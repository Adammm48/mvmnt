-- ============================================================================
-- 0044 · Kilometres with the club
--
-- The club-side half of App Spec §4.7's stats: distance a member has covered,
-- computed from what already exists — the runs they checked in to, times each
-- run's stated distance. No GPS trace, no health data, nothing new collected.
--
-- Honest by construction: it counts the club's advertised distance for runs
-- the member was actually at, which is the number a run club means when it
-- says "you've run 120K with us". Personal pace and heart rate remain
-- Phase 5's HealthKit territory (ADR 0005) — they need data this schema
-- deliberately does not hold.
-- ============================================================================

create or replace function public.my_distance_meters()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(r.distance_meters), 0)::bigint
  from public.run_attendance a
  join public.runs r on r.id = a.run_id
  where a.user_id = auth.uid()
    and a.checked_in_at is not null
    and a.withdrawn_at is null
    and r.status = 'completed'
    and r.distance_meters is not null;
$$;

comment on function public.my_distance_meters is
  'Metres run with the club: sum of stated distances of completed runs the caller checked in to. Own data only; no location or health data involved (App Spec §4.7, club-side half).';

grant execute on function public.my_distance_meters() to authenticated;
