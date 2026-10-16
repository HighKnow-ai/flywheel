#!/usr/bin/env node
/**
 * UAT 14 - phase 15 plan 02 (DRFT-01, D-21): does the planner declare a file-set, or say `undeclared`?
 *
 * PLAN-01 has been unmet since Phase 9 for one reason: the code path was proven against a fake backend
 * and never run live. This script is the re-runnable harness that scores ROADMAP.md's Phase 15
 * success criterion 1 so a live run, when a human decides to spend one (plan 15-04), is provable.
 *
 * Three modes (the shape `uat-10-agent-backlog.mjs` established):
 *
 *   --self-test   Pure and offline: no child process, no `claude` binary, no database. Asserts this
 *                 script's OWN report formatting - above all that a clause the running mode cannot
 *                 reach prints `not-measured` and that no code path prints `observed` for a clause
 *                 whose measurement function was never called (T-15-10) - and that the scratch root is
 *                 removed on the failure path. This is what an autonomous executor and CI run.
 *
 *   --offline     Zero tokens. Stands up a real scratch database and repository through
 *                 `uat_fanout_ops` (plan-setup / plan-start / plan-submit / plan-readback), which call
 *                 the REAL `begin_planning_run`, `resolve_planning_run`, `store_submitted_plan` and
 *                 `preview_edges_with`. This script owns no SQL and no storage logic. It renders the real
 *                 planning prompt, then submits a constructed plan covering a declared set, a
 *                 directory-prefix set that collides with a sibling, and an `undeclared` task, and
 *                 asserts the stored plan, the edge and the events. Criterion 1's live-only clause - a
 *                 real model's own decision - is `not-measured` here, always.
 *
 *   --live        The same walk, except the submission comes from a real `claude` planning-run session
 *                 briefed by the real prompt, with `submit_plan` the only thing pre-approved. Writes its
 *                 evidence to the path given by `--artifact <file>`. COSTS REAL TOKENS: never run by an
 *                 autonomous executor. Plan 15-04 owns running it and registering its MANUAL line in
 *                 `run-all.sh`; this plan deliberately does not touch that file.
 *
 * The three clauses scored, from ROADMAP.md Phase 15 success criterion 1:
 *   (a) the planner declares each task's expected file-set, observed against a live backend;
 *   (b) declared paths are attributable to the event actor, derived rather than stored;
 *   (c) the hand-typed path field survives, unprefilled.
 * (b) and (c) are surface properties owned by plan 15-05 and are `not-measured` in every mode of THIS
 * script, with that reason stated. Only `--live` can observe (a).
 *
 * SCRATCH ONLY. One `mkdtemp` root holds the app-data directory, the worktree root, the runtime
 * directory and the repository, and is removed on exit, failure included (`withScratchRoot`).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  claudeVersionString,
  Harness,
  probeClaudeAvailable,
  REPO_ROOT,
  resolveHarnessBinary,
  SIDECAR_ENTRY,
  step,
} from "./lib/sidecar-harness.mjs";

// -------------------------------------------------------------------------------------------
// Report formatting - the part --self-test proves.
// -------------------------------------------------------------------------------------------

const CLAUSES = Object.freeze([
  {
    id: "a",
    text:
      "User starts planning and the planner declares each task's expected file-set, observed " +
      "working against a live backend and recorded as an artifact.",
  },
  {
    id: "b",
    text: 'The declared paths show as chips marked "drafted by the planner", derived from the event actor rather than stored.',
  },
  {
    id: "c",
    text: "The hand-typed path field is still there as the same form with no prefill - an escape hatch, not the path of record.",
  },
]);

/** What this script's offline arm actually exercises. Each is a mechanism check, not a ROADMAP clause. */
const CHECKS = Object.freeze([
  { id: "prompt", text: "the planning prompt carries every `git ls-files` path of the repository and the `undeclared` instruction" },
  { id: "refusals", text: "the real writer refuses `undeclared` with files, and refuses an empty list without the flag" },
  { id: "stored", text: "the stored plan holds every task, `planned`, with the undeclared task declaring nothing" },
  { id: "order", text: "a task's declared entries read back in submission order" },
  { id: "edge", text: "a file and a directory prefix containing it make one edge carrying the colliding path; the undeclared task makes none" },
  { id: "event", text: "each task's `task.file_set_declared` event is agent-authored; the undeclared one carries a null `after`" },
]);

