/**
 * What changed, written for members rather than for a changelog.
 *
 * A version number tells somebody nothing. "Finally fixed the check-in bug"
 * tells them the thing they complained about was heard — which is most of what
 * a release note is for, and the reason this is a screen rather than a string
 * in the app store listing.
 *
 * Kept in code rather than the database on purpose: a note describes a build,
 * so it should ship with that build. A note editable after release could
 * describe a version nobody is running.
 */
export type Release = {
  version: string;
  title: string;
  notes: string[];
};

export const RELEASE_NOTES: Release[] = [
  {
    version: '0.1.0',
    title: 'The first one',
    notes: [
      'Sign up for a run, join a waitlist, and get your place back automatically when one opens.',
      'Check in at the meeting point. If your phone will not cooperate, an organiser can do it for you.',
      'Points, streaks, badges and five tiers — Rookie all the way to Legend.',
      'Add friends by scanning their code in person. No search, no adding people from a distance.',
      'Nudge a friend about a run. Once each, so nobody gets pestered.',
    ],
  },
];
