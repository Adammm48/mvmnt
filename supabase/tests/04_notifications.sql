-- ============================================================================
-- Notification pipeline: idempotency, fan-out, and the token reassignment rule.
--
-- The idempotency assertions are the important ones. At the 2,500-person event,
-- a missing dedupe key turns one scheduler retry into 2,500 duplicate pushes.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_run uuid;
  v_event uuid; v_again uuid;
  v_n integer; v_before integer;
  v_result jsonb;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');
  v_c := tests.make_member('cleo');   -- deliberately never registers a device

  perform tests.act_as(v_a);
  perform public.register_push_token('ExponentPushToken[aaa]', 'ios');
  perform tests.act_as(v_b);
  perform public.register_push_token('ExponentPushToken[bbb]', 'android');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Publishing schedules the whole timeline in one go.
  -- ---------------------------------------------------------------------
  v_run := tests.make_run(v_admin, null, now() + interval '3 days');

  perform tests.assert(
    exists (select 1 from public.notification_events
            where run_id = v_run and type = 'run_published' and audience = 'all_members'),
    'publishing announces the run to all members');
  perform tests.assert(
    exists (select 1 from public.notification_events
            where run_id = v_run and type = 'reminder_evening_before'),
    'publishing schedules the evening-before reminder');
  perform tests.assert(
    exists (select 1 from public.notification_events
            where run_id = v_run and type = 'reminder_morning_of'),
    'publishing schedules the morning-of reminder');

  perform tests.assert(
    (select scheduled_for from public.notification_events
     where run_id = v_run and type = 'reminder_morning_of') > now(),
    'reminders are scheduled for the future, not sent immediately');

  -- Copy is rendered at enqueue time and stored, so the delivery worker does
  -- no formatting and the wording exists in exactly one place.
  perform tests.assert(
    (select title from public.notification_events
     where run_id = v_run and type = 'run_published') like '%Saturday 6K%',
    'notification copy is rendered and stored on the event');

  -- ---------------------------------------------------------------------
  -- Idempotency: enqueueing the same real-world event twice inserts once.
  -- ---------------------------------------------------------------------
  select count(*)::int into v_before from public.notification_events where run_id = v_run;

  v_event := app_private.enqueue_notification('run_started', 'run_signed_up', v_run);
  v_again := app_private.enqueue_notification('run_started', 'run_signed_up', v_run);

  perform tests.assert(v_event is not null, 'the first enqueue creates an event');
  perform tests.assert(v_again is null,
    'the second enqueue is a no-op and says so by returning null');
  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
     where run_id = v_run and type = 'run_started'), 1,
    'a duplicate enqueue does not create a second event');

  -- ---------------------------------------------------------------------
  -- Fan-out: one delivery per device, and a row even for members with none.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform public.join_run(v_run);
  perform tests.act_as(v_b);
  perform public.join_run(v_run);
  perform tests.act_as(v_c);
  perform public.join_run(v_run);
  perform tests.act_as_system();

  v_n := app_private.fan_out_notification(v_event);
  perform tests.assert_eq(v_n, 3, 'fan-out reaches all three signed-up members');

  perform tests.assert_eq(
    (select count(*)::int from public.notification_deliveries
     where event_id = v_event and status = 'pending'), 2,
    'members with a registered device get a pending delivery');
  perform tests.assert_eq(
    (select count(*)::int from public.notification_deliveries
     where event_id = v_event and status = 'skipped'), 1,
    'a member with no device gets a skipped row, so "why did I not get that?" is answerable');

  perform tests.assert(
    (select processed_at is not null from public.notification_events where id = v_event),
    'the event is marked processed');

  -- Re-running fan-out must not duplicate. This is the second half of the
  -- idempotency story — the UNIQUE (event_id, push_token) constraint.
  perform tests.assert_eq(app_private.fan_out_notification(v_event), 0,
    're-running fan-out creates no further deliveries');
  perform tests.assert_eq(
    (select count(*)::int from public.notification_deliveries where event_id = v_event), 3,
    'the delivery count is unchanged after a repeated fan-out');

  -- Audience is resolved at send time, not enqueue time: someone who signs up
  -- after publication still receives the reminder.
  perform tests.assert(
    exists (select 1 from public.notification_deliveries
            where event_id = v_event and user_id = v_c),
    'members who joined after the event was enqueued are still included');

  -- ---------------------------------------------------------------------
  -- Token reassignment: a handed-down phone must not keep receiving the
  -- previous owner's notifications. That is a data disclosure, not a bug.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform public.register_push_token('ExponentPushToken[aaa]', 'ios');  -- ama's old device
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select user_id from public.push_tokens where expo_push_token = 'ExponentPushToken[aaa]'),
    v_b,
    'registering an existing token moves it to the new owner');
  perform tests.assert_eq(
    (select count(*)::int from public.push_tokens where expo_push_token = 'ExponentPushToken[aaa]'), 1,
    'and does not leave a duplicate row behind');

  -- ---------------------------------------------------------------------
  -- The scheduler.
  -- ---------------------------------------------------------------------
  update public.runs set starts_at = now() - interval '2 hours',
                         ends_at   = now() + interval '1 hour'
   where id = v_run;

  v_result := public.scheduler_tick();
  perform tests.assert_eq(
    (select status from public.runs where id = v_run), 'in_progress'::public.run_status,
    'the scheduler starts a run whose time has come');

  -- Idempotent: a second tick in the same state changes nothing. This is what
  -- makes the scheduled Edge Function safe to retry.
  v_result := public.scheduler_tick();
  perform tests.assert_eq((v_result ->> 'runs_started')::int, 0,
    'a second tick starts no runs');
  perform tests.assert_eq((v_result ->> 'events_fanned_out')::int, 0,
    'a second tick fans out nothing further');

  update public.runs set ends_at = now() - interval '1 minute' where id = v_run;  -- still after starts_at
  v_result := public.scheduler_tick();
  perform tests.assert_eq(
    (select status from public.runs where id = v_run), 'completed'::public.run_status,
    'the scheduler ends a run past its stated end time');

  -- ---------------------------------------------------------------------
  -- Cancelling a run drops its pending notifications: nobody should be
  -- reminded about a run that is not happening.
  -- ---------------------------------------------------------------------
  v_run := tests.make_run(v_admin, null, now() + interval '2 days');
  perform tests.assert(
    (select count(*)::int from public.notification_events
     where run_id = v_run and processed_at is null) > 0,
    'a freshly published run has pending notifications');

  perform tests.act_as(v_admin);
  perform public.cancel_run(v_run, 'storm');
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
     where run_id = v_run and processed_at is null), 0,
    'cancelling a run removes its pending notifications');
  perform tests.assert_eq(
    (select status from public.runs where id = v_run), 'cancelled'::public.run_status,
    'the run stays visible as cancelled rather than disappearing');

  raise notice 'PASS 04_notifications';
end $$;

rollback;
