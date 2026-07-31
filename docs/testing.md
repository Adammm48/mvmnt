# How this project tests

Three layers, each answering a different question. The split exists because
this project shipped the same class of bug four times and none of the tests
caught any of them.

## The bug that shaped this

Four platform calls did nothing on web. A notification tap opened nothing. A
published photo gallery was permitted, correct, and unreachable. Dead sign-in
buttons sat on the first screen for weeks.

Every one was found by a person using the app. The database suites were
thorough and caught none of them, because they asked *"did the function
return?"* and every one of these bugs answers *yes*. The member was simply
never told anything.

So the layers are organised around **who is asking**.

| Layer | Question | Where | Runs |
|---|---|---|---|
| Database | Does the rule hold, for every caller? | `supabase/tests/*.sql` | `npm run db:test` |
| Structure | Can this even be reached or seen? | `scripts/check-*.mjs` | `npm run check:reachable` |
| Visible outcome | Does the member learn what happened? | `tests/e2e/*.mjs` | `npm run test:e2e` |

All three run in CI, including the browser suite — it needs the Supabase
stack, both dev servers and their env vars, which took four attempts to get
right on a runner. Notes in the workflow explain each, because every one of
those failures was a CI-only problem that could not be reproduced locally.

## 1 · Database — the rules

410 assertions over the RPCs and row-level security. This layer is strong and
should stay the first place a new rule is proven: it is fast, it runs every
caller through every policy, and it is where "an organiser can, a member
cannot" belongs.

Two conventions, both enforced by `scripts/test-db.sh` rather than remembered:

- **Every suite wraps itself in one transaction and rolls back at the end of
  the file.** Twice, a block appended after the `rollback;` ran in autocommit
  and committed its fixtures — the suite then passed once after a reset and
  failed for ever after. The runner now refuses to start if any file has SQL
  after its rollback.
- **Never assert a global count.** The seeded database carries demo rows, so
  `count(*) from products` is a number that changes when somebody adds a
  product. Scope every assertion to the fixture's own rows. This has bitten
  products, sponsors, badges, tier history and reports.
- **Never assert a count the clock can change.** The seed's nearest run starts
  twenty minutes after a reset, so it has *completed* by the time anyone runs
  the suite an hour later. Anything counting "completed runs" therefore grows
  on its own. Assert `>= the fixture's own contribution`, and say why — the
  drift-measurement test does exactly this.

## 2 · Structure — reachability

`npm run check:reachable` walks the router's file tree and fails if any screen
has nothing pushing, linking or tabbing to it.

This exists for one bug: a gallery whose only route in was a push notification
the club cannot yet send. Every test navigated to it by URL — the one thing a
member cannot do — so it passed while being unopenable.

The check is a grep, not a graph. It proves a path was *written*, not that it
is reachable under every condition. That is the difference between an oversight
and a decision, which is what it is for.

## 3 · Visible outcome — what the member sees

`npm run test:e2e` drives a real browser against the real stack. The rule for
this layer, and the reason it exists:

> **Assert what is on screen, never that a call succeeded.**
> Every assertion must be a question a member could answer by looking at their
> phone.

So the suite checks that joining a run *says so*; that sharing either opens the
sheet or explains why it cannot; that a failed screen offers a way back; that a
report confirms; that the friend code shows its countdown. Each block maps to a
bug that actually shipped.

Two harness decisions worth knowing:

- **Sessions are cached per email.** The local auth config allows two sign-in
  emails an hour, and a suite that signs the same member in for every block
  silently runs the later blocks with no session — which looks exactly like a
  broken app.
- **A failing assertion prints what was on screen instead.** A test that fails
  without saying what it saw is the same unhelpfulness this suite exists to
  remove.

### Writing a new one

Add a block to `tests/e2e/visible-outcomes.mjs`. Use `openApp` / `openConsole`
from the harness, then `seen(page, text, description)`. Prefer asserting the
*state-independent invariant* over the fixture's current state — the attendance
block reads whichever button is on screen and asserts that pressing it reports
an outcome, rather than assuming the member has not joined yet.

## Running it on a virtual iPhone

    npm run ios:sim            # iPhone 17
    bash scripts/run-ios.sh "iPhone 17 Pro Max"

**This needs no Apple Developer account** — the simulator only needs Xcode,
which is free. That is worth stating plainly because "never run on a phone"
was assumed to be blocked behind the paid account for weeks; the paid account
is for a real device and the App Store, not for this.

The first run generates `ios/` from `app.json` (gitignored and disposable —
`app.json` stays the source of truth for icons, permissions and bundle ids),
installs native pods, builds, and launches. Later runs skip to the build.
JavaScript reloads on its own; only native config changes need
`rm -rf apps/mobile/ios` first.

