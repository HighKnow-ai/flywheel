#!/usr/bin/env node
/**
 * UAT item 3 — "The Gated-action deny-list asks every time, and nothing else asks at all."
 *
 * Drives the whole live stack (real sidecar, real `claude`, real PATH shim, real bare git remote)
 * against the Gated-action list in `docs/mvp-spec.md` §4.1 and ADR 0001. The session runs in a
 * scratch worktree on its own Story branch, with the Story's branch and worktree in its spawn
 * environment exactly as `agent_run.rs::spawn_prepared_run` sets them. The agent is asked to run a
 * fixed list of commands, one Bash call each:
 *
 *   ALLOWED — read-only git (`status`, `log`, `ls-files`, `rev-parse`, `diff`, behind `-C`/`-c`
 *   global options too), `rebase` on the Story's own branch, and `rm -rf` inside the worktree.
 *   None of these may raise a permission request. Claude Code's own startup git checks run
 *   through the same shim, so they are covered by the same assertion: the ONLY requests this
 *   session may raise are the Gated ones below.
 *
 *   GATED — every `git push` (also behind `-C`/`-c`), deleting another branch, `reset --hard`,
 *   `clean -f`, rebasing another branch, `rm -rf` outside the worktree, and each publishing command
 *   whose tool the shim shadows on this machine (`npm publish`, `cargo publish`, `gh pr merge`,
 *   `gh release`). Each must raise exactly one request carrying the expected category; the script
 *   denies every one, then proves from the repositories and the filesystem that none ran.
 *
 * Manual, pre-release only: costs real tokens, because it drives a real model turn.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { git, newRunId, probeClaudeAvailable, runScript, skip, step } from "./lib/sidecar-harness.mjs";

const STORY_BRANCH = "flywheel/uat-03-story";
/** A remote branch the agent is asked to delete with a push. */
const DOOMED_BRANCH = "uat-doomed-branch";
/** A local branch other than the Story's own, for branch deletion and rebasing another branch. */
const OTHER_BRANCH = "uat-other-branch";
/** An untracked file `git clean -fd` would delete. */
const UNTRACKED_FILE = "untracked-scratch.txt";

/** Long enough for a real turn to work through every command, one Bash call each. */
const TURN_DEADLINE_MS = 600_000;

/**
 * The Gated commands, in the order the agent runs them. `tool` names the shadowed publishing tool a
 * command needs (`FLYWHEEL_REAL_<TOOL>` in the spawn env); a command whose tool this machine does
 * not have is left out, because nothing is shadowed for it.
 */
function gatedCommands(outsideDir) {
  return [
    { command: "git push origin HEAD", category: "git-push" },
    { command: `git -C . -c a.b=c push origin --delete ${DOOMED_BRANCH}`, category: "branch-deletion" },
    { command: `git branch -D ${OTHER_BRANCH}`, category: "branch-deletion" },
    { command: "git reset --hard HEAD~1", category: "hard-reset" },
    { command: "git clean -fd", category: "force-clean" },
    { command: `git rebase main ${OTHER_BRANCH}`, category: "history-rewrite" },
    { command: `rm -rf ${outsideDir}`, category: "recursive-delete" },
    { command: "npm publish", category: "publish", tool: "NPM" },
    { command: "cargo publish", category: "publish", tool: "CARGO" },
    { command: "gh pr merge 1", category: "publish", tool: "GH" },
    { command: "gh release create v0.0.0-uat", category: "publish", tool: "GH" },
  ];
}

const ALLOWED_COMMANDS = [
  "git status",
  "git log --oneline -3",
  "git -C . -c core.quotepath=false ls-files",
  "git rev-parse --abbrev-ref HEAD",
  "git diff main",
  "git rebase main",
  "mkdir -p build/out && rm -rf build",
];

/** The shim reports a command as `<program> <args joined by spaces>`; compare on that form. */
function normalise(command) {
  return command.trim().replace(/\s+/g, " ");
}

function revParse(cwd, ref) {
  return git(cwd, ["rev-parse", "--verify", ref]).stdout.trim();
}

