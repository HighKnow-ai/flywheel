/**
 * Issue #122 — a shaping session is wired to the board's MCP server but never to the
 * permission-prompt tool. `--mcp-config` is always passed, so the session reaches the
 * `flywheel-board` server (where the Proposal and Round tools live); `--permission-prompt-tool` is
 * passed only when the session may raise a permission request, which a shaping session never does.
 *
 * Runs against the REAL spawned `fake-claude.mjs`, which reads the argv the adapter built and
 * connects to the MCP server named in `--mcp-config` exactly as the backend does.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { buildClaudeArgv, ClaudeCodeAdapter } from "../dist/claude-code-adapter.js";
import {
  MCP_SERVER_NAME,
  PERMISSION_TOOL_NAME,
  SHAPING_TOOL_DEFINITIONS,
  SHAPING_TOOL_NAMES,
} from "../dist/mcp-permission-server.js";

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

test("buildClaudeArgv passes the MCP config on its own, with no permission-prompt tool", () => {
  const mcpConfig = JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: { command: "node", args: ["x.js"] } } });
  const argv = buildClaudeArgv({ prompt: "p", permissionMode: "dontAsk", mcpConfig });
  assert.equal(argv[argv.indexOf("--mcp-config") + 1], mcpConfig);
  assert.ok(!argv.includes("--permission-prompt-tool"), "no prompt tool was given, so none is wired");

  const story = buildClaudeArgv({ prompt: "p", permissionMode: "acceptEdits", mcpConfig, permissionPromptToolName: PERMISSION_TOOL_NAME });
  assert.equal(story[story.indexOf("--permission-prompt-tool") + 1], PERMISSION_TOOL_NAME);
  assert.equal(story[story.indexOf("--mcp-config") + 1], mcpConfig);
});

test("a shaping session reaches the board's MCP server and is never wired to the permission prompt", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "shaping-run-wired";
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "shape the Epic",
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep"],
    disallowedTools: ["Bash", "Edit", "Write", "NotebookEdit", "AskUserQuestion"],
    permissionPrompt: false,
    sessionKind: "shaping",
    env: {
      FLYWHEEL_FAKE_ECHO_ARGV: "1",
      FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "task_list", arguments: {} }),
    },
    onEvent: (event) => events.push(event),
  });

  await waitForCondition(() => unknownLines(events, "argv_seen").length === 1);
  const argv = unknownLines(events, "argv_seen")[0].argv;
  assert.ok(!argv.includes("--permission-prompt-tool"), `no permission prompt: ${JSON.stringify(argv)}`);
  const mcpConfig = JSON.parse(argv[argv.indexOf("--mcp-config") + 1]);
  assert.deepEqual(Object.keys(mcpConfig.mcpServers), [MCP_SERVER_NAME], "the board server, and only it");
  assert.equal(argv[argv.indexOf("--permission-mode") + 1], "dontAsk");
  assert.equal(argv[argv.indexOf("--disallowedTools") + 1], "Bash,Edit,Write,NotebookEdit,AskUserQuestion");

  // The backend connects to the board server and sees the shaping tools, and only them: no
  // permission prompt, no Task tool, no hand-off.
  await waitForCondition(() => unknownLines(events, "task_tools_listed").length === 1);
  assert.deepEqual(unknownLines(events, "task_tools_listed")[0].names, [...SHAPING_TOOL_NAMES]);

  // A Story board tool is not this server's to relay for a shaping session: refused at once, and
  // nothing reaches the core.
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.equal(unknownLines(events, "task_tool_result")[0].isError, true);
  assert.ok(!events.some((e) => e.type === "board_tool_request"), "nothing was relayed");
  await session;
});

const ROUND = {
  note: "This Round settles who the Epic is for.",
  questions: [
    {
      title: "Audience",
      question: "Is the Epic for the developer alone?",
      grounding: "Read GLOSSARY.md, Developer",
      recommended_answer: "Yes, the one developer",
      because: "The MVP has one user",
    },
  ],
};

test("round_post is listed to a shaping session with what each question carries", () => {
  assert.deepEqual([...SHAPING_TOOL_NAMES], [
    "round_post",
    "round_wait",
    "propose_spec_change",
    "propose_roadmap_change",
    "roadmap_holds",
    "propose_story",
    "propose_story_order",
    "propose_exit_test",
    "propose_criterion",
  ]);
  const post = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "round_post");
  assert.deepEqual(post.inputSchema.required, ["note", "questions"]);
  assert.deepEqual(post.inputSchema.properties.questions.items.required, [
    "title",
    "question",
    "grounding",
    "recommended_answer",
    "because",
  ]);
  assert.match(post.description, /waits until every question is answered/);
});

test("round_post offers an ADR as a question with its draft and its bar lines (issue #129)", () => {
  const post = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "round_post");
  const item = post.inputSchema.properties.questions.items;
  assert.deepEqual(item.properties.kind.enum, ["question", "adr"]);
  const adr = item.properties.adr;
  assert.deepEqual(adr.required, ["path", "text", "hard_to_reverse", "surprising", "losing_alternative"]);
  assert.ok(adr.properties.relates_to, "Relates to is the fourth bar line, and may be none");
  assert.match(post.description, /kind "adr"/);
  assert.match(post.description, /Yes or No/);
});

test("round_post is relayed as a held board_tool_request, answered only when the core answers", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "shaping-run-round";
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "shape the Epic",
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep", `mcp__${MCP_SERVER_NAME}__round_post`],
    permissionPrompt: false,
    sessionKind: "shaping",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "round_post", arguments: ROUND }) },
    onEvent: (event) => events.push(event),
  });

  await waitForCondition(() => unknownLines(events, "task_tools_listed").length === 1);
  assert.ok(unknownLines(events, "task_tools_listed")[0].names.includes("round_post"));

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "round_post");
  assert.deepEqual(request.args, ROUND, "the Round reaches the core untouched");
  assert.equal(typeof request.requestId, "string");

  // Held: nothing reaches the agent while the developer answers.
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(unknownLines(events, "task_tool_result").length, 0, "the call is held until the core answers");

  const answers = { round: 1, answers: [{ number: 1, answer: "Yes, the one developer", answered_with: "recommended" }] };
  adapter.resolveBoardTool(runId, request.requestId, answers);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  const result = unknownLines(events, "task_tool_result")[0];
  assert.equal(result.isError, false);
  assert.deepEqual(JSON.parse(result.text), answers);
  await session;
});

test("round_wait takes no argument and is relayed as a held board_tool_request (issue #124)", async () => {
  const wait = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "round_wait");
  assert.deepEqual(wait.inputSchema, { type: "object", properties: {} });
  assert.match(wait.description, /waits until every question in it is answered/);
  const post = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "round_post");
  assert.match(post.description, /round_wait/, "round_post's refusal is named in its description");

  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "shaping-run-wait";
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "continue shaping the Epic",
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep", `mcp__${MCP_SERVER_NAME}__round_post`, `mcp__${MCP_SERVER_NAME}__round_wait`],
    permissionPrompt: false,
    sessionKind: "shaping",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "round_wait", arguments: {} }) },
    onEvent: (event) => events.push(event),
  });

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "round_wait");
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(unknownLines(events, "task_tool_result").length, 0, "held until the core answers");

  const answers = { round: 2, answers: [{ number: 1, answer: "Desktop only", answered_with: "own" }] };
  adapter.resolveBoardTool(runId, request.requestId, answers);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.deepEqual(JSON.parse(unknownLines(events, "task_tool_result")[0].text), answers);
  await session;
});

test("a Story session's board server does not list round_post, and refuses it unrelayed", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const session = adapter.startSession({
    runId: "story-run-no-round",
    worktreePath: process.cwd(),
    prompt: "work the Story",
    permissionMode: "acceptEdits",
    sessionKind: "story",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "round_post", arguments: ROUND }) },
    onEvent: (event) => events.push(event),
  });
  await waitForCondition(() => unknownLines(events, "task_tools_listed").length === 1);
  assert.ok(!unknownLines(events, "task_tools_listed")[0].names.includes("round_post"));
  assert.ok(!unknownLines(events, "task_tools_listed")[0].names.includes("propose_spec_change"));
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.equal(unknownLines(events, "task_tool_result")[0].isError, true);
  assert.ok(!events.some((e) => e.type === "board_tool_request"), "nothing was relayed");
  await session;
});

// Issue #125: a shaping session proposes spec changes. The core answers the call at once (a Proposal
// never holds the agent); this server relays it like every other board tool.
test("propose_spec_change is listed to a shaping session with the field, its new text and why", () => {
  assert.ok(SHAPING_TOOL_NAMES.includes("propose_spec_change"));
  const propose = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_spec_change");
  assert.deepEqual(propose.inputSchema.required, ["field", "text", "why"]);
  assert.deepEqual(propose.inputSchema.properties.field.enum, ["problem", "scope", "out_of_scope", "exit_test"]);
  assert.match(propose.description, /answered at once/);
});

// Issue #127: slicing the Epic into Stories. Both tools are answered at once, like every Proposal tool.
test("propose_story and propose_story_order are listed with their place in the order and the constraint", () => {
  const story = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_story");
  assert.deepEqual(story.inputSchema.required, ["title", "description"]);
  for (const key of ["after", "before", "runs_after", "runs_after_reason"]) {
    assert.ok(key in story.inputSchema.properties, key);
  }
  assert.match(story.description, /never blocks/);
  assert.match(story.description, /answered at once/);
  const order = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_story_order");
  assert.deepEqual(order.inputSchema.required, ["story", "action", "why"]);
  assert.deepEqual(order.inputSchema.properties.action.enum, ["move", "retire"]);
  assert.match(order.description, /answered at once/);
});

test("propose_story is relayed to the core and its answer reaches the agent", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "shaping-run-story";
  const args = { title: "Feed row", description: "Ships the row.", runs_after: "FLY-3", runs_after_reason: "shares `FeedRow.tsx`" };
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "slice the Epic",
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep", `mcp__${MCP_SERVER_NAME}__propose_story`],
    permissionPrompt: false,
    sessionKind: "shaping",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "propose_story", arguments: args }) },
    onEvent: (event) => events.push(event),
  });
  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "propose_story");
  assert.deepEqual(request.args, args);
  const answer = { proposal_id: "01STORY", state: "pending" };
  adapter.resolveBoardTool(runId, request.requestId, answer);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.deepEqual(JSON.parse(unknownLines(events, "task_tool_result")[0].text), answer);
  await session;
});

// Issue #128: writing the Acceptance criteria. The Check is optional: without it, judged at review.
test("propose_criterion is listed with its Story, its statement and an optional Check", () => {
  const criterion = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_criterion");
  assert.deepEqual(criterion.inputSchema.required, ["story", "statement"]);
  assert.ok("check" in criterion.inputSchema.properties);
  assert.match(criterion.description, /judged at review/);
  assert.match(criterion.description, /answered at once/);
});

test("propose_criterion is relayed to the core and its answer reaches the agent", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "shaping-run-criterion";
  const args = { story: "FLY-3", statement: "A malformed line is skipped", check: "cargo test -p core --test parser" };
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "write the criteria",
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep", `mcp__${MCP_SERVER_NAME}__propose_criterion`],
    permissionPrompt: false,
    sessionKind: "shaping",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "propose_criterion", arguments: args }) },
    onEvent: (event) => events.push(event),
  });
  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "propose_criterion");
  assert.deepEqual(request.args, args);
  const answer = { proposal_id: "01CRITERION", state: "pending" };
  adapter.resolveBoardTool(runId, request.requestId, answer);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.deepEqual(JSON.parse(unknownLines(events, "task_tool_result")[0].text), answer);
  await session;
});

test("propose_spec_change is relayed to the core and its answer reaches the agent", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "shaping-run-propose";
  const args = { field: "scope", text: "The board, and nothing else.", why: "Round 1 narrowed it" };
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "shape the Epic",
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep", `mcp__${MCP_SERVER_NAME}__propose_spec_change`],
    permissionPrompt: false,
    sessionKind: "shaping",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "propose_spec_change", arguments: args }) },
    onEvent: (event) => events.push(event),
  });
  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "propose_spec_change");
  assert.deepEqual(request.args, args);
  const answer = { proposal_id: "01PROPOSAL", state: "pending" };
  adapter.resolveBoardTool(runId, request.requestId, answer);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.deepEqual(JSON.parse(unknownLines(events, "task_tool_result")[0].text), answer);
  await session;
});

// Issue #133: a roadmap Round proposes Roadmap changes or says the Roadmap holds. Both are relayed
// like every other board tool and answered at once by the core.
test("propose_roadmap_change and roadmap_holds are listed with each change kind and a why", () => {
  const propose = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_roadmap_change");
  assert.deepEqual(propose.inputSchema.required, ["change", "why"]);
  assert.deepEqual(propose.inputSchema.properties.change.enum, [
    "create_milestone",
    "amend_milestone",
    "reorder_milestone",
    "retire_milestone",
    "add_epic",
    "drop_epic",
  ]);
  assert.match(propose.description, /round_wait/);
  const holds = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "roadmap_holds");
  assert.deepEqual(holds.inputSchema.required, ["why"]);
  assert.match(holds.description, /Roadmap still holds/);
});

test("propose_roadmap_change is relayed to the core and its answer reaches the agent", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "roadmap-run-propose";
  const args = { change: "create_milestone", title: "Mobile", exit_test: "A phone answers a Round", why: "Asked twice" };
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "revisit the Roadmap",
    permissionMode: "dontAsk",
    allowedTools: ["Read", "Glob", "Grep", `mcp__${MCP_SERVER_NAME}__propose_roadmap_change`],
    permissionPrompt: false,
    sessionKind: "shaping",
    env: { FLYWHEEL_FAKE_CALL_TASK_TOOL: JSON.stringify({ name: "propose_roadmap_change", arguments: args }) },
    onEvent: (event) => events.push(event),
  });
  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  assert.equal(request.tool, "propose_roadmap_change");
  assert.deepEqual(request.args, args);
  const answer = { proposal_id: "01PROPOSAL", state: "pending" };
  adapter.resolveBoardTool(runId, request.requestId, answer);
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.deepEqual(JSON.parse(unknownLines(events, "task_tool_result")[0].text), answer);
  await session;
});

// Issue #132: a Milestone's shaping session proposes its exit test, answered at once the same way.
test("propose_exit_test is listed to a shaping session with the new text and why", () => {
  assert.ok(SHAPING_TOOL_NAMES.includes("propose_exit_test"));
  const propose = SHAPING_TOOL_DEFINITIONS.find((tool) => tool.name === "propose_exit_test");
  assert.deepEqual(propose.inputSchema.required, ["text", "why"]);
  assert.match(propose.description, /answered at once/);
  assert.match(propose.description, /propose_spec_change/);
});
