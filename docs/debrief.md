# The build debrief

One document collecting every phase debrief, for the owner. The short
version of what exists, why it is shaped the way it is, what broke along the
way, and — at the bottom — **the list of things only you can do**. Updated as
of 2026-07-29, at the end of the Phase 4 build.

If you read nothing else: **the app does everything up to and including
Phase 4 of the spec**, it is tested (ten database suites plus structural
guards, green in CI on every push), and nothing is blocked on engineering —
everything still open is a decision or an account that has to be yours.

---

## Phase 1 — Core (sign-up, check-in, runs, notifications, console)

Members sign in with a 6-digit emailed code — no passwords anywhere. They see
upcoming runs as photo cards, join (or land on the waitlist, and are told
which *before* tapping), and check in at the meeting point by GPS. The server
decides everything: capacity, waitlist order, whether a check-in's
coordinates are close enough. Your console creates, publishes and cancels
runs, with a map pin for the meeting point and a run-day screen for checking
in anyone whose phone let them down — which is the designed fallback, not an
afterthought.

Decisions that still shape everything:

- **Every rule lives in Postgres**, behind RPCs and row-level security. The
  apps are allowed to *ask*; the database decides. A bug in a screen cannot
  leak another member's data or oversell a run.
- **Check-in coordinates are deleted after 30 days**, automatically. The
  record that somebody attended stays; where they stood does not.
- **No member directory.** A member can read exactly one profile: their own.
  Everything social that came later respects this.
- **Notifications are idempotent** end to end — a retry cannot double-send.

## Phase 2 — Community (leaderboard, friends, loyalty, tiers)

Points for showing up, streaks for consecutive weeks, badges, and the five
tiers you named — **Rookie, Runner, Competitor, Elite, Legend** — reachable
in six months of Saturdays. (Decay — losing points for missed runs — was
built and then removed on your call after the council: it hands a member who
has drifted a reason not to come back. Points only go up now; a tier records
what you have done, and the streak and monthly board carry current form.)
Crossing a tier opens the chest ("Adam the Great has gifted you…" — the
reward strings are still yours to fill in). The leaderboard shows the top
100 with each member's own standing above it, and any member can hide
themselves from it without losing anything.

Friends are **QR-only, in person**: an 8-character code that lives sixty
seconds and dies on first use — per your instruction, no off switch needed
because expiry *is* the off switch. Friends see one thing: whether you're
coming to the next run. The poke exists and is capped.

The organiser side grew the members directory (organiser-only, full record —
your "the organiser has all the trust" rule), promote/demote with the
founder's account protected from demotion, and a written break-glass
recovery script.

## Phase 3 — Commerce (shop, gifts, sponsors)

The catalogue, orders and stock that cannot oversell under concurrency,
points spendable as a discount (10 piastres/point — **a guess awaiting your
rate**), and gifts that can only go to someone added by scanning a code in
person. **No payment gateway** — Stripe does not serve Egypt-based
businesses, and the real alternatives (Paymob/Fawry/Accept) need quotes only
you can obtain — so an order reserves stock and the club takes payment in
person, and the app says so plainly.

Sponsors get placements with honest reporting: reach is counted **once per
person per day** by construction, so a sponsor hears "137 people saw you",
never an inflatable view count and never a name.

## Phase 4 — Routes, photos, live location

- **Routes**: you draw the route by clicking along the streets in the
  console; publishing it is a separate act that notifies exactly the people
  signed up, once. Members see it on a real map, on the same streets you
  clicked — still with no map SDK and no API key. (The first version drew the
  shape alone on a dark card. You called it correctly: without streets under
  it, it represented nothing.)
- **Photo galleries**: your Drive folders (pre-run / run / after / camera)
  per run, in a **private** bucket. Nothing is visible until you publish;
  publishing tells exactly the people who checked in, once; every image is a
  short-lived signed link, so nothing is shareable by URL. You can delete
  any photo — that is the takedown route the privacy policy points at.
- **Live location** ([ADR 0004](decisions/0004-live-tracking.md)): opt-in
  per run, off by default, friends-and-organisers only, foreground only.
  The one that matters: the database keeps **one row per sharer,
  overwritten** — a movement trail is structurally impossible, not merely
  forbidden. Dots die when the toggle flips, when the run ends, or after two
  minutes of silence. Your run-day screen shows who is still out on the
  course, on a real map, with named ageing pins.

## After the phases — the sweep

- **Load-tested at your real numbers** (100–150 typical, 300 peak — your
  correction): every burst clears in under a third of a second with zero
  errors; a ~1,800-member headroom run queues but never breaks. Full method
  and tables in [load-test.md](load-test.md).
