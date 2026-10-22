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
import { BOARD_TOOL_NAMES, MCP_SERVER_NAME, PERMISSION_TOOL_NAME } from "../dist/mcp-permission-server.js";

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

  // The backend connects to the board server and sees its tools.
  await waitForCondition(() => unknownLines(events, "task_tools_listed").length === 1);
  assert.deepEqual(unknownLines(events, "task_tools_listed")[0].names, ["approve_action", ...BOARD_TOOL_NAMES]);

  await waitForCondition(() => events.some((e) => e.type === "board_tool_request"));
  const request = events.find((e) => e.type === "board_tool_request");
  adapter.resolveBoardTool(runId, request.requestId, undefined, "a shaping session has no Story");
  await waitForCondition(() => unknownLines(events, "task_tool_result").length === 1);
  assert.equal(unknownLines(events, "task_tool_result")[0].isError, true);
  await session;
});
