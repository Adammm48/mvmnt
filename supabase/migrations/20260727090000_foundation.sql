-- ============================================================================
-- 0001 · Foundation: private schema, enums, shared helpers
--
-- app_private holds anything that must never be reachable over PostgREST.
-- Nothing in it is granted to anon or authenticated; SECURITY DEFINER functions
-- in public reach into it, and that is the only path in.
-- ============================================================================

create schema if not exists app_private;
revoke all on schema app_private from public;

-- ---------------------------------------------------------------------------
-- Enums
--
-- Enums rather than text + CHECK: an invalid value becomes impossible rather
-- than merely rejected, and the admin console can read the allowed values off
-- the type instead of hard-coding a second copy of the list (Principles §2).
-- ---------------------------------------------------------------------------

create type public.member_role as enum ('member', 'admin');

create type public.run_status as enum (
  'draft',        -- admin is still editing; invisible to members
  'published',    -- visible, open for sign-up
  'in_progress',  -- started
  'completed',    -- finished
  'cancelled'     -- called off; stays visible so members find out why
);

-- How a check-in was recorded. Phase 1 ships 'geofence' and 'admin'.
-- 'qr' exists now so that adding a QR factor in Phase 2 (see ADR 0002) is a
-- server-side change and not a migration against live attendance data.
create type public.check_in_method as enum ('geofence', 'qr', 'admin');

create type public.notification_type as enum (
  'run_published',
  'reminder_evening_before',
  'reminder_morning_of',
  'run_started',
  'run_ended',
  'waitlist_promoted'
);

create type public.notification_audience as enum (
  'all_members',
  'run_signed_up',   -- confirmed attendees of one run (not the waitlist)
  'run_checked_in',
  'single_user'
);

create type public.delivery_status as enum (
  'pending',  -- queued, not yet attempted
  'logged',   -- Phase 1: recorded instead of sent (no APNs/FCM credentials yet)
  'sent',
  'failed',
  'skipped'   -- e.g. member has no registered device
);

-- ---------------------------------------------------------------------------
-- Distance
--
-- Haversine rather than PostGIS. PostGIS is a large dependency to carry for a
-- single great-circle distance between two points a few hundred metres apart,
-- and every Principles §1 test ("does this dependency justify itself?") fails
-- here. If Phase 4 route drawing needs real geometry operations, revisit —
-- that is a genuine PostGIS use case and this function is trivial to drop.
--
-- Accurate to well under a metre at these distances, which is far below GPS
-- error, so the approximation is invisible in practice.
-- ---------------------------------------------------------------------------
create or replace function app_private.distance_meters(
  lat_a double precision,
  lng_a double precision,
  lat_b double precision,
  lng_b double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 6371000.0 * 2 * asin(sqrt(
      power(sin(radians(lat_b - lat_a) / 2), 2)
    + cos(radians(lat_a)) * cos(radians(lat_b))
    * power(sin(radians(lng_b - lng_a) / 2), 2)
  ));
$$;

comment on function app_private.distance_meters is
  'Great-circle distance in metres. Used server-side to re-derive check-in distance; the client''s own distance claim is never trusted.';

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Guard: block UPDATEs to a column that must never change after insert.
-- Used for run_attendance.queued_at, the waitlist FIFO key. See ADR 0001 —
-- promotion silently overwriting this key was the bug the council caught, so
-- it is enforced by the database rather than by remembering not to do it.
-- ---------------------------------------------------------------------------
create or replace function app_private.freeze_queued_at()
returns trigger
language plpgsql
as $$
begin
  -- A genuine re-join out of the withdrawn state is allowed to take a fresh
  -- queue position (going to the back, which is the fair outcome). Every other
  -- transition must leave queued_at alone.
  if new.queued_at is distinct from old.queued_at
     and not (old.withdrawn_at is not null and new.withdrawn_at is null) then
    raise exception
      'queued_at is immutable except on re-join; attempted % -> % on attendance %',
      old.queued_at, new.queued_at, old.id
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The club's timezone.
--
-- A function rather than a literal repeated across notification copy and
-- reminder scheduling: those two must never disagree, and a club that moves or
-- runs a second city should be a one-line change (Principles §2).
--
-- Runs happen at a physical meeting point in one place. Times are rendered and
-- scheduled here, not in the member's device timezone — a member travelling
-- abroad should still read "07:00", not their local equivalent.
-- ---------------------------------------------------------------------------
create or replace function app_private.club_timezone()
returns text
language sql
immutable
parallel safe
as $$ select 'Africa/Cairo'::text $$;
