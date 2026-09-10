/**
 * AGNT-06 — a gated tool call genuinely halts the agent, and the only thing that can unhalt it is
 * a decision relayed from the Rust core (here, `ClaudeCodeAdapter.resolvePermission`, standing in
 * for `index.ts`'s `permission_answer` op). Every case runs against the REAL spawned
 * `fake-claude.mjs` playing the backend's own role in the round trip (spawning the real MCP
 * server via `@modelcontextprotocol/sdk`'s client, exactly as the documented `--mcp-config`
 * mechanism works) — never a mock of `child_process` or of the MCP protocol.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { buildClaudeArgv, ClaudeCodeAdapter, STOP_GRACE_MS } from "../dist/claude-code-adapter.js";
import { PERMISSION_TOOL_NAME } from "../dist/mcp-permission-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;

// Safety net: a test that fails an assertion before answering a held call would otherwise leave
// fake-claude.mjs (and the grandchild MCP server process it spawned) running forever, hanging
// this file's own process. Runs once, after every test has settled; a no-op when nothing is left.
after(() => {
  for (const pattern of [FAKE_CLAUDE, "mcp-permission-server\\.js"]) {
    try {
      execSync(`pkill -f ${JSON.stringify(pattern)}`, { stdio: "ignore" });
    } catch {
      // pkill exits non-zero when nothing matched — nothing to clean up.
    }
  }
});

/** Poll `predicate` until it's true or `timeoutMs` elapses. */
async function waitForCondition(predicate, { timeoutMs = 4000, intervalMs = 10 } = {}) {
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

function startFakeSession(adapter, runId, events, extraEnv = {}) {
  return adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "do the gated thing",
    permissionMode: "acceptEdits",
    env: extraEnv,
    onEvent: (event) => events.push(event),
  });
}

function permissionRequestEvents(events) {
  return events.filter((e) => e.type === "permission_request");
}

function toolResultFor(events, label) {
  return events
    .filter((e) => e.type === "unknown")
    .map((e) => {
      try {
        return JSON.parse(e.raw);
      } catch {
        return undefined;
      }
    })
    .find((parsed) => parsed?.type === "permission_tool_result" && parsed.label === label);
}

test("buildClaudeArgv appends the permission-prompt tool name and an MCP config naming exactly one server", () => {
  const argv = buildClaudeArgv({
    prompt: "<prompt>",
    permissionMode: "acceptEdits",
    permissionPromptToolName: PERMISSION_TOOL_NAME,
    mcpConfig: JSON.stringify({ mcpServers: { "flywheel-permissions": { command: "node", args: ["x.js"] } } }),
  });

  assert.ok(argv.includes("--permission-prompt-tool"));
  assert.equal(argv[argv.indexOf("--permission-prompt-tool") + 1], PERMISSION_TOOL_NAME);

  assert.ok(argv.includes("--mcp-config"));
  const mcpConfig = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]);
  assert.equal(Object.keys(mcpConfig.mcpServers).length, 1, "the config must name exactly one server");
});

test("buildClaudeArgv omits both permission flags when neither is supplied (backward compatible)", () => {
  const argv = buildClaudeArgv({ prompt: "<prompt>", permissionMode: "acceptEdits" });
  assert.ok(!argv.includes("--permission-prompt-tool"));
  assert.ok(!argv.includes("--mcp-config"));
});

test("a gated tool call raises a permission_request event and does not resolve until answered", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "perm-run-allow";

  const sessionPromise = startFakeSession(adapter, runId, events, { FLYWHEEL_FAKE_CALL_PERMISSION: "1" });

  await waitForCondition(() => permissionRequestEvents(events).length === 1);
  const request = permissionRequestEvents(events)[0];
  assert.equal(request.toolName, "Bash");
  assert.deepEqual(request.input, { command: "echo first" });

  // Not yet answered — the fake backend's own tool-call result must not have arrived.
  assert.equal(toolResultFor(events, "first"), undefined);

  adapter.resolvePermission(runId, request.requestId, "allow");

  await waitForCondition(() => toolResultFor(events, "first") !== undefined);
  assert.equal(toolResultFor(events, "first").behavior, "allow");

  await withTimeout(sessionPromise, 5000, "session did not close after being allowed");
  const closed = events.find((e) => e.type === "session_closed");
  assert.equal(closed.reason, "completed");
});

test("a denying answer resolves as denied and the fake backend records a denial rather than proceeding", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "perm-run-deny";

  const sessionPromise = startFakeSession(adapter, runId, events, { FLYWHEEL_FAKE_CALL_PERMISSION: "1" });

  await waitForCondition(() => permissionRequestEvents(events).length === 1);
  const request = permissionRequestEvents(events)[0];

  adapter.resolvePermission(runId, request.requestId, "deny");

  await waitForCondition(() => toolResultFor(events, "first") !== undefined);
  assert.equal(toolResultFor(events, "first").behavior, "deny", "a denied call must record a denial, not proceed");

  await withTimeout(sessionPromise, 5000, "session did not close after being denied");
});

