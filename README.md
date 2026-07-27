# MVMNT

The run club app. iOS and Android, plus a browser console the club's organisers
run day to day without a developer.

**Status: Phase 1.** Sign-up, run sign-up, geofenced check-in, run detail,
notifications, and the admin run editor. Phases 2–5 (leaderboard, QR friends,
merch, routes and galleries, HealthKit) are not built — see
[docs/backlog.md](docs/backlog.md).

```
apps/mobile      Expo app (iOS + Android), dev-client/prebuild
apps/admin       React + Vite organiser console
packages/shared  Generated DB types, theme tokens, formatters
supabase/        Migrations, RPCs, RLS, Edge Functions, tests
docs/            Architecture decisions, API reference, council transcripts
```

---

## Running it locally

**You need:** Node 20+, Docker (Colima works and needs no privileged helper),
and the Supabase CLI (installed as a dev dependency).

```bash
npm install
colima start            # or Docker Desktop
npm run db:start        # Supabase: Postgres, Auth, Storage, Edge Functions
npm run db:reset        # migrations + seed + placeholder cover images
```

Copy `.env.example` to `apps/mobile/.env` and `apps/admin/.env`, filling in the
keys `npm run db:start` printed.

```bash
npm run db:test                        # database test suite
npm run --workspace @mvmnt/admin dev   # organiser console → :5173
npm run --workspace @mvmnt/mobile web  # app in a browser → :8081
```

For the app on a real simulator or device, `npm run --workspace @mvmnt/mobile ios`
(needs Xcode) or `… android`.

**Seeded accounts:** `organiser@mvmnt.test` is an admin, `runner2@…` through
`runner30@…` are members. Password `password123`, though sign-in is by emailed
6-digit code — read it at **http://127.0.0.1:54324** (Mailpit), which catches
every local email.

### Handy

| Command | Does |
|---|---|
| `npm run db:reset` | Rebuild from migrations, reseed, re-upload cover images |
| `npm run db:types` | Regenerate `packages/shared/src/database.types.ts` — run after any migration |
| `npm run db:test` | The database test suite |
| `npm run seed:media` | Re-upload placeholder covers only |

`EXPO_PUBLIC_DEV_FAKE_LOCATION=30.0444,31.2357` in `apps/mobile/.env` lets you
test geofenced check-in without standing at the meeting point. It is ignored in
release builds.

---

## How this is put together

**Business rules live in the database.** Capacity, waitlist order, the check-in
geofence, who may edit a run — all in `SECURITY DEFINER` functions in
`supabase/migrations/`. Clients call them and render the result; they never
decide. The apps hold no rule that could drift from the server's.

That means **the schema is the interesting part of this repo**, and the
migrations are written to be read. Start with
[`…0300_attendance.sql`](supabase/migrations/20260727090300_attendance.sql).

**Two gates on every table:** a `GRANT` (may this role touch the table?) and an
RLS policy (which rows?). Both must agree — a missing grant makes policies dead
letters. Full reference in [docs/api.md](docs/api.md).

**Notifications are queue-and-worker**, not fire-and-forget: one event fans out
to N devices with per-device retry and failure logging. Idempotent at both
levels, because without that a single scheduler retry double-pushes everyone —
2,500 duplicate notifications at a large event.

### Decisions worth reading before changing things

- [ADR 0001 — Phase 1 data model](docs/decisions/0001-phase-1-data-model.md) —
  why attendance is timestamps not booleans, why `queued_at` exists, and what
  was deliberately left out
- [ADR 0002 — Check-in, location and retention](docs/decisions/0002-check-in-location-and-retention.md) —
  why the geofence prompts rather than decides, why organiser check-in is the
  primary mitigation, and the 30-day location retention rule
- [The council transcript](docs/council/2026-07-27-phase1-data-model-transcript.md) —
  the review that changed ten things about the schema before it was written

---

## Testing

Depth tracks risk (Principles §11). The security- and money-sensitive flows get
the full treatment; admin CRUD gets a lighter pass.

```bash
npm run db:test
```

Five suites over attendance and the waitlist, geofenced check-in, every RLS
policy, notification idempotency, and retention/erasure. They run inside
transactions and roll back, so they are safe against a seeded database.

**RLS cannot be tested by clicking around** — the UI only ever asks for data it
is supposed to have. A policy hole is invisible from the front end and obvious
in `03_access_control.sql`.

---

## Before this goes live

Tracked in full in [docs/backlog.md](docs/backlog.md). The blocking ones:

1. **Apple Developer Program**, enrolled to MVMNT. Organisation enrolment needs a
   D-U-N-S number, which Apple takes 1–2 weeks to verify. Gates Sign in with
   Apple, push, TestFlight and release.
2. **Firebase project** for Android push, and **Google Play Console** ($25) for
   the listing.
3. **A published privacy policy.** Both stores require one, and it does not exist
   yet. This is writing, not engineering, and it is usually what holds a release
   up.
4. **Choose the Supabase region deliberately.** The club is in Cairo, so Egypt's
   PDPL applies and cross-border transfer rules are in play — much cheaper to
   decide now than to migrate production data later. See ADR 0002 §8.

Until 1 and 2 exist, the `push_delivery` flag stays off and notifications are
recorded rather than sent. The pipeline is real and observable in
`notification_deliveries`; only the outbound call is skipped.

---

## Conventions

- **Never edit the schema through the Supabase dashboard.** Migrations are the
  source of truth; a dashboard edit is invisible to everyone else and lost on the
  next reset.
- **Regenerate types after every migration** (`npm run db:types`) and commit
  them — they are reviewed as part of the diff.
- **Comments explain *why*.** The what is in the code.
