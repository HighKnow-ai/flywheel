/**
 * D-47/D-48/PROC-04's real-process proof (plan 03-02 Task 3): stopping the heartbeat file
 * provably kills the WHOLE watchdog-led session group (the watchdog wrapper AND the backend it
 * spawned), and a readable kill record survives on disk afterward. Every liveness assertion here
 * probes a real pid directly (`process.kill(pid, 0)`), never inferred from the watchdog's own
 * exit event — an exit event cannot distinguish "dead" from "reparented and still running".
 *
 * This file is criterion 2's *mechanism* proof. The *whole-application* proof — `kill -9` on the
 * real running Flywheel process, then confirming with the OS process table that no `claude`
 * process survives and a kill record exists under `<app-data>/runtime/kills/` — is the
 * `<human-check>` in `03-02-PLAN.md`'s own `<verify>` block, because it needs the real Tauri
 * process tree that no unit harness in this repository can stand up.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WATCHDOG_ENTRY = path.join(__dirname, "..", "dist", "watchdog.js");
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

/** Every watchdog pid this file has spawned, force-killed by group unconditionally in `after()`
 * regardless of test outcome — mirrors `stop.test.mjs`'s own tracked-pid safety net (plan 03-02:
 * never a broad `pkill -f`, which can tear down a sibling test file's still-legitimate session). */
const trackedWatchdogPids = [];

after(() => {
  for (const pid of trackedWatchdogPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone — nothing to clean up.
    }
  }
});

/** `true` if `pid` answers a zero-signal probe, `false` otherwise (including "never existed" and
 * "already gone") — the one liveness primitive every assertion in this file uses directly. */
function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Poll `predicate` until it returns a truthy value or `timeoutMs` elapses; returns that value,
 * or throws naming `message` on timeout, so a failure here always says which pid was still (or
 * not yet) alive rather than just "timed out". */
async function waitFor(predicate, { timeoutMs = 5000, intervalMs = 20, message = "waitFor timed out" } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = predicate();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(message);
}

/** The direct child pid of `parentPid`, or `undefined` if it has none (yet, or ever). This is the
 * only way this test file learns the BACKEND's own pid: `spawn()` only ever returns the
 * WRAPPER's pid to this file, since the backend is spawned from INSIDE the watchdog process, not
 * by this test directly. */
function directChildPidOf(parentPid) {
  try {
    const output = execFileSync("pgrep", ["-P", String(parentPid)], {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    const firstLine = output.split("\n")[0];
    const pid = Number.parseInt(firstLine, 10);
    return Number.isInteger(pid) ? pid : undefined;
  } catch {
    return undefined; // pgrep exits non-zero when the parent has no children (yet, or ever).
  }
}

function touchHeartbeat(runtimeDir) {
  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, "heartbeat"), new Date().toISOString());
}

/**
 * Spawn the watchdog exactly the way `claude-code-adapter.ts` does — `detached: true` on the
 * wrapper itself, nothing else — pointed at `fake-claude.mjs` in its STUBBORN mode (never exits
 * on its own, ignores SIGINT, forks its own grandchild), which is what makes it a realistic
 * long-lived backend for these tests instead of the default fixture's own ~50ms auto-exit.
 */
