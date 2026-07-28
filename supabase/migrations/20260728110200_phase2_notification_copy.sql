-- ============================================================================
-- 0020 · Copy and wiring for the Phase 2 notification types
--
-- Separate from 0019 because Postgres refuses to USE an enum value in the same
-- transaction that ADDs it, and each migration file is one transaction.
--
-- Two of the six Phase 1 notifications were fully described by their run:
-- "Saturday 6K starts at 07:00 from Zamalek Club Gate" needs nothing else. The
-- Phase 2 pair are not. A poke needs the name of the person who sent it, and a
-- badge has no run at all. So the rendering path grows a context argument
-- rather than growing a parameter per notification type — the next type that
-- needs a fact about something other than a run costs a key, not a signature
-- change and a rewrite of every caller.
-- ============================================================================

-- Both functions gain an argument, so CREATE OR REPLACE would leave the old
-- arity behind as an overload rather than replacing it. For the copy that means
-- two divergent sources of truth for the same wording; for the enqueue path it
-- is worse — an existing four-argument call would match both candidates and
-- fail as ambiguous, which is every run publication in the app.
drop function if exists app_private.render_notification(notification_type, public.runs);
drop function if exists app_private.enqueue_notification(
  notification_type, notification_audience, uuid, uuid, timestamptz, uuid);

-- ---------------------------------------------------------------------------
-- Copy, now with context.
--
-- p_run stays a real parameter rather than being folded into the context: five
-- of the eight types are run-shaped, and passing the whole row keeps their copy
-- reading off typed columns instead of stringly-typed JSON.
-- ---------------------------------------------------------------------------
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
      -- Named on purpose. "A friend wants you there" is anonymous nagging; the
      -- whole point of the mechanic is that a specific person you physically
      -- stood next to is asking. The fallback covers a friend who has since
      -- deleted their account, which anonymises their name (see 0011).
      title := coalesce(p_context->>'actor_name', 'A friend') || ' wants you there';
      body  := p_run.title || ' — ' || day_str || ' ' || time_str
               || ' from ' || p_run.meeting_point_name;

    when 'badge_earned' then
      -- No run: a badge is earned across many of them.
      title := 'Badge unlocked';
      body  := coalesce(p_context->>'badge_label', 'A new badge')
               || ' — that is a lot of early mornings. Well done';

    else
      raise exception 'no copy defined for notification type %', p_type;
  end case;
end;
$$;

