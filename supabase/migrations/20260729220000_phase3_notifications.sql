-- ============================================================================
-- 0033 · Copy and wiring for the Phase 3 notifications
--
-- App Spec §6: "gift received" and the sponsor shoutout. Separate from 0030 for
-- the usual reason — a new enum value cannot be used in the transaction that
-- adds it.
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
      -- Named, because the whole point of the gift flow is that somebody chose
      -- this for you rather than a shop sending you a parcel.
      title := coalesce(p_context->>'actor_name', 'A friend') || ' sent you something';
      body  := coalesce(p_context->>'product_name', 'A gift') || ' from the MVMNT shop'
               || ' — open the app to confirm your size';

    when 'sponsor_shoutout' then
      -- The club's message, carrying a sponsor's name. Not the sponsor writing
      -- to members: the copy is the organiser's and the audience is the club's.
      title := coalesce(p_context->>'sponsor_name', 'Today''s run') || ' — with MVMNT';
      body  := coalesce(p_context->>'message', 'Today''s run is supported by our sponsor.');

    else
      raise exception 'no copy defined for notification type %', p_type;
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Telling somebody a gift is waiting.
--
-- Fires when the order is paid, not when it is placed. A gift announced before
-- the money cleared is a gift that might evaporate, and there is no good way to
-- take that message back.
-- ---------------------------------------------------------------------------
create or replace function app_private.on_order_paid_notify_gift()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_buyer text;
begin
  if new.status = 'paid'
     and old.status is distinct from 'paid'
     and new.is_gift
     and new.recipient_id is not null
  then
    select display_name into v_buyer from public.profiles where id = new.buyer_id;

    begin
      perform app_private.enqueue_notification(
        p_type         => 'gift_received',
        p_audience     => 'single_user',
        p_run_id       => null,
        p_target_user  => new.recipient_id,
        p_created_by   => new.buyer_id,
        p_context      => jsonb_build_object(
                            'actor_name', coalesce(v_buyer, 'A friend'),
                            'product_name', new.product_name),
        p_dedupe_extra => 'order:' || new.id::text
      );
    exception when others then
      -- A failed notification must not roll back a paid order.
      raise warning 'gift notification for order % failed: %', new.id, sqlerrm;
    end;
  end if;

  return new;
end;
$$;

create trigger orders_notify_gift
  after update of status on public.orders
  for each row execute function app_private.on_order_paid_notify_gift();

-- ---------------------------------------------------------------------------
-- The sponsor shoutout (§4.5, §6).
--
-- Organiser-composed and organiser-sent. There is deliberately no way for a
-- sponsor to trigger this themselves: the club's notification channel is the
-- club's, and a sponsor who could push to it directly would be renting an
-- audience rather than supporting one.
-- ---------------------------------------------------------------------------
create or replace function public.admin_send_sponsor_shoutout(
  p_sponsor_id uuid,
  p_message    text,
  p_run_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sponsor public.sponsors;
  v_event   uuid;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_message is null or length(trim(p_message)) = 0 then
    raise exception 'write the message members will see' using errcode = 'check_violation';
  end if;

  select * into v_sponsor from public.sponsors where id = p_sponsor_id;
  if not found then
    raise exception 'sponsor not found' using errcode = 'no_data_found';
  end if;
  if current_date < v_sponsor.active_from
     or (v_sponsor.active_to is not null and current_date > v_sponsor.active_to) then
    raise exception 'that sponsorship is not active today'
      using errcode = 'check_violation';
  end if;

  v_event := app_private.enqueue_notification(
    p_type         => 'sponsor_shoutout',
    p_audience     => case when p_run_id is null then 'all_members' else 'run_signed_up' end,
    p_run_id       => p_run_id,
    p_target_user  => null,
    p_context      => jsonb_build_object('sponsor_name', v_sponsor.name,
                                         'message', trim(p_message)),
    -- Two shoutouts for the same sponsor on the same day would be the club
    -- spamming its own members on somebody else's behalf.
    p_dedupe_extra => 'sponsor:' || p_sponsor_id::text || ':'
                      || (now() at time zone app_private.club_timezone())::date::text
  );

  perform app_private.audit('sponsor_shoutout', 'sponsors', p_sponsor_id::text,
                            jsonb_build_object('message', trim(p_message), 'run_id', p_run_id));

  return v_event;
end;
$$;

grant execute on function public.admin_send_sponsor_shoutout(uuid, text, uuid) to authenticated;
