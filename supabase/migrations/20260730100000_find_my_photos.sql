-- ============================================================================
-- 0049 · Find my photos — the data model
--
-- App Spec §10's AI face-matching, built to ADR 0005's shape: opt-in by one
-- selfie, matched once per gallery at publish time, deletable as a unit, and
-- BOUGHT rather than built — a managed recognition API called from an Edge
-- Function, never an in-house model.
--
-- What ships now is everything except the recognition call itself, which
-- needs a provider account and a budget the club has not chosen (see
-- docs/open-items.md). The seam is one Edge Function; the day the account
-- exists, matching starts working without a schema change.
--
-- THE PRIVACY SHAPE, RESTATED AS CONSTRAINTS
--
--   · No selfie, no matching. Matching runs only over members with a selfie
--     row, and a member without one simply does not exist to the matcher.
--   · The selfie and its provider-side face record are ONE unit: deleting the
--     selfie deletes the match rows and, when the provider is wired, must
--     delete the provider's face record too (the Edge Function's job — the
--     provider_face_id below is the handle it needs).
--   · Matches grant no access. "Photos of you" is a filter over a gallery the
--     member can already see; an unpublished gallery stays invisible, matched
--     or not, enforced by the same photos_published_at gate as the gallery.
--   · A match is a GUESS by a model, and is stored — and shown — as one.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- The selfie: one per member, in the private gallery-media bucket under
-- selfies/<user_id>. Storing the path rather than bytes keeps to the pattern
-- of run_photos: the row is the truth, the bucket is just bytes.
-- ---------------------------------------------------------------------------
create table public.face_optins (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  storage_path     text not null,
  -- The provider's identifier for this face, once enrolled. Null until the
  -- Edge Function has actually enrolled it — which is also the honest signal
  -- for "matching is not live yet".
  provider_face_id text,
  created_at       timestamptz not null default now()
);

comment on table public.face_optins is
  'One selfie per member who asked to be findable in run photos. The selfie, its provider-side face record and every match are one deletable unit (ADR 0005 §2, migration 0049).';

comment on column public.face_optins.provider_face_id is
  'The managed recognition service''s id for this face. Null until enrolment runs — which requires the provider account in docs/open-items.md. The Edge Function must delete this remotely when the row is deleted.';

-- ---------------------------------------------------------------------------
-- Matches: which published photos a member is probably in.
--
-- Computed once, when a gallery is published, per ADR 0005's cost model —
-- recognition APIs bill per image, so the club pays per gallery, not per view.
-- ---------------------------------------------------------------------------
create table public.photo_matches (
  photo_id   uuid not null references public.run_photos(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  -- The model's confidence, 0–100, kept because "shown as a guess" needs the
  -- number: the UI can say so, and a threshold change can re-filter without
  -- re-billing every gallery.
  confidence numeric(5, 2) not null check (confidence between 0 and 100),
  created_at timestamptz not null default now(),
  primary key (photo_id, user_id)
);

comment on table public.photo_matches is
  'A model''s guess that a member appears in a photo. Grants no access — it filters a gallery the member can already see. Rows cascade away with the photo, the member, or the member''s opt-out (migration 0049).';

create index photo_matches_by_user on public.photo_matches (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Two gates, as everywhere.
-- ---------------------------------------------------------------------------
alter table public.face_optins   enable row level security;
alter table public.photo_matches enable row level security;

grant select, insert, delete on public.face_optins   to authenticated;
grant select                 on public.photo_matches to authenticated;
grant all on public.face_optins, public.photo_matches to service_role;

-- Your own opt-in and nobody else's — not even organisers. An organiser has no
-- business browsing members' selfies; the club's trust in organisers is about
-- running the club, and this is not that.
create policy face_optins_own on public.face_optins
  for select to authenticated using (user_id = auth.uid());
create policy face_optins_insert on public.face_optins
  for insert to authenticated with check (user_id = auth.uid());
create policy face_optins_delete on public.face_optins
  for delete to authenticated using (user_id = auth.uid());

-- Your matches, and only in galleries that are actually published — the same
-- gate the gallery itself sits behind, so a match can never leak that an
-- unpublished gallery exists.
create policy photo_matches_own on public.photo_matches
  for select to authenticated
  using (
    user_id = auth.uid()
    and exists (
      select 1
      from public.run_photos ph
      join public.runs r on r.id = ph.run_id
      where ph.id = photo_matches.photo_id
        and r.photos_published_at is not null
    )
  );

-- The selfie bytes: each member reads and writes selfies/<their own id> only.
create policy selfie_own_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'gallery-media'
    and name = 'selfies/' || auth.uid()::text
  );

create policy selfie_own_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'gallery-media'
    and name = 'selfies/' || auth.uid()::text
  );

