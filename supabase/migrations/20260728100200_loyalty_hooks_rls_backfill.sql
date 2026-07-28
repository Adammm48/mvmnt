-- ============================================================================
-- 0017 · Wiring points into check-in, access rules, and the backfill
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Award on check-in — as a trigger, not by editing the check-in RPCs.
--
-- There are already two paths that set checked_in_at (public.check_in and
-- public.admin_check_in) and Phase 3+ may add more. Calling the award function
-- from each one means every future path has to remember to, and one that
-- forgets fails silently — a member simply never gets their points.
--
-- A trigger on the transition is the single place that cannot be forgotten
-- (Principles §2).
-- ---------------------------------------------------------------------------
create or replace function app_private.on_check_in_award_points()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Only on the transition into a valid check-in. Re-running an update that
  -- leaves checked_in_at unchanged must not re-award, and the ledger's unique
  -- index would reject it anyway — this just avoids the pointless work.
  if new.checked_in_at is not null
     and new.withdrawn_at is null
     and new.user_id is not null
     and (tg_op = 'INSERT' or old.checked_in_at is null or old.withdrawn_at is not null)
  then
    perform app_private.award_check_in_points(new.user_id, new.run_id, new.checked_in_at);
    perform app_private.award_badges(new.user_id, new.checked_in_at);
  end if;

  return new;
end;
$$;

create trigger run_attendance_award_points
  after insert or update of checked_in_at, withdrawn_at on public.run_attendance
  for each row execute function app_private.on_check_in_award_points();

-- ---------------------------------------------------------------------------
-- Access rules
--
-- The ledger is readable only by its owner. The leaderboard does NOT read it
-- directly — leaderboard() is SECURITY DEFINER and exposes only name, avatar
-- and a total. So no member can reconstruct another member's run-by-run
-- history, which is the specific thing that would turn the board into the
-- attendance log the owner asked to hide.
-- ---------------------------------------------------------------------------
alter table public.point_events   enable row level security;
alter table public.member_badges  enable row level security;
alter table public.badges         enable row level security;

create policy point_events_select_own on public.point_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

create policy member_badges_select_own on public.member_badges
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- The badge catalogue is not personal data — everyone can see what there is to
-- earn, which is the point of having milestones at all.
create policy badges_select_all on public.badges
  for select to authenticated
  using (true);

create policy badges_admin_write on public.badges
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Every write goes through a SECURITY DEFINER function that validates first.
revoke insert, update, delete on public.point_events  from authenticated;
revoke insert, update, delete on public.member_badges from authenticated;

grant select on public.point_events            to authenticated;
grant select on public.member_badges           to authenticated;
grant select on public.badges                  to authenticated;
grant select on public.effective_point_events  to authenticated;
grant insert, update, delete on public.badges  to authenticated;

grant select, insert, update, delete on public.point_events  to service_role;
grant select, insert, update, delete on public.member_badges to service_role;
grant select, insert, update, delete on public.badges        to service_role;

grant execute on function public.leaderboard(text)                to authenticated;
grant execute on function public.my_standing(text)                to authenticated;
grant execute on function public.points_total(uuid, timestamptz)  to authenticated;
grant execute on function public.runs_attended(uuid)              to authenticated;
grant execute on function public.current_streak_weeks(uuid, timestamptz) to authenticated;
grant execute on function public.tier_for_points(integer)         to authenticated;
grant execute on function public.points_to_next_tier(integer)     to authenticated;

-- ---------------------------------------------------------------------------
-- Leaderboard opt-out.
--
-- A member controls only their own visibility. Deliberately its own function
-- rather than a column update, so the intent is explicit and auditable — this
-- is a privacy control, not a preference.
-- ---------------------------------------------------------------------------
create or replace function public.set_leaderboard_visibility(p_visible boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles
     set leaderboard_opt_out = not p_visible
   where id = auth.uid();

  perform app_private.audit(
    'set_leaderboard_visibility', 'profiles', auth.uid()::text,
    jsonb_build_object('visible', p_visible)
  );
end;
$$;

grant execute on function public.set_leaderboard_visibility(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- Organiser correction.
--
-- Points disputes will happen, and an organiser needs a way to settle one
-- without hand-editing a ledger. Recorded as an 'adjustment' so it is visibly
-- a human decision rather than something the rules produced, and audited.
-- ---------------------------------------------------------------------------
create or replace function public.admin_adjust_points(
  p_user_id uuid,
  p_points  integer,
  p_note    text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;
  if p_note is null or length(trim(p_note)) = 0 then
    -- A correction with no stated reason is unauditable six months later.
    raise exception 'a reason is required for a points adjustment'
      using errcode = 'check_violation';
  end if;

  insert into public.point_events (user_id, run_id, kind, points, source, note)
  values (p_user_id, null, 'adjustment', p_points, 'admin', trim(p_note));

  perform app_private.audit('adjust_points', 'point_events', p_user_id::text,
                            jsonb_build_object('points', p_points, 'note', p_note));
end;
$$;

grant execute on function public.admin_adjust_points(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Backfill existing history.
--
-- Phase 1 has been recording check-ins already. Those members earned those
-- runs, so their points and badges should reflect them.
--
-- Notifications are suppressed. Awarding across historical check-ins would
-- otherwise enqueue a milestone notification for every member retroactively;
-- with no APNs credentials yet those sit unsent in notification_deliveries and
-- then all fire on the day credentials are added — every member being
-- congratulated at once for something they did months ago.
-- ---------------------------------------------------------------------------
create or replace function public.backfill_loyalty()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row     record;
  v_points  integer := 0;
  v_members integer := 0;
begin
  -- Oldest first, so streak bonuses build up in the order they really happened
  -- rather than every check-in seeing a fully-formed streak behind it.
  for v_row in
    select a.user_id, a.run_id
    from public.run_attendance a
    join public.runs r on r.id = a.run_id
    where a.checked_in_at is not null
      and a.withdrawn_at is null
      and a.user_id is not null
      and r.status <> 'cancelled'
    order by a.checked_in_at
  loop
    v_points := v_points + app_private.award_check_in_points(
      v_row.user_id, v_row.run_id, now(), 'backfill', false
    );
  end loop;

  for v_row in select distinct user_id from public.point_events where user_id is not null loop
    perform app_private.award_badges(v_row.user_id, now(), false);
    v_members := v_members + 1;
  end loop;

  perform app_private.audit('backfill_loyalty', 'point_events', null,
                            jsonb_build_object('points_awarded', v_points, 'members', v_members));

  return jsonb_build_object('points_awarded', v_points, 'members_processed', v_members);
end;
$$;

revoke execute on function public.backfill_loyalty() from public, anon, authenticated;
grant  execute on function public.backfill_loyalty() to service_role;

-- Run it once, now, for the history that already exists.
select public.backfill_loyalty();
