-- ============================================================================
-- 0003 · Runs
--
-- Route polyline is Phase 4 and is not modelled here (ADR 0001).
-- ============================================================================

create table public.runs (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  description         text,

  starts_at           timestamptz not null,
  -- Nullable: the admin may not know the finish time when publishing. The
  -- "run ended" notification only fires automatically when this is set;
  -- otherwise an admin ends the run manually. See ADR 0001.
  ends_at             timestamptz,

  meeting_point_name  text not null,
  meeting_point_lat   double precision not null,
  meeting_point_lng   double precision not null,

  -- How close a member must be for the app to offer check-in. Per-run because a
  -- 2,500-person event spreads over a much larger area than a weekly 6K.
  check_in_radius_m   integer not null default 250,

  distance_meters     integer,
  pace_groups         text[] not null default '{}',

  -- NULL means unlimited, which is the normal case for this club. A waitlist
  -- only exists when an admin sets a number.
  capacity            integer,

  status              public.run_status not null default 'draft',
  published_at        timestamptz,
  cancelled_at        timestamptz,
  cancellation_reason text,

  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint title_length          check (char_length(trim(title)) between 1 and 120),
  constraint capacity_positive     check (capacity is null or capacity > 0),
  constraint radius_sane           check (check_in_radius_m between 25 and 5000),
  constraint distance_positive     check (distance_meters is null or distance_meters > 0),
  constraint ends_after_starts     check (ends_at is null or ends_at > starts_at),
  constraint lat_in_range          check (meeting_point_lat between -90 and 90),
  constraint lng_in_range          check (meeting_point_lng between -180 and 180),
  constraint published_has_time    check (status <> 'published' or published_at is not null),
  constraint cancelled_has_time    check (status <> 'cancelled' or cancelled_at is not null)
);

comment on table public.runs is
  'A scheduled run. Draft runs are invisible to members — see RLS in 0009.';
comment on column public.runs.capacity is
  'NULL = unlimited (the default). When set, joins beyond it go to the waitlist.';
comment on column public.runs.check_in_radius_m is
  'Geofence radius. Validated server-side in public.check_in(); the client never decides whether it is in range.';

create trigger runs_touch_updated_at
  before update on public.runs
  for each row execute function app_private.touch_updated_at();

-- The home screen's only query: upcoming published runs, soonest first.
create index runs_upcoming_idx
  on public.runs (starts_at)
  where status in ('published', 'in_progress');

-- Used by the scheduler sweeping for runs due to start, end, or be reminded about.
create index runs_status_starts_at_idx on public.runs (status, starts_at);
