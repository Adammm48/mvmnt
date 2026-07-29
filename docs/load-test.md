# Load test — the burst paths

The club's real numbers (owner, 2026-07-29): **100–150 runners on a normal
Saturday, peaking at 300.** One historic event reached 2,500, but that is an
outlier to be planned for deliberately if it ever recurs, not the design
target — so the stress band here is the real one: 150 as the typical case,
300 as the peak, with one oversized run kept as a headroom check.

App Spec §12 names the paths that spike: concurrent sign-ups and check-ins
in a short window, simultaneous live-location updates, and notification
fan-out to the whole crowd at once.

`scripts/load-test.mjs` is the test. It runs against the local stack only —
members are minted by signing JWTs with the fixed local demo secret, which a
real project rejects, so the script **cannot** load-test production by
accident. Run it with:

```
npm run db:reset
MEMBERS=150 node scripts/load-test.mjs    # the normal Saturday
MEMBERS=300 node scripts/load-test.mjs    # the peak
```

## What local numbers are and are not

A laptop's Postgres is not the hosted project. These numbers do not predict
production latency. What they do catch — and the reason the spec asks for the
test — are the failure *shapes* that travel with the code wherever it runs:
a path that is accidentally quadratic, a lock that serialises a burst
(capacity counting takes `FOR UPDATE` on the run row — the obvious suspect),
or an RPC that starts refusing under concurrency.

## Results — 2026-07-29, local stack (M-series laptop)

**150 members, 50 concurrent** — the normal Saturday:

| Burst | ok / err | p50 | p95 | p99 | wall |
|---|---|---|---|---|---|
| `join_run`, all at once | 150 / 0 | 36ms | 119ms | 153ms | 0.16s |
| `check_in`, all at once | 150 / 0 | 40ms | 106ms | 139ms | 0.16s |
| `share_live_position` | 150 / 0 | 20ms | 44ms | 54ms | 0.08s |
| second wave (all UPDATEs) | 150 / 0 | 17ms | 60ms | 77ms | 0.08s |
| fan-out via `scheduler_tick` | 150 deliveries | — | — | — | 8ms |

**300 members, 50 concurrent** — the peak:

| Burst | ok / err | p50 | p95 | p99 | wall |
|---|---|---|---|---|---|
| `join_run` | 300 / 0 | 33ms | 114ms | 170ms | 0.28s |
| `check_in` | 300 / 0 | 35ms | 124ms | 208ms | 0.31s |
| `share_live_position` | 300 / 0 | 23ms | 52ms | 74ms | 0.16s |
| second wave | 300 / 0 | 17ms | 50ms | 64ms | 0.14s |
| fan-out via `scheduler_tick` | 300 deliveries | — | — | — | 11ms |

**Headroom check, ~1,800 members at 100 concurrent** (run once to see where
the ceiling might be — roughly the historic outlier event, and 6× the peak):

| Burst | ok / err | p50 | p95 | p99 | wall |
|---|---|---|---|---|---|
| `join_run` | 1764 / 0 | 62ms | 300ms | 450ms | 1.7s |
| `check_in` | 1764 / 0 | 71ms | 311ms | 442ms | 1.8s |
| `share_live_position` | 1764 / 0 | 40ms | 105ms | 171ms | 0.8s |
| second wave | 1764 / 0 | 39ms | 88ms | 137ms | 0.8s |
| fan-out via `scheduler_tick` | 1764 deliveries | — | — | — | 24ms |

(1,764 rather than the requested 2,500: GoTrue's admin user-creation API
dropped some of the crowd-minting calls under pool pressure. That is the
test harness building its fixtures, not an app path — real members sign up
weeks before an event. Every burst that ran, ran clean.)

## Reading of the results

- **At the club's real scale — 150 to 300 — every burst clears in well under
  half a second with zero errors.** The whole Saturday peak is absorbed
  faster than one person's screen transition.
- **The `FOR UPDATE` on the run row during capacity counting — the obvious
  serialisation risk — holds up.** Even at 6× the peak it queues rather than
  collapses (check-in p95 grew ~2.5× for ~6× the crowd).
- **Fan-out is effectively free** at any of these scales (one
  `INSERT … SELECT` per event). The expensive half of notifications is the
  push provider, which is out of scope here (`push_delivery` stays off until
  credentials exist).
- **Live positions behave the way ADR 0004 says**: the second wave, pure
  UPDATEs on the same rows, is the cheapest burst in every table — the
  one-row-per-member design stays one row per member under load.

## Before a genuinely oversized event

If another 2,500-person event is planned: re-run this against a **staging**
hosted project (set `SUPABASE_URL` and that project's service key — never the
live one), and test the one thing this script cannot exercise locally —
Expo's push throughput once `push_delivery` is on. Both are listed in
[open-items](open-items.md).
