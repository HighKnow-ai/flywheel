#!/usr/bin/env node
/**
 * Phase 5, Plan 17 (gap HUMAN-02) — the Product Kill Criterion's comparison, turned from a
 * hand-run protocol (`05-SPIKE-FINDINGS.md`'s "Measurement Protocol") into one command per arm
 * and one file holding both numbers and the verdict.
 *
 * Unlike `uat-08-socratic-authoring.mjs`, this script does NOT use the sidecar harness's
 * `Harness` class and starts no sidecar — it reads the developer's REAL fleet database through
 * the read-only `uat_authoring_ops` subcommands plan 05-17 adds (`recent-authoring-runs`,
 * `measure-run`, `measure-board-counts`), so it passes `process.env` through untouched and must
 * never set `FLYWHEEL_APP_DATA_DIR`. Only `REPO_ROOT`, `resolveHarnessBinary` and `step` are
 * imported from the shared lib.
 *
 * `--self-test`: pure, offline, no child process, no binary resolution and no file written —
 * mirrors `uat-08-socratic-authoring.mjs`'s own `--self-test` convention, exercising the three
 * module-level pure functions below with the criterion's own adjacency and empty edges (an exact
 * tie on minutes, an amendment rate of exactly one half, a zero-criteria run).
 *
 * `--list-runs [n]`: shells `recent-authoring-runs` and prints one labelled line per run, so a
 * run id is found from the terminal rather than read off a UI surface.
 *
 * `--in-app-run <runId> [--terminal-project <projectId>] [--in-app-minutes <n>]`: the comparison
 * sitting. Reads the in-app arm's own numbers with `measure-run` (its `elapsedMinutes` is
 * board-derived, never hand-timed, unless `--in-app-minutes` explicitly overrides it), prints the
 * terminal arm's brief so both arms shape the identical epic, times the terminal arm with this
 * instrument's own monotonic clock, derives the terminal arm's task/criteria counts as a
 * before-and-after board difference when `--terminal-project` is given (otherwise prompts for
 * them), prompts for the terminal arm's reworded count (no board read can supply it — a bare
 * terminal has no amend record), computes the verdict by the criterion's own rule, and writes
 * both arms plus the verdict to `05-KILL-CRITERION.md`.
 *
 * The live comparison costs real time from a human performing the terminal arm at human pace —
 * it is not executed by an autonomous CI/executor run, exactly like `uat-08`'s own live mode.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

import { REPO_ROOT, resolveHarnessBinary, step } from "./lib/sidecar-harness.mjs";

// ---------------------------------------------------------------------------------------------
// Pure core — asserted offline by --self-test, never touched by anything that reaches a file or
// a child process.
// ---------------------------------------------------------------------------------------------

/** Human-readable copy per verdict, kept in one table so "the layout finding" phrase appears in
 * exactly one place — the `option-b` row — and can never leak into an `option-a` or
 * `indeterminate` sheet by accident. */
const VERDICT_COPY = {
  "option-b":
    "option-b — the layout finding applies: the in-app arm was slower AND more than half its " +
    "accepted criteria were amended before acceptance",
  "option-a":
    "option-a — no layout change: the rule's two clauses (slower AND more-than-half-amended) " +
    "were not both satisfied",
  indeterminate: "indeterminate — not enough signal to apply the rule",
};

/**
 * Pure: applies `05-SPIKE-FINDINGS.md`'s `changes_the_plan_when` rule verbatim to one in-app
 * measurement and one terminal measurement.
 *
 * `inApp`: `{ minutes, acceptedTaskProposals, acceptedCriterionProposals, amendedBeforeAccept }`.
 * `terminal`: `{ minutes }` — only the terminal arm's elapsed minutes feed the rule; its reworded
 * count is recorded on the sheet for context but plays no part in the verdict, since the
 * criterion's own rule is stated entirely in terms of the in-app arm's own accepted criteria.
 *
 * Returns `{ verdict, amendmentRate, minutesDelta, reason }`. `verdict` is one of `option-a`,
 * `option-b` or `indeterminate`. `indeterminate` — and NEVER a division — happens when either
 * arm's minutes are missing, when the in-app arm accepted fewer than three task proposals (the
 * protocol's own validity bar), or when it accepted zero criterion proposals (the rate is
 * undefined). `option-b` requires BOTH the in-app arm's minutes to be STRICTLY GREATER than the
 * terminal arm's AND its amendment rate to be STRICTLY GREATER than one half — an exact tie on
 * either clause is `option-a`, never `option-b`, and an indeterminate result never falls through
 * to `option-a`.
 */
