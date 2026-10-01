/**
 * Phase 12 plan 12-03, Task 1 — unit coverage for `sessionstart-hook.ts`'s own `<behavior>` arms:
 * the positive arm (writes a PATH-prepending line into `CLAUDE_ENV_FILE`), the append arm (a
 * pre-seeded marker survives byte-for-byte), and the four degrade arms (`CLAUDE_ENV_FILE` unset,
 * `FLYWHEEL_SHIM_BIN` unset, a non-existent target directory, a shim directory containing a
 * space). Zero credential spend — nothing here spawns `claude`.
 *
 * Task 2 extends this SAME file with the `writeHookSettings` settings-shape arm and the mandatory
 * suite-wide benign-command arm.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { sessionStartHookScriptPath } from "../dist/claude-code-adapter.js";

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
});
