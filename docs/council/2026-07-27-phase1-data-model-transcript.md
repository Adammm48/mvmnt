# LLM Council — Phase 1 Data Model & Check-In Security

**Date:** 2026-07-27
**Convened because:** MVMNT_App_Spec §0 requires consequential or hard-to-reverse decisions
(explicitly: data model changes, security-sensitive flows) to go through the council before
implementation.

---

## Original question

Pressure-test the Phase 1 data model and check-in security design for MVMNT before writing
migrations. Three decisions on the table:

1. **Schema shape** — nullable timestamps instead of booleans on `run_attendance`, `is_in` as a
   `GENERATED` column, notification events split across two tables.
2. **GPS geofence as the sole check-in factor** — no QR code. Known to be spoofable. Check-ins
   become leaderboard points in Phase 2, so they carry value.
3. **Nullable capacity with waitlist auto-promotion** — what is the concurrency-safe Postgres
   implementation?

## Framed question given to advisors

Context supplied: React Native/Expo + Supabase (Postgres, Auth, Storage, Realtime, Edge
Functions), separate React admin console. ~300 people weekly, one event reached 2,500. Solo
builder working alongside coursework. UK-based, so UK/EU GDPR applies. Club currently runs on
WhatsApp and Instagram. Governing principles: simplicity over cleverness, single source of truth,
every client request untrusted, RLS wherever possible, privacy by default, design for the 300
baseline and verify burst paths at 2,500 rather than over-building everywhere.

Phase 1 scope: account sign-up, run sign-up, check-in, run detail, minimal admin run editor,
notifications (new run published, reminder, run started, run ended, waitlist spot opened).

Noted for the advisors: the builder originally recommended a rotating QR code at the meeting
point; the product owner chose geofence instead, having been told it is spoofable.

---

## Advisor responses

### The Contrarian *(anonymised as Response B)*

**DECISION 1 — the generated column is a distraction; the real bug is elsewhere.**

`is_in` STORED buys you nothing a partial index doesn't:
`CREATE INDEX ... ON run_attendance (run_id) WHERE checked_in_at IS NOT NULL AND withdrawn_at IS NULL`.
Meanwhile it costs you: you cannot readily alter a generated expression, only `DROP COLUMN`/re-add,
and it ships in every Realtime payload and PostgREST select. Drop it.

The expensive mistake is nullable timestamps as a state machine. Withdraw-then-rejoin forces you to
`SET withdrawn_at = NULL`, erasing history — and worse, it destroys waitlist ordering. What
determines FIFO position: `waitlisted_at` or `signed_up_at`? If promotion sets
`signed_up_at = now()`, you've overwritten your own queue key. Add an immutable `queued_at` set once
at first join, never touched, and an append-only `run_attendance_events` if you care about history
at all.

Second real bug: `notification_events` has no idempotency key. Add `UNIQUE (run_id, type)` (or
include `audience`), and `UNIQUE (event_id, token)` on deliveries. Without those, one cron retry
double-pushes 2,500 people. The two-table split is fine — that's not where you're exposed.

Also: `push_tokens.expo_token UNIQUE` requires
`ON CONFLICT (expo_token) DO UPDATE SET user_id = EXCLUDED.user_id`. Shared/handed-down phones
otherwise send someone else's notifications to the wrong account — a GDPR incident, not a bug.

**DECISION 2** — you're optimising against cheaters and ignoring false negatives: denied permission,
indoor meeting points, urban GPS drift. Build the admin manual check-in override first; it's the
only mitigation that matters. And store `reported_lat/lng/accuracy_m/distance_m/client_ts/server_ts`
on the check-in row now — Phase 2 leaderboards will inherit Phase 1 data, and you cannot
re-adjudicate fraud you never recorded.

**DECISION 3** — `SELECT capacity FROM runs WHERE id = p_run FOR UPDATE` at the top of the SECURITY
DEFINER join *and* withdraw functions. Count-then-insert is unsafe under READ COMMITTED without it.
Same lock, same order, both paths. Don't use a trigger.

