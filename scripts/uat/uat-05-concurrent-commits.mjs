#!/usr/bin/env node
/**
 * UAT item 5 (Success Criterion 4, WORK-04/WORK-05) — "Ten concurrent commits through a live agent
 * session keep every commit."
 *
 * 03-VERIFICATION.md deferred this because `lock_contention.rs`/`commit_stress_harness.rs` drive
 * the shim directly rather than through a live session: "neither is the full packaged app driving
 * a real agent session end to end." This script closes the session half of that gap — the ten
 * concurrent commits are performed by a process tree rooted in a real `claude` session, inheriting
 * that session's real spawn environment (shim-prefixed PATH included), not by a test harness
 * calling the shim itself.
 *
 * What it asserts:
 *   1. All ten commits are reachable — one per worktree branch, verified by `git rev-parse` and
 *      `git cat-file` against the repository afterwards, never from the agent's narration.
 *   2. The agent's own `git` resolved through the installed PATH shim. The evidence is written to
 *      a file BY THE AGENT'S OWN SHELL (`command -v git`), then read back here — a model claiming
 *      "I used the shim" would not count.
 *   3. No commit was lost to git's index/ref locking under contention, which is the actual
 *      WORK-04/WORK-05 guarantee: ten concurrent writers to one repository, zero dropped.
 *
 * Costs real tokens: it drives a real model turn.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  git,
  newRunId,
  probeClaudeAvailable,
  runScript,
  skip,
  step,
} from "./lib/sidecar-harness.mjs";

const COMMIT_COUNT = 10;
const TURN_DEADLINE_MS = 300_000;

/**
 * The fan-out the agent is asked to run. Written into the repository by the harness so the model
 * only has to invoke one command — what is under test is the process tree and its environment, not
 * the model's ability to retype a long shell pipeline.
 *
 * Every `git` here is a BARE invocation, so each resolves through whatever leads PATH — which, in
 * a real session, is the per-run shim directory.
 */
function fanoutScript(count) {
  return `#!/bin/bash
# Ten concurrent committers against ONE repository (WORK-04/WORK-05).
#
# Every git invocation here is BARE and stays inside the "safe" classification set, so the
# shim lets it through and what is actually exercised is the concurrency guarantee rather than
# the destructive gate. In particular this avoids \`git -C\`
# (the classifier reads it as uncategorized, i.e. fail-closed destructive) by cd-ing instead.
set -u
cd "$(dirname "$0")"

# Evidence written by this shell, not narrated by the model: where does a bare 'git' resolve to
# inside the agent's own process tree?
command -v git > .uat-git-path
git --version > .uat-git-version 2>&1

pids=()
for i in $(seq 1 ${count}); do
  (
    wt="../worktrees/wt-$i"
    cd "$wt" || exit 90
    echo "payload $i" > "file-$i.txt"
    git add "file-$i.txt" || exit 91
    git commit -q -m "uat concurrent commit $i" || exit 92
  ) &
  pids+=($!)
done

failed=0
for pid in "\${pids[@]}"; do
  wait "$pid" || failed=$((failed + 1))
done
echo "$failed" > .uat-failed-count
exit 0
`;
}

