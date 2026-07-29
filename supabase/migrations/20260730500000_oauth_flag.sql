-- ============================================================================
-- 0054 · The OAuth switch
--
-- Owner decision, 2026-07-29: sign-in with Apple and Google is wanted. The
-- audit council removed the buttons because they were visible and dead — a
-- store rejection and a lie. This flag squares both: the buttons render ONLY
-- when the flag is on, and the flag goes on the day the OAuth apps exist
-- (Apple Developer account for Sign in with Apple; a Google Cloud OAuth
-- client for Google — both on the owner's questionnaire, section D).
--
-- Flipping it is one console update, no app release: the sign-in screen
-- reads the flag each time it mounts. Apple's rule applies once both exist:
-- if Google sign-in is offered on iOS, Sign in with Apple must be too — so
-- the flag governs the PAIR, never one of them.
-- ============================================================================
insert into public.feature_flags (key, enabled, description) values
  ('oauth_sign_in', false,
   'Show "Continue with Apple/Google" on the sign-in screen. On only once BOTH OAuth apps are configured in Supabase Auth — the pair ships together because App Store rules require Apple sign-in wherever Google sign-in is offered.')
on conflict (key) do nothing;

-- The sign-in screen has no session yet, so the flag must be readable by anon.
grant select on public.feature_flags to anon;
drop policy if exists feature_flags_read on public.feature_flags;
create policy feature_flags_read on public.feature_flags
  for select using (true);
