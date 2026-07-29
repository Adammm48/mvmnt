-- ============================================================================
-- 0026 · What each tier is actually worth
--
-- Owner decision, 2026-07-29: every tier carries a reward — a discount, a
-- shirt, something custom at Legend. The rewards themselves are not decided
-- yet, so this ships the placeholders and the means to change them.
--
-- A TABLE, NOT A CONSTANT
--
-- These will change: the club will trial one thing, a sponsor will offer
-- another, Legend's reward will be argued about for a month. Every one of those
-- is a text edit, and a text edit that needs a developer and an App Store review
-- is a text edit that does not happen. Same reasoning as the badge catalogue in
-- 0016 — an organiser can change this from the console and members see it
-- immediately.
--
-- The reward is a plain string on purpose. Nothing in the app redeems it,
-- validates it or knows what it means; it is a promise the club makes and
-- honours in person. When Phase 3 brings merch and payments there will be a
-- real question about whether these become entitlements the system enforces,
-- and that is a different table and a different decision.
-- ============================================================================

create table public.tier_rewards (
  tier        public.member_tier primary key,
  reward      text not null,
  -- Shown while the club is still deciding, so a member sees an honest "coming
  -- soon" rather than a placeholder that reads like a real offer.
  is_placeholder boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

comment on table public.tier_rewards is
  'What a member gets for reaching each tier. Free text — nothing in the app redeems it. Editable by organisers without a deploy.';

create trigger tier_rewards_touch_updated_at
  before update on public.tier_rewards
  for each row execute function app_private.touch_updated_at();

-- Placeholders. Written as the sort of thing the owner described so the screens
-- can be laid out and reviewed against realistic copy, and flagged as
-- placeholders so no member is promised something the club has not agreed.
insert into public.tier_rewards (tier, reward, is_placeholder) values
  ('rookie',     'A welcome from the club — the rest starts here', true),
  ('runner',     'A discount at the club shop',                     true),
  ('competitor', 'A free club shirt',                               true),
  ('elite',      'Priority place on capped runs',                   true),
  ('legend',     'A custom shirt with your name on it',             true);

-- ---------------------------------------------------------------------------
-- Access.
--
-- Every member reads all five. The ladder is only motivating if you can see
-- what is at the top of it, not just the rung above you.
-- ---------------------------------------------------------------------------
alter table public.tier_rewards enable row level security;

create policy tier_rewards_select_all on public.tier_rewards
  for select to authenticated
  using (true);

create policy tier_rewards_admin_write on public.tier_rewards
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.tier_rewards to authenticated;
grant insert, update, delete on public.tier_rewards to authenticated;
grant select, insert, update, delete on public.tier_rewards to service_role;

-- ---------------------------------------------------------------------------
-- Editing one, from the console.
--
-- Its own function rather than a bare UPDATE so the change is audited: a reward
-- is a promise to the whole club, and "who changed Legend to a keyring?" should
-- be answerable.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_tier_reward(
  p_tier   public.member_tier,
  p_reward text,
  p_is_placeholder boolean default false
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_reward is null or length(trim(p_reward)) = 0 then
    raise exception 'a tier needs to say what it is worth'
      using errcode = 'check_violation';
  end if;

  insert into public.tier_rewards (tier, reward, is_placeholder, updated_by)
  values (p_tier, trim(p_reward), p_is_placeholder, auth.uid())
  on conflict (tier) do update
    set reward = excluded.reward,
        is_placeholder = excluded.is_placeholder,
        updated_by = excluded.updated_by;

  perform app_private.audit('set_tier_reward', 'tier_rewards', p_tier::text,
                            jsonb_build_object('reward', trim(p_reward),
                                               'placeholder', p_is_placeholder));
end;
$$;

grant execute on function public.admin_set_tier_reward(public.member_tier, text, boolean) to authenticated;
