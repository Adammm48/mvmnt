/**
 * The app's config, with the backend values carried into the build.
 *
 * WHY THIS FILE EXISTS
 *
 * `app.json` remains the source of truth for everything static — icons,
 * permissions, bundle ids, plugins — and is spread in below untouched. This
 * wrapper exists for one reason: to get the Supabase URL and anon key into a
 * RELEASE bundle.
 *
 * Reading them straight from `process.env.EXPO_PUBLIC_*` in application code
 * works in development and silently fails in a release build. Metro inlines
 * those variables when it bundles, and in development Expo CLI has loaded
 * `.env` first — but Xcode's "Bundle React Native code and images" phase does
 * not. The result was a shipping build whose bundle contained no backend URL at
 * all: the app launched, sat on its loading spinner for ever, and never
 * reached sign-in. Found by building Release for the simulator and grepping
 * main.jsbundle for the URL — it was not there.
 *
 * Expo CLI *does* evaluate this file, and it loads `.env` before doing so, so
 * the values land in `extra` and travel with the bundle. Same mechanism for a
 * local build, an EAS build, and CI — one path, no per-environment special
 * case. Production values come from EAS environment variables rather than a
 * committed file (see docs/dev-todo.md step 1).
 */

const appJson = require('./app.json');

module.exports = () => ({
  ...appJson.expo,
  extra: {
    ...appJson.expo.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    // The dev location override deliberately stays on process.env: it is
    // __DEV__-gated in location.ts, so it cannot reach a release build at all,
    // and routing it through here would add config nothing reads.
  },
});
