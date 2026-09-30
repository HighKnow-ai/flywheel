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

import { AUTHORING_STAGE_GATE_MATCHER, writeHookSettings } from "../dist/claude-code-adapter.js";

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
