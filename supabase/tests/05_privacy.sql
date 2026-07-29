-- ============================================================================
-- Retention and erasure.
--
-- ADR 0002 §5-6. These tests exist because a retention policy that only lives
-- in a document is a policy nobody follows.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_run uuid; v_old_run uuid;
  v_purged integer;
  v_att uuid;
  v_token text;
  v_product uuid; v_order uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');

  -- Publish while it is still in the future (publish_run refuses a past run),
  -- then move it into the check-in window.
  v_run := tests.make_run(v_admin, null, now() + interval '2 hours');
  update public.runs set starts_at = now() - interval '10 minutes',
                         ends_at   = now() + interval '1 hour'
   where id = v_run;

  perform tests.act_as(v_a);
  perform public.register_push_token('ExponentPushToken[aaa]', 'ios');
  perform public.check_in(v_run, 30.044400, 31.235700, 10);
  perform tests.act_as(v_b);
  perform public.check_in(v_run, 30.044400, 31.235700, 10);
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Retention: coordinates expire after 30 days, the check-in itself does not.
  -- ---------------------------------------------------------------------
  -- Scoped to this fixture's run: the suite runs against a seeded database,
  -- so a global count would be measuring the seed, not the behaviour.
  perform tests.assert_eq(
    (select count(*)::int from public.check_in_evidence where run_id = v_run), 2,
    'both check-ins recorded location evidence');

  -- Age one of them past the window.
  update public.check_in_evidence e
     set server_ts = now() - interval '31 days'
    from public.run_attendance a
   where a.id = e.attendance_id and a.user_id = v_a;

  v_purged := public.purge_expired_location_data();

  perform tests.assert_eq(v_purged, 1, 'the purge removes exactly the expired evidence');
  -- (1, not 2: the seed's own evidence rows are recent and must survive.)
  perform tests.assert_eq(
    (select count(*)::int from public.check_in_evidence where run_id = v_run), 1,
    'evidence inside the retention window is kept');

  -- The attendance record itself is untouched — Phase 2 points depend on it.
  perform tests.assert(
    (select checked_in_at is not null from public.run_attendance
     where run_id = v_run and user_id = v_a),
    'purging coordinates does not remove the check-in');
  perform tests.assert_eq(
    (select check_in_method from public.run_attendance where run_id = v_run and user_id = v_a),
    'geofence'::public.check_in_method,
    'and does not remove how the check-in happened');
  perform tests.assert_eq(
    (select checked_in_count::int from public.run_attendance_counts where run_id = v_run), 2,
    'headcounts are unaffected by the purge');

  perform tests.assert(
    exists (select 1 from public.audit_log where action = 'purge_location_data'),
    'the purge is recorded in the audit log');

  -- Running it again is a no-op.
  perform tests.assert_eq(public.purge_expired_location_data(), 0,
    'the purge is idempotent');

  -- ---------------------------------------------------------------------
  -- Erasure (GDPR Art. 17).
  -- ---------------------------------------------------------------------
  select id into v_att from public.run_attendance where run_id = v_run and user_id = v_b;

  -- A member cannot erase somebody else.
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.erase_member(%L)', v_b),
    'a member cannot erase another member''s account');
  perform tests.act_as_system();

  -- Give ben a Phase 2 footprint first: a friend, a live code, points and a
  -- badge. Erasure has to reach all of it, and the only way to know it does is
  -- to have some of it there when erasure runs.
  perform tests.act_as(v_b);
  select token into v_token from public.my_friend_qr();
  perform tests.act_as(v_a);
  perform public.add_friend_by_token(v_token);
  perform tests.act_as_system();

  -- And a Phase 3 one: a gift ama sent him, carrying free text.
  --
  -- Placed through place_order() rather than written straight into the table,
  -- so the fixture obeys the same rules a real gift does — the gift_is_not_self
  -- constraint rejects the shortcut of making one person both sides, which is
  -- the constraint doing its job.
  insert into public.products (name, price_minor, status, stock, sizes)
  values ('Test hoodie', 30000, 'in_stock', 5, array['S','L']) returning id into v_product;

  perform tests.act_as(v_a);
  v_order := public.place_order(v_product, 1, 'S', 0, v_b, 'see you Saturday');
  perform tests.act_as_system();
  update public.orders set status = 'paid' where id = v_order;

  -- Ben confirms it, which is where the address comes from.
  perform tests.act_as(v_b);
  perform public.redeem_gift(v_order, 'L', '14 Zamalek Street, ask for Ben');
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select delivery_note from public.orders where id = v_order),
    '14 Zamalek Street, ask for Ben',
    'the delivery note is stored while the member exists');

  perform tests.assert_eq(
    (select count(*)::int from public.friendships
      where user_low in (v_a, v_b) and user_high in (v_a, v_b)), 1,
    'ama and ben are friends before the erasure');

  perform tests.act_as(v_b);
  perform public.erase_member(v_b);
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Phase 2 data goes with the account.
  --
  -- A friendship that outlived one of its two people would leave ama with a
  -- friend who no longer exists, and — worse — a row still naming ben in a
  -- table nobody can read but which is nonetheless a record of who he knew.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    (select count(*)::int from public.friendships
      where user_low = v_b or user_high = v_b), 0,
    'their friendships are gone — nobody is left holding a friend who no longer exists');
  perform tests.assert_eq(
    (select count(*)::int from public.friend_qr_tokens where user_id = v_b), 0,
    'their friend codes are gone');
  perform tests.assert_eq(
    (select count(*)::int from public.member_badges where user_id = v_b), 0,
    'their badges are gone');

  -- The points ledger follows the attendance rule rather than the friends rule:
  -- anonymised, not deleted, because it is append-only and the club's own
  -- totals are derived from it.
  perform tests.assert(
    not exists (select 1 from public.point_events where user_id = v_b),
    'no points event still names them');

  -- ---------------------------------------------------------------------
  -- And what they typed goes with them.
  --
  -- The order row survives as anonymised sales history, which is right. What
  -- must not survive is the free text: a delivery note is an address, and a
  -- gift message is private correspondence.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    (select count(*)::int from public.orders where id = v_order), 1,
    'the order survives — the club''s sales history is not personal data');
  -- Only the recipient was erased. The buyer is still a member, and her record
  -- of what she bought is hers — erasing one person must not quietly strip
  -- another person's purchase history.
  perform tests.assert(
    (select recipient_id is null from public.orders where id = v_order),
    'it no longer names the person who was erased');
  perform tests.assert_eq(
    (select buyer_id from public.orders where id = v_order), v_a,
    'but the buyer, who has not erased anything, keeps her own order');
  perform tests.assert(
    (select delivery_note is null from public.orders where id = v_order),
    'the delivery note is gone — an anonymised row holding a street address is not anonymous');
  perform tests.assert(
    (select gift_message is null from public.orders where id = v_order),
    'and so is the message they wrote');
  perform tests.assert(
    (select size is null from public.orders where id = v_order),
    'and their size, which is a body measurement rather than a sales fact');

  -- The erasure completing at all is the assertion here. gift_has_recipient
  -- used to abort it: recipient_id is SET NULL on delete while is_gift stays
  -- true, so anybody who had ever been sent a gift could not delete their
  -- account. An integrity rule that forbids the anonymised state is a rule that
  -- forbids erasure.
  perform tests.assert(
    (select is_gift from public.orders where id = v_order),
    'the row still records that it was a gift, to somebody who no longer exists');

  perform tests.assert_eq(
    (select count(*)::int from public.sponsor_impressions where user_id = v_b), 0,
    'which sponsors they saw is deleted outright — it is a behavioural profile, not history');

  -- Personal data is gone.
  perform tests.assert_eq(
    (select count(*)::int from public.profiles where id = v_b), 0,
    'the profile is deleted');
  perform tests.assert_eq(
    (select count(*)::int from auth.users where id = v_b), 0,
    'the auth account is deleted');
  perform tests.assert_eq(
    (select count(*)::int from public.check_in_evidence where attendance_id = v_att), 0,
    'their location evidence is hard-deleted, not merely detached');
  perform tests.assert_eq(
    (select count(*)::int from public.push_tokens where user_id = v_b), 0,
    'their registered devices are removed');

  -- ...but the anonymous fact of attendance survives, so history stays correct.
  perform tests.assert_eq(
    (select count(*)::int from public.run_attendance where id = v_att), 1,
    'the attendance row survives erasure');
  perform tests.assert(
    (select user_id is null from public.run_attendance where id = v_att),
    'anonymised rather than deleted — the row no longer identifies anyone');
  perform tests.assert_eq(
    (select checked_in_count::int from public.run_attendance_counts where run_id = v_run), 2,
    'the headcount for a run that already happened is not silently corrupted');

  perform tests.assert(
    exists (select 1 from public.audit_log
            where action = 'erase_member' and entity_id = v_b::text),
    'the erasure is recorded in the audit log');

  -- The append-only event log is likewise anonymised, not deleted.
  perform tests.assert(
    (select count(*)::int from public.run_attendance_events where attendance_id = v_att) > 0,
    'the attendance history survives');
  perform tests.assert(
    not exists (select 1 from public.run_attendance_events
                where attendance_id = v_att and user_id is not null),
    'and carries no reference to the erased member');

  -- ---------------------------------------------------------------------
  -- Append-only: history cannot be rewritten, but anonymisation is permitted.
  -- That exception is what lets erasure above work at all.
  -- ---------------------------------------------------------------------
  perform tests.assert_rejects(
    format('update public.run_attendance_events set event = ''withdrawn''
            where attendance_id = %L', v_att),
    'attendance history cannot be rewritten');
  perform tests.assert_rejects(
    'update public.audit_log set action = ''nothing to see here''',
    'the audit log cannot be rewritten');
  perform tests.assert_rejects(
    format('update public.run_attendance_events set user_id = %L
            where attendance_id = %L', v_a, v_att),
    'a cleared reference cannot be reassigned to somebody else');

  raise notice 'PASS 05_privacy';
end $$;

-- ---------------------------------------------------------------------------
-- Consent is recorded, not assumed (migration 0048).
--
-- The club took consent verbally before this. That is real consent but not a
-- demonstrable one, and the burden of showing it was given sits with the club.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_a uuid; v_b uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser-c', true);
  v_a := tests.make_member('nour');
  v_b := tests.make_member('omar');

  -- A fresh member has accepted nothing, which is what the app gates on.
  perform tests.assert(
    (select consent_version is null from public.profiles where id = v_a),
    'a new member has no consent on file');

  -- Under 18 is refused rather than recorded as a false. There is no version
  -- of that row that would be valid consent, and writing one would create a
  -- record that looks like consent and is not.
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    'select public.accept_consent(''2026-07-draft'', false, true)',
    'an under-18 cannot consent for themselves, so it is refused not stored');
  perform tests.act_as_system();
  perform tests.assert(
    (select consent_version is null from public.profiles where id = v_a),
    'and nothing is written when it is refused');

  -- Accepting records the version, the age assertion and the photo position.
  perform tests.act_as(v_a);
  perform public.accept_consent('2026-07-draft', true, true);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select consent_version from public.profiles where id = v_a), '2026-07-draft',
    'acceptance records WHICH version was accepted');
  perform tests.assert(
    (select age_confirmed and not photo_objection from public.profiles where id = v_a),
    'along with the age assertion and the photo position');
  perform tests.assert_eq(
    (select count(*)::int from public.consent_events
      where user_id = v_a and event = 'accepted'), 1,
    'and leaves an append-only record of it');

  -- Objecting to photos at sign-up is carried through.
  perform tests.act_as(v_b);
  perform public.accept_consent('2026-07-draft', true, false);
  perform tests.act_as_system();
  perform tests.assert(
    (select photo_objection from public.profiles where id = v_b),
    'a member who declines photos at sign-up is recorded as objecting');

  -- Withdrawal has to be as easy as consent, or the consent was never valid.
  perform tests.act_as(v_a);
  perform public.set_photo_objection(true);
  perform tests.act_as_system();
  perform tests.assert(
    (select photo_objection from public.profiles where id = v_a),
    'a member can withdraw photo consent at any time');
  perform tests.assert_eq(
    (select count(*)::int from public.consent_events
      where user_id = v_a and event = 'photo_objection'), 1,
    'and the withdrawal is its own event rather than an edit of the acceptance');

  -- Setting it to what it already is must not fabricate a change of mind.
  perform tests.act_as(v_a);
  perform public.set_photo_objection(true);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.consent_events
      where user_id = v_a and event = 'photo_objection'), 1,
    'saving the same position again writes no history');

  -- Lifting it again is recorded too — the club needs both directions.
  perform tests.act_as(v_a);
  perform public.set_photo_objection(false);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.consent_events
      where user_id = v_a and event = 'photo_objection_lifted'), 1,
    'and changing back is recorded rather than erasing the objection');

  -- One member cannot read another's consent history.
  perform tests.act_as(v_b);
  perform tests.assert_eq(
    (select count(*)::int from public.consent_events where user_id = v_a), 0,
    'consent history is private to its owner');

  -- The organiser can see the objection, because they are the only person who
  -- can act on it when publishing a gallery.
  perform tests.act_as(v_admin);
  perform tests.assert(
    (select photo_objection from public.admin_members() where user_id = v_b),
    'organisers see who has asked not to appear in photos');

  -- Erasure takes the consent record with it: once the person is gone there is
  -- nobody whose consent needs demonstrating.
  perform tests.act_as(v_b);
  perform public.erase_member(v_b);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.consent_events where user_id = v_b), 0,
    'erasing a member erases their consent record with them');
