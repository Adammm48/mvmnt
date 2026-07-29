/**
 * What a member accepts, and which version of it.
 *
 * The version is stored against every acceptance (migration 0048), so a
 * materially changed policy can require fresh acceptance rather than silently
 * inheriting an old one. Bump it ONLY for changes that alter what a member is
 * agreeing to — a typo fix that forces three hundred people to re-accept
 * teaches them to tap through without reading, which is worse than the typo.
 */
export const CONSENT_VERSION = '2026-07-draft';

/**
 * REPLACE ME before launch: this points at the draft policy in the repo.
 * The published policy needs a public URL — both app stores require one, and a
 * consent screen linking to a document nobody can open is not consent.
 * Tracked in docs/open-items.md.
 */
export const POLICY_URL = '';

/** The minimum age for an app account. See migration 0048 for why. */
export const MINIMUM_AGE = 18;
