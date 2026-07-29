-- ============================================================================
-- 0034 · One validity rule, and it fails the safe way
--
-- Two bugs, one cause.
--
-- WHAT WAS BROKEN
--
-- The predicate deciding which ledger rows count existed in four copies. 0025
-- centralised two of them into app_private.point_event_stands() — but 0023 had
-- already recreated my_standing() and leaderboard() with the older inline copy,
-- and 0031's admin_member_detail() carried a third. So today:
--
--   · points_total() counts absence penalties. leaderboard() and my_standing()
--     do not. A member's own points and their leaderboard points DISAGREE, and
--     have since the day decay shipped.
--   · A redemption vanishes entirely. Spending points at the shop deducted
--     nothing, because 'redemption' was not on the list of kinds that "stand on
--     their own" — which is how the shop tests caught this at all.
--
-- WHY IT KEPT HAPPENING
--
-- The rule was written as an allowlist: "these kinds count regardless". Every
-- new kind therefore defaulted to **silently not counting**, and silence is
-- exactly what nobody notices. Two new kinds shipped after it — absence and
-- redemption — and both were forgotten.
--
-- THE FIX IS THE SHAPE, NOT THE LIST
--
-- Inverted: only check_in and streak_bonus depend on a check-in still standing.
-- Everything else counts. A kind added tomorrow counts by default, so the
-- failure mode of forgetting becomes "a number is too big", which somebody
-- notices immediately, instead of "a number is quietly too small", which nobody
-- does.
-- ============================================================================

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
  -- Named as a denylist on purpose. These two are derived from a check-in and
  -- stop counting when it is undone; everything else — adjustments, absence
  -- penalties, redemptions, and whatever comes next — stands on its own.
  select p_kind not in ('check_in', 'streak_bonus')
      or (p_checked_in_at is not null and p_withdrawn_at is null);
$$;

comment on function app_private.point_event_stands is
  'The single rule for which ledger rows count. Written as a denylist so a new point kind counts by default: forgetting one then over-counts visibly rather than under-counting silently. See migration 0034.';

-- ---------------------------------------------------------------------------
-- The two that still had their own copy.
--
-- Recreated with the helper so the leaderboard, a member's own standing, and
-- points_total() are now provably the same arithmetic.
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
  with totals as (
    select pe.user_id, greatest(sum(pe.points), 0)::integer as pts
    from public.point_events pe
    left join public.run_attendance a
      on a.user_id = pe.user_id and a.run_id = pe.run_id
    where pe.user_id is not null
      and (v_since is null or pe.awarded_at >= v_since)
      and app_private.point_event_stands(pe.kind, a.checked_in_at, a.withdrawn_at)
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
    case
      when (select rnk from me) is null then 100
      else greatest(1, ((select rnk from me) * 100) / greatest((select max(total) from ranked), 1))
    end,
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
    -- greatest(...,0) mirrors points_total()'s floor. Without it an organiser
    -- adjustment could put somebody below zero on the board but not on their
    -- own profile — the same class of disagreement this migration exists to end.
    select pe.user_id, greatest(sum(pe.points), 0)::integer as pts
    from public.point_events pe
    left join public.run_attendance a
      on a.user_id = pe.user_id and a.run_id = pe.run_id
    where pe.user_id is not null
      and (v_since is null or pe.awarded_at >= v_since)
      and app_private.point_event_stands(pe.kind, a.checked_in_at, a.withdrawn_at)
    group by pe.user_id
  ),
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

grant execute on function public.my_standing(text) to authenticated;
grant execute on function public.leaderboard(text) to authenticated;

