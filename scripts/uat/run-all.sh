#!/usr/bin/env bash
#
# Run every scriptable live UAT item across phases and print a result table. Phase 3 items (1, 3,
# 5, 6a, 6b, 7) and Phase 5's item 8 (05-10-PLAN.md Task 3) all join this one runner rather than
# each phase inventing its own.
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
  cargo build -p core --bin uat_session_env --bin uat_seed_ui --bin uat_authoring_ops --bin uat_fleet_ops --bin uat_fanout_ops -p flywheel-shim 2>&1 | tail -2
  npm --prefix packages/sidecar run build >/dev/null 2>&1 || {
    printf '  ⚠ sidecar build failed — scripts needing it will skip\n'
  }
fi

declare -a NAMES=()
declare -a RESULTS=()
declare -a NOTES=()
declare -a LOGS=()

# Every item's FULL output is retained on disk, beside the items' own JSON artifacts (D-105). It used
# to live only in this process's stdout, so a failing token-spending item left nothing behind once
# the terminal scrolled — which is half of why the uat-03 failure had to be diagnosed from a sibling
# item's artifact.
LOG_DIR="${FLYWHEEL_UAT_ARTIFACT_DIR:-${TMPDIR:-/tmp}/flywheel-uat-artifacts}"
mkdir -p "$LOG_DIR"
RUN_STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
printf '▸ Per-item output logs: %s/run-all-%s-*.log\n' "$LOG_DIR" "$RUN_STAMP"

run_item() {
  local label="$1"; shift
  printf '\n▸ %s\n' "$label"
  local slug log output status
  slug="$(printf '%s' "$label" | tr -c 'a-zA-Z0-9' '-' | tr -s '-' | cut -c1-40)"
  log="${LOG_DIR}/run-all-${RUN_STAMP}-${slug}.log"
  output="$("$@" 2>&1)"
  status=$?
  printf '%s\n' "$output" >"$log"
  printf '%s\n' "$output" | sed 's/^/  /'
  NAMES+=("$label")
  LOGS+=("$log")
  case "$status" in
    0) RESULTS+=("PASS"); NOTES+=("") ;;
    3) RESULTS+=("SKIP"); NOTES+=("$(printf '%s' "$output" | awk -F': ' '/SKIP/{print $NF; exit}')") ;;
    # NOT truncated. This used to be `substr($0,1,70)`, which reduced a real failure to
    # "AssertionError [ERR_ASSERTION]: the session must not close while a des" — cutting off
    # mid-word, and with it every word that would have said WHICH property failed. A note that
    # overflows the table box is strictly better than one that loses the finding. `INSTRUMENT` is
    # matched too, so `assertNoEvent`'s budget refusal surfaces here as itself rather than as a
    # generic assertion failure.
    *) RESULTS+=("FAIL"); NOTES+=("$(printf '%s' "$output" | awk '/^(AssertionError|ASSERTION|PROPERTY|INSTRUMENT)/{print; exit}')") ;;
  esac
}

# FIRST, and deliberately: the two zero-token harness gates. If the harness has stopped supervising
# its own sessions, every credential-spending item below is racing the watchdog and its verdict means
# nothing — so this is checked before a single token is spent, not after (D-105).
run_item "GATE — harness supervises its own sessions (zero tokens)" \
  node scripts/uat/harness-supervision-gate.mjs --mode=supervised
run_item "GATE — the heartbeat opt-out is still reaped on time (zero tokens)" \
  node scripts/uat/harness-supervision-gate.mjs --mode=unsupervised

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
run_item "UAT 8 — Socratic epic authoring, driven live (Phase 5 roadmap criteria)" \
  node scripts/uat/uat-08-socratic-authoring.mjs
run_item "UAT 9 — Product Kill Criterion, in-app vs terminal-paced (05-17-PLAN.md)" \
  node scripts/uat/uat-09-product-kill-criterion.mjs
run_item "UAT 10 — phase-6 agent backlog loop, offline (all PROP ids, zero tokens)" \
  node scripts/uat/uat-10-agent-backlog.mjs --offline
run_item "UAT 11 — env-file-ordering verdict functions, self-test only (zero tokens; live run is MANUAL below)" \
  node scripts/uat/uat-11-env-file-ordering.mjs --selftest
run_item "UAT 12 — fleet live reads: log tail, dismiss, blocked queue, reclaim (D-REV-48/49/50/55, zero tokens)" \
  node scripts/uat/uat-12-fleet-live-reads.mjs
run_item "UAT 13 — whole fan-out, only the model faked: cap, commit, merge, wave-two base (D-REV-34, zero tokens)" \
  node scripts/uat/uat-13-fan-out-live.mjs

printf '\n\n┌─ UAT results (Phases 3 and 5) ────────────────────────────────────────────\n'
FAILED=0
for i in "${!NAMES[@]}"; do
  case "${RESULTS[$i]}" in
    PASS) icon="✅" ;;
    SKIP) icon="⏭️ " ;;
    *)    icon="❌"; FAILED=1 ;;
  esac
  printf '│ %s %-6s %s\n' "$icon" "${RESULTS[$i]}" "${NAMES[$i]}"
  [ -n "${NOTES[$i]}" ] && printf '│          ↳ %s\n' "${NOTES[$i]}"
  # The full output of a FAILING item, named right where someone reads the failure.
  [ "${RESULTS[$i]}" = "FAIL" ] && printf '│          ↳ full output: %s\n' "${LOGS[$i]}"
done
printf '│ 👁  MANUAL UAT 2 — orphan recovery modal blocks the board\n'
printf '│          ↳ bash scripts/uat/uat-ui-setup.sh orphan\n'
printf '│ 👁  MANUAL UAT 4 — destructive card renders correctly\n'
printf '│          ↳ bash scripts/uat/uat-ui-setup.sh destructive\n'
printf '│ 👁  MANUAL UAT 10-live — phase-6 agent backlog loop, live (spends tokens)\n'
printf '│          ↳ node scripts/uat/uat-10-agent-backlog.mjs --live\n'
printf '│ 👁  MANUAL UAT 11-live — CLAUDE_ENV_FILE ordering, PATH shadow restoration, ask-branch (spends tokens)\n'
printf '│          ↳ node scripts/uat/uat-11-env-file-ordering.mjs\n'
printf '└────────────────────────────────────────────────────────────────────────────\n'

exit "$FAILED"
