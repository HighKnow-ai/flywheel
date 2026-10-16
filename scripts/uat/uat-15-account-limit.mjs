#!/usr/bin/env node
/**
 * UAT 15 - phase 15 plan 03 (DRFT-12, D-31..D-34): does a real backend limit land in a run's own state?
 *
 * `limit_gate.rs` has carried the sentence "no hard limit has ever been observed" in its own header since
 * Phase 9. This is the re-runnable harness that scores ROADMAP.md's Phase 15 success criterion 6 (its limit
 * half), so that the deliberate burn plan 15-04 runs is provable and a constructed fixture can never be
 * mistaken for it.
 *
 * Three modes (the shape `uat-10-agent-backlog.mjs` and `uat-14-planner-file-set.mjs` established):
 *
 *   --self-test   Pure and offline: no child process, no `claude` binary, no database. Asserts this
 *                 script's OWN honesty rule - `observed` exists only for a tier a real backend process
 *                 delivered (`LiveObservation`), a warning-tier observation never closes criterion 6 - and
 *                 the wire-line-to-event translation against the committed real capture.
 *
 *   --offline     Zero tokens. Replays the committed real `rate_limit_event` capture through the production
 *                 seam: `normaliseStreamEvent` (the adapter's own tier rule), then, through `uat_fanout_ops`,
 *                 `LimitSignal::from_event` and `apply_rate_limit_signal_for_run`. It then does the same
 *                 with a rejected line DERIVED from that capture and labels that result CONSTRUCTED. Until
 *                 plan 15-04 runs `--live`, the `Rejected` tier is a documented shape no backend has sent.
 *
 *   --live        Drives a real `claude` session on the developer's own credentials until the backend
 *                 reports a tier, captures the raw wire lines that carry it, and writes the artifact and the
 *                 fixture derived from them. COSTS A WINDOW OF SUBSCRIPTION CAPACITY: never run by an
 *                 autonomous executor and never by plan 15-03. Plan 15-04 runs it after its own decision
 *                 checkpoint and owns the redaction rule for what it commits.
 *
 * ROADMAP criterion 6, limit half, scored as four clauses:
 *   (a) a real rate or session limit is observed in a live run;
 *   (b) it is backed off from;
 *   (c) it is surfaced in the run's own state rather than retried blindly;
 *   (d) the measurement is recorded.
 * Only `--live` can observe (a) or record (d). Criterion 6 closes only when (a) was observed at the
 * `Rejected` tier (D-32: a warning does not close it) and (b), (c) and (d) hold.
 *
 * A clause an offline replay verified is `passed`, never `observed`: `observed` is reserved for what a real
 * backend process told this script, and the type system below makes any other route to it throw.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  claudeVersionString,
  Harness,
  probeClaudeAvailable,
  REPO_ROOT,
  resolveHarnessBinary,
  SidecarClient,
  SIDECAR_ENTRY,
  step,
} from "./lib/sidecar-harness.mjs";

// -------------------------------------------------------------------------------------------
// The committed real capture, and the adapter seam it is replayed through.
// -------------------------------------------------------------------------------------------

const CAPTURE_PATH = path.join(REPO_ROOT, "scripts", "uat", "fixtures", "live-opus5-unmodelled-shapes.json");
const ADAPTER_PATH = path.join(REPO_ROOT, "packages", "sidecar", "dist", "claude-code-adapter.js");

/** The one real limit notice this repository holds (an `allowed_warning`), exactly as committed. */
function loadRealCapture() {
  const shapes = JSON.parse(fs.readFileSync(CAPTURE_PATH, "utf8")).shapes;
  const shape = shapes.find((s) => s.expectedEventType === "rate_limit");
  assert.ok(shape, `${CAPTURE_PATH} holds no rate-limit shape`);
  return shape.line;
}

/** The adapter's own normaliser: the production tier rule, not a parallel one. */
async function loadSeam() {
  if (!fs.existsSync(ADAPTER_PATH)) {
    throw new Error(`${ADAPTER_PATH} not found - run \`npm --prefix packages/sidecar run build\``);
  }
  return import(pathToFileURL(ADAPTER_PATH).href);
}

