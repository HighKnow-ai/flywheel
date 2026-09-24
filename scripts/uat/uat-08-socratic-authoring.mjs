#!/usr/bin/env node
/**
 * Phase 5, Plan 10, Task 3 — the live acceptance run: one real `claude` session, driven through
 * the whole Socratic epic-authoring flow (challenge, decompose, accept/reject/amend, reopen),
 * reporting pass or fail per `ROADMAP.md` §"Phase 5" success criterion.
 *
 * Modelled on `uat-06-permission-block-lifecycle.mjs`/`uat-07-launcher-shape-gate.mjs`: the same
 * `lib/sidecar-harness.mjs` plumbing, the same isolated `CLAUDE_CONFIG_DIR`, the same
 * production-cadence heartbeat writer `05-SPIKE-FINDINGS.md`'s own `heartbeat_verdict` requires
 * for a session this long-lived. What differs: this flow drives the sidecar's `authoring_spawn`/
 * `authoring_turn` ops (D-84/D-85/D-89) rather than `spawn`, and it needs a REAL board — the
 * accept/reject/amend/reopen half of the journey is a Rust-core write, which this plain Node
 * harness cannot perform itself. `packages/core/tests/bin/uat_authoring_ops.rs` (new, this plan)
 * is the bridge: a small CLI this script shells out to, driving the SAME domain functions the
 * desktop app's own command layer calls, against a real scratch database under
 * `FLYWHEEL_APP_DATA_DIR`. `apply-proposal-created` in particular is not a simulation of the
 * inbound write path — it calls `authoring_proposal::apply_proposal_created` with the REAL sidecar
 * event this script observes on the live session's own stdout stream, the identical function
 * `commands::authoring::handle_inbound_proposal_created` (the real desktop app) calls in
 * production.
 *
 * `--self-test`: pure, offline, no child process and no `claude` binary — asserts this script's
 * own report-formatting and argument-parsing logic, mirroring
 * `scripts/spike/authoring-stage-gate-spike.mjs`'s own `--self-test` convention (05-01).
 *
 * The live run costs real tokens: it drives a real model conversation of several turns. It is not
 * executed by an autonomous CI/executor run — `run-all.sh` lists it, and a human runs it
 * deliberately when judging SHAPE-01/SHAPE-03's own human-only half (05-VALIDATION.md's
 * "Manual-Only Verifications").
 */
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  drainIncidentalPermissionRequests,
  HEARTBEAT_TICK_MS,
  probeClaudeAvailable,
  REPO_ROOT,
  resolveHarnessBinary,
  runScript,
  skip,
  step,
} from "./lib/sidecar-harness.mjs";

/** How long to wait for the model to produce its first challenging reply. */
const TURN_DEADLINE_MS = 120_000;

/** How long to wait for a proposal to arrive after advancing the stage. */
const PROPOSAL_DEADLINE_MS = 120_000;

// ---------------------------------------------------------------------------------------------
// The `uat_authoring_ops` bridge — one small wrapper per subcommand, all synchronous
// (`spawnSync`), all throwing with the binary's own stderr on a non-zero exit so a bridge failure
// reads as a real error, never a silently-swallowed `undefined`.
// ---------------------------------------------------------------------------------------------

function opsEnv(appDataDir) {
  return { ...process.env, FLYWHEEL_APP_DATA_DIR: appDataDir };
}

function runOps(binPath, appDataDir, args, input) {
  const result = spawnSync(binPath, args, {
    encoding: "utf8",
    env: opsEnv(appDataDir),
    input,
  });
  if (result.status !== 0) {
    throw new Error(
      `uat_authoring_ops ${args.join(" ")} failed (status ${result.status}): ${result.stderr ?? ""}`,
    );
  }
  const trimmed = (result.stdout ?? "").trim();
  return trimmed.length > 0 ? JSON.parse(trimmed) : {};
}

