-- ============================================================================
-- 0009 · Run lifecycle and the scheduler
--
-- Publishing, cancelling, and the tick that moves runs through their statuses
-- and fans out due notifications.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Publish a run.
--
-- Publishing is what makes a run visible AND what schedules its whole
-- notification timeline. Both reminders are enqueued now with a future
-- scheduled_for; the audience is resolved at send time, so members who sign up
-- tomorrow still receive a reminder enqueued today.
-- ---------------------------------------------------------------------------
create or replace function public.publish_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run           public.runs;
  v_evening_before timestamptz;
  v_morning_of     timestamptz;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select * into v_run from public.runs where id = p_run_id for update;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;
  if v_run.status <> 'draft' then
    raise exception 'only a draft run can be published (this one is %)', v_run.status
      using errcode = 'check_violation';
  end if;
  if v_run.starts_at <= now() then
    raise exception 'cannot publish a run that starts in the past'
      using errcode = 'check_violation';
  end if;

  update public.runs
     set status = 'published', published_at = now()
   where id = p_run_id;

  -- 19:00 local time the evening before, and two hours before the start.
  -- Computed in Europe/London so a 07:00 Saturday run reminds at 19:00 Friday
  -- regardless of where the server or the member's phone is.
  v_evening_before := ((v_run.starts_at at time zone 'Europe/London')::date
                       - interval '1 day' + interval '19 hours')
                      at time zone 'Europe/London';
  v_morning_of     := v_run.starts_at - interval '2 hours';

  perform app_private.enqueue_notification(
    'run_published', 'all_members', p_run_id, null, now()
  );

  -- Skip a reminder whose moment has already passed — publishing a run the
  -- night before should not fire an "evening before" reminder immediately.
  if v_evening_before > now() then
    perform app_private.enqueue_notification(
      'reminder_evening_before', 'run_signed_up', p_run_id, null, v_evening_before
    );
  end if;
  if v_morning_of > now() then
    perform app_private.enqueue_notification(
      'reminder_morning_of', 'run_signed_up', p_run_id, null, v_morning_of
    );
  end if;

  perform app_private.audit('publish_run', 'runs', p_run_id::text,
                            jsonb_build_object('starts_at', v_run.starts_at));
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancel a run.
--
-- The run stays visible so members find out why rather than watching it vanish.
-- Pending notifications for it are dropped — nobody should get a reminder for a
-- cancelled run.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_run(
  p_run_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.runs
     set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason
   where id = p_run_id and status in ('draft', 'published', 'in_progress');

  if not found then
    raise exception 'run not found, or already finished' using errcode = 'no_data_found';
  end if;

  delete from public.notification_events
   where run_id = p_run_id and processed_at is null;

  perform app_private.audit('cancel_run', 'runs', p_run_id::text,
                            jsonb_build_object('reason', p_reason));
end;
$$;

-- ---------------------------------------------------------------------------
-- Manual start / end.
--
-- App Spec leaves it open whether these fire on a schedule or by hand. Both:
-- the scheduler handles the normal case, and these let an organiser who is
-- standing at the meeting point correct a late start from their phone.
-- ---------------------------------------------------------------------------
create or replace function public.start_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.runs set status = 'in_progress'
   where id = p_run_id and status = 'published';
  if not found then
    raise exception 'run is not in a state that can be started' using errcode = 'check_violation';
  end if;

  perform app_private.enqueue_notification('run_started', 'run_signed_up', p_run_id);
  perform app_private.audit('start_run', 'runs', p_run_id::text);
end;
$$;

create or replace function public.end_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.runs set status = 'completed'
   where id = p_run_id and status in ('published', 'in_progress');
  if not found then
    raise exception 'run is not in a state that can be ended' using errcode = 'check_violation';
  end if;

  -- Addressed to those who actually turned up, not those who merely signed up.
  perform app_private.enqueue_notification('run_ended', 'run_checked_in', p_run_id);
  perform app_private.audit('end_run', 'runs', p_run_id::text);
end;
$$;

-- ---------------------------------------------------------------------------
-- The scheduler tick.
--
-- Called by a scheduled Edge Function (and by hand in local development, which
-- is how the whole notification timeline is testable without waiting for real
-- clock time to pass).
--
-- Idempotent throughout: status transitions are guarded by their WHERE clauses,
-- and enqueueing is protected by dedupe_key. Running this twice in the same
-- second changes nothing — which is the property that makes retrying it safe.
-- ---------------------------------------------------------------------------
create or replace function public.scheduler_tick()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run           record;
  v_event         record;
  v_started       integer := 0;
  v_ended         integer := 0;
  v_fanned        integer := 0;
  v_deliveries    integer := 0;
begin
  -- 1. Runs whose start time has arrived.
  for v_run in
    select id from public.runs
    where status = 'published' and starts_at <= now()
    for update skip locked
  loop
    update public.runs set status = 'in_progress' where id = v_run.id;
    perform app_private.enqueue_notification('run_started', 'run_signed_up', v_run.id);
    v_started := v_started + 1;
  end loop;

  -- 2. Runs past their stated end time. Runs with no ends_at are left alone —
  --    an organiser ends those by hand (see ADR 0001).
  for v_run in
    select id from public.runs
    where status = 'in_progress' and ends_at is not null and ends_at <= now()
    for update skip locked
  loop
    update public.runs set status = 'completed' where id = v_run.id;
    perform app_private.enqueue_notification('run_ended', 'run_checked_in', v_run.id);
    v_ended := v_ended + 1;
  end loop;

  -- 3. Fan out everything due.
  --    SKIP LOCKED so two overlapping ticks divide the work rather than
  --    blocking on each other or double-sending.
  for v_event in
    select id from public.notification_events
    where processed_at is null and scheduled_for <= now()
    order by scheduled_for
    for update skip locked
  loop
    v_deliveries := v_deliveries + app_private.fan_out_notification(v_event.id);
    v_fanned := v_fanned + 1;
  end loop;

  return jsonb_build_object(
    'runs_started',     v_started,
    'runs_ended',       v_ended,
    'events_fanned_out', v_fanned,
    'deliveries_queued', v_deliveries
  );
end;
$$;

comment on function public.scheduler_tick is
  'Advances run statuses and fans out due notifications. Idempotent; safe to retry and safe to run concurrently. Service role only.';
