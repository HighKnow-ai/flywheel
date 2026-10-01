#!/usr/bin/env node
/**
 * Plan 06-09 — the phase-6 ship gate: one scriptable run that proves the whole agent-backlog loop
 * end to end, through the REAL domain functions, and reports pass/fail per ROADMAP.md's five
 * Phase 6 success criteria. 06-01's tracer feedback gate and 06-08's own live-app check were both
 * deferred here (WINDOWS.md #19, #21) on this project's standing preference for a durable,
 * re-runnable automated harness over a one-off manual pass — this script is that harness.
 *
 * Three modes:
 *
 *   --self-test   Pure, offline, no child process and no `claude` binary. Asserts this script's
 *                 own report formatting (a criterion this mode did not measure is reported
 *                 `not-measured`, never `observed`) and its propose_item-payload-to-bridge-args
 *                 translation. This is what an autonomous executor and CI run.
 *
 *   --offline     Drives the whole flow with no real model and no tokens. Stands up a real scratch
 *                 database through `uat_authoring_ops`, then stages every proposal by calling the
 *                 REAL `buildProposeItemPayload`/`stageAuthoringProposal`
 *                 (packages/sidecar/dist/mcp-permission-server.js) against a socket THIS script
 *                 serves with the REAL `startPermissionServer` — answering each held call the same
 *                 way `ClaudeCodeAdapter.startSession`'s own `onProposal` wiring answers it in
 *                 production (see this plan's Rule-1 fix there), by shelling out to the bridge's
 *                 `propose-item`. No fixture anywhere in this file hand-writes a staged-proposal
 *                 tool-result literal — every asserted shape comes from calling the real function.
 *                 Walks: a near-duplicate (asserts the duplicate verdict), the volume limit (10th
 *                 succeeds, 11th refused, one limit notice), and all four triage verbs (accept,
 *                 reject, merge, defer).
 *
 *   --live        The same walk, except the FIRST proposal comes from a real `claude` execution-run
 *                 session with `propose_item` pre-approved — so success criterion 1 is measured
 *                 against a real model's own decision to call the tool, never a constructed
 *                 payload. The remaining proposals (duplicate/limit/verb filler) reuse the same
 *                 offline-style bridge so this mode spends tokens only on the one call that needs
 *                 a real model. Costs real tokens; not run by an autonomous executor — `run-all.sh`
 *                 lists only its command, as MANUAL text, for a human to run deliberately.
 *
 * Every mode's report marks each of ROADMAP.md's five Phase 6 success criteria `observed`,
 * `failed`, or `not-measured` — never `observed` for a criterion the mode cannot reach. In
 * `--offline`, criterion 1's live-only half (a real model's own decision to call the tool) is
 * always `not-measured` — this is precisely the distinction Phase 5's own history (see
 * scripts/uat/README.md's long finding log for uat-08-socratic-authoring.mjs) says a report must
 * keep honest, rather than claim a mechanism test proves a model's behaviour.
 *
 * Reachable by this script's two arms, per ROADMAP.md Phase 6 success criterion:
 *   1. (agent proposes mid-session, lands distinct/unpromoted) — LIVE ONLY. --offline reports
 *      not-measured; --live drives it through a real session.
 *   2. (triage verbs: accept/reject/merge/defer) — both arms reach the VERB behaviour; the
 *      "in a dedicated view" clause is UI and is proven separately by component tests.
 *   3. (provenance: run + rationale) — both arms reach it via list-deferred's rationale field.
 *   4. (duplicate flagged before the user sees it) — both arms reach it.
 *   5. (volume limit, loud refusal, notice) — both arms reach it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";

import {
  assertClaudeConfigIsolated,
  createPermissionAnswerHandler,
  drainInboundCoreRequests,
  probeClaudeAvailable,
  REPO_ROOT,
  resolveHarnessBinary,
  runScript,
  skip,
  step,
} from "./lib/sidecar-harness.mjs";

// -------------------------------------------------------------------------------------------
// ROADMAP.md Phase 6 success criteria — the exact wording, so the report quotes the roadmap
// rather than a paraphrase of it.
// -------------------------------------------------------------------------------------------

const SUCCESS_CRITERIA = Object.freeze([
  {
    id: 1,
    text:
      "A running agent proposes a new task, issue or epic mid-session through a board tool, and " +
      "it lands in a distinct proposed state — never appearing as accepted work, with no code " +
      "path that promotes it except explicit human triage.",
  },
  {
    id: 2,
    text:
      "User triages the proposal queue in a dedicated view: accept, reject, merge into an " +
      "existing item, or defer.",
  },
  { id: 3, text: "Each proposal shows which agent run produced it and what prompted it." },
  {
    id: 4,
    text: "A proposal that duplicates an existing item is flagged as a duplicate before the user sees it.",
  },
  {
    id: 5,
    text:
      "A chatty agent hits a per-run proposal limit and the user is told the limit was hit, " +
      "rather than proposals being silently dropped.",
  },
]);

const REPORT_STATUSES = Object.freeze(["observed", "failed", "not-measured"]);

/**
 * Format `results` (a map of criterion id -> `{status, detail?}`) into the per-criterion report
 * every mode prints. Throws — rather than silently printing a gap — when a criterion is missing
 * or carries an unrecognised status, so a caller cannot accidentally ship a report that quietly
 * drops a criterion or invents a new status word nobody classified.
 */
