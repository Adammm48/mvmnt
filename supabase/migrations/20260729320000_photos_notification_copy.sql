-- ============================================================================
-- 0041 · Copy for the photos-ready notification
--
-- Separate from 0039 because the enum value cannot be used in the migration
-- that adds it, and separate from 0040 to keep the full render function in one
-- readable piece rather than scattering copy across feature migrations.
-- ============================================================================

drop function if exists app_private.render_notification(
  notification_type, public.runs, jsonb);

create or replace function app_private.render_notification(
  p_type    notification_type,
  p_run     public.runs,
  p_context jsonb default '{}'::jsonb,
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

    when 'route_published' then
      -- Named for the run rather than the route: a member cares that Saturday's
      -- plan is settled, not that a polyline was saved.
      title := 'The route for ' || p_run.title || ' is live';
      body  := 'Have a look before ' || day_str || ' — '
               || coalesce(
                    nullif((p_run.distance_meters / 1000)::text, '0') || 'K from ',
                    'starting at ')
               || p_run.meeting_point_name;

    when 'photos_ready' then
      -- Goes only to people who were checked in, so "you" is literally true.
      title := 'Photos from ' || p_run.title || ' are up';
      body  := 'You might be in them — have a look';

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

    when 'friend_poke' then
      title := coalesce(p_context->>'actor_name', 'A friend') || ' wants you there';
      body  := p_run.title || ' — ' || day_str || ' ' || time_str
               || ' from ' || p_run.meeting_point_name;

    when 'badge_earned' then
      title := 'Badge unlocked';
      body  := coalesce(p_context->>'badge_label', 'A new badge')
               || ' — that is a lot of early mornings. Well done';

    when 'gift_received' then
      title := coalesce(p_context->>'actor_name', 'A friend') || ' sent you something';
      body  := coalesce(p_context->>'product_name', 'A gift') || ' from the MVMNT shop'
               || ' — open the app to confirm your size';

    when 'sponsor_shoutout' then
      title := coalesce(p_context->>'sponsor_name', 'Today''s run') || ' — with MVMNT';
      body  := coalesce(p_context->>'message', 'Today''s run is supported by our sponsor.');

    else
      raise exception 'no copy defined for notification type %', p_type;
  end case;
end;
$$;
