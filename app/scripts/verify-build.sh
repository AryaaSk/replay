#!/usr/bin/env bash
#
# Verify a locally-built Replay.app is correctly signed by the Apple Developer
# ID Application certificate, and that Gatekeeper would accept it.
#
# Run AFTER `npm run tauri:build`. Doesn't check notarisation — that needs
# `xcrun stapler validate` on the .dmg, see check_notarised below.
#
# Usage:  ./scripts/verify-build.sh
#         ./scripts/verify-build.sh /path/to/some-other.app   # custom path
#
# No secrets in here. Safe to commit.

set -euo pipefail

# Default to the standard release output. Override with $1.
APP_PATH="${1:-src-tauri/target/release/bundle/macos/Replay.app}"
DMG_PATH="${2:-$(ls src-tauri/target/release/bundle/dmg/Replay_*.dmg 2>/dev/null | head -1)}"

cd "$(dirname "$0")/.."   # cwd = app/

echo "═══ checking signed app at: $APP_PATH ═══"
if [ ! -d "$APP_PATH" ]; then
  echo "  ✗ no .app at $APP_PATH — run 'npm run tauri:build' first"
  exit 1
fi

echo
echo "── codesign --verify (deep + strict) ──"
codesign --verify --deep --strict --verbose=2 "$APP_PATH"

echo
echo "── codesign --display (signing identity) ──"
codesign --display --verbose=2 "$APP_PATH" 2>&1 | grep -E "(Authority|TeamIdentifier|Identifier=)" || true

echo
echo "── spctl --assess (Gatekeeper accept/reject) ──"
spctl --assess --verbose --type execute "$APP_PATH" || {
  echo "  ✗ Gatekeeper would reject. Common causes:"
  echo "    - app not notarised (signing alone isn't enough for first-time users)"
  echo "    - quarantine attribute missing/wrong"
  exit 1
}

if [ -n "${DMG_PATH:-}" ] && [ -f "$DMG_PATH" ]; then
  echo
  echo "═══ checking dmg at: $DMG_PATH ═══"
  echo
  echo "── stapler validate (notarisation ticket) ──"
  if xcrun stapler validate "$DMG_PATH" 2>&1 | grep -qi "validated"; then
    echo "  ✓ notarisation ticket is stapled"
  else
    echo "  ⚠ no notarisation ticket — run notarisation step before publishing"
    echo "    (signing alone works on YOUR Mac but Gatekeeper will warn new users)"
  fi
fi

echo
echo "═══ ✓ checks complete ═══"
