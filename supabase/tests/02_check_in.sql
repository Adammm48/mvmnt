-- ============================================================================
-- Geofenced check-in.
--
-- Priority flow under Principles §11 — full rigour. Coordinates are around
-- Zamalek Club Gate (51.5027, -0.1519); the fixture run uses a 250 m radius.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_run uuid;
  v_lat  double precision := 30.044400;
  v_lng  double precision := 31.235700;
  -- ~100 m north of the meeting point: comfortably inside.
  v_near_lat double precision := 30.045300;
  -- ~2 km north: well outside.
  v_far_lat  double precision := 30.062400;
  v_dist double precision;
  v_f uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');

  -- Starts in 4 hours, so the one-hour check-in window has not opened.
  v_run := tests.make_run(v_admin, null, now() + interval '4 hours');

  -- ---------------------------------------------------------------------
  -- Too early: check-in opens one hour before the start.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.check_in(%L, %s, %s, 10)', v_run, v_near_lat, v_lng),
    'check-in is closed more than an hour before the start');
  perform tests.act_as_system();

  update public.runs set starts_at = now() - interval '10 minutes',
                         ends_at   = now() + interval '80 minutes'
   where id = v_run;

  -- ---------------------------------------------------------------------
  -- Outside the radius is refused, and the server computes the distance
  -- itself — the client sends only a position.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.check_in(%L, %s, %s, 10)', v_run, v_far_lat, v_lng),
    'a member 2 km away cannot check in');

  -- ---------------------------------------------------------------------
  -- Inside the radius succeeds and confers "in".
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    public.check_in(v_run, v_near_lat, v_lng, 12),
    'checked_in'::public.attendance_state,
    'a member at the meeting point can check in');
  perform tests.act_as_system();

  perform tests.assert(
    (select is_in from public.run_attendance_view where run_id = v_run and user_id = v_a),
    'checking in makes a member publicly "in"');

  -- App Spec §4.1: checking in without a prior sign-up also confers a place.
  perform tests.assert(
    (select signed_up_at is not null from public.run_attendance
     where run_id = v_run and user_id = v_a),
    'checking in without signing up first still confers a place');

  perform tests.assert_eq(
    (select checked_in_count::int from public.run_attendance_counts where run_id = v_run), 1,
    'the check-in appears in the public headcount');

  -- ---------------------------------------------------------------------
  -- Evidence is recorded, with the distance recomputed server-side.
  -- ---------------------------------------------------------------------
  select e.distance_m into v_dist
  from public.check_in_evidence e
  join public.run_attendance a on a.id = e.attendance_id
  where a.run_id = v_run and a.user_id = v_a;

  perform tests.assert(v_dist between 80 and 130,
    'the server records its own computed distance (~100 m), not the client''s claim');
  perform tests.assert_eq(
    (select method from public.check_in_evidence e
     join public.run_attendance a on a.id = e.attendance_id
     where a.run_id = v_run and a.user_id = v_a),
    'geofence'::public.check_in_method,
    'the check-in method is recorded');

  -- ---------------------------------------------------------------------
  -- Accuracy allowance: a member who is genuinely present but has a poor GPS
  -- fix is admitted. False negatives are the failure mode that actually
  -- happens, so this is deliberate — see ADR 0002.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform tests.assert_eq(
    public.check_in(v_run, 30.047700, v_lng, 400),   -- ~370 m out, ±400 m accuracy
    'checked_in'::public.attendance_state,
    'a poor GPS fix that could plausibly be inside the radius is accepted');

  -- ...but a bad fix does not admit someone genuinely far away.
  perform tests.assert_rejects(
    format('select public.check_in(%L, %s, %s, 50)', v_run, v_far_lat, v_lng),
    'a 2 km distance is not excused by a 50 m accuracy allowance');

  -- ------------------------------------------------------------------------
  -- The allowance is bounded (migration 0045).
  --
  -- p_accuracy_m is client input and was subtracted from the distance with no
  -- ceiling, so one authenticated call with an absurd accuracy checked you in
  -- from anywhere on Earth — and attendance is the currency the whole loyalty
  -- and shop system is denominated in. Generous is right; unbounded was not.
  -- ------------------------------------------------------------------------
  perform tests.assert_rejects(
    format('select public.check_in(%L, %s, %s, 9999999)', v_run, v_far_lat, v_lng),
    'an absurd accuracy claim cannot teleport a member into the geofence');

  perform tests.assert_rejects(
    format('select public.check_in(%L, %s, %s, 100000)', v_run, v_far_lat, v_lng),
    'and neither can a merely enormous one');

  -- A negative claim must not make the check STRICTER by accident — that would
  -- turn a malformed client into a member who cannot check in at all.
  perform tests.assert_eq(
    public.check_in(v_run, v_near_lat, v_lng, -500),
    'checked_in'::public.attendance_state,
    'a nonsensical negative accuracy is floored, not subtracted the wrong way');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- A device clock claiming an implausible time is discarded and replaced
  -- with server time — NOT rejected. A member whose phone clock is wrong is
  -- still standing at the meeting point, and refusing them would be the exact
  -- false negative ADR 0002 is built to avoid. The claim is still recorded in
  -- the evidence row, where a large skew is itself a signal.
  -- ---------------------------------------------------------------------
  v_c := tests.make_member('cass');
  perform tests.act_as(v_c);
  perform tests.assert_eq(
    public.check_in(v_run, v_near_lat, v_lng, 10, now() + interval '10 days'),
    'checked_in'::public.attendance_state,
    'a wrong device clock does not block a genuine check-in');
  perform tests.act_as_system();

  perform tests.assert(
    (select checked_in_at between now() - interval '1 minute' and now() + interval '1 minute'
     from public.run_attendance where run_id = v_run and user_id = v_c),
    'the check-in is timestamped by the server, not by the device''s claim');
  perform tests.assert(
    (select client_ts > now() + interval '9 days'
     from public.check_in_evidence e
     join public.run_attendance a on a.id = e.attendance_id
     where a.run_id = v_run and a.user_id = v_c),
    'but the implausible client timestamp is still retained as evidence');

  -- ---------------------------------------------------------------------
  -- After check-in has closed.
  -- ---------------------------------------------------------------------
  update public.runs set starts_at = now() - interval '10 hours',
                         ends_at   = now() - interval '8 hours'
   where id = v_run;
  perform tests.act_as(tests.make_member('dee'));
  perform tests.assert_rejects(
    format('select public.check_in(%L, %s, %s, 10)', v_run, v_near_lat, v_lng),
    'check-in closes once the run has ended');
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- The feature flag is a real kill switch.
  -- ---------------------------------------------------------------------
  update public.runs set starts_at = now() - interval '10 minutes',
                         ends_at   = now() + interval '80 minutes'
   where id = v_run;
  update public.feature_flags set enabled = false where key = 'geofence_check_in';

  perform tests.act_as(tests.make_member('eve'));
  perform tests.assert_rejects(
    format('select public.check_in(%L, %s, %s, 10)', v_run, v_near_lat, v_lng),
    'disabling the geofence flag stops geofenced check-in entirely');
  perform tests.act_as_system();
  update public.feature_flags set enabled = true where key = 'geofence_check_in';

  -- ---------------------------------------------------------------------
  -- Organiser override — the mitigation that actually matters (ADR 0002 §3).
  -- ---------------------------------------------------------------------
  v_f := tests.make_member('fred');   -- has NOT checked in, so method is unambiguous
  perform tests.act_as(v_b);
  perform tests.assert_rejects(
    format('select public.admin_check_in(%L, %L)', v_run, v_f),
    'a member cannot check themselves in through the admin route');
  perform tests.act_as_system();

  perform tests.act_as(v_admin);
  perform tests.assert_eq(
    public.admin_check_in(v_run, v_f),
    'checked_in'::public.attendance_state,
    'an organiser can check a member in by hand');
  perform tests.act_as_system();

  perform tests.assert_eq(
    (select check_in_method from public.run_attendance where run_id = v_run and user_id = v_f),
    'admin'::public.check_in_method,
    'a manual check-in is recorded as such, not disguised as a geofence hit');
  perform tests.assert(
    exists (select 1 from public.audit_log
            where action = 'admin_check_in' and actor_id = v_admin),
    'a manual check-in is written to the audit log (Principles §3)');

  -- Removing a check-in also removes the location evidence supporting it.
  perform tests.act_as(v_admin);
  perform public.admin_remove_check_in(v_run, v_f);
  perform tests.act_as_system();

  perform tests.assert(
    (select checked_in_at is null from public.run_attendance
     where run_id = v_run and user_id = v_f),
    'an organiser can remove a check-in');
  perform tests.assert(
    not exists (select 1 from public.check_in_evidence e
                join public.run_attendance a on a.id = e.attendance_id
                where a.run_id = v_run and a.user_id = v_f),
    'removing a check-in discards the location data that supported it');


  -- ---------------------------------------------------------------------
  -- The directions link never moves the geofence.
  --
  -- maps_url exists so an organiser can send members to a named gate rather
  -- than a bare coordinate. It is navigation only, and this is the assertion
  -- that keeps it that way: point the link at another country, and check-in
  -- still measures from the pin. If this ever fails, somebody has taught
  -- check_in() to read it, and a pasted link can now strand people.
  -- ---------------------------------------------------------------------
  perform tests.act_as_system();
  update public.runs
     set maps_url = 'https://maps.app.goo.gl/somewhere-else-entirely'
   where id = v_run;

  perform tests.assert(
    (select maps_url is not null from public.runs where id = v_run),
    'the run carries a pasted directions link');

  v_f := tests.make_member('faris');
  perform tests.act_as(v_f);
  perform public.check_in(v_run, v_near_lat, v_lng, 10);
  perform tests.assert(
    (select checked_in_at is not null from public.run_attendance
      where run_id = v_run and user_id = v_f),
    'someone at the pin still checks in, whatever the directions link says');

  perform tests.act_as_system();
  perform tests.assert_rejects(
    format('update public.runs set maps_url = %L where id = %L', 'not a link', v_run),
    'a directions link that is not an https address is refused');

  raise notice 'PASS 02_check_in';
end $$;

rollback;
