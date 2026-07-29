# Council transcript — whole-system review, 2026-07-29

Anonymisation: A = Executor, B = Contrarian, C = Outsider, D = Expansionist, E = First Principles.

## Advisor responses

### The Contrarian

## Fatal: the geofence is a suggestion, not a control

`supabase/migrations/20260727090700_attendance_rpc.sql:293`

```sql
if v_distance - coalesce(p_accuracy_m, 0) > v_run.check_in_radius_m then
```

`p_accuracy_m` is unbounded client input, subtracted straight from distance. No clamp in the RPC, no check constraint on `check_in_evidence.accuracy_m` (`20260727090300_attendance.sql:258`). One authenticated POST with `p_accuracy_m: 9999999` checks you in from anywhere on Earth — no mock-GPS app, no jailbreak. And `check_in` creates the attendance row if absent, so it's a single call. That converts to points → tiers → `tier_rewards` (free shirt at Legend) → and points are money at 1 piastre each in `place_order`. Clamp to `least(coalesce(p_accuracy_m,0), 75)` and flag evidence rows above it for the organiser.

## `dev_mark_paid` is member-callable

`20260729210000_merch.sql:520` grants it to `authenticated`; the body (`:411`) has **no buyer check** — any member can mark *any* order paid. Its only production guard is "no `%@mvmnt.test` user exists". `supabase/seed.sql:33` and `scripts/screenshots.mjs` create exactly those accounts. Seed the live project once — for a demo, for README screenshots — and the shop is free. Revoke from `authenticated`; grant to `service_role` only.

## Points double-spend

`place_order` locks the product row, never the buyer. Two concurrent orders for different products each read `points_total()` = full balance and each spend it. Lock the member.

## Handover trap

`20260728030000_schedule_the_scheduler.sql` crons only the SQL tick. The Edge Function that actually sends push is a **commented-out** block requiring `vault.create_secret` + `cron.schedule`. Launch day is silent, deliveries accrue as `pending`, and a non-technical owner cannot fix it.

### The First Principles Thinker

## The job, and whether the build serves it

The club's job is: **tell 150 people where Saturday is, know roughly who's coming, hand back the photos.** MVMNT does the middle one beautifully and cannot do the first at all on launch day — `push_delivery` is off until MVMNT owns an Apple account. So on day one the announcement still happens in WhatsApp, and the app is an addition to the tool it was built to replace. The whole notification pipeline — the largest piece of engineering here — ships inert.

**The blocker nobody wrote down.** Sign-in is email OTP only; Apple/Google are stubs. No SMTP provider appears in `supabase/config.toml`, `docs/costs.md`, or `docs/open-items.md`. Supabase's built-in sender is test-grade and rate-limited (this config: 2/hour). 150 members signing in one Saturday morning will hit that wall, and there is no second door. This outranks the privacy policy in open-items and costs ~$0–20/month to fix.

**English-only, for Cairo.** Zero i18n, zero RTL. Grep returns nothing.

**Distribution is the real bottleneck.** Native-only means launch waits on store review, which waits on legal advice. `react-native-web` is already a dependency and the four web platform bugs are already fixed. Ship the web build at a URL — the club shares links in WhatsApp today. That decouples the first real member from Apple entirely.

**Postgres as centre of gravity is correct** — keep it. But "zero developer" is true only for operations that got a console screen. There is no runbook and no monitoring: pg_cron ticks every minute, and if it dies the non-technical owner cannot distinguish a broken scheduler from a quiet week. A weekly "scheduler ran, N queued" email to the owner beats all of Phase 5.

**Delete or defer:** sponsors, merch/gifts, secret badges, pokes, live location — ~2,500 lines of permanent surface for a club with no gateway and no signed sponsors. And kill **absence decay**: punishing a missed Saturday, in a club whose actual problem is turnout, is a product risk disguised as a scoring rule.

### The Expansionist

Confirmed: zero references to `club_id` or `tenant` anywhere in the schema — this is hard-wired single-club.

The sponsor system is the sleeper asset. `sponsor_impressions` (migration `20260729200000_sponsors.sql`) enforces one-row-per-member-per-day via primary key — that's a *reach* number, not an inflatable adtech impression count, and the docs already frame it as defensible in a commercial conversation. Most local sponsorship deals in Cairo run on vibes and Instagram screenshots. MVMNT can walk into a shoe brand or gym meeting with "280 distinct members saw your logo, verifiably, for 30 days" — that's a rate card, not a favor. Add `run_badge` placements tied to specific routes and this becomes segmentable (e.g., "sponsor only the 10K+ crowd").

