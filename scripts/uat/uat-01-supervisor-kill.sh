#!/usr/bin/env bash
#
# UAT item 1 (Success Criterion 2, PROC-03/PROC-04) — "Supervisor kill -9 leaves no surviving
# agent process."
#
# 03-VERIFICATION.md deferred this because "proving the WHOLE application (Rust supervisor + Node
# sidecar + watchdog process-group tree) survives a hard kill -9 of the supervisor itself requires
# a packaged, running app — no harness in this repository stands that up."
#
# This stands it up, with one deliberate substitution: the Rust supervisor is replaced by
# lib/supervisor.mjs, which does the only two things the watchdog can observe about a supervisor —
# it owns the sidecar process, and it touches the heartbeat file via the PRODUCTION writer
# (runtime_protocol::touch_heartbeat). Everything downstream of that is the real product: the real
# sidecar, the real claude-code-adapter, the real watchdog wrapper, the real backend binary, the
# real process group.
#
# WHAT IS KILLED, AND WHY ONLY THE SUPERVISOR. The watchdog's own doc comment names its reason for
# existing: a SIGKILL of the sidecar produces no RunEvent::Exit and no shutdown_all_sessions(), and
# macOS has no PDEATHSIG, so nothing but a stale heartbeat can reach a running session. Two
# measured findings shaped what this script kills, and how:
#
#   - Killing the sidecar TOO collapses the session through broken pipes (the sidecar's next event
#     write gets EPIPE, then the watchdog's does) within about a second, long before the 15s stale
#     window. The group empties, but the watchdog never fires and no kill record is written.
#   - Even killing only the supervisor collapses it the same way if the sidecar's stdout is a pipe
#     this process owns. So the supervisor gives the sidecar a FIFO for stdin and FILES for
#     stdout/stderr: nothing the supervisor's death can break, leaving a stale heartbeat as the
#     only signal that reaches the session — exactly the condition under test.
#
# The backend is a long-lived stub (lib/long-lived-backend.mjs) because the real one will not stay
# alive across the stale window on demand; see that file for the measurement. Everything above the
# leaf of the process tree is the real product.
#
# Asserted afterwards, within the stale window plus a margin:
#   1. No process from the session's process group survives in the OS process table.
#   2. A kill record exists under <runtime>/kills/<runId>.json naming the run id, pid, reason and
#      timestamp.
#
# Costs real tokens: it drives a real model turn (a long sleep).

set -uo pipefail
# Job-control notifications ("Killed: 9") would otherwise print into the middle of this script's
# own output when it kills the supervisor — the kill is the point, not an incident to report.
set +m

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SUPERVISOR="${REPO_ROOT}/scripts/uat/lib/supervisor.mjs"
HARNESS_BIN=""
for profile in debug release; do
  if [ -x "${REPO_ROOT}/target/${profile}/uat_session_env" ]; then
    HARNESS_BIN="${REPO_ROOT}/target/${profile}/uat_session_env"
    break
  fi
done

NAME="UAT 1 — supervisor kill -9 leaves no surviving agent process"

fail() { printf '\n❌ FAIL — %s\n\n%s\n' "$NAME" "$1"; exit 1; }
skip() { printf '\n⏭️  SKIP — %s: %s\n' "$NAME" "$1"; exit 3; }
step() { printf '   · %s\n' "$1"; }

[ -n "$HARNESS_BIN" ] || skip "uat_session_env is not built — run \`cargo build -p core --bin uat_session_env\`"
[ -f "${REPO_ROOT}/packages/sidecar/dist/index.js" ] || skip "the sidecar bundle is missing — run \`npm --prefix packages/sidecar run build\`"
command -v claude >/dev/null 2>&1 || skip "the real \`claude\` binary is not resolvable"

SCRATCH="$(mktemp -d "${TMPDIR:-/tmp}/flywheel-uat-supervisor-kill-XXXXXX")"
APP_DATA="${SCRATCH}/appdata"
WORKTREE="${SCRATCH}/work"
SUPERVISOR_PID=""
SIDECAR_PID=""
GROUP_PID=""

cleanup() {
  # Best-effort: anything still alive after the assertions is a leak this script created, and
  # leaving it running would poison the developer's machine and the next run.
  for pid in "$SUPERVISOR_PID" "$SIDECAR_PID"; do
    [ -n "$pid" ] && kill -9 "$pid" 2>/dev/null
  done
  [ -n "$GROUP_PID" ] && kill -9 -- "-${GROUP_PID}" 2>/dev/null
  rm -rf "$SCRATCH"
}
trap cleanup EXIT

mkdir -p "$APP_DATA" "$WORKTREE"
git init -q --initial-branch main "$WORKTREE" || fail "could not create the scratch repository"
git -C "$WORKTREE" config user.email "uat@flywheel.invalid"
git -C "$WORKTREE" config user.name "Flywheel UAT"
echo "# UAT scratch repo" > "${WORKTREE}/README.md"
git -C "$WORKTREE" add README.md
git -C "$WORKTREE" commit -qm "initial commit"
step "created a scratch repository and app-data directory"

READY_FILE="${SCRATCH}/ready"
FIFO="${SCRATCH}/sidecar-stdin"
mkfifo "$FIFO" || fail "could not create the sidecar stdin FIFO"
FLYWHEEL_UAT_LONG_LIVED_BACKEND=1 node "$SUPERVISOR" "$APP_DATA" "$WORKTREE" \
  "stay alive until killed" \
  fifo "$FIFO" \
  > "$READY_FILE" 2>"${SCRATCH}/supervisor.err" &
