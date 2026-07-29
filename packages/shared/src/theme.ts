/**
 * Design tokens — the club's own look, second edition.
 *
 * Owner decision, 2026-07-29, holding the actual club mark: MVMNT's brand is
 * black type on white, so the app is too. White base, ink text, and exactly
 * two colours with a meaning: GREEN says yes — approval, confirmation,
 * checked in, points earned — and AMBER celebrates — badges, streaks, the
 * chest, a friend's dot on the live map. The primary button is ink, like the
 * wordmark: on a monochrome brand the strongest colour is black, and a green
 * button next to green confirmations would dilute what green means.
 *
 * The first palette (dark blue-grey, coral) predates the club's mark arriving.
 * The token NAMES it left behind are kept even where they now read oddly —
 * `textOnDark` is simply "text on the base surface" — because renaming them
 * would touch every screen to change nothing.
 *
 * Both the mobile app and the admin console import these. Neither hard-codes a
 * hex value (Principles §2).
 */

export const colors = {
  /** Primary CTA only — Join, Check In, Sign Up. Ink, like the wordmark. */
  action: '#16191F',
  actionPressed: '#31363F',

  /** Approval: checked in, streak kept, points earned, "you're in". Green-700
   *  rather than a brighter green — this one has to carry TEXT on white. */
  success: '#15803D',

  /** The base is the brand: white, with cards one step of grey off it. */
  base: '#FFFFFF',
  baseElevated: '#F4F5F7',

  /** A dark panel for the few surfaces that stay dark (viewer, share card). */
  surface: '#16191F',
  surfaceSunken: '#0E1014',

  /** Celebration only — badges, streaks, the chest, live dots. Capped at
   *  small elements: at larger sizes amber reads as anxious, not optimistic. */
  highlight: '#F59E0B',

  /**
   * Genuine alerts only — run cancelled, waitlist closing. App Spec §2 is
   * explicit that saturated red must not be a primary colour in a fitness
   * context, where it reads as "stop/warning" rather than encouragement.
   */
  alert: '#D93025',

  textPrimary: '#16191F',
  textSecondary: '#5A6070',
  /** Historic names — today: primary and muted text on the (white) base. */
  textOnDark: '#16191F',
  textOnDarkMuted: '#5A6070',
  textOnAction: '#FFFFFF',

  border: '#E4E6EA',
  borderStrong: '#C9CDD4',
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

/**
 * Declared outside the `as const` object below on purpose.
 *
 * A const assertion turns a nested array literal into a readonly tuple, and
 * React Native's TextStyle wants a mutable FontVariant[]. The mismatch does not
 * fail at the token — it fails at every StyleSheet.create that spreads one of
 * these, poisoning the whole stylesheet's inferred type and burying real errors
 * under a hundred spurious ones. Naming the array keeps its type mutable.
 */
const TABULAR_NUMS: 'tabular-nums'[] = ['tabular-nums'];

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
  dataLarge: { fontSize: 28, fontWeight: '700', fontVariant: TABULAR_NUMS },
  data: { fontSize: 16, fontWeight: '600', fontVariant: TABULAR_NUMS },
} as const;

/** The club's timezone. Mirrors app_private.club_timezone() in the database. */
export const CLUB_TIMEZONE = 'Africa/Cairo';