`my_distance_meters()` (just added, `20260729500000_distance_with_the_club.sql`) is an untapped hook: "120km with MVMNT" is shareable, screenshot-bait marketing that costs nothing to expose in the app and turns members into recruiters for free.

The QR-friends + gift system (points→discount, gift only to a scanned-in-person friend) is a closed-loop referral engine already built — it just isn't labeled as growth infrastructure. A small twist (bonus points when a gifted friend completes their first check-in) turns existing plumbing into a CAC-free acquisition channel.

Biggest thing to prepare *now*: the schema has zero `club_id`/tenant concept. Every SECURITY DEFINER function assumes one club. If this technical achievement (ADRs, council transcripts, ten test suites, public repo as CV) ever justifies white-labeling for other Cairo clubs, retrofitting multi-tenancy after real data exists is a rewrite, not a migration — worth a single deliberate decision now, even if unbuilt.

### The Outsider

As a new Cairo member opening the app: Sign-in is email-only, one-time code (`apps/mobile/app/sign-in.tsx`) — no phone/OTP-by-SMS, no Apple/Google (buttons exist but just show "not available yet"). For a WhatsApp-native audience that's a real first-run wall: an inbox check is friction WhatsApp never asked for. Everything I can see is hardcoded English (`packages/shared/src/voice.ts`, all screen strings) — no i18n/RTL scaffolding despite this being a Cairo club; Arabic-speaking parents/older members get zero accommodation. The friend code expires in 60 seconds (`apps/mobile/app/friends/code.tsx`) — great for anti-abuse, brutal on a bad 3G connection if the scan flow stalls. Check-in is GPS/geofence-gated (`apps/mobile/app/run/[id].tsx`); the debrief admits an "offline check-in queue" silently failed on web until caught by the owner manually, which is an alarming class of bug to have shipped at all pre-launch, even if fixed.

As the non-technical owner: `docs/open-items.md` and the debrief hand you real operational tasks — filling `tier_rewards`, picking a point-to-piastre rate, seeding `supabase/seed.sql` with real GPS coordinates (wrong pin literally locks members out of checking in that morning), and running `scripts/restore-organiser.sql` yourself if your account is ever lost. That last one assumes comfort running raw SQL against a database — not "non-technical alone" comfort. No documented "what do I do when push notifications aren't going out at 8am Saturday" runbook is visible.

As a recruiter: strong first impression — CI badge, ADRs, a documented bug-hunting culture, ("silent failures" postmortem) — but `docs/spec/MVMNT_App_Spec_1.md` line 4 still has a literal unfilled `[business email — add here]` placeholder, and the privacy policy is explicitly an unpublished draft. A public repo with visible unfinished-founding-doc placeholders slightly undercuts the "production-intent" framing on close read.

### The Executor

Read the repo. Here's the actual Monday-morning gap, in order:

**1. Hosted Supabase doesn't exist.** `supabase/config.toml` only configures local dev (`local_smtp`/Inbucket on port 54324, `site_url = http://127.0.0.1:3000`). There is no staging/prod project, no chosen region (costs.md admits this openly, and it's a legal question under Egypt's PDPL, not just ops). Every migration has run only against ephemeral CI containers (`.github/workflows/ci.yml` calls `supabase start` + `db reset` fresh every run) — migration drift against a real persistent hosted DB has never been exercised once.

**2. OTP email has no real provider.** Auth is 6-digit emailed codes — the entire login path — and `local_smtp` (Inbucket, a test double) is the only SMTP config in the repo. No Postmark/Resend/SendGrid config exists anywhere. At 100–300 signups on a Saturday morning, Gmail/Outlook spam-filtering an unauthenticated sender's OTP is the single most likely first-week outage, and nobody has picked or configured a provider.

**3. No EAS build pipeline at all.** `find` for `eas.json` returns nothing. `apps/mobile/app.json` has no `eas.projectId`, no `ios.buildNumber`/`android.versionCode`. This has never been built as a release binary — only run on the web harness. That means device testing (real GPS geofence accuracy, background/foreground location behavior, camera QR scan under real conditions, push permission prompts) has literally never happened once outside a simulator.

**4. Apple enrollment blocks everything downstream** and needs a D-U-N-S number (1–2 week wait) — not started per debrief.md's own to-do list. Push notifications (fully built, per `apps/mobile/src/lib/push.ts`) are inert until that account plus Firebase exist; `registerForPush()` currently always fails gracefully on-device because no APNs/FCM credentials exist — that's untested against a real push send at any volume.

