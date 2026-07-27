-- ============================================================================
-- Row Level Security and authorisation.
--
-- These are the tests that cannot be replaced by clicking around the app: a
-- policy hole is invisible from the UI, because the UI only ever asks for data
-- it is supposed to have.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid;
  v_pub uuid; v_draft uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');

  v_pub   := tests.make_run(v_admin, null);
  v_draft := tests.make_run(v_admin, null, now() + interval '5 hours', false);

  perform tests.act_as(v_a);
  perform public.join_run(v_pub);
  perform tests.act_as(v_b);
  perform public.join_run(v_pub);
  perform tests.act_as_system();

  -- ---------------------------------------------------------------------
  -- Profiles: no member directory exists. App Spec §4.4 makes QR-only friend
  -- adding a safety measure, which is worth nothing if the API lists members.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.profiles), 1,
    'a member can read exactly one profile — their own');
  perform tests.assert_eq(
    (select count(*)::int from public.profiles where id = v_b), 0,
    'a member cannot read another member''s profile');

  -- Privilege escalation.
  perform tests.assert_rejects(
    format('update public.profiles set role = ''admin'' where id = %L', v_a),
    'a member cannot promote themselves to admin');

  -- ---------------------------------------------------------------------
  -- Runs: drafts are invisible.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    (select count(*)::int from public.runs where id = v_draft), 0,
    'a member cannot see a draft run');
  perform tests.assert_eq(
    (select count(*)::int from public.runs where id = v_pub), 1,
    'a member can see a published run');
  perform tests.assert_denied(
    format('update public.runs set title = ''hijacked'' where id = %L', v_pub),
    'a member cannot edit a run');
  perform tests.assert_rejects(
    'insert into public.runs (title, starts_at, meeting_point_name, meeting_point_lat, meeting_point_lng)
     values (''mine'', now() + interval ''1 day'', ''x'', 51.5, -0.15)',
    'a member cannot create a run');
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select title from public.runs where id = v_pub), 'Saturday 6K',
    'and the run really is untouched, not merely reported as zero rows');
  perform tests.act_as(v_a);

  -- ---------------------------------------------------------------------
  -- Attendance: own rows only, but aggregate counts are public.
  -- ---------------------------------------------------------------------
  perform tests.assert_eq(
    (select count(*)::int from public.run_attendance where run_id = v_pub), 1,
    'a member sees only their own attendance row');
  perform tests.assert_eq(
    (select going_count::int from public.run_attendance_counts where run_id = v_pub), 2,
    'but the aggregate headcount reflects everyone (App Spec §2)');

  -- Writes must go through the RPCs, which validate first.
  perform tests.assert_rejects(
    format('insert into public.run_attendance (run_id, user_id, signed_up_at)
            values (%L, %L, now())', v_draft, v_a),
    'a member cannot write an attendance row directly, bypassing capacity and timing rules');
  perform tests.assert_denied(
    format('update public.run_attendance set checked_in_at = now() where user_id = %L', v_a),
    'a member cannot check themselves in by writing the column directly');

  -- ---------------------------------------------------------------------
  -- Admin-only operations reject members even though EXECUTE is granted:
  -- the grant is the outer fence, is_admin() is what decides.
  -- ---------------------------------------------------------------------
  perform tests.assert_rejects(
    format('select public.publish_run(%L)', v_draft),
    'a member cannot publish a run');
  perform tests.assert_rejects(
    format('select public.cancel_run(%L)', v_pub),
    'a member cannot cancel a run');
  perform tests.assert_rejects(
    format('select public.admin_remove_check_in(%L, %L)', v_pub, v_b),
    'a member cannot remove someone else''s check-in');

  -- The scheduler is not reachable at all: a member must not be able to force
  -- the club's notification fan-out.
  perform tests.assert_rejects(
    'select public.scheduler_tick()',
    'a member cannot run the scheduler');

  -- Audit log is admin-only.
  perform tests.assert_eq(
    (select count(*)::int from public.audit_log), 0,
    'a member cannot read the audit log');

  -- Feature flags are readable (the app branches on them) but not writable.
  perform tests.assert(
    (select count(*)::int from public.feature_flags) > 0,
    'a member can read feature flags');
  perform tests.assert_denied(
    'update public.feature_flags set enabled = false where key = ''geofence_check_in''',
    'a member cannot change a feature flag');

  -- ---------------------------------------------------------------------
  -- Location evidence: your own only.
  -- ---------------------------------------------------------------------
  perform tests.act_as_system();
  update public.runs set starts_at = now() - interval '5 minutes',
                         ends_at   = now() + interval '1 hour'
   where id = v_pub;

  perform tests.act_as(v_b);
  perform public.check_in(v_pub, 30.044400, 31.235700, 10);

  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.check_in_evidence), 0,
    'a member cannot read another member''s location data');

  perform tests.act_as(v_b);
  perform tests.assert_eq(
    (select count(*)::int from public.check_in_evidence), 1,
    'a member can read their own location data (so a subject access request is answerable)');

  -- ---------------------------------------------------------------------
  -- Admins can see what they need to run the club.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_admin);
  perform tests.assert_eq(
    (select count(*)::int from public.run_attendance where run_id = v_pub), 2,
    'an admin can see the full attendance list');
  perform tests.assert_eq(
    (select count(*)::int from public.runs where id = v_draft), 1,
    'an admin can see draft runs');

  perform tests.act_as_system();
  raise notice 'PASS 03_access_control';
end $$;

rollback;