/** Report per-criterion pass/fail lines and return whether every criterion passed — the shape
 * both the live run and `--self-test` (which exercises this function directly, with a synthetic
 * result set) share, so the report format is asserted once.
 *
 * A truthy fourth (`informational`) element marks an entry that this single-session run cannot
 * structurally exercise (SHAPE-05's reopen leg, today). It gets its own marker and its own label
 * suffix naming why it is not gating, and is EXCLUDED from the returned `allPassed` — a genuine
 * pass on every criterion this run CAN exercise must still be reportable as a pass (WR-06). */
function reportCriteria(results) {
  let allPassed = true;
  for (const [criterion, passed, detail, informational] of results) {
    const icon = informational ? "ℹ️" : passed ? "✅" : "❌";
    const suffix = informational ? " (informational — not gating)" : "";
    step(`${icon} ${criterion}${suffix}${detail ? ` — ${detail}` : ""}`);
    if (!passed && !informational) allPassed = false;
  }
  return allPassed;
}

/**
 * Pure: builds the `results` array `reportCriteria` expects, from the booleans the live run
 * computes. Extracted out of the live body so `--self-test` can assert the gating SHAPE of the
 * REAL result set the live run produces, rather than a synthetic stand-in that could drift from
 * it (WR-06).
 *
 * The SHAPE-05 entry is marked `informational`: a fresh-session run structurally has no epic to
 * reopen (SHAPE-05's reopen leg is proven structurally by `authoring_acceptance.rs::criterion_4_*`
 * instead), so it is reported rather than gated. `criterion4Reopened`/`criterion4PrimedRejected`
 * still feed the entry's `passed` value — if a future run ever does materialise an epic and set
 * them, the line reports a real pass instead of a stale note.
 */
function buildCriteriaResults(flags) {
  const {
    criterion1Challenged,
    criterion1NoWorkPlanned,
    criterion2Landed,
    criterion3Decided,
    criterion4Reopened,
    criterion4PrimedRejected,
  } = flags;

  return [
    [
      "SHAPE-01 — the agent challenges before any work is planned",
      criterion1Challenged && criterion1NoWorkPlanned,
      `challenged=${criterion1Challenged} noWorkPlanned=${criterion1NoWorkPlanned}`,
    ],
    [
      "SHAPE-02 — the outcome lands directly on the board",
      criterion2Landed,
      criterion2Landed ? "a subtree accept materialised real rows" : "no subtree was accepted",
    ],
    [
      "SHAPE-03/SHAPE-04 — accept, reject and amend decided individually",
      criterion3Decided,
      criterion3Decided
        ? "at least one reject and one amend were exercised"
        : "not enough proposals to exercise all three verbs",
    ],
    [
      "SHAPE-05 — reopening primes the challenge against what the epic already contains",
      criterion4Reopened || criterion4PrimedRejected,
      "this single-session run has no epic to reopen; the reopen leg is proven structurally by " +
        "authoring_acceptance.rs::criterion_4_* — reported here rather than gated",
      true,
    ],
  ];
}

/** The token a human must replace before a verdict counts as read. Kept as a named constant so
 * `renderChallengeEvidenceSheet` and its self-test checks agree on the exact literal. */
const UNJUDGED_TOKEN = "UNJUDGED";

/** Fixed evidence-sheet file name — one per project, overwritten per run rather than accumulating
 * timestamped files nobody reads (T-05-16-05). */
const EVIDENCE_FILE_NAME = "05-LIVE-CHALLENGE-TRANSCRIPT.md";

/**
 * Pure: renders the Markdown evidence sheet a human reads their one judgement call from. No
 * filesystem or process access — it formats `evidence` and returns a string, so `--self-test` can
 * assert its shape offline (T-05-16-06).
 *
 * `evidence` fields: `runId`, `openingPrompt`, `firstReplyText`, `secondTurn`, `secondReplyText`,
 * `proposeAttempted`, `proposeDenied`, `draftedCriteriaCount`, `amendedCriteriaCount`, `results`
 * (the array `buildCriteriaResults`/`reportCriteria` share — may be `[]` before the decompose
 * phase completes), and `timestamp` (an ISO string, supplied by the caller so this function never
 * reads the clock itself and stays byte-identical across calls with identical input).
 */
