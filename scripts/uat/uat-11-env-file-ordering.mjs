#!/usr/bin/env node
/**
 * UAT item 11 (plan 12-05, AGNT-07) — the phase's one credential-spending measurement. Three
 * questions, one real headless session:
 *
 *   1. Is P1 restored? `sessionstart-hook.ts` (plan 12-03) writes the shim's shadow directory onto
 *      `CLAUDE_ENV_FILE`, Claude Code's own documented PATH-restoration mechanism — but whether
 *      that file is actually SOURCED AFTER the shell snapshot, on the installed `claude` binary in
 *      headless mode, is `[CITED]` in `docs/destructive-gate-trust-boundary.md`, never `[VERIFIED]`.
 *      This script measures the ordering directly: it compares the FIRST segment of the agent's
 *      own command shell's `PATH` against the shim directory for this run.
 *   2. Is an ordinary command still ordinary? `git --version` must still just run — a tool_result
 *      arrives, no `permission_request` is ever raised for it. Round ten's live run failed on
 *      exactly this probe (120-second timeout waiting for `git --version`'s own `tool_result`), so
 *      this is the product's usability gate, not a recordable negative outcome: a failure here
 *      means revert the responsible change, never record a pass.
 *   3. Does the ask-branch discriminator survive into the command shell? Plan 12-04's pre-push
 *      "ask" branch depends on `FLYWHEEL_PERMISSION_SOCKET` reaching the command shell that runs
 *      `git push`. This measures whether it does, converting that branch from an assumption about
 *      an invisible process into a fact.
 *
 * Every probe asserts on a file ITS OWN command wrote, inside the harness scratch directory —
 * never on the agent's narration of what it ran (`destructive-gate.test.mjs`'s own standing rule,
 * applied here to a live item). Probe 2 is the one exception: "ordinary" is a property of the
 * SESSION's event stream (a `tool_result` arrives, no `permission_request` interrupts it), not a
 * file, so it is asserted against the sidecar's own events exactly as `uat-07-launcher-shape-gate.mjs`
 * asserts its own harmless-probe property.
 *
 * **Deliberate deviation from 12-RESEARCH.md Open Question 1, recorded in 12-05-PLAN.md's own
 * objective.** The research's sketch proposes a marker directory containing a stub `git` that
 * writes a file instead of running real git, proving PATH precedence behaviourally. This script
 * instead measures the real product wiring directly (the first `PATH` segment of the agent's own
 * command shell, compared against Flywheel's shim directory) — same question, no fake `git`, no
 * second settings file composed outside `writeHookSettings`, strictly cheaper.
 *
 * **A non-credential self-test arm (`--selftest`) spends no credentials and spawns no `claude`.**
 * It constructs each probe's evidence by hand — a matching and a mismatching `PATH` segment, an
 * absent probe file, and both socket-presence verdicts — and asserts the SAME pure verdict
 * functions the live arm calls return the expected classification for each, in both directions.
 * UAT 6a's own recorded finding (a vacuous pass because the watchdog killed the session before the
 * property was ever exercised) is why this exists: a green live run that cannot be told apart from
 * a green vacuous run is worth nothing, and this arm is what tells the difference.
 *
 * Spawns exactly ONE live session, through the harness's normal `startSidecar()`/`op: "spawn"`
 * path — the settings file under test comes from the product's own `writeHookSettings`
 * (`claude-code-adapter.ts`), never a settings file this script composes itself.
 *
 * ============================================================================================
 * D-63 — THE ONLY REMOTE THIS SCRIPT MAY EVER TOUCH IS THE LOCAL BARE REPOSITORY
 * `harness.createRepoWithRemote` CREATES INSIDE THE HARNESS SCRATCH DIRECTORY.
 * ============================================================================================
 * This script must NEVER add, name, or push to a network remote, and must NEVER run a destructive
 * git command outside that scratch repository. The reason is recorded, not hypothetical: a real,
 * unauthorized `git push` to this project's own GitHub remote
 * (`git@github.com:cymarechal/highknow-harness.git`) happened during the investigation that
 * produced the bypass-class finding this script measures, under a brief that fenced live `claude`
 * sessions but did not fence real destructive git commands — see the "Incident recorded during
 * this investigation" section of
 * `planning-archive:.planning/phases/03-nothing-lost-nothing-left-running/03-DESTRUCTIVE-GATE-BYPASS-CLASS.md`. D-63
 * (`03-CONTEXT.md`) exists so that lesson is a binding decision, not a comment someone can forget:
 * verification of this gate never executes the destructive command against a real remote or a real
 * worktree; where execution is genuinely required — as it is here — the brief names a throwaway
 * remote, and that throwaway remote is the ONLY thing this script is permitted to touch. This item
 * does not push, delete, or force anything at all — it only needs a worktree to spawn the agent
 * in — but the repo it works in is still built via `createRepoWithRemote`, so the invariant above
 * is reproduced exactly as every other live script in this directory carries it, rather than
 * silently dropped because this item happens not to need it.
 *
 * Costs real tokens (the live arm only): it drives one real model turn against the real installed
 * backend. `--selftest` costs nothing.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  claudeVersionString,
  drainIncidentalPermissionRequests,
  newRunId,
  probeClaudeAvailable,
  runScript,
  skip,
  step,
} from "./lib/sidecar-harness.mjs";

/** Round ten's own measured precedent (`12-05-PLAN.md`): the live run that timed out waiting 120
 * seconds for `git --version`'s `tool_result`. Both probe 2's bounded wait and its file-waiting
 * siblings (probes 1 and 3, part of the same turn) share this budget. */
