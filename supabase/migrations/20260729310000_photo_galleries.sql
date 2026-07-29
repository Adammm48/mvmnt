-- ============================================================================
-- 0040 · Photo galleries
--
-- App Spec §4.8, the short-term half: replicate the club's Google Drive
-- structure — pre-run / run / after / camera — as in-app galleries per run,
-- with a photos-ready notification when a gallery is published. The AI
-- face-matching half is explicitly "target", not now, and nothing here is
-- shaped around it beyond keeping one photo = one row.
--
-- A SEPARATE, PRIVATE BUCKET
--
-- Migration 0012 said it in advance: run covers live in the public `run-media`
-- bucket because they are club imagery, and member photos must not go there.
-- A gallery photo is a picture of identifiable people at a known place and
-- time — that is personal data, and "public bucket, guessable URL" is the
-- wrong default in exactly the way that never gets noticed until it matters.
-- `gallery-media` is public = false: every read goes through Storage's RLS
-- and reaches only signed-in members, and only once the gallery is published.
--
-- PUBLISHING IS A SEPARATE ACT, AGAIN
--
-- Same shape as routes (0037) and runs themselves: organisers upload over a
-- few days as photos come in from whoever shot them; members see nothing until
-- the organiser says so, and the club is notified exactly once. The
-- photos-ready notification goes to the people who were checked in at that
-- run — they are the ones in the pictures.
-- ============================================================================

create type public.photo_category as enum ('pre_run', 'run', 'after', 'camera');

comment on type public.photo_category is
  'The club''s existing Google Drive folder structure, kept as-is (App Spec §4.8): before the run, during it, afterwards, and the photographer''s camera roll.';

create table public.run_photos (
  id           uuid primary key default gen_random_uuid(),
  run_id       uuid not null references public.runs (id) on delete cascade,
  category     public.photo_category not null,
  -- The object's path inside the gallery-media bucket. The row is the source
  -- of truth for what a gallery contains; the bucket is just bytes.
  storage_path text not null unique,
  -- Who uploaded it — an organiser. SET NULL so erasing an organiser's account
  -- anonymises their uploads rather than deleting the club's photos.
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.run_photos is
  'One row per gallery photo. Bytes live in the private gallery-media bucket; visibility to members is gated on runs.photos_published_at (App Spec §4.8).';

create index run_photos_by_run on public.run_photos (run_id, category, created_at);

alter table public.runs
  add column photos_published_at timestamptz;

comment on column public.runs.photos_published_at is
  'When the organiser published this run''s gallery. Null means members see no photos and no gallery section. Set by admin_publish_gallery(), which also sends the photos-ready notification.';

-- ---------------------------------------------------------------------------
-- The bucket. Everything about it is the opposite of run-media (0012) on purpose.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'gallery-media',
  'gallery-media',
  false,     -- the entire point — see the header
  15728640,  -- 15 MB: a full-resolution phone photo, not a video host
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- Members read a photo's bytes only when its gallery is published. The check
-- goes through run_photos rather than parsing the object path: the row is the
-- record, and an object that never got a row is invisible rather than leaked.
create policy "published gallery photos are readable by members"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'gallery-media'
    and (
      public.is_admin()
      or exists (
        select 1
        from public.run_photos ph
        join public.runs r on r.id = ph.run_id
        where ph.storage_path = storage.objects.name
          and r.photos_published_at is not null
      )
    )
  );

create policy "organisers upload gallery photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'gallery-media' and public.is_admin());

create policy "organisers replace gallery photos"
  on storage.objects for update to authenticated
  using (bucket_id = 'gallery-media' and public.is_admin())
  with check (bucket_id = 'gallery-media' and public.is_admin());

create policy "organisers delete gallery photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'gallery-media' and public.is_admin());

-- ---------------------------------------------------------------------------
-- The table's own rules, in the two-gate style of 0010: the GRANT says what
-- verbs exist at all, the policy says who gets them.
--
-- Members SELECT rows only for published galleries — the list of what is in a
-- gallery is as gated as the bytes. Organisers insert and delete rows directly
-- (registering an upload is not a state machine that needs an RPC); publishing
-- is an RPC because it notifies people.
-- ---------------------------------------------------------------------------
alter table public.run_photos enable row level security;

create policy run_photos_select_published on public.run_photos
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.runs r
      where r.id = run_id and r.photos_published_at is not null
    )
  );

create policy run_photos_admin_write on public.run_photos
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select                 on public.run_photos to authenticated;
grant insert, update, delete on public.run_photos to authenticated;
-- The 0010 blanket grant to service_role predates this table, so like every
-- table added since it needs its own — the seed script writes through it.
grant select, insert, update, delete on public.run_photos to service_role;

-- ---------------------------------------------------------------------------
-- Publishing.
-- ---------------------------------------------------------------------------
create or replace function public.admin_publish_gallery(p_run_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
  v_event uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into v_count from public.run_photos where run_id = p_run_id;
  if v_count = 0 then
    raise exception 'upload some photos before publishing the gallery'
      using errcode = 'check_violation';
  end if;

  update public.runs set photos_published_at = now() where id = p_run_id;
  if not found then
    raise exception 'run not found' using errcode = 'no_data_found';
  end if;

  -- To the people who were checked in — they are the ones in the photos.
  -- Idempotent by the usual dedupe key: adding a batch of late photos and
  -- pressing publish again does not ping everyone twice. A gallery worth
  -- re-announcing is a deliberate message, not a side effect of saving.
  v_event := app_private.enqueue_notification(
    p_type     => 'photos_ready',
    p_audience => 'run_checked_in',
    p_run_id   => p_run_id
  );

  perform app_private.audit('publish_gallery', 'runs', p_run_id::text,
                            jsonb_build_object('photos', v_count));
  return v_event;
end;
$$;

grant execute on function public.admin_publish_gallery(uuid) to authenticated;
