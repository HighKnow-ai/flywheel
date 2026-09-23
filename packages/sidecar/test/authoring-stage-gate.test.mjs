/**
 * D-88 (plan 05-03): the stage-gate hook and its `writeHookSettings` wiring. Follows
 * `destructive-gate.test.mjs`'s own invocation pattern — spawn the SHIPPED compiled hook script
 * directly, feeding it the same stdin shape the backend writes, under a caller-supplied env — no
 * real `claude` binary needed for the hook's own decision logic. The settings-shape assertions
 * (task d's "exactly two `PreToolUse` entries") drive a real `ClaudeCodeAdapter.startSession`
 * against `fake-claude.mjs` (mirroring `adapter.test.mjs`'s own harness) and read the resulting
 * `<runtimeDir>/settings/<runId>.json` back off disk, since `writeHookSettings` itself is a
 * private function this module never exports.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  AUTHORING_STAGE_GATE_MATCHER,
  ClaudeCodeAdapter,
  stageGateHookScriptPath,
} from "../dist/claude-code-adapter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FAKE_CLAUDE = path.join(__dirname, "fake-claude.mjs");
const A_RUN_ID = "run-authoring-stage-gate-test";

/** Run the SHIPPED compiled hook script directly, feeding it the same `tool_input.command`-shaped
 * (but here mostly irrelevant — this hook never reads it) payload the backend writes to stdin,
 * under a caller-supplied env. Mirrors `destructive-gate.test.mjs::runHook` exactly. */
function runHook(env, payload = { tool_name: "mcp__flywheel-permissions__propose_task", tool_input: {} }) {
  const hookPath = stageGateHookScriptPath();
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env,
  });
  let decision;
  try {
    decision = JSON.parse(result.stdout);
  } catch {
    decision = undefined;
  }
  return { status: result.status, decision };
}

/** A scratch `<runtimeDir>` with a `stage/<runId>.json` marker already written, mirroring the
 * shape `core::runtime_protocol::write_authoring_stage` produces. */
function scratchRuntimeDirWithStage(stage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-stagegate-"));
  const stageDir = path.join(dir, "stage");
  fs.mkdirSync(stageDir, { recursive: true });
  if (stage !== undefined) {
    fs.writeFileSync(
      path.join(stageDir, `${A_RUN_ID}.json`),
      JSON.stringify({ stage, written_at: new Date().toISOString() }),
    );
  }
  return dir;
}

function baseEnv(runtimeDir, runId = A_RUN_ID) {
  return { ...process.env, FLYWHEEL_RUN_ID: runId, FLYWHEEL_RUNTIME_DIR: runtimeDir };
}

