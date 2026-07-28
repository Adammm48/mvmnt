# ADR 0003 — Leaderboard visibility, and the loyalty model

**Status:** Accepted · **Date:** 2026-07-28 · **Phase:** 2
**Reviewed by:** LLM Council, 5 advisors + 3 peer reviews —
[transcript](../council/2026-07-28-phase2-leaderboard-and-privacy-transcript.md)

## Context

App Spec §4.2 specifies a global public leaderboard. Phase 1 deliberately built no member
directory, and the club owner had just instructed that members must not see attendance counts
at all. Those positions conflict.

The council was convened per §0 and was **unanimous against shipping a browsable named
leaderboard** — no advisor defended it, and all three reviewers independently ranked the same
argument strongest:

> Points accrue per check-in, so a member's rank *is* a running attendance counter. Screenshot
> the board weekly, diff it, and you learn exactly which named members attended which run —
> the fact the owner had just ordered hidden.

## Decision

**MVMNT chose the full named leaderboard, capped at the top 100, ranked dynamically.**
The recommendation was put with its reasoning and was overruled. This is the product owner's
call and it is recorded as a deliberate, informed decision — not an oversight.

### What ships

| | |
|---|---|
| **Leaderboard** | Top 100 members by points, named, visible to all signed-in members. Windowed: this month / all-time. |
| **Outside the top 100** | A member always sees their own rank, percentile and points-to-next — so the screen is useful to everyone, not just the top third. |
| **Opt-out** | Any member can remove themselves from the public board at any time. Default is visible. |
| **Tier perks** | **Deferred.** Tiers and badges are recognition only in Phase 2 — no priority sign-up, no discounts. Revisit in Phase 3 when merch exists. |
| **Streaks** | Forgiving: a club-cancelled run never breaks a streak, and members can pause for injury, travel or Ramadan. |

### Why an opt-out, when the owner chose "public"

Added on my initiative, and worth being explicit that it was not requested.

Publishing a member's name alongside a record of how often they attend a known place at a
known time is personal-data processing. Under Egypt's PDPL — and GDPR, if any member is an
EU/UK resident — a person needs some way to object. An opt-out is the cheapest possible
version of that: it costs one boolean and one `WHERE` clause, it takes nothing away from
members who want to compete, and without it the club has no answer for the first member who
asks to be removed.

It is also the mitigation that most directly addresses the council's actual concern
(locatability of regular attendees) while leaving the owner's decision intact.

**Default is visible**, because the owner chose a public board and defaulting everyone to
hidden would quietly undo that.

## Residual risks accepted

Recorded so they are not rediscovered as surprises:

1. **Rank is diffable.** Weekly screenshots of a points-ranked board can reconstruct who
   attended which run. The top-100 cap does not remove this — the top of the board is by
   definition the most regular attendees.
2. **Rewards now create a fraud incentive.** ADR 0002 accepted a spoofable geofence explicitly
   *because* "in Phase 1 a check-in is only a headcount — there is nothing worth stealing yet."
   That premise has now changed. The 30-day check-in evidence is what makes a disputed rank
   re-adjudicable; beyond 30 days it cannot be.
3. **Group attendance still unmodelled** (open since ADR 0001). Members bring guests, so
   per-check-in points misattribute, and the 2,500-person event will distort every rank.

## The loyalty model

**One ranking currency: points.** The council's "pick one number" applies to *ranking*, so
tiers key off lifetime points rather than a separate run count. Badges remain run-count
milestones because "50 runs" is a more legible achievement than "500 points" — they are
discrete achievements, not a competing ranking, so they do not reintroduce the ambiguity the
council warned about.

| | |
|---|---|
| Check-in | 10 points |
| Weekly streak bonus | +2 per consecutive week, capped at +10 |
| Tiers | Starter 0 · Core 500 · Elite 1000 (≈50 and ≈100 runs) |
| Badges | 50 / 100 / 250 runs attended |

### Engineering decisions carried from the council

- **Append-only `point_events`** with `UNIQUE (user_id, run_id, kind)`. That constraint is the
  design: awards become idempotent and replayable, and the rules can change without lying to
  members about history. Never a mutable integer on the profile.
- **Every points function takes `p_now timestamptz DEFAULT now()`.** Without it, streak logic
  cannot be tested without waiting real weeks.
- **Backfill emits no notifications.** Awarding points for existing check-in history would
  enqueue milestone and streak notifications for every member retroactively; they would sit
  unsent (no APNs credentials yet) and fire the day credentials land.

## Consequences

**The privacy policy and the app both already promise a leaderboard** —
`docs/privacy-policy.md` says the display name is kept "for the leaderboard in a future
release", and the profile screen tells members *"This is what other members see on the
leaderboard later."* Both must now describe what actually ships, including the opt-out. That
is a notice obligation, not a nicety.

## Revisit this when

- **A member asks to be removed**, or an organiser reports someone gaming check-ins — the
  first is handled by the opt-out, the second needs the Phase 1 evidence trail within 30 days.
- **Merch lands (Phase 3)** and tier perks become real. Points then become a debt that cannot
  be devalued, and priority sign-up gets decided properly.
- **Real performance data exists** (Phase 4 routes, Phase 5 health). Ranking could then reflect
  distance or effort rather than attendance alone — which is what the owner actually asked for
  and what the app cannot yet supply.