- **The voice reaches every phase**, subtly: ambient lines are daily-stable
  and muted; the rest fire once, on moments — an order landing, a gift going
  out, the sharing switch flipping on. Easter eggs ride along at ~4%
  everywhere. "Developed by Adam Elbasiony" is on both sign-in pages.
- **A dormant Phase 1 bug found and fixed**: tapping a push notification had
  never opened anything. Now photos-ready lands on the gallery, everything
  else on its run — live the day push credentials exist.
- **Structural guards in the test suite**: every table must have RLS, every
  `SECURITY DEFINER` function must pin its search path. A future migration
  that forgets either fails CI instead of shipping a hole.

## Phase 5 — built to the edge of the missing accounts

- **Find me in photos**: a member takes one selfie in-app (never from the
  library), and published galleries grow a "You" tab of photos the matcher
  thinks they are in. Opting out deletes the selfie, the enrolment and
  every match as one unit — the club forgets the face. The only missing
  piece is the recognition-service account: the matcher Edge Function
  refuses loudly until its key exists, and the app says "matching is not
  switched on yet" instead of pretending. The day you sign up for a
  provider, matching goes live with no code change on the app side.
- **Your stats**: the club half (runs, kilometres, streak, tier) works
  today, from attendance alone. The phone half (steps, pace, heart rate)
  renders through one adapter seam that currently — honestly — reports no
  health source exists, and promises on-screen that those numbers will
  never reach the club's servers ([ADR 0005](decisions/0005-phase-5-health-and-faces.md)).
- **Consent is recorded, not remembered**: first open asks 18+ and photo
  permission separately, stores both with the policy version, and the photo
  answer is a plain switch in the profile forever after. The app account is
  18+ (a minor cannot consent to their own data); under-18s run with the
  club and an organiser checks them in.

## The look, second edition

You produced the club's real mark — MVMNT, black on white — and the app now
wears it: white base, ink text and buttons, **green only ever means yes**
(checked in, streak kept, approved), amber only ever celebrates (badges,
chest, live dots), and the five tier colours re-tuned to stay readable on
white. A bottom tab bar carries the five rooms — Home, Board, Photos, Shop,
Profile — with icons drawn in-house, and photos became labelled cards with
real covers instead of a text link. The console matches.

## The bug pattern worth remembering

The worst bugs in this build shared one shape: **code that ran without error
and told nobody anything.** Four platform calls failed silently on web
(alerts, confirms, sharing, the offline check-in queue) — every one found by
*you* using the app, not by tests, because the tests asserted the code ran
rather than that the member was told. All of them now report a visible
outcome, and the tests assert the telling. The second pattern: two values
that happened to be equal, written as if they were the same thing — both
instances only surfaced when something changed. The README documents both
patterns so they stay found.

Both patterns recurred on Android months later, which is the useful part:
they are not bugs that were fixed, they are shapes the codebase is prone to.
See below.

---

## Android, and what a second platform found

The app had only ever been built for iPhone. Putting it on a Samsung Galaxy
S23 Ultra (`npm run android:phone`, no paid account, no expiry) took an
afternoon and found four defects, none of which any amount of further iPhone
testing would have surfaced.

- **A missing package.** `expo-router` imports `@expo/ui/jetpack-compose` for
  its Android toolbar. It was not installed, and iOS takes a different code
  path — so every native library compiled and the JavaScript bundle then
  failed to resolve. Installed; the iOS scripts now also reinstall pods when
  a dependency has been added, because otherwise adding it would have broken
  the iPhone build with a missing-symbol link error naming nothing useful.
- **Edge-to-edge.** Android draws apps *under* the navigation bar. The last
  line of every pushed screen was unreachable — the stats screen ended
  mid-sentence, and the gallery's "find me in photos" link could not be read
  or tapped. Fixed once in the root stack's `contentStyle`; the tab bar and
  sign-in opt out explicitly because they already inset themselves. The first
  attempt padded them twice and left a white band under the tabs — worth
  knowing, because the fix looks right until you see the tab bar.
- **Two copies again.** `orders.tsx` carried two `cancel()` functions: a dead
  one holding the only success message, and a live one that reloaded the list
  in silence. So cancelling an order left the checkout banner — "It's yours.
  Pay at the run" — sitting above an order marked *Cancelled*. The dead copy
  is gone and the row's actions now take an `onDone(message)` that cannot be
  omitted: reporting the outcome is the prop's type, not a convention.
- **The blank-image bug's last survivor.** The order row handed a stored
  *path* straight to `<Image>`, so every order thumbnail was a blank square —
  the same defect as the blank shop, in the one screen that fix had missed.
  A cancelled order also still read "−280 pts" when the points had already
  been refunded; the ledger was right and the screen was lying about it.