function computeKillCriterionVerdict(inApp, terminal) {
  const { minutes: inAppMinutes, acceptedTaskProposals, acceptedCriterionProposals, amendedBeforeAccept } =
    inApp;
  const { minutes: terminalMinutes } = terminal;

  if (inAppMinutes == null || terminalMinutes == null) {
    return {
      verdict: "indeterminate",
      amendmentRate: null,
      minutesDelta: null,
      reason: "one or both arms have no elapsed-minutes measurement",
    };
  }

  const minutesDelta = inAppMinutes - terminalMinutes;

  if (acceptedTaskProposals < 3) {
    return {
      verdict: "indeterminate",
      amendmentRate: null,
      minutesDelta,
      reason: "fewer than three accepted task proposals — the protocol's own validity bar",
    };
  }

  if (acceptedCriterionProposals === 0) {
    return {
      verdict: "indeterminate",
      amendmentRate: null,
      minutesDelta,
      reason: "zero accepted criterion proposals — the amendment rate is undefined",
    };
  }

  const amendmentRate = amendedBeforeAccept / acceptedCriterionProposals;
  const slower = inAppMinutes > terminalMinutes;
  const heavilyAmended = amendmentRate > 0.5;
  const verdict = slower && heavilyAmended ? "option-b" : "option-a";

  return { verdict, amendmentRate, minutesDelta, reason: null };
}

function fmtNum(value, digits = 1) {
  return value == null ? "n/a" : Number(value).toFixed(digits);
}

/**
 * Pure: renders the Markdown evidence sheet both arms and the computed verdict land in. No
 * filesystem or process access. `record`: `{ timestamp, runId, inApp, terminal, verdictResult }`
 * — see `runComparison` below for the exact shape each field carries. Every number is printed
 * beside the ONE word naming its source (`board-derived`, `operator-supplied` or
 * `instrument-measured`), so a later reader can tell measurement from testimony.
 */
function renderKillCriterionSheet(record) {
  const { timestamp, runId, inApp, terminal, verdictResult } = record;
  const { verdict, amendmentRate, minutesDelta, reason } = verdictResult;
  const verdictCopy = VERDICT_COPY[verdict] ?? verdict;

  return `# Phase 5 — Socratic Epic Authoring — Product Kill Criterion

**Captured:** ${timestamp}
**In-app run:** ${runId}

## In-app arm

- Elapsed minutes: ${fmtNum(inApp.minutes)} (${inApp.minutesSource})
- Accepted task proposals: ${inApp.acceptedTaskProposals} (board-derived)
- Accepted criterion proposals: ${inApp.acceptedCriterionProposals} (board-derived)
- Amended-before-accept criteria: ${inApp.amendedBeforeAccept} (board-derived)

## Terminal arm

- Elapsed minutes: ${fmtNum(terminal.minutes)} (${terminal.minutesSource})
- Tasks entered: ${terminal.tasks} (${terminal.tasksSource})
- Criteria entered: ${terminal.criteria} (${terminal.criteriaSource})
- Reworded criteria: ${terminal.reworded} (${terminal.rewordedSource})

## Computed verdict

- In-app amendment rate: ${amendmentRate == null ? "n/a" : amendmentRate.toFixed(2)}
- Minutes delta (in-app minus terminal): ${fmtNum(minutesDelta)}
- Verdict: ${verdictCopy}${reason ? ` — ${reason}` : ""}

## Notes (operator — fill in if useful)

_(blank)_
`;
}

/**
 * Pure: the instruction block printed before the terminal arm's clock starts, so both arms shape
 * the IDENTICAL epic — the comparison is meaningless otherwise.
 */
