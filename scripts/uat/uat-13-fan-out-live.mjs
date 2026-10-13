#!/usr/bin/env node
/**
 * UAT 13 - a whole fan-out with only the model replaced (plan 11-16, register item D-REV-34).
 *
 * D-REV-34's claim is the point of Phase 09: one approved plan drives real sessions, the merge lands,
 * and wave two builds on wave one. It has four parts, each its own section below, each printing the
 * register id and a verdict:
 *
 *   1/4 cap     the tick spawns up to the cap through the real sidecar, and no more
 *   2/4 commit  each agent commits, as its briefing tells it to
 *   3/4 merge   the automatic merge lands each wave-one task on the epic's integration branch
 *   4/4 base    wave two's worktree is cut from a base that contains wave one
 *
 * WHAT IS REAL. The sidecar (`packages/sidecar/dist/index.js`) as its own process; the core's dispatcher
 * tick (`dispatch_exec::run_pass`) and the production `apply_session_closed`, through `uat_fanout_ops`;
 * the PATH shim, the watchdog wrapper, the scope marker, the worktrees and the merge; and git. WHAT IS
 * FAKED. The model: `packages/sidecar/test/fake-claude.mjs`, in its commit mode, which commits only when
 * its briefing carries the dispatcher's commit instruction.
 *
 * WHAT IS NOT PROVEN. A real account and a real model's obedience (plan 11-21), and the desktop launch
 * body itself (`uat_fanout_ops` mirrors its core steps; see that file's header).
 *
 * THE PLAN IS FOUR TASKS, NOT THREE. Wave one holds three disjoint tasks and the cap is two, so the cap
 * is the only thing that can hold the third back. With a two-task wave the cap would never bind and
 * "exactly two spawns" would be true of any dispatcher.
 *
 * THE WAVE-TWO CLAIM IS ASSERTED BY GIT. "Wave two starts from a base containing wave one" is a claim
 * about history, and the dispatcher's own record of it (the plan's state column) is the thing under
 * test, so section 4 reads `git merge-base --is-ancestor` and never the board. Its control: a wave-one
 * task's own branch must NOT contain a sibling's commit, or the check would pass for any branch.
 *
 * SCRATCH ONLY (T-11-45). One `mkdtemp` root holds the app-data directory, the worktree root, the
 * runtime directory and the repository, and is removed on exit, failure included. The binary refuses
 * to run without those variables. A failure prints its evidence instead of keeping the directory.
 *
 * Exit codes follow run-all.sh: 0 pass, 1 fail. A missing binary is a failure, not a skip.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { Harness, REPO_ROOT, SIDECAR_ENTRY, git as gitIn, resolveHarnessBinary } from "./lib/sidecar-harness.mjs";

const CAP = 2;
const SESSION_CLOSE_TIMEOUT_MS = Number(process.env.UAT13_CLOSE_TIMEOUT_MS ?? 60_000);
const MAX_TICKS = 12;
const FAKE_CLAUDE = path.join(REPO_ROOT, "packages", "sidecar", "test", "fake-claude.mjs");

const TASKS = [
  { title: "Task A", file: "src/a.txt", wave: 1 },
  { title: "Task B", file: "src/b.txt", wave: 1 },
  { title: "Task C", file: "src/c.txt", wave: 1 },
  { title: "Task D", file: "src/d.txt", wave: 2 },
];

const git = (cwd, ...args) => gitIn(cwd, args).stdout.trim();
const gitOk = (cwd, ...args) => gitIn(cwd, args, { allowFailure: true }).status === 0;

async function main() {
  const fanout = resolveHarnessBinary("uat_fanout_ops");
  const heartbeatBin = resolveHarnessBinary("uat_session_env");
  if (fanout === undefined || heartbeatBin === undefined) {
    throw new Error(
      "HARNESS PRECONDITION FAILED: uat_fanout_ops / uat_session_env not found under target/{debug,release} - " +
        "run `cargo build -p core --bin uat_fanout_ops --bin uat_session_env -p flywheel-shim` first",
    );
  }
  if (!fs.existsSync(SIDECAR_ENTRY)) {
    throw new Error(`HARNESS PRECONDITION FAILED: ${SIDECAR_ENTRY} not found - run \`npm --prefix packages/sidecar run build\``);
  }

  const h = new Harness("uat-13");
  const verdicts = [];
  const evidence = { ticks: [], closes: [] };
  try {
    const worktreeRoot = path.join(h.root, "worktrees");
    const runtimeDir = path.join(h.root, "runtime");
    fs.mkdirSync(worktreeRoot, { recursive: true });
    fs.mkdirSync(runtimeDir, { recursive: true });
    for (const dir of [h.appDataDir, worktreeRoot, runtimeDir]) {
      assert.ok(path.resolve(dir).startsWith(path.resolve(h.root) + path.sep), `${dir} must live inside the scratch root`);
    }
    const env = {
      ...process.env,
      FLYWHEEL_APP_DATA_DIR: h.appDataDir,
      FLYWHEEL_WORKTREE_ROOT: worktreeRoot,
      FLYWHEEL_RUNTIME_DIR: runtimeDir,
    };

    // The scratch repository: one commit on `main`, identity configured for the core's own merges.
    const repo = path.join(h.root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    git(repo, "init", "--initial-branch=main");
    git(repo, "config", "user.email", "uat@flywheel.test");
    git(repo, "config", "user.name", "UAT");
    fs.writeFileSync(path.join(repo, "README.md"), "uat-13 scratch repo\n");
    git(repo, "add", "README.md");
    git(repo, "commit", "-m", "initial commit");
    const mainBefore = git(repo, "rev-parse", "main");

    /** Run a subcommand; every stdout line is JSON. Returns the parsed lines. */
    const ops = (...args) => {
      const r = spawnSync(fanout, args, { encoding: "utf8", env });
      if (r.status !== 0) throw new Error(`uat_fanout_ops ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
      return r.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
    };
    const touchHeartbeat = () => spawnSync(heartbeatBin, ["--touch-heartbeat"], { env });
    touchHeartbeat();
    const heartbeat = setInterval(touchHeartbeat, 2_000);
    h.onCleanup(() => clearInterval(heartbeat));

    const setup = ops("setup", repo, String(CAP), JSON.stringify(TASKS)).at(-1);
    const planId = setup.planId;
    const idOf = Object.fromEntries(setup.tasks.map((t) => [t.title, t.taskId]));

    const sidecar = await h.startSidecar({
      env: { FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE, FLYWHEEL_WORKTREE_ROOT: worktreeRoot, FLYWHEEL_RUNTIME_DIR: runtimeDir },
    });

    /** One tick; the spawn requests it produced and its report. */
    const tick = () => {
      const lines = ops("tick");
      const requests = lines.filter((l) => l.event === "spawn-request");
      const report = lines.find((l) => l.event === "pass");
      const state = ops("state", planId).at(-1);
      const entry = { requests, report, state };
      evidence.ticks.push(entry);
      return entry;
    };
    /** Hand each request to the real sidecar, wait for every session to close, give the core the event. */
    const runSessions = async (requests) => {
      const runIds = [];
      for (const { request } of requests) {
        const { id: _drop, ...body } = request; // the client numbers its own requests
        await sidecar.request(body, 30_000);
        runIds.push(request.runId);
      }
      for (const runId of runIds) {
        const closed = await sidecar.waitForEvent(
          (e) => e.type === "session_closed" && e.runId === runId,
          SESSION_CLOSE_TIMEOUT_MS,
          `session_closed for run ${runId}`,
        );
        evidence.closes.push({ runId, reason: closed.reason, detail: closed.detail });
        ops("session-closed", JSON.stringify(closed));
      }
    };

    // ---- drive the whole plan -------------------------------------------------------------
    // Tick 1: three wave-one tasks are ready, the cap is two.
    const first = tick();
    // Tick 2, BEFORE any session has closed: both slots are still taken, so nothing may spawn.
    const second = tick();
    await runSessions([...first.requests, ...second.requests]);
    let drained = false;
    for (let i = 0; i < MAX_TICKS && !drained; i += 1) {
      const t = tick();
      await runSessions(t.requests);
      drained = t.state.status === "complete" || t.state.tasks.every((x) => x.state === "merged");
    }
    const final = ops("state", planId).at(-1);
    const integration = final.integrationBranch;
    const byTitle = Object.fromEntries(final.tasks.map((t) => [t.title, t]));

    /** The commits an agent made on a task's branch: the fake's message is `agent work: <file>`. */
    const agentCommits = (title) => {
      const { branch } = byTitle[title];
      if (!branch) return []; // never got a worktree: no commits, and the sections say so
      const file = TASKS.find((t) => t.title === title).file;
      return git(repo, "log", "--format=%H", `--grep=^agent work: ${file}$`, branch).split("\n").filter(Boolean);
    };

    const section = (n, name, title, body) => {
      try {
        const detail = body();
        process.stdout.write(`D-REV-34  [${n}/4 ${name}]  PASS - ${title}\n${detail.map((d) => `      ${d}\n`).join("")}`);
        verdicts.push({ ok: true });
      } catch (err) {
        process.stdout.write(`D-REV-34  [${n}/4 ${name}]  FAIL - ${title}\n      ${String(err.message).split("\n").join("\n      ")}\n`);
        verdicts.push({ ok: false });
      }
    };

    // ---- 1/4 ------------------------------------------------------------------------------
    section(1, "cap", "the tick spawns up to the cap through the real sidecar, and no more", () => {
      assert.equal(first.state.tasks.filter((t) => t.wave === 1).length, 3, "three wave-one tasks are ready");
      assert.equal(first.requests.length, CAP, `tick 1 must spawn exactly ${CAP} of the 3 ready tasks`);
      assert.equal(first.report.spawned, CAP, "the pass report agrees with the requests it produced");
      assert.equal(first.state.liveRuns, CAP, "exactly the cap's worth of runs are live after tick 1");
      assert.equal(second.requests.length, 0, "tick 2 ran with both slots taken and must spawn nothing");
      assert.equal(second.state.liveRuns, CAP, "the cap still holds after tick 2");
      for (const [i, t] of evidence.ticks.entries()) {
        assert.ok(t.state.liveRuns <= CAP, `tick ${i + 1}: ${t.state.liveRuns} live runs exceeds the cap of ${CAP}`);
      }
      const spawned = new Set(evidence.ticks.flatMap((t) => t.requests.map((r) => r.taskId)));
      assert.equal(spawned.size, TASKS.length, "every task was spawned exactly once over the plan");
      assert.equal(evidence.closes.length, TASKS.length, "every session came back from the sidecar as a session_closed");
      assert.ok(evidence.closes.every((c) => c.reason === "completed"), `all sessions completed: ${JSON.stringify(evidence.closes)}`);
      return [`tick 1 spawned ${first.requests.length} of 3 ready; tick 2 (slots full) spawned ${second.requests.length}`, `ticks run: ${evidence.ticks.length}; live runs never above ${CAP}`];
    });

    // ---- 2/4 ------------------------------------------------------------------------------
    section(2, "commit", "each agent commits, as its briefing tells it to", () => {
      const lines = [];
      for (const t of TASKS) {
        const commits = agentCommits(t.title);
        assert.equal(commits.length, 1, `${t.title}: exactly one agent commit on its branch, found ${commits.length}`);
        const files = git(repo, "show", "--name-only", "--format=", commits[0]).split("\n").filter(Boolean);
        assert.deepEqual(files, [t.file], `${t.title}: the commit touches only its declared file`);
        lines.push(`${t.title}: ${commits[0].slice(0, 9)} touches ${t.file}`);
      }
      return lines;
    });

    // ---- 3/4 ------------------------------------------------------------------------------
    section(3, "merge", "the automatic merge lands each wave-one task on the integration branch", () => {
      assert.ok(integration, "the epic has an integration branch");
      assert.equal(git(repo, "rev-parse", "main"), mainBefore, "main did not move: automatic merges target the integration branch only");
      const lines = [];
      for (const t of TASKS) {
        const [commit] = agentCommits(t.title);
        assert.ok(commit, `${t.title}: no agent commit to find on the integration branch`);
        assert.ok(gitOk(repo, "merge-base", "--is-ancestor", commit, integration), `${t.title}: ${commit.slice(0, 9)} is not reachable from ${integration}`);
        assert.ok(git(repo, "ls-tree", "-r", "--name-only", integration).split("\n").includes(t.file), `${t.title}: ${t.file} is not in ${integration}'s tree`);
        lines.push(`${t.title}: ${commit.slice(0, 9)} is an ancestor of ${integration}`);
      }
      assert.ok(Number(git(repo, "rev-list", "--count", "--merges", `main..${integration}`)) >= 3, "the integration branch carries a merge commit per merged task");
      return lines;
    });

    // ---- 4/4 ------------------------------------------------------------------------------
    section(4, "base", "wave two's worktree is cut from a base that contains wave one (asserted by git)", () => {
      const waveOne = TASKS.filter((t) => t.wave === 1).map((t) => ({ title: t.title, commit: agentCommits(t.title)[0] }));
      const [dCommit] = agentCommits("Task D");
      assert.ok(dCommit && waveOne.every((w) => w.commit), "wave two cannot be judged: a task has no agent commit");
      const dBase = git(repo, "rev-parse", `${dCommit}^`);
      const lines = [];
      for (const { title, commit } of waveOne) {
        assert.ok(
          gitOk(repo, "merge-base", "--is-ancestor", commit, dBase),
          `Task D was cut from ${dBase.slice(0, 9)}, which does not contain ${title}'s commit ${commit.slice(0, 9)}`,
        );
        lines.push(`${title}'s ${commit.slice(0, 9)} is an ancestor of Task D's base ${dBase.slice(0, 9)}`);
      }
      // Control: the wave-one siblings were cut in parallel, so neither may contain the other's commit.
      const [a, b] = waveOne;
      assert.ok(!gitOk(repo, "merge-base", "--is-ancestor", b.commit, agentCommits(a.title)[0]), "control: Task A's branch must not contain Task B's commit");
      lines.push("control: Task A's branch does not contain Task B's commit (the check can fail)");
      return lines;
    });

    if (verdicts.some((v) => !v.ok)) {
      process.stdout.write(`\nEVIDENCE\n${JSON.stringify({ final, closes: evidence.closes, ticks: evidence.ticks.map((t) => ({ spawned: t.requests.length, report: t.report, live: t.state.liveRuns })) }, null, 2)}\n`);
      process.stdout.write(`ASSERTION FAILED: ${verdicts.filter((v) => !v.ok).length} of 4 D-REV-34 sections failed\n`);
      process.exitCode = 1;
    } else {
      process.stdout.write("\nUAT 13 PASS - D-REV-34 wiring half: 4 of 4 sections (a real account and a model's obedience are not covered)\n");
    }
  } catch (err) {
    process.stdout.write(`ASSERTION FAILED: ${err?.stack ?? String(err)}\n`);
    process.stdout.write(`EVIDENCE ${JSON.stringify({ ticks: evidence.ticks.map((t) => ({ spawned: t.requests.map((r) => r.taskId), report: t.report, live: t.state.liveRuns })), closes: evidence.closes })}\n`);
    process.exitCode = 1;
  } finally {
    // Removes the sidecar, the heartbeat writer and the whole scratch root, on failure too (T-11-45).
    h.cleanup({ preserveRoot: false });
  }
}

main().catch((err) => {
  process.stdout.write(`ASSERTION FAILED: ${err?.stack ?? String(err)}\n`);
  process.exit(1);
});
