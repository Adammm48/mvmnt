-- ============================================================================
-- 0007 · Rendering, enqueueing and fanning out notifications
--
-- Every notification in the app takes this path. Copy is written once, here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Copy.
--
-- The single source of truth for notification wording (Principles §2). The
-- mobile app, admin console and delivery worker all read the rendered strings
-- off notification_events; none of them formats its own.
--
-- Times render in the club's timezone (app_private.club_timezone()); the run
-- happens at a physical meeting point regardless of where a member's phone
-- thinks it is.
-- ---------------------------------------------------------------------------
create or replace function app_private.render_notification(
  p_type notification_type,
  p_run  public.runs,
  out title text,
  out body  text
)
language plpgsql
stable
as $$
declare
  local_start timestamp := p_run.starts_at at time zone app_private.club_timezone();
  time_str    text      := to_char(local_start, 'HH24:MI');
  day_str     text      := to_char(local_start, 'FMDay');
begin
  case p_type
    when 'run_published' then
      title := p_run.title || ' just dropped';
      body  := day_str || ' ' || time_str || ' from ' || p_run.meeting_point_name
               || ' — grab your spot';

    when 'reminder_evening_before' then
      title := 'Tomorrow: ' || p_run.title;
      body  := time_str || ' at ' || p_run.meeting_point_name || '. See you there';

    when 'reminder_morning_of' then
      title := 'Today: ' || p_run.title;
      body  := time_str || ' at ' || p_run.meeting_point_name || '. See you there';

    when 'run_started' then
      title := 'The run has started';
      body  := p_run.title || ' is under way';

    when 'run_ended' then
      title := 'Nice work — that''s a wrap';
      body  := 'Thanks for coming out to ' || p_run.title;

    when 'waitlist_promoted' then
      title := 'A spot opened up';
      body  := 'You''re in for ' || p_run.title || ', ' || day_str || ' ' || time_str;

    else
      raise exception 'no copy defined for notification type %', p_type;
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enqueue.
--
-- Idempotent by construction: the dedupe_key is derived from what the event IS,
-- so calling this twice for the same real-world occurrence inserts once. Every
-- caller can therefore retry freely without reasoning about duplicates.
-- ---------------------------------------------------------------------------
create or replace function app_private.enqueue_notification(
  p_type          notification_type,
  p_audience      notification_audience,
  p_run_id        uuid,
  p_target_user   uuid default null,
  p_scheduled_for timestamptz default now(),
  p_created_by    uuid default auth.uid()
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run        public.runs;
  v_title      text;
  v_body       text;
  v_dedupe_key text;
  v_event_id   uuid;
begin
  select * into v_run from public.runs where id = p_run_id;
  if not found then
    raise exception 'run % not found', p_run_id using errcode = 'no_data_found';
  end if;

  select title, body into v_title, v_body
  from app_private.render_notification(p_type, v_run);

  v_dedupe_key := 'run:' || p_run_id::text || ':' || p_type::text
                  || coalesce(':' || p_target_user::text, '');

  insert into public.notification_events (
    type, audience, run_id, target_user_id, dedupe_key, title, body,
    scheduled_for, created_by
  )
  values (
    p_type, p_audience, p_run_id, p_target_user, v_dedupe_key, v_title, v_body,
    p_scheduled_for, p_created_by
  )
  on conflict (dedupe_key) do nothing
  returning id into v_event_id;

  -- NULL means it was already enqueued. That is a success, not a failure.
  return v_event_id;
end;
$$;

comment on function app_private.enqueue_notification is
  'Idempotent. Returns the new event id, or NULL if this notification was already enqueued.';

-- ---------------------------------------------------------------------------
-- Fan-out: resolve the audience to devices.
--
-- Separated from enqueueing so that a fan-out failure can be retried without
-- re-rendering or re-deciding anything, and so the burst path (2,500 members ×
-- their devices) is one set-based INSERT rather than a loop.
--
-- Members with no registered device get a 'skipped' row rather than nothing, so
-- "why didn't I get that?" is answerable from the table (Principles §7).
-- ---------------------------------------------------------------------------
create or replace function app_private.fan_out_notification(p_event_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.notification_events;
  v_count integer;
begin
  select * into v_event from public.notification_events where id = p_event_id for update;
  if not found then
    raise exception 'notification event % not found', p_event_id using errcode = 'no_data_found';
  end if;

  with audience as (
    select p.id as user_id
    from public.profiles p
    where case v_event.audience
      when 'all_members' then true
      when 'single_user' then p.id = v_event.target_user_id
      when 'run_signed_up' then exists (
        select 1 from public.run_attendance a
        where a.run_id = v_event.run_id and a.user_id = p.id
          and a.signed_up_at is not null and a.withdrawn_at is null
      )
      when 'run_checked_in' then exists (
        select 1 from public.run_attendance a
        where a.run_id = v_event.run_id and a.user_id = p.id
          and a.checked_in_at is not null and a.withdrawn_at is null
      )
    end
  )
  insert into public.notification_deliveries (event_id, user_id, push_token, status)
  select
    p_event_id,
    aud.user_id,
    coalesce(t.expo_push_token, 'no-device:' || aud.user_id::text),
    case when t.expo_push_token is null then 'skipped' else 'pending' end::public.delivery_status
  from audience aud
  left join public.push_tokens t on t.user_id = aud.user_id
  on conflict (event_id, push_token) do nothing;

  get diagnostics v_count = row_count;

  update public.notification_events
     set processed_at = now()
   where id = p_event_id;

  return v_count;
end;
$$;
