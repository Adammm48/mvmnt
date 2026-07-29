# MVMNT API — Phases 1 and 2

Every backend capability, with its purpose, inputs, outputs, permissions and
errors (Engineering Principles §8).

**The shape of the whole thing:** clients get `SELECT` and almost nothing else.
Every state change goes through a `SECURITY DEFINER` function that validates
first, so the rules live in one place instead of being spread across a dozen
policies and two front-ends (Principles §2). If you are adding a feature and
find yourself writing an `INSERT` from the app, that is the signal you need an
RPC instead.

Two independent gates gate every table:

| Gate | Decides |
|---|---|
| `GRANT` | whether the role may touch the table at all |
| RLS policy | which rows it may touch |

Both must agree. A missing `GRANT` makes RLS policies dead letters — the role
cannot reach the table for them to be evaluated. This is not theoretical; it
happened during Phase 1 (see migration `…0900_rls.sql`).

---

## Calling convention

All RPCs are `POST /rest/v1/rpc/<name>` with a JSON body, or via the client
library:

```ts
const { data, error } = await supabase.rpc('join_run', { p_run_id: runId });
```

**The caller is never a parameter.** Every member-facing function derives the
caller from `auth.uid()`. There is no function that accepts "who I am" from the
client.

**Errors** arrive as PostgREST errors carrying the `RAISE EXCEPTION` message.
Those messages are written for members to read, so the default is to show them
(`toMemberMessage()` in `@mvmnt/shared` handles the few that would be jargon).

**Idempotency.** `join_run`, `withdraw_from_run`, `check_in`,
`register_push_token`, `scheduler_tick` and `purge_expired_location_data` are all
safe to call twice. That is deliberate — it is what makes retrying on a flaky
connection safe.

---

## Member functions

### `join_run(p_run_id uuid, p_pace_group text = null) → attendance_state`

Take a place on a run, or a waitlist position if it is full.

| | |
|---|---|
| **Permission** | Any signed-in member |
| **Returns** | `'signed_up'` if a place was held, `'waitlisted'` if the run was full |
| **Concurrency** | Locks the run row (`FOR UPDATE`) before counting places |

Already holding a place or a waitlist position is a no-op returning the current
state — a double-tap cannot produce a surprise. Re-joining after withdrawing
takes a **fresh** queue position at the back (see ADR 0001).

**Errors**
| Message | Cause |
|---|---|
| `authentication required` | No session |
| `run not found` | Unknown id, or a draft the caller cannot see |
| `this run is not open for sign-up` | Run is draft, cancelled, started or finished |
| `this run has already started` | `starts_at` has passed |
| `unknown pace group: X` | Not one of the run's `pace_groups` |

---

### `withdraw_from_run(p_run_id uuid) → void`

Give up a place. If it was a confirmed place on a capped run, the first person
on the waitlist is promoted and notified in the same transaction.

| | |
|---|---|
| **Permission** | Any signed-in member, for their own attendance |
| **Concurrency** | Takes the same run-row lock as `join_run`, in the same order |

Promotion is FIFO by `queued_at`, **never** by `signed_up_at` — which promotion
itself overwrites. Withdrawing twice is a no-op.

**Errors**
| Message | Cause |
|---|---|
| `this run has already started; ask an organiser to remove you` | Past `starts_at` (App Spec §4.1) |

---

### `check_in(p_run_id uuid, p_lat float8, p_lng float8, p_accuracy_m float8 = null, p_client_ts timestamptz = null) → attendance_state`

Record attendance at the meeting point.

| | |
|---|---|
| **Permission** | Any signed-in member |
| **Returns** | `'checked_in'` |
| **Concurrency** | **No run-row lock**, deliberately |

The client sends a position; the server recomputes the distance and decides. A
client asserting it is in range is ignored.

**Why no lock:** check-in does not consume a capacity place — someone standing
at the meeting point is there whether or not the run is nominally full. Skipping
the lock also keeps the burst path fast, since a mass start means hundreds of
simultaneous check-ins that would otherwise serialise on one row.

**Acceptance rule:** `distance - accuracy ≤ radius`. Comparing raw distance
would reject members who really are present but have a poor GPS fix, and false
negatives are the failure mode that actually happens (ADR 0002).

**`p_client_ts`** is the device's clock at the moment of the tap, which lets an
offline check-in queue and replay later with its original time. It is trusted
only when plausible (within +5min/−24h); otherwise server time is used and the
implausible claim is still recorded as evidence.

