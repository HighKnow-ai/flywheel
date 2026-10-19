/**
 * Issue #52 — the Story agent's Task board tool. The MCP server the backend spawns lists
 * `task_list` / `task_add` / `task_update`, and each call is relayed over the run's socket to the
 * sidecar, raised upstream as a `task_tool_request` event and held until the Rust core answers
 * (`ClaudeCodeAdapter.resolveTaskTool`, standing in for `index.ts`'s `task_tool_answer` op). The
 * sidecar decides nothing and never opens the database: the answer is whatever the core sends.
 *
 * Runs against the REAL spawned `fake-claude.mjs`, which spawns the real MCP server through the
 * SDK client exactly as the backend does from `--mcp-config`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { buildClaudeArgv, ClaudeCodeAdapter } from "../dist/claude-code-adapter.js";
import { TASK_TOOL_NAMES, TASK_TOOL_QUALIFIED_NAMES, MCP_SERVER_NAME } from "../dist/mcp-permission-server.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
process.env.FLYWHEEL_CLAUDE_BIN = path.join(__dirname, "fake-claude.mjs");

function descendantsOf(pid) {
  let kids = [];
  try {
    kids = execSync(`pgrep -P ${pid}`, { encoding: "utf8" }).split("\n").filter(Boolean).map(Number);
  } catch {
    // No children.
  }
  return kids.flatMap((kid) => [kid, ...descendantsOf(kid)]);
}

after(() => {
  for (const pid of descendantsOf(process.pid)) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
});

async function waitForCondition(predicate, { timeoutMs = 4000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("waitForCondition timed out");
}

function unknownLines(events, type) {
  return events
    .filter((e) => e.type === "unknown")
    .map((e) => {
      try {
        return JSON.parse(e.raw);
      } catch {
        return undefined;
      }
    })
    .filter((parsed) => parsed?.type === type);
}

function startWithTaskCall(adapter, runId, events, toolCall) {
  return adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "keep your checklist",
    permissionMode: "acceptEdits",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify(toolCall) },
    onEvent: (event) => events.push(event),
  });
}

test("the three Task tools are named once, on the session's one MCP server", () => {
  assert.deepEqual([...TASK_TOOL_NAMES], ["task_list", "task_add", "task_update"]);
  assert.deepEqual(
    [...TASK_TOOL_QUALIFIED_NAMES],
    TASK_TOOL_NAMES.map((name) => `mcp__${MCP_SERVER_NAME}__${name}`),
  );
});

test("buildClaudeArgv pre-approves the Task tools so a checklist write never waits on a permission card", () => {
  const argv = buildClaudeArgv({
    prompt: "<prompt>",
    permissionMode: "acceptEdits",
    allowedTools: [...TASK_TOOL_QUALIFIED_NAMES],
  });
  const at = argv.indexOf("--allowedTools");
  assert.notEqual(at, -1);
  assert.equal(argv[at + 1], TASK_TOOL_QUALIFIED_NAMES.join(","));
  assert.ok(!buildClaudeArgv({ prompt: "<prompt>", permissionMode: "acceptEdits" }).includes("--allowedTools"));
});

test("a Task tool call is held until the core answers, and the agent receives the core's checklist", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "task-tool-run-ok";
  const session = startWithTaskCall(adapter, runId, events, {
    name: "task_add",
    arguments: { titles: ["Write the failing test"] },
  });

  await waitForCondition(() => events.some((e) => e.type === "task_tool_request"));
  const request = events.find((e) => e.type === "task_tool_request");
  assert.equal(request.tool, "task_add");
  assert.deepEqual(request.args, { titles: ["Write the failing test"] });
  assert.equal(typeof request.requestId, "string");

  // The tool lists all three names to the backend.
  await waitForCondition(() => unknownLines(events, "task_tools_listed").length === 1);
  assert.deepEqual(unknownLines(events, "task_tools_listed")[0].names, ["approve_action", ...TASK_TOOL_NAMES]);

  // Not answered yet: the agent has received nothing.
  assert.equal(unknownLines(events, "task_tool_result").length, 0);

  const checklist = { tasks: [{ task_id: "t1", title: "Write the failing test", state: "open" }] };
  adapter.resolveTaskTool(runId, request.requestId, checklist);

  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  const result = unknownLines(events, "task_tool_result")[0];
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.text), checklist);
  await session;
});

test("a refusal from the core reaches the agent as a tool error carrying the core's reason", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "task-tool-run-refused";
  const session = startWithTaskCall(adapter, runId, events, {
    name: "task_update",
    arguments: { task_id: "t2", state: "doing" },
  });

  await waitForCondition(() => events.some((e) => e.type === "task_tool_request"));
  const request = events.find((e) => e.type === "task_tool_request");
  adapter.resolveTaskTool(runId, request.requestId, undefined, "another Task of this Story is already doing; at most one is");

  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  const result = unknownLines(events, "task_tool_result")[0];
  assert.equal(result.isError, true);
  assert.match(result.text, /at most one/);
  await session;
});

test("resolveTaskTool rejects a run this sidecar never spawned", () => {
  const adapter = new ClaudeCodeAdapter();
  assert.throws(() => adapter.resolveTaskTool("no-such-run", "r", { tasks: [] }), /unknown runId/);
});
