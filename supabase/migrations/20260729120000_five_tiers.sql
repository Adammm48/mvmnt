-- ============================================================================
-- 0023 · Five tiers
--
-- Owner decision, 2026-07-29: Rookie · Runner · Competitor · Elite · Legend,
-- replacing the three the spec started with (Starter / Core / Elite).
--
-- More rungs is the right call for a club that meets weekly. Three tiers over
-- several years means most members sit in one band for a year at a time and the
-- ladder stops meaning anything; five gives a newcomer something reachable in
-- their first couple of months and still leaves a rung that is genuinely rare.
--
-- WHY THIS DROPS AND RECREATES THE TYPE
--
-- Postgres can add a value to an enum but not remove one. Leaving 'starter' and
-- 'core' behind as values nothing can produce is the kind of debris that has
-- somebody six months from now writing a case for a tier that cannot happen. No
-- column stores member_tier — it exists only as a function return type — so the
-- type can be replaced outright, at the cost of recreating the four functions
-- that name it.
--
-- THRESHOLDS
--
-- Owner decision: Legend is reachable in six months. Not a round-number guess —
-- the club runs once a week, a check-in is 10 points, and the streak bonus
-- climbs 2 a week to a cap of 10, so twenty-six consecutive weeks is worth
-- exactly 490. That number is where Legend sits, and the rungs below are placed
-- at the months on the way:
--
--   Rookie       0    where everyone starts
--   Runner      60    ~5 runs, about a month. Deliberately the easiest jump —
--                     the tier nobody ever leaves is the one that teaches them
--                     the ladder is not meant for them
--   Competitor 150    ~10 runs, around two and a half months
--   Elite      290    ~16 runs, around four months
--   Legend     480    26 runs — a clean six months of not missing
--
-- This only works because points can also go DOWN (migration 0025). Without
-- decay, a six-month ceiling would mean every regular is Legend forever by
-- their second season and the top rung stops saying anything. With it, the
-- tier reads as current form rather than length of service.
-- ============================================================================

-- The four functions that name the type, dropped so the type can go.
drop function if exists public.tier_for_points(integer);
drop function if exists public.my_standing(text);
drop function if exists public.leaderboard(text);
drop function if exists public.admin_members(text, integer);

drop type public.member_tier;

create type public.member_tier as enum (
  'rookie',
  'runner',
  'competitor',
  'elite',
  'legend'
);

-- ---------------------------------------------------------------------------
-- Tier and the distance to the next one.
--
-- The two are written next to each other and share their thresholds by eye;
-- they are the only place these numbers appear server-side, and a mismatch
-- would tell a member they are 40 points from a tier they are already in.
-- ---------------------------------------------------------------------------
create or replace function public.tier_for_points(p_points integer)
returns public.member_tier
language sql
immutable
parallel safe
as $$
  select case
    when p_points >= 480 then 'legend'::public.member_tier
    when p_points >= 290 then 'elite'::public.member_tier
    when p_points >= 150 then 'competitor'::public.member_tier
    when p_points >= 60  then 'runner'::public.member_tier
    else 'rookie'::public.member_tier
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
    when p_points >= 480 then null
    when p_points >= 290 then 480 - p_points
    when p_points >= 150 then 290 - p_points
    when p_points >= 60  then 150 - p_points
    else 60 - p_points
  end;
$$;

-- ---------------------------------------------------------------------------
-- The three readers, recreated unchanged apart from the type they return.
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

create or replace function public.admin_members(
  p_search text default null,
  p_limit  integer default 50
)
returns table (
  user_id             uuid,
  display_name        text,
  email               text,
  avatar_url          text,
  role                public.member_role,
  is_founder          boolean,
  points              integer,
  tier                public.member_tier,
  runs_attended       integer,
  streak_weeks        integer,
  last_run_at         timestamptz,
  joined_at           timestamptz,
  leaderboard_opt_out boolean,
  friend_code_active  boolean,
  friend_count        integer
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id, p.display_name, u.email::text, p.avatar_url, p.role, p.is_founder,
    public.points_total(p.id),
    public.tier_for_points(public.points_total(p.id)),
    public.runs_attended(p.id),
    public.current_streak_weeks(p.id),
    (select max(a.checked_in_at) from public.run_attendance a
      where a.user_id = p.id and a.withdrawn_at is null),
    p.created_at,
    p.leaderboard_opt_out,
    exists (
      select 1 from public.friend_qr_tokens t
      where t.user_id = p.id and t.revoked_at is null and t.expires_at > now()
    ),
    (select count(*)::integer from public.friendships f
      where f.user_low = p.id or f.user_high = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  where p_search is null
     or trim(p_search) = ''
     or p.display_name ilike '%' || trim(p_search) || '%'
     or u.email ilike '%' || trim(p_search) || '%'
  order by (select max(a.checked_in_at) from public.run_attendance a
             where a.user_id = p.id and a.withdrawn_at is null) desc nulls last,
           p.display_name
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

comment on function public.admin_members is
  'Organiser-only members directory. Members cannot browse the membership — profiles RLS is unchanged and still returns one row. See migration 0021.';

-- The drops above took their grants with them.
grant execute on function public.tier_for_points(integer)     to authenticated;
grant execute on function public.points_to_next_tier(integer) to authenticated;
grant execute on function public.my_standing(text)            to authenticated;
grant execute on function public.leaderboard(text)            to authenticated;
grant execute on function public.admin_members(text, integer) to authenticated;
