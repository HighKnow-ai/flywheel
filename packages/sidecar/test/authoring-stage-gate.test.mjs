/**
 * D-88 (plan 05-03): the stage-gate hook and its `writeHookSettings` wiring. Follows
 * `destructive-gate.test.mjs`'s own invocation pattern — spawn the SHIPPED compiled hook script
 * directly, feeding it the same stdin shape the backend writes, under a caller-supplied env — no
 * real `claude` binary needed for the hook's own decision logic. The settings-shape assertion
 * drives a real `ClaudeCodeAdapter.startSession` against `fake-claude.mjs` (mirroring
 * `adapter.test.mjs`'s own harness) and reads the resulting `<runtimeDir>/settings/<runId>.json`
 * back off disk. Plan 06-01 (`06-RESEARCH.md` Pitfall 1) made `writeHookSettings` an exported
 * function with an `includeAuthoringStageGate` parameter; `execution-hook-settings.test.mjs`
 * unit-tests it directly for both branches, while this file keeps its own integration-level proof
 * via a real spawn.
 *
 * G-05-8(b): what this file does and does not prove. It drives the SHIPPED compiled hook, which
 * is real; but every marker fixture below is HAND-WRITTEN by `scratchRuntimeDirWithStage` — this
 * file proves the hook's DECISION given a marker, and proves NOTHING about whether the product
 * ever writes one. `packages/core/tests/authoring_stage_marker_contract.rs` is the test that owns
 * that write-side contract, driving a real `start_authoring_run` through to the same shipped hook
 * this file also spawns. This separation is deliberate, not an omission — but it is worth stating
 * plainly, because for nine gap-closure rounds these two files each fabricated the other's state
 * (this file hand-writes the marker; that file asserts only the database row) and the product's
 * own disagreement between the two went unasserted the entire time. That is exactly the gap
 * `01M3DNC0G9CYAWSD8DYEGTRP8C` hit in production.
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

test("a legitimately-challenging run and a run whose marker cannot be read are denied for DIFFERENT reasons", () => {
  // G-05-8(b): this is the property the live run violated. During challenge a propose call
  // SHOULD be denied — that is D-88 working — but it must be denied by denyForChallengeStage,
  // whose reason tells the agent to keep challenging. A run whose marker cannot be read must
  // still fail closed (this assertion does NOT weaken that posture: both cases below deny and
  // both exit non-zero), but it must be denied by failClosed's own reason, never the other one.
  const challengeDir = scratchRuntimeDirWithStage("challenge");
  const absentDir = scratchRuntimeDirWithStage(undefined);

  const challenge = runHook(baseEnv(challengeDir));
  const absent = runHook(baseEnv(absentDir));

  assert.notEqual(challenge.status, 0, "the challenge-stage case must still deny");
  assert.notEqual(absent.status, 0, "the absent-marker case must still deny (fail-closed)");
  assert.equal(challenge.decision?.hookSpecificOutput?.permissionDecision, "deny");
  assert.equal(absent.decision?.hookSpecificOutput?.permissionDecision, "deny");

  const challengeReason = challenge.decision?.hookSpecificOutput?.permissionDecisionReason ?? "";
  const absentReason = absent.decision?.hookSpecificOutput?.permissionDecisionReason ?? "";

  assert.match(challengeReason, /challenge stage/);
  assert.doesNotMatch(absentReason, /challenge stage/);
  // A future edit that collapses these two paths into one message would hand a
  // legitimately-challenging agent an infrastructure error again — the exact defect that turned
  // a six-task epic into prose in run 01M3DNC0G9CYAWSD8DYEGTRP8C.
  assert.notEqual(challengeReason, absentReason, "the two denial reasons must never collapse into one message");
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

// Plan 06-01 (`06-RESEARCH.md` Pitfall 1): before this plan, `writeHookSettings` unconditionally
// wrote BOTH entries for every session, including an ordinary task-execution `startSession` run —
// this test used to assert that exact bug ("exactly two PreToolUse entries") as if it were the
// correct shape. It is corrected here to assert the fix: an execution run now gets exactly ONE
// entry (no `AUTHORING_STAGE_GATE_MATCHER`), because `propose_item`'s shared `propose_` prefix
// would otherwise be denied by the authoring stage gate before its own MCP handler is ever
// reached. `execution-hook-settings.test.mjs` (plan 06-01) unit-tests `writeHookSettings` directly
// for both the `false` and `true` branches; this integration-level test proves the SAME shape via
// a real `startSession` spawn, mirroring this file's own established harness.
test("an execution-run startSession writes exactly ONE PreToolUse entry, byte-identical to the pre-existing Bash entry", async () => {
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
  assert.equal(entries.length, 1, "expected exactly one PreToolUse entry for an execution run");
  assert.deepEqual(entries[0], {
    matcher: "Bash",
    hooks: [{ type: "command", command: `${process.execPath} ${path.join(__dirname, "..", "dist", "pretooluse-hook.js")}` }],
  });
  assert.ok(
    !entries.some((entry) => entry.matcher === AUTHORING_STAGE_GATE_MATCHER),
    "an execution run's settings file must carry no authoring stage-gate matcher",
  );

  delete process.env.FLYWHEEL_CLAUDE_BIN;
});
