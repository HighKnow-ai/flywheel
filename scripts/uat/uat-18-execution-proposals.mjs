#!/usr/bin/env node
/**
 * UAT 18 — a running Story files Proposals, offline and zero tokens (issue #160, Epic #62): "A running
 * Story files a Proposal with `propose`, capped at 3, withdrawable, answered at once."
 *
 * Drives the REAL sidecar (`packages/sidecar/dist/index.js`) and its REAL board MCP server, listed to a
 * Story session, with a scripted fake agent at the backend leaf (`packages/sidecar/test/fake-claude.mjs`,
 * its scripted board-call mode). The board's half runs through `uat_review_ops`
 * (packages/core/tests/bin), which calls the same core functions the desktop's Start, its board tool
 * router and `proposal_accept` wrap; this script relays each board tool call between the two, as
 * `sidecar.rs` and `commands/task.rs` do.
 *
 *   1. Start Story "Parser": its session starts on its Context packet, with `propose` and
 *      `proposal_withdraw` pre-approved.
 *   2. The agent files three Proposals (a New Story, an Amend Epic spec, a New Epic): each is answered
 *      at once.
 *   3. A fourth is refused, and the refusal names `proposal_withdraw`.
 *   4. The agent withdraws its third Proposal and files the fourth again: it is filed.
 *   5. No call was ever held: every one was answered as it arrived, and the session ran to its end.
 *   6. The Story's list holds three pending Proposals and the withdrawn one; the developer accepts the
 *      New Story and it is on the board, in Shaping.
 *
 * SCRATCH DATA ONLY: everything runs under one `mkdtemp` root (the harness's FLYWHEEL_APP_DATA_DIR and a
 * scratch FLYWHEEL_WORKTREE_ROOT), and the bridge refuses to run without it. Exit codes: 0 pass, 1 fail.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT, resolveHarnessBinary, runScript, step } from "./lib/sidecar-harness.mjs";

const FAKE_CLAUDE = path.join(REPO_ROOT, "packages", "sidecar", "test", "fake-claude.mjs");
const SESSION_TIMEOUT_MS = 30_000;

const WHY = "Found while working the Parser";
const EVIDENCE = "src/parser.rs:42 panics on an empty line";
const STORY_PACKET = String.raw`FLY-\d+ Parser \(Running\)`;

/** The scripted Story agent: three Proposals, a fourth that is refused, a withdrawal, and the fourth again. */
const AGENT_SCRIPT = [
  { when: STORY_PACKET, name: "propose", arguments: { kind: "new_story", title: "Empty-line recovery", description: "Recover from an empty line", why: WHY, evidence: EVIDENCE } },
  { when: STORY_PACKET, name: "propose", arguments: { kind: "amend_epic_spec", field: "scope", text: "The parser, and recovering from bad lines", why: WHY, evidence: EVIDENCE } },
  { when: STORY_PACKET, name: "propose", arguments: { kind: "new_epic", title: "Error recovery", problem: "One bad line stops the parse", why: WHY, evidence: EVIDENCE } },
  { when: STORY_PACKET, name: "propose", arguments: { kind: "new_story", title: "Line numbers in errors", why: WHY, evidence: EVIDENCE } },
  { when: STORY_PACKET, name: "proposal_withdraw", arguments: { proposal_id: "{{result:propose:proposal_id}}" } },
  { when: STORY_PACKET, name: "propose", arguments: { kind: "new_story", title: "Line numbers in errors", why: WHY, evidence: EVIDENCE } },
];

