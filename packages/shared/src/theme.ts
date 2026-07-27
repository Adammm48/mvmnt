/**
 * Design tokens from App Spec §2.
 *
 * The palette is psychological, not decorative, and the reasoning is preserved
 * here because it constrains use: coral is reserved for THE primary action on a
 * screen, and stops meaning "go" the moment a second one appears next to it.
 *
 * Both the mobile app and the admin console import these. Neither hard-codes a
 * hex value (Principles §2).
 */

export const colors = {
  /** Primary CTA only — Join, Check In, Sign Up. Never two on one screen. */
  action: '#FF5A36',
  actionPressed: '#E64420',

  /** Confirmation: checked in, streak kept, points earned. */
  success: '#3DDC84',

  /** Calm base. Deliberately not pure black — less fatiguing on long scrolls. */
  base: '#1B1F2A',
  baseElevated: '#252A38',

  /** Warm off-white rather than clinical white. */
  surface: '#F7F5F2',
  surfaceSunken: '#EDEAE5',

  /** Reward highlights only — badges, streaks. Capped at small elements: at
   *  larger sizes yellow reads as anxious rather than optimistic. */
  highlight: '#FFC93C',

  /**
   * Genuine alerts only — run cancelled, waitlist closing. App Spec §2 is
   * explicit that saturated red must not be a primary colour in a fitness
   * context, where it reads as "stop/warning" rather than encouragement.
   */
  alert: '#D93025',

  textPrimary: '#1B1F2A',
  textSecondary: '#5C6272',
  textOnDark: '#F7F5F2',
  textOnDarkMuted: '#A8AEBF',
  textOnAction: '#FFFFFF',

  border: '#E3DED7',
  borderStrong: '#CFC8BE',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

/**
 * Minimum interactive size. App Spec §2 requires check-in to work one-handed,
 * gloved and in low signal; Principles §5 requires large touch targets. 48pt
 * exceeds Apple's 44pt floor because the check-in button in particular gets
 * pressed by cold hands in a crowd.
 */
export const MIN_TOUCH_TARGET = 48;

export const typography = {
  /** Encouragement-facing: rounded and friendly. */
  display: { fontSize: 32, fontWeight: '700', letterSpacing: -0.5 },
  title: { fontSize: 24, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  label: { fontSize: 14, fontWeight: '600' },
  caption: { fontSize: 13, fontWeight: '400' },

  /**
   * Data — leaderboard numbers, headcounts, distances. Structured rather than
   * rounded so figures read as credible instead of childish (App Spec §2).
   */
  dataLarge: { fontSize: 28, fontWeight: '700', fontVariant: ['tabular-nums'] },
  data: { fontSize: 16, fontWeight: '600', fontVariant: ['tabular-nums'] },
} as const;

/** The club's timezone. Mirrors app_private.club_timezone() in the database. */
export const CLUB_TIMEZONE = 'Africa/Cairo';
