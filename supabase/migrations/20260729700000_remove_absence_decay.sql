-- ============================================================================
-- 0046 · Absence decay is removed
--
-- Owner decision, 2026-07-29, after the end-of-build council review argued
-- against it: docking points for missed Saturdays is a product risk in a club
-- whose actual problem is turnout. A member who has drifted away and opens the
-- app to find they have *lost* something is being given a reason not to come
-- back, at exactly the moment the app should be doing the opposite.
--
-- Migration 0025 built it on a defensible argument, so it is worth being clear
-- about which part of that argument survives and which does not.
--
-- WHAT 0025 GOT RIGHT, AND WHAT IT COSTS TO GIVE UP
--
-- 0025's real point was: a tier ceiling reachable in six months only means
-- something if points can also fall. Otherwise every regular is Legend by their
-- second season and stays Legend whatever happens next — the top rung ends up
-- measuring how long ago somebody joined rather than what they are doing now.
-- That reasoning is sound, and removing decay does have that consequence.
--
-- It is accepted, because the app already measures "now" twice, in ways that
-- cost a member nothing when life gets in the way:
--
--   · the STREAK counts consecutive weeks and resets on its own — present tense
--     by construction, and framed as something you have rather than something
--     you lose;
--   · the LEADERBOARD takes a window, so a monthly board already answers "who
--     is showing up lately" without touching anybody's total.
--
-- So the tier becomes what a tier in a running club normally is: a record of
-- what you have done, which nobody takes off you. You do not hand back a
-- marathon medal for a quiet winter.
--
-- WHAT IS KEPT, AND WHY
--
--   · The `absence` point kind stays in the enum. Postgres cannot remove an
--     enum value, and any historical rows must keep rendering — the app already
--     describes them as "Away from the club".
--   · point_event_stands() keeps handling 'absence', so those historical rows
--     still count exactly as they did. Changing the predicate would silently
--     restore points to anybody who was ever charged.
--   · consecutive_missed_runs() stays. It is a *measurement*, not a penalty,
--     and it is the honest raw material for the opposite feature: a "we have
--     missed you" nudge rather than a fine. Not built here — that is a product
--     decision, and this migration is deliberately only a removal.
--
-- The trigger and the function that applied the charge are dropped. Nothing
-- deducts points automatically any more; an organiser adjustment remains the
-- only way a total goes down, and that one is deliberate, attributed and
-- audited.
-- ============================================================================

drop trigger if exists runs_apply_absence_decay on public.runs;
drop function if exists app_private.on_run_completed_apply_decay();
drop function if exists app_private.apply_absence_decay(uuid);

comment on function public.consecutive_missed_runs is
  'Completed club runs since the member last checked in. Counts the club''s schedule, not weeks — a fortnight with no run is not a miss. A measurement only: nothing deducts points for absence (migration 0046).';
