/**
 * Load-test the burst-prone paths, before a large event does it for real.
 *
 * App Spec §12: design for ~300 as the normal case, but load-test the paths
 * that spike — "concurrent check-ins/sign-ups in a short window, simultaneous
 * live-location connections, and notification fan-out to thousands" — before
 * an event like the 2,500-person one. This script is that test, runnable
 * against the local stack on any machine. The club's real numbers: 100–150 a
 * Saturday, peaking at 300 — so 300 is the default and the number that has to
 * be comfortable; larger runs are headroom checks, not the target:
 *
 *   npm run db:reset
 *   MEMBERS=150 node scripts/load-test.mjs    # the normal Saturday
 *   MEMBERS=300 node scripts/load-test.mjs    # the peak (also the default)
 *
 * What it measures, in order:
 *   1. Everyone signs up for one run at once      (join_run)
 *   2. Everyone checks in inside one window       (check_in — the 9am burst)
 *   3. Everyone shares live position at once      (share_live_position)
 *   4. One notification fans out to all of them   (scheduler_tick)
 *
 * LOCAL ONLY, BY CONSTRUCTION. Members are minted by signing JWTs with the
 * local stack's fixed demo secret — the one that ships inside every
 * `supabase start` and is published in Supabase's own docs. Against a real
 * project that secret is wrong and every request fails with 401, which is
 * exactly the desired behaviour: this script cannot load-test production by
 * accident.
 *
 * Numbers from a local laptop are not production numbers. What they ARE good
 * for: catching a path that is accidentally quadratic, a lock that
 * serialises a burst, or an RPC that falls over at concurrency — the
 * failure shapes that follow the code wherever it is deployed.
 */

import crypto from 'node:crypto';

const API = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const MEMBERS = Number(process.env.MEMBERS ?? 300);
/** How many requests are in flight at once — a phone crowd, not a DoS. */
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 50);

// The fixed local demo credentials. See the header: being useless against
// production is the point.
const JWT_SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long';
const SERVICE =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

// --- tiny local JWT ---------------------------------------------------------
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
function memberJwt(userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'HS256', typ: 'JWT' });
  const payload = b64({
    sub: userId,
    role: 'authenticated',
    aud: 'authenticated',
    iss: `${API}/auth/v1`,
    iat: now,
    exp: now + 3600,
  });
  const sig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

// --- plumbing ---------------------------------------------------------------
async function service(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE,
      Authorization: `Bearer ${SERVICE}`,
      'Content-Type': 'application/json',
      ...(opts.headers ?? {}),
    },
  });
  return res;
}

