/**
 * Plan 03-20 Task 1 (close provenance): drives three deliberately-induced session endings through
 * the real watchdog (`watchdog.ts`) and the real adapter (`claude-code-adapter.ts`) and asserts
 * three distinct, correctly-attributed origins — the instrument this plan builds BEFORE it is ever
 * pointed at the unknown session-lifecycle termination `03-VERIFICATION.md`'s gap names.
 *
 * Follows `watchdog.test.mjs`'s and `stop.test.mjs`'s own real-process idioms throughout: real pid
 * liveness where it matters, scratch runtime directories via `fs.mkdtempSync`, and an `after()`
 * teardown — never a mock of `child_process`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { ClaudeCodeAdapter, resolveCloseOrigin } from "../dist/claude-code-adapter.js";
import { startPermissionServer } from "../dist/mcp-permission-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
// H1a is exactly the bug this test file exists to discriminate against: an ambient
// FLYWHEEL_HEARTBEAT_STALE_MS in THIS process's own environment (e.g. inherited from a shell, or
// from `npm test`'s own wrapper) would otherwise leak into the "default" scenario below, since
// `startSession` spreads `process.env` BEFORE `options.env`. Cleared unconditionally so the
// "default" test is deterministic regardless of how this file was invoked.
delete process.env.FLYWHEEL_HEARTBEAT_STALE_MS;

/** Poll `predicate` until it's true or `timeoutMs` elapses — mirrors `stop.test.mjs`'s own
 * identical helper. */
async function waitForCondition(predicate, { timeoutMs = 5000, intervalMs = 20 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitForCondition timed out");
}

/** Bounds an otherwise-hanging promise with a clear failure instead of stalling the suite —
 * mirrors `stop.test.mjs`'s own identical helper. */
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function scratchRuntimeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-close-provenance-test-"));
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

/** Read `<runtimeDir>/lifecycle/<runId>.jsonl`, asserting every line parses as JSON, and return
 * the parsed lines in source order. */
function readLifecycleLines(runtimeDir, runId) {
  const filePath = path.join(runtimeDir, "lifecycle", `${runId}.jsonl`);
  const contents = fs.readFileSync(filePath, "utf8");
  const rawLines = contents.split("\n").filter((line) => line.trim().length > 0);
  assert.ok(rawLines.length > 0, `expected at least one lifecycle line at ${filePath}`);
  return rawLines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(`lifecycle line ${index} did not parse as JSON: ${line}\n${err}`);
    }
  });
}

/** Every scenario in this file writes a `watchdog_started` first line carrying the EFFECTIVE
 * stale window the watchdog actually read — checkable against its own record rather than against
 * whatever exported the variable (plan 03-20's H1a). Shared across Tests 1, 3 and 4. */
function assertWatchdogStartedFirstLine(lines) {
  assert.equal(lines[0].event, "watchdog_started");
  assert.equal(typeof lines[0].stale_ms, "number");
  assert.ok(
    lines[0].stale_ms_source === "env" || lines[0].stale_ms_source === "default",
    `stale_ms_source must be exactly "env" or "default", got: ${JSON.stringify(lines[0].stale_ms_source)}`,
  );
}

/** Poll for `<runtimeDir>/runs/<runId>.json` (PROC-03's run descriptor) and return its `pid` —
 * the watchdog wrapper's own pid, used only as a teardown safety net for the stubborn scenarios
 * below, mirroring `watchdog.test.mjs`'s own tracked-pid precedent. */
async function waitForWrapperPid(runtimeDir, runId) {
  const descriptorPath = path.join(runtimeDir, "runs", `${runId}.json`);
  await waitForCondition(() => fs.existsSync(descriptorPath), {
    message: "the run descriptor never appeared on disk",
  });
  return JSON.parse(fs.readFileSync(descriptorPath, "utf8")).pid;
}

