-- ============================================================================
-- 0004 · Attendance, its event log, and check-in evidence
--
-- The corrections from the council concentrate here. See ADR 0001.
-- ============================================================================

create type public.attendance_state as enum (
  'waitlisted',
  'signed_up',
  'checked_in',
  'withdrawn'
);

create type public.attendance_event as enum (
  'signed_up',
  'waitlisted',
  'promoted',
  'checked_in',
  'check_in_removed',
  'withdrawn',
  'rejoined'
);

-- ---------------------------------------------------------------------------
-- Current state, one row per member per run.
-- ---------------------------------------------------------------------------
create table public.run_attendance (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.runs (id)     on delete cascade,
  -- Nullable so that erasing a member anonymises their attendance rather than
  -- deleting them, which would silently corrupt headcounts for past runs.
  -- See ADR 0002 §6.
  user_id        uuid references public.profiles (id) on delete set null,

  -- The waitlist FIFO key. Set on join, reset only on a genuine re-join out of
  -- the withdrawn state, and NEVER touched by promotion or check-in — enforced
  -- by trigger below, because getting this wrong reorders the queue silently.
  queued_at      timestamptz not null default clock_timestamp(),

  -- Non-null means the member holds a confirmed place.
  signed_up_at   timestamptz,
  -- Non-null means they were placed on the waitlist at some point. Kept after
  -- promotion as history; it is not the queue key.
  waitlisted_at  timestamptz,
  checked_in_at  timestamptz,
  withdrawn_at   timestamptz,

  check_in_method public.check_in_method,
  pace_group      text,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint one_row_per_member_per_run unique (run_id, user_id),

  -- A check-in always records how it happened, and never records how without
  -- having happened.
  constraint check_in_method_matches_check_in
    check ((checked_in_at is null) = (check_in_method is null)),

  -- A member is either confirmed or waitlisted, never neither while active.
  constraint active_row_has_a_place
    check (withdrawn_at is not null or signed_up_at is not null or waitlisted_at is not null)
);

comment on table public.run_attendance is
  'Current attendance state. History lives in run_attendance_events; location evidence lives in check_in_evidence.';
comment on column public.run_attendance.queued_at is
  'Waitlist FIFO key. Immutable except on re-join (enforced by trigger). Promotion must not touch it — see ADR 0001.';

create trigger run_attendance_touch_updated_at
  before update on public.run_attendance
  for each row execute function app_private.touch_updated_at();

create trigger run_attendance_freeze_queued_at
  before update on public.run_attendance
  for each row execute function app_private.freeze_queued_at();

-- Counting confirmed places for capacity. Partial so it stays small.
create index run_attendance_confirmed_idx
  on public.run_attendance (run_id)
  where signed_up_at is not null and withdrawn_at is null;

-- Picking the next person off the waitlist: ORDER BY queued_at LIMIT 1.
create index run_attendance_waitlist_idx
  on public.run_attendance (run_id, queued_at)
  where signed_up_at is null and withdrawn_at is null;

-- The "who is in" count on the run detail screen. This partial index is what
-- replaces the rejected GENERATED is_in column (ADR 0001).
create index run_attendance_checked_in_idx
  on public.run_attendance (run_id)
  where checked_in_at is not null and withdrawn_at is null;

-- "My runs" on the profile screen.
create index run_attendance_user_idx on public.run_attendance (user_id, run_id);

-- ---------------------------------------------------------------------------
-- The single definition of a member's attendance state.
--
-- IMMUTABLE and derived purely from its arguments, so it can be used in views,
-- policies and indexes without any chance of a second copy of these rules
-- drifting from this one (Principles §2).
-- ---------------------------------------------------------------------------
create or replace function public.attendance_state(
  signed_up_at  timestamptz,
  checked_in_at timestamptz,
  withdrawn_at  timestamptz
)
returns public.attendance_state
language sql
immutable
parallel safe
as $$
  select case
    when withdrawn_at  is not null then 'withdrawn'::public.attendance_state
    when checked_in_at is not null then 'checked_in'::public.attendance_state
    when signed_up_at  is not null then 'signed_up'::public.attendance_state
    else 'waitlisted'::public.attendance_state
  end;
$$;

-- ---------------------------------------------------------------------------
-- Public "in" status.
--
-- App Spec §4.1: publicly "in" once signed up AND checked in, OR checked in
-- without signing up. Both branches reduce to "checked in", so this is not
-- stored anywhere — it is derived here and nowhere else.
--
-- security_invoker = on: the view is subject to the caller's RLS on the
-- underlying table, so it cannot be used to read someone else's attendance.
-- ---------------------------------------------------------------------------
create view public.run_attendance_view
with (security_invoker = on) as
  select
    a.*,
    public.attendance_state(a.signed_up_at, a.checked_in_at, a.withdrawn_at) as state,
    (a.checked_in_at is not null and a.withdrawn_at is null)                 as is_in
  from public.run_attendance a;

comment on view public.run_attendance_view is
  'run_attendance plus derived state/is_in. Respects the caller''s RLS.';

