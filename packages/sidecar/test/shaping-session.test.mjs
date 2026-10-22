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
  assert.ok(SHAPING_TOOL_NAMES.includes("round_post"));
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
