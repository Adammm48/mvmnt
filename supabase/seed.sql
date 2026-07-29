-- ============================================================================
-- Local development seed. Runs automatically after `supabase db reset`.
--
-- The shape matters more than the volume: every state the UI has to render
-- should exist here, so that empty states, waitlists and past runs are visible
-- without hand-crafting data each time.
--
-- NOT for production. Passwords are 'password123' for every account.
-- Meeting points are PLACEHOLDERS pending real ones from MVMNT.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Accounts.
--
-- Inserting into auth.users directly is the documented way to seed a local
-- Supabase stack; the on_auth_user_created trigger creates each profile.
-- ---------------------------------------------------------------------------
-- The empty-string token columns are not decoration. They are nullable in
-- Postgres, but GoTrue scans them into non-nullable Go strings, so a NULL makes
-- every sign-in fail with an opaque "Database error querying schema" 500 that
-- says nothing about the real cause. Leave them as ''.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data,
  confirmation_token, recovery_token,
  email_change, email_change_token_new, email_change_token_current
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
    case n when 1 then 'Club Organiser' else 'Runner ' || n end),
  '', '', '', '', ''
from generate_series(1, 30) as n
on conflict (id) do nothing;

-- Each account needs a matching identity row, or the provider linkage is
-- missing and sign-in fails even once the tokens above are fixed.
insert into auth.identities (
  provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
)
select
  u.id::text, u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
  'email', now(), now(), now()
from auth.users u
where u.email like '%@mvmnt.test'
on conflict (provider, provider_id) do nothing;

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
    'Zamalek Club Gate', 30.044400, 31.235700, 6000, array['easy','steady','quick'],
    'Our weekly 6K. All paces welcome — nobody gets left behind.', v_admin)
  returning id into v_soon;

  -- A published route on it, so the map has something to draw on both sides.
  --
  -- A loop out of the meeting point, over Qasr El Nil bridge, around Gezira and
  -- back. It starts at this run's own pin on purpose — a route beginning
  -- somewhere else is exactly the mistake the drawer should make obvious, so
  -- the demo data should not model it.
  --
  -- Placeholder geometry, like the meeting points themselves. Real routes come
  -- from the club (docs/open-items.md).
  update public.runs
     set route = '[[31.2357,30.0444],[31.2330,30.0450],[31.2312,30.0464],[31.2270,30.0478],
                   [31.2245,30.0490],[31.2228,30.0518],[31.2240,30.0548],[31.2270,30.0560],
                   [31.2298,30.0540],[31.2318,30.0505],[31.2340,30.0470],[31.2357,30.0444]]'::jsonb,
         route_published_at = now()
   where id = v_soon;

  -- Capacity 5, so the waitlist and its promotion flow can be exercised.
  insert into public.runs (title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, distance_meters, capacity,
    pace_groups, description, created_by)
  values ('Track Session',
    (date_trunc('day', now() at time zone 'Africa/Cairo') + interval '3 days' + interval '18 hours') at time zone 'Africa/Cairo',
    (date_trunc('day', now() at time zone 'Africa/Cairo') + interval '3 days' + interval '19 hours') at time zone 'Africa/Cairo',
    'Cairo Stadium Track', 30.070800, 31.312300, 5000, 5, array['steady','quick'],
    'Intervals on the track. Limited places.', v_admin)
  returning id into v_full;

  insert into public.runs (title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, distance_meters, pace_groups,
    description, created_by)
  values ('Sunday Long Run',
    (date_trunc('day', now() at time zone 'Africa/Cairo') + interval '8 days' + interval '9 hours') at time zone 'Africa/Cairo',
    (date_trunc('day', now() at time zone 'Africa/Cairo') + interval '8 days' + interval '11 hours') at time zone 'Africa/Cairo',
    'Al-Azhar Park', 30.040300, 31.263300, 15000, array['easy','steady'],
    'Longer, slower, chattier.', v_admin)
  returning id into v_future;

  -- Already finished, with check-ins — gives the profile screen some history.
  insert into public.runs (title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, distance_meters, status, published_at,
    pace_groups, created_by)
  values ('Last Saturday 6K',
    (date_trunc('day', now() at time zone 'Africa/Cairo') - interval '7 days' + interval '9 hours') at time zone 'Africa/Cairo',
    (date_trunc('day', now() at time zone 'Africa/Cairo') - interval '7 days' + interval '10 hours 30 minutes') at time zone 'Africa/Cairo',
    'Zamalek Club Gate', 30.044400, 31.235700, 6000, 'completed', now() - interval '14 days',
    array['easy','steady'], v_admin)
  returning id into v_past;

  -- Draft: must be invisible to members, visible to the admin console.
  insert into public.runs (title, starts_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, pace_groups, created_by)
  values ('Bank Holiday 10K', now() + interval '20 days',
    'New Cairo Waterway', 30.010000, 31.420000, array['easy'], v_admin)
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

