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
 * Pull a friend code out of whatever the camera read, or the member typed.
 *
 * The QR encodes the bare code — a code is useless outside the app, so a
 * stranger scanning it with the system camera gets a meaningless string rather
 * than a tappable link. This stays tolerant of a URL form anyway, because a
 * scanner that silently rejects a valid code is indistinguishable from a broken
 * one.
 *
 * Typing is the real fallback, so spaces and dashes are stripped and case is
 * ignored. The alphabet excludes I, L, O and U — but somebody reading a code
 * out will still say "oh" for zero and "eye" for one, so those four are folded
 * onto the digits they were confused with rather than rejected. The server
 * re-validates either way; getting this wrong here only ever costs a retry.
 */
const CODE_LENGTH = 8;

export function extractToken(scanned: string): string | null {
  const cleaned = scanned
    .trim()
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    // Ambiguous glyphs, folded the way a person would have misread them.
    .replace(/[IL]/g, '1')
    .replace(/[O]/g, '0')
    .replace(/[U]/g, 'V');

  if (new RegExp(`^[0-9A-Z]{${CODE_LENGTH}}$`).test(cleaned)) return cleaned;

  // A URL form: take the last path-ish segment and try again.
  const tail = scanned.trim().split(/[/:?#=]/).pop() ?? '';
  if (tail && tail !== scanned.trim()) return extractToken(tail);

  return null;
}