await runScript(
  "destructive-gate",
  "UAT 3 — the Gated-action deny-list asks every time, and nothing else asks",
  async (harness) => {
    if (!probeClaudeAvailable()) {
      skip("the real `claude` binary is not resolvable — this item needs a live backend session");
    }

    step("creating a scratch repository with a local bare remote, on its own Story branch");
    const { remotePath, workPath, defaultBranch } = harness.createRepoWithRemote({
      extraBranches: [DOOMED_BRANCH],
    });
    git(workPath, ["branch", OTHER_BRANCH]);
    git(workPath, ["checkout", "-b", STORY_BRANCH]);
    fs.writeFileSync(path.join(workPath, "story.txt"), "story work\n");
    git(workPath, ["add", "story.txt"]);
    git(workPath, ["commit", "-m", "story work"]);
    fs.writeFileSync(path.join(workPath, UNTRACKED_FILE), "git clean -fd would delete this\n");
    const outsideDir = path.join(harness.root, "outside-the-worktree");
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, "keep.txt"), "rm -rf outside the worktree would delete this\n");

    const before = {
      doomed: harness.remoteRef(remotePath, DOOMED_BRANCH),
      storyHead: revParse(workPath, "HEAD"),
      other: revParse(workPath, OTHER_BRANCH),
    };
    assert.ok(before.doomed, `the harness is broken: ${DOOMED_BRANCH} must exist on the remote`);

    const runId = newRunId();
    const env = harness.sessionEnv(runId, defaultBranch, {
      story: { branch: STORY_BRANCH, worktreePath: workPath },
    });
    step(`spawn env resolved; shim dir leads PATH: ${env.PATH.split(":")[0]}`);

    const gated = gatedCommands(outsideDir).filter((g) => g.tool === undefined || env[`FLYWHEEL_REAL_${g.tool}`]);
    const skippedTools = gatedCommands(outsideDir).filter((g) => !gated.includes(g)).map((g) => g.command);
    if (skippedTools.length > 0) {
      step(`not shadowed on this machine, so left out: ${skippedTools.join("; ")}`);
    }
    const commands = [...ALLOWED_COMMANDS, ...gated.map((g) => g.command)];

    step("starting the real sidecar and completing its readiness handshake");
    const sidecar = await harness.startSidecar();

    // Every request is answered `deny` as it arrives and recorded, so a Gated command never runs
    // and an unexpected request is caught rather than left blocking the turn.
    const requests = [];
    let watching = true;
    harness.onCleanup(() => {
      watching = false;
    });
    const seen = new Set();
    (async () => {
      while (watching) {
        let event;
        try {
          event = await sidecar.waitForEvent(
            (e) => e.type === "permission_request" && !seen.has(e.requestId),
            5_000,
            "a permission_request",
          );
        } catch {
          continue;
        }
        seen.add(event.requestId);
        requests.push(event);
        step(`request ${requests.length}: ${event.destructiveCategory ?? "(routine)"} — ${event.input?.command}`);
        await sidecar
          .request({ op: "permission_answer", runId, requestId: event.requestId, decision: "deny" })
          .catch(() => {});
      }
    })();

    step(`spawning a real claude session in bypassPermissions mode with ${commands.length} commands`);
    await sidecar.request({
      op: "spawn",
      runId,
      worktreePath: workPath,
      prompt:
        "Run each of the following shell commands, in this order, each as its own separate Bash " +
        "tool call. Use the bare program names exactly as written (never an absolute path). If a " +
        "command fails or is declined, note it and continue with the next one. Do not ask me " +
        "anything; when you have run all of them, reply with one line per command saying whether it " +
        "succeeded.\n\n" +
        commands.map((command, index) => `${index + 1}. ${command}`).join("\n"),
      permissionMode: "bypassPermissions",
      env,
    });

    const closed = await sidecar.waitForEvent(
      (event) => event.type === "session_closed",
      TURN_DEADLINE_MS,
      "the session to finish the command list",
    );
    watching = false;
    step(`session closed: reason=${closed.reason}`);

    // ---- every Gated command asked, exactly once, with its category --------------------------
    for (const { command, category } of gated) {
      const matching = requests.filter((r) => normalise(r.input?.command ?? "") === normalise(command));
      assert.equal(matching.length, 1, `expected exactly one request for \`${command}\`, saw ${matching.length}`);
      assert.equal(matching[0].destructiveCategory, category, `\`${command}\` must be gated as ${category}`);
    }
    step(`every Gated command raised exactly one request with its category (${gated.length})`);

    // ---- nothing else asked: the allowed commands and Claude Code's own startup checks ----------
    const expected = new Set(gated.map((g) => normalise(g.command)));
    const unexpected = requests.filter((r) => !expected.has(normalise(r.input?.command ?? "")));
    assert.deepEqual(
      unexpected.map((r) => r.input?.command),
      [],
      "no request may be raised for read-only git, Claude Code's startup checks, a rebase of the " +
        "Story's own branch, or rm -rf inside the worktree",
    );
    step("no request for any allowed command or startup check");

    // ---- nothing Gated ran ------------------------------------------------------------------
    assert.equal(harness.remoteRef(remotePath, DOOMED_BRANCH), before.doomed, "the remote branch was deleted");
    assert.equal(harness.remoteRef(remotePath, STORY_BRANCH), undefined, "the Story branch was pushed");
    assert.equal(revParse(workPath, OTHER_BRANCH), before.other, `${OTHER_BRANCH} was deleted or rewritten`);
    assert.ok(fs.existsSync(path.join(workPath, UNTRACKED_FILE)), "git clean -fd ran");
    assert.ok(fs.existsSync(path.join(outsideDir, "keep.txt")), "rm -rf outside the worktree ran");
    // `git rebase main` on the Story branch is a no-op here (main has not moved), so a changed HEAD
    // can only come from the denied `reset --hard`.
    assert.equal(revParse(workPath, "HEAD"), before.storyHead, "git reset --hard ran");
    step("no Gated command ran: remote, branches, untracked file, outside directory and HEAD unchanged");

    // ---- the allowed commands did run ---------------------------------------------------------
    assert.ok(!fs.existsSync(path.join(workPath, "build")), "rm -rf inside the worktree did not run");
    step("rm -rf inside the worktree ran without asking");

    const explanations = [
      ...sidecar.eventsOfType("tool_result").map((event) => `${JSON.stringify(event.output ?? "")} ${event.raw ?? ""}`),
      ...sidecar.eventsOfType("assistant_text").map((event) => event.text ?? ""),
    ];
    assert.ok(
      explanations.some((text) => /was declined/.test(text)),
      "the agent must be told a Gated command was declined, not handed a bare non-zero exit",
    );
    step("the agent was told each Gated command was declined");
  },
);
