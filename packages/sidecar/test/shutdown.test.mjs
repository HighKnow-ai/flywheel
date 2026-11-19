/**
 * CR-02 / PROC-01's real-process proof for the `shutdown` op (plan 02-14): the first test in this
 * suite that drives the sidecar as a REAL CHILD PROCESS over its actual stdin/stdout protocol,
 * rather than importing `ClaudeCodeAdapter` directly — the point of the exercise, since `shutdown`
 * is a protocol surface the Rust core depends on, and a test that bypasses stdin would not prove
 * it exists at all.
 *
 * Reuses `stop.test.mjs`'s real-process vocabulary: the `FLYWHEEL_CLAUDE_BIN` pointer at
 * `fake-claude.mjs`, the `after()` `pkill -f` safety net, `waitForCondition`, `withTimeout`, and
 * the `process.kill(pid, 0)` / `err.code === "ESRCH"` assertion that is the actual proof a
 * process is gone.
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { recordStubbornChildren } from "./stubborn-children.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SIDECAR_ENTRY = path.join(__dirname, "..", "dist", "index.js");
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

/** Every stubborn process this file's sessions start (the fixture records its own pid and its
 * grandchild's, and the watchdog wrapper above them: its group holds all three), ended in the
 * `after()` below even when a test never tracked the pid it needs. Never a process-table match: a
 * `pkill -f <fake-claude path>` once ended a sibling file's live session, and `ps` is refused in an
 * agent sandbox. */
const stubborn = recordStubbornChildren(import.meta.url);

// Safety net, independent of whether the shutdown path under test actually tore everything down:
// a stubborn fake-claude (or its grandchild) left alive by a failing assertion would otherwise
// keep this file's own Node process's event loop non-empty forever, hanging the whole test file.
// Runs once, after every test in this file has settled, and is a no-op when nothing is left —
// scoped to this file's own tracked pids (see comment above), not a global pattern match.
after(() => {
  stubborn.reap(); // the fixture's own record: ends what the pids above did not reach.
});

/** Poll `predicate` until it is true or `timeoutMs` elapses. The default is wider than every caller's `withTimeout`, so
 * the caller's bound and its message are the ones that fire: a 2s default here once cut an 8s budget short under load. */
