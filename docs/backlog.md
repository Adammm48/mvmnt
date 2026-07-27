# Backlog — requirements accepted but deliberately not built yet

Things MVMNT has asked for that are real requirements, recorded here so they are not lost between
phases. App Spec §0 fixes the phase order and says not to start the next phase until the current one
is confirmed working, so items land here rather than being pulled forward.

---

## Health stats — HealthKit / Health Connect · **Phase 5**

**Asked for:** 2026-07-27 — *"I want stats pulled from Apple Health or equivalent to show them their
stats too."*

**Status:** confirmed requirement, scheduled for Phase 5 where App Spec §10 already places it.

**Why it is not being built now:** it is two phases past the current one, and pulling it forward
would break the build order MVMNT set. It is also gated on things that do not exist yet — an Apple
Developer account, and an Apple entitlement request that Apple reviews separately from the app
itself.

**What it actually involves** (worth knowing before it is scheduled, because it is routinely
underestimated):

- **Two integrations, not one.** HealthKit on iOS and Health Connect on Android share no code
  (App Spec §12). Budget it as two small builds.
- **A separate Apple entitlement.** HealthKit access needs Apple's approval, with a specific,
  non-blanket permission prompt explaining exactly which data types are read and why
  (App Spec §8, Engineering Principles §4).
- **Health data raises the privacy bar sharply** — it is special-category data under GDPR and
  sensitive under Egyptian PDPL. It needs its own consent, its own retention rule and its own
  deletion path, exactly as location got in [ADR 0002](decisions/0002-check-in-location-and-retention.md).
- **Read-only, and never the source of truth for a check-in.** Health data is reported by the
  device; it should decorate a member's own profile, not decide attendance or points.

**Already done in anticipation:** the stack is committed to Expo **dev-client/prebuild** rather than
managed Expo Go from day one, precisely because HealthKit is unreachable from Expo Go and App Spec
§12 flags the later migration as a known friction point. Nothing about Phase 5 will require redoing
Phase 1 work.

**Worth deciding when it is scheduled:** which specific stats. "Stats" could mean steps, distance,
heart rate, VO2 max, or personal bests — each is a separate HealthKit type, a separate permission,
and a separate line in the privacy declaration. The narrowest useful set is the right one to ask
for.

---

## Real meeting points and a real upcoming run

**Asked for:** deferred 2026-07-27 — *"just leave a placeholder for now."*

`supabase/seed.sql` uses placeholder Cairo landmarks (Zamalek Club Gate, Cairo Stadium Track,
Al-Azhar Park, New Cairo Waterway) with approximate coordinates. They are fine for development but
should be replaced with real meeting points before anyone tests against something that looks real,
since the geofence radius is measured from these coordinates.

---

## Open questions carried forward

- **Supabase project region** — see [ADR 0002 §8](decisions/0002-check-in-location-and-retention.md).
  Decide before launch, not after; a region change means migrating production data.
- **Group attendance** — "can I bring my flatmate" has no model, raised by the council and unresolved
  (see [ADR 0001](decisions/0001-phase-1-data-model.md)). Needs a product decision before it needs a
  schema.
- **Check-out** — check-in cannot tell you who is still out on the route, so it is not the safety
  register it is sometimes assumed to be.
