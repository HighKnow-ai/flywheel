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
import net from "node:net";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { PassThrough } from "node:stream";
import { pathToFileURL } from "node:url";

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
  classifyNonConversationTurn,
  composeIsolatedClaudeConfigDir,
  createPermissionAnswerHandler,
  createUnmodelledEventSink,
  CREDENTIAL_LINK_ALLOWLIST,
  decideTurnArmedWindow,
  drainIncidentalPermissionRequests,
  drainInboundCoreRequests,
  HARNESS_PRECONDITION_PREFIX,
  Harness,
  HEARTBEAT_TICK_MS,
  HELD_INBOUND_REQUEST_TYPES,
  LIVE_TOOL_CALL_IDLE_MS,
  LIVE_TURN_IDLE_MS,
  NON_CONVERSATION_SOURCES,
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
  TurnDeadlineError,
  UNMODELLED_EVENT_CAPTURE_LIMIT,
  UNMODELLED_EVENT_LINE_LIMIT,
} from "./lib/sidecar-harness.mjs";
import { DEFAULT_SCENARIO, SCENARIOS, SCENARIO_ENV_VAR, stagedToolResultText } from "./lib/fake-authoring-claude.mjs";

/** The fake authoring backend's own file — resolved once so both `--replay-check` (as
 * `FLYWHEEL_CLAUDE_BIN`) and this script's own build-hint messages name the same path. Never
 * reachable from the live arm — only `--replay-check` sets `FLYWHEEL_CLAUDE_BIN` at all. */
const FAKE_AUTHORING_CLAUDE_PATH = path.join(REPO_ROOT, "scripts", "uat", "lib", "fake-authoring-claude.mjs");

/** Plan 05-34 (G-05-6 closure): the frozen real capture of an unauthenticated CLI's first turn —
 * see the fixture's own `note` field for the full provenance. Read once at module load, from the
 * SAME file Task 1 froze and Task 3's fake-backend scenario reads, so no reader here can drift
 * from the real capture by retyping a copy of it. */
const UNAUTHENTICATED_FIXTURE_PATH = path.join(REPO_ROOT, "scripts", "uat", "fixtures", "unauthenticated-cli-first-turn.json");
const UNAUTHENTICATED_FIXTURE = JSON.parse(fs.readFileSync(UNAUTHENTICATED_FIXTURE_PATH, "utf8"));

/** Plan 05-37 (Task 3, gap G-05-7): the frozen real captures of the rate-limit notice and the
 * reasoning-only assistant message from live run `01M3C48C3PV1NSGHERBZ587YB1` — the SAME fixture
 * Task 2 froze and `fake-authoring-claude.mjs`'s `unmodelled-wire-shapes` scenario reads, read once
 * here too so this script's own assertions cannot drift from the real capture by retyping it. */
const UNMODELLED_SHAPES_FIXTURE_PATH = path.join(REPO_ROOT, "scripts", "uat", "fixtures", "live-opus5-unmodelled-shapes.json");
const UNMODELLED_SHAPES_FIXTURE = JSON.parse(fs.readFileSync(UNMODELLED_SHAPES_FIXTURE_PATH, "utf8"));

/** Plan 05-42 (gap G-05-8(a)): the frozen real capture of live run `01M3DNC0G9CYAWSD8DYEGTRP8C`'s
 * `AskUserQuestion` tool call (plan 05-41's own fixture) — the SAME fixture
 * `fake-authoring-claude.mjs`'s `ask-user-question` scenario reads, read once here too so this
 * script's own assertions (the `--replay-check` branch below and the `--self-test` renderer checks)
 * cannot drift from the real capture by retyping a copy of it. */
const ASK_USER_QUESTION_FIXTURE_PATH = path.join(REPO_ROOT, "scripts", "uat", "fixtures", "live-opus5-ask-user-question.json");
const ASK_USER_QUESTION_FIXTURE = JSON.parse(fs.readFileSync(ASK_USER_QUESTION_FIXTURE_PATH, "utf8"));
const ASK_USER_QUESTION_PROMPTS = ASK_USER_QUESTION_FIXTURE.shapes.find(
  (shape) => shape.name === "ask-user-question",
).line.message.content[0].input.questions;

/**
 * Plan 05-38 (Task 2, gap G-05-7): the live arm's own wall-clock CEILING on a single turn wait. This
 * name asserts that a turn past the value is presumed RUNAWAY — never that a turn must complete
 * within it, a claim this repository cannot support. Plan 05-38's own Task 1 gave `waitForTurn`
 * idle-primary bounds
 * (the ordinary idle window, and now `LIVE_TOOL_CALL_IDLE_MS` for a mid-flight tool call) that reset
 * on every observed progress signal — this ceiling now resets alongside them, so a turn that keeps
 * producing tool calls, tool results, text and reasoning back-to-back never reaches it no matter how
 * long its TOTAL run grows. It remains a genuine backstop for the one state nothing else bounds: a
 * turn that stops advancing in EVERY sense (no chunk, no tool call, no reasoning) for this long
 * straight — most plausibly before its very first chunk.
 *
 * The derivation, in four parts, each closing a different way the next reader could misuse this
 * number:
 * - What was measured: turn 1 of live run `01M3C48C3PV1NSGHERBZ587YB1`, backend `claude-opus-5`, was
 *   still producing events at 120000ms — roughly 130 of them, about sixty tool-call/tool-result
 *   pairs — and was killed by the instrument at that point.
 * - What that measurement IS: a LOWER bound. The turn did not finish. No upper bound on a real
 *   first turn exists anywhere in this repository, and none can be obtained without spending a
 *   credential.
 * - What this number therefore is: a runaway bound, not a completion bound — chosen well above the
 *   only observed lower bound so that a turn doing genuine work cannot reach it, and explicitly NOT
 *   a claim that a real turn completes inside it.
 * - What actually stops a stuck turn: the idle bounds, not this ceiling. If this ceiling EVER fires
 *   on a real run, that is itself a reportable finding — it means a turn went 900000ms without ever
 *   going silent long enough to trip either idle window — and the next reader should treat it as new
 *   information rather than as a number to raise again.
 */
const LIVE_TURN_CEILING_MS = 900_000;

/**
 * How long to wait for a proposal to arrive after advancing the stage. Plan 05-38 (Task 2):
 * deliberately UNCHANGED this round — the same SHAPE of bound as {@link LIVE_TURN_CEILING_MS} (a
 * wall clock on a real model producing a real artefact), but nothing in this repository has ever
 * measured a real post-advance proposal turn, so there is no derivation to write here, and inventing
 * one would be the exact defect this plan exists to close. What would change that: the first live
 * run that reaches the decompose stage and produces a real measurement — this constant should be
 * revisited the moment it does, not before.
 */
const PROPOSAL_DEADLINE_MS = 120_000;

/**
 * The two bounds {@link drainProposalsUntilQuiet} takes for a re-drain window, named here beside
 * {@link PROPOSAL_DEADLINE_MS} (the FIRST wait, for the very first proposal in a stage) since all
 * three bound the same phase of a run — proposals arriving after a stage advances:
 * - `PROPOSAL_DRAIN_QUIET_MS` — how long the watermark must sit unchanged before a burst is called
 *   done.
 * - `PROPOSAL_DRAIN_DEADLINE_MS` — the outer ceiling if the wire never goes quiet at all. Reuses
 *   {@link PROPOSAL_DEADLINE_MS}'s own derivation (nothing in this repository has ever measured a
 *   real multi-window proposal burst either) as its own independent total bound.
 */
