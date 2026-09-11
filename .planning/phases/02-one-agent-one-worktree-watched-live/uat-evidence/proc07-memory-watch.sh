#!/usr/bin/env bash
#
# proc07-memory-watch.sh — the PROC-07 UAT instrument.
#
# PROC-07's truth is: "a user watches a long-running session live and application
# memory stays flat rather than growing with the transcript." 02-VALIDATION.md
# records the check as manual ("watch RSS in Activity Monitor"). This script turns
# that into a measurement: it samples the resident memory of every Flywheel process
# alongside the size of the session log being streamed, so the two curves can be
# compared instead of eyeballed.
#
# The design it is testing: the renderer never holds the whole transcript. Both
# `session_log::read_window` (clamped at LOG_WINDOW_MAX_LIMIT = 100) and
# `query::events::activity_trail` (LIMIT/OFFSET) hand back a bounded page, so the
# log on disk can grow without bound while the process set does not.
#
# Usage:
#   ./proc07-memory-watch.sh [--interval 10] [--duration 10] [--out FILE]
#
#   --interval  seconds between samples (default 10)
#   --duration  minutes to watch          (default 10)
#   --seconds   watch this many seconds instead of --duration (for a dry run)
#   --out       CSV path (default: ./proc07-<timestamp>.csv beside this script)
#
# Start this BEFORE launching the app if you can — it snapshots the WebKit
# WebContent processes already running so it can attribute the new one (Flywheel's
# renderer) correctly. Launching it after the app still works; it just cannot
# separate Flywheel's WebContent from any other app's, and says so.

set -uo pipefail

INTERVAL=10
DURATION_MIN=10
DURATION_SEC=
OUT=""
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSIONS_DIR="$HOME/Library/Application Support/Flywheel/sessions"

while [ $# -gt 0 ]; do
  case "$1" in
    --interval) INTERVAL="${2:?--interval needs a value}"; shift 2 ;;
    --duration) DURATION_MIN="${2:?--duration needs a value}"; shift 2 ;;
    --seconds)  DURATION_SEC="${2:?--seconds needs a value}"; shift 2 ;;
    --out)      OUT="${2:?--out needs a value}"; shift 2 ;;
    -h|--help)  sed -n '2,28p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$OUT" ] || OUT="$SCRIPT_DIR/proc07-$(date +%Y%m%dT%H%M%S).csv"

# --- process discovery -------------------------------------------------------
# Re-run every sample: the sidecar and the claude child appear and disappear
# across a run, and a sample that missed them would understate memory.

app_pids() {
  { pgrep -f 'target/debug/desktop' 2>/dev/null
    pgrep -f 'Flywheel.app/Contents/MacOS/Flywheel' 2>/dev/null
  } | sort -u
}

sidecar_pids() { pgrep -f 'sidecar/dist/index.js' 2>/dev/null | sort -u; }

# Every descendant of $1, recursively — this is how the spawned `claude` process
# and anything it spawns get counted.
descendants() {
  local pid="$1" kid
  for kid in $(pgrep -P "$pid" 2>/dev/null); do
    echo "$kid"
    descendants "$kid"
  done
}

webcontent_pids() { pgrep -f 'com.apple.WebKit.WebContent' 2>/dev/null | sort -u; }

# Sum RSS (KB on macOS) over the pids given on stdin.
rss_sum() {
  local pid total=0 kb
  while read -r pid; do
    [ -n "$pid" ] || continue
    kb=$(ps -o rss= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -n "$kb" ] && total=$((total + kb))
  done
  echo "$total"
}

BASELINE_WC="$(webcontent_pids | tr '\n' ' ')"
APP_RUNNING_AT_START=$([ -n "$(app_pids)" ] && echo yes || echo no)

# WebContent processes that were not running when this script started — for a
# script started before the app, this is exactly Flywheel's renderer.
new_webcontent_pids() {
  local pid
  for pid in $(webcontent_pids); do
    case " $BASELINE_WC " in *" $pid "*) ;; *) echo "$pid" ;; esac
  done
}

# --- session log tracking ----------------------------------------------------
# The newest *.jsonl under <app-data>/sessions/ is the run being watched
# (session_log.rs: one append-only file per agent run, named <agent_run_id>.jsonl).