function formatTerminalArmBrief(premise) {
  return `Terminal arm — shape the SAME epic the in-app arm just shaped.

Premise: "${premise}"

Prompt \`claude\` directly in a terminal on this identical premise — no app, no composer, no
proposal tray. Decompose it into at least three tasks, each carrying at least one acceptance
criterion, and hand-enter every task and criterion onto the board through quick-add as the model
proposes them. Press Enter here the moment the LAST criterion has been entered — that stops this
instrument's own clock.`;
}

/** The premise both arms shape — fixed so a rerun of the comparison is apples-to-apples. */
const SHAPING_PREMISE =
  "Build a notifications feature so a user gets pinged when something on their board needs them.";

/** Fixed evidence-sheet file name — one per project, overwritten per run (mirrors `uat-08`'s own
 * `05-LIVE-CHALLENGE-TRANSCRIPT.md` convention). */
const EVIDENCE_FILE_NAME = "05-KILL-CRITERION.md";

/**
 * Resolve the one fixed path the sheet is written to: `FLYWHEEL_UAT_EVIDENCE_DIR` when set,
 * otherwise the phase directory under the harness's own `REPO_ROOT` — never a temp directory.
 * Creates the directory if absent. Never called by `--self-test`.
 */
function resolveEvidencePath() {
  const dir =
    process.env.FLYWHEEL_UAT_EVIDENCE_DIR ??
    path.join(REPO_ROOT, "target", "uat-evidence");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, EVIDENCE_FILE_NAME);
}

// ---------------------------------------------------------------------------------------------
// self-test — no child process, no binary resolution, no file, ever
// ---------------------------------------------------------------------------------------------

