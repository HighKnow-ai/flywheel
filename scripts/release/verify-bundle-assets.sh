#!/usr/bin/env bash
# Verify what the INSTALLED Flywheel.app carries (plan 11-20, D-REV-20, T-11-55).
#
# Subject is /Applications/Flywheel.app only. A development build is not the subject, so
# this script never reads a Cargo or Tauri build directory (override with FLYWHEEL_APP for a
# different installed copy). The source icon is the one tracked in the repository.
#
# One line per check, "PASS" or "FAIL"; exit non-zero on the first failure.
set -euo pipefail

APP="${FLYWHEEL_APP:-/Applications/Flywheel.app}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SRC_ICNS="$ROOT/packages/desktop/src-tauri/icons/icon.icns"
PLIST="$APP/Contents/Info.plist"

fail() { echo "FAIL  $1"; exit 1; }
pass() { echo "PASS  $1"; }

[ -d "$APP" ] || fail "installed bundle: $APP is absent (a development build is not the subject)"
[ -f "$SRC_ICNS" ] || fail "source icon: $SRC_ICNS is absent"

plist() { defaults read "$PLIST" "$1" 2>/dev/null || true; }

# 1. The icon file the plist names is the one present, and it is the source icon, byte for byte.
ICON_NAME="$(plist CFBundleIconFile)"
[ -n "$ICON_NAME" ] || fail "Info.plist: CFBundleIconFile is not set (an unreferenced icon paints nothing)"
case "$ICON_NAME" in *.icns) ;; *) ICON_NAME="$ICON_NAME.icns" ;; esac
INSTALLED_ICNS="$APP/Contents/Resources/$ICON_NAME"
[ -f "$INSTALLED_ICNS" ] || fail "Info.plist: CFBundleIconFile names $ICON_NAME but Contents/Resources/ has no such file"
pass "Info.plist: CFBundleIconFile=$ICON_NAME is present in Contents/Resources/"

SRC_SHA="$(shasum -a 256 "$SRC_ICNS" | cut -d' ' -f1)"
APP_SHA="$(shasum -a 256 "$INSTALLED_ICNS" | cut -d' ' -f1)"
[ "$SRC_SHA" = "$APP_SHA" ] || fail "icns hash: installed $APP_SHA != source $SRC_SHA"
pass "icns hash: installed == src-tauri/icons/icon.icns ($APP_SHA)"

# 2. Identity keys.
[ "$(plist CFBundleName)" = "Flywheel" ] || fail "Info.plist: CFBundleName is '$(plist CFBundleName)', expected Flywheel"
pass "Info.plist: CFBundleName=Flywheel"
[ "$(plist CFBundleIdentifier)" = "com.highknow.flywheel" ] || fail "Info.plist: CFBundleIdentifier is '$(plist CFBundleIdentifier)', expected com.highknow.flywheel"
pass "Info.plist: CFBundleIdentifier=com.highknow.flywheel"

# 3. Nested executables and the staged sidecar entrypoint (same members plan 11-01 established).
for exe in flywheel-sidecar flywheel-node flywheel-shim; do
  [ -x "$APP/Contents/MacOS/$exe" ] || fail "bundle member: Contents/MacOS/$exe is missing or not executable"
  pass "bundle member: Contents/MacOS/$exe is executable"
done
[ -f "$APP/Contents/Resources/sidecar/dist/index.js" ] || fail "bundle member: Contents/Resources/sidecar/dist/index.js is missing"
pass "bundle member: Contents/Resources/sidecar/dist/index.js exists"

echo "ALL PASS  $APP"
