-- ============================================================================
-- 0018 · Friends (QR-only) and pokes
--
-- App Spec §4.4 makes QR-only adding a deliberate safety measure: no search, no
-- remote add, no username lookup. §8 adds that a member must be able to
-- regenerate or invalidate their code if they think it has been shared without
-- consent.
--
-- HOW "IN PERSON" IS ACTUALLY ENFORCED
--
-- A permanent friend code would not be QR-only in any meaningful sense — it
-- would be a username you paste into WhatsApp, and the whole safety property
-- collapses. So the token behind the QR is SHORT-LIVED (3 minutes) and rotates.
-- A screenshot forwarded to someone who was not standing there is expired
-- before it arrives. That is the mechanism that makes "in person" true rather
-- than merely intended.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Short-lived QR tokens.
-- ---------------------------------------------------------------------------
create table public.friend_qr_tokens (
  token       text primary key,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);

create index friend_qr_tokens_user_idx on public.friend_qr_tokens (user_id, expires_at desc);

comment on table public.friend_qr_tokens is
  'Short-lived tokens behind a member''s friend QR. Expiry is what makes "in person only" real — a forwarded screenshot is dead on arrival.';

-- ---------------------------------------------------------------------------
-- Friendships.
--
-- One row per pair, with the ids stored in a fixed order. Two rows (a→b and
-- b→a) would let the pair drift out of sync — one side unfriending while the
-- other still sees them — which is exactly the kind of asymmetry that turns
-- into "I removed them but they can still see me".
-- ---------------------------------------------------------------------------
create table public.friendships (
  user_low    uuid not null references public.profiles (id) on delete cascade,
  user_high   uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  -- Which of the two scanned the other's code. Kept for moderation: if someone
  -- reports unwanted adds, an organiser needs to see who initiated them.
  initiated_by uuid references public.profiles (id) on delete set null,

  primary key (user_low, user_high),
  constraint ordered_pair check (user_low < user_high)
);

create index friendships_high_idx on public.friendships (user_high);