await runScript("uat-18", "UAT 18 — a running Story files Proposals, capped at 3, withdrawable, answered at once (zero tokens)", async (harness) => {
  const bin = resolveHarnessBinary("uat_review_ops");
  if (bin === undefined) {
    throw new Error(
      "HARNESS PRECONDITION FAILED: the uat_review_ops binary was not found under target/{debug,release} — " +
        "run `cargo build -p core --bin uat_review_ops --bin uat_session_env -p flywheel-shim` first",
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

  const { workPath } = harness.createRepoWithRemote();
  const seeded = ops("seed", workPath);
  const [parser] = seeded.stories;
  step(`seeded Epic "Parsing" with ${seeded.stories.map((s) => `${s.key} ${s.title}`).join(", ")}`);

  // ---- 1. Start the Story ---------------------------------------------------------------------
  const started = ops("start-story", parser.id);
  const { runId, ...spawn } = started.spawn;
  assert.match(spawn.prompt, new RegExp(STORY_PACKET), "the session starts on the Story's Context packet");
  for (const tool of ["propose", "proposal_withdraw"]) {
    assert.ok(spawn.allowedTools.includes(`mcp__flywheel-board__${tool}`), `${tool} is pre-approved: ${spawn.allowedTools}`);
  }
  step(`1. ${parser.key} started: its Story session runs with propose and proposal_withdraw pre-approved`);

  const sidecar = await harness.startSidecar({ env: { FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE } });
  const sessionEnv = {
    ...harness.sessionEnv(runId, "main", { story: { branch: started.branch, worktreePath: started.worktreePath } }),
    ...started.policyEnv,
    FLYWHEEL_FAKE_ECHO_ARGV: "1",
    FLYWHEEL_FAKE_BOARD_CALLS: JSON.stringify(AGENT_SCRIPT),
  };
  const cursor = sidecar.events.length;
  await sidecar.request({ ...spawn, runId, worktreePath: started.worktreePath, env: sessionEnv });

  // Relay every board call as it arrives. None is ever held: the core answers each at once.
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
    assert.notEqual(event.type, "permission_request", `a Proposal tool never waits on a permission card: ${JSON.stringify(event)}`);
    handled.add(event.requestId);
    const { answer } = ops("tool-call", runId, event.requestId, event.tool, JSON.stringify(event.args ?? {}));
    assert.ok(answer, `${event.tool} is answered at once, never held`);
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
  assert.ok(!printed.some((l) => l.type === "board_call_unresolved" || l.type === "board_call_skipped"), `every step ran: ${JSON.stringify(printed)}`);
  const results = printed.filter((l) => l.type === "board_call_result");
  assert.deepEqual(
    results.map((r) => [r.name, r.isError]),
    [
      ["propose", false],
      ["propose", false],
      ["propose", false],
      ["propose", true],
      ["proposal_withdraw", false],
      ["propose", false],
    ],
    JSON.stringify(results),
  );

  // ---- 2. Three filed, each answered at once ----------------------------------------------------
  const filed = results.slice(0, 3).map((r) => JSON.parse(r.text));
  assert.deepEqual(filed.map((a) => [a.kind, a.state, a.open]), [["new_story", "pending", 1], ["amend_epic_spec", "pending", 2], ["new_epic", "pending", 3]]);
  step("2. the agent filed a New Story, an Amend Epic spec and a New Epic; each was answered at once");

  // ---- 3. The fourth is refused, naming proposal_withdraw --------------------------------------
  assert.match(results[3].text, /proposal_withdraw/, "the refusal names the withdraw tool");
  step(`3. a fourth was refused: "${results[3].text.split(";")[0]}"`);

  // ---- 4. Withdraw one, file again --------------------------------------------------------------
  const withdrawn = JSON.parse(results[4].text);
  assert.deepEqual([withdrawn.proposal_id, withdrawn.state, withdrawn.open], [filed[2].proposal_id, "withdrawn", 2]);
  const again = JSON.parse(results[5].text);
  assert.deepEqual([again.kind, again.state, again.open], ["new_story", "pending", 3]);
  step("4. the agent withdrew its New Epic, which freed a slot, and filed the fourth again");
  step("5. no call was held: every one was answered as it arrived, and the session ran to its end");

  // ---- 6. The Story's list, and an accepted New Story -------------------------------------------
  const { proposals } = ops("story-proposals", parser.id);
  assert.deepEqual(proposals.map((p) => p.state), ["pending", "pending", "withdrawn", "pending"]);
  assert.ok(proposals.every((p) => p.evidence === EVIDENCE), "every Proposal keeps its evidence line");
  const { applied } = ops("accept", proposals[0].id);
  assert.match(applied, /^StoryCreated/, applied);
  step(`6. the Story lists ${proposals.length} Proposals; accepting the New Story created it in Shaping`);
});