const PROBE_DEADLINE_MS = 120_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- Pure verdict functions — the SAME code the live arm and --selftest both exercise ----------

/** Read `filePath`'s trimmed UTF-8 content, throwing (never guessing) when the file does not
 * exist — the file IS the evidence; an absent file is a failed probe, not an unanswered one. */
export function readProbeFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `PROBE FILE MISSING: expected ${filePath} to exist — the agent's command never ran, or never ` +
        "wrote its answer. Asserting on the file, never on the transcript's narration.",
    );
  }
  return fs.readFileSync(filePath, "utf8").trim();
}

/** Probe 1 — is P1 restored? `restored` when the observed first `PATH` segment equals the run's
 * shim directory, `snapshot-won` otherwise. Both are legitimate, recordable outcomes. */
export function classifyProbe1(observedFirstSegment, shimDir) {
  return observedFirstSegment === shimDir ? "restored" : "snapshot-won";
}

/** Probe 3 — does the ask-branch discriminator survive? `present`/`absent` are the only two
 * values the probe command can ever write; anything else is a probe-command defect, not a
 * legitimate third outcome, so it throws rather than silently classifying it as one. */
export function classifyProbe3(observedSocketFlag) {
  if (observedSocketFlag === "set") return "present";
  if (observedSocketFlag === "unset") return "absent";
  throw new Error(
    `PROBE 3 FAILED: unexpected content ${JSON.stringify(observedSocketFlag)} — the probe command ` +
      'only ever writes "set" or "unset".',
  );
}

/** Probe 2 — is an ordinary command still ordinary? Takes the race OUTCOME the live arm observed
 * (`"tool-result"`, `"permission-request"`, or `"timeout"`) and classifies it. Unlike probes 1 and
 * 3, a non-`success` verdict here is NOT a legitimate recordable outcome — the caller must still
 * fail the run naming this detail (12-05-PLAN.md Task 2's own action: "the correct next action is
 * a revert of the change responsible, not a documentation edit"). */
export function classifyProbe2(outcome) {
  if (outcome === "tool-result") {
    return { verdict: "success", detail: "a tool_result arrived for git --version and no permission_request was raised for it" };
  }
  if (outcome === "permission-request") {
    return {
      verdict: "permission-requested",
      detail: "a permission_request was raised for an ordinary `git --version` — round ten repeating",
    };
  }
  if (outcome === "timeout") {
    return {
      verdict: "timeout",
      detail: `git --version's tool_result never arrived within ${PROBE_DEADLINE_MS}ms — round ten's own precedent`,
    };
  }
  throw new Error(`unrecognised probe 2 outcome: ${JSON.stringify(outcome)}`);
}

/** Poll for `filePath` to exist, bounded by `timeoutMs`, then return its trimmed content via
 * {@link readProbeFile}. The async sibling of the pure, synchronous `readProbeFile` above — kept
 * separate so `--selftest` can exercise the synchronous assertion with zero real time elapsed. */
