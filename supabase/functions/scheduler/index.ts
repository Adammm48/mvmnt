/**
 * The scheduler.
 *
 * One scheduled entry point that does three things, all idempotent, so a retry
 * or an overlapping invocation is harmless:
 *
 *   1. scheduler_tick()              — advance run statuses, enqueue and fan out
 *   2. deliver pending notifications — batched to Expo, or logged (see below)
 *   3. purge_expired_location_data() — the 30-day rule from ADR 0002 §5
 *
 * Run it every minute. Reminders are scheduled to the minute, so a coarser
 * interval delays them by up to its own length.
 *
 * PHASE 1: `push_delivery` is off until MVMNT owns an Apple Developer account
 * and a Firebase project. While off, deliveries are marked 'logged' rather than
 * sent — the whole pipeline runs and is observable in notification_deliveries,
 * only the outbound HTTP call is skipped. Turning the flag on is the entire
 * change needed to go live.
 */

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Expo's push API accepts at most 100 messages per request. */
const EXPO_BATCH_SIZE = 100;
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

/** Bounded so one bad run cannot spend the whole function timeout retrying. */
const MAX_DELIVERIES_PER_TICK = 2_000;
const MAX_ATTEMPTS = 3;

type Delivery = {
  id: number;
  event_id: string;
  push_token: string;
  attempts: number;
  notification_events: { title: string; body: string; run_id: string | null; type: string } | null;
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const url = Deno.env.get('SUPABASE_URL');
  if (!serviceKey || !url) {
    return json({ error: 'function is misconfigured' }, 500);
  }

  // Server-to-server only. Supabase's verify_jwt accepts any valid project JWT
  // including the anon key, so a member could otherwise trigger the club's
  // entire notification fan-out on demand.
  const presented = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (presented !== serviceKey) {
    return json({ error: 'forbidden' }, 403);
  }

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const { data: tick, error: tickError } = await supabase.rpc('scheduler_tick');
    if (tickError) throw new Error(`scheduler_tick failed: ${tickError.message}`);

    const delivery = await deliverPending(supabase);

    // Cheap and idempotent; a no-op on all but the first run of each day.
    const { data: purged, error: purgeError } = await supabase.rpc(
      'purge_expired_location_data',
    );
    if (purgeError) throw new Error(`purge failed: ${purgeError.message}`);

    return json({ ok: true, tick, delivery, location_rows_purged: purged });
  } catch (error) {
    // Logged rather than swallowed: a silent scheduler is indistinguishable
    // from one with nothing to do (Principles §7).
    console.error('scheduler failed', error);
    return json({ ok: false, error: String(error) }, 500);
  }
});

async function deliverPending(supabase: SupabaseClient) {
  const { data: flag } = await supabase
    .from('feature_flags')
    .select('enabled')
    .eq('key', 'push_delivery')
    .maybeSingle();

  const sendForReal = flag?.enabled === true;

  const { data: pending, error } = await supabase
    .from('notification_deliveries')
    .select('id, event_id, push_token, attempts, notification_events(title, body, run_id, type)')
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .limit(MAX_DELIVERIES_PER_TICK)
    .returns<Delivery[]>();

  if (error) throw new Error(`could not read pending deliveries: ${error.message}`);
  if (!pending?.length) return { pending: 0, sent: 0, logged: 0, failed: 0 };

  if (!sendForReal) {
    // Phase 1. Recorded as delivered-in-principle so the pipeline is provable
    // end to end without credentials: querying this table answers "who would
    // have been notified, and when?".
    const { error: logError } = await supabase
      .from('notification_deliveries')
      .update({ status: 'logged', sent_at: new Date().toISOString() })
      .in('id', pending.map((d) => d.id));

    if (logError) throw new Error(`could not log deliveries: ${logError.message}`);
    return { pending: pending.length, sent: 0, logged: pending.length, failed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < pending.length; i += EXPO_BATCH_SIZE) {
    const batch = pending.slice(i, i + EXPO_BATCH_SIZE);
    const results = await sendBatch(batch);
    sent += results.sent;
    failed += results.failed;

    for (const update of results.updates) {
      await supabase
        .from('notification_deliveries')
        .update(update.patch)
        .eq('id', update.id);
    }

    // Expo reports a token that no longer belongs to an install. Keeping it
    // means retrying a dead device on every future notification.
    if (results.deadTokens.length) {
      await supabase
        .from('push_tokens')
        .delete()
        .in('expo_push_token', results.deadTokens);
    }
  }

  return { pending: pending.length, sent, logged: 0, failed };
}

async function sendBatch(batch: Delivery[]) {
  const messages = batch.map((d) => ({
    to: d.push_token,
    title: d.notification_events?.title ?? 'MVMNT',
    body: d.notification_events?.body ?? '',
    sound: 'default',
    // Lets the app deep-link to the screen the notification is about — the
    // type decides which one (photos land on the gallery, not the run).
    data: {
      run_id: d.notification_events?.run_id ?? null,
      type: d.notification_events?.type ?? null,
    },
  }));

  const updates: { id: number; patch: Record<string, unknown> }[] = [];
  const deadTokens: string[] = [];
  let sent = 0;
  let failed = 0;

  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(messages),
    });

    if (!response.ok) {
      // The whole batch failed. Bump attempts and leave them pending so the
      // next tick retries, rather than marking them failed on one bad response.
      const reason = `expo returned ${response.status}`;
      for (const d of batch) {
        failed++;
        updates.push({
          id: d.id,
          patch: {
            attempts: d.attempts + 1,
            error: reason,
            status: d.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
          },
        });
      }
      return { sent, failed, updates, deadTokens };
    }

    const payload = await response.json();
    const tickets: { status: string; message?: string; details?: { error?: string } }[] =
      payload.data ?? [];

    batch.forEach((d, index) => {
      const ticket = tickets[index];
      if (ticket?.status === 'ok') {
        sent++;
        updates.push({
          id: d.id,
          patch: { status: 'sent', sent_at: new Date().toISOString(), attempts: d.attempts + 1 },
        });
        return;
      }

      failed++;
      if (ticket?.details?.error === 'DeviceNotRegistered') deadTokens.push(d.push_token);

      updates.push({
        id: d.id,
        patch: {
          attempts: d.attempts + 1,
          error: ticket?.message ?? 'unknown expo error',
          // A device that no longer exists will never succeed, so retrying is
          // pointless — mark it failed immediately rather than after 3 attempts.
          status:
            ticket?.details?.error === 'DeviceNotRegistered' ||
            d.attempts + 1 >= MAX_ATTEMPTS
              ? 'failed'
              : 'pending',
        },
      });
    });
  } catch (error) {
    for (const d of batch) {
      failed++;
      updates.push({
        id: d.id,
        patch: {
          attempts: d.attempts + 1,
          error: String(error),
          status: d.attempts + 1 >= MAX_ATTEMPTS ? 'failed' : 'pending',
        },
      });
    }
  }

  return { sent, failed, updates, deadTokens };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
