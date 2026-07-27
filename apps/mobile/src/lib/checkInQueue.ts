/**
 * Offline check-in queue.
 *
 * App Spec §2: check-in must work "one-handed, glove-on, low-signal". At a mass
 * start, hundreds of phones hit a congested cell at once — which is exactly
 * when a member is standing at the meeting point and least able to retry.
 *
 * So a failed check-in is stored with the timestamp at which it was actually
 * attempted, and replayed later. public.check_in() takes that client timestamp
 * and reconciles it against server time, so a check-in synced twenty minutes
 * afterwards is still recorded as having happened when the member tapped.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';
import type { Fix } from './location';

const STORAGE_KEY = 'mvmnt.pending-check-ins.v1';

export type PendingCheckIn = {
  runId: string;
  fix: Fix;
  queuedAt: string;
};

async function read(): Promise<PendingCheckIn[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PendingCheckIn[]) : [];
  } catch {
    // A corrupt queue must not brick check-in. Losing a queued entry is
    // recoverable — the member taps again, or an organiser checks them in.
    return [];
  }
}

async function write(items: PendingCheckIn[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

export async function enqueue(entry: PendingCheckIn): Promise<void> {
  const items = await read();
  // One entry per run: tapping five times on a dead connection should not
  // produce five replays.
  const deduped = items.filter((i) => i.runId !== entry.runId);
  deduped.push(entry);
  await write(deduped);
}

export async function pendingCount(): Promise<number> {
  return (await read()).length;
}

export async function hasPendingFor(runId: string): Promise<boolean> {
  return (await read()).some((i) => i.runId === runId);
}

/**
 * Replay everything queued. Safe to call on every app foreground: check_in() is
 * idempotent, so a replay that already succeeded changes nothing.
 *
 * Returns how many were accepted, so the UI can confirm quietly.
 */
export async function flush(): Promise<{ synced: number; remaining: number }> {
  const items = await read();
  if (items.length === 0) return { synced: 0, remaining: 0 };

  const stillPending: PendingCheckIn[] = [];
  let synced = 0;

  for (const item of items) {
    const { error } = await supabase.rpc('check_in', {
      p_run_id: item.runId,
      p_lat: item.fix.latitude,
      p_lng: item.fix.longitude,
      p_accuracy_m: item.fix.accuracy ?? undefined,
      p_client_ts: item.fix.capturedAt,
    });

    if (!error) {
      synced++;
      continue;
    }

    // A rejection is final — the window closed, or the member was too far away.
    // Only a transport failure is worth retrying; anything else would sit in
    // the queue forever being re-rejected.
    const transportFailure = /network|fetch|timeout|Failed to fetch/i.test(error.message ?? '');
    if (transportFailure) stillPending.push(item);
  }

  await write(stillPending);
  return { synced, remaining: stillPending.length };
}

export async function clear(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}
