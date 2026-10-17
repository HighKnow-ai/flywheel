/**
 * Phase 09 review CR-01: the scope gate must fail CLOSED.
 *
 * Rust arms the run's scope marker, then the sidecar is the only thing that wires `scope-hook.js`
 * into the agent. Before this fix a settings-write failure or an unset `FLYWHEEL_RUNTIME_DIR`
 * started the run with an armed marker and no hooks at all, and an unquoted or missing hook script
 * made `node` exit 1, which does NOT block a write (only exit 2 does).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import * as adapterModule from "../dist/claude-code-adapter.js";

const { ClaudeCodeAdapter, scopeHookScriptPath, writeHookSettings } = adapterModule;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");

function scratch(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `flywheel-scope-fail-closed-${label}-`));
}

/** A PATH whose first segment holds a `git` file: what `shimBinFromEnv` reads FLYWHEEL_SHIM_BIN from. */
function pathWithShim() {
  const dir = scratch("shim");
  fs.writeFileSync(path.join(dir, "git"), "");
  return `${dir}${path.delimiter}${process.env.PATH}`;
}

/** A PATH with no shim in front, but still able to find `node` for the fake CLI's shebang. */
function pathWithoutShim() {
  return `${scratch("empty-path")}${path.delimiter}${path.dirname(process.execPath)}`;
}

async function start(runId, extra) {
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  const events = [];
  let error;
  try {
    await new ClaudeCodeAdapter().startSession({
      runId,
      worktreePath: process.cwd(),
      prompt: "say hi",
      permissionMode: "acceptEdits",
      onEvent: (e) => events.push(e),
      ...extra,
    });
  } catch (err) {
    error = err;
  } finally {
    delete process.env.FLYWHEEL_CLAUDE_BIN;
  }
  return { events, error };
}

function assertRefused({ events, error }, reason) {
  assert.ok(error, "an armed run whose gate cannot be installed must be refused");
  assert.match(String(error.message), reason);
  assert.equal(events.some((e) => e.type === "init"), false, "the backend must never have been spawned");
  const closed = events.filter((e) => e.type === "session_closed");
  assert.equal(closed.length, 1, "exactly one terminal event, so Rust closes the run row");
  assert.equal(closed[0].reason, "failed");
  assert.match(closed[0].detail ?? "", reason, "the reason reaches the run record");
}

test("an armed run with FLYWHEEL_RUNTIME_DIR unset is refused, not started unenforced", async () => {
  const result = await start("run-armed-no-runtime-dir", {
    scopeArmed: true,
    env: { FLYWHEEL_RUNTIME_DIR: "", PATH: pathWithShim() },
  });
  assertRefused(result, /FLYWHEEL_RUNTIME_DIR/);
});

test("an armed run whose settings file cannot be written is refused", async () => {
  const blocker = path.join(scratch("blocker"), "not-a-directory");
  fs.writeFileSync(blocker, "a file where the runtime directory should be");
  const result = await start("run-armed-settings-write-fails", {
    scopeArmed: true,
    env: { FLYWHEEL_RUNTIME_DIR: blocker, PATH: pathWithShim() },
  });
  assertRefused(result, /settings/);
});

test("an armed run with no shim binary to ask is refused", async () => {
  const result = await start("run-armed-no-shim", {
    scopeArmed: true,
    env: { FLYWHEEL_RUNTIME_DIR: scratch("runtime"), PATH: pathWithoutShim() },
  });
  assertRefused(result, /FLYWHEEL_SHIM_BIN/);
});

test("an armed run with everything installed starts normally", async () => {
  const { events, error } = await start("run-armed-wired", {
    scopeArmed: true,
    env: { FLYWHEEL_RUNTIME_DIR: scratch("runtime"), PATH: pathWithShim() },
  });
  assert.equal(error, undefined);
  assert.equal(events[events.length - 1].type, "session_closed");
  assert.equal(events[events.length - 1].reason, "completed");
});

test("an UNARMED run keeps launching without a shim to ask (D-150: today's single-task launch)", async () => {
  const { events, error } = await start("run-unarmed-no-shim", {
    env: { FLYWHEEL_RUNTIME_DIR: scratch("runtime"), PATH: pathWithoutShim() },
  });
  assert.equal(error, undefined);
  assert.equal(events[events.length - 1].reason, "completed");
});

// ---- the hook command: quoted, and every failure is exit 2 -------------------------------------

function runCommand(command) {
  return spawnSync("sh", ["-c", command], { encoding: "utf8" });
}

test("the scope hook command survives a path with a space in it", () => {
  const dir = path.join(scratch("space"), "dir with space");
  fs.mkdirSync(dir);
  const script = path.join(dir, "hook.js");
  fs.writeFileSync(script, "process.exit(0);\n");
  assert.equal(runCommand(adapterModule.scopeHookCommand(process.execPath, script)).status, 0);
});

test("a missing hook script exits 2 (blocks), never 1 (lets the write through)", () => {
  const missing = path.join(scratch("missing"), "dir with space", "scope-hook.js");
  assert.equal(runCommand(adapterModule.scopeHookCommand(process.execPath, missing)).status, 2);
});

test("a hook that dies with exit 1, or cannot be read at all, is turned into a block", () => {
  const dir = scratch("dies");
  const dies = path.join(dir, "dies.js");
  fs.writeFileSync(dies, "process.exit(1);\n");
  assert.equal(runCommand(adapterModule.scopeHookCommand(process.execPath, dies)).status, 2);
  const missingNode = path.join(dir, "no node here");
  assert.equal(runCommand(adapterModule.scopeHookCommand(missingNode, dies)).status, 2);
});

test("the hook's own deny (exit 2) and allow (exit 0) pass through unchanged", () => {
  const dir = scratch("verdicts");
  const deny = path.join(dir, "deny.js");
  fs.writeFileSync(deny, "console.error('FLYWHEEL-SCOPE: no'); process.exit(2);\n");
  const denied = runCommand(adapterModule.scopeHookCommand(process.execPath, deny));
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /FLYWHEEL-SCOPE/);
});

test("writeHookSettings wires the scope entry through that quoted, fail-closed command", () => {
  const settingsPath = writeHookSettings(scratch("settings"), "run-quoted", true);
  const entries = JSON.parse(fs.readFileSync(settingsPath, "utf8")).hooks.PreToolUse;
  assert.equal(
    entries[1].hooks[0].command,
    adapterModule.scopeHookCommand(process.execPath, scopeHookScriptPath()),
  );
});