end $$;

rollback;

-- ---------------------------------------------------------------------------
-- Avatars (migration 0051): own folder only, and erasure removes the face.
-- ---------------------------------------------------------------------------
do $$
declare
  v_a uuid; v_b uuid;
begin
  perform tests.act_as_system();
  v_a := tests.make_member('selfista');
  v_b := tests.make_member('other');

  perform tests.act_as(v_a);
  perform public.set_avatar('avatars/' || v_a || '/face.jpg');
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select avatar_url from public.profiles where id = v_a),
    'avatars/' || v_a || '/face.jpg',
    'a member sets their own avatar path');

  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.set_avatar(%L)', 'avatars/' || v_b || '/face.jpg'),
    'a member cannot point their face at somebody else''s folder');
  perform public.set_avatar(null);
  perform tests.act_as_system();
  perform tests.assert(
    (select avatar_url is null from public.profiles where id = v_a),
    'and clearing it works');

  -- Erasure reaches the stored files.
  perform tests.act_as_system();
  insert into storage.objects (bucket_id, name, owner)
  values ('avatars', v_a || '/face.jpg', v_a);
  perform tests.act_as(v_a);
  perform public.erase_member(v_a);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from storage.objects
      where bucket_id = 'avatars' and name like v_a || '/%'), 0,
    'erasing a member deletes their avatar files — the face does not outlive the person');
end $$;
