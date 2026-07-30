#!/usr/bin/env bash
# Put MVMNT on a REAL iPhone.
#
#   ./scripts/run-iphone.sh
#
# NO PAID APPLE ACCOUNT NEEDED. A free Apple ID signs apps onto your own
# device; they simply expire after 7 days and are reinstalled by running this
# again. The £79/year account is for the App Store and for builds that do not
# expire — not for this.
#
# THE TRAP THIS SCRIPT EXISTS FOR
#
# The app is configured to reach the database at 127.0.0.1. On the simulator
# that works, because the simulator shares the Mac's network. On a real iPhone
# 127.0.0.1 is THE PHONE ITSELF, so the app installs perfectly, opens, and then
# cannot sign in — with no error that explains why. The fix is to point it at
# the Mac's address on the Wi-Fi, which is what this script does, after
# checking the phone can actually get there.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/mobile"
BUILD_DIR="/tmp/mvmnt-iphone-build"

export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

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
DEVICE_LINE="$(xcrun devicectl list devices 2>/dev/null | grep -iE 'iphone|ipad' | grep -vi 'simulator' | head -1)"
if [ -z "$DEVICE_LINE" ]; then
  cat >&2 <<'EOF'
No iPhone found. To connect one:

  1. Plug it into this Mac with a cable.
  2. On the phone, tap "Trust This Computer" and enter your passcode.
  3. Settings > Privacy & Security > Developer Mode > On, then restart the phone.
     (Developer Mode only appears after a Mac has tried to install to it once.)

Then run this again.
EOF
  exit 1
fi
echo "==> Found: $DEVICE_LINE"
DEVICE_ID="$(echo "$DEVICE_LINE" | grep -oE '[0-9A-F]{8}-[0-9A-F]{16}|[0-9a-f]{40}' | head -1)"

# ---------------------------------------------------------------------------
# 3. Signing. The one step that cannot be automated.
# ---------------------------------------------------------------------------
if ! grep -q "DEVELOPMENT_TEAM = [A-Z0-9]" "$APP_DIR/ios/MVMNT.xcodeproj/project.pbxproj" 2>/dev/null; then
  cat >&2 <<EOF

==> One-time setup needed, in Xcode (it needs your Apple ID; a free one works):

    open $APP_DIR/ios/MVMNT.xcworkspace

    1. Select the MVMNT target > Signing & Capabilities.
    2. Tick "Automatically manage signing".
    3. Team: add your Apple ID if it is not listed, then pick it.
       (Xcode > Settings > Accounts > + > Apple ID)
    4. If it complains the bundle id is taken, change it to something
       unique like com.adamelbasiony.mvmnt — anything nobody else has used.

Then run this script again. It only has to be done once.
EOF
  exit 1
fi

# ---------------------------------------------------------------------------
# 4. Build against the LAN address rather than localhost.
# ---------------------------------------------------------------------------
ANON_KEY="$(grep '^EXPO_PUBLIC_SUPABASE_ANON_KEY=' "$ROOT/.env" 2>/dev/null | cut -d= -f2-)"
if [ -z "$ANON_KEY" ]; then
  echo "No EXPO_PUBLIC_SUPABASE_ANON_KEY in .env — copy .env.example first." >&2
  exit 1
fi

export EXPO_PUBLIC_SUPABASE_URL="http://$LAN_IP:54321"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY"
echo "==> Building against $EXPO_PUBLIC_SUPABASE_URL"

if [ ! -d "$APP_DIR/ios" ]; then
  (cd "$APP_DIR" && npx expo prebuild --platform ios --no-install)
fi
if [ ! -d "$APP_DIR/ios/Pods" ]; then
  (cd "$APP_DIR/ios" && pod install)
fi

# Release, so the JavaScript is embedded. A Debug build would also need Metro
# reachable from the phone, which is a second thing to go wrong.
(cd "$APP_DIR/ios" && xcodebuild \
  -workspace MVMNT.xcworkspace -scheme MVMNT \
  -configuration Release -destination "id=$DEVICE_ID" \
  -derivedDataPath "$BUILD_DIR" \
  -allowProvisioningUpdates build) | tail -3

APP="$(find "$BUILD_DIR/Build/Products" -name 'MVMNT.app' -maxdepth 3 | head -1)"
[ -n "$APP" ] || { echo "build produced no .app" >&2; exit 1; }

echo "==> Installing to the phone"
xcrun devicectl device install app --device "$DEVICE_ID" "$APP"

cat <<EOF

Installed. Open MVMNT on the phone.

FIRST LAUNCH, if iOS refuses to open it:
  Settings > General > VPN & Device Management > your Apple ID > Trust.

Sign in with any seeded account, e.g. runner7@mvmnt.test, and read the
6-digit code from the mail catcher — on the phone's browser, or on this Mac:
  http://$LAN_IP:54324

WHAT THIS IS ACTUALLY WORTH TESTING (the simulator cannot):
  · check-in at a real meeting point, with real GPS
  · the camera scanning a friend's code in daylight
  · how it behaves on mobile data with the Wi-Fi off
    (it will lose the database — that is expected until the hosted project
     exists; the offline check-in queue is the part to watch)

The build expires after 7 days on a free Apple ID. Run this again to renew.
EOF
