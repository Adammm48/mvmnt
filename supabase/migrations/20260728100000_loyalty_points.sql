-- ============================================================================
-- 0015 · Loyalty: the points ledger
--
-- Append-only, idempotent, replayable. See ADR 0003.
--
-- The whole design rests on UNIQUE (user_id, run_id, kind): awarding the same
-- thing twice is impossible, so every award path can be retried freely and the
-- entire history can be recomputed from check-ins if the rules change. A
-- mutable `points` integer on the profile would make the rules unfalsifiable —
-- you could never prove a member's total was right, only assert it.
-- ============================================================================

create type public.point_kind as enum (
  'check_in',       -- attended a run
  'streak_bonus',   -- consecutive weeks attended
  'adjustment'      -- an organiser correcting something by hand
);

create table public.point_events (
  id          bigint generated always as identity primary key,
  -- Nullable so erasing a member anonymises their history rather than deleting
  -- it, exactly as run_attendance does (ADR 0002 §6). An anonymous row still
  -- balances the club's totals; it just names nobody.
  user_id     uuid references public.profiles (id) on delete set null,
  run_id      uuid references public.runs (id)     on delete cascade,
  kind        public.point_kind not null,
  points      integer not null,
  -- When the points were EARNED, not when the row was written. Backfill sets
  -- this to the original checked_in_at so history and leaderboard windows stay
  -- truthful.
  awarded_at  timestamptz not null default now(),
  -- 'live' | 'backfill' | 'admin' — how the row came to exist, so a
  -- recomputation can be told apart from an organiser's manual correction.
  source      text not null default 'live',
  note        text,
  created_at  timestamptz not null default now()
);

-- THE constraint. Makes every award idempotent, so award paths can be retried
-- freely and the whole history replayed.
--
-- Partial, excluding adjustments: an organiser may legitimately correct the
-- same run more than once, so manual corrections carry no run-scoped
-- uniqueness. A plain table constraint would have silently blocked the second
-- correction.
create unique index one_award_per_run_per_kind
  on public.point_events (user_id, run_id, kind)
  where kind <> 'adjustment';

comment on table public.point_events is
  'Append-only points ledger. UNIQUE(user_id, run_id, kind) makes awards idempotent and the whole history replayable — see ADR 0003.';
comment on column public.point_events.awarded_at is
  'When the points were earned. Backfill preserves the original check-in time so leaderboard windows stay truthful.';

create index point_events_user_idx    on public.point_events (user_id, awarded_at desc);
create index point_events_awarded_idx on public.point_events (awarded_at);

-- Append-only, with the same anonymisation exception as everything else.
create trigger point_events_append_only
  before update on public.point_events
  for each row execute function app_private.allow_anonymisation_only('user_id');

-- ---------------------------------------------------------------------------
-- The rules, in one place.
--
-- Kept as functions rather than scattered literals so the values are visible,
-- testable, and changeable without hunting through award logic. Changing them
-- does not rewrite history: past rows keep the points they were awarded.
-- ---------------------------------------------------------------------------
create or replace function app_private.points_for_check_in()
returns integer language sql immutable parallel safe as $$ select 10 $$;

-- +2 per consecutive week, capped at +10, so a long streak stays rewarding
-- without letting one very consistent member become uncatchable.
create or replace function app_private.points_for_streak(p_streak_weeks integer)
returns integer language sql immutable parallel safe as $$
  select least(greatest(p_streak_weeks - 1, 0) * 2, 10)
$$;

-- ---------------------------------------------------------------------------
-- Streaks — deliberately forgiving (ADR 0003).
--
-- Counted in ISO weeks in the club's timezone, not in consecutive runs: a club
-- that sometimes runs twice a week should not punish attending only once.
--
-- A week is "kept" if the member attended, OR if the club offered no run that
-- week at all. Nobody's promise breaks because the club cancelled — that is
-- App Spec §2's "progress, not shame" applied literally, and it is why the
-- club's own schedule is part of the calculation rather than just the member's
-- attendance.
-- ---------------------------------------------------------------------------
create or replace function public.current_streak_weeks(
  p_user_id uuid,
  p_now     timestamptz default now()
)
returns integer
language plpgsql
stable
as $$
declare
  v_tz    text := app_private.club_timezone();
  v_week  date;
  v_streak integer := 0;
  v_attended boolean;
  v_offered  boolean;
begin
  -- Walk back week by week from the current one. Bounded at 520 (ten years) so
  -- a data oddity can never spin forever.
  v_week := date_trunc('week', (p_now at time zone v_tz))::date;

  for i in 0..519 loop
    select exists (
      select 1
      from public.run_attendance a
      join public.runs r on r.id = a.run_id
      where a.user_id = p_user_id
        and a.checked_in_at is not null
        and a.withdrawn_at is null
        and date_trunc('week', (a.checked_in_at at time zone v_tz))::date = v_week
    ) into v_attended;

    select exists (
      select 1 from public.runs r
      where r.status in ('published', 'in_progress', 'completed')
        and date_trunc('week', (r.starts_at at time zone v_tz))::date = v_week
        and r.starts_at <= p_now
    ) into v_offered;

    if v_attended then
      v_streak := v_streak + 1;
    elsif v_offered then
      -- A run was there to be attended and was missed. The streak ends —
      -- except in the current week, which is not over yet and must not break a
      -- streak before the member has had the chance to run.
      if i = 0 then
        null;
      else
        exit;
      end if;
    else
      -- No run offered that week (club cancelled, off-season, or before the
      -- club existed). Neutral: neither extends nor breaks.
      null;
    end if;

    v_week := v_week - 7;
  end loop;

  return v_streak;
