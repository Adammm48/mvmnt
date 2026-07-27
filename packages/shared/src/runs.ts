/**
 * Presentation helpers for runs and attendance.
 *
 * These format and label. They never decide anything — whether a run is full,
 * whether a member may check in, and who gets promoted are all server-side
 * rules in supabase/migrations (Principles §2). Anything here that looks like a
 * rule is a hint for the UI, and the server re-derives it independently.
 */

import type { Database } from './database.types';
import { CLUB_TIMEZONE } from './theme';

export type Run = Database['public']['Tables']['runs']['Row'];
export type RunStatus = Database['public']['Enums']['run_status'];
export type AttendanceState = Database['public']['Enums']['attendance_state'];
export type CheckInMethod = Database['public']['Enums']['check_in_method'];
export type RunCounts = Database['public']['Views']['run_attendance_counts']['Row'];
export type Profile = Database['public']['Tables']['profiles']['Row'];

/** How long before a run starts that check-in opens. Mirrors public.check_in(). */
export const CHECK_IN_OPENS_MINUTES_BEFORE = 60;

export function formatRunTime(startsAt: string): string {
  return new Date(startsAt).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: CLUB_TIMEZONE,
  });
}

export function formatRunDate(startsAt: string): string {
  const date = new Date(startsAt);
  const today = new Date();
  const inClubTz = (d: Date) =>
    d.toLocaleDateString('en-GB', { timeZone: CLUB_TIMEZONE });

  if (inClubTz(date) === inClubTz(today)) return 'Today';

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (inClubTz(date) === inClubTz(tomorrow)) return 'Tomorrow';

  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'short',
    timeZone: CLUB_TIMEZONE,
  });
}

export function formatDistance(meters: number | null): string | null {
  if (meters === null) return null;
  return meters >= 1000 ? `${(meters / 1000).toFixed(1).replace(/\.0$/, '')}K` : `${meters}m`;
}

/**
 * Social proof, framed positively.
 *
 * App Spec §2 is explicit: lean into "312 people are already in" rather than
 * hiding a low early number, because the bandwagon effect genuinely increases
 * sign-ups. So a low count is stated plainly and warmly rather than suppressed —
 * "Be the first one in" is an invitation, not an admission of emptiness.
 */
export function formatAttendance(counts: Pick<RunCounts, 'going_count'> | null): string {
  const going = counts?.going_count ?? 0;
  if (going === 0) return 'Be the first one in';
  if (going === 1) return '1 person is in';
  return `${going} people are in`;
}

/**
 * Progress framed as distance-to-go rather than shortfall (App Spec §2, §4.2:
 * "3 more runs to Elite", never "you missed 2 runs").
 */
export function formatSpotsLeft(run: Run, counts: RunCounts | null): string | null {
  if (run.capacity === null) return null;
  const left = run.capacity - (counts?.going_count ?? 0);
  if (left <= 0) return 'Waitlist open';
  if (left === 1) return 'Last spot';
  return `${left} spots left`;
}

/** UI hint only. public.check_in() re-validates the window server-side. */
export function isCheckInWindowOpen(run: Run, now = new Date()): boolean {
  const start = new Date(run.starts_at);
  const opens = new Date(start.getTime() - CHECK_IN_OPENS_MINUTES_BEFORE * 60_000);
  const closes = run.ends_at
    ? new Date(run.ends_at)
    : new Date(start.getTime() + 4 * 60 * 60_000);
  return now >= opens && now <= closes && (run.status === 'published' || run.status === 'in_progress');
}

export function isJoinable(run: Run, now = new Date()): boolean {
  return run.status === 'published' && new Date(run.starts_at) > now;
}

/** Wording for a member's own state. Positive framing throughout (App Spec §2). */
export function describeAttendanceState(state: AttendanceState | null): string {
  switch (state) {
    case 'checked_in':
      return "You're in";
    case 'signed_up':
      return "You're signed up";
    case 'waitlisted':
      return "You're on the waitlist";
    case 'withdrawn':
    case null:
      return 'Not signed up';
  }
}