await runScript(
  "concurrent-commits",
  `UAT 5 — ${COMMIT_COUNT} concurrent commits through a live session keep every commit`,
  async (harness) => {
    if (!probeClaudeAvailable()) {
      skip("the real `claude` binary is not resolvable — this item needs a live backend session");
    }

    step("creating a scratch repository");
    const { workPath, defaultBranch } = harness.createRepoWithRemote();
    fs.mkdirSync(path.join(harness.root, "worktrees"), { recursive: true });
    // Worktrees must be removed before the repository directory is deleted, or git leaves
    // administrative files behind that confuse a later `git worktree list` in the same tree.
    harness.onCleanup(() => {
      git(workPath, ["worktree", "prune"], { allowFailure: true });
    });

    // The worktrees are created HERE, not by the agent. The UAT item is about ten concurrent
    // COMMITS surviving, and `git worktree add` classifies as `uncategorized` — fail-closed
    // destructive — so asking the agent to create them would test the destructive gate (UAT item
    // 3's subject) instead of the concurrency guarantee this item is about.
    for (let i = 1; i <= COMMIT_COUNT; i += 1) {
      git(workPath, [
        "worktree",
        "add",
        "-q",
        "-b",
        `uat-concurrent-${i}`,
        path.join(harness.root, "worktrees", `wt-${i}`),
        "HEAD",
      ]);
    }
    step(`pre-created ${COMMIT_COUNT} worktrees off HEAD`);

    const scriptPath = path.join(workPath, "fanout.sh");
    fs.writeFileSync(scriptPath, fanoutScript(COMMIT_COUNT), { mode: 0o755 });
    step(`wrote the ${COMMIT_COUNT}-way fan-out script into the worktree`);

    const runId = newRunId();
    const env = harness.sessionEnv(runId, defaultBranch);
    const expectedShimDir = env.PATH.split(":")[0];
    step(`spawn env resolved; shim dir leads PATH: ${expectedShimDir}`);

    step("starting the real sidecar and completing its readiness handshake");
    const sidecar = await harness.startSidecar();

    step("spawning a real claude session and asking it to run the fan-out");
    await sidecar.request({
      op: "spawn",
      runId,
      worktreePath: workPath,
      prompt:
        "Run exactly this one command and nothing else: bash ./fanout.sh  " +
        "Use the bare command name (never an absolute path). " +
        "Do not inspect, modify or rewrite the script. Do not ask for confirmation. " +
        "After it finishes, reply with the single word DONE.",
      permissionMode: "bypassPermissions",
      env,
    });

    step("waiting for the session to finish");
    const closed = await sidecar.waitForEvent(
      (event) => event.type === "session_closed",
      TURN_DEADLINE_MS,
      "the session_closed event",
    );
    step(`session closed: reason=${closed.reason}`);

    // ---- assertion 2 first: did the agent's own shell resolve git through the shim? ------------
    const gitPathFile = path.join(workPath, ".uat-git-path");
    assert.ok(
      fs.existsSync(gitPathFile),
      "the fan-out script never ran — no evidence file was written. The session may have refused " +
        `the command. session_closed detail: ${closed.detail ?? "(none)"}`,
    );
    const resolvedGit = fs.readFileSync(gitPathFile, "utf8").trim();
    step(`the agent's own shell resolved git to: ${resolvedGit}`);
    assert.equal(
      path.dirname(resolvedGit),
      expectedShimDir,
      "the agent's git must resolve through the per-run PATH shim directory, not a bare system " +
        `git. Resolved to ${resolvedGit}, expected something inside ${expectedShimDir}.`,
    );

    // ---- assertion 1: every commit is reachable -------------------------------------------------
    const failedCountFile = path.join(workPath, ".uat-failed-count");
    const failedCount = fs.existsSync(failedCountFile)
      ? Number(fs.readFileSync(failedCountFile, "utf8").trim())
      : Number.NaN;

    const missing = [];
    for (let i = 1; i <= COMMIT_COUNT; i += 1) {
      const branch = `uat-concurrent-${i}`;
      const rev = git(workPath, ["rev-parse", "--verify", `refs/heads/${branch}`], {
        allowFailure: true,
      });
      if (rev.status !== 0) {
        missing.push(`${branch} (no such branch)`);
        continue;
      }
      // The branch existing is not enough — it must carry the commit, with the file in its tree.
      const blob = git(workPath, ["cat-file", "-e", `${branch}:file-${i}.txt`], {
        allowFailure: true,
      });
      if (blob.status !== 0) missing.push(`${branch} (commit present but file-${i}.txt missing)`);
    }

    assert.deepEqual(
      missing,
      [],
      `${COMMIT_COUNT - missing.length}/${COMMIT_COUNT} commits landed — these did not: ` +
        `${missing.join(", ")}. Reported in-script failures: ${failedCount}. This is the exact ` +
        "WORK-04/WORK-05 failure mode: a commit lost to index/ref lock contention.",
    );
    step(`PASS — all ${COMMIT_COUNT} commits are reachable and carry their payload`);

    assert.equal(
      failedCount,
      0,
      `the fan-out script itself reported ${failedCount} failed committer(s), even though every ` +
        "branch is present — investigate before trusting this result",
    );

    const retries = sidecar.eventsOfType("git_retry");
    const exhausted = sidecar.eventsOfType("git_lock_exhausted");
    step(
      `shim lock telemetry: ${retries.length} retry notice(s), ${exhausted.length} exhaustion(s)`,
    );
    assert.equal(
      exhausted.length,
      0,
      "the shim reported exhausting its retry budget — a commit was at risk of being dropped",
    );
  },
);