test("the hook denies a proposal call during the challenge stage, naming the stage", () => {
  const dir = scratchRuntimeDirWithStage("challenge");
  const { status, decision } = runHook(baseEnv(dir));
  assert.notEqual(status, 0);
  assert.equal(decision?.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(decision?.hookSpecificOutput?.permissionDecisionReason ?? "", /challenge stage/);
});

test("the hook produces no denial for the decompose stage", () => {
  const dir = scratchRuntimeDirWithStage("decompose");
  const { status, decision } = runHook(baseEnv(dir));
  assert.equal(status, 0);
  assert.deepEqual(decision, {});
});

test("the hook produces no denial for the criteria stage", () => {
  const dir = scratchRuntimeDirWithStage("criteria");
  const { status, decision } = runHook(baseEnv(dir));
  assert.equal(status, 0);
  assert.deepEqual(decision, {});
});

test("a missing marker file denies (fail-closed)", () => {
  const dir = scratchRuntimeDirWithStage(undefined);
  const { status, decision } = runHook(baseEnv(dir));
  assert.notEqual(status, 0);
  assert.equal(decision?.hookSpecificOutput?.permissionDecision, "deny");
});

test("a marker holding an unrecognised stage denies (fail-closed)", () => {
  const dir = scratchRuntimeDirWithStage("not-a-real-stage");
  const { status, decision } = runHook(baseEnv(dir));
  assert.notEqual(status, 0);
  assert.equal(decision?.hookSpecificOutput?.permissionDecision, "deny");
  assert.match(decision?.hookSpecificOutput?.permissionDecisionReason ?? "", /unrecognised stage/);
});

test("an unset FLYWHEEL_RUN_ID denies (fail-closed)", () => {
  const dir = scratchRuntimeDirWithStage("decompose");
  const env = { ...process.env, FLYWHEEL_RUNTIME_DIR: dir };
  delete env.FLYWHEEL_RUN_ID;
  const { status, decision } = runHook(env);
  assert.notEqual(status, 0);
  assert.equal(decision?.hookSpecificOutput?.permissionDecision, "deny");
});

test("an unset FLYWHEEL_RUNTIME_DIR denies (fail-closed)", () => {
  const env = { ...process.env, FLYWHEEL_RUN_ID: A_RUN_ID };
  delete env.FLYWHEEL_RUNTIME_DIR;
  const { status, decision } = runHook(env);
  assert.notEqual(status, 0);
  assert.equal(decision?.hookSpecificOutput?.permissionDecision, "deny");
});

test("a hook payload carrying a different runId than the environment does not change the decision (the payload is ignored)", () => {
  // T-05-03-02: the run this hook decides against is named by ITS OWN environment only. A
  // spoofed runId inside the payload must never let one session read (or influence a decision
  // about) another session's stage marker — this run's own marker is `decompose` (allow), and a
  // payload naming a DIFFERENT run id (whose marker does not even exist) must not flip that.
  const dir = scratchRuntimeDirWithStage("decompose");
  const { status, decision } = runHook(baseEnv(dir), {
    runId: "run-some-other-session-entirely",
    tool_name: "mcp__flywheel-permissions__propose_task",
    tool_input: { runId: "run-some-other-session-entirely" },
  });
  assert.equal(status, 0);
  assert.deepEqual(decision, {});
});

test("stage-gate-hook.ts never reads a run id out of the hook payload", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "stage-gate-hook.ts"), "utf8");
  const stripped = source
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
  assert.doesNotMatch(stripped, /payload\.(runId|run_id)|tool_input\.runId/);
});

test("the second matcher regex compiles and matches propose_task while not matching approve_action, report_summary, or a read tool", () => {
  const matcher = new RegExp(`^${AUTHORING_STAGE_GATE_MATCHER}$`);
  assert.match("mcp__flywheel-permissions__propose_task", matcher);
  assert.doesNotMatch("mcp__flywheel-permissions__approve_action", matcher);
  assert.doesNotMatch("mcp__flywheel-permissions__report_summary", matcher);
  assert.doesNotMatch("mcp__flywheel-permissions__get_epic", matcher);
});

test("writeHookSettings writes exactly two PreToolUse entries, the first byte-identical to the pre-existing Bash entry", async () => {
  process.env.FLYWHEEL_CLAUDE_BIN = FAKE_CLAUDE;
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-stagegate-settings-"));
  const adapter = new ClaudeCodeAdapter();

  await adapter.startSession({
    runId: "run-settings-shape-test",
    worktreePath: process.cwd(),
    prompt: "say hi",
    permissionMode: "acceptEdits",
    env: { FLYWHEEL_RUNTIME_DIR: runtimeDir },
    onEvent: () => {},
  });

  const settingsPath = path.join(runtimeDir, "settings", "run-settings-shape-test.json");
  const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
  const entries = settings.hooks.PreToolUse;
  assert.equal(entries.length, 2, "expected exactly two PreToolUse entries");
  assert.deepEqual(entries[0], {
    matcher: "Bash",
    hooks: [{ type: "command", command: `${process.execPath} ${path.join(__dirname, "..", "dist", "pretooluse-hook.js")}` }],
  });
  assert.equal(entries[1].matcher, AUTHORING_STAGE_GATE_MATCHER);

  delete process.env.FLYWHEEL_CLAUDE_BIN;
});
