#!/usr/bin/env bash
#
# Stand the real application up on the demonstration board (phase 14, VIS-06, criterion 5).
#
# The board is Flywheel's own planning tree (this milestone's phases, plans and tasks, the archived
# history, the pending todos) with every runtime state it cannot carry synthesised on top: running,
# blocked, failed, completed, abandoned, awaiting review, proposals pending, commits ahead, a dirty
# tree, a merged branch. Visual decisions are judged on it, never on fixture rows.
#
# Usage: demo-board.sh
#   DEMO_SKIP_BUILD=1  skip the build (not recommended, see below)
#   DEMO_SEED_ONLY=1   seed, verify and print the banner, but do not launch the window
#
# WHERE IT LIVES. A known, stable path, not a fresh scratch directory per run, because plans 14-09
# and 14-10 must come back to the same board and the owner's verdict has to be recorded against a
# board that still exists afterwards: <repo>/target/demo-board/ (git-ignored). Never the real
# app-data directory, never inside the planning tree.
#
# RE-SEEDS OR REUSES. Every run RE-SEEDS the same path: the previous demo directory is removed and
# written again, and the script says so. It never accumulates directories. Re-seeding is also what
# the live rows need: the app rewrites any running/blocked run it finds at launch unless the seeder
# has just protected it (see the header of packages/core/tests/bin/demo_board.rs), and a board the
# app has already launched once has lost that protection's effect on its first-launch history.
#
# SCOPE. This script launches and seeds. It captures nothing. Plan 14-10 owns the capture.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEMO_BASE="${REPO_ROOT}/target/demo-board"
APP_DATA="${DEMO_BASE}/appdata"
WORKTREE_ROOT="${DEMO_BASE}/worktrees"

die() { printf '\n❌ %s\n' "$1"; exit 1; }
step() { printf '   · %s\n' "$1"; }

# Build before launching, not merely check for existence. A STALE desktop binary is the worst
# failure mode here: it starts, renders, and quietly opens the developer's REAL fleet database,
# because a binary predating the FLYWHEEL_APP_DATA_DIR seam simply ignores it. It is
# indistinguishable from working until the project rail shows real projects. Keep this build
# unconditional by default.
if [ "${DEMO_SKIP_BUILD:-0}" != "1" ] && [ "${DEMO_SEED_ONLY:-0}" != "1" ]; then
  step "building the seeder and the desktop app (set DEMO_SKIP_BUILD=1 to skip)"
  cargo build -p core --bin demo_board -p desktop 2>&1 | tail -3 | sed 's/^/     /'
elif [ "${DEMO_SEED_ONLY:-0}" = "1" ] && [ "${DEMO_SKIP_BUILD:-0}" != "1" ]; then
  step "building the seeder (set DEMO_SKIP_BUILD=1 to skip)"
  cargo build -p core --bin demo_board 2>&1 | tail -3 | sed 's/^/     /'
fi

SEEDER=""
for profile in debug release; do
  [ -x "${REPO_ROOT}/target/${profile}/demo_board" ] && SEEDER="${REPO_ROOT}/target/${profile}/demo_board" && break
done
[ -n "$SEEDER" ] || die "demo_board is not built - run \`cargo build -p core --bin demo_board\`"

# Release first, then debug. A Tauri DEBUG build loads its frontend from `devUrl`
# (http://localhost:1420), not from the bundled dist, so a debug binary with nothing serving that
# port opens a blank white window. A release build embeds the frontend and needs no dev server.
APP_BIN=""
APP_PROFILE=""
if [ "${DEMO_SEED_ONLY:-0}" != "1" ]; then
  for profile in release debug; do
    if [ -x "${REPO_ROOT}/target/${profile}/desktop" ]; then
      APP_BIN="${REPO_ROOT}/target/${profile}/desktop"
      APP_PROFILE="$profile"
      break
    fi
  done
  [ -n "$APP_BIN" ] || die "the desktop binary is not built - run \`cargo build -p desktop\` (or \`npm --prefix packages/desktop run tauri build\`)"
fi

