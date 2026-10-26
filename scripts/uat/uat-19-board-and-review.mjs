#!/usr/bin/env node
/**
 * UAT 19 — Milestone 4's exit test, offline and zero tokens (issue #169, Epics #61, #62 and #63): a Story
 * goes from Ready to Merged on the board, through Needs you, the triage drawer, a request for changes, the
 * Decisions section and Merge.
 *
 * Drives the REAL sidecar (`packages/sidecar/dist/index.js`) and its REAL board MCP server, listed to a
 * Story session, with a scripted fake agent at the backend leaf (`packages/sidecar/test/fake-claude.mjs`,
 * its scripted board-call mode with `commit` steps). The board's half runs through `uat_review_ops`
 * (packages/core/tests/bin), which calls the same core functions the desktop's commands wrap; this script
 * relays each board tool call between the two, as `sidecar.rs` and `commands/task.rs` do.
 *
 *   1. Start Story "Parser" (Ready, two criteria: one proven by a Check, one judged at review). Its agent
 *      writes its Tasks, commits the parser, files a New Story and an Amend criterion, commits an ADR,
 *      and hands off with the ADR's bar lines.
 *   2. Before the hand-off is answered, Needs you lists the Proposals row and the judged-on change; after
 *      it, the Review too.
 *   3. Triage: the developer rejects the New Story in the drawer and accepts the Amend criterion where it
 *      is drawn. Needs you keeps only the Review.
 *   4. The developer requests changes. A second session starts in the same worktree on a packet that
 *      carries the comments and the decided Proposals; it adds a Task for the review point, commits the
 *      fix, re-runs the Checks and hands off again.
 *   5. The review card: the Check passed at the new head and is pre-ticked; the amended criterion; the new
 *      ADR in the Decisions section with its hand-off bar lines, unflagged.
 *   6. The developer accepts both criteria, keeps the ADR and merges: the merge commit is on the base
 *      branch, the worktree is gone, the ADR is linked to the Story, and Needs you now lists Confirm exit
 *      test for the Epic, whose Stories are all Merged.
 *
 * SCRATCH DATA ONLY: everything runs under one `mkdtemp` root (the harness's FLYWHEEL_APP_DATA_DIR and a
 * scratch FLYWHEEL_WORKTREE_ROOT), and the bridge refuses to run without it. Exit codes: 0 pass, 1 fail.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT, git, resolveHarnessBinary, runScript, step } from "./lib/sidecar-harness.mjs";

const FAKE_CLAUDE = path.join(REPO_ROOT, "packages", "sidecar", "test", "fake-claude.mjs");
const SESSION_TIMEOUT_MS = 60_000;

/** Section 7 of a packet after a request for changes. */
const CHANGES_REQUESTED = "The developer requested changes at review";
const WHY = "Found while writing the parser";
const EVIDENCE = "src/parser.rs:3 returns on the first bad line";
const ADR_PATH = "docs/adr/0001-parse-into-a-tree.md";
const ADR_TEXT = [
  "# Parse into a tree, not a token stream",
  "",
  "Status: accepted",
  "",
  "The parser returns a tree whose nodes keep their line, so an error can name where it is.",
  "",
].join("\n");
const ADR_BAR_LINES = {
  path: ADR_PATH,
  hard_to_reverse: "Every caller walks the tree",
  surprising: "A line-oriented format parsed into a tree",
  losing_alternative: "A flat token stream",
  relates_to: "none",
};
const COMMENTS = "Name the column in a parse error, not only the line.";

/** The scripted Story agent: its first session works and hands off; after a request for changes, its
 * second session adds a Task for the review point, commits the fix, re-runs the Checks and hands off. */