function spawnWatchdog({ runtimeDir, runId, staleMs, pollMs }) {
  const child = spawn(process.execPath, [WATCHDOG_ENTRY, FAKE_CLAUDE], {
    env: {
      ...process.env,
      FLYWHEEL_RUNTIME_DIR: runtimeDir,
      FLYWHEEL_HEARTBEAT_STALE_MS: String(staleMs),
      FLYWHEEL_HEARTBEAT_POLL_MS: String(pollMs),
      FLYWHEEL_RUN_ID: runId,
      FLYWHEEL_FAKE_STUBBORN: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return child;
}

function scratchRuntimeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-watchdog-test-"));
}

test("a fresh heartbeat leaves both the watchdog and its backend alive across at least three poll intervals", async () => {
  const runtimeDir = scratchRuntimeDir();
  const pollMs = 100;
  const staleMs = 100_000; // Comfortably larger than this test's own wait — proves liveness here, not staleness.
  touchHeartbeat(runtimeDir);

  const watchdog = spawnWatchdog({ runtimeDir, runId: "wd-fresh-heartbeat", staleMs, pollMs });
  trackedWatchdogPids.push(watchdog.pid);

  const backendPid = await waitFor(() => directChildPidOf(watchdog.pid), {
    message: "the backend never appeared as the watchdog's own direct child",
  });

  // Keep touching the heartbeat across at least three of the watchdog's own poll intervals,
  // exactly like the Rust core's own heartbeat thread would while Flywheel is alive.
  const keepTouching = setInterval(() => touchHeartbeat(runtimeDir), Math.max(10, pollMs / 2));
  await new Promise((resolve) => setTimeout(resolve, pollMs * 3 + 300));
  clearInterval(keepTouching);

  assert.ok(isAlive(watchdog.pid), "the watchdog must still be alive with a fresh heartbeat");
  assert.ok(isAlive(backendPid), "the backend must still be alive with a fresh heartbeat");

  process.kill(-watchdog.pid, "SIGKILL");
});

test("ceasing to touch the heartbeat kills both the watchdog and the backend within one stale window plus one poll interval", async () => {
  const runtimeDir = scratchRuntimeDir();
  const pollMs = 100;
  const staleMs = 300;
  touchHeartbeat(runtimeDir);

  const watchdog = spawnWatchdog({ runtimeDir, runId: "wd-stale-kill", staleMs, pollMs });
  trackedWatchdogPids.push(watchdog.pid);

  const backendPid = await waitFor(() => directChildPidOf(watchdog.pid), {
    message: "the backend never appeared as the watchdog's own direct child",
  });
  assert.ok(isAlive(watchdog.pid) && isAlive(backendPid), "both must start out alive");

  // Never touched again after this point — the watchdog must notice this on its own.
  await waitFor(() => !isAlive(watchdog.pid) && !isAlive(backendPid), {
    timeoutMs: staleMs + pollMs * 3 + 3000,
    message:
      `expected both the watchdog (pid ${watchdog.pid}) and the backend (pid ${backendPid}) ` +
      "to be dead once the stale window elapsed",
  });
});

test("a kill record for the run exists on disk, parses as JSON, and names the reason, pid and a timestamp", async () => {
  const runtimeDir = scratchRuntimeDir();
  const pollMs = 100;
  const staleMs = 300;
  const runId = "wd-kill-record";
  touchHeartbeat(runtimeDir);

  const watchdog = spawnWatchdog({ runtimeDir, runId, staleMs, pollMs });
  trackedWatchdogPids.push(watchdog.pid);
  await waitFor(() => directChildPidOf(watchdog.pid), {
    message: "the backend never appeared as the watchdog's own direct child",
  });

  const killRecordFile = path.join(runtimeDir, "kills", `${runId}.json`);
  await waitFor(() => fs.existsSync(killRecordFile), {
    timeoutMs: staleMs + pollMs * 3 + 3000,
    message: "expected a kill record to appear on disk once the stale window elapsed",
  });

  const record = JSON.parse(fs.readFileSync(killRecordFile, "utf8"));
  assert.equal(record.run_id, runId, "the kill record must name this run");
  assert.equal(record.reason, "heartbeat-stale", "the kill record must name the reason");
  assert.equal(typeof record.pid, "number", "the kill record must name a pid");
  assert.ok(record.pid > 0, "the kill record's pid must be a real positive number");
  assert.ok(
    typeof record.killed_at === "string" && record.killed_at.length > 0,
    "the kill record must carry a timestamp",
  );
});

test("sending the force signal to the negation of the watchdog's pid kills both the watchdog and the backend", async () => {
  const runtimeDir = scratchRuntimeDir();
  const pollMs = 100;
  const staleMs = 100_000; // Not relied on here — this test signals the group itself.
  touchHeartbeat(runtimeDir);

  const watchdog = spawnWatchdog({ runtimeDir, runId: "wd-group-signal", staleMs, pollMs });
  trackedWatchdogPids.push(watchdog.pid);
  const backendPid = await waitFor(() => directChildPidOf(watchdog.pid), {
    message: "the backend never appeared as the watchdog's own direct child",
  });
  assert.ok(isAlive(watchdog.pid) && isAlive(backendPid), "both must start out alive");

  process.kill(-watchdog.pid, "SIGKILL");

  await waitFor(() => !isAlive(watchdog.pid) && !isAlive(backendPid), {
    timeoutMs: 3000,
    message: "expected the group signal to kill both the watchdog and the backend",
  });
});

test("starting with no heartbeat file at all does not kill the backend before one full stale window has elapsed", async () => {
  const runtimeDir = scratchRuntimeDir();
  const pollMs = 50;
  const staleMs = 1000;
  // Deliberately never touched — this is the launch-race grace window, not staleness detection.

  const watchdog = spawnWatchdog({ runtimeDir, runId: "wd-no-heartbeat-grace", staleMs, pollMs });
  trackedWatchdogPids.push(watchdog.pid);
  const backendPid = await waitFor(() => directChildPidOf(watchdog.pid), {
    message: "the backend never appeared as the watchdog's own direct child",
  });

  await new Promise((resolve) => setTimeout(resolve, staleMs / 2));
  assert.ok(isAlive(watchdog.pid), "the watchdog must still be alive at half the stale window");
  assert.ok(isAlive(backendPid), "the backend must still be alive at half the stale window");

  process.kill(-watchdog.pid, "SIGKILL");
});
