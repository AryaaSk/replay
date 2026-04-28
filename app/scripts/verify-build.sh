#!/usr/bin/env bash
#
# Verify the most recent Replay build is correctly signed by the Apple
# Developer ID Application certificate, that Gatekeeper would accept it,
# and (if the .dmg has been notarised) that the staple is valid.
#
# Run AFTER `npm run tauri:build`. Tauri's bundler deletes the loose
# Replay.app after folding it into the .dmg, so we mount the .dmg and
# verify the .app inside.
#
# Usage:  ./scripts/verify-build.sh
#         ./scripts/verify-build.sh /path/to/some.dmg     # custom dmg
#
# No secrets in here. Safe to commit.

set -euo pipefail

cd "$(dirname "$0")/.."   # cwd = app/

DMG_PATH="${1:-$(ls -t src-tauri/target/release/bundle/dmg/Replay_*.dmg 2>/dev/null | head -1 || true)}"
LOOSE_APP="src-tauri/target/release/bundle/macos/Replay.app"

# Prefer a loose .app if it exists (faster, no mount needed).
if [ -d "$LOOSE_APP" ]; then
  APP_PATH="$LOOSE_APP"
  MOUNT_POINT=""
elif [ -n "${DMG_PATH:-}" ] && [ -f "$DMG_PATH" ]; then
  echo "═══ no loose .app — mounting $DMG_PATH to inspect ═══"
  MOUNT_OUTPUT=$(hdiutil attach -nobrowse -noverify -readonly "$DMG_PATH")
  MOUNT_POINT=$(echo "$MOUNT_OUTPUT" | tail -1 | awk '{ for(i=3;i<=NF;++i) printf "%s ", $i; print "" }' | sed 's/ $//')
  APP_PATH=$(find "$MOUNT_POINT" -maxdepth 2 -name "Replay.app" -type d | head -1)
  if [ -z "$APP_PATH" ]; then
    echo "  ✗ no Replay.app inside $DMG_PATH"
    hdiutil detach "$MOUNT_POINT" >/dev/null
    exit 1
  fi
else
  echo "  ✗ no .app or .dmg found — run 'npm run tauri:build' first"
  exit 1
fi

cleanup() {
  if [ -n "${MOUNT_POINT:-}" ]; then
    hdiutil detach "$MOUNT_POINT" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo
echo "═══ inspecting: $APP_PATH ═══"

echo
echo "── codesign --verify (deep + strict) ──"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo
echo "── codesign --display (signing identity) ──"
codesign --display --verbose=2 "$APP_PATH" 2>&1 | grep -E "(Authority|TeamIdentifier|Identifier=)" || true

echo
echo "── spctl --assess (Gatekeeper accept/reject) ──"
if spctl --assess --verbose --type execute "$APP_PATH" 2>&1; then
  :
else
  echo "  ✗ Gatekeeper would reject. Common causes:"
  echo "    - app not notarised yet (signing alone isn't enough for first-time users)"
  echo "    - quarantine attribute missing"
  echo "  (this is EXPECTED until you run notarisation — see below)"
fi

if [ -n "${DMG_PATH:-}" ] && [ -f "$DMG_PATH" ]; then
  echo
  echo "═══ checking dmg: $DMG_PATH ═══"
  echo
  echo "── stapler validate (notarisation ticket) ──"
  if xcrun stapler validate "$DMG_PATH" 2>&1 | tee /tmp/replay-stapler.out | grep -qi "validated\|worked\|stapled"; then
    echo "  ✓ notarisation ticket is stapled"
  else
    echo "  ⚠ no notarisation ticket on the dmg yet"
    echo "    your build is signed but unnotarised — Gatekeeper will warn first-time users"
    echo "    notarise with:"
    echo "      xcrun notarytool submit \"$DMG_PATH\" --keychain-profile replay-notary --wait"
    echo "      xcrun stapler staple \"$DMG_PATH\""
  fi
fi

echo
echo "═══ ✓ checks complete ═══"