test("an answer whose request id matches no held call is ignored and resolves nothing else", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "perm-run-unknown-id";

  const sessionPromise = startFakeSession(adapter, runId, events, { FLYWHEEL_FAKE_CALL_PERMISSION: "1" });

  await waitForCondition(() => permissionRequestEvents(events).length === 1);
  const request = permissionRequestEvents(events)[0];

  // A bogus requestId must be a silent no-op — the real held call stays held.
  adapter.resolvePermission(runId, "not-a-real-request-id", "allow");

  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(toolResultFor(events, "first"), undefined, "the real held call must still be unresolved");

  // Clean up: answer the real one so the session can close.
  adapter.resolvePermission(runId, request.requestId, "allow");
  await withTimeout(sessionPromise, 5000, "session did not close after the real answer");
});

test("two concurrent held calls resolve independently and in the order their answers arrive, not the order raised", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "perm-run-concurrent";

  const sessionPromise = startFakeSession(adapter, runId, events, { FLYWHEEL_FAKE_CALL_PERMISSION: "2" });

  await waitForCondition(() => permissionRequestEvents(events).length === 2);
  const requests = permissionRequestEvents(events);
  assert.notEqual(requests[0].requestId, requests[1].requestId);

  // Identify each held call by its OWN input (not by arrival order into `events`, which the two
  // concurrent socket connections do not guarantee matches fake-claude's own "first"/"second"
  // labels) — the "second" call is the one whose command echoes "second".
  const secondRequest = requests.find((r) => r.input.command === "echo second");
  const firstRequest = requests.find((r) => r.input.command === "echo first");
  assert.ok(secondRequest && firstRequest, "both concurrent calls must have been raised");

  // Answer the SECOND-raised call FIRST, with a decision distinct from the first's — proving
  // resolution order tracks the answer order, not the raise order.
  adapter.resolvePermission(runId, secondRequest.requestId, "deny");
  await waitForCondition(() => toolResultFor(events, "second") !== undefined);
  assert.equal(toolResultFor(events, "second").behavior, "deny");
  // The first-raised call must still be unresolved at this point.
  assert.equal(toolResultFor(events, "first"), undefined);

  adapter.resolvePermission(runId, firstRequest.requestId, "allow");
  await waitForCondition(() => toolResultFor(events, "first") !== undefined);
  assert.equal(toolResultFor(events, "first").behavior, "allow");

  await withTimeout(sessionPromise, 5000, "session did not close after both calls resolved");
});

test(
  "the permission server never resolves a call from its own state",
  { timeout: STOP_GRACE_MS * 5 + 10_000 },
  async () => {
    const adapter = new ClaudeCodeAdapter();
    const events = [];
    const runId = "perm-run-never-self-resolves";

    const sessionPromise = startFakeSession(adapter, runId, events, { FLYWHEEL_FAKE_CALL_PERMISSION: "1" });

    await waitForCondition(() => permissionRequestEvents(events).length === 1);
    const request = permissionRequestEvents(events)[0];

    // No answer relayed — wait at least five times the stop grace period and assert the call is
    // STILL held, proving the server has no timer of its own.
    await new Promise((resolve) => setTimeout(resolve, STOP_GRACE_MS * 5));
    assert.equal(
      toolResultFor(events, "first"),
      undefined,
      "the held call must still be unresolved after five times the grace period — no self-timeout",
    );
    assert.equal(
      events.find((e) => e.type === "session_closed"),
      undefined,
      "the session itself must not have closed on its own either",
    );

    // Clean up: answer it so this test doesn't leak a hung process into the suite.
    adapter.resolvePermission(runId, request.requestId, "allow");
    await withTimeout(sessionPromise, 5000, "session did not close after the cleanup answer");
  },
);

test("no credential value appears in any permission_request event this suite observed", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "perm-run-no-credential-leak";

  const sessionPromise = startFakeSession(adapter, runId, events, {
    FLYWHEEL_FAKE_CALL_PERMISSION: "1",
    ANTHROPIC_API_KEY: "sk-ant-should-never-appear-anywhere",
  });

  await waitForCondition(() => permissionRequestEvents(events).length === 1);
  const request = permissionRequestEvents(events)[0];
  for (const event of events) {
    const serialised = JSON.stringify(event);
    assert.ok(!/sk-ant-/.test(serialised), `event leaked a credential-shaped string: ${serialised}`);
  }

  adapter.resolvePermission(runId, request.requestId, "allow");
  await withTimeout(sessionPromise, 5000, "session did not close");
});
