-- ============================================================================
-- 0042 · Live positions
--
-- ADR 0004, in full. The one-sentence version: a member who opts in gets
-- exactly one row holding their latest position, visible to their friends and
-- to organisers, and the row cannot outlive the run, the sharing, or two
-- minutes of silence.
--
-- THE TABLE IS THE PRIVACY ARGUMENT
--
-- (run_id, user_id) is the PRIMARY KEY. That single line is why this feature
-- does not build a movement history: there is nowhere for a second position
-- to go except over the first. The privacy policy's "we do not build a
-- history of your movements" is enforced by the schema, not by a purge job
-- somebody has to keep working. (The purge here deletes *current* points that
-- went stale — a different job from deleting a trail, which cannot exist.)
-- ============================================================================

create table public.live_positions (
  run_id     uuid not null references public.runs (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  updated_at timestamptz not null default now(),

  -- One row per member per run. The upsert target, and the no-history rule.
  primary key (run_id, user_id)
);

comment on table public.live_positions is
  'One CURRENT position per sharing member per run — never a trail (ADR 0004). Written only through share_live_position(); rows die with the run, with stop_sharing_live_position(), or after 2 minutes of silence via the scheduler.';

create index live_positions_staleness on public.live_positions (updated_at);

-- ---------------------------------------------------------------------------
-- Writing: an RPC rather than direct upsert, because the write rule is a
-- state machine ("checked in, run in progress"), and those live in RPCs
-- everywhere else in this schema.
-- ---------------------------------------------------------------------------
create or replace function public.share_live_position(
  p_run_id uuid,
  p_lat    double precision,
  p_lng    double precision
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_status public.run_status;
begin
  select status into v_status from public.runs where id = p_run_id;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'live location only works while the run is on'
      using errcode = 'check_violation';
  end if;

  -- Being there is the precondition for saying where you are. This is also
  -- what stops a member broadcasting a position for a run across town.
  if not exists (
    select 1 from public.run_attendance
    where run_id = p_run_id and user_id = auth.uid()
      and checked_in_at is not null and withdrawn_at is null
  ) then
    raise exception 'check in first — sharing is for people on the run'
      using errcode = 'check_violation';
  end if;

  if p_lat is null or p_lng is null
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'that is not a position' using errcode = 'check_violation';
  end if;

  insert into public.live_positions (run_id, user_id, lat, lng, updated_at)
  values (p_run_id, auth.uid(), p_lat, p_lng, now())
  on conflict (run_id, user_id)
  do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();

  -- Deliberately NOT audited: this fires every ~10 seconds per sharer, and an
  -- audit log of positions would be the movement history the table exists to
  -- prevent. The opt-in/opt-out moments are the meaningful events, and
  -- stop_sharing is visible as the row vanishing.
end;
$$;

create or replace function public.stop_sharing_live_position(p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Unconditional and unfailable: whatever state the run is in, "stop showing
  -- people where I am" must always work.
  delete from public.live_positions
  where run_id = p_run_id and user_id = auth.uid();
end;
$$;

grant execute on function public.share_live_position(uuid, double precision, double precision) to authenticated;
grant execute on function public.stop_sharing_live_position(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Reading: friends of the sharer, the sharer themself, and organisers
-- (ADR 0004 §7 — the opt-in is the boundary; the role widens who sees a
-- shared position, never whether one exists).
-- ---------------------------------------------------------------------------
alter table public.live_positions enable row level security;

-- friendships itself carries no member grant — every friend query goes through
-- a definer function — so the policy needs one too, in the is_admin() mould.
create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.friendships f
    where f.user_low = least(a, b) and f.user_high = greatest(a, b)
  );
$$;

grant execute on function public.are_friends(uuid, uuid) to authenticated;

create policy live_positions_select_friends on public.live_positions
  for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_admin()
    or public.are_friends(auth.uid(), user_id)
  );

-- No insert/update/delete policies for authenticated: writes go through the
-- RPCs above. Two-gate model — the grant below only opens SELECT.
grant select on public.live_positions to authenticated;
grant select, insert, update, delete on public.live_positions to service_role;

-- ---------------------------------------------------------------------------
-- Death of a row, ways two and three (way one is stop_sharing above).
-- ---------------------------------------------------------------------------

-- The run ending sweeps the map clean, whether it ended by hand or by clock.
create or replace function app_private.clear_live_positions(p_run_id uuid)
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with gone as (
    delete from public.live_positions where run_id = p_run_id returning 1
  )
  select count(*)::integer from gone;
$$;

-- Staleness: a phone that has gone quiet for two minutes is a phone in a
-- pocket, a dead battery, or a crashed app. Its dot must not sit on friends'
-- screens claiming currency it does not have.
create or replace function public.purge_stale_live_positions()
returns integer
language sql
security definer
set search_path = public, pg_temp
as $$
  with gone as (
    delete from public.live_positions
    where updated_at < now() - interval '2 minutes'
    returning 1
  )
  select count(*)::integer from gone;
$$;

revoke execute on function public.purge_stale_live_positions() from public, anon, authenticated;
grant  execute on function public.purge_stale_live_positions() to service_role;

comment on function public.purge_stale_live_positions is
  'Deletes live positions not refreshed for 2 minutes (ADR 0004). Called from scheduler_tick; this is staleness hygiene on current points, not trail deletion — a trail cannot exist.';
