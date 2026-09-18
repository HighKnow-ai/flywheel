#!/usr/bin/env bash
#
# Precondition setup for the two VISUAL phase-03 UAT items (2 and 4).
#
# These two are the ones a script genuinely cannot decide. Item 2 asks whether the orphan-recovery
# modal actually BLOCKS the board — that Escape does nothing, that click-outside does nothing, that
# the board is unreachable until the list is empty. Item 4 asks whether the destructive card RENDERS
# correctly — the stop-sign glyph, the consequence sentence naming the deleted BRANCH rather than
# the remote, Deny filled and primary, Allow outlined and secondary reading "just this once", and no
# allow-always affordance anywhere. Those are judgements about pixels.
#
# So this script does everything EXCEPT the looking: it builds what is missing, creates a scratch
# repository, seeds a scratch database into the precise state that forces the thing under inspection
# onto the screen, and launches the real application against it. Nothing it touches goes anywhere
# near ~/Library/Application Support/Flywheel.
#
# Usage: uat-ui-setup.sh <orphan|destructive>
#
#   orphan      — UAT item 2. A run the database believes is running with no live process behind it,
#                 so launch reconciliation must surface it in the blocking recovery modal.
#   destructive — UAT item 4. A pending branch-deletion permission request, so the destructive
#                 variant of the permission card must render.
#
# The scratch directory is deliberately NOT deleted on exit: the app is still running in it, and the
# whole point is that you get to look. The path is printed at the end so you can remove it yourself.

set -uo pipefail

MODE="${1:-}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

die() { printf '\n❌ %s\n' "$1"; exit 1; }
step() { printf '   · %s\n' "$1"; }

case "$MODE" in
  orphan|destructive) ;;
  *) die "usage: uat-ui-setup.sh <orphan|destructive>" ;;
esac

# Build before launching, not merely check for existence. A STALE desktop binary is the worst
# failure mode this script has: it starts, renders, and quietly opens the developer's REAL fleet
# database, because a binary predating the FLYWHEEL_APP_DATA_DIR seam simply ignores it. That is
# indistinguishable from working until you notice the project rail showing real projects. Cost one
# debugging round; keep this build unconditional.
if [ "${UAT_SKIP_BUILD:-0}" != "1" ]; then
  step "building the seeder and the desktop app (set UAT_SKIP_BUILD=1 to skip)"
  cargo build -p core --bin uat_seed_ui -p desktop 2>&1 | tail -3 | sed 's/^/     /'
fi

SEEDER=""
for profile in debug release; do
  [ -x "${REPO_ROOT}/target/${profile}/uat_seed_ui" ] && SEEDER="${REPO_ROOT}/target/${profile}/uat_seed_ui" && break
done
[ -n "$SEEDER" ] || die "uat_seed_ui is not built — run \`cargo build -p core --bin uat_seed_ui\`"

# Release first, then debug. The order matters: a Tauri DEBUG build loads its frontend from
# `devUrl` (http://localhost:1420), not from the bundled dist — so launching a debug binary with
# nothing serving that port gives a blank white window. A release build embeds the frontend and
# needs no dev server.
APP_BIN=""
APP_PROFILE=""
for profile in release debug; do
  if [ -x "${REPO_ROOT}/target/${profile}/desktop" ]; then
    APP_BIN="${REPO_ROOT}/target/${profile}/desktop"
    APP_PROFILE="$profile"
    break
  fi
done
[ -n "$APP_BIN" ] || die "the desktop binary is not built — run \`cargo build -p desktop\` (or \`npm --prefix packages/desktop run tauri build\`)"

