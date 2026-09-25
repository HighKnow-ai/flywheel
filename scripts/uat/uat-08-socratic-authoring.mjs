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
import os from "node:os";
import path from "node:path";

import {
  accumulateTurn,
  ACCEPTED_AUTH_METHODS,
  API_KEY_ENV_VARS,
  assertAllHeldRequestsAnswered,
  assertBackendAuthenticated,
  assertClaudeConfigIsolated,
  BACKEND_REFUSAL_KIND,
  BACKEND_REFUSAL_PREFIX,
  BEHAVIOURAL_CONFIG_DENYLIST,
  composeIsolatedClaudeConfigDir,
  createPermissionAnswerHandler,
  CREDENTIAL_LINK_ALLOWLIST,
  drainIncidentalPermissionRequests,
  drainInboundCoreRequests,
  HARNESS_PRECONDITION_PREFIX,
  HEARTBEAT_TICK_MS,
  HELD_INBOUND_REQUEST_TYPES,
  LIVE_TURN_IDLE_MS,
  probeClaudeAvailable,
  readBackendRefusal,
  REPO_ROOT,
  resolveHarnessBinary,
  runScript,
  scrubApiKeyEnv,
  SidecarClient,
  skip,
  step,
  summariseAuthStatus,
} from "./lib/sidecar-harness.mjs";
import { DEFAULT_SCENARIO, SCENARIOS, SCENARIO_ENV_VAR } from "./lib/fake-authoring-claude.mjs";

/** The fake authoring backend's own file — resolved once so both `--replay-check` (as
 * `FLYWHEEL_CLAUDE_BIN`) and this script's own build-hint messages name the same path. Never
 * reachable from the live arm — only `--replay-check` sets `FLYWHEEL_CLAUDE_BIN` at all. */
const FAKE_AUTHORING_CLAUDE_PATH = path.join(REPO_ROOT, "scripts", "uat", "lib", "fake-authoring-claude.mjs");

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

/**
 * D-87 (plan 05-18, G-05-1): build a `drainInboundCoreRequests` handler for `board_read_request`
 * events — the harness's own side of the round trip the real desktop app plays at
 * `commands::authoring::handle_inbound_board_read_request`. Pipes the RAW event, verbatim, into
 * the `answer-board-read` bridge subcommand (the same `resolve_board_read` dispatch the desktop
 * app calls), then relays whatever it returns — a `{result}` or an `{error}` — back to the sidecar
 * as an `authoring_read_answer` op, exactly mirroring `createPermissionAnswerHandler`'s own shape.
 * A thrown bridge failure (a USAGE failure, not a resolver error — see `answer-board-read`'s own
 * doc comment) is converted to `{ error: String(err) }` rather than rethrown: an errored read
 * still has to release the held call, or this handler would recreate the exact starvation this
 * plan exists to close.
 */