-- ---------------------------------------------------------------------------
-- Enqueue, now able to carry context and to exist without a run.
--
-- Every existing call site keeps working untouched: the new parameters default,
-- and the dedupe key is byte-for-byte what it was whenever they are unused.
-- That last part is not cosmetic — a changed key looks like a brand-new event
-- to the ON CONFLICT, so any already-sent notification would send a second time.
-- ---------------------------------------------------------------------------
create or replace function app_private.enqueue_notification(
  p_type          notification_type,
  p_audience      notification_audience,
  p_run_id        uuid,
  p_target_user   uuid default null,
  p_scheduled_for timestamptz default now(),
  p_created_by    uuid default auth.uid(),
  p_context       jsonb default '{}'::jsonb,
  -- Appended to the dedupe key when the type alone does not identify the
  -- occurrence: two friends poking about the same run are two notifications,
  -- and two badges earned on the same day are two notifications.
  p_dedupe_extra  text default null
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
  if p_run_id is not null then
    select * into v_run from public.runs where id = p_run_id;
    if not found then
      raise exception 'run % not found', p_run_id using errcode = 'no_data_found';
    end if;
  elsif p_target_user is null then
    -- Without either, there is nothing to key the notification on and nobody
    -- obvious to send it to.
    raise exception 'a notification needs a run or a target member'
      using errcode = 'check_violation';
  end if;

  select title, body into v_title, v_body
  from app_private.render_notification(p_type, v_run, p_context);

  v_dedupe_key :=
    case when p_run_id is not null
      then 'run:' || p_run_id::text || ':' || p_type::text
           || coalesce(':' || p_target_user::text, '')
      else 'user:' || p_target_user::text || ':' || p_type::text
    end
    || coalesce(':' || p_dedupe_extra, '');

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

-- ---------------------------------------------------------------------------
-- Badges, now announcing themselves.
--
-- 0016 took p_emit_notifications and did nothing with it; the backfill was
-- written against a promise this function had not yet kept. Honouring it here
-- is what stops every historical member being congratulated at once on the day
-- push credentials are added.
--
-- Failure to notify must not fail the check-in that triggered it. A member
-- standing at the meeting point cares that they are checked in; the badge push
-- is a nicety, and letting it roll back the transaction would trade something
-- that matters for something that does not.
-- ---------------------------------------------------------------------------
create or replace function app_private.award_badges(
  p_user_id uuid,
  p_now     timestamptz default now(),
  p_emit_notifications boolean default true
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_runs    integer;
  v_badge   record;
  v_awarded integer := 0;
begin
  v_runs := public.runs_attended(p_user_id);

  for v_badge in
    select b.key, b.label
    from public.badges b
    where b.runs_required <= v_runs
      and not exists (
        select 1 from public.member_badges mb
        where mb.user_id = p_user_id and mb.badge_key = b.key
      )
    order by b.runs_required
  loop
    insert into public.member_badges (user_id, badge_key, earned_at)
    values (p_user_id, v_badge.key, p_now)
    on conflict do nothing;

    v_awarded := v_awarded + 1;

    if p_emit_notifications then
      begin
        perform app_private.enqueue_notification(
          p_type         => 'badge_earned',
          p_audience     => 'single_user',
          p_run_id       => null,
          p_target_user  => p_user_id,
          p_created_by   => null,
          p_context      => jsonb_build_object('badge_label', v_badge.label),
          -- One announcement per badge, forever, even if the awarding path is
          -- somehow re-run.
          p_dedupe_extra => v_badge.key
        );
      exception when others then
        -- Swallowed, but never silently: a badge that stopped announcing itself
        -- would otherwise look like a badge that stopped being awarded.
        raise warning 'badge notification for % (%) failed: %',
          p_user_id, v_badge.key, sqlerrm;
      end;
    end if;
  end loop;

  return v_awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- Poking, now actually reaching the friend.
--
-- 0018 recorded the poke but sent nothing, so the whole mechanic was a row in a
-- table nobody saw.
-- ---------------------------------------------------------------------------
create or replace function public.poke_friend(p_friend_id uuid, p_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_run  public.runs;
  v_name text;
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  if not exists (
    select 1 from public.friendships
    where user_low = least(v_me, p_friend_id)
      and user_high = greatest(v_me, p_friend_id)
  ) then
    -- Friendship is the authorisation. Without this check the poke becomes a
    -- way to message any member whose id you can obtain — precisely the
    -- unsolicited contact §4.4 exists to prevent.
    raise exception 'you can only nudge someone you have added as a friend'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_run from public.runs where id = p_run_id;
  if not found or v_run.status <> 'published' or v_run.starts_at <= now() then
    raise exception 'you can only nudge someone about an upcoming run'
      using errcode = 'check_violation';
  end if;

  -- Nested block so the handler catches the poke insert and nothing else. At
  -- function level it would also swallow a unique violation raised anywhere
  -- below, reporting an unrelated fault as "you already nudged them".
  begin
    insert into public.pokes (from_user, to_user, run_id)
    values (v_me, p_friend_id, p_run_id);
  exception when unique_violation then
    -- No ON CONFLICT: a second attempt should tell the member they already did
    -- it, not silently do nothing and look broken.
    raise exception 'you have already nudged them about this run'
      using errcode = 'check_violation';
  end;

  select display_name into v_name from public.profiles where id = v_me;

  perform app_private.enqueue_notification(
    p_type         => 'friend_poke',
    p_audience     => 'single_user',
    p_run_id       => p_run_id,
    p_target_user  => p_friend_id,
    p_created_by   => v_me,
    p_context      => jsonb_build_object('actor_name', v_name),
    -- The sender belongs in the key. Without it, the first friend to nudge you
    -- about a run silences every other friend — the dedupe would treat their
    -- distinct, separately-capped nudges as one repeated event.
    p_dedupe_extra => 'from:' || v_me::text
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Unfriending has to reach the queue too.
--
-- 0018 deleted the poke rows and stopped there, which left the notification
-- already enqueued for it sitting in the queue: unfriend someone and their
-- nudge still arrives minutes later. That is precisely the outcome the function
-- was written to prevent, and it lives here rather than in 0018 because the
-- friend_poke enum value does not exist yet at that point.
--
-- Only unprocessed events are withdrawn. Once fan-out has run the push is on
-- its way to a device and deleting the row would only destroy the record of it.
-- ---------------------------------------------------------------------------
create or replace function public.remove_friend(p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.friendships
   where user_low = least(v_me, p_friend_id)
     and user_high = greatest(v_me, p_friend_id);

  delete from public.notification_events
   where type = 'friend_poke'
     and processed_at is null
     and ((created_by = v_me and target_user_id = p_friend_id)
       or (created_by = p_friend_id and target_user_id = v_me));

  -- Both directions, so this works the same whoever pressed the button.
  delete from public.pokes
   where (from_user = v_me and to_user = p_friend_id)
      or (from_user = p_friend_id and to_user = v_me);
end;
$$;

comment on function public.remove_friend is
  'Unilateral, immediate, and silent — the other member is not told. A removal that pings the other person is one nobody socially awkward will ever use.';

comment on function public.poke_friend is
  'One nudge per friend per run, enforced by pokes.one_poke_per_friend_per_run. The blast radius is exactly the set of people the member chose to scan a QR with, and unfriending is silent and unilateral.';