newest_log() {
  [ -d "$SESSIONS_DIR" ] || return 0
  /bin/ls -t "$SESSIONS_DIR"/*.jsonl 2>/dev/null | head -1
}

echo "PROC-07 memory watch"
echo "  interval : ${INTERVAL}s"
if [ -n "$DURATION_SEC" ]; then echo "  duration : ${DURATION_SEC}s"; else echo "  duration : ${DURATION_MIN}m"; fi
echo "  csv      : $OUT"
echo "  sessions : $SESSIONS_DIR"
if [ "$APP_RUNNING_AT_START" = yes ]; then
  echo "  note     : Flywheel was already running — the renderer (WebContent) column"
  echo "             cannot be attributed and will read 0. Restart the app with this"
  echo "             script already running to measure it."
fi
echo

printf 'elapsed_s,app_rss_kb,renderer_rss_kb,sidecar_rss_kb,agent_children_rss_kb,total_rss_kb,log_bytes,log_lines,log_file\n' > "$OUT"

START=$(date +%s)
if [ -n "$DURATION_SEC" ]; then END=$((START + DURATION_SEC)); else END=$((START + DURATION_MIN * 60)); fi
FIRST_TOTAL=""
FIRST_BYTES=""
LAST_TOTAL=0
LAST_BYTES=0
PEAK_TOTAL=0

printf '%8s  %10s  %10s  %10s  %10s  %11s  %12s  %9s\n' \
  ELAPSED APP_MB RENDER_MB SIDECAR_MB AGENT_MB TOTAL_MB LOG_KB LOG_LINES

while [ "$(date +%s)" -lt "$END" ]; do
  NOW=$(date +%s)
  ELAPSED=$((NOW - START))

  APP_LIST="$(app_pids)"
  SIDECAR_LIST="$(sidecar_pids)"

  # Agent children = everything descended from the sidecar (the `claude` process
  # and its own children), minus the sidecar pids themselves.
  CHILD_LIST=""
  for p in $SIDECAR_LIST; do
    CHILD_LIST="$CHILD_LIST
$(descendants "$p")"
  done
  CHILD_LIST="$(printf '%s\n' "$CHILD_LIST" | sed '/^$/d' | sort -u)"

  APP_KB=$(printf '%s\n' "$APP_LIST" | rss_sum)
  REND_KB=$(new_webcontent_pids | rss_sum)
  SIDE_KB=$(printf '%s\n' "$SIDECAR_LIST" | rss_sum)
  CHILD_KB=$(printf '%s\n' "$CHILD_LIST" | rss_sum)
  TOTAL_KB=$((APP_KB + REND_KB + SIDE_KB + CHILD_KB))

  LOG="$(newest_log)"
  if [ -n "$LOG" ] && [ -f "$LOG" ]; then
    BYTES=$(wc -c < "$LOG" | tr -d ' ')
    LINES=$(wc -l < "$LOG" | tr -d ' ')
    LOGNAME="$(basename "$LOG")"
  else
    BYTES=0; LINES=0; LOGNAME="(none yet)"
  fi

  printf '%s,%s,%s,%s,%s,%s,%s,%s,%s\n' \
    "$ELAPSED" "$APP_KB" "$REND_KB" "$SIDE_KB" "$CHILD_KB" "$TOTAL_KB" \
    "$BYTES" "$LINES" "$LOGNAME" >> "$OUT"

  printf '%8s  %10.1f  %10.1f  %10.1f  %10.1f  %11.1f  %12.1f  %9s\n' \
    "${ELAPSED}s" \
    "$(echo "$APP_KB"   | awk '{print $1/1024}')" \
    "$(echo "$REND_KB"  | awk '{print $1/1024}')" \
    "$(echo "$SIDE_KB"  | awk '{print $1/1024}')" \
    "$(echo "$CHILD_KB" | awk '{print $1/1024}')" \
    "$(echo "$TOTAL_KB" | awk '{print $1/1024}')" \
    "$(echo "$BYTES"    | awk '{print $1/1024}')" \
    "$LINES"

  # Anchor the "before" reading on the first sample where a log actually exists —
  # memory before the stream starts is not the baseline PROC-07 is about.
  if [ -z "$FIRST_TOTAL" ] && [ "$BYTES" -gt 0 ]; then
    FIRST_TOTAL="$TOTAL_KB"; FIRST_BYTES="$BYTES"
  fi
  LAST_TOTAL="$TOTAL_KB"; LAST_BYTES="$BYTES"
  [ "$TOTAL_KB" -gt "$PEAK_TOTAL" ] && PEAK_TOTAL="$TOTAL_KB"

  sleep "$INTERVAL"
done

echo
echo "--- summary ---------------------------------------------------------------"
if [ -z "$FIRST_TOTAL" ]; then
  echo "No session log ever appeared under $SESSIONS_DIR."
  echo "Nothing was streaming, so this run measures nothing. Start a run, then re-run."
  exit 1
fi

MEM_DELTA=$((LAST_TOTAL - FIRST_TOTAL))
LOG_DELTA=$((LAST_BYTES - FIRST_BYTES))

awk -v m0="$FIRST_TOTAL" -v m1="$LAST_TOTAL" -v peak="$PEAK_TOTAL" \
    -v b0="$FIRST_BYTES" -v b1="$LAST_BYTES" -v md="$MEM_DELTA" -v ld="$LOG_DELTA" '
BEGIN {
  printf "memory   first %.1f MB  ->  last %.1f MB   (delta %+.1f MB, peak %.1f MB)\n",
         m0/1024, m1/1024, md/1024, peak/1024
  printf "log      first %.1f KB  ->  last %.1f KB   (delta %+.1f KB)\n",
         b0/1024, b1/1024, ld/1024
  if (ld <= 0) {
    print  "verdict  INCONCLUSIVE — the log did not grow during the watch window."
    print  "         The agent was idle or already finished. Watch a live run."
    exit 0
  }
  growth = md / ld
  printf "ratio    %.3f KB of RSS per KB of transcript\n", growth
  print  ""
  if (growth < 0.25)
    print "verdict  FLAT — memory did not track the transcript. This is what PROC-07 asserts."
  else if (growth < 1.0)
    print "verdict  SUSPICIOUS — memory grew by a meaningful fraction of the transcript."
  else
    print "verdict  TRACKING — memory grew at least as fast as the transcript. PROC-07 FAILS."
  print  ""
  print  "Read the ratio against normal noise: JIT warm-up, GC timing and WebKit"
  print  "caches move RSS by tens of MB on their own. A long log (megabytes) makes"
  print  "the ratio meaningful; a 50 KB log does not."
}'

echo
echo "CSV written: $OUT"