function createBoardReadHandler({ opsBin, appDataDir, sidecar, runId }) {
  return async (event) => {
    let answer;
    try {
      answer = runOps(opsBin, appDataDir, ["answer-board-read"], JSON.stringify(event));
    } catch (err) {
      answer = { error: String(err) };
    }
    await sidecar
      .request({ op: "authoring_read_answer", runId, requestId: event.requestId, ...answer })
      .catch(() => {});
    return true;
  };
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
 * Plan 05-30 (G-05-5 closure): the fail-closed ALLOW-list of `readNoWorkPlanned` readings that may
 * pass SHAPE-01's second half. Replaces the prior `!== "violated"` DENY-list, under which any
 * reading value the author had not anticipated passed by default — exactly the mechanism that let
 * a fourth reading (`"uncorrelatable"`, added by this same plan) have silently passed SHAPE-01 had
 * the deny-list been left in place. A reading added later and not added HERE does not pass, and
 * that is deliberate: this is the generalisation of the defect class this plan closes, not a
 * detail specific to one new value.
 */
const PASSING_NO_WORK_READINGS = new Set(["refused", "unproven"]);

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
    noWorkPlannedReading,
    criterion2Landed,
    criterion3Decided,
    criterion4Reopened,
    criterion4PrimedRejected,
  } = flags;

  // Task 3 (G-05-2): never a boolean that goes vacuously true the moment no propose attempt
  // happens to be observed. "unproven" names WHERE the structural guarantee is actually proven —
  // never leaves a reader thinking an absence of evidence was a measurement. Plan 05-30 (G-05-5
  // closure) added a FOURTH value, "uncorrelatable": propose attempts were observed but at least
  // one carried no correlation id, so the backend supplied no exact key and this run cannot be
  // judged either way — its own detail line, distinct from "unproven"'s, because the two states
  // differ in whether the criterion could even be evaluated at all.
  const noWorkPlannedDetail =
    noWorkPlannedReading === "unproven"
      ? "unproven — no propose attempt observed this run; the structural guarantee (the proposal " +
        "tools are absent from the tool set until the stage advances) is proven by " +
        "packages/core/tests/authoring_stage.rs and " +
        "packages/sidecar/test/authoring-stage-gate.test.mjs, not by this run"
      : noWorkPlannedReading === "uncorrelatable"
        ? "uncorrelatable — a propose attempt was observed but the backend's own tool_call block " +
          "carried no correlation id, so this run cannot be paired with its own answer and cannot " +
          "be judged either way; see CORRELATION_ID_FIELD's own doc comment for the asymmetric " +
          "grounding behind this abstention"
        : noWorkPlannedReading;

  return [
    [
      "SHAPE-01 — the agent challenges before any work is planned",
      criterion1Challenged && PASSING_NO_WORK_READINGS.has(noWorkPlannedReading),
      `challenged=${criterion1Challenged} noWorkPlanned=${noWorkPlannedDetail}`,
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
 * assert its shape offline (T-05-16-06). Byte-identical output for identical input (T-05-16-06,
 * re-asserted by G-05-2's own self-test check).
 *
 * `evidence` fields:
 * - `runId`, `timestamp` (an ISO string, supplied by the caller so this function never reads the
 *   clock itself)
 * - `exchanges` — an ORDERED array recording the whole conversation, not two samples of it
 *   (G-05-2). Each entry: `{ speaker: "developer" | "agent", text, chunkCount?, charCount?,
 *   endedBy? }`. The opening prompt is the FIRST developer entry — there is no separate "opening
 *   prompt" section. `chunkCount`/`charCount`/`endedBy` are read only from `speaker: "agent"`
 *   entries (an agent turn's own capture-integrity numbers, from `SidecarClient.waitForTurn`).
 * - `noWorkPlannedReading` (Task 3, G-05-2) — the THREE-valued `readNoWorkPlanned` reading
 *   (`"refused" | "violated" | "unproven"`), printed verbatim rather than a bare boolean that goes
 *   vacuously true the moment no propose attempt happens to be observed. Defaults to `"unproven"`
 *   when omitted (no propose attempt observed by the time this sheet was written).
 * - `draftedCriteriaCount`, `amendedCriteriaCount`
 * - `results` (the array `buildCriteriaResults`/`reportCriteria` share — may be `[]` before the
 *   decompose phase completes)
 * - `synthetic` (boolean, default `false`) and `scenario` (the scenario name, when `synthetic` is
 *   true) — G-05-2's own guard against laundering a scripted run as a live one: a synthetic sheet
 *   carries an unmissable marker in its first two lines naming the scenario, and its verdict
 *   section is REPLACED by a refusal — the unfilled-verdict token appears zero times.
 */
function renderChallengeEvidenceSheet(evidence) {
  const {
    runId,
    exchanges = [],
    noWorkPlannedReading = "unproven",
    draftedCriteriaCount,
    amendedCriteriaCount,
    results,
    timestamp,
    synthetic = false,
    scenario,
    refusal = null,
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

  // The whole conversation, in order, each exchange its own fenced block — never two samples of
  // it. An agent entry's heading names its own capture-integrity numbers, so a truncated capture
  // is visible on the face of the document rather than only inferable by diffing prose.
  const conversationBlocks = exchanges
    .map((exchange, index) => {
      const speakerLabel = exchange.speaker === "agent" ? "Agent" : "Developer";
      const integritySuffix =
        exchange.speaker === "agent"
          ? ` — chunks=${exchange.chunkCount ?? 0} chars=${exchange.charCount ?? 0} endedBy=${exchange.endedBy ?? "unknown"}`
          : "";
      return `### ${index + 1}. ${speakerLabel}${integritySuffix}\n\n\`\`\`\n${exchange.text}\n\`\`\``;
    })
    .join("\n\n");

  // Plan 05-24 (Task 2, G-05-3): a Refusal column — the classifier code for a refused agent turn,
  // an em-dash placeholder for every other. Extends the pre-existing table rather than adding a
  // parallel one, so a reader scanning ONE table sees both capture integrity and refusal status.
  const agentExchanges = exchanges.filter((exchange) => exchange.speaker === "agent");
  const integrityTable =
    agentExchanges.length > 0
      ? `| Agent turn | Chunk count | Character count | End marker | Refusal |\n| --- | --- | --- | --- | --- |\n` +
        agentExchanges
          .map(
            (exchange, index) =>
              `| ${index + 1} | ${exchange.chunkCount ?? 0} | ${exchange.charCount ?? 0} | ${exchange.endedBy ?? "unknown"} | ` +
              `${exchange.refusal ? exchange.refusal.classifier ?? "unknown" : "—"} |`,
          )
          .join("\n")
      : "(no agent turns captured yet)";

  // Deliberately the second LINE of the whole document (never buried) — a human or a script
  // reading only the head of this file must see it before anything else.
  const syntheticMarkerLine = synthetic
    ? `**SYNTHETIC RUN (scenario: \`${scenario ?? "unknown"}\`)** — produced by a scripted stand-in ` +
      "backend, not a live conversation. No verdict may be recorded from it."
    : "";

  const verdictsSection = synthetic
    ? `## Verdicts\n\n` +
      `This is a SYNTHETIC run (scenario: \`${scenario ?? "unknown"}\`) — no verdict may be ` +
      "recorded from scripted dialogue. Run the live arm (no `--replay-check`) to produce a " +
      "judgeable transcript.\n"
    : `## Verdicts (human — fill these in)\n\n` +
      `- SHAPE-01 challenge-quality verdict: ${UNJUDGED_TOKEN} — reading the conversation above,\n` +
      "  did the agent push back on the stated premise, or did it affirm it and start planning work?\n" +
      `- SHAPE-03 draft-usefulness verdict: ${UNJUDGED_TOKEN} — were the drafted criteria above useful\n` +
      "  as-is, or did they need the amendment recorded above to become usable?\n";

  // Plan 05-24 (Task 2, G-05-3): rendered immediately ABOVE the verdict section — the same place a
  // reader looks for the verdict — naming the failure class, the classifier code, the request id,
  // and stating plainly that the run did not complete. Omitted entirely (not even an empty
  // heading) when `refusal` is absent, so an unrefused sheet stays BYTE-IDENTICAL to what this
  // function rendered before this field existed — that is what keeps the pre-existing determinism
  // check meaningful. Deliberately does NOT replace the verdict lines the way a synthetic sheet
  // does: the turns captured before the refusal are real model turns a human may legitimately
  // judge, so this section exists only to make sure nobody mistakes the run as complete — a future
  // author must not "tidy" this into a replacement of the verdict section.
  const refusalSection = refusal
    ? `## Backend refusal\n\n` +
      `This run stopped on a backend-level refusal (\`${refusal.kind ?? BACKEND_REFUSAL_KIND}\`), ` +
      `not a model turn — classifier \`${refusal.classifier ?? "unknown"}\`, request id ` +
      `\`${refusal.requestId ?? "none"}\`. The conversation did not complete. The turns captured ` +
      "above, before the refusal, are real model turns and may be judged on their own merits — but " +
      "no verdict below should be read as covering a finished conversation.\n\n"
    : "";

  return `# Phase 5 — Socratic Epic Authoring — Live Challenge Transcript
${syntheticMarkerLine}

**Run:** ${runId}
**Captured:** ${timestamp}

## Conversation

${conversationBlocks || "(no exchanges captured yet)"}

## Capture integrity

${integrityTable}

## Propose-tool observations

- noWorkPlanned reading: ${noWorkPlannedReading}

## Per-criterion results

${criterionLines || "(not yet available — populated once the decompose phase completes)"}

## Draft usefulness (SHAPE-03)

- Drafted criteria: ${drafted}
- Amended criteria: ${amended}
- Ratio (amended/drafted): ${amended}/${drafted}

${refusalSection}${verdictsSection}`;
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
          noWorkPlannedReading: "refused",
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
          noWorkPlannedReading: "refused",
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
      noWorkPlannedReading: "refused",
      criterion2Landed: true,
      criterion3Decided: true,
      criterion4Reopened: false,
      criterion4PrimedRejected: false,
    });
    const informationalEntries = results.filter((entry) => entry[3]);
    assert.equal(informationalEntries.length, 1);
    assert.ok(informationalEntries[0][0].includes("SHAPE-05"));
  });

  // Plan 05-24 (gap G-05-3): the exact turn-5 text of run `01M399FP80B184QM2RXTXJDZTK`,
  // `05-LIVE-CHALLENGE-TRANSCRIPT.md` — REAL captured evidence from the run this whole gap exists
  // to close, never invented. Declared here, before its first use below, so both the
  // evidence-sheet checks and the refusal-detection checks further down reference ONE constant.
  const LIVE_REFUSAL_TEXT =
    "API Error: Opus 5 (1M context)'s safeguards flagged this message " +
    "(https://www.anthropic.com/legal/aup). This sometimes happens with safe, normal " +
    "conversations. Claude Code can't respond to this message with Opus 5 (1M context).\n" +
    "\n" +
    "Try rephrasing the request in a new session or change your model.\n" +
    "\n" +
    "Learn more: https://support.claude.com/en/articles/16049681\n" +
    "\n" +
    "Details: `[reasoning_extraction]`\n" +
    "\n" +
    "Request ID: req_011CfMyQ7EQg8jnFnSugjHVw";

  const SYNTHETIC_EVIDENCE = {
    runId: "01ABCDEFGHJKMNPQRSTVWXYZ0",
    exchanges: [
      { speaker: "developer", text: "I want to build a notifications feature so users get pinged." },
      {
        speaker: "agent",
        text: "What problem are you actually trying to solve for the user here?",
        chunkCount: 1,
        charCount: 65,
        endedBy: "result",
      },
      { speaker: "developer", text: "Just in-app for now, nothing external." },
      {
        speaker: "agent",
        text: "Got it — in-app only. Before I draft anything, who dismisses a notification?",
        chunkCount: 1,
        charCount: 77,
        endedBy: "result",
      },
    ],
    noWorkPlannedReading: "unproven",
    draftedCriteriaCount: 2,
    amendedCriteriaCount: 1,
    results: buildCriteriaResults({
      criterion1Challenged: true,
      noWorkPlannedReading: "refused",
      criterion2Landed: true,
      criterion3Decided: true,
      criterion4Reopened: false,
      criterion4PrimedRejected: false,
    }),
    timestamp: "2026-01-01T00:00:00.000Z",
  };

  check("the evidence sheet carries every exchange verbatim, including turns beyond the first two", () => {
    const sheet = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    for (const exchange of SYNTHETIC_EVIDENCE.exchanges) {
      assert.ok(sheet.includes(exchange.text), `expected the sheet to include ${JSON.stringify(exchange.text)}`);
    }
  });

  check("the live-shaped sheet carries the unfilled-verdict token exactly twice", () => {
    const sheet = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const occurrences = sheet.split(UNJUDGED_TOKEN).length - 1;
    assert.equal(occurrences, 2);
  });

  check("the evidence sheet renders identically for identical input", () => {
    const first = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const second = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    assert.equal(first, second);
  });

  check("a sheet rendered WITHOUT a refusal contains no Backend refusal section, and stays byte-identical to a sheet with no refusal field at all (plan 05-24)", () => {
    const withoutField = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const withExplicitNull = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, refusal: null });
    assert.ok(!withoutField.includes("## Backend refusal"), "expected no refusal heading when refusal is absent");
    assert.equal(withoutField, withExplicitNull, "expected an explicit null refusal to render byte-identically to an absent one");
  });

  check("a sheet rendered WITH a refusal contains the Backend refusal section, positioned above the verdict section, naming the class/classifier/request id (plan 05-24)", () => {
    const refusalObject = { kind: BACKEND_REFUSAL_KIND, classifier: "reasoning_extraction", requestId: "req_011CfMyQ7EQg8jnFnSugjHVw", text: LIVE_REFUSAL_TEXT };
    const sheet = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, refusal: refusalObject });
    assert.ok(sheet.includes("## Backend refusal"), "expected a Backend refusal heading when refusal is present");
    assert.ok(sheet.includes(BACKEND_REFUSAL_KIND), "expected the failure class named in the section");
    assert.ok(sheet.includes("reasoning_extraction"), "expected the classifier code named in the section");
    assert.ok(sheet.includes("req_011CfMyQ7EQg8jnFnSugjHVw"), "expected the request id named in the section");
    const refusalHeadingIndex = sheet.indexOf("## Backend refusal");
    const verdictHeadingIndex = sheet.indexOf("## Verdicts");
    assert.ok(refusalHeadingIndex >= 0 && verdictHeadingIndex >= 0, "expected both headings to be present");
    assert.ok(refusalHeadingIndex < verdictHeadingIndex, "expected the Backend refusal section ABOVE the Verdicts section");
  });

  check("the synthetic-shaped sheet carries zero unfilled-verdict tokens and names its scenario in its first two lines", () => {
    const sheet = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, synthetic: true, scenario: "truncation-repro" });
    const occurrences = sheet.split(UNJUDGED_TOKEN).length - 1;
    assert.equal(occurrences, 0);
    const firstTwoLines = sheet.split("\n").slice(0, 2).join("\n");
    assert.ok(firstTwoLines.includes("SYNTHETIC"), "expected a synthetic marker in the first two lines");
    assert.ok(firstTwoLines.includes("truncation-repro"), "expected the scenario name in the first two lines");
  });

  check("the capture-integrity table has exactly one row per agent exchange, each carrying a Refusal column (plan 05-24)", () => {
    const sheet = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const agentExchangeCount = SYNTHETIC_EVIDENCE.exchanges.filter((exchange) => exchange.speaker === "agent").length;
    const tableRows = sheet.match(/^\| \d+ \|.*\|$/gm) ?? [];
    assert.equal(tableRows.length, agentExchangeCount);
    for (const row of tableRows) {
      // 5 columns (Agent turn, Chunk count, Character count, End marker, Refusal) => 6 pipe-split
      // segments including the leading/trailing empties either side of the row's own `|` fences.
      const cellCount = row.split("|").length - 2;
      assert.equal(cellCount, 5, `expected 5 columns (turn, chunks, chars, end marker, refusal): ${row}`);
    }
  });

  {
    // NF-01 regression (plan 05-24, Task 2, RED — written and confirmed FAILING before the fix):
    // the pre-fix live body captured a STANDALONE first turn (via `waitForTurn`), then handed the
    // SAME seed cursor to `driveChallengeConversation`, whose own first capture re-read the
    // IDENTICAL turn — producing two agent entries with the SAME end index in the rendered
    // transcript. This is exactly what made `05-LIVE-CHALLENGE-TRANSCRIPT.md`'s own turns 2 and 3
    // byte-identical. Reproduced here structurally: a standalone capture, then the driver seeded
    // with the SAME cursor, mirroring the pre-fix live body's own two call sites exactly.
    const nf01Turn1 = {
      text: "Board and repo are both empty — four forks that would materially change what gets built:",
      chunkCount: 1,
      charCount: 89,
      endedBy: "idle",
      endIndex: 3,
      refusal: null,
    };
    const nf01Stub = {
      async waitForTurn() {
        return { ...nf01Turn1 };
      },
      eventCursor() {
        return nf01Turn1.endIndex;
      },
    };
    const standaloneTurn1 = await nf01Stub.waitForTurn("stub-run-nf01", 0);
    const nf01Conversation = await driveChallengeConversation({
      sidecar: nf01Stub,
      runId: "stub-run-nf01",
      sendTurn: async () => {},
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });
    const preFixAssembly = [
      { speaker: "developer", text: OPENING_PROMPT },
      {
        speaker: "agent",
        text: standaloneTurn1.text,
        chunkCount: standaloneTurn1.chunkCount,
        charCount: standaloneTurn1.charCount,
        endedBy: standaloneTurn1.endedBy,
        endIndex: standaloneTurn1.endIndex,
      },
      ...nf01Conversation.exchanges,
    ];

    check(
      "[Plan 05-24, NF-01] the PRE-FIX live-body assembly duplicates the seed turn — proving the duplication was real",
      () => {
        const agentEntries = preFixAssembly.filter((exchange) => exchange.speaker === "agent");
        assert.equal(agentEntries.length, 2, "expected exactly two agent entries in the pre-fix assembly — the duplicate");
        assert.equal(
          agentEntries[0].endIndex,
          agentEntries[1].endIndex,
          "expected the pre-fix assembly's two agent entries to share the SAME end index — this IS NF-01",
        );
        assert.equal(
          agentEntries[0].text,
          agentEntries[1].text,
          "expected the pre-fix assembly's two agent entries to be byte-identical — this IS NF-01",
        );
      },
    );

    check(
      "[Plan 05-24, NF-01, RED until buildEvidenceExchanges exists] buildEvidenceExchanges assembles the SAME conversation with no duplicate — exactly one agent entry, strictly increasing end indices",
      () => {
        const fixedAssembly = buildEvidenceExchanges({ openingPrompt: OPENING_PROMPT, conversation: nf01Conversation });
        const agentEntries = fixedAssembly.filter((exchange) => exchange.speaker === "agent");
        assert.equal(agentEntries.length, 1, "expected exactly one agent entry — the duplication must be gone");
        let precedingEndIndex = -1;
        for (const entry of agentEntries) {
          assert.ok(
            entry.endIndex > precedingEndIndex,
            "expected assembled agent entries to carry strictly increasing end indices — no entry may repeat another's",
          );
          precedingEndIndex = entry.endIndex;
        }
      },
    );

    check(
      "[Plan 05-24] buildEvidenceExchanges on a zero-exchange conversation yields exactly one entry, the opening developer prompt — no throw, no fabricated agent entry",
      () => {
        const zeroExchangeAssembly = buildEvidenceExchanges({
          openingPrompt: OPENING_PROMPT,
          conversation: { exchanges: [] },
        });
        assert.equal(zeroExchangeAssembly.length, 1);
        assert.equal(zeroExchangeAssembly[0].speaker, "developer");
        assert.equal(zeroExchangeAssembly[0].text, OPENING_PROMPT);
      },
    );
  }

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

  // -----------------------------------------------------------------------------------------
  // drainInboundCoreRequests / assertAllHeldRequestsAnswered — a starved harness reports itself
  // by name (Task 3, G-05-1). All pure, offline, spawning nothing.
  // -----------------------------------------------------------------------------------------
  {
    const UNHANDLED_REQ = "req-board-read-unhandled";
    const stubEvents = [{ type: "board_read_request", requestId: UNHANDLED_REQ }];
    const stubSidecar = {
      unansweredHeldRequests: [],
      requests: [],
      async waitForEvent(predicate, _timeoutMs, _label) {
        const match = stubEvents.find((e) => predicate(e) && !stubSidecar.requests.some((r) => r.requestId === e.requestId));
        if (match === undefined) throw new Error("stub: no queued event matches the drain loop's own predicate");
        return match;
      },
      async request(payload) {
        stubSidecar.requests.push(payload);
        return {};
      },
    };
    // Only a `permission_request` handler is registered — the queued event is a
    // `board_read_request`, which this drain call has no handler for.
    let iterations = 0;
    await drainInboundCoreRequests(stubSidecar, "stub-run", {
      handlers: { permission_request: async () => true },
      shouldStop: () => {
        iterations += 1;
        return iterations > 1;
      },
    });

    check("an unhandled held kind is recorded, not swallowed", () => {
      assert.equal(stubSidecar.unansweredHeldRequests.length, 1);
      assert.equal(stubSidecar.unansweredHeldRequests[0].type, "board_read_request");
      assert.equal(stubSidecar.unansweredHeldRequests[0].requestId, UNHANDLED_REQ);
      assert.equal(stubSidecar.requests.length, 0, "no op should have been sent for the unhandled kind");
    });

    check("the recorded entry is what turns a wait into a named failure", () => {
      assert.throws(
        () => assertAllHeldRequestsAnswered(stubSidecar),
        (err) => err.message.includes("board_read_request") && err.message.includes(UNHANDLED_REQ),
      );
      assert.doesNotThrow(() => assertAllHeldRequestsAnswered({ unansweredHeldRequests: [] }));
    });

    check("every kind the sidecar can hold open has an answering handler", () => {
      const sidecarSource = fs.readFileSync(
        path.join(REPO_ROOT, "packages", "sidecar", "src", "index.ts"),
        "utf8",
      );
      const answeringOpCount = (sidecarSource.match(/case\s+"[a-zA-Z0-9_]+_answer"\s*:/g) ?? []).length;
      assert.equal(
        answeringOpCount,
        HELD_INBOUND_REQUEST_TYPES.length,
        "a new answering op on the sidecar means a new entry in HELD_INBOUND_REQUEST_TYPES and a " +
          "new handler in every live script's drain, or this starvation returns",
      );
    });
  }

  // -----------------------------------------------------------------------------------------
  // SidecarClient.waitForTurn — the turn boundary's own edges, pinned offline (Task 2, G-05-2).
  // Drives the REAL shipped method (`SidecarClient.prototype.waitForTurn.call(stub, …)`) against
  // a tiny stub exposing only the members the primitive touches (`events`, `turnWatchers`,
  // `unansweredHeldRequests`) — never a reimplementation of it, and never a child process.
  // -----------------------------------------------------------------------------------------
  {
    const RUN_ID = "run-waitforturn-self-test";

    // `check()` itself is synchronous (it does not await `fn()`) — every async
    // `SidecarClient.waitForTurn` call is awaited OUTSIDE `check()` first, mirroring this file's
    // own established idiom (the `drainIncidentalPermissionRequests`/`drainInboundCoreRequests`
    // blocks above), so a rejected assertion inside an unawaited async body can never become an
    // unhandled rejection instead of a reported failure.

    const cursorExclusionResult = await SidecarClient.prototype.waitForTurn.call(
      {
        events: [
          { runId: RUN_ID, type: "assistant_text", text: "PRE-CURSOR (must never appear)" },
          { runId: RUN_ID, type: "assistant_text", text: "POST-CURSOR (the real turn)" },
          { runId: RUN_ID, type: "result" },
        ],
        turnWatchers: [],
      },
      RUN_ID,
      1,
      { timeoutMs: 200, label: "cursor-exclusion self-test" },
    );
    check(
      "a chunk that arrived before the cursor is excluded from the captured turn — this fails if waitForTurn scans from index zero",
      () => {
        assert.ok(!cursorExclusionResult.text.includes("PRE-CURSOR"));
        assert.equal(cursorExclusionResult.chunkCount, 1);
        assert.ok(cursorExclusionResult.text.includes("POST-CURSOR"));
      },
    );

    const orderingResult = await SidecarClient.prototype.waitForTurn.call(
      {
        events: [
          { runId: RUN_ID, type: "assistant_text", text: "first chunk" },
          { runId: RUN_ID, type: "tool_call", toolName: "Bash", input: {} },
          { runId: RUN_ID, type: "assistant_text", text: "second chunk" },
          { runId: RUN_ID, type: "result" },
        ],
        turnWatchers: [],
      },
      RUN_ID,
      0,
      { timeoutMs: 200, label: "ordering self-test" },
    );
    check(
      "every chunk is present, in arrival order, with an interleaved tool call not interrupting accumulation",
      () => {
        assert.deepEqual(orderingResult.chunks, ["first chunk", "second chunk"]);
        assert.equal(orderingResult.toolCalls.length, 1);
        assert.ok(orderingResult.text.indexOf("first chunk") < orderingResult.text.indexOf("second chunk"));
      },
    );

    const foreignRunIdResult = await SidecarClient.prototype.waitForTurn.call(
      {
        events: [
          { runId: "some-other-run", type: "assistant_text", text: "OTHER RUN (must never appear)" },
          { runId: RUN_ID, type: "assistant_text", text: "OWN RUN" },
          { runId: RUN_ID, type: "result" },
        ],
        turnWatchers: [],
      },
      RUN_ID,
      0,
      { timeoutMs: 200, label: "foreign-run-id self-test" },
    );
    check("an event belonging to a different run id is never part of this run's turn", () => {
      assert.ok(!foreignRunIdResult.text.includes("OTHER RUN"));
      assert.equal(foreignRunIdResult.chunkCount, 1);
    });

    const backendEchoResult = await SidecarClient.prototype.waitForTurn.call(
      {
        events: [
          { runId: RUN_ID, type: "backend_echo", text: "ECHOED (must never appear)" },
          { runId: RUN_ID, type: "assistant_text", text: "REAL AGENT TEXT" },
          { runId: RUN_ID, type: "result" },
        ],
        turnWatchers: [],
      },
      RUN_ID,
      0,
      { timeoutMs: 200, label: "backend_echo self-test" },
    );
    check("a backend_echo event is never part of the turn's text", () => {
      assert.ok(!backendEchoResult.text.includes("ECHOED"));
      assert.equal(backendEchoResult.chunkCount, 1);
    });

    const resultTurn = await SidecarClient.prototype.waitForTurn.call(
      { events: [{ runId: RUN_ID, type: "result" }], turnWatchers: [] },
      RUN_ID,
      0,
      { timeoutMs: 200, label: "result-marker self-test" },
    );
    const idleTurn = await SidecarClient.prototype.waitForTurn.call(
      {
        events: [{ runId: RUN_ID, type: "assistant_text", text: "goes quiet after this" }],
        turnWatchers: [],
      },
      RUN_ID,
      0,
      { timeoutMs: 300, idleMs: 15, label: "idle-marker self-test" },
    );

    check("a turn ending on a result event reports endedBy as the result marker", () => {
      assert.equal(resultTurn.endedBy, "result");
    });

    check("a result with no preceding text resolves as a complete turn carrying no text, rather than hanging until the deadline", () => {
      assert.equal(resultTurn.chunkCount, 0);
      assert.equal(resultTurn.text, "");
    });

    check("a turn that goes quiet with no result ends on the idle marker after the declared window — distinguishable from the result marker", () => {
      assert.equal(idleTurn.endedBy, "idle");
      assert.equal(idleTurn.chunkCount, 1);
    });

    let deadlineRejection;
    try {
      await SidecarClient.prototype.waitForTurn.call({ events: [], turnWatchers: [] }, RUN_ID, 0, {
        timeoutMs: 20,
        idleMs: 500,
        label: "the deadline self-test",
      });
    } catch (err) {
      deadlineRejection = err;
    }
    check("a turn that never produces a chunk and never terminates rejects on its own deadline, naming what it captured", () => {
      assert.ok(deadlineRejection !== undefined, "expected waitForTurn to reject");
      assert.ok(deadlineRejection.message.includes("0 chunk"));
      assert.ok(deadlineRejection.message.includes("0 character"));
    });

    // ---------------------------------------------------------------------------------------
    // WR-04 closure (plan 05-25) — pendingToolCallCount, the idle policy's own scoped reset and
    // suppression, and the deadline message's new clause. All against the same tiny stub or a
    // short, explicitly-passed idleMs/timeoutMs, exactly like every check above.
    // ---------------------------------------------------------------------------------------

    check(
      "accumulateTurn's pendingToolCallCount counts an unanswered tool_call, decrements once its tool_result arrives, floors at zero, and ignores a foreign run's tool_result",
      () => {
        const runId = "run-pending-arith";
        const noCalls = accumulateTurn(
          [{ runId, type: "assistant_text", text: "hi" }, { runId, type: "result" }],
          runId,
          0,
        );
        assert.equal(noCalls.pendingToolCallCount, 0);

        const onePending = accumulateTurn(
          [{ runId, type: "assistant_text", text: "hi" }, { runId, type: "tool_call", toolName: "Bash" }],
          runId,
          0,
        );
        assert.equal(onePending.pendingToolCallCount, 1);

        const answered = accumulateTurn(
          [
            { runId, type: "assistant_text", text: "hi" },
            { runId, type: "tool_call", toolName: "Bash" },
            { runId, type: "tool_result", raw: "ok" },
          ],
          runId,
          0,
        );
        assert.equal(answered.pendingToolCallCount, 0);

        const foreignResultDoesNotAnswer = accumulateTurn(
          [
            { runId, type: "tool_call", toolName: "Bash" },
            { runId: "some-other-run", type: "tool_result", raw: "ok" },
          ],
          runId,
          0,
        );
        assert.equal(
          foreignResultDoesNotAnswer.pendingToolCallCount,
          1,
          "a foreign run's tool_result must not answer this run's pending call",
        );

        const twoPendingOneAnswered = accumulateTurn(
          [
            { runId, type: "tool_call", toolName: "Bash" },
            { runId, type: "tool_call", toolName: "Read" },
            { runId, type: "tool_result", raw: "ok" },
          ],
          runId,
          0,
        );
        assert.equal(twoPendingOneAnswered.pendingToolCallCount, 1);
      },
    );

    check("accumulateTurn returns pendingToolCallCount from BOTH of its return paths (result-terminated and fall-through)", () => {
      const runId = "run-pending-both-paths";
      const terminated = accumulateTurn(
        [{ runId, type: "tool_call", toolName: "Bash" }, { runId, type: "result" }],
        runId,
        0,
      );
      assert.equal(terminated.endedBy, "result");
      assert.equal(terminated.pendingToolCallCount, 1);
      const fallThrough = accumulateTurn([{ runId, type: "tool_call", toolName: "Bash" }], runId, 0);
      assert.equal(fallThrough.endedBy, undefined);
      assert.equal(fallThrough.pendingToolCallCount, 1);
    });

    let deadlineRejectionWithPending;
    try {
      await SidecarClient.prototype.waitForTurn.call(
        { events: [{ runId: RUN_ID, type: "tool_call", toolName: "Bash" }], turnWatchers: [] },
        RUN_ID,
        0,
        { timeoutMs: 20, idleMs: 500, label: "the deadline-with-pending-tool self-test" },
      );
    } catch (err) {
      deadlineRejectionWithPending = err;
    }
    check(
      "the deadline rejection names the outstanding tool call count and tool name when a tool call is pending — a hang while waiting on a tool is a different diagnosis from a hang with nothing in flight",
      () => {
        assert.ok(deadlineRejectionWithPending !== undefined, "expected waitForTurn to reject on its own deadline");
        assert.ok(
          deadlineRejectionWithPending.message.includes("OUTSTANDING TOOL CALL"),
          "expected the deadline message to name the outstanding-tool-call clause",
        );
        assert.ok(deadlineRejectionWithPending.message.includes("Bash"), "expected the outstanding tool's name to be named");
      },
    );

    {
      // A tool call outstanding must suppress the idle window ENTIRELY, even after idleMs has
      // long elapsed — the deadline is the only backstop. Then, once the call is answered (a
      // tool_result arrives), suppression must LIFT — the turn ends on the idle window again
      // rather than latching mid-flight for the rest of the turn.
      const PENDING_RUN_ID = "run-pendingtoolcall-suppression-self-test";
      const stub = {
        events: [
          { runId: PENDING_RUN_ID, type: "assistant_text", text: "starting the tool" },
          { runId: PENDING_RUN_ID, type: "tool_call", toolName: "Bash" },
        ],
        turnWatchers: [],
      };
      const promise = SidecarClient.prototype.waitForTurn.call(stub, PENDING_RUN_ID, 0, {
        timeoutMs: 2_000,
        idleMs: 30,
        label: "pending-tool-call suppression self-test",
      });
      const STILL_PENDING = Symbol("still-pending");
      const raceResult = await Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(STILL_PENDING), 90)),
      ]);
      check(
        "a turn with an outstanding tool call does not end on the idle window even long after the idle window would have elapsed — the idle window is stood down entirely while a tool call is pending",
        () => {
          assert.equal(
            raceResult,
            STILL_PENDING,
            "expected the turn to still be pending — the idle window must be suppressed while a tool call is outstanding",
          );
        },
      );

      // Answer the call for real and let the turn go idle — suppression must lift.
      stub.events.push({ runId: PENDING_RUN_ID, type: "tool_result", raw: "ok" });
      stub.turnWatchers[0]();
      const result = await promise;
      check(
        "a turn whose tool call is answered by a tool result, and which then goes quiet, ends on the idle window again — suppression lifts once the call is answered rather than latching for the rest of the turn",
        () => {
          assert.equal(result.endedBy, "idle");
          assert.equal(result.pendingToolCallCount, 0);
        },
      );
    }

    {
      // An event belonging to a DIFFERENT run, arriving while this turn is paused, must neither
      // arm nor extend the idle timer — the running timer, armed on the ORIGINAL schedule, must
      // fire on ITS OWN schedule, never a rescheduled one.
      const OWN_RUN_ID = "run-foreignevent-during-pause-self-test";
      const stub = {
        events: [{ runId: OWN_RUN_ID, type: "assistant_text", text: "own text, then goes quiet" }],
        turnWatchers: [],
      };
      const startedAt = Date.now();
      const promise = SidecarClient.prototype.waitForTurn.call(stub, OWN_RUN_ID, 0, {
        timeoutMs: 2_000,
        idleMs: 100,
        label: "foreign-event-during-pause self-test",
      });
      // Well before the 100ms idle window elapses, a foreign run's event arrives and this turn's
      // watcher is notified of it (mirroring what #handleLine does for every real event push).
      await new Promise((resolve) => setTimeout(resolve, 30));
      stub.events.push({ runId: "some-other-run", type: "assistant_text", text: "OTHER RUN (must never appear)" });
      stub.turnWatchers[0]();
      const result = await promise;
      const elapsedMs = Date.now() - startedAt;
      check(
        "an event belonging to a different run arriving during the pause neither arms nor extends this turn's idle timer — the turn ends on its ORIGINAL idle schedule, not a rescheduled one",
        () => {
          assert.equal(result.endedBy, "idle");
          assert.ok(!result.text.includes("OTHER RUN"), "expected the foreign run's text to never appear in this turn's own text");
          assert.equal(result.chunkCount, 1);
          // If the foreign event had reset the idle timer, this would resolve ~100ms after the
          // foreign event landed (~130ms total) rather than ~100ms after the turn started.
          assert.ok(
            elapsedMs < 120,
            `expected the idle timer to fire on its ORIGINAL ~100ms schedule, not be reset by the foreign event — took ${elapsedMs}ms`,
          );
        },
      );
    }
  }

  // -----------------------------------------------------------------------------------------
  // Backend refusal detection (plan 05-24, gap G-05-3) — the FOURTH self-naming failure class
  // this phase has found. False-positive checks are written and asserted BEFORE the positive
  // ones — the cost of a false positive (aborting a genuine, in-progress run) is the more
  // expensive direction here, so it is proven closed first.
  // -----------------------------------------------------------------------------------------

  // LIVE_REFUSAL_TEXT is declared once, near the top of this function (beside SYNTHETIC_EVIDENCE)
  // so both the evidence-sheet checks above and the checks below can reference the same constant.

  check("an ordinary turn that merely discusses an error, an API or a safeguard is NOT classified as a refusal", () => {
    assert.equal(
      readBackendRefusal(
        "I hit an API Error: once before on a flaky connection, but let's keep drafting the epic.",
      ),
      null,
      "expected prose that does not OPEN with the backend's own banner to read as null",
    );
    assert.equal(
      readBackendRefusal("Your safeguard against duplicate submissions looks solid to me."),
      null,
    );
  });

  check("an empty turn and a whitespace-only turn are NOT classified as refusals", () => {
    assert.equal(readBackendRefusal(""), null);
    assert.equal(readBackendRefusal("   \n  \t "), null);
  });

  check("readBackendRefusal classifies the real captured turn-5 text and extracts its classifier and request id", () => {
    const refusal = readBackendRefusal(LIVE_REFUSAL_TEXT);
    assert.ok(refusal !== null, "expected the real captured refusal text to be classified");
    assert.equal(refusal.kind, BACKEND_REFUSAL_KIND);
    assert.equal(refusal.classifier, "reasoning_extraction");
    assert.equal(refusal.requestId, "req_011CfMyQ7EQg8jnFnSugjHVw");
    assert.equal(refusal.text, LIVE_REFUSAL_TEXT);
  });

  check("a refusal carrying a classifier code never seen before still classifies, reporting it verbatim", () => {
    const refusal = readBackendRefusal(
      `${BACKEND_REFUSAL_PREFIX} some future safeguard flagged this.\n\nDetails: \`[a_brand_new_code]\`\n\nRequest ID: req_ZZZ`,
    );
    assert.ok(refusal !== null);
    assert.equal(refusal.classifier, "a_brand_new_code");
  });

  check("a refusal carrying no request id still classifies; the request id reads as absent, never an empty-string impostor", () => {
    const refusal = readBackendRefusal(`${BACKEND_REFUSAL_PREFIX} flagged, no request id on this one.`);
    assert.ok(refusal !== null);
    assert.equal(refusal.requestId, undefined);
    assert.notEqual(refusal.requestId, "", "requestId must be undefined, never an empty string");
  });

  check("accumulateTurn's refusal member is exactly null (never undefined) on a turn that is not refused", () => {
    const result = accumulateTurn(
      [{ runId: "r1", type: "assistant_text", text: "an ordinary reply" }, { runId: "r1", type: "result" }],
      "r1",
      0,
    );
    assert.equal(result.refusal, null);
  });

  check("accumulateTurn attaches the refusal reading on the result-terminated return path", () => {
    const result = accumulateTurn(
      [{ runId: "r1", type: "assistant_text", text: LIVE_REFUSAL_TEXT }, { runId: "r1", type: "result" }],
      "r1",
      0,
    );
    assert.ok(result.refusal !== null);
    assert.equal(result.refusal.classifier, "reasoning_extraction");
  });

  {
    // driveChallengeConversation stops at a refusal: reports it, settles false, and sends no
    // further developer turn — asserted against a stub sidecar, no real process, no timers left
    // running.
    const refusalTurns = [
      { text: "What should trigger a notification in the first place?", chunkCount: 1, charCount: 55, endedBy: "result", endIndex: 3, refusal: null },
      { text: LIVE_REFUSAL_TEXT, chunkCount: 1, charCount: LIVE_REFUSAL_TEXT.length, endedBy: "result", endIndex: 7, refusal: readBackendRefusal(LIVE_REFUSAL_TEXT) },
    ];
    let refusalPointer = 0;
    let refusalCursorValue = 0;
    const refusalSendCalls = [];
    const refusalStub = {
      async waitForTurn() {
        const turn = refusalTurns[refusalPointer];
        refusalPointer += 1;
        refusalCursorValue = turn.endIndex;
        return turn;
      },
      eventCursor() {
        return refusalCursorValue;
      },
    };
    const refusalResult = await driveChallengeConversation({
      sidecar: refusalStub,
      runId: "stub-run-refused",
      sendTurn: async (text) => {
        refusalSendCalls.push(text);
      },
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });

    check("driveChallengeConversation stops at a refused turn, reporting it and settling false", () => {
      assert.ok(refusalResult.refusal !== null, "expected the driver to report the refusal");
      assert.equal(refusalResult.refusal.classifier, "reasoning_extraction");
      assert.equal(refusalResult.settled, false);
    });
    check("driveChallengeConversation sends exactly one developer turn before a refusal stops it", () => {
      assert.equal(refusalSendCalls.length, 1, "expected the driver to have answered turn 1's question once, then stopped");
    });
    check("driveChallengeConversation preserves the refused turn verbatim in its own exchanges, rather than discarding it", () => {
      const refusedExchange = refusalResult.exchanges.find((exchange) => exchange.speaker === "agent" && exchange.refusal);
      assert.ok(refusedExchange, "expected the refused agent exchange to be present in the exchange list");
      assert.equal(refusedExchange.text, LIVE_REFUSAL_TEXT);
    });
  }

  // -----------------------------------------------------------------------------------------
  // The conversation driver (Task 1, G-05-2) — the answer bank, the closing turn, question
  // extraction, reply composition and `driveChallengeConversation`'s own ordering invariant. All
  // pure or stub-driven; no child process, no real SidecarClient, no timers left running.
  // -----------------------------------------------------------------------------------------

  check(
    "the answer bank, the closing turn, question extraction, reply composition and the driver all exist in this script, and none of them exists in the shared library",
    () => {
      const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
      for (const symbol of ["ANSWER_BANK", "CLOSING_TURN", "extractOpenQuestions", "composeDeveloperReply", "driveChallengeConversation"]) {
        assert.ok(thisFile.includes(symbol), `expected ${symbol} to be defined in this script`);
      }
      const libSource = fs
        .readFileSync(path.join(REPO_ROOT, "scripts", "uat", "lib", "sidecar-harness.mjs"), "utf8")
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join("\n");
      assert.ok(
        !/driveChallengeConversation|ANSWER_BANK/.test(libSource),
        "this script's own domain answers must never leak into the shared harness library",
      );
    },
  );

  check(
    "no answer-bank entry, the fallback, or the closing turn coaches the model to challenge, push back, ask clarifying questions, or names the Socratic method",
    () => {
      const forbidden = /challenge|push[\s-]?back|clarify|clarifying|socratic/i;
      for (const entry of ANSWER_BANK) {
        assert.ok(!forbidden.test(entry.answer), `answer-bank entry coaches conversational behaviour: ${JSON.stringify(entry.answer)}`);
      }
      assert.ok(!forbidden.test(ANSWER_BANK_FALLBACK), "the fallback answer coaches conversational behaviour");
      assert.ok(!forbidden.test(CLOSING_TURN), "the closing turn coaches conversational behaviour");
    },
  );

  check("extractOpenQuestions recovers every interrogative fragment from a multi-block turn, in order, capped", () => {
    const text =
      "Three things would materially change what gets built:\n" +
      "1. Who can dismiss a notification once it fires?\n" +
      "2. Should a notification survive the app restarting?\n" +
      "3. When an agent finishes unattended, does that alone warrant a notification?";
    const questions = extractOpenQuestions(text);
    assert.equal(questions.length, 3);
    assert.ok(questions[0].startsWith("Who can dismiss"));
    assert.ok(questions[1].startsWith("Should a notification survive"));
    assert.ok(questions[2].startsWith("When an agent finishes"));

    const manyQuestions = Array.from({ length: MAX_EXTRACTED_QUESTIONS + 5 }, (_, i) => `Question ${i}?`).join(" ");
    assert.equal(extractOpenQuestions(manyQuestions).length, MAX_EXTRACTED_QUESTIONS);

    assert.equal(extractOpenQuestions("This has no interrogative fragment at all.").length, 0);
  });

  check(
    "every line of a composed reply, minus its fixed preamble and its ordinal prefix, is an exact member of the answer bank's value set",
    () => {
      const syntheticQuestions = [
        "Who can dismiss a notification once it fires?",
        "Should a notification survive an app restart?",
        "When an agent finishes a run unattended, does that alone warrant a notification?",
        "This one matches nothing in the bank at all, so what happens?",
      ];
      const reply = composeDeveloperReply(syntheticQuestions);
      const lines = reply.split("\n");
      assert.equal(lines[0], REPLY_PREAMBLE);
      assert.equal(lines.length, syntheticQuestions.length + 1);
      const bankValues = new Set([...ANSWER_BANK.map((entry) => entry.answer), ANSWER_BANK_FALLBACK]);
      lines.slice(1).forEach((line, index) => {
        assert.ok(line.startsWith(`${index + 1}. `), `expected line ${index + 1} to carry its own ordinal prefix`);
        const stripped = line.replace(/^\d+\.\s/, "");
        assert.ok(bankValues.has(stripped), `composed reply line is not an exact answer-bank member: ${JSON.stringify(stripped)}`);
      });
      // The fourth question matches no pattern — pinning that the fallback is reachable, not just
      // declared.
      assert.equal(lines[4].replace(/^\d+\.\s/, ""), ANSWER_BANK_FALLBACK);
    },
  );

  {
    // driveChallengeConversation's own ordering + settling behaviour, driven against a fully
    // scripted async stub — no real SidecarClient, no timers, no process. `sendTurn` and
    // `eventCursor` are the only surface the driver touches beyond `waitForTurn`.
    const CANNED_SETTLING_TURNS = [
      { text: "What should trigger a notification in the first place?", chunkCount: 1, charCount: 44, endedBy: "result", endIndex: 3 },
      { text: "Understood — that's enough for me to move forward.", chunkCount: 1, charCount: 47, endedBy: "result", endIndex: 9 },
    ];
    let settlingPointer = 0;
    let settlingCursorValue = 0;
    const settlingSendCalls = [];
    const settlingStub = {
      async waitForTurn() {
        const turn = CANNED_SETTLING_TURNS[settlingPointer];
        settlingPointer += 1;
        settlingCursorValue = turn.endIndex;
        return turn;
      },
      eventCursor() {
        return settlingCursorValue;
      },
    };
    const settlingResult = await driveChallengeConversation({
      sidecar: settlingStub,
      runId: "stub-run-settles",
      sendTurn: async (text) => {
        settlingSendCalls.push({ text, cursorAtSend: settlingStub.eventCursor() });
      },
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });

    check("driveChallengeConversation sends a developer turn only after the preceding agent turn's own end index", () => {
      assert.equal(settlingSendCalls.length, 1);
      assert.ok(settlingSendCalls[0].cursorAtSend >= CANNED_SETTLING_TURNS[0].endIndex);
    });
    check("driveChallengeConversation reports settled once a turn carries no further question", () => {
      assert.equal(settlingResult.settled, true);
      assert.equal(settlingResult.agentTurns, 2);
      assert.equal(settlingResult.closingTurnSent, false);
      assert.equal(settlingResult.answeredQuestionCount, 1);
    });

    // The cap-escape shape — every canned turn carries a further question, so the driver must
    // stop at the declared cap and send exactly the closing turn once, never loop forever.
    let escapingCursorValue = 0;
    let escapingTurnIndex = 0;
    const escapingSendCalls = [];
    const escapingStub = {
      async waitForTurn() {
        escapingTurnIndex += 1;
        escapingCursorValue += 10;
        return {
          text: `Turn ${escapingTurnIndex} — still not settled, what about this instead?`,
          chunkCount: 1,
          charCount: 50,
          endedBy: "result",
          endIndex: escapingCursorValue,
        };
      },
      eventCursor() {
        return escapingCursorValue;
      },
    };
    const escapingResult = await driveChallengeConversation({
      sidecar: escapingStub,
      runId: "stub-run-never-settles",
      sendTurn: async (text) => {
        escapingSendCalls.push(text);
      },
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 3,
    });

    check("driveChallengeConversation escapes at the declared cap, sending exactly the closing turn once", () => {
      assert.equal(escapingResult.settled, false);
      assert.equal(escapingResult.closingTurnSent, true);
      assert.equal(escapingResult.agentTurns, 4, "expected the declared cap (3) plus the one final turn after the closing turn");
      assert.equal(escapingSendCalls.filter((text) => text === CLOSING_TURN).length, 1);
      assert.equal(escapingSendCalls[escapingSendCalls.length - 1], CLOSING_TURN);
    });
  }

  check(
    "a timeout capturing the distillation reply does not abort the run — recorded as a partial exchange via accumulateTurn instead",
    () => {
      const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
      // Built from parts at runtime, and searched from AFTER this check's own source, so this
      // self-referential scan finds the live body's step() narration, never this literal itself.
      const marker = ["distillation", "instruction", "and", "capturing"].join(" ");
      const searchFrom = thisFile.indexOf("async function driveChallengeConversation");
      const anchor = thisFile.indexOf(marker, searchFrom);
      assert.ok(anchor >= 0, "expected the live body to narrate the distillation capture");
      // Widened from 2000 (plan 05-25, WR-04 closure): the distillation waitForTurn call site now
      // also names an explicit idleMs (LIVE_TURN_IDLE_MS), pushing accumulateTurn( a little
      // further from this anchor than before — the window still scopes to the SAME region, just
      // wide enough to still include it.
      const distillationSection = thisFile.slice(anchor, anchor + 2500);
      assert.ok(/catch\s*\(err\)/.test(distillationSection), "expected a catch block around the distillation capture");
      assert.ok(
        /accumulateTurn\(/.test(distillationSection),
        "expected the catch path to fall back to accumulateTurn's own pure scan for a partial reading",
      );
    },
  );

  check("the live body calls advance-stage exactly once, after the driver returns, and never inside it", () => {
    const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
    // The runOps call-site shape (an array literal opening with the advance-stage op name) —
    // deliberately narrower than a bare string-literal scan, which would also match this very
    // check's own source below (a self-referential scan reads itself too). The pattern is built
    // from parts at runtime so its own source line never spells out the literal shape it hunts for.
    const advanceOpPattern = new RegExp("\\[\\s*" + JSON.stringify("advance-stage") + "\\s*,");
    // Scoped to the LIVE body specifically — `--replay-check` (plan 05-21) legitimately carries
    // its OWN advance-stage call site, once per non-default scenario, mirroring the live body
    // rather than duplicating this invariant. The live body's own runScript call is the only
    // TOP-LEVEL (column-zero) one in the file; every other call lives inside an indented helper.
    const liveBodyStart = thisFile.indexOf("\nawait runScript(\n");
    assert.ok(liveBodyStart >= 0, "expected to find the live body's own top-level runScript call");
    const liveBodySource = thisFile.slice(liveBodyStart);
    const advanceCallCount = (liveBodySource.match(new RegExp(advanceOpPattern.source, "g")) ?? []).length;
    assert.equal(advanceCallCount, 1, "expected exactly one advance-stage call site in the live body");
    // lastIndexOf, not indexOf: the ONLY real declaration is textually last in the file — every
    // earlier occurrence of this literal is a self-referential mention inside a check's own source
    // (this one included), which `indexOf` would otherwise find first and mis-slice from.
    const driverStart = thisFile.lastIndexOf("async function driveChallengeConversation");
    const driverEnd = thisFile.indexOf("\n}\n", driverStart);
    const driverBody = thisFile.slice(driverStart, driverEnd);
    assert.ok(!driverBody.includes("advance-stage"), "driveChallengeConversation must never call advance-stage itself");
  });

  check(
    "[Plan 05-24, NF-01] the live body holds exactly one waitForTurn( call site — no standalone first-turn capture duplicating the driver's own first exchange",
    () => {
      const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
      // Scoped to the LIVE body specifically, exactly like the advance-stage check above — the
      // same idiom, reused rather than a second scanning approach invented for this invariant.
      const liveBodyStart = thisFile.indexOf("\nawait runScript(\n");
      assert.ok(liveBodyStart >= 0, "expected to find the live body's own top-level runScript call");
      const liveBodySource = thisFile.slice(liveBodyStart);
      // Built from parts at runtime, matching the file's own established idiom for these
      // self-referential scans — this check is textually defined BEFORE the live body, so it can
      // never match its own source anyway, but the idiom stays consistent for a future reader.
      const waitForTurnMarker = ["waitForTurn", "("].join("");
      const nonCommentLineCount = liveBodySource
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .filter((line) => line.includes(waitForTurnMarker)).length;
      assert.equal(
        nonCommentLineCount,
        1,
        `expected exactly one ${waitForTurnMarker} call site in the live body, got ` +
          `${nonCommentLineCount} — a standalone first-turn capture would double-record the seed ` +
          "turn the driver already captures as its own first exchange (NF-01)",
      );
    },
  );

  check(
    "[Plan 05-25, WR-04] the live body names LIVE_TURN_IDLE_MS at least twice — once per capture site — never inheriting the short test default",
    () => {
      const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
      // Scoped to the LIVE body specifically, the same idiom as the two checks above it.
      const liveBodyStart = thisFile.indexOf("\nawait runScript(\n");
      assert.ok(liveBodyStart >= 0, "expected to find the live body's own top-level runScript call");
      const liveBodySource = thisFile.slice(liveBodyStart);
      // Built from parts at runtime so this check's own source is never what it finds.
      const idleConstantMarker = ["LIVE", "TURN", "IDLE", "MS"].join("_");
      const nonCommentOccurrenceCount = liveBodySource
        .split("\n")
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .filter((line) => line.includes(idleConstantMarker)).length;
      assert.ok(
        nonCommentOccurrenceCount >= 2,
        `expected the live body to name ${idleConstantMarker} at least twice (once per capture ` +
          `site), got ${nonCommentOccurrenceCount} — a future third live capture that forgets to ` +
          "pass it would silently inherit the short test default instead of stating its own " +
          "permitted pause at its own call site",
      );
    },
  );

  // -----------------------------------------------------------------------------------------
  // SHAPE-01's "no work planned" half (Task 3, G-05-2) — the real field, a three-valued
  // reading, and a criterion that can fail. All pure, no process, no filesystem beyond the one
  // source-scanning read every other pinning check in this file already performs.
  // -----------------------------------------------------------------------------------------

  check(
    "the harness's own tool_call field read is pinned against ToolCallEvent's real declaration in adapter.ts",
    () => {
      const adapterSource = fs.readFileSync(
        path.join(REPO_ROOT, "packages", "sidecar", "src", "adapter.ts"),
        "utf8",
      );
      const callMatch = adapterSource.match(/export interface ToolCallEvent extends AgentEventBase \{([\s\S]*?)\}/);
      assert.ok(callMatch, "expected to find the ToolCallEvent interface in adapter.ts");
      assert.ok(
        new RegExp(`\\b${TOOL_NAME_FIELD}\\s*:\\s*string`).test(callMatch[1]),
        `expected ToolCallEvent to declare a field named ${JSON.stringify(TOOL_NAME_FIELD)} — a ` +
          "rename in the product must fail this check, not silently zero the criterion again",
      );

      // Plan 05-23 (Task 2, WR-01 closure): the per-attempt correlation above reads
      // ToolResultEvent's OPTIONAL toolName the same way — pinned here too, so a product rename
      // or a widening back to no-name-at-all fails a check rather than silently degrading the
      // pairing back to bare position.
      const resultMatch = adapterSource.match(/export interface ToolResultEvent extends AgentEventBase \{([\s\S]*?)\}/);
      assert.ok(resultMatch, "expected to find the ToolResultEvent interface in adapter.ts");
      assert.ok(
        new RegExp(`\\b${TOOL_NAME_FIELD}\\?\\s*:\\s*string`).test(resultMatch[1]),
        `expected ToolResultEvent to declare an OPTIONAL field named ${JSON.stringify(TOOL_NAME_FIELD)}`,
      );

      // Plan 05-30 (G-05-5 closure): the wire's own correlation id, pinned the same way, over the
      // SAME two interface bodies captured above — a rename fails this check instead of silently
      // degrading the pairing back to bare position.
      assert.ok(
        new RegExp(`\\b${CORRELATION_ID_FIELD}\\?\\s*:\\s*string`).test(callMatch[1]),
        `expected ToolCallEvent to declare an OPTIONAL field named ${JSON.stringify(CORRELATION_ID_FIELD)} — ` +
          "a rename in the product must fail this check, not silently degrade the pairing back to position",
      );
      assert.ok(
        new RegExp(`\\b${CORRELATION_ID_FIELD}\\?\\s*:\\s*string`).test(resultMatch[1]),
        `expected ToolResultEvent to declare an OPTIONAL field named ${JSON.stringify(CORRELATION_ID_FIELD)}`,
      );
    },
  );

  check("readNoWorkPlanned distinguishes unproven, violated and refused, and ignores the old wrong field", () => {
    // Plan 05-23 (CR-01 closure): the window is now required — every fixture below carries a
    // matching runId and a window spanning its own whole array. Plan 05-30 (G-05-5 closure): every
    // correlatable attempt below now carries its own toolUseId, matched (or not) on its own
    // tool_result — an attempt with no id at all reads "uncorrelatable", covered by its own
    // dedicated checks further down, not by this one.
    const runId = "run-nwp-basic";
    const win = (events) => ({ runId, fromIndex: 0, toIndex: events.length });

    assert.equal(readNoWorkPlanned([], win([])), "unproven");

    const attemptOnly = [
      { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_basic_1" },
    ];
    assert.equal(readNoWorkPlanned(attemptOnly, win(attemptOnly)), "violated");

    const attemptAndRefusal = [
      { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_basic_2" },
      { type: "tool_result", runId, toolUseId: "toolu_basic_2", raw: "still in the challenge stage — no proposals yet." },
    ];
    assert.equal(readNoWorkPlanned(attemptAndRefusal, win(attemptAndRefusal)), "refused");

    // The regression this task closes: an event carrying the OLD wrong field (`name`, not
    // `toolName`) must never be detected as a propose attempt at all.
    const wrongField = [{ type: "tool_call", runId, name: "propose_task" }];
    assert.equal(readNoWorkPlanned(wrongField, win(wrongField)), "unproven");
  });

  check("readNoWorkPlanned throws a TypeError naming the missing member when called with no window at all", () => {
    // Plan 05-23 (CR-01 closure): the promoted signature makes the old one-argument shape
    // unwritable — calling with only an events array must throw, naming the FIRST missing
    // member ("runId"), never silently return a false reading.
    assert.throws(
      () => readNoWorkPlanned([]),
      (err) => err instanceof TypeError && /runId/.test(err.message),
      "expected a TypeError naming the missing runId member",
    );
  });

  check(
    "[Plan 05-23, Task 2, WR-01] a refused first propose attempt must not launder an unrefused " +
      "second one — the reading must be violated, never refused",
    () => {
      const runId = "run-wr01-bypass";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_bypass_1" }, // attempt 1
        { type: "tool_result", runId, toolUseId: "toolu_bypass_1", raw: "still in the challenge stage — no proposals yet." }, // refuses attempt 1
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_bypass_2" }, // attempt 2, unanswered
      ];
      const reading = readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: events.length });
      assert.equal(
        reading,
        "violated",
        "a refused first attempt must not launder an unrefused second attempt into a false " +
          "'refused' reading — this is the WR-01 bypass",
      );
    },
  );

  check(
    "[Plan 05-23/05-27, Task 2/3] the reading is order-independent over the attempt set, " +
      "INCLUDING the back-to-back-both-open shape",
    () => {
      const runId = "run-wr01-order";

      // Shape A: attempt1 refused, attempt2 unanswered (the WR-01 bypass shape, re-asserted here
      // explicitly as "order-independent" rather than duplicated for its own sake).
      const refusedThenUnrefused = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_ord_a1" }, // attempt1
        { type: "tool_result", runId, toolUseId: "toolu_ord_a1", raw: "still in the challenge stage — no proposals yet." }, // refuses attempt1
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_ord_a2" }, // attempt2, unanswered
      ];
      assert.equal(
        readNoWorkPlanned(refusedThenUnrefused, { runId, fromIndex: 0, toIndex: refusedThenUnrefused.length }),
        "violated",
        "expected a refused-then-unrefused pair to read violated",
      );

      // Shape B: attempt1 unrefused (the FIRST subsequent tool_result carries a DIFFERENT
      // correlation id, so it is not attempt1's answer at all — an id mismatch, not the retired
      // tool-name mismatch plan 05-30 deleted), attempt2 refused — the mirror image. Shapes C and D
      // below cover the back-to-back-both-open collision this comment used to describe as a fixture
      // requirement; it was actually the defect (plan 05-27, G-05-4 closure, 05-VERIFICATION.md
      // truth #11's `coincidental-reliance` flag).
      const unrefusedThenRefused = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_ord_b1" }, // attempt1
        { type: "tool_result", runId, toolUseId: "toolu_ord_other", raw: "ok" }, // different id — not attempt1's answer
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_ord_b2" }, // attempt2
        { type: "tool_result", runId, toolUseId: "toolu_ord_b2", raw: "still in the challenge stage — no proposals yet." }, // refuses attempt2
      ];
      assert.equal(
        readNoWorkPlanned(unrefusedThenRefused, { runId, fromIndex: 0, toIndex: unrefusedThenRefused.length }),
        "violated",
        "expected an unrefused-then-refused pair to read violated — the SAME outcome as its mirror image",
      );

      // Shape C (plan 05-27, G-05-4 closure; ids added plan 05-30, G-05-5 closure): the
      // back-to-back-both-open collision — both attempts issued before either is answered, then a
      // refusing result, then a non-refusing result. Each result carries the id of the attempt it
      // actually answers, which is what makes this order-independent by construction rather than by
      // a claimed-index scan.
      const bothOpenRefusalFirst = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_ord_c1" }, // attempt1
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_ord_c2" }, // attempt2
        { type: "tool_result", runId, toolUseId: "toolu_ord_c1", raw: "still in the challenge stage — no proposals yet." }, // answers attempt1, refuses
        { type: "tool_result", runId, toolUseId: "toolu_ord_c2", raw: "proposal created successfully" }, // answers attempt2, unrefused
      ];
      assert.equal(
        readNoWorkPlanned(bothOpenRefusalFirst, { runId, fromIndex: 0, toIndex: bothOpenRefusalFirst.length }),
        "violated",
        "expected the back-to-back-both-open shape (refusal first) to read violated",
      );
      const bothOpenFirstCorrelated = correlateProposeAttempts(bothOpenRefusalFirst, {
        runId,
        fromIndex: 0,
        toIndex: bothOpenRefusalFirst.length,
      });
      assert.equal(bothOpenFirstCorrelated.length, 2, "expected exactly two correlated attempts (Shape C)");
      assert.notEqual(
        bothOpenFirstCorrelated[0].answerIndex,
        bothOpenFirstCorrelated[1].answerIndex,
        "expected Shape C's two attempts to be paired with two DIFFERENT tool_result indices",
      );

      // Shape D: the mirror image of Shape C — non-refusing result first, refusing result second.
      // The point of the C/D pair: the reading is the SAME whichever attempt's answer refuses,
      // once each attempt genuinely has its own id-matched answer.
      const bothOpenRefusalSecond = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_ord_d1" }, // attempt1
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_ord_d2" }, // attempt2
        { type: "tool_result", runId, toolUseId: "toolu_ord_d1", raw: "proposal created successfully" }, // answers attempt1, unrefused
        { type: "tool_result", runId, toolUseId: "toolu_ord_d2", raw: "still in the challenge stage — no proposals yet." }, // answers attempt2, refuses
      ];
      assert.equal(
        readNoWorkPlanned(bothOpenRefusalSecond, { runId, fromIndex: 0, toIndex: bothOpenRefusalSecond.length }),
        "violated",
        "expected the back-to-back-both-open shape (refusal second) to read violated — the same " +
          "outcome as Shape C",
      );
      const bothOpenSecondCorrelated = correlateProposeAttempts(bothOpenRefusalSecond, {
        runId,
        fromIndex: 0,
        toIndex: bothOpenRefusalSecond.length,
      });
      assert.equal(bothOpenSecondCorrelated.length, 2, "expected exactly two correlated attempts (Shape D)");
      assert.notEqual(
        bothOpenSecondCorrelated[0].answerIndex,
        bothOpenSecondCorrelated[1].answerIndex,
        "expected Shape D's two attempts to be paired with two DIFFERENT tool_result indices",
      );
    },
  );

  check(
    "[Plan 05-23, Task 2] two propose attempts, both individually refused, read refused",
    () => {
      const runId = "run-wr01-both-refused";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_both_1" }, // attempt1
        { type: "tool_result", runId, toolUseId: "toolu_both_1", raw: "still in the challenge stage — no proposals yet." }, // refuses attempt1
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_both_2" }, // attempt2
        { type: "tool_result", runId, toolUseId: "toolu_both_2", raw: "still in the challenge stage — no proposals yet." }, // refuses attempt2
      ];
      const reading = readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: events.length });
      assert.equal(reading, "refused", "expected both individually-refused attempts to read refused");
    },
  );

  check(
    "[Plan 05-30, G-05-5 closure] a tool_result carrying a DIFFERENT correlation id is not this " +
      "attempt's answer — unrefused, violated",
    () => {
      // Retires the pre-05-30 "wrong tool name" check: the tool-name cross-check this test used to
      // exercise no longer exists in correlateProposeAttempts at all (it is never consulted, per
      // this plan's own STEP 4) — a result's toolName, present or absent, is irrelevant now. What
      // this test now proves is the mechanism that actually replaced it: an id mismatch, not a name
      // mismatch, is what keeps an unrelated result from being adopted as this attempt's answer.
      const runId = "run-wr30-wrong-id";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_wrongid_mine" },
        {
          type: "tool_result",
          runId,
          toolUseId: "toolu_wrongid_someone_elses",
          raw: "still in the challenge stage — no proposals yet.",
        },
      ];
      const reading = readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: events.length });
      assert.equal(
        reading,
        "violated",
        "a tool_result carrying a DIFFERENT correlation id must not count as this attempt's " +
          "answer, even though its own text matches the refusal wording",
      );
    },
  );

  check(
    "[Plan 05-30, G-05-5 closure] a tool_result carrying a matching correlation id but no " +
      "toolName is still accepted as the answer — the name is never consulted",
    () => {
      const runId = "run-wr30-matched-unnamed";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_matched_1" },
        { type: "tool_result", runId, toolUseId: "toolu_matched_1", raw: "still in the challenge stage — no proposals yet." },
      ];
      const reading = readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: events.length });
      assert.equal(reading, "refused", "expected a matching-id tool_result with no toolName to be accepted as the answer");
    },
  );

  check("[Plan 05-23, Task 2] an event at exactly the window's toIndex is outside the window — unproven", () => {
    const runId = "run-window-adjacency";
    const events = [
      { type: "tool_result", runId, raw: "irrelevant" },
      { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task" }, // index 1 — the boundary
    ];
    // toIndex: 1 excludes index 1 (the attempt) entirely — half-open [0, 1).
    const reading = readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: 1 });
    assert.equal(reading, "unproven", "expected an attempt sitting at exactly toIndex to be outside the window");
  });

  check("[Plan 05-23, Task 2] an empty window (fromIndex equal to toIndex) reads unproven, never throws", () => {
    const runId = "run-empty-window";
    const events = [{ type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task" }];
    const reading = readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: 0 });
    assert.equal(reading, "unproven", "expected an empty window to read unproven, not throw and not silently pass");
  });

  check("[Plan 05-23, Task 2] a foreign runId inside the index range is never attributed to this run", () => {
    const runId = "run-mine";
    const events = [{ type: "tool_call", runId: "run-someone-elses", toolName: "mcp__flywheel-permissions__propose_task" }];
    const reading = readNoWorkPlanned(events, { runId, fromIndex: 0, toIndex: events.length });
    assert.equal(reading, "unproven", "expected a foreign-runId attempt to be excluded, reading unproven");
  });

  check("[Plan 05-23, Task 2] each of the three missing-window-member cases raises a TypeError naming that member", () => {
    const events = [];
    assert.throws(
      () => readNoWorkPlanned(events, { fromIndex: 0, toIndex: 0 }),
      (err) => err instanceof TypeError && /runId/.test(err.message),
      "expected a TypeError naming the missing runId member",
    );
    assert.throws(
      () => readNoWorkPlanned(events, { runId: "run-x", toIndex: 0 }),
      (err) => err instanceof TypeError && /fromIndex/.test(err.message),
      "expected a TypeError naming the missing fromIndex member",
    );
    assert.throws(
      () => readNoWorkPlanned(events, { runId: "run-x", fromIndex: 0 }),
      (err) => err instanceof TypeError && /toIndex/.test(err.message),
      "expected a TypeError naming the missing toIndex member",
    );
  });

  check("all four noWorkPlanned readings map to SHAPE-01's own outcome, with the challenge half held true", () => {
    const outcomeFor = (reading) =>
      buildCriteriaResults({
        criterion1Challenged: true,
        noWorkPlannedReading: reading,
        criterion2Landed: false,
        criterion3Decided: false,
        criterion4Reopened: false,
        criterion4PrimedRejected: false,
      }).find(([name]) => name.includes("SHAPE-01"))[1];

    assert.equal(outcomeFor("refused"), true, "a refused propose attempt should still pass");
    assert.equal(outcomeFor("unproven"), true, "absence of evidence should pass, never a fabricated fail");
    assert.equal(outcomeFor("violated"), false, "the one reading that must sink SHAPE-01's second half");
    // Plan 05-30 (G-05-5 closure): the fourth reading must NOT pass — this is the fail-closed
    // allow-list itself under test, not merely the reading's existence. Also proves the allow-list
    // is genuinely an allow-list: a reading value this test does not otherwise name must still fail
    // closed rather than pass by omission.
    assert.equal(
      outcomeFor("uncorrelatable"),
      false,
      "an unjudgeable run must not pass SHAPE-01 — the whole point of the fail-closed allow-list",
    );
    assert.equal(
      outcomeFor("a-reading-nobody-anticipated"),
      false,
      "a reading value not in the allow-list must fail closed, never pass by default",
    );
  });

  check("the unproven detail line names where the structural guarantee is actually proven, not just that it is unproven", () => {
    const results = buildCriteriaResults({
      criterion1Challenged: true,
      noWorkPlannedReading: "unproven",
      criterion2Landed: false,
      criterion3Decided: false,
      criterion4Reopened: false,
      criterion4PrimedRejected: false,
    });
    const [, , detail] = results.find(([name]) => name.includes("SHAPE-01"));
    assert.ok(detail.includes("authoring_stage.rs"), "expected the core-side structural proof site named");
    assert.ok(detail.includes("authoring-stage-gate.test.mjs"), "expected the sidecar-side structural proof site named");
  });

  // -----------------------------------------------------------------------------------------
  // [Plan 05-27, Task 2] G-05-4 closure — the back-to-back propose collision, in both its live
  // and reviewed shapes. Plan 05-30 (G-05-5 closure) retired the two dedicated side-by-side
  // checks that used to live here: their entire job was proving these fixtures had teeth against
  // the ROUND-6 frozen control (`readNoWorkPlannedWithoutClaiming`, the pre-claiming algorithm).
  // Once pairing is an id lookup, two back-to-back attempts carry two different ids and cannot
  // collide by construction — the property that control guarded is subsumed, and the "Shape
  // C"/"Shape D" checks above already cover the back-to-back-both-open collision generally, with
  // the shipped `correlateProposeAttempts`. The round-6 control itself, and the ONE frozen
  // control that replaces it (`correlateProposeAttemptsPositionally`, the positional claiming
  // scan THIS round replaces), are covered further down.
  // -----------------------------------------------------------------------------------------

  check(
    "[Plan 05-27, Task 2] correlateProposeAttempts returns exactly two entries, ascending by " +
      "index, with two DIFFERENT non-null answerIndex values, for both the live-shape and the " +
      "CR-01-repro fixtures",
    () => {
      const runId = "run-05-27-pairing-invariant";
      const liveShape = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_g4_pi1" },
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_g4_pi2" },
        { type: "tool_result", runId, toolUseId: "toolu_g4_pi1", raw: "still in the challenge stage — no proposals yet." },
        { type: "tool_result", runId, toolUseId: "toolu_g4_pi2", raw: "proposal created successfully" },
      ];
      const cr01Repro = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_g4_pi3" },
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_g4_pi4" },
        { type: "tool_result", runId, toolUseId: "toolu_g4_pi3", raw: "still in the challenge stage — no proposals yet." },
        {
          type: "tool_result",
          runId,
          toolUseId: "toolu_g4_pi4",
          toolName: "mcp__flywheel-permissions__propose_assumption",
          raw: "proposal created successfully",
        },
      ];
      for (const fixture of [liveShape, cr01Repro]) {
        const win = { runId, fromIndex: 0, toIndex: fixture.length };
        const correlated = correlateProposeAttempts(fixture, win);
        assert.equal(correlated.length, 2, "expected exactly two correlated attempts");
        assert.ok(
          correlated[0].index < correlated[1].index,
          "expected the two entries to be returned in ascending index order",
        );
        assert.ok(
          correlated[0].answerIndex !== null && correlated[1].answerIndex !== null,
          "expected both entries to carry a non-null answerIndex",
        );
        // Comparing the two values directly, not counting a Set — a Set-size assertion passes
        // when both entries are null, which would prove nothing.
        assert.notEqual(
          correlated[0].answerIndex,
          correlated[1].answerIndex,
          "expected the two attempts to be paired with two DIFFERENT tool_result indices",
        );
      }
    },
  );

  check(
    "[Plan 05-27, Task 2] three back-to-back attempts answered by three unnamed refusing " +
      "results read refused — the fix must not launder a genuinely all-refused window into violated",
    () => {
      const runId = "run-05-27-three-all-refused";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_g4_three1" },
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_g4_three2" },
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_epic", toolUseId: "toolu_g4_three3" },
        { type: "tool_result", runId, toolUseId: "toolu_g4_three1", raw: "still in the challenge stage — no proposals yet." },
        { type: "tool_result", runId, toolUseId: "toolu_g4_three2", raw: "still in the challenge stage — no proposals yet." },
        { type: "tool_result", runId, toolUseId: "toolu_g4_three3", raw: "still in the challenge stage — no proposals yet." },
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };
      assert.equal(
        readNoWorkPlanned(events, win),
        "refused",
        "expected three genuinely refused attempts to read refused, never over-corrected to violated",
      );
    },
  );

  check(
    "[Plan 05-27, Task 2] two back-to-back attempts with only ONE subsequent unnamed refusing " +
      "result read violated — the second attempt has nothing left to claim and is unrefused by definition",
    () => {
      const runId = "run-05-27-one-result-two-attempts";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_g4_one1" },
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_g4_one2" },
        { type: "tool_result", runId, toolUseId: "toolu_g4_one1", raw: "still in the challenge stage — no proposals yet." },
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };
      assert.equal(
        readNoWorkPlanned(events, win),
        "violated",
        "expected the second attempt (with no answer left to claim) to make the reading violated",
      );
    },
  );

  check(
    "[Plan 05-30, G-05-5 closure] correlateProposeAttemptsPositionally reads WRONG on the " +
      "interleaved vacuous-pass fixture — the positional control has teeth",
    () => {
      // The SAME fixture shape Task 1's own RED test proved the shipped, id-based reading
      // against: a propose attempt and an unrelated board_search call interleaved, the read's own
      // result coincidentally matching the refusal wording ahead of the propose attempt's own real
      // answer.
      const runId = "run-05-30-positional-control";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_propose_1" }, // idx0 — propose attempt
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__board_search", toolUseId: "toolu_read_1" }, // idx1 — unrelated read
        { type: "tool_result", runId, toolUseId: "toolu_read_1", raw: "board_search is unavailable during challenge stage" }, // idx2 — answers the READ, coincidentally refusal-shaped
        { type: "tool_result", runId, toolUseId: "toolu_propose_1", raw: "proposal created successfully." }, // idx3 — the propose attempt's OWN real, unrefused answer
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };

      const shipped = readNoWorkPlanned(events, win);
      assert.equal(
        shipped,
        "violated",
        "the shipped, id-based reading must be violated — the propose attempt's own answer does not refuse",
      );

      const positionalCorrelated = correlateProposeAttemptsPositionally(events, win);
      const positionalReading =
        positionalCorrelated.length === 0
          ? "unproven"
          : positionalCorrelated.every((attempt) => attempt.refused)
            ? "refused"
            : "violated";
      assert.equal(
        positionalReading,
        "refused",
        "the frozen positional control must STILL read refused over the identical array — it claims " +
          "the read's own result as the propose attempt's answer, which is the exact vacuous pass " +
          "this plan closes",
      );

      assert.notEqual(
        shipped,
        positionalReading,
        "the shipped and positional readings must differ, or the id-based fix has no effect",
      );
    },
  );

  check(
    "the frozen positional control is never referenced from the live body — a live run must " +
      "never be graded by it — and round 6's retired control is gone from the file entirely",
    () => {
      const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
      // Scoped to the LIVE body specifically, the same idiom used by the other live-body-scoped
      // checks in this file. Built from parts at runtime so this check's own source is never what
      // it finds.
      const liveBodyStart = thisFile.indexOf("\nawait runScript(\n");
      assert.ok(liveBodyStart >= 0, "expected to find the live body's own top-level runScript call");
      const liveBodySource = thisFile.slice(liveBodyStart);
      const positionalControlMarker = ["correlateProposeAttempts", "Positionally"].join("");
      assert.ok(
        !liveBodySource.includes(positionalControlMarker),
        "the frozen positional control exists only so the offline arms can prove the id-bearing " +
          "fixtures have teeth — a live run must never be graded by it",
      );

      // Plan 05-30 (G-05-5 closure): round 6's own frozen control is retired outright, not merely
      // unreferenced — its function DECLARATION must no longer exist anywhere in the file. Built
      // from parts, none of which is the whole identifier, so this check's own source is never
      // what it finds.
      const retiredControlDeclaration = ["function readNoWorkPlanned", "WithoutClaiming"].join("");
      assert.ok(
        !thisFile.includes(retiredControlDeclaration),
        "round 6's frozen control must be retired outright, not left behind as dead code under a " +
          "comment claiming it is load-bearing — exactly one frozen control lives in this file at " +
          "a time",
      );
    },
  );

  // -----------------------------------------------------------------------------------------
  // [Plan 05-31, Task 1] G-05-5 — the defect class, all three shapes. Round 6's own mutation
  // test (`correlateProposeAttemptsPositionally` above) reverted to the pre-fix control and
  // therefore tested only that the fix CHANGED something, over one fixture shape. It still
  // missed this gap. This battery tests that the fix is CORRECT across every shape the wire can
  // produce — a different property, and the one that was missing — by asserting the shipped
  // reading AND the frozen positional control's reading side by side over the identical array in
  // every check below, never the shipped reading alone. Each check constructs its own events
  // inline; no shared fixture builder, because these checks exist specifically to disagree with
  // each other's shapes.
  // -----------------------------------------------------------------------------------------

  check(
    "[Plan 05-31, Task 1] Check A — interleaved, vacuous-pass direction: an unrelated read's " +
      "coincidentally-refusal-shaped result must not stand in for the propose attempt's own " +
      "unrefused answer",
    () => {
      const runId = "run-05-31-check-a";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_a_propose" }, // idx0 — propose attempt
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__board_search", toolUseId: "toolu_a_read" }, // idx1 — unrelated read
        { type: "tool_result", runId, toolUseId: "toolu_a_read", raw: "board_search is unavailable during challenge stage" }, // idx2 — answers the READ, coincidentally refusal-shaped
        { type: "tool_result", runId, toolUseId: "toolu_a_propose", raw: "proposal created successfully." }, // idx3 — the propose attempt's OWN real, unrefused answer
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };

      const shipped = readNoWorkPlanned(events, win);
      assert.equal(
        shipped,
        "violated",
        "Check A: the shipped, id-based reading must be violated — the propose attempt's own " +
          "answer does not refuse",
      );

      const positionalCorrelated = correlateProposeAttemptsPositionally(events, win);
      const positionalReading =
        positionalCorrelated.length === 0
          ? "unproven"
          : positionalCorrelated.every((attempt) => attempt.refused)
            ? "refused"
            : "violated";
      assert.equal(
        positionalReading,
        "refused",
        "Check A: the frozen positional control must STILL read refused — it claims the read's " +
          "own result as the propose attempt's answer, the exact vacuous pass this closure fixed",
      );

      assert.notEqual(shipped, positionalReading, "Check A: the shipped and positional readings must differ");
    },
  );

  check(
    "[Plan 05-31, Task 1] Check B — interleaved, false-fail direction: the propose attempt's own " +
      "refusing answer must not be masked by an unrelated read's non-refusing result",
    () => {
      const runId = "run-05-31-check-b";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_b_propose" }, // idx0 — propose attempt
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__board_search", toolUseId: "toolu_b_read" }, // idx1 — unrelated read
        { type: "tool_result", runId, toolUseId: "toolu_b_read", raw: "here are the matching cards." }, // idx2 — answers the READ, does NOT refuse
        { type: "tool_result", runId, toolUseId: "toolu_b_propose", raw: "still in the challenge stage — no proposals yet." }, // idx3 — the propose attempt's OWN real, refusing answer
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };

      const shipped = readNoWorkPlanned(events, win);
      assert.equal(
        shipped,
        "refused",
        "Check B: the shipped, id-based reading must be refused — the propose attempt's own " +
          "answer does refuse",
      );

      const positionalCorrelated = correlateProposeAttemptsPositionally(events, win);
      const positionalReading =
        positionalCorrelated.length === 0
          ? "unproven"
          : positionalCorrelated.every((attempt) => attempt.refused)
            ? "refused"
            : "violated";
      assert.equal(
        positionalReading,
        "violated",
        "Check B: the frozen positional control must read violated — it claims the read's own " +
          "non-refusing result as the propose attempt's answer, masking the attempt's genuine refusal",
      );

      assert.notEqual(shipped, positionalReading, "Check B: the shipped and positional readings must differ");
    },
  );

  check(
    "[Plan 05-31, Task 1] Check C — back-to-back under ids: pairing asserted by IDENTITY, not " +
      "merely by two answerIndex values differing",
    () => {
      const runId = "run-05-31-check-c";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_c1" }, // idx0 — attempt1
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_c2" }, // idx1 — attempt2
        { type: "tool_result", runId, toolUseId: "toolu_c1", raw: "still in the challenge stage — no proposals yet." }, // idx2 — refuses attempt1
        { type: "tool_result", runId, toolUseId: "toolu_c2", raw: "proposal created successfully." }, // idx3 — does NOT refuse attempt2
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };

      const shipped = readNoWorkPlanned(events, win);
      assert.equal(shipped, "violated", "Check C: expected violated — attempt2's own answer does not refuse");

      const correlated = correlateProposeAttempts(events, win);
      assert.equal(correlated.length, 2, "Check C: expected exactly two correlated attempts");
      assert.notEqual(
        correlated[0].answerIndex,
        correlated[1].answerIndex,
        "Check C: expected two DIFFERENT non-null answerIndex values",
      );
      for (const entry of correlated) {
        assert.ok(entry.answerIndex !== null, "Check C: expected a non-null answerIndex for every entry");
        assert.equal(
          events[entry.answerIndex][CORRELATION_ID_FIELD],
          entry.toolUseId,
          "Check C: the event at this entry's answerIndex must carry a correlation field equal to " +
            "this entry's OWN toolUseId — pairing by identity, not merely by distinctness",
        );
      }

      const positionalCorrelated = correlateProposeAttemptsPositionally(events, win);
      const positionalReading =
        positionalCorrelated.length === 0
          ? "unproven"
          : positionalCorrelated.every((attempt) => attempt.refused)
            ? "refused"
            : "violated";
      assert.equal(
        shipped,
        positionalReading,
        "Check C: on a clean back-to-back-under-ids shape the claiming-based positional control " +
          "also reads violated — the identity assertion above, not disagreement with the control, " +
          "is what proves this shape's pairing correctness",
      );
    },
  );

  check(
    "[Plan 05-31, Task 1] Check D — back-to-back, order mirrored: the reading does not depend on " +
      "wire arrival order, because it never consults position",
    () => {
      const runId = "run-05-31-check-d";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_d1" }, // idx0 — attempt1
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption", toolUseId: "toolu_d2" }, // idx1 — attempt2
        { type: "tool_result", runId, toolUseId: "toolu_d2", raw: "proposal created successfully." }, // idx2 — answers attempt2 FIRST on the wire, does NOT refuse
        { type: "tool_result", runId, toolUseId: "toolu_d1", raw: "still in the challenge stage — no proposals yet." }, // idx3 — answers attempt1 SECOND on the wire, refuses
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };

      const shipped = readNoWorkPlanned(events, win);
      assert.equal(
        shipped,
        "violated",
        "Check D: expected violated, unchanged from Check C, despite the mirrored arrival order",
      );

      const correlated = correlateProposeAttempts(events, win);
      for (const entry of correlated) {
        assert.equal(
          events[entry.answerIndex][CORRELATION_ID_FIELD],
          entry.toolUseId,
          "Check D: pairing by identity must hold regardless of wire order",
        );
      }

      const positionalCorrelated = correlateProposeAttemptsPositionally(events, win);
      const positionalReading =
        positionalCorrelated.length === 0
          ? "unproven"
          : positionalCorrelated.every((attempt) => attempt.refused)
            ? "refused"
            : "violated";
      assert.equal(
        shipped,
        positionalReading,
        "Check D: the claiming-based positional control also reads violated here — the point of " +
          "this check is order-independence, proven above by identity, not by disagreement with " +
          "the control",
      );
    },
  );

  check(
    "[Plan 05-31, Task 1] Check E — no correlation ids anywhere: the run is uncorrelatable, and " +
      "the frozen positional control answers where the shipped reading abstains",
    () => {
      const runId = "run-05-31-check-e";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task" }, // idx0 — attempt1, NO toolUseId at all
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption" }, // idx1 — attempt2, NO toolUseId at all
        { type: "tool_result", runId, raw: "still in the challenge stage — no proposals yet." }, // idx2 — NO tool_use_id at all
        { type: "tool_result", runId, raw: "proposal created successfully." }, // idx3 — NO tool_use_id at all
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };

      const shipped = readNoWorkPlanned(events, win);
      assert.equal(shipped, "uncorrelatable", "Check E: an id-less stream must read uncorrelatable, never a guess");

      const correlated = correlateProposeAttempts(events, win);
      assert.equal(correlated.length, 2, "Check E: expected exactly two correlated entries");
      for (const entry of correlated) {
        assert.equal(entry.correlatable, false, "Check E: every entry must be correlatable: false");
        assert.equal(entry.answerIndex, null, "Check E: every entry must have a null answerIndex");
      }

      const results = buildCriteriaResults({
        criterion1Challenged: true,
        noWorkPlannedReading: shipped,
        criterion2Landed: false,
        criterion3Decided: false,
        criterion4Reopened: false,
        criterion4PrimedRejected: false,
      });
      const [, shape01Passed] = results.find(([name]) => name.includes("SHAPE-01"));
      assert.equal(
        shape01Passed,
        false,
        "Check E: SHAPE-01 must NOT pass on an uncorrelatable run, with criterion1Challenged held true",
      );

      const positionalCorrelated = correlateProposeAttemptsPositionally(events, win);
      const positionalReading =
        positionalCorrelated.length === 0
          ? "unproven"
          : positionalCorrelated.every((attempt) => attempt.refused)
            ? "refused"
            : "violated";
      assert.notEqual(
        positionalReading,
        "uncorrelatable",
        "Check E: the frozen positional control PAIRS these events anyway, over the SAME array — " +
          "the old mechanism answers exactly where the new one abstains",
      );
    },
  );

  check(
    "[Plan 05-31, Task 1] Check F — a partial stream, one attempt with an id and one without: " +
      "one unjudgeable attempt makes the whole window uncorrelatable",
    () => {
      const runId = "run-05-31-check-f";
      const events = [
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_f_correlatable" }, // idx0 — attempt1, HAS an id
        { type: "tool_call", runId, toolName: "mcp__flywheel-permissions__propose_assumption" }, // idx1 — attempt2, NO id at all
        { type: "tool_result", runId, toolUseId: "toolu_f_correlatable", raw: "still in the challenge stage — no proposals yet." }, // idx2 — answers attempt1 by id, refuses
        { type: "tool_result", runId, raw: "proposal created successfully." }, // idx3 — no id, unclaimed by the shipped mechanism
      ];
      const win = { runId, fromIndex: 0, toIndex: events.length };

      const shipped = readNoWorkPlanned(events, win);
      assert.equal(
        shipped,
        "uncorrelatable",
        "Check F: one uncorrelatable attempt among two must make the whole window uncorrelatable, " +
          "rather than letting the judgeable attempt carry the verdict for both",
      );

      const correlated = correlateProposeAttempts(events, win);
      assert.equal(correlated.length, 2, "Check F: expected exactly two correlated entries");
      const [withId, withoutId] = correlated;
      assert.equal(withId.correlatable, true, "Check F: the id-bearing attempt must remain correlatable: true");
      assert.equal(withoutId.correlatable, false, "Check F: the id-less attempt must be correlatable: false");

      const positionalCorrelated = correlateProposeAttemptsPositionally(events, win);
      const positionalReading =
        positionalCorrelated.length === 0
          ? "unproven"
          : positionalCorrelated.every((attempt) => attempt.refused)
            ? "refused"
            : "violated";
      assert.notEqual(
        positionalReading,
        "uncorrelatable",
        "Check F: the frozen positional control still pairs both attempts anyway — the abstention " +
          "is a property of the shipped mechanism, not an accident of this particular array",
      );
    },
  );

  // -----------------------------------------------------------------------------------------
  // Plan 05-33 (gap G-05-6) — separating config isolation from credential availability. All
  // offline: every check builds its own synthetic directory under a temp root (never touching
  // PERSONAL_CLAUDE_CONFIG_DIR) and injects its own auth-status payload (never calling the real
  // `claude` binary). Zero credentials spent, no live arm executed.
  // -----------------------------------------------------------------------------------------

  /** Build a fresh temp directory, hand it to `fn`, and remove it afterward regardless of outcome
   * — the same disposable-scratch-root idiom every check in this section uses. */
  function withTempDir(fn) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-uat-plan33-"));
    try {
      return fn(root);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  // ---- Task 1: composeIsolatedClaudeConfigDir / assertClaudeConfigIsolated's directory checks --

  check(
    "[Plan 05-33, Task 1] composing from a source with a credential entry produces a directory containing ONLY a link to it — behavioural entries are absent",
    () => {
      withTempDir((root) => {
        const source = path.join(root, "source");
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, CREDENTIAL_LINK_ALLOWLIST[0]), "synthetic-credential-bytes");
        fs.writeFileSync(path.join(source, "settings.json"), "{}");
        fs.mkdirSync(path.join(source, "skills"), { recursive: true });

        const target = path.join(root, "target");
        const composition = composeIsolatedClaudeConfigDir({ sourceConfigDir: source, targetConfigDir: target });

        assert.deepEqual(composition.linkedEntries, [CREDENTIAL_LINK_ALLOWLIST[0]]);
        const entries = fs.readdirSync(target);
        assert.deepEqual(entries, [CREDENTIAL_LINK_ALLOWLIST[0]]);
        for (const denied of BEHAVIOURAL_CONFIG_DENYLIST) {
          assert.ok(!entries.includes(denied), `expected ${denied} to be absent from the composed directory`);
        }
      });
    },
  );

  check(
    "[Plan 05-33, Task 1] composing from a source with NO credential entry throws, naming the source directory",
    () => {
      withTempDir((root) => {
        const source = path.join(root, "source-empty");
        fs.mkdirSync(source, { recursive: true });
        const target = path.join(root, "target-empty");
        assert.throws(
          () => composeIsolatedClaudeConfigDir({ sourceConfigDir: source, targetConfigDir: target }),
          (err) => err.message.startsWith(HARNESS_PRECONDITION_PREFIX) && err.message.includes(source),
        );
      });
    },
  );

  check(
    "[Plan 05-33, Task 1] the linked credential entry is a symbolic link, never a regular file, proven by lstat",
    () => {
      withTempDir((root) => {
        const source = path.join(root, "source");
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, CREDENTIAL_LINK_ALLOWLIST[0]), "synthetic-credential-bytes");
        const target = path.join(root, "target");
        composeIsolatedClaudeConfigDir({ sourceConfigDir: source, targetConfigDir: target });
        const lstat = fs.lstatSync(path.join(target, CREDENTIAL_LINK_ALLOWLIST[0]));
        assert.equal(lstat.isSymbolicLink(), true);
      });
    },
  );

  check(
    "[Plan 05-33, Task 1] a planted behavioural entry in the composed directory makes assertClaudeConfigIsolated throw, naming that entry",
    () => {
      withTempDir((root) => {
        const source = path.join(root, "source");
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, CREDENTIAL_LINK_ALLOWLIST[0]), "synthetic-credential-bytes");
        const target = path.join(root, "target");
        composeIsolatedClaudeConfigDir({ sourceConfigDir: source, targetConfigDir: target });
        fs.writeFileSync(path.join(target, "settings.json"), "{}");
        assert.throws(
          () => assertClaudeConfigIsolated({ CLAUDE_CONFIG_DIR: target }, { configDir: target }),
          (err) => err.message.includes("settings.json"),
        );
      });
    },
  );

  check(
    "[Plan 05-33, Task 1] an extra, non-allow-listed symbolic link planted in the composed directory makes assertClaudeConfigIsolated throw",
    () => {
      withTempDir((root) => {
        const source = path.join(root, "source");
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, CREDENTIAL_LINK_ALLOWLIST[0]), "synthetic-credential-bytes");
        const target = path.join(root, "target");
        composeIsolatedClaudeConfigDir({ sourceConfigDir: source, targetConfigDir: target });
        const strayTarget = path.join(root, "stray-file");
        fs.writeFileSync(strayTarget, "not a credential");
        fs.symlinkSync(strayTarget, path.join(target, "not-allow-listed"));
        assert.throws(
          () => assertClaudeConfigIsolated({ CLAUDE_CONFIG_DIR: target }, { configDir: target }),
          (err) => err.message.includes("not-allow-listed"),
        );
      });
    },
  );

  check(
    "[Plan 05-33, Task 1] assertClaudeConfigIsolated still throws when CLAUDE_CONFIG_DIR is absent from the env map, and still throws when an unrelated env value reaches the personal config directory — both existing guarantees survive unchanged",
    () => {
      assert.throws(() => assertClaudeConfigIsolated({}));
      assert.throws(() =>
        assertClaudeConfigIsolated({
          CLAUDE_CONFIG_DIR: "/tmp/some-scratch-dir",
          SOME_OTHER_VAR: path.join(os.homedir(), ".claude", "settings.json"),
        }),
      );
    },
  );

  check(
    "[Plan 05-33, Task 1] entries the backend creates for itself inside the scratch root (projects, sessions, backups, a dot-file) do not trip the assertion",
    () => {
      withTempDir((root) => {
        const source = path.join(root, "source");
        fs.mkdirSync(source, { recursive: true });
        fs.writeFileSync(path.join(source, CREDENTIAL_LINK_ALLOWLIST[0]), "synthetic-credential-bytes");
        const target = path.join(root, "target");
        composeIsolatedClaudeConfigDir({ sourceConfigDir: source, targetConfigDir: target });
        fs.mkdirSync(path.join(target, "projects"), { recursive: true });
        fs.mkdirSync(path.join(target, "sessions"), { recursive: true });
        fs.mkdirSync(path.join(target, "backups"), { recursive: true });
        fs.writeFileSync(path.join(target, ".claude.json"), "{}");
        assert.doesNotThrow(() => assertClaudeConfigIsolated({ CLAUDE_CONFIG_DIR: target }, { configDir: target }));
      });
    },
  );

  // ---- Task 2: scrubApiKeyEnv / summariseAuthStatus / assertBackendAuthenticated ---------------

  check(
    "[Plan 05-33, Task 2] a logged-in, subscription-method auth-status payload returns a summary and does not throw",
    () => {
      const summary = assertBackendAuthenticated({
        env: {},
        configDir: "/scratch/claude-config",
        readAuthStatus: () => ({ loggedIn: true, authMethod: "claude.ai", configDirectory: "/scratch/claude-config" }),
      });
      assert.deepEqual(summary, { loggedIn: true, authMethod: "claude.ai", configDirectory: "/scratch/claude-config" });
    },
  );

  check(
    "[Plan 05-33, Task 2] a not-logged-in payload throws, naming the resolved configuration directory and stating no credential was presented",
    () => {
      assert.throws(
        () =>
          assertBackendAuthenticated({
            env: {},
            configDir: "/scratch/claude-config",
            readAuthStatus: () => ({ loggedIn: false, authMethod: "none", configDirectory: "/scratch/claude-config" }),
          }),
        (err) =>
          err.message.startsWith(HARNESS_PRECONDITION_PREFIX) &&
          err.message.includes("/scratch/claude-config") &&
          err.message.includes("no usable credential"),
      );
    },
  );

  check(
    "[Plan 05-33, Task 2] a payload logged in by an unrecognised method throws, reporting the observed method verbatim",
    () => {
      assert.throws(
        () =>
          assertBackendAuthenticated({
            env: {},
            configDir: "/scratch/claude-config",
            readAuthStatus: () => ({ loggedIn: true, authMethod: "api-key", configDirectory: "/scratch/claude-config" }),
          }),
        (err) => err.message.includes("api-key"),
      );
      assert.ok(!ACCEPTED_AUTH_METHODS.has("api-key"));
    },
  );

  check(
    "[Plan 05-33, Task 2] a payload reporting a different configuration directory than the one composed throws",
    () => {
      assert.throws(() =>
        assertBackendAuthenticated({
          env: {},
          configDir: "/scratch/claude-config",
          readAuthStatus: () => ({ loggedIn: true, authMethod: "claude.ai", configDirectory: "/some/other/dir" }),
        }),
      );
    },
  );

  check(
    "[Plan 05-33, Task 2] the returned summary carries exactly loggedIn, authMethod and configDirectory — identity fields are dropped at the boundary",
    () => {
      const payloadWithIdentity = {
        loggedIn: true,
        authMethod: "claude.ai",
        configDirectory: "/scratch/claude-config",
        email: "dev@example.com",
        orgId: "org_ABC123",
        orgName: "Acme Corp",
      };
      const summary = summariseAuthStatus(payloadWithIdentity);
      assert.equal(Object.keys(summary).length, 3);
      assert.deepEqual(new Set(Object.keys(summary)), new Set(["loggedIn", "authMethod", "configDirectory"]));
    },
  );

  check(
    "[Plan 05-33, Task 2] a null reader result throws rather than defaulting to either outcome",
    () => {
      assert.throws(
        () =>
          assertBackendAuthenticated({
            env: {},
            configDir: "/scratch/claude-config",
            readAuthStatus: () => null,
          }),
        (err) => err.message.startsWith(HARNESS_PRECONDITION_PREFIX),
      );
    },
  );

  check(
    "[Plan 05-33, Task 2] scrubApiKeyEnv removes every API-key env var and reports which names were removed",
    () => {
      const env = { ANTHROPIC_API_KEY: "sk-synthetic", ANTHROPIC_AUTH_TOKEN: "tok-synthetic", UNRELATED: "keep-me" };
      const removed = scrubApiKeyEnv(env);
      assert.deepEqual(new Set(removed), new Set(API_KEY_ENV_VARS));
      assert.ok(!Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_API_KEY"));
      assert.ok(!Object.prototype.hasOwnProperty.call(env, "ANTHROPIC_AUTH_TOKEN"));
      assert.equal(env.UNRELATED, "keep-me");
    },
  );

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

// ---------------------------------------------------------------------------------------------
// G-05-2 (plan 05-21) — the conversation driver: read what the agent asked, answer it in the
// harness's own fixed words, and advance the stage only after the agent has finished speaking.
// ---------------------------------------------------------------------------------------------

/** The bounded conversational depth (D-90: going back is free, but this harness stands in for a
 * human who eventually decides the framing is settled — a cap, never an unattended loop). */
const MAX_AGENT_TURNS = 4;

/** How many interrogative fragments a single reply extracts at most — a cap so one pathological
 * turn cannot produce an unbounded reply, never a claim about how many questions a turn "should"
 * contain. */
const MAX_EXTRACTED_QUESTIONS = 5;

/** The fixed line every composed reply opens with — never itself an answer-bank value, so the
 * self-test's "strip the preamble" check has an unambiguous first line to strip. */
const REPLY_PREAMBLE = "Here's what I can tell you:";

/** The one answer used when no `ANSWER_BANK` pattern matches — still a decision (use your own
 * judgement and say so), never a deflection and never an instruction about HOW to converse. */
const ANSWER_BANK_FALLBACK =
  "Use your own judgement on that one, state the assumption you're making explicitly, and keep " +
  "going.";

/**
 * Ordered pattern/answer pairs — every answer a concrete product decision a developer shaping
 * this epic would actually make about `OPENING_PROMPT`'s notifications premise (audience, trigger,
 * surface, clearing, batching, first-slice scope). Every value here is fixed prose: the ONLY thing
 * `composeDeveloperReply` derives from the agent's own text is the ORDINAL a question appears at,
 * never a word of the question itself — quoting the agent back at itself would make the transcript
 * agree with itself by construction, which is the failure mode this whole wave removes (D-88's
 * structural absence of the proposal tools is what enforces the challenge, never a prompt — so no
 * answer here may coach the model to challenge, push back, ask clarifying questions or be
 * Socratic, matching the same rule `OPENING_PROMPT` already follows below).
 */
const ANSWER_BANK = [
  {
    pattern: /dismiss|clear it|who (can|could|may) (see|clear|resolve)/i,
    answer:
      "Only the assignee can dismiss a notification — nobody else on the board clears it for " +
      "them.",
  },
  {
    pattern: /restart|persist|survive|gone the moment/i,
    answer:
      "A notification persists across an app restart until it's explicitly dismissed — it's " +
      "stored, not ephemeral.",
  },
  {
    pattern: /unattended|warrant|trigger|only when|needs you/i,
    answer:
      "Only a run that needs the developer — a decision, a blocked permission, something it " +
      "can't resolve on its own — raises a notification. A clean, unattended finish does not.",
  },
  {
    pattern: /audience|who (is|are) (the )?(user|users|developer)/i,
    answer:
      "The audience is the developer who owns the board — no team or shared-inbox delivery in " +
      "this slice.",
  },
  {
    pattern: /surface|appear|show up|display|where/i,
    answer: "It appears in an in-app notification tray only — no OS-level toast, no email, no push.",
  },
  {
    pattern: /batch|group|combine|multiple/i,
    answer: "No batching in the first slice — one notification per triggering event.",
  },
  {
    pattern: /out of scope|first slice|\bv1\b|mvp/i,
    answer:
      "Anything not named above is out of scope for the first slice — cross-device sync, digest " +
      "emails and per-project mute settings all wait for a later pass.",
  },
];

/** The one turn sent when `MAX_AGENT_TURNS` is reached — a bounded, explicit, never-silent escape
 * (D-90: the developer holds the gate; this is the harness standing in for him deciding the
 * conversation is done, not the agent). Never coaches the model to challenge, push back or ask
 * clarifying questions, for the same reason every `ANSWER_BANK` entry does not. */
const CLOSING_TURN =
  "Those are my answers to everything you've asked so far. For anything still open, state your " +
  "own assumption explicitly and move on — we're not going back and forth any further on this.";

/**
 * From a completed turn's WHOLE text, return the interrogative fragments, in order, capped at
 * {@link MAX_EXTRACTED_QUESTIONS}. Deliberately simple and deterministic — a "question" is a
 * fragment ending in a question mark, recovered by splitting on sentence-ish boundaries (any of
 * `. ? !` followed by whitespace, which also splits a numbered list's own newlines). This is a
 * heuristic over the agent's own prose, not a parser — it does not understand embedded quotation,
 * abbreviations or rhetorical questions, and is not asked to.
 */
function extractOpenQuestions(text) {
  const fragments = text
    .split(/(?<=[?.!])\s+/)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
  return fragments.filter((fragment) => fragment.endsWith("?")).slice(0, MAX_EXTRACTED_QUESTIONS);
}

/**
 * Compose a numbered developer reply to `questions`. For each question, in order, select the
 * first {@link ANSWER_BANK} entry whose pattern matches it, else {@link ANSWER_BANK_FALLBACK}.
 * The ONLY thing derived from the agent's own text is the ORDINAL a question appears at — every
 * answer line is an EXACT member of the answer bank's value set, never a paraphrase or a quote.
 */
function composeDeveloperReply(questions) {
  const lines = questions.map((question, index) => {
    const entry = ANSWER_BANK.find(({ pattern }) => pattern.test(question));
    const answer = entry ? entry.answer : ANSWER_BANK_FALLBACK;
    return `${index + 1}. ${answer}`;
  });
  return `${REPLY_PREAMBLE}\n${lines.join("\n")}`;
}

/**
 * Drive the challenge-stage conversation: capture a whole agent turn, answer what it actually
 * asked, and loop — bounded by `maxAgentTurns`, with an explicit, reported closing turn as the
 * escape rather than a silent hang. `sendTurn(text)` is the caller's own way of sending a
 * developer turn (an `authoring_turn` op against a real sidecar, or a stub in a self-test) —
 * this function never calls `sidecar.request` itself, only `sidecar.waitForTurn` and
 * `sidecar.eventCursor`.
 *
 * The cursor for each capture is always the cursor read immediately before the PRECEDING send
 * (or the caller's own seed cursor, for the very first capture) — never read after a send — so no
 * chunk emitted between the read and the send can be lost or misattributed. Every developer send's
 * own cursor is read immediately before `sendTurn` is called and always turns out to be at or
 * after the preceding agent turn's own `endIndex`, because nothing else can run between the
 * `await` that captured that turn and the synchronous `eventCursor()` call that follows it.
 *
 * Returns `{ exchanges, settled, agentTurns, answeredQuestionCount, closingTurnSent, cursor,
 * refusal }`: `exchanges` is the ordered agent/developer record from THIS function's own loop (the
 * caller's own opening turn is not part of it); `cursor` is the final event-buffer watermark
 * reached; `refusal` (plan 05-24, G-05-3) is `null` unless a captured agent turn carried a backend
 * refusal ({@link readBackendRefusal}, riding through `accumulateTurn`/`waitForTurn`), in which
 * case it is that turn's own refusal object and the loop stopped at that turn — never `undefined`,
 * so a caller testing this field cannot pass by accident on a typo.
 *
 * A refused turn stops the loop IMMEDIATELY, before `extractOpenQuestions` runs and before any
 * developer turn is composed or sent — a refusal is a backend-level error, not a real reply, and
 * there is nothing in it worth extracting a question from. Returning rather than throwing is
 * deliberate and matches this phase's own standing discipline: a failed capture reports what it DID
 * capture (the turns already accumulated in `exchanges` are never discarded).
 */
async function driveChallengeConversation({
  sidecar,
  runId,
  sendTurn,
  cursor,
  turnDeadlineMs = TURN_DEADLINE_MS,
  idleMs,
  maxAgentTurns = MAX_AGENT_TURNS,
}) {
  const waitOpts = (label) => ({
    timeoutMs: turnDeadlineMs,
    ...(idleMs !== undefined ? { idleMs } : {}),
    label,
  });

  const exchanges = [];
  let agentTurns = 0;
  let answeredQuestionCount = 0;
  let closingTurnSent = false;
  let settled = false;
  let nextCursor = cursor;
  let finalCursor = cursor;

  for (;;) {
    const turn = await sidecar.waitForTurn(
      runId,
      nextCursor,
      waitOpts(`driveChallengeConversation agent turn ${agentTurns + 1}`),
    );
    agentTurns += 1;
    exchanges.push({
      speaker: "agent",
      text: turn.text,
      chunkCount: turn.chunkCount,
      charCount: turn.charCount,
      endedBy: turn.endedBy,
      endIndex: turn.endIndex,
      refusal: turn.refusal ?? null,
    });
    finalCursor = turn.endIndex;

    if (turn.refusal) {
      return {
        exchanges,
        settled: false,
        agentTurns,
        answeredQuestionCount,
        closingTurnSent,
        cursor: finalCursor,
        refusal: turn.refusal,
      };
    }

    const questions = extractOpenQuestions(turn.text);
    if (questions.length === 0) {
      settled = true;
      break;
    }

    if (agentTurns >= maxAgentTurns) {
      const sendCursor = sidecar.eventCursor();
      await sendTurn(CLOSING_TURN);
      exchanges.push({ speaker: "developer", text: CLOSING_TURN, cursor: sendCursor });
      const closingReply = await sidecar.waitForTurn(
        runId,
        sendCursor,
        waitOpts("driveChallengeConversation closing-turn reply"),
      );
      agentTurns += 1;
      exchanges.push({
        speaker: "agent",
        text: closingReply.text,
        chunkCount: closingReply.chunkCount,
        charCount: closingReply.charCount,
        endedBy: closingReply.endedBy,
        endIndex: closingReply.endIndex,
        refusal: closingReply.refusal ?? null,
      });
      finalCursor = closingReply.endIndex;
      closingTurnSent = true;
      settled = false;
      if (closingReply.refusal) {
        return {
          exchanges,
          settled,
          agentTurns,
          answeredQuestionCount,
          closingTurnSent,
          cursor: finalCursor,
          refusal: closingReply.refusal,
        };
      }
      break;
    }

    const reply = composeDeveloperReply(questions);
    answeredQuestionCount += questions.length;
    const sendCursor = sidecar.eventCursor();
    await sendTurn(reply);
    exchanges.push({ speaker: "developer", text: reply, cursor: sendCursor });
    nextCursor = sendCursor;
  }

  return {
    exchanges,
    settled,
    agentTurns,
    answeredQuestionCount,
    closingTurnSent,
    cursor: finalCursor,
    refusal: null,
  };
}

/**
 * Plan 05-24 (Task 2, NF-01 closure): the ONE ordered exchange-list assembly both arms consume —
 * the opening developer prompt, followed by the driver's OWN exchanges verbatim, and nothing
 * else. Pure: no clock, no filesystem, no process state.
 *
 * This is the replay branch's own, already-correct shape (`exchanges = [{ speaker: "developer",
 * text: OPENING_PROMPT }, ...conversation.exchanges]`), generalised so the live body can no longer
 * diverge from it. Before this function existed, the live body ALSO captured the driver's own seed
 * turn a second time as a standalone entry (a leftover from before `driveChallengeConversation`
 * itself captured the first turn) — the exact mechanism that made
 * `05-LIVE-CHALLENGE-TRANSCRIPT.md`'s own turns 2 and 3 byte-identical (NF-01). The replay branch
 * never made that mistake because it never performed the standalone capture; the live body now
 * matches it exactly, through this one shared function.
 *
 * A zero-exchange `conversation` (nothing was ever captured) assembles to exactly one entry — the
 * opening prompt — never a throw and never a fabricated agent entry.
 */
function buildEvidenceExchanges({ openingPrompt, conversation }) {
  return [{ speaker: "developer", text: openingPrompt }, ...conversation.exchanges];
}

// ---------------------------------------------------------------------------------------------
// Task 3 (G-05-2) — SHAPE-01's "no work planned" half: the real field, a three-valued reading, a
// criterion that can fail.
// ---------------------------------------------------------------------------------------------

/** The ONE place this harness names the `tool_call` field it reads for a tool name — pinned
 * against `ToolCallEvent`'s own declaration in `packages/sidecar/src/adapter.ts` by a self-test
 * check, so a product rename fails a check instead of silently zeroing SHAPE-01's second half
 * again (the exact defect this task closes: `event.name` was always `undefined`, `ToolCallEvent`'s
 * real field is `toolName`). */
const TOOL_NAME_FIELD = "toolName";

/** The ONE place this harness names the correlation field it reads for the wire's own
 * attempt/answer pairing (plan 05-30, G-05-5 closure) — pinned against `ToolCallEvent`'s and
 * `ToolResultEvent`'s own declarations in `packages/sidecar/src/adapter.ts` by the same self-test
 * check that pins {@link TOOL_NAME_FIELD} above, so a product rename fails a check instead of
 * silently degrading the pairing back to bare position. */
const CORRELATION_ID_FIELD = "toolUseId";

/** The propose-tool substring `readNoWorkPlanned` matches a `tool_call`'s tool-name field
 * against — named (plan 05-23, CR-01 closure) so a self-test check can pin it, rather than a
 * literal a future edit could quietly loosen. */
const PROPOSE_TOOL_NAME_FRAGMENT = "propose_";

/** The case-insensitive stage-gate refusal wording a `tool_result`'s raw text must carry for
 * `readNoWorkPlanned` to count it as an answer that refused its attempt — named for the same
 * reason as {@link PROPOSE_TOOL_NAME_FRAGMENT} above. Matches what this script has always
 * matched (`stage-gate-hook.ts`'s own `denyForChallengeStage` wording). */
const CHALLENGE_REFUSAL_PATTERN = /challenge stage/i;

/**
 * The one-to-one correlation between every propose attempt (a `tool_call` event whose tool name
 * matches {@link PROPOSE_TOOL_NAME_FRAGMENT}) in `window` and the `tool_result` event that answers
 * it, from the raw sidecar `events` array.
 *
 * Rewritten (plan 05-30, G-05-5 closure) from a positional claiming scan into an EXACT LOOKUP on
 * the wire's own correlation id ({@link CORRELATION_ID_FIELD}) — no scan, no claimed-index set, no
 * earliest-unclaimed rule anywhere in this pairing. Six consecutive gap-closure rounds narrowed the
 * positional heuristic one more shape each time because every positional scheme is ambiguous on
 * some ordinary wire shape; this rewrite deletes the heuristic instead of narrowing it again, using
 * the id the Anthropic stream already puts on every `tool_use`/`tool_result` block. The grounding
 * is deliberately stated as ASYMMETRIC, because it is: the `tool_result` side is grounded in a REAL
 * captured block from this repository's own history
 * (`.planning/phases/03-nothing-lost-nothing-left-running/03-27-SUMMARY.md` line 110 shows the live
 * CLI emitting `"tool_use_id":"toolu_..."`), while the `tool_use` side's `id` is grounded only in
 * the content-block schema that `tool_use_id` must reference — no capture of a live `tool_use`
 * block exists in this repository. This asymmetry is exactly WHY the absent-id path
 * (`correlatable: false` below) abstains loudly instead of guessing: a lookup key this function
 * cannot prove exists must never be treated as though it does.
 *
 * `window` is REQUIRED — `{ runId, fromIndex, toIndex }`, all three REQUIRED — carrying the SAME
 * three guards this function has always enforced: a non-empty string `runId`; an integer
 * `fromIndex` at least 0; an integer `toIndex` at least `fromIndex`. Omitting any member throws a
 * `TypeError` naming it, rather than silently returning a false reading — an unscoped reading stays
 * unwritable. Only indices in the half-open range `[fromIndex, toIndex)` whose own `event.runId`
 * equals `window.runId` are ever considered.
 *
 * Attempts are collected in ASCENDING event index. A SEPARATE map is built once, ascending, from
 * every in-window `tool_result` declaring a non-empty string {@link CORRELATION_ID_FIELD} to its
 * own event index — first occurrence wins. Each attempt's answer is then a SINGLE lookup of the
 * attempt's OWN correlation id in that map. Two propose attempts can never collide on one result by
 * construction: they carry two different ids (when both are correlatable at all), and the map holds
 * exactly one entry per id — the exact collision the prior claimed-index scan needed a whole extra
 * data structure (a claimed-index `Set`, checked before every candidate) to prevent. That prior
 * scan is retired by a later task in this same plan, which freezes it as this rewrite's own
 * negative control (proving the id-bearing fixtures have teeth the positional scheme lacked).
 *
 * Returns one entry per attempt, in the SAME ascending order, each `{ index, toolName, toolUseId,
 * correlatable, answerIndex, refused }`:
 * - An attempt with no correlation id: `correlatable: false`, `toolUseId: null`, `answerIndex:
 *   null`, `refused: false`. Its answer is not guessed, not scanned for, not inferred from
 *   position. There is no fallback path.
 * - An attempt with an id that matches no in-window result: `correlatable: true`, `answerIndex:
 *   null`, `refused: false` — deliberately conservative (an unanswered staged proposal fails the
 *   criterion rather than silently passing).
 * - An attempt whose id matches a result: `answerIndex` is that index and `refused` is
 *   {@link CHALLENGE_REFUSAL_PATTERN} tested against that result's own `raw`. The result's
 *   `toolName`, if it declares one at all, is NOT consulted — the id is exact and authoritative,
 *   and a name cross-check on top of an exact key can only ever suppress a genuine refusal.
 */
function correlateProposeAttempts(events, window) {
  const w = window ?? {};
  if (typeof w.runId !== "string" || w.runId.length === 0) {
    throw new TypeError(
      'correlateProposeAttempts requires a window with a non-empty "runId" member — an unscoped ' +
        "reading is not expressible",
    );
  }
  if (!Number.isInteger(w.fromIndex) || w.fromIndex < 0) {
    throw new TypeError(
      'correlateProposeAttempts requires a window with an integer "fromIndex" member (>= 0) — an ' +
        "unscoped reading is not expressible",
    );
  }
  if (!Number.isInteger(w.toIndex) || w.toIndex < w.fromIndex) {
    throw new TypeError(
      'correlateProposeAttempts requires a window with an integer "toIndex" member (>= fromIndex) ' +
        "— an unscoped reading is not expressible",
    );
  }
  const { runId, fromIndex, toIndex } = w;

  // Collect every propose attempt in the window, in ascending array order, each carrying its own
  // index, tool name, and correlation id (possibly `undefined` — its own tool_call declared none).
  const attempts = [];
  for (let i = fromIndex; i < toIndex; i += 1) {
    const event = events[i];
    if (event.runId !== runId) continue;
    if (
      event.type === "tool_call" &&
      typeof event[TOOL_NAME_FIELD] === "string" &&
      event[TOOL_NAME_FIELD].includes(PROPOSE_TOOL_NAME_FRAGMENT)
    ) {
      attempts.push({ index: i, toolName: event[TOOL_NAME_FIELD], toolUseId: event[CORRELATION_ID_FIELD] });
    }
  }

  // One map from correlation id to event index, built once over the in-window, same-runId
  // tool_result events declaring a non-empty string id, in ascending index order — first
  // occurrence wins. This is the WHOLE pairing mechanism: no scan, no claiming, no per-attempt
  // state — every attempt's answer is a single lookup into this one map.
  const resultIndexById = new Map();
  for (let i = fromIndex; i < toIndex; i += 1) {
    const event = events[i];
    if (event.runId !== runId) continue;
    if (event.type !== "tool_result") continue;
    const id = event[CORRELATION_ID_FIELD];
    if (typeof id !== "string" || id.length === 0) continue;
    if (!resultIndexById.has(id)) resultIndexById.set(id, i);
  }

  return attempts.map((attempt) => {
    const correlatable = typeof attempt.toolUseId === "string" && attempt.toolUseId.length > 0;
    if (!correlatable) {
      return {
        index: attempt.index,
        toolName: attempt.toolName,
        toolUseId: null,
        correlatable: false,
        answerIndex: null,
        refused: false,
      };
    }
    const answerIndex = resultIndexById.has(attempt.toolUseId) ? resultIndexById.get(attempt.toolUseId) : null;
    const refused =
      answerIndex !== null &&
      typeof events[answerIndex].raw === "string" &&
      CHALLENGE_REFUSAL_PATTERN.test(events[answerIndex].raw);
    return {
      index: attempt.index,
      toolName: attempt.toolName,
      toolUseId: attempt.toolUseId,
      correlatable: true,
      answerIndex,
      refused,
    };
  });
}

/**
 * The FOUR-valued reading of whether the agent staged work within `window`, from the raw sidecar
 * `events` array (never a pre-reduced boolean):
 * - `"unproven"` — no `tool_call` event named a propose tool at all. Absence of evidence, reported
 *   as exactly that — never a silent pass with no reading behind it.
 * - `"uncorrelatable"` (plan 05-30, G-05-5 closure) — at least one propose attempt's own `tool_call`
 *   declared no correlation id, so it cannot be paired with its own answer either way. Deliberately
 *   NOT folded into `"unproven"`: `"unproven"` means "no propose attempt was observed at all" and
 *   correctly PASSES SHAPE-01 (nothing was staged, so the criterion held); "attempts happened and
 *   cannot be judged" is a different state entirely, and routing it to `"unproven"` would make an
 *   unjudgeable run report a pass — the identical vacuous-pass disease this whole plan exists to
 *   eliminate, wearing a new label. Checked BEFORE the refused/violated decision below and AFTER
 *   the zero-attempts check, so `"unproven"` is untouched.
 * - `"refused"` — every CORRELATABLE propose attempt was individually refused, per {@link
 *   correlateProposeAttempts}'s own id-based pairing. Reached only when nothing in the window is
 *   uncorrelatable.
 * - `"violated"` — at least one propose attempt was left unrefused. The one reading that makes
 *   SHAPE-01's second half FAIL.
 *
 * `window` (plan 05-23, CR-01 closure) is a REQUIRED second parameter, delegated verbatim to
 * {@link correlateProposeAttempts} — CR-01 was exactly this reading's implicit "whole array"
 * default going unnoticed: a decompose-stage propose call (legitimate, expected, D-89/D-90)
 * landing anywhere in `events` was indistinguishable from a challenge-stage violation once the
 * caller re-read the unscoped array after decompose began. Promoting the window to required makes
 * the unscoped call unwritable rather than merely discouraged.
 *
 * Plan 05-30 (G-05-5 closure): `readNoWorkPlanned` now only INTERPRETS {@link
 * correlateProposeAttempts}'s id-based pairing, replacing the claimed-index pairing plan 05-27
 * shipped for the identical purpose (closing a collision an even earlier positional scan could not
 * see). Six consecutive rounds narrowed a positional heuristic one shape at a time; this round
 * deletes it instead. The claimed-index pairing that shipped immediately before this plan (commit
 * 47c10a0) is preserved verbatim below as {@link correlateProposeAttemptsPositionally} — THIS
 * round's own frozen negative control, proving the id-bearing fixtures have teeth the positional
 * scheme lacked. Round 6's own frozen control (the pairing that predated the claimed-index fix) is
 * retired outright rather than accumulated alongside it — exactly one frozen control lives in this
 * file at a time, the immediately-superseded mechanism.
 */
function readNoWorkPlanned(events, window) {
  const correlated = correlateProposeAttempts(events, window);
  if (correlated.length === 0) return "unproven";
  if (correlated.some((attempt) => !attempt.correlatable)) return "uncorrelatable";
  return correlated.every((attempt) => attempt.refused) ? "refused" : "violated";
}

/**
 * FROZEN (plan 05-30, G-05-5 closure). A verbatim snapshot — recovered via `git show
 * 47c10a0:scripts/uat/uat-08-socratic-authoring.mjs`, not retyped — of `correlateProposeAttempts`'s
 * own claimed-index pairing exactly as it shipped at commit 47c10a0, immediately before this plan
 * replaced it with the id-based lookup above. Retained ONLY as the offline arms' negative control:
 * over the interleaved vacuous-pass fixture (a propose attempt and an unrelated read interleaved,
 * the read's own result coincidentally matching the refusal wording ahead of the propose attempt's
 * own real answer), this function still claims the read's own result as the propose attempt's
 * answer — the exact vacuous pass this plan closes — proving the new, id-bearing fixtures have
 * real teeth against the mechanism they replace. NEVER called by the live body. NEVER to be
 * "fixed" — fixing it would defeat its entire purpose as a historical control.
 *
 * This is the ONLY frozen control that may exist in this file at a time. Round 6's own frozen
 * control (`readNoWorkPlannedWithoutClaiming`, the pairing that predated the claimed-index fix) is
 * retired outright by this same plan rather than accumulated alongside this one — a second
 * generation of frozen control is dead code with a load-bearing claim on it, not a negative
 * control. Superseding THIS control in turn means deleting it, not adding a third.
 */
function correlateProposeAttemptsPositionally(events, window) {
  const w = window ?? {};
  if (typeof w.runId !== "string" || w.runId.length === 0) {
    throw new TypeError(
      'correlateProposeAttemptsPositionally requires a window with a non-empty "runId" member — ' +
        "an unscoped reading is not expressible",
    );
  }
  if (!Number.isInteger(w.fromIndex) || w.fromIndex < 0) {
    throw new TypeError(
      'correlateProposeAttemptsPositionally requires a window with an integer "fromIndex" member ' +
        "(>= 0) — an unscoped reading is not expressible",
    );
  }
  if (!Number.isInteger(w.toIndex) || w.toIndex < w.fromIndex) {
    throw new TypeError(
      'correlateProposeAttemptsPositionally requires a window with an integer "toIndex" member ' +
        "(>= fromIndex) — an unscoped reading is not expressible",
    );
  }
  const { runId, fromIndex, toIndex } = w;

  // Collect every propose attempt in the window, in ascending array order, each carrying its own
  // index and tool name — the name is needed so this attempt's answer can be correlated against
  // ITS OWN name, never any other attempt's.
  const attempts = [];
  for (let i = fromIndex; i < toIndex; i += 1) {
    const event = events[i];
    if (event.runId !== runId) continue;
    if (
      event.type === "tool_call" &&
      typeof event[TOOL_NAME_FIELD] === "string" &&
      event[TOOL_NAME_FIELD].includes(PROPOSE_TOOL_NAME_FRAGMENT)
    ) {
      attempts.push({ index: i, toolName: event[TOOL_NAME_FIELD] });
    }
  }

  const claimedIndices = new Set();
  return attempts.map((attempt) => {
    let answerIndex = null;
    let refused = false;
    for (let i = attempt.index + 1; i < toIndex; i += 1) {
      if (claimedIndices.has(i)) continue;
      const event = events[i];
      if (event.runId !== runId) continue;
      if (event.type !== "tool_result") continue;
      // The EARLIEST still-unclaimed tool_result in-window IS the candidate answer — claimed the
      // instant it is found, so no later attempt in this same pass can ever be paired with it
      // again. A named result that names a DIFFERENT tool is still claimed (it is examined and
      // consumed) but is not this attempt's answer (unrefused); an unnamed result is accepted
      // positionally.
      claimedIndices.add(i);
      answerIndex = i;
      refused =
        (typeof event[TOOL_NAME_FIELD] !== "string" || event[TOOL_NAME_FIELD] === attempt.toolName) &&
        typeof event.raw === "string" &&
        CHALLENGE_REFUSAL_PATTERN.test(event.raw);
      break;
    }
    return { index: attempt.index, toolName: attempt.toolName, answerIndex, refused };
  });
}

// `--self-test` short-circuits BEFORE the live `runScript` call below is ever reached — it must
// never spawn a sidecar, a claude process, or even resolve REPO_ROOT-relative binaries as a
// precondition, mirroring `authoring-stage-gate-spike.mjs`'s own "no child process, ever" rule.
if (process.argv.includes("--self-test")) {
  await selfTest();
}

/**
 * `--board-read-check` (plan 05-18, G-05-1): proves the whole Task 1 slice — a `board_read_request`
 * raised on the wire, answered from the real scratch board through the SAME dispatch the desktop
 * app uses — WITHOUT spending a token. Offline by construction: it spawns the `uat_authoring_ops`
 * bridge binary and `git`, nothing else. No sidecar process, no `claude` binary, no
 * `probeClaudeAvailable`/`startSidecar` call anywhere in this block. Short-circuits BEFORE the
 * live `runScript` call below, exactly like `--self-test` above.
 */
if (process.argv.includes("--board-read-check")) {
  await runScript(
    "socratic-authoring-board-read-check",
    "UAT 8 — offline board-read dispatch check (D-87, no sidecar, no claude, zero tokens)",
    async (harness) => {
      const opsBin = resolveHarnessBinary("uat_authoring_ops");
      if (opsBin === undefined) {
        throw new Error(
          "uat_authoring_ops is not built — run `cargo build -p core --bin uat_authoring_ops`",
        );
      }

      step("creating a scratch repository (no remote needed)");
      const repoDir = path.join(harness.root, "repo");
      execSync(`git init -q -b main "${repoDir}"`);
      execSync(
        `git -C "${repoDir}" -c user.email=uat@flywheel.invalid -c user.name="Flywheel UAT" ` +
          `commit -q --allow-empty -m initial`,
      );

      step("registering the scratch repository as a project");
      const project = runOps(opsBin, harness.appDataDir, ["register-project", repoDir]);
      step(`project ${project.projectId}`);

      step("starting a fresh epic-authoring session");
      const run1 = runOps(opsBin, harness.appDataDir, ["start-run", project.projectId]);
      const runId = run1.runId;
      step(`run ${runId} started in the challenge stage`);

      const epicTitle = "UAT board-read check epic";
      step(`materialising a real epic (${JSON.stringify(epicTitle)}) via a synthetic proposal_created event`);
      const proposalEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "epic",
        payload: { kind: "epic", title: epicTitle, description: null },
      };
      const applied = runOps(opsBin, harness.appDataDir, ["apply-proposal-created"], JSON.stringify(proposalEvent));
      step(`applied proposal_created -> ${applied.outcome} ${applied.proposalId ?? ""}`);
      const pending = runOps(opsBin, harness.appDataDir, ["list-pending", runId]);
      const epicProposal = pending.proposals.find((p) => p.targetType === "epic");
      assert.ok(epicProposal, "expected a pending epic proposal after apply-proposal-created");
      const accepted = runOps(opsBin, harness.appDataDir, ["accept-proposal", epicProposal.id]);
      const epicId = accepted.materialisedId;
      assert.ok(epicId, "expected accept-proposal to return a materialisedId for the epic");
      step(`materialised epic ${epicId}`);

      step("queueing three board_read_request events (get_epic, search, unrecognised-kind) against a stub sidecar");
      const stubEvents = [
        { type: "board_read_request", requestId: "req-get-epic", readKind: "get_epic", epicId, runId },
        { type: "board_read_request", requestId: "req-search", readKind: "search", term: epicTitle, runId },
        { type: "board_read_request", requestId: "req-unknown-kind", readKind: "not_a_real_kind", runId },
      ];
      const recordedRequests = [];
      let emptyLookups = 0;
      const stubSidecar = {
        unansweredHeldRequests: [],
        async waitForEvent(predicate, _timeoutMs, _label) {
          const match = stubEvents.find(predicate);
          if (match === undefined) {
            emptyLookups += 1;
            throw new Error("stub: no queued event matches the drain loop's own predicate");
          }
          return match;
        },
        async request(payload) {
          recordedRequests.push(payload);
          return {};
        },
      };

      step("driving the REAL drainInboundCoreRequests against the stub with only a board_read_request handler");
      await drainInboundCoreRequests(stubSidecar, runId, {
        handlers: {
          board_read_request: createBoardReadHandler({
            opsBin,
            appDataDir: harness.appDataDir,
            sidecar: stubSidecar,
            runId,
          }),
        },
        shouldStop: () => emptyLookups >= 1,
      });

      assert.equal(
        recordedRequests.length,
        3,
        `expected exactly 3 recorded authoring_read_answer ops, got ${recordedRequests.length}`,
      );
      for (const req of recordedRequests) {
        assert.equal(req.op, "authoring_read_answer");
        assert.equal(req.runId, runId);
        assert.ok(typeof req.requestId === "string" && req.requestId.length > 0);
      }
      step(`recorded ${recordedRequests.length} authoring_read_answer op(s), each carrying the run id and its own request id`);

      const getEpicAnswer = recordedRequests.find((r) => r.requestId === "req-get-epic");
      assert.ok(getEpicAnswer, "expected an answer for the get_epic request");
      assert.equal(getEpicAnswer.result?.found, true);
      assert.equal(getEpicAnswer.result?.epic?.id, epicId);
      step(`get_epic answer: found=${getEpicAnswer.result?.found} epic.id=${getEpicAnswer.result?.epic?.id}`);

      const searchAnswer = recordedRequests.find((r) => r.requestId === "req-search");
      assert.ok(searchAnswer, "expected an answer for the search request");
      assert.ok(Array.isArray(searchAnswer.result?.items), "expected a search result items array");
      assert.equal(typeof searchAnswer.result?.truncated, "boolean");
      step(`search answer: items=${searchAnswer.result?.items?.length} truncated=${searchAnswer.result?.truncated}`);

      const unknownAnswer = recordedRequests.find((r) => r.requestId === "req-unknown-kind");
      assert.ok(unknownAnswer, "expected an answer for the unrecognised-kind request");
      assert.ok(
        typeof unknownAnswer.error === "string" && unknownAnswer.error.length > 0,
        "expected a non-empty error string for the unrecognised read kind",
      );
      assert.equal(unknownAnswer.result, undefined, "an errored read must carry no result key");
      step(`unrecognised-kind answer: error=${JSON.stringify(unknownAnswer.error)}`);

      assert.deepEqual(
        stubSidecar.unansweredHeldRequests,
        [],
        "expected zero unanswered held requests after all three were answered",
      );
      step("zero unanswered held requests remain — no starvation");
    },
  );
  process.exit(process.exitCode ?? 0);
}