function buildSyntheticRecord({ verdict, amendmentRate, minutesDelta, reason }) {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    runId: "01ABCDEFGHJKMNPQRSTVWXYZ0",
    inApp: {
      minutes: 42,
      minutesSource: "board-derived",
      acceptedTaskProposals: 5,
      acceptedCriterionProposals: 4,
      amendedBeforeAccept: 3,
    },
    terminal: {
      minutes: 30,
      minutesSource: "instrument-measured",
      tasks: 5,
      tasksSource: "board-derived",
      criteria: 4,
      criteriaSource: "board-derived",
      reworded: 1,
      rewordedSource: "operator-supplied",
    },
    verdictResult: { verdict, amendmentRate, minutesDelta, reason: reason ?? null },
  };
}

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

  check("slower AND heavily amended gives option-b", () => {
    const result = computeKillCriterionVerdict(
      { minutes: 40, acceptedTaskProposals: 5, acceptedCriterionProposals: 4, amendedBeforeAccept: 3 },
      { minutes: 20 },
    );
    assert.equal(result.verdict, "option-b");
  });

  check("slower AND lightly amended gives option-a", () => {
    const result = computeKillCriterionVerdict(
      { minutes: 40, acceptedTaskProposals: 5, acceptedCriterionProposals: 4, amendedBeforeAccept: 1 },
      { minutes: 20 },
    );
    assert.equal(result.verdict, "option-a");
  });

  check("faster AND heavily amended gives option-a", () => {
    const result = computeKillCriterionVerdict(
      { minutes: 10, acceptedTaskProposals: 5, acceptedCriterionProposals: 4, amendedBeforeAccept: 3 },
      { minutes: 20 },
    );
    assert.equal(result.verdict, "option-a");
  });

  check("an exact tie on minutes is not slower and gives option-a", () => {
    const result = computeKillCriterionVerdict(
      { minutes: 20, acceptedTaskProposals: 5, acceptedCriterionProposals: 4, amendedBeforeAccept: 3 },
      { minutes: 20 },
    );
    assert.equal(result.verdict, "option-a");
  });

  check("an amendment rate of exactly one half is not more than half and gives option-a", () => {
    const result = computeKillCriterionVerdict(
      { minutes: 40, acceptedTaskProposals: 5, acceptedCriterionProposals: 4, amendedBeforeAccept: 2 },
      { minutes: 20 },
    );
    assert.equal(result.amendmentRate, 0.5);
    assert.equal(result.verdict, "option-a");
  });

  check("zero accepted criterion proposals gives indeterminate and performs no division", () => {
    const result = computeKillCriterionVerdict(
      { minutes: 40, acceptedTaskProposals: 5, acceptedCriterionProposals: 0, amendedBeforeAccept: 0 },
      { minutes: 20 },
    );
    assert.equal(result.verdict, "indeterminate");
    assert.equal(result.amendmentRate, null, "no division must have been performed — not NaN, not Infinity");
  });

  check("fewer than three accepted task proposals gives indeterminate", () => {
    const result = computeKillCriterionVerdict(
      { minutes: 40, acceptedTaskProposals: 2, acceptedCriterionProposals: 4, amendedBeforeAccept: 3 },
      { minutes: 20 },
    );
    assert.equal(result.verdict, "indeterminate");
  });

  check("missing minutes on either arm gives indeterminate, never a default option-a", () => {
    const result = computeKillCriterionVerdict(
      { minutes: null, acceptedTaskProposals: 5, acceptedCriterionProposals: 4, amendedBeforeAccept: 3 },
      { minutes: 20 },
    );
    assert.equal(result.verdict, "indeterminate");
  });

  check("formatTerminalArmBrief states the given premise verbatim so both arms shape the same epic", () => {
    const brief = formatTerminalArmBrief("A synthetic premise unique to this check");
    assert.ok(brief.includes("A synthetic premise unique to this check"));
  });

  check("the sheet renders identically for identical input", () => {
    const record = buildSyntheticRecord({ verdict: "option-b", amendmentRate: 0.75, minutesDelta: 10 });
    const first = renderKillCriterionSheet(record);
    const second = renderKillCriterionSheet(record);
    assert.equal(first, second);
  });

  check("the sheet never contains the layout-change verdict when the computed verdict was option-a", () => {
    const record = buildSyntheticRecord({ verdict: "option-a", amendmentRate: 0.2, minutesDelta: -5 });
    const sheet = renderKillCriterionSheet(record);
    assert.ok(!sheet.includes("the layout finding applies"));
  });

  check("the sheet states the verdict's own rule when the verdict is option-b", () => {
    const record = buildSyntheticRecord({ verdict: "option-b", amendmentRate: 0.75, minutesDelta: 10 });
    const sheet = renderKillCriterionSheet(record);
    assert.ok(sheet.includes("the layout finding applies"));
  });

  if (failures > 0) {
    console.error(`[self-test] ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log("[self-test] all assertions passed — no child process was spawned, no binary was resolved, no file was written");
  process.exit(0);
}

// ---------------------------------------------------------------------------------------------
// the live comparison — reads the developer's REAL fleet database
// ---------------------------------------------------------------------------------------------

/** Shells one `uat_authoring_ops` subcommand with `process.env` passed through UNTOUCHED — this
 * script must never set `FLYWHEEL_APP_DATA_DIR`, so it reads the developer's own real database,
 * never a scratch one. */
function runOps(binPath, args) {
  const result = spawnSync(binPath, args, { encoding: "utf8", env: process.env });
  if (result.status !== 0) {
    throw new Error(`uat_authoring_ops ${args.join(" ")} failed (status ${result.status}): ${result.stderr ?? ""}`);
  }
  const trimmed = (result.stdout ?? "").trim();
  return trimmed.length > 0 ? JSON.parse(trimmed) : {};
}

function resolveOpsBinaryOrExit() {
  const binPath = resolveHarnessBinary("uat_authoring_ops");
  if (binPath === undefined) {
    console.error("uat_authoring_ops is not built — run: cargo build -p core --bin uat_authoring_ops");
    process.exit(1);
  }
  return binPath;
}

async function listRuns(limit) {
  const binPath = resolveOpsBinaryOrExit();
  const args = ["recent-authoring-runs"];
  if (limit != null) args.push(String(limit));
  const runs = runOps(binPath, args);
  if (!Array.isArray(runs) || runs.length === 0) {
    console.log("(no authoring runs found)");
    return;
  }
  for (const run of runs) {
    const epic = run.epicId ?? "-";
    console.log(`${run.runId}  epic=${epic}  status=${run.status}  started=${run.startedAt}`);
  }
}

function askLine(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function waitForEnter(prompt) {
  await askLine(prompt);
}

async function askNumber(question) {
  const answer = await askLine(question);
  return Number(answer.trim());
}

function parseComparisonArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--in-app-run") args.inAppRun = argv[++i];
    else if (argv[i] === "--terminal-project") args.terminalProject = argv[++i];
    else if (argv[i] === "--in-app-minutes") args.inAppMinutes = Number(argv[++i]);
  }
  return args;
}

async function runComparison(argv) {
  const args = parseComparisonArgs(argv);
  if (!args.inAppRun) {
    console.error("usage: --in-app-run <runId> [--terminal-project <projectId>] [--in-app-minutes <n>]");
    process.exit(1);
  }

  const binPath = resolveOpsBinaryOrExit();
  step(`Resolved uat_authoring_ops at ${binPath}`);

  const measurement = runOps(binPath, ["measure-run", args.inAppRun]);

  const inAppMinutesSource = args.inAppMinutes != null ? "operator-supplied" : "board-derived";
  const inAppMinutes = args.inAppMinutes != null ? args.inAppMinutes : measurement.elapsedMinutes;

  let before;
  if (args.terminalProject) {
    before = runOps(binPath, ["measure-board-counts", args.terminalProject]);
  }

  console.log("");
  console.log(formatTerminalArmBrief(SHAPING_PREMISE));
  console.log("");
  const start = process.hrtime.bigint();
  await waitForEnter("Press Enter the moment the LAST criterion has been entered... ");
  const elapsedNs = process.hrtime.bigint() - start;
  const terminalMinutes = Number(elapsedNs) / 1e9 / 60;

  let terminalTasks;
  let terminalCriteria;
  let countsSource;
  if (args.terminalProject) {
    const after = runOps(binPath, ["measure-board-counts", args.terminalProject]);
    terminalTasks = after.tasks - before.tasks;
    terminalCriteria = after.criteria - before.criteria;
    countsSource = "board-derived";
  } else {
    terminalTasks = await askNumber("Terminal arm — how many tasks were entered? ");
    terminalCriteria = await askNumber("Terminal arm — how many criteria were entered? ");
    countsSource = "operator-supplied";
  }

  const reworded = await askNumber(
    "Terminal arm — how many criteria were reworded before you considered them final? ",
  );

  const verdictResult = computeKillCriterionVerdict(
    {
      minutes: inAppMinutes,
      acceptedTaskProposals: measurement.acceptedTaskProposals,
      acceptedCriterionProposals: measurement.acceptedCriterionProposals,
      amendedBeforeAccept: measurement.amendedBeforeAccept,
    },
    { minutes: terminalMinutes },
  );

  const record = {
    timestamp: new Date().toISOString(),
    runId: args.inAppRun,
    inApp: {
      minutes: inAppMinutes,
      minutesSource: inAppMinutesSource,
      acceptedTaskProposals: measurement.acceptedTaskProposals,
      acceptedCriterionProposals: measurement.acceptedCriterionProposals,
      amendedBeforeAccept: measurement.amendedBeforeAccept,
    },
    terminal: {
      minutes: terminalMinutes,
      minutesSource: "instrument-measured",
      tasks: terminalTasks,
      tasksSource: countsSource,
      criteria: terminalCriteria,
      criteriaSource: countsSource,
      reworded,
      rewordedSource: "operator-supplied",
    },
    verdictResult,
  };

  const sheet = renderKillCriterionSheet(record);
  const sheetPath = resolveEvidencePath();
  fs.writeFileSync(sheetPath, sheet);
  step(`Wrote ${sheetPath}`);
  console.log("");
  console.log(sheet);
}

// ---------------------------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------------------------

const argv = process.argv.slice(2);

if (argv.includes("--self-test")) {
  await selfTest();
} else if (argv.includes("--list-runs")) {
  const idx = argv.indexOf("--list-runs");
  const next = argv[idx + 1];
  const limit = next && !next.startsWith("--") ? Number(next) : undefined;
  await listRuns(limit);
  process.exit(0);
} else if (argv.includes("--in-app-run")) {
  await runComparison(argv);
  process.exit(0);
} else {
  console.log(
    "usage: uat-09-product-kill-criterion.mjs --self-test | --list-runs [n] | " +
      "--in-app-run <runId> [--terminal-project <projectId>] [--in-app-minutes <n>]",
  );
  console.log(
    "⏭️  SKIP — Product Kill Criterion: no mode given, and this instrument needs an operator " +
      "at the terminal for the live comparison, so it never runs unattended.",
  );
  process.exit(3);
}
