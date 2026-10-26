#!/usr/bin/env node
/**
 * UAT 17 — Epic #60's exit test, offline and zero tokens (issue #134): "Cyril shapes a Milestone's exit
 * test, and confirming an Epic Done runs a Round that proposes a change or says the Roadmap still holds."
 *
 * Drives the REAL sidecar (`packages/sidecar/dist/index.js`) and its REAL board MCP server, with a
 * scripted fake agent at the backend leaf (`packages/sidecar/test/fake-claude.mjs`, its scripted
 * board-call mode). The agent reads the packet it was spawned with and answers it: a Milestone's shaping
 * packet gets a Round and a sharper exit test; a roadmap packet whose trigger is Epic "Rounds" Done gets
 * a proposed change (an Epic missing from its Milestone); any other roadmap packet gets "Roadmap still
 * holds". The board's half runs through `uat_roadmap_ops` (packages/core/tests/bin), which calls the
 * same core functions the desktop commands wrap; this script relays each board tool call between the
 * two, as `sidecar.rs` and the shaping router do, and plays the developer's clicks.
 *
 *   A. Shape the Milestone's exit test (#132): its shaping session posts a Round; the developer accepts
 *      every recommendation; the agent proposes a new exit test; the developer accepts it and closes the
 *      Exit test Stage, so the Milestone is Ready with the new exit test.
 *   B. Confirm Epic FLY-1 Done: one short Round opens on its Milestone, its session starts, the packet
 *      names the trigger and the short scope; the agent proposes a new Epic and waits; the developer
 *      accepts it; the held call is answered and the Round closes with the change applied.
 *   C. Confirm Epic FLY-3 Done: a second Round opens; the agent says the Roadmap still holds, and the
 *      Round closes with that line.
 *
 * SCRATCH DATA ONLY: everything runs under one `mkdtemp` root (the harness's FLYWHEEL_APP_DATA_DIR), and
 * the bridge refuses to run without it. Exit codes: 0 pass, 1 fail.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

import { REPO_ROOT, resolveHarnessBinary, runScript, step } from "./lib/sidecar-harness.mjs";

const FAKE_CLAUDE = path.join(REPO_ROOT, "packages", "sidecar", "test", "fake-claude.mjs");
const SESSION_TIMEOUT_MS = 30_000;

const SHARPER_EXIT_TEST = "Cyril takes a one-line idea to Ready Stories in Flywheel, and a roadmap Round answers each Epic he confirms Done.";

/** The scripted agent. It reads its packet and answers it, one step list for every session. */
const MILESTONE_PACKET = String.raw`^# Shaping packet: Milestone `;
const ROADMAP_PACKET = String.raw`^# Roadmap packet: `;
const ROUNDS_DONE = String.raw`confirmed Epic FLY-1 "Rounds" Done`;
const AGENT_SCRIPT = [
  // A Milestone's exit test: challenge it in a Round, then propose the sharper text.
  {
    when: MILESTONE_PACKET,
    name: "round_post",
    arguments: {
      note: "This Round settles what the exit test observes.",
      questions: [
        {
          title: "Observable",
          question: "Should the exit test name the roadmap Round an Epic's Done starts?",
          grounding: "Read the Milestone's exit test in the packet",
          recommended_answer: "Yes",
          because: "Epic #60 makes the Round part of what the Milestone delivers",
        },
      ],
    },
  },
  { when: MILESTONE_PACKET, name: "propose_exit_test", arguments: { text: SHARPER_EXIT_TEST, why: "Round 1 settled it" } },
  // A roadmap Round: an Epic missing after Rounds is Done, else the Roadmap holds.
  {
    when: ROUNDS_DONE,
    name: "propose_roadmap_change",
    arguments: {
      change: "add_epic",
      milestone_id: String.raw`{{prompt:Milestone "Shaping" \([^)]*\) \[milestone_id: ([0-9A-Z]+)\]}}`,
      title: "Round history",
      problem: "Answered Rounds cannot be read back once the Epic is Done.",
      why: "Rounds is Done, and its exit test left the history of answered Rounds out of every Epic.",
    },
  },
  { when: ROUNDS_DONE, name: "round_wait", arguments: {} },
  {
    when: ROADMAP_PACKET,
    unless: ROUNDS_DONE,
    name: "roadmap_holds",
    arguments: { why: "The Milestone's exit test is still reachable and no Epic is missing." },
  },
];