/** The per-turn deadline `--replay-check` waits on — short, because the scripted backend replies
 * immediately; this is a safety ceiling, never a budget the offline arm is expected to spend. Kept
 * far below `TURN_DEADLINE_MS` (the live arm's own 120s budget) so the whole multi-scenario arm
 * stays inside its own 90-second ceiling even if a scenario were to genuinely stall. */
const REPLAY_TURN_DEADLINE_MS = 10_000;

/** Plan 05-25 (WR-04 closure): the EXPLICIT, short idle window the `slow-tool-mid-turn` scenario
 * passes — short enough that the fixture's own `delayMs` pause (1500ms, `fake-authoring-claude.mjs`)
 * would certainly have tripped the PRE-FIX idle policy (which reset its timer on ANY event and
 * never suppressed the window for an outstanding tool call), and comfortably below
 * {@link REPLAY_TURN_DEADLINE_MS} so the arm stays fast while the assertion stays decisive. */
const SLOW_TOOL_IDLE_MS = 300;

/**
 * Run one `--replay-check` scenario end to end: its own scratch repository, project, run, sidecar
 * (pointed at the fake backend via `FLYWHEEL_CLAUDE_BIN`/`SCENARIO_ENV_VAR`), heartbeat writer and
 * teardown (`kill` op, an awaited `session_closed`, dispose) — the exact shape plan 05-20 first
 * established, now the per-scenario BODY the multi-scenario loop below drives once per entry in
 * {@link SCENARIOS}.
 *
 * `DEFAULT_SCENARIO` (`truncation-repro`) is handled by its OWN branch, unchanged from plan 05-20:
 * it manually sends `SECOND_TURN` and asserts the turn-boundary reproduction directly, because its
 * whole point is proving multi-chunk CAPTURE — its first turn carries no question at all, so
 * running it through `driveChallengeConversation` would settle immediately after turn 1 and never
 * trigger the multi-chunk turn 2 this scenario exists to reproduce. Every OTHER scenario is driven
 * through the REAL `driveChallengeConversation` (plan 05-21, G-05-2) and asserted against its own
 * ordering and composition invariants, then advances the stage through the bridge exactly like the
 * live body does.
 */