function renderReport(results) {
  const lines = ["Per-criterion report (ROADMAP.md Phase 6 — \"Agents File Their Own Backlog\"):"];
  for (const criterion of SUCCESS_CRITERIA) {
    const result = results[criterion.id];
    if (result === undefined) {
      throw new Error(`report is missing criterion ${criterion.id} — every criterion must be classified`);
    }
    if (!REPORT_STATUSES.includes(result.status)) {
      throw new Error(
        `criterion ${criterion.id} carries an unrecognised status ${JSON.stringify(result.status)} — ` +
          `expected one of ${REPORT_STATUSES.join(", ")}`,
      );
    }
    lines.push(`  [${result.status}] Criterion ${criterion.id}: ${criterion.text}`);
    if (result.detail) lines.push(`      ${result.detail}`);
  }
  return lines.join("\n");
}

// -------------------------------------------------------------------------------------------
// The `uat_authoring_ops` bridge — synchronous, throws with the binary's own stderr on failure.
// -------------------------------------------------------------------------------------------

function opsEnv(appDataDir) {
  return { ...process.env, FLYWHEEL_APP_DATA_DIR: appDataDir };
}

function runOps(binPath, appDataDir, args, input) {
  const result = spawnSync(binPath, args, { encoding: "utf8", env: opsEnv(appDataDir), input });
  if (result.status !== 0) {
    throw new Error(
      `uat_authoring_ops ${args.join(" ")} failed (status ${result.status}): ${result.stderr ?? ""}`,
    );
  }
  const trimmed = (result.stdout ?? "").trim();
  return trimmed.length > 0 ? JSON.parse(trimmed) : {};
}

/**
 * Load `packages/sidecar/dist/mcp-permission-server.js` lazily — never at module load — so
 * `--self-test` never depends on `npm --prefix packages/sidecar run build` having run.
 */
async function loadMcpPermissionServer() {
  const distPath = path.join(REPO_ROOT, "packages", "sidecar", "dist", "mcp-permission-server.js");
  if (!fs.existsSync(distPath)) {
    throw new Error(
      `the sidecar bundle was not found at ${distPath} — run \`npm --prefix packages/sidecar run build\` first`,
    );
  }
  return import(pathToFileURL(distPath).href);
}

/** Mirrors `packages/sidecar/test/socket-test-helpers.mjs::waitForListening` — a successful
 * connect is the observable proof a `net.Server` is actually accepting connections, since
 * `listen()`'s own callback fires on a later tick than `listen()` returns. Kept as a small local
 * copy rather than importing across the package boundary from another package's test directory. */
function waitForListening(socketPath) {
  return new Promise((resolve, reject) => {
    const client = net.createConnection(socketPath);
    client.once("connect", () => {
      client.end();
      resolve();
    });
    client.once("error", reject);
  });
}

/**
 * Translate one `AuthoringProposalPayload` (the shape `buildProposeItemPayload` builds, and the
 * shape a real session's own `proposal_created` wire event carries under `.payload`/`.rationale`/
 * `.targetType`) into `uat_authoring_ops propose-item`'s positional CLI args. Pure — no process,
 * no filesystem — so `--self-test` can assert it directly.
 */
function proposalPayloadToCliArgs(runId, payload) {
  const inner = payload.payload ?? {};
  const targetType = payload.targetType;
  const title = typeof inner.title === "string" ? inner.title : "";
  const rationale = typeof payload.rationale === "string" ? payload.rationale : "";
  const args = ["propose-item", runId, targetType, title, rationale];
  if (targetType === "issue") {
    // Both trailing slots are positional (body, then kind) — an issue's kind would otherwise land
    // in the body slot if the body were omitted, so a placeholder empty string is pushed even when
    // there is no body, keeping `kind` at its fixed position.
    args.push(typeof inner.body === "string" ? inner.body : "");
    args.push(typeof inner.issue_kind === "string" ? inner.issue_kind : "");
  } else if (typeof inner.description === "string") {
    args.push(inner.description);
  }
  return args;
}

/**
 * Stage one proposal over the REAL wire: `buildProposeItemPayload` builds the payload,
 * `stageAuthoringProposal` connects `handle.socketPath` and waits for an answer. Resolves with the
 * parsed `{staged, proposalId, duplicateCandidate?}` text block on success, or rejects with the
 * core's own refusal message (e.g. the proposal-limit text) on failure — mirroring
 * `packages/sidecar/test/propose-item-wire.test.mjs`'s own usage of these two functions exactly.
 */