const AGENT_SCRIPT = [
  // First session.
  { unless: CHANGES_REQUESTED, name: "task_add", arguments: { titles: ["Write the parser", "Record the tree decision as an ADR"] } },
  { unless: CHANGES_REQUESTED, name: "task_update", arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "doing" } },
  { unless: CHANGES_REQUESTED, commit: { path: "src/parser.rs", content: "// Parses a file into a tree.\npub fn parse(_src: &str) {}\n" } },
  { unless: CHANGES_REQUESTED, name: "task_update", arguments: { task_id: "{{result:task_add:tasks.0.task_id}}", state: "done", note: "src/parser.rs" } },
  {
    unless: CHANGES_REQUESTED,
    name: "propose",
    arguments: {
      kind: "new_story",
      title: "Recover from a bad line",
      criteria: [{ statement: "A bad line is skipped and the parse goes on", check: "cargo test recover" }],
      why: WHY,
      evidence: EVIDENCE,
    },
  },
  {
    unless: CHANGES_REQUESTED,
    name: "propose",
    arguments: {
      kind: "amend_criterion",
      criterion_id: String.raw`{{prompt:2\. A parse error names the line \[criterion_id: ([^\]]+)\]}}`,
      statement: "A parse error names its line",
      why: "The line is what the reader looks for",
      evidence: EVIDENCE,
    },
  },
  { unless: CHANGES_REQUESTED, name: "task_update", arguments: { task_id: "{{result:task_add:tasks.1.task_id}}", state: "doing" } },
  { unless: CHANGES_REQUESTED, commit: { path: ADR_PATH, content: ADR_TEXT } },
  { unless: CHANGES_REQUESTED, name: "task_update", arguments: { task_id: "{{result:task_add:tasks.1.task_id}}", state: "done" } },
  {
    unless: CHANGES_REQUESTED,
    name: "handoff",
    arguments: { next_session_must_know: "The parser is in; errors name the line.", decisions: "Parse into a tree (ADR 0001).", adrs: [ADR_BAR_LINES] },
  },
  // Second session, after the request for changes.
  { when: CHANGES_REQUESTED, name: "task_add", arguments: { titles: ["Name the column in a parse error"] } },
  { when: CHANGES_REQUESTED, name: "task_update", arguments: { task_id: "{{result:task_add:tasks.2.task_id}}", state: "doing" } },
  {
    when: CHANGES_REQUESTED,
    commit: { path: "src/parser.rs", content: "// Parses a file into a tree; an error names its line and column.\npub fn parse(_src: &str) {}\n" },
  },
  { when: CHANGES_REQUESTED, name: "task_update", arguments: { task_id: "{{result:task_add:tasks.2.task_id}}", state: "done" } },
  { when: CHANGES_REQUESTED, name: "checks_run", arguments: {} },
  {
    when: CHANGES_REQUESTED,
    name: "handoff",
    arguments: { next_session_must_know: "Errors name the line and the column.", decisions: "", adrs: [ADR_BAR_LINES] },
  },
];