-- ---------------------------------------------------------------------------
-- A season of history, so the loyalty features have something to stand on.
--
-- Without this the leaderboard is thirty people tied on ten points, every tier
-- is Starter and no badge has been earned — which renders, but shows none of
-- the states the screens were built for. This produces a real spread: a few
-- members at Elite with long streaks, a middle that comes most weeks, and a
-- tail that turns up occasionally.
--
-- Attendance is deterministic rather than random so the same reset always
-- produces the same board, and a screenshot taken today matches one taken
-- tomorrow.
--
-- Rows are inserted directly, oldest first, rather than through admin_check_in:
-- the points trigger reads checked_in_at as "now" when it works out the streak,
-- so a historical check-in has to carry its historical timestamp. Going through
-- the RPC would stamp every one of them with the present moment and hand
-- everybody a maximum streak bonus on every run they ever did.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid := '00000000-0000-0000-0000-000000000001';
  v_run   uuid;
  v_when  timestamptz;
  v_every integer;
  v_first integer;
  w integer;
  n integer;
begin
  -- 60 weeks back to last week, oldest first.
  for w in reverse 60..1 loop
    -- 09:00 in the club's timezone — the club runs Saturday mornings at 9 or
    -- 10, not at whatever hour the seed happened to be run. The hour is not
    -- cosmetic: at 04:00 every seeded member earns the 5am secret badge, which
    -- makes a badge that is supposed to be rare the most common one in the app.
    v_when := (date_trunc('day', now() at time zone 'Africa/Cairo')
               - (w || ' weeks')::interval
               + interval '9 hours') at time zone 'Africa/Cairo';

    insert into public.runs (
      title, starts_at, ends_at, meeting_point_name,
      meeting_point_lat, meeting_point_lng, distance_meters,
      status, published_at, pace_groups, created_by
    )
    values (
      case w % 3
        when 0 then 'Saturday 6K'
        when 1 then 'Riverside 8K'
        else 'Sunday Long Run'
      end,
      v_when, v_when + interval '90 minutes', 'Zamalek Club Gate',
      30.044400, 31.235700,
      case w % 3 when 0 then 6000 when 1 then 8000 else 15000 end,
      'completed', v_when - interval '5 days',
      array['easy','steady'], v_admin
    )
    returning id into v_run;

    for n in 2..30 loop
      -- How often this member turns up. The bands create a board with a top, a
      -- middle and a tail rather than one flat line.
      v_every := case
        when n <= 7  then 1   -- the regulars
        when n <= 16 then 2
        when n <= 24 then 3
        else 5                -- the occasional
      end;

      -- How long ago they joined the club, in weeks. Cadence alone would put
      -- everyone in a band on identical points, and a leaderboard of six-way
      -- ties tests nothing and demonstrates less. Members joining at different
      -- times is both the realistic reason totals differ and the thing that
      -- spreads them continuously.
      v_first := 60 - ((n * 13) % 52);

      continue when w > v_first or w % v_every <> 0;

      insert into public.run_attendance (
        run_id, user_id, queued_at, signed_up_at, checked_in_at, check_in_method
      )
      values (
        v_run,
        ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
        v_when - interval '2 days', v_when - interval '2 days', v_when, 'admin'
      );
    end loop;
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- Tier history, already seen.
--
-- The seeded attendance above climbs members through the tiers, and each
-- crossing is recorded as an unshown celebration (migration 0027). Left alone,
-- opening the app as any seeded member means a stack of chests for tiers they
-- "reached" months ago — the migration's own backfill cannot prevent it, because
-- migrations run before this file exists.
--
-- One member is deliberately left with an unclaimed Competitor tier, so the
-- chest can actually be seen without hand-editing the database.
-- ---------------------------------------------------------------------------
update public.member_tier_reached
   set acknowledged_at = reached_at
 where acknowledged_at is null;

update public.member_tier_reached
   set acknowledged_at = null
 where user_id = '00000000-0000-0000-0000-000000000009'
   and tier = 'competitor';


-- ---------------------------------------------------------------------------
-- The shop, and a sponsor.
--
-- Placeholder items in placeholder prices. Real catalogue and pricing are an
-- App Spec §11 open item ("current sponsor agreements and merch
-- catalogue/pricing, to replace placeholder data").
-- ---------------------------------------------------------------------------
insert into public.products (name, description, price_minor, status, stock, sizes, sort_order) values
  ('MVMNT Club Tee',      'The Saturday uniform. Soft cotton, club crest front and centre.', 45000, 'in_stock',   25, array['S','M','L','XL'], 1),
  ('MVMNT Cap',           'Keeps the Cairo sun honest.',                                     30000, 'in_stock',   40, '{}',                    2),
  ('MVMNT Bottle',        'One litre, fits the bridge railing at the meeting point.',        20000, 'in_stock', null, '{}',                    3),
  ('Winter Running Jacket','Coming when the weather turns.',                                 120000, 'coming_soon', null, array['S','M','L','XL'], 4);

insert into public.sponsors (name, url, active_from, created_by) values
  ('Cairo Runners Supply', 'https://example.test/crs', current_date - 30, '00000000-0000-0000-0000-000000000001');

insert into public.sponsor_placements (sponsor_id, type)
select id, 'home_banner' from public.sponsors where name = 'Cairo Runners Supply';