/** List the permission-server socket files currently on disk under `/tmp`, matching
 * `mcp-permission-server.ts::socketBaseDir`'s own preferred directory and
 * `startPermissionServer`'s own `flywheel-permission-<uuid>.sock` naming exactly — used by Tests 8
 * and 9 (plan 03-21) to detect a session's own socket without needing an internal accessor onto
 * `ClaudeCodeAdapter`'s private `LiveSession.permissionServer`, which this suite deliberately does
 * not add (out of this task's declared `<files>`). Falls back to an empty set, never throws, if
 * `/tmp` itself is unreadable — mirrors this file's own `resolveCloseOrigin`-adjacent discipline of
 * never letting a diagnostic read crash the test that depends on it. */
function listPermissionSockets() {
  try {
    return new Set(
      fs.readdirSync("/tmp").filter((name) => name.startsWith("flywheel-permission-") && name.endsWith(".sock")),
    );
  } catch {
    return new Set();
  }
}

/** The permission socket names on the argv of `wrapperPid`'s direct children — the backend the
 * watchdog spawned receives its socket path inside `--mcp-config`. Other test files running in
 * parallel open their own sockets under the same shared `/tmp`, so a before/after directory diff
 * alone can attribute a concurrent file's socket to this session; filtering the diff by this
 * session's own process tree cannot. */
function sessionSocketNames(wrapperPid) {
  const ps = spawnSync("ps", ["-A", "-o", "ppid=,args="], { encoding: "utf8" });
  const names = new Set();
  for (const line of (ps.stdout ?? "").split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match || Number(match[1]) !== wrapperPid) continue;
    for (const name of match[2].match(/flywheel-permission-[0-9a-f-]+\.sock/g) ?? []) names.add(name);
  }
  return names;
}

/** Every wrapper pid a stubborn scenario in this file has spawned — force-killed by group in
 * `after()` regardless of test outcome. In practice each stubborn scenario below already ends by
 * the whole group being signalled (a stale-kill SIGKILL or an explicit `killSession`), so this is
 * a backstop against a failed assertion leaving a session running, not the primary teardown. */
const trackedWrapperPids = [];

after(() => {
  for (const pid of trackedWrapperPids) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch {
      // Already gone — nothing to clean up.
    }
  }
});

/** The three origins Tests 1, 3 and 4 observe, filled in as each runs — `node:test` runs this
 * file's top-level tests sequentially by default, so Test 5 can read them back without
 * re-inducing any of the three endings itself. */
const observedOrigins = {};

test("watchdog-initiated: a stale heartbeat kills the session, reporting closeOrigin watchdog-heartbeat-stale, exitSignal SIGKILL, exitCode null", async () => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "cp-watchdog-stale";
  const events = [];

  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  try {
    const adapter = new ClaudeCodeAdapter();
    // Heartbeat file deliberately never written — the watchdog must notice this entirely on its
    // own, once one full stale window has elapsed since ITS OWN start.
    const startPromise = startFakeSession(adapter, runId, events, {
      FLYWHEEL_FAKE_STUBBORN: "1",
      FLYWHEEL_RUNTIME_DIR: runtimeDir,
      FLYWHEEL_HEARTBEAT_STALE_MS: "1500",
      FLYWHEEL_HEARTBEAT_POLL_MS: "200",
    });
    trackedWrapperPids.push(await waitForWrapperPid(runtimeDir, runId));

    await withTimeout(startPromise, 8000, "the stale-heartbeat session did not close in time");

    const closed = events.find((e) => e.type === "session_closed");
    assert.ok(closed, "expected a session_closed event");
    assert.equal(closed.reason, "failed");
    assert.equal(closed.closeOrigin, "watchdog-heartbeat-stale");
    assert.equal(closed.exitSignal, "SIGKILL");
    assert.equal(closed.exitCode, null);
    observedOrigins.watchdogStale = closed.closeOrigin;

    const lines = readLifecycleLines(runtimeDir, runId);
    assertWatchdogStartedFirstLine(lines);
    assert.equal(lines[0].stale_ms, 1500);
    assert.equal(lines[0].stale_ms_source, "env");
  } finally {
    delete process.env.FLYWHEEL_RUNTIME_DIR;
  }
});