const STATUSES = Object.freeze(["observed", "failed", "not-measured"]);

/**
 * The only producer of `observed`. A result reads `observed` solely because `measure()` called the
 * measurement function and it returned; `renderReport` refuses any `observed` row without that stamp.
 */
class Ledger {
  #results = new Map();

  /** Run `fn` (may be async). Returned string is the detail. A throw is a `failed` row, never swallowed. */
  async measure(id, fn) {
    try {
      const detail = await fn();
      this.#results.set(id, { status: "observed", detail: detail ?? "", measured: true });
    } catch (err) {
      this.#results.set(id, { status: "failed", detail: String(err?.message ?? err), measured: true });
    }
  }

  notMeasured(id, reason) {
    this.#results.set(id, { status: "not-measured", detail: reason, measured: false });
  }

  /** Every id in `ids` this ledger has no row for becomes `not-measured` with `reason`. */
  fill(ids, reason) {
    for (const id of ids) if (!this.#results.has(id)) this.notMeasured(id, reason);
  }

  get(id) {
    return this.#results.get(id);
  }

  anyFailed() {
    return [...this.#results.values()].some((r) => r.status === "failed");
  }
}

/** Format both groups. Throws on a missing row, an unknown status, or `observed` with no measurement stamp. */
function renderReport(clauses, checks) {
  const lines = ['Per-clause report (ROADMAP.md Phase 15 success criterion 1 - "Nothing Typed That An Agent Could Draft"):'];
  const emit = (rows, ledger, label) => {
    for (const row of rows) {
      const result = ledger.get(row.id);
      if (result === undefined) throw new Error(`report is missing ${label} ${row.id} - every row must be classified`);
      if (!STATUSES.includes(result.status)) {
        throw new Error(`${label} ${row.id} carries an unrecognised status ${JSON.stringify(result.status)}`);
      }
      if (result.status === "observed" && result.measured !== true) {
        throw new Error(`${label} ${row.id} claims "observed" but its measurement function was never called`);
      }
      lines.push(`  [${result.status}] ${label} ${row.id}: ${row.text}`);
      if (result.detail) lines.push(`      ${result.detail}`);
    }
  };
  emit(CLAUSES, clauses, "Clause");
  lines.push("Mechanism checks this mode exercised:");
  emit(CHECKS, checks, "Check");
  return lines.join("\n");
}

const SURFACE_REASON =
  "A surface property owned by plan 15-05 (the chip editor and the retained textarea); this script never renders a surface.";

/** Clauses (b) and (c) in every mode: never measured here. */
function surfaceClauses(ledger) {
  ledger.notMeasured("b", `${SURFACE_REASON} The event-actor source it reads from is asserted by Check event.`);
  ledger.notMeasured("c", SURFACE_REASON);
}

// -------------------------------------------------------------------------------------------
// Scratch discipline - removed on exit, failure included.
// -------------------------------------------------------------------------------------------

/**
 * Run `body(harness)` inside one scratch root and ALWAYS remove it afterwards, including when the body
 * throws. (`runScript` in the shared library deliberately KEEPS the root on failure; this script's
 * evidence is the artifact and the printed report, so it follows uat-13's discipline instead.)
 */
async function withScratchRoot(label, body) {
  const harness = new Harness(label);
  try {
    return await body(harness);
  } finally {
    harness.cleanup({ preserveRoot: false });
  }
}

// -------------------------------------------------------------------------------------------
// The uat_fanout_ops bridge and a scratch repository.
// -------------------------------------------------------------------------------------------

function requireBinary() {
  const bin = resolveHarnessBinary("uat_fanout_ops");
  if (bin === undefined) {
    throw new Error("uat_fanout_ops is not built - run `cargo build -p core --bin uat_fanout_ops`");
  }
  return bin;
}

/** Point every path the core writes at the scratch root, then return a `runOps(...args)` bridge. */
function scratchBridge(harness) {
  const worktreeRoot = path.join(harness.root, "worktrees");
  const runtimeDir = path.join(harness.root, "runtime");
  fs.mkdirSync(worktreeRoot, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (const dir of [harness.appDataDir, worktreeRoot, runtimeDir]) {
    assert.ok(
      path.resolve(dir).startsWith(path.resolve(harness.root) + path.sep),
      `${dir} must live inside the scratch root`,
    );
  }
  // Process-level so `harness.sessionEnv` and `startSidecar` (which spread process.env) agree with the ops binary.
  process.env.FLYWHEEL_APP_DATA_DIR = harness.appDataDir;
  process.env.FLYWHEEL_WORKTREE_ROOT = worktreeRoot;
  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  const bin = requireBinary();
  return (...args) => {
    const r = spawnSync(bin, args, { encoding: "utf8", env: process.env });
    if (r.status !== 0) throw new Error(`uat_fanout_ops ${args[0]} failed (${r.status}): ${(r.stderr ?? "").trim()}`);
    return JSON.parse(r.stdout.trim().split("\n").filter(Boolean).at(-1));
  };
}

const SCRATCH_FILES = Object.freeze({
  "README.md": "# planner scratch repo\n",
  "Cargo.toml": '[package]\nname = "scratch"\nversion = "0.1.0"\n',
  "src/lib.rs": "pub mod parser;\npub mod render;\n",
  "src/parser.rs": "pub fn parse(input: &str) -> Vec<&str> { input.split(',').collect() }\n",
  "src/render.rs": "pub fn render(items: &[&str]) -> String { items.join(\", \") }\n",
  "docs/guide.md": "# Guide\n",
});

function createScratchRepo(root) {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
    return r.stdout;
  };
  git("init", "--initial-branch=main");
  git("config", "user.email", "uat@flywheel.invalid");
  git("config", "user.name", "Flywheel UAT");
  for (const [file, body] of Object.entries(SCRATCH_FILES)) {
    fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
    fs.writeFileSync(path.join(repo, file), body);
  }
  git("add", ".");
  git("commit", "-m", "initial commit");
  return { repo, tracked: git("ls-files").split("\n").filter(Boolean) };
}

const TASK_SPECS = Object.freeze([
  { title: "Parser: accept a trailing comma in src/parser.rs" },
  { title: "Renderer: join items with a separator in src/render.rs" },
  { title: "Docs: write the user guide" },
]);

/** The section of the prompt between the listing heading and the next heading - the lines the model sees. */
function promptListing(prompt) {
  const start = prompt.indexOf("## Files In This Repository");
  assert.ok(start >= 0, "the prompt has no `## Files In This Repository` section");
  const rest = prompt.slice(start + "## Files In This Repository".length);
  const end = rest.indexOf("\n## ");
  return (end < 0 ? rest : rest.slice(0, end)).split("\n").map((l) => l.trim()).filter(Boolean);
}

function setupEpic(runOps, harness) {
  step("creating a scratch repository with a real tracked tree");
  const { repo, tracked } = createScratchRepo(harness.root);
  step("registering it and creating one epic with three tasks (through the real domain functions)");
  const setup = runOps("plan-setup", repo, JSON.stringify(TASK_SPECS));
  return { repo, tracked, ...setup };
}

function checkPrompt(prompt, tracked) {
  const listed = promptListing(prompt);
  for (const file of tracked) assert.ok(listed.includes(file), `tracked path ${file} is missing from the prompt's listing`);
  assert.equal(listed.length, tracked.length, "the prompt lists paths git does not track");
  assert.ok(/`undeclared`|\bundeclared\b/.test(prompt), "the prompt never offers `undeclared` as an answer");
  return `${tracked.length} tracked paths listed, none extra; the \`undeclared\` instruction is present`;
}

// -------------------------------------------------------------------------------------------
// --self-test
// -------------------------------------------------------------------------------------------

async function selfTestBody() {
  step("a ledger with nothing measured renders every row not-measured, never observed");
  const none = { clauses: new Ledger(), checks: new Ledger() };
  none.clauses.fill(CLAUSES.map((c) => c.id), "self-test: nothing was run");
  none.checks.fill(CHECKS.map((c) => c.id), "self-test: nothing was run");
  const rendered = renderReport(none.clauses, none.checks);
  assert.ok(!/\[observed\]/.test(rendered), rendered);
  assert.ok(/\[not-measured\]/.test(rendered), rendered);
  for (const c of CLAUSES) assert.ok(rendered.includes(`Clause ${c.id}:`), `clause ${c.id} missing`);
  for (const c of CHECKS) assert.ok(rendered.includes(`Check ${c.id}:`), `check ${c.id} missing`);

  step("a row that was never classified makes the report throw rather than print a gap");
  assert.throws(() => renderReport(new Ledger(), none.checks), /missing Clause a/);

  step("a measurement function that is never called can never produce `observed`");
  const unrun = new Ledger();
  let called = false;
  const neverInvoked = () => {
    called = true;
    return "should not exist";
  };
  void neverInvoked; // deliberately not passed to measure()
  unrun.fill(CLAUSES.map((c) => c.id), "no measurement function ran");
  assert.equal(called, false);
  assert.equal(unrun.get("a").status, "not-measured");
  assert.equal(unrun.get("a").measured, false);

  step("`observed` without a measurement stamp is refused by the formatter");
  const forged = new Ledger();
  forged.notMeasured("a", "x");
  forged.get("a").status = "observed"; // the row is shared by reference: simulates a hand-written verdict
  forged.fill(["b", "c"], "x");
  assert.throws(() => renderReport(forged, none.checks), /claims "observed" but its measurement function was never called/);

  step("measure() stamps observed only after the function returned, and records a throw as failed");
  const live = new Ledger();
  await live.measure("a", () => "ran");
  await live.measure("b", () => {
    throw new Error("boom");
  });
  assert.deepEqual([live.get("a").status, live.get("a").measured], ["observed", true]);
  assert.deepEqual([live.get("b").status, live.get("b").detail], ["failed", "boom"]);
  assert.equal(live.anyFailed(), true);

  step("an unrecognised status is refused");
  const odd = new Ledger();
  odd.notMeasured("a", "x");
  odd.get("a").status = "yes-definitely";
  odd.fill(["b", "c"], "x");
  assert.throws(() => renderReport(odd, none.checks), /unrecognised status/);

  step("clauses b and c are never measured by this script, in any mode");
  const surf = new Ledger();
  surfaceClauses(surf);
  assert.equal(surf.get("b").status, "not-measured");
  assert.equal(surf.get("c").status, "not-measured");
  assert.match(surf.get("c").detail, /plan 15-05/);

  step("the scratch root is removed when the body succeeds and when it throws");
  let okRoot;
  await withScratchRoot("uat-14-selftest-ok", (h) => {
    okRoot = h.root;
    assert.ok(fs.existsSync(h.root));
  });
  assert.equal(fs.existsSync(okRoot), false, "scratch root survived a successful run");
  let failedRoot;
  await assert.rejects(
    withScratchRoot("uat-14-selftest-fail", (h) => {
      failedRoot = h.root;
      fs.writeFileSync(path.join(h.root, "evidence.txt"), "x");
      throw new Error("body failed");
    }),
    /body failed/,
  );
  assert.equal(fs.existsSync(failedRoot), false, "scratch root survived a FAILED run");

  step("the prompt-listing parser reads exactly the lines between the listing heading and the next heading");
  const sample = "## Epic\n\nE\n\n## Files In This Repository\n\na.rs\nb/c.rs\n\n## Your Task\n\nx\n";
  assert.deepEqual(promptListing(sample), ["a.rs", "b/c.rs"]);
  assert.throws(() => promptListing("## Epic\n"), /no `## Files In This Repository`/);

  const finalClauses = new Ledger();
  finalClauses.fill(CLAUSES.map((c) => c.id), "--self-test runs no planner and no database");
  const finalChecks = new Ledger();
  finalChecks.fill(CHECKS.map((c) => c.id), "--self-test runs no planner and no database");
  process.stdout.write(`\n${renderReport(finalClauses, finalChecks)}\n`);
}

// -------------------------------------------------------------------------------------------
// --offline
// -------------------------------------------------------------------------------------------

async function offlineBody(harness) {
  const runOps = scratchBridge(harness);
  const { tracked, epicId, tasks } = setupEpic(runOps, harness);
  const [k0, k1, k2] = tasks.map((t) => t.key);
  const clauses = new Ledger();
  const checks = new Ledger();

  step("starting the planning run through the production begin_planning_run (real prompt, real worktree)");
  const start = runOps("plan-start", epicId);
  await checks.measure("prompt", () => checkPrompt(start.prompt, tracked));

  await checks.measure("refusals", () => {
    const both = runOps(
      "plan-submit",
      start.runId,
      JSON.stringify({ tasks: [{ key: k0, files: ["src/parser.rs"], wave: 1, undeclared: true }] }),
    );
    assert.match(both.refused ?? "", /undeclared/, `undeclared + files must be refused, got ${JSON.stringify(both)}`);
    const empty = runOps(
      "plan-submit",
      start.runId,
      JSON.stringify({ tasks: [{ key: k0, files: [], wave: 1 }] }),
    );
    assert.ok((empty.refused ?? "").includes(k0), `an empty list without the flag must be refused naming ${k0}: ${JSON.stringify(empty)}`);
    return "Malformed for undeclared+files, EmptyFileList for empty-without-flag; nothing stored by either";
  });

  step("submitting a constructed plan: a declared set, a colliding directory prefix, and an undeclared task");
  const submitted = runOps(
    "plan-submit",
    start.runId,
    JSON.stringify({
      tasks: [
        { key: k0, files: ["docs/", "src/parser.rs"], wave: 1, rationale: "parser, and the guide it documents" },
        { key: k1, files: ["src/"], wave: 1, rationale: "owns the src directory" },
        { key: k2, files: [], wave: 1, rationale: "cannot tell from the title", undeclared: true },
      ],
      excluded: [],
    }),
  );
  assert.ok(submitted.planId, `the valid submission was refused: ${JSON.stringify(submitted)}`);
  const stored = runOps("plan-readback", submitted.planId);
  const byKey = Object.fromEntries(stored.tasks.map((t) => [t.key, t]));

  await checks.measure("stored", () => {
    assert.equal(stored.tasks.length, 3, "all three tasks are in the plan");
    for (const t of stored.tasks) assert.equal(t.state, "planned", `${t.key} is ${t.state}, not planned`);
    assert.deepEqual(byKey[k2].files, [], "the undeclared task declares nothing");
    return "3 tasks stored, every one `planned` (none `skipped`); the undeclared task holds no entries";
  });
  await checks.measure("order", () => {
    assert.deepEqual(byKey[k0].files, ["docs/", "src/parser.rs"]);
    return `${k0} read back as ${JSON.stringify(byKey[k0].files)}`;
  });
  await checks.measure("edge", () => {
    assert.equal(stored.edges.length, 1, `expected exactly one edge, got ${JSON.stringify(stored.edges)}`);
    assert.deepEqual(stored.edges[0].collidingPaths, [["src/parser.rs", "src/"]]);
    assert.ok(stored.edges.every((e) => e.before !== k2 && e.after !== k2), "the undeclared task is in an edge");
    return `one edge ${stored.edges[0].before} -> ${stored.edges[0].after} on ${JSON.stringify(stored.edges[0].collidingPaths[0])}`;
  });
  await checks.measure("event", () => {
    for (const k of [k0, k1]) {
      assert.equal(byKey[k].events.length, 1, `${k}: one declared event`);
      assert.notEqual(byKey[k].events[0].after, null, `${k}: a declaration carries its entries`);
      assert.equal(byKey[k].events[0].actorType, "agent", `${k}: the event actor is the agent`);
    }
    assert.equal(byKey[k2].events.length, 1, "the undeclared task: one declared event");
    assert.equal(byKey[k2].events[0].after, null, "the undeclared event's `after` is null");
    assert.equal(byKey[k2].events[0].actorType, "agent");
    return "declarations and the undeclared marker are all agent-authored events; provenance is derived, not stored";
  });

  clauses.notMeasured(
    "a",
    "LIVE ONLY. This mode submits a constructed plan; it never observes a real model's own decision to declare " +
      "a set or to answer `undeclared`. The mechanism it would be measured through is exercised by the checks below.",
  );
  surfaceClauses(clauses);
  checks.fill(CHECKS.map((c) => c.id), "not run");

  process.stdout.write(`\n${renderReport(clauses, checks)}\n`);
  if (checks.anyFailed()) throw new Error("one or more offline mechanism checks failed");
}

// -------------------------------------------------------------------------------------------
// --live
// -------------------------------------------------------------------------------------------

async function liveBody(harness, artifactPath) {
  if (!probeClaudeAvailable()) {
    throw new Error("the real `claude` binary is not resolvable - this mode needs a live backend session");
  }
  if (resolveHarnessBinary("uat_session_env") === undefined) {
    throw new Error("uat_session_env is not built - run `cargo build -p core --bin uat_session_env`");
  }
  if (!fs.existsSync(SIDECAR_ENTRY)) {
    throw new Error(`${SIDECAR_ENTRY} not found - run \`npm --prefix packages/sidecar run build\``);
  }
  const runOps = scratchBridge(harness);
  const { tracked, epicId, tasks } = setupEpic(runOps, harness);
  const clauses = new Ledger();
  const checks = new Ledger();

  step("starting the planning run through the production begin_planning_run");
  const start = runOps("plan-start", epicId);
  await checks.measure("prompt", () => checkPrompt(start.prompt, tracked));

  const env = { ...harness.sessionEnv(start.runId, "main"), ...harness.cleanClaudeConfigEnv() };
  step(`isolation: CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`);

  const sidecar = await harness.startSidecar();
  const evidence = { permissionRequests: [], submissionEvent: undefined, outcome: undefined };
  let draining = true;
  harness.onCleanup(() => {
    draining = false;
  });

  step("spawning a real claude planning-run session (submit_plan is the only pre-approved tool)");
  await sidecar.request({
    op: "spawn",
    runId: start.runId,
    worktreePath: start.worktreePath,
    prompt: start.prompt,
    permissionMode: "default",
    planning: true,
    env,
  });

  // Anything the session asks permission for beyond the pre-approved tool is DENIED and recorded:
  // the measurement is whether the planner can read the repository and call submit_plan, nothing else.
  const permissionLoop = (async () => {
    while (draining) {
      let event;
      try {
        event = await sidecar.waitForEvent((e) => e.type === "permission_request" && e.runId === start.runId && !e.__seen, 5_000, "permission");
      } catch {
        continue;
      }
      event.__seen = true;
      evidence.permissionRequests.push({ tool: event.toolName ?? event.tool, input: event.input ?? event.command });
      await sidecar.request({ op: "permission_answer", runId: start.runId, requestId: event.requestId, decision: "deny" }).catch(() => {});
    }
  })();
  void permissionLoop;

  step("waiting for the real session's own submit_plan call");
  const submitted = await sidecar.waitForEvent(
    (e) => e.type === "plan_submitted" && e.runId === start.runId,
    300_000,
    "a plan_submitted event from the live planning session",
  );
  evidence.submissionEvent = { tasks: submitted.tasks, excluded: submitted.excluded };
  const outcome = runOps("plan-submit", start.runId, JSON.stringify({ tasks: submitted.tasks, excluded: submitted.excluded }));
  evidence.outcome = outcome;
  await sidecar
    .request({
      op: "authoring_proposal_answer",
      runId: start.runId,
      requestId: submitted.requestId,
      ...(outcome.planId ? { result: { planId: outcome.planId } } : { error: outcome.refused }),
    })
    .catch(() => {});
  draining = false;
  await sidecar.request({ op: "interrupt", runId: start.runId }).catch(() => {});

  let readback;
  await clauses.measure("a", () => {
    assert.ok(outcome.planId, `the live submission was refused by the real writer: ${outcome.refused}`);
    readback = runOps("plan-readback", outcome.planId);
    const declared = readback.tasks.filter((t) => t.files.length > 0);
    const undeclared = readback.tasks.filter((t) => t.files.length === 0);
    const paths = declared.flatMap((t) => t.files);
    const inListing = (p) => tracked.some((f) => (p.endsWith("/") ? f.startsWith(p) : f === p));
    const unknown = paths.filter((p) => !inListing(p));
    return (
      `a real session stored a plan of ${readback.tasks.length} tasks: ${declared.length} declared (${paths.length} paths, ` +
      `${paths.length - unknown.length} present in git ls-files, ${unknown.length} absent: ${JSON.stringify(unknown)}), ` +
      `${undeclared.length} answered undeclared.`
    );
  });
  if (readback) {
    await checks.measure("stored", () => {
      for (const t of readback.tasks) assert.equal(t.state, "planned", `${t.key} is ${t.state}`);
      assert.equal(readback.tasks.length, tasks.length, "every task of the epic is in the plan");
      return "every task of the epic stored `planned`";
    });
    await checks.measure("event", () => {
      for (const t of readback.tasks) {
        assert.equal(t.events.length, 1, `${t.key}: one declared event`);
        assert.equal(t.events[0].actorType, "agent");
        assert.equal(t.events[0].after === null, t.files.length === 0, `${t.key}: a null \`after\` iff nothing was declared`);
      }
      return "each task's declared event is agent-authored, null-after exactly when the task declared nothing";
    });
  }
  surfaceClauses(clauses);
  clauses.fill(CLAUSES.map((c) => c.id), "not run");
  checks.fill(CHECKS.map((c) => c.id), "not run in --live: the constructed-plan walk belongs to --offline");

  const report = renderReport(clauses, checks);
  const artifact = {
    capturedAt: new Date().toISOString(),
    claudeVersion: claudeVersionString(),
    repoRoot: REPO_ROOT,
    prompt: start.prompt,
    trackedFiles: tracked,
    ...evidence,
    readback,
    report,
  };
  fs.mkdirSync(path.dirname(path.resolve(artifactPath)), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  step(`wrote the evidence artifact: ${artifactPath}`);
  process.stdout.write(`\n${report}\n`);
  if (clauses.anyFailed() || checks.anyFailed()) throw new Error("the live measurement failed - see the report above");
}

// -------------------------------------------------------------------------------------------
// Dispatch
// -------------------------------------------------------------------------------------------

const USAGE =
  "usage: uat-14-planner-file-set.mjs --self-test | --offline | --live --artifact <file>\n" +
  "  --self-test  pure, offline, no child process - report formatting and scratch cleanup\n" +
  "  --offline    zero tokens - the real prompt and the real writer, with a constructed submission\n" +
  "  --live       a real claude planning run (COSTS REAL TOKENS); evidence is written to --artifact <file>\n";

async function run(title, body) {
  process.stdout.write(`\n=== ${title} ===\n`);
  try {
    await body();
    process.stdout.write(`\nPASS - ${title}\n`);
    process.exitCode = 0;
  } catch (err) {
    process.stdout.write(`\nFAIL - ${title}\n\n${err?.stack ?? String(err)}\n`);
    process.exitCode = 1;
  }
}

const argv = process.argv.slice(2);
if (argv.includes("--self-test")) {
  await run("UAT 14 - planner file-set (self-test: report formatting, no child process)", selfTestBody);
} else if (argv.includes("--offline")) {
  await run("UAT 14 - planner file-set (offline, zero tokens)", () =>
    withScratchRoot("uat-14-offline", offlineBody),
  );
} else if (argv.includes("--live")) {
  const at = argv.indexOf("--artifact");
  const artifactPath = at >= 0 ? argv[at + 1] : undefined;
  if (artifactPath === undefined || artifactPath.startsWith("--")) {
    process.stderr.write(`--live needs --artifact <file> (checked before any token is spent)\n${USAGE}`);
    process.exit(2);
  }
  await run("UAT 14 - planner file-set (LIVE, costs real tokens)", () =>
    withScratchRoot("uat-14-live", (h) => liveBody(h, artifactPath)),
  );
} else {
  process.stderr.write(USAGE);
  process.exit(2);
}
