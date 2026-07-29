-- ============================================================================
-- BREAK GLASS · Restore organiser access
--
-- Run this in the Supabase SQL editor (Dashboard → SQL Editor) when nobody can
-- get into the organiser console any more. Typical causes:
--
--   · the owner lost access to the email inbox the account signs in with
--   · the founding account was deleted from inside the app
--   · every organiser was demoted, or demoted themselves
--
-- WHY THIS WORKS, AND WHY IT IS NOT A BACKDOOR
--
-- Nothing here bypasses a rule that the app enforces. The role guard in
-- migration 0022 deliberately exempts callers with no authenticated identity
-- (`auth.uid() is null`) — which is exactly what the SQL editor is. That is the
-- same path the very first organiser was created through, and it is available
-- only to somebody who already holds the Supabase project credentials.
--
-- Somebody with those credentials can already read and write every table
-- directly: `service_role` and `postgres` both carry `rolbypassrls`. This script
-- adds no access. It exists so that recovering does not mean improvising
-- against a live database at the worst possible moment.
--
-- Every promotion below is written to `audit_log` by the guard trigger, so the
-- club can see afterwards that it happened, when, and to whom.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- STEP 1 — Look before you touch anything.
--
-- If this already lists somebody with role = 'admin', the club is not locked
-- out and the real problem is a sign-in one. Stop here and fix that instead:
-- check the member can receive email at that address.
-- ----------------------------------------------------------------------------
select p.display_name,
       u.email,
       p.role,
       p.is_founder,
       u.last_sign_in_at
from public.profiles p
join auth.users u on u.id = p.id
where p.role = 'admin' or p.is_founder
order by p.is_founder desc, p.created_at;

-- ----------------------------------------------------------------------------
-- STEP 2 — Promote the account that should have access.
--
-- Replace the email below. It must already exist: the person has to have signed
-- in to the app at least once, which is what creates their profile. Promoting
-- somebody who has never opened the app is not possible, and should not be —
-- there is no account to promote.
--
-- If no founding account exists any more (is_founder was empty in step 1), this
-- promotion claims that flag automatically. See migration 0022.
-- ----------------------------------------------------------------------------
do $$
declare
  v_email text := 'REPLACE_WITH_THE_EMAIL@example.com';   -- ← EDIT THIS
  v_id    uuid;
begin
  select u.id into v_id from auth.users u where lower(u.email) = lower(trim(v_email));

  if v_id is null then
    raise exception
      'No account for %. They must sign in to the app once first — that is what creates the profile.',
      v_email;
  end if;

  update public.profiles set role = 'admin' where id = v_id;

  raise notice 'Promoted % to organiser.', v_email;
end $$;

-- ----------------------------------------------------------------------------
-- STEP 3 — Confirm, and leave a trail.
--
-- Re-run step 1. The account should now show role = 'admin'. The change is
-- already in audit_log; this just puts it somewhere a person will look.
-- ----------------------------------------------------------------------------
select action, entity_id, metadata, occurred_at
from public.audit_log
where action = 'change_role'
order by occurred_at desc
limit 5;

-- ----------------------------------------------------------------------------
-- AFTERWARDS
--
-- Tell the club owner this was done and why. An organiser appearing out of
-- nowhere is indistinguishable from a compromise, and the audit log will not
-- explain itself.
-- ----------------------------------------------------------------------------
