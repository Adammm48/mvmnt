-- ============================================================================
-- 0057 · Every place on the board is one member's alone
--
-- Owner decision, 2026-07-30, on seeing two members share "=5" at 280 points:
-- no shared places. The previous design showed a genuine tie honestly
-- ("=5, =5, then 7"), which is how race results do it — but a leaderboard the
-- club looks at every week reads better when every row has its own number,
-- and the owner has called it.
--
-- A tie still has to break SOMEHOW, and the tie-breaker must be a fact rather
-- than an accident. Alphabetical or id order would quietly reward names and
-- uuids. The honest one is time, the same rule races and arcade boards use:
--
--     equal points — whoever GOT THERE FIRST stays ahead.
--
-- Concretely: the moment a member's counting ledger last changed. Somebody
-- sitting on 280 since March outranks somebody who reached 280 today, and the
-- newcomer knows exactly what to do about it — earn one more point. Earning
-- moves your moment to "now", so you cannot hold a place by going quiet while
-- somebody passes you on points; the clock only ever settles ties, never the
-- order of different totals.
--
-- Two functions change together (leaderboard, my_standing) because their
-- ORDER BY must be the same expression, or the board and the member's own
-- card disagree about rank — the exact class of two-copies bug this project
-- has now hit three times. Both also gain the final tie-breaker (user_id) so
-- the order is fully deterministic even for two members who somehow share a
-- timestamp.
--
-- "Points to move up a place" changes meaning with unique ranks: it is now
-- the gap to the member DIRECTLY ABOVE plus one — plus one because matching
-- their total ties you, and a fresh earner loses the tie on time. When the
-- member above holds the same total, the answer is simply 1.
-- ============================================================================

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
  with valid as (
    select pe.user_id, pe.points, pe.awarded_at
    from public.point_events pe
    left join public.run_attendance a
      on a.user_id = pe.user_id and a.run_id = pe.run_id
    where pe.user_id is not null
      and app_private.point_event_stands(pe.kind, a.checked_in_at, a.withdrawn_at)
  ),
  totals as (
    -- The window's points, and the moment the member last earned inside it —
    -- the tie-breaker. max(awarded_at) is "when they arrived at this total".
    select v.user_id,
           greatest(sum(v.points), 0)::integer as pts,
           max(v.awarded_at) as reached_at
    from valid v
    where v_since is null or v.awarded_at >= v_since
    group by v.user_id
  ),
  lifetime as (
    select v.user_id, greatest(sum(v.points), 0)::integer as pts
    from valid v
    group by v.user_id
  ),
  ranked as (
    -- row_number, not rank(): every place is one member's alone.
    select t.user_id, t.pts,
           row_number() over (
             order by t.pts desc, t.reached_at asc, t.user_id
           )::integer as rnk
    from totals t
  )
  select r.rnk, p.id, p.display_name, p.avatar_url, r.pts,
         public.tier_for_points(coalesce(l.pts, r.pts)),
         p.id = auth.uid()
  from ranked r
  join public.profiles p on p.id = r.user_id
  left join lifetime l on l.user_id = r.user_id
  where not p.leaderboard_opt_out
  order by r.rnk
  limit 100;
end;
$$;

comment on function public.leaderboard is
  'Top 100 by the chosen window. Every rank is unique: ties break by who reached the total first, then by id for determinism (migration 0057). Points are windowed; the tier is always lifetime (0047).';

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
  with valid as (
    select pe.user_id, pe.points, pe.awarded_at
    from public.point_events pe
    left join public.run_attendance a
      on a.user_id = pe.user_id and a.run_id = pe.run_id
    where pe.user_id is not null
      and app_private.point_event_stands(pe.kind, a.checked_in_at, a.withdrawn_at)
  ),
  totals as (
    select v.user_id,
           greatest(sum(v.points), 0)::integer as pts,
           max(v.awarded_at) as reached_at
    from valid v
    where v_since is null or v.awarded_at >= v_since
    group by v.user_id
  ),
  ranked as (
    -- The SAME ordering as leaderboard(), or the board and this card disagree.
    select t.user_id, t.pts,
           row_number() over (
             order by t.pts desc, t.reached_at asc, t.user_id
           )::integer as rnk,
           count(*) over ()::integer as total
    from totals t
  ),
  me as (select * from ranked where user_id = v_user),
  above as (
    -- The member directly above, by rank — who may hold the same total.
    select r.pts from ranked r
    where r.rnk = (select rnk from me) - 1
  )
  select
    coalesce((select pts from me), 0),
    coalesce((select rnk from me), (select coalesce(max(total), 0) + 1 from ranked)),
    greatest((select coalesce(max(total), 0) from ranked), 1),
    case
      when (select rnk from me) is null then 100
      else greatest(1, ((select rnk from me) * 100) / greatest((select max(total) from ranked), 1))
    end,
    -- Gap to the row directly above, plus one: matching them only ties, and a
    -- fresh earner loses the tie on time. Null at the top — nothing to chase.
    (select a.pts - (select pts from me) + 1 from above a),
    public.tier_for_points(public.points_total(v_user)),
    public.points_to_next_tier(public.points_total(v_user)),
    public.current_streak_weeks(v_user),
    public.runs_attended(v_user);
end;
$$;

comment on function public.my_standing is
  'The caller''s own place, computed with the identical ordering as leaderboard() (migration 0057). points_to_next_rank is the gap to the row directly above plus one, because matching a total only ties it.';
