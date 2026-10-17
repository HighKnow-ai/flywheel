/**
 * A direct unit test of `writeHookSettings`'s settings shape, driven against a scratch runtime
 * directory: no tool-call entry at all (the prove-interception hook and the file-set scope gate are
 * both gone), and a `SessionStart` entry that runs the compiled hook script.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { sessionStartHookScriptPath, writeHookSettings } from "../dist/claude-code-adapter.js";

function scratchRuntimeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-execution-hook-settings-"));
}

test("writeHookSettings writes no tool-call hook entry", () => {
  const runtimeDir = scratchRuntimeDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-execution-hook-settings");
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.hooks.PreToolUse, [], "expected no tool-call hook entry");
});

test("writeHookSettings wires the SessionStart hook script", () => {
  const runtimeDir = scratchRuntimeDir();
  const settings = JSON.parse(fs.readFileSync(writeHookSettings(runtimeDir, "run-session-start"), "utf8"));
  const commands = settings.hooks.SessionStart.flatMap((entry) => entry.hooks.map((h) => h.command));
  assert.equal(commands.length, 1);
  assert.ok(commands[0].includes(sessionStartHookScriptPath()), "the SessionStart entry runs the compiled hook");
});

test("no settings entry carries a timeout — a timed-out hook does not block the call", () => {
  const runtimeDir = scratchRuntimeDir();
  const raw = fs.readFileSync(writeHookSettings(runtimeDir, "run-no-timeout"), "utf8");
  assert.equal(raw.includes('"timeout"'), false, "a timeout field would be a silent bypass");
});
