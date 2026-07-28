-- ============================================================================
-- 0021 · The organiser's members directory
--
-- Phase 2 deliberately shipped without one. The reasoning was that a searchable
-- list of the whole membership is precisely what App Spec §4.4's QR-only design
-- exists to prevent, so member-level actions hung off the run-day attendee list
-- instead.
--
-- That reasoning was right about members and wrong about organisers. An
-- organiser already sees who signed up and who checked in, for every run, and
-- can check people in, correct their points and disable their friend code. They
-- can already assemble this list by hand, one run at a time. Refusing to build
-- the convenient version of something they can already do withholds usefulness
-- without withholding capability — and it left "somebody has complained about a
-- member who is not on today's run" with no route at all.
--
-- What this does NOT do is open anything to members. `profiles` RLS is
-- unchanged: a member still reads exactly one row, their own. The directory is
-- one SECURITY DEFINER function that refuses anyone who is not an admin.
-- ============================================================================

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
  points              integer,
  tier                public.member_tier,
  runs_attended       integer,
  streak_weeks        integer,
  last_run_at         timestamptz,
  joined_at           timestamptz,
  leaderboard_opt_out boolean,
  -- Whether they currently have a live friend code. An organiser handling a
  -- complaint needs to know whether disabling it would actually change
  -- anything, or whether the code they were shown has already expired.
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
    p.id,
    p.display_name,
    -- From auth.users, which is not reachable through PostgREST at all. Email is
    -- how an organiser tells two members with the same name apart, and it is
    -- the only way to contact someone about a complaint.
    u.email::text,
    p.avatar_url,
    p.role,
    public.points_total(p.id),
    public.tier_for_points(public.points_total(p.id)),
    public.runs_attended(p.id),
    public.current_streak_weeks(p.id),
    (select max(a.checked_in_at)
       from public.run_attendance a
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
  -- Most recently active first, so the people an organiser is most likely to be
  -- asked about are the ones already on screen.
  order by (select max(a.checked_in_at)
              from public.run_attendance a
             where a.user_id = p.id and a.withdrawn_at is null) desc nulls last,
           p.display_name
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

comment on function public.admin_members is
  'Organiser-only members directory. Members cannot browse the membership — profiles RLS is unchanged and still returns one row. See migration 0021.';

grant execute on function public.admin_members(text, integer) to authenticated;
