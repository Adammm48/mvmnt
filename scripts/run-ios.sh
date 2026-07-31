#!/usr/bin/env bash
# Run MVMNT on an iPhone simulator.
#
#   ./scripts/run-ios.sh              # iPhone 17
#   ./scripts/run-ios.sh "iPhone 17 Pro Max"
#
# NO APPLE DEVELOPER ACCOUNT NEEDED. The simulator only needs Xcode, which is
# free. That matters because "we have never run this on a phone" was the single
# biggest gap in this project, and it was wrongly assumed to be blocked behind
# the paid account — the paid account is for a REAL device and the App Store,
# not for this.
#
# What the simulator does NOT prove: real GPS at a meeting point, a camera
# scanning a code in daylight, push notifications arriving, or how the app
# behaves on a bad mobile connection. Those still need a real phone in a real
# car park (docs/dev-todo.md step 4).
set -uo pipefail

DEVICE="${1:-iPhone 17}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$ROOT/apps/mobile"
BUILD_DIR="/tmp/mvmnt-ios-build"
BUNDLE_ID="com.mvmnt.app"

# CocoaPods refuses to work under a non-UTF-8 locale, with an error that names
# neither CocoaPods nor the locale.
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

if ! xcode-select -p >/dev/null 2>&1; then
  echo "Xcode is not selected. Run:" >&2
  echo "  sudo xcode-select -s /Applications/Xcode.app/Contents/Developer" >&2
  exit 1
fi

UDID="$(xcrun simctl list devices available \
  | grep -F "$DEVICE (" | head -1 | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/')"
if [ -z "$UDID" ]; then
  echo "No simulator called '$DEVICE'. Available iPhones:" >&2
  xcrun simctl list devices available | grep -i iphone | sed 's/^/  /' >&2
  exit 1
fi
echo "==> $DEVICE ($UDID)"

# 1. The native project. Regenerated from app.json every time, which is the
#    point of prebuild: ios/ is gitignored and disposable, and app.json stays
#    the single source of truth for icons, permissions and bundle ids.
if [ ! -d "$APP_DIR/ios" ]; then
  echo "==> Generating the native project"
  (cd "$APP_DIR" && npx expo prebuild --platform ios --no-install)
fi

# Pods are reinstalled when a dependency has been added since they were last
# installed, not only when the folder is missing. Adding a native module and
# then building against stale pods produces a link error naming a symbol rather
# than the missing module, which is a long way from "run pod install".
if [ ! -d "$APP_DIR/ios/Pods" ] || [ "$APP_DIR/package.json" -nt "$APP_DIR/ios/Podfile.lock" ]; then
  echo "==> Installing native dependencies (slow, once)"
  (cd "$APP_DIR/ios" && pod install)
fi

echo "==> Booting the simulator"
xcrun simctl boot "$UDID" 2>/dev/null || true
open -a Simulator

echo "==> Building (first build takes several minutes)"
(cd "$APP_DIR/ios" && xcodebuild \
  -workspace MVMNT.xcworkspace -scheme MVMNT \
  -configuration Debug -sdk iphonesimulator \
  -destination "id=$UDID" -derivedDataPath "$BUILD_DIR" \
  build) | tail -3

APP="$(find "$BUILD_DIR/Build/Products" -name 'MVMNT.app' -maxdepth 3 | head -1)"
[ -n "$APP" ] || { echo "build produced no .app" >&2; exit 1; }

echo "==> Installing"
xcrun simctl install "$UDID" "$APP"

# 2. Metro, in dev-client mode. A Debug build fetches its JavaScript at launch
#    rather than embedding it, so `expo start --web` is NOT enough: that serves
#    the web bundle and returns 404 for the iOS one, and the app opens to a
#    connection error that looks like a broken app.
if ! curl -s --max-time 5 "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
  echo "==> Starting Metro"
  (cd "$APP_DIR" && npx expo start --port 8081 > /tmp/mvmnt-metro.log 2>&1 &)
  sleep 20
fi

echo "==> Launching"
xcrun simctl launch "$UDID" "$BUNDLE_ID"

cat <<'EOF'

Running. The Simulator window is a real iPhone: your keyboard types into it,
and ⌘⇧H is the home button.

Sign in with any seeded account — runner7@mvmnt.test — and read the 6-digit
code from the local mail catcher at http://127.0.0.1:54324

To rebuild after changing native config (app.json, permissions, icons):
  rm -rf apps/mobile/ios && ./scripts/run-ios.sh
JavaScript changes reload on their own; no rebuild needed.
EOF