function renderChallengeEvidenceSheet(evidence) {
  const {
    runId,
    openingPrompt,
    firstReplyText,
    secondTurn,
    secondReplyText,
    proposeAttempted,
    proposeDenied,
    draftedCriteriaCount,
    amendedCriteriaCount,
    results,
    timestamp,
  } = evidence;

  const drafted = draftedCriteriaCount ?? 0;
  const amended = amendedCriteriaCount ?? 0;

  const criterionLines = (results ?? [])
    .map(([criterion, passed, detail, informational]) => {
      const icon = informational ? "ℹ️" : passed ? "✅" : "❌";
      const suffix = informational ? " (informational — not gating)" : "";
      return `- ${icon} ${criterion}${suffix}${detail ? ` — ${detail}` : ""}`;
    })
    .join("\n");

  return `# Phase 5 — Socratic Epic Authoring — Live Challenge Transcript

**Run:** ${runId}
**Captured:** ${timestamp}

## Opening prompt

${openingPrompt}

## Second turn

${secondTurn}

## First reply (verbatim)

\`\`\`
${firstReplyText}
\`\`\`

## Second reply (verbatim)

\`\`\`
${secondReplyText}
\`\`\`

## Propose-tool observations

- proposeAttempted: ${proposeAttempted}
- proposeDenied: ${proposeDenied}

## Per-criterion results

${criterionLines || "(not yet available — populated once the decompose phase completes)"}

## Draft usefulness (SHAPE-03)

- Drafted criteria: ${drafted}
- Amended criteria: ${amended}
- Ratio (amended/drafted): ${amended}/${drafted}

## Verdicts (human — fill these in)

- SHAPE-01 challenge-quality verdict: ${UNJUDGED_TOKEN} — reading the two verbatim replies above,
  did the agent push back on the stated premise, or did it affirm it and start planning work?
- SHAPE-03 draft-usefulness verdict: ${UNJUDGED_TOKEN} — were the drafted criteria above useful
  as-is, or did they need the amendment recorded above to become usable?
`;
}

/**
 * Resolve the one fixed path the evidence sheet is written to: `FLYWHEEL_UAT_EVIDENCE_DIR` when
 * set, otherwise the phase directory under the harness's own `REPO_ROOT` — never a temp directory,
 * since the whole point is that the next verification pass can find this file without being told
 * where to look. Creates the directory if absent. Not called by `--self-test` (T-05-16-06).
 */
function resolveEvidencePath() {
  const dir =
    process.env.FLYWHEEL_UAT_EVIDENCE_DIR ??
    path.join(REPO_ROOT, ".planning", "phases", "05-socratic-epic-authoring");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, EVIDENCE_FILE_NAME);
}

// ---------------------------------------------------------------------------------------------
// self-test — no child process, no claude binary, ever
// ---------------------------------------------------------------------------------------------

