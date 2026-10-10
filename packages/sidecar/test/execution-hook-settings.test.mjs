/**
 * Plan 06-01 (`06-RESEARCH.md` Pitfall 1): a direct unit test of `writeHookSettings`'s
 * `includeAuthoringStageGate` parameter — the whole fix for the collision between this function's
 * own unconditional two-entry write and the NEW `propose_item` tool an ordinary execution run is
 * now pre-approved to call (its shared `propose_` prefix would otherwise match
 * `AUTHORING_STAGE_GATE_MATCHER` and be denied by the authoring stage gate before its own MCP
 * handler is ever reached).
 *
 * Complements `authoring-stage-gate.test.mjs`'s own integration-level proof (a real
 * `ClaudeCodeAdapter.startSession` spawn) with a direct call against a scratch runtime directory,
 * for both the `false` and `true` branches.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  AUTHORING_STAGE_GATE_MATCHER,
  SCOPE_GATE_MATCHER,
  scopeHookScriptPath,
  writeHookSettings,
} from "../dist/claude-code-adapter.js";

function scratchRuntimeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-execution-hook-settings-"));
}

test("writeHookSettings(false) writes exactly one PreToolUse entry whose matcher is Bash", () => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "run-execution-hook-settings-false";

  const settingsPath = writeHookSettings(runtimeDir, runId, false);
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const entries = settings.hooks.PreToolUse;
  assert.equal(entries.length, 1, "expected exactly one PreToolUse entry");
  assert.equal(entries[0].matcher, "Bash");
});

test("writeHookSettings(true) writes exactly two PreToolUse entries, the second matching AUTHORING_STAGE_GATE_MATCHER", () => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "run-execution-hook-settings-true";

  const settingsPath = writeHookSettings(runtimeDir, runId, true);
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const entries = settings.hooks.PreToolUse;
  assert.equal(entries.length, 2, "expected exactly two PreToolUse entries");
  assert.equal(entries[0].matcher, "Bash");
  assert.equal(entries[1].matcher, AUTHORING_STAGE_GATE_MATCHER);
});

test("the false branch's Bash entry is byte-identical to the true branch's Bash entry", () => {
  const runtimeDir = scratchRuntimeDir();

  const falsePath = writeHookSettings(runtimeDir, "run-a", false);
  const truePath = writeHookSettings(runtimeDir, "run-b", true);

  const falseSettings = JSON.parse(fs.readFileSync(falsePath, "utf8"));
  const trueSettings = JSON.parse(fs.readFileSync(truePath, "utf8"));

  assert.deepEqual(falseSettings.hooks.PreToolUse[0], trueSettings.hooks.PreToolUse[0]);
});

// Plan 09-01 (D-151): the third PreToolUse entry. `includeScopeGate` defaults to false, so every
// call above (which does not pass it) keeps its exact one/two-entry shape.

test("writeHookSettings(false, false, true) adds exactly one scope entry after the Bash entry", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-scope-only", false, true);
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const entries = JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks.PreToolUse;
  assert.equal(entries.length, 2, "expected the Bash entry plus the scope entry");
  assert.equal(entries[0].matcher, "Bash");
  assert.equal(entries[1].matcher, SCOPE_GATE_MATCHER);
  assert.equal(entries[1].hooks.length, 1);
  assert.equal(entries[1].hooks[0].type, "command");
  assert.ok(
    entries[1].hooks[0].command.includes(scopeHookScriptPath()),
    "the scope entry must run the compiled scope hook script",
  );
});

test("writeHookSettings(true, true) writes the Bash, authoring and scope entries in that order", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-all-three", true, true);
  const entries = JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks.PreToolUse;
  assert.equal(entries.length, 3);
  assert.deepEqual(
    entries.map((e) => e.matcher),
    ["Bash", AUTHORING_STAGE_GATE_MATCHER, SCOPE_GATE_MATCHER],
  );
});

test("the scope flag leaves the Bash entry, the authoring entry and SessionStart byte-identical", () => {
  const runtimeDir = scratchRuntimeDir();
  const without = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-w1", true, false), "utf8"));
  const withScope = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-w2", true, true), "utf8"));
  assert.deepEqual(withScope.hooks.PreToolUse.slice(0, 2), without.hooks.PreToolUse);
  assert.deepEqual(withScope.hooks.SessionStart, without.hooks.SessionStart);
});

test("no settings entry carries a timeout — a timed-out PreToolUse hook does not block the call", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-no-timeout", true, true);
  const raw = fs.readFileSync(settingsPath, "utf8");
  assert.equal(raw.includes('"timeout"'), false, "a timeout field would be a silent bypass");
});

test("SCOPE_GATE_MATCHER matches the file-writing tools and not Bash, Read or MCP tools", () => {
  const re = new RegExp(`^(?:${SCOPE_GATE_MATCHER})$`);
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assert.ok(re.test(tool), `${tool} must be matched`);
  }
  for (const tool of ["Bash", "Read", "Grep", "mcp__flywheel-permissions__propose_item", "WriteSomething"]) {
    assert.equal(re.test(tool), false, `${tool} must not be matched`);
  }
});