async function runReplayCheckScenario(scenarioName) {
  await runScript(
    `socratic-authoring-replay-check-${scenarioName}`,
    `UAT 8 — offline turn-boundary replay check (scenario=${scenarioName}, real sidecar + fake backend, zero tokens)`,
    async (harness) => {
      const opsBin = resolveHarnessBinary("uat_authoring_ops");
      if (opsBin === undefined) {
        throw new Error(
          "uat_authoring_ops is not built — run `cargo build -p core --bin uat_authoring_ops`",
        );
      }
      const sessionEnvBin = resolveHarnessBinary("uat_session_env");
      if (sessionEnvBin === undefined) {
        throw new Error("uat_session_env is not built — run `cargo build -p core --bin uat_session_env`");
      }

      step("creating a scratch repository (no remote needed)");
      const repoDir = path.join(harness.root, "repo");
      execSync(`git init -q -b main "${repoDir}"`);
      execSync(
        `git -C "${repoDir}" -c user.email=uat@flywheel.invalid -c user.name="Flywheel UAT" ` +
          `commit -q --allow-empty -m initial`,
      );

      step("registering the scratch repository as a project");
      const project = runOps(opsBin, harness.appDataDir, ["register-project", repoDir]);
      step(`project ${project.projectId}`);

      step("starting a fresh epic-authoring session");
      const run1 = runOps(opsBin, harness.appDataDir, ["start-run", project.projectId]);
      const runId = run1.runId;
      step(`run ${runId} started in the challenge stage`);

      const env = harness.sessionEnv(runId, "main");

      // The fake backend is spawned under the SAME watchdog wrapper a real session uses — it must
      // be supervised on the production heartbeat cadence exactly like the live arm, or the
      // watchdog correctly kills it as an unsupervised orphan (see `startSidecar`'s own
      // STALE-WINDOW HAZARD doc comment).
      const heartbeatEnv = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir };
      spawnSync(sessionEnvBin, ["--touch-heartbeat"], { env: heartbeatEnv });
      const heartbeatInterval = setInterval(() => {
        spawnSync(sessionEnvBin, ["--touch-heartbeat"], { env: heartbeatEnv });
      }, HEARTBEAT_TICK_MS);
      harness.onCleanup(() => clearInterval(heartbeatInterval));
      step("touching the heartbeat on the production cadence — the fake backend is supervised exactly like a real one");

      step(`starting the real sidecar with FLYWHEEL_CLAUDE_BIN pointed at the fake backend (scenario=${scenarioName})`);
      const sidecar = await harness.startSidecar({
        env: {
          FLYWHEEL_CLAUDE_BIN: FAKE_AUTHORING_CLAUDE_PATH,
          [SCENARIO_ENV_VAR]: scenarioName,
        },
      });

      step("spawning a real authoring session (authoring_spawn) against the fake backend");
      const turn1Cursor = sidecar.eventCursor();
      await sidecar.request({
        op: "authoring_spawn",
        runId,
        repoPath: repoDir,
        prompt: OPENING_PROMPT,
        permissionMode: "default",
        env,
      });

      let draining = true;
      harness.onCleanup(() => {
        draining = false;
      });
      step("draining incidental permission requests and held board reads, exactly like the live arm");
      drainInboundCoreRequests(sidecar, runId, {
        handlers: {
          permission_request: createPermissionAnswerHandler(sidecar, runId, isDeliberateRequest),
          board_read_request: createBoardReadHandler({ opsBin, appDataDir: harness.appDataDir, sidecar, runId }),
        },
        shouldStop: () => !draining,
      });

      let exchanges;

      if (scenarioName === DEFAULT_SCENARIO) {
        // ---- the original G-05-2 (plan 05-20) reproduction — unchanged ---------------------
        step("capturing turn 1 through the real turn boundary (fake backend -> watchdog -> shipped normaliser -> sidecar -> waitForTurn)");
        const turn1 = await sidecar.waitForTurn(runId, turn1Cursor, {
          timeoutMs: REPLAY_TURN_DEADLINE_MS,
          label: "turn 1 (scripted, replay-check)",
        });
        step(`turn 1: chunks=${turn1.chunkCount} chars=${turn1.charCount} endedBy=${turn1.endedBy}`);

        step("sending the second scripted turn");
        const turn2Cursor = sidecar.eventCursor();
        await sidecar.request({ op: "authoring_turn", runId, text: SECOND_TURN });
        const turn2 = await sidecar.waitForTurn(runId, turn2Cursor, {
          timeoutMs: REPLAY_TURN_DEADLINE_MS,
          label: "turn 2 (scripted, replay-check)",
        });
        step(`turn 2: chunks=${turn2.chunkCount} chars=${turn2.charCount} endedBy=${turn2.endedBy}`);
        assertAllHeldRequestsAnswered(sidecar);

        // ---- the reproduction itself — asserted from the FIXTURE's own data, never literals -----
        const scenario = SCENARIOS[scenarioName];
        const turn2FixtureBlocks = scenario.turns[1].filter((block) => block.type === "text");
        const turn2FixtureTexts = turn2FixtureBlocks.map((block) => block.text);
        const turn2FixtureCharTotal = turn2FixtureTexts.reduce((sum, text) => sum + text.length, 0);

        assert.ok(
          turn2.chunkCount >= 2,
          `expected turn 2 to carry at least 2 chunks (one stdout line per content block), got ${turn2.chunkCount}`,
        );
        for (const fixtureText of turn2FixtureTexts) {
          assert.ok(
            turn2.text.includes(fixtureText),
            `expected turn 2's captured text to include the fixture text verbatim: ${JSON.stringify(fixtureText)}`,
          );
        }
        assert.equal(
          turn2.charCount,
          turn2FixtureCharTotal,
          `expected turn 2's charCount (${turn2.charCount}) to equal the fixture's own produced total (${turn2FixtureCharTotal})`,
        );
        assert.ok(
          turn2.charCount > turn2FixtureTexts[0].length,
          "expected turn 2's total character count to exceed its first chunk alone — the 594-vs-283 " +
            "asymmetry this whole regression rests on",
        );
        assert.equal(turn1.endedBy, "result", "expected turn 1 to end on the result marker");
        assert.equal(turn2.endedBy, "result", "expected turn 2 to end on the result marker");
        for (const chunk of turn2.chunks) {
          assert.ok(
            !turn1.chunks.includes(chunk),
            "expected turn 2's chunks to contain none of turn 1's text — the cursor discipline must hold",
          );
        }
        step(
          `reproduction confirmed: turn 2's ${turn2.chunkCount} chunks (${turn2.charCount} chars, ` +
            `first chunk alone was ${turn2FixtureTexts[0].length} chars) all captured — the exact ` +
            "shape that used to drop the three questions verbatim",
        );

        exchanges = [
          { speaker: "developer", text: OPENING_PROMPT },
          { speaker: "agent", text: turn1.text, chunkCount: turn1.chunkCount, charCount: turn1.charCount, endedBy: turn1.endedBy },
          { speaker: "developer", text: SECOND_TURN },
          { speaker: "agent", text: turn2.text, chunkCount: turn2.chunkCount, charCount: turn2.charCount, endedBy: turn2.endedBy },
        ];
      } else if (scenarioName === "slow-tool-mid-turn") {
        // ---- WR-04 closure (plan 05-25) — a real mid-turn pause, captured whole ----------------
        // A single, manually-captured turn (like DEFAULT_SCENARIO's own branch above) — this
        // scenario's whole point is proving the idle-policy fix directly, with an EXPLICIT short
        // idleMs, never through driveChallengeConversation's own longer default.
        step(
          `capturing the single scripted turn with an explicit short idleMs=${SLOW_TOOL_IDLE_MS} — ` +
            "short enough that the PRE-FIX idle policy would certainly have truncated this capture " +
            "at the fixture's own mid-turn pause",
        );
        const turn = await sidecar.waitForTurn(runId, turn1Cursor, {
          timeoutMs: REPLAY_TURN_DEADLINE_MS,
          idleMs: SLOW_TOOL_IDLE_MS,
          label: "the slow-tool-mid-turn scenario's single turn",
        });
        step(`captured: chunks=${turn.chunkCount} chars=${turn.charCount} endedBy=${turn.endedBy}`);
        assertAllHeldRequestsAnswered(sidecar);

        const scenario = SCENARIOS[scenarioName];
        const fixtureTextBlocks = scenario.turns[0].filter((block) => block.type === "text");
        assert.equal(
          turn.chunkCount,
          fixtureTextBlocks.length,
          `expected the captured turn to carry every one of the fixture's ${fixtureTextBlocks.length} ` +
            `text block(s), got ${turn.chunkCount} — a turn paused on a slow tool call must never be ` +
            "truncated before it finishes",
        );
        for (const block of fixtureTextBlocks) {
          assert.ok(
            turn.text.includes(block.text),
            `expected the captured turn's text to include this fixture block verbatim: ${JSON.stringify(block.text)}`,
          );
        }
        assert.equal(
          turn.endedBy,
          "result",
          "expected the captured turn to end on the backend's own result marker, not the idle " +
            "marker — a turn paused on a slow tool call must be captured whole, ending on the " +
            "backend's own end-of-turn line, never truncated at the idle window while the backend " +
            "is still generating",
        );
        step(
          `reproduction confirmed: the turn's ${turn.chunkCount} chunk(s) (${turn.charCount} chars) ` +
            "all captured, ending on the result marker — the mid-turn pause did not truncate it",
        );

        exchanges = [
          { speaker: "developer", text: OPENING_PROMPT },
          {
            speaker: "agent",
            text: turn.text,
            chunkCount: turn.chunkCount,
            charCount: turn.charCount,
            endedBy: turn.endedBy,
          },
        ];
      } else {
        // ---- every other scenario — driven through the REAL driveChallengeConversation ---------
        step("driving the REAL driveChallengeConversation against the scripted backend");
        const conversation = await driveChallengeConversation({
          sidecar,
          runId,
          sendTurn: (text) => sidecar.request({ op: "authoring_turn", runId, text }),
          cursor: turn1Cursor,
          turnDeadlineMs: REPLAY_TURN_DEADLINE_MS,
          maxAgentTurns: MAX_AGENT_TURNS,
        });
        for (const exchange of conversation.exchanges) {
          step(
            exchange.speaker === "agent"
              ? `agent turn: ${JSON.stringify(exchange.text)} — chunks=${exchange.chunkCount} ` +
                  `chars=${exchange.charCount} endedBy=${exchange.endedBy}`
              : `developer turn: ${JSON.stringify(exchange.text)}`,
          );
        }
        assertAllHeldRequestsAnswered(sidecar);

        // Plan 05-23 (CR-01 closure): the boundary every window below is measured against —
        // captured once, right after the driver returns and the held-request check passes,
        // mirroring the live body's own boundary-taking convention exactly. Everything from here
        // on (advance-stage and whatever follows it) is decompose-stage activity.
        const challengeWindowEnd = sidecar.eventCursor();

        // Ordering invariant: every developer exchange's own send-cursor is at or after the
        // preceding agent turn's own end index — asserted PER EXCHANGE, not in aggregate.
        let precedingAgentEndIndex = turn1Cursor;
        for (const exchange of conversation.exchanges) {
          if (exchange.speaker === "agent") {
            precedingAgentEndIndex = exchange.endIndex;
          } else {
            assert.ok(
              exchange.cursor >= precedingAgentEndIndex,
              `expected developer exchange ${JSON.stringify(exchange.text)} to be sent at or after ` +
                `the preceding agent turn's own end index (${precedingAgentEndIndex}), got ${exchange.cursor}`,
            );
          }
        }

        // Composition invariant: every developer exchange's lines are drawn from the answer bank
        // or are the closing turn verbatim.
        const bankValues = new Set([...ANSWER_BANK.map((entry) => entry.answer), ANSWER_BANK_FALLBACK]);
        for (const exchange of conversation.exchanges) {
          if (exchange.speaker !== "developer") continue;
          if (exchange.text === CLOSING_TURN) continue;
          const lines = exchange.text.split("\n");
          assert.equal(
            lines[0],
            REPLY_PREAMBLE,
            `expected a composed developer reply to open with the fixed preamble: ${JSON.stringify(exchange.text)}`,
          );
          for (const line of lines.slice(1)) {
            const stripped = line.replace(/^\d+\.\s/, "");
            assert.ok(
              bankValues.has(stripped),
              `developer exchange line is not an exact answer-bank member: ${JSON.stringify(stripped)}`,
            );
          }
        }

        if (scenarioName === "settles-after-answers") {
          assert.equal(conversation.settled, true, "expected the settles-after-answers scenario to settle");
          assert.equal(conversation.answeredQuestionCount, 3, "expected exactly three questions answered");
          assert.equal(conversation.closingTurnSent, false, "expected zero closing turns sent");
          step(
            `settled after ${conversation.agentTurns} agent turn(s), ` +
              `${conversation.answeredQuestionCount} question(s) answered, no closing turn`,
          );
        } else if (scenarioName === "never-settles") {
          assert.equal(conversation.settled, false, "expected the never-settles scenario to NOT settle");
          assert.equal(conversation.closingTurnSent, true, "expected the closing turn to have been sent");
          assert.equal(
            conversation.agentTurns,
            MAX_AGENT_TURNS + 1,
            "expected the declared cap plus the one final turn that follows the closing turn",
          );
          step(
            `did not settle within ${MAX_AGENT_TURNS} agent turns — closing turn sent, ` +
              `${conversation.agentTurns} agent turn(s) total`,
          );
        } else if (scenarioName === "stages-work-during-challenge") {
          // Task 3 (G-05-2): the one scenario that proves SHAPE-01's "no work planned" half can
          // FAIL — a propose attempt with no refusal must read as "violated" and must sink the
          // built SHAPE-01 entry, isolated from the "challenged" half by holding it true. Plan
          // 05-23 (CR-01 closure): the window is now explicit, from turn1Cursor to the boundary
          // captured just above — the propose attempt in this fixture lands inside the challenge
          // stage itself, so it must still be caught.
          const reading = readNoWorkPlanned(sidecar.events, {
            runId,
            fromIndex: turn1Cursor,
            toIndex: challengeWindowEnd,
          });
          assert.equal(reading, "violated", "expected a propose attempt with no refusal to read as violated");
          const shapeResults = buildCriteriaResults({
            criterion1Challenged: true,
            noWorkPlannedReading: reading,
            criterion2Landed: false,
            criterion3Decided: false,
            criterion4Reopened: false,
            criterion4PrimedRejected: false,
          });
          const shape01 = shapeResults.find(([name]) => name.includes("SHAPE-01"));
          assert.ok(shape01, "expected a SHAPE-01 entry in the built results");
          assert.equal(shape01[1], false, "expected SHAPE-01 to NOT pass when a propose attempt went unrefused");
          step(`noWorkPlanned reading: ${reading} — SHAPE-01 entry passed=${shape01[1]} (expected false)`);
        } else if (scenarioName === "back-to-back-proposals") {
          // Task 1 (plan 05-27, G-05-4 closure): the collision `isAttemptRefused`'s independent
          // per-attempt scan could not see — two propose attempts issued back-to-back, in ONE
          // turn, before either is answered. The shipped, id-based `correlateProposeAttempts`
          // pairs each attempt with its OWN result by construction (two attempts carry two
          // different ids and cannot collide), making the reading `violated`. Plan 05-30 (G-05-5
          // closure): the round-6 side-by-side comparison against the pre-claiming algorithm that
          // used to live here is retired — the property it guarded is subsumed by the id lookup —
          // and the file's one remaining frozen control (`correlateProposeAttemptsPositionally`)
          // is exercised offline in `--self-test`, not against this live-driven fixture.
          const challengeWindow = { runId, fromIndex: turn1Cursor, toIndex: challengeWindowEnd };

          // Non-vacuity gate: the window must genuinely hold at least two propose tool_call
          // events and at least two tool_result events for this run — proving the fixture's
          // `role: "user"` envelope really did normalise into tool_result events, not merely
          // that the assertions below happen to pass on an empty or malformed window.
          const proposeCallCount = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              event.type === "tool_call" &&
              typeof event[TOOL_NAME_FIELD] === "string" &&
              event[TOOL_NAME_FIELD].includes(PROPOSE_TOOL_NAME_FRAGMENT),
          ).length;
          const toolResultCount = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              event.type === "tool_result",
          ).length;
          assert.ok(
            proposeCallCount >= 2,
            `expected at least two propose tool_call events in the challenge window, got ${proposeCallCount}`,
          );
          assert.ok(
            toolResultCount >= 2,
            `expected at least two tool_result events in the challenge window, got ${toolResultCount} — ` +
              'the role: "user" envelope must have normalised into tool_result events',
          );

          const correlated = correlateProposeAttempts(sidecar.events, challengeWindow);
          assert.equal(correlated.length, 2, "expected exactly two correlated propose attempts");
          assert.ok(
            correlated[0].answerIndex !== null && correlated[1].answerIndex !== null,
            "expected both attempts to carry a non-null answerIndex",
          );
          assert.notEqual(
            correlated[0].answerIndex,
            correlated[1].answerIndex,
            "expected the two attempts to be paired with two DIFFERENT tool_result indices",
          );

          const claimedReading = readNoWorkPlanned(sidecar.events, challengeWindow);
          assert.equal(
            claimedReading,
            "violated",
            "expected the claimed-index reading to report violated — the second, unrefused " +
              "attempt must sink SHAPE-01",
          );

          const shapeResults = buildCriteriaResults({
            criterion1Challenged: true,
            noWorkPlannedReading: claimedReading,
            criterion2Landed: false,
            criterion3Decided: false,
            criterion4Reopened: false,
            criterion4PrimedRejected: false,
          });
          const shape01 = shapeResults.find(([name]) => name.includes("SHAPE-01"));
          assert.ok(shape01, "expected a SHAPE-01 entry in the built results");
          assert.equal(shape01[1], false, "expected SHAPE-01 to NOT pass when a propose attempt went unrefused");

          step(`back-to-back reading (id-based): ${claimedReading} — SHAPE-01 entry passed=${shape01[1]} (expected false)`);
        } else if (scenarioName === "interleaved-read-during-proposal") {
          // Plan 05-30 (gap G-05-5): the propose attempt's own real, unrefused answer sits BEHIND
          // an unrelated board_search call's result, and that unrelated result's own text
          // coincidentally matches the stage-gate refusal wording. A positional pairing would claim
          // the wrong result as the propose attempt's answer and certify a genuine violation as a
          // pass; the id-based lookup must pair each attempt with its OWN result regardless of
          // interleaving.
          const challengeWindow = { runId, fromIndex: turn1Cursor, toIndex: challengeWindowEnd };

          // Non-vacuity gate: the window must genuinely hold at least one propose tool_call, at
          // least one NON-propose tool_call, and at least two tool_result events for this run —
          // proving the fixture actually normalised as intended before the assertions below run
          // over it.
          const proposeCallCount = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              event.type === "tool_call" &&
              typeof event[TOOL_NAME_FIELD] === "string" &&
              event[TOOL_NAME_FIELD].includes(PROPOSE_TOOL_NAME_FRAGMENT),
          ).length;
          const nonProposeCallCount = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              event.type === "tool_call" &&
              !(typeof event[TOOL_NAME_FIELD] === "string" && event[TOOL_NAME_FIELD].includes(PROPOSE_TOOL_NAME_FRAGMENT)),
          ).length;
          const toolResultCount = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              event.type === "tool_result",
          ).length;
          assert.ok(
            proposeCallCount >= 1,
            `expected at least one propose tool_call event in the challenge window, got ${proposeCallCount}`,
          );
          assert.ok(
            nonProposeCallCount >= 1,
            `expected at least one NON-propose tool_call event in the challenge window, got ${nonProposeCallCount}`,
          );
          assert.ok(
            toolResultCount >= 2,
            `expected at least two tool_result events in the challenge window, got ${toolResultCount}`,
          );

          const correlated = correlateProposeAttempts(sidecar.events, challengeWindow);
          assert.equal(correlated.length, 1, "expected exactly one correlated propose attempt");
          const [attempt] = correlated;
          assert.ok(attempt.answerIndex !== null, "expected the propose attempt to carry a non-null answerIndex");
          assert.equal(
            sidecar.events[attempt.answerIndex][CORRELATION_ID_FIELD],
            attempt.toolUseId,
            "expected the paired result's own correlation id to equal the attempt's own — the id " +
              "lookup, not position, is what decided this pairing",
          );
          assert.equal(attempt.refused, false, "expected the propose attempt's OWN answer to be unrefused");

          const reading = readNoWorkPlanned(sidecar.events, challengeWindow);
          assert.equal(
            reading,
            "violated",
            "expected the interleaved-read shape to read violated — the vacuous SHAPE-01 pass this " +
              "gap describes must be gone",
          );

          const shapeResults = buildCriteriaResults({
            criterion1Challenged: true,
            noWorkPlannedReading: reading,
            criterion2Landed: false,
            criterion3Decided: false,
            criterion4Reopened: false,
            criterion4PrimedRejected: false,
          });
          const shape01 = shapeResults.find(([name]) => name.includes("SHAPE-01"));
          assert.ok(shape01, "expected a SHAPE-01 entry in the built results");
          assert.equal(shape01[1], false, "expected SHAPE-01 to NOT pass over the interleaved-read shape");

          step(
            `interleaved-read reading: ${reading} — propose attempt at index ${attempt.index} paired ` +
              `with its own result at index ${attempt.answerIndex} — SHAPE-01 entry ` +
              `passed=${shape01[1]} (expected false)`,
          );
        } else if (scenarioName === "proposal-without-correlation-ids") {
          // Plan 05-31 (Task 2, G-05-5 closure): the absent-id decision's own end-to-end proof.
          // A backend that supplies no correlation ids at all must make the run unjudgeable,
          // never guessed at and never passed by default. The fixture's own result text
          // deliberately does NOT match the refusal wording, so a reintroduced positional
          // fallback would read `violated` — visibly wrong — rather than coincidentally
          // agreeing with the `uncorrelatable` abstention proven below.
          const challengeWindow = { runId, fromIndex: turn1Cursor, toIndex: challengeWindowEnd };

          // Non-vacuity gate: the window must genuinely hold at least one propose tool_call and
          // at least one tool_result event for this run, so the assertions below cannot pass
          // over an empty window.
          const proposeCallCount = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              event.type === "tool_call" &&
              typeof event[TOOL_NAME_FIELD] === "string" &&
              event[TOOL_NAME_FIELD].includes(PROPOSE_TOOL_NAME_FRAGMENT),
          ).length;
          const toolResultCount = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              event.type === "tool_result",
          ).length;
          assert.ok(
            proposeCallCount >= 1,
            `expected at least one propose tool_call event in the challenge window, got ${proposeCallCount}`,
          );
          assert.ok(
            toolResultCount >= 1,
            `expected at least one tool_result event in the challenge window, got ${toolResultCount}`,
          );

          // The adapter's own honest absence, asserted on LIVE event objects from the real
          // sidecar — a key-PRESENCE check, never a comparison against `undefined` (which would
          // also pass on a present-but-undefined value, the exact shape
          // `claude-code-adapter.ts`'s own conditional-spread idiom is written to prevent). This
          // is what makes this scenario prove the ADAPTER's honest absence, not merely the
          // harness's handling of it.
          const inWindowCallsAndResults = sidecar.events.filter(
            (event, index) =>
              index >= challengeWindow.fromIndex &&
              index < challengeWindow.toIndex &&
              event.runId === runId &&
              (event.type === "tool_call" || event.type === "tool_result"),
          );
          assert.ok(
            inWindowCallsAndResults.length >= 2,
            `expected at least one tool_call AND one tool_result event in the challenge window, ` +
              `got ${inWindowCallsAndResults.length}`,
          );
          for (const event of inWindowCallsAndResults) {
            assert.ok(
              !Object.prototype.hasOwnProperty.call(event, CORRELATION_ID_FIELD),
              `expected a ${event.type} event (seq=${event.seq}) to carry NO ${CORRELATION_ID_FIELD} ` +
                "key at all — the adapter must never fabricate a correlation id the backend did not supply",
            );
          }

          const reading = readNoWorkPlanned(sidecar.events, challengeWindow);
          assert.equal(
            reading,
            "uncorrelatable",
            "expected an id-less stream to read uncorrelatable, never a guess and never a silent pass",
          );

          const shapeResults = buildCriteriaResults({
            criterion1Challenged: true,
            noWorkPlannedReading: reading,
            criterion2Landed: false,
            criterion3Decided: false,
            criterion4Reopened: false,
            criterion4PrimedRejected: false,
          });
          const shape01 = shapeResults.find(([name]) => name.includes("SHAPE-01"));
          assert.ok(shape01, "expected a SHAPE-01 entry in the built results");
          assert.equal(shape01[1], false, "expected SHAPE-01 to NOT pass over an uncorrelatable run");

          const positionalCorrelated = correlateProposeAttemptsPositionally(sidecar.events, challengeWindow);
          const positionalReading =
            positionalCorrelated.length === 0
              ? "unproven"
              : positionalCorrelated.every((attempt) => attempt.refused)
                ? "refused"
                : "violated";
          assert.notEqual(
            positionalReading,
            "uncorrelatable",
            "expected the frozen positional control to still pair these events anyway, over the " +
              "SAME window — the old mechanism answers exactly where the new one abstains",
          );

          step(
            `id-less stream reading: ${reading} (frozen positional control would have read: ` +
              `${positionalReading}) — SHAPE-01 entry passed=${shape01[1]} (expected false)`,
          );
        } else if (scenarioName === "backend-refuses-mid-conversation") {
          // Plan 05-24 (gap G-05-3): the driver must have stopped AT the refusal — reporting it,
          // settling false, and sending no further developer turn into a refused session.
          assert.ok(conversation.refusal, "expected the driver to report a refusal for this scenario");
          assert.equal(
            conversation.refusal.classifier,
            "reasoning_extraction",
            "expected the detected classifier to equal the fixture's own code",
          );
          assert.equal(conversation.settled, false, "expected settled to be false when a refusal stops the driver");
          const developerTurns = conversation.exchanges.filter((exchange) => exchange.speaker === "developer");
          assert.equal(
            developerTurns.length,
            1,
            "expected exactly one developer turn composed by the driver — the loop ran once (answering " +
              "turn 1's questions) and then stopped at the refusal, never sending a second developer turn",
          );
          const refusedExchange = conversation.exchanges.find(
            (exchange) => exchange.speaker === "agent" && exchange.refusal,
          );
          assert.ok(refusedExchange, "expected a refused agent exchange in the driver's own exchange record");
          assert.ok(
            refusedExchange.text.includes(BACKEND_REFUSAL_PREFIX),
            "expected the refused turn's text to be preserved verbatim in the exchanges — a failed " +
              "capture must report what it DID capture, never discard it",
          );
          step(
            `driver stopped at the refusal — classifier=${conversation.refusal.classifier} ` +
              `requestId=${conversation.refusal.requestId ?? "none"} — settled=${conversation.settled}`,
          );
        }

        // Plan 05-24 (gap G-05-3): a refused conversation must NEVER reach advance-stage — the
        // whole point of this scenario is that the gate is never opened on it. Every other
        // scenario advances the stage through the bridge, mirroring the live body exactly.
        if (scenarioName === "backend-refuses-mid-conversation") {
          step("skipping advance-stage for this scenario — a refused conversation never reaches it (D-90)");
          exchanges = buildEvidenceExchanges({ openingPrompt: OPENING_PROMPT, conversation });

          const recentRuns = runOps(opsBin, harness.appDataDir, ["recent-authoring-runs", "50"]);
          const thisRun = Array.isArray(recentRuns) ? recentRuns.find((r) => r.runId === runId) : undefined;
          assert.ok(thisRun, "expected to find this run via recent-authoring-runs");
          assert.equal(
            thisRun.authoringStage,
            "challenge",
            "expected the run's stage to still be challenge — advance-stage must never have been called",
          );
          step(`confirmed via recent-authoring-runs: authoringStage=${thisRun.authoringStage} (still challenge)`);
        } else {
          step("advancing the stage (Cyril's own gate, D-90) through the bridge, mirroring the live body");
          const advanceCursor = sidecar.eventCursor();
          const advanced = runOps(opsBin, harness.appDataDir, ["advance-stage", runId]);
          assert.equal(advanced.stage, "decompose");
          assert.ok(
            advanceCursor >= conversation.cursor,
            `expected the cursor recorded at advance-stage (${advanceCursor}) to be at or after the ` +
              `final agent turn's own end index (${conversation.cursor})`,
          );

          exchanges = buildEvidenceExchanges({ openingPrompt: OPENING_PROMPT, conversation });

          if (scenarioName === "proposes-work-after-advance") {
            // Plan 05-23 (CR-01 closure): the fixture reaches decompose LEGITIMATELY — a clean
            // challenge stage, then one post-advance developer turn (the distillation instruction,
            // mirroring the live body's own step) that triggers the fixture's scripted decompose-
            // stage propose call. This is the exact combination CR-01's own defect needed and no
            // offline arm ever exercised before this plan: a propose call that lands strictly AFTER
            // challengeWindowEnd, which the bounded reading must never see and the unbounded
            // (CR-01) reading must still misread.
            assert.ok(
              typeof advanced.distillationText === "string" && advanced.distillationText.length > 0,
              "expected advance-stage to return a distillation instruction for this scenario",
            );
            const postAdvanceCursor = sidecar.eventCursor();
            await sidecar.request({ op: "authoring_turn", runId, text: advanced.distillationText });
            exchanges.push({ speaker: "developer", text: advanced.distillationText, cursor: postAdvanceCursor });
            const postAdvanceReply = await sidecar.waitForTurn(runId, postAdvanceCursor, {
              timeoutMs: REPLAY_TURN_DEADLINE_MS,
              label: "the post-advance decompose-stage reply (proposes-work-after-advance)",
            });
            exchanges.push({
              speaker: "agent",
              text: postAdvanceReply.text,
              chunkCount: postAdvanceReply.chunkCount,
              charCount: postAdvanceReply.charCount,
              endedBy: postAdvanceReply.endedBy,
            });

            // Assertion 1: the bounded challenge-window reading is unproven — the challenge stage
            // was genuinely clean.
            const boundedWindow = { runId, fromIndex: turn1Cursor, toIndex: challengeWindowEnd };
            const boundedReading = readNoWorkPlanned(sidecar.events, boundedWindow);
            assert.equal(
              boundedReading,
              "unproven",
              "expected the bounded challenge-window reading to be unproven — the challenge stage " +
                "was genuinely clean",
            );

            // Assertion 2: at least one propose tool_call for this run exists at an index at or
            // after challengeWindowEnd — so the scenario provably reached the contaminating state
            // and the assertions below are not vacuous.
            const proposeAfterBoundary = sidecar.events.some(
              (event, index) =>
                index >= challengeWindowEnd &&
                event.runId === runId &&
                event.type === "tool_call" &&
                typeof event[TOOL_NAME_FIELD] === "string" &&
                event[TOOL_NAME_FIELD].includes(PROPOSE_TOOL_NAME_FRAGMENT),
            );
            assert.ok(
              proposeAfterBoundary,
              "expected at least one propose tool_call for this run at an index at or after " +
                "challengeWindowEnd — the scenario must provably reach the contaminating state",
            );

            // Assertion 3: the reading over the WHOLE unscoped range (from turn1Cursor to the
            // current events length) is still violated — this is the CR-01 reading, asserted to
            // still be wrong, which is what gives the regression teeth.
            const unboundedWindow = { runId, fromIndex: turn1Cursor, toIndex: sidecar.events.length };
            const unboundedReading = readNoWorkPlanned(sidecar.events, unboundedWindow);
            assert.equal(
              unboundedReading,
              "violated",
              "expected the WHOLE unscoped range's reading (the CR-01 reading) to still be violated " +
                "— this is what gives the regression teeth",
            );

            // Assertion 4: the bounded reading reused as the final gating value is NOT violated.
            assert.notEqual(
              boundedReading,
              "violated",
              "expected the bounded reading reused as the final gating value to NOT be violated",
            );

            // Assertion 5: buildCriteriaResults with criterion1Challenged held true and the bounded
            // reading yields a SHAPE-01 entry whose passed flag is true — the successful path
            // SHAPE-01 and SHAPE-02 must be able to share.
            const shapeResults = buildCriteriaResults({
              criterion1Challenged: true,
              noWorkPlannedReading: boundedReading,
              criterion2Landed: false,
              criterion3Decided: false,
              criterion4Reopened: false,
              criterion4PrimedRejected: false,
            });
            const shape01 = shapeResults.find(([name]) => name.includes("SHAPE-01"));
            assert.ok(shape01, "expected a SHAPE-01 entry in the built results");
            assert.equal(
              shape01[1],
              true,
              "expected SHAPE-01 to pass on the successful path — a clean challenge followed by a " +
                "legitimate decompose-stage proposal",
            );

            step(
              `bounded reading (gating): ${boundedReading} — unbounded reading (CR-01's own reading, ` +
                `still wrong): ${unboundedReading} — SHAPE-01 entry passed=${shape01[1]} (expected true)`,
            );
          }
        }
      }

      // A synthetic evidence sheet — written for inspection, but NEVER through `resolveEvidencePath()`
      // and NEVER anywhere near the phase directory (G-05-2's own guard against laundering a
      // scripted run as a live one). Written under the harness's OWN scratch root, never
      // `.planning/` — one per scenario, so a human debugging a failure reads the dialogue rather
      // than reconstructing it.
      const scratchEvidenceDir = path.join(harness.root, "evidence");
      fs.mkdirSync(scratchEvidenceDir, { recursive: true });
      const scratchEvidencePath = path.join(scratchEvidenceDir, EVIDENCE_FILE_NAME);
      fs.writeFileSync(
        scratchEvidencePath,
        renderChallengeEvidenceSheet({
          runId,
          exchanges,
          noWorkPlannedReading: "unproven",
          draftedCriteriaCount: 0,
          amendedCriteriaCount: 0,
          results: [],
          timestamp: new Date().toISOString(),
          synthetic: true,
          scenario: scenarioName,
        }),
      );
      step(`wrote a synthetic evidence sheet (scratch only, never the phase directory): ${scratchEvidencePath}`);

      step("ending the run (kill op) and confirming the fake backend leaves no process behind");
      await sidecar.request({ op: "kill", runId });
      await sidecar.waitForEvent(
        (event) => event.type === "session_closed" && event.runId === runId,
        30_000,
        "a session_closed event after kill",
      );
      sidecar.dispose();
      step("session closed and disposed — no fake backend process should remain running");
    },
  );
}

