-- ============================================================================
-- 0010 · Row Level Security and grants
--
-- Posture: RLS on every table, no exceptions. Clients get SELECT and almost
-- nothing else — every state change goes through a SECURITY DEFINER RPC in
-- 0008/0009 that validates first. That way the write rules live in one place
-- instead of being spread across a dozen policies (Principles §2, §3).
--
-- Policies target `authenticated` explicitly. `anon` is granted nothing at all:
-- there is no public read surface in Phase 1.
-- ============================================================================

alter table public.profiles              enable row level security;
alter table public.runs                  enable row level security;
alter table public.run_attendance        enable row level security;
alter table public.run_attendance_events enable row level security;
alter table public.check_in_evidence     enable row level security;
alter table public.push_tokens           enable row level security;
alter table public.notification_events   enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.audit_log             enable row level security;
alter table public.feature_flags         enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
--
-- A member can read their own profile and nothing else. There is deliberately
-- no way to browse or search the membership: App Spec §4.4 makes QR-only friend
-- adding a safety measure against unsolicited contact, and that is worth
-- nothing if a member directory is readable through the API. Phase 2 opens
-- exactly as much as the friends feature needs, and no more.
-- ---------------------------------------------------------------------------
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_admin());

create policy profiles_update_own on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- Privilege escalation guard. The UPDATE policy above lets a member edit their
-- own row, which would otherwise include setting role = 'admin' on themselves.
-- A policy cannot express "any column except this one", so it is a trigger.
--
-- The `auth.uid() is null` exemption is the bootstrap path: there is no admin
-- yet when the club is first set up, so the very first one has to be promoted
-- server-side (psql, a migration, or the Supabase SQL editor). Without this,
-- the guard locks everybody out of ever creating an admin at all.
--
-- Safe because a null uid means there is no authenticated caller: every request
-- through PostgREST as `authenticated` carries a sub claim, and `anon` holds no
-- grant or policy that could reach this table in the first place.
create or replace function app_private.guard_profile_role()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role
     and auth.uid() is not null
     and not public.is_admin() then
    raise exception 'only an admin can change a role'
      using errcode = 'insufficient_privilege';
  end if;
  if new.role is distinct from old.role then
    perform app_private.audit('change_role', 'profiles', new.id::text,
                              jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return new;
end;
$$;

create trigger profiles_guard_role
  before update on public.profiles
  for each row execute function app_private.guard_profile_role();

revoke insert, delete on public.profiles from authenticated;

-- ---------------------------------------------------------------------------
-- runs
-- ---------------------------------------------------------------------------
create policy runs_select_visible on public.runs
  for select to authenticated
  using (status <> 'draft' or public.is_admin());

create policy runs_admin_write on public.runs
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- run_attendance
--
-- Read your own; admins read all. Members never read each other's rows — the
-- run detail screen gets its numbers from run_attendance_counts, which exposes
-- aggregates without exposing who.
--
-- No write policies at all: join_run / withdraw_from_run / check_in are the
-- only ways in, and they enforce capacity, timing and the geofence first.
-- ---------------------------------------------------------------------------
create policy attendance_select_own on public.run_attendance
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.run_attendance from authenticated;

create policy attendance_events_select_own on public.run_attendance_events
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.run_attendance_events from authenticated;

-- ---------------------------------------------------------------------------
-- check_in_evidence
--
-- Location data. A member can see their own — they are entitled to know what is
-- held about them (Principles §4, and it makes a subject access request
-- answerable from one table). Nobody else but an admin can, ever.
-- ---------------------------------------------------------------------------
create policy evidence_select_own on public.check_in_evidence
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.run_attendance a
      where a.id = check_in_evidence.attendance_id and a.user_id = auth.uid()
    )
  );

revoke insert, update, delete on public.check_in_evidence from authenticated;

-- ---------------------------------------------------------------------------
-- push_tokens
--
-- Registration goes through register_push_token() so the token-reassignment
-- rule cannot be bypassed. Members may delete their own (signing out a device).
-- ---------------------------------------------------------------------------
create policy push_tokens_select_own on public.push_tokens
  for select to authenticated
  using (user_id = auth.uid());

create policy push_tokens_delete_own on public.push_tokens
  for delete to authenticated
  using (user_id = auth.uid());

revoke insert, update on public.push_tokens from authenticated;

-- ---------------------------------------------------------------------------
-- notifications
--
-- A member sees an event only if it was actually addressed to one of their
-- devices — that powers the in-app notification list without letting anyone
-- enumerate what the club sends to everybody else.
-- ---------------------------------------------------------------------------
create policy notification_events_select_addressed on public.notification_events
  for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.notification_deliveries d
      where d.event_id = notification_events.id and d.user_id = auth.uid()
    )
  );

