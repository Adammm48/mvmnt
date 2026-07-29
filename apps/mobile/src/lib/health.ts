/**
 * Health data — the seam where HealthKit and Health Connect plug in.
 *
 * ADR 0005 §1 fixes the shape before the accounts exist: health data is
 * DISPLAY-ONLY and never touches the server. This module is the entire
 * surface the rest of the app is allowed to see — one interface, one
 * `getHealthProvider()`, and screens that render whatever it returns.
 *
 * Today there is exactly one implementation: `unavailable`, which reports
 * honestly that no health source exists yet. That is not a mock — it is the
 * true state of a build with no HealthKit entitlement (needs MVMNT's Apple
 * Developer account) and no Health Connect declaration (needs the Play
 * Console review). See docs/open-items.md.
 *
 * REPLACE ME when the accounts exist, with two thin adapters:
 *   · ios: react-native-health — read-only scopes, requested on first use,
 *     never at launch. Purpose strings worded specifically (App Review's
 *     Guideline 5.1.3 rejection is vague wording, not the access itself).
 *   · android: Health Connect SDK + the Play Console health declaration.
 * Each adapter maps its platform's types onto HealthStats below and nothing
 * else — no adapter may grow a network call, because the contract this file
 * enforces is that health data has nowhere to go.
 */

export type HealthStats = {
  /** Steps today, from the phone's own count. */
  stepsToday: number | null;
  /** Distance covered today in metres, per the device. */
  distanceTodayMeters: number | null;
  /** Most recent resting heart rate, if the device knows one. */
  restingHeartRate: number | null;
};

export type HealthProvider = {
  /**
   * Whether this build can read health data at all. 'unavailable' is a fact
   * about the build, not a permission state — the UI words the two
   * differently, because "we can't yet" and "you said no" deserve different
   * sentences.
   */
  availability: 'unavailable' | 'not_asked' | 'granted' | 'denied';
  /** Ask the OS for read access. No-op unless availability is 'not_asked'. */
  requestAccess(): Promise<'granted' | 'denied'>;
  /** Read the latest stats. Null fields mean the device has no answer. */
  read(): Promise<HealthStats>;
};

/**
 * The build-with-no-entitlements provider: says so, returns nothing, and
 * cannot be asked. Every screen renders this state as "coming with the app
 * stores" rather than as an error, because it is not one.
 */
const unavailable: HealthProvider = {
  availability: 'unavailable',
  async requestAccess() {
    return 'denied';
  },
  async read() {
    return { stepsToday: null, distanceTodayMeters: null, restingHeartRate: null };
  },
};

export function getHealthProvider(): HealthProvider {
  // When the adapters exist this becomes a Platform.select — and nothing
  // above this line changes.
  return unavailable;
}