**Window:** opens 60 minutes before `starts_at`, closes at `ends_at` (or
`starts_at + 4h`).

**Errors**
| Message | Cause |
|---|---|
| `check-in is currently handled by organisers` | `geofence_check_in` flag off |
| `check-in is not open yet` / `check-in has closed for this run` | Outside the window |
| `you look too far from X to check in (about Nm away)` | Outside radius + accuracy |

**Side effect:** writes a `check_in_evidence` row. Purged after 30 days
(ADR 0002 §5).

---

### `register_push_token(p_token text, p_platform text) → void`

Register a device for notifications. `p_platform` is `'ios'` or `'android'`.

**Reassigns the token to the calling user on conflict.** This is the point of the
function: a device can change hands, and without reassignment the new owner
receives the previous owner's notifications — a disclosure of personal data, not
merely a bug.

---

### `erase_member(p_user_id uuid) → void`

GDPR Article 17 erasure.

| | |
|---|---|
| **Permission** | Yourself, or an admin |

Destroys the profile, auth account, location evidence, devices and delivery
records. **Anonymises rather than deletes** attendance and its event log, so
headcounts for past runs stay correct — after erasure those rows record that
somebody attended, which is not personal data.

---

### `is_admin(uid uuid = auth.uid()) → boolean`

The single source of truth for authorisation. The mobile app, the admin console
and every admin RPC ask this; none decides for itself.

---

## Loyalty and the leaderboard

Points are earned by checking in, never by signing up — the club's currency is
attendance, and awarding for intent would make the board a measure of optimism.
The award happens in a trigger on the check-in transition rather than inside the
check-in RPCs, so a future third path to checking in cannot forget to award
(migration 0017).

An award stops counting the moment its check-in is removed or withdrawn. The
ledger row survives — it is append-only and records what happened — but every
total re-derives from valid check-ins, so an organiser undoing a mistaken
check-in silently and correctly takes the points back.

### `points_total(p_user_id uuid = auth.uid(), p_since timestamptz = null) → integer`

### `my_standing(p_window text = 'all_time') → row`

A member's own position: points, rank, total members, percentile, points to the
next rank, tier, points to the next tier, streak weeks, runs attended.

Works for **everyone**, including members outside the top 100 and members who
have opted out of the public board. Rank is computed against all members
regardless of opt-out, so hiding yourself does not shuffle anyone else.

`p_window` is `'all_time'` or `'month'`. Tier, streak and runs attended are
lifetime facts in both — there is no such thing as a monthly tier.

### `leaderboard(p_window text = 'all_time') → rows`

Top 100 by points: rank, user id, display name, avatar, points, tier, `is_me`.

**The single deliberate exception** to Phase 1's rule that a member can read only
their own profile, and the reasoning — including the risks the club accepted —
is in [ADR 0003](decisions/0003-leaderboard-visibility-and-loyalty.md). It exposes
three fields about another member and nothing else; there is no route from here
to another member's run-by-run history.

The 100 cap is enforced in SQL rather than by the caller, because a
client-supplied limit would let someone page through the whole membership.
Members with `leaderboard_opt_out` are filtered out *after* ranking, so opting
out hides a member without promoting everyone below them.

### `set_leaderboard_visibility(p_visible boolean) → void`

A member's own visibility, and only their own. Deliberately its own function
rather than a column update: this is a privacy control, not a preference, and it
is audited.

### `tier_for_points(integer)` · `points_to_next_tier(integer)` · `runs_attended(uuid)` · `current_streak_weeks(uuid, timestamptz)`

Pure helpers, exposed so the apps display the same numbers the ranking uses.
`points_to_next_tier` returns **null** at the top rather than zero, so the UI can
celebrate rather than render a dead target.

---

## Friends and pokes

App Spec §4.4: QR only. No search, no username lookup, no remote add. What
actually enforces "in person" is not the UI but the token — it lives three
minutes, burns on first use, and can be killed by the member or an organiser. A
screenshot forwarded to somebody who was not standing there has expired before
it arrives.

None of `friend_qr_tokens`, `friendships` or `pokes` is directly readable
(`pokes` excepted for the two people in it). Every read goes through a
`SECURITY DEFINER` function, because a member who could select `friendships`
could map the club's whole social graph — a member directory by another name.

### `my_friend_qr() → (token text, expires_at timestamptz)`

Returns the live token if there is one, mints a 3-minute one otherwise. Reusing
an unexpired token keeps the code on screen stable while it is being scanned.

### `revoke_my_friend_qr() → void`

