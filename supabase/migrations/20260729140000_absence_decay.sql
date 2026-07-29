-- ============================================================================
-- 0025 · Points ease back when somebody stops coming
--
-- Owner decision, 2026-07-29: "penalties start after 2 consecutive missed runs."
--
-- This is what makes the six-month Legend in 0023 work. A ceiling that low with
-- points that only ever go up would mean every regular is Legend by their second
-- season and stays there whatever happens next — the top rung would measure how
-- long ago somebody joined. With decay, a tier says what a member is doing now.
--
-- THE FIRST MISS IS FREE, DELIBERATELY
--
-- One missed Saturday is a wedding, a night shift, a cold. Charging for it makes
-- the app punish an ordinary life, and App Spec §2 rules out guilt as a
-- motivator. Two in a row is a pattern, and that is where this starts.
--
-- HOW MUCH, AND THE FLOOR
--
-- 10 a run — exactly what a check-in is worth, so a missed run costs what
-- attending one earns and nothing more. Never below zero: a member returning
-- after a long absence starts from where they left off rather than climbing out
-- of a hole, which is the difference between an app that welcomes them back and
-- one that greets them with a debt.
--
-- NOBODY IS TOLD
--
-- No notification. A push saying "you have lost 10 points" is the exact message
-- App Spec §2 exists to prevent, and it would arrive on the evening of a run
-- somebody already feels bad about missing. It is visible on their own profile
-- if they look, and that is the right amount of visible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The validity rule, finally in one place.
--
-- Four copies of this predicate existed — the view, points_total, my_standing
-- and leaderboard — each with a comment explaining that it had to match the
-- others. Absence rows are the case that would have broken them apart: they are
-- run-linked but there is no check-in behind them, so under the old wording
-- every penalty would have been silently filtered out and the whole feature
-- would have done nothing at all.
-- ---------------------------------------------------------------------------
create or replace function app_private.point_event_stands(
  p_kind          public.point_kind,
  p_checked_in_at timestamptz,
  p_withdrawn_at  timestamptz
)
returns boolean
language sql
immutable
parallel safe
as $$
  -- Adjustments and absence penalties stand on their own. Everything else is
  -- tied to a check-in and stops counting if that check-in is undone.
  select p_kind in ('adjustment', 'absence')
      or (p_checked_in_at is not null and p_withdrawn_at is null);
$$;

create or replace view public.effective_point_events
with (security_invoker = on) as
  select pe.*
  from public.point_events pe
  left join public.run_attendance a
    on a.user_id = pe.user_id and a.run_id = pe.run_id
  where app_private.point_event_stands(pe.kind, a.checked_in_at, a.withdrawn_at);

comment on view public.effective_point_events is
  'Ledger rows that currently count. A run-linked award stops counting if its check-in is removed — see ADR 0003.';

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
  -- greatest(...,0) is the floor. The decay below never takes a member past
  -- zero, but an organiser adjustment can, and a negative points total is not
  -- a thing this app should be able to display.
  select greatest(coalesce(sum(pe.points), 0), 0)::integer
  from public.point_events pe
  left join public.run_attendance a
    on a.user_id = pe.user_id and a.run_id = pe.run_id
  where pe.user_id = p_user_id
    and (p_since is null or pe.awarded_at >= p_since)
    and app_private.point_event_stands(pe.kind, a.checked_in_at, a.withdrawn_at);
$$;

-- ---------------------------------------------------------------------------
-- How many club runs in a row a member has missed.
--
-- Counted against the club's own schedule, not a calendar: a member has not
-- "missed" anything in a fortnight the club did not run. Same principle as
-- current_streak_weeks, which forgives a week with no run.
-- ---------------------------------------------------------------------------
create or replace function public.consecutive_missed_runs(
  p_user_id uuid,
  p_as_of   timestamptz default now()
)
returns integer
language sql
stable
as $$
  select count(*)::integer
  from public.runs r
  where r.status = 'completed'
    and r.starts_at <= p_as_of
    and r.starts_at > coalesce(
      -- The last run they actually turned up to.
      (select max(r2.starts_at)
       from public.run_attendance a2
       join public.runs r2 on r2.id = a2.run_id
       where a2.user_id = p_user_id
         and a2.checked_in_at is not null
         and a2.withdrawn_at is null),
      -- Never attended: nothing to count from, and nothing to lose either — the
      -- guard in apply_absence_decay skips them entirely.
      'infinity'::timestamptz
    );
$$;

comment on function public.consecutive_missed_runs is
  'Completed club runs since the member last checked in. Counts the club''s schedule, not weeks — a fortnight with no run is not a miss.';

-- ---------------------------------------------------------------------------
-- Apply the decay for one run.
-- ---------------------------------------------------------------------------
create or replace function app_private.apply_absence_decay(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run     public.runs;
  v_member  record;
  v_missed  integer;
  v_total   integer;
  v_deduct  integer;
  v_applied integer := 0;
begin
  select * into v_run from public.runs where id = p_run_id;
  if not found or v_run.status <> 'completed' then
    return 0;
  end if;

  for v_member in
    select p.id
    from public.profiles p
    -- Only members who have ever turned up. Somebody who signed up months ago
    -- and never came is not "missing" runs — they have not started, and
    -- charging them for it would put them below zero on day one.
    where exists (
      select 1 from public.run_attendance a
      where a.user_id = p.id and a.checked_in_at is not null and a.withdrawn_at is null
    )
    and not exists (
      select 1 from public.run_attendance a
      where a.user_id = p.id and a.run_id = p_run_id
        and a.checked_in_at is not null and a.withdrawn_at is null
    )
  loop
    v_missed := public.consecutive_missed_runs(v_member.id, v_run.starts_at);

    -- The first miss is free.
    continue when v_missed < 2;

    v_total  := public.points_total(v_member.id);
    v_deduct := least(10, v_total);
    continue when v_deduct <= 0;

    insert into public.point_events (user_id, run_id, kind, points, source, note)
    values (v_member.id, p_run_id, 'absence', -v_deduct, 'live',
            v_missed || ' runs since you were last out')
    -- The partial unique index makes this idempotent, so re-completing a run
    -- or a retried scheduler tick cannot charge somebody twice.
    on conflict (user_id, run_id, kind) where kind <> 'adjustment' do nothing;

    v_applied := v_applied + 1;
  end loop;

  return v_applied;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hooked to the run finishing, as a trigger.
--
-- Two paths already complete a run — scheduler_tick and end_run — and the
-- points award learned this lesson in 0017: calling it from each one means
-- every future path has to remember to, and one that forgets fails silently.
-- Absence is worse than a missed award, because nothing at all happens when
-- somebody does not turn up. There is no event to notice; the run ending IS
-- the event.
-- ---------------------------------------------------------------------------
create or replace function app_private.on_run_completed_apply_decay()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    perform app_private.apply_absence_decay(new.id);
  exception when others then
    -- Never let this fail the run completion. Ending a run is what tells
    -- everyone who was there "nice work"; a points adjustment is not worth
    -- rolling that back.
    raise warning 'absence decay for run % failed: %', new.id, sqlerrm;
  end;
  return new;
end;
$$;

create trigger runs_apply_absence_decay
  after update of status on public.runs
  for each row
  when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function app_private.on_run_completed_apply_decay();

grant execute on function public.consecutive_missed_runs(uuid, timestamptz) to authenticated;