/** Run `tasks` (functions returning promises) with a bounded pool. */
async function pooled(tasks, limit) {
  const results = new Array(tasks.length);
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

function stats(name, outcomes) {
  const ok = outcomes.filter((o) => o.ok);
  const errors = outcomes.filter((o) => !o.ok);
  const times = ok.map((o) => o.ms).sort((a, b) => a - b);
  const pct = (p) => (times.length ? Math.round(times[Math.floor((times.length - 1) * p)]) : 0);
  const wall = Math.round(outcomes.reduce((m, o) => Math.max(m, o.done), 0) - outcomes.reduce((m, o) => Math.min(m, o.start), Infinity));
  const rps = wall > 0 ? Math.round((outcomes.length / wall) * 1000) : 0;
  console.log(
    `  ${name.padEnd(28)} ${String(ok.length).padStart(5)} ok ${String(errors.length).padStart(4)} err · p50 ${pct(0.5)}ms · p95 ${pct(0.95)}ms · p99 ${pct(0.99)}ms · ${wall}ms wall · ~${rps}/s`,
  );
  if (errors.length) {
    const sample = {};
    for (const e of errors) sample[e.error] = (sample[e.error] ?? 0) + 1;
    for (const [msg, n] of Object.entries(sample).slice(0, 5)) console.log(`      ${n}× ${msg}`);
  }
  return { ok: ok.length, errors: errors.length };
}

async function timedRpc(jwt, fn, args) {
  const start = performance.now();
  try {
    const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE, // anon key would also do; apikey only routes
        Authorization: `Bearer ${jwt}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
    const ms = performance.now() - start;
    if (!res.ok) {
      const body = await res.text();
      const msg = (() => {
        try {
          return JSON.parse(body).message ?? body;
        } catch {
          return body;
        }
      })();
      return { ok: false, ms, error: `${res.status} ${msg.slice(0, 90)}`, start, done: start + ms };
    }
    return { ok: true, ms, start, done: start + ms };
  } catch (e) {
    const ms = performance.now() - start;
    return { ok: false, ms, error: String(e).slice(0, 90), start, done: start + ms };
  }
}

// --- the test ---------------------------------------------------------------
console.log(`\nLoad test · ${MEMBERS} members · ${CONCURRENCY} concurrent\n`);

// A guard against pointing this anywhere real: the demo secret must actually
// work. One probe with a minted token for a nonsense user — 401 means a real
// stack, and the run stops before any load is generated.
{
  const probe = await fetch(`${API}/rest/v1/runs?select=id&limit=1`, {
    headers: { apikey: SERVICE, Authorization: `Bearer ${memberJwt(crypto.randomUUID())}` },
  });
  if (probe.status === 401) {
    console.error('This stack does not accept the local demo JWT secret — refusing to load-test it.');
    process.exit(1);
  }
}

// 0. Mint the crowd.
console.log('Creating the crowd…');
let t0 = performance.now();
const memberIds = [];
{
  const tasks = Array.from({ length: MEMBERS }, (_, i) => async () => {
    const email = `load${i}@load.test`;
    const res = await service('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { display_name: `Load ${i}` } }),
    });
    if (res.status === 422) {
      // Already exists from a previous round — find it.
      const found = await (await service(`/auth/v1/admin/users?page=1&per_page=1&filter=${email}`)).json();
      return found.users?.[0]?.id ?? null;
    }
    const body = await res.json();
    return body.id ?? null;
  });
  const ids = await pooled(tasks, CONCURRENCY);
  memberIds.push(...ids.filter(Boolean));
}
console.log(`  ${memberIds.length} members in ${Math.round(performance.now() - t0)}ms\n`);

// A fresh uncapped run, starting soon enough that check-in is open.
const runRes = await service('/rest/v1/runs', {
  method: 'POST',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    title: 'Load Test 6K',
    starts_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    ends_at: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
    meeting_point_name: 'Load Test Gate',
    meeting_point_lat: 30.0444,
    meeting_point_lng: 31.2357,
    status: 'published',
    published_at: new Date().toISOString(),
    pace_groups: ['easy'],
  }),
});
const run = (await runRes.json())[0];
if (!run?.id) {
  console.error('could not create the load-test run', run);
  process.exit(1);
}

const jwts = memberIds.map((id) => memberJwt(id));

// 1. Everyone hits Join at once — a run drop.
console.log('1. The run drops: everyone joins at once');
let outcomes = await pooled(
  jwts.map((jwt) => () => timedRpc(jwt, 'join_run', { p_run_id: run.id })),
  CONCURRENCY,
);
const joined = stats('join_run', outcomes);

// 2. The 9am burst: everyone checks in inside one window.
console.log('2. The 9am burst: everyone checks in');
outcomes = await pooled(
  jwts.map((jwt) => () =>
    timedRpc(jwt, 'check_in', {
      p_run_id: run.id,
      p_lat: 30.0444 + (Math.random() - 0.5) * 0.001,
      p_lng: 31.2357 + (Math.random() - 0.5) * 0.001,
      p_accuracy_m: 15,
    }),
  ),
  CONCURRENCY,
);
const checked = stats('check_in', outcomes);

// 3. Everyone shares live position simultaneously (run must be in progress).
console.log('3. Everyone shares live position');
await service(`/rest/v1/runs?id=eq.${run.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ status: 'in_progress' }),
});
outcomes = await pooled(
  jwts.map((jwt) => () =>
    timedRpc(jwt, 'share_live_position', {
      p_run_id: run.id,
      p_lat: 30.05 + (Math.random() - 0.5) * 0.01,
      p_lng: 31.23 + (Math.random() - 0.5) * 0.01,
    }),
  ),
  CONCURRENCY,
);
stats('share_live_position', outcomes);

// …and a second wave, which is all UPDATEs on the same rows.
outcomes = await pooled(
  jwts.map((jwt) => () =>
    timedRpc(jwt, 'share_live_position', {
      p_run_id: run.id,
      p_lat: 30.05 + (Math.random() - 0.5) * 0.01,
      p_lng: 31.23 + (Math.random() - 0.5) * 0.01,
    }),
  ),
  CONCURRENCY,
);
stats('share_live_position (2nd)', outcomes);

// 4. Fan-out: end the run and let the scheduler deliver to everyone at once.
console.log('4. Notification fan-out to the whole crowd');
await service(`/rest/v1/runs?id=eq.${run.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ ends_at: new Date(Date.now() - 60 * 1000).toISOString(), starts_at: new Date(Date.now() - 3600 * 1000).toISOString() }),
});
t0 = performance.now();
const tick = await (await service('/rest/v1/rpc/scheduler_tick', { method: 'POST', body: '{}' })).json();
console.log(
  `  scheduler_tick               ${Math.round(performance.now() - t0)}ms · ${JSON.stringify(tick)}`,
);

// Tidy up: the load run and its debris, then the crowd.
console.log('\nCleaning up…');
t0 = performance.now();
await service(`/rest/v1/runs?id=eq.${run.id}`, { method: 'DELETE' });
{
  const tasks = memberIds.map((id) => () =>
    service(`/auth/v1/admin/users/${id}`, { method: 'DELETE' }),
  );
  await pooled(tasks, CONCURRENCY);
}
console.log(`  done in ${Math.round(performance.now() - t0)}ms`);

const failed = joined.errors + checked.errors;
if (failed > 0) {
  console.log(`\n${failed} join/check-in requests failed — read the samples above.`);
  process.exit(1);
}
console.log('\nAll bursts absorbed.');