async function stageViaWire(mcp, handle, { target_type, title, rationale, body, kind }) {
  const args = { target_type, title, rationale };
  if (body !== undefined) args.body = body;
  if (kind !== undefined) args.kind = kind;
  const payload = mcp.buildProposeItemPayload(args);
  const result = await mcp.stageAuthoringProposal(handle.socketPath, payload);
  return JSON.parse(result.content[0].text);
}

/**
 * Serve the socket `stageAuthoringProposal` connects to, with a REAL `startPermissionServer` —
 * answering every held proposal-staging call by shelling out to the bridge's `propose-item`, the
 * SAME real domain write path `commands::authoring::handle_inbound_proposal_created` calls in
 * production (via `apply_proposal_created`). `handle.lastBridgeOutcome` is set to the bridge's own
 * raw JSON on every call — including `duplicateOf`/`duplicateScore`, which the wire answer itself
 * never carries (this bridge never resolves a duplicate candidate's label; it relays none) — so a
 * caller can inspect the REAL DB-level verdict directly, never a value this script invents.
 */
function startOfflineProposalBridge(mcp, { opsBin, appDataDir, runId }) {
  const handle = mcp.startPermissionServer(
    () => {},
    () => {},
    () => {},
    (payload) => {
      const cliArgs = proposalPayloadToCliArgs(runId, payload);
      let outcome;
      try {
        outcome = runOps(opsBin, appDataDir, cliArgs);
      } catch (err) {
        const message = String(err?.message ?? err);
        handle.lastBridgeOutcome = { outcome: "bridge_error", error: message };
        handle.answerProposalStaged(payload.requestId, undefined, message);
        return;
      }
      handle.lastBridgeOutcome = outcome;
      if (outcome.outcome === "created") {
        handle.answerProposalStaged(payload.requestId, { proposalId: outcome.proposalId });
      } else if (outcome.outcome === "limit_exhausted") {
        handle.answerProposalStaged(
          payload.requestId,
          undefined,
          `proposal limit reached: this run has already staged ${outcome.count} of ${outcome.limit} ` +
            "allowed proposals — this one was NOT staged. Call report_summary and put it in the " +
            "remains field instead.",
        );
      } else {
        handle.answerProposalStaged(
          payload.requestId,
          undefined,
          `unexpected propose-item outcome: ${JSON.stringify(outcome)}`,
        );
      }
    },
  );
  return handle;
}

// -------------------------------------------------------------------------------------------
// Shared setup + the shared filler/verb walk (identical whether the first proposal was staged
// synthetically or by a real model).
// -------------------------------------------------------------------------------------------

function initScratchRepo(repoDir) {
  spawnSync("git", ["init", "-q", "-b", "main", repoDir]);
  spawnSync("git", [
    "-C",
    repoDir,
    "-c",
    "user.email=uat@flywheel.invalid",
    "-c",
    "user.name=Flywheel UAT",
    "commit",
    "-q",
    "--allow-empty",
    "-m",
    "initial",
  ]);
}

/**
 * Register a scratch project, seed one real task (via its own, SEPARATE agent run, so seeding
 * never spends a slot of the MAIN run's 10-proposal budget) to merge a proposal into later, then
 * start the main agent run this script's whole walk uses as its `propose_item` run_id. The bridge
 * offers no subcommand to create an `agent_run` under an externally-chosen id, and
 * `create_proposal_in_tx` only cares that a real `agent_runs` row exists — never whether it
 * carries an `authoring_stage` — so `start-run`'s own minted id is reused directly as the sidecar
 * spawn `runId` in `--live`. Mirrors `uat-08-socratic-authoring.mjs`'s own `--board-read-check`
 * setup shape.
 */
async function setupProjectAndSeedTask(opsBin, harness) {
  step("creating a scratch repository (no remote needed)");
  const repoDir = path.join(harness.root, "repo");
  initScratchRepo(repoDir);

  step("registering the scratch repository as a project");
  const project = runOps(opsBin, harness.appDataDir, ["register-project", repoDir]);
  step(`project ${project.projectId}`);

  step("seeding one real task (its own run, so seeding never spends the main run's proposal budget)");
  const seedRun = runOps(opsBin, harness.appDataDir, ["start-run", project.projectId]);
  const seedEvent = {
    type: "proposal_created",
    runId: seedRun.runId,
    verb: "create",
    targetType: "task",
    payload: { kind: "task", title: "UAT seed task (merge target)", description: null },
  };
  const appliedSeed = runOps(
    opsBin,
    harness.appDataDir,
    ["apply-proposal-created"],
    JSON.stringify(seedEvent),
  );
  assert.equal(
    appliedSeed.outcome,
    "created",
    `expected the seed task proposal to stage, got ${JSON.stringify(appliedSeed)}`,
  );
  const acceptedSeed = runOps(opsBin, harness.appDataDir, ["accept-proposal", appliedSeed.proposalId]);
  assert.ok(acceptedSeed.materialisedId, "expected the seed task to materialise");
  step(`seed task materialised: ${acceptedSeed.materialisedId}`);

  step("starting the main agent run (its id is this script's propose_item run_id throughout)");
  const run = runOps(opsBin, harness.appDataDir, ["start-run", project.projectId]);
  step(`run ${run.runId}`);

  return { projectId: project.projectId, runId: run.runId, seedTaskId: acceptedSeed.materialisedId };
}

