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
- **Erasing the founding account** is still allowed, and should be — deletion is a
  legal right and cannot be gated behind "but you run the club". The app now warns
  before it happens, `scripts/restore-organiser.sql` covers the aftermath, and the
  last-organiser backstop in `admin_set_member_role` stops the same thing being
  done by demotion. Nothing outstanding; recorded because the reasoning matters
  more than the code.
- **Tie-breaking on the board.** Rank ties share a position, which is correct and
  which the UI now shows honestly (no medal for a shared place). A secondary sort
  — most recent check-in, longest streak — would break more of them, but every
  candidate tiebreak leaks something about *when* somebody ran.

---

## Waiting on the owner

> Run `npm run check:placeholders` for the live list — it reads the source, so
> it cannot drift from what is actually still open. Reasoning for each is in
> [open-items.md](open-items.md).

- **The tier rewards are placeholders.** 2026-07-29: *"I will tell you what the
  reward for each tier is later — remind me."* All five are seeded with
  plausible copy and flagged `is_placeholder`, so members currently see them
  marked **being confirmed** rather than as offers. Organiser console →
  **Rewards** edits them; no deploy needed. Until they are confirmed the club is
  promising nothing, which is the correct state to launch in but not to stay in.

- **The author's voice is in-app only, deliberately.** The catalogue in
  `packages/shared/src/voice.ts` covers greetings, achievements, empty states,
  loading, errors and rare easter eggs, and every one of them appears inside the
  app. It is **not** in push notifications, and that is a decision rather than an
  omission: those go out under the club's name to the club's members, so a
  developer signature there stops being a signature and becomes advertising in
  somebody else's channel. Easy to change — the copy is in
  `app_private.render_notification` — but it should be the owner's call and the
  club's, not a default.
- **The contact links are placeholders and render as "coming soon".** Portfolio,
  GitHub, LinkedIn and email in `voice.ts` are obviously-wrong URLs and the About
  page refuses to open them. A plausible-looking address that 404s in front of
  300 members is worse than one that is visibly unfinished. Replace before launch.

- **The rain run.** Of the hidden badges on the wish list, three were derivable
  from data the club already has — a 5am check-in, 100km of runs, a month
  without missing — and one was not. "Ran in the rain" needs historical weather
  for every past run at every meeting point, which is a paid API and a new
  outbound dependency for a single joke. Worth doing if a weather integration
  ever arrives for another reason; not worth it on its own.
- **Birthday wishes.** The catalogue has the line, and there is nowhere to put
  it: MVMNT does not store a date of birth and should not start collecting one
  for a greeting. It becomes free the day a profile grows a birthday for some
  other reason — and if it never does, that is the right outcome.
- **Merch and photo-matching lines** (`Adam hopes you love it`, `Adam is looking
  for your photos…`) are written and unwired, because the features are Phase 3
  and Phase 5. They cost nothing sitting in the catalogue and will be there when
  the screens are.

---

## Open questions carried forward

- **Supabase project region** — see [ADR 0002 §8](decisions/0002-check-in-location-and-retention.md).
  Decide before launch, not after; a region change means migrating production data.
- **Group attendance** — "can I bring my flatmate" has no model, raised by the council and unresolved
  (see [ADR 0001](decisions/0001-phase-1-data-model.md)). Needs a product decision before it needs a
  schema.
- **Check-out** — check-in cannot tell you who is still out on the route, so it is not the safety
  register it is sometimes assumed to be.