await runScript("uat-19", "UAT 19 — a Story from Ready to Merged through Needs you, triage, review and Merge (zero tokens)", async (harness) => {
  const bin = resolveHarnessBinary("uat_review_ops");
  if (bin === undefined) {
    throw new Error(
      "HARNESS PRECONDITION FAILED: the uat_review_ops binary was not found under target/{debug,release} — " +
        "run `cargo build -p flywheel-core --bin uat_review_ops --bin uat_session_env -p flywheel-shim` first",
    );
  }
  const worktreeRoot = path.join(harness.root, "worktrees");
  fs.mkdirSync(worktreeRoot, { recursive: true });
  const env = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir, FLYWHEEL_WORKTREE_ROOT: worktreeRoot };
  const ops = (...args) => {
    const r = spawnSync(bin, args, { encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`uat_review_ops ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1));
  };
  const needsYou = () => ops("needs-you", projectId).items;
  const kinds = (items) => items.map((i) => i.kind);

  const { workPath } = harness.createRepoWithRemote();
  const seeded = ops("seed-review", workPath);
  const { projectId, epicId, epicKey, story } = seeded;
  assert.equal(story.state, "ready");
  step(`seeded Epic ${epicKey} "Parsing" with ${story.key} ${story.title}, Ready, with ${seeded.criteria.length} criteria`);

  const sidecar = await harness.startSidecar({ env: { FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE } });

  /**
   * Run one Story session to its end, relaying each board call as it arrives; `beforeAnswer(event)` runs
   * before a call is answered, so the script can read the board while the session waits. Returns what the
   * scripted agent printed.
   */
  async function runSession(started, beforeAnswer = () => {}) {
    const { runId, ...spawn } = started.spawn;
    const sessionEnv = {
      ...harness.sessionEnv(runId, "main", { story: { branch: started.branch, worktreePath: started.worktreePath } }),
      ...started.policyEnv,
      FLYWHEEL_FAKE_BOARD_CALLS: JSON.stringify(AGENT_SCRIPT),
    };
    const cursor = sidecar.events.length;
    await sidecar.request({ ...spawn, runId, worktreePath: started.worktreePath, env: sessionEnv });
    const handled = new Set();
    const mine = (e) => e.runId === undefined || e.runId === runId;
    for (;;) {
      const event = await sidecar.waitForEvent(
        (e) =>
          sidecar.events.indexOf(e) >= cursor &&
          mine(e) &&
          ((e.type === "board_tool_request" && !handled.has(e.requestId)) || e.type === "permission_request" || e.type === "session_closed"),
        SESSION_TIMEOUT_MS,
        `session ${runId}'s next board call or its end`,
      );
      if (event.type === "session_closed") break;
      assert.notEqual(event.type, "permission_request", `nothing in this walk waits on a permission card: ${JSON.stringify(event)}`);
      handled.add(event.requestId);
      await beforeAnswer(event);
      const { answer } = ops("tool-call", runId, event.requestId, event.tool, JSON.stringify(event.args ?? {}));
      await sidecar.request({ op: "board_tool_answer", runId, requestId: event.requestId, ...answer });
    }
    ops("session-closed", runId);
    const printed = sidecar.events
      .slice(cursor)
      .filter((e) => e.type === "unknown" && mine(e))
      .map((e) => {
        try {
          return JSON.parse(e.raw);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    assert.ok(
      !printed.some((l) => ["board_call_unresolved", "fake_commit_failed"].includes(l.type)),
      `every step ran: ${JSON.stringify(printed.filter((l) => l.type !== "board_call_skipped"))}`,
    );
    const failed = printed.filter((l) => l.type === "board_call_result" && l.isError);
    assert.deepEqual(failed, [], "no board call was refused");
    return printed;
  }

  // ---- 1. Start, work, file, commit, hand off ---------------------------------------------------
  const first = ops("start-story", story.id);
  assert.match(first.spawn.prompt, /None: this is the Story's first session\./);
  let duringSession = null;
  const printed1 = await runSession(first, (event) => {
    if (event.tool === "handoff") duringSession = needsYou();
  });
  const calls1 = printed1.filter((l) => l.type === "board_call_result").map((l) => l.name);
  assert.deepEqual(calls1, ["task_add", "task_update", "task_update", "propose", "propose", "task_update", "task_update", "handoff"]);
  const commits1 = printed1.filter((l) => l.type === "fake_commit").map((l) => l.path);
  assert.deepEqual(commits1, ["src/parser.rs", ADR_PATH], "both commits went through the session's PATH shim");
  const handoff1 = JSON.parse(printed1.filter((l) => l.type === "board_call_result").at(-1).text);
  assert.equal(handoff1.story_state, "in_review");
  assert.deepEqual(handoff1.checks.map((c) => c.result), ["passed"], "the Check ran at hand-off and passed");
  step(`1. ${story.key}'s session wrote 2 Tasks, committed the parser and an ADR, filed 2 Proposals and handed off`);

  // ---- 2. Needs you: the Proposals row and the judged-on change, then the Review ---------------
  assert.ok(duringSession, "Needs you was read while the hand-off waited");
  assert.deepEqual(kinds(duringSession), ["judged_on", "proposals"], JSON.stringify(duringSession));
  const judged = duringSession.find((i) => i.kind === "judged_on");
  assert.equal(judged.judgedOn.change, "amend_criterion");
  assert.equal(judged.judgedOn.before, "A parse error names the line");
  assert.equal(judged.judgedOn.after, "A parse error names its line");
  assert.equal(judged.judgedOn.filedBy, story.key);
  assert.equal(judged.judgedOn.duplicateOf, null);
  assert.deepEqual(duringSession.find((i) => i.kind === "proposals").proposals, { count: 1, stories: 1, epics: 1 });
  const afterHandoff = needsYou();
  // Review and a judged-on change share a rank and mix by age: the change was filed before the hand-off.
  assert.deepEqual(kinds(afterHandoff), ["judged_on", "review", "proposals"], JSON.stringify(afterHandoff));
  const reviewItem = afterHandoff.find((i) => i.kind === "review");
  assert.equal(reviewItem.record.key, story.key);
  assert.deepEqual(reviewItem.conflicts, [], "the branch merges cleanly: Review, not Rebase needed");
  step("2. Needs you listed the judged-on change and the Proposals row while the session ran, and the Review after its hand-off");

  // ---- 3. Triage ----------------------------------------------------------------------------------
  const { proposals: drawer } = ops("triage", projectId);
  assert.equal(drawer.length, 1, "the drawer holds the New Story; the judged-on change is its own item");
  assert.deepEqual([drawer[0].verb, drawer[0].targetType, drawer[0].payload.title, drawer[0].storyKey], ["create", "story", "Recover from a bad line", story.key]);
  ops("reject", drawer[0].id, "Out of this Epic: a separate Story for the next Milestone");
  const { applied } = ops("accept", judged.id);
  assert.match(applied, /^CriterionAmended/, applied);
  assert.deepEqual(kinds(needsYou()), ["review"], "decided, both leave Needs you");
  step("3. the developer rejected the New Story in the drawer and accepted the Amend criterion in Needs you");

  // ---- 4. Request changes; the second session works the review point -----------------------------
  let review = ops("review", story.id);
  assert.equal(review.decisions.length, 1, JSON.stringify(review.decisions));
  const second = ops("request-changes", story.id, COMMENTS);
  assert.equal(second.worktreePath, first.worktreePath, "the second session starts in the same worktree");
  assert.ok(second.spawn.prompt.includes(`${CHANGES_REQUESTED}:\n\n${COMMENTS}`), "section 7 carries the comments");
  assert.match(second.spawn.prompt, /Your Proposals decided since your last session:\n- .*Recover from a bad line/, "and the decided Proposals");
  assert.match(second.spawn.prompt, /\n2\. A parse error names its line \[criterion_id: /, "and the amended criterion");
  assert.deepEqual(kinds(needsYou()), [], "a Running Story with a live session waits on no one");
  const printed2 = await runSession(second);
  const calls2 = printed2.filter((l) => l.type === "board_call_result").map((l) => l.name);
  assert.deepEqual(calls2, ["task_add", "task_update", "task_update", "checks_run", "handoff"]);
  const rerun = JSON.parse(printed2.find((l) => l.type === "board_call_result" && l.name === "checks_run").text);
  assert.deepEqual([rerun.recorded, rerun.checks.map((c) => c.result)], [false, ["passed"]], "the feedback run records nothing");
  step("4. the developer requested changes; a second session in the same worktree added a Task, committed the fix, re-ran the Checks and handed off");

  // ---- 5. The review card -------------------------------------------------------------------------
  review = ops("review", story.id);
  assert.equal(review.storyState, "in_review");
  assert.deepEqual([review.open, review.liveSession, review.openTasks, review.failingChecks], [true, false, 0, 0]);
  assert.deepEqual(review.files.sort(), [ADR_PATH, "src/parser.rs"]);
  assert.deepEqual(
    review.criteria.map((c) => [c.statement, c.accepted, c.preTicked, c.check?.result ?? null]),
    [
      ["The parser lives in src/parser.rs", false, true, "passed"],
      ["A parse error names its line", false, false, null],
    ],
  );
  assert.deepEqual(review.decisions, [
    {
      kind: "adr",
      path: ADR_PATH,
      status: "A",
      flags: [],
      newAdr: { title: "Parse into a tree, not a token stream", barLinesFrom: "handoff", hardToReverse: ADR_BAR_LINES.hard_to_reverse, decision: "keep" },
    },
  ]);
  assert.deepEqual(kinds(needsYou()), ["review"]);
  step("5. the review card: the Check passed at the new head and is pre-ticked, the amended criterion, and the new ADR with its bar lines");

  // ---- 6. Accept, Keep, Merge -------------------------------------------------------------------------
  for (const c of review.criteria) ops("accept-criterion", c.id);
  ops("adr-decide", story.id, ADR_PATH, "keep");
  const merged = ops("merge", story.id);
  assert.deepEqual([merged.storyState, merged.baseBranch, merged.cleanupWarning, merged.adrsLinked], ["merged", "main", null, [ADR_PATH]]);
  const mainHead = git(workPath, ["rev-parse", "main"]).stdout.trim();
  assert.equal(mainHead, merged.mergeCommit, "the merge commit is the base branch's head");
  const parents = git(workPath, ["rev-list", "--parents", "-n", "1", mainHead]).stdout.trim().split(" ");
  assert.equal(parents.length, 3, "a two-parent merge commit");
  assert.ok(fs.existsSync(path.join(workPath, ADR_PATH)), "the ADR is on the base branch");
  assert.ok(!fs.existsSync(first.worktreePath), "the worktree is gone");
  const branches = git(workPath, ["branch", "--list", first.branch]).stdout.trim();
  assert.equal(branches, "", "and its branch, contained in main, is deleted");
  const { links } = ops("adr-links", projectId);
  assert.deepEqual(links, [{ path: ADR_PATH, kind: "story", id: story.id }], "the ADR is linked to the Story");
  const after = needsYou();
  assert.deepEqual(kinds(after), ["confirm_exit_test"], JSON.stringify(after));
  assert.deepEqual([after[0].record.id, after[0].exitTest], [epicId, "A file with a bad line parses, and the error names the line"]);
  step(`6. accepted both criteria, kept the ADR and merged (${merged.method}): ${merged.mergeCommit.slice(0, 12)} is on main, the worktree is gone, the ADR is linked, and Needs you lists Confirm exit test for ${epicKey}`);
});
