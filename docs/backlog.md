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
would break the build order MVMNT set.

### How hard are the permissions? Not very — and iOS is the easy half

An earlier note in this file claimed HealthKit needs a separate Apple entitlement that Apple reviews
independently. **That was wrong**, and the correction matters for planning:

- **iOS is self-serve.** HealthKit is a standard capability enabled in Xcode and App Store Connect.
  No application, no approval queue, no waiting. The only real prerequisite is the Apple Developer
  Program membership already needed for everything else.
  Required: `NSHealthShareUsageDescription` (and `NSHealthUpdateUsageDescription` if ever writing),
  worded specifically — a vague purpose string is the common rejection, not the health access
  itself. App Review applies Guideline 5.1.3: no health data for advertising, no selling it, a
  privacy policy is mandatory, and HealthKit data must not be stored in iCloud.

- **Android is the one with a real gate.** Health Connect permissions require a **health apps
  declaration form** in the Play Console, reviewed by Google against a list of approved use cases.
  Fitness tracking qualifies, but it is a genuine review that can bounce and take days to a couple
  of weeks. Also needs an in-app permissions rationale screen and a linked privacy policy.

  This is the same asymmetry App Spec §12 already noted for background location: Android is
  stricter, not looser.

- **The actual blocker is a published privacy policy** at a public URL. Both stores require one for
  health data, MVMNT does not have one, and it is writing rather than engineering — so it tends to
  be the thing that holds a release up.

*Store policies move. Re-check the specifics when this is scheduled rather than trusting this note.*

**Other things worth knowing before it is scheduled:**

- **Two integrations, not one.** HealthKit on iOS and Health Connect on Android share no code
  (App Spec §12). Budget it as two small builds.
- **Health data raises the privacy bar sharply** — special-category under GDPR, sensitive under
  Egyptian PDPL. It needs its own consent, retention rule and deletion path, exactly as location got
  in [ADR 0002](decisions/0002-check-in-location-and-retention.md).
- **On-device only — decided 2026-07-27.** MVMNT's instruction: *"I only want them to display, not
  store them for now."* Health data is read from HealthKit/Health Connect and rendered locally, and
  is **never transmitted to Supabase**. No health columns, no health tables, no server-side
  retention rule — because there is nothing on the server to retain.

  This is the cheapest possible version of the feature in privacy terms: it sidesteps storage,
  retention, cross-border transfer and most of both stores' review scrutiny at once. It is also the
  decision to revisit first if health stats are ever meant to feed the leaderboard, since a
  server-side leaderboard cannot be computed from data that never leaves the phone.
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

## Carried out of Phase 2

- **Scanning on the web.** `expo-camera` reads QR codes reliably on iOS and Android;
  in a browser it depends on `BarcodeDetector`, which is not everywhere. The scan
  screen therefore always offers typing the code by hand, and that fallback is what
  the web demo uses. Not a gap to close so much as a constraint to remember — the
  club uses the app, not the browser.
- **Poke volume.** One nudge per friend per run is the cap App Spec §9 recommends,
  so a member with twenty friends could in principle receive twenty notifications
  about one run. Bounded by the fact that every one of those friends was added by
  physically scanning a code, and unfriending is silent and one-sided. Worth
  watching once real people use it; a per-recipient daily cap is the obvious next
  lever if it becomes a complaint.
- **A members screen for organisers.** Points corrections and disabling a friend
  code currently hang off the run-day attendee list, because that is where a
  complaint actually reaches an organiser. A dedicated members directory would be
  more convenient and would also be the one screen in the app that lets someone
  browse the whole membership — which is the thing App Spec §4.4 spent the entire
  friends design avoiding. Deliberately not built.
- **Tie-breaking on the board.** Rank ties share a position, which is correct and
  which the UI now shows honestly (no medal for a shared place). A secondary sort
  — most recent check-in, longest streak — would break more of them, but every
  candidate tiebreak leaks something about *when* somebody ran.

---

## Open questions carried forward

- **Supabase project region** — see [ADR 0002 §8](decisions/0002-check-in-location-and-retention.md).
  Decide before launch, not after; a region change means migrating production data.
- **Group attendance** — "can I bring my flatmate" has no model, raised by the council and unresolved
  (see [ADR 0001](decisions/0001-phase-1-data-model.md)). Needs a product decision before it needs a
  schema.
- **Check-out** — check-in cannot tell you who is still out on the route, so it is not the safety
  register it is sometimes assumed to be.
