-- ============================================================================
-- 0008 · Attendance RPCs
--
-- Every attendance rule lives in this file and nowhere else. The mobile app and
-- admin console call these functions; neither decides for itself whether a run
-- is full, whether a member is in range, or who gets promoted (Principles §2).
--
-- All are SECURITY DEFINER with a pinned search_path, and all re-derive the
-- caller from auth.uid() rather than accepting a user id from the client.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Join a run.
--
-- Returns the resulting state: 'signed_up' if a place was held, 'waitlisted' if
-- the run was full.
--
-- LOCKING: takes a row lock on the run before counting confirmed places.
-- Count-then-insert is unsafe under READ COMMITTED without it — two concurrent
-- joins for the last place both count capacity-1 and both insert. The withdraw
-- path takes the same lock in the same order.
-- ---------------------------------------------------------------------------
create or replace function public.join_run(
  p_run_id     uuid,
  p_pace_group text default null
)
returns public.attendance_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user      uuid := auth.uid();
  v_run       public.runs;
  v_confirmed integer;
  v_existing  public.run_attendance;
  -- Captured immediately after the lookup below. FOUND cannot be used for this:
  -- the capacity COUNT further down resets it to true, which would send every
  -- brand-new member down the re-join branch.
  v_has_row   boolean;
  v_state     public.attendance_state;
  v_id        uuid;
  v_event     public.attendance_event;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  -- The lock. Everything below reads a consistent view of this run's places.
  select * into v_run from public.runs where id = p_run_id for update;

  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;
  if v_run.status <> 'published' then
    raise exception 'this run is not open for sign-up' using errcode = 'check_violation';
  end if;
  if v_run.starts_at <= now() then
    raise exception 'this run has already started' using errcode = 'check_violation';
  end if;
  if p_pace_group is not null
     and array_length(v_run.pace_groups, 1) is not null
     and not (p_pace_group = any (v_run.pace_groups)) then
    raise exception 'unknown pace group: %', p_pace_group using errcode = 'check_violation';
  end if;

  select * into v_existing
  from public.run_attendance
  where run_id = p_run_id and user_id = v_user;
  v_has_row := found;

  -- Already holding a place or a waitlist position: idempotent no-op, so a
  -- double-tap on a slow connection cannot produce a surprising result.
  if v_has_row and v_existing.withdrawn_at is null then
    return public.attendance_state(
      v_existing.signed_up_at, v_existing.checked_in_at, v_existing.withdrawn_at
    );
  end if;

  select count(*) into v_confirmed
  from public.run_attendance
  where run_id = p_run_id and signed_up_at is not null and withdrawn_at is null;

  if v_run.capacity is null or v_confirmed < v_run.capacity then
    v_state := 'signed_up';
  else
    v_state := 'waitlisted';
  end if;

  if v_has_row then
    -- Re-joining after withdrawing. queued_at is reset so they take a fresh
    -- place at the BACK of the queue — reclaiming the original position would
    -- let a member jump ahead of people who joined while they were out. This is
    -- the one transition the freeze_queued_at trigger permits.
    update public.run_attendance
       set queued_at     = clock_timestamp(),
           withdrawn_at  = null,
           signed_up_at  = case when v_state = 'signed_up'  then now() else null end,
           waitlisted_at = case when v_state = 'waitlisted' then now() else waitlisted_at end,
           pace_group    = coalesce(p_pace_group, pace_group)
     where id = v_existing.id
     returning id into v_id;
    v_event := 'rejoined';
  else
    insert into public.run_attendance (
      run_id, user_id, queued_at, signed_up_at, waitlisted_at, pace_group
    )
    values (
      p_run_id, v_user, clock_timestamp(),
      case when v_state = 'signed_up'  then now() end,
      case when v_state = 'waitlisted' then now() end,
      p_pace_group
    )
    returning id into v_id;
    v_event := case when v_state = 'signed_up' then 'signed_up' else 'waitlisted' end;
  end if;

  insert into public.run_attendance_events (attendance_id, run_id, user_id, event, actor_id)
  values (v_id, p_run_id, v_user, v_event, v_user);

  return v_state;
end;
$$;

