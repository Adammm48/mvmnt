-- ============================================================================
-- 0002 · Profiles
--
-- One row per member, keyed by auth.users.id. Deliberately minimal: no points,
-- tier, or personal QR code — those arrive with Phase 2 (ADR 0001).
-- ============================================================================

create table public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text not null,
  avatar_url    text,
  role          public.member_role not null default 'member',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint display_name_length check (char_length(trim(display_name)) between 1 and 60)
);

comment on table public.profiles is
  'Member profile. Row is created automatically on sign-up by app_private.handle_new_user().';
comment on column public.profiles.role is
  'Authorisation is read from here, never from a client-supplied claim. Only an existing admin can change it (see RLS).';

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function app_private.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Admin check
--
-- SECURITY DEFINER on purpose: RLS policies on `profiles` need to ask "is the
-- caller an admin?", which reads `profiles`. Without DEFINER that recurses into
-- the very policy being evaluated. DEFINER runs it as the owner, bypassing RLS
-- for this one narrow read.
--
-- search_path is pinned. A SECURITY DEFINER function with a mutable search_path
-- is a privilege-escalation hole: a caller could create their own `profiles`
-- table in a schema earlier on the path and have this function read that
-- instead.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = uid and p.role = 'admin'
  );
$$;

comment on function public.is_admin is
  'True if the given user (default: the caller) is an admin. The single source of truth for authorisation — mobile app, admin console and every RPC ask this, none of them decide for themselves (Principles §2).';

-- ---------------------------------------------------------------------------
-- Auto-create a profile on sign-up.
--
-- Without this, a user exists in auth.users with no profile row and every
-- policy that joins to profiles silently treats them as a non-member.
-- ---------------------------------------------------------------------------
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    -- Apple and Google supply a name in user_metadata; email OTP does not, so
    -- fall back to the local part of the address and let the member edit it.
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Runner'
    ),
    nullif(trim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();
