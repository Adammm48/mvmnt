-- ============================================================================
-- 0022 · Promoting organisers, and the full picture of a member
--
-- Two owner decisions drive this file (2026-07-29):
--
--   1. "The organiser has all the trust — don't hide anything from him."
--      So admin_member_detail returns everything the database knows about a
--      member, including who their friends are. That is a real widening and it
--      is deliberate; see the note on friends below.
--
--   2. "He will use it alone, and if someone else has it he trusts them."
--      So promotion and demotion carry no approval flow, no cooldown and no
--      second signature. One guard only, and it is the owner's own: the
--      founding account can never be demoted, by anyone, including itself.
--
-- The founder rule is not a trust restriction. It is the thing that makes
-- everything else safe to leave open — however the roles are shuffled, there is
-- always one account that can still get in.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Who the founder is.
--
-- An explicit flag rather than "whichever admin is oldest". Derived would move
-- on its own the moment that account was erased or another was backdated, and
-- an account that silently stops being un-demotable is the exact failure this
-- is meant to prevent. The partial unique index makes "exactly one" a schema
-- rule instead of a convention.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column is_founder boolean not null default false;

create unique index profiles_one_founder on public.profiles (is_founder)
  where is_founder;

comment on column public.profiles.is_founder is
  'The club owner''s original account. Cannot be demoted by anyone, including itself — it is the guaranteed way back into the console. At most one row has this.';

-- On a database that already has organisers, the earliest of them is the
-- account the club was bootstrapped with.
update public.profiles
   set is_founder = true
 where id = (
   select p.id from public.profiles p
   where p.role = 'admin'
   order by p.created_at, p.id
   limit 1
 );

-- On a fresh one this finds nobody: migrations run before any account exists.
-- So the flag also claims itself — see guard_profile_role below, where the
-- first account ever promoted to admin becomes the founder. That covers the
-- real bootstrap (a brand-new project, promoted by hand once) and repairs the
-- state if the founding account is ever erased.

-- ---------------------------------------------------------------------------
-- The guard, at the table.
--
-- Deliberately in the trigger and not only in the RPC below. A rule that lives
-- in one function is a rule that the next function forgets (Principles §2), and
-- `profiles` is directly updatable by an admin through PostgREST — so an RPC-only
-- guard would be trivially sidestepped by a plain PATCH.
-- ---------------------------------------------------------------------------
create or replace function app_private.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'only an admin can change a role'
      using errcode = 'insufficient_privilege';
  end if;

  -- The founder keeps their role no matter who asks. The null-uid exemption
  -- stays: it is the same bootstrap path that created the first admin, and
  -- someone with direct database access can already do anything.
  if old.is_founder
     and new.role is distinct from old.role
     and auth.uid() is not null then
    raise exception 'the club owner''s account cannot be demoted'
      using errcode = 'insufficient_privilege';
  end if;

  -- Nor can the flag itself be moved or cleared through the API, which would
  -- otherwise be a one-step way around the rule above.
  if new.is_founder is distinct from old.is_founder
     and auth.uid() is not null then
    raise exception 'the founding account cannot be reassigned'
      using errcode = 'insufficient_privilege';
  end if;

  -- The founding account claims itself.
  --
  -- The first admin the club ever has is, by definition, the one the owner
  -- bootstrapped by hand — there is no earlier candidate and nobody to choose
  -- between. Doing it here rather than in a migration is what makes it work on
  -- a brand-new project, where migrations run before a single account exists.
  --
  -- After the flag is set this is a no-op forever, because the EXISTS is then
  -- always true. If the founding account is erased it re-arms, so a club can
  -- never end up with no protected way in.
  if new.role = 'admin' and not new.is_founder
     and not exists (select 1 from public.profiles where is_founder) then
    new.is_founder := true;
  end if;

  if new.role is distinct from old.role then
    perform app_private.audit('change_role', 'profiles', new.id::text,
                              jsonb_build_object('from', old.role, 'to', new.role,
                                                 'founder', new.is_founder));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Promote and demote.
--
-- The console calls this rather than PATCHing profiles directly, so the refusals
-- come back as sentences an organiser can read instead of a constraint name.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_member_role(
  p_user_id uuid,
  p_role    public.member_role
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.profiles;
  v_admins integer;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select * into v_target from public.profiles where id = p_user_id;
  if not found then
    raise exception 'that member no longer exists' using errcode = 'no_data_found';
  end if;

  if v_target.role = p_role then
    return;  -- already there; a double-tap is not an error
  end if;

  if v_target.is_founder then
    raise exception 'the club owner''s account cannot be demoted'
      using errcode = 'insufficient_privilege';
  end if;

  -- Lockout backstop, not a trust rule. It only ever fires if the founding
  -- account has been erased, which is a member's right and would otherwise
  -- leave the club one careless tap from having no way into the console at all.
  if p_role = 'member' then
    select count(*)::integer into v_admins from public.profiles where role = 'admin';
    if v_admins <= 1 then
      raise exception 'this is the last organiser — promote someone else first'
        using errcode = 'check_violation';
    end if;
  end if;

  update public.profiles set role = p_role where id = p_user_id;
  -- The role change itself is audited by the guard trigger, which sees every
  -- path rather than only this one.
end;
$$;

grant execute on function public.admin_set_member_role(uuid, public.member_role) to authenticated;

-- ---------------------------------------------------------------------------
-- Everything the database knows about one member.
--
-- One call returning a document, rather than eight round trips the console
-- would have to assemble and keep in step.
--
-- ON FRIENDS: this returns names, not a count. That is a genuine widening —
-- a friendship is a fact about two people, and listing it exposes a little of
-- someone who is not the member being looked at. It is here because the owner
-- asked for it explicitly, and because the alternative is an organiser handling
-- a complaint about unwanted adds with no way to see what was actually added.
-- It stays organiser-only; no member can reach any part of this.
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

    -- Recent runs, with how each check-in happened and whether the location
    -- evidence behind it still exists. Evidence is purged at 30 days, so
    -- "no evidence" on an older run is the retention rule working, not a gap.
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
               'still_counting', pe.kind = 'adjustment'
                 or exists (select 1 from public.run_attendance a
                            where a.user_id = pe.user_id and a.run_id = pe.run_id
                              and a.checked_in_at is not null and a.withdrawn_at is null))
             order by pe.awarded_at desc)
      from (select * from public.point_events
             where user_id = p_user_id order by awarded_at desc limit 20) pe
    ), '[]'::jsonb),

    -- What the club has actually sent them, and whether it arrived.
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object(
               'title', ne.title, 'type', ne.type,
               'status', d.status, 'sent_at', d.sent_at, 'created_at', d.created_at)
             order by d.created_at desc)
      from (select * from public.notification_deliveries
             where user_id = p_user_id order by created_at desc limit 20) d
      join public.notification_events ne on ne.id = d.event_id
    ), '[]'::jsonb),

    -- Every organiser action ever taken on this account. The point of an audit
    -- log is that somebody can read it.
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

-- ---------------------------------------------------------------------------
-- The directory gains the two fields the console needs to render the role
-- controls without a second call per row.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_members(text, integer);

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

grant execute on function public.admin_members(text, integer) to authenticated;