-- ---------------------------------------------------------------------------
-- And the third copy, in the organiser's member detail.
--
-- This one drives the "still counting" column on a member's points ledger — so
-- it was telling an organiser that a redemption did not count while the
-- member's balance said it did.
-- ---------------------------------------------------------------------------
create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select jsonb_build_object(
    'profile', (
      select jsonb_build_object(
        'user_id', p.id,
        'display_name', p.display_name,
        'email', u.email,
        'avatar_url', p.avatar_url,
        'role', p.role,
        'is_founder', p.is_founder,
        'joined_at', p.created_at,
        'leaderboard_opt_out', p.leaderboard_opt_out,
        'points', public.points_total(p.id),
        'tier', public.tier_for_points(public.points_total(p.id)),
        'runs_attended', public.runs_attended(p.id),
        'streak_weeks', public.current_streak_weeks(p.id)
      )
      from public.profiles p join auth.users u on u.id = p.id
      where p.id = p_user_id
    ),

    'badges', coalesce((
      select jsonb_agg(jsonb_build_object('key', b.key, 'label', b.label, 'earned_at', mb.earned_at)
                       order by b.runs_required)
      from public.member_badges mb join public.badges b on b.key = mb.badge_key
      where mb.user_id = p_user_id
    ), '[]'::jsonb),

    'friends', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', o.id,
               'display_name', o.display_name,
               'since', f.created_at,
               'they_initiated', f.initiated_by is distinct from p_user_id)
             order by f.created_at desc)
      from public.friendships f
      join public.profiles o
        on o.id = case when f.user_low = p_user_id then f.user_high else f.user_low end
      where f.user_low = p_user_id or f.user_high = p_user_id
    ), '[]'::jsonb),

    'friend_code', jsonb_build_object(
      'active', exists (
        select 1 from public.friend_qr_tokens t
        where t.user_id = p_user_id and t.revoked_at is null and t.expires_at > now()
      ),
      'shown_count', (select count(*) from public.friend_qr_tokens where user_id = p_user_id)
    ),

    'devices', coalesce((
      select jsonb_agg(jsonb_build_object('platform', t.platform, 'last_seen_at', t.last_seen_at)
                       order by t.last_seen_at desc)
      from public.push_tokens t where t.user_id = p_user_id
    ), '[]'::jsonb),

    'recent_runs', coalesce((
      select jsonb_agg(x order by x->>'starts_at' desc)
      from (
        select jsonb_build_object(
                 'run_id', r.id,
                 'title', r.title,
                 'starts_at', r.starts_at,
                 'state', public.attendance_state(a.signed_up_at, a.checked_in_at, a.withdrawn_at),
                 'check_in_method', a.check_in_method,
                 'has_location_evidence', exists (
                   select 1 from public.check_in_evidence e where e.attendance_id = a.id
                 )
               ) as x
        from public.run_attendance a
        join public.runs r on r.id = a.run_id
        where a.user_id = p_user_id
        order by r.starts_at desc
        limit 20
      ) s
    ), '[]'::jsonb),

    'points_ledger', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', pe.kind, 'points', pe.points, 'source', pe.source,
               'note', pe.note, 'awarded_at', pe.awarded_at,
               'still_counting', app_private.point_event_stands(
                 pe.kind,
                 (select a.checked_in_at from public.run_attendance a
                   where a.user_id = pe.user_id and a.run_id = pe.run_id),
                 (select a.withdrawn_at from public.run_attendance a
                   where a.user_id = pe.user_id and a.run_id = pe.run_id)))
             order by pe.awarded_at desc)
      from (select * from public.point_events
             where user_id = p_user_id order by awarded_at desc limit 20) pe
    ), '[]'::jsonb),

    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'product_name', o.product_name, 'status', o.status,
               'total_minor', o.total_minor, 'points_spent', o.points_spent,
               'is_gift', o.is_gift, 'created_at', o.created_at)
             order by o.created_at desc)
      from (select * from public.orders
             where buyer_id = p_user_id or recipient_id = p_user_id
             order by created_at desc limit 20) o
    ), '[]'::jsonb),

    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', ne.title, 'type', ne.type,
               'status', d.status, 'sent_at', d.sent_at, 'created_at', d.created_at)
             order by d.created_at desc)
      from (select * from public.notification_deliveries
             where user_id = p_user_id order by created_at desc limit 20) d
      join public.notification_events ne on ne.id = d.event_id
    ), '[]'::jsonb),

    'admin_actions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'action', l.action, 'at', l.occurred_at, 'metadata', l.metadata,
               'by', (select display_name from public.profiles where id = l.actor_id))
             order by l.occurred_at desc)
      from (select * from public.audit_log
             where entity_id = p_user_id::text
             order by occurred_at desc limit 30) l
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_member_detail(uuid) to authenticated;