test("the watchdog_started lifecycle line records the default stale window and its source when no override is supplied", async () => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "cp-default-stale-window";
  const events = [];

  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  try {
    const adapter = new ClaudeCodeAdapter();
    // The default (non-stubborn) fake CLI exits on its own after ~50ms — no override supplied,
    // and no need to wait out a real 15-second stale window just to read the FIRST lifecycle line.
    await withTimeout(
      startFakeSession(adapter, runId, events, { FLYWHEEL_RUNTIME_DIR: runtimeDir }),
      8000,
      "the default-stale-window session did not close in time",
    );

    const lines = readLifecycleLines(runtimeDir, runId);
    assertWatchdogStartedFirstLine(lines);
    assert.equal(lines[0].stale_ms, 15000);
    assert.equal(lines[0].stale_ms_source, "default");
  } finally {
    delete process.env.FLYWHEEL_RUNTIME_DIR;
  }
});

test("backend-initiated: a self-exiting backend produces closeOrigin backend-exit with a numeric exitCode and null exitSignal", async () => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "cp-backend-exit";
  const events = [];

  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  try {
    const adapter = new ClaudeCodeAdapter();
    // A stale window far larger than this session's own lifetime, so the watchdog cannot be the
    // cause — the default (non-stubborn) fake CLI exits on its own after ~50ms.
    await withTimeout(
      startFakeSession(adapter, runId, events, {
        FLYWHEEL_RUNTIME_DIR: runtimeDir,
        FLYWHEEL_HEARTBEAT_STALE_MS: "60000",
      }),
      8000,
      "the backend-exit session did not close in time",
    );

    const closed = events.find((e) => e.type === "session_closed");
    assert.ok(closed, "expected a session_closed event");
    assert.equal(closed.closeOrigin, "backend-exit");
    assert.equal(typeof closed.exitCode, "number");
    assert.equal(closed.exitSignal, null);
    observedOrigins.backendExit = closed.closeOrigin;

    const lines = readLifecycleLines(runtimeDir, runId);
    assertWatchdogStartedFirstLine(lines);
    assert.equal(lines[lines.length - 1].event, "backend_exit");
  } finally {
    delete process.env.FLYWHEEL_RUNTIME_DIR;
  }
});

test("supervisor-initiated: killSession produces reason interrupted and closeOrigin supervisor-signal", async () => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "cp-supervisor-kill";
  const events = [];

  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  try {
    const adapter = new ClaudeCodeAdapter();
    const startPromise = startFakeSession(adapter, runId, events, {
      FLYWHEEL_FAKE_STUBBORN: "1",
      FLYWHEEL_RUNTIME_DIR: runtimeDir,
      FLYWHEEL_HEARTBEAT_STALE_MS: "60000",
    });
    trackedWrapperPids.push(await waitForWrapperPid(runtimeDir, runId));

    // "once the first event has arrived" (the plan's own behaviour wording).
    await waitForCondition(() => events.length > 0);

    await withTimeout(adapter.killSession(runId), 8000, "killSession did not resolve in time");
    await withTimeout(startPromise, 8000, "the supervisor-killed session did not close in time");

    const closed = events.find((e) => e.type === "session_closed");
    assert.ok(closed, "expected a session_closed event");
    assert.equal(closed.reason, "interrupted");
    assert.equal(closed.closeOrigin, "supervisor-signal");
    observedOrigins.supervisorSignal = closed.closeOrigin;

    const lines = readLifecycleLines(runtimeDir, runId);
    assertWatchdogStartedFirstLine(lines);
  } finally {
    delete process.env.FLYWHEEL_RUNTIME_DIR;
  }
});

test("the instrument discriminates: the three origins observed above are three distinct strings, and none is unattributed", () => {
  const origins = [observedOrigins.watchdogStale, observedOrigins.backendExit, observedOrigins.supervisorSignal];
  for (const origin of origins) {
    assert.ok(typeof origin === "string" && origin.length > 0, "every prior test must have recorded an origin");
    assert.notEqual(origin, "unattributed", `origin must not be unattributed: ${origin}`);
  }
  assert.equal(new Set(origins).size, 3, `expected three DISTINCT origins, got: ${JSON.stringify(origins)}`);
});

