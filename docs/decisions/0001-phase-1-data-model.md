# ADR 0001 — Phase 1 data model

**Status:** Accepted · **Date:** 2026-07-27 · **Phase:** 1
**Reviewed by:** LLM Council, 5 advisors + 5 peer reviews — `docs/council/2026-07-27-phase1-data-model-transcript.md`

## Context

App Spec §5 sketches the entities. Building it exactly as sketched turned out to contain one real
bug and several near-misses, all found by the council convened per App Spec §0.

## Decisions

### Timestamps, not booleans

App Spec §5 models `Attendance` with `signed_up (bool), checked_in (bool)`. We use nullable
timestamps instead. Nulls carry the same information, and *when* something happened is needed for
the waitlist queue, for observability (Principles §7), and for the reminder scheduler. A boolean
throws that away for no saving.

### `public_status` is not stored

§5 lists `public_status ("in"/"out")` as a column. Read §4.1 closely — "signed up **and** checked
in, *or* checked in without signing up" reduces to simply *checked in*. Storing it creates a second
copy of a fact that can disagree with the first, violating Principles §2.

**Not a `GENERATED` column either.** That was the original proposal; the council rejected it 5/5. It
buys nothing a partial index doesn't, it appears in every Realtime payload and PostgREST select, and
the expression is awkward to change (`ALTER COLUMN … SET EXPRESSION` only exists from Postgres 17
and Supabase project versions vary).

It is a **view** (`run_attendance_public`) plus a partial index. One definition, and
`CREATE OR REPLACE VIEW` is free when Phase 2 redefines what "in" means.

### `queued_at` — the immutable waitlist key

**This is the bug the council caught.** The waitlist is FIFO, and the obvious key is
`signed_up_at`. But promotion off the waitlist *sets* `signed_up_at = now()` — which overwrites the
ordering key with the promotion time. The queue silently reorders itself and nobody notices, because
nothing errors.

So `queued_at` is a separate column, set when a member joins, and **never touched by promotion or
check-in**.

One refinement on the council's advice: they said set it once at first join and never again. That is
wrong for fairness. If a member withdraws from a full run and rejoins a week later, they should go
to the *back* of the queue, not reclaim their original slot. So `queued_at` is reset on a genuine
re-join out of the withdrawn state, and is immutable with respect to every *other* transition. The
full history is preserved in the event log regardless.

### `run_attendance_events` — append-only, no personal data

`UNIQUE(run_id, user_id)` plus mutable columns means the row only remembers its last state. Sign
up → withdraw → rejoin is invisible afterwards, and with it the signup-versus-turnout rate, which is
the single most useful health number the club has.

Current-state row (right for reads at 300 people) **plus** an append-only event log beside it. The
log records the transition, actor and timestamp — deliberately no location or free text, so ADR 0002
can anonymise rather than delete it when a member exercises erasure.

### Notifications split across two tables, with idempotency

§5 has a single `Notification` entity. One event fans out to N devices, so it is two tables — that
is normalisation, not architecture, and it is what makes per-device failure logging (Principles §7)
and retry possible.

The original proposal was missing the part that matters: **without an idempotency key, one cron
retry double-pushes every member.** At the 2,500-person event that is 2,500 duplicate notifications
from a single retry.

- `notification_events.dedupe_key` UNIQUE — a text key like `run:<id>:reminder_morning_of`, or
  `run:<id>:waitlist_promoted:<user_id>` for per-member events. Enqueueing twice is a no-op.
- `notification_deliveries` UNIQUE `(event_id, push_token)` — a device is written once per event.

Notification copy is rendered **in SQL at enqueue time** and stored on the event row, so the
delivery worker is dumb and the copy exists in exactly one place (Principles §2) rather than being
duplicated across the app, admin console and Edge Function.

### `push_tokens` upserts by token, reassigning the user

`ON CONFLICT (expo_push_token) DO UPDATE SET user_id = EXCLUDED.user_id`. Without this, a
handed-down or shared phone keeps delivering the previous owner's notifications to the new owner.
That is a personal-data disclosure, not a bug.

### Concurrency: lock the run row, in both directions

`SELECT … FROM runs WHERE id = ? FOR UPDATE` at the top of **both** the join and the withdraw
functions, in the same order. Count-then-insert is unsafe under READ COMMITTED without it — two
concurrent joins both see capacity-1 taken and both insert.

Serialising on the run row is enough. At ~300 sign-ups spread over days, and even 2,500 over an
announcement window, contention on a single row for the microseconds a join takes is not a
bottleneck. No trigger, no counter cache, no advisory locks.

## Explicitly not doing

**`club_id` multi-tenancy.** The Expansionist argued a tenant key is the one thing genuinely
expensive to retrofit — rewriting every RLS policy and backfilling live data — and that claim is
technically correct. Four of five reviewers rejected it as building for a company that does not
exist, against the explicit instruction to design for ~300 people.

Recorded as a **deliberate deferral, not an oversight**. If MVMNT ever seriously proposes running a
second club, revisit *before* there is production data, not after.

**Also rejected:** a check-in proximity graph (who stood near whom — special-category inference
under UK GDPR, and purpose creep past the consent in ADR 0002), a generalised event pipe for future
sponsor impressions, and admin-created "unclaimed profiles" for non-members (creating records for
people who never consented and cannot be informed).

**Not pre-creating Phase 2–5 columns.** No `points`, `tier`, `personal_qr`, or `route_polyline`.
`ALTER TABLE … ADD COLUMN` is cheap; carrying unused columns is not (Principles §1). The exception
was `club_id`, argued above and still declined.

## Open question for the product owner

**The waitlist is a social contract, not a feature** (the Outsider's point, and unresolved). If a
spot opens at 11pm and a member is auto-promoted, they wake up committed to a run they had mentally
dropped. Do they lose the spot if they do not show? Is there a penalty?

Phase 1 implements the kindest reading — auto-promote, notify, no penalty, withdraw freely — because
it is the only version that cannot make someone angry about a rule they never agreed to. Flagged for
confirmation.

## Also unaddressed, flagged not solved

**Group attendance.** Members do not sign up as individuals — they bring a friend, they bring
someone new. There is no model for "can I bring my flatmate," and at a 2,500-person event that is
plausibly most of the growth. Out of Phase 1 scope; needs a product decision before it needs a
schema.
