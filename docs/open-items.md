# Open items — placeholders that still need a real answer

Run `npm run check:placeholders` for the live list. **That command reads the
source; this page explains it.** If the two ever disagree, the command is right.

A hand-kept list of "fix later" goes stale the first time somebody fixes one and
forgets to cross it off — and then it is worse than nothing, because it is
confidently wrong. So the list is generated and this page carries only the
reasoning: who can answer each one, and what actually goes wrong if it ships
unanswered.

**Nothing here is filled with a guess.** Every placeholder is either visibly
marked in the UI ("coming soon", "being confirmed") or an empty value that
refuses to be used. That is deliberate: a plausible-looking value stops looking
like a placeholder, and then it never gets fixed — it just ships.

---

## Blocks release

### Privacy policy — two open questions

*(Two of the original four are answered and built: photo consent is now asked
in the app and recorded with its version, and the app account is 18+ with
under-18s checked in by an organiser. See migration 0048.)*

**Who:** the club owner, with legal advice.
**Where:** [`docs/privacy-policy.md`](privacy-policy.md), marked `[TO CONFIRM BEFORE PUBLICATION]`.

Both app stores require a published privacy policy at a public URL, and it
cannot be published with open questions inside it. The two remaining are:
which region the Supabase project is hosted in (a cross-border transfer
question under Egypt's PDPL, and the same decision as creating the hosted
project), and whether MVMNT must register as a data controller.

One more thing turns the consent screen from honest to complete: **the policy
needs a public URL**. `POLICY_URL` in `packages/shared/src/consent.ts` is an
empty string, so the screen currently says the policy is being finalised
rather than linking to something that does not exist. The same domain
purchase covers the sending address for sign-in codes.

This is the item most likely to hold up a launch, and it is writing and advice
rather than engineering — so it can start now and run in parallel with
everything else.

---

## Breaks a feature in the field

### Real meeting points

**Who:** the club owner.
**Where:** [`supabase/seed.sql`](../supabase/seed.sql).

The seeded landmarks (Zamalek Club Gate, Cairo Stadium Track, Al-Azhar Park, New
Cairo Waterway) are approximations. **The geofence measures from these
coordinates**, so a wrong one means members standing at the real meeting point
are told they are too far away to check in.

Organisers set coordinates per run in the console, so this only affects seeded
demo data — but the moment a real run is created from a copied placeholder, it
is live.

---

## Visible to members, and to anyone reading this repo

### What each tier is actually worth

**Who:** the club owner.
**Where:** the `tier_rewards` table — organiser console → **Rewards**.

All five carry plausible copy (a discount, a free shirt, a custom shirt at
Legend) flagged `is_placeholder`, so members see them marked **being confirmed**
rather than as offers. The club is currently promising nothing, which is the
right state to launch in and the wrong one to stay in.

No deploy needed: an organiser edits these and members see the change
immediately.

### The spec's own contact line

**Who:** the club owner.
**Where:** [`docs/spec/MVMNT_App_Spec_1.md`](spec/MVMNT_App_Spec_1.md), line 4.

The build spec itself carries `[business email or website — add here]`, unfilled
since before this project started. Harmless to the running app, but a public
repo with an obviously unfinished line in its founding document looks
unfinished.

### Adam's contact links

**Who:** Adam.
**Where:** `CONTACT_LINKS` in [`packages/shared/src/voice.ts`](../packages/shared/src/voice.ts).

GitHub is real. Portfolio, LinkedIn and email are **empty strings** with
`placeholder: true` — the About page renders them as "coming soon" and refuses
to open them. They are empty rather than invented because a plausible-looking
URL that 404s in front of three hundred members is worse than one that is
visibly unfinished, and guessing somebody's portfolio address is exactly how
that happens.

---

## A number that is a guess

### What a loyalty point is worth in the shop

**Who:** the club owner.
**Where:** `points_discount_minor()` in migration 0035, mirrored by
`PIASTRES_PER_POINT` in [`packages/shared/src/shop.ts`](../packages/shared/src/shop.ts).

**10 piastres a point.** That makes six months of perfect attendance worth about
a tenth off a shirt, and a full year about a fifth.

The first version used one point to one piastre because it was the roundest
possible rule. Putting it on screen showed what that meant: 400 points — half a
year of Saturdays — took **EGP 4** off a 450-pound shirt. Under one percent. A
discount that small tells a member exactly what the club thinks their year was
worth, so it was raised.

The current rate is a defensible guess, not a decision. It is deliberately below
the tier rewards, which already promise a free shirt at Competitor — points and
tiers reward the same members, and if points alone bought the shirt the tier
would mean nothing. Worth revisiting once real merch prices exist.

**Change it in both places or neither.** The database and the app quoting
different rates is how a shop charges something other than the number it showed.

---

## Blocks Phase 3

### Payment gateway costs

**Who:** the club owner.
**Where:** [`docs/costs.md`](costs.md), marked `[NEEDS A QUOTE]`.

Stripe does not support Egypt-based businesses, so merch needs an Egyptian
gateway — Paymob, Fawry or Accept. Fees are roughly 2.5–3.5% plus a fixed
amount, but setup and monthly costs vary and are negotiable at volume, and the
answer depends on whether MVMNT is a registered company.