**5. Privacy policy has four unresolved legal questions** (hosting region, minors/age rating, controller registration, photo consent mechanism) and both stores require it live at a public URL before submission — no domain purchased yet either (costs.md, section 1).

**6. Day-2 ops has no owner.** No runbook for who rotates the `SUPABASE_SERVICE_ROLE_KEY`, who watches `notification_deliveries` status counts (the only place that's surfaced, in a CI step, not a monitoring dashboard), who wakes a sleeping free-tier project. The non-technical owner inherits all of this with zero tooling built for it beyond `scripts/restore-organiser.sql`.

Sequencing that actually works: start D-U-N-S + Apple company enrollment today (it's the longest pole and free); in parallel, create the hosted Supabase project and pick a region now (before any real data exists, since migrating data later is much harder than migrating an empty schema); pick and wire an OTP email provider before onboarding session 1, not after; only then attempt a real EAS build and put it on a physical device with real GPS — that first real-device test will surface problems (permission prompt wording rejected by review, location accuracy at the actual meeting points from the seeded/placeholder coordinates in `supabase/seed.sql`) that no amount of CI green can catch. Everything else (tier rewards copy, point rate, contact links) is cosmetic and can ship after.

## Peer reviews

## Reviewer 1
1. Strongest: B (Contrarian) — only response with live, exploitable bugs at file:line, all verified true. "App is exploitable today" findings, not roadmap gaps.
2. Biggest blind spot: D (Expansionist) — reframes as growth/monetisation while the app isn't safe to launch as-is.
3. All missed: nobody connected the broken auth funnel (A/E) with the money exploit (B) — the first real Saturday would be both inaccessible AND unsafe. Nobody asked about cross-device GPS variance; "one real device test" is treated as monolithic.

## Reviewer 2 (verification duty)
Claim 1 geofence bypass: TRUE (attendance_rpc.sql:293, no clamp, no CHECK on evidence).
Claim 2 dev_mark_paid member-callable: TRUE (merch.sql:520 grant; body 401-424 has no ownership check; seed.sql:33 + screenshots.mjs create the @mvmnt.test accounts that disable the only guard).
Claim 3 points double-spend: TRUE (place_order locks products only; points_total read unlocked; genuine race under read-committed).
1. Strongest: B. 2. Blind spot: D — growth pitch atop an unauthenticated check-in bypass. 3. All missed: A/C/D/E all failed to find the two most severe bugs despite touching the same files.

## Reviewer 3 (two-week action duty)
1. Strongest: E (First Principles) — starts from the club's actual job and works backwards. Its "defer merch/sponsors/live-location" call is not sunk-cost-reversed; it is independently vindicated by B, whose critical bugs live exactly in the subsystems E wants dormant. The web-URL-over-app-store claim checks out: react-native-web is already a dependency, the web bugs are fixed, and push is inert on native too until Apple/Firebase exist.
2. Blind spot: D — treats unshipped revenue features as underexploited assets while ignoring whether the club can launch safely at all.
3. All missed: a staged pilot (dry-run Saturday with a small trusted cohort on real hosted infra) and any rollback/kill-switch plan for the non-technical owner.

## Reviewer 4 (member experience & legal duty)
1. Strongest: E — names email-OTP-only as "the blocker nobody wrote down", backs it with the 2/hour built-in sender cap, prices the fix, ranks it above the privacy questions, and offers the web-link de-risking move.
2. Blind spot: D — ignores member experience and consent entirely while praising the repo as production-intent, when photo galleries ship with no upfront consent capture.
3. All missed: photo consent severity — the policy is opt-out-after-the-fact (organiser takedown), with no upfront capture, for identifiable people. Also: an admin check-in path exists, so "GPS is the only route" is not quite true; and nobody validated whether the club's actual members need Arabic/RTL at all.

## Reviewer 5 (ordering & dependencies duty)
1. Strongest: E — the only one that changes the critical path rather than sorting it. Correctly diagnoses OTP as rate-limited (2/hr), not merely spam-filtered; the web build turns Apple's D-U-N-S chain from a hard dependency into an optional parallel track.
2. Blind spot: B — four real bugs presented as equally "fatal now", with no differentiation between a one-line clamp (minutes) and the push handover (externally gated). Security severity is not the same axis as sequencing priority.
3. All missed: nobody sequenced legal/consent against data creation as one dependency. Once real GPS/attendance PII lands before consent mechanics are settled, that is a PDPL one-way door — no retroactive consent. And nobody proposed a small soft-launch before the 100-300 signup Saturday.