async function waitForFileContent(filePath, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fs.existsSync(filePath)) return readProbeFile(filePath);
    if (Date.now() >= deadline) {
      throw new Error(
        `PROBE FILE NEVER APPEARED: ${label} expected ${filePath} to exist within ${timeoutMs}ms.`,
      );
    }
    await sleep(500);
  }
}

// ---- The non-credential self-test arm ------------------------------------------------------------

/** Constructs each probe's evidence by hand and asserts the SAME verdict functions the live arm
 * calls classify it correctly — both the positive case and the three negative cases 12-05-PLAN.md
 * names: a deliberately wrong first `PATH` segment, an absent probe file, and each socket verdict.
 * Spends no credentials, spawns no `claude`. */
function runSelfTest(harness) {
  const dir = path.join(harness.root, "selftest-probes");
  fs.mkdirSync(dir, { recursive: true });
  const SHIM_DIR = "/fake/flywheel-shim-dir/for-selftest-only";

  // --- Probe 1 ------------------------------------------------------------------------------
  assert.equal(classifyProbe1(SHIM_DIR, SHIM_DIR), "restored");
  assert.equal(classifyProbe1("/some/unrelated/dir", SHIM_DIR), "snapshot-won");
  step("probe1 verdict (selftest): matching segment -> restored, wrong segment -> snapshot-won");

  const p1File = path.join(dir, "probe1.txt");
  fs.writeFileSync(p1File, `${SHIM_DIR}\n`);
  assert.equal(readProbeFile(p1File), SHIM_DIR);
  const missingFile = path.join(dir, "never-written.txt");
  assert.throws(() => readProbeFile(missingFile), /PROBE FILE MISSING/);
  step("probe1 file assertion (selftest): reads an existing file, throws on an absent probe file");

  // --- Probe 2 --------------------------------------------------------------------------------
  assert.equal(classifyProbe2("tool-result").verdict, "success");
  assert.equal(classifyProbe2("permission-request").verdict, "permission-requested");
  assert.equal(classifyProbe2("timeout").verdict, "timeout");
  step("probe2 verdict (selftest): success, permission-requested, and timeout all classified correctly");

  // --- Probe 3 --------------------------------------------------------------------------------
  assert.equal(classifyProbe3("set"), "present");
  assert.equal(classifyProbe3("unset"), "absent");
  assert.throws(() => classifyProbe3("neither"), /PROBE 3 FAILED/);
  step("probe3 verdict (selftest): set -> present, unset -> absent, anything else throws");

  fs.rmSync(dir, { recursive: true, force: true });
}

// ---- The live arm ---------------------------------------------------------------------------------

