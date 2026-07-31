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

const fs = require('fs');
const path = require('path');

const appJson = require('./app.json');

/**
 * Firebase's Android config, wired in only once it is actually present.
 *
 * Android push goes through FCM, which needs this file compiled into the app.
 * It is NOT committed: it identifies the club's Firebase project, so it lives
 * beside the .env as a local secret and arrives on EAS as a file-type secret.
 *
 * Declaring it unconditionally in app.json would be the obvious move and the
 * wrong one — prebuild fails outright when the path does not resolve, so every
 * developer without the file (and CI, and today's phone builds) would break on
 * a file none of them need until push goes live. Present: wired. Absent:
 * silently skipped, and push registration already explains itself to the
 * member (lib/push.ts).
 */
const GOOGLE_SERVICES = path.join(__dirname, 'google-services.json');
const googleServicesFile = fs.existsSync(GOOGLE_SERVICES) ? './google-services.json' : undefined;

module.exports = () => ({
  ...appJson.expo,
  android: {
    ...appJson.expo.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
  },
  extra: {
    ...appJson.expo.extra,
    supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
    // The dev location override deliberately stays on process.env: it is
    // __DEV__-gated in location.ts, so it cannot reach a release build at all,
    // and routing it through here would add config nothing reads.
  },
});
