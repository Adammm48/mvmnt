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

### Privacy policy — three open questions

**Who:** the club owner, with legal advice.
**Where:** [`docs/privacy-policy.md`](privacy-policy.md), marked `[TO CONFIRM BEFORE PUBLICATION]`.

Both app stores require a published privacy policy at a public URL, and it
cannot be published with open questions inside it. The three are: which region
the Supabase project is hosted in (a cross-border transfer question under
Egypt's PDPL), whether under-18s attend club runs (which changes consent
requirements and the store age rating), and whether MVMNT must register as a
data controller.

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

## Deliberately not on this list

`scripts/restore-organiser.sql` contains `REPLACE_WITH_THE_EMAIL@example.com`.
That is an input typed at the moment the script is run, not an unfinished
decision. Flagging it forever would train everybody to ignore this output, which
is the exact failure the check exists to prevent.
