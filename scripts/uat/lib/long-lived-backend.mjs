#!/usr/bin/env node
/**
 * A backend stub for UAT item 1 only, pointed at by `FLYWHEEL_CLAUDE_BIN`.
 *
 * WHY THIS EXISTS, AND WHAT IT DOES NOT WEAKEN. UAT item 1's guarantee is about the PROCESS TREE:
 * when the supervisor stops heartbeating, does the session's watchdog force-kill its whole process
 * group and leave a kill record behind? Nothing in that sentence depends on which binary sits at
 * the leaf of the tree. What it does depend on is the leaf staying alive longer than the stale
 * window (15s) — and the real backend will not do that on demand. Measured against
 * claude 2.1.267: asking it to `sleep 240` is refused by Claude Code's own tool policy ("Do not
 * chain shorter sleeps to work around this block"), the turn ends in about 16 seconds, and the
 * watchdog then exits alongside its finished child rather than ever firing. A test built on that
 * would be timing the model, not the watchdog.
 *
 * Everything above the leaf is the real product: the real sidecar, the real ClaudeCodeAdapter, the
 * real watchdog wrapper, the real process group, the real runtime protocol on disk. The real
 * backend binary IS exercised end-to-end — by UAT items 3 and 5, which need a real model and get
 * one.
 *
 * Behaviour: emit one well-formed stream-json init line so the adapter sees a normal session
 * start, then stay alive doing nothing until something kills it. It installs no signal handlers,
 * so it dies exactly as an unresponsive backend would.
 */
const sessionId = `uat-${process.pid}`;

process.stdout.write(
  `${JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: "uat-long-lived-backend",
  })}\n`,
);

// Deliberately no SIGTERM/SIGINT handler: the point is to be reaped, not to cooperate.
setInterval(() => {}, 1 << 30);
