/**
 * The voice of the person who built this.
 *
 * Old-school "made by" signature, in the games tradition: a human behind the
 * software rather than a brand. The rule the whole file is written to is the
 * one the author set himself — **memorable, not annoying** — and every decision
 * below is downstream of it.
 *
 * WHAT THAT RULE ACTUALLY BUYS
 *
 * A line that appears every single time stops being a voice and becomes
 * furniture: read once, ignored forever, and mildly irritating by the twentieth
 * Saturday. So:
 *
 *   · Greetings are chosen per member per DAY, not per render. Opening the app
 *     three times before a run gives the same line all three times, because a
 *     greeting that reshuffles while you look at it is obviously a machine.
 *   · Achievements rotate freely — they are rare by nature.
 *   · Easter eggs fire at ~4%, so they land every few weeks per member rather
 *     than every session. That number is the entire difference between a
 *     surprise and a tic.
 *   · Different members see different lines on the same morning. The seed
 *     includes the member id, so nobody's feed is the club's feed.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * Push notifications. Those go out under the club's name to the club's members,
 * and a developer signature in someone else's outbound channel stops being a
 * signature and becomes advertising. Everything in this file is in-app, where
 * the app is the thing the author made. See docs/backlog.md.
 */

export type VoiceSlot =
  | 'greeting'
  | 'greeting_evening'
  | 'checked_in'
  | 'run_finished'
  | 'streak_new'
  | 'milestone_100'
  | 'loading'
  | 'empty_runs'
  | 'empty_friends'
  | 'empty_board'
  | 'error_generic'
  | 'error_offline'
  | 'error_notfound'
  | 'waitlisted'
  | 'friend_added'
  | 'top_three'
  | 'push_permission'
  | 'seasonal'
  | 'secret_found'
  | 'whats_new'
  | 'birthday'
  | 'shop_welcome'
  | 'order_reserved'
  | 'gift_sent'
  | 'photos_published'
  | 'live_sharing'
  | 'selfie_optin'
  | 'stats_intro'
  | 'easter_egg';