end;
$$;

comment on function public.current_streak_weeks is
  'Consecutive weeks attended. A week with no run offered is neutral, and the current week never breaks a streak early — see ADR 0003.';

-- ---------------------------------------------------------------------------
-- Awarding points for a check-in.
--
-- Idempotent by the unique constraint, so it is safe to call from the check-in
-- path, from a backfill, and from a repair script, in any order, repeatedly.
--
-- p_now is injected rather than read from the clock: streak logic is otherwise
-- untestable without waiting real weeks (the council's sharpest engineering
-- point).
--
-- p_emit_notifications exists for the backfill. Awarding points across existing
-- history would otherwise enqueue a milestone notification for every member
-- retroactively — sitting unsent while there are no APNs credentials, then
-- firing all at once the day credentials land.
-- ---------------------------------------------------------------------------
create or replace function app_private.award_check_in_points(
  p_user_id  uuid,
  p_run_id   uuid,
  p_now      timestamptz default now(),
  p_source   text default 'live',
  p_emit_notifications boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_awarded_at timestamptz;
  v_streak     integer;
  v_bonus      integer;
  v_total      integer := 0;
  v_rows       integer;
begin
  -- Points follow the check-in that earned them, so a backfill reproduces the
  -- original timeline rather than collapsing every member's history onto today.
  select a.checked_in_at into v_awarded_at
  from public.run_attendance a
  where a.user_id = p_user_id and a.run_id = p_run_id
    and a.checked_in_at is not null and a.withdrawn_at is null;

  if v_awarded_at is null then
    return 0;  -- not checked in (or withdrawn): nothing to award
  end if;

  insert into public.point_events (user_id, run_id, kind, points, awarded_at, source)
  values (p_user_id, p_run_id, 'check_in', app_private.points_for_check_in(), v_awarded_at, p_source)
  on conflict (user_id, run_id, kind) where kind <> 'adjustment' do nothing;

  -- GET DIAGNOSTICS rather than FOUND. FOUND is fragile here: the streak query
  -- below sits between the two inserts, and relying on FOUND surviving an
  -- intervening statement is exactly the bug that shipped in join_run during
  -- Phase 1. An explicit row count cannot be clobbered.
  get diagnostics v_rows = row_count;
  v_total := v_total + (v_rows * app_private.points_for_check_in());

  -- Streak bonus, evaluated as at the moment of the check-in rather than now,
  -- so a replay reproduces the same answer it would have given at the time.
  v_streak := public.current_streak_weeks(p_user_id, v_awarded_at);
  v_bonus  := app_private.points_for_streak(v_streak);

  if v_bonus > 0 then
    insert into public.point_events (user_id, run_id, kind, points, awarded_at, source, note)
    values (p_user_id, p_run_id, 'streak_bonus', v_bonus, v_awarded_at, p_source,
            v_streak || ' week streak')
    on conflict (user_id, run_id, kind) where kind <> 'adjustment' do nothing;

    get diagnostics v_rows = row_count;
    v_total := v_total + (v_rows * v_bonus);
  end if;

  return v_total;
end;
$$;

-- ---------------------------------------------------------------------------
-- Which ledger rows currently count.
--
-- The ledger is append-only: it records what was awarded and when, and that
-- record is never rewritten. But an award can stop being *valid* — an organiser
-- removing a mistaken check-in should take the points with it.
--
-- Rather than writing reversal rows (which then need reversing again if the
-- member is re-checked-in, and rapidly stops being auditable), validity is
-- derived: a run-linked award counts only while the check-in behind it still
-- stands. Revocation and restoration both become automatic and exact.
--
-- Defined once, here, so every total in the app agrees (Principles §2).
-- ---------------------------------------------------------------------------
create view public.effective_point_events
with (security_invoker = on) as
  select pe.*
  from public.point_events pe
  left join public.run_attendance a
    on a.user_id = pe.user_id and a.run_id = pe.run_id
  where
    -- Manual adjustments stand on their own; they are not tied to a check-in.
    pe.kind = 'adjustment'
    or (a.checked_in_at is not null and a.withdrawn_at is null);

comment on view public.effective_point_events is
  'Ledger rows that currently count. A run-linked award stops counting if its check-in is removed — see ADR 0003.';

-- ---------------------------------------------------------------------------
-- Totals.
--
-- Computed, never stored. At ~300 members and a few thousand rows this is a
-- trivial aggregate, and a stored counter is exactly the kind of second copy
-- that drifts from the ledger (Principles §2).
-- ---------------------------------------------------------------------------
create or replace function public.points_total(
  p_user_id uuid,
  p_since   timestamptz default null
)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(pe.points), 0)::integer
  from public.point_events pe
  left join public.run_attendance a
    on a.user_id = pe.user_id and a.run_id = pe.run_id
  where pe.user_id = p_user_id
    and (p_since is null or pe.awarded_at >= p_since)
    and (pe.kind = 'adjustment'
         or (a.checked_in_at is not null and a.withdrawn_at is null));
$$;

create or replace function public.runs_attended(p_user_id uuid)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.run_attendance
  where user_id = p_user_id
    and checked_in_at is not null
    and withdrawn_at is null;
$$;