create policy deliveries_select_own on public.notification_deliveries
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update, delete on public.notification_events     from authenticated;
revoke insert, update, delete on public.notification_deliveries from authenticated;

-- ---------------------------------------------------------------------------
-- audit_log — admins only, and append-only even for them (trigger in 0006).
-- ---------------------------------------------------------------------------
create policy audit_select_admin on public.audit_log
  for select to authenticated
  using (public.is_admin());

revoke insert, update, delete on public.audit_log from authenticated;

-- ---------------------------------------------------------------------------
-- feature_flags — everyone reads (the app branches on them), admins write.
-- ---------------------------------------------------------------------------
create policy flags_select_all on public.feature_flags
  for select to authenticated
  using (true);

create policy flags_admin_write on public.feature_flags
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Table grants — an explicit allowlist.
--
-- Do NOT assume Supabase has already granted broad privileges on new tables in
-- `public`. Current versions do not: a table created by a migration reaches
-- `authenticated` with no SELECT at all, and RLS policies on it are dead
-- letters because the role cannot reach the table to have them evaluated.
--
-- (This was found the hard way. A local harness that mimicked the older,
-- permissive behaviour passed every access-control test while the real stack
-- refused to let a member read their own profile.)
--
-- Two layers, and both must agree: the GRANT decides whether the role may touch
-- the table at all, RLS decides which rows. Least privilege means granting only
-- the verbs each policy above is written to constrain.
-- ---------------------------------------------------------------------------

-- Read-only for members; every change goes through a validating RPC.
grant select on public.runs                    to authenticated;
grant select on public.run_attendance          to authenticated;
grant select on public.run_attendance_events   to authenticated;
grant select on public.check_in_evidence       to authenticated;
grant select on public.notification_events     to authenticated;
grant select on public.notification_deliveries to authenticated;
grant select on public.audit_log               to authenticated;
grant select on public.feature_flags           to authenticated;

-- Members edit their own profile (the role column is guarded by trigger).
grant select, update on public.profiles        to authenticated;

-- Members may sign a device out; registration goes through register_push_token.
grant select, delete on public.push_tokens     to authenticated;

-- Admin write paths. RLS narrows these to admins — the grant only opens the
-- verb, the policy decides who and which rows.
grant insert, update, delete on public.runs          to authenticated;
grant insert, update, delete on public.feature_flags to authenticated;

-- Views.
--
-- run_attendance_counts intentionally bypasses row-level RLS to publish
-- aggregate headcounts ("312 people are already in", App Spec §2). It selects
-- no identifying column, so there is nothing to leak.
grant select on public.run_attendance_counts to authenticated;
grant select on public.run_attendance_view   to authenticated;

-- service_role is the trusted server identity used by Edge Functions. It
-- bypasses RLS by design, so its grants are broad — but it is never exposed to
-- a client, and its key must never be bundled into the app or admin console.
grant select, insert, update, delete on all tables in schema public to service_role;

-- ---------------------------------------------------------------------------
-- Function grants
--
-- EXECUTE is granted to PUBLIC by default in Postgres, so anything that must
-- not be callable by a member has to be revoked explicitly. Missing one of
-- these is the most likely way to put a hole in the model above.
-- ---------------------------------------------------------------------------

-- Member-callable.
grant execute on function public.join_run(uuid, text)                 to authenticated;
grant execute on function public.withdraw_from_run(uuid)              to authenticated;
grant execute on function public.check_in(uuid, double precision, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.register_push_token(text, text)      to authenticated;
grant execute on function public.is_admin(uuid)                       to authenticated;
grant execute on function public.attendance_state(timestamptz, timestamptz, timestamptz) to authenticated;

-- Admin-callable. These check is_admin() internally too — the grant is the
-- outer fence, the check inside is the one that actually decides.
grant execute on function public.publish_run(uuid)                    to authenticated;
grant execute on function public.cancel_run(uuid, text)               to authenticated;
grant execute on function public.start_run(uuid)                      to authenticated;
grant execute on function public.end_run(uuid)                        to authenticated;
grant execute on function public.admin_check_in(uuid, uuid)           to authenticated;
grant execute on function public.admin_remove_check_in(uuid, uuid)    to authenticated;

-- Service role only: the scheduler is not a user-facing operation, and letting
-- a member trigger fan-out would let them force the club's notifications.
revoke execute on function public.scheduler_tick() from public, anon, authenticated;
grant  execute on function public.scheduler_tick() to service_role;

-- anon gets nothing anywhere.
revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;
revoke all on all sequences in schema public from anon;
