/**
 * Turning Postgres errors into something a member should read.
 *
 * The RPCs raise messages written for humans, so the default is to show the
 * server's own message rather than invent a second copy of it here
 * (Principles §2). This maps only the cases where the raw message would be
 * unhelpful or alarming.
 */

export type SupabaseishError = {
  message?: string;
  code?: string;
  details?: string | null;
} | null;

const FRIENDLY: Record<string, string> = {
  // Postgres privilege errors surface as jargon; a member reading "permission
  // denied for table" learns nothing actionable.
  '42501': 'You do not have permission to do that.',
  PGRST301: 'Your session has expired. Please sign in again.',
  '23505': 'That has already been done.',
};

/**
 * Accepts `unknown` because half the call sites are `catch` blocks, where TypeScript
 * types the value as unknown and there is no honest narrowing available — a thrown
 * value really could be anything. Shifting that check in here means no screen has to
 * cast, and a screen that casts wrongly is a screen that crashes while reporting an
 * error, which is the worst moment to crash.
 */
export function toMemberMessage(
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string {
  if (!error || typeof error !== 'object') return fallback;
  const { code, message: raw } = error as NonNullable<SupabaseishError>;

  if (code && FRIENDLY[code]) return FRIENDLY[code]!;

  const message = typeof raw === 'string' ? raw.trim() : undefined;
  if (!message) return fallback;

  // PostgREST wraps RAISE EXCEPTION text; strip the SQL noise but keep the
  // message the function author actually wrote for the member.
  const cleaned = message
    .replace(/^ERROR:\s*/i, '')
    .replace(/\s*CONTEXT:[\s\S]*$/i, '')
    .trim();

  if (/authentication required/i.test(cleaned)) return 'Please sign in first.';
  if (/permission denied|admin only/i.test(cleaned)) return 'You do not have permission to do that.';

  return cleaned || fallback;
}

/** True when the failure is a lost connection rather than a rejection. */
export function isOffline(error: unknown): boolean {
  const m =
    error && typeof error === 'object'
      ? ((error as NonNullable<SupabaseishError>).message ?? '')
      : '';
  return /network|fetch failed|Failed to fetch|timeout|offline/i.test(m);
}
