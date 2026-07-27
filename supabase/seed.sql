-- ============================================================================
-- Local development seed. Runs automatically after `supabase db reset`.
--
-- The shape matters more than the volume: every state the UI has to render
-- should exist here, so that empty states, waitlists and past runs are visible
-- without hand-crafting data each time.
--
-- NOT for production. Passwords are 'password123' for every account.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Accounts.
--
-- Inserting into auth.users directly is the documented way to seed a local
-- Supabase stack; the on_auth_user_created trigger creates each profile.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
select
  '00000000-0000-0000-0000-000000000000',
  ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  'authenticated', 'authenticated',
  case n when 1 then 'organiser@mvmnt.test' else 'runner' || n || '@mvmnt.test' end,
  crypt('password123', gen_salt('bf')),
  now(), now(), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('full_name',
    case n when 1 then 'Club Organiser' else 'Runner ' || n end)
from generate_series(1, 30) as n
on conflict (id) do nothing;

-- The first admin. In production this same statement is how the first admin is
-- created — run once against the project, then admins promote each other.
-- The role guard permits it precisely because there is no authenticated caller
-- here (see migration 0010).
update public.profiles
   set role = 'admin'
 where id = '00000000-0000-0000-0000-000000000001';

-- ---------------------------------------------------------------------------
-- Runs, covering every state the app has to render.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin  uuid := '00000000-0000-0000-0000-000000000001';
  v_soon   uuid;
  v_full   uuid;
  v_future uuid;
  v_past   uuid;
  v_draft  uuid;
  v_member uuid;
  n integer;
begin
  -- Starts in 20 minutes: check-in is open, so the check-in CTA is testable
  -- the moment the app loads.
  insert into public.runs (title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, distance_meters, pace_groups,
    description, created_by)
  values ('Saturday 6K', now() + interval '20 minutes', now() + interval '110 minutes',
    'Hyde Park Corner', 51.502700, -0.151900, 6000, array['easy','steady','quick'],
    'Our weekly 6K. All paces welcome — nobody gets left behind.', v_admin)
  returning id into v_soon;

  -- Capacity 5, so the waitlist and its promotion flow can be exercised.
  insert into public.runs (title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, distance_meters, capacity,
    pace_groups, description, created_by)
  values ('Track Session', now() + interval '3 days', now() + interval '3 days 1 hour',
    'Paddington Rec', 51.532200, -0.196500, 5000, 5, array['steady','quick'],
    'Intervals on the track. Limited places.', v_admin)
  returning id into v_full;

  insert into public.runs (title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, distance_meters, pace_groups,
    description, created_by)
  values ('Sunday Long Run', now() + interval '8 days', now() + interval '8 days 2 hours',
    'Battersea Park', 51.479100, -0.155700, 15000, array['easy','steady'],
    'Longer, slower, chattier.', v_admin)
  returning id into v_future;

  -- Already finished, with check-ins — gives the profile screen some history.
  insert into public.runs (title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, distance_meters, status, published_at,
    pace_groups, created_by)
  values ('Last Saturday 6K', now() - interval '7 days', now() - interval '7 days' + interval '90 minutes',
    'Hyde Park Corner', 51.502700, -0.151900, 6000, 'completed', now() - interval '14 days',
    array['easy','steady'], v_admin)
  returning id into v_past;

  -- Draft: must be invisible to members, visible to the admin console.
  insert into public.runs (title, starts_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, pace_groups, created_by)
  values ('Bank Holiday Special (unpublished)', now() + interval '20 days',
    'Regent''s Park', 51.531200, -0.156100, array['easy'], v_admin)
  returning id into v_draft;

  -- Publishing schedules each run's reminders too.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  perform public.publish_run(v_soon);
  perform public.publish_run(v_full);
  perform public.publish_run(v_future);

  -- Sign-ups: 12 for the weekly run, and 8 for the 5-place track session so
  -- three people sit on the waitlist.
  for n in 2..13 loop
    v_member := ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform public.join_run(v_soon, 'steady');
  end loop;

  for n in 2..9 loop
    v_member := ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform public.join_run(v_full, 'quick');
  end loop;

  perform set_config('request.jwt.claims', '', true);

  -- Attendance on the completed run, recorded as organiser check-ins so the
  -- seed does not have to fabricate location evidence.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  for n in 2..11 loop
    perform public.admin_check_in(
      v_past, ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid);
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
