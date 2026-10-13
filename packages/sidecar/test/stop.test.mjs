/**
 * PROC-06 / D-35's real-process proof: a stubborn child with a grandchild is fully torn down by
 * the interrupt-then-force sequence, and every other case in plan 02-02 Task 1's `<behavior>` list
 * is covered against the real spawned fake CLI (`fake-claude.mjs`) — never a mock of
 * `child_process`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { ClaudeCodeAdapter } from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;

// Every grandchild pid a "stubborn" test in THIS file has observed — tracked so the safety net
// below can clean up precisely the processes THIS FILE started, mirroring
// `shutdown.test.mjs`'s own scoped-pid precedent (plan 03-02): a broad `pkill -f <fake-claude
// path>` (this file's own precedent before plan 03-02) matches ANY process whose command line
// contains that shared fixture path — including a SIBLING test file's still-legitimately-running
// session, since `node --test` runs multiple test files concurrently and every file points
// `FLYWHEEL_CLAUDE_BIN` at the identical `fake-claude.mjs` script. Plan 03-02's watchdog wrapper
// makes this collision materially more likely to land mid-suite (it adds a second process, and a
// startup delay, to every session, shifting this file's own timing relative to its siblings') —
// observed directly: `permission.test.mjs`'s own 25-second held-open session was torn down by
// this file's OLD broad pkill mid-suite before this fix.
const trackedGrandchildPids = [];

/** The POSIX process GROUP id for `pid`, or `undefined` if `pid` is no longer alive — mirrors
 * `shutdown.test.mjs`'s own identical helper. The grandchild shares its process group with the
 * watchdog wrapper that leads it (plan 03-02) and the backend in between, so signalling the
 * NEGATION of this one id reaches all three — the same group-wide reach `killSession`'s own
 * `-child.pid` signalling relies on in production. */
