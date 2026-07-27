-- ============================================================================
-- 0006 · Audit log and feature flags
-- Principles §3 (log security-sensitive actions) and §9 (feature flags).
-- ============================================================================

create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references public.profiles (id) on delete set null,
  action      text not null,
  entity      text not null,
  entity_id   text,
  metadata    jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

comment on table public.audit_log is
  'Security-sensitive actions: role changes, admin check-ins, run cancellation, moderation. Append-only; readable by admins only.';

create index audit_log_occurred_idx on public.audit_log (occurred_at desc);
create index audit_log_entity_idx   on public.audit_log (entity, entity_id);

-- Same rule as the attendance event log: entries cannot be rewritten, but the
-- actor reference can be cleared when that person is erased. Without the
-- exception, erasing a member who had ever performed an audited action would
-- fail on the ON DELETE SET NULL cascade.
create trigger audit_log_append_only
  before update on public.audit_log
  for each row execute function app_private.allow_anonymisation_only('actor_id');

-- Callable only from SECURITY DEFINER functions in this schema — never granted
-- to clients, so a caller cannot forge audit entries.
create or replace function app_private.audit(
  p_action    text,
  p_entity    text,
  p_entity_id text,
  p_metadata  jsonb default '{}'::jsonb,
  p_actor     uuid  default auth.uid()
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.audit_log (actor_id, action, entity, entity_id, metadata)
  values (p_actor, p_action, p_entity, p_entity_id, coalesce(p_metadata, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------
-- Feature flags
--
-- Phase 1 needs exactly one (geofenced check-in), but the mechanism is here now
-- because the features that most need it — live location, AI photo matching —
-- are the ones it is most painful to retrofit a kill switch onto.
-- ---------------------------------------------------------------------------
create table public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) on delete set null
);

create trigger feature_flags_touch_updated_at
  before update on public.feature_flags
  for each row execute function app_private.touch_updated_at();

insert into public.feature_flags (key, enabled, description) values
  ('geofence_check_in', true,
   'Offer check-in when the member is inside the run''s radius. Turning this off leaves admin check-in as the only route, which is the intended fallback if GPS proves unreliable in the field.'),
  ('push_delivery', false,
   'Actually send to Expo/APNs/FCM. Off until MVMNT owns an Apple Developer account and a Firebase project; deliveries are recorded with status=''logged'' until then.');
