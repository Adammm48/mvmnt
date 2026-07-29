-- ============================================================================
-- 0028 · The ones nobody tells you about
--
-- "Adam noticed…" — badges that are not on the list, awarded for things the
-- club already records. A milestone you can see coming is a target; one that
-- arrives unannounced is a small piece of delight, and it only works if nobody
-- can grind toward it.
--
-- WHY THESE THREE
--
-- Every one is derivable from data the app already has, with no new tracking
-- and no new permission:
--
--   · 5am club        — check-in time, which is recorded anyway
--   · 100 kilometres  — the distances organisers already set on runs
--   · 30-day streak   — the streak the loyalty system already computes
--
-- A "rain run" was on the wish list and is not here: it needs a weather service
-- for every past run at every meeting point, which is a paid API and a new
-- outbound dependency for one joke. Recorded in docs/backlog.md rather than
-- half-built.
--
-- HIDDEN, NOT SECRET
--
-- `is_secret` keeps them off the badge grid until earned. It is not a security
-- property — anyone reading this file can see the list — it is a UI one, and
-- the whole point of them.
-- ============================================================================

alter table public.badges
  add column is_secret boolean not null default false,
  -- Nullable so a secret badge can be awarded by rule rather than run count;
  -- the existing four keep their thresholds untouched.
  add column hint text;

comment on column public.badges.is_secret is
  'Hidden from the badge grid until earned. A UI property, not a security one — the rules are in migration 0028.';

insert into public.badges (key, label, runs_required, sort_order, is_secret, hint) values
  ('secret_dawn',     'The 5am club',      0, 10, true, 'Checked in before 6am'),
  ('secret_100k',     '100 kilometres',    0, 11, true, '100km of club runs, all told'),
  ('secret_streak30', 'Thirty days',       0, 12, true, 'A month without missing');

-- ---------------------------------------------------------------------------
-- The rules.
--
-- Written as one function per badge rather than a clever table of predicates:
-- three hand-written rules are easier to read, and each is a different shape.
-- ---------------------------------------------------------------------------
create or replace function app_private.award_secret_badges(
  p_user_id uuid,
  p_now     timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_awarded integer := 0;
begin
  -- Before 6am, in the club's timezone. A member in another timezone on holiday
  -- is judged by the club's clock, which is the clock the run happened on.
  if exists (
    select 1
    from public.run_attendance a
    where a.user_id = p_user_id
      and a.checked_in_at is not null
      and a.withdrawn_at is null
      and extract(hour from (a.checked_in_at at time zone app_private.club_timezone())) < 6
  ) then
    insert into public.member_badges (user_id, badge_key, earned_at)
    values (p_user_id, 'secret_dawn', p_now)
    on conflict do nothing;
    if found then v_awarded := v_awarded + 1; end if;
  end if;

  -- 100km across attended runs. Runs with no stated distance count as zero
  -- rather than being guessed at.
  if (
    select coalesce(sum(r.distance_meters), 0)
    from public.run_attendance a
    join public.runs r on r.id = a.run_id
    where a.user_id = p_user_id
      and a.checked_in_at is not null
      and a.withdrawn_at is null
  ) >= 100000 then
    insert into public.member_badges (user_id, badge_key, earned_at)
    values (p_user_id, 'secret_100k', p_now)
    on conflict do nothing;
    if found then v_awarded := v_awarded + 1; end if;
  end if;

  -- Four consecutive weeks is a month in a club that runs weekly. Reusing the
  -- streak the loyalty system already computes means this badge and the streak
  -- on the profile can never disagree.
  if public.current_streak_weeks(p_user_id, p_now) >= 4 then
    insert into public.member_badges (user_id, badge_key, earned_at)
    values (p_user_id, 'secret_streak30', p_now)
    on conflict do nothing;
    if found then v_awarded := v_awarded + 1; end if;
  end if;

  return v_awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- Hooked to the same moment as everything else.
--
-- award_badges already runs on the check-in transition, and every one of these
-- rules can only become true because somebody checked in. Extending that
-- function rather than adding a second trigger keeps one path from check-in to
-- "what did that earn me?".
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
    where not b.is_secret
      and b.runs_required <= v_runs
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
          p_dedupe_extra => v_badge.key
        );
      exception when others then
        raise warning 'badge notification for % (%) failed: %',
          p_user_id, v_badge.key, sqlerrm;
      end;
    end if;
  end loop;

  -- The hidden ones award silently. No notification: being told about a secret
  -- badge by a push notification is the one way to make it not a secret, and
  -- finding it on your own profile is the whole experience.
  v_awarded := v_awarded + app_private.award_secret_badges(p_user_id, p_now);

  return v_awarded;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the profile asks for.
--
-- Returns the visible catalogue plus any secret badge this member has actually
-- earned — so an unearned secret is absent rather than greyed out, which is the
-- difference between a surprise and a to-do list.
-- ---------------------------------------------------------------------------
create or replace function public.my_badges()
returns table (
  key         text,
  label       text,
  hint        text,
  is_secret   boolean,
  runs_required integer,
  sort_order  integer,
  earned_at   timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select b.key, b.label, b.hint, b.is_secret, b.runs_required, b.sort_order, mb.earned_at
  from public.badges b
  left join public.member_badges mb
    on mb.badge_key = b.key and mb.user_id = auth.uid()
  where not b.is_secret or mb.earned_at is not null
  order by b.is_secret, b.sort_order;
$$;

grant execute on function public.my_badges() to authenticated;

-- Award the hidden ones against history, so a member who already qualified does
-- not have to wait for their next run to find out.
do $$
declare v_row record;
begin
  for v_row in select id from public.profiles loop
    perform app_private.award_secret_badges(v_row.id, now());
  end loop;
end $$;
