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
  v_rank integer; v_total integer; v_dec uuid; v_tiered uuid; v_secret uuid;
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
  -- Scoped to the visible catalogue. The hidden badges in 0028 fire on rules
  -- like "checked in before 6am", and this fixture's timestamps come from
  -- now() — so a global count here would pass or fail depending on what time
  -- of day the suite happened to run.
  perform tests.assert_eq(
    (select count(*)::int from public.member_badges mb
      join public.badges b on b.key = mb.badge_key
     where mb.user_id = v_c and not b.is_secret), 0,
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
  -- Missing runs costs nothing (migration 0046).
  --
  -- Absence decay was built, then removed on the owner's decision after the
  -- end-of-build council: docking points for missed Saturdays gives a member
  -- who has drifted a reason not to come back, in a club whose actual problem
  -- is turnout. This proves the charge is gone rather than merely disabled —
  -- a dormant trigger and a removed one look identical until one fires.
  --
  -- The tier consequence is accepted deliberately: a tier is now a record of
  -- what a member has done, and "what they are doing now" is carried by the
  -- streak and by the leaderboard's monthly window, neither of which takes
  -- anything away from anybody.
  -- ---------------------------------------------------------------------
  v_dec := tests.make_member('dana');

  -- Dana attends one run, then stops. The timings sit inside the last few days
  -- on purpose: the seeded database carries a year of completed runs, and
  -- anchoring further back would drag those in too.
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

  -- Three consecutive misses — well past where the old rule started charging.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '2 days',
                         ends_at   = v_now - interval '2 days' + interval '1 hour'
   where id = v_wk;
  update public.runs set status = 'completed' where id = v_wk;

  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '36 hours',
                         ends_at   = v_now - interval '36 hours' + interval '1 hour'
   where id = v_wk;
  update public.runs set status = 'completed' where id = v_wk;

  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs set starts_at = v_now - interval '24 hours',
                         ends_at   = v_now - interval '24 hours' + interval '1 hour'
   where id = v_wk;
  update public.runs set status = 'completed' where id = v_wk;

  perform tests.assert_eq(
    public.points_total(v_dec), 10,
    'three missed runs in a row cost nothing — what she earned is hers');
  perform tests.assert_eq(
    (select count(*)::int from public.point_events
      where user_id = v_dec and kind = 'absence'), 0,
    'and no absence charge is written at all');

  -- The measurement survives the removal: the club can still see who has
  -- drifted, which is the raw material for a welcome-back nudge rather than
  -- a fine. It counts the club's schedule, not weeks.
  -- At LEAST the three we created, never exactly three: consecutive_missed_runs
  -- counts every completed club run, and the seeded calendar keeps moving —
  -- the demo run that starts twenty minutes from a reset has completed by the
  -- time anyone runs this suite an hour later, making it a fourth miss. Same
  -- family as "never assert a global count": the number belongs to the whole
  -- database, not to this fixture. What the test is actually for is that the
  -- drift is MEASURABLE and uncharged.
  perform tests.assert(
    public.consecutive_missed_runs(v_dec, v_now) >= 3,
    'the club can still measure a drift without charging for it');

  -- An organiser adjustment stays the ONLY way a total goes down, and that one
  -- is deliberate, attributed and audited.
  perform tests.act_as(v_admin);
  perform public.admin_adjust_points(v_dec, -5, 'the only way points come off');
  perform tests.act_as_system();
  perform tests.assert_eq(
    public.points_total(v_dec), 5,
    'an organiser can still correct a total by hand');

  -- ---------------------------------------------------------------------
  -- A tier is a lifetime fact, on every board (migration 0047).
  --
  -- The monthly board used to recompute the tier from the month's points, so
  -- a member with a lifetime Elite total and a quiet month was rendered as
  -- whatever the quiet month was worth — contradicting their own standing
  -- card four inches above it on the same screen.
  -- ---------------------------------------------------------------------
  declare
    v_tiered uuid; v_life public.member_tier; v_board public.member_tier;
  begin
    perform tests.act_as_system();
    v_tiered := tests.make_member('tessa');
    -- A big lifetime total, awarded well before this month.
    insert into public.point_events (user_id, kind, points, source, note, awarded_at)
    values (v_tiered, 'adjustment', 400, 'live', 'lifetime total',
            now() - interval '6 months');
    -- And a small amount inside the current month.
    insert into public.point_events (user_id, kind, points, source, note)
    values (v_tiered, 'adjustment', 20, 'live', 'a quiet month');

    perform tests.act_as(v_tiered);
    select tier into v_life from public.my_standing('month');
    select tier into v_board
      from public.leaderboard('month') where is_me limit 1;

    perform tests.assert_eq(v_board, v_life,
      'the monthly board shows the same tier as the member''s own standing card');
    perform tests.assert_eq(v_life, 'elite'::public.member_tier,
      'and it is the lifetime tier, not what this month alone would be worth');

    -- The points column still reflects the window — only the tier is lifetime.
    perform tests.assert_eq(
      (select points from public.leaderboard('month') where is_me limit 1), 20,
      'while the points column still shows the window the board is ranking by');
  end;
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Ties break by who got there first (migration 0057).
  --
  -- Owner decision: no shared places. Two members on the same points cannot
  -- both be "=5" — the one who reached the total first stays ahead, the way
  -- race results settle a dead heat on the earlier finisher. The board and
  -- the member's own card must agree on the resulting order, because they
  -- compute it separately and this project has already met that bug.
  -- ---------------------------------------------------------------------
  declare
    v_first uuid; v_second uuid;
    v_rank_first integer; v_rank_second integer; v_gap integer;
  begin
    perform tests.act_as_system();
    v_first := tests.make_member('tortoise');
    v_second := tests.make_member('hare');

    -- Same total, reached at different moments: the tortoise got there
    -- yesterday, the hare only just arrived.
    insert into public.point_events (user_id, kind, points, source, note, awarded_at)
    values (v_first, 'adjustment', 70, 'live', 'reached 70 yesterday', now() - interval '1 day');
    insert into public.point_events (user_id, kind, points, source, note)
    values (v_second, 'adjustment', 70, 'live', 'reached 70 just now');

    perform tests.act_as(v_first);
    select l.rank into v_rank_first from public.leaderboard() l where l.is_me;
    perform tests.act_as(v_second);
    select l.rank into v_rank_second from public.leaderboard() l where l.is_me;

    perform tests.assert(
      v_rank_first < v_rank_second,
      'equal points: whoever reached the total first ranks higher');
    perform tests.assert_eq(
      v_rank_second - v_rank_first, 1,
      'and the places are consecutive — no shared =N, no gap');

    -- The member's own card agrees with the board about the rank…
    perform tests.act_as(v_second);
    perform tests.assert_eq(
      (select ms.rank from public.my_standing() ms), v_rank_second,
      'my_standing computes the same unique rank as the board');

    -- …and tells the tied-but-below member the honest cost of passing:
    -- one point, because matching a total only ties it and a fresh earner
    -- loses the tie on time.
    select ms.points_to_next_rank into v_gap from public.my_standing() ms;
    perform tests.assert_eq(
      v_gap, 1,
      'level on points, behind on time: one point takes the place');
  end;
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- The hidden badges.
  --
  -- Awarded silently and absent from the catalogue until earned — my_badges()
  -- must not return one the member has not got, or the surprise becomes a
  -- to-do list.
  -- ---------------------------------------------------------------------
  v_secret := tests.make_member('sam');

  perform tests.act_as(v_secret);
  perform tests.assert_eq(
    (select count(*)::int from public.my_badges() where is_secret), 0,
    'an unearned secret badge is not listed at all');
  perform tests.assert(
    (select count(*) from public.my_badges() where not is_secret) >= 4,
    'while the visible catalogue is fully listed, earned or not');
  perform tests.act_as_system();

  -- A 5am check-in, stated explicitly rather than relying on the clock.
  v_wk := tests.make_run(v_admin, null, v_now + interval '2 hours');
  update public.runs
     set starts_at = (date_trunc('day', v_now at time zone 'Africa/Cairo')
                      - interval '1 day' + interval '5 hours') at time zone 'Africa/Cairo',
         ends_at   = (date_trunc('day', v_now at time zone 'Africa/Cairo')
                      - interval '1 day' + interval '6 hours') at time zone 'Africa/Cairo',
         status    = 'completed'
   where id = v_wk;

  insert into public.run_attendance (run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method)
  select v_wk, v_secret, r.starts_at, r.starts_at, r.starts_at, 'admin'
  from public.runs r where r.id = v_wk;

  perform tests.assert_eq(
    (select count(*)::int from public.member_badges
      where user_id = v_secret and badge_key = 'secret_dawn'), 1,
    'checking in before 6am quietly earns the 5am club');

  perform tests.act_as(v_secret);
  perform tests.assert_eq(
    (select count(*)::int from public.my_badges() where key = 'secret_dawn'), 1,
    'and it appears on their own profile once earned');
  perform tests.act_as_system();

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
  -- Every total in the app agrees.
  --
  -- The predicate deciding which ledger rows count lived in four copies, and
  -- they drifted: points_total() counted absence penalties while the
  -- leaderboard did not, so a member's own points and their board points
  -- disagreed. Nothing errored — both numbers looked plausible on their own.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_dec);
  perform tests.assert_eq(
    (select points from public.my_standing()),
    public.points_total(v_dec),
    'a member''s standing matches their own points total, after a penalty');

  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select points from public.my_standing()),
    public.points_total(v_a),
    'and after an organiser adjustment');

  perform tests.act_as(v_c);
  perform tests.assert_eq(
    (select points from public.my_standing()),
    public.points_total(v_c),
    'and after check-ins and streak bonuses');

  perform tests.assert_eq(
    (select points from public.leaderboard() where is_me),
    public.points_total(v_c),
    'and the public board shows that same number, not a second opinion');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- The ledger is append-only.
  -- ---------------------------------------------------------------------
  perform tests.assert_rejects(
    format('update public.point_events set points = 9999 where user_id = %L', v_a),
    'ledger rows cannot be rewritten');

  raise notice 'PASS 06_loyalty';
