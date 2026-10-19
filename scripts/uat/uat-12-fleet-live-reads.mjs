#!/usr/bin/env node
/**
 * UAT 12 — the fleet's four live reads, against the real core on throwaway data (plan 11-15).
 *
 * Closes the scriptable half of four DEFERRED-REVIEW.md items from Phase 10. Each section prints its
 * register id and a verdict, so the output maps onto the register without interpretation:
 *
 *   D-REV-48  appending to a live run's log makes `fleet_list` return the new tail
 *   D-REV-49  `agent_run_acknowledge` drops a finished run's row from `fleet_list`
 *   D-REV-50  `fleet_blocked_queue` shrinks by exactly one per `agent_run_answer_permission`
 *   D-REV-55  `worktree_reclaim` removes exactly the selected directories, and `fleet_list` is
 *             answerable while it runs
 *
 * WHAT "THE REAL COMMANDS" MEANS HERE. The five Tauri commands live in the desktop crate, which needs an
 * AppHandle and a 13-minute cold build. Each is a thin wrapper over a function in `packages/core`, so
 * `uat_fleet_ops` (packages/core/tests/bin) calls that function. Not exercised: the AppState mutex,
 * `spawn_blocking`, the `board:changed` emit and the IPC serialisation. See that file's header.
 *
 * SCRATCH DATA ONLY (T-11-43). Every call runs with FLYWHEEL_APP_DATA_DIR and FLYWHEEL_WORKTREE_ROOT
 * pointing inside one `mkdtemp` directory, which is removed in a `finally`, on failure too. The binary
 * itself refuses to run without those variables, so a mistake here fails closed.
 *
 * Exit codes follow run-all.sh: 0 pass, 1 fail. A missing binary is a failure, not a skip: a harness
 * that did not run is not a harness that passed.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { resolveHarnessBinary } from "./lib/sidecar-harness.mjs";

/** The bound on a `fleet_list` issued during a reclaim, end to end including process start (T-11-44). */
const LIST_DURING_RECLAIM_BOUND_MS = 2000;
/** Committed files per worktree in the reclaim section: enough that the removal takes measurable time. */
const BULK_FILES = Number(process.env.UAT12_BULK_FILES ?? 6000);

const GIT_ID = ["-c", "user.email=uat@flywheel.test", "-c", "user.name=UAT"];

function git(cwd, ...args) {
  const r = spawnSync("git", [...GIT_ID, ...args], { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
}

function makeRepo(dir, bulkFiles = 0) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, "init", "--initial-branch=main");
  fs.writeFileSync(path.join(dir, "README.md"), "uat-12 scratch repo\n");
  for (let i = 0; i < bulkFiles; i += 1) {
    const sub = path.join(dir, "bulk", `d${Math.floor(i / 100)}`);
    if (i % 100 === 0) fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(path.join(sub, `f${i}.txt`), `file ${i}\n`);
  }
  git(dir, "add", "-A");
  git(dir, "commit", "-m", "initial commit");
}

