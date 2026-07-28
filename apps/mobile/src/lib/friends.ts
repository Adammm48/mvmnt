import { supabase } from './supabase';
import type { FriendRow, Run } from '@mvmnt/shared';

/**
 * The run a friends list is about.
 *
 * my_friends() defaults to the next published run on its own, but the screen
 * also needs the run's title to say which run it is talking about — and if the
 * two picked different runs the list would report presence at one run under the
 * heading of another. So the client resolves it once and passes it in.
 */
export async function nextRun(): Promise<Run | null> {
  const { data } = await supabase
    .from('runs')
    .select('*')
    .eq('status', 'published')
    .gt('starts_at', new Date().toISOString())
    .order('starts_at', { ascending: true })
    .limit(1);

  return data?.[0] ?? null;
}

export async function loadFriends(runId: string | null): Promise<FriendRow[]> {
  // Omitted rather than passed as null: the generated types make p_run_id
  // optional, and the SQL default already resolves to the next published run.
  const { data, error } = await supabase.rpc(
    'my_friends',
    runId ? { p_run_id: runId } : {},
  );
  if (error) throw error;
  return data ?? [];
}

/**
 * Pull a friend token out of whatever the camera actually read.
 *
 * The QR encodes the bare token — a token is useless outside the app, so a
 * stranger scanning it with the system camera gets a meaningless string rather
 * than a tappable link. This stays tolerant of a URL form anyway, because a
 * scanner that silently rejects a valid code is indistinguishable from one that
 * is broken.
 */
export function extractToken(scanned: string): string | null {
  const trimmed = scanned.trim();
  const bare = /^[0-9a-f]{32}$/i;
  if (bare.test(trimmed)) return trimmed.toLowerCase();

  const tail = trimmed.split(/[/:?#=]/).pop() ?? '';
  return bare.test(tail) ? tail.toLowerCase() : null;
}
