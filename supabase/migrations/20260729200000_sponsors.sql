-- ============================================================================
-- 0031 · Sponsors, placements, and numbers a sponsor can trust
--
-- App Spec §4.5. Sponsors are the one part of this app where the numbers leave
-- the club and become the basis of a commercial conversation — "you reached
-- 280 members last month" is a claim MVMNT will be held to. So the measurement
-- design matters more than the schema does.
--
-- HOW IMPRESSIONS ARE COUNTED, AND WHY IT IS NOT WHAT ADTECH MEANS
--
-- The obvious implementation — the app posts an event every time a banner
-- renders — produces a number nobody should believe. It counts one member
-- opening the app eight times as eight people, it inflates the moment anyone
-- adds a scroll listener, and a client can trivially send a million of them.
--
-- So a placement counts **one impression per member per day**, enforced by a
-- primary key rather than by the client behaving. What that measures is
-- *reach*: how many distinct members actually saw this sponsor on a given day.
-- It is a smaller number than an adtech impression count and a far more
-- defensible one, and MVMNT can put it in front of a sponsor without having to
-- explain it away.
--
-- Taps are counted per event, because a member tapping twice genuinely is two
-- taps and there is no incentive to inflate a number that makes engagement
-- look artificially high per impression.
--
-- STORAGE
--
-- Rolled up daily rather than kept as raw events. At 300 members and a handful
-- of placements this is a few hundred rows a year instead of hundreds of
-- thousands, and no reporting query ever has to aggregate a large table
-- (Principles §6). The cost is that per-hour breakdowns are impossible — which
-- nothing in App Spec §4.5 asks for.
-- ============================================================================

create type public.placement_type as enum (
  'home_banner',   -- the strip on the home screen
  'run_badge',     -- "presented by" on a specific run
  'push_mention'   -- a line inside a notification the club was already sending
);

create table public.sponsors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  logo_url    text,
  url         text,
  -- The date range is the whole lifecycle. A sponsor is not deleted when their
  -- deal ends — the reporting for the period they paid for has to survive, and
  -- so does the record that their logo was shown on a given run.
  active_from date not null default current_date,
  active_to   date,
  created_at  timestamptz not null default now(),
  created_by  uuid references public.profiles (id) on delete set null,

  constraint sponsor_name_present check (char_length(trim(name)) between 1 and 120),
  constraint sponsor_dates_ordered check (active_to is null or active_to >= active_from)
);

comment on table public.sponsors is
  'A sponsor and the window they are paid up for. Never deleted once they have run — the reporting and the historical record of which runs carried their badge both depend on the row surviving.';

create table public.sponsor_placements (
  id          uuid primary key default gen_random_uuid(),
  sponsor_id  uuid not null references public.sponsors (id) on delete cascade,
  type        public.placement_type not null,
  -- Null for a home banner (it is club-wide); required for a run badge, which
  -- is by definition attached to one run.
  run_id      uuid references public.runs (id) on delete cascade,
  created_at  timestamptz not null default now(),

  constraint run_badge_has_run
    check (type <> 'run_badge' or run_id is not null),
  -- One placement of a given type per sponsor per run. Two identical banners
  -- would double every number in the report.
  constraint one_placement_per_sponsor_per_slot
    unique nulls not distinct (sponsor_id, type, run_id)
);

create index sponsor_placements_run_idx on public.sponsor_placements (run_id);