test("resolveCloseOrigin never throws on missing evidence: a non-existent runtime directory, and a lifecycle file with an unparseable line", () => {
  const missingDirOrigin = resolveCloseOrigin({
    interruptionRequested: false,
    runtimeDir: path.join(os.tmpdir(), "flywheel-close-provenance-does-not-exist"),
    runId: "no-such-run",
  });
  assert.equal(missingDirOrigin, "unattributed");

  const runtimeDir = scratchRuntimeDir();
  const runId = "cp-unparseable-lifecycle-line";
  const lifecycleFile = path.join(runtimeDir, "lifecycle", `${runId}.jsonl`);
  fs.mkdirSync(path.dirname(lifecycleFile), { recursive: true });
  fs.writeFileSync(lifecycleFile, "this is not JSON\n");

  const unparseableOrigin = resolveCloseOrigin({
    interruptionRequested: false,
    runtimeDir,
    runId,
  });
  assert.equal(unparseableOrigin, "unattributed");
});

// ---- PROC-04 regression guard (plan 03-21): a pending permission question buys no extra life ---
//
// The `deferred-items.md` entry for `permission.test.mjs` (5 of 7 tests, real MCP round trip via
// `FLYWHEEL_FAKE_CALL_PERMISSION`) records a grandchild-process/stdio-transport sandbox constraint
// in THIS execution environment. Per this task's own instruction, that history is reused as a
// technique, not assumed as an outcome: Tests 7 and 8 below attempt the exact same
// `ClaudeCodeAdapter.startSession` + `FLYWHEEL_FAKE_CALL_PERMISSION` mechanism `permission.test.mjs`
// uses (the only way to raise a genuinely held request ON a real, watchdog-supervised session), and
// only fall back to a named skip if that mechanism itself is what does not work here — never a
// silent weakening of the assertion.

test("a pending permission request does not extend the watchdog's stale window", async (t) => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "cp-pending-request-stale-kill";
  const events = [];

  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  try {
    const adapter = new ClaudeCodeAdapter();
    // Heartbeat file deliberately never written, same as the no-request stale-kill scenario above
    // — the only addition here is a genuinely held, deliberately unanswered permission_request.
    const startPromise = startFakeSession(adapter, runId, events, {
      FLYWHEEL_FAKE_CALL_PERMISSION: "1",
      FLYWHEEL_RUNTIME_DIR: runtimeDir,
      FLYWHEEL_HEARTBEAT_STALE_MS: "1500",
      FLYWHEEL_HEARTBEAT_POLL_MS: "200",
    });
    trackedWrapperPids.push(await waitForWrapperPid(runtimeDir, runId));

    try {
      await waitForCondition(() => events.some((e) => e.type === "permission_request"), { timeoutMs: 5000 });
    } catch (err) {
      t.skip(
        "the real MCP round trip (FLYWHEEL_FAKE_CALL_PERMISSION) did not raise a permission_request " +
          "in this execution environment — see deferred-items.md's permission.test.mjs entry " +
          `(grandchild-process/stdio-transport sandbox constraint). Underlying error: ${err}`,
      );
      return;
    }
    // Deliberately never answered — the whole point of this test.

    await withTimeout(startPromise, 8000, "the pending-permission stale-heartbeat session did not close in time");

    const closed = events.find((e) => e.type === "session_closed");
    assert.ok(closed, "expected a session_closed event");
    assert.equal(closed.closeOrigin, "watchdog-heartbeat-stale");
    assert.equal(closed.exitSignal, "SIGKILL");
    assert.equal(closed.exitCode, null);

    const lines = readLifecycleLines(runtimeDir, runId);
    assertWatchdogStartedFirstLine(lines);
    assert.equal(lines[0].stale_ms, 1500);
  } finally {
    delete process.env.FLYWHEEL_RUNTIME_DIR;
  }
});

