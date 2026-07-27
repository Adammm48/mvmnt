-- ============================================================================
-- 0012 · Run cover media
--
-- A photo (and optionally a short clip) per run. App Spec §2 asks for an app
-- that makes people *want* to tap "join" — a wall of text does not, and the run
-- card is where that decision actually gets made.
--
-- Scope note: this is NOT the photo system in §4.8. That is Phase 4 — per-run
-- galleries with the pre-run/run/after/camera categories, and AI face matching
-- in Phase 5. This is one cover image and one optional clip per run, to make
-- Phase 1 feel like a running club rather than a form. The storage bucket and
-- its policies are deliberately shaped so Phase 4 galleries can reuse them.
-- ============================================================================

alter table public.runs
  add column cover_image_url text,
  add column cover_video_url text;

comment on column public.runs.cover_image_url is
  'Public URL of the run''s cover photo in the run-media bucket. Club imagery, not personal data.';
comment on column public.runs.cover_video_url is
  'Optional short looping clip shown on the run detail screen. Muted and autoplaying, so it must never carry meaningful audio.';

-- ---------------------------------------------------------------------------
-- Storage.
--
-- Public read: these are the club's own promotional images, shown on a screen a
-- member sees before signing in to a specific run, and serving them through
-- signed URLs would mean re-signing on every render for no privacy benefit.
--
-- Nothing personal goes in this bucket. When Phase 4 adds member photos, those
-- need a SEPARATE, non-public bucket — a gallery of identifiable members is
-- personal data and a public bucket would be exactly the wrong default
-- (Principles §4).
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'run-media',
  'run-media',
  true,
  52428800,  -- 50 MB: enough for a cover photo or a few seconds of video
  array['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/quicktime']
)
on conflict (id) do nothing;

create policy "run media is publicly readable"
  on storage.objects for select
  using (bucket_id = 'run-media');

-- Only organisers upload. Without this any authenticated member could write to
-- the bucket, and a public bucket the whole membership can write to is an open
-- file host.
create policy "organisers upload run media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'run-media' and public.is_admin());

create policy "organisers replace run media"
  on storage.objects for update to authenticated
  using (bucket_id = 'run-media' and public.is_admin())
  with check (bucket_id = 'run-media' and public.is_admin());

create policy "organisers delete run media"
  on storage.objects for delete to authenticated
  using (bucket_id = 'run-media' and public.is_admin());