const LINES: Record<VoiceSlot, string[]> = {
  greeting: [
    'Morning. Go smash today’s run.',
    'Every run counts. Even the slow ones.',
    'Future you will thank you for this.',
    'Don’t let the snooze button win.',
    'Proud of you for showing up.',
    'Lace up. The hard part is the door.',
    'Nobody ever regretted going.',
    'Today is a good day to be outside.',
  ],
  greeting_evening: [
    'Rest counts too. That is not a excuse, it is training.',
    'Tomorrow’s run starts with tonight’s sleep.',
    'Legs up. You have earned it.',
  ],
  checked_in: [
    'Huge W. You’re officially in.',
    'You showed up. That was the whole test.',
    'In the books before most people are awake.',
    'Look at you, being the kind of person who turns up.',
  ],
  run_finished: [
    'Another one in the books.',
    'That’s done. Nobody can take it off you.',
    'Go and eat something. You’ve earned it.',
  ],
  streak_new: [
    'Careful… this is becoming a habit.',
    'Two in a row is a coincidence. Keep going and it’s a personality.',
    'A streak. No pressure. (Some pressure.)',
  ],
  milestone_100: [
    'I genuinely never expected someone to hit 100 this fast.',
    '100 runs. I built this app in less time than you spent running.',
  ],
  loading: [
    'Warming up the servers…',
    'Tying your virtual shoelaces…',
    'Built with ☕ and questionable sleep.',
    'Stretching. Unlike Adam.',
    'Finding everyone…',
  ],
  empty_runs: [
    'Adam is waiting for your first run.',
    'Nothing yet. The next one lands here the moment it drops.',
  ],
  empty_friends: [
    'Adam thinks running is better with friends.',
    'Nobody yet. Scan someone’s code at the next run.',
  ],
  empty_board: [
    'Adam believes somebody has to be first.',
    'An empty board is just an opportunity with extra steps.',
  ],
  error_generic: [
    'Adam definitely didn’t mean for this to happen.',
    'Something broke. Adam has been notified. (Hopefully.)',
  ],
  error_offline: [
    'Adam can’t outrun your Wi-Fi.',
    'No signal. Your check-in is saved and will go through on its own.',
  ],
  error_notfound: [
    'Adam definitely didn’t mean for this to happen.',
    'This page went for a run and didn’t come back.',
  ],
  waitlisted: [
    'Adam is crossing his fingers a spot opens.',
    'On the list. You’ll be the first to know.',
  ],
  friend_added: ['Adam approves ✅', 'Adam thinks you two should run together.'],
  top_three: ['Adam is impressed.', 'Top three. Adam is taking notes.'],
  push_permission: ['Adam promises not to spam you.'],

  // Filled in by seasonalSlot() below — kept as a slot so the picker treats it
  // like any other and it still varies per member.
  seasonal: ['Adam recommends dressing for the weather, whatever it is doing.'],

  secret_found: [
    'Adam noticed.',
    'Adam saw that. Adam is impressed.',
    'That one was hidden. Adam is genuinely pleased you found it.',
  ],
  whats_new: [
    'Adam has been cooking…',
    'Adam finally fixed that bug everyone reported.',
    'Adam added a thing. Adam hopes you like the thing.',
  ],
  birthday: ['Adam hopes you celebrate with a run. 🎂'],

  // Phase 3 & 4 surfaces, same register: the shop, the photos, the live map.
  shop_welcome: [
    'Adam models none of this merch. You’re welcome.',
    'Points off the price. Adam is basically giving it away. (He is not.)',
    'Everything here survives a Cairo summer wash. Probably.',
  ],
  order_reserved: [
    'Reserved. Adam is guarding it personally.',
    'It’s yours. Pay at the run — Adam trusts you.',
    'Adam has set one aside. Try to look surprised.',
  ],
  gift_sent: [
    'Sent. Adam loves a generous runner.',
    'On its way. Adam is telling them right now.',
    'Adam thinks you just made someone’s Saturday.',
  ],
  photos_published: [
    'Adam swears the camera adds pace.',
    'Find yourself. Adam looks mid-blink in every single one.',
    'Photographic proof you were there. Adam is proud.',
  ],
  selfie_optin: [
    'One selfie and the app finds you in every crowd shot. Adam still finds you at the front. Or the back.',
    'Smile like you negative-split. The camera believes you even if Adam doesn’t.',
    'This is the only photo you take standing still. Make it count.',
  ],
  stats_intro: [
    'Numbers don’t lie. Adam does, but only about his 5K time.',
    'Every kilometre here was real. We checked. Adam checked twice.',
    'Stats are just bragging with receipts.',
  ],
  live_sharing: [
    'Your friends can see you now. No pressure. (Some pressure.)',
    'Live. Adam suggests looking strong at every corner.',
    'Sharing on. Adam promises it forgets where you were.',
  ],

  // The rare ones. These are the reason anybody screenshots an app.
  easter_egg: [
    'Adam is wondering how your calves are still working.',
    'Adam forgot to stretch. Don’t be like Adam.',
    'Fun fact: Adam built this instead of sleeping.',
    'Adam spent three hours fixing a bug so this button could exist.',
    'Adam has run this route exactly once and has not recovered.',
    'Somewhere, Adam is refreshing the leaderboard.',
  ],
};

/** How often an easter egg replaces the normal line. Rare on purpose. */
const EASTER_EGG_CHANCE = 0.04;

/**
 * A small deterministic hash.
 *
 * Deterministic matters more than random here: the same member on the same day
 * must get the same greeting, or the app looks like it is thinking out loud.
 * Math.random() cannot do that, and storing a choice per member per day would
 * be a table to maintain for a nicety.
 */
function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Today, in the club's timezone, as a stable key. */
function todayKey(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: 'Africa/Cairo' });
}

