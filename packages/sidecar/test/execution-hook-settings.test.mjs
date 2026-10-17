/**
 * A direct unit test of `writeHookSettings`'s settings shape: no tool-call entry by default, and
 * the file-set scope entry when `includeScopeGate` is set (plan 09-01, D-151), driven against a
 * scratch runtime directory.
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

test("writeHookSettings without the scope flag writes no tool-call hook entry", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-execution-hook-settings-false");
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.hooks.PreToolUse, [], "expected no tool-call hook entry");
});

// Plan 09-01 (D-151): the scope PreToolUse entry. `includeScopeGate` defaults to false.

test("writeHookSettings(true) writes exactly the scope entry", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-scope-only", true);
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const entries = JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks.PreToolUse;
  assert.equal(entries.length, 1, "expected only the scope entry");
  assert.equal(entries[0].matcher, SCOPE_GATE_MATCHER);
  assert.equal(entries[0].hooks.length, 1);
  assert.equal(entries[0].hooks[0].type, "command");
  assert.ok(
    entries[0].hooks[0].command.includes(scopeHookScriptPath()),
    "the scope entry must run the compiled scope hook script",
  );
});

test("no settings entry matches Bash", () => {
  const runtimeDir = scratchRuntimeDir();
  const entries = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-no-bash", true), "utf8")).hooks.PreToolUse;
  assert.equal(entries.some((e) => e.matcher === "Bash"), false);
});

test("the scope flag leaves SessionStart byte-identical", () => {
  const runtimeDir = scratchRuntimeDir();
  const without = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-w1", false), "utf8"));
  const withScope = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-w2", true), "utf8"));
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