-- ---------------------------------------------------------------------------
-- Pokes.
--
-- App Spec §9 leaves the mechanic undecided and recommends starting with
-- option 1 — a plain notification — plus option 4, a hard cap. That is what
-- this is: the spec's own recommendation, not a guess, and swapping it for a
-- richer mechanic later touches only this table and one function.
--
-- The UNIQUE constraint is the cap: one poke per friend per run, forever. The
-- council's concern was a member accepting a friend out of politeness and then
-- being nudged repeatedly; a per-run cap plus unfriending bounds that.
-- ---------------------------------------------------------------------------
create table public.pokes (
  id          bigint generated always as identity primary key,
  from_user   uuid references public.profiles (id) on delete set null,
  to_user     uuid references public.profiles (id) on delete cascade,
  run_id      uuid not null references public.runs (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint one_poke_per_friend_per_run unique (from_user, to_user, run_id)
);

create index pokes_to_user_idx on public.pokes (to_user, created_at desc);

-- ---------------------------------------------------------------------------
-- Show my QR.
--
-- Reuses an unexpired token rather than minting one per render, so the code on
-- screen is stable while the member holds their phone out.
-- ---------------------------------------------------------------------------
create or replace function public.my_friend_qr()
returns table (token text, expires_at timestamptz)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user  uuid := auth.uid();
  v_token text;
  v_exp   timestamptz;
begin
  if v_user is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select t.token, t.expires_at into v_token, v_exp
  from public.friend_qr_tokens t
  where t.user_id = v_user
    and t.revoked_at is null
    and t.expires_at > now() + interval '20 seconds'
  order by t.expires_at desc
  limit 1;

  if v_token is null then
    -- 32 hex chars, 122 bits of entropy, from Postgres's own strong random
    -- source. Guessing one inside its three-minute life is not a practical
    -- attack, which matters because possession of a token is the entire
    -- authorisation to become someone's friend.
    --
    -- gen_random_uuid() rather than pgcrypto's gen_random_bytes(): the latter
    -- lives in the extensions schema on Supabase and is therefore invisible to
    -- a function with a pinned search_path, and pinning search_path is not
    -- negotiable in a SECURITY DEFINER function. Same randomness, no extension.
    v_token := replace(gen_random_uuid()::text, '-', '');
    v_exp   := now() + interval '3 minutes';

    insert into public.friend_qr_tokens (token, user_id, expires_at)
    values (v_token, v_user, v_exp);
  end if;

  return query select v_token, v_exp;
end;
$$;

-- ---------------------------------------------------------------------------
-- Invalidate every code I have ever shown (App Spec §8).
--
-- For the member who thinks their code was captured. Existing friendships are
-- untouched — this stops future adds, it does not undo past ones.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_my_friend_qr()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  update public.friend_qr_tokens
     set revoked_at = now()
   where user_id = auth.uid() and revoked_at is null;

  perform app_private.audit('revoke_friend_qr', 'friend_qr_tokens', auth.uid()::text, '{}'::jsonb);
end;
$$;

-- ---------------------------------------------------------------------------
-- Add a friend by scanning their code.
--
-- Auto-accepted, per §4.4 — there is no request to approve, because the
-- approval already happened physically when they chose to show you the code.
--
-- The token is single-use: without that, one screenshot taken over a shoulder
-- during the 3-minute window could be used repeatedly.
-- ---------------------------------------------------------------------------
create or replace function public.add_friend_by_token(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_owner  uuid;
  v_low    uuid;
  v_high   uuid;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  select t.user_id into v_owner
  from public.friend_qr_tokens t
  where t.token = p_token
    and t.revoked_at is null
    and t.expires_at > now()
  for update;

  if v_owner is null then
    -- Deliberately one message for expired, revoked and never-existed. A
    -- distinct "no such code" would let someone probe for valid tokens.
    raise exception 'that code is not valid any more — ask them to show it again'
      using errcode = 'check_violation';
  end if;

  if v_owner = v_me then
    raise exception 'that is your own code' using errcode = 'check_violation';
  end if;

  -- Burn the token. One scan, one friendship.
  update public.friend_qr_tokens set revoked_at = now() where token = p_token;

  v_low  := least(v_me, v_owner);
  v_high := greatest(v_me, v_owner);

  insert into public.friendships (user_low, user_high, initiated_by)
  values (v_low, v_high, v_me)
  on conflict (user_low, user_high) do nothing;

  return v_owner;
end;
$$;

-- ---------------------------------------------------------------------------
-- Unfriend.
--
-- Deliberately unilateral and immediate, with no notification to the other
-- side. The council raised that people accept out of politeness and then feel
-- unable to withdraw; a removal that pings the other person is one nobody
-- socially awkward will ever use.
-- ---------------------------------------------------------------------------
create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.friendships
   where user_low = least(v_me, p_friend_id)
     and user_high = greatest(v_me, p_friend_id);

  -- Drop any pending pokes in both directions, so removing someone actually
  -- stops the nudges rather than leaving one queued.
  delete from public.pokes
   where (from_user = v_me and to_user = p_friend_id)
      or (from_user = p_friend_id and to_user = v_me);
end;
$$;

-- ---------------------------------------------------------------------------
-- My friends, and whether they are coming to the next run.
--
-- The one place a member sees another member's name outside the leaderboard,
-- and it is scoped hard: name, avatar, and a single in/out flag for ONE
-- upcoming run. No history, no points, no per-run log.
--
-- The council warned that a friends list is "a leaderboard at n=2" if it
-- carries stats. It deliberately carries none.
-- ---------------------------------------------------------------------------
create or replace function public.my_friends(p_run_id uuid default null)
returns table (
  friend_id    uuid,
  display_name text,
  avatar_url   text,
  state        public.attendance_state,
  friends_since timestamptz,
  -- Whether I have already nudged this friend about this run. Returned rather
  -- than left to the client to work out, because the alternative is a Nudge
  -- button that looks available and then errors — the cap is a rule, so the UI
  -- has to be able to see it.
  already_poked boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_me  uuid := auth.uid();
  v_run uuid;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  -- Default to the next published run, which is what the friends list is for.
  v_run := coalesce(p_run_id, (
    select r.id from public.runs r
    where r.status = 'published' and r.starts_at > now()
    order by r.starts_at
    limit 1
  ));

  return query
  select
    p.id, p.display_name, p.avatar_url,
    case when a.id is null then null
         else public.attendance_state(a.signed_up_at, a.checked_in_at, a.withdrawn_at)
    end,
    f.created_at,
    exists (
      select 1 from public.pokes pk
      where pk.from_user = v_me and pk.to_user = p.id and pk.run_id = v_run
    )
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_low = v_me then f.user_high else f.user_low end
  left join public.run_attendance a
    on a.user_id = p.id and a.run_id = v_run
  where f.user_low = v_me or f.user_high = v_me
  order by p.display_name;
end;
$$;

-- ---------------------------------------------------------------------------
-- Poke a friend about a run.
-- ---------------------------------------------------------------------------
create or replace function public.poke_friend(p_friend_id uuid, p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_run  public.runs;
  v_name text;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.friendships
    where user_low = least(v_me, p_friend_id)
      and user_high = greatest(v_me, p_friend_id)
  ) then
    -- Friendship is the authorisation. Without this check the poke becomes a
    -- way to message any member whose id you can obtain — precisely the
    -- unsolicited contact §4.4 exists to prevent.
    raise exception 'you can only nudge someone you have added as a friend'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_run from public.runs where id = p_run_id;
  if not found or v_run.status <> 'published' or v_run.starts_at <= now() then
    raise exception 'you can only nudge someone about an upcoming run'
      using errcode = 'check_violation';
  end if;

  insert into public.pokes (from_user, to_user, run_id)
  values (v_me, p_friend_id, p_run_id);
  -- No ON CONFLICT: a second attempt should tell the member they already did
  -- it, not silently do nothing and look broken.
  exception when unique_violation then
    raise exception 'you have already nudged them about this run'
      using errcode = 'check_violation';
end;
$$;

-- ---------------------------------------------------------------------------
-- Access rules
--
-- No table here is directly readable. Every read goes through a SECURITY
-- DEFINER function that scopes exactly what leaves the database — otherwise a
-- member could select the friendships table and map the club's whole social
-- graph, which is a directory by another name.
-- ---------------------------------------------------------------------------
alter table public.friend_qr_tokens enable row level security;
alter table public.friendships      enable row level security;
alter table public.pokes            enable row level security;

-- friend_qr_tokens and friendships get no SELECT policy at all: RLS denies by
-- default, and the functions above are the only way in.
--
-- Pokes are the exception, and only for the two people involved. The sender is
-- included deliberately: without it a member cannot see that their own nudge
-- landed, and "did that work?" is exactly the question a silent one-shot action
-- provokes.
create policy pokes_select_own on public.pokes
  for select to authenticated
  using (to_user = auth.uid() or from_user = auth.uid());

revoke all on public.friend_qr_tokens from authenticated;
revoke all on public.friendships      from authenticated;
revoke insert, update, delete on public.pokes from authenticated;
grant select on public.pokes to authenticated;

grant select, insert, update, delete on public.friend_qr_tokens to service_role;
grant select, insert, update, delete on public.friendships      to service_role;
grant select, insert, update, delete on public.pokes            to service_role;

grant execute on function public.my_friend_qr()                 to authenticated;
grant execute on function public.revoke_my_friend_qr()          to authenticated;
grant execute on function public.add_friend_by_token(text)      to authenticated;
grant execute on function public.remove_friend(uuid)            to authenticated;
grant execute on function public.my_friends(uuid)               to authenticated;
grant execute on function public.poke_friend(uuid, uuid)        to authenticated;

-- ---------------------------------------------------------------------------
-- Moderation (App Spec §7): an organiser can kill a member's QR code if abuse
-- is reported, without touching their account or their existing friendships.
-- ---------------------------------------------------------------------------
create or replace function public.admin_disable_member_qr(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.friend_qr_tokens
     set revoked_at = now()
   where user_id = p_user_id and revoked_at is null;

  perform app_private.audit('disable_member_qr', 'friend_qr_tokens', p_user_id::text, '{}'::jsonb);
end;
$$;

grant execute on function public.admin_disable_member_qr(uuid) to authenticated;
