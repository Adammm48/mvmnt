-- ============================================================================
-- Live positions.
--
-- ADR 0004's claims, as executable statements. The ones worth a machine
-- checking: one row per member (no trail is *possible*), the write gate
-- (checked in + run in progress), the read circle (self, friends,
-- organisers — nobody else), and the three deaths (toggle, run end, silence).
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_c uuid; v_run uuid;
  v_tok text;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');
  v_c := tests.make_member('cleo');
  -- Starting in 30 minutes so check-in is open.
  v_run := tests.make_run(v_admin, null, now() + interval '30 minutes');

  -- ama and ben are friends; cleo is a stranger to both.
  perform tests.act_as(v_a);
  select token into v_tok from public.my_friend_qr();
  perform tests.act_as(v_b);
  perform public.add_friend_by_token(v_tok);

  -- Everyone joins and checks in.
  perform tests.act_as(v_a);
  perform public.join_run(v_run);
  perform public.check_in(v_run, 30.044400, 31.235700, 10);
  perform tests.act_as(v_b);
  perform public.join_run(v_run);
  perform public.check_in(v_run, 30.044400, 31.235700, 10);
  perform tests.act_as(v_c);
  perform public.join_run(v_run);
  perform public.check_in(v_run, 30.044400, 31.235700, 10);

  -- ------------------------------------------------------------------------
  -- The write gate: not before the run is actually on.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_rejects(
    format('select public.share_live_position(%L, 30.045, 31.236)', v_run),
    'sharing is refused while the run has not started');

  perform tests.act_as_system();
  update public.runs set status = 'in_progress' where id = v_run;

  -- A member who never checked in cannot share. (Withdraw cleo's check-in by
  -- the organiser's hand, then have her try.)
  perform tests.act_as(v_admin);
  perform public.admin_remove_check_in(v_run, v_c);
  perform tests.act_as(v_c);
  perform tests.assert_rejects(
    format('select public.share_live_position(%L, 30.045, 31.236)', v_run),
    'sharing without being checked in is refused');

  -- ------------------------------------------------------------------------
  -- One row, overwritten — the no-trail property.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform public.share_live_position(v_run, 30.0450, 31.2360);
  perform public.share_live_position(v_run, 30.0460, 31.2370);
  perform public.share_live_position(v_run, 30.0470, 31.2380);

  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.live_positions
      where run_id = v_run and user_id = v_a), 1,
    'three updates leave exactly one row — a trail cannot exist');
  perform tests.assert(
    (select lat = 30.0470 from public.live_positions
      where run_id = v_run and user_id = v_a),
    'and the row holds the latest position');

  -- ------------------------------------------------------------------------
  -- The read circle.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform tests.assert_eq(
    (select count(*)::int from public.live_positions where run_id = v_run), 1,
    'a friend sees the sharer''s dot');

  perform tests.act_as(v_c);
  perform tests.assert_eq(
    (select count(*)::int from public.live_positions where run_id = v_run), 0,
    'a non-friend on the same run sees nothing');

  perform tests.act_as(v_admin);
  perform tests.assert_eq(
    (select count(*)::int from public.live_positions where run_id = v_run), 1,
    'an organiser sees every sharer — who is still out on the course');

  -- Direct writes are shut regardless of who you are: the grant only opens
  -- SELECT, so this is a denial (zero rows / permission), not an exception.
  perform tests.act_as(v_b);
  perform tests.assert_denied(
    format('insert into public.live_positions (run_id, user_id, lat, lng)
            values (%L, %L, 30.05, 31.24)', v_run, v_b),
    'positions cannot be written around the RPC');

  -- ------------------------------------------------------------------------
  -- Death one: the toggle. Always works, whatever the run state.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform public.stop_sharing_live_position(v_run);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.live_positions where user_id = v_a), 0,
    'stopping sharing removes the dot immediately');

  -- ------------------------------------------------------------------------
  -- Death two: the run ending sweeps the map, by hand and by clock.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_b);
  perform public.share_live_position(v_run, 30.0455, 31.2365);

  perform tests.act_as(v_admin);
  perform public.end_run(v_run);
  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.live_positions where run_id = v_run), 0,
    'ending the run clears every live position');

  -- By clock: a second run that the scheduler ends.
  declare
    v_run2 uuid;
  begin
    v_run2 := tests.make_run(v_admin, null, now() + interval '30 minutes');
    perform tests.act_as(v_b);
    perform public.join_run(v_run2);
    perform public.check_in(v_run2, 30.044400, 31.235700, 10);
    perform tests.act_as_system();
    update public.runs set status = 'in_progress' where id = v_run2;
    perform tests.act_as(v_b);
    perform public.share_live_position(v_run2, 30.0450, 31.2360);

    perform tests.act_as_system();
    -- Slide the whole run into the past so ends_at can be due without
    -- violating ends_after_starts.
    update public.runs
       set starts_at = now() - interval '2 hours',
           ends_at   = now() - interval '1 minute'
     where id = v_run2;
    perform public.scheduler_tick();
    perform tests.assert_eq(
      (select count(*)::int from public.live_positions where run_id = v_run2), 0,
      'the scheduler ending a run clears its live positions too');
  end;

  -- ------------------------------------------------------------------------
  -- Death three: silence. A dot not refreshed for two minutes is purged.
  -- ------------------------------------------------------------------------
  declare
    v_run3 uuid;
  begin
    v_run3 := tests.make_run(v_admin, null, now() + interval '30 minutes');
    perform tests.act_as(v_b);
    perform public.join_run(v_run3);
    perform public.check_in(v_run3, 30.044400, 31.235700, 10);
    perform tests.act_as_system();
    update public.runs set status = 'in_progress' where id = v_run3;
    perform tests.act_as(v_b);
    perform public.share_live_position(v_run3, 30.0450, 31.2360);

    perform tests.act_as_system();
    -- Backdate the row as if the phone went into a pocket.
    update public.live_positions
       set updated_at = now() - interval '3 minutes'
     where run_id = v_run3 and user_id = v_b;

    perform tests.assert_eq(public.purge_stale_live_positions(), 1,
      'a position silent for over two minutes is purged');
    perform tests.assert_eq(
      (select count(*)::int from public.live_positions where run_id = v_run3), 0,
      'and the map no longer claims the member is there');
  end;
end $$;

rollback;
