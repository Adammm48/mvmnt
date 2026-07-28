-- ============================================================================
-- Friends, QR codes and pokes.
--
-- This is the security-sensitive half of Phase 2. The safety property App Spec
-- §4.4 asks for — you can only be added by someone who stood in front of you —
-- rests entirely on properties of the token: it expires, it burns on use, and
-- it can be killed. None of those is visible in the UI, so if any of them
-- silently stopped holding, nothing would look wrong. They are tested here.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid;
  v_run uuid; v_past uuid; v_draft uuid;
  v_tok text; v_tok2 text; v_exp timestamptz;
  v_owner uuid; v_rows integer; v_state public.attendance_state;
  v_name text; v_title text; v_poked boolean;
  v_now timestamptz := now();
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');
  v_c := tests.make_member('cleo');
  v_run := tests.make_run(v_admin, null, v_now + interval '2 hours');

  -- ---------------------------------------------------------------------
  -- Showing a code.
  --
  -- Stable while it lives: a code that changed on every render would be
  -- unscannable, because the other phone is reading it over a second or two.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  select token, expires_at into v_tok, v_exp from public.my_friend_qr();
  perform tests.assert(v_tok is not null, 'a member can show a friend code');
  perform tests.assert(
    v_exp > now() and v_exp <= now() + interval '3 minutes',
    'the code expires within three minutes — that short life is what makes "in person" true');

  select token into v_tok2 from public.my_friend_qr();
  perform tests.assert_eq(v_tok2, v_tok,
    'showing the code again reuses the live one rather than minting a new one');

  -- ---------------------------------------------------------------------
  -- Scanning it.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform tests.assert_rejects(
    format('select public.add_friend_by_token(%L)', v_tok || 'x'),
    'a made-up token is not accepted');

  v_owner := public.add_friend_by_token(v_tok);
  perform tests.assert_eq(v_owner, v_a, 'scanning a code returns whose code it was');

  -- Single use. A code photographed over a shoulder must not keep working for
  -- the rest of its three minutes.
  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.add_friend_by_token(%L)', v_tok),
    'a token is single-use — one scan, one friendship');

  -- ---------------------------------------------------------------------
  -- The friendship is one thing, seen identically from both sides.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  select count(*)::int into v_rows from public.my_friends(v_run);
  perform tests.assert_eq(v_rows, 1, 'ama sees ben');

  perform tests.act_as(v_b);
  select count(*)::int into v_rows from public.my_friends(v_run);
  perform tests.assert_eq(v_rows, 1, 'and ben sees ama — one row, not two rows that can drift apart');

  -- Nobody can read the social graph directly. A member who could select
  -- friendships could map who knows whom across the whole club, which is the
  -- member directory §4.4 exists to prevent.
  perform tests.assert_rejects(
    'select * from public.friendships',
    'the friendships table is not readable by a member');
  perform tests.assert_rejects(
    'select * from public.friend_qr_tokens',
    'nor is the token table — reading it would be a permanent skeleton key');

  -- ---------------------------------------------------------------------
  -- What a friend row carries: presence, not performance.
  --
  -- The council's warning was that a friends list carrying stats is a
  -- leaderboard at n=2, and re-exposes the per-run attendance the owner asked
  -- to hide. It carries a name, an avatar and one in/out flag.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    (select count(*)::int
     from information_schema.columns
     where table_schema = 'public'
       and table_name = 'my_friends'),
    0, 'my_friends is a function, not a view anyone can widen by accident');

  perform tests.act_as(v_a);
  select state into v_state from public.my_friends(v_run) where friend_id = v_b;
  perform tests.assert(v_state is null, 'a friend who has not signed up shows as nothing yet');

  perform tests.act_as(v_b);
  perform public.join_run(v_run);

  perform tests.act_as(v_a);
  select state into v_state from public.my_friends(v_run) where friend_id = v_b;
  perform tests.assert_eq(v_state, 'signed_up'::public.attendance_state,
    'and shows as in once they sign up');

  -- ---------------------------------------------------------------------
  -- Pokes.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.poke_friend(%L, %L)', v_a, v_run),
    'you cannot nudge someone who is not your friend — friendship is the authorisation');

  perform tests.act_as(v_a);
  select already_poked into v_poked from public.my_friends(v_run) where friend_id = v_b;
  perform tests.assert(v_poked is false, 'nothing nudged yet');

  perform public.poke_friend(v_b, v_run);

  select already_poked into v_poked from public.my_friends(v_run) where friend_id = v_b;
  perform tests.assert(v_poked, 'the list reports the nudge, so the button can stop offering it');

  -- The cap from App Spec §9: one per friend per run, forever.
  perform tests.assert_rejects(
    format('select public.poke_friend(%L, %L)', v_b, v_run),
    'a friend can be nudged once per run and no more');

  perform tests.act_as_system();
  select display_name into v_name from public.profiles where id = v_a;
  select title into v_title
  from public.notification_events
  where type = 'friend_poke' and target_user_id = v_b and run_id = v_run;

  perform tests.assert_eq(v_title, v_name || ' wants you there',
    'the nudge names the person who sent it — anonymous nagging is not the mechanic');

  -- Two friends nudging about the same run are two separate notifications.
  -- The dedupe key is derived, so getting this wrong would silently mute
  -- everyone after the first sender.
  perform tests.act_as(v_a);
  select token into v_tok from public.my_friend_qr();
  perform tests.act_as(v_c);
  perform public.add_friend_by_token(v_tok);   -- cleo and ama are now friends
  perform tests.act_as(v_c);
  select token into v_tok from public.my_friend_qr();
  perform tests.act_as(v_b);
  perform public.add_friend_by_token(v_tok);   -- ben and cleo are now friends
  perform public.poke_friend(v_c, v_run);      -- ben nudges cleo

  perform tests.act_as(v_c);
  perform public.poke_friend(v_b, v_run);      -- cleo nudges ben

  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
     where type = 'friend_poke' and target_user_id = v_b and run_id = v_run), 2,
    'two friends nudging about the same run produce two notifications, not one');

  -- Only about a run that has not happened.
  v_past := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '1 hour',
                         ends_at   = v_now
   where id = v_past;
  v_draft := tests.make_run(v_admin, null, v_now + interval '3 hours', false);

  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.poke_friend(%L, %L)', v_b, v_past),
    'you cannot nudge someone about a run that has already started');

  perform tests.assert_rejects(
    format('select public.poke_friend(%L, %L)', v_b, v_draft),
    'nor about a draft the club has not announced');

  -- ---------------------------------------------------------------------
  -- Unfriending: unilateral, immediate, and quiet.
  --
  -- Quiet on purpose. The council raised that people accept out of politeness
  -- and then feel unable to withdraw; a removal that pings the other person is
  -- one nobody socially awkward will ever use.
  -- ---------------------------------------------------------------------
  perform tests.act_as_system();
  v_rows := (select count(*)::int from public.notification_events);

  perform tests.act_as(v_a);
  perform public.remove_friend(v_b);
  select count(*)::int into v_rows from public.my_friends(v_run) where friend_id = v_b;
  perform tests.assert_eq(v_rows, 0, 'ama no longer sees ben');

  perform tests.act_as(v_b);
  select count(*)::int into v_rows from public.my_friends(v_run) where friend_id = v_a;
  perform tests.assert_eq(v_rows, 0, 'and ben no longer sees ama — removal is symmetric');

  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.notification_events where type = 'friend_poke'
      and created_by = v_a and target_user_id = v_b), 0,
    'and the nudges between them are gone rather than left queued');

  -- ---------------------------------------------------------------------
  -- Killing a code that got away (App Spec §8).
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  select token into v_tok from public.my_friend_qr();
  perform public.revoke_my_friend_qr();

  perform tests.act_as(v_b);
  perform tests.assert_rejects(
    format('select public.add_friend_by_token(%L)', v_tok),
    'a revoked code stops working immediately');

  -- Revoking stops future adds; it does not undo friendships already made.
  perform tests.act_as(v_a);
  select count(*)::int into v_rows from public.my_friends(v_run);
  perform tests.assert_eq(v_rows, 1, 'ama still has cleo — revoking a code is not unfriending');

  -- Expiry, independent of revocation.
  perform tests.act_as(v_a);
  select token into v_tok from public.my_friend_qr();
  perform tests.act_as_system();
  update public.friend_qr_tokens set expires_at = now() - interval '1 second'
   where token = v_tok;

  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.add_friend_by_token(%L)', v_tok),
    'an expired code stops working — this is what makes a forwarded screenshot useless');

  -- And you cannot befriend yourself into anything.
  perform tests.act_as(v_a);
  select token into v_tok from public.my_friend_qr();
  perform tests.assert_rejects(
    format('select public.add_friend_by_token(%L)', v_tok),
    'scanning your own code is rejected');

  -- ---------------------------------------------------------------------
  -- Moderation (App Spec §7).
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform tests.assert_rejects(
    format('select public.admin_disable_member_qr(%L)', v_a),
    'a member cannot disable another member''s code');

  perform tests.act_as(v_a);
  select token into v_tok from public.my_friend_qr();
  perform tests.act_as(v_admin);
  perform public.admin_disable_member_qr(v_a);

  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.add_friend_by_token(%L)', v_tok),
    'an organiser can kill a reported member''s code');

  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.audit_log
     where action = 'disable_member_qr' and entity_id = v_a::text), 1,
    'and that moderation action is on the record');

  -- ---------------------------------------------------------------------
  -- Badges announce themselves.
  --
  -- Wired in 0020 after 0016 declared the intent and did not act on it, so the
  -- test exists to keep the two from drifting apart again.
  -- ---------------------------------------------------------------------
  perform tests.act_as_system();
  for i in 1..10 loop
    v_past := tests.make_run(v_admin, null, v_now + interval '2 hours');
    update public.runs
       set starts_at = v_now - (i || ' days')::interval,
           ends_at   = v_now - (i || ' days')::interval + interval '1 hour',
           status    = 'completed'
     where id = v_past;

    insert into public.run_attendance (run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method)
    values (v_past, v_c, v_now - (i || ' days')::interval,
            v_now - (i || ' days')::interval,
            v_now - (i || ' days')::interval, 'admin');
  end loop;

  perform tests.assert_eq(
    (select count(*)::int from public.member_badges
     where user_id = v_c and badge_key = 'runs_10'), 1,
    'ten runs earns the first badge');

  select title into v_title
  from public.notification_events
  where type = 'badge_earned' and target_user_id = v_c;

  perform tests.assert_eq(v_title, 'Badge unlocked',
    'and the member is told about it');

  perform tests.assert(
    (select run_id from public.notification_events
     where type = 'badge_earned' and target_user_id = v_c) is null,
    'a badge notification has no run — it is earned across many of them');

  -- Fan-out must cope with a run-less notification, or badge pushes sit
  -- unprocessed forever while every other type flows.
  perform tests.assert_eq(
    app_private.fan_out_notification(
      (select id from public.notification_events
       where type = 'badge_earned' and target_user_id = v_c)),
    1, 'and it fans out to the member like any other notification');

  raise notice 'friends: all assertions passed';
end $$;

rollback;
