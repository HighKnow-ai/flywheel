import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { CapabilityUnsupportedError } from "../dist/adapter.js";
import { buildClaudeArgv, ClaudeCodeAdapter } from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

test("buildClaudeArgv returns the exact expected array for the default mode, with no credential in it", () => {
  const argv = buildClaudeArgv({ prompt: "<prompt>", permissionMode: "acceptEdits" });
  assert.deepEqual(argv, [
    "-p",
    "<prompt>",
    "--output-format",
    "stream-json",
    "--permission-mode",
    "acceptEdits",
  ]);
  for (const element of argv) {
    assert.ok(!/sk-ant-|api[_-]?key/i.test(element), `argv element leaked a credential-shaped string: ${element}`);
  }
});

test("resumeSession rejects with CapabilityUnsupportedError, and capabilities.supportsResume is false", async () => {
  const adapter = new ClaudeCodeAdapter();
  assert.equal(adapter.capabilities.supportsResume, false);
  await assert.rejects(() => adapter.resumeSession("run-1", "session-1"), CapabilityUnsupportedError);
});

test("normalised events for the fake CLI's stream arrive in source order with contiguous seq values", async () => {
  // Points FLYWHEEL_CLAUDE_BIN directly at the executable fake CLI script (its own shebang picks
  // the node interpreter) — resolveClaudeBin() reads this env var verbatim as the spawned binary.
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  const adapter = new ClaudeCodeAdapter();
  const events = [];

  await adapter.startSession({
    runId: "run-1",
    worktreePath: process.cwd(),
    prompt: "say hi",
    permissionMode: "acceptEdits",
    env: {},
    onEvent: (event) => events.push(event),
  });

  // At least init, assistant_text, result, and — plan 02-02's D-35 addition — the terminal
  // session_closed event every session now ends with exactly once, regardless of why it ended.
  assert.ok(events.length >= 4, `expected at least 4 events, got ${events.length}`);
  assert.deepEqual(
    events.map((e) => e.seq),
    events.map((_, i) => i),
    "seq values must be contiguous starting at 0",
  );
  for (const event of events) {
    assert.ok(event.raw && event.raw.length > 0, "every event must carry a non-empty raw field");
  }
  assert.equal(events[0].type, "init");
  assert.equal(events[1].type, "assistant_text");
  assert.equal(events[events.length - 2].type, "result");
  assert.equal(events[events.length - 1].type, "session_closed");
  assert.equal(events[events.length - 1].reason, "completed");

  delete process.env.FLYWHEEL_CLAUDE_BIN;
});
