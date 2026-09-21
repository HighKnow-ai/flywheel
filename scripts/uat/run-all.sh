#!/usr/bin/env bash
#
# Run every scriptable phase-03 UAT item and print a result table.
#
# The two visual items (2 and 4) are not run here — they need a human looking at a window. They are
# listed in the table as MANUAL with the command that stands each one up.
#
# Exit code: 0 when every scriptable item passed or skipped, 1 when any failed.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT" || exit 1

BUILD=1
for arg in "$@"; do
  [ "$arg" = "--no-build" ] && BUILD=0
done

if [ "$BUILD" = "1" ]; then
  printf '▸ Building prerequisites (pass --no-build to skip)\n'
  cargo build -p core --bin uat_session_env --bin uat_seed_ui -p flywheel-shim 2>&1 | tail -2
  npm --prefix packages/sidecar run build >/dev/null 2>&1 || {
    printf '  ⚠ sidecar build failed — scripts needing it will skip\n'
  }
fi

declare -a NAMES=()
declare -a RESULTS=()
declare -a NOTES=()

run_item() {
  local label="$1"; shift
  printf '\n▸ %s\n' "$label"
  local output
  output="$("$@" 2>&1)"
  local status=$?
  printf '%s\n' "$output" | sed 's/^/  /'
  NAMES+=("$label")
  case "$status" in
    0) RESULTS+=("PASS"); NOTES+=("") ;;
    3) RESULTS+=("SKIP"); NOTES+=("$(printf '%s' "$output" | awk -F': ' '/SKIP/{print $NF; exit}')") ;;
    *) RESULTS+=("FAIL"); NOTES+=("$(printf '%s' "$output" | awk '/^(AssertionError|ASSERTION|PROPERTY)/{print substr($0,1,70); exit}')") ;;
  esac
}

run_item "UAT 1 — supervisor kill -9 leaves no surviving agent process" \
  bash scripts/uat/uat-01-supervisor-kill.sh
run_item "UAT 3 — destructive gate stops a live auto-accept session" \
  node scripts/uat/uat-03-destructive-gate.mjs
run_item "UAT 5 — ten concurrent commits keep every commit" \
  node scripts/uat/uat-05-concurrent-commits.mjs
run_item "UAT 6a — unanswered destructive request, unsupervised (no heartbeat)" \
  node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=off
run_item "UAT 6b — unanswered destructive request, production-shaped (heartbeat on)" \
  node scripts/uat/uat-06-permission-block-lifecycle.mjs --heartbeat=on
run_item "UAT 7 — launcher-wrapped destructive command, measured live (D-62 item 2)" \
  node scripts/uat/uat-07-launcher-shape-gate.mjs

printf '\n\n┌─ Phase 03 UAT results ─────────────────────────────────────────────────────\n'
FAILED=0
for i in "${!NAMES[@]}"; do
  case "${RESULTS[$i]}" in
    PASS) icon="✅" ;;
    SKIP) icon="⏭️ " ;;
    *)    icon="❌"; FAILED=1 ;;
  esac
  printf '│ %s %-6s %s\n' "$icon" "${RESULTS[$i]}" "${NAMES[$i]}"
  [ -n "${NOTES[$i]}" ] && printf '│          ↳ %s\n' "${NOTES[$i]}"
done
printf '│ 👁  MANUAL UAT 2 — orphan recovery modal blocks the board\n'
printf '│          ↳ bash scripts/uat/uat-ui-setup.sh orphan\n'
printf '│ 👁  MANUAL UAT 4 — destructive card renders correctly\n'
printf '│          ↳ bash scripts/uat/uat-ui-setup.sh destructive\n'
printf '└────────────────────────────────────────────────────────────────────────────\n'

exit "$FAILED"
