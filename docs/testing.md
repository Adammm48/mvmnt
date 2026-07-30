# How this project tests

Three layers, each answering a different question. The split exists because
this project shipped the same class of bug four times and none of the tests
caught any of them.

## The bug that shaped this

Four platform calls did nothing on web. A notification tap opened nothing. A
published photo gallery was permitted, correct, and unreachable. Dead sign-in
buttons sat on the first screen for weeks.

Every one was found by a person using the app. The database suites were
thorough and caught none of them, because they asked *"did the function
return?"* and every one of these bugs answers *yes*. The member was simply
never told anything.

So the layers are organised around **who is asking**.

| Layer | Question | Where | Runs |
|---|---|---|---|
| Database | Does the rule hold, for every caller? | `supabase/tests/*.sql` | `npm run db:test` |
| Structure | Can this even be reached or seen? | `scripts/check-*.mjs` | `npm run check:reachable` |
| Visible outcome | Does the member learn what happened? | `tests/e2e/*.mjs` | `npm run test:e2e` |

All three run in CI, including the browser suite — it needs the Supabase
stack, both dev servers and their env vars, which took four attempts to get
right on a runner. Notes in the workflow explain each, because every one of
those failures was a CI-only problem that could not be reproduced locally.

## 1 · Database — the rules

410 assertions over the RPCs and row-level security. This layer is strong and
should stay the first place a new rule is proven: it is fast, it runs every
caller through every policy, and it is where "an organiser can, a member
cannot" belongs.

Two conventions, both enforced by `scripts/test-db.sh` rather than remembered:

- **Every suite wraps itself in one transaction and rolls back at the end of
  the file.** Twice, a block appended after the `rollback;` ran in autocommit
  and committed its fixtures — the suite then passed once after a reset and
  failed for ever after. The runner now refuses to start if any file has SQL
  after its rollback.
- **Never assert a global count.** The seeded database carries demo rows, so
  `count(*) from products` is a number that changes when somebody adds a
  product. Scope every assertion to the fixture's own rows. This has bitten
  products, sponsors, badges, tier history and reports.

## 2 · Structure — reachability

`npm run check:reachable` walks the router's file tree and fails if any screen
has nothing pushing, linking or tabbing to it.

This exists for one bug: a gallery whose only route in was a push notification
the club cannot yet send. Every test navigated to it by URL — the one thing a
member cannot do — so it passed while being unopenable.

The check is a grep, not a graph. It proves a path was *written*, not that it
is reachable under every condition. That is the difference between an oversight
and a decision, which is what it is for.

## 3 · Visible outcome — what the member sees

`npm run test:e2e` drives a real browser against the real stack. The rule for
this layer, and the reason it exists:

> **Assert what is on screen, never that a call succeeded.**
> Every assertion must be a question a member could answer by looking at their
> phone.

So the suite checks that joining a run *says so*; that sharing either opens the
sheet or explains why it cannot; that a failed screen offers a way back; that a
report confirms; that the friend code shows its countdown. Each block maps to a
bug that actually shipped.

Two harness decisions worth knowing:

- **Sessions are cached per email.** The local auth config allows two sign-in
  emails an hour, and a suite that signs the same member in for every block
  silently runs the later blocks with no session — which looks exactly like a
  broken app.
- **A failing assertion prints what was on screen instead.** A test that fails
  without saying what it saw is the same unhelpfulness this suite exists to
  remove.

### Writing a new one

Add a block to `tests/e2e/visible-outcomes.mjs`. Use `openApp` / `openConsole`
from the harness, then `seen(page, text, description)`. Prefer asserting the
*state-independent invariant* over the fixture's current state — the attendance
block reads whichever button is on screen and asserts that pressing it reports
an outcome, rather than assuming the member has not joined yet.

## What is deliberately not tested

- **Anything needing a physical device**: real GPS at a meeting point, the
  camera scanning a code in sunlight, push permission prompts, a real
  notification arriving. The web build cannot exercise these, and pretending
  otherwise is worse than the gap. They are the dry-run Saturday's job
  ([dev-todo](dev-todo.md) step 6).
- **Visual regression.** Screenshots are regenerated for the README, not
  diffed. At this scale a person looking at the screen is cheaper and catches
  more than a pixel budget.
