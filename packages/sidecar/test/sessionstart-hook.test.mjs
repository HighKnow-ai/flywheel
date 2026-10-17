/**
 * Phase 12 plan 12-03 — unit coverage for `sessionstart-hook.ts` and its `writeHookSettings`
 * registration. Task 1's own arms: the positive arm (writes a PATH-prepending line into
 * `CLAUDE_ENV_FILE`), the append arm (a pre-seeded marker survives byte-for-byte), and the four
 * degrade arms (`CLAUDE_ENV_FILE` unset, `FLYWHEEL_SHIM_BIN` unset, a non-existent target
 * directory, a shim directory containing a space). Task 2 adds the order/no-leaked-PATH
 * assertions on the positive arm, the `sh -n` parse check on the space arm, and the
 * `writeHookSettings` settings-shape arm below. Zero credential spend — nothing here spawns
 * `claude`.
 *
 * **The benign arm, and it is not optional (round ten's own lesson, carried into this plan by
 * 12-RESEARCH.md Pitfall 3).** This file alone cannot prove a `SessionStart` registration left
 * ordinary commands alone — that proof is `destructive-gate.test.mjs`'s own `LAUNCHER_CORPUS` and
 * ordinary-usage rows (`source .venv/bin/activate && pytest`, `eval "$(direnv hook bash)"`,
 * `npm test`, `cargo build`, `git status`, `command -v git`) staying green when the WHOLE sidecar
 * suite runs, not just this file:
 *
 * ```
 * cd packages/sidecar
 * FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude npm test
 * ```
 *
 * Do not delete that suite-wide run as "redundant" with this file — this file proves the hook's
 * own behavior; the suite-wide run is what proves the hook's REGISTRATION never turned a benign
 * command into a permission request.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { sessionStartHookScriptPath, writeHookSettings } from "../dist/claude-code-adapter.js";

function scratchDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sessionstart-hook-test-"));
}

function runHook(env) {
  return spawnSync(process.execPath, [sessionStartHookScriptPath()], {
    encoding: "utf8",
    env,
  });
}

test("positive arm: writes a PATH-prepending line into CLAUDE_ENV_FILE", () => {
  const dir = scratchDir();
  const envFile = path.join(dir, "env-file.sh");
  const shimBin = path.join(dir, "shim", "git");
  const result = runHook({ ...process.env, CLAUDE_ENV_FILE: envFile, FLYWHEEL_SHIM_BIN: shimBin });
  assert.equal(result.status, 0);
  const content = fs.readFileSync(envFile, "utf8");
  const lines = content.split("\n").filter((l) => l.length > 0);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^export PATH=/);
  assert.ok(lines[0].includes(path.dirname(shimBin)));
  // Order asserted, not just presence: the shim directory must appear BEFORE the unexpanded
  // $PATH reference, never after — a trailing prepend would not lead PATH[0].
  assert.ok(lines[0].indexOf(path.dirname(shimBin)) < lines[0].indexOf("$PATH"));
  // The line must never contain this TEST PROCESS's own expanded PATH value — it references the
  // sourcing shell's $PATH literally, unexpanded by this hook's own process.
  assert.ok(!process.env.PATH || !lines[0].includes(process.env.PATH));
});

test("append arm: a pre-seeded marker line survives byte-for-byte", () => {
  const dir = scratchDir();
  const envFile = path.join(dir, "env-file.sh");
  const marker = "# pre-existing marker\n";
  fs.writeFileSync(envFile, marker);
  const shimBin = path.join(dir, "shim", "git");
  const result = runHook({ ...process.env, CLAUDE_ENV_FILE: envFile, FLYWHEEL_SHIM_BIN: shimBin });
  assert.equal(result.status, 0);
  const content = fs.readFileSync(envFile, "utf8");
  assert.ok(content.startsWith(marker));
  assert.ok(content.length > marker.length);
});

test("degrade arm: CLAUDE_ENV_FILE unset exits 0 and writes nothing", () => {
  const dir = scratchDir();
  const shimBin = path.join(dir, "shim", "git");
  const env = { ...process.env, FLYWHEEL_SHIM_BIN: shimBin };
  delete env.CLAUDE_ENV_FILE;
  const result = runHook(env);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("degrade arm: FLYWHEEL_SHIM_BIN unset exits 0 and creates no file", () => {
  const dir = scratchDir();
  const envFile = path.join(dir, "env-file.sh");
  const env = { ...process.env, CLAUDE_ENV_FILE: envFile };
  delete env.FLYWHEEL_SHIM_BIN;
  const result = runHook(env);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.equal(fs.existsSync(envFile), false);
});

test("degrade arm: CLAUDE_ENV_FILE inside a non-existent directory exits 0 without throwing", () => {
  const dir = scratchDir();
  const envFile = path.join(dir, "missing-subdir", "env-file.sh");
  const shimBin = path.join(dir, "shim", "git");
  const result = runHook({ ...process.env, CLAUDE_ENV_FILE: envFile, FLYWHEEL_SHIM_BIN: shimBin });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

test("degrade arm: a shim directory containing a space is quoted in the emitted line", () => {
  const dir = scratchDir();
  const spacedDir = path.join(dir, "shim with space");
  fs.mkdirSync(spacedDir, { recursive: true });
  const envFile = path.join(dir, "env-file.sh");
  const shimBin = path.join(spacedDir, "git");
  const result = runHook({ ...process.env, CLAUDE_ENV_FILE: envFile, FLYWHEEL_SHIM_BIN: shimBin });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  const content = fs.readFileSync(envFile, "utf8");
  const line = content.trim();
  assert.ok(line.includes('"'));
  const parse = spawnSync("sh", ["-n"], { input: `${line}\n`, encoding: "utf8" });
  assert.equal(parse.status, 0, `sh -n failed to parse the emitted line: ${parse.stderr}`);
});

test("settings-shape arm: writeHookSettings carries a SessionStart entry alongside an untouched PreToolUse entry", () => {
  const runtimeDir = scratchDir();
  const settingsPath = writeHookSettings(runtimeDir, "run-sessionstart-shape");
  assert.ok(settingsPath, "expected writeHookSettings to return a path");

  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  assert.equal(settings.hooks.PreToolUse.length, 1);
  assert.equal(settings.hooks.PreToolUse[0].matcher, "Bash");

  const sessionStart = settings.hooks.SessionStart;
  assert.equal(sessionStart.length, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(sessionStart[0], "matcher"), false);
  assert.ok(sessionStart[0].hooks[0].command.endsWith("sessionstart-hook.js"));
});

