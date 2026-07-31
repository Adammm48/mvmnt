#!/usr/bin/env bash
# Put MVMNT on a REAL Android phone (a Samsung, say).
#
#   ./scripts/run-android.sh
#
# NOTHING TO PAY, NOTHING TO SIGN UP FOR. Unlike iOS there is no Apple ID, no
# provisioning profile and no 7-day expiry: Android lets a phone install a
# locally built app once Developer options are on. The build stays until it is
# uninstalled.
#
# THE TWO TRAPS THIS SCRIPT EXISTS FOR
#
# 1. The app is configured to reach the database at 127.0.0.1. On a phone that
#    means THE PHONE ITSELF, so the app installs perfectly, opens, and cannot
#    sign in with nothing on screen explaining why. It is built against the
#    Mac's Wi-Fi address instead, after checking the phone can get there.
#
# 2. Android BLOCKS plain http:// in release builds. The local stack is http,
#    so a release build reaches the right address and is then refused by the
#    operating system — which looks identical to trap 1 from the outside. The
#    manifest is patched below for this local-testing build only.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/mobile"

# Where the SDK lives. Android Studio and the command-line tools both default
# here, so this works whichever way it was installed; an existing ANDROID_HOME
# wins, for anyone who put it elsewhere.
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/cmdline-tools/latest/bin"

# ---------------------------------------------------------------------------
# 1. The Mac's address on the Wi-Fi, and proof the stack answers on it.
# ---------------------------------------------------------------------------
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
if [ -z "$LAN_IP" ]; then
  echo "Not on Wi-Fi — the phone needs to reach this Mac over the network." >&2
  exit 1
fi
echo "==> This Mac is $LAN_IP on the Wi-Fi"

if ! curl -s --max-time 8 -o /dev/null "http://$LAN_IP:54321/auth/v1/health"; then
  echo "The database is not answering on $LAN_IP:54321." >&2
  echo "Start it with: npm run db:start" >&2
  exit 1
fi
echo "==> Database answers on the network"

# ---------------------------------------------------------------------------
# 2. A phone.
# ---------------------------------------------------------------------------
if ! command -v adb >/dev/null 2>&1; then
  echo "adb is not installed. Install it with:" >&2
  echo "  brew install --cask android-platform-tools" >&2
  exit 1
fi

DEVICE="$(adb devices | awk 'NR>1 && $2=="device" {print $1; exit}')"
if [ -z "$DEVICE" ]; then
  UNAUTHORISED="$(adb devices | awk 'NR>1 && $2=="unauthorized" {print $1; exit}')"
  if [ -n "$UNAUTHORISED" ]; then
    cat >&2 <<'EOF'
The phone is plugged in but has not trusted this Mac yet.

Look at the phone: there is an "Allow USB debugging?" dialog. Tick
"Always allow from this computer" and tap Allow. Then run this again.
EOF
    exit 1
  fi
  cat >&2 <<'EOF'
No Android phone found. To connect one (Samsung wording in brackets):

  1. On the phone: Settings > About phone > Software information, and tap
     "Build number" seven times. It will say "You are now a developer".
  2. Settings > Developer options > USB debugging > On.
  3. Plug the phone into this Mac with a cable.
  4. Tap "Allow" on the USB debugging prompt that appears on the phone.

If the phone charges but nothing else happens, pull down the notification
shade, tap the USB notification and choose "File transfer" rather than
"Charging only" — charge-only mode hides the phone from the Mac.

Then run this again.
EOF
  exit 1
fi
echo "==> Found phone: $DEVICE"

# ---------------------------------------------------------------------------
# 3. Build against the LAN address rather than localhost.
# ---------------------------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
[ -f "$ENV_FILE" ] || ENV_FILE="$ROOT/.env"
ANON_KEY="$(grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r')"
if [ -z "$ANON_KEY" ]; then
  echo "No EXPO_PUBLIC_SUPABASE_ANON_KEY found in $ENV_FILE — copy .env.example first." >&2
  exit 1
fi

export EXPO_PUBLIC_SUPABASE_URL="http://$LAN_IP:54321"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
echo "==> Building against $EXPO_PUBLIC_SUPABASE_URL"

if [ ! -d "$APP_DIR/android" ]; then
  (cd "$APP_DIR" && npx expo prebuild --platform android --no-install) || exit 1
fi

# Trap 2. Release builds refuse plain http, and the local stack is plain http.
# This is a local-testing concession only: android/ is gitignored and rebuilt
# by every prebuild, and the hosted project will be https, so nothing about the
# shipped app is being loosened here.
MANIFEST="$APP_DIR/android/app/src/main/AndroidManifest.xml"
if [ -f "$MANIFEST" ] && ! grep -q 'usesCleartextTraffic="true"' "$MANIFEST"; then
  echo "==> Allowing plain http for this local build (the stack is not https yet)"
  /usr/bin/sed -i '' 's|<application |<application android:usesCleartextTraffic="true" |' "$MANIFEST"
fi

# Release, so the JavaScript is embedded. A debug build would also need Metro
# reachable from the phone, which is a second thing to go wrong. Expo's
# generated project signs release with the debug key, so this needs no keystore.
#
# Lint is skipped. A release build normally runs `lintVitalRelease`, which on
# this project exhausts its own class loader and fails the build with an
# OutOfMemoryError deep inside the linter — after the app has compiled
# perfectly. Lint checks Android API misuse and belongs to the store pipeline
# (dev-todo step 5, where EAS runs the real release build); blocking a phone
# install on it trades a genuine test for a check that is not even running.
(cd "$APP_DIR/android" && ./gradlew assembleRelease -x lintVitalAnalyzeRelease -x lintVitalReportRelease -x lintVitalRelease) || exit 1

APK="$(find "$APP_DIR/android/app/build/outputs/apk/release" -name '*.apk' | head -1)"
[ -n "$APK" ] || { echo "build produced no .apk" >&2; exit 1; }

echo "==> Installing to the phone"
# -r replaces an existing install and keeps its data.
adb -s "$DEVICE" install -r "$APK" || exit 1

adb -s "$DEVICE" shell monkey -p com.adamelbasiony.mvmnt \
  -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1

cat <<EOF

Installed and launched.

Sign in with any seeded account, e.g. runner7@mvmnt.test, and read the
6-digit code from the mail catcher — on the phone's browser, or on this Mac:
  http://$LAN_IP:54324

WHAT THIS IS ACTUALLY WORTH TESTING (the simulator cannot):
  · check-in at a real meeting point, with real GPS
  · the camera scanning a friend's code in daylight
  · Android's own back gesture, which iOS has no equivalent of
  · a non-Apple screen shape — Samsungs are taller and narrower than an iPhone

To watch the app's logs while you use it:
  adb logcat -s ReactNativeJS
EOF
