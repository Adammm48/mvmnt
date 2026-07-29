-- ============================================================================
-- Sign-up, capacity, waitlist and promotion.
--
-- Priority flow under Principles §11 — full rigour.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_run uuid;
  v_state public.attendance_state;
  v_queued_before timestamptz; v_queued_after timestamptz;
  v_next uuid; v_route_run uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');
  v_c := tests.make_member('cleo');

  -- ---------------------------------------------------------------------
  -- Profile is created automatically on sign-up.
  -- ---------------------------------------------------------------------
  perform tests.assert(
    exists (select 1 from public.profiles where id = v_a),
    'signing up creates a profile row');
  perform tests.assert_eq(
    (select display_name from public.profiles where id = v_a), 'ama',
    'display name comes from the identity provider metadata');

  -- ---------------------------------------------------------------------
  -- Unlimited capacity: everyone gets a place.
  -- ---------------------------------------------------------------------
  v_run := tests.make_run(v_admin, null);

  -- A run nobody has joined reports zeroes across the board. Worth asserting:
  -- the LEFT JOIN in run_attendance_counts yields an all-NULL row for an empty
  -- run, which silently counted as a waitlisted member until it was guarded.
  perform tests.assert_eq(
    (select going_count::int from public.run_attendance_counts where run_id = v_run), 0,
    'an empty run has nobody going');
  perform tests.assert_eq(
    (select waitlist_count::int from public.run_attendance_counts where run_id = v_run), 0,
    'an empty run has an empty waitlist, not a phantom member');
  perform tests.assert_eq(
    (select checked_in_count::int from public.run_attendance_counts where run_id = v_run), 0,
    'an empty run has nobody checked in');

  perform tests.act_as(v_a);
  v_state := public.join_run(v_run, 'easy');
  perform tests.assert_eq(v_state, 'signed_up'::public.attendance_state,
    'joining a run with no capacity limit confirms a place');

  -- Joining twice is a no-op, not an error or a duplicate row.
  v_state := public.join_run(v_run, 'easy');
  perform tests.assert_eq(v_state, 'signed_up'::public.attendance_state,
    'joining twice is idempotent');
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.run_attendance where run_id = v_run and user_id = v_a), 1,
    'joining twice does not create a second row');

  -- An unknown pace group is rejected rather than silently stored.
  perform tests.act_as(v_b);
  perform tests.assert_rejects(
    format('select public.join_run(%L, %L)', v_run, 'sprint'),
    'an unlisted pace group is rejected');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Capacity of 1: the second member is waitlisted.
  -- ---------------------------------------------------------------------
  v_run := tests.make_run(v_admin, 1);

  perform tests.act_as(v_a);
  perform tests.assert_eq(public.join_run(v_run), 'signed_up'::public.attendance_state,
    'first member takes the only place');

  perform tests.act_as(v_b);
  perform tests.assert_eq(public.join_run(v_run), 'waitlisted'::public.attendance_state,
    'second member is waitlisted when the run is full');

  perform tests.act_as(v_c);
  perform tests.assert_eq(public.join_run(v_run), 'waitlisted'::public.attendance_state,
    'third member is waitlisted too');

  perform tests.act_as_system();
  perform tests.assert_eq(
    (select going_count::int from public.run_attendance_counts where run_id = v_run), 1,
    'headcount counts confirmed places only');
  perform tests.assert_eq(
    (select waitlist_count::int from public.run_attendance_counts where run_id = v_run), 2,
    'waitlist count is exposed separately');

  -- ---------------------------------------------------------------------
  -- THE COUNCIL'S BUG: promotion must not touch queued_at.
  --
  -- If promotion overwrote the FIFO key the queue would silently reorder and
  -- nothing would error, so this is asserted directly.
  -- ---------------------------------------------------------------------
  select queued_at into v_queued_before
  from public.run_attendance where run_id = v_run and user_id = v_b;

  perform tests.act_as(v_a);
  perform public.withdraw_from_run(v_run);
  perform tests.act_as_system();

  select queued_at into v_queued_after
  from public.run_attendance where run_id = v_run and user_id = v_b;

  perform tests.assert_eq(v_queued_after, v_queued_before,
    'promotion leaves queued_at untouched');
  perform tests.assert(
    (select signed_up_at is not null from public.run_attendance
     where run_id = v_run and user_id = v_b),
    'withdrawing a confirmed place promotes the first person on the waitlist');
  perform tests.assert(
    (select signed_up_at is null from public.run_attendance
     where run_id = v_run and user_id = v_c),
    'only one person is promoted per freed place');

  -- FIFO, not arbitrary: ben queued before cleo, so ben was promoted.
  perform tests.assert(
    (select a.queued_at from public.run_attendance a where a.run_id = v_run and a.user_id = v_b)
    < (select a.queued_at from public.run_attendance a where a.run_id = v_run and a.user_id = v_c),
    'the promoted member is the one who queued first');

  -- The promotion notification was enqueued, addressed to the right member.
  perform tests.assert(
    exists (select 1 from public.notification_events
            where run_id = v_run and type = 'waitlist_promoted' and target_user_id = v_b),
    'promotion enqueues a waitlist_promoted notification for the promoted member');

  -- ---------------------------------------------------------------------
  -- Re-joining goes to the BACK of the queue.
  --
  -- Deliberate divergence from the council's "set queued_at once, never again":
  -- reclaiming an original position would let a member jump people who queued
  -- while they were withdrawn. See ADR 0001.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform public.join_run(v_run);   -- run is full again, so ama is waitlisted
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select public.attendance_state(signed_up_at, checked_in_at, withdrawn_at)
     from public.run_attendance where run_id = v_run and user_id = v_a),
    'waitlisted'::public.attendance_state,
    're-joining a full run puts the member on the waitlist');

  perform tests.assert(
    (select a.queued_at from public.run_attendance a where a.run_id = v_run and a.user_id = v_a)
    > (select a.queued_at from public.run_attendance a where a.run_id = v_run and a.user_id = v_c),
    're-joining takes a place at the back of the queue, behind those who waited');

  -- ---------------------------------------------------------------------
  -- queued_at is immutable for every other transition — enforced by trigger,
  -- not by remembering not to write it.
  -- ---------------------------------------------------------------------
  perform tests.assert_rejects(
    format('update public.run_attendance set queued_at = now() + interval ''1 day''
            where run_id = %L and user_id = %L', v_run, v_c),
    'queued_at cannot be updated outside a re-join');

  -- ---------------------------------------------------------------------
  -- Withdrawing from the waitlist promotes nobody.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_c);
  perform public.withdraw_from_run(v_run);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select going_count::int from public.run_attendance_counts where run_id = v_run), 1,
    'leaving the waitlist does not change the confirmed headcount');

  -- ---------------------------------------------------------------------
  -- Timing rules.
  -- ---------------------------------------------------------------------
  v_run := tests.make_run(v_admin, null, now() + interval '3 hours');
  perform tests.act_as(v_a);
  perform public.join_run(v_run);
  perform tests.act_as_system();

  update public.runs set starts_at = now() - interval '1 minute' where id = v_run;

  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.withdraw_from_run(%L)', v_run),
    'a member cannot withdraw after the run has started (App Spec 4.1)');
  perform tests.act_as_system();

  -- A draft run is not joinable.
  v_run := tests.make_run(v_admin, null, now() + interval '2 hours', false);
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.join_run(%L)', v_run),
    'a draft run cannot be joined');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Routes (App Spec §4.7).
  --
  -- Every coordinate is validated server-side because the console is not the
  -- only thing that could ever call this, and a transposed pair stored happily
  -- fails later on a member's phone rather than here.
  -- ---------------------------------------------------------------------
  -- Its own run: by this point in the suite the fixture above has been through
  -- cancellation and re-publication, and admin_publish_route refuses a draft.
  v_route_run := tests.make_run(v_admin, null, now() + interval '4 hours');
  perform tests.act_as(v_admin);

  perform tests.assert_rejects(
    format('select public.admin_set_route(%L, %L::jsonb)', v_route_run, '[[31.23, 30.04]]'),
    'a single point is not a route');

  perform tests.assert_rejects(
    format('select public.admin_set_route(%L, %L::jsonb)', v_route_run, '[[31.23, 30.04], [31.24]]'),
    'every point must be a pair');

  -- The classic mapping bug: latitude and longitude the wrong way round. It
  -- renders as a route in the Indian Ocean, and the only place to catch it is
  -- the range check.
  perform tests.assert_rejects(
    format('select public.admin_set_route(%L, %L::jsonb)', v_route_run, '[[30.04, 131.23], [30.05, 131.24]]'),
    'a latitude beyond 90 is refused — that is a transposed pair, not a route');

  perform public.admin_set_route(v_route_run, '[[31.235, 30.044], [31.240, 30.048], [31.245, 30.044]]'::jsonb);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select jsonb_array_length(route) from public.runs where id = v_route_run), 3,
    'a valid route is stored');
  perform tests.assert(
    (select route_published_at is null from public.runs where id = v_route_run),
    'and drawing it does not publish it — drafting is not announcing');

  -- Members only see a published route.
  perform tests.act_as(v_admin);
  perform public.admin_publish_route(v_route_run);
  perform tests.act_as_system();
  perform tests.assert(
    (select route_published_at is not null from public.runs where id = v_route_run),
    'publishing marks it live');
  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
      where type = 'route_published' and run_id = v_route_run), 1,
    'and tells the people who signed up');

  -- Re-publishing a corrected route must not notify twice.
  perform tests.act_as(v_admin);
  perform public.admin_publish_route(v_route_run);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
      where type = 'route_published' and run_id = v_route_run), 1,
    'and fixing a corner does not ping the club again');

  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.admin_set_route(%L, %L::jsonb)', v_route_run, '[[31.23, 30.04], [31.24, 30.05]]'),
    'a member cannot draw a route');
  perform tests.act_as_system();

  raise notice 'PASS 01_attendance';
end $$;

rollback;
