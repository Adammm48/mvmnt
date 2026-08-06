-- Opting out must be able to reach the provider's copy of the face.
--
-- disable_photo_matching() deleted the face_optins row FIRST and wrote an
-- audit entry with empty details after — destroying provider_face_id, the one
-- value the Edge Function needs to delete the face from the recognition
-- service. The comment promised "the Edge Function reads pending deletions
-- from the audit log entry"; the entry had nothing in it to read. Harmless
-- while matching was a stub, a data-protection failure the day it goes live:
-- the club would forget the face while the provider quietly kept it.
--
-- The id is captured into the audit details before the delete. The matcher
-- sweeps entries whose details carry a provider_face_id and no
-- provider_deleted_at, calls the provider's delete, and stamps the entry —
-- so the sweep is idempotent and a crashed run retries next time.

create or replace function public.disable_photo_matching()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_face_id text;
begin
  if v_me is null then
    raise exception 'authentication required'
      using errcode = 'invalid_authorization_specification';
  end if;

  select provider_face_id into v_face_id
    from public.face_optins where user_id = v_me;

  delete from public.photo_matches where user_id = v_me;
  delete from public.face_optins   where user_id = v_me;

  -- Storage guards SQL deletes behind a transaction-local switch, to stop an
  -- accidental DELETE orphaning objects. This one is not accidental: erasing
  -- the face IS the operation (unchanged from the original).
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects
   where bucket_id = 'gallery-media'
     and name = 'selfies/' || v_me::text;

  perform app_private.audit(
    'disable_photo_matching', 'face_optins', v_me::text,
    case when v_face_id is null then '{}'::jsonb
         else jsonb_build_object('provider_face_id', v_face_id) end
  );
end;
$$;

comment on function public.disable_photo_matching is
  'Deletes the selfie, the opt-in and every match as one unit — and carries '
  'the provider''s face id into the audit entry so the Edge Function can '
  'delete the provider-side copy too. Opting out means the club AND its '
  'provider forget your face (ADR 0005 §2).';
