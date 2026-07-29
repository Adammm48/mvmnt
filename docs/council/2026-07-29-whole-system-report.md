# Council review — the whole system, before the first real member

**Date:** 2026-07-29 · **Question:** App Spec §0's end-of-build review.
**Method:** five advisors read the repo independently, then reviewed each
other's findings anonymously, then this synthesis. Karpathy's LLM Council,
adapted. Earlier councils: the Phase 1 data model, and the Phase 2
leaderboard/privacy conflict.

**Anonymisation mapping** (revealed): A = Executor · B = Contrarian ·
C = Outsider · D = Expansionist · E = First Principles Thinker.

---

## Where the council agrees

**The app is well built and cannot launch yet, and those are not in
tension.** Nobody disputed the architecture — rules in Postgres, RLS
everywhere, tested — and nobody thought it was ready for a real Saturday.
Every advisor independently reached the same shape of answer: the
engineering is ahead of the operational reality by a wide margin.

**Sign-in is the launch blocker nobody had written down.** Three advisors
found it separately. Auth is email OTP only; the only SMTP configured
anywhere in the repo is Inbucket, the local test double. Supabase's
built-in sender is rate-limited (this config: 2/hour). 150 members signing
in on one Saturday morning hit that wall with no second door — it is not
in `docs/open-items.md`, it costs ~$0–20/month to fix, and it outranks
everything else on the list including the privacy policy.

**Nothing has ever run outside a laptop.** No hosted Supabase project, no
region chosen (which is a PDPL question, not just an ops one), no
`eas.json`, no release binary, no physical device, no real GPS. CI green
against ephemeral containers has never once exercised migration drift on a
persistent database.

**"Zero developer handover" is true only where a console screen exists.**
Two advisors landed on the same gap from opposite directions: there is no
runbook and no monitoring. If the scheduler dies, the owner cannot tell a
broken cron from a quiet week. The break-glass recovery is a raw SQL
script — which assumes a comfort level "non-technical" does not include.

## Where the council clashes

**Ship less, or ship what exists?** First Principles wants sponsors,
merch, gifts, pokes and live location deferred — ~2,500 lines of permanent
surface for a club with no payment gateway and no signed sponsors — and
wants absence decay killed outright as a product risk (punishing a missed
Saturday in a club whose actual problem is turnout). The Expansionist
argues the opposite: the sponsor reporting is the most commercially
valuable thing here precisely because its reach numbers are honest, and the
QR-friends + gift loop is a referral engine already built.

Two reviewers sided with deferral, and one made the argument that decides
it: the Contrarian's critical bugs live *exactly* in the subsystems First
Principles wants dormant. That is not a coincidence — untested-in-anger
surface is where the holes were.

**Native app, or the web build?** First Principles argues shipping the
existing `react-native-web` build at a URL decouples the first real member
from Apple's D-U-N-S wait entirely — the club already shares links in
WhatsApp, and push is inert on native too until credentials exist. The
Executor sequences everything through the App Store. Two reviewers
independently checked the web claim and found it holds.

## Blind spots the council caught

**Only one advisor found the security holes — and all three were real.**
The verification reviewer confirmed each against the code, and this
session then reproduced and fixed all three (migration 0045, committed):

- **The geofence was a suggestion, not a control.** `check_in()`
  subtracted the client's *own reported accuracy* from the measured
  distance with no ceiling. One authenticated call with
  `p_accuracy_m: 9999999` checked you in from anywhere on Earth — and
  since check-in creates the attendance row when absent, it was a single
  request. Attendance is the currency points, tiers, rewards and shop
  discounts are all denominated in.
- **`dev_mark_paid` was member-callable, for anybody's order.** Granted to
  `authenticated`, with no buyer check. Its only guard was "refuse if no
  `@mvmnt.test` account exists" — and `seed.sql` and the screenshot script
  create exactly those accounts. Seeding a live project once, for a demo,
  would have handed every member a free-shirt button.
- **Points could be spent twice.** `place_order` locked the product row but
  never the buyer.

**Consent for photos is opt-out-after-the-fact.** The galleries are
private, signed-URL, publish-gated — and there is still no upfront consent
capture for photographing identifiable people. The reviewer's point stands
that this is more than one of "four open questions".

**Legal and data creation are one dependency, not two.** Every advisor
treated "create the hosted project" and "settle the privacy policy" as
parallel tracks. Once real GPS and attendance data lands before the consent
mechanics are settled, that is a one-way door under Egypt's PDPL — there is
no retroactive consent.

**Nobody proposed a pilot.** Two reviewers converged on it independently:
there is no plan for a small trusted cohort on real hosted infrastructure
before 150 people arrive, and no kill switch for the owner when something
breaks live.

## The recommendation

**Do not launch to the whole club. Run one dry-run Saturday with 8–10
trusted members on real hosted infrastructure, and treat everything else as
downstream of that.**

This is the Contrarian's severity reasoning combined with the ordering
reviewer's correction of it. The bugs are fixed, but they were found by
reading — not by use, and the same council noted the four *previous*
silent-failure bugs were all found by the owner using the app, never by
tests. The dry run is the cheapest instrument that turns unknown-unknowns
into a list.

Sequenced by external lead time, because that is what cannot be
compressed:

1. **Start Apple enrolment today** (D-U-N-S, 1–2 weeks, free to begin) —
   longest pole, blocks push and the store, blocks nothing else.
2. **Create the hosted Supabase project and choose its region now**, while
   the database is still empty. Migrating an empty schema is trivial;
   migrating real member data later is not, and the region is a legal
   answer, not a preference.
3. **Wire a real email provider before anybody signs in.** This is the
   single highest-value hour of work available.
4. **Settle photo consent before the first gallery**, since it cannot be
   obtained retroactively.
5. **Then the dry run**, on that infrastructure, with real phones and real
   GPS at a real meeting point.

Deferral verdict: **do not delete anything, but keep the shop dark until a
real Saturday works.** First Principles is right about the risk and wrong
about the remedy — the code is written, tested and costs nothing dormant,
and `products.status` already gates the catalogue with no schema change.
Absence decay is the exception: that is a *product* judgement about a club
with a turnout problem, and it deserves the owner's explicit decision
rather than a default.

## The one thing to do first

**Create the hosted Supabase project, in a deliberately chosen region,
today — before a single real row exists.** Everything else in the list can
be reordered. This one gets strictly more expensive from the moment the
first member signs up, and it is the precondition for the dry run that
tells you what you actually don't know.
