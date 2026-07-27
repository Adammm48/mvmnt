-- ============================================================================
-- Test helpers
--
-- Plain SQL assertions rather than pgTAP. pgTAP is a real dependency to install
-- and pin, and it buys formatting — these tests need "did the rule hold?", which
-- an exception answers just as well (Principles §1). They run under psql against
-- any Postgres, including the local Supabase stack.
--
-- Every test file runs inside its own transaction and rolls back, so the suite
-- leaves no state behind and files cannot affect each other.
-- ============================================================================

create schema if not exists tests;

create or replace function tests.assert(cond boolean, msg text)
returns void language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAILED: %', msg using errcode = 'triggered_action_exception';
  end if;
end $$;

create or replace function tests.assert_eq(actual anyelement, expected anyelement, msg text)
returns void language plpgsql as $$
begin
  if actual is distinct from expected then
    raise exception 'FAILED: % (expected %, got %)', msg, expected, actual
      using errcode = 'triggered_action_exception';
  end if;
end $$;

-- Asserts that a statement is rejected. Note the inner BEGIN/EXCEPTION block:
-- it opens a subtransaction, so the failed statement rolls back cleanly and the
-- surrounding test transaction stays usable.
create or replace function tests.assert_rejects(p_sql text, msg text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception
    when triggered_action_exception then
      raise;  -- our own assertion failures must not be swallowed
    when others then
      return;
  end;
  raise exception 'FAILED: expected rejection but statement succeeded — %', msg
    using errcode = 'triggered_action_exception';
end $$;

-- Asserts that a statement changed nothing.
--
-- Distinct from assert_rejects on purpose: RLS does not raise on UPDATE or
-- DELETE, it filters the rows out, so a denied write "succeeds" while affecting
-- zero rows. Using assert_rejects for those would report a pass whether the
-- policy worked or not. (INSERT is different — a WITH CHECK violation does
-- raise, so assert_rejects is right there.)
create or replace function tests.assert_denied(p_sql text, msg text)
returns void language plpgsql as $$
declare v_rows bigint;
begin
  begin
    execute p_sql;
    get diagnostics v_rows = row_count;
  exception
    when triggered_action_exception then raise;
    when others then return;  -- raising is also a valid denial
  end;
  if v_rows <> 0 then
    raise exception 'FAILED: % (% row(s) changed)', msg, v_rows
      using errcode = 'triggered_action_exception';
  end if;
end $$;

-- Create a member. The on_auth_user_created trigger makes the profile.
create or replace function tests.make_member(p_name text, p_admin boolean default false)
returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, p_name || '@example.test', jsonb_build_object('full_name', p_name));
  if p_admin then
    update public.profiles set role = 'admin' where id = v_id;
  end if;
  return v_id;
end $$;

-- Impersonate a member for RLS purposes: sets the JWT claim auth.uid() reads,
-- and switches to the `authenticated` role so policies actually apply (the
-- table owner and superusers bypass RLS, which would make every test pass).
create or replace function tests.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create or replace function tests.act_as_system()
returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
end $$;

grant usage on schema tests to authenticated;
grant execute on all functions in schema tests to authenticated;

-- A convenient fixture: a published run starting in two hours at a known point
-- (Zamalek Club Gate, London).
create or replace function tests.make_run(
  p_admin    uuid,
  p_capacity integer default null,
  p_starts   timestamptz default now() + interval '2 hours',
  p_publish  boolean default true
)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  insert into public.runs (
    title, starts_at, ends_at, meeting_point_name,
    meeting_point_lat, meeting_point_lng, capacity, created_by, pace_groups
  )
  values (
    'Saturday 6K', p_starts, p_starts + interval '90 minutes', 'Zamalek Club Gate',
    30.044400, 31.235700, p_capacity, p_admin, array['easy','steady']
  )
  returning id into v_id;

  if p_publish then
    -- publish_run is admin-only and reads auth.uid(); impersonate without
    -- leaving the role switched, since callers continue as the system.
    perform set_config('request.jwt.claims',
      json_build_object('sub', p_admin, 'role', 'authenticated')::text, true);
    perform public.publish_run(v_id);
    perform set_config('request.jwt.claims', '', true);
  end if;

  return v_id;
end $$;
