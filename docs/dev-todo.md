# The developer's to-do list

The engineering that remains, in execution order. Every item is **gated on an
answer or account from [the owner's questionnaire](owner-questionnaire.md)** —
there is deliberately nothing here that could be done today, because
everything that could be done today has been done (see
[debrief.md](debrief.md)).

## 1 · Stand up production — gated on D1, D4, and the Supabase account
- Create the hosted project in the chosen region; apply all migrations to it;
  run the full test suite against it once.
- Point the apps' environment at the hosted URL and keys; verify sign-in,
  check-in and the console against it end to end.
- Set the production auth config: raise the 2/hour email rate limit, set
  site_url, confirm OTP expiry.
- Re-run the load-test script against a staging copy (due before any
  2,500-person event — F2).

## 2 · Real email — gated on D1 and a Resend account
- Verify the domain in Resend (SPF, DKIM, DMARC records).
- Wire SMTP into the hosted project per the block in `supabase/config.toml`.
- Send a real code to a real phone on mobile data; check the spam folder
  rather than assume.

## 3 · Publish the policy — gated on D1–D3, D6, D7
- Fill the privacy policy's remaining blanks (legal name, contact, region,
  registration answer); publish at a public URL on the domain.
- Set `POLICY_URL` in `packages/shared/src/consent.ts` so the consent screen
  links to it; bump `CONSENT_VERSION` if wording materially changed.

## 3½ · Post-audit account wiring — gated on D5, D8, D9
- Configure Apple + Google OAuth in Supabase Auth (D5 + D8); flip the
  `oauth_sign_in` flag from the console — the sign-in buttons appear with no
  release.
- Wire the crash service (D9) into `CrashBoundary.componentDidCatch` and the
  scheduler Edge Function.
- EAS init: set `extra.eas.projectId` in app.json — push token registration
  is explicitly guarded on it and says so until then.

## 4 · The device build — gated on D5 (Apple) + Play Console
*Largely unblocked without the paid account: `npm run ios:sim` runs it on a
simulator, and `npm run ios:phone` puts it on a REAL iPhone via free Apple ID
signing (7-day builds). What genuinely still needs the paid membership is
push notifications, non-expiring builds, and the stores themselves.*
- `eas.json`, bundle ids, signing; app icon and splash from the real mark
  (E1); build the dev client and then release candidates.
- First run on physical iPhone and Android: real GPS at a real pin (B2),
  camera QR scan, permission prompts, offline check-in queue on mobile data.
- Configure APNs/FCM; flip the `push_delivery` flag; verify a real push
  arrives and deep-links (the pipeline is built and logged, never yet sent).

### 4a · Android push, in the order it actually unblocks

Four things stand between a published run and a phone buzzing. Firebase is
one of them, and on its own it changes nothing — worth stating, because
"Firebase is ready" feels like the finish line and is the first step.

1. **Firebase project** with an Android app registered under the exact
   package id `com.adamelbasiony.mvmnt`. A mismatch here fails silently.
2. **`google-services.json`** → saved to `apps/mobile/`. Gitignored;
   `app.config.js` wires it in when present and skips it when not, and
   `run-android.sh` regenerates the native project when it appears or
   changes (otherwise the file sits there doing nothing).
3. **An Expo account and `npx eas init`** — free, and the piece most easily
   missed. Delivery goes through Expo's push service, and
   `getExpoPushTokenAsync` needs an EAS `projectId`. Without it NO token is
   ever minted, so the club cannot reach the phone no matter what Firebase
   says. This is why zero rows sat in `push_tokens`.
4. **The FCM V1 service-account key** (Firebase → Project settings →
   Service accounts → Generate new private key) uploaded to Expo with
   `eas credentials`, so Expo's servers may deliver to FCM on the club's
   behalf. A private key: never commit it, and prefer uploading it straight
   from the download rather than leaving copies around.

Then flip `push_delivery` and publish a test run. iOS needs the paid Apple
account for APNs and is otherwise the same shape.
- Store listings: screenshots, descriptions, age rating (18+ per D7),
  privacy questionnaires on both stores; submit for review. Google's data
  safety form declares: email, name/avatar, precise location (check-in and
  opt-in live sharing), photos, and biometrics (the find-me selfie) — the
  audit's enumerated list.

## 5 · Real data — gated on section A, B, C answers
- Enter tier rewards (console → Rewards), clear `is_placeholder`.
- Point rate: if A3 changes it, update migration value + `PIASTRES_PER_POINT`
  together (they must agree — documented in both files).
- Real meeting points, schedule, capacities, organisers, catalogue, sponsors —
  console work, done with the owner.
- Replace seeded demo data on production with the real calendar.

## 6 · The dry run — gated on F1
- Support the 8–10 member Saturday on real infrastructure; watch logs live.
- Fix what it teaches us. History says it will teach us something no test
  found — every silent-failure bug so far was found by a human using the app.

## 7 · Phase 5's runtime halves — gated on D5 + a recognition-service account
- HealthKit (iOS) / Health Connect (Android) display-only stats per ADR 0005.
- Face-matching behind an Edge Function, opt-in by selfie, matched once at
  gallery publish per ADR 0005.

## Done since the audit council (no owner input needed)
Recorded here so the queue above reads as the whole remaining list:
content reporting end to end (member sheet → organiser Reports tab with
remove/resolve), avatar upload, honest camera/photo-library purpose strings,
OAuth buttons behind a flag instead of dead on screen, crash boundary,
SecureStore chunking, expo-updates + build numbers, the merch pipeline's
production path, sold-out as its own status, notification deep-links for
every type, the attendance CSV, and two test suites that were committing
their fixtures.

## Parked, by decision (revisit only if the club asks)
- Arabic/RTL localisation · guardian-consent flow for under-18 accounts ·
  multi-tenancy for other clubs · payment gateway integration (C2).