/**
 * The whole per-run walk, shared by both modes: a handful of generic filler proposals FIRST (bm25
 * needs a realistic corpus to compute a meaningfully negative IDF-weighted score against — scoring
 * a near-duplicate pair alone, in a brand-new two-document corpus, measurably under-scores the
 * pinned -21.0 threshold, since IDF collapses toward zero when every term is common across the
 * WHOLE tiny corpus; `06-04-SUMMARY.md`'s own pinned fixture measured this same property against a
 * 20-filler-row corpus for the identical reason), then `stageFirstProposal()` (criterion 1's own
 * subject — synthetic in `--offline`, a real model's own tool call in `--live`), then a
 * near-duplicate of it (asserts the duplicate verdict), then one more filler to reach the per-run
 * limit of 10 (asserts the 10th succeeds), then an 11th (asserts it is refused, naming the limit),
 * the derived limit notice, and all four triage verbs. `handle` is an ALREADY-LISTENING
 * `startOfflineProposalBridge` handle the caller owns the lifecycle of.
 */
async function runAgentBacklogFlow({ mcp, handle, opsBin, appDataDir, projectId, runId, seedTaskId, stageFirstProposal }) {
  const stagedIds = [];

  step("staging 7 generic filler proposals first, so bm25 has a realistic corpus to score the near-duplicate against");
  for (let n = 1; n <= 7; n += 1) {
    const filler = await stageViaWire(mcp, handle, {
      target_type: "task",
      title: `UAT backlog filler item ${n}`,
      rationale: `Filling the run's proposal budget for the limit test (item ${n})`,
    });
    assert.ok(filler.proposalId, `expected filler ${n} to stage, got ${JSON.stringify(filler)}`);
    stagedIds.push(filler.proposalId);
  }

  const firstProposal = await stageFirstProposal();
  stagedIds.push(firstProposal.proposalId);

  step("staging a near-duplicate of the first proposal and asserting the duplicate verdict is present");
  // bm25's score is a SUM over every matching query term — a title-only restatement of a SHORT
  // title (a handful of words) measurably under-scores the pinned -21.0 threshold even with a
  // realistic corpus (confirmed empirically while building this script: a 5-word title alone
  // scored around -8.6, nowhere near the threshold, while the SAME title plus a shared,
  // multi-sentence body scored -53.8). Restating the first proposal's own BODY VERBATIM alongside
  // a reworded title — exactly what a real near-duplicate restatement does, and exactly the shape
  // `06-04-SUMMARY.md`'s own pinned fixture used (title+body pairs, never title alone) — is what
  // gives bm25 enough shared terms to score strongly.
  const dupWire = await stageViaWire(mcp, handle, {
    target_type: firstProposal.targetType,
    title: `${firstProposal.title} (restated)`,
    body: firstProposal.body,
    rationale: "Restating the same finding in different words, to exercise duplicate detection",
  });
  assert.ok(dupWire.proposalId, `expected the near-duplicate to stage, got ${JSON.stringify(dupWire)}`);
  const dupOutcome = handle.lastBridgeOutcome;
  assert.ok(
    dupOutcome?.duplicateOf,
    `expected the near-duplicate to carry a duplicateOf candidate, got ${JSON.stringify(dupOutcome)}`,
  );
  assert.equal(
    dupOutcome.duplicateOf,
    firstProposal.proposalId,
    `expected the near-duplicate's candidate to be the first proposal itself, got ${JSON.stringify(dupOutcome)}`,
  );
  step(`duplicate verdict: duplicateOf=${dupOutcome.duplicateOf} duplicateScore=${dupOutcome.duplicateScore}`);
  stagedIds.push(dupWire.proposalId);

  step("staging one more filler proposal to reach the per-run limit of 10");
  const tenth = await stageViaWire(mcp, handle, {
    target_type: "task",
    title: "UAT backlog filler item 8",
    rationale: "Filling the run's proposal budget for the limit test (item 8)",
  });
  assert.ok(tenth.proposalId, `expected the 10th proposal to stage, got ${JSON.stringify(tenth)}`);
  stagedIds.push(tenth.proposalId);
  assert.equal(
    stagedIds.length,
    10,
    `expected exactly 10 staged proposals before the limit test, got ${stagedIds.length}`,
  );
  step("staged exactly 10 proposals for this run (the 10th succeeded)");

  step("staging an 11th proposal and asserting it is refused, naming the limit");
  let refused;
  try {
    await stageViaWire(mcp, handle, {
      target_type: "task",
      title: "The 11th finding",
      rationale: "This one must be refused by the per-run limit",
    });
    assert.fail("expected the 11th proposal to be refused by the per-run limit");
  } catch (err) {
    refused = err;
  }
  assert.match(refused.message, /proposal limit reached/);
  assert.match(refused.message, /report_summary/);
  step("the 11th proposal was refused, naming the limit and pointing at report_summary's remains field");

  step("asserting limit-notices reports exactly one notice for this run");
  const notices = runOps(opsBin, appDataDir, ["limit-notices", projectId]);
  const ownNotice = notices.find((notice) => notice.agentRunId === runId);
  assert.ok(ownNotice, `expected a limit notice for run ${runId}, got ${JSON.stringify(notices)}`);
  assert.equal(
    ownNotice.refusedCount,
    1,
    `expected exactly one refusal recorded, got ${JSON.stringify(ownNotice)}`,
  );
  step(`limit notice: ${JSON.stringify(ownNotice)}`);

  step("exercising all four triage verbs: accept, reject, merge, defer");
  const [acceptId, rejectId, mergeId, deferId] = stagedIds.slice(2, 6);
  assert.ok(acceptId && rejectId && mergeId && deferId, "expected at least 6 staged proposals for the verb walk");

  const countsBeforeAccept = runOps(opsBin, appDataDir, ["board-counts", projectId]);
  const accepted = runOps(opsBin, appDataDir, ["accept-proposal", acceptId]);
  assert.ok(accepted.materialisedId, `expected accept-proposal to mint a canonical row, got ${JSON.stringify(accepted)}`);
  const countsAfterAccept = runOps(opsBin, appDataDir, ["board-counts", projectId]);
  assert.equal(
    countsAfterAccept.tasks,
    countsBeforeAccept.tasks + 1,
    "expected exactly one new canonical task after accepting",
  );
  step(`accept: ${acceptId} -> task ${accepted.materialisedId}`);

  const rejected = runOps(opsBin, appDataDir, ["reject-proposal", rejectId]);
  assert.equal(rejected.status, "rejected", `expected status rejected, got ${JSON.stringify(rejected)}`);
  step(`reject: ${rejectId} -> ${rejected.status}`);

  const countsBeforeMerge = runOps(opsBin, appDataDir, ["board-counts", projectId]);
  const merged = runOps(opsBin, appDataDir, ["merge-proposal", mergeId, "task", seedTaskId]);
  assert.ok(merged.issueId, `expected merge-proposal to mint a child issue, got ${JSON.stringify(merged)}`);
  const countsAfterMerge = runOps(opsBin, appDataDir, ["board-counts", projectId]);
  assert.equal(
    countsAfterMerge.tasks,
    countsBeforeMerge.tasks,
    "expected the merge target task row to stay unchanged (no new task minted by a merge)",
  );
  step(`merge: ${mergeId} -> issue ${merged.issueId}; seeded task row unchanged (tasks stayed at ${countsAfterMerge.tasks})`);

  const deferred = runOps(opsBin, appDataDir, ["defer-proposal", deferId]);
  assert.equal(deferred.status, "deferred", `expected status deferred, got ${JSON.stringify(deferred)}`);
  const countsAfterDefer = runOps(opsBin, appDataDir, ["board-counts", projectId]);
  assert.equal(countsAfterDefer.tasks, countsAfterMerge.tasks, "expected defer to mint nothing");
  const deferredList = runOps(opsBin, appDataDir, ["list-deferred", projectId]);
  const deferredRow = deferredList.proposals.find((p) => p.id === deferId);
  assert.ok(deferredRow, `expected ${deferId} in list-deferred, got ${JSON.stringify(deferredList)}`);
  step(`defer: ${deferId} -> appears in list-deferred, minted nothing, rationale=${JSON.stringify(deferredRow.rationale)}`);

  return {
    results: {
      2: {
        status: "observed",
        detail:
          "All four triage verbs (accept/reject/merge/defer) proven end to end through the real " +
          "domain functions; the dedicated-view's own rendering is proven separately by component " +
          "tests (packages/desktop/src/triage/__tests__/*, plans 06-07/06-08), not by this script.",
      },
      3: {
        status: "observed",
        detail:
          `the deferred proposal's rationale round-trips through list-deferred: ` +
          `${JSON.stringify(deferredRow.rationale)}. Agent-run attribution is enforced structurally ` +
          "by create_proposal_in_tx's identity-from-agent_runs-row design — every proposal in this " +
          "walk only staged because its run_id resolved to this run's own project/epic/actor — " +
          "proven directly by packages/core/tests/proposal_channel.rs.",
      },
      4: {
        status: "observed",
        detail:
          `a near-duplicate's duplicateOf/duplicateScore were present on the real staged row before ` +
          `any triage decision was made (duplicateOf=${dupOutcome.duplicateOf}, ` +
          `duplicateScore=${dupOutcome.duplicateScore}).`,
      },
      5: {
        status: "observed",
        detail:
          "the 11th proposal in this run was refused, naming the limit (10) and pointing the agent " +
          `at report_summary's remains field; limit-notices reported exactly one notice ` +
          `(refusedCount=1) for this run.`,
      },
    },
  };
}