-- ---------------------------------------------------------------------------
-- Withdraw from a run, promoting the next person off the waitlist.
--
-- App Spec §4.1: a member may remove their own status any time before the run
-- starts. After it starts, only an admin can (see admin_remove_check_in).
-- ---------------------------------------------------------------------------
create or replace function public.withdraw_from_run(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user     uuid := auth.uid();
  v_run      public.runs;
  v_row      public.run_attendance;
  v_held     boolean;
  v_confirmed integer;
  v_next     public.run_attendance;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  -- Same lock, same order as join_run. Taking them in a consistent order is
  -- what keeps the two paths from deadlocking against each other.
  select * into v_run from public.runs where id = p_run_id for update;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;
  if v_run.starts_at <= now() then
    raise exception 'this run has already started; ask an organiser to remove you'
      using errcode = 'check_violation';
  end if;

  select * into v_row
  from public.run_attendance
  where run_id = p_run_id and user_id = v_user;

  if not found or v_row.withdrawn_at is not null then
    return;  -- Idempotent: withdrawing twice is not an error.
  end if;

  v_held := v_row.signed_up_at is not null;

  update public.run_attendance
     set withdrawn_at = now()
   where id = v_row.id;

  insert into public.run_attendance_events (attendance_id, run_id, user_id, event, actor_id)
  values (v_row.id, p_run_id, v_user, 'withdrawn', v_user);

  -- Only a confirmed place frees a spot. Someone leaving the waitlist promotes
  -- nobody.
  if not v_held or v_run.capacity is null then
    return;
  end if;

  select count(*) into v_confirmed
  from public.run_attendance
  where run_id = p_run_id and signed_up_at is not null and withdrawn_at is null;

  if v_confirmed >= v_run.capacity then
    return;
  end if;

  -- FIFO by queued_at — never by signed_up_at, which promotion is about to set.
  select * into v_next
  from public.run_attendance
  where run_id = p_run_id and signed_up_at is null and withdrawn_at is null
  order by queued_at
  limit 1;

  if not found then
    return;
  end if;

  update public.run_attendance
     set signed_up_at = now()   -- queued_at deliberately untouched
   where id = v_next.id;

  insert into public.run_attendance_events (attendance_id, run_id, user_id, event, actor_id)
  values (v_next.id, p_run_id, v_next.user_id, 'promoted', v_user);

  perform app_private.enqueue_notification(
    'waitlist_promoted', 'single_user', p_run_id, v_next.user_id
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Check in.
--
-- The client sends its position; this function recomputes the distance and
-- decides. A client asserting "I am in range" is ignored (Principles §3).
--
-- NO run-row lock here, deliberately. Check-in does not consume a capacity
-- place — someone standing at the meeting point is there whether or not the run
-- is nominally full, and refusing them would be absurd. Skipping the lock also
-- keeps the burst path fast: a mass start means hundreds of simultaneous
-- check-ins, and serialising them all on one run row is exactly the contention
-- to avoid. Correctness comes from the unique constraint instead.
--
-- p_client_ts lets an offline check-in be queued on the device and synced later
-- with its original timestamp — see App Spec §2 (check-in must work low-signal).
-- ---------------------------------------------------------------------------
create or replace function public.check_in(
  p_run_id     uuid,
  p_lat        double precision,
  p_lng        double precision,
  p_accuracy_m double precision default null,
  p_client_ts  timestamptz default null
)
returns public.attendance_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user       uuid := auth.uid();
  v_run        public.runs;
  v_distance   double precision;
  v_at         timestamptz;
  v_id         uuid;
  v_row        public.run_attendance;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.feature_flags
                 where key = 'geofence_check_in' and enabled) then
    raise exception 'check-in is currently handled by organisers'
      using errcode = 'check_violation';
  end if;

  select * into v_run from public.runs where id = p_run_id;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;
  if v_run.status not in ('published', 'in_progress') then
    raise exception 'this run is not open for check-in' using errcode = 'check_violation';
  end if;

  -- Trust the device's timestamp only when it is plausible; otherwise treat the
  -- check-in as happening now. A device clock is client input like any other.
  v_at := coalesce(p_client_ts, now());
  if v_at > now() + interval '5 minutes' or v_at < now() - interval '24 hours' then
    v_at := now();
  end if;

  if v_at < v_run.starts_at - interval '1 hour' then
    raise exception 'check-in is not open yet' using errcode = 'check_violation';
  end if;
  if v_at > coalesce(v_run.ends_at, v_run.starts_at + interval '4 hours') then
    raise exception 'check-in has closed for this run' using errcode = 'check_violation';
  end if;

  v_distance := app_private.distance_meters(
    p_lat, p_lng, v_run.meeting_point_lat, v_run.meeting_point_lng
  );

  -- Accept when the member could plausibly be inside the radius given their
  -- own reported GPS accuracy. Comparing raw distance against the radius would
  -- reject people who really are present but have a poor fix — and false
  -- negatives, not spoofers, are the failure mode that actually happens
  -- (ADR 0002). A generous accuracy allowance is a spoofing risk we accept and
  -- record rather than one we try to detect.
  if v_distance - coalesce(p_accuracy_m, 0) > v_run.check_in_radius_m then
    raise exception 'you look too far from % to check in (about %m away)',
      v_run.meeting_point_name, round(v_distance)
      using errcode = 'check_violation';
  end if;

  -- Checking in without a prior sign-up is explicitly supported (App Spec §4.1)
  -- and confers a place, so signed_up_at is set either way.
  insert into public.run_attendance (
    run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method
  )
  values (p_run_id, v_user, clock_timestamp(), v_at, v_at, 'geofence')
  on conflict (run_id, user_id) do update
    set checked_in_at   = coalesce(public.run_attendance.checked_in_at, v_at),
        check_in_method = coalesce(public.run_attendance.check_in_method, 'geofence'),
        signed_up_at    = coalesce(public.run_attendance.signed_up_at, v_at),
        withdrawn_at    = null
  returning id into v_id;

  insert into public.check_in_evidence (
    attendance_id, run_id, method, reported_lat, reported_lng,
    accuracy_m, distance_m, client_ts
  )
  values (
    v_id, p_run_id, 'geofence', p_lat, p_lng, p_accuracy_m, v_distance, p_client_ts
  )
  on conflict (attendance_id) do nothing;

  insert into public.run_attendance_events (attendance_id, run_id, user_id, event, actor_id)
  values (v_id, p_run_id, v_user, 'checked_in', v_user);

  select * into v_row from public.run_attendance where id = v_id;
  return public.attendance_state(v_row.signed_up_at, v_row.checked_in_at, v_row.withdrawn_at);
end;
$$;

-- ---------------------------------------------------------------------------
-- Organiser check-in.
--
-- The most important mitigation in the whole check-in design (ADR 0002 §3):
-- it fixes every false negative — denied permission, dead battery, phone in a
-- locker, GPS drift — and it is the practical anti-cheat, since an organiser
-- who can see the crowd is a better judge than any client-side signal.
-- ---------------------------------------------------------------------------
create or replace function public.admin_check_in(
  p_run_id  uuid,
  p_user_id uuid
)
returns public.attendance_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id  uuid;
  v_row public.run_attendance;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  insert into public.run_attendance (
    run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method
  )
  values (p_run_id, p_user_id, clock_timestamp(), now(), now(), 'admin')
  on conflict (run_id, user_id) do update
    set checked_in_at   = coalesce(public.run_attendance.checked_in_at, now()),
        check_in_method = coalesce(public.run_attendance.check_in_method, 'admin'),
        signed_up_at    = coalesce(public.run_attendance.signed_up_at, now()),
        withdrawn_at    = null
  returning id into v_id;

  insert into public.check_in_evidence (attendance_id, run_id, method)
  values (v_id, p_run_id, 'admin')
  on conflict (attendance_id) do nothing;

  insert into public.run_attendance_events (attendance_id, run_id, user_id, event, actor_id)
  values (v_id, p_run_id, p_user_id, 'checked_in', auth.uid());

  perform app_private.audit('admin_check_in', 'run_attendance', v_id::text,
                            jsonb_build_object('run_id', p_run_id, 'user_id', p_user_id));

  select * into v_row from public.run_attendance where id = v_id;
  return public.attendance_state(v_row.signed_up_at, v_row.checked_in_at, v_row.withdrawn_at);
end;
$$;

create or replace function public.admin_remove_check_in(
  p_run_id  uuid,
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.run_attendance
     set checked_in_at = null, check_in_method = null
   where run_id = p_run_id and user_id = p_user_id
   returning id into v_id;

  if v_id is null then
    return;
  end if;

  -- The evidence goes with the check-in it supported: keeping a location claim
  -- for a check-in an organiser has just declared invalid serves no purpose and
  -- fails data minimisation (Principles §4).
  delete from public.check_in_evidence where attendance_id = v_id;

  insert into public.run_attendance_events (attendance_id, run_id, user_id, event, actor_id)
  values (v_id, p_run_id, p_user_id, 'check_in_removed', auth.uid());

  perform app_private.audit('admin_remove_check_in', 'run_attendance', v_id::text,
                            jsonb_build_object('run_id', p_run_id, 'user_id', p_user_id));
end;
$$;
