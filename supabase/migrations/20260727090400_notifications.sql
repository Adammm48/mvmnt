-- ============================================================================
-- 0005 · Push tokens and the notification pipeline
--
-- Two tables, not one: a single event fans out to N devices. That split is what
-- makes per-device failure logging (Principles §7) and retry possible.
--
-- Phase 1 has no APNs/FCM credentials, so deliveries are written with
-- status 'logged' instead of being sent. The pipeline is real; only the final
-- HTTP call is absent. See docs/api.md.
-- ============================================================================

create table public.push_tokens (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade,
  expo_push_token text not null unique,
  platform        text not null check (platform in ('ios', 'android')),
  last_seen_at    timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

comment on table public.push_tokens is
  'Registered devices. Register via public.register_push_token(), which reassigns a token that has moved to a different account.';

create index push_tokens_user_idx on public.push_tokens (user_id);

-- ---------------------------------------------------------------------------
-- Registering a device.
--
-- The ON CONFLICT clause is the point of this function. Expo issues a token per
-- device install, and a device can change hands — someone sells a phone, a
-- family member inherits it, two people share a tablet. Without reassigning
-- user_id on conflict, the new owner receives the previous owner's
-- notifications: a disclosure of personal data, not merely a bug.
-- ---------------------------------------------------------------------------
create or replace function public.register_push_token(
  p_token    text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'unsupported platform: %', p_platform using errcode = 'check_violation';
  end if;

  insert into public.push_tokens (user_id, expo_push_token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (expo_push_token) do update
    set user_id      = excluded.user_id,
        platform     = excluded.platform,
        last_seen_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Notification events — one row per thing that happened.
-- ---------------------------------------------------------------------------
create table public.notification_events (
  id             uuid primary key default gen_random_uuid(),
  type           public.notification_type not null,
  audience       public.notification_audience not null,
  run_id         uuid references public.runs (id)     on delete cascade,
  target_user_id uuid references public.profiles (id) on delete cascade,

  -- THE idempotency key. Without it, one retry of the scheduler re-enqueues an
  -- event and every member is pushed twice — 2,500 duplicates at a large event
  -- from a single retry. Enqueueing is a no-op on conflict.
  --
  -- Shape: 'run:<uuid>:reminder_morning_of'
  --        'run:<uuid>:waitlist_promoted:<user uuid>'   (per-member events)
  dedupe_key     text not null unique,

  -- Copy is rendered once, here, at enqueue time (Principles §2). The delivery
  -- worker does no formatting, so notification wording exists in exactly one
  -- place rather than being reimplemented in the app, the console and the
  -- Edge Function.
  title          text not null,
  body           text not null,

  scheduled_for  timestamptz not null default now(),
  processed_at   timestamptz,

  created_by     uuid references public.profiles (id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint single_user_has_target
    check (audience <> 'single_user' or target_user_id is not null),
  constraint run_scoped_has_run
    check (audience = 'all_members' or audience = 'single_user' or run_id is not null)
);

comment on column public.notification_events.dedupe_key is
  'Unique. Makes enqueueing idempotent so a scheduler retry cannot double-push. See ADR 0001.';

-- The scheduler's only query: what is due and not yet processed?
create index notification_events_due_idx
  on public.notification_events (scheduled_for)
  where processed_at is null;

-- ---------------------------------------------------------------------------
-- Deliveries — one row per device per event.
-- ---------------------------------------------------------------------------
create table public.notification_deliveries (
  id           bigint generated always as identity primary key,
  event_id     uuid not null references public.notification_events (id) on delete cascade,
  user_id      uuid references public.profiles (id) on delete set null,
  push_token   text not null,

  status       public.delivery_status not null default 'pending',
  error        text,
  attempts     integer not null default 0,
  sent_at      timestamptz,
  created_at   timestamptz not null default now(),

  -- Second half of the idempotency story: a device is written at most once per
  -- event, so re-running fan-out cannot duplicate sends.
  constraint one_delivery_per_device_per_event unique (event_id, push_token)
);

comment on table public.notification_deliveries is
  'Per-device delivery attempt. Phase 1 writes status=''logged'' rather than sending — see docs/api.md.';

create index notification_deliveries_pending_idx
  on public.notification_deliveries (event_id)
  where status = 'pending';

create index notification_deliveries_user_idx
  on public.notification_deliveries (user_id, created_at desc);