Two quotes are needed before the merch checkout can be built. Everything else in
Phase 3 — sponsors, and the merch catalogue itself — can be built without them.

---

## Switches Phase 5 fully on

### A face-recognition service account

**Who:** Adam, when the club wants "find me in photos" live.
**Where:** set `FACE_PROVIDER_KEY` on the hosted project and finish the
provider block in `supabase/functions/match-faces/index.ts` (marked
REPLACE ME).

Everything else is built: opt-in selfies, the match rows, the "You" tab,
unit deletion, erasure. AWS Rekognition is the reference choice (ADR 0005);
the cost model is per published gallery, not per view — a few dollars a
month at this club's photo volume, but it is a budget decision and a data
processing agreement, so it is yours.

### The Apple Developer + Play Console accounts (again)

The same accounts that unlock push and the stores also unlock the phone half
of Your stats — HealthKit needs the entitlement, Health Connect needs the
Play declaration. The adapter seam is `apps/mobile/src/lib/health.ts`
(marked REPLACE ME); nothing above it changes.

## Owed to the spec

### Load test against the hosted project, if a big event recurs

**Who:** Adam, when (if) another oversized event is planned.
**Where:** [`docs/load-test.md`](load-test.md) has the local results and the how.

The local stack absorbs the club's real scale — 150 typical, 300 peak — with
zero errors and sub-half-second bursts, and holds at 6× that as a headroom
check. Two things the local run cannot prove: the hosted project's Postgres
under the same burst (run the script against a **staging** project), and
Expo's push throughput once `push_delivery` is switched on. Neither blocks
normal Saturdays; both are due before another 2,500-person event.


### ~~The end-of-build whole-system review~~ — DONE, 2026-07-29

Run and recorded: [council report](council/2026-07-29-whole-system-report.md),
[full transcript](council/2026-07-29-whole-system-transcript.md). It found
three real security holes (all fixed in migration 0045) and one launch
blocker that was not on this list — see below.

---

## Blocks the first real Saturday

### An email provider for sign-in codes — **use Resend**

**Who:** Adam. **Cost:** free, probably forever.
**Where:** the SMTP block in [`supabase/config.toml`](../supabase/config.toml)
is filled in and commented, with the go-live steps.

The whole login path is a 6-digit emailed code, and the only mail sender in
this repo is Inbucket — a local test double that delivers to nobody. On a
hosted project with nothing configured, Supabase's built-in sender takes over:
rate-limited to a couple of messages an hour, from a shared domain. 150
members signing in on one Saturday morning hit that wall with no second door.

**The comparison, as of July 2026:**

| | Free tier | Then | Verdict for MVMNT |
|---|---|---|---|
| **Resend** | 3,000/month, 100/day, 1 domain | $20/mo for 50,000 | **Pick this** |
| Postmark | 100/month, hard stop | $15/mo for 10,000 | Best-in-class deliverability, but 100/month is unusable — onboarding alone blows through it, so it is $15/mo from day one |
| SendGrid | **gone** — retired May 2025 | $19.95/mo after a 60-day trial | No longer a free option at all |

**Why Resend wins on this club's actual numbers.** Steady state is small:
sessions persist, so a member only needs a code when they sign in on a new
device — realistically well under 200 emails a month for 150 members. Resend's
3,000/month is not close to a constraint.

The one pinch is the **100/day** cap on the day the club onboards. Two ways
past it, and the first is free: onboard in waves rather than all at once,
which the dry-run recommendation means you are doing anyway — or pay $20 for
the launch month and drop back to free.

Postmark is the better product on pure deliverability and it is worth knowing
that if codes ever do go to spam at scale. It is not worth $15/month from day
one for a club whose entire monthly volume fits inside a free tier.

**Before it works, you need the domain** — for the sending address and,
separately, to publish the privacy policy that both app stores require. One
purchase, two blockers cleared. The DNS records Resend asks for (SPF, DKIM,
DMARC) are the difference between arriving and going to spam; they are not
optional decoration.

### The hosted Supabase project, in a chosen region

**Who:** Adam. **Do it while the database is still empty.**

Nothing has ever run outside a laptop. Creating the project is minutes;
choosing the region is a legal answer under Egypt's PDPL rather than a
preference, and it is also the first of the privacy policy's four open
questions. Migrating an empty schema is trivial. Migrating real member data
later is not.

### A dry-run Saturday before the real one

**Who:** Adam plus 8–10 trusted members.

The council's central recommendation. Every silent-failure bug in this
project's history was found by somebody *using* the app, never by tests —
and the three security holes the council found were found by reading, not
by use. One small real Saturday on the real infrastructure, with real
phones at a real meeting point, is the cheapest instrument that turns
unknown-unknowns into a list.

---

## Deliberately not on this list

`scripts/restore-organiser.sql` contains `REPLACE_WITH_THE_EMAIL@example.com`.
That is an input typed at the moment the script is run, not an unfinished
decision. Flagging it forever would train everybody to ignore this output, which
is the exact failure the check exists to prevent.
