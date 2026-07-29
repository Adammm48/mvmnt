-- ============================================================================
-- 0047 · A tier is a lifetime fact, including on the monthly board
--
-- Found by the owner reading their own screen: the standing card said ELITE
-- and the row for the same member, four inches below it, said RUNNER.
--
-- leaderboard() computed the tier from the WINDOWED points:
--
--     public.tier_for_points(r.pts)   -- r.pts is this month's total
--
-- So on the monthly board a member with 400 lifetime points and 90 this month
-- was rendered as whatever 90 points is worth. my_standing() had already got
-- this right — it takes the tier from the lifetime total regardless of window —
-- which is exactly why the two disagreed on one screen.
--
-- This is the third time this project has hit the same shape of bug: two
-- numbers that happen to be equal in the common case (all-time window), written
-- as if they were the same thing, and only pulling apart when something
-- changes. The others were the validity predicate in four copies (0035) and
-- `v_spend := v_discount` in the shop (0035). The rule that would have caught
-- all three: if two expressions must always agree, one of them should not exist.
--
-- There is no such thing as a monthly tier. A tier is what a member has done,
-- full stop — and since migration 0046 removed absence decay, that is now
-- doubly true: the total it is derived from never goes down on its own.
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
    -- The ledger rows that currently count, once. Both totals below are built
    -- from this, so the windowed and lifetime numbers cannot drift apart by
    -- applying the validity rule differently.
    select pe.user_id, pe.points, pe.awarded_at
    from public.point_events pe
    left join public.run_attendance a
      on a.user_id = pe.user_id and a.run_id = pe.run_id
    where pe.user_id is not null
      and app_private.point_event_stands(pe.kind, a.checked_in_at, a.withdrawn_at)
  ),
  totals as (
    -- What the board RANKS by: the chosen window.
    --
    -- greatest(...,0) mirrors points_total()'s floor. Without it an organiser
    -- adjustment could put somebody below zero on the board but not on their
    -- own profile.
    select v.user_id, greatest(sum(v.points), 0)::integer as pts
    from valid v
    where v_since is null or v.awarded_at >= v_since
    group by v.user_id
  ),
  lifetime as (
    -- What the board TIERS by: everything, always. Never filtered by window.
    select v.user_id, greatest(sum(v.points), 0)::integer as pts
    from valid v
    group by v.user_id
  ),
  ranked as (
    select t.user_id, t.pts, rank() over (order by t.pts desc)::integer as rnk
    from totals t
  )
  select r.rnk, p.id, p.display_name, p.avatar_url, r.pts,
         -- coalesce for the member whose only points fall inside the window
         -- but whose lifetime row is somehow absent — impossible today, and a
         -- null tier would render as a blank badge rather than an error.
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
  'Top 100 by the chosen window, excluding members who opted out. Points are windowed; the TIER is always lifetime (migration 0047) — a monthly board that recomputed tiers from monthly points contradicted the member''s own standing card on the same screen.';