async function waitForCondition(predicate, { timeoutMs = 30_000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitForCondition timed out");
}

/**
 * Wait until `pid` no longer exists (`kill(pid, 0)` throws ESRCH), failing with `message` after `timeoutMs`.
 *
 * A signalled process is not gone the instant the signal is sent: it still has to be scheduled to die, and
 * until its new parent reaps it, it is a zombie that `kill(pid, 0)` still finds. On a loaded machine that
 * takes measurable time after the ack arrived (measured: a grandchild still in state `E`, exiting, 11-37ms after
 * the ack under 20 parallel runs), so asserting ESRCH at once fails intermittently although the
 * group signal did its work (issue #169). The proof is that the process is gone within a bound, not in zero
 * time.
 */
async function waitUntilGone(pid, message, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch (err) {
      if (err.code === "ESRCH") return;
      throw err;
    }
    if (Date.now() > deadline) assert.fail(`${message} (pid ${pid} still exists ${timeoutMs}ms later)`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Bounds an otherwise-hanging promise with a clear failure instead of stalling the suite. */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Spawn a REAL `node dist/index.js` sidecar child process, pointed at `fake-claude.mjs` via
 * `FLYWHEEL_CLAUDE_BIN`. Every parsed stdout line (an `{ kind: "event", ... }` or
 * `{ kind: "ack", ... }` object) is pushed into `lines`, which the caller polls with
 * `waitForCondition`. `send(request)` writes one newline-delimited JSON request to the child's
 * stdin — the exact protocol the Rust core speaks.
 */
function startSidecar() {
  const child = spawn(process.execPath, [SIDECAR_ENTRY], {
    stdio: ["pipe", "pipe", "inherit"],
    env: { ...process.env, FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE },
  });
  const lines = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    if (line.trim().length === 0) return;
    try {
      lines.push(JSON.parse(line));
    } catch {
      // A non-JSON stdout line would be a sidecar bug — ignored here, not this test's concern.
    }
  });
  function send(request) {
    child.stdin.write(`${JSON.stringify(request)}\n`);
  }
  return { child, lines, send };
}

function eventsFor(sidecar, runId) {
  return sidecar.lines
    .filter((line) => line.kind === "event" && line.event?.runId === runId)
    .map((line) => line.event);
}

function ackFor(sidecar, id) {
  return sidecar.lines.find((line) => line.kind === "ack" && line.id === id);
}

function spawnRequest(id, runId, env = {}) {
  return {
    id,
    op: "spawn",
    runId,
    worktreePath: process.cwd(),
    prompt: "say hi",
    permissionMode: "acceptEdits",
    env,
  };
}

test("a shutdown request tears down two stubborn sessions and both of their grandchildren", async () => {
  const sidecar = startSidecar();
  try {
    sidecar.send(spawnRequest("spawn-a", "run-shutdown-a", { FLYWHEEL_FAKE_STUBBORN: "1" }));
    sidecar.send(spawnRequest("spawn-b", "run-shutdown-b", { FLYWHEEL_FAKE_STUBBORN: "1" }));

    await withTimeout(
      waitForCondition(
        () =>
          eventsFor(sidecar, "run-shutdown-a").some((e) => e.raw?.includes("grandchild_pid")) &&
          eventsFor(sidecar, "run-shutdown-b").some((e) => e.raw?.includes("grandchild_pid")),
      ),
      8000,
      "both sessions' grandchild pids were not reported in time",
    );

    const pidA = JSON.parse(
      eventsFor(sidecar, "run-shutdown-a").find((e) => e.raw?.includes("grandchild_pid")).raw,
    ).pid;
    const pidB = JSON.parse(
      eventsFor(sidecar, "run-shutdown-b").find((e) => e.raw?.includes("grandchild_pid")).raw,
    ).pid;

    // BEFORE state: both grandchildren are genuinely alive — a test that passed because they
    // never started would prove nothing.
    assert.doesNotThrow(() => process.kill(pidA, 0), "grandchild A must be alive before shutdown");
    assert.doesNotThrow(() => process.kill(pidB, 0), "grandchild B must be alive before shutdown");

    sidecar.send({ id: "shutdown-two-sessions", op: "shutdown" });

    await withTimeout(
      waitForCondition(() => ackFor(sidecar, "shutdown-two-sessions") !== undefined),
      8000,
      "the shutdown ack did not arrive in time",
    );

    const ack = ackFor(sidecar, "shutdown-two-sessions");
    assert.equal(ack.ok, true, "the shutdown request must ack ok");
    assert.equal(ack.data?.killed, 2, "the shutdown ack must report both sessions killed");

    await waitUntilGone(pidA, "grandchild A must no longer exist after the shutdown reached its process group");
    await waitUntilGone(pidB, "grandchild B must no longer exist after the shutdown reached its process group");
  } finally {
    sidecar.child.kill();
  }
});

test("a shutdown request against a sidecar with no live sessions acks ok with killed 0, promptly", async () => {
  const sidecar = startSidecar();
  try {
    // Time the shutdown from a booted sidecar: a ping's ack says it reads requests. Timing from the spawn
    // measured Node's own start-up too, which a loaded machine stretches past the bound (issue #169).
    sidecar.send({ id: "ping-empty", op: "ping" });
    await withTimeout(
      waitForCondition(() => ackFor(sidecar, "ping-empty") !== undefined),
      8000,
      "the sidecar did not answer its ping in time",
    );
    const startedAt = Date.now();
    sidecar.send({ id: "shutdown-empty", op: "shutdown" });

    await withTimeout(
      waitForCondition(() => ackFor(sidecar, "shutdown-empty") !== undefined),
      2000,
      "the empty-session shutdown ack did not arrive in time",
    );

    const ack = ackFor(sidecar, "shutdown-empty");
    assert.equal(ack.ok, true, "an empty shutdown must never be an error (PROC-01 empty edge)");
    assert.equal(ack.data?.killed, 0);
    assert.ok(
      Date.now() - startedAt < 1000,
      "an empty shutdown must resolve promptly — it must never wait out the session grace window",
    );
  } finally {
    sidecar.child.kill();
  }
});

test("a second shutdown request immediately after the first is idempotent (killed 0)", async () => {
  const sidecar = startSidecar();
  try {
    sidecar.send(spawnRequest("spawn-c", "run-shutdown-idempotent", { FLYWHEEL_FAKE_STUBBORN: "1" }));

    await withTimeout(
      waitForCondition(() => eventsFor(sidecar, "run-shutdown-idempotent").some((e) => e.raw?.includes("grandchild_pid"))),
      4000,
      "the session's grandchild pid was not reported in time",
    );

    sidecar.send({ id: "shutdown-first", op: "shutdown" });
    await withTimeout(
      waitForCondition(() => ackFor(sidecar, "shutdown-first") !== undefined),
      8000,
      "the first shutdown ack did not arrive in time",
    );
    assert.equal(ackFor(sidecar, "shutdown-first").ok, true);
    assert.equal(ackFor(sidecar, "shutdown-first").data?.killed, 1);

    sidecar.send({ id: "shutdown-second", op: "shutdown" });
    await withTimeout(
      waitForCondition(() => ackFor(sidecar, "shutdown-second") !== undefined),
      2000,
      "the second shutdown ack did not arrive in time",
    );
    assert.equal(ackFor(sidecar, "shutdown-second").ok, true);
    assert.equal(
      ackFor(sidecar, "shutdown-second").data?.killed,
      0,
      "a second shutdown immediately after the first must be an idempotent no-op",
    );
  } finally {
    sidecar.child.kill();
  }
});

test("SIGTERM to the sidecar process tears down a stubborn session's grandchild", async () => {
  const sidecar = startSidecar();
  try {
    sidecar.send(spawnRequest("spawn-d", "run-shutdown-sigterm", { FLYWHEEL_FAKE_STUBBORN: "1" }));

    await withTimeout(
      waitForCondition(() => eventsFor(sidecar, "run-shutdown-sigterm").some((e) => e.raw?.includes("grandchild_pid"))),
      8000,
      "the grandchild pid was not reported in time",
    );

    const pid = JSON.parse(
      eventsFor(sidecar, "run-shutdown-sigterm").find((e) => e.raw?.includes("grandchild_pid")).raw,
    ).pid;
    assert.doesNotThrow(() => process.kill(pid, 0), "the grandchild must be alive before SIGTERM");

    const exited = new Promise((resolve) => sidecar.child.once("exit", resolve));
    sidecar.child.kill("SIGTERM");
    await withTimeout(exited, 8000, "the sidecar process did not exit after SIGTERM in time");

    await waitUntilGone(pid, "the grandchild must be gone after the sidecar's own SIGTERM fallback net ran");
  } finally {
    try {
      sidecar.child.kill();
    } catch {
      // Already exited — nothing to do.
    }
  }
});
