-- ============================================================================
-- 0037 · Routes
--
-- App Spec §4.7: an organiser draws the route on a map in the console and
-- publishes it per run. No external GPX, no third-party route service — the
-- club draws what it actually runs.
--
-- STORED AS JSONB, NOT POSTGIS
--
-- Same call as the check-in distance calculation in migration 0001, for the
-- same reason (Principles §1: every dependency needs a justification). PostGIS
-- would buy spatial indexing, containment queries and projection handling —
-- none of which this needs. A route here is drawn once, read whole, and drawn
-- on a map. Nothing ever asks "which routes pass within 200m of this point".
--
-- If Phase 5 ever wants route matching against a member's GPS trace, that is
-- the moment PostGIS earns its place. Adding it then is a migration; carrying
-- it now is a dependency nobody is using.
--
-- The shape is a bare array of [lng, lat] pairs — GeoJSON's ordering, so if
-- this ever does become a geometry the coordinates are already the right way
-- round. Getting that backwards is the classic mapping bug, and it renders as
-- a route somewhere off the coast of Somalia.
-- ============================================================================

alter table public.runs
  add column route jsonb,
  -- Set when the route is published, which is a separate act from drawing it:
  -- an organiser sketching a route on Tuesday should not notify the club.
  add column route_published_at timestamptz;

comment on column public.runs.route is
  'An array of [lng, lat] pairs — GeoJSON coordinate order. Plain JSONB rather than PostGIS: a route is drawn once and read whole, and nothing asks a spatial question of it. See migration 0037.';

-- A route that is not a list of coordinate pairs is a route that will crash a
-- map renderer, and the crash will happen on a member's phone rather than here.
alter table public.runs
  add constraint route_is_coordinate_array check (
    route is null
    or (jsonb_typeof(route) = 'array' and jsonb_array_length(route) >= 2)
  );

-- ---------------------------------------------------------------------------
-- Drawing it.
--
-- Validates every point server-side. The console sends what the organiser drew,
-- and a dragged-off-the-map click or a transposed pair would otherwise be
-- stored happily and fail later, somewhere less obvious.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_route(
  p_run_id uuid,
  p_route  jsonb
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_point jsonb;
  v_lng   numeric;
  v_lat   numeric;
  v_count integer;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  -- Clearing a route is a legitimate act, not an error.
  if p_route is null or jsonb_array_length(p_route) = 0 then
    update public.runs set route = null, route_published_at = null where id = p_run_id;
    perform app_private.audit('clear_route', 'runs', p_run_id::text, '{}'::jsonb);
    return;
  end if;

  if jsonb_typeof(p_route) <> 'array' then
    raise exception 'a route must be a list of points' using errcode = 'check_violation';
  end if;

  v_count := jsonb_array_length(p_route);
  if v_count < 2 then
    raise exception 'a route needs at least two points' using errcode = 'check_violation';
  end if;
  -- A generous ceiling. Leaflet hands back a point per click, so a hand-drawn
  -- route is tens of points; anything near this is a bug or a paste.
  if v_count > 5000 then
    raise exception 'that route has too many points — simplify it'
      using errcode = 'check_violation';
  end if;

  for v_point in select * from jsonb_array_elements(p_route) loop
    if jsonb_typeof(v_point) <> 'array' or jsonb_array_length(v_point) <> 2 then
      raise exception 'every point must be a [longitude, latitude] pair'
        using errcode = 'check_violation';
    end if;

    v_lng := (v_point->>0)::numeric;
    v_lat := (v_point->>1)::numeric;

    -- Range-checked in the right order. Latitude beyond ±90 is the signature of
    -- a transposed pair, and catching it here means it never reaches a phone.
    if v_lng < -180 or v_lng > 180 or v_lat < -90 or v_lat > 90 then
      raise exception 'a point is off the map — coordinates must be [longitude, latitude]'
        using errcode = 'check_violation';
    end if;
  end loop;

  update public.runs set route = p_route where id = p_run_id;

  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;

  perform app_private.audit('set_route', 'runs', p_run_id::text,
                            jsonb_build_object('points', v_count));
end;
$$;

-- ---------------------------------------------------------------------------
-- Publishing it.
--
-- Separate from drawing, and it notifies the people who signed up (App Spec §6:
-- "The route for Saturday's run is live"). Drawing is drafting; publishing is
-- telling three hundred people, and conflating the two means every correction
-- pings the club again.
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_route(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run   public.runs;
  v_event uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select * into v_run from public.runs where id = p_run_id;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;
  if v_run.route is null then
    raise exception 'draw the route before publishing it' using errcode = 'check_violation';
  end if;
  if v_run.status = 'draft' then
    raise exception 'publish the run itself first' using errcode = 'check_violation';
  end if;

  update public.runs set route_published_at = now() where id = p_run_id;

  -- Idempotent by the usual dedupe key, so re-publishing a corrected route does
  -- not notify twice. If the club genuinely wants to re-announce, that is a
  -- deliberate message rather than an accident of pressing save again.
  v_event := app_private.enqueue_notification(
    p_type        => 'route_published',
    p_audience    => 'run_signed_up',
    p_run_id      => p_run_id
  );

  perform app_private.audit('publish_route', 'runs', p_run_id::text, '{}'::jsonb);
  return v_event;
end;
$$;

grant execute on function public.admin_set_route(uuid, jsonb) to authenticated;
grant execute on function public.admin_publish_route(uuid)    to authenticated;
