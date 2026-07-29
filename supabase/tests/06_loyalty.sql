-- ============================================================================
-- Loyalty: points, streaks, badges, tiers, and the leaderboard.
--
-- Money-adjacent (points become merch discounts in Phase 3) and privacy-
-- sensitive (the leaderboard is the one place a member sees another member's
-- name), so this gets the full rigour of Principles §11.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid;
  v_run uuid; v_run2 uuid; v_wk uuid;
  v_pts integer; v_rows integer; v_streak integer;
  v_now timestamptz := now();
  v_rank integer; v_total integer; v_dec uuid; v_tiered uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');
  v_c := tests.make_member('cleo');

  -- ---------------------------------------------------------------------
  -- Checking in awards points, exactly once.
  -- ---------------------------------------------------------------------
  v_run := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '10 minutes',
                         ends_at   = v_now + interval '1 hour'
   where id = v_run;

  perform tests.act_as(v_a);
  perform public.check_in(v_run, 30.044400, 31.235700, 10);
  perform tests.act_as_system();

  perform tests.assert_eq(
    public.points_total(v_a), 10,
    'checking in awards points');

  -- The trigger fires on the transition, and the ledger's unique index blocks
  -- a second award. Calling the award function directly must be a no-op.
  perform app_private.award_check_in_points(v_a, v_run, v_now);
  perform tests.assert_eq(
    public.points_total(v_a), 10,
    'awarding the same check-in twice does not double-count');

  perform tests.assert_eq(
    (select count(*)::int from public.point_events
     where user_id = v_a and run_id = v_run and kind = 'check_in'), 1,
    'and writes no duplicate ledger row');

  -- ---------------------------------------------------------------------
  -- An organiser removing a check-in revokes the points.
  --
  -- The ledger row survives — it is append-only and records what happened —
  -- but it stops counting, because the check-in behind it no longer stands.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_admin);
  perform public.admin_remove_check_in(v_run, v_a);
  perform tests.act_as_system();

  perform tests.assert_eq(
    public.points_total(v_a), 0,
    'removing a check-in revokes its points');
  perform tests.assert_eq(
    (select count(*)::int from public.point_events where user_id = v_a and run_id = v_run), 1,
    'but the ledger row is not deleted — the ledger is append-only');

  -- ...and restoring the check-in restores them, with no reversal bookkeeping.
  perform tests.act_as(v_admin);
  perform public.admin_check_in(v_run, v_a);
  perform tests.act_as_system();

  perform tests.assert_eq(
    public.points_total(v_a), 10,
    're-checking in restores the points automatically');

  -- ---------------------------------------------------------------------
  -- Withdrawing also stops points counting.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform public.check_in(v_run, 30.044400, 31.235700, 10);
  perform tests.act_as_system();
  perform tests.assert_eq(public.points_total(v_b), 10, 'ben earned points');

  -- Move the run back into the future so withdrawal is allowed; ends_at must
  -- move with it or the ends_after_starts constraint rejects the update.
  update public.runs set starts_at = v_now + interval '1 hour',
                         ends_at   = v_now + interval '3 hours'
   where id = v_run;
  perform tests.act_as(v_b);
  perform public.withdraw_from_run(v_run);
  perform tests.act_as_system();

  perform tests.assert_eq(
    public.points_total(v_b), 0,
    'withdrawing after checking in stops the points counting');

  -- ---------------------------------------------------------------------
  -- Streaks.
  --
  -- p_now is injected precisely so this is testable without waiting weeks.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    public.current_streak_weeks(v_c, v_now), 0,
    'a member who has never run has no streak');

  -- Three consecutive weekly runs, all attended.
  for i in 1..3 loop
    v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
    update public.runs
       set starts_at = v_now - (i || ' weeks')::interval,
           ends_at   = v_now - (i || ' weeks')::interval + interval '1 hour',
           status    = 'completed'
     where id = v_wk;

    insert into public.run_attendance (run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method)
    values (v_wk, v_c, v_now - (i || ' weeks')::interval,
            v_now - (i || ' weeks')::interval,
            v_now - (i || ' weeks')::interval, 'admin');
  end loop;

  perform tests.assert(
    public.current_streak_weeks(v_c, v_now) >= 3,
    'three consecutive attended weeks make a streak of at least three');

  -- A week the club offered a run and the member missed it breaks the streak.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs
     set starts_at = v_now - interval '4 weeks',
         ends_at   = v_now - interval '4 weeks' + interval '1 hour',
         status    = 'completed'
   where id = v_wk;   -- offered, not attended by cleo

  v_streak := public.current_streak_weeks(v_c, v_now);
  perform tests.assert(
    v_streak <= 4,
    'a missed week the club did run ends the streak');

  -- ---------------------------------------------------------------------
  -- Streak bonus scales and is capped, so nobody becomes uncatchable.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(app_private.points_for_streak(1), 0, 'a one-week streak earns no bonus');
  perform tests.assert_eq(app_private.points_for_streak(3), 4, 'a three-week streak earns 4');
  perform tests.assert_eq(app_private.points_for_streak(50), 10, 'the streak bonus is capped at 10');

  -- ---------------------------------------------------------------------
  -- Tiers — thresholds and the always-forward framing.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(public.tier_for_points(0),   'rookie'::public.member_tier,     '0 points is Rookie');
  perform tests.assert_eq(public.tier_for_points(59),  'rookie'::public.member_tier,     '59 is still Rookie');
  perform tests.assert_eq(public.tier_for_points(60),  'runner'::public.member_tier,     '60 reaches Runner');
  perform tests.assert_eq(public.tier_for_points(150), 'competitor'::public.member_tier, '150 reaches Competitor');
  perform tests.assert_eq(public.tier_for_points(290), 'elite'::public.member_tier,      '290 reaches Elite');
  perform tests.assert_eq(public.tier_for_points(480), 'legend'::public.member_tier,     '480 reaches Legend');

  -- The ladder is calibrated so that never missing a Saturday for six months
  -- reaches the top: 26 runs at 10 points, plus a streak bonus climbing 2 a
  -- week to a cap of 10. If either of those rules changes, this breaks — which
  -- is the point, because the tier thresholds would silently stop meaning what
  -- the owner asked for.
  perform tests.assert_eq(
    (select sum(10 + app_private.points_for_streak(w))::int
       from generate_series(1, 26) w),
    490,
    'six months of never missing is worth 490 points');
  perform tests.assert_eq(
    public.tier_for_points(
      (select sum(10 + app_private.points_for_streak(w))::int from generate_series(1, 26) w)),
    'legend'::public.member_tier,
    '...which is Legend — the six-month ladder the owner asked for');

  perform tests.assert_eq(public.points_to_next_tier(50), 10,
    'distance to the next tier is stated as points to go');
  perform tests.assert(
    public.points_to_next_tier(500) is null,
    'at the top there is no next tier — null, not zero, so the UI can celebrate rather than show a dead target');

  -- ---------------------------------------------------------------------
  -- Badges.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    (select count(*)::int from public.member_badges where user_id = v_c), 0,
    'no badge before the threshold is reached');

  -- Push cleo to 10 attended runs.
  for i in 5..12 loop
    v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
    update public.runs
       set starts_at = v_now - (i || ' weeks')::interval,
           ends_at   = v_now - (i || ' weeks')::interval + interval '1 hour',
           status    = 'completed'
     where id = v_wk;
    insert into public.run_attendance (run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method)
    values (v_wk, v_c, v_now - (i || ' weeks')::interval,
            v_now - (i || ' weeks')::interval,
            v_now - (i || ' weeks')::interval, 'admin');
  end loop;

  perform tests.assert(
    public.runs_attended(v_c) >= 10,
    'cleo has attended at least ten runs');
  perform tests.assert(
    exists (select 1 from public.member_badges where user_id = v_c and badge_key = 'runs_10'),
    'the ten-run badge is awarded automatically');
  perform tests.assert(
    not exists (select 1 from public.member_badges where user_id = v_c and badge_key = 'runs_50'),
    'and a badge beyond the threshold is not');

  -- Badges do not duplicate on further check-ins.
  perform app_private.award_badges(v_c, v_now);
  perform tests.assert_eq(
    (select count(*)::int from public.member_badges where user_id = v_c and badge_key = 'runs_10'), 1,
    'a badge is earned once, not once per subsequent run');

  -- ---------------------------------------------------------------------
  -- The leaderboard — the one deliberate exception to "no member directory".
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert(
    (select count(*) from public.leaderboard('all_time')) > 0,
    'a member can read the leaderboard');
  perform tests.assert(
    exists (select 1 from public.leaderboard('all_time') where is_me),
    'and can see which row is their own');
  perform tests.act_as_system();

  -- It must never expose more than name, avatar and a total. Anything
  -- run-level would rebuild the per-run attendance log the owner hid.
  perform tests.assert(
    not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'leaderboard'
        and column_name in ('email', 'checked_in_at', 'run_id')
    ),
    'the leaderboard exposes no email, no run and no check-in time');

  -- ---------------------------------------------------------------------
  -- Opt-out: hidden from others, still visible to yourself.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_c);
  perform public.set_leaderboard_visibility(false);
  perform tests.act_as_system();

  perform tests.act_as(v_a);
  perform tests.assert(
    not exists (select 1 from public.leaderboard('all_time') where user_id = v_c),
    'a member who opts out disappears from everyone else''s leaderboard');
  perform tests.act_as_system();

  perform tests.act_as(v_c);
  select rank, total_members into v_rank, v_total from public.my_standing('all_time');
  perform tests.assert(
    v_rank is not null and v_rank > 0,
    'but still sees their own rank — opting out of publicity is not opting out of the club');
  perform tests.act_as_system();

  -- Opting back in restores visibility.
  perform tests.act_as(v_c);
  perform public.set_leaderboard_visibility(true);
  perform tests.act_as_system();
  perform tests.act_as(v_a);
  perform tests.assert(
    exists (select 1 from public.leaderboard('all_time') where user_id = v_c),
    'and can opt back in');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Access control.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.point_events where user_id = v_c), 0,
    'a member cannot read another member''s points ledger');
  perform tests.assert_eq(
    (select count(*)::int from public.member_badges where user_id = v_c), 0,
    'nor their badges');

  perform tests.assert_rejects(
    format('insert into public.point_events (user_id, kind, points) values (%L, ''adjustment'', 9999)', v_a),
    'a member cannot award themselves points');
  perform tests.assert_rejects(
    format('select public.admin_adjust_points(%L, 5000, ''nice try'')', v_a),
    'a member cannot use the organiser adjustment function');
  perform tests.assert_rejects(
    'select public.backfill_loyalty()',
    'a member cannot trigger a backfill');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Organiser adjustment — allowed, but never anonymous.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_admin);
  perform tests.assert_rejects(
    format('select public.admin_adjust_points(%L, 50, '''')', v_a),
    'an adjustment without a stated reason is refused');

  perform public.admin_adjust_points(v_a, 50, 'missed check-in at Zamalek, confirmed in person');
  perform tests.act_as_system();

  perform tests.assert_eq(
    public.points_total(v_a), 60,
    'an organiser adjustment lands in the total');
  perform tests.assert(
    exists (select 1 from public.audit_log where action = 'adjust_points'),
    'and is written to the audit log');

  -- An adjustment is exempt from the per-run uniqueness, so a second
  -- correction to the same member is possible.
  perform tests.act_as(v_admin);
  perform public.admin_adjust_points(v_a, -10, 'correcting the previous adjustment');
  perform tests.act_as_system();
  perform tests.assert_eq(
    public.points_total(v_a), 50,
    'a second adjustment is allowed and nets correctly');

  -- ---------------------------------------------------------------------
  -- Points ease back when somebody stops coming.
  --
  -- The rule that makes a six-month ladder mean anything: without it every
  -- regular is Legend forever by their second season. It is also the only rule
  -- in the app that takes something away from a member, so the shape of it
  -- matters more than the arithmetic — the first miss is free, and nobody can
  -- be driven below zero.
  -- ---------------------------------------------------------------------
  v_dec := tests.make_member('dana');

  -- Dana attends one run, then stops.
  --
  -- The timings sit inside the last few days on purpose. The seeded database
  -- carries a year of completed runs, and anchoring this fixture further back
  -- would count those as misses too — the count is against the club's real
  -- schedule, which in this database is not empty.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs
     set starts_at = v_now - interval '3 days',
         ends_at   = v_now - interval '3 days' + interval '1 hour',
         status    = 'completed'
   where id = v_wk;
  insert into public.run_attendance (run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method)
  values (v_wk, v_dec, v_now - interval '3 days', v_now - interval '3 days',
          v_now - interval '3 days', 'admin');

  perform tests.assert_eq(public.points_total(v_dec), 10, 'dana earned one run''s points');

  -- The club runs again and she misses it. One miss costs nothing.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '2 days',
                         ends_at   = v_now - interval '2 days' + interval '1 hour'
   where id = v_wk;
  update public.runs set status = 'completed' where id = v_wk;

  perform tests.assert_eq(
    public.points_total(v_dec), 10,
    'missing one run costs nothing — a wedding, a night shift, a cold');

  -- The second consecutive miss is where it starts.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '36 hours',
                         ends_at   = v_now - interval '36 hours' + interval '1 hour'
   where id = v_wk;
  update public.runs set status = 'completed' where id = v_wk;

  perform tests.assert_eq(
    public.points_total(v_dec), 0,
    'the second consecutive miss costs a run''s worth');
  perform tests.assert_eq(
    (select count(*)::int from public.point_events where user_id = v_dec and kind = 'absence'), 1,
    'and is recorded in the ledger rather than silently subtracted');

  -- Re-completing the same run must not charge twice.
  perform app_private.apply_absence_decay(v_wk);
  perform tests.assert_eq(
    (select count(*)::int from public.point_events where user_id = v_dec and kind = 'absence'), 1,
    'the same run cannot charge a member twice — a retried tick is safe');

  -- The floor. Dana is already at zero; missing more must not push her under.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '24 hours',
                         ends_at   = v_now - interval '24 hours' + interval '1 hour'
   where id = v_wk;
  update public.runs set status = 'completed' where id = v_wk;

  perform tests.assert_eq(
    public.points_total(v_dec), 0,
    'nobody is driven below zero — a member coming back starts where they left off, not in debt');

  -- Somebody who has never attended is not "missing" runs.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '12 hours',
                         ends_at   = v_now - interval '12 hours' + interval '1 hour'
   where id = v_wk;
  update public.runs set status = 'completed' where id = v_wk;

  perform tests.assert_eq(
    (select count(*)::int from public.point_events
      where user_id = v_admin and kind = 'absence'), 0,
    'a member who has never checked in is not penalised — they have not started, not stopped');

  -- Absence is not tied to a check-in, so it must survive the validity rule
  -- that governs run-linked awards. If it did not, every penalty would be
  -- filtered straight back out and the feature would do nothing.
  perform tests.assert_eq(
    (select count(*)::int from public.effective_point_events
      where user_id = v_dec and kind = 'absence'), 1,
    'an absence charge counts even though there is no check-in behind it');

  -- ---------------------------------------------------------------------
  -- Crossing a tier is recorded once, when it happens.
  --
  -- Derived state cannot answer "did something just happen?", and a value
  -- cached on the device answers it differently on every phone. So the crossing
  -- is an event, and the celebration is driven from the database.
  -- ---------------------------------------------------------------------
  v_tiered := tests.make_member('tess');

  perform tests.assert_eq(
    (select count(*)::int from public.member_tier_reached where user_id = v_tiered), 0,
    'a new member has crossed nothing');

  -- Straight to Competitor with one adjustment.
  perform tests.act_as(v_admin);
  perform public.admin_adjust_points(v_tiered, 200, 'seeding a tier crossing for the test');
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select count(*)::int from public.member_tier_reached
      where user_id = v_tiered and tier = 'competitor'), 1,
    'crossing a tier records it');
  perform tests.assert(
    (select acknowledged_at is null from public.member_tier_reached
      where user_id = v_tiered and tier = 'competitor'),
    'and leaves it unacknowledged, so the app can celebrate it');

  -- Rookie is never recorded: everybody is Rookie from their first point, and
  -- a chest for arriving where you already were is noise.
  perform tests.assert_eq(
    (select count(*)::int from public.member_tier_reached
      where user_id = v_tiered and tier = 'rookie'), 0,
    'Rookie is not celebrated — it is where everyone starts');

  -- Falling back and climbing again must not re-award. Points can go down now,
  -- and a reward you can farm by resting is not a reward.
  perform tests.act_as(v_admin);
  perform public.admin_adjust_points(v_tiered, -100, 'dropping them back below the line');
  perform public.admin_adjust_points(v_tiered, 100, 'and back over it');
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select count(*)::int from public.member_tier_reached
      where user_id = v_tiered and tier = 'competitor'), 1,
    'dropping out of a tier and climbing back does not hand out a second chest');

  -- And the drop itself is not celebrated. Sliding from Competitor down to
  -- Runner is not "reaching Runner", and a chest for it would be congratulating
  -- somebody on a demotion.
  perform tests.assert_eq(
    (select count(*)::int from public.member_tier_reached
      where user_id = v_tiered and tier = 'runner'), 0,
    'falling to a lower tier is never recorded as reaching it');

  -- The member sees their own, and acknowledging clears it.
  perform tests.act_as(v_tiered);
  perform tests.assert_eq(
    (select count(*)::int from public.my_unclaimed_tiers()), 1,
    'the member has one unclaimed tier');

  perform public.acknowledge_tier('competitor');
  perform tests.assert_eq(
    (select count(*)::int from public.my_unclaimed_tiers()), 0,
    'and acknowledging it clears it, so the chest shows once');

  perform tests.assert_eq(
    (select count(*)::int from public.member_tier_reached where user_id = v_a), 0,
    'and one member cannot see another member''s tier history');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- The ledger is append-only.
  -- ---------------------------------------------------------------------
  perform tests.assert_rejects(
    format('update public.point_events set points = 9999 where user_id = %L', v_a),
    'ledger rows cannot be rewritten');

  raise notice 'PASS 06_loyalty';
end $$;

rollback;
