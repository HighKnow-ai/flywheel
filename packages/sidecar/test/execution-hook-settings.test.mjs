/**
 * A direct unit test of `writeHookSettings`'s settings shape: the `Bash` destructive-gate entry
 * always, plus the file-set scope entry when `includeScopeGate` is set (plan 09-01, D-151), driven
 * against a scratch runtime directory.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { SCOPE_GATE_MATCHER, scopeHookScriptPath, writeHookSettings } from "../dist/claude-code-adapter.js";

function scratchRuntimeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-execution-hook-settings-"));
}

test("writeHookSettings without the scope flag writes exactly one PreToolUse entry whose matcher is Bash", () => {
  const runtimeDir = scratchRuntimeDir();
  const runId = "run-execution-hook-settings-false";

  const settingsPath = writeHookSettings(runtimeDir, runId);
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const entries = settings.hooks.PreToolUse;
  assert.equal(entries.length, 1, "expected exactly one PreToolUse entry");
  assert.equal(entries[0].matcher, "Bash");
});

// Plan 09-01 (D-151): the scope PreToolUse entry. `includeScopeGate` defaults to false.

test("writeHookSettings(true) adds exactly one scope entry after the Bash entry", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-scope-only", true);
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

test("the scope flag leaves the Bash entry and SessionStart byte-identical", () => {
  const runtimeDir = scratchRuntimeDir();
  const without = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-w1", false), "utf8"));
  const withScope = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-w2", true), "utf8"));
  assert.deepEqual(withScope.hooks.PreToolUse.slice(0, 1), without.hooks.PreToolUse);
  assert.deepEqual(withScope.hooks.SessionStart, without.hooks.SessionStart);
});

test("no settings entry carries a timeout — a timed-out PreToolUse hook does not block the call", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-no-timeout", true);
  const raw = fs.readFileSync(settingsPath, "utf8");
  assert.equal(raw.includes('"timeout"'), false, "a timeout field would be a silent bypass");
});

test("SCOPE_GATE_MATCHER matches the file-writing tools and not Bash, Read or MCP tools", () => {
  const re = new RegExp(`^(?:${SCOPE_GATE_MATCHER})$`);
  for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
    assert.ok(re.test(tool), `${tool} must be matched`);
  }
  for (const tool of ["Bash", "Read", "Grep", "mcp__flywheel-permissions__approve_action", "WriteSomething"]) {
    assert.equal(re.test(tool), false, `${tool} must not be matched`);
  }
});
