-- ============================================================================
-- 0043 · The run's end sweeps the live map
--
-- Recreates end_run() and scheduler_tick() from 0008 with one addition each:
-- when a run completes — by hand or by clock — every live position for it is
-- deleted, and each tick also purges positions gone quiet for two minutes
-- (ADR 0004 §2: rows die with the run, with the toggle, or with staleness).
--
-- Everything else in both functions is byte-for-byte the 0008 behaviour; the
-- absence-decay work from 0034 hangs off the runs status trigger and is
-- unaffected by re-creating these.
-- ============================================================================

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

  -- The run is over; nobody is "out on the course" any more. Leaving the dots
  -- up would show everyone's parked-car position indefinitely.
  perform app_private.clear_live_positions(p_run_id);

  -- Addressed to those who actually turned up, not those who merely signed up.
  perform app_private.enqueue_notification('run_ended', 'run_checked_in', p_run_id);
  perform app_private.audit('end_run', 'runs', p_run_id::text);
end;
$$;

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
  v_stale         integer := 0;
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
    perform app_private.clear_live_positions(v_run.id);
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

  -- 4. Live positions that have gone quiet. A dot two minutes silent is a
  --    phone in a pocket, not a runner at that spot.
  v_stale := public.purge_stale_live_positions();

  return jsonb_build_object(
    'runs_started',     v_started,
    'runs_ended',       v_ended,
    'events_fanned_out', v_fanned,
    'deliveries_queued', v_deliveries,
    'stale_positions_purged', v_stale
  );
end;
$$;

comment on function public.scheduler_tick is
  'Advances run statuses, fans out due notifications, and purges stale live positions. Idempotent; safe to retry and safe to run concurrently. Service role only.';