const PROPOSAL_DRAIN_QUIET_MS = 3_000;
const PROPOSAL_DRAIN_DEADLINE_MS = 120_000;

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
 * Plan 260929-lq1: the one sanctioned way a LIVE decision target (an `accept-proposal`,
 * `accept-subtree`, `reject-proposal` or `amend-criterion` argument) is chosen. It exists because
 * round 12's live run (`01M3NXWP72VACQJQNVGDK7AXJ8`) crashed inside the core's own pending guard:
 * a proposal id read from a `list-pending` snapshot taken BEFORE a mutating `accept-subtree` call
 * is a fact about a board state that no longer exists by the time it is used — the exact defect
 * plan 05-46 had already fixed once, at a different call site, one round earlier. Fixing the call
 * site and never stating the property let the defect move one call site over instead of
 * disappearing.
 *
 * The `status = 'pending'` filter this function's own `list-pending` read resolves through lives
 * in the core's own SQL (`pending_proposals_for_run`, `authoring_proposal.rs:1049-1052`), not in
 * this harness — "freshly read" and "still genuinely pending" are therefore one fact the database
 * establishes, not two this function has to reconcile itself. Its only job is to stop a caller
 * from separating the read from the decision by holding an array across a mutation: it takes no
 * caller-supplied array and hands none back, so a stale pick is not a shape this function can
 * produce.
 *
 * DECISION TARGETS ONLY — never for a measurement. `draftedCriteriaCount` deliberately keeps
 * reading the pre-cascade `list-pending` snapshot taken before any decision: it measures how many
 * criteria the model drafted, a fact about the run that the cascade must not be allowed to erase.
 * Routing it through this helper would silently collapse that count after every accept.
 *
 * Returns `{ proposal, pendingOfType, pendingTotal }` — `proposal` is the first still-pending
 * match or `null`. Never throws on an empty result, so each caller decides whether an absence is
 * fatal (nothing left to accept) or merely reportable (a reject/amend the cascade already
 * resolved, per SHAPE-04's own honest-reporting branch).
 */
function pickPendingProposal(opsBin, appDataDir, runId, { targetType, excludeIds = [] }) {
  const pending = runOps(opsBin, appDataDir, ["list-pending", runId]);
  const pendingOfType = pending.proposals.filter(
    (p) => p.targetType === targetType && !excludeIds.includes(p.id),
  );
  return {
    proposal: pendingOfType.length > 0 ? pendingOfType[0] : null,
    pendingOfType: pendingOfType.length,
    pendingTotal: pending.proposals.length,
  };
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

/** Plan 05-49 (G-05-10 missing[1]/[2]): the ONE sidecar op a `proposal_created` handler answers
 * on — the staging-path sibling of the literal `"authoring_read_answer"` above — named ONCE here so
 * this harness and the sidecar's own dispatch (`packages/sidecar/src/index.ts`'s
 * `"authoring_proposal_answer"` case) cannot drift on the string. */
const PROPOSAL_STAGED_RELAY_OP = "authoring_proposal_answer";

/** Plan 05-49: the error text relayed for each non-`created` `ProposalOutcome` the
 * `apply-proposal-created` bridge subcommand reports — copied verbatim from
 * `commands::authoring::handle_inbound_proposal_created`'s own wording (the real desktop app's
 * inbound handler) so a human reading either side's error sees the identical sentence. */
const PROPOSAL_OUTCOME_ERROR_TEXT = Object.freeze({
  ignored: "the proposal event was ignored: malformed or unparseable payload",
  unknown_run: "no agent_runs row matches this run",
  terminal_run: "this run has already reached a terminal status",
});

/** Plan 05-49 (G-05-10 missing[2]): every `proposal_created` event's own `requestId` that
 * {@link createProposalStagedHandler}'s returned handler has already applied to the database —
 * checked by {@link drainProposalsUntilQuiet} so the post-turn sweep, which scans the SAME growing
 * `sidecar.events` array the held handler already observed, never re-applies an event the held
 * handler already wrote. Module-level (never threaded through either function's own parameter
 * list) because this script drives exactly one authoring session per process — a second concurrent
 * session driven from the same process is not a shape this harness produces anywhere. */
const proposalStagedAppliedRequestIds = new Set();

/**
 * D-80/D-81/D-92 (plan 05-48; this plan's own in-turn fix, G-05-10): the harness's own inbound half
 * of the proposal-STAGING round trip — the staging sibling of {@link createBoardReadHandler}
 * immediately above, built to the IDENTICAL four-key options shape. Before this plan, nothing in
 * this harness ever answered a held `proposal_created` call at all — `drainProposalsUntilQuiet`
 * only picked events up AFTER the agent's own turn returned, so `proposal_list` called inside that
 * SAME turn could never see the row (the exact defect `05-LIVE-CHALLENGE-TRANSCRIPT.md` turn 6
 * captured). This handler applies the event to the database DURING the held tool call by piping it,
 * RAW, to the `apply-proposal-created` bridge subcommand — the SAME `apply_proposal_created` domain
 * function `commands::authoring::handle_inbound_proposal_created` (the real desktop app's own
 * inbound half) calls in production — then relays the bridge's own `proposalId` (a `created`
 * outcome) or a named error (the three non-created outcomes, via {@link
 * PROPOSAL_OUTCOME_ERROR_TEXT}) back over the sidecar as one {@link PROPOSAL_STAGED_RELAY_OP}
 * op. A thrown bridge failure is converted to `{ error: String(err) }` rather than rethrown, for
 * the exact reason `createBoardReadHandler`'s own comment gives: an errored apply still has to
 * release the held call, or this handler recreates the starvation it exists to prevent.
 *
 * An event carrying no `requestId` is applied but never relayed — the identical compatibility rule
 * `handle_inbound_proposal_created` itself follows for a `requestId`-less inbound event.
 */
function createProposalStagedHandler({ opsBin, appDataDir, sidecar, runId }) {
  return async (event) => {
    let answer;
    try {
      const outcome = runOps(opsBin, appDataDir, ["apply-proposal-created"], JSON.stringify(event));
      answer =
        outcome.outcome === "created"
          ? { result: { proposalId: outcome.proposalId } }
          : { error: PROPOSAL_OUTCOME_ERROR_TEXT[outcome.outcome] ?? `unrecognised proposal outcome: ${outcome.outcome}` };
    } catch (err) {
      answer = { error: String(err) };
    }
    if (typeof event.requestId === "string") {
      proposalStagedAppliedRequestIds.add(event.requestId);
    }
    if (typeof event.requestId !== "string") return true;
    await sidecar
      .request({ op: PROPOSAL_STAGED_RELAY_OP, runId, requestId: event.requestId, ...answer })
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
    // Plan 05-49 (Task 3, G-05-10 missing[3]): defaults to "not-applicable" so every PRE-EXISTING
    // caller of this function (every `--replay-check` self-check above, and every offline
    // `--self-test` fixture that built a `flags` object before this field existed) stays
    // byte-identical in its own gating outcome — "not-applicable" is a PASSING verdict, so an
    // absent flag never turns a previously-passing synthetic result red.
    proposalListVerdict = "not-applicable",
    // Plan 260929-nxq (Task 2c): optional, following the exact precedent `proposalListVerdict`
    // set immediately above — defaults to `null` so the existing ternary below still produces its
    // pre-existing strings and every one of the fourteen offline callers stays byte-identical in
    // both its gating outcome and its printed line.
    criterion2Detail = null,
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
      criterion2Detail ??
        (criterion2Landed ? "a subtree accept materialised real rows" : "no subtree was accepted"),
    ],
    [
      "SHAPE-03/SHAPE-04 — accept, reject and amend decided individually",
      criterion3Decided && PASSING_PROPOSAL_LIST_VERDICTS.has(proposalListVerdict),
      (criterion3Decided
        ? "at least one reject and one amend were exercised"
        : "not enough proposals to exercise all three verbs") +
        ` — proposalListVerdict=${proposalListVerdict}`,
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
 * Pure: renders the Markdown "Questions asked" block for one agent exchange's typed
 * `AskUserQuestion` prompts (plan 05-42, gap G-05-8(a)). Returns the EMPTY STRING for `undefined`,
 * a non-array, or an empty array — the same present-or-absent discipline `nonConversation`/
 * `credentialPath`/`failure` already follow in `renderChallengeEvidenceSheet` below: an exchange
 * with no `questions` key and one whose `questions` is `[]` must render byte-identically, so a
 * synthetic sheet produced by `--replay-check` never drifts from a live one over a field that was
 * not there.
 *
 * Never sorts, de-duplicates or merges — two questions with identical text render as two entries,
 * each rendered in the order the agent asked it, under a bold label naming the tool the questions
 * came through, carrying its own header when present and marked as accepting multiple answers only
 * when `multiSelect` is strictly `true`. Beneath each, its own option labels render as nested
 * bullets in offered order, each carrying its own description when present.
 */
function renderQuestionsAsked(questions) {
  if (!Array.isArray(questions) || questions.length === 0) return "";
  const questionBlocks = questions.map((question) => {
    const headerPrefix = question.header ? `**${question.header}:** ` : "";
    const multiSelectSuffix = question.multiSelect === true ? " _(accepts multiple answers)_" : "";
    const options = Array.isArray(question.options) ? question.options : [];
    const optionLines = options
      .map((option) => {
        const description = option.description ? ` — ${option.description}` : "";
        return `  - ${option.label}${description}`;
      })
      .join("\n");
    return `- ${headerPrefix}${question.question}${multiSelectSuffix}\n${optionLines}`;
  });
  return `\n\n**Questions asked (via AskUserQuestion):**\n\n${questionBlocks.join("\n")}`;
}

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
 * - `criteriaReachabilityReading` (plan 05-46, gap G-05-9) — the FOUR-valued `readCriteriaReachability`
 *   reading (`"drafted" | "blocked" | "declined" | "not-attempted"`), rendered immediately next to
 *   `draftedCriteriaCount` so a zero count reads as a NAMED reason, never a bare number a reader
 *   could mistake for the model's own considered choice when it was, in fact, impossible. Defaults
 *   to `"not-attempted"` when omitted. `criteriaDrainStoppedBy` (`"quiet" | "deadline" | null`)
 *   renders alongside it — "the window closed quiet" and "the window ran out" are different facts
 *   about a run and must not read the same.
 * - `proposalListVerdict` (plan 05-49, Task 3, G-05-10 `missing[3]`) — the FOUR-valued
 *   `assertProposalListNonEmptyInTurn` verdict (`"satisfied" | "violated" | "not-applicable" |
 *   "unknown"`), rendered immediately beside `criteriaReachabilityReading` since both describe the
 *   same criteria-stage turn. Defaults to `"not-applicable"` when omitted.
 * - `results` (the array `buildCriteriaResults`/`reportCriteria` share — may be `[]` before the
 *   decompose phase completes)
 * - `synthetic` (boolean, default `false`) and `scenario` (the scenario name, when `synthetic` is
 *   true) — G-05-2's own guard against laundering a scripted run as a live one: a synthetic sheet
 *   carries an unmissable marker in its first two lines naming the scenario, and its verdict
 *   section is REPLACED by a non-conversation notice — the unfilled-verdict token appears zero times.
 * - `credentialPath` (plan 05-33, Task 3) — the summary `assertBackendAuthenticated` returned,
 *   PLUS a `scrubbedCount` naming how many API-key env vars `scrubApiKeyEnv` removed before spawn.
 *   Optional; `null`/absent renders BYTE-IDENTICALLY to omitting the field entirely — the same
 *   discipline `nonConversation` already carries, for the same reason: `--replay-check` produces
 *   synthetic sheets that must not drift. Never carries an email address, an organisation id or an
 *   organisation name — `summariseAuthStatus` already makes that structurally impossible before
 *   this function ever sees the object; this is the second fence, not the first.
 * - `failure` (plan 05-36, gap G-05-7) — the `Error` (or `TurnDeadlineError`/
 *   `ConversationAbortedError`) that ended the run, when the run ended in one. Rendered
 *   immediately AFTER the drafted-criteria section and BEFORE the non-conversation section (the
 *   verdict section stays last) — its own class name, message, and the FIRST stack frame only,
 *   never the whole stack, which would put absolute developer paths into a committed file.
 *   Optional; `null`/absent renders BYTE-IDENTICALLY to omitting the field entirely, the same
 *   discipline every other optional section here already follows.
 * - `questions` (plan 05-42, gap G-05-8(a)) — on an agent exchange ONLY: the typed
 *   `AskUserQuestion` prompts {@link questionsFromTurn}/{@link buildAgentExchange} carried onto
 *   that exchange, rendered by {@link renderQuestionsAsked} inside that same turn's own block.
 *   Arrives typed from the adapter seam (`ToolCallEvent.questions`, plan 05-41) — never parsed out
 *   of the turn's own text. Absent entirely, or `[]`, renders BYTE-IDENTICALLY to omitting the
 *   field — the same discipline `nonConversation`/`credentialPath`/`failure` above already follow.
 */
function renderChallengeEvidenceSheet(evidence) {
  const {
    runId,
    exchanges = [],
    noWorkPlannedReading = "unproven",
    draftedCriteriaCount,
    amendedCriteriaCount,
    criteriaReachabilityReading = "not-attempted",
    criteriaDrainStoppedBy = null,
    proposalListVerdict = "not-applicable",
    results,
    timestamp,
    synthetic = false,
    scenario,
    nonConversation = null,
    credentialPath = null,
    failure = null,
    // Quick task 260929-p61: defaults to the answer-bank provenance value — the same value every
    // pre-existing caller (the offline arms, every self-test fixture built before this field
    // existed) implicitly used, so an unaugmented sheet keeps reading exactly as it did before
    // this field existed.
    answerSource = ANSWER_SOURCE_BANK,
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
      // Plan 05-42 (gap G-05-8(a)): the typed AskUserQuestion prompts this turn carried, rendered
      // immediately after the fenced text and before the next exchange's own heading — the empty
      // string for a developer entry or an agent entry with no (or empty) `questions`, which is
      // what keeps this byte-identical to how this renderer produced output before this field
      // existed.
      const questionsBlock = exchange.speaker === "agent" ? renderQuestionsAsked(exchange.questions) : "";
      return `### ${index + 1}. ${speakerLabel}${integritySuffix}\n\n\`\`\`\n${exchange.text}\n\`\`\`${questionsBlock}`;
    })
    .join("\n\n");

  // Plan 05-24 (Task 2, G-05-3), generalised by plan 05-34 (G-05-6): a Non-conversation column —
  // the classifier code (text-banner source) or error code (wire source) for a non-conversation
  // agent turn, an em-dash placeholder for every other. Extends the pre-existing table rather than
  // adding a parallel one, so a reader scanning ONE table sees both capture integrity and
  // non-conversation status.
  const agentExchanges = exchanges.filter((exchange) => exchange.speaker === "agent");
  const integrityTable =
    agentExchanges.length > 0
      ? `| Agent turn | Chunk count | Character count | End marker | Non-conversation |\n| --- | --- | --- | --- | --- |\n` +
        agentExchanges
          .map((exchange, index) => {
            const nc = exchange.nonConversation;
            const ncCell = nc ? nc.classifier ?? nc.errorCode ?? nc.terminalReason ?? "unknown" : "—";
            return (
              `| ${index + 1} | ${exchange.chunkCount ?? 0} | ${exchange.charCount ?? 0} | ${exchange.endedBy ?? "unknown"} | ` +
              `${ncCell} |`
            );
          })
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

  // Plan 05-24 (Task 2, G-05-3), generalised by plan 05-34 (G-05-6): rendered immediately ABOVE
  // the verdict section — the same place a reader looks for the verdict — naming the failure
  // class, WHICH SOURCE fired ({@link NON_CONVERSATION_SOURCES}), the classifier/error code, the
  // request id, and stating plainly that the run did not complete. The heading names the CLASS
  // (a non-conversation backend message) rather than one member of it (a text-banner "refusal") —
  // the old heading survived plan 05-24 bound to exactly the mechanism this plan generalises past.
  // Omitted entirely (not even an empty heading) when `nonConversation` is absent, so an ordinary
  // sheet stays BYTE-IDENTICAL to what this function rendered before this field existed — that is
  // what keeps the pre-existing determinism check meaningful. Deliberately does NOT replace the
  // verdict lines the way a synthetic sheet does: the turns captured before the non-conversation
  // turn are real model turns a human may legitimately judge, so this section exists only to make
  // sure nobody mistakes the run as complete — a future author must not "tidy" this into a
  // replacement of the verdict section.
  const nonConversationSection = nonConversation
    ? `## Non-conversation turn\n\n` +
      `This run stopped on a non-conversation backend message (\`${nonConversation.kind ?? BACKEND_REFUSAL_KIND}\`), ` +
      `not a model turn — detected via \`${nonConversation.source ?? "unknown"}\`, classifier/code ` +
      `\`${nonConversation.classifier ?? nonConversation.errorCode ?? nonConversation.terminalReason ?? "unknown"}\`, ` +
      `request id \`${nonConversation.requestId ?? "none"}\`. The conversation did not complete. The ` +
      "turns captured above, before this message, are real model turns and may be judged on their " +
      "own merits — but no verdict below should be read as covering a finished conversation.\n\n"
    : "";

  // Plan 05-33 (Task 3): rendered ABOVE the verdict section, mirroring the refusal section's own
  // placement — the direct countermeasure to validation ledger row `05-22-03`, whose credential
  // path is unrecoverable after the fact. Omitted entirely (not even an empty heading) when
  // `credentialPath` is absent or null, so an unaugmented sheet stays BYTE-IDENTICAL to what this
  // function rendered before this field existed.
  const credentialPathSection = credentialPath
    ? `## Credential path\n\n` +
      `- Authentication method: ${credentialPath.authMethod}\n` +
      `- Logged in: ${credentialPath.loggedIn}\n` +
      `- Configuration directory: ${credentialPath.configDirectory}\n` +
      `- No API-key environment variable was present in the spawned environment ` +
      `(${credentialPath.scrubbedCount ?? 0} removed before spawn).\n\n`
    : "";

  // Plan 05-36 (gap G-05-7): rendered immediately AFTER the drafted-criteria section and BEFORE
  // the non-conversation section — a thrown exception ends the run in EITHER a conversational
  // state (nonConversation may also be set) or a genuinely unexpected one (a deadline, a bridge
  // error), and this section is the one place either shows up. Only the class name, message and
  // FIRST stack frame are rendered — never the whole stack, which would put absolute developer
  // paths into a committed repository file. Omitted entirely (not even an empty heading) when
  // `failure` is absent or null, so an unaugmented sheet stays BYTE-IDENTICAL to what this
  // function rendered before this field existed — the same discipline every other optional
  // section here already follows.
  const failureFirstFrame =
    failure && typeof failure.stack === "string" ? failure.stack.split("\n")[1]?.trim() : undefined;
  const failureSection = failure
    ? `## Run failure\n\n` +
      `This run did not complete. \`${failure.name ?? failure.constructor?.name ?? "Error"}\`: ` +
      `${failure.message ?? String(failure)}\n\n` +
      (failureFirstFrame ? `\`\`\`\n${failureFirstFrame}\n\`\`\`\n\n` : "")
    : "";

  return `# Phase 5 — Socratic Epic Authoring — Live Challenge Transcript
${syntheticMarkerLine}

**Run:** ${runId}
**Captured:** ${timestamp}
**Answer source:** ${answerSource}

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
- Criteria reachability: ${criteriaReachabilityReading} (criteria-stage proposal drain stoppedBy: ${criteriaDrainStoppedBy ?? "n/a"})
- proposal_list-in-staging-turn verdict: ${proposalListVerdict}
- Amended criteria: ${amended}
- Ratio (amended/drafted): ${amended}/${drafted}

${failureSection}${nonConversationSection}${credentialPathSection}${verdictsSection}`;
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
  // Plan 05-49: `check` is now async-tolerant — `fn()` may return a plain value (every pre-existing
  // check in this file) OR a Promise (the new handler-driving checks Task 1/Task 2 need, since
  // `createProposalStagedHandler` and `stageAuthoringProposal` are both genuinely async). A
  // synchronous `fn` runs to completion with no `await` ever reached, so every existing call site
  // (none of which is itself awaited) keeps its EXACT prior ordering and behaviour; only a caller
  // that explicitly writes `await check(...)` for an async `fn` gets the new awaited behaviour.
  const check = async (label, fn) => {
    try {
      const result = fn();
      if (result && typeof result.then === "function") await result;
      console.log(`[self-test] PASS — ${label}`);
    } catch (err) {
      failures += 1;
      console.error(`[self-test] FAIL — ${label}: ${err?.message ?? err}`);
    }
  };

  // -----------------------------------------------------------------------------------------
  // Plan 05-49 (G-05-10): a tiny, self-test-only stand-in for the `uat_authoring_ops` bridge
  // binary. `createProposalStagedHandler` calls the module-level `runOps` (a real `spawnSync`)
  // directly, exactly like `createBoardReadHandler` beside it — so exercising it here against a
  // REAL executable, rather than mocking `runOps` itself, proves the handler's own argv/stdin/
  // stdout contract with the bridge, not a stand-in for that contract. Writes a shebang script
  // (never invoked outside this process) that reads all of stdin (mirroring the real bridge's own
  // `read_to_string`) and echoes one fixed line of JSON, matching `runOps`'s own
  // "trim, then JSON.parse if non-empty" reading exactly.
  // -----------------------------------------------------------------------------------------
  function writeStubOpsBin(dir, stdoutJson) {
    const scriptPath = path.join(dir, `stub-ops-bin-${Math.random().toString(36).slice(2)}.mjs`);
    const body =
      "#!/usr/bin/env node\n" +
      "let chunks = [];\n" +
      "process.stdin.on('data', (c) => chunks.push(c));\n" +
      "process.stdin.on('end', () => {\n" +
      `  process.stdout.write(${JSON.stringify(JSON.stringify(stdoutJson))});\n` +
      "  process.exit(0);\n" +
      "});\n";
    fs.writeFileSync(scriptPath, body, { mode: 0o755 });
    return scriptPath;
  }

  // -----------------------------------------------------------------------------------------
  // Task 1 (G-05-10 missing[1]/[2]): createProposalStagedHandler — the held staging-answer
  // handler that applies a proposal_created event DURING the agent's own turn.
  // -----------------------------------------------------------------------------------------
  await check(
    "createProposalStagedHandler relays the bridge's proposalId into the authoring_proposal_answer op",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat08-selftest-staged-"));
      try {
        const opsBin = writeStubOpsBin(tmpDir, { outcome: "created", proposalId: "01SELFTESTCREATEDPROPOSAL1" });
        const requests = [];
        const stubSidecar = {
          request: async (payload) => {
            requests.push(payload);
            return {};
          },
        };
        const handler = createProposalStagedHandler({
          opsBin,
          appDataDir: tmpDir,
          sidecar: stubSidecar,
          runId: "run-self-test-staged-1",
        });
        const event = {
          type: "proposal_created",
          runId: "run-self-test-staged-1",
          requestId: "req-self-test-staged-1",
          verb: "create",
          targetType: "epic",
          payload: { title: "t", description: "d" },
        };
        const handled = await handler(event);
        assert.equal(handled, true, "expected the handler to report it handled the event");
        assert.equal(requests.length, 1, "expected exactly one relayed answer");
        assert.equal(requests[0].op, PROPOSAL_STAGED_RELAY_OP);
        assert.equal(requests[0].runId, "run-self-test-staged-1");
        assert.equal(requests[0].requestId, "req-self-test-staged-1");
        assert.deepEqual(requests[0].result, { proposalId: "01SELFTESTCREATEDPROPOSAL1" });
        assert.equal(requests[0].error, undefined, "a created outcome must never also carry an error");
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  await check(
    "a proposal_created event is applied exactly once when both the held handler and the sweep see it",
    async () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "uat08-selftest-dedupe-"));
      try {
        const opsBin = writeStubOpsBin(tmpDir, { outcome: "created", proposalId: "01SELFTESTDEDUPEPROPOSAL1" });
        const stubSidecar = { request: async () => ({}) };
        const requestId = `req-self-test-dedupe-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const event = {
          type: "proposal_created",
          runId: "run-self-test-dedupe-1",
          requestId,
          verb: "create",
          targetType: "epic",
          payload: { title: "t", description: "d" },
        };

        const handler = createProposalStagedHandler({
          opsBin,
          appDataDir: tmpDir,
          sidecar: stubSidecar,
          runId: "run-self-test-dedupe-1",
        });
        await handler(event);

        // The sweep now observes the SAME event, in a stub sidecar's own `events` array — exactly
        // the shape drainProposalsUntilQuiet scans in production.
        let sweepAppliedCount = 0;
        const stubSidecarForSweep = { events: [event] };
        const result = await drainProposalsUntilQuiet(stubSidecarForSweep, {
          applyEvent: () => {
            sweepAppliedCount += 1;
          },
          quietMs: 20,
          deadlineMs: 200,
          label: "self-test dedupe sweep",
        });
        assert.equal(
          sweepAppliedCount,
          0,
          "expected the sweep to skip an event the held handler already applied",
        );
        assert.equal(result.applied, 0);
        assert.ok(result.nextIndex >= 1);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    },
  );

  // -----------------------------------------------------------------------------------------
  // Task 2 (G-05-10): the fixture's own staged tool-result body must match the shape the real
  // MCP server produces — the structural guard against the exact divergence this plan closes.
  // -----------------------------------------------------------------------------------------
  await check(
    "the fixture's staged tool-result body matches the shape the real MCP server produces",
    async () => {
      const distPath = path.join(REPO_ROOT, "packages", "sidecar", "dist", "mcp-permission-server.js");
      if (!fs.existsSync(distPath)) {
        console.log(
          `[self-test] SKIP — the fixture's staged tool-result body matches the shape the real MCP ` +
            `server produces: ${distPath} is not built — run \`npm --prefix packages/sidecar run build\``,
        );
        return;
      }
      const { startPermissionServer, stageAuthoringProposal, buildProposeEpicPayload } = await import(
        pathToFileURL(distPath).href
      );
      const REAL_PROPOSAL_ID = "01SELFTESTREALSERVERIDAA1";
      let handle;
      try {
        handle = startPermissionServer(
          () => {},
          () => {},
          () => {},
          (payload) => {
            handle.answerProposalStaged(payload.requestId, { proposalId: REAL_PROPOSAL_ID });
          },
        );
        await new Promise((resolve, reject) => {
          const deadline = Date.now() + 2000;
          const attempt = () => {
            const client = net.createConnection(handle.socketPath);
            client.once("connect", () => {
              client.end();
              resolve();
            });
            client.once("error", () => {
              if (Date.now() > deadline) {
                reject(new Error(`timed out waiting for the permission socket to listen: ${handle.socketPath}`));
                return;
              }
              setTimeout(attempt, 10);
            });
          };
          attempt();
        });

        const result = await stageAuthoringProposal(
          handle.socketPath,
          buildProposeEpicPayload({ title: "t", description: "d" }),
        );
        const realBody = JSON.parse(result.content[0].text);
        const fixtureBody = JSON.parse(stagedToolResultText(REAL_PROPOSAL_ID));
        assert.deepEqual(
          Object.keys(realBody).sort(),
          Object.keys(fixtureBody).sort(),
          "expected the fixture's own staged tool-result body to declare the SAME keys the real " +
            "MCP server's stageAuthoringProposal resolves with",
        );
        assert.deepEqual(realBody, fixtureBody);
      } finally {
        handle?.close();
      }
    },
  );

  // -----------------------------------------------------------------------------------------
  // Task 3 (G-05-10 missing[3]): assertProposalListNonEmptyInTurn — pure, synthetic, no live run.
  // -----------------------------------------------------------------------------------------
  check("an empty proposal_list inside a staging turn fails the live assertion", () => {
    const turn = [
      { type: "tool_call", toolName: "mcp__flywheel-permissions__propose_criterion", toolUseId: "t1" },
      {
        type: "tool_result",
        toolUseId: "t1",
        output: JSON.stringify({ staged: true, proposalId: "01SYNTHETICCRITERIONID001" }),
      },
      { type: "tool_call", toolName: "mcp__flywheel-permissions__proposal_list", toolUseId: "t2" },
      { type: "tool_result", toolUseId: "t2", output: JSON.stringify({ proposals: [], truncated: false }) },
    ];
    assert.equal(assertProposalListNonEmptyInTurn(turn), "violated");
  });

  check("a proposal_list with rows after a staging call satisfies the assertion", () => {
    const turn = [
      { type: "tool_call", toolName: "mcp__flywheel-permissions__propose_epic", toolUseId: "t1" },
      {
        type: "tool_result",
        toolUseId: "t1",
        output: JSON.stringify({ staged: true, proposalId: "01SYNTHETICEPICID00000001" }),
      },
      { type: "tool_call", toolName: "mcp__flywheel-permissions__proposal_list", toolUseId: "t2" },
      {
        type: "tool_result",
        toolUseId: "t2",
        output: JSON.stringify({ proposals: [{ id: "01SYNTHETICEPICID00000001" }], truncated: false }),
      },
    ];
    assert.equal(assertProposalListNonEmptyInTurn(turn), "satisfied");
  });

  check("a turn with no staging call is not-applicable", () => {
    const turnWithNoToolCallsAtAll = [{ type: "tool_call", toolName: "Bash", toolUseId: "t1" }];
    assert.equal(assertProposalListNonEmptyInTurn(turnWithNoToolCallsAtAll), "not-applicable");

    // A staging call with no LATER proposal_list call is equally not-applicable — the turn does
    // not exercise the property either way.
    const stagedButNoListCall = [
      { type: "tool_call", toolName: "mcp__flywheel-permissions__propose_epic", toolUseId: "t1" },
      {
        type: "tool_result",
        toolUseId: "t1",
        output: JSON.stringify({ staged: true, proposalId: "01SYNTHETICEPICID00000002" }),
      },
    ];
    assert.equal(assertProposalListNonEmptyInTurn(stagedButNoListCall), "not-applicable");
  });

  check(
    "an unrecognised proposal_list verdict is fail-closed — only satisfied/not-applicable pass",
    () => {
      // A proposal_list call whose result cannot be parsed into a proposals array (a malformed
      // body, or no correlation id at all) reads "unknown" — never silently treated as a pass.
      const turnWithUnparsableListResult = [
        { type: "tool_call", toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "t1" },
        {
          type: "tool_result",
          toolUseId: "t1",
          output: JSON.stringify({ staged: true, proposalId: "01SYNTHETICTASKID000000001" }),
        },
        { type: "tool_call", toolName: "mcp__flywheel-permissions__proposal_list", toolUseId: "t2" },
        { type: "tool_result", toolUseId: "t2", output: JSON.stringify({ notProposals: [] }) },
      ];
      const unknownVerdict = assertProposalListNonEmptyInTurn(turnWithUnparsableListResult);
      assert.equal(unknownVerdict, "unknown");
      assert.ok(
        !PASSING_PROPOSAL_LIST_VERDICTS.has(unknownVerdict),
        "expected the fail-closed allow-list to NOT pass an unrecognised/unknown verdict",
      );
      assert.ok(
        !PASSING_PROPOSAL_LIST_VERDICTS.has("violated"),
        "expected the fail-closed allow-list to NOT pass a violated verdict",
      );
      assert.ok(
        !PASSING_PROPOSAL_LIST_VERDICTS.has("some-future-unanticipated-verdict"),
        "expected the fail-closed allow-list to NOT pass a verdict string it has never seen before",
      );
      assert.ok(PASSING_PROPOSAL_LIST_VERDICTS.has("satisfied"));
      assert.ok(PASSING_PROPOSAL_LIST_VERDICTS.has("not-applicable"));
    },
  );

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

  check("a sheet rendered WITHOUT a non-conversation turn contains no Non-conversation turn section, and stays byte-identical to a sheet with no nonConversation field at all (plan 05-24, generalised by 05-34)", () => {
    const withoutField = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const withExplicitNull = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, nonConversation: null });
    assert.ok(!withoutField.includes("## Non-conversation turn"), "expected no non-conversation heading when nonConversation is absent");
    assert.equal(withoutField, withExplicitNull, "expected an explicit null nonConversation to render byte-identically to an absent one");
  });

  check("a sheet rendered WITH a non-conversation turn contains the Non-conversation turn section, positioned above the verdict section, naming the class/classifier/request id (plan 05-24, generalised by 05-34)", () => {
    const nonConversationObject = { kind: BACKEND_REFUSAL_KIND, source: NON_CONVERSATION_SOURCES.TEXT_BANNER, classifier: "reasoning_extraction", requestId: "req_011CfMyQ7EQg8jnFnSugjHVw", text: LIVE_REFUSAL_TEXT };
    const sheet = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, nonConversation: nonConversationObject });
    assert.ok(sheet.includes("## Non-conversation turn"), "expected a Non-conversation turn heading when nonConversation is present");
    assert.ok(sheet.includes(BACKEND_REFUSAL_KIND), "expected the failure class named in the section");
    assert.ok(sheet.includes("reasoning_extraction"), "expected the classifier code named in the section");
    assert.ok(sheet.includes("req_011CfMyQ7EQg8jnFnSugjHVw"), "expected the request id named in the section");
    assert.ok(sheet.includes(NON_CONVERSATION_SOURCES.TEXT_BANNER), "expected the firing source named in the section");
    const nonConversationHeadingIndex = sheet.indexOf("## Non-conversation turn");
    const verdictHeadingIndex = sheet.indexOf("## Verdicts");
    assert.ok(nonConversationHeadingIndex >= 0 && verdictHeadingIndex >= 0, "expected both headings to be present");
    assert.ok(nonConversationHeadingIndex < verdictHeadingIndex, "expected the Non-conversation turn section ABOVE the Verdicts section");
  });

  check("the synthetic-shaped sheet carries zero unfilled-verdict tokens and names its scenario in its first two lines", () => {
    const sheet = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, synthetic: true, scenario: "truncation-repro" });
    const occurrences = sheet.split(UNJUDGED_TOKEN).length - 1;
    assert.equal(occurrences, 0);
    const firstTwoLines = sheet.split("\n").slice(0, 2).join("\n");
    assert.ok(firstTwoLines.includes("SYNTHETIC"), "expected a synthetic marker in the first two lines");
    assert.ok(firstTwoLines.includes("truncation-repro"), "expected the scenario name in the first two lines");
  });

  // ---------------------------------------------------------------------------------------------
  // renderQuestionsAsked / the Questions section (plan 05-42, gap G-05-8(a))
  // ---------------------------------------------------------------------------------------------

  check("renderQuestionsAsked returns the empty string for undefined, a non-array, or an empty array", () => {
    assert.equal(renderQuestionsAsked(undefined), "");
    assert.equal(renderQuestionsAsked("x"), "");
    assert.equal(renderQuestionsAsked([]), "");
  });

  check(
    "an agent exchange with no questions key renders byte-identically to one whose questions is an empty array, with no Questions section either way",
    () => {
      const withoutField = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
      const withEmptyArray = renderChallengeEvidenceSheet({
        ...SYNTHETIC_EVIDENCE,
        exchanges: SYNTHETIC_EVIDENCE.exchanges.map((exchange) =>
          exchange.speaker === "agent" ? { ...exchange, questions: [] } : exchange,
        ),
      });
      assert.equal(withoutField, withEmptyArray);
      assert.ok(!withoutField.includes("Questions asked"), "expected no Questions section when no exchange carries questions");
    },
  );

  check(
    "each question renders its header, question text, and its option labels (with descriptions) as nested entries in emitted order, marking multiSelect true distinctly from false/absent",
    () => {
      const rendered = renderQuestionsAsked(ASK_USER_QUESTION_PROMPTS);
      const triggersIndex = rendered.indexOf("Triggers");
      const channelsIndex = rendered.indexOf("Channels");
      const timingIndex = rendered.indexOf("Timing");
      assert.ok(triggersIndex >= 0 && channelsIndex >= 0 && timingIndex >= 0, "expected all three headers");
      assert.ok(triggersIndex < channelsIndex && channelsIndex < timingIndex, "expected headers in emitted order");

      for (const prompt of ASK_USER_QUESTION_PROMPTS) {
        assert.ok(rendered.includes(prompt.question), `expected question text verbatim: ${JSON.stringify(prompt.question)}`);
        for (const option of prompt.options) {
          assert.ok(rendered.includes(option.label), `expected option label verbatim: ${JSON.stringify(option.label)}`);
        }
      }

      const multiSelectMarker = "accepts multiple answers";
      const triggersBlock = rendered.slice(triggersIndex, channelsIndex);
      const channelsBlock = rendered.slice(channelsIndex, timingIndex);
      const timingBlock = rendered.slice(timingIndex);
      assert.ok(triggersBlock.includes(multiSelectMarker), "expected the Triggers prompt (multiSelect true) to be marked");
      assert.ok(channelsBlock.includes(multiSelectMarker), "expected the Channels prompt (multiSelect true) to be marked");
      assert.ok(!timingBlock.includes(multiSelectMarker), "expected the Timing prompt (multiSelect false) NOT to be marked");
    },
  );

  check("two questions with identical text render as two entries, never merged into one", () => {
    const duplicateQuestions = [
      { question: "Same question text?", header: "A", options: [{ label: "Yes" }] },
      { question: "Same question text?", header: "B", options: [{ label: "No" }] },
    ];
    const rendered = renderQuestionsAsked(duplicateQuestions);
    const occurrences = rendered.split("Same question text?").length - 1;
    assert.equal(occurrences, 2, "expected two rendered question entries, never merged into one");
  });

  {
    // Built from SYNTHETIC_EVIDENCE's OWN exchanges (spread, never a fresh `speaker: "agent"`
    // literal) — SYNTHETIC_EVIDENCE.exchanges[1] is already its first agent turn ("### 2. Agent"),
    // so attaching `questions` there keeps this file's non-comment `speaker: "agent"` construction
    // count exactly at the four Task 1 named as legitimate (its own doc comment, its own
    // acceptance criteria): the renderer's SYNTHETIC_EVIDENCE fixture (x2), the frozen pre-fix
    // negative control (x1), and buildAgentExchange itself (x1).
    const QUESTIONS_EVIDENCE = {
      ...SYNTHETIC_EVIDENCE,
      exchanges: SYNTHETIC_EVIDENCE.exchanges.map((exchange, index) =>
        index === 1 ? { ...exchange, questions: ASK_USER_QUESTION_PROMPTS } : exchange,
      ),
    };

    check(
      "the Questions section for an agent exchange renders inside that exchange's own block: after its fenced text, before the next exchange's heading, carrying every question text and every one of the eleven option labels",
      () => {
        const sheet = renderChallengeEvidenceSheet(QUESTIONS_EVIDENCE);
        assert.ok(sheet.includes("Questions asked"), "expected a Questions section heading");
        const turnHeadingIndex = sheet.indexOf("### 2. Agent");
        const questionsIndex = sheet.indexOf("Questions asked");
        const nextHeadingIndex = sheet.indexOf("### 3. Developer");
        assert.ok(turnHeadingIndex >= 0 && questionsIndex >= 0 && nextHeadingIndex >= 0, "expected all three markers present");
        assert.ok(
          turnHeadingIndex < questionsIndex && questionsIndex < nextHeadingIndex,
          "expected the Questions section between its own turn's heading and the next exchange's heading",
        );
        let totalOptions = 0;
        for (const prompt of ASK_USER_QUESTION_PROMPTS) {
          assert.ok(sheet.includes(prompt.question), `expected the sheet to include the question text verbatim: ${JSON.stringify(prompt.question)}`);
          for (const option of prompt.options) {
            totalOptions += 1;
            assert.ok(sheet.includes(option.label), `expected the sheet to include the option label verbatim: ${JSON.stringify(option.label)}`);
          }
        }
        assert.equal(totalOptions, 11, "expected the frozen capture to carry eleven option labels total");
      },
    );

    check("rendering the same questions-carrying evidence object twice produces byte-identical output", () => {
      const first = renderChallengeEvidenceSheet(QUESTIONS_EVIDENCE);
      const second = renderChallengeEvidenceSheet(QUESTIONS_EVIDENCE);
      assert.equal(first, second);
    });

    check(
      "a synthetic sheet whose agent exchange carries questions still carries the synthetic marker in its first two lines and the unfilled-verdict token zero times",
      () => {
        const sheet = renderChallengeEvidenceSheet({ ...QUESTIONS_EVIDENCE, synthetic: true, scenario: "ask-user-question" });
        const occurrences = sheet.split(UNJUDGED_TOKEN).length - 1;
        assert.equal(occurrences, 0);
        const firstTwoLines = sheet.split("\n").slice(0, 2).join("\n");
        assert.ok(firstTwoLines.includes("SYNTHETIC"));
        assert.ok(firstTwoLines.includes("ask-user-question"));
      },
    );
  }

  check("the capture-integrity table has exactly one row per agent exchange, each carrying a Non-conversation column (plan 05-24, generalised by 05-34)", () => {
    const sheet = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
    const agentExchangeCount = SYNTHETIC_EVIDENCE.exchanges.filter((exchange) => exchange.speaker === "agent").length;
    const tableRows = sheet.match(/^\| \d+ \|.*\|$/gm) ?? [];
    assert.equal(tableRows.length, agentExchangeCount);
    for (const row of tableRows) {
      // 5 columns (Agent turn, Chunk count, Character count, End marker, Non-conversation) => 6
      // pipe-split segments including the leading/trailing empties either side of the row's `|`.
      const cellCount = row.split("|").length - 2;
      assert.equal(cellCount, 5, `expected 5 columns (turn, chunks, chars, end marker, non-conversation): ${row}`);
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
      nonConversation: null,
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

  // -----------------------------------------------------------------------------------------
  // Gap G-05-6 closure (plan 05-34): classifyNonConversationTurn — the wire-fact classifier that
  // REPLACES prefix-bound text matching as the primary mechanism. The retained text-banner reader
  // (readBackendRefusal, checked above) stays the fallback for the one shape this repository has
  // no raw stream capture for.
  // -----------------------------------------------------------------------------------------

  check("[Plan 05-34, Task 2] a turn whose window carries an assistant envelope's wire error flag classifies as non-conversation, naming the assistant envelope as source, whatever its text says", () => {
    const events = [{ type: "assistant_text", text: "an ordinary-looking reply", isApiErrorMessage: true, errorCode: "authentication_failed" }];
    const result = classifyNonConversationTurn({ text: "an ordinary-looking reply", events });
    assert.ok(result !== null, "expected the wire's own assistant-envelope flag to classify the turn");
    assert.equal(result.source, NON_CONVERSATION_SOURCES.ASSISTANT_ERROR_FLAG);
    assert.equal(result.errorCode, "authentication_failed");
  });

  check("[Plan 05-34, Task 2] a turn whose terminating result event carries the wire's error flag true classifies as non-conversation, naming the result line as source", () => {
    const events = [{ type: "result", isError: true, terminalReason: "api_error" }];
    const result = classifyNonConversationTurn({ text: "ordinary text with no banner", events });
    assert.ok(result !== null, "expected the wire's own result-line flag to classify the turn");
    assert.equal(result.source, NON_CONVERSATION_SOURCES.RESULT_ERROR_FLAG);
    assert.equal(result.terminalReason, "api_error");
  });

  check("[Plan 05-34, Task 2] a turn whose text opens with the safety-classifier banner but whose events carry no wire flag is STILL classified, naming the text banner as source — the retained reader's reach is unchanged", () => {
    const result = classifyNonConversationTurn({ text: LIVE_REFUSAL_TEXT, events: [{ type: "assistant_text", text: LIVE_REFUSAL_TEXT }] });
    assert.ok(result !== null, "expected the retained text-banner reader to still classify this shape");
    assert.equal(result.source, NON_CONVERSATION_SOURCES.TEXT_BANNER);
    assert.equal(result.classifier, "reasoning_extraction");
  });

  check("[Plan 05-34, Task 2] an ordinary turn — no wire flag, no banner — classifies as null, including for empty and whitespace-only text", () => {
    assert.equal(classifyNonConversationTurn({ text: "an ordinary reply", events: [{ type: "assistant_text", text: "an ordinary reply" }] }), null);
    assert.equal(classifyNonConversationTurn({ text: "", events: [] }), null);
    assert.equal(classifyNonConversationTurn({ text: "   \n  \t ", events: [] }), null);
  });

  check("[Plan 05-34, Task 2] the real captured login-notice text, read from the frozen fixture, classifies as null through the text-banner reader alone — the direct proof the superseded mechanism could not have caught this message", () => {
    const loginNoticeText = UNAUTHENTICATED_FIXTURE.lines.find((line) => line.type === "assistant")?.message?.content?.find((block) => block.type === "text")?.text;
    assert.ok(typeof loginNoticeText === "string" && loginNoticeText.length > 0, "expected to find the login-notice text in the frozen fixture");
    assert.equal(readBackendRefusal(loginNoticeText), null, "expected the text-banner reader alone to return null for the real captured login-notice text");
  });

  check("[Plan 05-34, Task 2] a classification carries the error code when the wire supplied one, and the classifier/request id when the text banner supplied them; absent fields read as absent, never as an empty string", () => {
    const wireResult = classifyNonConversationTurn({
      text: "prose",
      events: [{ type: "assistant_text", text: "prose", isApiErrorMessage: true, errorCode: "authentication_failed" }],
    });
    assert.equal(wireResult.errorCode, "authentication_failed");
    assert.ok(!Object.prototype.hasOwnProperty.call(wireResult, "classifier"), "expected no classifier key on a wire-sourced classification");
    assert.ok(!Object.prototype.hasOwnProperty.call(wireResult, "requestId"), "expected no requestId key on a wire-sourced classification");

    const bannerResult = classifyNonConversationTurn({ text: LIVE_REFUSAL_TEXT, events: [] });
    assert.equal(bannerResult.classifier, "reasoning_extraction");
    assert.equal(bannerResult.requestId, "req_011CfMyQ7EQg8jnFnSugjHVw");
    assert.ok(!Object.prototype.hasOwnProperty.call(bannerResult, "errorCode"), "expected no errorCode key on a banner-sourced classification");
  });

  check("[Plan 05-34, Task 2] a result event carrying the error flag literally false does not classify a turn as non-conversation", () => {
    const events = [{ type: "result", isError: false }];
    assert.equal(classifyNonConversationTurn({ text: "an ordinary reply", events }), null);
  });

  check("accumulateTurn's nonConversation member is exactly null (never undefined) on a turn that is not non-conversation (plan 05-24, generalised by 05-34)", () => {
    const result = accumulateTurn(
      [{ runId: "r1", type: "assistant_text", text: "an ordinary reply" }, { runId: "r1", type: "result" }],
      "r1",
      0,
    );
    assert.equal(result.nonConversation, null);
  });

  check("accumulateTurn attaches the nonConversation reading on the result-terminated return path (plan 05-24, generalised by 05-34)", () => {
    const result = accumulateTurn(
      [{ runId: "r1", type: "assistant_text", text: LIVE_REFUSAL_TEXT }, { runId: "r1", type: "result" }],
      "r1",
      0,
    );
    assert.ok(result.nonConversation !== null);
    assert.equal(result.nonConversation.classifier, "reasoning_extraction");
    assert.equal(result.nonConversation.source, NON_CONVERSATION_SOURCES.TEXT_BANNER);
  });

  {
    // driveChallengeConversation stops at a non-conversation turn: reports it, settles false, and
    // sends no further developer turn — asserted against a stub sidecar, no real process, no
    // timers left running.
    const refusalTurns = [
      { text: "What should trigger a notification in the first place?", chunkCount: 1, charCount: 55, endedBy: "result", endIndex: 3, nonConversation: null },
      { text: LIVE_REFUSAL_TEXT, chunkCount: 1, charCount: LIVE_REFUSAL_TEXT.length, endedBy: "result", endIndex: 7, nonConversation: classifyNonConversationTurn({ text: LIVE_REFUSAL_TEXT, events: [] }) },
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

    check("driveChallengeConversation stops at a non-conversation turn, reporting it and settling false", () => {
      assert.ok(refusalResult.nonConversation !== null, "expected the driver to report the non-conversation classification");
      assert.equal(refusalResult.nonConversation.classifier, "reasoning_extraction");
      assert.equal(refusalResult.settled, false);
    });
    check("driveChallengeConversation sends exactly one developer turn before a non-conversation turn stops it", () => {
      assert.equal(refusalSendCalls.length, 1, "expected the driver to have answered turn 1's question once, then stopped");
    });
    check("driveChallengeConversation preserves the non-conversation turn verbatim in its own exchanges, rather than discarding it", () => {
      const refusedExchange = refusalResult.exchanges.find((exchange) => exchange.speaker === "agent" && exchange.nonConversation);
      assert.ok(refusedExchange, "expected the non-conversation agent exchange to be present in the exchange list");
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
    "buildAgentExchange on a turn with no AskUserQuestion returns an object carrying no questions key at all (key-presence, never truthiness)",
    () => {
      const plainTurn = { text: "ordinary reply", chunkCount: 1, charCount: 14, endedBy: "result", endIndex: 5, toolCalls: [] };
      const exchange = buildAgentExchange(plainTurn);
      assert.equal(exchange.speaker, "agent");
      assert.equal(exchange.text, plainTurn.text);
      assert.equal(exchange.nonConversation, null);
      assert.equal(Object.hasOwn(exchange, "questions"), false, "expected no questions key on a turn with no AskUserQuestion");

      const askTurn = {
        text: "a follow-up",
        chunkCount: 1,
        charCount: 11,
        endedBy: "result",
        endIndex: 9,
        toolCalls: [{ toolName: "AskUserQuestion", questions: [{ question: "Which?", options: [{ label: "A" }] }] }],
      };
      const askExchange = buildAgentExchange(askTurn);
      assert.equal(Object.hasOwn(askExchange, "questions"), true, "expected a questions key when the turn carried AskUserQuestion prompts");
      assert.equal(askExchange.questions.length, 1);

      const overridden = buildAgentExchange(plainTurn, { endedBy: "timeout" });
      assert.equal(overridden.endedBy, "timeout", "expected overrides to take precedence without reconstructing the rest");
      assert.equal(overridden.text, plainTurn.text);
    },
  );

  check(
    "questionsFromTurn returns [] for a turn with no toolCalls, a turn whose tool calls are other tools, and an AskUserQuestion call with no parsed questions",
    () => {
      assert.deepEqual(questionsFromTurn({ text: "x" }), []);
      assert.deepEqual(questionsFromTurn({ text: "x", toolCalls: [{ toolName: "Bash" }] }), []);
      assert.deepEqual(
        questionsFromTurn({ text: "x", toolCalls: [{ toolName: "AskUserQuestion", questions: [] }] }),
        [],
      );
      assert.deepEqual(
        questionsFromTurn({ text: "x", toolCalls: [{ toolName: "AskUserQuestion" }] }),
        [],
      );
      const found = questionsFromTurn({
        text: "x",
        toolCalls: [{ toolName: "AskUserQuestion", questions: [{ question: "Which?", options: [] }] }],
      });
      assert.equal(found.length, 1);
      assert.equal(found[0].question, "Which?");
    },
  );

  check(
    "no answer-bank entry, the fallback, the closing turn, or the option-selection prefix coaches the model to challenge, push back, ask clarifying questions, or names the Socratic method",
    () => {
      const forbidden = /challenge|push[\s-]?back|clarify|clarifying|socratic/i;
      for (const entry of ANSWER_BANK) {
        assert.ok(!forbidden.test(entry.answer), `answer-bank entry coaches conversational behaviour: ${JSON.stringify(entry.answer)}`);
      }
      assert.ok(!forbidden.test(ANSWER_BANK_FALLBACK), "the fallback answer coaches conversational behaviour");
      assert.ok(!forbidden.test(CLOSING_TURN), "the closing turn coaches conversational behaviour");
      assert.ok(!forbidden.test(OPTION_SELECTION_PREFIX), "the option-selection prefix coaches conversational behaviour");
    },
  );

  check(
    "extractOpenQuestions recovers every interrogative fragment from a multi-block turn's prose, in order, capped, each carrying empty options",
    () => {
      const text =
        "Three things would materially change what gets built:\n" +
        "1. Who can dismiss a notification once it fires?\n" +
        "2. Should a notification survive the app restarting?\n" +
        "3. When an agent finishes unattended, does that alone warrant a notification?";
      const questions = extractOpenQuestions({ text, toolCalls: [] });
      assert.equal(questions.length, 3);
      assert.ok(questions[0].text.startsWith("Who can dismiss"));
      assert.deepEqual(questions[0].options, []);
      assert.ok(questions[1].text.startsWith("Should a notification survive"));
      assert.ok(questions[2].text.startsWith("When an agent finishes"));

      const manyQuestionsText = Array.from({ length: MAX_EXTRACTED_QUESTIONS + 5 }, (_, i) => `Question ${i}?`).join(" ");
      assert.equal(extractOpenQuestions({ text: manyQuestionsText, toolCalls: [] }).length, MAX_EXTRACTED_QUESTIONS);

      assert.equal(extractOpenQuestions({ text: "This has no interrogative fragment at all.", toolCalls: [] }).length, 0);
    },
  );

  check(
    "extractOpenQuestions puts every typed tool-call question first, in order, then the prose fragments, capped in total — a turn's cap is never reached by prose alone once tool-call questions already fill it",
    () => {
      const mixedTurn = {
        text: "Here's a follow-up question in prose too?",
        toolCalls: [
          {
            toolName: "AskUserQuestion",
            questions: [
              { question: "Which trigger?", header: "Triggers", options: [{ label: "Assigned to me" }, { label: "Mentioned" }] },
              { question: "Which channel?", header: "Channels", options: [{ label: "In-app" }] },
            ],
          },
        ],
      };
      const questions = extractOpenQuestions(mixedTurn);
      assert.equal(questions.length, 3);
      assert.equal(questions[0].text, "Which trigger?");
      assert.deepEqual(questions[0].options, ["Assigned to me", "Mentioned"]);
      assert.equal(questions[1].text, "Which channel?");
      assert.deepEqual(questions[1].options, ["In-app"]);
      assert.ok(questions[2].text.startsWith("Here's a follow-up question in prose too?"));
      assert.deepEqual(questions[2].options, []);

      const manyToolCallQuestions = Array.from({ length: MAX_EXTRACTED_QUESTIONS + 2 }, (_, i) => ({
        question: `Tool-call question ${i}?`,
        options: [{ label: `Option ${i}` }],
      }));
      const overflowTurn = {
        text: "A trailing prose question that must never appear?",
        toolCalls: [{ toolName: "AskUserQuestion", questions: manyToolCallQuestions }],
      };
      const cappedQuestions = extractOpenQuestions(overflowTurn);
      assert.equal(cappedQuestions.length, MAX_EXTRACTED_QUESTIONS);
      assert.ok(
        cappedQuestions.every((q) => q.text.startsWith("Tool-call question")),
        "expected every capped entry to be a tool-call question — a trailing prose question must never appear once the cap is already reached by tool-call questions alone",
      );
    },
  );

  check(
    "[Plan 260929-nxq, Task 1a] extractOpenQuestions finds all five of a bolded, numbered turn's " +
      "questions — the fixture is the real shape from the transcript (`**1. Where does the board " +
      "app actually live?** This repo is empty.`), which today yields one",
    () => {
      const text =
        "That changes what I need from you. Five questions, each with the default I'd otherwise assume.\n\n" +
        "**1. Where does the board app actually live?** This repo is empty.\n" +
        "*Default: the app exists elsewhere.*\n\n" +
        "**2. Which channels?** In-app only is a feed plus unread badge.\n" +
        "*Default: in-app only for v1.*\n\n" +
        "**3. What actually pings someone?** The candidate list: assigned, mentioned, commented on.\n" +
        "*Default: assigned and mentioned only.*\n\n" +
        "**4. Real-time or not?** Live push versus polling on an interval.\n" +
        "*Default: poll every 30 seconds.*\n\n" +
        "**5. How much user control?** Mark read and mark all read is table stakes.\n" +
        "*Default: read state only.*";
      const questions = extractOpenQuestions({ text, toolCalls: [] });
      assert.equal(
        questions.length,
        5,
        `expected all five bolded questions, got ${questions.length}: ${JSON.stringify(questions.map((q) => q.text))}`,
      );
      assert.ok(questions[0].text.endsWith("Where does the board app actually live?"));
      assert.ok(questions[1].text.endsWith("Which channels?"));
      assert.ok(questions[2].text.endsWith("What actually pings someone?"));
      assert.ok(questions[3].text.endsWith("Real-time or not?"));
      assert.ok(questions[4].text.endsWith("How much user control?"));
    },
  );

  check(
    "[Plan 260929-nxq, Task 1b] extractOpenQuestions finds the imperative ask in a turn containing " +
      'no ? at all — the fixture is the verbatim "Tell me: attention router or activity log…" ' +
      "sentence",
    () => {
      const text =
        "Tell me: attention router or activity log — and if it's the router, whether a filtered " +
        "board view would do the job.";
      assert.ok(!text.includes("?"), "expected the fixture itself to contain no ? character, matching the real turn it is drawn from");
      const questions = extractOpenQuestions({ text, toolCalls: [] });
      assert.equal(questions.length, 1, `expected the imperative ask to be recognised as one open question, got ${questions.length}`);
      assert.ok(questions[0].text.startsWith("Tell me:"));
    },
  );

  check(
    "[Plan 260929-nxq, Task 1c] classifyWithheldConsent matches the verbatim withholding sentence " +
      "from run 01M3P4VZCA1M0C37C8V7ZE72WG and reads each of the transcript's own near-miss " +
      "negatives as clear, named individually",
    () => {
      const positive = classifyWithheldConsent(
        "**I don't think this is settled enough to advance.** Tell me: attention router or " +
          "activity log — and if it's the router, whether a filtered board view would do the job.",
      );
      assert.ok(positive, "expected the verbatim withholding sentence to be classified as withheld");
      assert.ok(/don.t think this is settled enough to advance/i.test(positive.sentence));

      const negativeOnlyYouCanAdvance = classifyWithheldConsent(
        "I can't stage anything yet, and only you can advance it.",
      );
      assert.equal(
        negativeOnlyYouCanAdvance,
        null,
        "the developer-gate description ('only you can advance it') must read clear, not withheld",
      );

      const negativeStageAdvancedOnYourSide = classifyWithheldConsent(
        "All eight staged. Proposals are landing now, so the stage has advanced on your side.",
      );
      assert.equal(
        negativeStageAdvancedOnYourSide,
        null,
        "the core's own stage-advance narration ('the stage has advanced on your side') must read clear, not withheld",
      );

      const negativeCriteriaInstruction = classifyWithheldConsent(
        "Before we move on: call propose_assumption once for EACH assumption you challenged in this stage.",
      );
      assert.equal(
        negativeCriteriaInstruction,
        null,
        "the core's own criteria instruction ('Before we move on…') must read clear, not withheld",
      );
    },
  );

  check("[Plan 260929-nxq, Task 1c] readAdvanceConsent reads undefined, null and an empty string as unreadable, never as clear", () => {
    assert.equal(readAdvanceConsent(undefined), "unreadable");
    assert.equal(readAdvanceConsent(null), "unreadable");
    assert.equal(readAdvanceConsent(""), "unreadable");
  });

  check(
    "every line of a composed reply to a no-options question, minus its fixed preamble and its ordinal prefix, is an exact member of the answer bank's value set",
    () => {
      const syntheticQuestions = [
        { text: "Who can dismiss a notification once it fires?", options: [] },
        { text: "Should a notification survive an app restart?", options: [] },
        { text: "When an agent finishes a run unattended, does that alone warrant a notification?", options: [] },
        { text: "This one matches nothing in the bank at all, so what happens?", options: [] },
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

  check(
    "composeDeveloperReply answers a question WITH options by selecting exactly one offered label, verbatim, prefixed by OPTION_SELECTION_PREFIX, and never quotes the question's own text",
    () => {
      const optionsQuestion = {
        text: "How should notifications reach the user in v1?",
        options: ["In-app inbox only", "Email", "Browser / mobile push", "Slack"],
      };
      const reply = composeDeveloperReply([optionsQuestion]);
      const lines = reply.split("\n");
      assert.equal(lines.length, 2);
      const answerLine = lines[1].replace(/^\d+\.\s/, "");
      assert.ok(
        answerLine.startsWith(OPTION_SELECTION_PREFIX),
        `expected the answer line to open with the fixed selection prefix: ${JSON.stringify(answerLine)}`,
      );
      const selectedLabel = answerLine.slice(OPTION_SELECTION_PREFIX.length);
      assert.ok(
        optionsQuestion.options.includes(selectedLabel),
        `expected the selected label to be an exact member of the offered options: ${JSON.stringify(selectedLabel)}`,
      );
      assert.ok(
        !answerLine.includes(optionsQuestion.text),
        `expected the composed reply to contain no substring of the question's own text: ${JSON.stringify(answerLine)}`,
      );
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

  {
    // Plan 260929-nxq (Task 1h): THE deflection-proof check, the one the rule turns on — driven
    // through the REAL driveChallengeConversation against a scripted stub whose every turn
    // withholds consent. No reply the driver itself composes can clear the flag.
    let withholdingCursorValue = 0;
    let withholdingTurnIndex = 0;
    const withholdingSendCalls = [];
    const WITHHOLDING_TEXT =
      "I'm not ready to advance on this yet — I don't think this is settled enough to advance.";
    const withholdingStub = {
      async waitForTurn() {
        withholdingTurnIndex += 1;
        withholdingCursorValue += 10;
        return {
          text: WITHHOLDING_TEXT,
          chunkCount: 1,
          charCount: WITHHOLDING_TEXT.length,
          endedBy: "result",
          endIndex: withholdingCursorValue,
        };
      },
      eventCursor() {
        return withholdingCursorValue;
      },
    };
    const withholdingResult = await driveChallengeConversation({
      sidecar: withholdingStub,
      runId: "stub-run-withholds-throughout",
      sendTurn: async (text) => {
        withholdingSendCalls.push(text);
      },
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 3,
    });

    check(
      "driveChallengeConversation never reports settled and never lets its own composed reply " +
        "clear a withheld consent — it drives to its cap, sends CLOSING_TURN exactly once, and " +
        "still reads the last (closing-reply) turn as withheld",
      () => {
        assert.equal(withholdingResult.settled, false);
        assert.equal(withholdingResult.closingTurnSent, true);
        assert.equal(withholdingSendCalls.length, 3, "expected two ordinary developer sends plus the one closing turn");
        assert.equal(withholdingSendCalls.filter((text) => text === CLOSING_TURN).length, 1);
        assert.equal(withholdingSendCalls[2], CLOSING_TURN);
        assert.ok(
          withholdingSendCalls.slice(0, 2).every((text) => text !== CLOSING_TURN),
          "expected the driver to keep sending its ordinary composed replies before it ever reaches the cap",
        );
        assert.equal(withholdingResult.consentReading, "withheld");
        assert.equal(withholdingResult.consentWithheldSentence, classifyWithheldConsent(WITHHOLDING_TEXT).sentence);
      },
    );

    // The mirror: withholds on its first turn, clear by its last — the rule must not punish a run
    // where the agent got its answer.
    const MIRROR_TURNS = [
      { text: "I don't think this is settled enough to advance yet.", endIndex: 5 },
      { text: "Understood — that's clear now, thanks for confirming.", endIndex: 9 },
    ];
    let mirrorPointer = 0;
    let mirrorCursorValue = 0;
    const mirrorStub = {
      async waitForTurn() {
        const turn = MIRROR_TURNS[mirrorPointer];
        mirrorPointer += 1;
        mirrorCursorValue = turn.endIndex;
        return { ...turn, chunkCount: 1, charCount: turn.text.length, endedBy: "result" };
      },
      eventCursor() {
        return mirrorCursorValue;
      },
    };
    const mirrorResult = await driveChallengeConversation({
      sidecar: mirrorStub,
      runId: "stub-run-withholds-then-clears",
      sendTurn: async () => {},
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });
    check(
      "driveChallengeConversation reads consentReading from the LAST agent turn only — a run that withheld once and cleared by its final turn reports clear",
      () => {
        assert.equal(mirrorResult.consentReading, "clear");
      },
    );
  }

  {
    // Plan 260929-nxq (Task 1h): fallbackAnswerCount counts a wholly-fallback composed reply.
    let fallbackCursorValue = 0;
    let fallbackPointer = 0;
    const FALLBACK_TURNS = [
      { text: "This one matches nothing in the bank at all, so what happens?", endIndex: 4 },
      { text: "Understood, moving forward with that.", endIndex: 8 },
    ];
    const fallbackStub = {
      async waitForTurn() {
        const turn = FALLBACK_TURNS[fallbackPointer];
        fallbackPointer += 1;
        fallbackCursorValue = turn.endIndex;
        return { ...turn, chunkCount: 1, charCount: turn.text.length, endedBy: "result" };
      },
      eventCursor() {
        return fallbackCursorValue;
      },
    };
    const fallbackResult = await driveChallengeConversation({
      sidecar: fallbackStub,
      runId: "stub-run-wholly-fallback",
      sendTurn: async () => {},
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });
    check("fallbackAnswerCount counts a wholly-fallback composed reply as such", () => {
      assert.equal(fallbackResult.fallbackAnswerCount, 1);
    });
  }

  // -----------------------------------------------------------------------------------------
  // Quick task 260929-p61 — the developer answer source: the arm guard, and the driver seam.
  // -----------------------------------------------------------------------------------------

  for (const flag of OFFLINE_ARM_FLAGS) {
    check(
      `[Quick 260929-p61] createDeveloperAnswerSource refuses construction when argv carries "${flag}"`,
      () => {
        assert.throws(
          () =>
            createDeveloperAnswerSource({
              argv: ["node", "uat-08-socratic-authoring.mjs", flag],
              isTty: false,
              handoffDir: os.tmpdir(),
              runId: "stub-run-arm-guard",
            }),
          (err) => err instanceof LiveArmRequiredError && err.flag === flag && err.message.includes(flag),
        );
      },
    );
  }

  check(
    "[Quick 260929-p61] createDeveloperAnswerSource constructs successfully against a fabricated live-shaped argv",
    () => {
      const source = createDeveloperAnswerSource({
        argv: ["node", "uat-08-socratic-authoring.mjs"],
        isTty: false,
        handoffDir: os.tmpdir(),
        runId: "stub-run-live-shaped-argv",
      });
      assert.equal(source.name, ANSWER_SOURCE_DEVELOPER);
      assert.equal(typeof source.answerQuestions, "function");
    },
  );

  {
    // (c) the real driver, given a stub answerQuestions and a scripted stub sidecar, awaits it,
    // hands it the extracted questions, records its returned string verbatim as the developer
    // exchange, and reports the developer provenance value.
    let devCallIndex = 0;
    const DEV_TURNS = [
      { text: "Where does the board app actually live?", endIndex: 4 },
      { text: "Great, thanks — that settles it.", endIndex: 8 },
    ];
    const devStub = {
      async waitForTurn() {
        const turn = DEV_TURNS[devCallIndex];
        devCallIndex += 1;
        return { ...turn, chunkCount: 1, charCount: turn.text.length, endedBy: "result" };
      },
      eventCursor() {
        return DEV_TURNS[Math.min(devCallIndex, DEV_TURNS.length - 1)].endIndex;
      },
    };
    let receivedQuestions = null;
    const STUB_DEVELOPER_REPLY = `${REPLY_PREAMBLE}\n1. it lives inside the desktop app itself`;
    const devResult = await driveChallengeConversation({
      sidecar: devStub,
      runId: "stub-run-developer-answers",
      sendTurn: async () => {},
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
      answerQuestions: async (questions) => {
        receivedQuestions = questions;
        return STUB_DEVELOPER_REPLY;
      },
    });
    check(
      "[Quick 260929-p61] driveChallengeConversation awaits an injected answerQuestions, hands it the extracted questions, records its return value verbatim as the developer exchange, and reports the developer provenance value",
      () => {
        assert.ok(Array.isArray(receivedQuestions) && receivedQuestions.length > 0, "expected the injected source to receive the extracted questions");
        assert.equal(receivedQuestions[0].text, "Where does the board app actually live?");
        const developerExchange = devResult.exchanges.find((exchange) => exchange.speaker === "developer");
        assert.equal(developerExchange.text, STUB_DEVELOPER_REPLY, "expected the injected source's own return value recorded verbatim");
        assert.equal(devResult.answerSource, ANSWER_SOURCE_DEVELOPER);
      },
    );
  }

  {
    // (d) the real driver with no answerQuestions reports the bank provenance value and composes
    // bank lines exactly as before this task.
    let bankCallIndex = 0;
    const BANK_TURNS = [
      { text: "Who can dismiss a notification once it fires?", endIndex: 4 },
      { text: "Good, that's clear.", endIndex: 8 },
    ];
    const bankStub = {
      async waitForTurn() {
        const turn = BANK_TURNS[bankCallIndex];
        bankCallIndex += 1;
        return { ...turn, chunkCount: 1, charCount: turn.text.length, endedBy: "result" };
      },
      eventCursor() {
        return BANK_TURNS[Math.min(bankCallIndex, BANK_TURNS.length - 1)].endIndex;
      },
    };
    const bankResult = await driveChallengeConversation({
      sidecar: bankStub,
      runId: "stub-run-bank-provenance",
      sendTurn: async () => {},
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });
    check(
      "[Quick 260929-p61] driveChallengeConversation with no answerQuestions reports the answer-bank provenance value and composes bank lines exactly as before",
      () => {
        assert.equal(bankResult.answerSource, ANSWER_SOURCE_BANK);
        const developerExchange = bankResult.exchanges.find((exchange) => exchange.speaker === "developer");
        assert.equal(
          developerExchange.text,
          composeDeveloperReply([{ text: "Who can dismiss a notification once it fires?", options: [] }]),
        );
      },
    );
  }

  check(
    "[Quick 260929-p61] the evidence sheet renders the answer source next to the other conversation facts, defaulting to the answer-bank provenance value for a caller that never set it",
    () => {
      const withoutField = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
      assert.ok(withoutField.includes(`**Answer source:** ${ANSWER_SOURCE_BANK}`));
      const withDeveloper = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, answerSource: ANSWER_SOURCE_DEVELOPER });
      assert.ok(withDeveloper.includes(`**Answer source:** ${ANSWER_SOURCE_DEVELOPER}`));
    },
  );

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

  check(
    "the live body calls advance-stage exactly twice, both after the driver returns, and never inside it",
    () => {
      const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
      // The runOps call-site shape (an array literal opening with the advance-stage op name) —
      // deliberately narrower than a bare string-literal scan, which would also match this very
      // check's own source below (a self-referential scan reads itself too). The pattern is built
      // from parts at runtime so its own source line never spells out the literal shape it hunts for.
      const advanceOpPattern = new RegExp("\\[\\s*" + JSON.stringify("advance-stage") + "\\s*,");
      // Scoped to the LIVE body specifically — `--replay-check` (plan 05-21) legitimately carries
      // its OWN advance-stage call site(s), mirroring the live body rather than duplicating this
      // invariant. The live body's own runScript call is the only TOP-LEVEL (column-zero) one in
      // the file; every other call lives inside an indented helper.
      const liveBodyStart = thisFile.indexOf("\nawait runScript(\n");
      assert.ok(liveBodyStart >= 0, "expected to find the live body's own top-level runScript call");
      const liveBodySource = thisFile.slice(liveBodyStart);
      const globalAdvancePattern = new RegExp(advanceOpPattern.source, "g");
      const advanceMatches = [...liveBodySource.matchAll(globalAdvancePattern)];
      // Plan 05-46 (gap G-05-9): D-88's own three-stage machine holds TWO developer gates (D-90) —
      // challenge -> decompose, and decompose -> criteria — so the live body now carries two
      // advance-stage call sites, never one and never a third.
      assert.equal(
        advanceMatches.length,
        2,
        `expected exactly two advance-stage call sites in the live body (one per developer-held ` +
          `gate in D-88's three-stage machine: challenge -> decompose, decompose -> criteria), got ` +
          `${advanceMatches.length}`,
      );
      // Both call sites must appear textually AFTER the driver's own call — an advance can never
      // migrate back inside the conversation the driver is still running.
      const driverCallMarker = "await driveChallengeConversation(";
      const driverCallIndex = liveBodySource.indexOf(driverCallMarker);
      assert.ok(driverCallIndex >= 0, "expected to find the live body's own call to driveChallengeConversation");
      advanceMatches.forEach((match, position) => {
        assert.ok(
          match.index > driverCallIndex,
          `expected advance-stage call site #${position + 1} (at index ${match.index}) to appear ` +
            `after the live body's own call to driveChallengeConversation (at index ${driverCallIndex})`,
        );
      });
      // lastIndexOf, not indexOf: the ONLY real declaration is textually last in the file — every
      // earlier occurrence of this literal is a self-referential mention inside a check's own source
      // (this one included), which `indexOf` would otherwise find first and mis-slice from.
      const driverStart = thisFile.lastIndexOf("async function driveChallengeConversation");
      const driverEnd = thisFile.indexOf("\n}\n", driverStart);
      const driverBody = thisFile.slice(driverStart, driverEnd);
      assert.ok(!driverBody.includes("advance-stage"), "driveChallengeConversation must never call advance-stage itself");
    },
  );

  check(
    "[Plan 05-24, NF-01; extended plan 05-46, gap G-05-9] the live body holds exactly two waitForTurn( call sites — the distillation and criteria captures — never a standalone first-turn capture duplicating the driver's own first exchange",
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
      // Plan 05-46 (gap G-05-9): TWO legitimate call sites now — the distillation reply (entering
      // decompose) and the criteria reply (entering criteria) — neither one a standalone capture of
      // the driver's OWN first turn, which NF-01 named and which the driver itself still captures.
      assert.equal(
        nonCommentLineCount,
        2,
        `expected exactly two ${waitForTurnMarker} call sites in the live body (the distillation ` +
          `and criteria replies), got ${nonCommentLineCount} — a standalone first-turn capture ` +
          "would double-record the seed turn the driver already captures as its own first exchange " +
          "(NF-01); a third capture site beyond the two named here would be equally unexpected",
      );
    },
  );

  check(
    "[Plan 260929-lq1] every proposal-decision call site in the live body is immediately preceded " +
      "by its own pickPendingProposal( pick, with no mutating decision op between them — the " +
      "structural gate pairing the round-12 crash fix",
    () => {
      const thisFile = fs.readFileSync(new URL(import.meta.url), "utf8");
      // Scoped to the LIVE body specifically, the same idiom as the advance-stage/waitForTurn
      // checks above — this is their sibling, not a second scanning style.
      const liveBodyStart = thisFile.indexOf("\nawait runScript(\n");
      assert.ok(liveBodyStart >= 0, "expected to find the live body's own top-level runScript call");
      const liveBodySource = thisFile.slice(liveBodyStart);

      // Built from parts at runtime, and the op-name list built by splitting a single
      // space-separated string rather than writing an array literal, so this check's own source
      // never spells out the argv shape it hunts for — the same self-match discipline the
      // advance-stage check above uses.
      const decisionOpNames = "accept-proposal accept-subtree reject-proposal amend-criterion".split(" ");
      const argvPattern = (opName) => new RegExp("\\[\\s*" + JSON.stringify(opName) + "\\s*,");
      const pickMarker = ["pickPendingProposal", "("].join("");

      const decisionMatches = [];
      for (const opName of decisionOpNames) {
        const globalPattern = new RegExp(argvPattern(opName).source, "g");
        for (const match of liveBodySource.matchAll(globalPattern)) {
          decisionMatches.push({ opName, index: match.index });
        }
      }
      decisionMatches.sort((a, b) => a.index - b.index);
      assert.ok(decisionMatches.length > 0, "expected at least one proposal-decision call site in the live body");

      for (const { opName, index } of decisionMatches) {
        const precedingSource = liveBodySource.slice(0, index);
        const pickIndex = precedingSource.lastIndexOf(pickMarker);
        assert.ok(
          pickIndex >= 0,
          `expected a ${pickMarker} pick to precede the ${opName} decision at live-body offset ` +
            `${index} — every decision target must be derived from a read taken immediately ` +
            "before the deciding call, never from an older snapshot",
        );
        // The pick statement's own terminating semicolon — everything before it is the pick call
        // itself (whose own argv, `["list-pending", runId]`, never matches a DECISION op's argv
        // shape, so it is safe to include in the scan too; this just skips re-scanning it).
        const pickStatementEnd = liveBodySource.indexOf(";", pickIndex);
        assert.ok(
          pickStatementEnd >= 0 && pickStatementEnd < index,
          `expected the ${pickMarker} pick before offset ${index} to terminate before the ${opName} decision itself`,
        );
        const betweenSource = liveBodySource.slice(pickStatementEnd + 1, index);
        for (const otherOpName of decisionOpNames) {
          assert.ok(
            !argvPattern(otherOpName).test(betweenSource),
            `expected no mutating decision op between the pick and the ${opName} decision at ` +
              `offset ${index}, but found a ${otherOpName} argv-shaped occurrence — a proposal id ` +
              "read before a mutating decision is a fact about a board state that no longer " +
              "exists (the round-12 crash: a snapshot taken before accept-subtree's own cascade)",
          );
        }
      }
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
  // readCriteriaReachability (plan 05-46, gap G-05-9) — the four-valued reading, against
  // in-memory event fixtures, reusing correlateProposeAttempts verbatim.
  // -----------------------------------------------------------------------------------------

  check("readCriteriaReachability reads \"drafted\" whenever draftedCriteriaCount is greater than zero, regardless of event content", () => {
    const reading = readCriteriaReachability([], { runId: "run-a", fromIndex: 0, toIndex: 0 }, { draftedCriteriaCount: 2 });
    assert.equal(reading, "drafted");
  });

  check("readCriteriaReachability reads \"blocked\" when a propose_criterion attempt is refused, paired by correlation id", () => {
    const events = [
      { type: "tool_call", runId: "run-b", toolName: "mcp__flywheel-permissions__propose_criterion", toolUseId: "toolu_pc_1" },
      {
        type: "tool_result",
        runId: "run-b",
        toolUseId: "toolu_pc_1",
        raw: "still in the challenge stage — no proposals yet",
      },
    ];
    const reading = readCriteriaReachability(
      events,
      { runId: "run-b", fromIndex: 0, toIndex: events.length },
      { draftedCriteriaCount: 0 },
    );
    assert.equal(reading, "blocked");
  });

  check("readCriteriaReachability reads \"declined\" when proposal_list was called and no criterion was drafted and nothing was refused", () => {
    const events = [
      { type: "tool_call", runId: "run-c", toolName: "mcp__flywheel-permissions__proposal_list", toolUseId: "toolu_pl_1" },
      { type: "tool_result", runId: "run-c", toolUseId: "toolu_pl_1", raw: "[]" },
    ];
    const reading = readCriteriaReachability(
      events,
      { runId: "run-c", fromIndex: 0, toIndex: events.length },
      { draftedCriteriaCount: 0 },
    );
    assert.equal(reading, "declined");
  });

  check("readCriteriaReachability reads \"not-attempted\" when there is no propose_criterion attempt and no proposal_list call at all", () => {
    const events = [
      { type: "tool_call", runId: "run-d", toolName: "mcp__flywheel-permissions__propose_task", toolUseId: "toolu_pt_1" },
      { type: "tool_result", runId: "run-d", toolUseId: "toolu_pt_1", raw: "ok" },
    ];
    const reading = readCriteriaReachability(
      events,
      { runId: "run-d", fromIndex: 0, toIndex: events.length },
      { draftedCriteriaCount: 0 },
    );
    assert.equal(reading, "not-attempted");
  });

  check("readCriteriaReachability never confuses a foreign run's proposal_list call with this run's own", () => {
    const events = [
      { type: "tool_call", runId: "run-someone-elses", toolName: "mcp__flywheel-permissions__proposal_list", toolUseId: "toolu_foreign_1" },
    ];
    const reading = readCriteriaReachability(
      events,
      { runId: "run-e", fromIndex: 0, toIndex: events.length },
      { draftedCriteriaCount: 0 },
    );
    assert.equal(reading, "not-attempted");
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

  // ---- Task 3: renderChallengeEvidenceSheet's credentialPath section ----------------------------

  const CREDENTIAL_PATH_SUMMARY = {
    loggedIn: true,
    authMethod: "claude.ai",
    configDirectory: "/scratch/claude-config",
    scrubbedCount: 0,
  };

  check(
    "[Plan 05-33, Task 3] a sheet rendered with credentialPath omitted is byte-identical to one rendered with credentialPath explicitly null",
    () => {
      const withoutField = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
      const withExplicitNull = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, credentialPath: null });
      assert.equal(withoutField, withExplicitNull);
      assert.ok(!withoutField.includes("## Credential path"));
    },
  );

  check(
    "[Plan 05-33, Task 3] a sheet rendered WITH a credentialPath summary carries the credential-path heading ABOVE the verdict heading",
    () => {
      const sheet = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, credentialPath: CREDENTIAL_PATH_SUMMARY });
      const credentialHeadingIndex = sheet.indexOf("## Credential path");
      const verdictHeadingIndex = sheet.indexOf("## Verdicts");
      assert.ok(credentialHeadingIndex >= 0 && verdictHeadingIndex >= 0);
      assert.ok(credentialHeadingIndex < verdictHeadingIndex);
      assert.ok(sheet.includes("claude.ai"));
    },
  );

  check(
    "[Plan 05-33, Task 3] a sheet rendered with a credentialPath summary contains none of the identity strings from a payload that carried them",
    () => {
      const identityPayload = {
        loggedIn: true,
        authMethod: "claude.ai",
        configDirectory: "/scratch/claude-config",
        email: "dev@example.com",
        orgId: "org_ABC123",
        orgName: "Acme Corp",
      };
      const credentialPath = { ...summariseAuthStatus(identityPayload), scrubbedCount: 0 };
      const sheet = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, credentialPath });
      assert.ok(!sheet.includes(identityPayload.email));
      assert.ok(!sheet.includes(identityPayload.orgId));
      assert.ok(!sheet.includes(identityPayload.orgName));
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Plan 05-36 (Task 1, gap G-05-7): one writer, one exit — a thrown exception anywhere in the
  // live conversation still lands the evidence sheet, carrying what it captured and why it died.
  // ---------------------------------------------------------------------------------------------

  check(
    "[Plan 05-36, Task 1] sidecar-harness.mjs exports TurnDeadlineError, and this file exports ConversationAbortedError/writeChallengeEvidence",
    () => {
      assert.equal(typeof TurnDeadlineError, "function");
      assert.equal(typeof ConversationAbortedError, "function");
      assert.equal(typeof writeChallengeEvidence, "function");
    },
  );

  // A minimal fake child — no real process ever spawned, its stdout/stderr never written to — is
  // enough to construct a REAL SidecarClient and drive its own waitForTurn/fail() path directly,
  // the same mechanism the live sidecar uses, exercised entirely offline.
  const turnDeadlineSidecar = new SidecarClient({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: { write: () => {} },
    on: () => {},
  });
  turnDeadlineSidecar.events.push(
    { type: "assistant_text", runId: "stub-run-deadline", text: "partial reply" },
    { type: "tool_call", runId: "stub-run-deadline", toolName: "Bash", toolUseId: "toolu_1" },
  );
  let turnDeadlineError;
  try {
    await turnDeadlineSidecar.waitForTurn("stub-run-deadline", 0, {
      timeoutMs: 10,
      idleMs: 5,
      label: "self-test deadline",
    });
  } catch (err) {
    turnDeadlineError = err;
  }

  check(
    "[Plan 05-36, Task 1] a rejected turn wait produces a TurnDeadlineError instance carrying a partial object whose chunkCount matches the synthetic events",
    () => {
      assert.ok(
        turnDeadlineError instanceof TurnDeadlineError,
        `expected a TurnDeadlineError, got ${turnDeadlineError?.constructor?.name}`,
      );
      assert.equal(
        turnDeadlineError.partial.chunkCount,
        1,
        "expected the partial capture's chunkCount to match the one synthetic assistant_text event",
      );
    },
  );

  check(
    "[Plan 05-36, Task 1] the TurnDeadlineError message string still begins with the literal 'timed out after ' and still contains the literal 'captured so far: '",
    () => {
      assert.ok(turnDeadlineError.message.startsWith("timed out after "));
      assert.ok(turnDeadlineError.message.includes("captured so far: "));
    },
  );

  check(
    "[Plan 05-36, Task 1] the body of writeChallengeEvidence contains exactly one writeFileSync call",
    () => {
      const source = fs.readFileSync(process.argv[1], "utf8");
      // lastIndexOf, deliberately: this very check's own source text necessarily contains the
      // declaration string literally (it is a check ABOUT that string), and that occurrence always
      // sits EARLIER in the file than the real declaration — the real one is the LAST occurrence.
      const declaration = "export function writeChallengeEvidence(state) {";
      const start = source.lastIndexOf(declaration);
      assert.ok(start >= 0, "expected to find writeChallengeEvidence's own declaration");
      const end = source.indexOf("\n}\n", start);
      const body = source.slice(start, end);
      const count = (body.match(/writeFileSync\(/g) ?? []).length;
      assert.equal(count, 1, `expected exactly one writeFileSync call inside writeChallengeEvidence, found ${count}`);
    },
  );

  check(
    "[Plan 05-36, Task 1] a sheet rendered with the failure field omitted is byte-identical to one rendered with it explicitly null",
    () => {
      const withoutField = renderChallengeEvidenceSheet(SYNTHETIC_EVIDENCE);
      const withExplicitNull = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, failure: null });
      assert.equal(withoutField, withExplicitNull);
    },
  );

  check(
    "[Plan 05-36, Task 1] the failure heading's index in a rendered sheet is greater than the drafted-criteria heading's index and lower than the verdict heading's index",
    () => {
      const failureError = new Error("stub failure for self-test");
      const sheet = renderChallengeEvidenceSheet({ ...SYNTHETIC_EVIDENCE, failure: failureError });
      const draftedIndex = sheet.indexOf("## Draft usefulness (SHAPE-03)");
      const failureIndex = sheet.indexOf("## Run failure");
      const verdictIndex = sheet.indexOf("## Verdicts");
      assert.ok(draftedIndex >= 0 && failureIndex >= 0 && verdictIndex >= 0);
      assert.ok(failureIndex > draftedIndex, "expected the failure heading after the drafted-criteria heading");
      assert.ok(failureIndex < verdictIndex, "expected the failure heading before the verdict heading");
    },
  );

  check(
    "[Plan 05-36, Task 1] a state with a null conversation and a failure renders a sheet containing the opening prompt and the failure cause, with no agent exchange and no throw",
    () => {
      const scratchPath = path.join(os.tmpdir(), `flywheel-uat08-selftest-null-conv-${Date.now()}-${Math.random()}.md`);
      try {
        writeChallengeEvidence({
          evidencePath: scratchPath,
          runId: "stub-run-null-conversation",
          openingPrompt: OPENING_PROMPT,
          conversation: null,
          noWorkPlannedReading: "unproven",
          draftedCriteriaCount: 0,
          amendedCriteriaCount: 0,
          results: [],
          credentialPath: null,
          nonConversation: null,
          failure: new Error("stub failure — driver never returned"),
        });
        assert.ok(fs.existsSync(scratchPath));
        const sheet = fs.readFileSync(scratchPath, "utf8");
        assert.ok(sheet.includes(OPENING_PROMPT), "expected the opening prompt in the sheet");
        assert.ok(
          sheet.includes("stub failure — driver never returned"),
          "expected the failure cause in the sheet",
        );
        assert.ok(!/### \d+\. Agent/.test(sheet), "expected no agent exchange heading");
      } finally {
        fs.rmSync(scratchPath, { force: true });
      }
    },
  );

  // A stub sidecar whose first waitForTurn resolves normally (one agent turn carrying a question,
  // so the driver sends a developer reply and loops) then rejects on the second call with a
  // partial-carrying error — mirroring the shape a real TurnDeadlineError carries.
  class SelfTestPartialError extends Error {
    constructor(partial) {
      super("stub deadline error");
      this.partial = partial;
    }
  }
  const conversationAbortedStub = {
    calls: 0,
    async waitForTurn() {
      this.calls += 1;
      if (this.calls === 1) {
        return {
          text: "First reply — what's the audience for this feature?",
          chunkCount: 1,
          charCount: 52,
          endedBy: "result",
          endIndex: 5,
          nonConversation: null,
        };
      }
      throw new SelfTestPartialError({
        text: "partial second reply, cut off mid-turn",
        chunkCount: 2,
        charCount: 39,
        endIndex: 9,
        nonConversation: null,
      });
    },
    eventCursor() {
      return 5;
    },
  };
  let conversationAbortedError;
  try {
    await driveChallengeConversation({
      sidecar: conversationAbortedStub,
      runId: "stub-run-aborted",
      sendTurn: async () => {},
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });
  } catch (err) {
    conversationAbortedError = err;
  }

  check(
    "[Plan 05-36, Task 1] a ConversationAbortedError built from an error carrying a two-chunk partial exposes an exchange list whose LAST entry is the recovered agent exchange and whose earlier entries are in their original order",
    () => {
      assert.ok(conversationAbortedError instanceof ConversationAbortedError);
      const exchanges = conversationAbortedError.exchanges;
      assert.ok(exchanges.length >= 3, `expected at least 3 exchanges, got ${exchanges.length}`);
      assert.equal(exchanges[0].speaker, "agent");
      assert.ok(exchanges[0].text.includes("audience"));
      assert.equal(exchanges[1].speaker, "developer");
      const last = exchanges[exchanges.length - 1];
      assert.equal(last.speaker, "agent");
      assert.equal(last.chunkCount, 2);
      assert.equal(last.endedBy, "turn-deadline");
      assert.ok(last.text.includes("partial second reply"));
    },
  );

  const zeroTurnStub = {
    async waitForTurn() {
      throw new SelfTestPartialError({ text: "", chunkCount: 0, charCount: 0, endIndex: 0, nonConversation: null });
    },
    eventCursor() {
      return 0;
    },
  };
  let zeroTurnError;
  try {
    await driveChallengeConversation({
      sidecar: zeroTurnStub,
      runId: "stub-run-zero",
      sendTurn: async () => {},
      cursor: 0,
      turnDeadlineMs: 200,
      maxAgentTurns: 4,
    });
  } catch (err) {
    zeroTurnError = err;
  }

  check(
    "[Plan 05-36, Task 1] a conversation driver whose turn wait rejects before ANY turn was captured carries an empty exchange list, never a fabricated entry",
    () => {
      assert.ok(zeroTurnError instanceof ConversationAbortedError);
      assert.deepEqual(zeroTurnError.exchanges, []);
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Plan 05-36 (Task 2, gap G-05-7): a failed run keeps its scratch root and says where it is; a
  // successful one does not; the credential-path artifact's survival is asserted, not assumed.
  // ---------------------------------------------------------------------------------------------

  {
    const cleanupSuccessHarness = new Harness("selftest-cleanup-success");
    const cleanupSuccessRoot = cleanupSuccessHarness.root;
    const originalWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    process.stdout.write = (chunk) => {
      captured += chunk;
      return true;
    };
    try {
      cleanupSuccessHarness.cleanup();
    } finally {
      process.stdout.write = originalWrite;
    }
    check(
      "[Plan 05-36, Task 2] cleanup() with no options removes the scratch root and prints nothing about a preserved directory",
      () => {
        assert.equal(fs.existsSync(cleanupSuccessRoot), false, "expected the root to be removed");
        assert.ok(!captured.includes("preserved scratch root"), "expected no preserved-root message");
      },
    );
  }

  {
    const cleanupPreserveHarness = new Harness("selftest-cleanup-preserve");
    const cleanupPreserveRoot = cleanupPreserveHarness.root;
    let teardownRuns = 0;
    cleanupPreserveHarness.onCleanup(() => {
      teardownRuns += 1;
    });
    const originalWrite = process.stdout.write.bind(process.stdout);
    let captured = "";
    process.stdout.write = (chunk) => {
      captured += chunk;
      return true;
    };
    try {
      cleanupPreserveHarness.cleanup({ preserveRoot: true });
    } finally {
      process.stdout.write = originalWrite;
    }
    check(
      "[Plan 05-36, Task 2] cleanup({ preserveRoot: true }) leaves the scratch root in place, runs the registered teardown (proven by a counter, not the filesystem), and prints the preserved path exactly once",
      () => {
        assert.equal(fs.existsSync(cleanupPreserveRoot), true, "expected the root to still exist");
        assert.equal(teardownRuns, 1, "expected the registered teardown to have run exactly once");
        const preservedLines = captured.split("\n").filter((line) => line.includes("preserved scratch root"));
        assert.equal(preservedLines.length, 1, "expected exactly one preserved-root line");
        assert.ok(preservedLines[0].includes(cleanupPreserveRoot), "expected the preserved line to name the root");
      },
    );
    fs.rmSync(cleanupPreserveRoot, { recursive: true, force: true });
  }

  {
    const artifactSuccessHarness = new Harness("selftest-artifact-success");
    const artifactSuccessPath = artifactSuccessHarness.writeArtifact("selftest-artifact-success", { ok: true });
    artifactSuccessHarness.cleanup();
    check(
      "[Plan 05-36, Task 2] a file written through writeArtifact still exists after cleanup() on the success path",
      () => {
        assert.ok(fs.existsSync(artifactSuccessPath));
      },
    );
    fs.rmSync(artifactSuccessPath, { force: true });
  }

  {
    const artifactPreserveHarness = new Harness("selftest-artifact-preserve");
    const artifactPreserveRoot = artifactPreserveHarness.root;
    const artifactPreservePath = artifactPreserveHarness.writeArtifact("selftest-artifact-preserve", { ok: true });
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      artifactPreserveHarness.cleanup({ preserveRoot: true });
    } finally {
      process.stdout.write = originalWrite;
    }
    check(
      "[Plan 05-36, Task 2] a file written through writeArtifact still exists after cleanup({ preserveRoot: true }) — survival is unconditional",
      () => {
        assert.ok(fs.existsSync(artifactPreservePath));
      },
    );
    fs.rmSync(artifactPreservePath, { force: true });
    fs.rmSync(artifactPreserveRoot, { recursive: true, force: true });
  }

  let skipBranchRoot;
  {
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = () => true;
    try {
      await runScript("selftest-skip-branch", "self-test skip branch (never a real failure)", async (harness) => {
        skipBranchRoot = harness.root;
        skip("missing prerequisite — self-test only, not a real precondition failure");
      });
    } finally {
      process.stdout.write = originalWrite;
    }
  }
  check(
    "[Plan 05-36, Task 2] the SkipError branch of runScript does not set the preserve flag — a skip removes the root exactly like the success path",
    () => {
      assert.equal(fs.existsSync(skipBranchRoot), false, "expected the root to be removed on a skip");
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Plan 05-36 (Task 3, 05-REVIEW.md WR-01): the replay arm's advance-stage gate reads the fact the
  // driver returned, not a scenario's own name.
  // ---------------------------------------------------------------------------------------------

  check(
    "[Plan 05-36, Task 3] conversationStoppedOnNonConversationTurn is true for a conversation whose nonConversation field is non-null",
    () => {
      assert.equal(
        conversationStoppedOnNonConversationTurn({
          exchanges: [],
          nonConversation: { kind: BACKEND_REFUSAL_KIND, source: NON_CONVERSATION_SOURCES.TEXT_BANNER },
        }),
        true,
      );
    },
  );

  check(
    "[Plan 05-36, Task 3] conversationStoppedOnNonConversationTurn is false for a conversation whose nonConversation field is null",
    () => {
      assert.equal(conversationStoppedOnNonConversationTurn({ exchanges: [], nonConversation: null }), false);
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Plan 05-37 (Task 3, gap G-05-7): the durable unmodelled-event sink — its own bounds, its own
  // recorded truncation, its own artifact-directory-only placement, and the no-sink default.
  // ---------------------------------------------------------------------------------------------

  const sinkSelfTestArtifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-selftest-sink-"));

  check(
    "[Plan 05-37, Task 3] createUnmodelledEventSink's file path begins with the artifact directory it was given",
    () => {
      const sink = createUnmodelledEventSink({ artifactDir: sinkSelfTestArtifactDir, label: "selftest" });
      assert.ok(
        sink.filePath.startsWith(sinkSelfTestArtifactDir),
        `expected ${sink.filePath} to begin with ${sinkSelfTestArtifactDir}`,
      );
    },
  );

  check(
    "[Plan 05-37, Task 3] createUnmodelledEventSink's file path never resolves under the repository root",
    () => {
      const sink = createUnmodelledEventSink({ artifactDir: sinkSelfTestArtifactDir, label: "selftest" });
      assert.ok(
        !sink.filePath.startsWith(REPO_ROOT),
        `expected ${sink.filePath} to NOT resolve under REPO_ROOT (${REPO_ROOT}) — the artifact directory is the only permitted destination (T-05-37-02)`,
      );
    },
  );

  check(
    "[Plan 05-37, Task 3] appending a raw string longer than UNMODELLED_EVENT_LINE_LIMIT records both the cut and the original length",
    () => {
      const sink = createUnmodelledEventSink({ artifactDir: sinkSelfTestArtifactDir, label: "selftest-oversized" });
      const oversized = "x".repeat(UNMODELLED_EVENT_LINE_LIMIT + 137);
      sink.append(oversized);
      const written = fs.readFileSync(sink.filePath, "utf8").trim().split("\n").filter((l) => l.length > 0);
      assert.equal(written.length, 1, "expected exactly one written line for one append call");
      const parsed = JSON.parse(written[0]);
      assert.equal(parsed.truncated, true);
      assert.equal(parsed.originalLength, oversized.length);
      assert.equal(parsed.raw.length, UNMODELLED_EVENT_LINE_LIMIT, "expected the stored raw text to be cut to exactly the byte limit");
    },
  );

  check(
    "[Plan 05-37, Task 3] appending a raw string within the byte limit records no truncated key and no originalLength key",
    () => {
      const sink = createUnmodelledEventSink({ artifactDir: sinkSelfTestArtifactDir, label: "selftest-ordinary" });
      sink.append("an ordinary short unmodelled-event raw line");
      const written = fs.readFileSync(sink.filePath, "utf8").trim().split("\n").filter((l) => l.length > 0);
      const parsed = JSON.parse(written[0]);
      assert.ok(!Object.prototype.hasOwnProperty.call(parsed, "truncated"));
      assert.ok(!Object.prototype.hasOwnProperty.call(parsed, "originalLength"));
      assert.equal(parsed.raw, "an ordinary short unmodelled-event raw line");
    },
  );

  check(
    "[Plan 05-37, Task 3] appending more lines than UNMODELLED_EVENT_CAPTURE_LIMIT writes exactly one final line recording the limit and the suppressed count",
    () => {
      const sink = createUnmodelledEventSink({ artifactDir: sinkSelfTestArtifactDir, label: "selftest-bound" });
      const overflow = 3;
      for (let i = 0; i < UNMODELLED_EVENT_CAPTURE_LIMIT + overflow; i += 1) {
        sink.append(`unmodelled event number ${i}`);
      }
      const written = fs.readFileSync(sink.filePath, "utf8").trim().split("\n").filter((l) => l.length > 0);
      assert.equal(
        written.length,
        UNMODELLED_EVENT_CAPTURE_LIMIT + 1,
        "expected the captured lines plus exactly one boundary line",
      );
      const boundaryLine = JSON.parse(written[written.length - 1]);
      assert.equal(boundaryLine.limitReached, true);
      assert.equal(boundaryLine.limit, UNMODELLED_EVENT_CAPTURE_LIMIT);
      assert.equal(boundaryLine.suppressed, overflow);
      const summary = sink.summary();
      assert.equal(summary.appended, UNMODELLED_EVENT_CAPTURE_LIMIT);
      assert.equal(summary.suppressed, overflow);
    },
  );

  // `check()` is synchronous by construction (see its own definition above) — the client write and
  // the tick wait for the 'data' event to be delivered happen HERE, before the synchronous check()
  // call below asserts on the already-settled result, rather than inside an async check function
  // `check()` would not actually await.
  const noSinkStubClient = new SidecarClient({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: { write: () => {} },
    on: () => {},
  });
  const noSinkCapturedStderr = [];
  {
    const originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (chunk) => {
      noSinkCapturedStderr.push(String(chunk));
      return true;
    };
    try {
      noSinkStubClient.child.stdout.write(
        `${JSON.stringify({ kind: "event", event: { type: "unknown", runId: "run-selftest", raw: "an unrecognised raw line" } })}\n`,
      );
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      process.stderr.write = originalStderrWrite;
    }
  }
  check(
    "[Plan 05-37, Task 3] a SidecarClient constructed with no sink carries no sink, and still writes the stderr line for an unrecognised event",
    () => {
      assert.equal(noSinkStubClient.sink, undefined, "expected no sink on a client constructed without one");
      assert.ok(
        noSinkCapturedStderr.some((line) => line.includes("unrecognised sidecar event")),
        "expected the existing stderr line to still be written with no sink injected",
      );
    },
  );

  check(
    "[Plan 05-37, Task 3] SCENARIOS contains unmodelled-wire-shapes, reading the frozen fixture rather than declaring a literal copy of its measured values",
    () => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(SCENARIOS, "unmodelled-wire-shapes"),
        "expected fake-authoring-claude.mjs to declare an unmodelled-wire-shapes scenario",
      );
      const fakeBackendSource = fs.readFileSync(FAKE_AUTHORING_CLAUDE_PATH, "utf8");
      assert.ok(
        fakeBackendSource.includes("live-opus5-unmodelled-shapes.json"),
        "expected fake-authoring-claude.mjs to read the frozen fixture path rather than retype its values",
      );
      const measuredUtilization = String(UNMODELLED_SHAPES_FIXTURE.shapes.find((s) => s.expectedEventType === "rate_limit").line.rate_limit_info.utilization);
      assert.ok(
        !fakeBackendSource.includes(measuredUtilization),
        "expected fake-authoring-claude.mjs to never declare the measured utilization as a literal — it must read it from the fixture",
      );
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Plan 05-38 (Task 1, gap G-05-7 second finding): a turn is bounded by silence in every state —
  // the mid-flight window's own finite bound, and reasoning counted as turn progress.
  // ---------------------------------------------------------------------------------------------

  check(
    "[Plan 05-38, Task 1] LIVE_TOOL_CALL_IDLE_MS is exported with the derived value 120000",
    () => {
      assert.equal(LIVE_TOOL_CALL_IDLE_MS, 120_000);
    },
  );

  check(
    "[Plan 05-38, Task 1] accumulateTurn returns a thinkingCount on the result-terminated return path",
    () => {
      const events = [
        { type: "thinking", runId: "run-t38-1", text: "weighing the options" },
        { type: "assistant_text", runId: "run-t38-1", text: "hi" },
        { type: "result", runId: "run-t38-1" },
      ];
      const partial = accumulateTurn(events, "run-t38-1", 0);
      assert.equal(partial.endedBy, "result");
      assert.equal(partial.thinkingCount, 1);
      assert.equal(partial.chunkCount, 1);
    },
  );

  check(
    "[Plan 05-38, Task 1] accumulateTurn returns a thinkingCount on the fall-through (unterminated) return path",
    () => {
      const events = [{ type: "thinking", runId: "run-t38-2", text: "weighing the options" }];
      const partial = accumulateTurn(events, "run-t38-2", 0);
      assert.equal(partial.endedBy, undefined);
      assert.equal(partial.thinkingCount, 1);
    },
  );

  check(
    "[Plan 05-38, Task 1] a reasoning event increments thinkingCount and leaves chunkCount/charCount unchanged — reasoning is not agent speech",
    () => {
      const events = [{ type: "thinking", runId: "run-t38-3", text: "a stretch of reasoning" }];
      const partial = accumulateTurn(events, "run-t38-3", 0);
      assert.equal(partial.thinkingCount, 1);
      assert.equal(partial.chunkCount, 0);
      assert.equal(partial.charCount, 0);
      assert.deepEqual(partial.chunks, []);
    },
  );

  check(
    "[Plan 05-38, Task 1] a reasoning event belonging to a DIFFERENT run changes nothing for this run",
    () => {
      const events = [{ type: "thinking", runId: "some-other-run", text: "not this run's reasoning" }];
      const partial = accumulateTurn(events, "run-t38-4", 0);
      assert.equal(partial.thinkingCount, 0);
      assert.equal(partial.chunkCount, 0);
    },
  );

  // A minimal fake child, driving a REAL SidecarClient directly — the same mechanism used above for
  // the plan 05-36 TurnDeadlineError checks — with events pushed straight onto `.events` and
  // `turnWatchers` invoked by hand, so no real wire is needed to exercise `waitForTurn`'s own timers.
  const midFlightSidecar = new SidecarClient({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: { write: () => {} },
    on: () => {},
  });
  midFlightSidecar.events.push({ type: "tool_call", runId: "run-t38-midflight", toolName: "Bash", toolUseId: "toolu_t38_mf" });
  const midFlightResult = await midFlightSidecar.waitForTurn("run-t38-midflight", 0, {
    timeoutMs: 5_000,
    idleMs: 5_000,
    toolCallIdleMs: 20,
    label: "self-test mid-flight window",
  });

  check(
    "[Plan 05-38, Task 1] a turn with an outstanding tool call and a short explicitly-passed mid-flight window concludes with the idle marker, reporting it ended mid-flight and naming the outstanding tool",
    () => {
      assert.equal(midFlightResult.endedBy, "idle");
      assert.equal(midFlightResult.midFlight, true);
      assert.deepEqual(midFlightResult.outstandingTools, ["Bash"]);
    },
  );

  const resultWinsSidecar = new SidecarClient({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: { write: () => {} },
    on: () => {},
  });
  resultWinsSidecar.events.push(
    { type: "tool_call", runId: "run-t38-resultwins", toolName: "Bash", toolUseId: "toolu_t38_rw" },
    { type: "result", runId: "run-t38-resultwins" },
  );
  const resultWinsResult = await resultWinsSidecar.waitForTurn("run-t38-resultwins", 0, {
    timeoutMs: 5_000,
    idleMs: 5_000,
    toolCallIdleMs: 5_000,
    label: "self-test result-wins-while-pending",
  });

  check(
    "[Plan 05-38, Task 1] the backend's own end-of-turn line still ends the turn immediately even while a tool call is outstanding",
    () => {
      assert.equal(resultWinsResult.endedBy, "result");
    },
  );

  const reasoningAliveSidecar = new SidecarClient({
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: { write: () => {} },
    on: () => {},
  });
  reasoningAliveSidecar.events.push({ type: "assistant_text", runId: "run-t38-reasoning-alive", text: "starting" });
  const reasoningAliveIdleMs = 60;
  const reasoningAlivePromise = reasoningAliveSidecar.waitForTurn("run-t38-reasoning-alive", 0, {
    timeoutMs: 5_000,
    idleMs: reasoningAliveIdleMs,
    toolCallIdleMs: 5_000,
    label: "self-test reasoning-keeps-turn-alive",
  });
  // Three reasoning events, each pushed WITHIN the previous one's own idle window — if a reasoning
  // event did not re-arm the window (the hazard this plan closes), the turn would have already
  // concluded after the FIRST window elapsed, well before this loop finishes.
  for (let i = 0; i < 3; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(reasoningAliveIdleMs / 2)));
    reasoningAliveSidecar.events.push({ type: "thinking", runId: "run-t38-reasoning-alive", text: `reasoning ${i}` });
    for (const watcher of reasoningAliveSidecar.turnWatchers) watcher();
  }
  const reasoningAliveResult = await reasoningAlivePromise;

  check(
    "[Plan 05-38, Task 1] a sequence of reasoning events keeps a turn alive past the caller's ordinary idle window",
    () => {
      assert.equal(reasoningAliveResult.endedBy, "idle");
      assert.equal(reasoningAliveResult.midFlight, undefined);
      assert.equal(reasoningAliveResult.thinkingCount, 3);
    },
  );

  // ---------------------------------------------------------------------------------------------
  // Plan 05-38 (Task 3, gap G-05-7): the frozen negative control — plan 05-25's own superseded
  // arming rule, proven to differ from the shipped rule over the same accumulated turn state.
  // ---------------------------------------------------------------------------------------------

  check(
    "[Plan 05-38, Task 3] the superseded arming rule stands the window down entirely on an outstanding tool call (only the ceiling backstops that state), while the shipped rule arms its own tool-call window",
    () => {
      const events = [{ type: "tool_call", runId: "run-t38-superseded", toolName: "Bash", toolUseId: "toolu_t38_sc" }];
      const partial = accumulateTurn(events, "run-t38-superseded", 0);
      assert.equal(partial.pendingToolCallCount, 1);
      const superseded = decideTurnArmedWindowSuperseded(partial, { idleMs: 100 });
      assert.equal(
        superseded.window,
        "none",
        "expected the superseded rule to stand the window down entirely — nothing left but the wall clock",
      );
      const shipped = decideTurnArmedWindow(partial, { idleMs: 100, toolCallIdleMs: 500 });
      assert.equal(shipped.window, "tool-call");
      assert.equal(shipped.ms, 500);
    },
  );

  check(
    "[Plan 05-38, Task 3] decideTurnArmedWindow (the shipped arming rule) arms the ordinary idle window once a chunk has been captured and nothing is pending, and arms nothing before either happens",
    () => {
      const chunkOnly = accumulateTurn([{ type: "assistant_text", runId: "run-t38-arming", text: "hi" }], "run-t38-arming", 0);
      const idleDecision = decideTurnArmedWindow(chunkOnly, { idleMs: 250, toolCallIdleMs: 999 });
      assert.equal(idleDecision.window, "idle");
      assert.equal(idleDecision.ms, 250);

      const nothingYet = accumulateTurn([], "run-t38-arming", 0);
      const noneDecision = decideTurnArmedWindow(nothingYet, { idleMs: 250, toolCallIdleMs: 999 });
      assert.equal(noneDecision.window, "none");
    },
  );

  check(
    "[Plan 05-38, Task 3] SCENARIOS contains works-continuously-past-old-deadline, built from repeated reasoning/tool-use/tool-result blocks each carrying a small delayMs",
    () => {
      assert.ok(
        Object.prototype.hasOwnProperty.call(SCENARIOS, "works-continuously-past-old-deadline"),
        "expected fake-authoring-claude.mjs to declare a works-continuously-past-old-deadline scenario",
      );
      const scenario = SCENARIOS["works-continuously-past-old-deadline"];
      const blocks = scenario.turns[0];
      const thinkingBlocks = blocks.filter((block) => block.type === "thinking");
      const toolUseBlocks = blocks.filter((block) => block.type === "tool_use");
      const toolResultBlocks = blocks.filter((block) => block.type === "tool_result");
      assert.ok(thinkingBlocks.length >= 2, "expected at least two reasoning blocks");
      assert.equal(toolUseBlocks.length, toolResultBlocks.length, "expected every tool_use to have its own matching tool_result");
      assert.ok(
        toolUseBlocks.every((block) => typeof block.id === "string" && block.id.length > 0),
        "expected every tool_use block to carry its own id",
      );
      for (const toolUse of toolUseBlocks) {
        assert.ok(
          toolResultBlocks.some((result) => result.tool_use_id === toolUse.id),
          `expected a tool_result matching tool_use id ${toolUse.id}`,
        );
      }
      const lastBlock = blocks[blocks.length - 1];
      assert.equal(lastBlock.type, "text");
      assert.ok(/\?/.test(lastBlock.text), "expected the final block to carry a question");
      const totalDelayMs = blocks.reduce((sum, block) => sum + (typeof block.delayMs === "number" ? block.delayMs : 0), 0);
      assert.ok(
        totalDelayMs > REPLAY_CONTINUOUS_WORK_CEILING_MS,
        `expected the scenario's own total delay (${totalDelayMs}ms) to comfortably exceed ` +
          `REPLAY_CONTINUOUS_WORK_CEILING_MS (${REPLAY_CONTINUOUS_WORK_CEILING_MS}ms)`,
      );
    },
  );

  // ---------------------------------------------------------------------------------------------
  // drainProposalsUntilQuiet (plan 05-46, gap G-05-9) — a stub sidecar whose `events` array grows
  // on a real timer, exercising the SAME function the live body calls. The two-burst fixture is
  // written FIRST: it is the fixture this defect's single-shot drain was always dodging.
  // ---------------------------------------------------------------------------------------------

  {
    const twoBurstStub = { events: [{ type: "proposal_created", id: "p1" }, { type: "proposal_created", id: "p2" }] };
    const twoBurstApplied = [];
    const twoBurstResultPromise = drainProposalsUntilQuiet(twoBurstStub, {
      applyEvent: (event) => twoBurstApplied.push(event.id),
      quietMs: 300,
      deadlineMs: 5_000,
      label: "self-test two-burst",
    });
    // The gap between bursts: longer than PROPOSAL_DRAIN_SCAN_TICK_MS (50ms — so the drain's own
    // loop gets at least one scan pass in between) but shorter than quietMs (300ms — so the drain
    // must NOT report "quiet" before the second burst ever arrives).
    await new Promise((resolve) => setTimeout(resolve, 150));
    twoBurstStub.events.push({ type: "proposal_created", id: "p3" }, { type: "other_event" }, { type: "proposal_created", id: "p4" });
    const twoBurstResult = await twoBurstResultPromise;

    check(
      "drainProposalsUntilQuiet collects both bursts separated in time, applies each event exactly once, and reports stoppedBy \"quiet\"",
      () => {
        assert.deepEqual(twoBurstApplied, ["p1", "p2", "p3", "p4"]);
        assert.equal(twoBurstResult.applied, 4);
        assert.equal(twoBurstResult.stoppedBy, "quiet");
        assert.equal(twoBurstResult.nextIndex, twoBurstStub.events.length);
      },
    );
  }

  {
    const neverQuietStub = { events: [] };
    let neverQuietCounter = 0;
    const neverQuietTimer = setInterval(() => {
      neverQuietCounter += 1;
      neverQuietStub.events.push({ type: "proposal_created", id: `forever-${neverQuietCounter}` });
    }, 40);
    const neverQuietApplied = [];
    const neverQuietResult = await drainProposalsUntilQuiet(neverQuietStub, {
      applyEvent: (event) => neverQuietApplied.push(event.id),
      quietMs: 10_000, // never reached — a new event lands well inside this window every 40ms
      deadlineMs: 300,
      label: "self-test never-quiet",
    });
    clearInterval(neverQuietTimer);

    check(
      "drainProposalsUntilQuiet returns on its deadline, rather than running forever, when events never stop arriving",
      () => {
        assert.equal(neverQuietResult.stoppedBy, "deadline");
        assert.ok(neverQuietApplied.length > 0, "expected at least one event to have been applied before the deadline fired");
      },
    );
  }

  {
    const oneBurstStub = { events: [{ type: "proposal_created", id: "only" }, { type: "some_other_event" }] };
    const oneBurstApplied = [];
    const oneBurstResult = await drainProposalsUntilQuiet(oneBurstStub, {
      applyEvent: (event) => oneBurstApplied.push(event.id),
      quietMs: 150,
      deadlineMs: 2_000,
      label: "self-test one-burst-no-duplicate",
    });

    check(
      "drainProposalsUntilQuiet applies exactly one event for a single burst with nothing else arriving, with no duplicate across passes",
      () => {
        assert.deepEqual(oneBurstApplied, ["only"]);
        assert.equal(oneBurstResult.applied, 1);
        assert.ok(oneBurstResult.passes >= 2, "expected more than one scan pass while waiting out the quiet window");
        assert.equal(oneBurstResult.stoppedBy, "quiet");
      },
    );
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

/**
 * Plan 260929-nxq (Task 1a): the sentence-fragment split boundary `extractOpenQuestions` uses to
 * recover interrogative fragments from a turn's own prose — and the IDENTICAL rule
 * `classifyWithheldConsent` (1c) reuses below, so the two functions cannot invent two different
 * notions of "a sentence" from the same prose. Widened from a bare `(?<=[?.!])\s+` to also
 * consume any closing markdown emphasis, quote or bracket character sitting between the sentence
 * terminator and the following whitespace — measured against turn 1 of run
 * `01M3P4VZCA1M0C37C8V7ZE72WG`: the bare separator saw ONE of the turn's five numbered, bolded
 * questions (`**1. Where does the board app actually live?**`), because `**` sat between the `?`
 * and the space the old pattern required. The terminator set itself (`[?.!]`) is UNCHANGED — a
 * numbered-list marker ("1.", "2." …) must keep being split off by the `.` terminator exactly as
 * before this plan.
 */
const QUESTION_FRAGMENT_SPLIT_PATTERN = /(?<=[?.!])[*_`"'’”)\]]*\s+/;

/** The same closing-markdown character class {@link QUESTION_FRAGMENT_SPLIT_PATTERN} consumes
 * between a terminator and trailing whitespace, applied here to a fragment's own TRAILING edge
 * before an `endsWith("?")` test — belt-and-braces for the fragment that ends the whole turn (no
 * trailing whitespace ever follows it, so the split pattern above never fires on it there), so
 * `…live?**` sitting at the very end of a turn's text reads as ending in `?` exactly like one that
 * ends mid-turn. */
const TRAILING_MARKDOWN_PATTERN = /[*_`"'’”)\]]*$/;

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
    // Plan 260929-nxq (Task 1g): narrowed. The bare `where` alternative used to claim ANY
    // question containing the word "where" — measured at planning time against turn 1's real
    // text, it mis-answered "Where does the board app actually live?" by claiming it was asking
    // where a notification surfaces. Now `where` only fires alongside an explicit notification
    // referent, never a bare location question.
    pattern: /surface|appear|show up|display|where (?:does|do|is|will) (?:it|this|a notification|the notification)/i,
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
  // Plan 260929-nxq (Task 1g): six new entries, each a concrete product decision covering a
  // question shape the widened extractor (1a/1b) now surfaces, matched to the exact fork this
  // agent actually raised in run 01M3P4VZCA1M0C37C8V7ZE72WG.
  {
    pattern: /where does the (?:board )?app(?:lication)? (?:actually )?live|is (?:this|it) greenfield|another repo/i,
    answer:
      "The board app lives in a separate repo from this one — this repo is the planning board of " +
      "record, not greenfield application code.",
  },
  {
    pattern: /which channels?\b|channels? (?:should|would|will|does)/i,
    answer: "In-app only for v1, with the data model built so email can be layered on later.",
  },
  {
    pattern: /what (?:actually )?(?:fires|triggers|pings)|what fires a notification/i,
    answer:
      "Only a run that needs the developer — a decision, a blocked permission, something it " +
      "can't resolve on its own — raises a notification. A clean, unattended finish does not.",
  },
  {
    pattern: /real-?time or (?:not|polling)|live push|websockets?|\bpoll(?:ing)?\b/i,
    answer: "Poll every ~30 seconds — no realtime transport (websockets/SSE) in v1.",
  },
  {
    pattern: /how much (?:user )?control|per-event-type toggles|quiet hours|mark[- ]all[- ]read/i,
    answer:
      "Read state plus mark-all-read only — no per-event-type toggles, per-board mute or quiet " +
      "hours in v1.",
  },
  {
    pattern: /attention router|activity log/i,
    answer:
      "Activity log — an immutable historical notification, not a live claim about present " +
      "state. A filtered board view (\"cards waiting on me\") is not a substitute for it: it " +
      "computes from state that already exists, which is a different product than what's being " +
      "asked for here.",
  },
];

/**
 * Plan 260929-nxq (Task 1c): every pattern requires a FIRST-PERSON statement about the agent's
 * own readiness — never a bare mention of advancing. Measured across all eight transcript blocks
 * of run `01M3P4VZCA1M0C37C8V7ZE72WG` plus seven hand-built negatives and five hand-built
 * positives: 1 true positive (the verbatim sentence from that run), 0 false positives. Two
 * earlier, looser pattern sets were discarded during planning because they tripped on *"I can't
 * stage anything yet, and only you can advance it"* (the agent describing the stage machine, not
 * withholding) and on the core's own criteria instruction *"Before we move on: call
 * `propose_assumption`…"* — both must read clear, and both are asserted as named negatives in
 * this file's self-test below.
 */
const WITHHELD_CONSENT_PATTERNS = [
  /\bi(?:'m| am) not ready to advance\b/i,
  /\bi(?:'d| would) rather not move on\b/i,
  /\bi don.t think (?:this|that|it) is settled\b/i,
  /\bnot settled enough to advance\b/i,
  /\b(?:this|that|it)(?:'s| is) not settled\b/i,
];

/**
 * Plan 260929-nxq (Task 1c): classify a withheld consent from the agent's OWN text only —
 * splitting on the same {@link QUESTION_FRAGMENT_SPLIT_PATTERN} `extractOpenQuestions` uses, so
 * this never invents a second notion of "a sentence" from the same prose. Returns `{ sentence,
 * patternSource }` for the first fragment matching any {@link WITHHELD_CONSENT_PATTERNS} entry,
 * or `null` when none matches (including an empty or non-string `text`).
 */
function classifyWithheldConsent(text) {
  if (typeof text !== "string" || text.length === 0) return null;
  const fragments = text
    .split(QUESTION_FRAGMENT_SPLIT_PATTERN)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);
  for (const fragment of fragments) {
    for (const pattern of WITHHELD_CONSENT_PATTERNS) {
      if (pattern.test(fragment)) {
        return { sentence: fragment, patternSource: pattern.source };
      }
    }
  }
  return null;
}

/**
 * Plan 260929-nxq (Task 1c): a THREE-valued reading of a single captured agent turn's own consent
 * to advance — `"withheld"` when {@link classifyWithheldConsent} matches, `"clear"` when the turn
 * carries real text and it does not match, and `"unreadable"` for a missing or empty turn text
 * (e.g. a timed-out capture). An absence of evidence is not consent — this register's own eighth
 * rule ("Assert reachability, not usage…") exists precisely because a zero that cannot distinguish
 * "would not" from "could not" gets read as "would not" every time; `"unreadable"` is that
 * distinction made explicit rather than silently folded into `"clear"`.
 */
function readAdvanceConsent(turnText) {
  if (typeof turnText !== "string" || turnText.trim().length === 0) return "unreadable";
  return classifyWithheldConsent(turnText) ? "withheld" : "clear";
}

/** The one turn sent when `MAX_AGENT_TURNS` is reached — a bounded, explicit, never-silent escape
 * (D-90: the developer holds the gate; this is the harness standing in for him deciding the
 * conversation is done, not the agent). Never coaches the model to challenge, push back or ask
 * clarifying questions, for the same reason every `ANSWER_BANK` entry does not. */
const CLOSING_TURN =
  "Those are my answers to everything you've asked so far. For anything still open, state your " +
  "own assumption explicitly and move on — we're not going back and forth any further on this.";

/** Plan 05-42 (gap G-05-8(a), Task 2): the fixed prefix of an option-selection reply line —
 * `composeDeveloperReply`'s answer for a question that carries offered options. Never itself
 * coaching text (asserted alongside `ANSWER_BANK_FALLBACK`/`CLOSING_TURN` in the forbidden-coaching
 * self-test check below): selecting an option the agent itself offered is answering, not
 * paraphrasing the question back at it. */
const OPTION_SELECTION_PREFIX = "Picking: ";

/**
 * From a completed `turn`, return the open questions in order, each `{ text, options }` —
 * `options` an array of offered label strings, empty for a prose-derived question. Every typed
 * `AskUserQuestion` prompt {@link questionsFromTurn} finds comes FIRST, in order, each entry's
 * `text` its own `question` and `options` its own offered labels in offered order; then the
 * interrogative fragments recovered from `turn.text` — a fragment ending in a question mark, split
 * on sentence-ish boundaries (any of `. ? !` followed by whitespace, which also splits a numbered
 * list's own newlines), exactly as before this plan — each carrying an empty `options`; the
 * combined list is then capped at {@link MAX_EXTRACTED_QUESTIONS}.
 *
 * Ordering is guaranteed WITHIN each source; tool-call questions come first because a tool call
 * precedes the trailing prose of the turn that issued it — this harness does not claim a merged
 * wire ordering it does not measure. This is a heuristic over the agent's own prose (for the
 * fragment half), not a parser — it does not understand embedded quotation, abbreviations or
 * rhetorical questions, and is not asked to.
 */
/**
 * Plan 260929-nxq (Task 1b): an anchored opener set recognising a question asked in the
 * IMPERATIVE, with no `?` character anywhere in it — measured against the second agent turn of
 * run `01M3P4VZCA1M0C37C8V7ZE72WG` ("I don't think this is settled enough to advance. Tell me:
 * attention router or activity log…"), whose entire text contains no `?` at all, so the old
 * `?`-only heuristic read it as settled. Anchored to the START of a stripped fragment (leading
 * markdown/ordinal noise removed by {@link stripLeadingNoise}) so it can never fire mid-sentence
 * on an incidental "tell me" buried inside a longer prose block.
 */
const REQUEST_FOR_INPUT_PATTERN =
  /^(tell me|let me know|say which|say so|which (?:one )?(?:do|would|should)|pick one|decide|choose|confirm whether)\b/i;

/** Strips leading whitespace, markdown emphasis/quote characters and a numbered-list ordinal
 * (e.g. "1." or "2)") from a fragment before it is tested against
 * {@link REQUEST_FOR_INPUT_PATTERN} — the same class of noise {@link
 * QUESTION_FRAGMENT_SPLIT_PATTERN}/{@link TRAILING_MARKDOWN_PATTERN} strip from the OTHER end of a
 * fragment, applied here to the front so a bolded, numbered imperative ask ("**3. Tell me…**")
 * reads the same as a bare one. */
function stripLeadingNoise(fragment) {
  return fragment
    .replace(/^[\s*_`"'‘“(]+/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/^[\s*_`"'‘“(]+/, "");
}

function extractOpenQuestions(turn) {
  const toolCallQuestions = questionsFromTurn(turn).map((prompt) => ({
    text: prompt.question,
    options: Array.isArray(prompt.options) ? prompt.options.map((option) => option.label) : [],
  }));

  const fragments = turn.text
    .split(QUESTION_FRAGMENT_SPLIT_PATTERN)
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.length > 0);

  const proseQuestions = fragments
    .filter((fragment) => fragment.replace(TRAILING_MARKDOWN_PATTERN, "").endsWith("?"))
    .map((fragment) => ({ text: fragment, options: [] }));

  // Task 1b: an imperative request for a decision is a question too — returned AFTER the prose
  // "?" questions and before the cap, de-duplicated against fragments already returned (a
  // fragment can be both).
  const seenFragmentTexts = new Set(proseQuestions.map((question) => question.text));
  const imperativeQuestions = [];
  for (const fragment of fragments) {
    if (seenFragmentTexts.has(fragment)) continue;
    if (REQUEST_FOR_INPUT_PATTERN.test(stripLeadingNoise(fragment))) {
      imperativeQuestions.push({ text: fragment, options: [] });
      seenFragmentTexts.add(fragment);
    }
  }

  // Task 1d: a turn whose text trips classifyWithheldConsent contributes AT MINIMUM one open
  // question whose text is the matched withholding sentence — so questions.length is never 0 for
  // such a turn, and driveChallengeConversation's settled branch needs no special case. Guaranteed
  // to survive the cap below even when the turn already carries MAX_EXTRACTED_QUESTIONS other
  // fragments — the withholding sentence is precisely the one thing the cap must never drop.
  const withheld = classifyWithheldConsent(turn.text);
  const withheldQuestions =
    withheld && !seenFragmentTexts.has(withheld.sentence) ? [{ text: withheld.sentence, options: [] }] : [];

  const combined = [...toolCallQuestions, ...proseQuestions, ...imperativeQuestions, ...withheldQuestions];
  if (withheldQuestions.length > 0 && combined.length > MAX_EXTRACTED_QUESTIONS) {
    const withoutWithheld = combined.slice(0, combined.length - 1);
    return [...withoutWithheld.slice(0, MAX_EXTRACTED_QUESTIONS - 1), withheldQuestions[0]];
  }
  return combined.slice(0, MAX_EXTRACTED_QUESTIONS);
}

/**
 * Compose a numbered developer reply to `questions` (each `{ text, options }`). For an entry with
 * NO options, select the first {@link ANSWER_BANK} entry whose pattern matches its `text`, else
 * {@link ANSWER_BANK_FALLBACK} — unchanged from before this plan. For an entry WITH options, the
 * answer line is {@link OPTION_SELECTION_PREFIX} followed by exactly one offered label, verbatim:
 * the first label matching an `ANSWER_BANK` pattern, else the first offered label.
 *
 * Every answer line is now an exact member of one of two fixed sets: the answer bank's values, or
 * the option labels the agent itself offered in that same turn — never a paraphrase or a quote of
 * the QUESTION text itself. Selecting an option is NOT the failure the rest of this rule guards
 * against: an option label is a choice the agent itself put on the table, and choosing one is the
 * entire semantics of answering it. What stays forbidden, and is asserted below, is echoing any
 * part of the question's own text.
 */
function composeDeveloperReply(questions) {
  const lines = questions.map(({ text, options }, index) => {
    if (Array.isArray(options) && options.length > 0) {
      const matched = options.find((label) => ANSWER_BANK.some(({ pattern }) => pattern.test(label)));
      const chosen = matched ?? options[0];
      return `${index + 1}. ${OPTION_SELECTION_PREFIX}${chosen}`;
    }
    const entry = ANSWER_BANK.find(({ pattern }) => pattern.test(text));
    const answer = entry ? entry.answer : ANSWER_BANK_FALLBACK;
    return `${index + 1}. ${answer}`;
  });
  return `${REPLY_PREAMBLE}\n${lines.join("\n")}`;
}

// ---------------------------------------------------------------------------------------------
// Quick task 260929-p61 — the developer answer source: the live arm asks the developer the
// agent's own extracted questions instead of composing a reply from ANSWER_BANK. Structurally
// unreachable from the three offline arms below (`--self-test`, `--board-read-check`,
// `--replay-check`), which keep composing from the bank exactly as before this task.
// ---------------------------------------------------------------------------------------------

/** The three offline arms' own flags, in the order they appear in this file — the single list
 * {@link assertLiveArm} refuses construction against, and the structural source-scan self-test
 * check (quick task 260929-p61) proves describes every offline arm in the file. Frozen so no
 * caller can mutate the list a fourth arm would need to extend. */
const OFFLINE_ARM_FLAGS = Object.freeze(["--self-test", "--board-read-check", "--replay-check"]);

/** Thrown by {@link assertLiveArm} when the supplied argv carries one of {@link
 * OFFLINE_ARM_FLAGS} — the developer answer source may only ever be constructed from the live
 * arm's own argv. */
export class LiveArmRequiredError extends Error {
  constructor(flag) {
    super(
      `createDeveloperAnswerSource refused construction: argv carries the offline flag "${flag}" ` +
        "— the developer prompt may only be reached from the live arm.",
    );
    this.name = "LiveArmRequiredError";
    this.flag = flag;
  }
}

/** Scans `argv` for any {@link OFFLINE_ARM_FLAGS} member and throws {@link LiveArmRequiredError}
 * naming the one it found. Takes `argv` as a parameter, defaulting to `process.argv` — the
 * parameter is what lets the self-test drive every offline flag against this guard without
 * mutating global state. Called FIRST, before anything else, by {@link
 * createDeveloperAnswerSource}. */
function assertLiveArm(argv = process.argv) {
  for (const flag of OFFLINE_ARM_FLAGS) {
    if (argv.includes(flag)) throw new LiveArmRequiredError(flag);
  }
}

/** The two provenance values `driveChallengeConversation` reports on its own `answerSource`
 * return field — declared once so neither the driver nor the live gates below can drift from a
 * retyped string. */
const ANSWER_SOURCE_BANK = "answer-bank";
const ANSWER_SOURCE_DEVELOPER = "developer";

/** The per-turn handoff deadline the no-TTY transport waits on — 30 minutes, because the
 * developer runs this gate backgrounded and needs real time to answer by hand, not a
 * machine-scale timeout. */
const HANDOFF_DEADLINE_MS = 30 * 60 * 1000;

/** How often the no-TTY transport polls for the matching answers file. */
const HANDOFF_POLL_MS = 5_000;

/** The fixed per-question marker a handoff sheet renders and {@link parseHandoffAnswers} parses
 * back — `ANSWER <n>: `. */
const HANDOFF_ANSWER_MARKER = "ANSWER";

/** Filename builders for the per-turn handoff files — embedding the turn number is the mechanism
 * that stops turn N from ever consuming turn N-1's stale answers file (T-p61-02). */
function handoffQuestionsFileName(turnNumber) {
  return `challenge-turn-${turnNumber}-questions.md`;
}
function handoffAnswersFileName(turnNumber) {
  return `challenge-turn-${turnNumber}-answers.md`;
}

/** Thrown by {@link parseHandoffAnswers} when a completed handoff sheet is malformed — its
 * message names the specific defect (a missing marker, a duplicate marker, an empty answer, or an
 * out-of-range ordinal) so a developer editing the file by hand knows exactly what to fix. A
 * malformed file keeps the no-TTY transport polling; only the deadline turns this into a thrown
 * run failure (Task 1's own design decision 4). */
export class HandoffParseError extends Error {
  constructor(message) {
    super(message);
    this.name = "HandoffParseError";
  }
}

/**
 * Pure: renders the per-turn handoff sheet a developer fills in by hand when the live arm runs
 * with no TTY. Every extracted question renders verbatim and numbered exactly as it will be
 * answered, followed by one `ANSWER n: ` marker line per question. No filesystem or process
 * access.
 */
function renderHandoffQuestionsSheet({ runId, turnNumber, questions }) {
  const questionLines = questions.map((question, index) => `${index + 1}. ${question.text}`).join("\n");
  const markerLines = questions
    .map((_question, index) => `${HANDOFF_ANSWER_MARKER} ${index + 1}: `)
    .join("\n");
  return (
    `# Challenge turn ${turnNumber} — developer answers needed\n\n` +
    `**Run:** ${runId}\n\n` +
    "The agent asked the questions below, verbatim and numbered. Fill in one `ANSWER n:` line per " +
    "question below, save this file, and write your answers to this turn's own answers file (named " +
    "in the harness scrollback) — the run polls for it.\n\n" +
    `## Questions\n\n${questionLines}\n\n` +
    `## Your answers\n\n${markerLines}\n`
  );
}

/**
 * Pure: parses a completed handoff sheet's `text`, returning the ordered answer strings for
 * `questionCount` questions. Throws {@link HandoffParseError} naming the specific defect: a
 * missing marker for some ordinal, a duplicate marker for some ordinal, an empty answer after a
 * marker, or a marker whose ordinal exceeds `questionCount`.
 */
function parseHandoffAnswers(text, questionCount) {
  const markerPattern = new RegExp(`^${HANDOFF_ANSWER_MARKER}\\s+(\\d+):\\s?(.*)$`);
  const found = new Map();
  for (const rawLine of text.split("\n")) {
    const match = markerPattern.exec(rawLine.trim());
    if (!match) continue;
    const ordinal = Number(match[1]);
    const value = match[2].trim();
    if (ordinal < 1 || ordinal > questionCount) {
      throw new HandoffParseError(
        `handoff answers carry marker "${HANDOFF_ANSWER_MARKER} ${ordinal}:" but only ` +
          `${questionCount} question(s) were asked`,
      );
    }
    if (found.has(ordinal)) {
      throw new HandoffParseError(`handoff answers carry a duplicate marker for question ${ordinal}`);
    }
    found.set(ordinal, value);
  }
  const answers = [];
  for (let ordinal = 1; ordinal <= questionCount; ordinal += 1) {
    if (!found.has(ordinal)) {
      throw new HandoffParseError(`handoff answers are missing the marker for question ${ordinal}`);
    }
    const value = found.get(ordinal);
    if (value.length === 0) {
      throw new HandoffParseError(`handoff answers carry an empty answer for question ${ordinal}`);
    }
    answers.push(value);
  }
  return answers;
}

/**
 * Constructs the developer answer source — the ONE construction site for this whole file is the
 * live body, below. Refuses construction via {@link assertLiveArm} before anything else, so a
 * caller that somehow reached this factory from an offline arm's own argv still gets refused.
 * Every dependency is injectable so the self-test can drive this function directly, with no real
 * TTY, no real filesystem timing and no real process argv.
 *
 * Returns `{ name, answerQuestions }`: `name` is {@link ANSWER_SOURCE_DEVELOPER}, and
 * `answerQuestions(questions)` returns a `Promise<string>` shaped exactly like {@link
 * composeDeveloperReply}'s own return value (the fixed `REPLY_PREAMBLE`, then one numbered line
 * per question carrying the developer's own answer, verbatim) — that shape is load-bearing, since
 * the exchange record, the evidence sheet and the fallback counter all read it.
 *
 * With a TTY (`isTty` truthy): prints every question first, verbatim and numbered, then prompts
 * once per question in order, in the style of `uat-09-product-kill-criterion.mjs`'s own
 * `askLine`. An answer that trims to empty throws, naming the ordinal.
 *
 * With no TTY (the developer's backgrounded shell — the PRIMARY path, not the edge case): writes
 * this turn's own questions sheet under `handoffDir`, logs its path and the answers path the
 * developer must create, then polls for the matching answers file every `pollMs` until
 * `deadlineMs` elapses. A read that parses yields the answers. A read that throws a {@link
 * HandoffParseError} is logged only when its message differs from the last logged one, and
 * polling continues — the developer is editing this file by hand while the run waits, and a
 * half-saved file must not kill the run. Reaching the deadline throws a named error carrying the
 * last parse defect when one was seen, or stating that no answers file ever appeared when none
 * was.
 */
function createDeveloperAnswerSource({
  argv = process.argv,
  isTty = process.stdin.isTTY,
  handoffDir,
  runId,
  deadlineMs = HANDOFF_DEADLINE_MS,
  pollMs = HANDOFF_POLL_MS,
  log = () => {},
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  assertLiveArm(argv);
  let turnNumber = 0;

  async function askOnTty(questions) {
    questions.forEach((question, index) => {
      console.log(`${index + 1}. ${question.text}`);
    });
    const answers = [];
    for (let index = 0; index < questions.length; index += 1) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      // eslint-disable-next-line no-await-in-loop -- one prompt per question, in order, by design.
      const raw = await new Promise((resolve) => {
        rl.question(`Answer ${index + 1}: `, (answer) => {
          rl.close();
          resolve(answer);
        });
      });
      const trimmed = raw.trim();
      if (trimmed.length === 0) {
        throw new Error(`developer answer source: empty answer given for question ${index + 1}`);
      }
      answers.push(trimmed);
    }
    return answers;
  }

  async function askOverHandoff(questions, thisTurn) {
    const questionsPath = path.join(handoffDir, handoffQuestionsFileName(thisTurn));
    const answersPath = path.join(handoffDir, handoffAnswersFileName(thisTurn));
    fs.writeFileSync(questionsPath, renderHandoffQuestionsSheet({ runId, turnNumber: thisTurn, questions }));
    log(
      `developer answers needed for challenge turn ${thisTurn} — questions written to ` +
        `${questionsPath}; write your answers to ${answersPath} (one ANSWER n: line per question) ` +
        `before the deadline`,
    );

    const deadline = Date.now() + deadlineMs;
    let lastParseMessage = null;
    for (;;) {
      if (fs.existsSync(answersPath)) {
        try {
          const text = fs.readFileSync(answersPath, "utf8");
          return parseHandoffAnswers(text, questions.length);
        } catch (err) {
          if (!(err instanceof HandoffParseError)) throw err;
          if (err.message !== lastParseMessage) {
            log(`developer answers file at ${answersPath} did not parse yet: ${err.message}`);
            lastParseMessage = err.message;
          }
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(
          lastParseMessage
            ? `developer answer source: deadline reached waiting for ${answersPath} — last parse ` +
                `defect: ${lastParseMessage}`
            : `developer answer source: deadline reached — no answers file ever appeared at ${answersPath}`,
        );
      }
      // eslint-disable-next-line no-await-in-loop -- polling is the whole point of this loop.
      await sleep(pollMs);
    }
  }

  async function answerQuestions(questions) {
    turnNumber += 1;
    const thisTurn = turnNumber;
    const answers = isTty ? await askOnTty(questions) : await askOverHandoff(questions, thisTurn);
    const lines = answers.map((answer, index) => `${index + 1}. ${answer}`);
    return `${REPLY_PREAMBLE}\n${lines.join("\n")}`;
  }

  return { name: ANSWER_SOURCE_DEVELOPER, answerQuestions };
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
 * nonConversation }`: `exchanges` is the ordered agent/developer record from THIS function's own
 * loop (the caller's own opening turn is not part of it); `cursor` is the final event-buffer
 * watermark reached; `nonConversation` (plan 05-24's `refusal` field, RENAMED and generalised by
 * plan 05-34/G-05-6) is `null` unless a captured agent turn was classified as non-conversation
 * ({@link classifyNonConversationTurn}, riding through `accumulateTurn`/`waitForTurn`), in which
 * case it is that turn's own classification object and the loop stopped at that turn — never
 * `undefined`, so a caller testing this field cannot pass by accident on a typo.
 *
 * A non-conversation turn stops the loop IMMEDIATELY, before `extractOpenQuestions` runs and
 * before any developer turn is composed or sent — a non-conversation message is a backend-level
 * error, not a real reply, and there is nothing in it worth extracting a question from. Returning
 * rather than throwing is deliberate and matches this phase's own standing discipline: a failed
 * capture reports what it DID capture (the turns already accumulated in `exchanges` are never
 * discarded).
 *
 * A turn wait that REJECTS (plan 05-36, gap G-05-7) — most commonly a {@link TurnDeadlineError}
 * from a wall-clock deadline, but any rejection is handled the same way — is different again: it
 * is not a backend reply at all, so there is nothing to return normally. The whole loop body is
 * wrapped in a try/catch for exactly this; on catch, this function throws
 * {@link ConversationAbortedError} carrying the exchanges it had already accumulated PLUS, when
 * the caught error itself carries a `partial` capture with a non-zero chunk count (a
 * {@link TurnDeadlineError}'s own field), one final recovered agent exchange built from that
 * partial — appended LAST, after every exchange that completed before it. Never swallowed: the
 * caller must still fail the run, exactly as a bare rejection always did.
 */

/**
 * Plan 05-36 (gap G-05-7): thrown by {@link driveChallengeConversation} when its own turn wait
 * rejects — see that function's own doc comment for the full mechanism. Carries `cause` (the
 * original error), `exchanges` (the driver's own accumulated array, including the recovered
 * partial entry when one exists), `agentTurns`, `answeredQuestionCount` and `closingTurnSent` — a
 * partial capture that escapes only as a thrown message is a capture that cannot be written to an
 * evidence sheet, which is exactly what destroyed live run `01M3C48C3PV1NSGHERBZ587YB1`.
 */
export class ConversationAbortedError extends Error {
  constructor(cause, { exchanges, agentTurns, answeredQuestionCount, closingTurnSent }) {
    super(`driveChallengeConversation aborted: ${cause?.message ?? String(cause)}`);
    this.name = "ConversationAbortedError";
    this.cause = cause;
    this.exchanges = exchanges;
    this.agentTurns = agentTurns;
    this.answeredQuestionCount = answeredQuestionCount;
    this.closingTurnSent = closingTurnSent;
  }
}

async function driveChallengeConversation({
  sidecar,
  runId,
  sendTurn,
  cursor,
  turnDeadlineMs = LIVE_TURN_CEILING_MS,
  idleMs,
  // Plan 05-38 (Task 3): threaded through exactly like `idleMs` above — `undefined` (every call
  // site before this plan) inherits `waitForTurn`'s own default (`LIVE_TOOL_CALL_IDLE_MS`), so no
  // pre-existing caller's behaviour changes. Exists so the `works-continuously-past-old-deadline`
  // replay-check scenario can pass an explicit mid-flight window comfortably above its own gaps.
  toolCallIdleMs,
  maxAgentTurns = MAX_AGENT_TURNS,
  // Quick task 260929-p61: optional. Absent (every pre-existing caller) means the answer bank,
  // as before; supplied means the developer's own words. Reported under `answerSource` on all
  // three of this function's return objects below, so neither caller drifts on which one fired.
  answerQuestions,
}) {
  const waitOpts = (label) => ({
    timeoutMs: turnDeadlineMs,
    ...(idleMs !== undefined ? { idleMs } : {}),
    ...(toolCallIdleMs !== undefined ? { toolCallIdleMs } : {}),
    label,
  });
  const answerSourceValue = typeof answerQuestions === "function" ? ANSWER_SOURCE_DEVELOPER : ANSWER_SOURCE_BANK;

  const exchanges = [];
  let agentTurns = 0;
  let answeredQuestionCount = 0;
  let closingTurnSent = false;
  let settled = false;
  let nextCursor = cursor;
  let finalCursor = cursor;
  // Plan 260929-nxq (Task 1e): how many composed answer lines, across the WHOLE conversation,
  // were exactly ANSWER_BANK_FALLBACK — counted from the composed reply string itself so
  // composeDeveloperReply keeps its signature and every existing caller byte-identical.
  let fallbackAnswerCount = 0;

  // Plan 260929-nxq (Task 1e): the LAST captured agent turn's own consent reading — "last, not
  // any": an agent that withheld at turn 2 and stopped withholding at turn 4 got what it needed,
  // and that run is clean.
  const deriveConsent = () => {
    const lastAgentExchange = [...exchanges].reverse().find((exchange) => exchange.speaker === "agent");
    const consentReading = readAdvanceConsent(lastAgentExchange?.text);
    const consentWithheldSentence =
      consentReading === "withheld" ? classifyWithheldConsent(lastAgentExchange.text).sentence : null;
    return { consentReading, consentWithheldSentence };
  };

  for (;;) {
    try {
      const turn = await sidecar.waitForTurn(
        runId,
        nextCursor,
        waitOpts(`driveChallengeConversation agent turn ${agentTurns + 1}`),
      );
      agentTurns += 1;
      exchanges.push(buildAgentExchange(turn));
      finalCursor = turn.endIndex;

      if (turn.nonConversation) {
        return {
          exchanges,
          settled: false,
          agentTurns,
          answeredQuestionCount,
          closingTurnSent,
          cursor: finalCursor,
          nonConversation: turn.nonConversation,
          fallbackAnswerCount,
          answerSource: answerSourceValue,
          ...deriveConsent(),
        };
      }

      const questions = extractOpenQuestions(turn);
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
        exchanges.push(buildAgentExchange(closingReply));
        finalCursor = closingReply.endIndex;
        closingTurnSent = true;
        settled = false;
        if (closingReply.nonConversation) {
          return {
            exchanges,
            settled,
            agentTurns,
            answeredQuestionCount,
            closingTurnSent,
            cursor: finalCursor,
            nonConversation: closingReply.nonConversation,
            fallbackAnswerCount,
            answerSource: answerSourceValue,
            ...deriveConsent(),
          };
        }
        break;
      }

      // Quick task 260929-p61: an injected answerQuestions is awaited in place of the bank's
      // synchronous composeDeveloperReply — an await over the synchronous default changes nothing
      // for it. Everything else in this loop (cursor discipline, closing-turn branch, withheld-
      // consent derivation, fallback counting) is untouched.
      const reply = answerQuestions ? await answerQuestions(questions) : composeDeveloperReply(questions);
      answeredQuestionCount += questions.length;
      fallbackAnswerCount += reply
        .split("\n")
        .slice(1)
        .filter((line) => line.replace(/^\d+\.\s/, "") === ANSWER_BANK_FALLBACK).length;
      const sendCursor = sidecar.eventCursor();
      await sendTurn(reply);
      exchanges.push({ speaker: "developer", text: reply, cursor: sendCursor });
      nextCursor = sendCursor;
    } catch (err) {
      // Plan 05-36 (gap G-05-7): a rejected turn wait is not a backend reply — surrender what was
      // already accumulated rather than let it vanish into a thrown message string. When the
      // caught error itself carries a partial capture with real content (a TurnDeadlineError's own
      // `partial` field), reconstruct one final agent exchange from it and append it LAST, after
      // every exchange that completed before it — never a second throw, never a fabricated entry
      // when nothing was captured.
      const recoveredExchanges = [...exchanges];
      if (err?.partial && err.partial.chunkCount > 0) {
        recoveredExchanges.push(buildAgentExchange(err.partial, { endedBy: "turn-deadline" }));
      }
      throw new ConversationAbortedError(err, {
        exchanges: recoveredExchanges,
        agentTurns,
        answeredQuestionCount,
        closingTurnSent,
      });
    }
  }

  return {
    exchanges,
    settled,
    agentTurns,
    answeredQuestionCount,
    closingTurnSent,
    cursor: finalCursor,
    nonConversation: null,
    fallbackAnswerCount,
    answerSource: answerSourceValue,
    ...deriveConsent(),
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

/**
 * Plan 05-42 (gap G-05-8(a)): the typed `AskUserQuestion` prompts a captured turn's tool calls
 * carried, in emitted order — read ONLY from `turn.toolCalls` (`ToolCallEvent.questions`, plan
 * 05-41's adapter-seam field). Returns `[]` for a turn with no `toolCalls`, no `toolCalls` entries
 * whose `toolName` is `AskUserQuestion`, or an `AskUserQuestion` entry whose payload did not parse
 * (so `questions` is absent on that event). NEVER parses raw text, stderr or a session log — the
 * payload arrives typed from the adapter seam, and reconstructing it here would be the exact
 * wrong-layer fix `scripts/uat/README.md` Item 8's fourth rule forbids.
 */
export function questionsFromTurn(turn) {
  const toolCalls = Array.isArray(turn?.toolCalls) ? turn.toolCalls : [];
  const prompts = [];
  for (const call of toolCalls) {
    if (call?.toolName !== "AskUserQuestion") continue;
    if (!Array.isArray(call.questions) || call.questions.length === 0) continue;
    prompts.push(...call.questions);
  }
  return prompts;
}

/**
 * Plan 05-42 (gap G-05-8(a)): the ONE place an agent exchange object is constructed from a
 * captured turn — `speaker: "agent"`, `text`/`chunkCount`/`charCount`/`endedBy`/`endIndex` read
 * straight from `turn`, `nonConversation` defaulting to `null`, and `questions` (the typed prompts
 * {@link questionsFromTurn} returns) spread in ONLY when non-empty — absent entirely otherwise, the
 * same present-or-absent discipline `nonConversation`/`credentialPath` already follow in
 * `renderChallengeEvidenceSheet`. `overrides` lets a call site force a field (the timeout paths
 * pass `{ endedBy: "timeout" }` / `{ endedBy: "turn-deadline" }`) without reconstructing the rest.
 *
 * Exists because nine separate literal exchange objects — three in `driveChallengeConversation`,
 * several in `runReplayCheckScenario`'s own scenario branches, and two in the live arm's inline
 * callback — had to stay in sync by hand, which is exactly how the NF-01 duplicate-turn defect
 * happened. Adding a sixth field (`questions`) to every one of those sites by hand would be the
 * same bet again.
 */
export function buildAgentExchange(turn, overrides = {}) {
  const exchange = {
    speaker: "agent",
    text: turn.text,
    chunkCount: turn.chunkCount,
    charCount: turn.charCount,
    endedBy: turn.endedBy,
    endIndex: turn.endIndex,
    nonConversation: turn.nonConversation ?? null,
    ...overrides,
  };
  const questions = questionsFromTurn(turn);
  if (questions.length > 0) exchange.questions = questions;
  return exchange;
}

/**
 * Plan 05-36 (Task 3, 05-REVIEW.md WR-01): whether the replay arm's advance-stage gate must be
 * SKIPPED for this scenario — derived from the categorical fact `driveChallengeConversation`
 * already returns (`conversation.nonConversation`, never `undefined` — see that function's own
 * doc comment), never from a scenario's own name. Citing D-90: the developer alone opens the
 * advance-stage gate, and a gate opened on an unfinished conversation is exactly the failure this
 * branch exists to catch. Citing D-89: advancing is what distils the conversation into staged
 * proposals, which is meaningful only once the conversation has actually finished — a
 * non-conversation turn means it did not. Exported (rather than left inline) so `--self-test` can
 * assert both directions directly, with no sidecar involved.
 */
export function conversationStoppedOnNonConversationTurn(conversation) {
  return conversation.nonConversation !== null && conversation.nonConversation !== undefined;
}

/**
 * Plan 05-36 (gap G-05-7): the ONE function in this file that performs a filesystem write of the
 * evidence sheet. Every write site in the live body funnels through here instead of calling
 * `fs.writeFileSync` directly, so no future failure shape can be added that bypasses it — the
 * defect this whole plan closes was exactly a write site sitting downstream of a call that could
 * throw. Takes a single mutable state object carrying `evidencePath`, `runId`, `openingPrompt`,
 * `conversation`, `noWorkPlannedReading`, `draftedCriteriaCount`, `amendedCriteriaCount`,
 * `criteriaReachabilityReading`, `criteriaDrainStoppedBy` (plan 05-46, gap G-05-9),
 * `proposalListVerdict` (plan 05-49, Task 3, G-05-10 `missing[3]`), `results`, `credentialPath`,
 * `nonConversation` and `failure`.
 *
 * Tolerates a `conversation` of `null` or `undefined` by treating it as a conversation with zero
 * exchanges — a run that died before `driveChallengeConversation` ever returned still gets the
 * opening prompt and the failure cause written, never a throw from this function itself.
 *
 * NEVER THROWS: a writer that throws while recording a failure would destroy the failure it was
 * recording, which is worse than a missing sheet. A write error is reported on stderr and this
 * function simply returns.
 */
export function writeChallengeEvidence(state) {
  try {
    const exchanges = buildEvidenceExchanges({
      openingPrompt: state.openingPrompt,
      conversation: state.conversation ?? { exchanges: [] },
    });
    const sheet = renderChallengeEvidenceSheet({
      runId: state.runId,
      exchanges,
      noWorkPlannedReading: state.noWorkPlannedReading,
      draftedCriteriaCount: state.draftedCriteriaCount,
      amendedCriteriaCount: state.amendedCriteriaCount,
      criteriaReachabilityReading: state.criteriaReachabilityReading,
      criteriaDrainStoppedBy: state.criteriaDrainStoppedBy,
      proposalListVerdict: state.proposalListVerdict,
      results: state.results,
      timestamp: new Date().toISOString(),
      nonConversation: state.nonConversation ?? null,
      credentialPath: state.credentialPath ?? null,
      failure: state.failure ?? null,
      // Quick task 260929-p61: read straight off the returned conversation, the same place every
      // other conversation-derived field on this call (noWorkPlannedReading and friends) is
      // assigned from — `state.conversation` already carries it, since the live body assigns the
      // driver's whole return object there verbatim.
      answerSource: state.conversation?.answerSource ?? ANSWER_SOURCE_BANK,
    });
    fs.writeFileSync(state.evidencePath, sheet);
    step(`wrote challenge evidence sheet: ${state.evidencePath}`);
  } catch (err) {
    process.stderr.write(`[uat-08] failed to write the challenge evidence sheet (continuing): ${String(err)}\n`);
  }
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

/** Plan 05-46 (gap G-05-9): the propose-tool fragment {@link readCriteriaReachability} filters
 * propose attempts by, specifically — never the broader {@link PROPOSE_TOOL_NAME_FRAGMENT}, which
 * also matches `propose_task`/`propose_assumption`. Named for the same reason that constant is. */
const PROPOSE_CRITERION_TOOL_NAME_FRAGMENT = "propose_criterion";

/** Plan 05-46 (gap G-05-9): the tool-name fragment {@link readCriteriaReachability} scans for to
 * detect that the agent read a staged proposal's id back — plan 05-44's `proposal_list` tool.
 * Named for the same reason {@link PROPOSE_CRITERION_TOOL_NAME_FRAGMENT} above is. */
const PROPOSAL_LIST_TOOL_NAME_FRAGMENT = "proposal_list";

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
 * Plan 05-46 (gap G-05-9): the reachability reading the gap asked for BY NAME — distinguishing a
 * `Drafted criteria: 0` reading caused by the agent CHOOSING not to draft from one caused by the
 * agent being STRUCTURALLY UNABLE to. Computed over `events` in `window` (`{ runId, fromIndex,
 * toIndex }`, delegated verbatim to {@link correlateProposeAttempts} — the SAME required-window
 * discipline CR-01 already established for `readNoWorkPlanned`, for the identical reason: an
 * unscoped reading here could see a LATER stage's own legitimate activity and misclassify it).
 *
 * Four values, checked in this order:
 * - `"drafted"` — `draftedCriteriaCount` (the caller's own `list-pending` count, never re-derived
 *   from the event stream here — `list-pending`'s real database snapshot is this harness's one
 *   source of truth for what actually landed) is greater than zero.
 * - `"blocked"` — otherwise, at least one `propose_criterion` attempt in `window`, paired by the
 *   wire's own correlation id through the EXISTING {@link correlateProposeAttempts} (never a second
 *   pairing scheme — six consecutive rounds of this phase shipped a criterion that could not report
 *   a genuine result, every one of them building a new correlation mechanism), was refused.
 * - `"declined"` — otherwise, a `tool_call` naming {@link PROPOSAL_LIST_TOOL_NAME_FRAGMENT} appears
 *   in `window` (the agent read a staged proposal's id back) and nothing above already returned.
 * - `"not-attempted"` — otherwise: no `propose_criterion` attempt and no `proposal_list` call at
 *   all in `window`.
 *
 * NEVER fails the run on any value — a zero count is a REPORTED reading; the developer judges
 * whether zero drafted criteria after `"declined"` is a legitimate judgement call or a prompting gap.
 */
function readCriteriaReachability(events, window, { draftedCriteriaCount }) {
  if (draftedCriteriaCount > 0) return "drafted";

  const criteriaAttempts = correlateProposeAttempts(events, window).filter((attempt) =>
    attempt.toolName.includes(PROPOSE_CRITERION_TOOL_NAME_FRAGMENT),
  );
  if (criteriaAttempts.some((attempt) => attempt.correlatable && attempt.refused)) return "blocked";

  const { runId, fromIndex, toIndex } = window;
  let sawProposalListCall = false;
  for (let i = fromIndex; i < toIndex; i += 1) {
    const event = events[i];
    if (event.runId !== runId) continue;
    if (
      event.type === "tool_call" &&
      typeof event[TOOL_NAME_FIELD] === "string" &&
      event[TOOL_NAME_FIELD].includes(PROPOSAL_LIST_TOOL_NAME_FRAGMENT)
    ) {
      sawProposalListCall = true;
      break;
    }
  }
  if (sawProposalListCall) return "declined";
  return "not-attempted";
}

/** Plan 05-49 (Task 3, G-05-10 `missing[3]`): the six write-verb tool-name fragments
 * {@link assertProposalListNonEmptyInTurn} treats as a "staging call" — every verb whose
 * successful staging result now carries a `proposalId` (plan 05-48). Named as its own array,
 * rather than reusing the broader {@link PROPOSE_TOOL_NAME_FRAGMENT} alone, because `amend_` and
 * `delete_` calls also resolve with a `proposalId` and must count here too. */
const STAGING_VERB_TOOL_NAME_FRAGMENTS = Object.freeze([
  "propose_task",
  "propose_epic",
  "propose_criterion",
  "propose_assumption",
  "amend_proposal",
  "delete_proposal",
]);

/** Plan 05-49 (Task 3): the fail-closed ALLOW-list of {@link assertProposalListNonEmptyInTurn}
 * verdicts that may pass the SHAPE-03/SHAPE-04 criterion — mirrors {@link
 * PASSING_NO_WORK_READINGS}'s own allow-list discipline exactly (never a deny-list a future,
 * unanticipated verdict could pass by accident). Only `"satisfied"` (a later `proposal_list`
 * returned rows) and `"not-applicable"` (no staging call, or no `proposal_list` call, in this
 * turn) pass; `"violated"` and `"unknown"` do not. */
const PASSING_PROPOSAL_LIST_VERDICTS = new Set(["satisfied", "not-applicable"]);

/**
 * Plan 05-49 (Task 3, G-05-10 `missing[3]`): the live-path assertion the gap names by hand —
 * `proposal_list` returning empty inside the SAME turn as a successful staging call is a NAMED,
 * gating failure, not something only a human reading `05-LIVE-CHALLENGE-TRANSCRIPT.md` would
 * notice (turn 6's own live capture is exactly this failure). Pure: `turn` is a plain array of this
 * ONE turn's own raw sidecar events (`tool_call`/`tool_result`, in ascending order — the same shape
 * a caller already has as a slice of `sidecar.events`), so a self-test can drive this with a
 * synthetic array and no live run, timer or child process at all.
 *
 * Correlates every `tool_result` in `turn` to its own `tool_call` via {@link CORRELATION_ID_FIELD}
 * — the SAME exact-lookup key {@link correlateProposeAttempts} uses, never a second pairing scheme
 * — then scans `turn`'s tool calls in order:
 * - A call whose name matches {@link STAGING_VERB_TOOL_NAME_FRAGMENTS} and whose correlated result
 *   parses to an object carrying a string `proposalId` marks `sawStagedProposal`.
 * - Once `sawStagedProposal` is true, a LATER call naming {@link PROPOSAL_LIST_TOOL_NAME_FRAGMENT}
 *   marks `sawProposalListCall` and inspects its own correlated result's `proposals` field:
 *   - not an array at all (missing correlation id, unparsable result, or a `proposals` field that
 *     is absent or the wrong shape) → returns `"unknown"` immediately — a verdict that cannot be
 *     determined is never silently folded into a pass.
 *   - an array of length zero → returns `"violated"` immediately — the exact defect this task
 *     closes.
 *   - a non-empty array → keeps scanning (a LATER `proposal_list` call in the same turn could still
 *     be empty).
 *
 * Returns `"not-applicable"` when the turn has no staging call, or a staging call but no
 * `proposal_list` call at all — the turn simply does not exercise this property either way.
 * Returns `"satisfied"` when at least one staging call and at least one later `proposal_list` call
 * exist, and every such `proposal_list` call in the turn returned a non-empty array.
 */
function assertProposalListNonEmptyInTurn(turn) {
  if (!Array.isArray(turn)) {
    throw new TypeError(
      "assertProposalListNonEmptyInTurn requires an array of this turn's own tool_call/tool_result events",
    );
  }

  const resultBodyById = new Map();
  for (const event of turn) {
    if (event?.type !== "tool_result") continue;
    const id = event[CORRELATION_ID_FIELD];
    if (typeof id !== "string" || id.length === 0) continue;
    if (resultBodyById.has(id)) continue;
    let parsed;
    try {
      parsed = typeof event.output === "string" ? JSON.parse(event.output) : event.output;
    } catch {
      parsed = undefined;
    }
    resultBodyById.set(id, parsed);
  }

  const bodyFor = (event) => {
    const id = event[CORRELATION_ID_FIELD];
    return typeof id === "string" ? resultBodyById.get(id) : undefined;
  };

  let sawStagedProposal = false;
  let sawProposalListCall = false;

  for (const event of turn) {
    if (event?.type !== "tool_call" || typeof event[TOOL_NAME_FIELD] !== "string") continue;
    const name = event[TOOL_NAME_FIELD];

    if (STAGING_VERB_TOOL_NAME_FRAGMENTS.some((fragment) => name.includes(fragment))) {
      const body = bodyFor(event);
      if (body !== undefined && typeof body === "object" && typeof body.proposalId === "string") {
        sawStagedProposal = true;
      }
      continue;
    }

    if (!sawStagedProposal || !name.includes(PROPOSAL_LIST_TOOL_NAME_FRAGMENT)) continue;

    sawProposalListCall = true;
    const body = bodyFor(event);
    const proposals = body !== undefined && typeof body === "object" ? body.proposals : undefined;
    if (!Array.isArray(proposals)) return "unknown";
    if (proposals.length === 0) return "violated";
  }

  if (!sawStagedProposal || !sawProposalListCall) return "not-applicable";
  return "satisfied";
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

/** Plan 05-46 (gap G-05-9): the internal scan tick {@link drainProposalsUntilQuiet} sleeps between
 * passes — never a literal at its own call site. Deliberately small and NOT derived from a caller's
 * `quietMs`/`deadlineMs`, so a self-test fixture can choose its own quiet/deadline windows freely
 * without also having to reason about their relationship to the tick. */
const PROPOSAL_DRAIN_SCAN_TICK_MS = 50;

/**
 * Plan 05-46 (gap G-05-9): implements the window the OLD single-pass loop's own comment always
 * promised and the code never built — proposals now arrive across more than one stage window (the
 * decompose stage's distillation proposals, and, once Task 2 opens a second stage window, the
 * criteria stage's proposals too), so a single pass over `sidecar.eventsOfType("proposal_created")`
 * structurally cannot collect them. This is the gap's `superseded_root_cause` becoming load-bearing.
 *
 * Deliberately NOT built out of repeated `waitForEvent` calls: `waitForEvent` scans already-received
 * events FIRST (see its own doc comment in `sidecar-harness.mjs`), so a second call made after the
 * first `proposal_created` already arrived would resolve INSTANTLY on that same already-applied
 * event — a `waitForEvent`-based re-drain loop never actually re-arms. A watermark scanned forward
 * over the raw `sidecar.events` array is the only shape that does.
 *
 * `applyEvent` is invoked EXACTLY ONCE per matching event, in ascending index order, however many
 * scan passes see it — the watermark advances past every index a pass examines, so no later pass
 * can ever re-offer an index the watermark has already crossed. Mirrors `drainInboundCoreRequests`'s
 * own once-only idiom (a `seen` Set there, a plain integer cursor here, since `sidecar.events` is
 * append-only and never re-orders or re-emits an entry the way held inbound requests can appear to).
 *
 * Plan 05-49 (G-05-10): this function NO LONGER carries the id-reachability property by itself — a
 * `proposal_created` event is now, first and foremost, answered DURING the agent's own held tool
 * call by {@link createProposalStagedHandler} (registered in `drainInboundCoreRequests`), which is
 * what makes the minted id reachable within the SAME turn that staged it. This sweep now only
 * catches a `proposal_created` event that arrives with NO held caller — a genuine possibility this
 * script has always modelled (see the loop's own history), never the primary path a live run
 * exercises. Every event this sweep would otherwise re-see, {@link createProposalStagedHandler} has
 * already applied and recorded in {@link proposalStagedAppliedRequestIds}; `scanOnce` below skips
 * any such event so ONE event is never applied twice by two different mechanisms observing the same
 * growing `sidecar.events` array.
 *
 * `fromIndex` (default 0) lets a caller resume a SECOND drain window from where a prior one left
 * off, via the `nextIndex` this function returns — required the moment more than one stage window
 * calls this function against the same growing `sidecar.events` array, so the second call's own
 * first scan does not re-walk (and therefore re-apply) everything the first call already handled.
 *
 * Returns `{ applied, passes, stoppedBy, nextIndex, label }`:
 * - `applied` — the count of events actually handed to `applyEvent`.
 * - `passes` — how many scan passes ran (at least 1 — the first scan runs synchronously before any
 *   sleep, so a burst already fully buffered when this function is called pays no tick latency at
 *   all to be noticed).
 * - `stoppedBy` — `"quiet"` when `quietMs` elapsed with the watermark unchanged, or `"deadline"`
 *   when `deadlineMs` elapsed first. These are different facts about a run ("the window closed
 *   quiet" vs. "the window ran out") and the caller reports which one happened rather than
 *   collapsing them into one boolean.
 * - `nextIndex` — the watermark's final position, for a caller that wants to resume a later window
 *   from here.
 */
async function drainProposalsUntilQuiet(
  sidecar,
  { applyEvent, quietMs = PROPOSAL_DRAIN_QUIET_MS, deadlineMs = PROPOSAL_DRAIN_DEADLINE_MS, label, fromIndex = 0 },
) {
  let watermark = fromIndex;
  let applied = 0;
  let passes = 0;
  const startedAt = Date.now();
  let lastProgressAt = startedAt;

  const scanOnce = () => {
    passes += 1;
    let sawNew = false;
    while (watermark < sidecar.events.length) {
      const event = sidecar.events[watermark];
      watermark += 1;
      if (event.type !== "proposal_created") continue;
      // Plan 05-49 (G-05-10): already applied by the held `createProposalStagedHandler` — never
      // re-applied here.
      if (typeof event.requestId === "string" && proposalStagedAppliedRequestIds.has(event.requestId)) continue;
      applyEvent(event);
      applied += 1;
      sawNew = true;
    }
    return sawNew;
  };

  for (;;) {
    if (scanOnce()) lastProgressAt = Date.now();
    const now = Date.now();
    if (now - lastProgressAt >= quietMs) {
      return { applied, passes, stoppedBy: "quiet", nextIndex: watermark, label };
    }
    if (now - startedAt >= deadlineMs) {
      return { applied, passes, stoppedBy: "deadline", nextIndex: watermark, label };
    }
    await new Promise((resolve) => setTimeout(resolve, PROPOSAL_DRAIN_SCAN_TICK_MS));
  }
}

/** Plan 05-38 (Task 3, gap G-05-7): the deliberately SHORT ceiling the
 * `works-continuously-past-old-deadline` scenario passes as its own `turnDeadlineMs` — smaller than
 * the scenario's own total elapsed time (the sum of its per-block `delayMs` pauses), so completing
 * at all proves the new, progress-reset ceiling survives a turn that runs past it while never
 * falling silent for as long as any single gap. Declared HERE, before the `--self-test` trigger
 * below, rather than alongside its sibling `REPLAY_*` constants further down — `selfTest()` reads
 * this constant directly (its own SCENARIOS-shape check), and `--self-test` calls it before module
 * evaluation ever reaches the `--replay-check` section's own constant declarations. */
const REPLAY_CONTINUOUS_WORK_CEILING_MS = 2_000;

/** Plan 05-38 (Task 3, gap G-05-7): the mid-flight idle window the same scenario passes — larger
 * than any single gap between the scenario's own alternating blocks, so no individual pause is ever
 * read as a mid-flight stall. Declared beside {@link REPLAY_CONTINUOUS_WORK_CEILING_MS} for the same
 * reason. */
const REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS = 3_000;

// `--self-test` short-circuits BEFORE the live `runScript` call below is ever reached — it must
// never spawn a sidecar, a claude process, or even resolve REPO_ROOT-relative binaries as a
// precondition, mirroring `authoring-stage-gate-spike.mjs`'s own "no child process, ever" rule.
if (process.argv.includes("--self-test")) {
  await selfTest();
}

/**
 * `--board-read-check` (plan 05-18, G-05-1; extended plan 05-44, gap G-05-9): proves the whole
 * Task 1 slice — a `board_read_request` raised on the wire, answered from the real scratch board
 * through the SAME dispatch the desktop app uses — WITHOUT spending a token. Offline by
 * construction: it spawns the `uat_authoring_ops` bridge binary and `git`, nothing else. No
 * sidecar process, no `claude` binary, no `probeClaudeAvailable`/`startSidecar` call anywhere in
 * this block. Short-circuits BEFORE the live `runScript` call below, exactly like `--self-test`
 * above.
 *
 * Plan 05-44 extends this arm with the end-to-end slice gap G-05-9 asks for: while the epic
 * proposal is STILL PENDING, a `list_proposals` board read hands the agent its own id back — the
 * ONLY route an agent actually has, since `stageAuthoringProposal` never returns one. That id is
 * then used, exactly as an agent would, as a criterion proposal's `parent_proposal_id`. Accepting
 * the criterion (not the epic — see the inline note at that call) drives D-96's implied-parent walk
 * (`accept_proposal_in_tx`, `authoring_proposal.rs:679`), which accepts the still-pending epic
 * FIRST, in the same transaction, before the criterion materialises. `board-counts` then proves a
 * real `acceptance_criteria` row exists. This slice runs BEFORE the epic proposal's own (pre-
 * existing, unchanged) `accept-proposal` call below — the epic is already accepted by the time that
 * call runs, so it exercises `accept_proposal_in_tx`'s documented already-accepted no-op branch.
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

      // Shared across BOTH drains below (the early list_proposals-only drain and the later
      // get_epic/search/unrecognised-kind drain) so `recordedRequests.length` at the end reads as
      // one cumulative tally, and `stubEvents` is reassigned per drain since a fresh
      // `drainInboundCoreRequests` call starts its own internal `seen` set each time.
      const recordedRequests = [];
      let emptyLookups = 0;
      let stubEvents = [];
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
      const boardReadHandler = createBoardReadHandler({
        opsBin,
        appDataDir: harness.appDataDir,
        sidecar: stubSidecar,
        runId,
      });

      step(
        "reading the epic proposal's id back through a list_proposals board_read_request, WHILE IT IS STILL PENDING",
      );
      stubEvents = [
        { type: "board_read_request", requestId: "req-list-proposals", readKind: "list_proposals", runId },
      ];
      emptyLookups = 0;
      await drainInboundCoreRequests(stubSidecar, runId, {
        handlers: { board_read_request: boardReadHandler },
        shouldStop: () => emptyLookups >= 1,
      });
      const listProposalsAnswer = recordedRequests.find((r) => r.requestId === "req-list-proposals");
      assert.ok(listProposalsAnswer, "expected an answer for the list_proposals request");
      const pendingRows = listProposalsAnswer.result?.proposals;
      assert.ok(Array.isArray(pendingRows) && pendingRows.length === 1, `expected exactly one pending proposal, got ${JSON.stringify(pendingRows)}`);
      const [proposalRow] = pendingRows;
      assert.equal(proposalRow.targetType, "epic", "expected the one pending proposal to be the staged epic");
      assert.equal(proposalRow.id.length, 26, "expected a 26-character proposal id");
      assert.equal(
        proposalRow.id,
        applied.proposalId,
        "the id list_proposals hands back must equal the id apply-proposal-created reported — the two representations of the same fact must agree",
      );
      step(`list_proposals answer: 1 pending proposal, id=${proposalRow.id} (agrees with apply-proposal-created's own report)`);

      step("staging a criterion whose parent_proposal_id names the STILL-PENDING epic proposal, through the real bridge");
      const criterionEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "criterion",
        parentProposalId: proposalRow.id,
        payload: { kind: "criterion", statement: "UAT board-read check criterion", verification_hint: null },
      };
      const appliedCriterion = runOps(
        opsBin,
        harness.appDataDir,
        ["apply-proposal-created"],
        JSON.stringify(criterionEvent),
      );
      assert.equal(
        appliedCriterion.outcome,
        "created",
        `expected the criterion proposal_created event to deserialise and apply, got ${JSON.stringify(appliedCriterion)}`,
      );
      step(`applied proposal_created (criterion) -> ${appliedCriterion.outcome} ${appliedCriterion.proposalId}`);

      // Deviation (Rule 1 — auto-fixed bug in the plan's own literal instruction): `accept_subtree`
      // (packages/core/src/domain/authoring_proposal.rs:986) asserts its own root proposal must be
      // a TASK proposal — calling it here on the EPIC proposal would error
      // ("accept_subtree's root must be a task proposal, got a Epic proposal"). The mechanism this
      // slice actually proves — D-96's implied-parent walk inside `accept_proposal_in_tx`
      // (authoring_proposal.rs:679-684) — is reached by accepting the CRITERION proposal instead:
      // it recursively accepts its still-pending epic PARENT first, in the same transaction, then
      // materialises the criterion against it. `accept-proposal` already exists in this bridge
      // binary for exactly this call shape.
      step("accepting the criterion proposal — D-96's implied-parent walk must accept the still-pending epic first");
      const acceptedCriterion = runOps(opsBin, harness.appDataDir, ["accept-proposal", appliedCriterion.proposalId]);
      assert.ok(acceptedCriterion.materialisedId, "expected accept-proposal to return a materialisedId for the criterion");
      step(`materialised criterion ${acceptedCriterion.materialisedId}`);

      const countsAfterCriterion = runOps(opsBin, harness.appDataDir, ["board-counts", project.projectId]);
      assert.equal(
        countsAfterCriterion.criteria,
        1,
        `expected exactly 1 criterion on the board after accepting the criterion proposal, got ${JSON.stringify(countsAfterCriterion)}`,
      );
      step(
        `board-counts after accepting the criterion: epics=${countsAfterCriterion.epics} tasks=${countsAfterCriterion.tasks} criteria=${countsAfterCriterion.criteria}`,
      );

      // Pre-existing call, unchanged: the epic proposal is ALREADY accepted (by the implied-parent
      // walk above), so this exercises `accept_proposal_in_tx`'s documented already-accepted no-op
      // branch — the existing materialised_id is returned unchanged, no second canonical row is
      // written.
      const accepted = runOps(opsBin, harness.appDataDir, ["accept-proposal", epicProposal.id]);
      const epicId = accepted.materialisedId;
      assert.ok(epicId, "expected accept-proposal to return a materialisedId for the epic");
      step(`materialised epic ${epicId}`);

      step("queueing three board_read_request events (get_epic, search, unrecognised-kind) against the stub sidecar");
      stubEvents = [
        { type: "board_read_request", requestId: "req-get-epic", readKind: "get_epic", epicId, runId },
        { type: "board_read_request", requestId: "req-search", readKind: "search", term: epicTitle, runId },
        { type: "board_read_request", requestId: "req-unknown-kind", readKind: "not_a_real_kind", runId },
      ];
      emptyLookups = 0;

      step("driving the REAL drainInboundCoreRequests against the stub with only a board_read_request handler");
      await drainInboundCoreRequests(stubSidecar, runId, {
        handlers: { board_read_request: boardReadHandler },
        shouldStop: () => emptyLookups >= 1,
      });

      assert.equal(
        recordedRequests.length,
        4,
        `expected exactly 4 recorded authoring_read_answer ops (1 list_proposals + 3 below), got ${recordedRequests.length}`,
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
        "expected zero unanswered held requests after all four were answered",
      );
      step("zero unanswered held requests remain — no starvation");

      // -----------------------------------------------------------------------------------------
      // Plan 260929-lq1 — decision-ordering regression: reproduces round-12's crash
      // (`01M3NXWP72VACQJQNVGDK7AXJ8`) against the REAL core, zero tokens. Reuses this arm's still-
      // open run and project, and its existing `apply-proposal-created` event shape. Proves the
      // collision is real, that the core (not the harness) refuses it, for BOTH reject and amend,
      // and that `pickPendingProposal` never hands back a decided id — the fresh read the fixed
      // live sequence now performs.
      // -----------------------------------------------------------------------------------------
      step("decision-ordering regression: staging two task proposals, each with one criterion child");
      const firstTaskEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "task",
        payload: { kind: "task", title: "Regression task 1 (subtree accepted)", description: null },
      };
      const appliedFirstTask = runOps(opsBin, harness.appDataDir, ["apply-proposal-created"], JSON.stringify(firstTaskEvent));
      assert.equal(appliedFirstTask.outcome, "created", "expected the first regression task proposal to apply");

      const firstCriterionEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "criterion",
        parentProposalId: appliedFirstTask.proposalId,
        payload: { kind: "criterion", statement: "Regression criterion 1 (decided by the cascade)", verification_hint: null },
      };
      const appliedFirstCriterion = runOps(
        opsBin,
        harness.appDataDir,
        ["apply-proposal-created"],
        JSON.stringify(firstCriterionEvent),
      );
      assert.equal(appliedFirstCriterion.outcome, "created", "expected the first regression criterion proposal to apply");

      const secondTaskEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "task",
        payload: { kind: "task", title: "Regression task 2 (never touched by the cascade)", description: null },
      };
      const appliedSecondTask = runOps(opsBin, harness.appDataDir, ["apply-proposal-created"], JSON.stringify(secondTaskEvent));
      assert.equal(appliedSecondTask.outcome, "created", "expected the second regression task proposal to apply");

      const secondCriterionEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "criterion",
        parentProposalId: appliedSecondTask.proposalId,
        payload: { kind: "criterion", statement: "Regression criterion 2 (the surviving sibling)", verification_hint: null },
      };
      const appliedSecondCriterion = runOps(
        opsBin,
        harness.appDataDir,
        ["apply-proposal-created"],
        JSON.stringify(secondCriterionEvent),
      );
      assert.equal(appliedSecondCriterion.outcome, "created", "expected the second regression criterion proposal to apply");

      step("taking one stale list-pending snapshot — the shape a careless author would index — then accepting the first task's subtree");
      const staleSnapshot = runOps(opsBin, harness.appDataDir, ["list-pending", runId]);
      const staleFirstCriterion = staleSnapshot.proposals.find((p) => p.id === appliedFirstCriterion.proposalId);
      assert.ok(staleFirstCriterion, "expected the first regression criterion to still be pending in the stale snapshot");
      const regressionSubtreeOutcome = runOps(opsBin, harness.appDataDir, ["accept-subtree", appliedFirstTask.proposalId]);
      assert.ok(
        regressionSubtreeOutcome.acceptedCount > 0,
        "expected accept-subtree to accept at least the task itself, cascading to its criterion child",
      );

      step("asserting the CORE itself refuses reject-proposal on the id the cascade already decided");
      assert.throws(
        () => runOps(opsBin, harness.appDataDir, ["reject-proposal", staleFirstCriterion.id, "stale target"]),
        /is not pending/,
        "expected reject-proposal on a cascade-decided id to throw, naming the core's own pending guard",
      );
      step("asserting the CORE itself refuses amend-criterion on the SAME already-decided id, the same way");
      assert.throws(
        () => runOps(opsBin, harness.appDataDir, ["amend-criterion", staleFirstCriterion.id, "stale amend"]),
        /is not pending/,
        "expected amend-criterion on a cascade-decided id to throw, naming the same pending guard reject-proposal does",
      );

      step("asserting pickPendingProposal never hands back the decided id — it finds the surviving sibling instead");
      const freshCriterionPick = pickPendingProposal(opsBin, harness.appDataDir, runId, { targetType: "criterion" });
      assert.ok(freshCriterionPick.proposal, "expected pickPendingProposal to find the surviving sibling criterion");
      assert.equal(
        freshCriterionPick.proposal.id,
        appliedSecondCriterion.proposalId,
        "expected pickPendingProposal to return regression task 2's criterion, the one the cascade never touched",
      );
      assert.notEqual(
        freshCriterionPick.proposal.id,
        staleFirstCriterion.id,
        "pickPendingProposal must never hand back the id the cascade already decided",
      );
      step(
        `pickPendingProposal returned the surviving sibling ${freshCriterionPick.proposal.id} ` +
          `(${freshCriterionPick.pendingOfType} criterion proposal(s) pending)`,
      );

      step("rejecting the surviving sibling, then asserting the exhaustion path reports null with zero pending");
      runOps(opsBin, harness.appDataDir, [
        "reject-proposal",
        freshCriterionPick.proposal.id,
        "regression: exercising the exhaustion path",
      ]);
      const exhaustedCriterionPick = pickPendingProposal(opsBin, harness.appDataDir, runId, { targetType: "criterion" });
      assert.equal(
        exhaustedCriterionPick.proposal,
        null,
        "expected pickPendingProposal to report null once no criterion proposal remains pending",
      );
      assert.equal(
        exhaustedCriterionPick.pendingOfType,
        0,
        "expected pendingOfType to be zero once every criterion proposal has been decided",
      );
      step(
        "decision-ordering regression complete — the reject/amend collision was reproduced against " +
          "the real core, both verbs were proven to refuse it, and the exhaustion path was proven " +
          "to report null rather than an id",
      );

      // -----------------------------------------------------------------------------------------
      // Plan 260929-nxq (Task 2e) — board-row materialisation regression: proves SHAPE-02's new
      // board-counts-delta arithmetic offline, real bridge, real core, zero tokens. Reuses this
      // arm's still-open run and project, and its existing apply-proposal-created event shape.
      // This is the fallback path SHAPE-02's new preference order depends on and which no offline
      // arm measured this way before this plan.
      // -----------------------------------------------------------------------------------------
      step("board-row materialisation regression: reading board-counts as the baseline");
      const materialisationCountsBefore = runOps(opsBin, harness.appDataDir, ["board-counts", project.projectId]);

      step("staging a fresh epic proposal and a criterion child naming its still-pending epic proposal id");
      const materialisationEpicEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "epic",
        payload: { kind: "epic", title: "Materialisation regression epic", description: null },
      };
      const appliedMaterialisationEpic = runOps(
        opsBin,
        harness.appDataDir,
        ["apply-proposal-created"],
        JSON.stringify(materialisationEpicEvent),
      );
      assert.equal(
        appliedMaterialisationEpic.outcome,
        "created",
        "expected the materialisation-regression epic proposal to apply",
      );

      const materialisationCriterionEvent = {
        type: "proposal_created",
        runId,
        verb: "create",
        targetType: "criterion",
        parentProposalId: appliedMaterialisationEpic.proposalId,
        payload: { kind: "criterion", statement: "Materialisation regression criterion", verification_hint: null },
      };
      const appliedMaterialisationCriterion = runOps(
        opsBin,
        harness.appDataDir,
        ["apply-proposal-created"],
        JSON.stringify(materialisationCriterionEvent),
      );
      assert.equal(
        appliedMaterialisationCriterion.outcome,
        "created",
        "expected the materialisation-regression criterion proposal to apply",
      );

      step(
        "picking the criterion through pickPendingProposal and grounding it against the staging " +
          "call's own reported id",
      );
      const materialisationPick = pickPendingProposal(opsBin, harness.appDataDir, runId, { targetType: "criterion" });
      assert.ok(materialisationPick.proposal, "expected pickPendingProposal to find the freshly staged criterion");
      assert.equal(
        materialisationPick.proposal.id,
        appliedMaterialisationCriterion.proposalId,
        "expected the picked id to equal the id the staging call itself returned — grounding the " +
          "pick rather than trusting list ordering",
      );

      step("accepting the picked criterion — D-96's implied-parent walk must accept the still-pending epic first");
      runOps(opsBin, harness.appDataDir, ["accept-proposal", materialisationPick.proposal.id]);
      const materialisationCountsAfter = runOps(opsBin, harness.appDataDir, ["board-counts", project.projectId]);
      assert.equal(
        materialisationCountsAfter.epics,
        materialisationCountsBefore.epics + 1,
        `expected epics to grow by exactly one, got before=${materialisationCountsBefore.epics} ` +
          `after=${materialisationCountsAfter.epics}`,
      );
      assert.equal(
        materialisationCountsAfter.criteria,
        materialisationCountsBefore.criteria + 1,
        `expected criteria to grow by exactly one, got before=${materialisationCountsBefore.criteria} ` +
          `after=${materialisationCountsAfter.criteria}`,
      );
      step(
        `board-counts before=${JSON.stringify(materialisationCountsBefore)} ` +
          `after=${JSON.stringify(materialisationCountsAfter)} — one accept, two materialised rows, ` +
          "D-96's implied-parent walk observed through the board rather than inferred from a return value",
      );

      step("asserting SHAPE-02's own delta arithmetic reports a landing for this accept, and no landing for a zero delta");
      const materialisationTotalBoardRows = (counts) => counts.epics + counts.tasks + counts.criteria;
      const materialisationDelta =
        materialisationTotalBoardRows(materialisationCountsAfter) -
        materialisationTotalBoardRows(materialisationCountsBefore);
      assert.ok(materialisationDelta > 0, "expected a strictly positive board-row delta for this accept");
      const zeroDeltaCounts = runOps(opsBin, harness.appDataDir, ["board-counts", project.projectId]);
      const zeroDelta =
        materialisationTotalBoardRows(zeroDeltaCounts) - materialisationTotalBoardRows(zeroDeltaCounts);
      assert.equal(
        zeroDelta,
        0,
        "expected a self-comparison to report exactly zero — the 'never passes on zero' half, exercised rather than asserted",
      );
      assert.ok(!(zeroDelta > 0), "expected a zero delta to never read as a landing");

      step("board-row materialisation regression complete");
    },
  );
  process.exit(process.exitCode ?? 0);
}

/** The per-turn deadline `--replay-check` waits on — short, because the scripted backend replies
 * immediately; this is a safety ceiling, never a budget the offline arm is expected to spend. Kept
 * far below the live arm's own runaway ceiling ({@link LIVE_TURN_CEILING_MS}) so the whole
 * multi-scenario arm stays inside its own 90-second ceiling even if a scenario were to genuinely
 * stall. */
const REPLAY_TURN_DEADLINE_MS = 10_000;

/** Plan 05-46 (gap G-05-9): the quiet window `--replay-check`'s own criteria-stage
 * `drainProposalsUntilQuiet` call uses — short, for the same reason {@link REPLAY_TURN_DEADLINE_MS}
 * is: the scripted backend and the real bridge both respond immediately, so there is no real-world
 * latency to wait out. The deadline stays the shipped default ({@link PROPOSAL_DRAIN_DEADLINE_MS}) —
 * only the quiet window is shortened here. */
const REPLAY_PROPOSAL_DRAIN_QUIET_MS = 500;

/** Plan 05-25 (WR-04 closure): the EXPLICIT, short idle window the `slow-tool-mid-turn` scenario
 * passes — short enough that the fixture's own `delayMs` pause (1500ms, `fake-authoring-claude.mjs`)
 * would certainly have tripped the PRE-FIX idle policy (which reset its timer on ANY event and
 * never suppressed the window for an outstanding tool call), and comfortably below
 * {@link REPLAY_TURN_DEADLINE_MS} so the arm stays fast while the assertion stays decisive. */
const SLOW_TOOL_IDLE_MS = 300;

/** Plan 05-36 (Task 1, gap G-05-7): the deliberately SHORT wall-clock deadline the
 * `turn-deadline-exceeded` scenario alone passes to `driveChallengeConversation`, so the offline
 * arm reproduces the live run's own thrown timeout in well under two seconds rather than waiting
 * out `REPLAY_TURN_DEADLINE_MS`. Never used by any other scenario — every one of them settles (or
 * deliberately fails to settle) long before this fires. */
const REPLAY_THROWN_DEADLINE_MS = 1_500;

/**
 * Plan 05-38 (Task 3, gap G-05-7): the FROZEN negative control — plan 05-25's own superseded arming
 * rule, exactly as `waitForTurn` implemented it before this plan: stand the window down entirely
 * while a tool call is outstanding, so the outer wall-clock ceiling is the ONLY thing that can ever
 * conclude that state. Retained ONLY as the offline arm's negative control, run over the SAME
 * accumulated turn state {@link decideTurnArmedWindow} (the shipped rule) is asserted against, so a
 * regression cannot pass for the wrong reason — this phase has already paid for that twice
 * (`scripts/uat/README.md`'s own recorded history). NEVER called by the live body. NEVER to be
 * "fixed" — fixing it would defeat its entire purpose as a historical control. Mirrors exactly how
 * `correlateProposeAttemptsPositionally` (above) is this file's frozen control for a different,
 * unrelated mechanism (propose-attempt correlation, not turn-window arming) — this is not a second
 * generation of THAT lineage, it is the one frozen control for THIS one.
 */
function decideTurnArmedWindowSuperseded(partial, { idleMs }) {
  if (partial.pendingToolCallCount > 0) return { window: "none", ms: undefined };
  if (partial.chunkCount > 0) return { window: "idle", ms: idleMs };
  return { window: "none", ms: undefined };
}

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
      // Plan 05-34 (G-05-6 closure): the spawn timestamp the `unauthenticated-backend-first-turn`
      // scenario measures its own stop-latency against — the offline analogue of the live run's
      // own 120000ms proposal deadline it must never again wait out.
      const spawnStartMs = Date.now();
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
          proposal_created: createProposalStagedHandler({ opsBin, appDataDir: harness.appDataDir, sidecar, runId }),
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
          buildAgentExchange(turn1),
          { speaker: "developer", text: SECOND_TURN },
          buildAgentExchange(turn2),
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
          buildAgentExchange(turn),
        ];
      } else if (scenarioName === "turn-deadline-exceeded") {
        // ---- Task 1 closure (plan 05-36, gap G-05-7) — the thrown-deadline mechanism, offline ---
        // Reproduces the EXACT mechanism that destroyed live run `01M3C48C3PV1NSGHERBZ587YB1`: a
        // turn wait whose wall-clock deadline elapses while a tool call is genuinely outstanding —
        // which stands the idle window down entirely (WR-04's own policy), so the deadline is the
        // ONLY thing that can fire. `driveChallengeConversation` now THROWS `ConversationAbortedError`
        // on this path instead of returning; this branch is the offline proof that the throw still
        // carries what was captured, and that `writeChallengeEvidence` still lands a sheet from it.
        step(
          "driving the REAL driveChallengeConversation with a deliberately short " +
            `REPLAY_THROWN_DEADLINE_MS=${REPLAY_THROWN_DEADLINE_MS} — an outstanding tool call ` +
            "stands the idle window down entirely (WR-04), so only the wall-clock deadline can " +
            "fire, exactly as it did on the live run this scenario reproduces",
        );
        let aborted;
        try {
          await driveChallengeConversation({
            sidecar,
            runId,
            sendTurn: (text) => sidecar.request({ op: "authoring_turn", runId, text }),
            cursor: turn1Cursor,
            turnDeadlineMs: REPLAY_THROWN_DEADLINE_MS,
            maxAgentTurns: MAX_AGENT_TURNS,
          });
          assert.fail("expected driveChallengeConversation to throw ConversationAbortedError for this scenario");
        } catch (err) {
          assert.ok(
            err instanceof ConversationAbortedError,
            `expected a ConversationAbortedError, got ${err?.constructor?.name}: ${err?.message}`,
          );
          aborted = err;
        }
        assertAllHeldRequestsAnswered(sidecar);
        step(
          `driver threw ConversationAbortedError as expected — ${aborted.exchanges.length} exchange(s) ` +
            `recovered, cause: ${aborted.cause?.message}`,
        );

        const fixtureFirstChunk = SCENARIOS[scenarioName].turns[0].find((block) => block.type === "text").text;
        assert.ok(
          aborted.exchanges.some(
            (exchange) => exchange.speaker === "agent" && exchange.text.includes(fixtureFirstChunk),
          ),
          "expected the recovered exchange list to carry the fixture's own first captured chunk verbatim",
        );

        // Never through `resolveEvidencePath()` and never anywhere near the phase directory —
        // written under the harness's OWN scratch root, at a path distinct from the shared
        // synthetic-sheet write below, so this scenario's own assertions read exactly what THIS
        // branch produced.
        const scratchDeadlineEvidenceDir = path.join(harness.root, "evidence-turn-deadline-exceeded");
        fs.mkdirSync(scratchDeadlineEvidenceDir, { recursive: true });
        const scratchDeadlineEvidencePath = path.join(scratchDeadlineEvidenceDir, EVIDENCE_FILE_NAME);
        writeChallengeEvidence({
          evidencePath: scratchDeadlineEvidencePath,
          runId,
          openingPrompt: OPENING_PROMPT,
          conversation: { exchanges: aborted.exchanges },
          noWorkPlannedReading: "unproven",
          draftedCriteriaCount: 0,
          amendedCriteriaCount: 0,
          results: [],
          credentialPath: null,
          nonConversation: null,
          failure: aborted.cause,
        });
        assert.ok(
          fs.existsSync(scratchDeadlineEvidencePath),
          "expected the scenario's own scratch evidence sheet to exist",
        );
        const deadlineSheet = fs.readFileSync(scratchDeadlineEvidencePath, "utf8");
        assert.ok(
          deadlineSheet.includes(fixtureFirstChunk),
          "expected the sheet to contain the text of the first captured chunk",
        );
        assert.ok(
          deadlineSheet.includes("## Run failure"),
          "expected the sheet to contain the failure-section heading",
        );
        assert.ok(
          deadlineSheet.includes(`${REPLAY_THROWN_DEADLINE_MS}ms`),
          "expected the sheet's failure section to name the deadline in its failure message",
        );
        step(
          "wrote and asserted the scenario's own scratch evidence sheet (never resolveEvidencePath()): " +
            scratchDeadlineEvidencePath,
        );

        // This scenario aborted, not settled — D-90's gate is never opened on it. `exchanges`
        // feeds the shared synthetic-sheet write and kill/dispose tail below, exactly like every
        // other scenario.
        exchanges = buildEvidenceExchanges({
          openingPrompt: OPENING_PROMPT,
          conversation: { exchanges: aborted.exchanges },
        });
      } else if (scenarioName === "works-continuously-past-old-deadline") {
        // ---- Task 3 closure (plan 05-38, gap G-05-7) — a turn that works continuously past the
        // OLD wall-clock deadline still completes, because the ceiling now resets on every
        // observed progress signal exactly like the idle windows do. -----------------------------
        step(
          "driving the REAL driveChallengeConversation with a deliberately short " +
            `REPLAY_CONTINUOUS_WORK_CEILING_MS=${REPLAY_CONTINUOUS_WORK_CEILING_MS} — smaller than ` +
            "this scenario's own total elapsed time, while every single gap stays comfortably below " +
            `both this ceiling and REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS=${REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS} ` +
            "— the exact combination live run 01M3C48C3PV1NSGHERBZ587YB1's own turn 1 produced, and " +
            "exactly what the OLD arrangement (an unconditional wall-clock deadline from call start) " +
            "could not survive",
        );
        const continuousWorkStartMs = Date.now();
        const conversation = await driveChallengeConversation({
          sidecar,
          runId,
          sendTurn: (text) => sidecar.request({ op: "authoring_turn", runId, text }),
          cursor: turn1Cursor,
          turnDeadlineMs: REPLAY_CONTINUOUS_WORK_CEILING_MS,
          toolCallIdleMs: REPLAY_CONTINUOUS_WORK_TOOL_IDLE_MS,
          maxAgentTurns: MAX_AGENT_TURNS,
        });
        const continuousWorkElapsedMs = Date.now() - continuousWorkStartMs;
        assertAllHeldRequestsAnswered(sidecar);

        const firstAgentExchange = conversation.exchanges.find((exchange) => exchange.speaker === "agent");
        assert.ok(firstAgentExchange, "expected at least one captured agent exchange");
        assert.equal(
          firstAgentExchange.endedBy,
          "result",
          "expected the turn to end on the backend's own result marker, never the idle marker and " +
            "never a thrown deadline",
        );
        const continuousWorkScenario = SCENARIOS[scenarioName];
        const continuousWorkBlocks = continuousWorkScenario.turns[0];
        const questionBlock = continuousWorkBlocks[continuousWorkBlocks.length - 1];
        assert.ok(
          firstAgentExchange.text.includes(questionBlock.text),
          "expected the captured turn's text to include the scenario's own final question verbatim",
        );
        assert.ok(
          continuousWorkElapsedMs > REPLAY_CONTINUOUS_WORK_CEILING_MS,
          `expected the measured elapsed time (${continuousWorkElapsedMs}ms) to exceed ` +
            `REPLAY_CONTINUOUS_WORK_CEILING_MS (${REPLAY_CONTINUOUS_WORK_CEILING_MS}ms) — a turn ` +
            "that settles faster than the ceiling it was given proves nothing about surviving past it",
        );
        step(
          `turn completed normally after ${continuousWorkElapsedMs}ms — past ` +
            `REPLAY_CONTINUOUS_WORK_CEILING_MS (${REPLAY_CONTINUOUS_WORK_CEILING_MS}ms) — ended by ` +
            `${firstAgentExchange.endedBy}, ${firstAgentExchange.chunkCount} chunk(s) captured`,
        );

        // The silent case (Task 1's own behavior 3): a genuinely silent mid-flight turn still
        // concludes in bounded time, naming the outstanding tool — proven here with the same
        // hand-pushed-event technique the self-test above uses, so this scenario proves BOTH
        // halves: working continuously past the old deadline, AND a genuine silence still bounded.
        step("driving a further silent-mid-flight wait against a deliberately unanswered, hand-pushed tool call");
        const silentMidFlightMs = 200;
        const silentCursor = sidecar.eventCursor();
        sidecar.events.push({ type: "tool_call", runId, toolName: "Bash", toolUseId: "toolu_wcpd_silent" });
        const silentReading = await sidecar.waitForTurn(runId, silentCursor, {
          timeoutMs: 5_000,
          idleMs: 5_000,
          toolCallIdleMs: silentMidFlightMs,
          label: "the works-continuously-past-old-deadline scenario's own silent mid-flight check",
        });
        assert.equal(silentReading.endedBy, "idle");
        assert.equal(silentReading.midFlight, true);
        assert.deepEqual(silentReading.outstandingTools, ["Bash"]);
        step(
          `silent mid-flight check concluded on its own short window (${silentMidFlightMs}ms), ` +
            `naming the outstanding tool: ${JSON.stringify(silentReading.outstandingTools)}`,
        );

        exchanges = buildEvidenceExchanges({ openingPrompt: OPENING_PROMPT, conversation });
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
        // Plan 05-34 (G-05-6 closure): the driver-stop timestamp — paired with `spawnStartMs`
        // above, this is what lets the `unauthenticated-backend-first-turn` scenario assert it
        // stopped well inside the deadline rather than waiting one out, measured against the
        // constant itself, never a hardcoded millisecond figure.
        const driveStopMs = Date.now();
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

        // Composition invariant: every developer exchange's lines are drawn from the answer bank,
        // select an offered option (plan 05-42, gap G-05-8(a)), or are the closing turn verbatim.
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
              bankValues.has(stripped) || stripped.startsWith(OPTION_SELECTION_PREFIX),
              `developer exchange line is not an exact answer-bank member and does not select an offered option: ${JSON.stringify(stripped)}`,
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
          // Plan 05-24 (gap G-05-3), generalised by plan 05-34 (G-05-6): the driver must have
          // stopped AT the non-conversation turn — reporting it, settling false, and sending no
          // further developer turn into a refused session. This scenario's text carries no wire
          // error flag (the fake backend never sets one for it), so it must be caught by the
          // retained text-banner reader — the source names it, proving the reader's reach is
          // unchanged by this plan's classifier.
          assert.ok(conversation.nonConversation, "expected the driver to report a non-conversation classification for this scenario");
          assert.equal(
            conversation.nonConversation.classifier,
            "reasoning_extraction",
            "expected the detected classifier to equal the fixture's own code",
          );
          assert.equal(
            conversation.nonConversation.source,
            NON_CONVERSATION_SOURCES.TEXT_BANNER,
            "expected this scenario's text-only refusal to be caught by the retained text-banner reader",
          );
          assert.equal(conversation.settled, false, "expected settled to be false when a non-conversation turn stops the driver");
          const developerTurns = conversation.exchanges.filter((exchange) => exchange.speaker === "developer");
          assert.equal(
            developerTurns.length,
            1,
            "expected exactly one developer turn composed by the driver — the loop ran once (answering " +
              "turn 1's questions) and then stopped at the non-conversation turn, never sending a second developer turn",
          );
          const refusedExchange = conversation.exchanges.find(
            (exchange) => exchange.speaker === "agent" && exchange.nonConversation,
          );
          assert.ok(refusedExchange, "expected a non-conversation agent exchange in the driver's own exchange record");
          assert.ok(
            refusedExchange.text.includes(BACKEND_REFUSAL_PREFIX),
            "expected the non-conversation turn's text to be preserved verbatim in the exchanges — a " +
              "failed capture must report what it DID capture, never discard it",
          );
          step(
            `driver stopped at the non-conversation turn — source=${conversation.nonConversation.source} ` +
              `classifier=${conversation.nonConversation.classifier} ` +
              `requestId=${conversation.nonConversation.requestId ?? "none"} — settled=${conversation.settled}`,
          );
        } else if (scenarioName === "unauthenticated-backend-first-turn") {
          // Gap G-05-6 (plan 05-34): the exact stream that defeated the live run — an
          // unauthenticated backend's first turn, replayed offline through the real sidecar and
          // the real shipped normaliser. Every assertion below reads from the frozen fixture's own
          // data (via the fake backend's SCENARIOS entry, which itself reads the same fixture at
          // module load) rather than from literals, so this check and the real capture cannot
          // drift apart.
          const fixtureScenario = SCENARIOS[scenarioName];
          const fixtureBlock = fixtureScenario.turns[0][0];
          const fixtureFallbackText = fixtureScenario.fallback[0].text;

          assert.ok(
            conversation.nonConversation,
            "expected the driver to classify the unauthenticated first turn as non-conversation",
          );
          assert.notEqual(
            conversation.nonConversation.source,
            NON_CONVERSATION_SOURCES.TEXT_BANNER,
            "expected a WIRE signal to have fired for this scenario — the login-notice text does " +
              "not match the text-banner reader at all, which is the entire point: this shape is " +
              "exactly what the superseded text-only mechanism could never have caught",
          );
          assert.ok(
            conversation.nonConversation.source === NON_CONVERSATION_SOURCES.ASSISTANT_ERROR_FLAG ||
              conversation.nonConversation.source === NON_CONVERSATION_SOURCES.RESULT_ERROR_FLAG,
            `expected the reported source to name a wire signal, got ${conversation.nonConversation.source}`,
          );
          assert.equal(
            conversation.settled,
            false,
            "expected the conversation to NOT be recorded as having settled — the exact misreading " +
              "that let the original live run wait out the full proposal deadline",
          );

          // The negative that makes the gap's own reason concrete: the captured agent exchange for
          // this turn is FLAGGED non-conversation, never bare ordinary agent speech — the original
          // defect counted this exact text as a genuine settled reply.
          const nonConversationExchange = conversation.exchanges.find(
            (exchange) => exchange.speaker === "agent" && exchange.nonConversation,
          );
          assert.ok(
            nonConversationExchange,
            "expected the captured agent exchange for the login-notice turn to carry a truthy " +
              "nonConversation classification, never read as ordinary agent speech",
          );
          assert.equal(
            nonConversationExchange.text,
            fixtureBlock.text,
            "expected the captured exchange's text to equal the frozen fixture's own login-notice text verbatim",
          );

          // The run must have stopped AT turn one — no second developer turn sent, and the
          // scenario's own fallback text (which would only be reached by a second scripted or
          // fallback turn) appears nowhere in what was captured.
          const developerTurns = conversation.exchanges.filter((exchange) => exchange.speaker === "developer");
          assert.equal(
            developerTurns.length,
            0,
            "expected ZERO developer turns — the non-conversation classification must stop the " +
              "driver before any reply is composed or sent, on turn one",
          );
          const capturedTexts = conversation.exchanges.map((exchange) => exchange.text);
          assert.ok(
            !capturedTexts.includes(fixtureFallbackText),
            "expected the fallback turn's text to appear nowhere in the captured exchanges — " +
              "reaching it would mean the driver did not stop on turn one",
          );

          // The offline analogue of the live run's own 120000ms proposal deadline it must never
          // again wait out — asserted against the deadline CONSTANT, never a hardcoded millisecond
          // figure, and comparing timestamps taken around the real spawn/drive calls above, not a
          // synthetic measurement.
          const elapsedMs = driveStopMs - spawnStartMs;
          assert.ok(
            elapsedMs < REPLAY_TURN_DEADLINE_MS,
            `expected the run to stop well under REPLAY_TURN_DEADLINE_MS (${REPLAY_TURN_DEADLINE_MS}ms), took ${elapsedMs}ms`,
          );

          step(
            `driver stopped at the unauthenticated first turn — source=${conversation.nonConversation.source} ` +
              `elapsed=${elapsedMs}ms (well under REPLAY_TURN_DEADLINE_MS=${REPLAY_TURN_DEADLINE_MS}ms) — ` +
              `settled=${conversation.settled}`,
          );
        } else if (scenarioName === "unmodelled-wire-shapes") {
          // Task 3 (plan 05-37, gap G-05-7): both new wire shapes Task 1 modelled, replayed through
          // the REAL sidecar and the REAL shipped normaliser. This is the assertion that would have
          // caught this gap in the first place — a positive count of ZERO unknown-type events for
          // the whole run, read from the run's own event list, never scraped from stderr.
          const runEvents = sidecar.events.filter((event) => event.runId === runId);

          const rateLimitEvent = runEvents.find((event) => event.type === "rate_limit");
          assert.ok(rateLimitEvent, "expected at least one rate_limit event for this run");
          const measuredRateLimitInfo = UNMODELLED_SHAPES_FIXTURE.shapes.find(
            (shape) => shape.expectedEventType === "rate_limit",
          ).line.rate_limit_info;
          assert.equal(
            rateLimitEvent.utilization,
            measuredRateLimitInfo.utilization,
            "expected the captured rate_limit event's utilization to equal the frozen fixture's own measured value",
          );
          assert.equal(rateLimitEvent.rateLimitType, measuredRateLimitInfo.rateLimitType);
          assert.equal(rateLimitEvent.status, measuredRateLimitInfo.status);

          const thinkingEvent = runEvents.find((event) => event.type === "thinking");
          assert.ok(thinkingEvent, "expected at least one thinking event for this run");

          const questionsFixtureTurn = SCENARIOS[scenarioName].turns[0].find((block) => block.type === "text");
          assert.ok(
            conversation.exchanges.some(
              (exchange) => exchange.speaker === "agent" && exchange.text.includes(questionsFixtureTurn.text),
            ),
            "expected the conversation's captured agent text to include the ordinary block's own question text — modelling the two new shapes must not swallow the conversation itself",
          );

          const unknownEvents = runEvents.filter((event) => event.type === "unknown");
          assert.equal(
            unknownEvents.length,
            0,
            `expected zero unknown-type events for this run, got ${unknownEvents.length}: ` +
              `${JSON.stringify(unknownEvents.map((e) => e.raw))}`,
          );

          assert.equal(conversation.settled, true, "expected this scenario's conversation to settle on turn 2");

          step(
            `both new shapes flowed end to end: rate_limit utilization=${rateLimitEvent.utilization}, ` +
              "a thinking event was captured, and zero unknown-type events were seen for this run",
          );
        } else if (scenarioName === "ask-user-question") {
          // Plan 05-42 (gap G-05-8(a)): proves BOTH halves of this gap together — the questions and
          // options a real `AskUserQuestion` tool call carries survive the wire onto the captured
          // turn's own `toolCalls` and from there onto the built agent exchange (Task 1), AND the
          // driver treats them as open questions rather than reading a turn whose prose carries no
          // question mark as settled (Task 2) — this scenario's closing text block deliberately
          // carries no "?" at all, so the ONLY thing that can keep the conversation going past turn
          // 1 is the driver reading the tool call's own typed questions.
          const firstAgentExchange = conversation.exchanges.find((exchange) => exchange.speaker === "agent");
          assert.ok(firstAgentExchange, "expected at least one captured agent exchange");
          assert.ok(
            Array.isArray(firstAgentExchange.questions) && firstAgentExchange.questions.length === 3,
            `expected the built agent exchange to carry three typed questions, got ${JSON.stringify(firstAgentExchange.questions)}`,
          );

          const rawToolCallEvent = sidecar.events.find(
            (event) => event.runId === runId && event.type === "tool_call" && event.toolName === "AskUserQuestion",
          );
          assert.ok(rawToolCallEvent, "expected a raw tool_call event for this run whose toolName is AskUserQuestion");
          assert.ok(
            Array.isArray(rawToolCallEvent.questions) && rawToolCallEvent.questions.length === 3,
            "expected the raw wire event itself to carry three typed questions",
          );

          const directQuestions = questionsFromTurn(accumulateTurn(sidecar.events, runId, turn1Cursor));
          const headers = directQuestions.map((question) => question.header);
          const expectedHeaders = ASK_USER_QUESTION_PROMPTS.map((prompt) => prompt.header);
          assert.deepEqual(
            headers,
            expectedHeaders,
            `expected questionsFromTurn to return the fixture's own headers in emitted order, got ${JSON.stringify(headers)}`,
          );

          const runEvents = sidecar.events.filter((event) => event.runId === runId);
          const unknownEvents = runEvents.filter((event) => event.type === "unknown");
          assert.equal(
            unknownEvents.length,
            0,
            `expected zero unknown-type events for this run, got ${unknownEvents.length}: ` +
              `${JSON.stringify(unknownEvents.map((e) => e.raw))}`,
          );

          // Task 2's own property: the driver must NOT read this turn as settled — it must send a
          // developer reply selecting an offered option for each of the three typed questions, and
          // that reply must never quote any of the question texts themselves.
          const developerTurns = conversation.exchanges.filter((exchange) => exchange.speaker === "developer");
          assert.ok(
            developerTurns.length >= 1,
            "expected the driver to send at least one developer turn answering the tool call's own " +
              "questions — a turn whose questions live in a tool call must never be read as settled",
          );
          assert.ok(
            developerTurns.every((exchange) => exchange.text.includes(OPTION_SELECTION_PREFIX)),
            "expected every developer reply to this scenario to select an offered option",
          );
          for (const prompt of ASK_USER_QUESTION_PROMPTS) {
            assert.ok(
              !developerTurns.some((exchange) => exchange.text.includes(prompt.question)),
              `expected no developer reply to quote a question's own text verbatim: ${JSON.stringify(prompt.question)}`,
            );
          }
          assert.ok(
            conversation.answeredQuestionCount >= 3,
            `expected at least three questions answered, got ${conversation.answeredQuestionCount}`,
          );

          step(
            `captured three typed question(s) on the wire and on the built exchange — headers: ` +
              `${JSON.stringify(headers)} — zero unknown-type events — answeredQuestionCount=` +
              `${conversation.answeredQuestionCount}, developer turn(s)=${developerTurns.length}`,
          );
        }

        // Plan 05-24 (gap G-05-3), generalised by plan 05-34 (G-05-6), and by plan 05-36 (Task 3,
        // 05-REVIEW.md WR-01): a non-conversation conversation must NEVER reach advance-stage — the
        // whole point of these scenarios is that the gate is never opened on them. This is now
        // decided from the categorical fact the driver itself returned
        // (`conversationStoppedOnNonConversationTurn`), not from a list of scenario names kept in
        // sync by hand — the consequence covers ANY non-conversation scenario, present or future,
        // with no name list to maintain. Every other scenario advances the stage through the
        // bridge, mirroring the live body exactly.
        if (conversationStoppedOnNonConversationTurn(conversation)) {
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
          exchanges = buildEvidenceExchanges({ openingPrompt: OPENING_PROMPT, conversation });

          // Plan 05-46 (gap G-05-9), Task 3(b): a scenario may declare how many stage advances it
          // wants via its own `stageTargets` array (e.g. `["decompose", "criteria"]`) — defaulting
          // to a single `["decompose"]` advance so every PRE-EXISTING scenario is byte-identical in
          // behaviour. Looping around this ONE call site (rather than adding a second, duplicated
          // one) keeps the replay body holding exactly one `advance-stage` call site in its source.
          const stageTargets = SCENARIOS[scenarioName].stageTargets ?? ["decompose"];
          let capturedInstructionReplies = 0;
          let criteriaReachabilityReadingForReplay = null;
          let criteriaDrainStoppedByForReplay = null;

          for (const stageTarget of stageTargets) {
            const advanceCursor = sidecar.eventCursor();
            const advanced = runOps(opsBin, harness.appDataDir, ["advance-stage", runId]);
            assert.equal(advanced.stage, stageTarget);
            if (stageTarget === "decompose") {
              assert.ok(
                advanceCursor >= conversation.cursor,
                `expected the cursor recorded at advance-stage (${advanceCursor}) to be at or after ` +
                  `the final agent turn's own end index (${conversation.cursor})`,
              );
            }

            if (advanced.instructionText) {
              const postAdvanceCursor = sidecar.eventCursor();
              await sidecar.request({ op: "authoring_turn", runId, text: advanced.instructionText });
              exchanges.push({ speaker: "developer", text: advanced.instructionText, cursor: postAdvanceCursor });
              const postAdvanceReply = await sidecar.waitForTurn(runId, postAdvanceCursor, {
                timeoutMs: REPLAY_TURN_DEADLINE_MS,
                label: `the post-advance ${stageTarget}-stage reply (${scenarioName})`,
              });
              exchanges.push(buildAgentExchange(postAdvanceReply));
              capturedInstructionReplies += 1;

              if (stageTarget === "criteria") {
                // Plan 05-46 (gap G-05-9), Task 3(c)'s own honesty bound: this arm opens no socket,
                // so NO row ever reaches the board here — `apply-proposal-created` is never called
                // and `list-pending` is never called either. `drainProposalsUntilQuiet` is still
                // exercised (proving it does not hang against the real sidecar's own event array),
                // but its `applyEvent` is a plain counter, never the real bridge — nothing this
                // scenario emits is a genuine `proposal_created` sidecar event (no real MCP round
                // trip ever happens against a scripted backend), so there is nothing FOR the real
                // bridge to apply regardless.
                step("waiting for the criteria-stage proposal drain to go quiet (replay-check, no board write)");
                let replayDrainAppliedCount = 0;
                const criteriaDrainResult = await drainProposalsUntilQuiet(sidecar, {
                  applyEvent: () => {
                    replayDrainAppliedCount += 1;
                  },
                  quietMs: REPLAY_PROPOSAL_DRAIN_QUIET_MS,
                  label: `${scenarioName}-criteria-drain`,
                });
                criteriaDrainStoppedByForReplay = criteriaDrainResult.stoppedBy;
                assertAllHeldRequestsAnswered(sidecar);

                // The reading, not the row (Task 3(c)): `draftedCriteriaCount` here is a WIRE-ONLY
                // signal — the count of `propose_criterion` attempts in this window that are
                // correlatable and were NOT refused — never a `list-pending` row count, since no
                // row exists to count in this offline arm.
                const criteriaWindow = { runId, fromIndex: challengeWindowEnd, toIndex: sidecar.eventCursor() };
                const wireDraftedCriteriaCount = correlateProposeAttempts(sidecar.events, criteriaWindow).filter(
                  (attempt) => attempt.toolName.includes(PROPOSE_CRITERION_TOOL_NAME_FRAGMENT) && attempt.correlatable && !attempt.refused,
                ).length;
                criteriaReachabilityReadingForReplay = readCriteriaReachability(sidecar.events, criteriaWindow, {
                  draftedCriteriaCount: wireDraftedCriteriaCount,
                });
                step(
                  `criteria-stage proposal drain stopped ${criteriaDrainStoppedByForReplay} ` +
                    `(applied=${replayDrainAppliedCount}, expected 0 — no board write in this arm) — ` +
                    `wire-derived drafted count=${wireDraftedCriteriaCount} — ` +
                    `reachability=${criteriaReachabilityReadingForReplay}`,
                );
              }
            }

            if (scenarioName === "proposes-work-after-advance" && stageTarget === "decompose") {
              // Plan 05-23 (CR-01 closure): the fixture reaches decompose LEGITIMATELY — a clean
              // challenge stage, then one post-advance developer turn (the distillation
              // instruction, mirroring the live body's own step) that triggers the fixture's
              // scripted decompose-stage propose call. This is the exact combination CR-01's own
              // defect needed and no offline arm ever exercised before this plan: a propose call
              // that lands strictly AFTER challengeWindowEnd, which the bounded reading must never
              // see and the unbounded (CR-01) reading must still misread.
              assert.ok(
                typeof advanced.instructionText === "string" && advanced.instructionText.length > 0,
                "expected advance-stage to return a distillation instruction for this scenario",
              );

              // Assertion 1: the bounded challenge-window reading is unproven — the challenge
              // stage was genuinely clean.
              const boundedWindow = { runId, fromIndex: turn1Cursor, toIndex: challengeWindowEnd };
              const boundedReading = readNoWorkPlanned(sidecar.events, boundedWindow);
              assert.equal(
                boundedReading,
                "unproven",
                "expected the bounded challenge-window reading to be unproven — the challenge stage " +
                  "was genuinely clean",
              );

              // Assertion 2: at least one propose tool_call for this run exists at an index at or
              // after challengeWindowEnd — so the scenario provably reached the contaminating
              // state and the assertions below are not vacuous.
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
                "expected the WHOLE unscoped range's reading (the CR-01 reading) to still be " +
                  "violated — this is what gives the regression teeth",
              );

              // Assertion 4: the bounded reading reused as the final gating value is NOT violated.
              assert.notEqual(
                boundedReading,
                "violated",
                "expected the bounded reading reused as the final gating value to NOT be violated",
              );

              // Assertion 5: buildCriteriaResults with criterion1Challenged held true and the
              // bounded reading yields a SHAPE-01 entry whose passed flag is true — the successful
              // path SHAPE-01 and SHAPE-02 must be able to share.
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
                "expected SHAPE-01 to pass on the successful path — a clean challenge followed by " +
                  "a legitimate decompose-stage proposal",
              );

              step(
                `bounded reading (gating): ${boundedReading} — unbounded reading (CR-01's own ` +
                  `reading, still wrong): ${unboundedReading} — SHAPE-01 entry passed=${shape01[1]} ` +
                  "(expected true)",
              );
            }
          }

          if (scenarioName === "drafts-criteria-after-second-advance") {
            // Plan 05-46 (gap G-05-9), Task 3: the two-advance shape's own assertions — both
            // instruction replies captured, the criteria-reachability reading reads "drafted" (from
            // the wire's own tool_call/tool_result shape, never a board row — see Task 3(c)'s own
            // honesty bound above), and the criteria-stage drain reports it stopped quiet.
            assert.equal(
              capturedInstructionReplies,
              2,
              `expected both the distillation and criteria instruction replies to be captured, got ${capturedInstructionReplies}`,
            );
            assert.equal(
              criteriaReachabilityReadingForReplay,
              "drafted",
              `expected the criteria-reachability reading to be "drafted", got ${criteriaReachabilityReadingForReplay}`,
            );
            assert.equal(
              criteriaDrainStoppedByForReplay,
              "quiet",
              `expected the criteria-stage proposal drain to stop quiet, got ${criteriaDrainStoppedByForReplay}`,
            );

            const readIdCallEvent = sidecar.events.find(
              (event) =>
                event.runId === runId &&
                event.type === "tool_call" &&
                typeof event[TOOL_NAME_FIELD] === "string" &&
                event[TOOL_NAME_FIELD].includes(PROPOSAL_LIST_TOOL_NAME_FRAGMENT),
            );
            assert.ok(readIdCallEvent, "expected a proposal_list tool_call event for this run");

            const criterionCallEvent = sidecar.events.find(
              (event) =>
                event.runId === runId &&
                event.type === "tool_call" &&
                typeof event[TOOL_NAME_FIELD] === "string" &&
                event[TOOL_NAME_FIELD].includes(PROPOSE_CRITERION_TOOL_NAME_FRAGMENT),
            );
            assert.ok(criterionCallEvent, "expected a propose_criterion tool_call event for this run");
            // The fixture's own declared id — read from the scenario, never retyped as a second
            // literal — so this assertion cannot drift from what the fixture actually emits.
            const expectedParentId = SCENARIOS[scenarioName].readBackProposalId;
            assert.equal(
              expectedParentId.length,
              26,
              `expected the scenario's own readBackProposalId to be a 26-character id, got length ${expectedParentId.length}`,
            );
            assert.equal(
              criterionCallEvent.input?.parent_proposal_id,
              expectedParentId,
              "expected the propose_criterion call to name the SAME id the proposal_list read back " +
                "as its own parent_proposal_id",
            );

            step(
              "drafts-criteria-after-second-advance: both instruction replies captured, " +
                `reachability=${criteriaReachabilityReadingForReplay}, criteria drain ` +
                `stoppedBy=${criteriaDrainStoppedByForReplay}, proposal_list and propose_criterion ` +
                "both observed on the wire",
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
    // Plan 05-33 (Task 3, gap G-05-6): the direct countermeasure to validation ledger row
    // `05-22-03`, whose credential path was never recorded — this summary is written into both a
    // durable artifact (here) and the evidence sheet itself (every renderChallengeEvidenceSheet
    // call below), so which credential authenticated a run can never again be invisible.
    const credentialPath = { ...credentialSummary, scrubbedCount: removedApiKeyVars.length };
    harness.writeArtifact("uat-08-credential-path", credentialPath);

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
        proposal_created: createProposalStagedHandler({ opsBin, appDataDir: harness.appDataDir, sidecar, runId }),
      },
      shouldStop: () => !draining,
    });

    // Plan 05-24 (Task 2, NF-01 closure): NO standalone first-turn capture here anymore.
    // `driveChallengeConversation`, seeded with `turn1Cursor` below, captures the agent's first
    // reply as its OWN first agent exchange — capturing it a second time here (as this file used
    // to) is exactly what produced two identical entries in `05-LIVE-CHALLENGE-TRANSCRIPT.md`
    // (NF-01). The narration and `criterion1Challenged` scan below are derived from the driver's
    // own returned exchanges instead, so they survive without the duplicate capture behind them.

    // Resolved here, before anything below can need it. Plan 05-24 (G-05-3) claimed this location
    // was enough to guarantee "a refusal can still write the evidence sheet" — it was not: live run
    // `01M3C48C3PV1NSGHERBZ587YB1` proved that a THROW from `driveChallengeConversation` itself (a
    // shape this comment did not name) bypassed every downstream write anyway, because every write
    // sat behind the very call that threw. Plan 05-36 (gap G-05-7) is the actual fix: the sheet is
    // now written from exactly ONE place, `writeChallengeEvidence`, reached from exactly ONE exit
    // point — the `finally` below — so resolving the path early no longer needs to carry the whole
    // guarantee on its own.
    const evidencePath = resolveEvidencePath();

    // Plan 05-36 (gap G-05-7): ONE mutable state object, seeded here and assigned into as the run
    // progresses, with `writeChallengeEvidence(evidenceState)` the ONE thing that turns it into a
    // file on disk. Everything from here to the end of this run body is wrapped in one try/finally
    // (below) whose `finally` calls `writeChallengeEvidence(evidenceState)` unconditionally — a
    // thrown exception ANYWHERE in that span still lands a sheet carrying whatever had been
    // captured before the throw, which is exactly the guarantee live run
    // `01M3C48C3PV1NSGHERBZ587YB1` needed and did not have.
    const evidenceState = {
      evidencePath,
      runId,
      openingPrompt: OPENING_PROMPT,
      conversation: null,
      noWorkPlannedReading: "unproven",
      draftedCriteriaCount: 0,
      amendedCriteriaCount: 0,
      criteriaReachabilityReading: "not-attempted",
      criteriaDrainStoppedBy: null,
      // Plan 05-49 (Task 3, G-05-10 missing[3]): defaults byte-identically to the value used when
      // the criteria stage never sends its own instruction turn — see that call site's own comment.
      proposalListVerdict: "not-applicable",
      results: [],
      credentialPath,
      nonConversation: null,
      failure: null,
    };

    // Quick task 260929-p61: the ONE construction of the developer answer source for this whole
    // live body — handed to driveChallengeConversation below so its replies are the developer's
    // own words, never the answer bank's. `handoffDir` is the evidence directory itself, so the
    // no-TTY transport's per-turn questions/answers sheets sit beside the transcript the
    // developer is already watching in the scrollback.
    const developerAnswerSource = createDeveloperAnswerSource({
      handoffDir: path.dirname(evidencePath),
      runId,
      log: step,
    });

    try {
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
        // Plan 05-38 (Task 2): confirmed by reading — this call site still passes the live idle
        // window explicitly (below), and now also passes the ceiling under its own name, so this
        // caller never silently inherits a default that means something different to it than to
        // the offline arms.
        turnDeadlineMs: LIVE_TURN_CEILING_MS,
        // WR-04 closure (plan 05-25): the live arm states, at its own call site, the pause it
        // permits a REAL model turn to take mid-turn — never the short TURN_IDLE_MS default a test
        // passes when deliberately measuring the degrade path.
        idleMs: LIVE_TURN_IDLE_MS,
        maxAgentTurns: MAX_AGENT_TURNS,
        // Quick task 260929-p61: the live arm asks the developer, never composes from the bank.
        answerQuestions: developerAnswerSource.answerQuestions,
      });
      evidenceState.conversation = conversation;
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

      // G-05-3 (plan 05-24), generalised by G-05-6 (plan 05-34): a non-conversation backend message
      // stopped the driver — this is the mechanism that killed run 01M399FP80B184QM2RXTXJDZTK, and
      // the wire-fact classification is what stops a run like gap G-05-6's own (an unauthenticated
      // first turn) at the point of detection instead of waiting out the full proposal deadline. Fail
      // fast, naming the class, the firing source, the classifier/code and the request id, WITHOUT
      // discarding the turns already captured and WITHOUT advancing the stage — D-90's gate exists to
      // be opened on a finished conversation, and this one did not finish.
      if (conversation.nonConversation) {
        evidenceState.nonConversation = conversation.nonConversation;
        writeChallengeEvidence(evidenceState);
        throw new Error(
          `backend non-conversation message (${BACKEND_REFUSAL_KIND}) stopped the challenge ` +
            `conversation before it settled — source=${conversation.nonConversation.source ?? "unknown"} ` +
            `classifier=${conversation.nonConversation.classifier ?? conversation.nonConversation.errorCode ?? "unknown"} ` +
            `requestId=${conversation.nonConversation.requestId ?? "none"}. This is a backend-level ` +
            "message, not a model turn; the conversation did not complete and the stage was never " +
            `advanced. See ${evidencePath} for the captured turns.`,
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

      // Plan 260929-nxq (Task 1g): a wholly-deflecting reply is a fact in the scrollback rather
      // than a silence — how many of this conversation's own composed answer lines were exactly
      // ANSWER_BANK_FALLBACK, against how many questions were answered in total.
      step(
        `answer-bank fallback ratio this conversation: ${conversation.fallbackAnswerCount}/` +
          `${conversation.answeredQuestionCount} composed answer line(s) were the wholly-generic ` +
          "fallback — a nonzero ratio is a legitimate delegation as one line among real answers, " +
          "and a deflection when it is the entire reply",
      );

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
      evidenceState.noWorkPlannedReading = noWorkPlannedReading;
      // Plan 05-24 (Task 2, NF-01 closure): derived from the driver's OWN exchanges alone — the
      // driver's first exchange already IS the agent's first turn, so there is no separate `turn1`
      // to fold in here anymore.
      const criterion1Challenged = conversation.exchanges.some(
        (exchange) => exchange.speaker === "agent" && /\?/.test(exchange.text),
      );

      // Plan 05-36 (gap G-05-7): `writeChallengeEvidence` derives `exchanges` itself, via
      // `buildEvidenceExchanges`, from `evidenceState.conversation` — there is no separate local
      // assembly to keep in sync any more. Below, a distillation turn is recorded by pushing
      // directly onto `evidenceState.conversation.exchanges` (the SAME array `conversation`
      // returned), so every subsequent `writeChallengeEvidence` call sees it automatically.
      writeChallengeEvidence(evidenceState);
      step(
        `wrote challenge evidence sheet (pre-proposal, results pending): ${evidencePath} — a run ` +
          "that dies later in the proposal phase still leaves this transcript for the human",
      );

      // Plan 260929-nxq (Task 1f) — first gate: D-90's own gate is the developer's, never opened
      // over an agent that has explicitly withheld its consent to advance. `consentReading` is
      // read from the LAST captured agent turn (including the reply to CLOSING_TURN, when the
      // conversation reached its own bound) — never from the driver's own composed reply, which
      // cannot clear the flag by construction.
      step(`advance-stage consent reading (challenge -> decompose): ${conversation.consentReading}`);
      if (conversation.consentReading === "withheld") {
        writeChallengeEvidence(evidenceState);
        throw new Error(
          "the agent withheld its consent to advance, and the conversation reached its own bound " +
            `(closingTurnSent=${conversation.closingTurnSent}) still saying so: ` +
            `${JSON.stringify(conversation.consentWithheldSentence)}. D-90's gate is the developer's ` +
            `own — a withheld consent is never advanced over. See ${evidencePath} for the captured turns.`,
        );
      }

      step(
        "advancing the stage (Cyril's own gate, D-90) — the developer decides the challenge is " +
          "done, only now that the driver's own conversation has returned",
      );
      const advanced = runOps(opsBin, harness.appDataDir, ["advance-stage", runId]);
      assert.equal(advanced.stage, "decompose");
      // Plan 260929-nxq (Task 1f): hoisted out of the block below so the SECOND advance-stage
      // gate, further down, can read this reply's own consent — the only agent turn produced
      // between the two developer-held gates. Stays `undefined` when this stage never sent its
      // own instruction turn at all, which `readAdvanceConsent` reads as "unreadable", never as
      // consent.
      let instructionReply;
      if (advanced.instructionText) {
        step("sending the distillation instruction and capturing its reply (not required for the run to continue)");
        const instructionCursor = sidecar.eventCursor();
        await sidecar.request({ op: "authoring_turn", runId, text: advanced.instructionText });
        evidenceState.conversation.exchanges.push({
          speaker: "developer",
          text: advanced.instructionText,
          cursor: instructionCursor,
        });
        // G-05-3 (plan 05-24), generalised by G-05-6 (plan 05-34): `instructionReply` stays
        // `undefined` on a genuine TIMEOUT (the catch branch below, unchanged from before this plan)
        // so the non-conversation check after this try/catch is a no-op for that path — a timeout
        // and a non-conversation message are different classes and must stay separately reported. A
        // non-conversation message, by contrast, is a SUCCESSFUL capture (the turn ended cleanly on
        // `result` — this is the exact place the real run actually died), so it must be checked and
        // must fail the run OUTSIDE this try/catch, never swallowed by the timeout branch.
        try {
          instructionReply = await sidecar.waitForTurn(runId, instructionCursor, {
            timeoutMs: LIVE_TURN_CEILING_MS,
            // WR-04 closure (plan 05-25): explicit, matching the driveChallengeConversation call
            // above — the live arm never inherits the short test default at either capture site.
            idleMs: LIVE_TURN_IDLE_MS,
            label: "the decompose stage's reply to the distillation instruction",
          });
          evidenceState.conversation.exchanges.push(buildAgentExchange(instructionReply));
          step(
            `distillation reply captured: chunks=${instructionReply.chunkCount} ` +
              `chars=${instructionReply.charCount} endedBy=${instructionReply.endedBy}`,
          );
        } catch (err) {
          // The decompose turn's completeness is not a gating property — a timeout here is recorded
          // as a partial exchange (via the pure accumulateTurn scan, never a rethrow) and the
          // proposal wait below still happens.
          const partial = accumulateTurn(sidecar.events, runId, instructionCursor);
          evidenceState.conversation.exchanges.push(buildAgentExchange(partial, { endedBy: "timeout" }));
          step(`distillation reply capture timed out (not fatal — the proposal wait still happens): ${err.message}`);
        }

        // G-05-3 (plan 05-24), generalised by G-05-6 (plan 05-34): the place the real run actually
        // died. Never fall through into the proposal wait below — a non-conversation distillation
        // turn means no propose call is ever coming.
        if (instructionReply && instructionReply.nonConversation) {
          evidenceState.nonConversation = instructionReply.nonConversation;
          writeChallengeEvidence(evidenceState);
          throw new Error(
            `backend non-conversation message (${BACKEND_REFUSAL_KIND}) stopped the run at the ` +
              `distillation turn — source=${instructionReply.nonConversation.source ?? "unknown"} ` +
              `classifier=${instructionReply.nonConversation.classifier ?? instructionReply.nonConversation.errorCode ?? "unknown"} ` +
              `requestId=${instructionReply.nonConversation.requestId ?? "none"}. This is a ` +
              "backend-level message, not a model turn; the conversation did not complete and the " +
              `proposal wait was never entered. See ${evidencePath} for the captured turns.`,
          );
        }
      }

      step("waiting for at least one proposal (assumption or task) to arrive");
      let sawProposal = false;
      let taskProposalId = null;
      let criterionProposalId = null;
      let decomposeDrainResult = null;
      // Plan 05-46 (gap G-05-9): a running watermark across BOTH stage windows, so the criteria
      // window's own drain call resumes exactly where the decompose window's drain left off,
      // rather than re-walking (and re-applying) everything the first call already handled.
      let proposalDrainWatermark = sidecar.eventCursor();
      try {
        const proposalEvent = await sidecar.waitForEvent(
          (event) => event.type === "proposal_created",
          PROPOSAL_DEADLINE_MS,
          "a proposal_created event",
        );
        sawProposal = true;
        step(`first proposal observed: verb=${proposalEvent.verb} targetType=${proposalEvent.targetType}`);
        // Plan 05-46 (gap G-05-9): a re-scanning quiet window, not one pass — this IS the inbound
        // write path (apply-proposal-created), not a simulation of it. See
        // drainProposalsUntilQuiet's own doc comment for why a single pass, or a waitForEvent-based
        // re-drain, structurally cannot collect a burst that arrives after the first proposal.
        decomposeDrainResult = await drainProposalsUntilQuiet(sidecar, {
          applyEvent: (event) => {
            const outcome = runOps(opsBin, harness.appDataDir, ["apply-proposal-created"], JSON.stringify(event));
            step(`applied proposal_created -> ${outcome.outcome} ${outcome.proposalId ?? ""}`);
          },
          fromIndex: proposalDrainWatermark,
          label: "decompose-stage proposal drain",
        });
        proposalDrainWatermark = decomposeDrainResult.nextIndex;
        step(
          `decompose-stage proposal drain stopped ${decomposeDrainResult.stoppedBy} after ` +
            `${decomposeDrainResult.passes} pass(es), ${decomposeDrainResult.applied} proposal(s) applied`,
        );
      } catch (err) {
        step(`no proposal arrived within the deadline: ${err.message}`);
      }

      const pendingAfterDecompose = runOps(opsBin, harness.appDataDir, ["list-pending", runId]);
      step(`${pendingAfterDecompose.proposals.length} proposal(s) pending after the first decompose window`);

      // Plan 260929-nxq (Task 1f) — second gate: the decompose stage's own reply to the
      // distillation instruction (`instructionReply`, hoisted above) is the only agent turn
      // produced between the two developer-held gates, so it is what this gate reads.
      // "unreadable" (the timeout path, which the catch above deliberately treats as non-fatal, or
      // simply no instruction turn having been sent at all) narrates its own abstention and
      // proceeds — it must not silently read as consent.
      const secondGateConsentReading = readAdvanceConsent(instructionReply?.text);
      step(`advance-stage consent reading (decompose -> criteria): ${secondGateConsentReading}`);
      if (secondGateConsentReading === "withheld") {
        const secondGateWithheld = classifyWithheldConsent(instructionReply.text);
        writeChallengeEvidence(evidenceState);
        throw new Error(
          "the agent withheld its consent to advance from decompose into criteria: " +
            `${JSON.stringify(secondGateWithheld?.sentence ?? null)}. D-90's gate is the developer's ` +
            `own — a withheld consent is never advanced over. See ${evidencePath} for the captured turns.`,
        );
      }

      // ---- Task 2 (gap G-05-9): the SECOND developer-held gate (D-90) — into the stage literally
      // named for what plan 05-45 gave it: criteria. Placed here, BEFORE the accept/reject/amend
      // block below, and never inside driveChallengeConversation (D-90 stays the developer's own
      // gate, fired a second time exactly like the first).
      step(
        "advancing the stage a second time (Cyril's own gate, D-90) — into the criteria stage " +
          "plan 05-45 gave its own instruction",
      );
      const criteriaAdvanced = runOps(opsBin, harness.appDataDir, ["advance-stage", runId]);
      assert.equal(criteriaAdvanced.stage, "criteria");
      let criteriaDrainResult = null;
      // Plan 05-49 (Task 3, G-05-10 missing[3]): "not-applicable" (a PASSING verdict) when the
      // criteria stage never sends its own instruction turn at all — that turn simply never ran,
      // so the property this verdict names was never exercised either way.
      let proposalListVerdict = "not-applicable";
      if (criteriaAdvanced.instructionText) {
        step("sending the criteria instruction and capturing its reply (not required for the run to continue)");
        const criteriaInstructionCursor = sidecar.eventCursor();
        await sidecar.request({ op: "authoring_turn", runId, text: criteriaAdvanced.instructionText });
        evidenceState.conversation.exchanges.push({
          speaker: "developer",
          text: criteriaAdvanced.instructionText,
          cursor: criteriaInstructionCursor,
        });
        // Mirrors the distillation capture above verbatim in shape: a timeout is a partial
        // exchange, never fatal; a genuine non-conversation reply IS fatal, checked OUTSIDE this
        // try/catch so the timeout branch never swallows it.
        let criteriaInstructionReply;
        let criteriaTurnEndIndex = criteriaInstructionCursor;
        try {
          criteriaInstructionReply = await sidecar.waitForTurn(runId, criteriaInstructionCursor, {
            timeoutMs: LIVE_TURN_CEILING_MS,
            idleMs: LIVE_TURN_IDLE_MS,
            label: "the criteria stage's reply to the criteria instruction",
          });
          criteriaTurnEndIndex = criteriaInstructionReply.endIndex;
          evidenceState.conversation.exchanges.push(buildAgentExchange(criteriaInstructionReply));
          step(
            `criteria reply captured: chunks=${criteriaInstructionReply.chunkCount} ` +
              `chars=${criteriaInstructionReply.charCount} endedBy=${criteriaInstructionReply.endedBy}`,
          );
        } catch (err) {
          const partial = accumulateTurn(sidecar.events, runId, criteriaInstructionCursor);
          criteriaTurnEndIndex = partial.endIndex;
          evidenceState.conversation.exchanges.push(buildAgentExchange(partial, { endedBy: "timeout" }));
          step(
            `criteria reply capture timed out (not fatal — the criteria-stage proposal drain still ` +
              `happens): ${err.message}`,
          );
        }

        // Plan 05-49 (Task 3, G-05-10 missing[3]): the live gating check — an empty proposal_list
        // inside the SAME turn as a successful staging call must never pass silently. Scoped to
        // exactly this turn's own slice of `sidecar.events` (never the whole run), so a LATER
        // turn's own unrelated proposal_list call can never taint this reading.
        proposalListVerdict = assertProposalListNonEmptyInTurn(
          sidecar.events.slice(criteriaInstructionCursor, criteriaTurnEndIndex),
        );
        evidenceState.proposalListVerdict = proposalListVerdict;
        step(`proposal_list-in-staging-turn verdict: ${proposalListVerdict}`);

        writeChallengeEvidence(evidenceState);
        step(
          `wrote challenge evidence sheet (post-criteria-turn, results pending): ${evidencePath} — a ` +
            "run that dies in the criteria stage still leaves this transcript for the human",
        );

        // A non-conversation reply here means no propose_criterion call is ever coming — as true
        // in the criteria stage as in the decompose stage above.
        if (criteriaInstructionReply && criteriaInstructionReply.nonConversation) {
          evidenceState.nonConversation = criteriaInstructionReply.nonConversation;
          writeChallengeEvidence(evidenceState);
          throw new Error(
            `backend non-conversation message (${BACKEND_REFUSAL_KIND}) stopped the run at the ` +
              `criteria turn — source=${criteriaInstructionReply.nonConversation.source ?? "unknown"} ` +
              `classifier=${criteriaInstructionReply.nonConversation.classifier ?? criteriaInstructionReply.nonConversation.errorCode ?? "unknown"} ` +
              `requestId=${criteriaInstructionReply.nonConversation.requestId ?? "none"}. This is a ` +
              "backend-level message, not a model turn; the conversation did not complete and the " +
              `criteria-stage proposal drain was never entered. See ${evidencePath} for the captured turns.`,
          );
        }

        step("waiting for the criteria-stage proposal drain to go quiet");
        criteriaDrainResult = await drainProposalsUntilQuiet(sidecar, {
          applyEvent: (event) => {
            const outcome = runOps(opsBin, harness.appDataDir, ["apply-proposal-created"], JSON.stringify(event));
            step(`applied proposal_created -> ${outcome.outcome} ${outcome.proposalId ?? ""}`);
          },
          fromIndex: proposalDrainWatermark,
          label: "criteria-stage proposal drain",
        });
        proposalDrainWatermark = criteriaDrainResult.nextIndex;
        evidenceState.criteriaDrainStoppedBy = criteriaDrainResult.stoppedBy;
        step(
          `criteria-stage proposal drain stopped ${criteriaDrainResult.stoppedBy} after ` +
            `${criteriaDrainResult.passes} pass(es), ${criteriaDrainResult.applied} proposal(s) applied`,
        );
      }

      // G-05-1 (plan 05-18): a held request starved in the criteria stage must fail fast here,
      // naming itself, rather than read as a quiet model.
      assertAllHeldRequestsAnswered(sidecar);

      // Plan 05-46 (gap G-05-9): recomputed from the SECOND `list-pending` snapshot, which is a
      // superset of `pendingAfterDecompose` above — never re-derived from the first snapshot, which
      // cannot see anything the criteria-stage instruction produced.
      const pending = runOps(opsBin, harness.appDataDir, ["list-pending", runId]);
      step(
        `${pending.proposals.length} proposal(s) pending after the criteria window (superset of the ` +
          "decompose-window snapshot)",
      );

      // Plan 260929-lq1: renamed from `criterionProposals` — this array's only remaining purpose
      // is a COUNT of what the model drafted, never a pool of decision targets. Every decision
      // target below is picked fresh via pickPendingProposal, after whatever mutation preceded it.
      const draftedCriterionProposals = pending.proposals.filter((p) => p.targetType === "criterion");

      // The SHAPE-03 draft-usefulness judgement reads these two counts from the evidence sheet
      // rather than a scrollback line — how many criteria the model drafted, and how many the
      // developer had to amend before they were usable. Plan 260929-lq1: `draftedCriteriaCount`
      // is deliberately exempt from pickPendingProposal — it measures the model's own drafted
      // output from the pre-cascade snapshot above, which the cascade below must never erase.
      const draftedCriteriaCount = draftedCriterionProposals.length;
      let amendedCriteriaCount = 0;

      // Plan 05-46 (gap G-05-9): the reachability reading the gap asked for by name, computed over
      // everything from the challenge-stage boundary onward (decompose- and criteria-stage
      // activity) so it can see a propose_criterion attempt or a proposal_list read wherever either
      // happened. Reuses correlateProposeAttempts verbatim via readCriteriaReachability — no second
      // pairing scheme.
      const criteriaReachabilityReading = readCriteriaReachability(
        sidecar.events,
        { runId, fromIndex: challengeWindowEnd, toIndex: sidecar.eventCursor() },
        { draftedCriteriaCount },
      );
      evidenceState.criteriaReachabilityReading = criteriaReachabilityReading;
      step(`criteria-reachability reading: ${criteriaReachabilityReading}`);

      let criterion2Landed = false;
      let criterion3Decided = false;
      let rejectExercised = false;
      let amendExercised = false;
      let rejectedCriterionId = null;
      let acceptPath = "none";

      // Plan 260929-nxq (Task 2a): the board is measured, not the branch — SHAPE-02's own sentence
      // is "the outcome lands directly on the board", asserted by a board-counts delta taken
      // BEFORE and AFTER the accept chain, never from which branch happened to run and never from
      // a decided-proposal count. Strictly HARDER than `acceptedCount > 0`: a run that accepted
      // nothing, or accepted something that materialised no row, fails — it must never pass on a
      // zero delta.
      const countsBeforeAccept = runOps(opsBin, harness.appDataDir, ["board-counts", project.projectId]);
      const totalBoardRows = (counts) => counts.epics + counts.tasks + counts.criteria;

      // Plan 260929-nxq (Task 2b): three accept paths, in preference order, each with its own
      // LITERAL argv call site — 260929-lq1's structural gate scans for argv-shaped literals, so a
      // computed verb would slip past it — and each picking its own target with its own
      // pickPendingProposal call immediately before its own decision, per the rule that closure
      // installed.
      //   1. a pending TASK -> accept-subtree (D-95's ONE bulk path — today's behaviour, unchanged
      //      whenever a task proposal exists).
      //   2. else a pending CRITERION -> accept-proposal, whose D-96 implied-parent walk accepts
      //      the still-pending parent first in the same transaction — the only ordering that lands
      //      a *criterion* on the board in a live run.
      //   3. else a pending EPIC -> accept-proposal, the last resort: an epic with nothing drafted
      //      under it is still a real board row.
      const taskTarget = pickPendingProposal(opsBin, harness.appDataDir, runId, { targetType: "task" });
      if (taskTarget.proposal) {
        taskProposalId = taskTarget.proposal.id;
        acceptPath = "task-subtree";
        step(`accepting the task subtree ${taskProposalId} (D-95's ONE bulk path)`);
        runOps(opsBin, harness.appDataDir, ["accept-subtree", taskProposalId]);
      } else {
        const criterionAcceptTarget = pickPendingProposal(opsBin, harness.appDataDir, runId, { targetType: "criterion" });
        if (criterionAcceptTarget.proposal) {
          acceptPath = "criterion-implied-parent";
          step(
            `no task proposal pending — accepting a criterion proposal ` +
              `${criterionAcceptTarget.proposal.id} instead (D-96's implied-parent walk accepts its ` +
              "still-pending epic parent first, in the same transaction)",
          );
          runOps(opsBin, harness.appDataDir, ["accept-proposal", criterionAcceptTarget.proposal.id]);
        } else {
          const epicAcceptTarget = pickPendingProposal(opsBin, harness.appDataDir, runId, { targetType: "epic" });
          if (epicAcceptTarget.proposal) {
            acceptPath = "epic";
            step(
              `no task or criterion proposal pending — accepting the epic proposal ` +
                `${epicAcceptTarget.proposal.id} directly (the last resort: an epic with nothing ` +
                "drafted under it is still a real board row)",
            );
            runOps(opsBin, harness.appDataDir, ["accept-proposal", epicAcceptTarget.proposal.id]);
          } else {
            step("no task, criterion or epic proposal was pending to accept — nothing for SHAPE-02 to land");
          }
        }
      }

      const countsAfterAccept = runOps(opsBin, harness.appDataDir, ["board-counts", project.projectId]);
      const boardRowDelta = totalBoardRows(countsAfterAccept) - totalBoardRows(countsBeforeAccept);
      criterion2Landed = boardRowDelta > 0;
      const criterion2Detail =
        `acceptPath=${acceptPath} before={epics:${countsBeforeAccept.epics},tasks:${countsBeforeAccept.tasks},` +
        `criteria:${countsBeforeAccept.criteria}} after={epics:${countsAfterAccept.epics},` +
        `tasks:${countsAfterAccept.tasks},criteria:${countsAfterAccept.criteria}} delta=${boardRowDelta}`;
      step(`board-counts delta: ${criterion2Detail} — SHAPE-02 requires a strictly positive delta`);

      // Plan 260929-lq1 (round-12 crash fix): a GENUINELY fresh read, taken AFTER the accept chain
      // above — never a pre-cascade snapshot, which is exactly the stale array that crashed the
      // round-12 run inside the core's own pending guard.
      const rejectTarget = pickPendingProposal(opsBin, harness.appDataDir, runId, { targetType: "criterion" });
      if (rejectTarget.proposal) {
        rejectedCriterionId = rejectTarget.proposal.id;
        step(
          `rejecting a criterion proposal ${rejectedCriterionId} with a reason ` +
            `(${rejectTarget.pendingOfType} criterion proposal(s) still pending after the cascade)`,
        );
        runOps(opsBin, harness.appDataDir, ["reject-proposal", rejectedCriterionId, "Too vague to verify"]);
        rejectExercised = true;
      } else {
        step(
          "SHAPE-04's individual reject could not be exercised this run — the subtree cascade " +
            "decided every criterion proposal, leaving none still pending to reject",
        );
      }

      // Plan 260929-lq1: excludes rejectedCriterionId so reject and amend can never collide on the
      // same row — deciding an already-decided proposal a second time is the exact defect this
      // rule closes (amend_proposal refuses a decided row for the same reason reject_proposal does).
      const amendTarget = pickPendingProposal(opsBin, harness.appDataDir, runId, {
        targetType: "criterion",
        excludeIds: rejectedCriterionId ? [rejectedCriterionId] : [],
      });
      if (amendTarget.proposal) {
        criterionProposalId = amendTarget.proposal.id;
        step(`amending criterion proposal ${criterionProposalId} to the developer's own text`);
        runOps(opsBin, harness.appDataDir, [
          "amend-criterion",
          criterionProposalId,
          "A UAT-amended criterion, the developer's own wording",
        ]);
        amendedCriteriaCount += 1;
        amendExercised = true;
      } else {
        step(
          "SHAPE-04's individual amend could not be exercised this run — no criterion proposal " +
            "remained pending after the reject above",
        );
      }

      // Plan 260929-lq1: a correction, not a refactor — criterion3Decided previously went true if
      // EITHER branch ran, while buildCriteriaResults' own detail string for it claims "at least
      // one reject and one amend were exercised". True now only when both genuinely did.
      criterion3Decided = rejectExercised && amendExercised;

      step("closing this run with a summary (D-64's own guarantee)");
      runOps(opsBin, harness.appDataDir, ["close-run", runId, "UAT 8 shaped one task."]);

      // ---- SHAPE-05 — reopening --------------------------------------------------------------
      // Plan 260929-nxq (Task 2d): derived from what this run actually observed — SHAPE-05's
      // reopen leg has nothing to do with whether a reject happened, and gating the explanation on
      // one is why a wrong sentence got printed at all (the pre-fix narration explained an absent
      // epic with the fixed string "the model proposed a task without an epic" for a run that was
      // the precise inverse: one epic proposal, zero task proposals). SHAPE-05's reopen check
      // needs a REAL epic AND a SECOND session against it (the exact two-session shape
      // `authoring_acceptance.rs`'s own Criterion 2/4 tests document and exercise directly against
      // the database) — a single-session run structurally cannot produce that, whether or not it
      // materialised an epic.
      let criterion4Reopened = false;
      let criterion4PrimedRejected = false;
      const pendingTargetTypeTally = pending.proposals.reduce((tally, proposal) => {
        tally[proposal.targetType] = (tally[proposal.targetType] ?? 0) + 1;
        return tally;
      }, {});
      const pendingTargetTypeTallyText =
        Object.entries(pendingTargetTypeTally)
          .map(([targetType, count]) => `${targetType}=${count}`)
          .join(" ") || "none";
      if (countsAfterAccept.epics > 0) {
        step(
          `an epic exists on the board after this run (acceptPath=${acceptPath}) — SHAPE-05's ` +
            "reopen check needs a SECOND session against it, which a single-session run " +
            "structurally cannot produce; the reopen leg is exercised structurally by " +
            "authoring_acceptance.rs::criterion_4_* instead, and this run reports it honestly as " +
            "unproven rather than fabricating a pass",
        );
      } else {
        step(
          `no epic exists on the board after this run (acceptPath=${acceptPath}, pending tally at ` +
            `the challenge/criteria boundary: ${pendingTargetTypeTallyText}) — SHAPE-05's reopen ` +
            "check is exercised structurally by authoring_acceptance.rs::criterion_4_* instead; " +
            "this run reports it honestly as unproven rather than fabricating a pass",
        );
      }

      // Plan 05-23 (CR-01 closure): REUSE, never re-read. The challenge-stage reading captured
      // above (bounded at challengeWindowEnd, before advance-stage) was already correct the moment
      // driveChallengeConversation returned — decompose-stage propose calls (the proposal activity
      // just above) are legitimate by construction and must never re-taint it. A second, unscoped
      // computation here is exactly the CR-01 defect: it would see this stage's own legitimate
      // propose_* calls and force "violated" on essentially every otherwise-successful run.
      const finalNoWorkPlannedReading = noWorkPlannedReading;
      evidenceState.noWorkPlannedReading = finalNoWorkPlannedReading;

      const results = buildCriteriaResults({
        criterion1Challenged,
        noWorkPlannedReading: finalNoWorkPlannedReading,
        criterion2Landed,
        criterion3Decided,
        criterion4Reopened,
        criterion4PrimedRejected,
        proposalListVerdict,
        criterion2Detail,
      });
      evidenceState.draftedCriteriaCount = draftedCriteriaCount;
      evidenceState.amendedCriteriaCount = amendedCriteriaCount;
      evidenceState.results = results;

      writeChallengeEvidence(evidenceState);
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
    } catch (err) {
      // Plan 05-36 (gap G-05-7): a `ConversationAbortedError` (or any other error carrying an
      // `exchanges` array) that escaped BEFORE `evidenceState.conversation` was ever assigned still
      // gets its captured turns into the sheet — this is the direct fix for the live failure, where
      // 539 characters of real agent speech existed only inside a thrown message string.
      if (evidenceState.conversation === null && Array.isArray(err?.exchanges)) {
        evidenceState.conversation = { exchanges: err.exchanges };
      }
      evidenceState.failure = err;
      throw err;
    } finally {
      // The ONE unconditional write for this run — reached whether the try block returned
      // normally, threw partway through, or never captured a single turn. Every other
      // `writeChallengeEvidence` call above is a progressive convenience; this is the guarantee.
      writeChallengeEvidence(evidenceState);
    }
  },
);