/** The wire line's nested notice object, found by shape so this script never spells the wire key itself. */
function noticeKey(line) {
  const keys = Object.keys(line).filter((k) => line[k] !== null && typeof line[k] === "object");
  assert.equal(keys.length, 1, `expected exactly one nested notice object, got ${JSON.stringify(keys)}`);
  return keys[0];
}

/** The same wire line with its notice status replaced. The rest of the real capture is kept. */
function withStatus(line, status) {
  const key = noticeKey(line);
  return { ...line, [key]: { ...line[key], status } };
}

// -------------------------------------------------------------------------------------------
// The honesty rule - the part --self-test proves.
// -------------------------------------------------------------------------------------------

const CLAUSES = Object.freeze([
  { id: "a", text: "A real rate or session limit is observed in a live run." },
  { id: "b", text: "The limit is backed off from." },
  { id: "c", text: "The limit is surfaced in the run's own state rather than retried blindly." },
  { id: "d", text: "The measurement is recorded." },
]);

const STATUSES = Object.freeze(["observed", "passed", "failed", "not-measured"]);

const LIVE = Symbol("tier delivered by a real backend process");

/**
 * A tier a real backend process delivered. The constructor is unreachable without the module-private
 * symbol, and the only factory takes a `SidecarClient` and reads ITS event buffer - a fixture, a
 * constructed line or a plain object cannot become one (T-15-11).
 */
class LiveObservation {
  constructor(token, tier, detail) {
    if (token !== LIVE) throw new Error("LiveObservation can only be made from a live sidecar's events");
    this.tier = tier;
    this.detail = detail;
  }

  static fromSidecar(client, runId) {
    if (!(client instanceof SidecarClient)) throw new Error("not a live sidecar client");
    const seen = client.events
      .filter((e) => e.runId === runId && (e.type === "rate_limit" || e.rateLimitTier !== undefined))
      .map((e) => e.tier ?? e.rateLimitTier)
      .filter((t) => typeof t === "string");
    const tier = seen.includes("rejected") ? "rejected" : seen.includes("warning") ? "warning" : seen.at(-1);
    return tier === undefined ? undefined : new LiveObservation(LIVE, tier, `tiers received from the backend: ${JSON.stringify(seen)}`);
  }
}

class Ledger {
  #results = new Map();

  /** A mechanism verified by running it. Never `observed`. A throw is a `failed` row, never swallowed. */
  async verify(id, fn) {
    try {
      this.#results.set(id, { status: "passed", detail: (await fn()) ?? "" });
    } catch (err) {
      this.#results.set(id, { status: "failed", detail: String(err?.message ?? err) });
    }
  }

  /** The only producer of `observed`: refuses anything that is not a `LiveObservation`. */
  observed(id, observation, detail) {
    if (!(observation instanceof LiveObservation)) throw new Error(`clause ${id}: only a LiveObservation can be observed`);
    this.#results.set(id, { status: "observed", detail, tier: observation.tier, stamp: LIVE });
  }

  notMeasured(id, reason) {
    this.#results.set(id, { status: "not-measured", detail: reason });
  }