Kills every code the member has ever shown (App Spec §8). Existing friendships
are untouched — this stops future adds, it does not undo past ones. Audited.

### `add_friend_by_token(p_token text) → uuid`

Auto-accepted, per §4.4: there is no request to approve because the approval
already happened physically. Single-use, so one shoulder-surfed screenshot
cannot be redeemed repeatedly.

Expired, revoked and never-existed all return the **same** message. A distinct
"no such code" would let someone probe for valid tokens.

**Errors:** `that code is not valid any more — ask them to show it again`;
`that is your own code`.

### `remove_friend(p_friend_id uuid) → void`

Unilateral, immediate, and **silent** — the other member is not notified. People
accept out of politeness, and a removal that pings the other person is one
nobody socially awkward will ever use. Also drops pokes in both directions and
withdraws any poke notification not yet sent.

### `my_friends(p_run_id uuid = null) → rows`

Friend id, display name, avatar, their state for **one** upcoming run, when you
became friends, and whether you have already nudged them about it.

Deliberately carries no statistics. A friends list carrying stats is a
leaderboard at n=2, and would re-expose exactly the per-run attendance the club
asked to hide.

### `poke_friend(p_friend_id uuid, p_run_id uuid) → void`

One nudge per friend per run, forever, enforced by a unique constraint. The
blast radius is exactly the set of people the member chose to scan a code with,
and unfriending is silent and unilateral.

**Errors:** `you can only nudge someone you have added as a friend`; `you can
only nudge someone about an upcoming run`; `you have already nudged them about
this run`.

### `admin_disable_member_qr(p_user_id uuid) → void` *(organiser)*

Moderation for App Spec §7: kill a reported member's code without touching their
account or their existing friendships. Audited.

### `admin_members(p_search text = null, p_limit integer = 50) → rows` *(organiser)*

The members directory: name, email, points, tier, runs attended, streak, last
run, when they joined, whether they are on the leaderboard, whether they have a
live friend code, and how many friends they have. Searches name and email;
capped at 200.

**This is the only thing in MVMNT that lists the whole membership, and it is
organiser-only.** `profiles` RLS is unchanged — a member still reads exactly one
row, their own — and the function refuses anyone `is_admin()` says no to.
[`03_access_control.sql`](../supabase/tests/03_access_control.sql) asserts both
halves: that an organiser can list and search it, and that a member gets an
error for either.

Email comes from `auth.users`, which is not reachable through PostgREST at all.
It is here because it is how an organiser tells two members with the same name
apart, and the only way to reply to a complaint.

Reads are not audited — logging every keystroke of a search would bury the
writes that matter. The two actions below are.

### `admin_member_detail(p_user_id uuid) → jsonb` *(organiser)*

Everything the database knows about one member, as a single document: profile,
badges, **friends by name**, friend-code status, registered devices, last 20
runs with how each check-in happened and whether its location evidence still
exists, last 20 points events with whether each still counts, last 20
notifications with delivery status, and every organiser action ever taken on
the account.

One call rather than eight, because the console would otherwise have to
assemble and keep eight results in step.