test("exactly one session_closed event, and the permission socket is removed, when a session ends with a request pending", async (t) => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "cp-pending-request-closes-once";
  const events = [];
  const socketsBefore = listPermissionSockets();

  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  try {
    const adapter = new ClaudeCodeAdapter();
    // A stale window far larger than this test's own lifetime — the supervisor's own killSession
    // call below must be what ends this session, not the watchdog.
    const startPromise = startFakeSession(adapter, runId, events, {
      FLYWHEEL_FAKE_CALL_PERMISSION: "1",
      FLYWHEEL_RUNTIME_DIR: runtimeDir,
      FLYWHEEL_HEARTBEAT_STALE_MS: "60000",
    });
    const wrapperPid = await waitForWrapperPid(runtimeDir, runId);
    trackedWrapperPids.push(wrapperPid);

    try {
      await waitForCondition(() => events.some((e) => e.type === "permission_request"), { timeoutMs: 5000 });
    } catch (err) {
      t.skip(
        "the real MCP round trip (FLYWHEEL_FAKE_CALL_PERMISSION) did not raise a permission_request " +
          "in this execution environment — see deferred-items.md's permission.test.mjs entry " +
          `(grandchild-process/stdio-transport sandbox constraint). Underlying error: ${err}`,
      );
      return;
    }

    const ownSockets = sessionSocketNames(wrapperPid);
    const newSockets = [...listPermissionSockets()].filter(
      (name) => !socketsBefore.has(name) && ownSockets.has(name),
    );
    assert.equal(
      newSockets.length,
      1,
      `expected exactly one new permission socket while the request is pending, got: ${JSON.stringify(newSockets)}`,
    );
    const socketPath = path.join("/tmp", newSockets[0]);
    assert.ok(fs.existsSync(socketPath), "the socket file must exist while the request is pending");

    // End the session via the supervisor WHILE the request is still unanswered — never resolved.
    await withTimeout(adapter.killSession(runId), 8000, "killSession did not resolve in time");
    await withTimeout(startPromise, 8000, "the session did not close in time after killSession");

    const closedEvents = events.filter((e) => e.type === "session_closed");
    assert.equal(closedEvents.length, 1, "exactly one session_closed event must be observed for the run");
    assert.equal(closedEvents[0].closeOrigin, "supervisor-signal");
    assert.ok(
      !fs.existsSync(socketPath),
      "the permission server's socket path must not exist on disk after the session closes",
    );
  } finally {
    delete process.env.FLYWHEEL_RUNTIME_DIR;
  }
});

test("answering a requestId twice settles it once — the AGNT-07 idempotency edge", async () => {
  // Deliberately bypasses ClaudeCodeAdapter/fake-claude entirely and connects a raw socket to the
  // handle's own socketPath, per this task's own sanctioned alternative ("the point of these tests
  // is the lifecycle around a held request, not the shim's own wire format") — this exercises
  // exactly the same `PermissionServerHandle.resolvePermission` idempotency
  // `ClaudeCodeAdapter.resolvePermission` delegates to, with no dependency on any backend spawn.
  const requests = [];
  const handle = startPermissionServer(
    (payload) => requests.push(payload),
    () => {},
  );
  try {
    const client = net.createConnection(handle.socketPath);
    await new Promise((resolve, reject) => {
      client.once("connect", resolve);
      client.once("error", reject);
    });
    const answers = [];
    createInterface({ input: client }).on("line", (line) => answers.push(JSON.parse(line)));

    client.write(JSON.stringify({ requestId: "cp-idempotency-req", toolName: "Bash", input: { command: "echo hi" } }) + "\n");
    await waitForCondition(() => requests.length === 1);
    assert.equal(requests[0].requestId, "cp-idempotency-req");

    handle.resolvePermission("cp-idempotency-req", "allow");
    await waitForCondition(() => answers.length === 1);
    assert.deepEqual(answers[0], { decision: "allow" });

    // Resolve the SAME requestId again — must settle nothing else: no throw, no second answer.
    handle.resolvePermission("cp-idempotency-req", "deny");
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(
      answers.length,
      1,
      "a second resolvePermission call for an already-answered requestId must produce no second answer",
    );
  } finally {
    handle.close();
  }
});
