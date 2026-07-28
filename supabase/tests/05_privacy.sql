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

rollback;
