# The owner's questionnaire

Everything the software still needs **from the club's owner** — decisions,
assets and accounts, never code. Answer inline, in any order; nothing here
needs technical knowledge. Where a placeholder is live today, it is shown, so
"keep it" is always a valid answer.

The engineering half lives in [dev-todo.md](dev-todo.md).

---

## A · Tiers and rewards — who gets what

The chest currently promises placeholders, marked "being confirmed" in the
app. For each tier, give the real reward and (optionally) the exact line the
chest should say after **"Adam the Great has gifted you…"**

| Tier | Reached at | Current placeholder | Your reward |
|---|---|---|---|
| Rookie | joining | "A welcome from the club — the rest starts here" | __________ |
| Runner | ~5 runs | "A discount at the club shop" (how much %?) | __________ |
| Competitor | ~10 runs | "A free club shirt" | __________ |
| Elite | ~16 runs | "Priority place on capped runs" | __________ |
| Legend | 26 runs | "A custom shirt with your name on it" | __________ |

- **A2.** Are any rewards *ongoing* rather than one-off (e.g. Runner's
  discount applies forever vs once)? __________
- **A3.** One point is currently worth **10 piastres** in the shop (six months
  of perfect attendance ≈ a tenth off a ~450 EGP shirt). Keep or change?
  __________

## B · The club's runs

- **B1.** The real weekly schedule: which days, and 9am or 10am each?
  __________
- **B2.** The real meeting points — for each: the name members know it by,
  and a Google Maps pin (share the link). The geofence measures from this
  pin; a wrong one locks members out of check-in. __________
- **B3.** Which runs are capped, and at what number? (Only the seeded Track
  Session is capped today, at 5, as a demo.) __________
- **B4.** Who are the organisers on day one? List their emails — they sign in
  like anyone and get promoted from the console. __________

## C · Money — the shop and sponsors

- **C1.** The real catalogue: each item's name, price in EGP, sizes, and a
  photo. (Demo tiles live there today.) __________
- **C2.** Payment stays "reserve in app, pay at the run" until you obtain
  gateway quotes (Paymob/Fawry). Get quotes now, or launch without? ________
- **C3.** Current sponsors, if any: name, logo, what they were promised, and
  what they pay. (The app can already report honest daily reach per sponsor.)
  __________

## D · Identity, accounts and legal

- **D1.** The domain to buy (e.g. mvmnt.run / mvmnt-cairo.com — your call):
  __________
- **D2.** The club's legal name for the privacy policy's "we" (a person's
  name is fine if there is no company): __________
- **D3.** The contact email for data questions — your Gmail, or an address on
  the new domain? __________
- **D4.** Hosted database region — closest is `eu-central-1` (Frankfurt);
  there is no Egypt region. Any preference or objection? __________
- **D5.** Apple Developer enrolment: as an individual (fast, "Adam
  Elbasiony" in the store) or an organisation (needs a legal entity +
  D-U-N-S, shows the club's name)? __________
- **D6.** Egypt data-controller registration: do you have someone who can
  advise (lawyer / knowledgeable friend), or should this stay on the list?
  __________
- **D7.** Confirm the 18+ app account rule (under-18s run, organisers check
  them in by hand): yes / no __________

## E · Brand and voice

- **E1.** The app icon needs the actual logo file — the black-on-white mark
  you showed, ideally as SVG or a large PNG (1024×1024+). Send it. ________
- **E2.** The mark says **"LIVE IN THE MOVEMENT"**; the app's About page
  currently says "Run together." Which tagline is the club's? __________
- **E3.** Any Adam-voice lines to add, remove, or tone down before three
  hundred people read them? (The full catalogue is
  `packages/shared/src/voice.ts` — happy to print it for review.) __________

## F · Launch

- **F1.** A date for the dry-run Saturday, and the 8–10 trusted members for
  it: __________
- **F2.** Is another 2,500-person event planned? (If yes, a staging load
  test becomes due.) __________

---

*Answers land as: rewards/products/sponsors/meeting points → you or I enter
them in the console; accounts and assets → hand me access and the files;
decisions → I wire them in. Nothing on this page requires a developer to
answer, and everything on it unblocks one.*