// -------------------------------------------------------------------------------------------
// --self-test
// -------------------------------------------------------------------------------------------

async function selfTestBody() {
  step("asserting renderReport prints every criterion and never marks an unmeasured one observed");
  const allNotMeasured = {};
  for (const criterion of SUCCESS_CRITERIA) {
    allNotMeasured[criterion.id] = { status: "not-measured", detail: "self-test stub" };
  }
  const rendered = renderReport(allNotMeasured);
  assert.ok(!/\[observed\]/.test(rendered), `expected no [observed] marker anywhere, got: ${rendered}`);
  assert.ok(/\[not-measured\]/.test(rendered), `expected at least one [not-measured] marker: ${rendered}`);
  for (const criterion of SUCCESS_CRITERIA) {
    assert.ok(rendered.includes(`Criterion ${criterion.id}:`), `expected Criterion ${criterion.id} in the report`);
  }

  step("asserting renderReport throws rather than silently omitting an unclassified criterion");
  assert.throws(() => renderReport({}), /missing criterion/);

  step("asserting renderReport rejects an unrecognised status rather than printing it as if it were real");
  const badStatus = {};
  for (const criterion of SUCCESS_CRITERIA) badStatus[criterion.id] = { status: "not-measured" };
  badStatus[1] = { status: "yes-definitely" };
  assert.throws(() => renderReport(badStatus), /unrecognised status/);

  step("asserting a mixed report prints each criterion's own status, never bleeding into a neighbour");
  const mixed = {};
  for (const criterion of SUCCESS_CRITERIA) mixed[criterion.id] = { status: "not-measured" };
  mixed[4] = { status: "observed", detail: "duplicate flag present" };
  const mixedRendered = renderReport(mixed);
  assert.ok(mixedRendered.includes("[observed] Criterion 4"), mixedRendered);
  assert.ok(mixedRendered.includes("duplicate flag present"), mixedRendered);
  assert.ok(mixedRendered.includes("[not-measured] Criterion 1"), mixedRendered);

  step("asserting proposalPayloadToCliArgs translates a task payload positionally");
  assert.deepEqual(
    proposalPayloadToCliArgs("RUN123", {
      targetType: "task",
      rationale: "r",
      payload: { kind: "task", title: "t", description: "d" },
    }),
    ["propose-item", "RUN123", "task", "t", "r", "d"],
  );

  step("asserting proposalPayloadToCliArgs translates an issue payload with both body and kind in position");
  assert.deepEqual(
    proposalPayloadToCliArgs("RUN123", {
      targetType: "issue",
      rationale: "r",
      payload: { kind: "issue", title: "t", body: "b", issue_kind: "bug" },
    }),
    ["propose-item", "RUN123", "issue", "t", "r", "b", "bug"],
  );

  step("asserting a task payload with no description omits the trailing body arg entirely");
  assert.deepEqual(
    proposalPayloadToCliArgs("RUN123", {
      targetType: "task",
      rationale: "r",
      payload: { kind: "task", title: "t" },
    }),
    ["propose-item", "RUN123", "task", "t", "r"],
  );

  step("asserting an issue payload with no body still places kind in its fixed position");
  assert.deepEqual(
    proposalPayloadToCliArgs("RUN123", {
      targetType: "issue",
      rationale: "r",
      payload: { kind: "issue", title: "t", issue_kind: "idea" },
    }),
    ["propose-item", "RUN123", "issue", "t", "r", "", "idea"],
  );
}

