# ADR 0004 · Live location during a run

**Status:** accepted · 2026-07-29
**Context:** App Spec §4.7 ("members can optionally share live location so
friends … can see progress start to finish") and §12's cross-platform note
recommending foreground-only scope. Spec §0 asks for a design review before
implementing the live-location approach; this ADR is that review, written up
as a decision record. The final whole-system review remains outstanding and is
tracked in [open-items](../open-items.md).

---

## 1. The question

Live location is the most privacy-sensitive thing this app will ever do, and
the easiest to over-build. The decisions that matter:

1. What is stored, and for how long?
2. Who can see a member's position?
3. How does the position travel — Realtime channels, or the database?
4. Foreground or background collection?

## 2. What is stored: one row, overwritten, never a trail

A member sharing live location gets **exactly one row** — `(run_id, user_id)`
is the primary key — upserted with their latest position. There is no history
table, no append, no way to reconstruct where someone was ninety seconds ago.

This is the load-bearing decision, and it is the same one ADR 0002 made about
check-ins: the privacy policy's central promise is *"we do not build a history
of your movements"*, and the schema should make that promise structurally
impossible to break rather than policy-dependent. A `live_positions` table
that only ever holds the current point **is not a movement history by
construction.** Nobody has to remember to purge a trail that cannot exist.

Rows die three ways, all automatic:

- the member stops sharing (the app deletes its own row);
- the run ends (`end_run` and the scheduler delete every row for the run);
- the row goes stale — the scheduler deletes anything not updated for two
  minutes, which covers a crashed app, a dead battery, or a member who walked
  off without toggling anything.

## 3. Who sees it: friends, opt-in, per run

Visibility is **friends only** — the people added by scanning a code in
person. The spec mentions "friends/leaderboard-followers"; there is no
follower concept in this app and this ADR deliberately does not invent one,
because "anyone who follows the leaderboard can watch you move" is exactly
the unsolicited-contact surface the QR-only friend system exists to prevent.
If the club wants a broader spectator mode later, that is its own decision
with its own review.

Sharing is **opt-in each run**, off by default, with an explicit toggle while
the run is in progress. Nothing about signing up, checking in, or having
shared last week turns it on. The server enforces every part of this:
RLS lets a member write only their own row, only while checked in to a run
that is actually in progress, and lets a member read only rows belonging to
their friends (organisers read all sharers' rows — see §7). The toggle in
the UI is a convenience; the database is the rule.

## 4. Transport: the database, polled — not Realtime channels

The obvious modern answer is Supabase Realtime broadcast. It was considered
and rejected for v1, for reasons in order of weight:

1. **Authorisation.** Broadcast channel access control lives in Realtime's
   own authorisation layer, separate from the RLS model every other rule in
   this system uses. The friends-only rule would exist twice, in two
   dialects, and drift. With a plain table, the read rule is one RLS policy
   in the same file, tested by the same harness as everything else.
2. **Testability.** `supabase/tests/*` is plain SQL. A table's policies are
   provable there; a websocket channel's are not.
3. **Scale honesty.** A Saturday run is 100–150 people. If every one of them
   shared (they will not — it is opt-in) and every one polled every ten
   seconds, that is ~15 requests/second of single-row indexed reads against
   the free-tier Postgres that already handles check-in bursts. The 2,500
   person event is a peak-load test item (spec §12), not a design driver.

The polling interval is ten seconds while the screen is open. The table
shape is deliberately Realtime-compatible — if polling ever feels laggy,
subscribing to `postgres_changes` on the same table with the same RLS is an
additive change, not a redesign.

## 5. Foreground only, while a run is in progress

Position is read only while the app is open in the foreground and the run is
in progress, using the same one-shot location plumbing as check-in, on a
timer. No background location entitlement is requested on either platform.

Spec §12 already recommends this ("foreground-only, while a run is active —
that covers the real use case"): background location triggers Google Play's
prominent-disclosure-plus-demo-video review and Apple's equivalent scrutiny,
for a feature whose real use is a friend glancing at the map mid-run. The
honest cost: a member who pockets their phone stops updating until they look
again, and their dot goes grey ("last seen 40s ago") rather than lying about
being current.

## 6. Display: dots on the route shape, not a map SDK

Friends' positions render as dots overlaid on the existing SVG route shape
(`RouteMap`), using the same projection the polyline uses. No map SDK, no
API key, no per-platform map rendering — the question mid-run is "how far
along is Sara", and a dot at two-thirds of the loop answers it. This also
means live tracking degrades gracefully on a run with no published route:
the toggle still works, and friends see "out on the run · last seen 12s ago"
as text without a shape to pin it to.

## 7. What was deliberately not built

- **A movement trail**, per §2. Also rules out replays and post-run pace
  analysis from this data — Phase 5's HealthKit integration is the honest
  source for that.
- **Organiser surveillance of non-sharers.** Organisers can see the positions
  of members who have turned sharing on — the club's stated trust model is
  that organisers see the club's records in full, and "who is still out on
  the course?" is a genuine run-day safety question. But the opt-in is the
  boundary for them too: a member who never toggled sharing is invisible to
  organisers exactly as they are to everyone else. There is no all-members
  map and no way to switch sharing on for somebody else.
- **Followers/spectators**, per §3.
- **Realtime channels**, per §4 — reconsidered the day polling measurably
  hurts.
