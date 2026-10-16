/**
 * Plan 09-08 (PLAN-01, D-147, D-149) — proves the `submit_plan` write surface at the wire level.
 *
 * `submit_plan` is a HELD call: the planning agent's tool call blocks until the Rust core answers,
 * so a mechanical error (a glob, an unknown task key) comes back to the agent in the same call,
 * where it can correct it, instead of being stored for the user to find. A held call whose callback
 * is not wired waits forever — the bug plan 06-09 already shipped once for `propose_item` — and only
 * a test through the real socket, driven by a real spawned backend stand-in, catches that.
 *
 * Authority is NOT tested here. The server lists `submit_plan` to every run, so visibility is not a
 * control; the Rust core refuses a call from anything that is not a running planning run
 * (`packages/core/tests/dispatch_plan.rs`).
 *
 * Imports are by namespace so a missing export fails an assertion, not module linking.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import * as adapterModule from "../dist/claude-code-adapter.js";
import * as server from "../dist/mcp-permission-server.js";

const { buildClaudeArgv, ClaudeCodeAdapter } = adapterModule;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");
process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;

// A test that fails before answering a held call would leave its fake backend running and hang this
// file's process. Kill only the sessions THIS file started: node runs test files in parallel, and a
// blanket `pkill` would take down another file's fake backend mid-test.
const started = [];
after(async () => {
  for (const { adapter, runId } of started) {
    await adapter.killSession(runId).catch(() => {});
  }
});

const SUBMISSION = {
  tasks: [
    { key: "FLY-1", files: ["src/a.rs", "docs/"], wave: 1, rationale: "touches the parser" },
    { key: "FLY-2", files: ["src/b.rs"], wave: 2, rationale: "builds on FLY-1" },
  ],
  excluded: [{ key: "FLY-3", reason: "already done by FLY-1" }],
};

async function waitForCondition(predicate, { timeoutMs = 5000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitForCondition timed out");
}

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function startPlanningSession(adapter, runId, events, submission = SUBMISSION) {
  started.push({ adapter, runId });
  return adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "plan the epic",
    permissionMode: "default",
    planning: true,
    env: { FLYWHEEL_FAKE_SUBMIT_PLAN: JSON.stringify(submission) },
    onEvent: (event) => events.push(event),
  });
}

function fakeLine(events, type) {
  return events
    .filter((e) => e.type === "unknown")
    .map((e) => {
      try {
        return JSON.parse(e.raw);
      } catch {
        return undefined;
      }
    })
    .find((parsed) => parsed?.type === type);
}

test("the submit_plan tool is registered with a schema that names tasks, files, waves and exclusions and no board id", () => {
  assert.equal(server.SUBMIT_PLAN_TOOL_NAME, "mcp__flywheel-permissions__submit_plan");
  const def = server.submitPlanToolDefinition;
  assert.ok(def, "submitPlanToolDefinition is exported");
  assert.equal(def.name, "submit_plan");
  assert.deepEqual(def.inputSchema.required, ["tasks"]);
  assert.deepEqual(def.inputSchema.properties.tasks.items.required, ["key", "files", "wave", "rationale"]);
  assert.deepEqual(def.inputSchema.properties.excluded.items.required, ["key", "reason"]);
  const serialised = JSON.stringify(def.inputSchema);
  assert.ok(!/"run_?id"|"project_?id"|"epic_?id"|"plan_?id"/i.test(serialised), serialised);
});

test("the wire payload carries the submission and no run, project, epic or plan id", () => {
  const payload = server.buildSubmitPlanPayload(SUBMISSION);
  assert.equal(payload.kind, "submit_plan");
  // `undeclared` is always on the wire and defaults to false.
  assert.deepEqual(payload.tasks, SUBMISSION.tasks.map((t) => ({ ...t, undeclared: false })));
  assert.deepEqual(payload.excluded, SUBMISSION.excluded);
  assert.ok(!/"runId"|"projectId"|"epicId"|"planId"/.test(JSON.stringify(payload)));
});

test("undeclared passes through on a task, is described to the model, and must be a boolean", () => {
  const payload = server.buildSubmitPlanPayload({
    tasks: [{ key: "FLY-1", files: [], wave: 1, rationale: "cannot tell", undeclared: true }],
  });
  assert.equal(payload.tasks[0].undeclared, true);
  assert.deepEqual(payload.tasks[0].files, []);
  const def = server.submitPlanToolDefinition;
  assert.equal(def.inputSchema.properties.tasks.items.properties.undeclared.type, "boolean");
  assert.match(def.description, /undeclared/);
  assert.match(def.description, /invented file set is worse than none/);
  assert.throws(
    () => server.buildSubmitPlanPayload({ tasks: [{ key: "FLY-1", files: [], wave: 1, undeclared: "yes" }] }),
    /undeclared/,
  );
});

test("a malformed submission throws before any socket write", () => {
  assert.throws(() => server.buildSubmitPlanPayload({}), /tasks/);
  assert.throws(() => server.buildSubmitPlanPayload({ tasks: "nope" }), /tasks/);
  assert.throws(() => server.buildSubmitPlanPayload({ tasks: [{ key: "FLY-1", files: "a.rs", wave: 1 }] }), /files/);
  assert.throws(() => server.buildSubmitPlanPayload({ tasks: [{ key: "FLY-1", files: ["a"], wave: 1.5 }] }), /wave/);
  assert.throws(() => server.buildSubmitPlanPayload({ tasks: [{ files: ["a"], wave: 1 }] }), /key/);
});

test("a planning launch pre-approves the submit tool and nothing else", () => {
  const argv = buildClaudeArgv({
    prompt: "plan",
    permissionMode: "default",
    permissionPromptToolName: "mcp__flywheel-permissions__approve_action",
    mcpConfig: "{}",
    submitPlanToolName: server.SUBMIT_PLAN_TOOL_NAME,
  });
  const allowed = argv.flatMap((value, i) => (value === "--allowedTools" ? [argv[i + 1]] : []));
  assert.deepEqual(allowed, [server.SUBMIT_PLAN_TOOL_NAME]);
});

test(
  "a held submit_plan call reaches the Rust-side callback and is answered, success path",
  { timeout: 20_000 },
  async () => {
    const adapter = new ClaudeCodeAdapter();
    const events = [];
    const runId = "plan-run-ok";
    const session = startPlanningSession(adapter, runId, events);

    await waitForCondition(() => events.some((e) => e.type === "plan_submitted"));
    const submitted = events.find((e) => e.type === "plan_submitted");
    assert.equal(submitted.runId, runId, "identity comes from the session, never the model");
    assert.equal(typeof submitted.requestId, "string");
    assert.deepEqual(submitted.tasks, SUBMISSION.tasks.map((t) => ({ ...t, undeclared: false })));
    assert.deepEqual(submitted.excluded, SUBMISSION.excluded);

    // Not answered yet: the agent's call must still be waiting.
    assert.equal(fakeLine(events, "submit_plan_result"), undefined);

    adapter.resolveProposalStaged(runId, submitted.requestId, { planId: "01PLANIDAAAAAAAAAAAAAAAAAA" });

    await waitForCondition(() => fakeLine(events, "submit_plan_result") !== undefined);
    const result = fakeLine(events, "submit_plan_result");
    assert.equal(result.isError, false);
    assert.match(result.text, /01PLANIDAAAAAAAAAAAAAAAAAA/);

    // Only the submit tool was pre-approved on this launch.
    assert.deepEqual(fakeLine(events, "allowed_tools").tools, [server.SUBMIT_PLAN_TOOL_NAME]);

    await withTimeout(session, 5000, "the planning session did not close after the answer");
  },
);

test(
  "a refusal comes back to the agent as a correctable error result in the same call",
  { timeout: 20_000 },
  async () => {
    const adapter = new ClaudeCodeAdapter();
    const events = [];
    const runId = "plan-run-refused";
    const session = startPlanningSession(adapter, runId, events);

    await waitForCondition(() => events.some((e) => e.type === "plan_submitted"));
    const submitted = events.find((e) => e.type === "plan_submitted");
    adapter.resolveProposalStaged(
      runId,
      submitted.requestId,
      undefined,
      'task FLY-2: the file-set entry "src/*.rs" was refused: the glob character `*` is not allowed',
    );

    await waitForCondition(() => fakeLine(events, "submit_plan_result") !== undefined);
    const result = fakeLine(events, "submit_plan_result");
    assert.equal(result.isError, true, "a refusal is an error RESULT the agent can read, not a protocol failure");
    assert.match(result.text, /FLY-2/);
    assert.match(result.text, /glob character/);

    await withTimeout(session, 5000, "the planning session did not close after the refusal");
  },
);
