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
export type TierReward = Database['public']['Tables']['tier_rewards']['Row'];
export type MemberBadge = Database['public']['Tables']['member_badges']['Row'];

/** The two windows public.leaderboard() and public.my_standing() accept. */
export type LeaderboardWindow = 'all_time' | 'month';

export const TIER_LABEL: Record<MemberTier, string> = {
  rookie: 'Rookie',
  runner: 'Runner',
  competitor: 'Competitor',
  elite: 'Elite',
  legend: 'Legend',
};

/**
 * Where each tier begins. Mirrors public.tier_for_points().
 *
 * Duplicated here only to draw a progress bar — the database decides what tier
 * anyone actually is, and if these ever drift the bar is slightly wrong rather
 * than a member wrongly promoted.
 */
export const TIER_FLOOR: Record<MemberTier, number> = {
  rookie: 0,
  runner: 60,
  competitor: 150,
  elite: 290,
  legend: 480,
};

export const TIER_ORDER: MemberTier[] = ['rookie', 'runner', 'competitor', 'elite', 'legend'];

/**
 * Tier colours.
 *
 * Five rungs need five colours a member can tell apart at pill size, and the
 * palette only carries three accents. Rookie and Legend are the two additions,
 * and they exist for this and nothing else — the same cap the palette puts on
 * the highlight yellow applies to all of them: small elements only. At larger
 * sizes these read as decoration rather than status (App Spec §2).
 */
/**
 * Tuned for the white theme: every one of these is used as TEXT and small
 * marks on a white or near-white surface, so each sits at roughly WCAG AA
 * against white. The originals were picked for a dark base and washed out
 * the day the brand went black-on-white.
 */
export const TIER_COLOR: Record<MemberTier, string> = {
  rookie: '#6B7280',
  runner: '#1D6FC2',
  competitor: '#15803D',
  elite: '#B45309',
  legend: '#7C3AED',
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
  return TIER_ORDER[Math.min(TIER_ORDER.indexOf(tier) + 1, TIER_ORDER.length - 1)]!;
}

/**
 * How far through the current tier a member is, 0–1, for the progress bar.
 *
 * The bands are different widths — the first is 60 points and the last is 190 —
 * so this measures against the member's own band rather than a fixed span. A
 * single constant here would have drawn a Rookie at 5 points as almost finished
 * and an Elite at 400 as barely started.
 */
export function tierProgressFraction(tier: MemberTier, pointsToNext: number | null): number {
  if (pointsToNext === null) return 1;
  const span = TIER_FLOOR[nextTier(tier)] - TIER_FLOOR[tier];
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (span - pointsToNext) / span));
}

/**
 * What a ledger row is, in words.
 *
 * `absence` is the one that needs care. It is a real deduction and hiding it
 * would be dishonest, but the wording stays factual rather than scolding —
 * App Spec §2 rules out guilt as a motivator, and a member reading their own
 * history should not find the app telling them off.
 */
export function describePointKind(kind: string): string {
  switch (kind) {
    case 'check_in':
      return 'Turned up';
    case 'streak_bonus':
      return 'Streak bonus';
    case 'adjustment':
      return 'Organiser adjustment';
    case 'absence':
      return 'Away from the club';
    default:
      return kind;
  }
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
  // Genuinely short: this renders in a stat cell that now shares a row with
  // three others, and "22 weeks" was truncating to "22 wee…" on a phone.
  // The unit lives in the label next to it.
  if (weeks === 0) return '—';
  return `${weeks}w`;
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
  // A tie is marked, not just repeated. Six rows each showing a bare "1" reads
  // as a broken screen; "=1" is the ordinary way a results board says joint
  // first, and it tells the member the number is deliberate.
  if (shared) return `=${rank}`;
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

/**
 * Eight characters, shown as two groups of four.
 *
 * Grouping is not decoration: reading "K7M29XQP" aloud reliably is hard, and
 * "K7M2 · 9XQP" is two short chunks. The separator is stripped again on the way
 * back in, so a member can type it either way.
 */
export function formatFriendCode(code: string): string {
  const clean = code.replace(/[^0-9A-Za-z]/g, '').toUpperCase();
  if (clean.length !== 8) return clean;
  return `${clean.slice(0, 4)} ${clean.slice(4)}`;
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