async function main() {
  const bin = resolveHarnessBinary("uat_fleet_ops");
  if (bin === undefined) {
    throw new Error(
      "HARNESS PRECONDITION FAILED: the uat_fleet_ops binary was not found under target/{debug,release} — " +
        "run `cargo build -p core --bin uat_fleet_ops` first",
    );
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "flywheel-uat-12-"));
  const appDataDir = path.join(root, "appdata");
  const worktreeRoot = path.join(root, "worktrees");
  fs.mkdirSync(appDataDir, { recursive: true });
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const env = { ...process.env, FLYWHEEL_APP_DATA_DIR: appDataDir, FLYWHEEL_WORKTREE_ROOT: worktreeRoot };

  const verdicts = [];
  try {
    // The scratch directory is the only thing any call below may write to.
    assert.ok(
      path.resolve(appDataDir).startsWith(path.resolve(root) + path.sep),
      "the app-data directory must live inside the scratch root",
    );

    const ops = (...args) => {
      const r = spawnSync(bin, args, { encoding: "utf8", env });
      if (r.status !== 0) throw new Error(`uat_fleet_ops ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
      return JSON.parse(r.stdout.trim().split("\n").at(-1));
    };
    /** The same call, expected to be refused: returns the exit status and stderr instead of throwing. */
    const opsRefused = (...args) => {
      const r = spawnSync(bin, args, { encoding: "utf8", env });
      return { status: r.status, stderr: r.stderr.trim() };
    };
    const fleet = () => ops("fleet-list");
    const row = (list, runId) => list.rows.find((r) => r.agentRunId === runId);

    const repoA = path.join(root, "repos", "alpha");
    const repoB = path.join(root, "repos", "bravo");
    makeRepo(repoA);
    makeRepo(repoB);
    const projectA = ops("register-project", repoA, "Alpha", "AAA").projectId;
    const projectB = ops("register-project", repoB, "Bravo", "BBB").projectId;

    /** One register item: run `body`, print its id and verdict, keep going so every id reports. */
    const section = async (id, title, body) => {
      try {
        const detail = await body();
        process.stdout.write(`${id}  PASS — ${title}\n${detail.map((d) => `      ${d}\n`).join("")}`);
        verdicts.push({ id, ok: true });
      } catch (err) {
        process.stdout.write(`${id}  FAIL — ${title}\n`);
        verdicts.push({ id, ok: false, err });
      }
    };

    // ---------------------------------------------------------------- D-REV-48
    await section("D-REV-48", "an appended log line reaches fleet_list as the row's activity tail", () => {
      const { runId } = ops("start-run", projectA, "log tail subject");
      const before = row(fleet(), runId);
      assert.ok(before, "the live run must be on the fleet");
      assert.equal(before.runStatus, "running");
      assert.deepEqual(before.activityLines, [], "no log yet: the cell reads as an absence, not a stale value");

      const line = (n) => JSON.stringify({ type: "assistant", tool: "Read", n });
      for (let n = 1; n <= 3; n += 1) ops("append-log", runId, line(n));
      const afterThree = row(fleet(), runId);
      assert.deepEqual(afterThree.activityLines, [line(1), line(2), line(3)], "the tail is the appended lines, verbatim, oldest first");

      ops("append-log", runId, line(4));
      assert.equal(row(fleet(), runId).activityLines.at(-1), line(4), "the very next read sees the newest line");

      // The window is bounded (LOG_TAIL_MAX_LINES): a chatty agent shows its latest, not its history.
      for (let n = 5; n <= 30; n += 1) ops("append-log", runId, line(n));
      const tail = row(fleet(), runId).activityLines;
      assert.equal(tail.length, 16, "the tail is capped at LOG_TAIL_MAX_LINES");
      assert.equal(tail.at(-1), line(30));
      assert.equal(tail[0], line(15));

      // Control: a finished run's log is never read, so its row carries no activity.
      ops("finish-run", runId, "completed");
      const finished = row(fleet(), runId);
      assert.ok(finished, "a finished, unacknowledged run stays on the fleet");
      assert.deepEqual(finished.activityLines, [], "terminal rows are never read");
      return [
        "tail verbatim after 3 appends; newest line visible on the next read; capped at 16 (lines 15..30)",
        "control: the same run, once completed, carries no activity",
        "NOT covered: the ~1 s refresh throttle and the 80-character clip are renderer behaviour (fleet-activity.test.tsx)",
      ];
    });

    // ---------------------------------------------------------------- D-REV-49
    await section("D-REV-49", "acknowledging a finished run drops its row from fleet_list", () => {
      const done = ops("start-run", projectA, "ack subject, completed");
      const failed = ops("start-run", projectB, "ack subject, failed");
      const live = ops("start-run", projectB, "ack subject, still live");
      ops("finish-run", done.runId, "completed");
      ops("finish-run", failed.runId, "failed");

      const listed = fleet();
      assert.ok(row(listed, done.runId) && row(listed, failed.runId), "both finished runs are on the fleet before Dismiss");

      // Control first: a live run cannot be dismissed, however the command is called.
      assert.equal(ops("acknowledge", live.runId).changed, false, "a live run is refused");
      assert.ok(row(fleet(), live.runId), "...and its row stays");

      assert.equal(ops("acknowledge", done.runId).changed, true);
      const afterOne = fleet();
      assert.equal(row(afterOne, done.runId), undefined, "the acknowledged completed run left the fleet");
      assert.ok(row(afterOne, failed.runId), "the other finished run is untouched: a click on one row clears one row");
      assert.equal(afterOne.totalRows, listed.totalRows - 1, "exactly one row left");

      assert.equal(ops("acknowledge", failed.runId).changed, true);
      assert.equal(row(fleet(), failed.runId), undefined, "a failed run is dismissible too");
      assert.equal(ops("acknowledge", failed.runId).changed, false, "a second Dismiss changes nothing");
      return [
        "completed and failed runs each leave on acknowledge; row count drops by exactly one per call",
        "controls: a live run is refused and stays; a repeat acknowledge reports no change",
        "NOT covered: the Tauri round trip from the button press, and how the token text fits at narrow widths",
      ];
    });

    // ---------------------------------------------------------------- D-REV-50
    await section("D-REV-50", "the blocked queue shrinks by exactly one per answered request", () => {
      assert.equal(ops("blocked-queue").entries.length, 0, "precondition: nothing is blocked yet");
      const a = ops("start-run", projectA, "blocked in alpha");
      const b = ops("start-run", projectB, "blocked in bravo");
      const reqA = ops("block-run", a.runId).requestId;
      const reqB = ops("block-run", b.runId).requestId;

      const queue = ops("blocked-queue").entries;
      assert.equal(queue.length, 2, "both blocked agents are listed, one per run");
      assert.deepEqual(queue.map((e) => e.projectName).sort(), ["Alpha", "Bravo"], "across two projects");
      assert.equal(row(fleet(), a.runId).fleetState, "blocked");

      // Answer the first one in queue order: the queue shrinks by one and loses exactly that entry.
      const first = queue[0];
      ops("answer", first.requestId, "allow");
      const afterOne = ops("blocked-queue").entries;
      assert.equal(afterOne.length, 1, "one answer, one entry gone");
      assert.deepEqual(afterOne.map((e) => e.requestId), [queue[1].requestId], "the unanswered agent is still listed");

      // Control: the same request cannot be answered twice, and a refused answer shrinks nothing.
      const again = opsRefused("answer", first.requestId, "deny");
      assert.notEqual(again.status, 0, "a second answer to the same request is refused");
      assert.equal(ops("blocked-queue").entries.length, 1, "a refused answer did not move the queue");

      ops("answer", queue[1].requestId, "deny");
      assert.equal(ops("blocked-queue").entries.length, 0, "the second answer empties it");
      assert.ok([reqA, reqB].includes(first.requestId));
      return [
        "2 blocked runs in 2 projects: queue 2 -> 1 -> 0, one answer each, the other agent's entry untouched",
        "control: re-answering an answered request is refused and the queue does not move",
        "NOT covered: the keypress -> Tauri round trip, a real sidecar raising the requests, the owner marking's look",
        "NOT covered: the sidecar relay and the allow_always rule write (the desktop half of agent_run_answer_permission)",
      ];
    });

    // ---------------------------------------------------------------- D-REV-55
    await section("D-REV-55", "worktree_reclaim removes exactly the selected directories and fleet_list stays answerable", async () => {
      const repoC = path.join(root, "repos", "charlie");
      makeRepo(repoC, BULK_FILES);
      const projectC = ops("register-project", repoC, "Charlie", "CCC").projectId;

      const reclaimable = ["one", "two", "three", "four"].map((n) => ops("make-reclaimable", projectC, `reclaim ${n}`));
      const live = ops("start-run", projectC, "reclaim bystander, live");
      assert.ok(live.runId, "the bystander run started");
      const selected = reclaimable.slice(0, 3);
      const spared = reclaimable[3];
      for (const w of reclaimable) assert.ok(fs.existsSync(w.path), `precondition: ${w.path} exists`);
      assert.ok(fs.existsSync(path.join(selected[0].path, "bulk")), "the worktrees really carry the bulk files");

      // Reclaim runs as its own process; fleet_list calls are issued back to back until it exits.
      const reclaim = spawn(bin, ["reclaim", ...selected.map((w) => w.storyId)], { env, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      reclaim.stdout.on("data", (d) => (stdout += d));
      reclaim.stderr.on("data", (d) => (stderr += d));
      const exited = new Promise((resolve) => reclaim.on("close", resolve));

      const lists = [];
      let done = false;
      exited.then(() => (done = true));
      while (!done) {
        const t0 = Date.now();
        const r = await new Promise((resolve) => {
          const p = spawn(bin, ["fleet-list"], { env, stdio: ["ignore", "pipe", "pipe"] });
          let out = "";
          p.stdout.on("data", (d) => (out += d));
          p.on("close", (code) => resolve({ code, out }));
        });
        lists.push({ start: t0, end: Date.now(), code: r.code, body: r.code === 0 ? JSON.parse(r.out) : null });
      }
      const code = await exited;
      assert.equal(code, 0, `reclaim exited ${code}: ${stderr.trim()}`);

      const events = stdout.trim().split("\n").map((l) => JSON.parse(l));
      const start = events.find((e) => e.event === "reclaim-start").ms;
      const end = events.find((e) => e.event === "reclaim-end");
      const outcomes = end.outcomes;

      // Exactly the selected directories are gone.
      assert.equal(outcomes.length, 3);
      for (const w of selected) {
        const o = outcomes.find((x) => x.storyId === w.storyId);
        assert.ok(o?.removed, `${w.storyId} must report removed: ${JSON.stringify(o)}`);
        assert.equal(fs.existsSync(w.path), false, `${w.path} must be gone from disk`);
      }
      assert.equal(fs.existsSync(spared.path), true, "the reclaimable worktree that was not selected is untouched");
      assert.equal(outcomes.some((o) => o.storyId === spared.storyId), false, "...and was never named in the batch");
      const liveRow = fleet().rows.find((r) => r.projectName === "Charlie" && r.runStatus === "running");
      assert.ok(liveRow, "the live run's row survived the reclaim");

      // fleet_list answered while the reclaim was in flight.
      const inFlight = lists.filter((l) => l.start >= start && l.end <= end.ms);
      assert.ok(
        inFlight.length >= 1,
        `INSTRUMENT: the reclaim lasted ${end.ms - start} ms and no fleet_list fit inside it, so responsiveness was not measured. ` +
          `Raise UAT12_BULK_FILES (now ${BULK_FILES}).`,
      );
      for (const l of inFlight) {
        assert.equal(l.code, 0, "a fleet_list issued during the reclaim must succeed");
        assert.ok(l.body.rows.some((r) => r.runStatus === "running"), "...and return the live row");
      }
      const slowest = Math.max(...lists.map((l) => l.end - l.start));
      assert.ok(
        slowest <= LIST_DURING_RECLAIM_BOUND_MS,
        `slowest fleet_list during the reclaim took ${slowest} ms, over the ${LIST_DURING_RECLAIM_BOUND_MS} ms bound`,
      );
      return [
        `${BULK_FILES} committed files per worktree; 3 of 4 reclaimable worktrees selected: those 3 gone from disk, the 4th and the live run's worktree untouched`,
        `reclaim lasted ${end.ms - start} ms; ${inFlight.length} fleet_list call(s) completed inside it, ${lists.length} issued in all`,
        `slowest fleet_list: ${slowest} ms, bound ${LIST_DURING_RECLAIM_BOUND_MS} ms (end to end, including process start)`,
        "NOT covered: the AppState mutex and spawn_blocking in the desktop command; a worktree holding node_modules; the dialog's look",
      ];
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  const failed = verdicts.filter((v) => !v.ok);
  if (failed.length > 0) {
    process.stdout.write(`\n❌ FAIL — UAT 12 — fleet live reads (${failed.map((f) => f.id).join(", ")})\n`);
    for (const f of failed) process.stdout.write(`\n[${f.id}]\n${f.err?.stack ?? String(f.err)}\n`);
    process.exitCode = 1;
    return;
  }
  process.stdout.write(`\n✅ PASS — UAT 12 — fleet live reads (${verdicts.map((v) => v.id).join(", ")})\n`);
}

main().catch((err) => {
  process.stdout.write(`\n❌ FAIL — UAT 12 — fleet live reads\n\n${err?.stack ?? String(err)}\n`);
  process.exitCode = 1;
});