VITE_PID=""
DEV_PORT=1420
start_dev_server_if_needed() {
  # Only a devUrl-loading binary needs this. Detect it from the binary itself rather than assuming
  # by profile, so a release build configured unusually is still handled correctly.
  #
  # `grep -c`, not `grep -q`: under `set -o pipefail`, a `grep -q` that matches exits immediately,
  # `strings` then dies of SIGPIPE, and the pipeline reports 141 — so the match reads as a MISS and
  # the dev server is silently never started. `grep -c` consumes all of its input, so there is no
  # SIGPIPE to misreport. This cost one blank-window debugging round; do not "simplify" it back.
  local devurl_hits
  devurl_hits=$(strings "$APP_BIN" 2>/dev/null | grep -c "localhost:${DEV_PORT}" || true)
  if [ "${devurl_hits:-0}" -eq 0 ]; then
    return 0
  fi
  if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    step "a dev server is already listening on ${DEV_PORT} — reusing it"
    return 0
  fi
  step "this is a ${APP_PROFILE} build, which loads its frontend from http://localhost:${DEV_PORT} — starting the dev server"
  npm --prefix "${REPO_ROOT}/packages/desktop" run dev >"${SCRATCH}/vite.log" 2>&1 &
  VITE_PID=$!
  for _ in $(seq 1 60); do
    if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
      step "dev server is up on ${DEV_PORT}"
      return 0
    fi
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      die "the dev server exited before it started listening:
$(tail -20 "${SCRATCH}/vite.log" 2>/dev/null)"
    fi
    sleep 0.5
  done
  die "the dev server never started listening on ${DEV_PORT}:
$(tail -20 "${SCRATCH}/vite.log" 2>/dev/null)"
}

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/flywheel-uat-ui-${MODE}-XXXXXX")"
APP_DATA="${SCRATCH}/appdata"
REPO="${SCRATCH}/repo"
WORKTREE_ROOT="${SCRATCH}/worktrees"
mkdir -p "$APP_DATA" "$REPO" "$WORKTREE_ROOT"

git init -q --initial-branch main "$REPO" || die "could not create the scratch repository"
git -C "$REPO" config user.email "uat@flywheel.invalid"
git -C "$REPO" config user.name "Flywheel UAT"
echo "# UAT scratch repo" > "${REPO}/README.md"
git -C "$REPO" add README.md
git -C "$REPO" commit -qm "initial commit"
step "created a scratch repository at ${REPO}"

export FLYWHEEL_APP_DATA_DIR="$APP_DATA"
export FLYWHEEL_WORKTREE_ROOT="$WORKTREE_ROOT"

SEED_OUTPUT="$("$SEEDER" "$MODE" "$REPO")" || die "seeding failed:
${SEED_OUTPUT}"
printf '%s\n' "$SEED_OUTPUT" | sed 's/^/   /'
RUN_ID="$(printf '%s\n' "$SEED_OUTPUT" | awk '/^SEEDED /{print $3; exit}')"

# Guard against the stale-binary failure above: prove the app binary actually honours the seam
# before handing the window over, rather than letting it silently open the real fleet database.
if ! strings "$APP_BIN" 2>/dev/null | grep -c "FLYWHEEL_APP_DATA_DIR" | grep -qv '^0$'; then
  die "the desktop binary does not reference FLYWHEEL_APP_DATA_DIR — it predates that seam and
would open your REAL fleet database instead of the scratch one. Rebuild it:
  cargo build -p desktop"
fi
step "verified the app binary honours FLYWHEEL_APP_DATA_DIR"

cat <<BANNER

────────────────────────────────────────────────────────────────────────────
Launching Flywheel against the scratch database.
  app data : ${APP_DATA}
  repo     : ${REPO}
  run      : ${RUN_ID}

BANNER

if [ "$MODE" = "orphan" ]; then
  cat <<'CHECKS'
UAT item 2 — what to confirm on screen:
  □ The orphan recovery modal appears and BLOCKS the board behind it.
  □ Escape does nothing.
  □ Clicking outside the modal does nothing.
  □ Each row offers Kill — never resume or adopt.
  □ Kill All resolves the remaining rows.
  □ The board becomes reachable only once the list is empty.
  □ The affected task's run then reads Abandoned, with the watchdog's own reason.
  □ Acknowledge clears it.
CHECKS
else
  cat <<'CHECKS'
UAT item 4 — what to confirm on screen:
  □ The card shows the stop-sign glyph.
  □ The consequence sentence names the deleted BRANCH ("feature/doomed"), NOT the remote.
  □ Deny is filled and primary.
  □ Allow is outlined and secondary, and reads "just this once".
  □ There is no allow-always option anywhere on the card.
  □ After answering Allow, the Settings permission-rules table still offers no standing grant.
CHECKS
fi

start_dev_server_if_needed

# The dev server is this script's child; it must not outlive the app window.
cleanup_dev_server() {
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
}
trap cleanup_dev_server EXIT

cat <<BANNER

Close the app window when you are done.
Scratch directory is left in place for inspection — remove it with:
  rm -rf "${SCRATCH}"
────────────────────────────────────────────────────────────────────────────

BANNER

"$APP_BIN"
