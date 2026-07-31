-- An optional link the organiser can paste for the meeting point.
--
-- The default remains DERIVED from meeting_point_lat/lng (see
-- packages/shared/src/runs.ts): the pin already exists, it is not null, and
-- the check-in geofence is measured from it. This column exists for the case
-- the pin cannot express — a Google Maps *place*, which names the destination
-- and can point at a specific gate or entrance rather than a bare coordinate.
--
-- IT IS NAVIGATION ONLY. check_in() reads meeting_point_lat/lng and nothing
-- here; a link pointing somewhere else changes where members are sent, never
-- where they may check in. That asymmetry is deliberate and the reason this
-- column is safe to add: the two values may disagree, but only one of them
-- decides anything.

alter table public.runs
  add column maps_url text;

comment on column public.runs.maps_url is
  'Optional link for directions to the meeting point. Overrides the link '
  'derived from meeting_point_lat/lng for NAVIGATION ONLY — check-in is '
  'always measured from the coordinates.';

-- A pasted value is the one field here typed by hand from another app, so it
-- is the one most likely to arrive as "google.com/maps..." with no scheme, or
-- as a stray word. https only: a maps link is always https, and anything that
-- is not a URL would open nothing on the member's phone — the silent-failure
-- shape this project keeps designing out.
alter table public.runs
  add constraint maps_url_is_https
  check (maps_url is null or maps_url ~ '^https://[^ ]+$');
