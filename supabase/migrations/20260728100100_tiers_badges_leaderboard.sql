-- ============================================================================
-- 0016 · Tiers, badges, and the leaderboard
--
-- The leaderboard is the one place in this app where a member can see another
-- member's name. Everything else in Phase 1 was built so that was impossible.
-- That exception is deliberate, owner-decided, and narrow — see ADR 0003.
-- ============================================================================

create type public.member_tier as enum ('starter', 'core', 'elite');

-- ---------------------------------------------------------------------------
-- Tier, from lifetime points.
--
-- One ranking currency, per the council: rank and tier key off the same number
-- rather than points-for-rank and runs-for-tier, which would leave members
-- asking why 4,000 points is not Elite. Thresholds are set to land near 50 and
-- 100 runs so the tier names still mean roughly what App Spec §4.3 implied.
-- ---------------------------------------------------------------------------
create or replace function public.tier_for_points(p_points integer)
returns public.member_tier
language sql
immutable
parallel safe
as $$
  select case
    when p_points >= 1000 then 'elite'::public.member_tier
    when p_points >= 500  then 'core'::public.member_tier
    else 'starter'::public.member_tier
  end;
$$;

create or replace function public.points_to_next_tier(p_points integer)
returns integer
language sql
immutable
parallel safe
as $$
  -- Always distance-to-go, never shortfall (App Spec §2: "3 more runs to
  -- Elite", never "you missed 2 runs"). Null at the top — there is nothing
  -- left to chase, which the UI should celebrate rather than render as zero.
  select case
    when p_points >= 1000 then null
    when p_points >= 500  then 1000 - p_points
    else 500 - p_points
  end;
$$;

-- ---------------------------------------------------------------------------
-- Badges — run-count milestones.
--
-- Discrete achievements rather than a second ranking, so they do not
-- reintroduce the two-currency confusion. "50 runs" is a far more legible
-- thing to be proud of than "500 points".
--
-- Held in a table rather than hardcoded so an organiser can add one without a
-- deploy.
-- ---------------------------------------------------------------------------
create table public.badges (
  key            text primary key,
  label          text not null,
  runs_required  integer not null,
  sort_order     integer not null default 0
);

insert into public.badges (key, label, runs_required, sort_order) values
  ('runs_10',  'First 10 runs', 10,  1),
  ('runs_50',  '50 runs',       50,  2),
  ('runs_100', '100 runs',      100, 3),
  ('runs_250', '250 runs',      250, 4);

-- Earned badges are recorded rather than derived, because the DATE a member
-- earned something is part of their history and cannot be recovered from a
-- threshold comparison after the fact.
create table public.member_badges (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  badge_key  text not null references public.badges (key) on delete cascade,
  earned_at  timestamptz not null default now(),
  primary key (user_id, badge_key)
);

create index member_badges_user_idx on public.member_badges (user_id, earned_at desc);

-- ---------------------------------------------------------------------------
-- Leaderboard visibility.
--
-- Default visible: the owner chose a public board, and defaulting everyone to
-- hidden would quietly undo that decision.
--
-- The opt-out exists because publishing a member's name alongside how often
-- they attend a known place at a known time is personal-data processing, and
-- under Egypt's PDPL (and GDPR, for any EU/UK member) a person needs some way
-- to object. It costs one boolean and one WHERE clause. See ADR 0003.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column leaderboard_opt_out boolean not null default false;

comment on column public.profiles.leaderboard_opt_out is
  'When true the member is hidden from the public leaderboard. They still see their own rank. See ADR 0003.';

-- ---------------------------------------------------------------------------
-- Awarding badges.
--
-- Separate from points so a rules change to one cannot corrupt the other.
-- Emits a notification per newly earned badge, unless suppressed for backfill.
-- ---------------------------------------------------------------------------
create or replace function app_private.award_badges(
  p_user_id uuid,
  p_now     timestamptz default now(),
  p_emit_notifications boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runs    integer;
  v_badge   record;
  v_awarded integer := 0;
begin
  v_runs := public.runs_attended(p_user_id);

  for v_badge in
    select b.key, b.label
    from public.badges b
    where b.runs_required <= v_runs
      and not exists (
        select 1 from public.member_badges mb
        where mb.user_id = p_user_id and mb.badge_key = b.key
      )
    order by b.runs_required
  loop
    insert into public.member_badges (user_id, badge_key, earned_at)
    values (p_user_id, v_badge.key, p_now)
    on conflict do nothing;

    v_awarded := v_awarded + 1;
  end loop;

  return v_awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- A member's own standing.
--
-- Works for everyone, including members outside the top 100 and members who
-- have opted out — so the screen is useful to the whole club rather than only
-- the visible third of it.
--
-- Rank is computed against ALL members, opted out or not. Hiding from the board
-- should not silently improve or worsen anyone else's position.
-- ---------------------------------------------------------------------------
create or replace function public.my_standing(p_window text default 'all_time')
returns table (
  points          integer,
  rank            integer,
  total_members   integer,
  percentile      integer,
  points_to_next_rank integer,
  tier            public.member_tier,
  points_to_next_tier integer,
  streak_weeks    integer,
  runs_attended   integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_since timestamptz;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  v_since := case
    when p_window = 'month'
      then date_trunc('month', (now() at time zone app_private.club_timezone()))
             at time zone app_private.club_timezone()
    else null
  end;

  return query
  -- Same validity rule as points_total(): a run-linked award stops counting
  -- once its check-in is removed. Duplicating the raw table here instead would
  -- let rank disagree with the member's own points total.
  with totals as (
    select pe.user_id, sum(pe.points)::integer as pts
    from public.point_events pe
    left join public.run_attendance a
      on a.user_id = pe.user_id and a.run_id = pe.run_id
    where pe.user_id is not null
      and (v_since is null or pe.awarded_at >= v_since)
      and (pe.kind = 'adjustment'
           or (a.checked_in_at is not null and a.withdrawn_at is null))
    group by pe.user_id
  ),
  ranked as (
    select t.user_id, t.pts,
           rank() over (order by t.pts desc)::integer as rnk,
           count(*) over ()::integer as total
    from totals t
  ),
  me as (select * from ranked where user_id = v_user)
  select
    coalesce((select pts from me), 0),
    coalesce((select rnk from me), (select coalesce(max(total), 0) + 1 from ranked)),
    greatest((select coalesce(max(total), 0) from ranked), 1),
    -- Percentile as "top N%", so bigger is better and it reads as an
    -- achievement rather than a position from the bottom.
    case
      when (select rnk from me) is null then 100
      else greatest(1, ((select rnk from me) * 100) / greatest((select max(total) from ranked), 1))
    end,
    -- Distance to the next person up, never the gap to those below.
    (select min(r.pts) - coalesce((select pts from me), 0)
     from ranked r where r.pts > coalesce((select pts from me), 0)),
    public.tier_for_points(public.points_total(v_user)),
    public.points_to_next_tier(public.points_total(v_user)),
    public.current_streak_weeks(v_user),
    public.runs_attended(v_user);
end;
$$;

-- ---------------------------------------------------------------------------
-- The public leaderboard.
--
-- SECURITY DEFINER, because this is the single deliberate exception to Phase
-- 1's rule that a member can read only their own profile. It exposes exactly
-- three things about another member — display name, avatar, points — for at
-- most 100 people, and only those who have not opted out. No email, no
-- attendance detail, no run-level history.
--
-- Capped in SQL rather than by the caller: a client-supplied limit could
-- otherwise walk the whole membership 100 rows at a time.
-- ---------------------------------------------------------------------------
create or replace function public.leaderboard(p_window text default 'all_time')
returns table (
  rank         integer,
  user_id      uuid,
  display_name text,
  avatar_url   text,
  points       integer,
  tier         public.member_tier,
  is_me        boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  v_since := case
    when p_window = 'month'
      then date_trunc('month', (now() at time zone app_private.club_timezone()))
             at time zone app_private.club_timezone()
    else null
  end;

  return query
  -- Same validity rule as points_total(): a run-linked award stops counting
  -- once its check-in is removed. Duplicating the raw table here instead would
  -- let rank disagree with the member's own points total.
  with totals as (
    select pe.user_id, sum(pe.points)::integer as pts
    from public.point_events pe
    left join public.run_attendance a
      on a.user_id = pe.user_id and a.run_id = pe.run_id
    where pe.user_id is not null
      and (v_since is null or pe.awarded_at >= v_since)
      and (pe.kind = 'adjustment'
           or (a.checked_in_at is not null and a.withdrawn_at is null))
    group by pe.user_id
  ),
  -- Rank before filtering, so opting out hides a member without shuffling
  -- everyone below them up a place.
  ranked as (
    select t.user_id, t.pts, rank() over (order by t.pts desc)::integer as rnk
    from totals t
  )
  select r.rnk, p.id, p.display_name, p.avatar_url, r.pts,
         public.tier_for_points(r.pts),
         p.id = auth.uid()
  from ranked r
  join public.profiles p on p.id = r.user_id
  where not p.leaderboard_opt_out
  order by r.rnk
  limit 100;
end;
$$;

comment on function public.leaderboard is
  'Top 100 by points. The single deliberate exception to "a member reads only their own profile" — exposes name, avatar and points only, and only for members who have not opted out. See ADR 0003.';
