-- ============================================================================
-- 0027 · Reaching a tier is an event, not a calculation
--
-- The tier a member is in has always been derived — tier_for_points(total) — and
-- derived is right for "what are you now?". It cannot answer "did something just
-- happen?", which is what a celebration needs. Recomputing on every app launch
-- and comparing against a value cached on the device would miss the moment
-- entirely on a reinstall, fire twice across two phones, and fire wrongly the
-- first time somebody signs in on a new device.
--
-- So crossing a tier is recorded when it happens, once, server-side. The app
-- asks "is there anything I have not shown you yet?" and the answer does not
-- depend on what any particular device remembers.
--
-- FIRST TIME ONLY
--
-- Points can fall now (0025), so a member can drop out of a tier and climb back.
-- They do not get the chest again: the row is keyed on (user_id, tier) and the
-- insert does nothing on conflict. A reward you can farm by resting is not a
-- reward, and being congratulated for regaining ground you lost reads as
-- sarcasm.
-- ============================================================================

create table public.member_tier_reached (
  user_id         uuid not null references public.profiles (id) on delete cascade,
  tier            public.member_tier not null,
  reached_at      timestamptz not null default now(),
  -- Null until the member has actually been shown the celebration. Separate
  -- from reached_at because the two are genuinely different moments: somebody
  -- can cross a tier at 08:40 on a Saturday with their phone in a bag.
  acknowledged_at timestamptz,

  primary key (user_id, tier)
);

create index member_tier_reached_pending_idx
  on public.member_tier_reached (user_id)
  where acknowledged_at is null;

comment on table public.member_tier_reached is
  'The first time a member crossed into each tier. Recorded rather than derived so the app can celebrate the moment without depending on device state. See migration 0027.';

-- ---------------------------------------------------------------------------
-- Recorded from the ledger, because the ledger is the only thing that moves a
-- total. Every path that awards or deducts points goes through point_events —
-- check-ins, streak bonuses, organiser corrections, absence — so a trigger here
-- catches all of them, including ones that do not exist yet.
--
-- Rookie is skipped: everybody is Rookie from their first point, and a
-- celebration for arriving where you already were is noise. The ladder starts
-- being an achievement at Runner.
-- ---------------------------------------------------------------------------
create or replace function app_private.on_points_changed_record_tier()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tier public.member_tier;
begin
  if new.user_id is null then
    return new;
  end if;

  v_tier := public.tier_for_points(public.points_total(new.user_id));

  if v_tier = 'rookie' then
    return new;
  end if;

  -- Only ever upward.
  --
  -- Points fall now (0025), so a member sliding from Competitor back to Runner
  -- would otherwise "reach" Runner and be handed a chest congratulating them on
  -- a demotion. Enum values order by declaration, so this compares rungs.
  if exists (
    select 1 from public.member_tier_reached
    where user_id = new.user_id and tier >= v_tier
  ) then
    return new;
  end if;

  insert into public.member_tier_reached (user_id, tier, reached_at)
  values (new.user_id, v_tier, coalesce(new.awarded_at, now()))
  on conflict (user_id, tier) do nothing;

  return new;
end;
$$;

create trigger point_events_record_tier
  after insert on public.point_events
  for each row execute function app_private.on_points_changed_record_tier();

-- ---------------------------------------------------------------------------
-- What the app asks on launch.
--
-- Returns the reward text alongside the tier, so opening the chest is one round
-- trip rather than two — this fires the moment somebody checks in at a meeting
-- point, which is exactly where the signal is worst.
-- ---------------------------------------------------------------------------
create or replace function public.my_unclaimed_tiers()
returns table (
  tier           public.member_tier,
  reached_at     timestamptz,
  reward         text,
  is_placeholder boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select t.tier, t.reached_at,
         coalesce(r.reward, ''), coalesce(r.is_placeholder, true)
  from public.member_tier_reached t
  left join public.tier_rewards r on r.tier = t.tier
  where t.user_id = auth.uid()
    and t.acknowledged_at is null
  -- Oldest first: if somebody has been away and comes back past two rungs at
  -- once, they should see them in the order they earned them.
  order by t.reached_at;
$$;

create or replace function public.acknowledge_tier(p_tier public.member_tier)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  update public.member_tier_reached
     set acknowledged_at = now()
   where user_id = auth.uid() and tier = p_tier and acknowledged_at is null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access.
--
-- Own rows only. A member's tier history is theirs; the leaderboard already
-- publishes the one fact about it that is public.
-- ---------------------------------------------------------------------------
alter table public.member_tier_reached enable row level security;

create policy member_tier_reached_select_own on public.member_tier_reached
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.member_tier_reached from authenticated;
grant select on public.member_tier_reached to authenticated;
grant select, insert, update, delete on public.member_tier_reached to service_role;

grant execute on function public.my_unclaimed_tiers()                    to authenticated;
grant execute on function public.acknowledge_tier(public.member_tier)    to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill, acknowledged.
--
-- Everybody already has a tier from history that predates this table. Recording
-- those as unacknowledged would greet the whole club with a stack of chests on
-- the morning this ships, for tiers they reached months ago — the same mistake
-- the loyalty backfill in 0017 avoided with notifications.
-- ---------------------------------------------------------------------------
insert into public.member_tier_reached (user_id, tier, reached_at, acknowledged_at)
select p.id, public.tier_for_points(public.points_total(p.id)), now(), now()
from public.profiles p
where public.tier_for_points(public.points_total(p.id)) <> 'rookie'
on conflict (user_id, tier) do nothing;
