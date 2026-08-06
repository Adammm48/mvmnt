-- ============================================================================
-- Photo galleries.
--
-- The property that matters is the same one the private bucket exists for: a
-- photo of identifiable members is invisible to the membership until the
-- organiser publishes the gallery — the rows, not just the bytes. And the
-- photos-ready notification goes to the people who were actually there, once.
-- ============================================================================
begin;

do $$
declare
  v_admin uuid; v_a uuid; v_b uuid; v_run uuid;
  v_photo uuid;
  v_event uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser', true);
  v_a := tests.make_member('ama');
  v_b := tests.make_member('ben');
  -- Starting in 30 minutes, so check-in (opens an hour before) is open.
  v_run := tests.make_run(v_admin, null, now() + interval '30 minutes');

  -- ama was there (signed up and checked in); ben signed up but never arrived.
  perform tests.act_as(v_a);
  perform public.join_run(v_run);
  perform tests.act_as(v_b);
  perform public.join_run(v_run);
  perform tests.act_as(v_a);
  perform public.check_in(v_run, 30.044400, 31.235700, 10);

  -- ------------------------------------------------------------------------
  -- Uploading is organiser-only, and rows are invisible until publication.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_denied(
    format('insert into public.run_photos (run_id, category, storage_path, uploaded_by)
            values (%L, %L, %L, %L)', v_run, 'run', 'x/member-upload.jpg', v_a),
    'a member cannot register a gallery photo');

  perform tests.act_as(v_admin);
  insert into public.run_photos (run_id, category, storage_path, uploaded_by)
  values (v_run, 'pre_run', v_run || '/pre_run/warmup.jpg',  v_admin),
         (v_run, 'run',     v_run || '/run/bridge.jpg',      v_admin),
         (v_run, 'after',   v_run || '/after/coffee.jpg',    v_admin);

  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.run_photos where run_id = v_run), 0,
    'an unpublished gallery shows a member nothing — not even the list');

  -- ------------------------------------------------------------------------
  -- A member cannot publish; an empty gallery cannot be published.
  -- ------------------------------------------------------------------------
  perform tests.assert_rejects(
    format('select public.admin_publish_gallery(%L)', v_run),
    'a member cannot publish a gallery');

  perform tests.act_as(v_admin);
  perform tests.assert_rejects(
    format('select public.admin_publish_gallery(%L)', gen_random_uuid()),
    'publishing an empty (or unknown) gallery is refused');

  -- ------------------------------------------------------------------------
  -- Publishing: gallery opens, and the notification goes to the checked-in.
  -- ------------------------------------------------------------------------
  v_event := public.admin_publish_gallery(v_run);

  perform tests.act_as_system();
  perform tests.assert(
    (select photos_published_at is not null from public.runs where id = v_run),
    'publishing stamps the run');

  perform app_private.fan_out_notification(v_event);
  perform tests.assert_eq(
    (select count(*)::int from public.notification_deliveries d
      where d.event_id = v_event and d.user_id = v_a), 1,
    'the member who was there is told the photos are up');
  perform tests.assert_eq(
    (select count(*)::int from public.notification_deliveries d
      where d.event_id = v_event and d.user_id = v_b), 0,
    'the member who signed up but never arrived is not — they are not in the photos');

  -- ------------------------------------------------------------------------
  -- After publication a member sees the list; re-publishing does not re-ping.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from public.run_photos where run_id = v_run), 3,
    'a published gallery lists its photos to members');

  perform tests.act_as(v_admin);
  insert into public.run_photos (run_id, category, storage_path, uploaded_by)
  values (v_run, 'camera', v_run || '/camera/late-batch.jpg', v_admin);
  perform public.admin_publish_gallery(v_run);

  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.notification_events
      where type = 'photos_ready' and run_id = v_run), 1,
    'adding a late batch and publishing again does not notify twice');

  -- ------------------------------------------------------------------------
  -- The BYTES gate, not just the rows: storage.objects' own policy.
  --
  -- The privacy claim is that an object in gallery-media is readable only
  -- when a run_photos row links it to a published gallery. Objects that
  -- never got a row — an upload that failed halfway, or something dropped
  -- into the bucket by hand — must be invisible, not leaked.
  -- ------------------------------------------------------------------------
  perform tests.act_as_system();
  insert into storage.objects (bucket_id, name, owner)
  values ('gallery-media', v_run || '/run/bridge.jpg', v_admin),
         ('gallery-media', v_run || '/run/orphan-no-row.jpg', v_admin);

  perform tests.act_as(v_a);
  perform tests.assert_eq(
    (select count(*)::int from storage.objects
      where bucket_id = 'gallery-media' and name = v_run || '/run/bridge.jpg'), 1,
    'a member can read the bytes of a published, registered photo');
  perform tests.assert_eq(
    (select count(*)::int from storage.objects
      where bucket_id = 'gallery-media' and name = v_run || '/run/orphan-no-row.jpg'), 0,
    'an object with no run_photos row is invisible — orphans do not leak');

  -- ------------------------------------------------------------------------
  -- Erasing the organiser anonymises their uploads; the club keeps its photos.
  -- ------------------------------------------------------------------------
  perform tests.act_as(v_admin);
  perform public.erase_member(v_admin);

  perform tests.act_as_system();
  perform tests.assert_eq(
    (select count(*)::int from public.run_photos where run_id = v_run), 4,
    'erasing the uploader does not delete the club''s gallery');
  perform tests.assert_eq(
    (select count(*)::int from public.run_photos
      where run_id = v_run and uploaded_by is not null), 0,
    'but their name comes off every upload');
