-- ============================================================================
-- 0011 · Retention and erasure
--
-- The policy in ADR 0002 §5-6, made executable. A retention rule that only
-- exists in a document is a retention rule nobody follows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Purge precise location data 30 days after capture.
--
-- The check-in itself survives — checked_in_at and check_in_method stay, so
-- attendance history and Phase 2 points are unaffected. Only the coordinates
-- go, because their sole purpose (adjudicating a disputed check-in) has expired
-- by then.
-- ---------------------------------------------------------------------------
create or replace function public.purge_expired_location_data()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted integer;
begin
  delete from public.check_in_evidence
   where server_ts < now() - interval '30 days';

  get diagnostics v_deleted = row_count;

  if v_deleted > 0 then
    perform app_private.audit(
      'purge_location_data', 'check_in_evidence', null,
      jsonb_build_object('rows_deleted', v_deleted, 'retention_days', 30),
      null  -- system action, no human actor
    );
  end if;

  return v_deleted;
end;
$$;

comment on function public.purge_expired_location_data is
  'Deletes check-in coordinates older than 30 days (ADR 0002 §5). Run daily by the scheduled Edge Function. Idempotent.';

revoke execute on function public.purge_expired_location_data() from public, anon, authenticated;
grant  execute on function public.purge_expired_location_data() to service_role;

-- ---------------------------------------------------------------------------
-- Erasure.
--
-- The tension: Article 17 says delete, but an append-only attendance history is
-- the thing we deliberately built so the club can see signup-versus-turnout.
-- Deleting attendance rows outright would silently corrupt headcounts for runs
-- that already happened.
--
-- Resolution: personal data is destroyed, the anonymous fact of an attendance
-- is kept. run_attendance.user_id and run_attendance_events.user_id are ON
-- DELETE SET NULL for exactly this reason — after erasure those rows describe
-- "somebody attended", which is not personal data.
--
-- Location evidence and devices are hard-deleted, not anonymised: coordinates
-- are personal data regardless of whose name is attached.
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

  -- Audit BEFORE the auth.users delete cascades actor references away.
  perform app_private.audit('erase_member', 'profiles', p_user_id::text,
                            jsonb_build_object('erased_at', now()));

  -- Cascades to profiles; profiles' ON DELETE SET NULL then anonymises the
  -- attendance and event rows rather than removing them.
  delete from auth.users where id = p_user_id;
end;
$$;

comment on function public.erase_member is
  'GDPR Art. 17 erasure. Destroys personal data; leaves anonymised attendance so past headcounts stay correct (ADR 0002 §6).';

grant execute on function public.erase_member(uuid) to authenticated;
