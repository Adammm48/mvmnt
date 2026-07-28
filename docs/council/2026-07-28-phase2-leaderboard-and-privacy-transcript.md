# LLM Council — Phase 2: the leaderboard vs the privacy model

**Date:** 2026-07-28
**Convened because:** App Spec §0 requires consequential or hard-to-reverse decisions
(explicitly: data model changes, security-sensitive flows like the QR friend system) to go
through the council before implementation.

**Format:** 5 advisors, independent and blind to each other, then 3 anonymised peer reviews.
(Phase 1 used 5 reviews; 3 here, which was enough — all three converged on the same answer
without prompting.)

---

## The question

Phase 2 = leaderboard, loyalty (points/streaks/badges/tiers), and the QR-only friends system.

The tension put to the council:

> App Spec §4.2 specifies a **global public leaderboard, open to all members**, ranked by
> points. But Phase 1 deliberately built **no member directory** — RLS lets a member read
> exactly one profile, their own, and attendance is exposed only as an aggregate count via a
> view that selects no identifying column. §4.4 and §8 describe QR-only friend adding as a
> deliberate anti-harassment measure *precisely because* it avoids a searchable directory.
> And the club owner has just instructed that members must not see attendance numbers at all.
>
> A global named leaderboard appears to contradict all three.

---

## Where the council agreed

**Unanimous, and the reviewers were unanimous about it too: a live named leaderboard cannot
ship as specified.** Not one advisor defended it.

The strongest argument (3/3 reviewers picked it as the best response) was mechanical rather
than rhetorical:

> Points accrue per check-in, so a member's rank **is a running attendance counter**. Anyone
> who screenshots the board weekly can diff it and learn exactly which named members attended
> which run — the precise fact the owner just ordered the app to stop publishing.

That argument also kills the two obvious escape hatches:

- **Top-N only** doesn't help: the top ten *are* the most regular attendees — the most
  reliably locatable people, at a known place, at a known time.
- **Handles instead of real names** are worse than useless: 300 people who meet weekly
  de-anonymise a handle in one conversation, and it buys false confidence.

Two advisors independently made the same reframe: **recognition is a publishing act, not a
query.** Nobody has a right to *browse* the club; the organiser has a right to *celebrate*
someone, with consent. That distinction resolves the tension without losing the motivation.

## Where the council clashed

**How much to build at all.** One advisor argued the leaderboard is "a borrowed artifact from
Strava, an app for strangers" — decoration, while the privacy design is load-bearing — and
that the honest move is to ship no table whatsoever. Another argued the constraint is the
product and pushed toward richer alternatives (shareable personal run cards, collective club
stats, a reusable scan primitive).

**Chairman's call: the minimalist reading wins**, with one piece of the expansive one kept.
A solo builder shipping alone should not add surface area to a feature the council thinks is
mostly harmful. But the *shareable personal run card* is genuinely good — it is recognition
with zero directory, and the club already lives on Instagram.

## The blind spot the reviews caught

The most privacy-fluent-sounding advisor proposed selling geofenced attendance as **sponsor
inventory** and logging scan direction to identify who recruits whom. Two of three reviewers
independently flagged this as the worst answer in the set: it monetises and enriches exactly
the co-presence data the QR design exists to protect, with no consent path, in a club where
locatability is a real safety concern for some members.

Recorded because the idea is superficially attractive and will come back in Phase 3.

## What every advisor missed

Reviewers converged on findings none of the five advisors raised:

1. **The promise has already been made.** `docs/privacy-policy.md` line 57 states the display
   name is kept "for the leaderboard in a future release", and the profile screen literally
   tells members *"This is what other members see on the leaderboard later."* Whatever is
   decided, **both must be corrected** — this is a notice obligation, not just a schema choice.
2. **The friends system quietly rebuilds the directory.** Friend-visible points and a stored
   scan graph are a leaderboard at n=2, and RLS does not constrain that unless it is designed
   to.
3. **No erasure path is defined** for a published podium, an earned badge, or a scan record.
   Phase 1 solved this for attendance (anonymise, don't delete); Phase 2 reintroduces it.
4. **Group attendance** (already flagged unresolved in ADR 0001): members bring guests, so
   per-check-in points misattribute from day one — and the 2,500-person event distorts every
   rank.
5. **Nobody proposed a kill criterion** — a feature flag, or a falsifiable "did attendance
   actually rise?" test.

---

## Other findings, beyond the leaderboard

**Rewards create a fraud incentive that Phase 1 never had.** ADR 0002 accepted a spoofable
geofence explicitly *because* "in Phase 1 a check-in is only a headcount — there is nothing
worth stealing yet." Attaching points, tiers and merch discounts is the exact trigger that ADR
named for revisiting it. The evidence columns retained for 30 days are what make
re-adjudication possible.

**Streaks will break on Ramadan.** Also on injury, travel, and club-cancelled runs. A streak
that punishes fasting is a guilt engine, and directly contradicts App Spec §2's "progress, not
shame" principle. Cancellations must be neutral; a pause/freeze must ship *with* the feature,
not after complaints.

**Two currencies is a bug, not a nuance.** The spec ranks the leaderboard by *points* but
describes tiers as "100 runs — Elite tier unlocked". Members will ask why 4,000 points isn't
Elite. Pick one number.

**Priority sign-up is regressive.** Raised by the advisor reasoning purely as an ordinary
member: giving the highest-point members first pick of a capped run means the regulars take
the places, and the new, slow, unsure member — the one who most needs a place to build a
habit — gets the waitlist. In a free community club that inverts the goal.

**Backfill will detonate.** Awarding points for existing check-in history will emit
`notification_events` for every member retroactively. Those sit unsent in the queue (no APNs
credentials yet) and fire the day credentials land. Needs an explicit
`p_emit_notifications := false` on the backfill path.

---

## The recommendation

**Ship the loyalty system. Do not ship a browsable leaderboard.**

| | Decision |
|---|---|
| **Leaderboard** | Your own rank and percentile only — "you're 23rd of 312". No other member named, anywhere, ever. |
| **Recognition** | Optional: an organiser-published podium (3–5 names, opt-in per member, pushed not browsable, no scroll, no history) — a publishing act, not a lookup surface. |
| **Personal progress** | Streak, milestones, next badge, and a shareable run card. All self-referential, zero directory. |
| **One currency** | Rank and tier both key off the same number. |
| **Ledger** | Append-only `point_events` with `UNIQUE(user_id, run_id, kind)` — idempotent, replayable, recomputable. Never a mutable integer. |
| **Testability** | Every points function takes `p_now timestamptz DEFAULT now()` — the only way to test streaks without waiting weeks. |
| **Cut from Phase 2** | Priority sign-up (regressive, and it touches Phase 1's tested path), merch discounts (Phase 3 doesn't exist), the month/all-time toggle (ship all-time), and the poke — the spec itself leaves its mechanic undecided, and undecided is not buildable. |

## The one thing to do first

**Get the owner's decision on leaderboard visibility before writing any schema** — it
determines the RLS model, and it is the only question here that cannot be reversed once
members' names have been published.