-- ---------------------------------------------------------------------------
-- Aggregate counts, readable by any member.
--
-- Deliberately NOT security_invoker: members cannot read each other's
-- attendance rows, but everyone can see "312 people are already in"
-- (App Spec §2). Exposing only aggregates is what makes that safe — there is
-- no member directory to harvest, consistent with the anti-harassment intent
-- behind the QR-only friend system in §4.4.
-- ---------------------------------------------------------------------------
-- The `a.id is not null` guard on the waitlist filter is load-bearing: the LEFT
-- JOIN yields one all-NULL row for a run nobody has joined, and without the
-- guard that phantom row satisfies "signed_up_at IS NULL AND withdrawn_at IS
-- NULL" and every empty run reports a waitlist of one. The other two filters
-- are safe already because they test a column for NOT NULL.
create view public.run_attendance_counts as
  select
    r.id                                                                          as run_id,
    count(*) filter (where a.signed_up_at is not null and a.withdrawn_at is null)  as going_count,
    count(*) filter (where a.checked_in_at is not null and a.withdrawn_at is null) as checked_in_count,
    count(*) filter (where a.id is not null
                       and a.signed_up_at is null and a.withdrawn_at is null)     as waitlist_count
  from public.runs r
  left join public.run_attendance a on a.run_id = r.id
  group by r.id;

comment on view public.run_attendance_counts is
  'Aggregate headcounts per run. Intentionally bypasses row-level RLS to expose counts without exposing who.';

-- ---------------------------------------------------------------------------
-- Append-only history.
--
-- Holds no location data and no free text, so a member exercising erasure can
-- have user_id nulled rather than the row deleted — keeping past headcounts
-- correct. See ADR 0002 §6.
-- ---------------------------------------------------------------------------
create table public.run_attendance_events (
  id             bigint generated always as identity primary key,
  attendance_id  uuid not null references public.run_attendance (id) on delete cascade,
  run_id         uuid not null references public.runs (id)           on delete cascade,
  user_id        uuid references public.profiles (id)                on delete set null,
  event          public.attendance_event not null,
  -- Who caused it: the member themselves, or an admin acting on their behalf.
  actor_id       uuid references public.profiles (id)                on delete set null,
  occurred_at    timestamptz not null default now()
);

create index run_attendance_events_attendance_idx
  on public.run_attendance_events (attendance_id, occurred_at);
create index run_attendance_events_run_idx
  on public.run_attendance_events (run_id, occurred_at);

-- ---------------------------------------------------------------------------
-- Append-only, enforced rather than assumed — with one exception.
--
-- A strict "no UPDATE ever" trigger is wrong here, and subtly so: erasure works
-- by ON DELETE SET NULL on the user reference, which IS an update. A blanket
-- ban makes the history immutable and therefore un-erasable, putting the log
-- straight into conflict with GDPR Article 17.
--
-- So the rule is: the only permitted update is one that blanks a reference to a
-- person and changes nothing else. Anonymisation in, rewriting out.
--
-- DELETE is deliberately not blocked by trigger. It is already revoked from
-- clients (migration 0010), and a trigger here would additionally break the
-- legitimate cascade when a run is deleted outright.
-- ---------------------------------------------------------------------------
create or replace function app_private.allow_anonymisation_only()
returns trigger
language plpgsql
as $$
declare
  v_old   jsonb := to_jsonb(old);
  v_new   jsonb := to_jsonb(new);
  v_col   text;
  v_allowed text[] := tg_argv::text[];
begin
  for v_col in select jsonb_object_keys(v_old) loop
    if v_old -> v_col is distinct from v_new -> v_col then
      if not (v_col = any (v_allowed)) then
        raise exception '% is append-only: column % cannot be changed', tg_table_name, v_col
          using errcode = 'check_violation';
      end if;
      if v_new -> v_col <> 'null'::jsonb then
        raise exception '% is append-only: % may only be cleared, not reassigned',
          tg_table_name, v_col
          using errcode = 'check_violation';
      end if;
    end if;
  end loop;
  return new;
end;
$$;

create trigger run_attendance_events_append_only
  before update on public.run_attendance_events
  for each row execute function app_private.allow_anonymisation_only('user_id', 'actor_id');

-- ---------------------------------------------------------------------------
-- Check-in location evidence.
--
-- A 1:1 side table rather than columns on run_attendance, deliberately
-- (ADR 0002 §4): purging is a DELETE instead of a wide UPDATE, and the hot,
-- frequently-read attendance row carries no coordinates at all — so no policy
-- or Realtime payload can leak location by accident.
--
-- Everything here is deleted 30 days after the run. See migration 0010.
-- ---------------------------------------------------------------------------
create table public.check_in_evidence (
  attendance_id  uuid primary key references public.run_attendance (id) on delete cascade,
  run_id         uuid not null references public.runs (id)              on delete cascade,

  method         public.check_in_method not null,
  reported_lat   double precision,
  reported_lng   double precision,
  accuracy_m     double precision,
  -- Recomputed server-side from the reported position. The client's own
  -- distance claim is never stored or trusted.
  distance_m     double precision,
  -- The device's clock at capture, kept alongside the server's. A large skew is
  -- itself a signal, and it is what makes offline queue-and-sync reconcilable.
  client_ts      timestamptz,
  server_ts      timestamptz not null default now()
);

comment on table public.check_in_evidence is
  'Location claim supporting a check-in, retained 30 days for dispute adjudication then purged (ADR 0002 §5). Never exposed to members other than the subject.';

create index check_in_evidence_run_idx on public.check_in_evidence (run_id, server_ts);