Two traps the script handles, both of which produce errors that name neither
cause: CocoaPods refuses to run under a non-UTF-8 locale, and a Debug build
fetches its JavaScript from Metro at launch — so `expo start --web` is not
enough, because it serves the web bundle and 404s the iOS one, and the app
opens on a connection error that looks like a broken app.

### On a real iPhone

    npm run ios:phone

**Also needs no paid Apple account.** A free Apple ID signs an app onto your
own device; it expires after 7 days and is renewed by running the command
again. The paid membership is for the App Store and non-expiring builds.

One trap the script exists for: the app is configured to reach the database at
`127.0.0.1`, which on a real phone means THE PHONE ITSELF. The app installs,
opens, and cannot sign in, with nothing on screen explaining why. The script
builds against the Mac's Wi-Fi address instead, and refuses to start unless
the database actually answers on it.

Signing is the one step that cannot be automated — it needs an Apple ID
selected once in Xcode, and the script prints the exact clicks.

This is where the things the simulator cannot fake finally get tested: real
GPS at a meeting point, a camera scanning a code in daylight, and behaviour on
mobile data. Until the hosted project exists the phone loses the database off
Wi-Fi — which makes it the honest moment to watch the offline check-in queue.

### On a real Android phone

    npm run android:phone

**Simpler than iOS in every way that matters**: no Apple ID, no signing step,
and **no 7-day expiry** — the build stays until it is uninstalled. It needs
`adb` and an SDK platform, both free (`brew install --cask
android-commandlinetools`, then `sdkmanager platform-tools platforms;android-35`).

On the phone: tap *Build number* seven times to unlock Developer options, turn
on **USB debugging**, plug in, and set *Use USB for* to **File transfer** —
charge-only mode hides the phone from the Mac entirely, and the resulting
"no device" looks exactly like a broken cable.

Two traps the script handles, both producing identical unexplained symptoms
on the phone:

- `127.0.0.1` is THE PHONE, as on iOS. It builds against the Mac's Wi-Fi
  address after checking the stack answers there.
- **Android blocks plain `http://` in release builds.** The local stack is
  http, so a correctly addressed app is refused by the operating system
  instead of the network. The generated manifest is patched for local builds
  only; `android/` is gitignored and regenerated, and production is https.

**The script deletes the JavaScript bundle before every build, deliberately.**
Gradle's bundle task watches the app directory, but half this app lives in
`packages/shared` — theme, voice, and every run and loyalty helper. Change one
of those and Gradle sees no input change, skips bundling, and packages the
*previous* JavaScript: the build succeeds, installs, launches, and does not
contain your change. It cost an hour once, debugging a feature that was
correct in the database, correct in the console, correct in the tests, and
absent on the phone. Forty seconds of rebundling buys the whole category.

If a change ever seems not to be on the phone, check the bundle's timestamp
before you doubt the code:

    ls -l apps/mobile/android/app/build/generated/assets/react/release/index.android.bundle

(Grepping it proves nothing — release bundles are Hermes bytecode, so the
strings are not readable text.)

Lint is skipped (`-x lintVitalRelease`): it exhausts its own class loader and
fails the build with an OutOfMemoryError *after* the app has compiled
perfectly. Lint belongs to the store pipeline, not to a device install.

Android is worth running even after iOS passes — it found four defects the
iPhone structurally could not (see the debrief's Android section), and it is
the platform most Egyptian club members actually use.

### Build Release before believing anything about speed or config

    bash scripts/run-ios.sh                 # Debug: JS streams from Metro
    # Release, for comparison — see the script's header for the flags

A Debug build fetches every line of JavaScript from a laptop over HTTP on each
launch, with no minification and every development assertion live. It is the
slowest the app will ever be and says nothing about how it performs on a
member's phone; Release compiles a single 5MB bundle into the app.

More importantly, Release is a different program in ways that hide bugs. Two
were found the first time it was built, neither reproducible in Debug or in a
browser: the shipping bundle contained no Supabase URL at all, because Xcode's
bundling phase does not load `.env` (config now goes through
`app.config.js` → `extra`); and the failure was invisible because session
restoration had no error path, so the app sat on a spinner for ever. **Build
Release at least once before trusting anything about configuration.**

## What is deliberately not tested

- **Anything the simulator cannot fake**: real GPS at a meeting point, a
  camera scanning a code in daylight, a push notification arriving, a bad
  mobile connection. The simulator proves the app builds, launches and renders
  natively — which the browser could never prove — but not these.
- **Anything needing a physical device**: real GPS at a meeting point, the
  camera scanning a code in sunlight, push permission prompts, a real
  notification arriving. The web build cannot exercise these, and pretending
  otherwise is worse than the gap. They are the dry-run Saturday's job
  ([dev-todo](dev-todo.md) step 6).
- **Visual regression.** Screenshots are regenerated for the README, not
  diffed. At this scale a person looking at the screen is cheaper and catches
  more than a pixel budget.