create policy selfie_own_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'gallery-media'
    and name = 'selfies/' || auth.uid()::text
  );

create policy selfie_own_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'gallery-media'
    and name = 'selfies/' || auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- Opting in and out.
-- ---------------------------------------------------------------------------
create or replace function public.enable_photo_matching()
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

  -- The selfie must exist before the row does: a row without bytes would tell
  -- the matcher to enrol a face that is not there.
  if not exists (
    select 1 from storage.objects
    where bucket_id = 'gallery-media' and name = 'selfies/' || v_me::text
  ) then
    raise exception 'take the selfie first' using errcode = 'check_violation';
  end if;

  insert into public.face_optins (user_id, storage_path)
  values (v_me, 'selfies/' || v_me::text)
  on conflict (user_id) do nothing;

  perform app_private.audit('enable_photo_matching', 'face_optins', v_me::text, '{}'::jsonb);
end;
$$;

create or replace function public.disable_photo_matching()
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

  -- The whole unit, in one act: matches first, then the opt-in row, then the
  -- bytes. The provider-side face record is the Edge Function's to delete —
  -- it holds the credentials — and it reads pending deletions from the audit
  -- log entry written here.
  delete from public.photo_matches where user_id = v_me;
  delete from public.face_optins   where user_id = v_me;

  -- Storage guards SQL deletes behind a transaction-local switch, to stop an
  -- accidental DELETE orphaning objects. This one is not accidental: erasing
  -- the face IS the operation, and going through the Storage API from inside
  -- a database function would invert the dependency for no protection.
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'gallery-media' and name = 'selfies/' || v_me::text;

  perform app_private.audit('disable_photo_matching', 'face_optins', v_me::text, '{}'::jsonb);
end;
$$;

comment on function public.disable_photo_matching is
  'Deletes the selfie, the opt-in and every match as one unit — opting out means the club forgets your face, not just stops using it (ADR 0005 §2).';

-- ---------------------------------------------------------------------------
-- Reading your matches, gallery by gallery.
-- ---------------------------------------------------------------------------
create or replace function public.my_photo_matches(p_run_id uuid)
returns table (photo_id uuid, confidence numeric)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.photo_id, m.confidence
  from public.photo_matches m
  join public.run_photos ph on ph.id = m.photo_id
  join public.runs r on r.id = ph.run_id
  where m.user_id = auth.uid()
    and ph.run_id = p_run_id
    and r.photos_published_at is not null
  order by m.confidence desc;
$$;

grant execute on function public.enable_photo_matching()  to authenticated;
grant execute on function public.disable_photo_matching() to authenticated;
grant execute on function public.my_photo_matches(uuid)   to authenticated;

-- ---------------------------------------------------------------------------
-- Erasure reaches the face too.
-- ---------------------------------------------------------------------------
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

comment on function public.erase_member is
  'GDPR Art. 17 erasure. Destroys personal data — free text on orders, and the selfie bytes that have no foreign key to cascade through — and leaves anonymised attendance and sales history (ADR 0002 §6, migrations 0036 and 0049).';
