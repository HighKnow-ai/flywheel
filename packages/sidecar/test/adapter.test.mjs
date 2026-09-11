import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { CapabilityUnsupportedError } from "../dist/adapter.js";
import { buildClaudeArgv, ClaudeCodeAdapter } from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

test("buildClaudeArgv returns the exact expected array for the default mode, with no credential in it", () => {
  // Exact-array assertions are the fastest signal when the argv changes unintentionally, but
  // alone they are NOT sufficient: this is exactly how G-02-2 shipped — this test asserted a
  // snapshot of whatever buildClaudeArgv currently produced, including a command line the real
  // CLI always rejected, and had no way to distinguish a correct argv from a frozen wrong one.
  // The constraint-shaped test below asserts the --output-format/--verbose pairing as a
  // relationship (survives reordering); real-claude-argv.test.mjs asserts against the real
  // binary. Keep this test for its speed; do not rely on it alone for argv correctness.
  const argv = buildClaudeArgv({ prompt: "<prompt>", permissionMode: "acceptEdits" });
  assert.deepEqual(argv, [
    "-p",
    "<prompt>",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "acceptEdits",
  ]);
  for (const element of argv) {
    assert.ok(!/sk-ant-|api[_-]?key/i.test(element), `argv element leaked a credential-shaped string: ${element}`);
  }
});

// The single declared source of accepted permission modes for the constraint test below — a
// future mode addition extends the guard by one line here, rather than requiring the literal to
// be repeated at every call site.
const ACCEPTED_PERMISSION_MODES = ["default", "acceptEdits", "plan", "bypassPermissions"];

test("buildClaudeArgv always pairs --output-format stream-json with --verbose (G-02-2)", () => {
  // claude 2.1.236: "When using --print, --output-format=stream-json requires --verbose".
  // Without it the CLI exits 1 at argument validation, having emitted nothing, and the session
  // closes as a bare `failed`. Asserted for every permission mode, including the ones that also
  // append the permission-gate flags, so no call shape can lose the pairing. Reordering the argv,
  // or inserting a flag between members, cannot break this guard — it asserts a relationship
  // between members, never their positions.
  const callShapes = [{}, { permissionPromptToolName: "mcp__x__y", mcpConfig: "{}" }];
  let examined = 0;
  for (const permissionMode of ACCEPTED_PERMISSION_MODES) {
    for (const extra of callShapes) {
      examined += 1;
      const argv = buildClaudeArgv({ prompt: "p", permissionMode, ...extra });
      const streamJson =
        argv.includes("--output-format") && argv[argv.indexOf("--output-format") + 1] === "stream-json";
      if (streamJson) {
        assert.ok(
          argv.includes("--verbose"),
          `argv for ${permissionMode} used stream-json without --verbose: ${JSON.stringify(argv)}`,
        );
      }
    }
  }
  // The loop's own iteration count is asserted, so a guard that silently examined nothing (an
  // empty mode list, an empty call-shape list) cannot report green.
  assert.equal(
    examined,
    ACCEPTED_PERMISSION_MODES.length * callShapes.length,
    "the pairing guard must examine every permission-mode / call-shape combination",
  );
  assert.ok(examined > 0, "the pairing guard must examine at least one argv variant");

  // Converse for the two-field call shape: a non-empty argv naming print mode and a permission
  // mode. Without this, an edit that dropped --output-format entirely would satisfy the pairing
  // implication vacuously (no stream-json means nothing to check) while producing a useless argv.
  for (const permissionMode of ACCEPTED_PERMISSION_MODES) {
    const argv = buildClaudeArgv({ prompt: "p", permissionMode });
    assert.ok(argv.length > 0, `two-field argv for ${permissionMode} must be non-empty`);
    assert.ok(
      argv.includes("-p"),
      `two-field argv for ${permissionMode} must name print mode: ${JSON.stringify(argv)}`,
    );
    assert.ok(
      argv.includes(permissionMode),
      `two-field argv for ${permissionMode} must name its own permission mode: ${JSON.stringify(argv)}`,
    );
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