await runScript("uat-17", "UAT 17 — shape a Milestone's exit test; confirming an Epic Done runs a roadmap Round (zero tokens)", async (harness) => {
  const bin = resolveHarnessBinary("uat_roadmap_ops");
  if (bin === undefined) {
    throw new Error(
      "HARNESS PRECONDITION FAILED: the uat_roadmap_ops binary was not found under target/{debug,release} — " +
        "run `cargo build -p flywheel-core --bin uat_roadmap_ops --bin uat_session_env` first",
    );
  }
  const env = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir };
  const ops = (...args) => {
    const r = spawnSync(bin, args, { encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`uat_roadmap_ops ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1));
  };

  const { workPath } = harness.createRepoWithRemote();
  const seeded = ops("seed", workPath);
  const [rounds, strip] = seeded.epics;
  step(`seeded Milestone "Shaping", in Shaping, with ${rounds.key} ${rounds.title} and ${strip.key} ${strip.title}, every Story Merged`);

  const sidecar = await harness.startSidecar({ env: { FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE } });

  /**
   * Spawn a shaping session as the desktop does and relay its board calls until it ends. A held call is
   * handed to `onHeld(event)`, which plays the developer and returns the release that answers it.
   * Returns what the scripted agent printed.
   */
  async function runSession(launched, onHeld) {
    const { runId, ...spawn } = launched.spawn;
    const sessionEnv = {
      ...harness.sessionEnv(runId, "main"),
      ...launched.policyEnv,
      FLYWHEEL_FAKE_ECHO_ARGV: "1",
      FLYWHEEL_FAKE_BOARD_CALLS: JSON.stringify(AGENT_SCRIPT),
    };
    const cursor = sidecar.events.length;
    await sidecar.request({ ...spawn, runId, worktreePath: workPath, env: sessionEnv });

    const handled = new Set();
    const mine = (e) => e.runId === undefined || e.runId === runId;
    for (;;) {
      const event = await sidecar.waitForEvent(
        (e) =>
          sidecar.events.indexOf(e) >= cursor &&
          mine(e) &&
          ((e.type === "board_tool_request" && !handled.has(e.requestId)) || e.type === "session_closed"),
        SESSION_TIMEOUT_MS,
        `session ${runId}'s next board call or its end`,
      );
      if (event.type === "session_closed") break;
      handled.add(event.requestId);
      const { answer } = ops("tool-call", runId, event.requestId, event.tool, JSON.stringify(event.args ?? {}));
      if (answer !== null) {
        await sidecar.request({ op: "board_tool_answer", runId, requestId: event.requestId, ...answer });
        continue;
      }
      step(`   ${event.tool} is held: Waiting on you`);
      const release = onHeld(event);
      assert.ok(release, `the developer's answer releases the held ${event.tool}`);
      assert.equal(release.requestId, event.requestId);
      await sidecar.request({ op: "board_tool_answer", runId, requestId: release.requestId, ...release.answer });
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
    const argv = printed.find((l) => l.type === "argv_seen")?.argv ?? [];
    assert.equal(argv[argv.indexOf("-p") + 1], spawn.prompt, "the agent was spawned on its packet");
    assert.ok(!printed.some((l) => l.type === "board_call_unresolved"), `every step resolved: ${JSON.stringify(printed)}`);
    return printed;
  }
  const called = (printed, name) => printed.find((l) => l.type === "board_call_result" && l.name === name);

  // ---- A. Shape the Milestone's exit test ----------------------------------------------------------
  const shaping = ops("shape-milestone", seeded.milestoneId);
  assert.match(shaping.spawn.prompt, /^# Shaping packet: Milestone Shaping/);
  step('A. Shape on Milestone "Shaping": its shaping session starts on the Milestone\'s shaping packet');
  const a = await runSession(shaping, (event) => {
    assert.equal(event.tool, "round_post", "a Milestone's session is held only on its Round");
    const answered = ops("answer-round", seeded.milestoneId);
    step(`   the developer accepts every recommendation in Round ${answered.round}`);
    return answered.release;
  });
  const posted = called(a, "round_post");
  assert.ok(posted && !posted.isError, `the Round was posted and answered: ${JSON.stringify(a)}`);
  const proposedText = called(a, "propose_exit_test");
  assert.ok(proposedText && !proposedText.isError, `the agent proposed an exit test: ${JSON.stringify(a)}`);
  let milestone = ops("milestone", seeded.milestoneId);
  assert.equal(milestone.pending.length, 1, "one exit-test change waits on the developer");
  assert.deepEqual(milestone.pending[0].payload, { title: null, exit_test: SHARPER_EXIT_TEST });
  ops("decide", milestone.pending[0].id, "accept");
  ops("close-exit-test", seeded.milestoneId);
  milestone = ops("milestone", seeded.milestoneId);
  assert.deepEqual([milestone.state, milestone.exitTest], ["ready", SHARPER_EXIT_TEST]);
  step("   the developer accepts the new exit test and closes Exit test: the Milestone is Ready with it");

  // ---- B. Confirm Epic "Rounds" Done: the Round proposes a change -------------------------------
  const first = ops("confirm-epic", rounds.id);
  assert.equal(first.outcome, "opened", "confirming the Epic Done opens a roadmap Round");
  assert.match(first.spawn.prompt, /The developer confirmed Epic FLY-1 "Rounds" Done, in Milestone "Shaping"\./);
  assert.match(first.spawn.prompt, /This Round is short, and on one Milestone: "Shaping"/);
  assert.ok(first.spawn.prompt.includes(`Exit test: ${SHARPER_EXIT_TEST}`), "the Round reads the exit test shaped in A");
  assert.ok(first.spawn.allowedTools.includes("mcp__flywheel-board__propose_roadmap_change"), "the session may propose");
  step(`B. ${rounds.key} confirmed Done: roadmap Round ${first.round} opened, its packet names the trigger and the short scope`);

  const b = await runSession(first, (event) => {
    assert.equal(event.tool, "round_wait");
    const view = ops("roadmap", seeded.projectId);
    let release = null;
    for (const p of view.round.proposals.filter((x) => x.state === "pending")) {
      step(`   the developer accepts "${p.summary}"`);
      release = ops("decide", p.id, "accept").release ?? release;
    }
    return release;
  });
  const proposed = called(b, "propose_roadmap_change");
  assert.ok(proposed && !proposed.isError, `the agent's proposal was filed: ${JSON.stringify(b)}`);
  const waited = called(b, "round_wait");
  assert.ok(waited && !waited.isError, "the held round_wait was answered");
  const decisions = JSON.parse(waited.text).decisions;
  assert.deepEqual(decisions.map((d) => [d.change, d.state]), [['New Epic "Round history" in Milestone "Shaping"', "accepted"]]);
  assert.ok(!called(b, "roadmap_holds"), "it did not also say it holds");

  let view = ops("roadmap", seeded.projectId);
  assert.equal(view.round.state, "closed");
  assert.match(view.round.ended, /Closed roadmap Round 1: 1 accepted, 0 rejected/);
  const shaped = view.milestones.find((m) => m.id === seeded.milestoneId);
  assert.ok(shaped.epics.some((e) => e.title === "Round history" && e.state === "shaping"), "the accepted Epic is on the board, in Shaping");
  step(`   the agent proposed "${decisions[0].change}", it was accepted, and Round 1 closed with it applied`);

  // ---- C. Confirm Epic "Roadmap strip" Done: the Round says the Roadmap holds -------------------
  const second = ops("confirm-epic", strip.id);
  assert.equal(second.outcome, "opened", "with Round 1 closed, a new Round opens");
  assert.equal(second.round, 2);
  assert.match(second.spawn.prompt, /The developer confirmed Epic FLY-3 "Roadmap strip" Done/);
  step(`C. ${strip.key} confirmed Done: roadmap Round 2 opened`);

  const c = await runSession(second, (event) => assert.fail(`nothing holds a Round that holds: ${event.tool}`));
  const held = called(c, "roadmap_holds");
  assert.ok(held && !held.isError, `the agent said the Roadmap holds: ${JSON.stringify(c)}`);
  assert.ok(!called(c, "propose_roadmap_change"), "and proposed nothing");
  view = ops("roadmap", seeded.projectId);
  assert.deepEqual([view.round.number, view.round.state, view.round.ended, view.round.proposals.length], [2, "closed", "Roadmap still holds", 0]);
  step('   the agent said the Roadmap still holds, and Round 2 closed with "Roadmap still holds"');
});
