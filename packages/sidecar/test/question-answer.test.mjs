/**
 * Issue #100: an `AskUserQuestion` call reaches the permission-prompt tool like any other tool call,
 * and the developer's answer must go back as `allow` with an `updatedInput` carrying the original
 * `questions` plus an `answers` record keyed by question text (Claude Agent SDK docs, "Handle
 * approvals and user input"). Without `answers` the CLI tells the agent "The user did not answer
 * the questions." These tests pin that shape: as a pure function, and through the real held-call
 * round trip against `fake-claude.mjs`.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

import { ClaudeCodeAdapter } from "../dist/claude-code-adapter.js";
import { permissionPromptResponse } from "../dist/mcp-permission-server.js";

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

const QUESTIONS = [
  {
    question: "Which colour should the button be?",
    header: "Colour",
    options: [
      { label: "Red", description: "Warm" },
      { label: "Blue", description: "Calm" },
    ],
    multiSelect: false,
  },
  {
    question: "Which platforms should we ship to?",
    header: "Platforms",
    options: [
      { label: "macOS", description: "" },
      { label: "Linux", description: "" },
      { label: "Windows", description: "" },
    ],
    multiSelect: true,
  },
  {
    question: "What should the release be called?",
    header: "Name",
    options: [
      { label: "v1", description: "" },
      { label: "v2", description: "" },
    ],
    multiSelect: false,
  },
];

const ANSWERS = {
  // single choice: the chosen label
  "Which colour should the button be?": "Blue",
  // multi-select: the labels joined with ", "
  "Which platforms should we ship to?": "macOS, Linux",
  // free text ("Other"): the developer's own words, never the word "Other"
  "What should the release be called?": "Call it Flywheel One",
};

test("an answered question is allow, with the original questions and the answers keyed by question text", () => {
  const response = permissionPromptResponse({ questions: QUESTIONS }, { decision: "allow", answers: ANSWERS });
  assert.deepEqual(response, {
    behavior: "allow",
    updatedInput: { questions: QUESTIONS, answers: ANSWERS },
  });
});

test("a plain allow still passes the input through unchanged, and a deny never carries answers", () => {
  assert.deepEqual(permissionPromptResponse({ command: "ls" }, { decision: "allow" }), {
    behavior: "allow",
    updatedInput: { command: "ls" },
  });
  assert.deepEqual(permissionPromptResponse({ questions: QUESTIONS }, { decision: "deny", answers: ANSWERS }), {
    behavior: "deny",
    message: "Denied by user",
  });
});

async function waitFor(predicate, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor timed out");
}

test("a held AskUserQuestion call settles with the relayed answers in the response Claude Code reads", async () => {
  const adapter = new ClaudeCodeAdapter();
  const events = [];
  const runId = "question-run-answer";
  const session = adapter.startSession({
    runId,
    worktreePath: process.cwd(),
    prompt: "ask me",
    permissionMode: "acceptEdits",
    env: {
      FLYWHEEL_FAKE_CALL_PERMISSION: "1",
      FLYWHEEL_FAKE_PERMISSION_CALL: JSON.stringify({ tool_name: "AskUserQuestion", input: { questions: QUESTIONS } }),
    },
    onEvent: (event) => events.push(event),
  });

  const request = await waitFor(() => events.find((e) => e.type === "permission_request"));
  assert.equal(request.toolName, "AskUserQuestion");

  adapter.resolvePermission(runId, request.requestId, "allow", ANSWERS);

  const result = await waitFor(() =>
    events
      .filter((e) => e.type === "unknown")
      .map((e) => {
        try {
          return JSON.parse(e.raw);
        } catch {
          return undefined;
        }
      })
      .find((parsed) => parsed?.type === "permission_tool_result"),
  );
  assert.deepEqual(result.response, { behavior: "allow", updatedInput: { questions: QUESTIONS, answers: ANSWERS } });
  await session;
});
