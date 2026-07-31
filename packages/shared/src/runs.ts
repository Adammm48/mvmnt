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

/**
 * Where the run meets, as a link any maps app will open.
 *
 * DERIVED FROM THE PIN, NOT STORED. The obvious alternative is a column the
 * organiser pastes a Google Maps link into, and it is the wrong shape: the
 * meeting point already exists as coordinates, they are `not null`, and the
 * check-in geofence is measured from them. A pasted link is a second address
 * for the same place, free to disagree — and when it does, members navigate
 * to where the link says and cannot check in where the circle is. This project
 * has paid for "two copies that must agree" enough times.
 *
 * Deriving also means every run ever created already has one, and the
 * organiser does no extra work.
 *
 * Google's documented cross-platform URL: it opens the Google Maps app when
 * it is installed, Apple Maps or the browser when it is not, on both
 * platforms — so it needs no API key, no SDK and no per-platform branch.
 */
export function meetingPointMapsUrl(run: {
  meeting_point_lat: number;
  meeting_point_lng: number;
}): string {
  return `https://www.google.com/maps/search/?api=1&query=${run.meeting_point_lat},${run.meeting_point_lng}`;
}

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
 * What a member sees about how full a run is — deliberately no numbers.
 *
 * Overrides the original App Spec §2 social-proof design ("312 people are
 * already in"), which leaned on real counts for a bandwagon effect. Product
 * decision: members should never see how many have joined or how many places
 * are left. Only two states are shown, and neither is a count:
 *
 *   - unlimited, or capacity not yet reached → nothing at all (no scarcity to
 *     signal)
 *   - capacity set and reached              → "Waitlist open", so a member
 *     knows what tapping Join will actually do before they tap it
 *
 * The organiser console is unaffected — it reads run_attendance_counts
 * directly, because an organiser needs the real numbers to run the event.
 */
export function formatCapacityStatus(run: Run, counts: RunCounts | null): string | null {
  if (run.capacity === null) return null;
  const going = counts?.going_count ?? 0;
  return going >= run.capacity ? 'Waitlist open' : 'Limited spots';
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
