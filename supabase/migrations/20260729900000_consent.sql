-- ============================================================================
-- 0048 · Consent, recorded rather than assumed
--
-- Owner decision, 2026-07-29: consent to be photographed is currently taken
-- verbally at runs, and should become one of the things a member accepts in
-- the app.
--
-- WHY A RECORD AND NOT A CHECKBOX
--
-- Verbal consent is real consent — it is not a lesser thing legally. What it
-- is not is *demonstrable*, and both Egypt's PDPL and the GDPR put the burden
-- on the club to show that consent was given. "We asked everyone at the start"
-- is not a record; it is a memory, and it does not survive a member saying
-- they were never asked.
--
-- So this stores what was accepted, which version of the document it was, and
-- when. The checkbox is the easy half; the row is the point.
--
-- THREE THINGS AT SIGN-UP, DELIBERATELY SEPARATE
--
--   1. The privacy policy and terms — the umbrella.
--   2. Age (18+) — because a minor cannot give valid consent for their own
--      data. Their guardian must, and the club has no guardian-consent flow.
--      Rather than build one now, the APP ACCOUNT is 18+. Under-18s still run
--      with the club exactly as they do today; an organiser checks them in by
--      hand, which is already the designed fallback for anyone whose phone
--      cannot. Nobody is excluded from the club — only from a data-collecting
--      account they cannot lawfully consent to.
--   3. Photos — separated because bundling it into "accept the terms" is
--      precisely the kind of blanket consent that is not freely given, and
--      because it is the one a member is most likely to feel strongly about.
--
-- WHAT PHOTO CONSENT HONESTLY MEANS
--
-- The club cannot promise not to photograph one person in a crowd of 300, and
-- a checkbox implying otherwise would be a lie told to make a screen look
-- compliant. What it can promise is exactly what this records: permission to
-- publish photos from runs in the app, and a standing, easy objection that
-- organisers can see and act on. A member who objects is not photographed out
-- of existence — they are flagged, and their photos come down when spotted or
-- asked for.
--
-- Versioned, so that a materially changed policy can require fresh acceptance
-- instead of silently inheriting an old one.
-- ============================================================================

alter table public.profiles
  -- Which version of the documents this member accepted, and when. Null means
  -- they have not accepted anything yet and the app must ask before letting
  -- them use it.
  add column consent_version    text,
  add column consented_at       timestamptz,
  -- Confirmed at acceptance, never a date of birth: the club needs to know
  -- that somebody asserted they are an adult, not how old they are. Storing a
  -- birth date would be collecting more personal data to answer a yes/no
  -- question (Principles §1 applied to data, not dependencies).
  add column age_confirmed      boolean not null default false,
  -- The member's standing position on their photographs. Default false — no
  -- objection — because it only becomes meaningful once they have accepted,
  -- and acceptance is what sets it.
  add column photo_objection    boolean not null default false;

comment on column public.profiles.age_confirmed is
  'The member asserted they are 18 or over. Not a date of birth — the club needs the answer, not the data behind it. Under-18s run with the club and are checked in by an organiser; the app account is adults-only because a minor cannot give valid consent for their own data (migration 0048).';

comment on column public.profiles.photo_objection is
  'The member has asked not to appear in club photos. Advisory and visible to organisers — the club cannot guarantee nobody is in the background of a crowd shot, and a flag that promised otherwise would be dishonest. Their photos come down on request or when spotted.';

-- ---------------------------------------------------------------------------
-- The append-only record.
--
-- Same shape as every other ledger here: history is written, never edited.
-- Withdrawing photo consent adds a row saying so rather than rewriting the row
-- that said the opposite — because "they consented on the 3rd and withdrew on
-- the 9th" is the fact, and an UPDATE would destroy half of it.
-- ---------------------------------------------------------------------------
create table public.consent_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id) on delete cascade,
  -- 'accepted' on first acceptance or re-acceptance of a new version;
  -- 'photo_objection' / 'photo_objection_lifted' for later changes of mind.
  event            text not null check (event in
                     ('accepted', 'photo_objection', 'photo_objection_lifted')),
  document_version text not null,
  age_confirmed    boolean,
  occurred_at      timestamptz not null default now()
);

create index consent_events_user_idx on public.consent_events (user_id, occurred_at desc);

comment on table public.consent_events is
  'Append-only consent history. Cascades away on erasure: once a member is gone there is nobody whose consent needs demonstrating, and the record would be personal data about a person who asked to be forgotten (migration 0048).';

alter table public.consent_events enable row level security;

-- A member reads their own history and writes none of it — every row comes
-- from the RPCs below.
grant select on public.consent_events to authenticated;
grant all    on public.consent_events to service_role;