**Friends are returned by name, not as a count.** That is a genuine widening —
a friendship is a fact about two people, so listing it exposes a little of
somebody who is not the member being looked at. It is here because the owner
asked for it explicitly (2026-07-29: *"the organiser has all the trust, don't
hide anything from him"*), and because an organiser handling a complaint about
unwanted adds otherwise cannot see what was actually added. Organiser-only; no
member can reach any part of it.

### `admin_set_member_role(p_user_id uuid, p_role member_role) → void` *(organiser)*

Promote a member to organiser, or demote one back. **One tier only** — an
organiser can do everything another organiser can, including promoting more.
That is the owner's decision, on the basis that anyone holding the account is
someone they trust; there is no approval flow, cooldown or second signature.

Two refusals:

| Message | Cause |
|---|---|
| `the club owner's account cannot be demoted` | The target is the founding account |
| `this is the last organiser — promote someone else first` | Lockout backstop; only reachable if the founding account has been erased |

**The founding account** is `profiles.is_founder`, at most one row (partial
unique index). It claims itself: the first account ever promoted to admin gets
the flag, which is what makes it work on a brand-new project where migrations
run before a single account exists. If that account is erased the rule re-arms
for the next promotion, so a club can never end up with no protected way in.

The guard is on the **table**, not only in this function — `profiles` is
directly updatable by an admin through PostgREST, so an RPC-only check would be
sidestepped by a plain `PATCH`. Neither the role nor the flag itself can be
changed on the founding account through the API. The `auth.uid() is null`
exemption remains: that is the same bootstrap path that created the first admin,
and anyone with direct database access can already do anything.
[`03_access_control.sql`](../supabase/tests/03_access_control.sql) asserts every
one of these, through both the RPC and a direct write.

### `admin_adjust_points(p_user_id uuid, p_points integer, p_note text) → void` *(organiser)*

Settles a points dispute without hand-editing a ledger. Recorded as an
`adjustment` so it is visibly a human decision rather than something the rules
produced. **The note is required** — a correction with no stated reason is
unauditable six months later.

---

## Organiser functions

All check `is_admin()` internally. `EXECUTE` is granted to `authenticated` — the
grant is the outer fence, the check inside is what decides. All write to
`audit_log`.

### `publish_run(p_run_id uuid) → void`

Make a draft visible **and** schedule its whole notification timeline in one
act: `run_published` immediately, `reminder_evening_before` at 19:00 club time
the day before, and `reminder_morning_of` two hours before the start. Reminders
whose moment has already passed are skipped.

The audience is resolved at *send* time, so members who sign up tomorrow still
receive a reminder enqueued today.

**Errors:** `admin only`; `only a draft run can be published (this one is X)`;
`cannot publish a run that starts in the past`.

### `cancel_run(p_run_id uuid, p_reason text = null) → void`

Cancels the run and **deletes its pending notifications** — nobody should be
reminded about a run that is not happening. The run stays visible so members
find out why rather than watching it vanish.

### `start_run(p_run_id uuid)` / `end_run(p_run_id uuid) → void`

Manual overrides for the scheduler, so an organiser standing at the meeting
point can correct a late start from their phone. `run_started` goes to signed-up
attendees; `run_ended` goes to those who **checked in**, so a no-show does not
receive "nice work".

### `admin_check_in(p_run_id uuid, p_user_id uuid) → attendance_state`

Check a member in by hand. **The most important mitigation in the check-in
design** (ADR 0002 §3): it fixes every false negative — denied permission, dead
battery, phone in a locker, GPS drift — and is the practical anti-cheat, since
an organiser who can see the crowd is a better judge than any client signal.

Records `check_in_method = 'admin'`, so a manual check-in is never disguised as a
geofence hit.

### `admin_remove_check_in(p_run_id uuid, p_user_id uuid) → void`

Removes a check-in **and its location evidence** — retaining a location claim
for a check-in an organiser has just declared invalid serves no purpose and
fails data minimisation.

---

## Service-role only

`EXECUTE` is revoked from `anon` and `authenticated`. Both run automatically —
see *Scheduling* below — and are also callable by hand for testing.

### `scheduler_tick() → jsonb`

Advances run statuses and fans out due notifications. Returns
`{runs_started, runs_ended, events_fanned_out, deliveries_queued}`.

Idempotent throughout and uses `SKIP LOCKED`, so overlapping invocations divide
the work rather than blocking or double-sending. **Runs every minute** —
reminders are scheduled to the minute, so a coarser interval delays them by its
own length.

A member must never be able to call this, or they could force the club's entire
notification fan-out on demand.

### `purge_expired_location_data() → integer`

Deletes `check_in_evidence` older than 30 days (ADR 0002 §5) and returns the row
count. The check-in itself survives; only the coordinates go. **Runs daily** at
03:15 UTC.

---

## Scheduling

Both functions above are driven by `pg_cron`, set up in migration
`…030000_schedule_the_scheduler.sql`:

| Job | Schedule | Runs |
|---|---|---|
| `mvmnt-scheduler-tick` | `* * * * *` | `scheduler_tick()` |
| `mvmnt-purge-location` | `15 3 * * *` | `purge_expired_location_data()` |

They are scheduled as pure SQL, so there is no secret to store and nothing to
authenticate against. To check they are alive:

```sql
select jobname, schedule, active from cron.job;
select jobname, status, return_message, start_time
from cron.job_run_details r join cron.job j using (jobid)
order by start_time desc limit 10;
```

**What this does NOT cover: actually sending a push.** That needs an outbound
HTTP call to Expo, so it belongs to the scheduler Edge Function, which is
scheduled separately once `push_delivery` is switched on and APNs/FCM
credentials exist. Until then delivery rows accumulate as `pending`, which is
the honest state — queued, because sending is not configured. The commented
setup (pg_net + Vault for the service role key) is at the bottom of that
migration.

**Never inline the service role key into a cron command.** It would sit in
`cron.job` in plain text, readable by anyone who can read that table. Use Vault.

---

## Tables and views

| Object | Member can read | Member can write |
|---|---|---|
| `profiles` | Own row only | Own row, except `role` (trigger-guarded) |
| `runs` | Published/completed/cancelled | No |
| `run_attendance` | Own rows only | No — via RPC |
| `run_attendance_view` | Own rows (adds `state`, `is_in`) | No |
| `run_attendance_counts` | **All runs, aggregate only** | No |
| `run_attendance_events` | Own rows | No — append-only |
| `check_in_evidence` | Own rows only | No |
| `push_tokens` | Own rows | Delete only |
| `notification_events` | Only those addressed to them | No |
| `notification_deliveries` | Own rows | No |
| `audit_log` | Admins only | No — append-only |
| `feature_flags` | All | Admins only |
| `point_events` | Own rows only | No — via trigger/RPC |
| `member_badges` | Own rows only | No — via trigger |
| `badges` | All — the catalogue is not personal data | Admins only |
| `friendships` | **No** — only via `my_friends()` | No — via RPC |
| `friend_qr_tokens` | **No** — only via `my_friend_qr()` | No — via RPC |
| `pokes` | Only ones they sent or received | No — via RPC |

**There is deliberately no member directory.** A member can read exactly one
profile: their own. App Spec §4.4 makes QR-only friend adding a safety measure
against unsolicited contact, and that is worth nothing if the API lists everyone.
`run_attendance_counts` exists so the app can render capacity state without
exposing *who* — it publishes aggregates and selects no identifying column.

Phase 2 opened two holes in that wall and no more, both through
`SECURITY DEFINER` functions rather than by relaxing a policy:

- `leaderboard()` — name, avatar and points, for at most 100 people, excluding
  anyone opted out.
- `my_friends()` — name, avatar and one in/out flag, for people who physically
  scanned a code with you.

Neither exposes a run-by-run history, which is the specific thing that would turn
either feature into the attendance log the club asked to hide.

---

## Feature flags

| Key | Default | Effect |
|---|---|---|
| `geofence_check_in` | on | Off leaves organiser check-in as the only route — the intended fallback if GPS proves unreliable in the field |
| `push_delivery` | **off** | Off records deliveries as `logged` instead of sending. Turning it on is the entire change needed to go live once APNs/FCM credentials exist |

---

## Storage

| Bucket | Read | Write |
|---|---|---|
| `run-media` | Public | Organisers only |

Club promotional imagery only — cover photos and clips. Public read is
deliberate and safe *because nothing personal goes in it*.

**Phase 4's member photo galleries need a separate, non-public bucket.** A
gallery of identifiable members is personal data, and a public bucket would be
exactly the wrong default (Principles §4).

---

## Notification types

| Type | Audience | Fired by |
|---|---|---|
| `run_published` | All members | `publish_run` |
| `reminder_evening_before` | Signed-up attendees | Scheduled at publish, 19:00 club time the day before |
| `reminder_morning_of` | Signed-up attendees | Scheduled at publish, 2h before start |
| `run_started` | Signed-up attendees | `scheduler_tick` or `start_run` |
| `run_ended` | **Checked-in** attendees | `scheduler_tick` (needs `ends_at`) or `end_run` |
| `waitlist_promoted` | The promoted member | `withdraw_from_run` |
| `friend_poke` | The nudged friend | `poke_friend` |
| `badge_earned` | The member who earned it | `award_badges`, via the check-in trigger |

**Copy is rendered in SQL at enqueue time** and stored on the event row, so it
exists in exactly one place and the delivery worker does no formatting
(Principles §2). Times render in the club's timezone via
`app_private.club_timezone()`.

Six of the eight types are fully described by their run. The Phase 2 pair are
not — a poke needs the sender's name and a badge has no run at all — so
`render_notification` takes a `jsonb` context rather than growing a parameter
per type, and `enqueue_notification` accepts a null run when the notification is
addressed to a single member. Existing dedupe keys are byte-for-byte unchanged:
a changed key looks like a new event, and every already-sent notification would
send again.

**Idempotency** is `notification_events.dedupe_key` (unique) plus
`notification_deliveries (event_id, push_token)` (unique). Without both, one
scheduler retry double-pushes every member — 2,500 duplicate notifications at a
large event from a single retry.

Members with no registered device get a `skipped` delivery row rather than
nothing, so "why didn't I get that?" is answerable from the table
(Principles §7).