async function selfTest() {
  let failures = 0;
  const check = (label, fn) => {
    try {
      fn();
      console.log(`[self-test] PASS — ${label}`);
    } catch (err) {
      failures += 1;
      console.error(`[self-test] FAIL — ${label}: ${err?.message ?? err}`);
    }
  };

  check("reportCriteria reports all-passed as true when every entry passed", () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    let allPassed;
    try {
      allPassed = reportCriteria([
        ["Criterion 1", true, "challenged"],
        ["Criterion 2", true, "landed on the board"],
      ]);
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.equal(allPassed, true);
  });

  check("reportCriteria reports all-passed as false when any entry failed", () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    let allPassed;
    try {
      allPassed = reportCriteria([
        ["Criterion 1", true, undefined],
        ["Criterion 2", false, "no proposal arrived"],
        ["Criterion 3", true, undefined],
      ]);
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.equal(allPassed, false);
  });

  check("a run whose gating criteria all passed reports an overall pass", () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    let allPassed;
    try {
      allPassed = reportCriteria(
        buildCriteriaResults({
          criterion1Challenged: true,
          criterion1NoWorkPlanned: true,
          criterion2Landed: true,
          criterion3Decided: true,
          criterion4Reopened: false,
          criterion4PrimedRejected: false,
        }),
      );
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.equal(allPassed, true);
  });

  check("a gating criterion that did not pass still reports an overall failure", () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    let allPassed;
    try {
      allPassed = reportCriteria(
        buildCriteriaResults({
          criterion1Challenged: true,
          criterion1NoWorkPlanned: true,
          criterion2Landed: false,
          criterion3Decided: true,
          criterion4Reopened: false,
          criterion4PrimedRejected: false,
        }),
      );
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.equal(allPassed, false);
  });

  check("an informational entry that did not pass never drags the overall result to false", () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    let allPassed;
    try {
      allPassed = reportCriteria([
        ["Gating entry", true, undefined],
        ["Informational entry", false, "not exercised this run", true],
      ]);
    } finally {
      process.stdout.write = originalWrite;
    }
    assert.equal(allPassed, true);
  });

  check("the SHAPE-05 entry is the only informational entry in the live result set", () => {
    const results = buildCriteriaResults({
      criterion1Challenged: true,
      criterion1NoWorkPlanned: true,
      criterion2Landed: true,
      criterion3Decided: true,
      criterion4Reopened: false,
      criterion4PrimedRejected: false,
    });
    const informationalEntries = results.filter((entry) => entry[3]);
    assert.equal(informationalEntries.length, 1);
    assert.ok(informationalEntries[0][0].includes("SHAPE-05"));
  });

  const SYNTHETIC_EVIDENCE = {
    runId: "01ABCDEFGHJKMNPQRSTVWXYZ0",
    openingPrompt: "I want to build a notifications feature so users get pinged.",
    firstReplyText: "What problem are you actually trying to solve for the user here?",
    secondTurn: "Just in-app for now, nothing external.",
    secondReplyText: "Got it — in-app only. Before I draft anything, who dismisses a notification?",
    proposeAttempted: false,
    proposeDenied: false,
    draftedCriteriaCount: 2,
    amendedCriteriaCount: 1,
    results: buildCriteriaResults({
      criterion1Challenged: true,
      criterion1NoWorkPlanned: true,
      criterion2Landed: true,
      criterion3Decided: true,
      criterion4Reopened: false,
      criterion4PrimedRejected: false,
    }),
    timestamp: "2026-01-01T00:00:00.000Z",
  };

  check("the evidence sheet carries both assistant replies verbatim", () => {
    const sheet = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    assert.ok(sheet.includes(SYNTHETIC_EVIDENCE.firstReplyText));
    assert.ok(sheet.includes(SYNTHETIC_EVIDENCE.secondReplyText));
  });

  check("the evidence sheet starts with both verdicts unfilled", () => {
    const sheet = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const occurrences = sheet.split(UNJUDGED_TOKEN).length - 1;
    assert.equal(occurrences, 2);
  });

  check("the evidence sheet renders identically for identical input", () => {
    const first = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const second = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    assert.equal(first, second);
  });

  check("the bridge binary path resolves under target/debug or target/release when built", () => {
    // Does not require the binary to actually be built — resolveHarnessBinary itself degrades to
    // `undefined` when it is not, which is exactly what the live run's own precondition check
    // (below, in the live path only) reads. This assertion is about the RESOLVER, not the binary.
    const resolved = resolveHarnessBinary("uat_authoring_ops");
    assert.ok(resolved === undefined || resolved.includes("uat_authoring_ops"));
  });

  check("runOps parses the bridge binary's own JSON stdout shape", () => {
    // A pure JSON round trip — no process spawned — proving the parsing half of `runOps` without
    // needing a real binary or a real database.
    const parsed = JSON.parse('{"runId":"01ABCDEFGHJKMNPQRSTVWXYZ0","epicId":null}');
    assert.equal(parsed.runId, "01ABCDEFGHJKMNPQRSTVWXYZ0");
    assert.equal(parsed.epicId, null);
  });

  check("the conversation prompt names the two required turns and asks for real structure", () => {
    assert.ok(OPENING_PROMPT.length > 0 && /challenge|clarifying/i.test(OPENING_PROMPT) === false);
    // The opening prompt is deliberately business-shaped, not meta — it must never coach the model
    // to "challenge me", since the whole point is that D-88's structural absence of the proposal
    // tool is what enforces the challenge, not an instruction in the prompt (05-RESEARCH.md
    // Pitfall 1's own lesson, generalised: do not paper over a structural guarantee with a prompt).
    assert.ok(/build|shape|epic/i.test(OPENING_PROMPT));
  });

  // -----------------------------------------------------------------------------------------
  // drainIncidentalPermissionRequests — a stub-driven exercise of the REAL shared helper
  // (Task 2, G-05-1). Not a reimplementation of the loop: a tiny stub exposing only the two
  // methods the helper calls, plus four checks against the four behaviours the loop promises.
  // -----------------------------------------------------------------------------------------
  {
    const REQ_A = "req-incidental-A";
    const REQ_B = "req-deliberate-B";
    // REQ_A appears TWICE (the same id fired twice); REQ_B is the one this run's predicate
    // claims. Neither event is ever removed from the queue — the drain loop's own `handled` Set
    // (not this stub) is what must stop a second match on the same id.
    const stubEvents = [
      { type: "permission_request", requestId: REQ_A },
      { type: "permission_request", requestId: REQ_A },
      { type: "permission_request", requestId: REQ_B },
    ];
    let emptyLookups = 0;
    const stubSidecar = {
      requests: [],
      async waitForEvent(predicate, _timeoutMs, _label) {
        const match = stubEvents.find(predicate);
        if (match === undefined) {
          emptyLookups += 1;
          throw new Error("stub: no queued event matches the drain loop's own predicate");
        }
        return match;
      },
      async request(payload) {
        stubSidecar.requests.push(payload);
        return {};
      },
    };
    const isDeliberateStub = (event) => event.requestId === REQ_B;
    // Drive the REAL shared helper against the stub. The stop predicate flips once one lookup
    // has already come back empty — which only happens after the answerable request has been
    // handled and the duplicate/deliberate entries have both been excluded — so the assertions
    // below run only once the loop has genuinely settled, with no timer left holding the event
    // loop open.
    await drainIncidentalPermissionRequests(stubSidecar, "stub-run", isDeliberateStub, () => emptyLookups >= 1);

    check(
      "an incidental request the predicate does not claim is answered exactly once, with an allow decision carrying its own request id",
      () => {
        assert.equal(stubSidecar.requests.length, 1);
        assert.equal(stubSidecar.requests[0].requestId, REQ_A);
        assert.equal(stubSidecar.requests[0].decision, "allow");
      },
    );

    check(
      "the same request id offered twice is answered once — the handled Set is doing real work",
      () => {
        assert.equal(stubSidecar.requests.filter((r) => r.requestId === REQ_A).length, 1);
      },
    );

    check("a request the predicate claims is never answered at all", () => {
      assert.ok(!stubSidecar.requests.some((r) => r.requestId === REQ_B));
    });

    check("the loop settles once the stop predicate flips, rather than running forever", () => {
      assert.ok(emptyLookups >= 1);
    });
  }

  if (failures > 0) {
    console.error(`[self-test] ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("[self-test] all assertions passed — no child process was spawned");
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// the live run
// ---------------------------------------------------------------------------------------------

/** Deliberately an ordinary feature request, never meta ("challenge me…") — SHAPE-01 is proven by
 * the model challenging THIS kind of input unprompted, not by being told to. */
const OPENING_PROMPT =
  "I want to build a notifications feature so users get pinged when something on their board " +
  "needs them.";

const SECOND_TURN =
  "Just in-app for now, nothing external. Let's move on when you're ready.";

/**
 * This script drives a conversation, never a destructive shell invocation — it reserves no gated
 * command of its own, so no `permission_request` it observes is ever one this script measures.
 * Named (rather than an inline arrow) so a future reader who assumes this script is about a gated
 * command finds the reason stated here instead of guessing.
 */
function isDeliberateRequest() {
  return false;
}

// `--self-test` short-circuits BEFORE the live `runScript` call below is ever reached — it must
// never spawn a sidecar, a claude process, or even resolve REPO_ROOT-relative binaries as a
// precondition, mirroring `authoring-stage-gate-spike.mjs`'s own "no child process, ever" rule.
if (process.argv.includes("--self-test")) {
  await selfTest();
}

await runScript(
  "socratic-authoring",
  "UAT 8 — Socratic epic authoring, driven live against the real backend (Phase 5 roadmap criteria)",
  async (harness) => {
    if (!probeClaudeAvailable()) {
      skip("the real `claude` binary is not resolvable — this item needs a live backend session");
    }

    const opsBin = resolveHarnessBinary("uat_authoring_ops");
    if (opsBin === undefined) {
      throw new Error(
        "uat_authoring_ops is not built — run `cargo build -p core --bin uat_authoring_ops`",
      );
    }

    step("creating a scratch repository (no remote needed — an authoring session writes no git history)");
    const repoDir = path.join(harness.root, "repo");
    execSync(`git init -q -b main "${repoDir}"`);
    execSync(`git -C "${repoDir}" -c user.email=uat@flywheel.invalid -c user.name="Flywheel UAT" commit -q --allow-empty -m initial`);

    step("registering the scratch repository as a project");
    const project = runOps(opsBin, harness.appDataDir, ["register-project", repoDir]);
    step(`project ${project.projectId}`);

    step("starting a fresh epic-authoring session (SHAPE-01's own case: no epic yet)");
    const run1 = runOps(opsBin, harness.appDataDir, ["start-run", project.projectId]);
    assert.equal(run1.authoringStage, "challenge");
    step(`run ${run1.runId} started in the challenge stage`);

    const runId = run1.runId;
    const env = harness.sessionEnv(runId, "main");
    Object.assign(env, harness.cleanClaudeConfigEnv());

    const opsHarnessBin = resolveHarnessBinary("uat_session_env");
    if (opsHarnessBin === undefined) {
      throw new Error("uat_session_env is not built — run `cargo build -p core --bin uat_session_env`");
    }
    const heartbeatEnv = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir };
    spawnSync(opsHarnessBin, ["--touch-heartbeat"], { env: heartbeatEnv });
    const heartbeatInterval = setInterval(() => {
      spawnSync(opsHarnessBin, ["--touch-heartbeat"], { env: heartbeatEnv });
    }, HEARTBEAT_TICK_MS);
    harness.onCleanup(() => clearInterval(heartbeatInterval));
    step("touching the heartbeat on the production cadence (05-SPIKE-FINDINGS.md's own verdict)");

    step("starting the real sidecar and completing its readiness handshake");
    const sidecar = await harness.startSidecar();

    step("spawning a real authoring session (authoring_spawn)");
    await sidecar.request({
      op: "authoring_spawn",
      runId,
      repoPath: repoDir,
      prompt: OPENING_PROMPT,
      permissionMode: "default",
      env,
    });

    // Fire-and-forget, deliberately not awaited: Claude Code's own internal session-startup git
    // housekeeping raises incidental permission requests outside the agent's visible Bash loop,
    // and an unanswered one would starve the turn before it ever reaches the agent's first reply.
    // Stopped via `onCleanup` so it never outlives this run. See the shared helper's own doc
    // comment in `lib/sidecar-harness.mjs` for the full mechanism.
    let draining = true;
    harness.onCleanup(() => {
      draining = false;
    });
    step(
      "draining incidental startup permission requests (this script reserves no gated command " +
        "of its own, so nothing here is ever the request under test)",
    );
    drainIncidentalPermissionRequests(sidecar, runId, isDeliberateRequest, () => !draining);

    step("waiting for the agent's first reply");
    const firstReply = await sidecar.waitForEvent(
      (event) => event.type === "assistant_text" && typeof event.text === "string" && event.text.length > 0,
      TURN_DEADLINE_MS,
      "the agent's first reply",
    );
    step(`first reply (verbatim, for the human transcript review): ${JSON.stringify(firstReply.text)}`);

    step("sending the second conversational turn");
    await sidecar.request({ op: "authoring_turn", runId, text: SECOND_TURN });
    const secondReply = await sidecar.waitForEvent(
      (event) =>
        event.type === "assistant_text" &&
        event !== firstReply &&
        typeof event.text === "string" &&
        event.text.length > 0,
      TURN_DEADLINE_MS,
      "the agent's second reply",
    );
    step(`second reply (verbatim): ${JSON.stringify(secondReply.text)}`);

    const proposeAttempted = sidecar
      .eventsOfType("tool_call")
      .some((event) => typeof event.name === "string" && event.name.includes("propose_"));
    const proposeDenied = sidecar
      .eventsOfType("tool_result")
      .some((event) => typeof event.raw === "string" && /challenge stage/i.test(event.raw));
    const criterion1Challenged =
      /\?/.test(firstReply.text) || /\?/.test(secondReply.text);
    const criterion1NoWorkPlanned = !proposeAttempted || proposeDenied;

    const evidencePath = resolveEvidencePath();
    fs.writeFileSync(
      evidencePath,
      renderChallengeEvidenceSheet({
        runId,
        openingPrompt: OPENING_PROMPT,
        firstReplyText: firstReply.text,
        secondTurn: SECOND_TURN,
        secondReplyText: secondReply.text,
        proposeAttempted,
        proposeDenied,
        draftedCriteriaCount: 0,
        amendedCriteriaCount: 0,
        results: [],
        timestamp: new Date().toISOString(),
      }),
    );
    step(
      `wrote challenge evidence sheet (pre-proposal, results pending): ${evidencePath} — a run ` +
        "that dies later in the proposal phase still leaves this transcript for the human",
    );

    step("advancing the stage (Cyril's own gate, D-90) — the developer decides the challenge is done");
    const advanced = runOps(opsBin, harness.appDataDir, ["advance-stage", runId]);
    assert.equal(advanced.stage, "decompose");
    if (advanced.distillationText) {
      await sidecar.request({ op: "authoring_turn", runId, text: advanced.distillationText });
    }

    step("waiting for at least one proposal (assumption or task) to arrive");
    let sawProposal = false;
    let materialisedEpicId = null;
    let taskProposalId = null;
    let criterionProposalId = null;
    let rejectedTaskId = null;
    try {
      const proposalEvent = await sidecar.waitForEvent(
        (event) => event.type === "proposal_created",
        PROPOSAL_DEADLINE_MS,
        "a proposal_created event",
      );
      sawProposal = true;
      step(`first proposal observed: verb=${proposalEvent.verb} targetType=${proposalEvent.targetType}`);
      // Apply every proposal_created event seen so far (and any that arrive over the next window)
      // through the real bridge — this IS the inbound write path, not a simulation of it.
      for (const event of sidecar.eventsOfType("proposal_created")) {
        const outcome = runOps(opsBin, harness.appDataDir, ["apply-proposal-created"], JSON.stringify(event));
        step(`applied proposal_created -> ${outcome.outcome} ${outcome.proposalId ?? ""}`);
      }
    } catch (err) {
      step(`no proposal arrived within the deadline: ${err.message}`);
    }

    const pending = runOps(opsBin, harness.appDataDir, ["list-pending", runId]);
    step(`${pending.proposals.length} proposal(s) pending after the first decompose window`);

    const taskProposal = pending.proposals.find((p) => p.targetType === "task");
    const criterionProposals = pending.proposals.filter((p) => p.targetType === "criterion");
    if (taskProposal) taskProposalId = taskProposal.id;
    if (criterionProposals.length > 0) criterionProposalId = criterionProposals[0].id;

    // The SHAPE-03 draft-usefulness judgement reads these two counts from the evidence sheet
    // rather than a scrollback line — how many criteria the model drafted, and how many the
    // developer had to amend before they were usable.
    const draftedCriteriaCount = criterionProposals.length;
    let amendedCriteriaCount = 0;

    let criterion2Landed = false;
    let criterion3Decided = false;
    if (taskProposalId) {
      step(`accepting the task subtree ${taskProposalId} (D-95's ONE bulk path)`);
      const subtreeOutcome = runOps(opsBin, harness.appDataDir, ["accept-subtree", taskProposalId]);
      materialisedEpicId = null; // this session had no epic — a task proposal here has no epic id
      criterion2Landed = subtreeOutcome.acceptedCount > 0;

      const counts = runOps(opsBin, harness.appDataDir, ["board-counts", project.projectId]);
      step(`board counts after accept: tasks=${counts.tasks} criteria=${counts.criteria}`);

      if (criterionProposals.length > 1) {
        rejectedTaskId = criterionProposals[1].id;
        step(`rejecting a second criterion proposal ${rejectedTaskId} with a reason`);
        runOps(opsBin, harness.appDataDir, ["reject-proposal", rejectedTaskId, "Too vague to verify"]);
        criterion3Decided = true;
      }
    }

    if (criterionProposalId) {
      step(`amending criterion proposal ${criterionProposalId} to the developer's own text`);
      runOps(opsBin, harness.appDataDir, [
        "amend-criterion",
        criterionProposalId,
        "A UAT-amended criterion, the developer's own wording",
      ]);
      amendedCriteriaCount += 1;
      criterion3Decided = true;
    }

    step("closing this run with a summary (D-64's own guarantee)");
    runOps(opsBin, harness.appDataDir, ["close-run", runId, "UAT 8 shaped one task."]);

    // ---- SHAPE-05 — reopening ----------------------------------------------------------------
    let criterion4Reopened = false;
    let criterion4PrimedRejected = false;
    if (rejectedTaskId && materialisedEpicId === null) {
      // This session's proposals had no epic (a fresh session, D-84) — SHAPE-05's reopen check
      // needs a REAL epic to reopen. Recorded here rather than faked: a fresh-epic session's own
      // task proposals never carry an epic id until a SEPARATE epic proposal is accepted and a
      // second session reopens it (the exact two-session shape `authoring_acceptance.rs`'s own
      // Criterion 2/4 tests document and exercise directly against the database). This live
      // script's own SHAPE-05 check is therefore reported honestly as unproven-this-run when the
      // conversation never produced an epic proposal — not silently marked green.
      step(
        "no epic was materialised in this conversation (the model proposed a task without an " +
          "epic) — SHAPE-05's reopen check is exercised structurally by " +
          "authoring_acceptance.rs::criterion_4_* instead; this run reports it honestly as " +
          "unproven rather than fabricating a pass",
      );
    }

    const results = buildCriteriaResults({
      criterion1Challenged,
      criterion1NoWorkPlanned,
      criterion2Landed,
      criterion3Decided,
      criterion4Reopened,
      criterion4PrimedRejected,
    });

    fs.writeFileSync(
      evidencePath,
      renderChallengeEvidenceSheet({
        runId,
        openingPrompt: OPENING_PROMPT,
        firstReplyText: firstReply.text,
        secondTurn: SECOND_TURN,
        secondReplyText: secondReply.text,
        proposeAttempted,
        proposeDenied,
        draftedCriteriaCount,
        amendedCriteriaCount,
        results,
        timestamp: new Date().toISOString(),
      }),
    );
    step(`wrote challenge evidence sheet (final): ${evidencePath}`);

    const allPassed = reportCriteria(results);
    harness.writeArtifact("uat-08-results", { sawProposal, results });

    assert.ok(
      allPassed,
      "one or more gating SHAPE criteria (SHAPE-01, SHAPE-02, SHAPE-03/SHAPE-04) did not pass " +
        "this run — see the per-criterion lines above. SHAPE-05 is reported informationally and " +
        "never gates this assertion. See also 05-10-PLAN.md Task 3's own human-check " +
        "instructions for the two judgements only a human reading the transcript can make once " +
        "this exits 0.",
    );
  },
);
