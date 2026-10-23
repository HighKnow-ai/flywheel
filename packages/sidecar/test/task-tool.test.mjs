/**
 * Issue #52 — the Story agent's Task board tool. The MCP server the backend spawns lists
 * `task_list` / `task_add` / `task_update`, and each call is relayed over the run's socket to the
 * sidecar, raised upstream as a `board_tool_request` event and held until the Rust core answers
 * (`ClaudeCodeAdapter.resolveBoardTool`, standing in for `index.ts`'s `board_tool_answer` op). The
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
import { BOARD_TOOL_DEFINITIONS, BOARD_TOOL_NAMES,BOARD_TOOL_QUALIFIED_NAMES, HANDOFF_TOOL_NAMES, STORY_PROPOSAL_TOOL_NAMES, TASK_TOOL_NAMES, TASK_TOOL_QUALIFIED_NAMES, MCP_SERVER_NAME, toolsFor } from "../dist/mcp-permission-server.js";

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

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "task_add");
  assert.deepEqual(request.args, { titles: ["Write the failing test"] });
  assert.equal(typeof request.requestId, "string");

  // The tool lists all three names to the backend.
  await waitForCondition(() => unknownLines(events, "task_tools_listed").length === 1);
  assert.deepEqual(unknownLines(events, "task_tools_listed")[0].names, ["approve_action", ...BOARD_TOOL_NAMES]);

  // Not answered yet: the agent has received nothing.
  assert.equal(unknownLines(events, "task_tool_result").length, 0);

  const checklist = { tasks: [{ task_id: "t1", title: "Write the failing test", state: "open" }] };
  adapter.resolveBoardTool(runId, request.requestId, checklist);

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

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  adapter.resolveBoardTool(runId, request.requestId, undefined, "another Task of this Story is already doing; at most one is");

  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  const result = unknownLines(events, "task_tool_result")[0];
  assert.equal(result.isError, true);
  assert.match(result.text, /at most one/);
  await session;
});

test("resolveBoardTool rejects a run this sidecar never spawned", () => {
  const adapter = new ClaudeCodeAdapter();
  assert.throws(() => adapter.resolveBoardTool("no-such-run", "r", { tasks: [] }), /unknown runId/);
});

// Issue #53: the hand-off and the feedback-only Check tool ride the same server, renamed to
// `flywheel-board` now that it carries more than the permission prompt.
test("the board server is flywheel-board and carries the hand-off and Check tools, all pre-approved", () => {
  assert.equal(MCP_SERVER_NAME, "flywheel-board");
  assert.deepEqual([...HANDOFF_TOOL_NAMES], ["checks_run", "handoff"]);
  assert.deepEqual([...BOARD_TOOL_NAMES], [...TASK_TOOL_NAMES, ...HANDOFF_TOOL_NAMES, ...STORY_PROPOSAL_TOOL_NAMES]);
  assert.ok(BOARD_TOOL_QUALIFIED_NAMES.includes("mcp__flywheel-board__handoff"));
  assert.ok(BOARD_TOOL_QUALIFIED_NAMES.includes("mcp__flywheel-board__checks_run"));
});

// Issue #161, ADR 0010: the hand-off carries each ADR's bar lines, which the review shows beside it.
test("the hand-off offers optional ADR bar lines, the first three required in each", () => {
  const handoff = BOARD_TOOL_DEFINITIONS.find((tool) => tool.name === "handoff");
  assert.deepEqual([...handoff.inputSchema.required], ["next_session_must_know", "decisions"], "adrs is optional");
  const adrs = handoff.inputSchema.properties.adrs;
  assert.equal(adrs.type, "array");
  assert.deepEqual([...adrs.items.required], ["path", "hard_to_reverse", "surprising", "losing_alternative"]);
  assert.equal(adrs.items.properties.relates_to.type, "string");
  assert.equal(adrs.items.properties.text, undefined, "the bar lines travel without the ADR's text");
  assert.match(handoff.description, /never written into the file/);
});

// Issue #160: a running Story files and withdraws Proposals on the same server; a shaping session,
// which has its own Proposal tools, never sees these two.
test("a Story session is listed propose and proposal_withdraw, and a shaping session never is", () => {
  assert.deepEqual([...STORY_PROPOSAL_TOOL_NAMES], ["propose", "proposal_withdraw"]);
  const story = toolsFor("story").map((tool) => tool.name);
  const shaping = toolsFor("shaping").map((tool) => tool.name);
  for (const name of STORY_PROPOSAL_TOOL_NAMES) {
    assert.ok(story.includes(name), `a Story session sees ${name}: ${story}`);
    assert.ok(!shaping.includes(name), `a shaping session never sees ${name}: ${shaping}`);
    assert.ok(BOARD_TOOL_QUALIFIED_NAMES.includes(`mcp__flywheel-board__${name}`), `${name} is pre-approved`);
  }
  const propose = BOARD_TOOL_DEFINITIONS.find((tool) => tool.name === "propose");
  assert.deepEqual([...propose.inputSchema.required], ["kind", "why", "evidence"]);
  assert.deepEqual(
    [...propose.inputSchema.properties.kind.enum],
    ["new_story", "amend_criterion", "amend_epic_spec", "reorder_story", "retire_story", "new_epic"],
  );
  assert.match(propose.description, /proposal_withdraw/);
});

test("a propose call is relayed to the core and the agent receives its answer", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "propose-run-ok";
  const args = { kind: "new_story", title: "Empty-line recovery", why: "The parser stops", evidence: "src/parser.rs:42" };
  const session = startWithTaskCall(adapter, runId, events, { name: "propose", arguments: args });

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "propose");
  assert.deepEqual(request.args, args);
  const answer = { proposal_id: "p1", kind: "new_story", state: "pending", open: 1, cap: 3 };
  adapter.resolveBoardTool(runId, request.requestId, answer);

  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  const result = unknownLines(events, "task_tool_result")[0];
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.text), answer);
  await session;
});

test("a hand-off is held until the core answers, and the agent receives the core's answer", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "handoff-run-ok";
  const summary = {
    next_session_must_know: "Checks pass.",
    decisions: "Kept the old seam.",
    adrs: [
      {
        path: "docs/adr/0010-reviews.md",
        hard_to_reverse: "Every review reads it",
        surprising: "Bar lines usually live in the file",
        losing_alternative: "Parsing the ADR file",
        relates_to: "ADR-0002",
      },
    ],
  };
  const session = startWithTaskCall(adapter, runId, events, { name: "handoff", arguments: summary });

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "handoff");
  assert.deepEqual(request.args, summary);
  assert.equal(unknownLines(events, "task_tool_result").length, 0, "nothing reaches the agent before the core answers");

  const answer = { story_state: "in_review", checks: [{ command: "true", result: "passed" }] };
  adapter.resolveBoardTool(runId, request.requestId, answer);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  const result = unknownLines(events, "task_tool_result")[0];
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.text), answer);
  await session;
});

// Issue #96: `task_update` takes an optional `note`, which replaces the Task's previous note. The
// sidecar offers it in the schema and relays it untouched; the core saves it.
test("task_update offers an optional note, and state is no longer required", () => {
  const update = BOARD_TOOL_DEFINITIONS.find((tool) => tool.name === "task_update");
  assert.equal(update.inputSchema.properties.note.type, "string");
  assert.match(update.inputSchema.properties.note.description, /Replaces the Task's previous note/);
  assert.deepEqual(update.inputSchema.required, ["task_id"], "a note-only update needs no state");
  assert.match(update.description, /note/);
});

test("a task_update note reaches the core untouched, and the agent receives the core's checklist with it", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "task-tool-run-note";
  const args = { task_id: "t1", note: "Survey done: the board tools are in task_tool.rs.\nLeft: the UI." };
  const session = startWithTaskCall(adapter, runId, events, { name: "task_update", arguments: args });

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "task_update");
  assert.deepEqual(request.args, args);

  const checklist = { tasks: [{ task_id: "t1", title: "Survey the repo", state: "doing", note: args.note }] };
  adapter.resolveBoardTool(runId, request.requestId, checklist);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  const result = unknownLines(events, "task_tool_result")[0];
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.text), checklist);
  await session;
});