end $$;


-- ---------------------------------------------------------------------------
-- Find my photos (migration 0049): the selfie is a unit, matches grant nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid; v_m uuid; v_other uuid; v_run uuid; v_photo uuid;
begin
  perform tests.act_as_system();
  v_admin := tests.make_member('organiser-f', true);
  v_m := tests.make_member('farida');
  v_other := tests.make_member('gamal');
  -- Published in the future, then moved into the past directly — publish_run
  -- rightly refuses a run that already started.
  v_run := tests.make_run(v_admin, null, now() + interval '2 hours');
  update public.runs
     set starts_at = now() - interval '3 hours',
         ends_at   = now() - interval '2 hours',
         status    = 'completed'
   where id = v_run;

  -- A photo in the gallery, unpublished for now.
  insert into public.run_photos (run_id, category, storage_path, uploaded_by)
  values (v_run, 'run', v_run || '/run/001.jpg', v_admin)
  returning id into v_photo;

  -- No selfie, no opt-in: the row is refused until the bytes exist.
  perform tests.act_as(v_m);
  perform tests.assert_rejects(
    'select public.enable_photo_matching()',
    'opting in without a selfie is refused — a face row with no face behind it');

  -- The selfie bytes land under the member's own id; the policy allows no
  -- other path, so the upload IS the identity check.
  perform tests.act_as_system();
  insert into storage.objects (bucket_id, name, owner)
  values ('gallery-media', 'selfies/' || v_m, v_m);

  perform tests.act_as(v_m);
  perform public.enable_photo_matching();
  perform tests.assert(
    (select count(*) = 1 from public.face_optins where user_id = v_m),
    'with the selfie in place, opting in works');

  -- A match exists (written by the matcher, i.e. service role)…
  perform tests.act_as_system();
  insert into public.photo_matches (photo_id, user_id, confidence)
  values (v_photo, v_m, 97.5);

  -- …but grants nothing while the gallery is unpublished. Same gate as the
  -- gallery itself: a match must never leak that an unpublished gallery exists.
  perform tests.act_as(v_m);
  perform tests.assert_eq(
    (select count(*)::int from public.my_photo_matches(v_run)), 0,
    'a match in an unpublished gallery is invisible even to its own member');

  perform tests.act_as_system();
  update public.runs set photos_published_at = now() where id = v_run;

  perform tests.act_as(v_m);
  perform tests.assert_eq(
    (select count(*)::int from public.my_photo_matches(v_run)), 1,
    'published, the member sees which photos are probably them');

  -- Another member sees none of it — matches are the member's own.
  perform tests.act_as(v_other);
  perform tests.assert_eq(
    (select count(*)::int from public.my_photo_matches(v_run)), 0,
    'matches are visible only to the person matched');
  perform tests.assert_eq(
    (select count(*)::int from public.face_optins), 0,
    'and nobody can see who else has opted in — not even that they have');

  -- Opting out deletes the unit: opt-in row, matches, and the selfie bytes.
  -- The member has been ENROLLED first — because the audit entry must carry
  -- the provider's face id out of the dying row. The original wrote '{}',
  -- which left the Edge Function nothing to delete provider-side: the club
  -- forgot the face while the provider quietly kept it.
  perform tests.act_as_system();
  update public.face_optins set provider_face_id = 'prov-face-123'
   where user_id = v_m;

  perform tests.act_as(v_m);
  perform public.disable_photo_matching();

  perform tests.act_as_system();
  perform tests.assert(
    exists (select 1 from public.audit_log
             where action = 'disable_photo_matching'
               and entity_id = v_m::text
               and metadata->>'provider_face_id' = 'prov-face-123'),
    'the audit entry carries the provider face id, so the provider-side copy can be deleted too');
  perform tests.act_as_system();
  perform tests.assert(
    (select count(*) = 0 from public.face_optins where user_id = v_m)
    and (select count(*) = 0 from public.photo_matches where user_id = v_m)
    and (select count(*) = 0 from storage.objects
          where bucket_id = 'gallery-media' and name = 'selfies/' || v_m),
    'opting out deletes the selfie, the enrolment and every match as one unit');

  -- Erasure reaches the selfie bytes too, which have no FK to cascade through.
  perform tests.act_as_system();
  insert into storage.objects (bucket_id, name, owner)
  values ('gallery-media', 'selfies/' || v_other, v_other);
  perform tests.act_as(v_other);
  perform public.enable_photo_matching();
  perform public.erase_member(v_other);
  perform tests.act_as_system();
  perform tests.assert(
    (select count(*) = 0 from storage.objects
      where bucket_id = 'gallery-media' and name = 'selfies/' || v_other),
    'erasing an account erases the face that came with it');
end $$;

rollback;
