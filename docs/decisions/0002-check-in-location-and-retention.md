# ADR 0002 — Geofenced check-in, the evidence we keep, and how long we keep it

**Status:** Accepted · **Date:** 2026-07-27 · **Phase:** 1
**Supersedes:** nothing · **Related:** [ADR 0001](0001-phase-1-data-model.md)

## Context

Check-in marks a member as publicly "in" for a run. From Phase 2 it also earns loyalty points that
feed a public leaderboard, so a check-in has value and therefore a motive to fake it.

Two mechanisms were considered: a rotating QR code displayed at the meeting point, or a GPS
geofence. **The product owner chose the geofence**, having been told it is spoofable. That decision
is settled and this ADR does not relitigate it — it records what follows from it.

The council (see `docs/council/2026-07-27-phase1-data-model-transcript.md`) reframed the problem in
a way that changed the design:

- **False negatives are the live risk, not cheaters.** Denied location permission, a phone in a
  locker, battery saver, and urban GPS drift will all deny a check-in to someone who genuinely
  turned up. At ~300 people weekly, that will happen every week. Spoofing might never happen.
- **In Phase 1 a check-in is only a headcount.** There is nothing worth stealing yet. The value
  appears in Phase 2, and Phase 2 inherits Phase 1's data.
- Therefore: **do not build fraud detection now. Record enough evidence that fraud can be
  adjudicated later**, and build the human override that fixes false negatives today.

All five advisors urged storing more location data. **None mentioned the legal obligation that
creates** — four of five peer reviewers flagged the omission. That is the gap this ADR closes.

## Decision

### 1. The geofence prompts; it does not decide

The app detects proximity and then asks: *"Looks like you're here — check in?"* One tap. It never
checks someone in silently.

Rationale: a silent verdict gives the member no receipt. When it fails they find out later via a
wrong leaderboard, and then they are arguing with an organiser about an event neither of them can
see. The tap costs nothing and makes the moment visible. Geofence still gates it — the button is
only offered inside the radius and the server re-validates independently.

### 2. The server never trusts the client's claim

The client sends coordinates; `public.check_in()` recomputes the distance server-side and applies
the radius and time-window rules. A client asserting "I am in range" is ignored. This is
non-negotiable under Engineering Principles §3.

### 3. Admin manual check-in and un-check-in ship in Phase 1

This is the highest-value mitigation available and the cheapest to build. It fixes every
false-negative case, and it is also the actual anti-cheat: at a run where everyone can see each
other, an organiser removing a check-in is more effective than any client-side detection.

### 4. We store the claim, not the verdict

Location evidence lives in `check_in_evidence`, a 1:1 side table keyed by attendance:
`method`, `reported_lat`, `reported_lng`, `accuracy_m`, `distance_m`, `client_ts`, `server_ts`.

**Deviation from the council's advice, deliberately:** advisors said to put these columns on the
attendance row. A side table is better here for two reasons — purging is a `DELETE` rather than a
wide `UPDATE` that rewrites every attendance row, and the frequently-read attendance row carries no
location data at all, so no RLS policy or Realtime payload can leak coordinates by accident.

`method` stays on `run_attendance` because the UI shows it ("checked in by organiser") and it is not
personal location data.

### 5. Retention: precise coordinates are deleted after 30 days

| Data | Retention | Why |
|---|---|---|
| The fact of a check-in (`checked_in_at`, `method`) | Kept | It is the attendance record and the basis of the member's own history and points |
| Precise coordinates, accuracy, distance | **30 days**, then hard-deleted | Only needed to adjudicate a disputed check-in, which happens within days of a run |
| `run_attendance_events` audit rows | Kept, but hold no location data | Sequence of state changes only |

30 days rather than 90: disputes surface within days of a run, monthly leaderboard windows do not
need coordinates, and the shorter window is the more defensible one under data-minimisation. A
scheduled `purge_expired_location_data()` enforces it — the policy is executable, not just written
down here.

### 6. Erasure