### The First Principles Thinker *(anonymised as Response D)*

**You're asking "how do we stop GPS spoofing" when the actual question is "what is a check-in a
record of?"**

Strip it down. At a 300-person run everyone can see who turned up. Ground truth is social, not
technical. In Phase 1 a check-in buys you a headcount and a safety register — spoofing that is
worthless. Spoofing only becomes worth doing in Phase 2, when points exist. So don't build
anti-fraud now; build **evidence you can re-adjudicate later**. Store the claim, not the verdict:
`check_in_method`, `reported_lat/lng`, `reported_accuracy_m`, `distance_m`, `mock_location_flag`,
`server_received_at`. When points arrive you can retroactively discount weak check-ins. Without
those columns you have an undifferentiated pile of booleans and Phase 2 starts blind. That is the
migration decision, not QR-vs-geofence.

**The expensive irreversibility isn't `is_in`.** It's `UNIQUE(run_id, user_id)` plus mutable
nullable timestamps. Sign up, withdraw, rejoin — the row is overwritten and the sequence is gone.
You cannot reconstruct waitlist ordering, no-show patterns, or "who dropped at 6am" from a row that
only remembers its last state. Attendance is already an event log; you've written half of one and
thrown away the half that matters. Keep the current-state row (it's right for 300 people), and add
an append-only `attendance_events(attendance_id, event, at, actor, metadata)`. Cheap now,
unrecoverable later.

`is_in` generated: fine, and correctly places the rule in one place. Two notification tables: not
over-engineering — one event fans out to N devices; that's normalisation, not architecture.

**Capacity:** stop counting rows to decide. `SELECT ... FROM runs WHERE id = $1 FOR UPDATE` at the
top of the SECURITY DEFINER function, then count and insert. Serialising on the run row is the
simplest thing that is actually correct.

### The Expansionist *(anonymised as Response E)*

**The one column that isn't cheap later: `club_id`.** "Add it later" is true for `loyalty_points`.
It is false for a tenant key, because retrofitting it means rewriting every RLS policy, every query,
and backfilling a live production dataset. You had a 2,500-person event. Other UK run clubs
coordinating over WhatsApp will want this exact app. Put a nullable `club_id` on runs and profiles
now, default it to one row, and you've kept the option to be infrastructure for fifty clubs instead
of an app for one — for about 20 lines of migration.

**Check-in is not a boolean. It's a spatiotemporal event, and you're throwing away the payload.**
The geofence already gives you lat/lng, accuracy, and timestamp at the moment of validation. Store
them. That single decision seeds: proof-of-attendance disputes, actual start-point heatmaps, and —
critically — a proximity graph. Who checked in within 30 seconds and 15 metres of whom. That is a
warm-start friend-suggestion engine for your QR system, and later a first-pass filter for the
face-matching feature (only match against people who were physically there).

**Model attendance as an append-only event log, not mutable nullable timestamps.**
`UNIQUE(run_id, user_id)` with `withdrawn_at` erases the signup→withdraw→resignup funnel. Show-up
rate versus signup rate is the single number that tells you whether the club is healthy — and it's
the number a sponsor pays for.

**Your `notification_deliveries` table already is the sponsor impression schema.** Generalise it
once now — `(subject_type, subject_id, actor_id, event_type, occurred_at, metadata jsonb)` — and
impressions, taps, pokes, and check-ins all land in one pipe you only build once.

**Unclaimed profiles.** At 2,500 people, most aren't in the app. Let admins check in a phone number
that a real account claims later. That's your growth loop, and it's free in Phase 1.

### The Outsider *(anonymised as Response C)*

**The auto check-in is the part that makes no sense to me.** You're building a system where I arrive
at a run and... nothing happens? No moment. Meanwhile the app silently decides whether I "counted."
When it fails — phone in a locker, battery saver, GPS drifting 200m in a city — I have no idea until
the leaderboard is wrong, and then I'm arguing with an organiser about a thing neither of us can
see. A tap-to-check-in button at the run is not friction. It's the *receipt*. People want to press
the button. Give them the automatic detection as a prompt — "Looks like you're here, check in?" —
not as a verdict.

**On cheating: you're solving it at the wrong layer.** 300 people who see each other weekly already
know who ran. The real anti-cheat is that Dave wasn't there and everyone noticed. Add "organiser can
remove a check-in" and you're 95% done. Building GPS forensics before anyone has cheated is a
solution to a problem you invented.

**The waiting list will produce your first angry member.** If a spot opens at 11pm and I'm
auto-promoted, I wake up committed to a run I forgot I wanted. Worse — do I lose the spot if I don't
show? Is there a penalty? Nobody has told me the rules, and rules I didn't agree to feel unfair.
Auto-promote is a *social contract*, not a feature.

**What you're assuming:** that people sign up as individuals. They don't. They come with a friend,
they bring someone new, they show up without signing up. Your model has no answer for "can I bring
my flatmate," and at 2,500 people that's most of the growth.

**Confusing:** why does a running club need accounts at all before it needs a run schedule people
can just *see*?

### The Executor *(anonymised as Response A)*

**Monday morning, in order.**

Week 0, before any app code: `supabase init` + `supabase start` locally (Docker). Everything in
`supabase/migrations/*.sql`, never the dashboard SQL editor. Seed script (`supabase/seed.sql`) that
creates 30 fake profiles, 5 runs — one starting in 10 minutes, one that ended yesterday, one at
capacity with 3 waitlisted. You will re-run `supabase db reset` fifty times; if seeding isn't one
command you will start avoiding tests.

Build order: schema + RLS → auth (email OTP only) → run list/detail → sign-up/withdraw RPC →
waitlist promotion → check-in RPC → admin editor → notifications last.

**What eats days with nothing to show:**
- RLS policies. Budget 2-3 days alone, and write pgTAP or plain SQL assertion tests — "can user B
  withdraw user A?" — because you cannot test RLS by clicking around.
- `is_in` as a GENERATED column: fine, but generated columns can't reference other tables, so
  capacity/waitlist logic still lives in a function. Don't discover that at 1am.
- Expo prebuild + dev-client on two platforms. Do this in week 0 while the app is empty, not after
  you've written 5,000 lines.

**Fake or cut without regret:**
- Push. Write only `notification_events` + a `dispatch_notification()` that inserts
  `notification_deliveries` with `status='logged'`. The Expo push call is 15 lines added later.
  Prove correctness by querying the deliveries table.
- pg_cron. Use one function, `process_due_notifications()`, called by a scheduled Edge Function.
  Locally you call it by hand — that's the feature, not a workaround.
- Google/Apple sign-in: leave the buttons out entirely rather than shipping dead buttons.
- Admin console: it's a table and a form. No design system.

**Where you get stuck:** GPS. The simulator lies. Add a `DEV_FAKE_LOCATION` flag that lets you type
coordinates. Otherwise you're driving to a park to test one function.

---

## Peer review round

Anonymisation mapping: **A** = Executor · **B** = Contrarian · **C** = Outsider ·
**D** = First Principles · **E** = Expansionist.

All five reviewers independently selected **B (the Contrarian)** as strongest, and four of five
selected **E (the Expansionist)** as having the biggest blind spot.

### Review 1
**Strongest: B.** Only response answering all three questions with code-level precision, catching
bugs nobody else saw: the generated column leaks into every Realtime/PostgREST payload (a partial
index is strictly better); promotion overwriting `signed_up_at` destroys the FIFO key; missing
idempotency keys mean a cron retry double-pushes 2,500 people; `push_tokens` needs
`ON CONFLICT (expo_token) DO UPDATE SET user_id`. Only one insisting the `FOR UPDATE` lock goes on
*both* join and withdraw paths — D gets the lock right but only for join.
**Biggest blind spot: E.** Answers none of the three questions as asked — no concurrency answer at
all — and loads a solo builder with multi-tenancy, a proximity graph, face-matching, sponsor
impressions and unclaimed profiles. `club_id` is arguably right; the rest is Phase 4 speculation
dressed as a cheap migration.
**All missed:** (a) UK GDPR — storing lat/lng/accuracy for 2,500 people needs a lawful basis, a
retention/deletion policy, and DSAR handling. Every response urges storing *more* location data;
none mentions the obligation that creates. (b) The 2,500-person event breaks check-in
operationally: hundreds of simultaneous RPCs on congested mobile networks at a mass start. No one
proposed offline-queued check-ins with `client_ts` reconciliation — which also makes B's admin
override necessary rather than optional.

### Review 2
**Strongest: B.** The only response that finds falsifiable bugs rather than opinions. The
`queued_at` catch is the sharpest thing in the council: promotion that touches `signed_up_at`
overwrites the FIFO key, so the waitlist silently reorders itself — nobody else spotted it.
**Biggest blind spot: E.** It designs for a company that doesn't exist, and every one of those ideas
is a GDPR problem, not a feature. Proximity graphs from check-in coordinates and face-matching are
special-category biometric processing (Art. 9); "unclaimed profiles" from phone numbers means
processing non-users' data with no lawful basis and no way to inform them. E never says the word
GDPR. `club_id` is the one good idea, buried.
**All missed:** erasure. B, D and E all recommend append-only event logs; nobody reconciled that
with Art. 17. Location data needs a lawful basis, a retention window, and a delete path — decide now
or the log becomes unerasable.

### Review 3
**Strongest: B.** The only response that names bugs that will actually fire and ranks them. Its
`queued_at` point kills the waitlist-ordering bug that DECISION 1 conceals. It also inverts DECISION
2 correctly: false negatives, not spoofers, are the live risk.
**Biggest blind spot: E.** Answers a Phase 1 scoping question with a Series A pitch. Worse, it
treats a GDPR-governed location dataset as an asset to mine, which is exactly the "privacy by
default" principle inverted.
**All missed:** (a) B, D and E all prescribe append-only logs without noting Article 17 erasure and
retention conflict with immutable attendance history — decide the retention policy before the
schema. Lawful basis for precise location and Expo's US transfer are unaddressed. (b) Check-in with
no check-out: the "safety register" everyone invokes cannot tell you who is still out on the route.

### Review 4
**Strongest: B.** Each finding has a fix attached. `queued_at` as an immutable FIFO key is a real,
silent data-loss bug nobody else names precisely.
**Biggest blind spot: E.** Under UK GDPR, inferring who stood near whom from location data — and
seeding face matching from it — is purpose creep past the stated basis, and "unclaimed profiles"
means creating records for people who never consented. It violates the two governing principles most
explicitly stated: don't over-build, privacy by default.
**All missed:** retention and erasure. Nobody says how append-only logs plus stored lat/lng survive
a deletion request. Also unmentioned: lawful basis for location capture, and whether check-in
doubles as a safety register.

### Review 5
**Strongest: B.** The only one that names failures that actually cost money, with the fix attached.
It kills `is_in` for a concrete reason rather than taste.
**Biggest blind spot: E.** Optimises for a company that doesn't exist, directly against "design for
the 300."
**All missed:** the schema has no roles/organiser table, yet B, C and D all depend on "admin
override" and RLS. Second: three of them recommend append-only event logs without any retention or
Article 17 erasure path for location data.

> *Chairman's note on Review 5's first point:* this one is a misread — `profiles.role` (member|admin)
> was in the proposed schema. The point is noted and dismissed. Its second point stands.

---

## Chairman synthesis

### Where the council agrees

- **Drop `is_in` as a `GENERATED` column.** A partial index serves every query it was meant to
  serve, and the generated expression is awkward to change later. (B, and A concurring on the
  practical limitation that generated columns can't reference other tables.)
- **The expensive, irreversible mistake is the mutable single-row state machine, not `is_in`.** B, D
  and E converged on this independently from three different angles. Withdraw-then-rejoin overwrites
  history; promotion overwrites the FIFO key.
- **Store the check-in claim, not the verdict.** B, D and E all independently reached this. Phase 2
  inherits Phase 1 data.
- **The two-table notification split is correct normalisation**, not over-engineering (B and D
  explicitly), but it was missing idempotency keys.
- **False negatives beat cheaters as the live risk**, and the admin manual override is the
  highest-value, lowest-cost mitigation (B, C, D).

### Where the council clashes

**`club_id` and the multi-tenancy option.** E argues a tenant key is the one thing genuinely
expensive to retrofit, because it means rewriting every RLS policy and backfilling live data — and
that is technically true. Four of five reviewers rejected it as building for a company that doesn't
exist, in direct conflict with "design for the 300." Reasonable advisors disagree here because they
are optimising different things: E is pricing an option, the reviewers are pricing the carrying cost
of complexity for a solo builder alongside coursework.

**Chairman sides with the reviewers**, with a caveat: E's specific claim about retrofit cost is
correct, so this is recorded as a known, deliberate deferral rather than an oversight. If MVMNT ever
seriously proposes running a second club, that is the trigger to revisit — before there is
production data, not after.

**Silent auto-check-in vs. prompted check-in.** C argues silent auto-detection removes the receipt
and makes failures invisible until the leaderboard is wrong. No other advisor addressed the UX at
all. **Chairman sides with C** — this costs nothing and removes the most likely source of member
complaints.

### Blind spots the council caught

1. **GDPR obligation for the location data every advisor wanted more of.** Four of five reviewers
   flagged it; zero of five advisors mentioned it. Lawful basis, retention window, and an Article 17
   erasure path must be decided *before* the schema, because an append-only log of location claims
   is exactly the thing that is hard to erase after the fact.
2. **Burst-path operational reality at a mass start.** Hundreds of simultaneous check-in RPCs on
   congested mobile networks. Offline-queue-and-sync with `client_ts` reconciliation is required, not
   optional — and it makes the admin override load-bearing.
3. **Check-in has no check-out**, so it is not the safety register three advisors called it.
4. **Group attendance** ("can I bring my flatmate") has no model, and C argues that is most of the
   growth at scale.

### The recommendation

Build the schema with these changes from the original proposal:

| Change | Origin |
|---|---|
| `is_in` becomes a view + partial index, not a `GENERATED` column | Contrarian, 5/5 reviewers |
| Immutable `queued_at` as the waitlist FIFO key, never mutated by promotion | Contrarian |
| Append-only `run_attendance_events` alongside the current-state row | First Principles, Expansionist, Contrarian |
| Check-in evidence columns (`reported_lat/lng`, `accuracy_m`, `distance_m`, `client_ts`, `server_ts`, `method`) | First Principles, Expansionist, Contrarian |
| `UNIQUE(run_id, type)` on notification_events; `UNIQUE(event_id, token)` on deliveries | Contrarian |
| `push_tokens` upsert reassigns `user_id` on conflict | Contrarian |
| `SELECT … FOR UPDATE` on the run row in **both** join and withdraw paths | Contrarian, First Principles |
| Admin manual check-in + remove-check-in in Phase 1 | Contrarian, Outsider |
| Geofence *prompts* rather than silently deciding | Outsider |
| Location retention policy + erasure path defined in the same migration | Peer review, 4/5 |

Rejected: `club_id` multi-tenancy, proximity graph, generalised event pipe, unclaimed profiles
(all Expansionist) — deferred with reasons recorded in the ADR.

### The one thing to do first

Write the retention and erasure policy for check-in location data **before** the first migration —
because it is the only decision on this list that becomes materially harder to reverse the moment
real attendance data exists.
