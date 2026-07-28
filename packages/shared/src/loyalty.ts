/**
 * Presentation helpers for points, tiers, streaks and the leaderboard.
 *
 * As with runs.ts these format and label only. Every threshold below is a
 * mirror of one the database already enforces, and the database is the
 * authority — nothing here decides who is Elite or what a badge is worth
 * (Principles §2).
 *
 * App Spec §2 governs the tone: progress is always stated as distance still to
 * go, never as a shortfall. "60 points to Core", never "you are 60 short".
 */

import type { Database } from './database.types';

export type MemberTier = Database['public']['Enums']['member_tier'];
export type Standing = Database['public']['Functions']['my_standing']['Returns'][number];
export type LeaderboardRow = Database['public']['Functions']['leaderboard']['Returns'][number];
export type FriendRow = Database['public']['Functions']['my_friends']['Returns'][number];
export type Badge = Database['public']['Tables']['badges']['Row'];
export type MemberBadge = Database['public']['Tables']['member_badges']['Row'];

/** The two windows public.leaderboard() and public.my_standing() accept. */
export type LeaderboardWindow = 'all_time' | 'month';

export const TIER_LABEL: Record<MemberTier, string> = {
  starter: 'Starter',
  core: 'Core',
  elite: 'Elite',
};

/**
 * Tier colours.
 *
 * Elite gets the highlight yellow, which the palette caps at small elements —
 * at larger sizes yellow reads as anxious rather than optimistic (App Spec §2),
 * so this belongs on a pill and nothing bigger.
 */
export const TIER_COLOR: Record<MemberTier, string> = {
  starter: '#A8AEBF',
  core: '#3DDC84',
  elite: '#FFC93C',
};

/**
 * The line under a member's points.
 *
 * Null from points_to_next_tier() means there is no next tier — the member is
 * Elite. The spec is explicit that this should be celebrated rather than
 * rendered as a dead "0 to go" target.
 */
export function describeTierProgress(tier: MemberTier, pointsToNext: number | null): string {
  if (pointsToNext === null) return `${TIER_LABEL[tier]} — you have run every step of the way here`;
  return `${pointsToNext} ${pointsToNext === 1 ? 'point' : 'points'} to ${TIER_LABEL[nextTier(tier)]}`;
}

function nextTier(tier: MemberTier): MemberTier {
  return tier === 'starter' ? 'core' : 'elite';
}

/**
 * How far through the current tier a member is, 0–1, for the progress bar.
 *
 * The 500-point span mirrors public.tier_for_points(); it is duplicated here
 * only to draw a bar, and the database remains the authority on what tier
 * anyone actually is. A drift between the two makes a bar slightly wrong, not a
 * member wrongly promoted.
 */
const TIER_SPAN = 500;

export function tierProgressFraction(pointsToNext: number | null): number {
  if (pointsToNext === null) return 1;
  return Math.min(1, Math.max(0, (TIER_SPAN - pointsToNext) / TIER_SPAN));
}

/**
 * Streaks, framed as something you have rather than something you might lose.
 *
 * No "don't break it!" copy anywhere. A streak that nags is a streak that
 * punishes an injury or a work trip, and App Spec §2 rules out guilt as a
 * motivator.
 */
export function describeStreak(weeks: number): string {
  if (weeks === 0) return 'Your next run starts a streak';
  if (weeks === 1) return '1 week running';
  return `${weeks} weeks running`;
}

/** The same thing for a stat tile, where a label underneath supplies the noun. */
export function describeStreakShort(weeks: number): string {
  if (weeks === 0) return 'None yet';
  return `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
}

/**
 * Rank, as a position among people who are also showing up.
 *
 * Members outside the top 100 still get a real answer here, which is the whole
 * reason my_standing() is separate from leaderboard().
 */
export function describeRank(standing: Pick<Standing, 'rank' | 'total_members' | 'points'>): string {
  if (standing.points === 0) return 'Check in to a run to get on the board';
  return `#${standing.rank} of ${standing.total_members}`;
}

/** Distance to the person above, never the gap to those below (App Spec §2). */
export function describeGapToNextRank(points: number | null): string | null {
  if (points === null) return null;
  return `${points} ${points === 1 ? 'point' : 'points'} to move up a place`;
}

/**
 * Medals for the top three, plain numbers below.
 *
 * A medal is only awarded when the place is held alone. Ties share a rank, and
 * early in a season most of the club is tied — without this, a board where
 * everyone has one run shows twenty gold medals in a column and reads as broken
 * rather than as "you are all level".
 *
 * Returned as a string so the row renders one element either way rather than
 * branching on layout.
 */
export function rankBadge(rank: number, shared = false): string {
  if (shared) return `${rank}`;
  return rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `${rank}`;
}

/** Ranks held by more than one member, for rankBadge's `shared` argument. */
export function sharedRanks(rows: readonly { rank: number }[]): Set<number> {
  const seen = new Map<number, number>();
  for (const row of rows) seen.set(row.rank, (seen.get(row.rank) ?? 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([rank]) => rank));
}

/**
 * How long a friend QR code has left, for the countdown under it.
 *
 * The countdown is not decoration: the three-minute life is the entire reason
 * "in person only" is true rather than merely intended, so a member should be
 * able to see it running down and understand why the code stopped working.
 */
export function secondsUntil(expiresAt: string, now = Date.now()): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * What a friend's row says about the next run.
 *
 * Deliberately thin. The council's warning was that a friends list carrying
 * stats becomes a leaderboard at n=2 and re-exposes the per-run attendance the
 * owner asked to hide, so this reports presence at ONE upcoming run and nothing
 * cumulative.
 */
export function describeFriendState(state: Database['public']['Enums']['attendance_state'] | null): string {
  switch (state) {
    case 'checked_in':
      return 'Here';
    case 'signed_up':
      return 'Going';
    case 'waitlisted':
      return 'On the waitlist';
    case 'withdrawn':
    case null:
    default:
      return 'Not in yet';
  }
}