// -------------------------------------------------------------------------------------------
// --offline
// -------------------------------------------------------------------------------------------

async function offlineBody(harness) {
  const opsBin = resolveHarnessBinary("uat_authoring_ops");
  if (opsBin === undefined) {
    throw new Error("uat_authoring_ops is not built — run `cargo build -p core --bin uat_authoring_ops`");
  }
  const mcp = await loadMcpPermissionServer();

  const { projectId, runId, seedTaskId } = await setupProjectAndSeedTask(opsBin, harness);

  const handle = startOfflineProposalBridge(mcp, { opsBin, appDataDir: harness.appDataDir, runId });
  let flowResults;
  try {
    await waitForListening(handle.socketPath);

    const firstTitle = "Flaky retry test needs investigation";
    const firstBody =
      "The retry loop silently drops webhook delivery events whenever concurrent load spikes " +
      "during execution, found while working on an unrelated task.";
    const stageFirstProposal = async () => {
      step("staging the first proposal through the real wire (buildProposeItemPayload + stageAuthoringProposal)");
      const firstWire = await stageViaWire(mcp, handle, {
        target_type: "task",
        title: firstTitle,
        body: firstBody,
        rationale: "Found while executing an unrelated task — the retry loop drops events under load",
      });
      assert.ok(firstWire.proposalId, `expected the first proposal to stage, got ${JSON.stringify(firstWire)}`);
      step(`first proposal staged (offline, synthetic wire call): ${firstWire.proposalId}`);
      return { proposalId: firstWire.proposalId, title: firstTitle, body: firstBody, targetType: "task" };
    };

    ({ results: flowResults } = await runAgentBacklogFlow({
      mcp,
      handle,
      opsBin,
      appDataDir: harness.appDataDir,
      projectId,
      runId,
      seedTaskId,
      stageFirstProposal,
    }));
  } finally {
    handle.close();
  }

  const results = {
    1: {
      status: "not-measured",
      detail:
        "This mode stages the first proposal synthetically through the real wire functions " +
        "(buildProposeItemPayload/stageAuthoringProposal) — it never drives a real model's own " +
        "decision to call propose_item mid-session. That half of this criterion is live-only by " +
        "construction (Phase 5's own lesson, recorded in scripts/uat/README.md: never report a " +
        "criterion observed in a mode that cannot reach it). Run --live to measure it.",
    },
    ...flowResults,
  };

  process.stdout.write(`\n${renderReport(results)}\n`);
}