# Prove the app binary honours BOTH seams before handing a window over, rather than letting it
# silently open the real fleet database or create worktrees under ~/Flywheel. `grep -c`, not
# `grep -q`: under `set -o pipefail` a matching `grep -q` exits at once, `strings` dies of SIGPIPE
# and the pipeline reports 141, so a HIT reads as a MISS.
if [ -n "$APP_BIN" ]; then
  for seam in FLYWHEEL_APP_DATA_DIR FLYWHEEL_WORKTREE_ROOT; do
    hits=$(strings "$APP_BIN" 2>/dev/null | grep -c "$seam" || true)
    if [ "${hits:-0}" -eq 0 ]; then
      die "the desktop binary does not reference ${seam} - it predates that seam and would touch
your REAL data instead of the demo board. Rebuild it:
  cargo build -p desktop"
    fi
  done
  step "verified the app binary honours FLYWHEEL_APP_DATA_DIR and FLYWHEEL_WORKTREE_ROOT"
fi

VITE_PID=""
DEV_PORT=1420
start_dev_server_if_needed() {
  # Only a devUrl-loading binary needs this; detect it from the binary, not from the profile.
  local devurl_hits
  devurl_hits=$(strings "$APP_BIN" 2>/dev/null | grep -c "localhost:${DEV_PORT}" || true)
  if [ "${devurl_hits:-0}" -eq 0 ]; then
    return 0
  fi
  if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    step "a dev server is already listening on ${DEV_PORT} - reusing it"
    return 0
  fi
  step "this is a ${APP_PROFILE} build, which loads its frontend from http://localhost:${DEV_PORT} - starting the dev server"
  npm --prefix "${REPO_ROOT}/packages/desktop" run dev >"${DEMO_BASE}/vite.log" 2>&1 &
  VITE_PID=$!
  for _ in $(seq 1 60); do
    if lsof -nP -iTCP:${DEV_PORT} -sTCP:LISTEN >/dev/null 2>&1; then
      step "dev server is up on ${DEV_PORT}"
      return 0
    fi
    if ! kill -0 "$VITE_PID" 2>/dev/null; then
      die "the dev server exited before it started listening:
$(tail -20 "${DEMO_BASE}/vite.log" 2>/dev/null)"
    fi
    sleep 0.5
  done
  die "the dev server never started listening on ${DEV_PORT}:
$(tail -20 "${DEMO_BASE}/vite.log" 2>/dev/null)"
}

# Re-seed the same known path. The guard keeps the removal inside the demo directory whatever the
# environment holds.
case "$DEMO_BASE" in
  */target/demo-board) ;;
  *) die "refusing to remove ${DEMO_BASE}: it is not the demo-board directory" ;;
esac
if [ -d "$DEMO_BASE" ]; then
  step "re-seeding the existing demo board at ${DEMO_BASE}"
else
  step "seeding a new demo board at ${DEMO_BASE}"
fi
rm -rf "$APP_DATA" "$WORKTREE_ROOT"
mkdir -p "$APP_DATA" "$WORKTREE_ROOT"

export FLYWHEEL_APP_DATA_DIR="$APP_DATA"
export FLYWHEEL_WORKTREE_ROOT="$WORKTREE_ROOT"

SEED_OUTPUT="$("$SEEDER" "$REPO_ROOT")" || die "seeding failed:
${SEED_OUTPUT}"
SEEDED_LINE="$(printf '%s\n' "$SEED_OUTPUT" | awk '/^SEEDED /{print; exit}')"
[ -n "$SEEDED_LINE" ] || die "the seeder printed no SEEDED line:
${SEED_OUTPUT}"

cat <<BANNER

────────────────────────────────────────────────────────────────────────────
Flywheel demonstration board
  database : ${APP_DATA}/flywheel.db
  app data : ${APP_DATA}
  worktrees: ${WORKTREE_ROOT}

$(printf '%s\n' "$SEED_OUTPUT" | grep -v '^SEEDED ' | sed 's/^/  /')

  counts   : ${SEEDED_LINE#SEEDED }
────────────────────────────────────────────────────────────────────────────

BANNER

if [ "${DEMO_SEED_ONLY:-0}" = "1" ]; then
  step "DEMO_SEED_ONLY=1 - not launching the window"
  exit 0
fi

start_dev_server_if_needed

# The dev server is this script's child; it must not outlive the app window.
cleanup_dev_server() {
  [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
}
trap cleanup_dev_server EXIT

printf 'Close the app window when you are done. The board stays at %s\n\n' "$DEMO_BASE"

"$APP_BIN"
