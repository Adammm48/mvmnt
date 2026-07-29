# Council transcript — full functional & store-compliance audit, 2026-07-29

Mandate (owner): architecture, every button and its output, fix bugs, complete gaps, App Store / Google Play compatibility.

## The Contrarian (bug hunt)

1. The whole merch pipeline is dead in production. dev_mark_paid (merch.sql:401-414) raises unless a %@mvmnt.test user exists. Merch.tsx:129 is the ONLY path awaiting_payment→paid. On a real DB every "Mark paid" click errors; Ready/Handed-over unreachable; gift notify never fires; recipient confirm-size UI unreachable. Orders accumulate with no organiser action possible.
2. Selling out silently deletes an item from the shop. place_order sets status='retired' at stock 0; products_select_visible hides it. "Sold out" copy unreachable; restock waitlist loses its audience; gift recipient can't read the product row → sizes empty → size picker missing → redeem_gift throws "choose a size" with no control on screen.
3. Cancelling an order resurrects deliberately-retired products (merch.sql:334 retired→in_stock unconditional).
4. "Cancel run" can silently do nothing: RunEditor.tsx:231 window.prompt returns null when suppressed → early return. The exact failure lib/confirm.ts fixed everywhere else, missed in the destructive path.
5. A started-but-not-ended run cannot be edited (RunEditor.tsx:97-100 exempts only 'completed').
6. Stale success state: run/[id].tsx never clears `celebrate`, so "You're in!" can sit above "You're out."

## First Principles (mobile architecture)

## Structurally missing, ranked by cost of late discovery

**1. No crash reporting. At all.** No Sentry, Crashlytics, `ErrorUtils`, or `componentDidCatch` anywhere in `apps/mobile` — and nothing in `docs/` either, so this isn't a tracked deferral, it's a blind spot. `apps/mobile/app/_layout.tsx:88-101` wraps the tree in providers with no error boundary: one render throw is a white screen, and the member's only recourse is to uninstall. You verified on a web harness where you can read the console. On 300 phones you get silence. This is the most expensive gap because its cost is unbounded and unmeasurable.

**2. `expo-secure-store`'s 2048-byte limit is acknowledged and unhandled.** `apps/mobile/src/lib/supabase.ts:23` names the limit; `:27-31` passes the session through unchunked. Supabase persists access token + refresh token + user object as one value. Above 2048 bytes Android throws — the write fails, the session never persists, and the member is signed out on every cold start. Android-only, device-only, invisible on the web harness and on `localStorage` (`:35`). Chunk the value or move to a two-key split.

**3. No OTA update path.** `expo-updates` appears in neither `app.json` nor `package.json` — no `runtimeVersion`, no channels. Every fix to items 1 and 2 is a full store review. Adding `expo-updates` after the first binary ships means a forced store release just to gain the ability to ship without one.

**4. Push will fail 100% in a store build, silently.** `src/lib/push.ts:83-88` reads `extra.eas.projectId`, which does not exist in `app.json` — no `extra` block, and no `eas.json` in the repo. `getExpoPushTokenAsync(undefined)` throws outside Expo Go; `:100` swallows it as "expected in Phase 1." That comment will still be there post-launch, converting a real regression into an expected one.

**5. `app.json` has no `ios.buildNumber` / `android.versionCode`,** so resubmissions collide until EAS `autoIncrement` is configured.

**Also:** `POLICY_URL = ''` (`packages/shared/src/consent.ts:18`) is a hard rejection on both stores — already tracked in `docs/open-items.md:30`.

**Sound, for the record:** SecureStore over AsyncStorage; the offline check-in queue (`src/lib/checkInQueue.ts`) with idempotent replay on foreground; email-OTP auth needing no deep-link round trip; `__DEV__`-gated location override (`src/lib/location.ts:35`) that can't ship on; `.env` correctly ignored; in-app account deletion present. The web-only paths are `Platform.OS === 'web'`-guarded throughout. The mobile-specific reasoning is good — the production-operations layer is what's absent.

## The Executor (store gates)

APPLE — 1.2 UGC: FAIL hard (no member report path for photos at photos/[runId].tsx or gift messages at orders.tsx:234; only organiser-side moderation; Apple wants filtering+reporting+blocking+24h commitment). 4.8/2.1 non-functional UI: FAIL (sign-in.tsx:166-170 dead Apple/Google buttons; about.tsx:109 "coming soon" links with no-op onPress). 5.1.1(i): FAIL — NSCameraUsageDescription claims "Nothing is recorded or uploaded" while photos/find-me.tsx uploads a selfie for face enrolment; misleading purpose string over biometric capture. Privacy policy URL: FAIL (POLICY_URL = ''). 2.1 minimum functionality: FLAG (unpayable checkout, rewards "being confirmed", face matching enrolled-but-idle). PASS: account deletion (profile.tsx:351), no tracking/ATT, location string specific and foreground-only.
GOOGLE — target API 36 PASS; data safety MISSING (must declare email, name/avatar, precise location, photos, BIOMETRICS via face_optins — sensitive category); permissions PASS; release config MISSING (no eas.json, buildNumber/versionCode, version 0.1.0).
Verdict: rejected today on 1.2, 4.8, and the policy URL. Reporting/blocking is the only real engineering; the rest is deletion and configuration.

