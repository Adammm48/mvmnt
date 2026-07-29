# The audit council's findings — and what was done about each

Five advisors read the entire repo with a mandate from the owner: every
button and its output, every bug, anything missing, and App Store / Google
Play compatibility. Every verified finding below was fixed the same session.
Full advisor texts: [the transcript](2026-07-29-audit-transcript.md).

## Store-rejection findings (all fixed)

| Finding | Fix |
|---|---|
| **No member-side content reporting** (Apple 1.2 / Play UGC — hard rejection). Photos and gift messages had organiser-only moderation. | `content_reports` table + `report_content()` / `admin_resolve_report()` (migration 0051); "Report this photo" on the gallery viewer; "Report this message" on received gifts; reports are private to organisers, deduped per open report, and outlive their targets. |
| **Dead "Continue with Apple/Google" buttons** (4.8/2.1 — non-functional UI). | Removed as stubs; rebuilt behind the `oauth_sign_in` feature flag (migration 0054) — they render only once the club's OAuth apps exist, flipped from the console with no app release. They ship as a pair because Apple requires its sign-in wherever Google's is offered. |
| **Camera purpose string was false** — claimed "nothing is recorded or uploaded" while find-me uploads a selfie. | Rewritten honestly: scanning records nothing; the selfie is optional, uploaded, deletable. Photo-library string added for the new pickers. |
| **"Coming soon" contact links tappable but dead.** | Placeholder links no longer render at all; a row appears the day its URL does. |
| **No `buildNumber`/`versionCode`.** | Both set; `runtimeVersion` policy added; `expo-updates` installed so post-launch fixes don't all require store review. |

## Production-killer bugs (all fixed)

| Finding | Fix |
|---|---|
| **The merch pipeline was dead on production** — the only path to "paid" was a dev stub that refuses outside development. | `admin_mark_paid()`: the organiser records an in-person payment — the function the stub had been quietly standing in for. Console wired to it. Tested. |
| **Selling out deleted the item** — last sale flipped it to 'retired', hiding it; gift recipients couldn't read the product, so the size picker vanished and redemption dead-ended. | New `sold_out` status (0052/0053): visible, honest, revived by restocking. Gift recipients can always read products their orders point at. Tested. |
| **Cancelling an order resurrected retired products.** | Restock revives only `sold_out`. Tested. |
| **Android sign-out-on-every-launch landmine** — SecureStore's 2048-byte limit acknowledged in a comment, unhandled in code. | Chunked storage adapter (≤1900-byte chunks with a count header, legacy passthrough, stale-chunk cleanup). |
| **No crash boundary** — one render throw was a white screen forever. | `CrashBoundary` at the root: a human screen, a way back, and the seam where a crash service plugs in (account-gated, dev-todo). |
| **Push would fail silently in a store build** — missing projectId threw into a catch labelled "expected in Phase 1". | Explicit unconfigured check with an honest message before the token call. |
| **`window.prompt` in Cancel run** — the one surviving native dialog; suppressed prompts silently cancelled nothing. | Styled reason sheet matching the console's confirm modals. |
| **A live run couldn't be edited** — the past-start lock exempted only 'completed'. | Only drafts are scolded about the past; a published or in-progress run stays editable. |
| **Admin check-in silently reversed a member's withdrawal.** | Withdrawn rows get their own labelled button ("Re-add & check in") behind a confirm. |
| **Stale "You're in!"** above a successful withdrawal. | Celebration cleared on withdraw. |

## Dead-ends and gaps (all fixed)

- **Deep links**: `badge_earned` → profile, `gift_received` → orders (they carried no run id and landed on home).
- **Roster export**: run-day CSV, copied from the sponsor report's proven pattern.
- **Avatars**: upload path at last (public `avatars` bucket, own-folder writes, `set_avatar()` refusing foreign paths, erasure deletes the files); profile picker; leaderboard/friends render through one helper.
- **Voice**: `streak_new` / `milestone_100` finally fire, on the post-check-in moment they were written for.
- **Chest with unconfirmed reward** reframed — "It's being engraved" instead of an IOU at the app's biggest moment.
- **Silent controls now speak**: shop quantity cap explains itself; admin stock ± toasts; the gift row is a real bordered control (and disabled with a reason when there are no friends).

## Owner-reported (same session, all fixed)

- "We sent a code to…" was black-on-black — the rebrand had turned `surfaceSunken` into a dark token under an ink-text notice.
- The zero-point standing card babbled ("0 runs / — streak / 40 points to move up a place") — replaced by one welcoming line until the first check-in.
- The tier ladder lost its colours in the rebrand retune — every rung now wears its own tier colour, dimmed until reached.
- "0K with the club" reads "— / first run pending" before the first check-in.
- Find-me accepts a library photo as well as a selfie (owner override of the camera-only rule, recorded in the code).

## Known-remaining (owner-gated, unchanged)

Policy URL, OAuth app configuration, EAS project id, crash-service account,
Google data-safety form (declare: email, name/avatar, precise location,
photos, biometrics). All in [dev-todo.md](../dev-todo.md).