// -------------------------------------------------------------------------------------------
// --live
// -------------------------------------------------------------------------------------------

async function liveBody(harness) {
  if (!probeClaudeAvailable()) {
    skip("the real `claude` binary is not resolvable — this item needs a live backend session");
  }
  const opsBin = resolveHarnessBinary("uat_authoring_ops");
  if (opsBin === undefined) {
    throw new Error("uat_authoring_ops is not built — run `cargo build -p core --bin uat_authoring_ops`");
  }
  // No `uat_session_env` build guard here: `harness.sessionEnv` below throws with the same
  // `cargo build -p core --bin uat_session_env` hint, and it owns the binary now (D-105).
  const mcp = await loadMcpPermissionServer();

  const { projectId, runId, seedTaskId } = await setupProjectAndSeedTask(opsBin, harness);

  const env = { ...harness.sessionEnv(runId, "main"), ...harness.cleanClaudeConfigEnv() };
  assertClaudeConfigIsolated(env);
  step(`isolation asserted: CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`);

  // The production-cadence heartbeat writer is `sessionEnv`'s default as of D-105, not a block
  // repeated here.

  const workPath = path.join(harness.root, "work");
  initScratchRepo(workPath);

  let firstRationale;
  let firstTitleCaptured;

  /**
   * Spawns the real session only once — called by `runAgentBacklogFlow` AFTER the 7 generic
   * fillers are already staged on this same run, so the live model's own propose_item call lands
   * as proposal #8 of 10 (it does not need to know or care how many proposals already exist on
   * its own run). The `proposal_created` handler below plays "the desktop app's own inbound
   * handler": it shells out to the SAME `apply_proposal_created` function
   * `commands::authoring::handle_inbound_proposal_created` calls in production, then answers the
   * sidecar's held socket call exactly the way the Rust core's `authoring_proposal_answer` op does.
   */
  const stageFirstProposalLive = async () => {
    step("starting the real sidecar and completing its readiness handshake");
    const sidecar = await harness.startSidecar();

    step("spawning a real claude execution-run session with propose_item pre-approved");
    await sidecar.request({
      op: "spawn",
      runId,
      worktreePath: workPath,
      prompt:
        "You are mid-way through an ordinary task. While working, you notice a real, separate " +
        "problem worth flagging for later: a flaky retry test that drops events under load. Call " +
        'the propose_item tool exactly once: target_type "task", a short title describing the ' +
        "problem, a body with 2-3 sentences giving real detail about what you observed (not just " +
        "the title restated), and a rationale explaining what you noticed and why it is worth " +
        "someone's attention. Do not do anything else — do not run any other tool, do not ask for " +
        "confirmation, just call propose_item once and then stop.",
      permissionMode: "bypassPermissions",
      env,
    });

    let draining = true;
    harness.onCleanup(() => {
      draining = false;
    });
    let firstProposalId;
    let firstBodyCaptured;
    let firstTargetType;
    let applyError;
    // Fire-and-forget, deliberately not awaited — mirrors every other live script in this
    // directory (see `drainIncidentalPermissionRequests`'s own doc comment in
    // lib/sidecar-harness.mjs).
    drainInboundCoreRequests(sidecar, runId, {
      handlers: {
        permission_request: createPermissionAnswerHandler(sidecar, runId, () => false),
        proposal_created: async (event) => {
          firstRationale = event.rationale;
          firstTitleCaptured = event.payload?.title;
          firstBodyCaptured = event.payload?.description;
          firstTargetType = event.targetType;
          let applied;
          try {
            applied = runOps(opsBin, harness.appDataDir, ["apply-proposal-created"], JSON.stringify(event));
          } catch (err) {
            applyError = err;
            await sidecar
              .request({
                op: "authoring_proposal_answer",
                runId,
                requestId: event.requestId,
                error: String(err?.message ?? err),
              })
              .catch(() => {});
            return;
          }
          if (applied.outcome === "created") {
            firstProposalId = applied.proposalId;
            await sidecar
              .request({
                op: "authoring_proposal_answer",
                runId,
                requestId: event.requestId,
                result: { proposalId: applied.proposalId },
              })
              .catch(() => {});
          } else {
            applyError = new Error(
              `apply-proposal-created returned an unexpected outcome: ${JSON.stringify(applied)}`,
            );
            await sidecar
              .request({
                op: "authoring_proposal_answer",
                runId,
                requestId: event.requestId,
                error: `unexpected outcome: ${applied.outcome}`,
              })
              .catch(() => {});
          }
        },
      },
      shouldStop: () => !draining,
    });

    step("waiting for the real session's own proposal_created event (the agent's own decision to call propose_item)");
    await sidecar.waitForEvent(
      (event) => event.type === "proposal_created" && event.runId === runId,
      180_000,
      "a real proposal_created event from the live session",
    );
    // The handler above applies and answers asynchronously from inside the same dispatch loop
    // that resolved the wait above — give it a brief window to finish before reading what it set.
    for (let i = 0; i < 50 && firstProposalId === undefined && applyError === undefined; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    draining = false;

    if (applyError) throw applyError;
    assert.ok(firstProposalId, "expected the live proposal_created event to apply and mint a proposal id");
    assert.ok(
      typeof firstRationale === "string" && firstRationale.trim().length > 0,
      "expected the live proposal to carry a non-empty rationale",
    );
    step(`live proposal staged: ${firstProposalId}, title=${JSON.stringify(firstTitleCaptured)}`);
    step(`the agent's own rationale: ${JSON.stringify(firstRationale)}`);

    step("interrupting the live session — its one propose_item call is answered, nothing further is needed");
    await sidecar.request({ op: "interrupt", runId }).catch(() => {});

    return {
      proposalId: firstProposalId,
      title: firstTitleCaptured,
      body: firstBodyCaptured,
      targetType: firstTargetType ?? "task",
    };
  };

  const handle = startOfflineProposalBridge(mcp, { opsBin, appDataDir: harness.appDataDir, runId });
  let flowResults;
  try {
    await waitForListening(handle.socketPath);
    ({ results: flowResults } = await runAgentBacklogFlow({
      mcp,
      handle,
      opsBin,
      appDataDir: harness.appDataDir,
      projectId,
      runId,
      seedTaskId,
      stageFirstProposal: stageFirstProposalLive,
    }));
  } finally {
    handle.close();
  }

  const results = {
    1: {
      status: "observed",
      detail:
        "a real claude execution-run session called propose_item once, mid-session, staging a " +
        `pending proposal with its own rationale: ${JSON.stringify(firstRationale)} (title: ` +
        `${JSON.stringify(firstTitleCaptured)}).`,
    },
    ...flowResults,
  };

  process.stdout.write(`\n${renderReport(results)}\n`);
}

// -------------------------------------------------------------------------------------------
// Dispatch
// -------------------------------------------------------------------------------------------

if (process.argv.includes("--self-test")) {
  await runScript("agent-backlog-self-test", "UAT 10 — self-test (report formatting + arg translation, no child process)", selfTestBody);
} else if (process.argv.includes("--offline")) {
  await runScript("agent-backlog-offline", "UAT 10 — phase-6 agent backlog loop (offline, zero tokens)", offlineBody);
} else if (process.argv.includes("--live")) {
  await runScript("agent-backlog-live", "UAT 10 — phase-6 agent backlog loop (live, costs real tokens)", liveBody);
} else {
  process.stderr.write(
    "usage: uat-10-agent-backlog.mjs --self-test | --offline | --live\n" +
      "  --self-test  pure, offline, no child process — report formatting + arg-translation checks\n" +
      "  --offline    the whole flow, zero tokens, via the real wire functions and the bridge\n" +
      "  --live       the same flow, but the first proposal comes from a real claude session " +
      "(costs tokens)\n",
  );
  process.exit(2);
}