## The Outsider (every control)

Ten confirmed issues, ranked by member impact:

1. **apps/mobile/app/sign-in.tsx** — "Continue with Apple" / "Continue with Google" render as fully-styled, non-disabled buttons (Button component has no `disabled` prop passed) on the very first screen every member sees. Tapping either just writes an inline error saying it "needs MVMNT's developer accounts." A "Coming soon" caption sits below but the buttons themselves promise a working sign-in and don't deliver it.

2. **apps/admin/src/screens/RunDay.tsx**, "Check in" — for a "Withdrawn" attendee this button is identical to the one for "Expected"/"Waitlist" rows, but `admin_check_in()` (migration `20260727090300_attendance.sql`) sets `withdrawn_at = null` and re-signs them up. One tap silently reverses a member's own withdrawal with no label distinguishing that outcome from a normal check-in.

3. **apps/mobile/app/(tabs)/profile.tsx**, "Turn on notifications" — label and enabled state never change even when `pushState` already reads "Notifications are on." underneath it. A member who already granted permission still sees an inviting, always-tappable button.

4. **apps/mobile/app/about.tsx**, placeholder contact links — tapping one (`link.placeholder` true) does nothing at all: no toast, no state change, no press feedback beyond the OS ripple.

5. **apps/mobile/app/shop/[id].tsx**, quantity "+" — silently stops incrementing at `Math.min(stock ?? 20, 20)` with no message explaining why it went dead.

6. **apps/admin/src/screens/Merch.tsx**, stock ± buttons — the only mutating admin controls with zero toast; feedback is only the number changing in a busy table row.

7. **apps/mobile/app/run/[id].tsx** not-found state — identical copy for a stale dev link and an organiser-cancelled run; a member never learns which happened.

8. **apps/admin/src/screens/RunEditor.tsx**, "Cancel run" — uses a native `window.prompt()` for the cancellation reason, breaking from the styled confirm modals used everywhere else.

9. **apps/mobile/app/shop/[id].tsx**, "Send it to a friend" toggle — with zero friends added, flips on with no recipient picker; "Send this gift" then goes permanently disabled, reason only visible via a hint several lines above the button.

10. **apps/mobile/src/components/TierChest.tsx** — the celebratory tier-unlock reveal can land on "The club is still confirming this one" as the reward, turning the app's biggest emotional payoff into an IOU.

## The Expansionist (what's missing)

Confirmed — avatar_url has no upload path anywhere, member or admin side. Ranked findings:

**1. Notification deep-links dead-end for 4 of 10 types (highest value/effort).** `apps/mobile/src/lib/notificationRouting.ts:27-36` only builds a destination when `data.run_id` is present. But `badge_earned` (`supabase/migrations/20260729170000_secret_badges.sql:153`, `p_run_id => null`) and `gift_received` (`20260729220000_phase3_notifications.sql:107`, `p_run_id => null`) are enqueued with no run — a member taps "Badge unlocked" or "X sent you something" and lands on the plain home screen, the exact failure this hook was built to fix for `photos_ready`. Fix: route `badge_earned` → profile (badges section), `gift_received` → `/orders`. A few lines in `destination()`.

**2. Attendance sheet has no export.** `apps/admin/src/screens/RunDay.tsx` loads `run_attendance_view` into a table with no CSV/print button — while `Sponsors.tsx:149-172` already has a working `exportCsv()` pattern to copy. A 150-300 person club will want a printable check-in list or post-run roster on day one for insurance/liability and no-show follow-up. Same effort as the sponsor export, already-proven pattern.

**3. No avatar upload UI anywhere.** `profiles.avatar_url` (migration `20260727090100_profiles.sql:11`) is only ever populated from OAuth metadata at signup (`handle_new_user()`) and rendered on leaderboard/friends (`leaderboard.tsx:229`, `friends/index.tsx:201`). `profile.tsx` lets a member edit `display_name` only — email-OTP members (no Apple/Google metadata) get no avatar, ever, and nobody can change a bad one.

**4. Voice slots built, never fired.** `streak_new` and `milestone_100` (`packages/shared/src/voice.ts:93-101`) are defined but `grep` shows zero call sites — despite `current_streak_weeks()` being a real, working RPC already rendered on `StandingCard.tsx:78`/`stats.tsx:64`. Cheap addition: fire `adamSays('streak_new')`/`milestone_100` in the post-check-in celebration (`run/[id].tsx:235`) when the returned streak/run-count crosses a threshold. `birthday` is also unused but has no backing DOB column — lower priority, needs schema work first.

## Disposition

Every verified finding was fixed in the same session — see the commit
'Everything the audit council found, fixed' and docs/council/2026-07-29-audit-fixes.md
for the item-by-item disposition. Peer review was replaced by direct
verification of each claim against the code before fixing, on the owner's
instruction to prioritise fixes over process.
