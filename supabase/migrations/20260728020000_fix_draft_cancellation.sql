-- ============================================================================
-- 0013 · Cancelling a draft must not publish it
--
-- Bug: cancel_run() set status = 'cancelled' regardless of the run's current
-- status. runs_select_visible allows any status other than 'draft' — so
-- cancelling a run that was NEVER published flipped it straight into visible,
-- and every member would see a run they were never told existed, now showing
-- up out of nowhere as "cancelled".
--
-- A draft was never announced, so "cancelling" it should discard it, not give
-- it its first (and only) appearance to members. Safe to delete outright:
-- join_run requires status = 'published', so a draft can have no attendance,
-- no check-in evidence, and nothing enqueued but its own (already-deleted-below)
-- notification. Every table that references runs cascades on delete.
-- ============================================================================

create or replace function public.cancel_run(
  p_run_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_was_draft boolean;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  select (status = 'draft') into v_was_draft
  from public.runs
  where id = p_run_id and status in ('draft', 'published', 'in_progress');

  if not found then
    raise exception 'run not found, or already finished' using errcode = 'no_data_found';
  end if;

  if v_was_draft then
    -- Never visible, so there is nothing to mark cancelled — discard it.
    delete from public.runs where id = p_run_id;
  else
    update public.runs
       set status = 'cancelled', cancelled_at = now(), cancellation_reason = p_reason
     where id = p_run_id;

    delete from public.notification_events
     where run_id = p_run_id and processed_at is null;
  end if;

  perform app_private.audit('cancel_run', 'runs', p_run_id::text,
                            jsonb_build_object('reason', p_reason, 'was_draft', v_was_draft));
end;
$$;

comment on function public.cancel_run is
  'Cancels a published/in_progress run (visible, notified) or discards a draft outright (never visible — nothing to cancel from a member''s perspective).';