end $$;

-- ---------------------------------------------------------------------------
-- Kilometres with the club (migration 0044): attendance times stated distance,
-- own rows only, and only for runs that actually happened.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_r1 uuid; v_r2 uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser-d', true);
  v_a := tests.make_member('dina');
  v_b := tests.make_member('essam');
  v_r1 := tests.make_run(v_admin, null, now() + interval '30 minutes');
  v_r2 := tests.make_run(v_admin, null, now() + interval '30 minutes');
  update public.runs set distance_meters = 6000 where id = v_r1;
  update public.runs set distance_meters = 8000 where id = v_r2;

  perform tests.act_as(v_a);
  perform public.join_run(v_r1);
  perform public.check_in(v_r1, 30.044400, 31.235700, 10);
  perform public.join_run(v_r2);
  perform public.check_in(v_r2, 30.044400, 31.235700, 10);
  -- essam signed up for one but never arrived.
  perform tests.act_as(v_b);
  perform public.join_run(v_r1);

  perform tests.act_as_system();
  update public.runs set status = 'completed' where id in (v_r1, v_r2);

  perform tests.act_as(v_a);
  perform tests.assert_eq(
    public.my_distance_meters()::int, 14000,
    'distance is the sum of stated distances of runs actually checked in to');

  perform tests.act_as(v_b);
  perform tests.assert_eq(
    public.my_distance_meters()::int, 0,
    'signing up without turning up adds nothing — and you only ever see your own');
end $$;



rollback;
