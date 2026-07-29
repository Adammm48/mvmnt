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
  v_admin uuid; v_a uuid; v_b uuid; v_founder uuid;
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

  -- ---------------------------------------------------------------------
  -- The members directory is the organiser's, and only the organiser's.
  --
  -- It is the one thing in the app that lists the whole membership, so the
  -- test that a member cannot reach it matters more than the test that an
  -- organiser can. EXECUTE is granted to `authenticated` — the grant is the
  -- outer fence and the is_admin() check inside is what actually decides, so
  -- this asserts the check, not the grant.
  -- ---------------------------------------------------------------------
  perform tests.assert(
    (select count(*) from public.admin_members()) >= 3,
    'an organiser can list the membership');

  perform tests.assert(
    exists (select 1 from public.admin_members('ama') where display_name = 'ama'),
    'and search it by name');

  perform tests.assert(
    exists (select 1 from public.admin_members('ben@example.test') where display_name = 'ben'),
    'and by email, which is how two members with the same name are told apart');

  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    'select * from public.admin_members()',
    'a member cannot list the membership — this is the directory §4.4 exists to prevent');
  perform tests.assert_rejects(
    'select * from public.admin_members(''ben'')',
    'nor search it, which would be the same disclosure one name at a time');

  -- The directory must not have quietly relaxed the underlying table.
  perform tests.assert_eq(
    (select count(*)::int from public.profiles), 1,
    'and still reads exactly one profile directly — their own');

  perform tests.assert_rejects(
    format('select public.admin_member_detail(%L)', v_b),
    'a member cannot read another member''s full record');

  -- ---------------------------------------------------------------------
  -- Organiser roles.
  --
  -- The most security-sensitive write in the schema: it does not break a
  -- feature when it goes wrong, it hands over every member's data or locks the
  -- club out of its own console. The owner chose an open model — one organiser,
  -- no approvals — on the basis that anyone holding the account is trusted. The
  -- founding account being un-demotable is what makes that safe to leave open.
  -- ---------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.admin_set_member_role(%L, ''admin'')', v_a),
    'a member cannot promote themselves');
  perform tests.assert_rejects(
    format('update public.profiles set role = ''admin'' where id = %L', v_a),
    'nor by writing the column directly — the guard is on the table, not the RPC');

  -- The founding account claims itself on the first promotion, with no
  -- migration and no manual step.
  --
  -- Cleared first because the seeded database already has a founder, and this
  -- has to be tested from the state a brand-new project is actually in. As the
  -- system there is no authenticated caller — the same bootstrap path that
  -- creates the very first admin.
  perform tests.act_as_system();
  update public.profiles set is_founder = false where is_founder;

  v_founder := tests.make_member('club owner', true);
  perform tests.assert(
    (select is_founder from public.profiles where id = v_founder),
    'the first account promoted to admin becomes the founding account');
  perform tests.assert_eq(
    (select count(*)::int from public.profiles where is_founder), 1,
    'and there is exactly one');

  perform tests.act_as(v_admin);
  perform public.admin_set_member_role(v_a, 'admin');
  perform tests.assert_eq(
    (select role from public.profiles where id = v_a),
    'admin'::public.member_role,
    'an organiser can promote a member');

  perform tests.assert(
    not (select is_founder from public.profiles where id = v_a),
    'a promoted organiser does not become a second founder');

  -- A second organiser is a full organiser: no junior tier, per the owner.
  perform tests.act_as(v_a);
  perform public.admin_set_member_role(v_b, 'admin');
  perform tests.assert_eq(
    (select role from public.profiles where id = v_b),
    'admin'::public.member_role,
    'and the organiser they promoted can promote others — one tier, by design');

  perform public.admin_set_member_role(v_b, 'member');
  perform tests.assert_eq(
    (select role from public.profiles where id = v_b),
    'member'::public.member_role,
    'and demote them again');

  -- The one rule the owner asked for.
  perform tests.assert_rejects(
    format('select public.admin_set_member_role(%L, ''member'')', v_founder),
    'the founding account cannot be demoted by another organiser');

  perform tests.act_as(v_founder);
  perform tests.assert_rejects(
    format('select public.admin_set_member_role(%L, ''member'')', v_founder),
    'nor by itself — this is the guaranteed way back into the console');

  perform tests.assert_rejects(
    format('update public.profiles set role = ''member'' where id = %L', v_founder),
    'nor by writing the column directly');

  perform tests.assert_rejects(
    format('update public.profiles set is_founder = false where id = %L', v_founder),
    'and the flag itself cannot be cleared, which would be a one-step way round it');

  perform tests.assert_rejects(
    format('update public.profiles set is_founder = true where id = %L', v_a),
    'nor moved to another account');

  perform tests.assert_eq(
    (select role from public.profiles where id = v_founder),
    'admin'::public.member_role,
    'so the founding account still holds its role after all of that');

  -- ------------------------------------------------------------------------
  -- Structural: EVERY table in public has RLS switched on.
  --
  -- The posture since 0010 is "RLS on every table, no exceptions" — but each
  -- new migration has to remember it, and a forgotten ALTER TABLE is
  -- invisible until someone reads data they should not. This makes the next
  -- forgotten one a red test instead of an incident.
  -- ------------------------------------------------------------------------
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity),
    0,
    'every table in public has row level security enabled — a new table missing it shows up here');

  -- Same idea for the other classic footgun: a SECURITY DEFINER function
  -- without a pinned search_path resolves names in the caller's path, which
  -- is a privilege escalation waiting for a hostile temp table. Every one of
  -- ours pins it; this keeps that true.
  perform tests.assert_eq(
    (select count(*)::int
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app_private') and p.prosecdef
        and (p.proconfig is null or not exists (
          select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))),
    0,
    'every SECURITY DEFINER function pins search_path — a new one without it shows up here');

  raise notice 'PASS 03_access_control';
end $$;

rollback;