export type VoiceOptions = {
  /** Included so two members never see the same line on the same morning. */
  userId?: string;
  /** Stable for a day (greetings) or fresh each call (achievements, loading). */
  stability?: 'daily' | 'each-time';
  /** Skip the easter-egg roll — wrong moment for a joke. */
  noSurprises?: boolean;
  now?: Date;
};

/**
 * One line for one place.
 *
 * `slot` is part of the seed, so the greeting and the empty state on the same
 * screen on the same day never land on the same index — which is what "different
 * in place" has to mean in practice.
 */
export function adamSays(slot: VoiceSlot, options: VoiceOptions = {}): string {
  const { userId = 'anon', stability = 'each-time', noSurprises = false, now = new Date() } = options;

  const nonce =
    stability === 'daily' ? todayKey(now) : `${now.getTime()}:${Math.random()}`;
  const seed = `${userId}:${slot}:${nonce}`;
  const roll = hash(seed);

  // The easter egg replaces the line rather than adding to it. Two jokes
  // stacked is a bit; one arriving unannounced is a surprise.
  if (!noSurprises && slot !== 'easter_egg') {
    const eggRoll = hash(`${seed}:egg`) % 10000;
    if (eggRoll / 10000 < EASTER_EGG_CHANCE) {
      const eggs = LINES.easter_egg;
      return eggs[hash(`${seed}:pick`) % eggs.length]!;
    }
  }

  const lines = LINES[slot];
  return lines[roll % lines.length]!;
}

/**
 * The seasonal line, by the club's calendar.
 *
 * Cairo, so the year is hot-and-hotter rather than four even seasons — the
 * bands are set to what a runner there actually feels, not to a textbook. A
 * joke about gloves in August is not a joke, it is a bug.
 */
export function seasonalLine(now = new Date()): string {
  const month = Number(now.toLocaleString('en-GB', { timeZone: 'Africa/Cairo', month: 'numeric' }));

  if (month === 12 || month <= 2) return 'Adam recommends gloves. Yes, even here.';
  if (month >= 6 && month <= 9) return 'Adam recommends sunscreen and starting earlier.';
  if (month === 3 || month === 4) return 'Adam recommends accepting whatever the wind is doing.';
  return 'Adam says this is the good part of the year. Use it.';
}

/** Morning or evening greeting, by the club's clock rather than the device's. */
export function greetingSlot(now = new Date()): VoiceSlot {
  const hour = Number(
    now.toLocaleString('en-GB', { timeZone: 'Africa/Cairo', hour: '2-digit', hour12: false }),
  );
  return hour >= 19 || hour < 4 ? 'greeting_evening' : 'greeting';
}

/**
 * The signature.
 *
 * One string, used everywhere it appears, so changing how the author is
 * credited is one edit rather than a search.
 */
export const SIGNATURE = {
  name: 'Adam Elbasiony',
  role: 'Founder & Lead Developer',
  /** Shown on the chest — the club's gift, handed over by name. */
  giftFrom: 'Adam the Great',
  footer: 'Made with ❤️ by Adam Elbasiony',
  study: 'Computer Science, University of Nottingham',
  hello: 'If you enjoyed MVMNT, say hi 👋',
} as const;

/**
 * Where to find him.
 *
 * Anything with `placeholder: true` renders as "coming soon" and refuses to
 * open. Their URLs are empty rather than invented: a plausible-looking address
 * that 404s in front of three hundred members is worse than one that is
 * visibly unfinished, and guessing somebody's portfolio URL is exactly how that
 * happens.
 */
export const CONTACT_LINKS: { label: string; url: string; placeholder: boolean }[] = [
  { label: 'GitHub', url: 'https://github.com/Adammm48', placeholder: false },
  { label: 'Portfolio', url: '', placeholder: true },
  { label: 'LinkedIn', url: '', placeholder: true },
  { label: 'Email', url: '', placeholder: true },
];