create policy consent_events_own on public.consent_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Accepting.
-- ---------------------------------------------------------------------------
create or replace function public.accept_consent(
  p_version       text,
  p_age_confirmed boolean,
  p_photo_ok      boolean default true
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'authentication required'
      using errcode = 'invalid_authorization_specification';
  end if;

  if coalesce(p_version, '') = '' then
    raise exception 'which version?' using errcode = 'check_violation';
  end if;

  -- Refused rather than recorded-as-false. An under-18 cannot consent for
  -- themselves, so there is no version of this row that would be valid, and
  -- writing one would create a record that looks like consent and is not.
  if not coalesce(p_age_confirmed, false) then
    raise exception
      'The app account is for members aged 18 and over. You can still run with the club — an organiser will check you in.'
      using errcode = 'check_violation';
  end if;

  update public.profiles
     set consent_version = p_version,
         consented_at    = now(),
         age_confirmed   = true,
         photo_objection = not coalesce(p_photo_ok, true)
   where id = v_me;

  insert into public.consent_events (user_id, event, document_version, age_confirmed)
  values (v_me, 'accepted', p_version, true);

  if not coalesce(p_photo_ok, true) then
    insert into public.consent_events (user_id, event, document_version)
    values (v_me, 'photo_objection', p_version);
  end if;
end;
$$;

comment on function public.accept_consent is
  'Records acceptance of a specific document version, the 18+ assertion, and the member''s position on photographs. Refuses rather than records when age is not confirmed (migration 0048).';

-- ---------------------------------------------------------------------------
-- Changing your mind about photographs, at any time.
--
-- Its own function because withdrawing consent must be as easy as giving it —
-- that is not a nicety, it is the condition that makes the original consent
-- valid in the first place.
-- ---------------------------------------------------------------------------
create or replace function public.set_photo_objection(p_objects boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_version text;
  v_current boolean;
begin
  if v_me is null then
    raise exception 'authentication required'
      using errcode = 'invalid_authorization_specification';
  end if;

  select consent_version, photo_objection into v_version, v_current
  from public.profiles where id = v_me;

  -- Setting it to what it already is writes no history — otherwise a screen
  -- that saves on every render would fabricate a trail of changes of mind.
  if v_current is not distinct from coalesce(p_objects, false) then
    return;
  end if;

  update public.profiles
     set photo_objection = coalesce(p_objects, false)
   where id = v_me;

  insert into public.consent_events (user_id, event, document_version)
  values (
    v_me,
    case when coalesce(p_objects, false)
      then 'photo_objection' else 'photo_objection_lifted' end,
    coalesce(v_version, 'unversioned')
  );
end;
$$;

comment on function public.set_photo_objection is
  'The member''s standing position on their photographs, changeable at any time. Withdrawal has to be as easy as consent or the consent was never valid (migration 0048).';

grant execute on function public.accept_consent(text, boolean, boolean) to authenticated;
grant execute on function public.set_photo_objection(boolean)           to authenticated;


-- ---------------------------------------------------------------------------
-- The organiser has to be able to see the objection.
--
-- A consent control recorded where nobody acts on it is decoration. The person
-- publishing a gallery is the only one who can honour "please don't post
-- pictures of me", so the flag travels to the members directory alongside
-- everything else they are trusted with.
-- ---------------------------------------------------------------------------
-- Adding a column to the return table changes the function's signature, and
-- CREATE OR REPLACE cannot change a return type — same rule that forces every
-- enum addition into its own migration. Drop, then recreate.
drop function if exists public.admin_members(text, integer);

create or replace function public.admin_members(
  p_search text default null,
  p_limit  integer default 50
)
returns table (
  user_id             uuid,
  display_name        text,
  email               text,
  avatar_url          text,
  role                public.member_role,
  is_founder          boolean,
  points              integer,
  tier                public.member_tier,
  runs_attended       integer,
  streak_weeks        integer,
  last_run_at         timestamptz,
  joined_at           timestamptz,
  leaderboard_opt_out boolean,
  friend_code_active  boolean,
  friend_count        integer,
  -- Standing objection to appearing in club photos. Surfaced here because the
  -- organiser publishing a gallery is the only person who can act on it, and
  -- a consent recorded where nobody sees it is not a control.
  photo_objection     boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id, p.display_name, u.email::text, p.avatar_url, p.role, p.is_founder,
    public.points_total(p.id),
    public.tier_for_points(public.points_total(p.id)),
    public.runs_attended(p.id),
    public.current_streak_weeks(p.id),
    (select max(a.checked_in_at) from public.run_attendance a
      where a.user_id = p.id and a.withdrawn_at is null),
    p.created_at,
    p.leaderboard_opt_out,
    exists (
      select 1 from public.friend_qr_tokens t
      where t.user_id = p.id and t.revoked_at is null and t.expires_at > now()
    ),
    (select count(*)::integer from public.friendships f
      where f.user_low = p.id or f.user_high = p.id),
    p.photo_objection
  from public.profiles p
  join auth.users u on u.id = p.id
  where p_search is null
     or trim(p_search) = ''
     or p.display_name ilike '%' || trim(p_search) || '%'
     or u.email ilike '%' || trim(p_search) || '%'
  order by (select max(a.checked_in_at) from public.run_attendance a
             where a.user_id = p.id and a.withdrawn_at is null) desc nulls last,
           p.display_name
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

grant execute on function public.admin_members(text, integer) to authenticated;