  fill(reason) {
    for (const { id } of CLAUSES) if (!this.#results.has(id)) this.notMeasured(id, reason);
  }

  get(id) {
    return this.#results.get(id);
  }

  anyFailed() {
    return [...this.#results.values()].some((r) => r.status === "failed");
  }
}

/** Criterion 6's verdict. Closed only by a `Rejected` observation plus (b), (c) and (d). */
function criterion6Verdict(ledger) {
  const a = ledger.get("a");
  const rest = ["b", "c", "d"].map((id) => ledger.get(id));
  if (a?.status !== "observed") return { closed: false, why: "(a) was not observed against a real backend" };
  if (a.tier !== "rejected") return { closed: false, why: `(a) observed the ${a.tier} tier; D-32: only Rejected closes this criterion` };
  const bad = rest.find((r) => !["passed", "observed"].includes(r?.status));
  if (bad) return { closed: false, why: "one of (b), (c), (d) did not hold" };
  return { closed: true, why: "a real Rejected tier was observed, backed off from, surfaced and recorded" };
}

/** Format the report. Throws on a missing row, an unknown status, or `observed` without the live stamp. */
function renderReport(ledger) {
  const lines = ['Per-clause report (ROADMAP.md Phase 15 success criterion 6 - the account limit):'];
  for (const clause of CLAUSES) {
    const r = ledger.get(clause.id);
    if (r === undefined) throw new Error(`report is missing clause ${clause.id} - every clause must be classified`);
    if (!STATUSES.includes(r.status)) throw new Error(`clause ${clause.id} carries an unrecognised status ${JSON.stringify(r.status)}`);
    if (r.status === "observed" && r.stamp !== LIVE) throw new Error(`clause ${clause.id} claims "observed" without a live backend stamp`);
    lines.push(`  [${r.status}] (${clause.id}) ${clause.text}`);
    if (r.detail) lines.push(`      ${r.detail}`);
  }
  const v = criterion6Verdict(ledger);
  lines.push(`Criterion 6 (limit half): ${v.closed ? "CLOSED" : "NOT CLOSED"} - ${v.why}`);
  return lines.join("\n");
}

const OFFLINE_REASON_A =
  "only a credential-spending run can reach this: an offline replay can never receive a limit from a real backend.";
const OFFLINE_REASON_D = "no artifact exists until plan 15-04 runs --live and commits the wire bytes it received.";

// -------------------------------------------------------------------------------------------
// Scratch discipline, the uat_fanout_ops bridge, a scratch repository.
// -------------------------------------------------------------------------------------------

async function withScratchRoot(label, body) {
  const harness = new Harness(label);
  try {
    return await body(harness);
  } finally {
    harness.cleanup({ preserveRoot: false });
  }
}

function scratchBridge(harness) {
  const worktreeRoot = path.join(harness.root, "worktrees");
  const runtimeDir = path.join(harness.root, "runtime");
  fs.mkdirSync(worktreeRoot, { recursive: true });
  fs.mkdirSync(runtimeDir, { recursive: true });
  for (const dir of [harness.appDataDir, worktreeRoot, runtimeDir]) {
    assert.ok(path.resolve(dir).startsWith(path.resolve(harness.root) + path.sep), `${dir} must live inside the scratch root`);
  }
  process.env.FLYWHEEL_APP_DATA_DIR = harness.appDataDir;
  process.env.FLYWHEEL_WORKTREE_ROOT = worktreeRoot;
  process.env.FLYWHEEL_RUNTIME_DIR = runtimeDir;
  const bin = resolveHarnessBinary("uat_fanout_ops");
  if (bin === undefined) throw new Error("uat_fanout_ops is not built - run `cargo build -p core --bin uat_fanout_ops`");
  return (...args) => {
    const r = spawnSync(bin, args, { encoding: "utf8", env: process.env });
    if (r.status !== 0) throw new Error(`uat_fanout_ops ${args[0]} failed (${r.status}): ${(r.stderr ?? "").trim()}`);
    return JSON.parse(r.stdout.trim().split("\n").filter(Boolean).at(-1));
  };
}

function createScratchRepo(root) {
  const repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  const git = (...args) => {
    const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  };
  git("init", "--initial-branch=main");
  git("config", "user.email", "uat@flywheel.invalid");
  git("config", "user.name", "Flywheel UAT");
  fs.writeFileSync(path.join(repo, "README.md"), "# account-limit scratch repo\n");
  git("add", ".");
  git("commit", "-m", "initial commit");
  return repo;
}

const sameStatuses = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// -------------------------------------------------------------------------------------------
// --self-test
// -------------------------------------------------------------------------------------------

async function selfTestBody() {
  const seam = await loadSeam();
  const real = loadRealCapture();

  step("the committed capture is a warning-tier notice and the adapter's own rule says so");
  const event = seam.normaliseStreamEvent(real, JSON.stringify(real), "RUN", 1, "2026-01-01T00:00:00Z");
  assert.equal(event.type, "rate_limit");
  assert.equal(event.tier, "warning", "the real capture must normalise to the warning tier");
  assert.equal(typeof event.resetsAt, "number");
  assert.equal(typeof event.rateLimitType, "string");

  step("a rejected line derived from the capture normalises to the rejected tier through the same rule");
  const derived = withStatus(real, "rejected");
  assert.equal(seam.normaliseStreamEvent(derived, JSON.stringify(derived), "RUN", 2, "2026-01-01T00:00:00Z").tier, "rejected");
  const unknown = withStatus(real, "something_new");
  assert.equal(
    seam.normaliseStreamEvent(unknown, JSON.stringify(unknown), "RUN", 3, "2026-01-01T00:00:00Z").tier,
    undefined,
    "an unrecognised status must yield no tier, not a guess",
  );

  step("`observed` is unreachable without a real backend's tier");
  const ledger = new Ledger();
  assert.throws(() => ledger.observed("a", { tier: "rejected" }, "forged"), /only a LiveObservation/);
  assert.throws(() => new LiveObservation(Symbol("forged"), "rejected", ""), /live sidecar/);
  assert.throws(() => LiveObservation.fromSidecar({ events: [{ type: "rate_limit", tier: "rejected" }] }, "RUN"), /not a live sidecar/);

  step("an offline-shaped ledger prints not-measured for the live-only clauses and never `observed`");
  const offline = new Ledger();
  offline.notMeasured("a", OFFLINE_REASON_A);
  await offline.verify("b", () => "ok");
  await offline.verify("c", () => "ok");
  offline.notMeasured("d", OFFLINE_REASON_D);
  const text = renderReport(offline);
  assert.match(text, /\[not-measured\] \(a\)/);
  assert.doesNotMatch(text, /\[observed\]/);
  assert.match(text, /NOT CLOSED/);

  step("the report refuses a row that claims `observed` without the live stamp, and a missing clause");
  const forged = new Ledger();
  forged.get = (id) => (id === "a" ? { status: "observed", detail: "forged", tier: "rejected" } : { status: "passed", detail: "" });
  assert.throws(() => renderReport(forged), /without a live backend stamp/);
  assert.throws(() => renderReport(new Ledger()), /missing clause a/);

  step("criterion 6 stays open for the real warning capture even when every other clause passes (D-32)");
  const warning = new Ledger();
  const warned = { status: "observed", detail: "warning", tier: event.tier, stamp: LIVE };
  warning.get = (id) => (id === "a" ? warned : { status: "passed", detail: "" });
  const warnVerdict = criterion6Verdict(warning);
  assert.equal(warnVerdict.closed, false);
  assert.match(warnVerdict.why, /only Rejected closes/);
  const rejected = new Ledger();
  rejected.get = (id) => (id === "a" ? { ...warned, tier: "rejected" } : { status: "passed", detail: "" });
  assert.equal(criterion6Verdict(rejected).closed, true, "the verdict is not simply hard-wired closed");

  const unreached = new Ledger();
  unreached.fill("self-test measures no clause");
  process.stdout.write(`\n${renderReport(unreached)}\n`);
}

// -------------------------------------------------------------------------------------------
// --offline
// -------------------------------------------------------------------------------------------

async function offlineBody(harness) {
  const seam = await loadSeam();
  const runOps = scratchBridge(harness);
  const real = loadRealCapture();

  step("a scratch repository, one project, one task and one real running agent run");
  const setup = runOps("gate-setup", createScratchRepo(harness.root));
  const apply = (line, now, seq) =>
    runOps("gate-apply", setup.runId, JSON.stringify(seam.normaliseStreamEvent(line, JSON.stringify(line), setup.runId, seq, new Date(now * 1000).toISOString())), String(now));

  const resetsAt = real[noticeKey(real)].resetsAt;
  const now = resetsAt - 3600;

  step("replaying the REAL captured warning through normaliseStreamEvent, LimitSignal::from_event and the gate");
  const warned = apply(real, now, 1);
  const constructedLine = withStatus(real, "rejected");
  step("replaying a rejected line DERIVED from that capture (constructed, not observed)");
  const rejected = apply(constructedLine, now, 2);
  const again = apply(constructedLine, now + 5, 3);
  const read = runOps("gate-read", String(now + 10));

  const ledger = new Ledger();
  ledger.notMeasured("a", OFFLINE_REASON_A);
  await ledger.verify("b", () => {
    assert.equal(warned.signal.tier, "warning");
    assert.equal(warned.maySpawn, true, "a warning lets the running wave spawn");
    assert.equal(warned.mayAdvance, false, "a warning stops the cursor advancing on its own");
    assert.equal(rejected.signal.tier, "rejected");
    assert.equal(rejected.maySpawn, false, "a rejection stops new dispatch");
    assert.equal(rejected.mayAdvance, false, "limit_gate.may_advance is open-only, so a pause stops the cursor too");
    assert.equal(rejected.after.resume_at, resetsAt, "the pause resumes at the wire's own reset instant");
    assert.equal(again.changed, false, "the same rejection again is not a new pause, so nothing retries blindly");
    return (
      `replayed real warning: spawn=${warned.maySpawn} advance=${warned.mayAdvance}. ` +
      `CONSTRUCTED rejected (not observed): spawn=${rejected.maySpawn} advance=${rejected.mayAdvance}, ` +
      `resumes at the wire's reset ${resetsAt}; a repeat of it changed nothing.`
    );
  });
  await ledger.verify("c", () => {
    assert.equal(warned.changed, true);
    assert.equal(warned.gateEvents, 1, "one dispatch.gate_changed event for the warning");
    assert.equal(rejected.gateEvents, 2, "one more for the pause, none for the repeat");
    assert.equal(again.gateEvents, 2);
    for (const r of [warned, rejected, again]) {
      assert.ok(sameStatuses(r.statusesBefore, r.statusesAfter), "the gate wrote an agent_runs status");
    }
    assert.ok(sameStatuses(setup.runStatus, rejected.statusesAfter), "the run is exactly as it started");
    assert.equal(read.gate.state, "paused", "the stored gate reads paused to the next dispatcher tick");
    assert.equal(read.message, rejected.message, "the user is shown the core's own sentence");
    return (
      `the gate is stored (paused, read back at the next tick) with ${rejected.gateEvents} dispatch.gate_changed events on the run's project stream; ` +
      `every agent_runs.status is unchanged (${rejected.statusesAfter.map((s) => s.status).join(", ")}). Message: ${rejected.message}`
    );
  });
  ledger.notMeasured("d", OFFLINE_REASON_D);

  process.stdout.write(`\n${renderReport(ledger)}\n`);
  process.stdout.write("The rejected result above is CONSTRUCTED from the committed warning capture, not observed.\n");
  if (ledger.anyFailed()) throw new Error("one or more offline clauses failed");
}

// -------------------------------------------------------------------------------------------
// --live  (written here, RUN by plan 15-04)
// -------------------------------------------------------------------------------------------

const BURN_PROMPT =
  "Write a file named notes-1.md containing a 1500 word essay on a topic of your choice. Then write notes-2.md " +
  "on a different topic, then notes-3.md, and keep going with a new file and a new topic each time. Never stop " +
  "and never ask a question: the only way this task ends is that it is interrupted.";

async function liveBody(harness, { artifactPath, fixturePath, maxMinutes }) {
  if (!probeClaudeAvailable()) throw new Error("the real `claude` binary is not resolvable - this mode needs a live backend session");
  if (!fs.existsSync(SIDECAR_ENTRY)) throw new Error(`${SIDECAR_ENTRY} not found - run \`npm --prefix packages/sidecar run build\``);
  const runOps = scratchBridge(harness);
  const setup = runOps("gate-setup", createScratchRepo(harness.root));

  const env = { ...harness.sessionEnv(setup.runId, "main"), ...harness.cleanClaudeConfigEnv() };
  step(`isolation: CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`);
  const sidecar = await harness.startSidecar();
  const startedAt = new Date().toISOString();

  step(`spawning a real claude session to burn the window (up to ${maxMinutes} minutes)`);
  await sidecar.request({
    op: "spawn",
    runId: setup.runId,
    worktreePath: setup.worktreePath,
    prompt: BURN_PROMPT,
    permissionMode: "bypassPermissions",
    env,
  });

  const carriesTier = (e) => e.runId === setup.runId && (e.type === "rate_limit" || e.rateLimitTier !== undefined);
  const deadline = Date.now() + maxMinutes * 60_000;
  while (Date.now() < deadline && !sidecar.events.some((e) => carriesTier(e) && (e.tier ?? e.rateLimitTier) === "rejected")) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  await sidecar.request({ op: "interrupt", runId: setup.runId }).catch(() => {});

  const limitEvents = sidecar.events.filter(carriesTier);
  const observation = LiveObservation.fromSidecar(sidecar, setup.runId);
  const ledger = new Ledger();
  const rejectedEvent = limitEvents.find((e) => (e.tier ?? e.rateLimitTier) === "rejected");
  let transition;
  if (observation) {
    ledger.observed("a", observation, observation.detail);
    const event = rejectedEvent ?? limitEvents.at(-1);
    transition = runOps("gate-apply", setup.runId, JSON.stringify(event), String(Math.floor(Date.now() / 1000)));
    await ledger.verify("b", () => {
      assert.equal(transition.maySpawn, rejectedEvent === undefined, "a rejection must stop new dispatch");
      return `new dispatch may spawn: ${transition.maySpawn}`;
    });
    await ledger.verify("c", () => {
      assert.ok(sameStatuses(transition.statusesBefore, transition.statusesAfter), "the gate wrote an agent_runs status");
      assert.ok(transition.gateEvents >= 1, "no dispatch.gate_changed event was appended");
      return `${transition.gateEvents} gate event(s); message: ${transition.message}`;
    });
  } else {
    ledger.notMeasured("a", `no limit tier reached the sidecar within ${maxMinutes} minutes`);
    ledger.fill("no limit was received, so there is nothing to back off from");
  }

  // The artifact holds ONLY the lines that carried a limit tier, never the transcript (T-15-15).
  const rawLines = limitEvents.map((e) => e.raw).filter((r) => typeof r === "string");
  const artifact = {
    capturedAt: new Date().toISOString(),
    startedAt,
    claudeVersion: claudeVersionString(),
    rawLines,
    observedTiers: limitEvents.map((e) => ({ at: e.at, tier: e.tier ?? e.rateLimitTier, window: e.rateLimitType, resetsAt: e.resetsAt })),
    gateTransition: transition,
  };
  fs.mkdirSync(path.dirname(path.resolve(artifactPath)), { recursive: true });
  fs.writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
  await ledger.verify("d", () => {
    assert.ok(rawLines.length > 0, "no raw wire line carried a limit tier");
    return `wrote ${artifactPath} (${rawLines.length} raw wire lines)`;
  });
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify({ derivedFrom: path.basename(artifactPath), capturedAt: artifact.capturedAt, lines: rawLines.map((l) => JSON.parse(l)) }, null, 2)}\n`,
  );
  step(`wrote the derived fixture: ${fixturePath}`);
  process.stdout.write(`\n${renderReport(ledger)}\n`);
  if (ledger.anyFailed()) throw new Error("the live measurement failed - see the report above");
}

// -------------------------------------------------------------------------------------------
// Dispatch
// -------------------------------------------------------------------------------------------

const USAGE =
  "usage: uat-15-account-limit.mjs --self-test | --offline | --live --artifact <file> --fixture <file> [--max-minutes <n>]\n" +
  "  --self-test  pure, offline, no child process - the honesty rule and the capture's translation\n" +
  "  --offline    zero tokens - replays the committed real capture through the production seam\n" +
  "  --live       a real claude session driven into the window limit (COSTS SUBSCRIPTION CAPACITY)\n";

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
const flag = (name) => {
  const at = argv.indexOf(name);
  const value = at >= 0 ? argv[at + 1] : undefined;
  return value === undefined || value.startsWith("--") ? undefined : value;
};

if (argv.includes("--self-test")) {
  await run("UAT 15 - account limit (self-test: honesty rule, no child process)", selfTestBody);
} else if (argv.includes("--offline")) {
  await run("UAT 15 - account limit (offline, zero tokens)", () => withScratchRoot("uat-15-offline", offlineBody));
} else if (argv.includes("--live")) {
  const [artifactPath, fixturePath] = [flag("--artifact"), flag("--fixture")];
  const maxMinutes = Number(flag("--max-minutes") ?? 90);
  if (!artifactPath || !fixturePath || !Number.isFinite(maxMinutes) || maxMinutes <= 0) {
    process.stderr.write(`--live needs --artifact <file> and --fixture <file> (checked before any capacity is spent)\n${USAGE}`);
    process.exit(2);
  }
  await run("UAT 15 - account limit (LIVE, spends subscription capacity)", () =>
    withScratchRoot("uat-15-live", (h) => liveBody(h, { artifactPath, fixturePath, maxMinutes })),
  );
} else {
  process.stderr.write(USAGE);
  process.exit(2);
}
