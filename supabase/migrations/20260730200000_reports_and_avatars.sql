-- ============================================================================
-- 0051 · Content reporting, and a face of your own
--
-- Two gaps the audit council found, one legal and one human.
--
-- REPORTING (Apple guideline 1.2)
--
-- The app carries user-visible content a member might object to: run photos
-- of identifiable people, and gift messages written by other members. The
-- organiser can already delete any photo — but App Store guideline 1.2
-- requires that MEMBERS have a way to flag objectionable content from inside
-- the app, not just that the club can act when asked in person. Google Play's
-- UGC policy asks for the same. Without this, the submission is rejectable
-- on both stores.
--
-- One table for every reportable kind, because "what can be reported" will
-- grow and a table per kind multiplies moderation surfaces. The organiser
-- console lists open reports; resolving one records who and when. Deleting
-- the offending photo is the existing admin_delete_photo; nothing new to
-- learn.
--
-- AVATARS
--
-- profiles.avatar_url has existed since Phase 1 and was only ever filled from
-- OAuth metadata — which email-OTP members (i.e. everybody, today) never
-- have. The leaderboard and friends screens render initials forever, and a
-- member has no way to set or change their own face. The column finally gets
-- an upload path.
--
-- The bucket is PUBLIC-read, unlike gallery-media, deliberately: an avatar is
-- the one photo a member chooses and uploads specifically to be displayed
-- beside their name, paths are unguessable uuids, writes are locked to the
-- member's own folder, and erasure deletes the files. The galleries' privacy
-- argument (photos of people who did not choose them) does not transfer to a
-- self-chosen profile picture.
-- ============================================================================

create table public.content_reports (
  id          uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  -- What is being reported. The id is text because targets live in different
  -- tables (photos, orders) and the report must survive its target's deletion
  -- — "we removed it" is the resolution, not the loss of the record.
  kind        text not null check (kind in ('photo', 'gift_message')),
  target_id   text not null,
  reason      text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null
);

create index content_reports_open_idx on public.content_reports (created_at desc)
  where resolved_at is null;

comment on table public.content_reports is
  'Member reports of objectionable content (App Store 1.2 / Play UGC). Reports outlive their targets: removing the content is the resolution, not the loss of the record (migration 0050).';

alter table public.content_reports enable row level security;

grant select, insert on public.content_reports to authenticated;
grant all on public.content_reports to service_role;

-- Members write through the RPC and read nothing back — a report is a message
-- to the club, not a public thread. Organisers read everything.
create policy content_reports_admin_read on public.content_reports
  for select to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Filing one.
-- ---------------------------------------------------------------------------
create or replace function public.report_content(
  p_kind      text,
  p_target_id text,
  p_reason    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'authentication required'
      using errcode = 'invalid_authorization_specification';
  end if;

  if p_kind not in ('photo', 'gift_message') then
    raise exception 'nothing reportable by that name' using errcode = 'check_violation';
  end if;

  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    raise exception 'say a few words about what is wrong — it is what the organiser acts on'
      using errcode = 'check_violation';
  end if;

  -- One open report per member per target. Reporting twice is a double-tap,
  -- not a second grievance, and a queue of duplicates buries the real ones.
  if exists (
    select 1 from public.content_reports
    where reporter_id = v_me and kind = p_kind and target_id = p_target_id
      and resolved_at is null
  ) then
    return;
  end if;

  insert into public.content_reports (reporter_id, kind, target_id, reason)
  values (v_me, p_kind, p_target_id, btrim(p_reason));

  perform app_private.audit('report_content', 'content_reports', p_target_id,
                            jsonb_build_object('kind', p_kind));
end;
$$;

comment on function public.report_content is
  'A member flags a photo or gift message for the organisers. Idempotent per open report (migration 0050).';

-- ---------------------------------------------------------------------------
-- Resolving one.
-- ---------------------------------------------------------------------------
create or replace function public.admin_resolve_report(p_report_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  update public.content_reports
     set resolved_at = now(), resolved_by = auth.uid()
   where id = p_report_id and resolved_at is null;

  perform app_private.audit('resolve_report', 'content_reports', p_report_id::text, '{}'::jsonb);
end;
$$;

grant execute on function public.report_content(text, text, text) to authenticated;
grant execute on function public.admin_resolve_report(uuid)       to authenticated;

-- ---------------------------------------------------------------------------
-- The avatars bucket.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

-- Anyone may look at an avatar (that is what it is for); a member writes only
-- inside their own folder, named by their uid.
create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_own_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_own_update on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

create policy avatars_own_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------------------------------------------------------------------
-- Setting it, and erasing it.
--
-- The URL is set through an RPC rather than a bare column update so the
-- server can insist the URL points into the member's own folder — otherwise
-- any member could set their avatar to any image on the internet, which is
-- how a profile picture becomes somebody else's face.
-- ---------------------------------------------------------------------------
create or replace function public.set_avatar(p_path text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'authentication required'
      using errcode = 'invalid_authorization_specification';
  end if;

  if p_path is null then
    update public.profiles set avatar_url = null where id = v_me;
    return;
  end if;

  if p_path not like 'avatars/' || v_me::text || '/%' then
    raise exception 'that is not your picture' using errcode = 'check_violation';
  end if;

  update public.profiles set avatar_url = p_path where id = v_me;
end;
$$;

comment on function public.set_avatar is
  'Sets the member''s avatar to a path inside their own avatars folder, or clears it. A bare column update would let a member point their face at any URL (migration 0050).';

grant execute on function public.set_avatar(text) to authenticated;

-- Erasure reaches the face too. This is the FULL erase_member from 0050
-- plus the avatar deletion — a partial rewrite here previously dropped the
-- selfie deletion and the test suite caught it.
create or replace function public.erase_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() and auth.uid() is distinct from p_user_id then
    raise exception 'you may only erase your own account'
      using errcode = 'insufficient_privilege';
  end if;

  delete from public.check_in_evidence
   where attendance_id in (
     select id from public.run_attendance where user_id = p_user_id
   );

  delete from public.push_tokens where user_id = p_user_id;

  delete from public.notification_deliveries where user_id = p_user_id;

  -- The selfie bytes. face_optins and photo_matches cascade with the profile,
  -- but a storage object has no foreign key to cascade through — leaving it
  -- would keep a photograph of a face belonging to somebody who asked to be
  -- forgotten, which is the single worst thing to leave. The transaction-local
  -- switch is storage's own escape hatch for deliberate SQL deletes.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'gallery-media' and name = 'selfies/' || p_user_id::text;

  -- The avatar files, same reasoning: no FK reaches them, and the face must
  -- not outlive the person (migration 0051).
  delete from storage.objects
   where bucket_id = 'avatars'
     and (storage.foldername(name))[1] = p_user_id::text;

  -- Free text this member wrote, on rows that survive as anonymised history.
  update public.orders
     set delivery_note = null
   where recipient_id = p_user_id and delivery_note is not null;

  update public.orders
     set gift_message = null
   where (buyer_id = p_user_id or recipient_id = p_user_id)
     and gift_message is not null;

  update public.orders
     set size = null
   where recipient_id = p_user_id and size is not null;

  perform app_private.audit('erase_member', 'profiles', p_user_id::text,
                            jsonb_build_object('erased_at', now()));

  delete from auth.users where id = p_user_id;
end;
$$;
