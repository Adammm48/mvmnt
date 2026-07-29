# ADR 0005 · Phase 5 — health data and face-matching, designed before built

**Status:** accepted (design) · 2026-07-29
**Context:** App Spec §10 puts HealthKit integration and AI selfie
face-matching in Phase 5. Both have a hard external dependency — an Apple
Developer account owned by MVMNT for the first, a paid recognition service
account for the second — so neither can be *finished* today. This ADR fixes
the design now, so the day the accounts exist the work is assembly rather
than invention. The club-side half of §4.7's stats that needs neither
(kilometres with the club, from attendance × stated run distance) shipped
with this ADR — see migration 0044.

## 1. Health data: display-only, never stored

The decision that constrains everything else: **health data never touches
the server.** Steps, heart rate and personal pace are read from
HealthKit/Health Connect on the device, shown to their owner on the device,
and discarded. No column, no table, no sync.

Why this is the right trade:

- The privacy policy currently says, truthfully, "we do not collect health
  or fitness data". Keeping that sentence true is worth more than any
  feature that would break it — and under Egypt's PDPL (and GDPR for EU
  members), health data is special-category, with obligations far beyond
  anything else this app holds.
- The member-visible value — "what was my pace, what was my heart rate on
  Saturday's run" — is entirely deliverable on-device. Nothing about it
  needs the club's database.
- What is *lost* is club-side aggregation ("average pace of the easy
  group"). If the club ever wants that, it is a new consent conversation
  and a new ADR, not a quiet extension.

Mechanics, when the account exists: `react-native-health` (iOS) and
Health Connect's SDK (Android) behind one thin adapter interface — two
integrations, no shared code, exactly as the spec's friction notes warn.
Read-only scopes, requested at the moment of first use, with the profile
showing plainly whether access is on and how to revoke it in OS settings.

## 2. Face-matching: bought, opt-in, and deletable

Spec §12 already makes the build/buy call — a managed recognition API
called from an Edge Function, not an in-house model. This ADR fixes the
privacy shape:

- **Opt-in by selfie.** A member who wants their photos found takes one
  selfie, in-app, knowing exactly what it is for. No selfie, no matching —
  and matching runs only over members who opted in. Nobody is searchable
  by a photo they never provided.
- **The selfie and its embedding are deletable as a unit**, from the
  profile, and are destroyed by account erasure. The embedding is stored
  with the provider only as long as membership lasts.
- **Matching is a convenience layer over the same gallery** — it surfaces
  "photos you might be in" from galleries the member can already see. It
  grants no access the gallery rules don't; an unpublished gallery stays
  invisible, matched or not.
- **Cost gate:** recognition APIs bill per image. The Edge Function runs
  per published gallery, once, not per viewer — the match set is computed
  at publish time and stored as rows, so viewing is free.

## 3. What Phase 5 will not do

- No health data on the server, per §1 — including "just steps".
- No matching against non-members, ex-members, or members without a selfie.
- No third recognition use (attendance-by-face, access control). The
  embeddings exist to find your race photos; anything else is a different
  purpose and a different consent.

## 4. Blocked on, precisely

1. Apple Developer Program membership owned by MVMNT (HealthKit
   entitlement, device builds, push certs — one account unlocks all three).
2. A Google Play Console + Health Connect review for the Android half.
3. A recognition-service account (AWS Rekognition or equivalent) with a
   budget the club accepts, priced per §2's publish-time model.

All three live on the owner's list in [open-items](../open-items.md).