async function runLiveProbes(harness) {
  if (!probeClaudeAvailable()) {
    skip("the real `claude` binary is not resolvable — this item needs a live backend session");
  }

  step(
    "creating a scratch repository with a local bare remote (D-63: the only remote in play, even " +
      "though this item never pushes, deletes, or forces anything on it)",
  );
  const { workPath, defaultBranch } = harness.createRepoWithRemote();

  const runId = newRunId();
  const env = harness.sessionEnv(runId, defaultBranch);
  const shimDir = env.PATH.split(path.delimiter)[0];
  step(`spawn env resolved; shim dir leads PATH: ${shimDir}`);

  const probeDir = path.join(harness.root, "env-file-ordering-probes");
  fs.mkdirSync(probeDir, { recursive: true });
  const p1Path = path.join(probeDir, "probe1-path-segment.txt");
  const p3Path = path.join(probeDir, "probe3-socket-presence.txt");

  step("starting the real sidecar and completing its readiness handshake");
  const sidecar = await harness.startSidecar();

  /** `true` only for a `permission_request` raised for the probe 2 command itself — left
   * deliberately unanswered so its arrival (or absence) is the measurement, exactly the way
   * `uat-07-launcher-shape-gate.mjs`'s own `isDeliberateRequest` scopes its one deliberate
   * request. Everything else (Claude Code's own internal session-startup git housekeeping) is
   * incidental and gets auto-allowed below so it cannot starve this turn. */
  const isDeliberate = (event) =>
    event.type === "permission_request" &&
    typeof event.input?.command === "string" &&
    /git\s+--version/.test(event.input.command);

  step("spawning a real claude session in bypassPermissions (auto-accept) mode");
  await sidecar.request({
    op: "spawn",
    runId,
    worktreePath: workPath,
    prompt:
      "Run exactly these three shell commands, in order, using your Bash tool and nothing else. " +
      "Do not ask me for confirmation first; just run them, one after the other.\n\n" +
      `1. Run exactly: printf '%s' "\${PATH%%:*}" > "${p1Path}"\n\n` +
      "2. Run exactly: git --version\n\n" +
      `3. Run exactly: if [ -n "$FLYWHEEL_PERMISSION_SOCKET" ]; then printf 'set' > "${p3Path}"; else printf 'unset' > "${p3Path}"; fi\n`,
    permissionMode: "bypassPermissions",
    env,
  });

  // Fire-and-forget, stopped via onCleanup — see uat-07's own identical pattern and
  // lib/sidecar-harness.mjs's doc comment on drainIncidentalPermissionRequests.
  let draining = true;
  harness.onCleanup(() => {
    draining = false;
  });
  drainIncidentalPermissionRequests(sidecar, runId, isDeliberate, () => !draining);

  step("waiting for probe 1's file: the first PATH segment the command shell observed");
  const observedFirstSegment = await waitForFileContent(p1Path, PROBE_DEADLINE_MS, "probe 1 (PATH segment)");
  const probe1 = {
    verdict: classifyProbe1(observedFirstSegment, shimDir),
    observed: observedFirstSegment,
    shimDir,
  };
  step(`PROBE 1 verdict: ${probe1.verdict} (observed="${probe1.observed}", shimDir="${shimDir}")`);

  step("waiting for the agent to attempt git --version (probe 2)");
  const outcome = await Promise.race([
    sidecar
      .waitForEvent(
        (event) =>
          event.type === "tool_result" &&
          /git version/i.test(event.raw ?? "") &&
          /"is_error":false/.test(event.raw ?? ""),
        PROBE_DEADLINE_MS,
        "git --version's tool_result (a clean, non-error result)",
      )
      .then(() => "tool-result"),
    sidecar
      .waitForEvent(isDeliberate, PROBE_DEADLINE_MS, "a permission_request for git --version")
      .then(() => "permission-request"),
  ]).catch(() => "timeout");
  const probe2 = classifyProbe2(outcome);
  step(`PROBE 2 verdict: ${probe2.verdict} (${probe2.detail})`);

  step("waiting for probe 3's file: whether FLYWHEEL_PERMISSION_SOCKET reached the command shell");
  const observedSocketFlag = await waitForFileContent(p3Path, PROBE_DEADLINE_MS, "probe 3 (socket presence)");
  const probe3 = { verdict: classifyProbe3(observedSocketFlag), observed: observedSocketFlag };
  step(`PROBE 3 verdict: ${probe3.verdict} (observed="${probe3.observed}")`);

  const claudeVersion = claudeVersionString();
  const artifactPath = harness.writeArtifact("probes", { runId, claudeVersion, probe1, probe2, probe3 });
  step(`wrote uat-11 artifact: ${artifactPath}`);

  // Probe 2 is the product's usability gate, not a recordable negative outcome (12-05-PLAN.md
  // Task 2's own action): the artifact is already written above, so even a failure here leaves
  // the evidence on disk for the revert this failure calls for.
  assert.equal(
    probe2.verdict,
    "success",
    `PROBE 2 FAILED (the product's usability gate): ${probe2.detail}. This is round ten repeating, ` +
      "a genuine regression, not a recordable negative outcome -- the correct next action is a " +
      "revert of the change responsible, never a documentation edit recording a pass.",
  );
}

// ---- Entry point -----------------------------------------------------------------------------------

const SELFTEST = process.argv.includes("--selftest");

await runScript(
  "uat-11-env-file-ordering",
  SELFTEST
    ? "UAT 11 (--selftest) — env-file-ordering verdict functions, offline, zero tokens"
    : "UAT 11 — CLAUDE_ENV_FILE ordering, PATH shadow restoration, and the ask-branch discriminator, " +
        "measured live (AGNT-07; the three live guarantees are backstop truths)",
  async (harness) => {
    if (SELFTEST) {
      runSelfTest(harness);
      return;
    }
    await runLiveProbes(harness);
  },
);