-- ---------------------------------------------------------------------------
-- The daily rollup.
--
-- The primary key is the whole anti-inflation mechanism: (placement, member,
-- day) can exist at most once, so recording an impression is an INSERT that
-- either happens or silently does not. There is no code path, client or
-- server, that can count the same member twice on the same day.
-- ---------------------------------------------------------------------------
create table public.sponsor_impressions (
  placement_id uuid not null references public.sponsor_placements (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  seen_on      date not null,
  -- Taps are the exception to one-per-day: a member tapping through twice is
  -- two taps, and there is no reason for anyone to want that number inflated.
  taps         integer not null default 0,

  primary key (placement_id, user_id, seen_on)
);

create index sponsor_impressions_day_idx on public.sponsor_impressions (seen_on);

comment on table public.sponsor_impressions is
  'One row per member per placement per day. The primary key is the point: reach cannot be inflated by a client, or by the same member opening the app repeatedly. See migration 0031.';

-- ---------------------------------------------------------------------------
-- What the app shows.
--
-- Returns only placements whose sponsor is inside their paid window, so an
-- expired deal disappears on its end date without anybody remembering to take
-- the banner down.
-- ---------------------------------------------------------------------------
create or replace function public.active_placements(p_run_id uuid default null)
returns table (
  placement_id uuid,
  sponsor_id   uuid,
  type         public.placement_type,
  name         text,
  logo_url     text,
  url          text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.id, s.id, p.type, s.name, s.logo_url, s.url
  from public.sponsor_placements p
  join public.sponsors s on s.id = p.sponsor_id
  where current_date >= s.active_from
    and (s.active_to is null or current_date <= s.active_to)
    and (
      -- Home banners are club-wide; run badges only for the run asked about.
      (p.type = 'home_banner' and p_run_id is null)
      or (p.run_id = p_run_id)
    )
  order by p.type, s.name;
$$;

-- ---------------------------------------------------------------------------
-- Recording that somebody saw it.
--
-- Deliberately cheap and deliberately unfailable: a sponsor metric must never
-- be the reason a member's home screen errors. It writes one row or does
-- nothing, and returns nothing either way.
-- ---------------------------------------------------------------------------
create or replace function public.record_placement_seen(p_placement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.sponsor_impressions (placement_id, user_id, seen_on)
  values (p_placement_id, auth.uid(), (now() at time zone app_private.club_timezone())::date)
  -- Already seen today. This is the normal case, not an error.
  on conflict (placement_id, user_id, seen_on) do nothing;
exception when foreign_key_violation then
  -- A placement removed while somebody had the screen open. Not worth an error
  -- on the member's device.
  return;
end;
$$;

create or replace function public.record_placement_tap(p_placement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    return;
  end if;

  insert into public.sponsor_impressions (placement_id, user_id, seen_on, taps)
  values (p_placement_id, auth.uid(), (now() at time zone app_private.club_timezone())::date, 1)
  on conflict (placement_id, user_id, seen_on)
    -- A tap implies a view, so this doubles as the impression if the render
    -- somehow was not recorded.
    do update set taps = public.sponsor_impressions.taps + 1;
exception when foreign_key_violation then
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- The report an organiser sends a sponsor.
--
-- Organiser-only. The numbers are about the club's members in aggregate, and
-- no member is identifiable in the output — a sponsor learns how many people
-- saw them, never who.
-- ---------------------------------------------------------------------------
create or replace function public.admin_sponsor_report(
  p_sponsor_id uuid default null,
  p_from       date default null,
  p_to         date default null
)
returns table (
  sponsor_id   uuid,
  sponsor_name text,
  placement_id uuid,
  type         public.placement_type,
  run_title    text,
  run_date     timestamptz,
  reach        integer,
  taps         integer,
  first_seen   date,
  last_seen    date
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
    s.id, s.name, p.id, p.type, r.title, r.starts_at,
    -- Reach is the count of distinct members, which is what the row grain
    -- already guarantees — one row per member per day. Summing rows would
    -- count a member who saw it on five days as five people.
    count(distinct i.user_id)::integer,
    coalesce(sum(i.taps), 0)::integer,
    min(i.seen_on),
    max(i.seen_on)
  from public.sponsor_placements p
  join public.sponsors s on s.id = p.sponsor_id
  left join public.runs r on r.id = p.run_id
  left join public.sponsor_impressions i
    on i.placement_id = p.id
   and (p_from is null or i.seen_on >= p_from)
   and (p_to   is null or i.seen_on <= p_to)
  where p_sponsor_id is null or s.id = p_sponsor_id
  group by s.id, s.name, p.id, p.type, r.title, r.starts_at
  order by s.name, p.type;
end;
$$;

comment on function public.admin_sponsor_report is
  'Reach (distinct members) and taps per placement. Reach is deliberately not an adtech impression count — see migration 0031 for why the smaller, defensible number is the right one to hand a sponsor.';

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------
alter table public.sponsors            enable row level security;
alter table public.sponsor_placements  enable row level security;
alter table public.sponsor_impressions enable row level security;

-- Members read sponsors and placements through active_placements(), but the
-- tables are readable too: a sponsor's name and logo are public-facing by
-- definition, and there is nothing to protect.
create policy sponsors_select_all on public.sponsors
  for select to authenticated using (true);

create policy sponsors_admin_write on public.sponsors
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy placements_select_all on public.sponsor_placements
  for select to authenticated using (true);

create policy placements_admin_write on public.sponsor_placements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Impressions are the exception. A member may not read them at all: the table
-- says which members saw which sponsor on which day, which is a behavioural
-- profile and nobody's business but the club's.
create policy impressions_admin_only on public.sponsor_impressions
  for select to authenticated using (public.is_admin());

revoke insert, update, delete on public.sponsor_impressions from authenticated;
grant select on public.sponsors            to authenticated;
grant select on public.sponsor_placements  to authenticated;
grant select on public.sponsor_impressions to authenticated;
grant insert, update, delete on public.sponsors           to authenticated;
grant insert, update, delete on public.sponsor_placements to authenticated;

grant select, insert, update, delete on public.sponsors            to service_role;
grant select, insert, update, delete on public.sponsor_placements  to service_role;
grant select, insert, update, delete on public.sponsor_impressions to service_role;

grant execute on function public.active_placements(uuid)                    to authenticated;
grant execute on function public.record_placement_seen(uuid)                to authenticated;
grant execute on function public.record_placement_tap(uuid)                 to authenticated;
grant execute on function public.admin_sponsor_report(uuid, date, date)     to authenticated;