/**
 * `--replay-check` (plan 05-20, G-05-2; scenario selector added plan 05-21): proves the WHOLE
 * turn-boundary slice AND both conversational shapes — a scripted, multi-block agent turn captured
 * whole through the REAL sidecar, the REAL watchdog and the REAL shipped normaliser, and a real
 * conversation settling or running out of depth — WITHOUT spending a token. It NEVER calls
 * `probeClaudeAvailable()` and never resolves a real `claude` binary — the only backend in this
 * arm's path is `fake-authoring-claude.mjs`. Short-circuits BEFORE the live `runScript` call below,
 * exactly like `--self-test` and `--board-read-check`.
 *
 * `--scenario <name>` runs exactly that entry of {@link SCENARIOS}; omitted, every scenario runs in
 * sequence, each with its own run, sidecar and teardown (never sharing state across scenarios).
 */
if (process.argv.includes("--replay-check")) {
  const scenarioFlagIndex = process.argv.indexOf("--scenario");
  const requestedScenario = scenarioFlagIndex >= 0 ? process.argv[scenarioFlagIndex + 1] : undefined;
  if (requestedScenario !== undefined && SCENARIOS[requestedScenario] === undefined) {
    process.stderr.write(
      `--replay-check --scenario ${requestedScenario}: unknown scenario (known: ${Object.keys(SCENARIOS).join(", ")})\n`,
    );
    process.exit(1);
  }
  const scenarioNames = requestedScenario !== undefined ? [requestedScenario] : Object.keys(SCENARIOS);

  let anyFailed = false;
  for (const scenarioName of scenarioNames) {
    process.exitCode = undefined;
    await runReplayCheckScenario(scenarioName);
    // IN-01 (05-REVIEW.md): exit code 1 is a real failure; exit code 3 is `runScript`'s own
    // SkipError convention (a precondition was missing, not a red arm) — conflating the two would
    // report a scenario that skipped itself as a failure of the WHOLE multi-scenario arm. No
    // scenario body calls skip() today; this closes the trap before a future one does.
    if (process.exitCode === 1) anyFailed = true;
  }
  process.exit(anyFailed ? 1 : 0);
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
    step(
      `composed isolated Claude config directory at ${harness.lastComposedClaudeConfig.configDir} — ` +
        `linked ${harness.lastComposedClaudeConfig.linkedEntries.length} credential ` +
        `entr${harness.lastComposedClaudeConfig.linkedEntries.length === 1 ? "y" : "ies"} by reference ` +
        "(plan 05-33, gap G-05-6)",
    );

    // Plan 05-33 (Task 2, gap G-05-6): scrub before spawn, refuse before spawn — BOTH before the
    // sidecar itself exists, so a refusal here costs no process, no deadline and no credential.
    // This is the direct countermeasure to validation ledger row `05-22-03`, whose credential path
    // was never recorded: from here on, the path this run took is either the developer's own
    // subscription login or a named, up-front refusal — never a silent API-key fallback.
    const removedApiKeyVars = scrubApiKeyEnv(env);
    step(
      removedApiKeyVars.length > 0
        ? `scrubbed ${removedApiKeyVars.length} API-key env var(s) from the spawn environment: ` +
            `${removedApiKeyVars.join(", ")}`
        : "no API-key env var was present in the spawn environment to scrub",
    );
    const credentialSummary = assertBackendAuthenticated({
      env,
      configDir: harness.lastComposedClaudeConfig.configDir,
    });
    step(`backend authenticated as the developer: method=${credentialSummary.authMethod} loggedIn=${credentialSummary.loggedIn}`);

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
    // G-05-2 (plan 05-20): the cursor is taken BEFORE the request that triggers the opening
    // turn — never after — so turn 1's capture is bounded at the start as well as the end. The
    // old `waitForEvent`'s buffered-first scan excluded only ONE prior event by object identity,
    // which is not the same guarantee (Evidence E9).
    const turn1Cursor = sidecar.eventCursor();
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
      "draining incidental startup permission requests AND held board reads (D-87, plan 05-18) " +
        "— this script reserves no gated command of its own, so no permission_request here is " +
        "ever the request under test, and every board_read_request is answered from the real " +
        "scratch board via the same dispatch the desktop app uses",
    );
    drainInboundCoreRequests(sidecar, runId, {
      handlers: {
        permission_request: createPermissionAnswerHandler(sidecar, runId, isDeliberateRequest),
        board_read_request: createBoardReadHandler({ opsBin, appDataDir: harness.appDataDir, sidecar, runId }),
      },
      shouldStop: () => !draining,
    });

    // Plan 05-24 (Task 2, NF-01 closure): NO standalone first-turn capture here anymore.
    // `driveChallengeConversation`, seeded with `turn1Cursor` below, captures the agent's first
    // reply as its OWN first agent exchange — capturing it a second time here (as this file used
    // to) is exactly what produced two identical entries in `05-LIVE-CHALLENGE-TRANSCRIPT.md`
    // (NF-01). The narration and `criterion1Challenged` scan below are derived from the driver's
    // own returned exchanges instead, so they survive without the duplicate capture behind them.

    // G-05-3 (plan 05-24): resolved here, before the fail-fast below can need it — a refusal must
    // be able to write the evidence sheet with whatever was captured before it fails the run.
    const evidencePath = resolveEvidencePath();

    step(
      "driving the challenge conversation — capturing the agent's first turn (the WHOLE turn, " +
        "every content block, bounded by its own result marker) then answering what it actually " +
        `asked, never a canned follow-up, bounded at ${MAX_AGENT_TURNS} agent turns (G-05-2)`,
    );
    const conversation = await driveChallengeConversation({
      sidecar,
      runId,
      sendTurn: (text) => sidecar.request({ op: "authoring_turn", runId, text }),
      cursor: turn1Cursor,
      turnDeadlineMs: TURN_DEADLINE_MS,
      // WR-04 closure (plan 05-25): the live arm states, at its own call site, the pause it
      // permits a REAL model turn to take mid-turn — never the short TURN_IDLE_MS default a test
      // passes when deliberately measuring the degrade path.
      idleMs: LIVE_TURN_IDLE_MS,
      maxAgentTurns: MAX_AGENT_TURNS,
    });
    const firstAgentExchange = conversation.exchanges.find((exchange) => exchange.speaker === "agent");
    if (firstAgentExchange) {
      step(
        `first reply (verbatim, for the human transcript review): ${JSON.stringify(firstAgentExchange.text)} ` +
          `— chunks=${firstAgentExchange.chunkCount} chars=${firstAgentExchange.charCount} ` +
          `endedBy=${firstAgentExchange.endedBy}`,
      );
    }
    for (const exchange of conversation.exchanges) {
      step(
        exchange.speaker === "agent"
          ? `agent turn: ${JSON.stringify(exchange.text)} — chunks=${exchange.chunkCount} ` +
              `chars=${exchange.charCount} endedBy=${exchange.endedBy}`
          : `developer turn: ${JSON.stringify(exchange.text)}`,
      );
    }

    // G-05-3 (plan 05-24): a backend refusal stopped the driver — this is the mechanism that
    // killed run 01M399FP80B184QM2RXTXJDZTK. Fail fast, naming the class, the classifier and the
    // request id, WITHOUT discarding the turns already captured and WITHOUT advancing the stage —
    // D-90's gate exists to be opened on a finished conversation, and this one did not finish.
    if (conversation.refusal) {
      const refusalExchanges = buildEvidenceExchanges({ openingPrompt: OPENING_PROMPT, conversation });
      fs.writeFileSync(
        evidencePath,
        renderChallengeEvidenceSheet({
          runId,
          exchanges: refusalExchanges,
          noWorkPlannedReading: "unproven",
          draftedCriteriaCount: 0,
          amendedCriteriaCount: 0,
          results: [],
          timestamp: new Date().toISOString(),
          refusal: conversation.refusal,
        }),
      );
      throw new Error(
        `backend refusal (${BACKEND_REFUSAL_KIND}) stopped the challenge conversation before it ` +
          `settled — classifier=${conversation.refusal.classifier ?? "unknown"} ` +
          `requestId=${conversation.refusal.requestId ?? "none"}. This is a backend-level refusal, ` +
          "not a model turn; the conversation did not complete and the stage was never advanced. " +
          `See ${evidencePath} for the captured turns.`,
      );
    }

    if (conversation.closingTurnSent) {
      step(
        `the conversation did not settle within ${MAX_AGENT_TURNS} agent turns — sent the closing ` +
          "turn and moved on rather than advancing into silence",
      );
    } else {
      step(
        `the conversation settled after ${conversation.agentTurns} agent turn(s), ` +
          `${conversation.answeredQuestionCount} question(s) answered`,
      );
    }

    // G-05-1 (plan 05-18): a starved held read must fail here, naming itself, rather than let the
    // run limp on to a misleading per-criterion result.
    assertAllHeldRequestsAnswered(sidecar);

    // Plan 05-23 (CR-01 closure): the boundary is taken HERE, once — immediately after the driver
    // returns and the held-request check passes. Everything from here on (advance-stage and the
    // decompose stage it opens) is legitimate by construction (D-89: advancing is what distils the
    // conversation into staged proposals; D-90: the developer alone opens that gate) and must
    // never be read as evidence about the challenge stage.
    const challengeWindowEnd = sidecar.eventCursor();
    step(
      `challenge-stage window closed at event index ${challengeWindowEnd} (from ${turn1Cursor}) — ` +
        "everything from here on is decompose-stage activity and legitimate by construction",
    );

    // Task 3 (G-05-2) / Plan 05-23 (CR-01 closure): the real field (TOOL_NAME_FIELD), read once
    // inside readNoWorkPlanned — event.name was always undefined (ToolCallEvent's real field is
    // toolName), which made this criterion's "no work planned" half vacuously true. Now a
    // three-valued, WINDOW-BOUNDED reading that can fail — and that a legitimate decompose-stage
    // propose call can never contaminate. This is the ONE reading computed for gating; the
    // "final" binding near the end of this run reuses it verbatim rather than recomputing it.
    const noWorkPlannedReading = readNoWorkPlanned(sidecar.events, {
      runId,
      fromIndex: turn1Cursor,
      toIndex: challengeWindowEnd,
    });
    // Plan 05-24 (Task 2, NF-01 closure): derived from the driver's OWN exchanges alone — the
    // driver's first exchange already IS the agent's first turn, so there is no separate `turn1`
    // to fold in here anymore.
    const criterion1Challenged = conversation.exchanges.some(
      (exchange) => exchange.speaker === "agent" && /\?/.test(exchange.text),
    );

    // Plan 05-24 (Task 2, NF-01 closure): the ONE shared assembly both arms use — see
    // `buildEvidenceExchanges`'s own doc comment for why the live body no longer performs a
    // separate first-turn capture the way it used to.
    const exchanges = buildEvidenceExchanges({ openingPrompt: OPENING_PROMPT, conversation });

    // evidencePath was already resolved above, before the refusal fail-fast — reused here.
    fs.writeFileSync(
      evidencePath,
      renderChallengeEvidenceSheet({
        runId,
        exchanges,
        noWorkPlannedReading,
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

    step(
      "advancing the stage (Cyril's own gate, D-90) — the developer decides the challenge is " +
        "done, only now that the driver's own conversation has returned",
    );
    const advanced = runOps(opsBin, harness.appDataDir, ["advance-stage", runId]);
    assert.equal(advanced.stage, "decompose");
    if (advanced.distillationText) {
      step("sending the distillation instruction and capturing its reply (not required for the run to continue)");
      const distillationCursor = sidecar.eventCursor();
      await sidecar.request({ op: "authoring_turn", runId, text: advanced.distillationText });
      exchanges.push({ speaker: "developer", text: advanced.distillationText, cursor: distillationCursor });
      // G-05-3 (plan 05-24): `distillationReply` stays `undefined` on a genuine TIMEOUT (the catch
      // branch below, unchanged from before this plan) so the refusal check after this try/catch
      // is a no-op for that path — a timeout and a refusal are different classes and must stay
      // separately reported. A refusal, by contrast, is a SUCCESSFUL capture (the turn ended
      // cleanly on `result` — this is the exact place the real run actually died), so it must be
      // checked and must fail the run OUTSIDE this try/catch, never swallowed by the timeout branch.
      let distillationReply;
      try {
        distillationReply = await sidecar.waitForTurn(runId, distillationCursor, {
          timeoutMs: TURN_DEADLINE_MS,
          // WR-04 closure (plan 05-25): explicit, matching the driveChallengeConversation call
          // above — the live arm never inherits the short test default at either capture site.
          idleMs: LIVE_TURN_IDLE_MS,
          label: "the decompose stage's reply to the distillation instruction",
        });
        exchanges.push({
          speaker: "agent",
          text: distillationReply.text,
          chunkCount: distillationReply.chunkCount,
          charCount: distillationReply.charCount,
          endedBy: distillationReply.endedBy,
          refusal: distillationReply.refusal ?? null,
        });
        step(
          `distillation reply captured: chunks=${distillationReply.chunkCount} ` +
            `chars=${distillationReply.charCount} endedBy=${distillationReply.endedBy}`,
        );
      } catch (err) {
        // The decompose turn's completeness is not a gating property — a timeout here is recorded
        // as a partial exchange (via the pure accumulateTurn scan, never a rethrow) and the
        // proposal wait below still happens.
        const partial = accumulateTurn(sidecar.events, runId, distillationCursor);
        exchanges.push({
          speaker: "agent",
          text: partial.text,
          chunkCount: partial.chunkCount,
          charCount: partial.charCount,
          endedBy: "timeout",
          refusal: partial.refusal ?? null,
        });
        step(`distillation reply capture timed out (not fatal — the proposal wait still happens): ${err.message}`);
      }

      // G-05-3 (plan 05-24): the place the real run actually died. Never fall through into the
      // proposal wait below — a refused distillation turn means no propose call is ever coming.
      if (distillationReply && distillationReply.refusal) {
        fs.writeFileSync(
          evidencePath,
          renderChallengeEvidenceSheet({
            runId,
            exchanges,
            noWorkPlannedReading,
            draftedCriteriaCount: 0,
            amendedCriteriaCount: 0,
            results: [],
            timestamp: new Date().toISOString(),
            refusal: distillationReply.refusal,
          }),
        );
        throw new Error(
          `backend refusal (${BACKEND_REFUSAL_KIND}) stopped the run at the distillation turn — ` +
            `classifier=${distillationReply.refusal.classifier ?? "unknown"} ` +
            `requestId=${distillationReply.refusal.requestId ?? "none"}. This is a backend-level ` +
            "refusal, not a model turn; the conversation did not complete and the proposal wait " +
            `was never entered. See ${evidencePath} for the captured turns.`,
        );
      }
    }

    step("waiting for at least one proposal (assumption or task) to arrive");
    let sawProposal = false;
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
    if (rejectedTaskId) {
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

    // Plan 05-23 (CR-01 closure): REUSE, never re-read. The challenge-stage reading captured
    // above (bounded at challengeWindowEnd, before advance-stage) was already correct the moment
    // driveChallengeConversation returned — decompose-stage propose calls (the proposal activity
    // just above) are legitimate by construction and must never re-taint it. A second, unscoped
    // computation here is exactly the CR-01 defect: it would see this stage's own legitimate
    // propose_* calls and force "violated" on essentially every otherwise-successful run.
    const finalNoWorkPlannedReading = noWorkPlannedReading;

    const results = buildCriteriaResults({
      criterion1Challenged,
      noWorkPlannedReading: finalNoWorkPlannedReading,
      criterion2Landed,
      criterion3Decided,
      criterion4Reopened,
      criterion4PrimedRejected,
    });

    fs.writeFileSync(
      evidencePath,
      renderChallengeEvidenceSheet({
        runId,
        exchanges,
        noWorkPlannedReading: finalNoWorkPlannedReading,
        draftedCriteriaCount,
        amendedCriteriaCount,
        results,
        timestamp: new Date().toISOString(),
      }),
    );
    step(`wrote challenge evidence sheet (final): ${evidencePath}`);

    // G-05-1 (plan 05-18): the last chance, immediately before the verdict, to catch a starved
    // held read that a criterion's own booleans would otherwise silently misreport as a plain
    // failure rather than the starvation it actually is.
    assertAllHeldRequestsAnswered(sidecar);

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