And a fifth, found later and worse than the other four because it makes the
build itself lie: **Gradle shipped a stale JavaScript bundle.** Its bundle
task watches `apps/mobile`, but half this app lives in `packages/shared`.
Change a helper there and Gradle sees no input change, skips bundling, and
packages the *previous* JavaScript — so the build succeeds, installs,
launches, and does not contain the change. It presented as a feature that was
correct in the database, correct in the console, correct in every test, and
absent on the phone; the tell was the bundle's timestamp, 45 minutes older
than the build. `run-android.sh` now deletes the bundle first, which costs
about forty seconds and removes the whole category. Worth remembering as the
build-tooling cousin of the app's own recurring bug: something ran, reported
success, and quietly did nothing.

Two things a desk cannot test and a run can: GPS check-in at a real meeting
point, and the camera scanning a friend's code in daylight.

Android is also the platform that matters commercially in Egypt — most club
members are on it — so a demo now runs on both.

## Meeting points: derived by default, overridable on purpose

Members get **Get directions →** on a run, which opens the Google Maps app at
the meeting point. Two things decide where that goes, and the split between
them is the interesting part.

**By default it is derived from the pin.** The meeting point already exists
as coordinates — `not null`, placed by dragging a pin on a Leaflet map in the
console — so `meetingPointMapsUrl(run)` builds Google's documented
cross-platform URL from them. No API key, no SDK, no per-platform branch, and
every run that already existed got directions the day this shipped, with no
organiser work at all.

**`maps_url` overrides it when the organiser has something better** — a
Google Maps *place*, which names the destination and can point at a specific
gate rather than a bare coordinate. That is a real gap in what a pin can say,
and the owner asked for it.

The reason it is safe to have both is worth keeping. Normally two stored
values for one fact is this codebase's oldest trap, and the fear here was
concrete: send members somewhere the geofence is not, and they stand at the
wrong corner unable to check in. That does not happen, because **the override
is navigation only** — `check_in()` measures from `meeting_point_lat/lng` and
never reads `maps_url`. The two values are *permitted* to disagree because
only one of them decides anything. A test in `02_check_in.sql` points the
link at another country and asserts someone at the pin still checks in; if
that ever fails, the asymmetry has been broken and the trap is real again.

The rest is guardrails: a `maps_url_is_https` check constraint, the same rule
stated in the console as a sentence before Save (a constraint violation is a
correct rejection and a terrible explanation), and the console showing the
pin's own link beside the map so "is the pin right" stays answerable
separately from "where do members get sent".

---

## The two lists that remain

Everything still open is now split cleanly in two:
[**owner-questionnaire.md**](owner-questionnaire.md) — every decision, asset
and account only you can provide, answerable inline with no technical
knowledge; and [**dev-todo.md**](dev-todo.md) — the engineering each answer
unblocks, in execution order. Nothing in the second list can start before
something in the first.

## Things worth knowing for later

**Only you can do these** (full detail: [open-items.md](open-items.md), and
`npm run check:placeholders` keeps the code-level list honest):

1. **Privacy policy, four open questions** — hosting region, minors, data
   controller registration, and how photo consent is obtained at runs. This
   blocks app-store submission; everything else can proceed around it.
2. **Tier rewards** — the chest currently promises a placeholder string per
   tier; you said you would name the real rewards.
3. **The point rate** — 10 piastres/point was my guess; check it against
   real merch prices.
4. **Your contact links** — the About page has GitHub only; portfolio,
   LinkedIn and email render "coming soon" until you fill `CONTACT_LINKS`.
5. **Payment gateway quotes** — Paymob/Fawry/Accept, needed only when the
   club wants in-app payment; the reserve-and-pay-in-person flow works now.
6. **Apple Developer + Firebase accounts, owned by MVMNT** — the moment they
   exist, push notifications go live by flipping the `push_delivery` flag;
   the entire pipeline behind it is built and logged.
7. **Real meeting points, routes, product photos and sponsor terms** — all
   placeholder today, all replaceable from the console with no developer.
8. **The end-of-build council review** the spec asks for — I recorded it as
   owed rather than spending your credits on it; say the word when you want
   it run.

**Operational facts:**

- The free Supabase tier genuinely covers 300 members; the $25/month Pro
  tier is insurance (no project sleeping, daily backups) — see
  [costs.md](costs.md). Before another 2,500-person event, re-run the load
  test against a staging project and test push throughput.
- Organisers can do everything from the console — runs, routes, photos,
  members, merch, sponsors, rewards. Nothing operational needs a developer.
- If the founding organiser account is ever lost:
  `scripts/restore-organiser.sql`, run by whoever holds database access.
- Phase 5 (HealthKit, AI face-matching) is specified and deliberately
  unbuilt: HealthKit needs a physical-device build under MVMNT's Apple
  account, and face-matching should be bought (a managed recognition API),
  which needs an account and a budget decision.
