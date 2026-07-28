-- ============================================================================
-- 0014 · Actually run the scheduler
--
-- scheduler_tick() and purge_expired_location_data() existed but nothing ever
-- called them. Every reminder was enqueued with a scheduled_for that nothing
-- would ever act on, runs never advanced from published to in_progress on
-- their own, and the 30-day location purge promised in ADR 0002 §5 never ran.
-- The whole notification timeline was inert.
--
-- WHAT IS SCHEDULED HERE vs WHAT IS NOT
--
-- Both functions below are pure SQL, so pg_cron can call them directly with no
-- secret to store and nothing to authenticate against. That covers: advancing
-- run statuses, enqueueing notifications, and fanning them out to per-device
-- delivery rows.
--
-- It does NOT cover actually SENDING a push, which needs an outbound HTTP call
-- to Expo and therefore the Edge Function. That stays a separate schedule and
-- is set up when push credentials exist — see the note at the bottom. Until
-- then deliveries accumulate as 'pending', which is the honest state: queued,
-- because sending is not configured yet.
-- ============================================================================

create extension if not exists pg_cron;

-- pg_cron jobs run as the role that scheduled them. This migration runs as the
-- database owner, which owns both functions, so the EXECUTE revokes that keep
-- them away from members do not get in the way here.

-- Unschedule first so re-running this migration replaces rather than duplicates
-- (older pg_cron does not upsert on job name).
do $$
begin
  perform cron.unschedule('mvmnt-scheduler-tick');
exception when others then
  null;  -- not scheduled yet
end $$;

do $$
begin
  perform cron.unschedule('mvmnt-purge-location');
exception when others then
  null;
end $$;

-- Every minute. Reminders are scheduled to the minute (19:00 the evening
-- before, two hours before the start), so a coarser interval delays them by up
-- to its own length — a "morning of" reminder arriving 15 minutes late is a
-- worse product than one arriving on time.
--
-- Cheap to run when idle: the due-notification lookup is a partial index scan
-- over `processed_at is null`, and the status sweeps are indexed on
-- (status, starts_at). A tick with nothing to do touches almost nothing.
select cron.schedule(
  'mvmnt-scheduler-tick',
  '* * * * *',
  $$select public.scheduler_tick()$$
);

-- Daily at 03:15 UTC — a quiet hour for the club, and deliberately not on the
-- hour, where every other scheduled job in the world piles up.
--
-- Idempotent, so a missed day self-corrects on the next run rather than
-- leaving location data past its retention window indefinitely.
select cron.schedule(
  'mvmnt-purge-location',
  '15 3 * * *',
  $$select public.purge_expired_location_data()$$
);

-- ---------------------------------------------------------------------------
-- STILL TO DO, when MVMNT owns an Apple Developer account and a Firebase
-- project (see docs/backlog.md):
--
-- Sending a push needs an HTTP call to Expo, so it has to go through the
-- scheduler Edge Function rather than SQL. That means pg_net plus the service
-- role key, and the key must come from Vault — never inlined into a cron job
-- definition, where it would sit in cron.job in plain text readable by anyone
-- who can read that table.
--
--   select vault.create_secret('<service-role-key>', 'service_role_key');
--
--   select cron.schedule(
--     'mvmnt-send-push',
--     '* * * * *',
--     $$
--     select net.http_post(
--       url     := '<project-url>/functions/v1/scheduler',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || (
--           select decrypted_secret from vault.decrypted_secrets
--           where name = 'service_role_key'
--         )
--       )
--     )
--     $$
--   );
--
-- The Edge Function is idempotent and already calls scheduler_tick() itself,
-- so enabling that alongside the tick above is safe rather than duplicative.
-- ---------------------------------------------------------------------------

comment on extension pg_cron is
  'Runs scheduler_tick() every minute and the location purge daily. Without this the notification timeline never fires — see migration 0014.';