SUPERVISOR_PID=$!
step "started the stand-in supervisor (pid ${SUPERVISOR_PID}), sidecar stdin on a FIFO"

# Wait for the supervisor to report a live session.
RUN_ID=""
for _ in $(seq 1 240); do
  if grep -q '^READY ' "$READY_FILE" 2>/dev/null; then
    RUN_ID=$(awk '/^READY /{print $2; exit}' "$READY_FILE")
    SIDECAR_PID=$(awk '/^READY /{print $3; exit}' "$READY_FILE")
    break
  fi
  if ! kill -0 "$SUPERVISOR_PID" 2>/dev/null; then
    fail "the supervisor exited before a session became live:
$(cat "${SCRATCH}/supervisor.err" 2>/dev/null)"
  fi
  sleep 0.5
done
[ -n "$RUN_ID" ] || fail "no session became live within 120s:
$(cat "${SCRATCH}/supervisor.err" 2>/dev/null)"

RUNTIME_DIR="${APP_DATA}/runtime"
DESCRIPTOR="${RUNTIME_DIR}/runs/${RUN_ID}.json"
[ -f "$DESCRIPTOR" ] || fail "the run descriptor is missing at ${DESCRIPTOR}"

# The descriptor's pid IS the watchdog wrapper, which leads the session's process group — so the
# group is addressed as the negative of that pid, exactly as watchdog.ts signals it.
GROUP_PID=$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["pid"])' "$DESCRIPTOR")
step "session ${RUN_ID} is live; process group leader is pid ${GROUP_PID}"

# Prove the group is genuinely alive BEFORE the kill — otherwise "nothing survives" afterwards
# would be vacuously true and this script would pass without testing anything.
if ! ps -o pid= -g "$GROUP_PID" | grep -q '[0-9]'; then
  fail "the session's process group ${GROUP_PID} was already empty before the kill — this harness
is not exercising a live session, so its post-kill assertions would be vacuous"
fi
ALIVE_BEFORE=$(ps -o pid= -g "$GROUP_PID" | wc -l | tr -d ' ')
step "falsifiability check: ${ALIVE_BEFORE} process(es) alive in the group before the kill"

# Only the SUPERVISOR is killed. The sidecar keeps running with its stdin still open (the FIFO),
# so neither of its own fallback nets fires and nothing but a stale heartbeat can reach the
# session — which is precisely the condition watchdog.ts exists for, and the only path that writes
# a kill record. See this script's header for why killing the sidecar too was the wrong test.
step "sending kill -9 to the supervisor (${SUPERVISOR_PID}) only; the sidecar (${SIDECAR_PID}) stays up"
kill -9 "$SUPERVISOR_PID" 2>/dev/null

# The watchdog polls every HEARTBEAT_POLL_MS (2s) and fires at HEARTBEAT_STALE_MS (15s), so the
# worst case is ~17s. 30s is a generous ceiling that still fails rather than hanging.
DEADLINE=$((SECONDS + 30))
KILL_RECORD="${RUNTIME_DIR}/kills/${RUN_ID}.json"
group_empty=false
record_present=false
while [ $SECONDS -lt $DEADLINE ]; do
  if ! ps -o pid= -g "$GROUP_PID" 2>/dev/null | grep -q '[0-9]'; then group_empty=true; fi
  if [ -f "$KILL_RECORD" ]; then record_present=true; fi
  if [ "$group_empty" = true ] && [ "$record_present" = true ]; then break; fi
  sleep 1
done

if [ "$group_empty" != true ]; then
  fail "ASSERTION 1 FAILED — processes from the session's group survived the supervisor kill:
$(ps -o pid=,command= -g "$GROUP_PID" 2>/dev/null)"
fi
step "ASSERTION 1 — no process from the session's group survives"

if [ "$record_present" != true ]; then
  fail "ASSERTION 2 FAILED — no kill record at ${KILL_RECORD}
kills dir contains: $(ls -la "${RUNTIME_DIR}/kills" 2>&1)"
fi

RECORD=$(cat "$KILL_RECORD")
for field in run_id pid start_time reason killed_at; do
  python3 -c '
import json,sys
record = json.loads(sys.argv[1])
field = sys.argv[2]
value = record.get(field)
if value is None or value == "":
    sys.exit(1)
' "$RECORD" "$field" || fail "ASSERTION 2 FAILED — the kill record is missing \`${field}\`: ${RECORD}"
done

RECORD_RUN_ID=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["run_id"])' "$RECORD")
RECORD_REASON=$(python3 -c 'import json,sys;print(json.loads(sys.argv[1])["reason"])' "$RECORD")
[ "$RECORD_RUN_ID" = "$RUN_ID" ] || fail "the kill record names run ${RECORD_RUN_ID}, expected ${RUN_ID}"
[ "$RECORD_REASON" = "heartbeat-stale" ] || fail "the kill record's reason is '${RECORD_REASON}', expected 'heartbeat-stale' — something other than the watchdog's staleness path reaped this session"

step "ASSERTION 2 — kill record names run_id, pid, start_time, reason=${RECORD_REASON}, killed_at"
printf '\n✅ PASS — %s\n' "$NAME"