function processGroupIdOf(pid) {
  try {
    const output = execSync(`ps -o pgid= -p ${pid}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    const pgid = Number.parseInt(output, 10);
    return Number.isInteger(pgid) ? pgid : undefined;
  } catch {
    return undefined; // pid is already gone — ps exits non-zero when nothing matches.
  }
}

// Safety net, independent of whether the adapter under test actually tore everything down: a
// stubborn fake-claude (or its grandchild) left alive by a failing assertion would otherwise keep
// this file's own Node process's event loop non-empty forever (an open stdout pipe/readline
// listener on a still-live child keeps the process referenced), hanging the whole test file. This
// runs once, after every test in this file has settled, and is a no-op when nothing is left —
// scoped to this file's own tracked pids (see comment above), never a broad pattern match.
after(() => {
  for (const pid of trackedGrandchildPids) {
    const pgid = processGroupIdOf(pid);
    if (pgid === undefined) continue; // already gone
    try {
      process.kill(-pgid, "SIGKILL");
    } catch {
      // Exited in the gap between the pgid lookup and this signal — nothing to do.
    }
  }
});

/** Poll `predicate` until it's true or `timeoutMs` elapses. */
async function waitForCondition(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitForCondition timed out");
}

/** Bounds an otherwise-hanging promise with a clear failure instead of stalling the suite. */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function startFakeSession(adapter, runId, events, env = {}) {
  return adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "say hi",
    permissionMode: "acceptEdits",
    env,
    onEvent: (event) => events.push(event),
  });
}

test("interrupting a cooperative session ends with reason interrupted", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "run-cooperative";

  const startPromise = startFakeSession(adapter, runId, events);
  await waitForCondition(() => events.some((e) => e.type === "assistant_text"));

  await withTimeout(adapter.interruptSession(runId), 8000, "interruptSession did not resolve in time");
  await withTimeout(startPromise, 8000, "the cooperative session did not close in time");

  const closed = events.find((e) => e.type === "session_closed");
  assert.ok(closed, "expected exactly one session_closed event");
  assert.equal(closed.reason, "interrupted");
});

test("interrupting an already-exited session is a safe no-op that emits no second session_closed", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "run-already-exited";

  // The default fake CLI exits on its own after ~50ms if never interrupted.
  await startFakeSession(adapter, runId, events);

  const closedCountBefore = events.filter((e) => e.type === "session_closed").length;
  assert.equal(closedCountBefore, 1, "the session must have closed naturally before this assertion");

  await withTimeout(
    adapter.interruptSession(runId),
    8000,
    "interrupting an already-exited session must resolve promptly",
  );

  const closedCountAfter = events.filter((e) => e.type === "session_closed").length;
  assert.equal(
    closedCountAfter,
    1,
    "interrupting an already-closed session must not emit a second session_closed event",
  );
});

test("interrupting a stubborn session escalates to a group SIGTERM and tears down its grandchild", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "run-stubborn";

  const startPromise = startFakeSession(adapter, runId, events, { FLYWHEEL_FAKE_STUBBORN: "1" });
  await waitForCondition(() => events.some((e) => e.raw && e.raw.includes("grandchild_pid")));

  const pidEvent = events.find((e) => e.raw && e.raw.includes("grandchild_pid"));
  const grandchildPid = JSON.parse(pidEvent.raw).pid;
  assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0, "expected a real grandchild pid");
  trackedGrandchildPids.push(grandchildPid);

  await withTimeout(
    adapter.interruptSession(runId),
    8000,
    "interruptSession must escalate to SIGTERM and resolve within the grace window plus margin",
  );
  await withTimeout(startPromise, 8000, "the stubborn session did not close in time");

  const closed = events.find((e) => e.type === "session_closed");
  assert.ok(closed, "expected a session_closed event for the stubborn session");
  assert.equal(closed.reason, "interrupted");

  // The group SIGTERM has been sent by the time the session closes, but the grandchild is
  // reparented to launchd and only disappears from the process table once that reaps it. On a
  // loaded CI runner that lags the close by a few hundred ms (11-04: green once, red once on the
  // same code), so poll for the disappearance rather than sampling it at one instant.
  await waitForCondition(
    () => {
      try {
        process.kill(grandchildPid, 0);
        return false;
      } catch (err) {
        return err.code === "ESRCH";
      }
    },
    { timeoutMs: 3000 },
  ).catch(() => {});
  assert.throws(
    () => process.kill(grandchildPid, 0),
    (err) => err.code === "ESRCH",
    "the grandchild process must no longer exist after the force step reached the whole process group",
  );
});

test("interrupting an unknown runId rejects with a typed error naming the id and signals no other session", async () => {
  const adapter = new ClaudeCodeAdapter();
  const bystanderEvents = [];
  const bystanderRunId = "run-bystander";

  const bystanderPromise = startFakeSession(adapter, bystanderRunId, bystanderEvents);

  await assert.rejects(
    () => adapter.interruptSession("run-does-not-exist"),
    (err) => typeof err.message === "string" && err.message.includes("run-does-not-exist"),
  );

  await withTimeout(bystanderPromise, 8000, "the bystander session did not close in time");
  const bystanderClosed = bystanderEvents.find((e) => e.type === "session_closed");
  assert.ok(bystanderClosed, "the bystander session must have closed on its own, untouched");
  assert.equal(
    bystanderClosed.reason,
    "completed",
    "the bystander session must never be marked interrupted by an unknown-runId call",
  );
});

test("interrupting one of two concurrent sessions leaves the other running and streaming", async () => {
  const adapter = new ClaudeCodeAdapter();
  const eventsA = [];
  const eventsB = [];
  const runA = "run-concurrent-a";
  const runB = "run-concurrent-b";

  const startA = startFakeSession(adapter, runA, eventsA, { FLYWHEEL_FAKE_STUBBORN: "1" });
  const startB = startFakeSession(adapter, runB, eventsB, { FLYWHEEL_FAKE_STUBBORN: "1" });

  await waitForCondition(() => eventsA.some((e) => e.raw && e.raw.includes("grandchild_pid")));
  await waitForCondition(() => eventsB.some((e) => e.raw && e.raw.includes("grandchild_pid")));

  await withTimeout(adapter.interruptSession(runA), 8000, "interrupting A did not resolve in time");

  assert.ok(eventsA.some((e) => e.type === "session_closed"), "A must be closed");
  assert.ok(!eventsB.some((e) => e.type === "session_closed"), "B must still be running after A was interrupted");
  assert.ok(eventsB.some((e) => e.type === "assistant_text"), "B must have been actively streaming");

  const eventsBCountBeforeCleanup = eventsB.length;
  // Prove B is still healthy (not silently killed alongside A) and clean it up: kill it directly,
  // which must produce a further event on B AFTER A already closed.
  await withTimeout(adapter.killSession(runB), 8000, "killing B did not resolve in time");
  await withTimeout(startB, 8000, "B did not close in time");

  assert.ok(
    eventsB.length > eventsBCountBeforeCleanup,
    "B must emit at least one further event (its own session_closed) after A was already closed",
  );
  assert.ok(eventsB.some((e) => e.type === "session_closed" && e.reason === "interrupted"));

  await withTimeout(startA, 8000, "A did not fully settle");
});