Deleting a member hard-deletes their `check_in_evidence` and `push_tokens`. Their
`run_attendance` and `run_attendance_events` rows are **anonymised, not deleted** — `user_id` is
nulled — so historical headcounts for past runs stay correct.

This is the compromise between Article 17 and an append-only log, and it is why the event log was
designed to hold no personal data beyond the user reference. Records nothing about the person once
that reference is gone.

### 7. Lawful basis and consent

Location is processed on **consent**, collected in-app at the point of first use with a specific
explanation, not a blanket permission prompt (Engineering Principles §4). Consent is refusable
without losing access to check-in: **a member who declines location can still be checked in by an
organiser.** Location is never collected in the background — only in the foreground while a run is
active, which also avoids the Play Store prominent-disclosure requirement noted in App Spec §12.

### 8. Jurisdiction — corrected 2026-07-27, needs confirmation

App Spec §8 frames the privacy obligations under **UK/EU GDPR**. The club is in **Cairo**
(confirmed when the timezone was set to `Africa/Cairo`), which makes that framing wrong, or at least
incomplete. Egypt has its own **Personal Data Protection Law (Law No. 151 of 2020)**.

This does not change any decision above — consent, minimisation, a fixed retention window and a
working erasure path are the right design under either regime, and the stricter reading is the one
already built. But three things follow, and none of them is an engineering decision:

1. **GDPR may not be the governing law.** It applies to a Cairo club only if MVMNT offers services
   to people in the EU/UK or monitors their behaviour. If some members are EU/UK residents, both
   regimes apply at once. If none are, Egyptian PDPL governs and the ADR's GDPR references are
   aspirational rather than binding.
2. **Egyptian PDPL has obligations GDPR does not**, including registration/licensing requirements
   with the Data Protection Center for entities processing personal data, and explicit rules on
   **cross-border transfer**.
3. **Cross-border transfer is a live issue the moment a Supabase region is chosen.** A Supabase
   project hosted in the EU or US means personal data of Egyptian residents leaves Egypt. That is
   precisely what the transfer rules cover. **Pick the Supabase region deliberately**, and record
   why — this is much cheaper to decide before launch than to migrate afterwards.

I am not qualified to advise on Egyptian law, and this is flagged rather than resolved. The
engineering posture is deliberately the stricter of the two regimes so that confirming the answer
later cannot require rebuilding anything.

### 9. Under-18 members — no additional guardrails, by decision

App Spec §11 lists this as an open item. Asked directly, MVMNT's answer was that it is "a safe
environment for everyone", and no minor-specific guardrails were requested. Phase 1 therefore treats
every member identically.

Recorded rather than assumed, because two consequences follow if minors do in fact attend: consent
for location processing from a minor generally requires a guardian, and the App Store / Play Store
age rating and data-safety declarations change. Both are cheap to address now and awkward later.
**Revisit if the club knowingly signs up under-18s.**

## Consequences

**Accepted:** a determined member with a mock-location app can fake a check-in in Phase 1, and we
will not detect it at the time. We accept this because the evidence to re-adjudicate is retained for
30 days, the social layer catches it at a run where everyone sees each other, and organisers can
remove a check-in.

**Cost:** a 30-day window means fraud discovered later than 30 days cannot be re-examined from
coordinates. Judged acceptable — that data is stale for the purpose anyway.

**Deferred:** device-per-account limits, mock-location flags, plausibility checks against previous
fixes, and rate limiting beyond the basic time window. None are worth building before anyone has
cheated.

## Revisit this when

- **Points go live (Phase 2)** — re-read this ADR then, because the motive to spoof appears at
  exactly that moment. Adding a QR factor on top of the geofence is a server-side change; the
  `method` column already anticipates it.
- Any organiser reports a suspected fake check-in.
- A member asks to be told what location data is held about them (the answer must be findable in
  `check_in_evidence` alone).

## Known gap, out of Phase 1 scope

**Check-in has no check-out.** Three advisors called this a "safety register"; it is not one. It
cannot tell you who is still out on the route after a run ends. If MVMNT wants that property, it is
a separate feature and should be specified as one rather than assumed from check-in.
