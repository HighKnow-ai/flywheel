#!/usr/bin/env node
/**
 * UAT 17 — Epic #60's exit test, offline and zero tokens (issue #134): "Cyril shapes a Milestone's exit
 * test, and confirming an Epic Done runs a Round that proposes a change or says the Roadmap still holds."
 *
 * Drives the REAL sidecar (`packages/sidecar/dist/index.js`) and its REAL board MCP server, with a
 * scripted fake agent at the backend leaf (`packages/sidecar/test/fake-claude.mjs`, its scripted
 * board-call mode). The agent reads the roadmap packet it was spawned with and answers it: a packet
 * whose trigger is Epic "Rounds" Done gets a proposed change (an Epic missing from its Milestone),
 * any other gets "Roadmap still holds". The board's half runs through `uat_roadmap_ops`
 * (packages/core/tests/bin), which calls the same core functions the desktop commands wrap; this
 * script relays each board tool call between the two, as `sidecar.rs` and the shaping router do.
 *
 *   A. Shape a Milestone's exit test: SKIPPED until #132 (Milestone exit-test shaping) merges, and the
 *      output says so. When it merges this step fails loudly rather than skipping silently.
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
import fs from "node:fs";
import path from "node:path";

import { REPO_ROOT, newRunId, resolveHarnessBinary, runScript, step } from "./lib/sidecar-harness.mjs";

const FAKE_CLAUDE = path.join(REPO_ROOT, "packages", "sidecar", "test", "fake-claude.mjs");
const ROUND_TIMEOUT_MS = 30_000;

/** #132 lands Milestone exit-test shaping; its desktop command is how this script knows. */
const MILESTONE_SHAPING_MERGED = fs.existsSync(path.join(REPO_ROOT, "packages", "desktop", "src-tauri", "src", "commands", "milestone_shaping.rs"))
  || spawnSync("git", ["grep", "-q", "fn milestone_shape", "--", "packages/desktop/src-tauri/src"], { cwd: REPO_ROOT }).status === 0;

/** The scripted agent. It reads its packet: an Epic "Rounds" confirmed Done means an Epic is missing
 * from its Milestone, so it proposes one and waits for the decision; any other trigger, it holds. */
const ROUNDS_DONE = String.raw`confirmed Epic FLY-1 "Rounds" Done`;
const AGENT_SCRIPT = [
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
    unless: ROUNDS_DONE,
    name: "roadmap_holds",
    arguments: { why: "The Milestone's exit test is still reachable and no Epic is missing." },
  },
];

await runScript("uat-17", "UAT 17 — confirming an Epic Done runs a roadmap Round (zero tokens)", async (harness) => {
  const bin = resolveHarnessBinary("uat_roadmap_ops");
  if (bin === undefined) {
    throw new Error(
      "HARNESS PRECONDITION FAILED: the uat_roadmap_ops binary was not found under target/{debug,release} — " +
        "run `cargo build -p core --bin uat_roadmap_ops --bin uat_session_env` first",
    );
  }
  const env = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir };
  const ops = (...args) => {
    const r = spawnSync(bin, args, { encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`uat_roadmap_ops ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1));
  };

  // ---- A. Shape a Milestone's exit test ----------------------------------------------------------
  if (MILESTONE_SHAPING_MERGED) {
    throw new Error(
      "#132 (Milestone exit-test shaping) has merged: extend step A to shape the Milestone's exit test " +
        "through it before confirming an Epic Done, then drop this guard",
    );
  }
  step("A. SKIPPED — shaping a Milestone's exit test waits for #132 (Milestone exit-test shaping), not merged yet");

  const { workPath } = harness.createRepoWithRemote();
  const seeded = ops("seed", workPath);
  const [rounds, strip] = seeded.epics;
  step(`seeded "Shaping" with ${rounds.key} ${rounds.title} and ${strip.key} ${strip.title}, every Story Merged`);

  const sidecar = await harness.startSidecar({ env: { FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE } });

  /** Spawn the Round's session as the desktop does, relay its board calls, accept what it proposes,
   * and return what its scripted agent printed once the session ends. */
  async function runRound(confirmed) {
    const { runId, ...spawn } = confirmed.spawn;
    const sessionEnv = {
      ...harness.sessionEnv(runId, "main"),
      ...confirmed.policyEnv,
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
        ROUND_TIMEOUT_MS,
        `roadmap session ${runId}'s next board call or its end`,
      );
      if (event.type === "session_closed") break;
      handled.add(event.requestId);
      const { answer } = ops("tool-call", runId, event.requestId, event.tool, JSON.stringify(event.args ?? {}));
      if (answer !== null) {
        await sidecar.request({ op: "board_tool_answer", runId, requestId: event.requestId, ...answer });
        continue;
      }
      // Held (`round_wait`): the developer decides every Proposal on the strip; the last decision
      // releases the call, answered with every decision, as the desktop's settle does.
      step(`   ${event.tool} is held: the Round is Waiting on you`);
      const view = ops("roadmap", seeded.projectId);
      let release = null;
      for (const p of view.round.proposals.filter((x) => x.state === "pending")) {
        step(`   the developer accepts "${p.summary}"`);
        release = ops("decide", p.id, "accept").release ?? release;
      }
      assert.ok(release, "accepting the Round's last Proposal releases the held round_wait");
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
    return { runId, prompt: spawn.prompt, printed };
  }

  // ---- B. Confirm Epic "Rounds" Done: the Round proposes a change -------------------------------
  const first = ops("confirm-epic", rounds.id);
  assert.equal(first.outcome, "opened", "confirming the Epic Done opens a roadmap Round");
  assert.match(first.spawn.prompt, /The developer confirmed Epic FLY-1 "Rounds" Done, in Milestone "Shaping"\./);
  assert.match(first.spawn.prompt, /This Round is short, and on one Milestone: "Shaping"/);
  assert.ok(first.spawn.allowedTools.includes("mcp__flywheel-board__propose_roadmap_change"), "the session may propose");
  step(`B. ${rounds.key} confirmed Done: roadmap Round ${first.round} opened, its packet names the trigger and the short scope`);

  const b = await runRound(first);
  const argv = b.printed.find((l) => l.type === "argv_seen")?.argv ?? [];
  assert.equal(argv[argv.indexOf("-p") + 1], first.spawn.prompt, "the agent was spawned on the roadmap packet");
  const proposed = b.printed.find((l) => l.type === "board_call_result" && l.name === "propose_roadmap_change");
  assert.ok(proposed && !proposed.isError, `the agent's proposal was filed: ${JSON.stringify(b.printed)}`);
  const waited = b.printed.find((l) => l.type === "board_call_result" && l.name === "round_wait");
  assert.ok(waited && !waited.isError, "the held round_wait was answered");
  const decisions = JSON.parse(waited.text).decisions;
  assert.deepEqual(decisions.map((d) => [d.change, d.state]), [['New Epic "Round history" in Milestone "Shaping"', "accepted"]]);
  assert.ok(b.printed.some((l) => l.type === "board_call_skipped" && l.name === "roadmap_holds"), "it did not also say it holds");

  let view = ops("roadmap", seeded.projectId);
  assert.equal(view.round.state, "closed");
  assert.match(view.round.ended, /Closed roadmap Round 1: 1 accepted, 0 rejected/);
  const shaping = view.milestones.find((m) => m.id === seeded.milestoneId);
  assert.ok(shaping.epics.some((e) => e.title === "Round history" && e.state === "shaping"), "the accepted Epic is on the board, in Shaping");
  step(`   the agent proposed "${decisions[0].change}", it was accepted, and Round 1 closed with it applied`);

  // ---- C. Confirm Epic "Roadmap strip" Done: the Round says the Roadmap holds -------------------
  const second = ops("confirm-epic", strip.id);
  assert.equal(second.outcome, "opened", "with Round 1 closed, a new Round opens");
  assert.equal(second.round, 2);
  assert.match(second.spawn.prompt, /The developer confirmed Epic FLY-3 "Roadmap strip" Done/);
  step(`C. ${strip.key} confirmed Done: roadmap Round 2 opened`);

  const c = await runRound(second);
  const held = c.printed.find((l) => l.type === "board_call_result" && l.name === "roadmap_holds");
  assert.ok(held && !held.isError, `the agent said the Roadmap holds: ${JSON.stringify(c.printed)}`);
  assert.ok(!c.printed.some((l) => l.type === "board_call_result" && l.name === "propose_roadmap_change"), "and proposed nothing");
  view = ops("roadmap", seeded.projectId);
  assert.deepEqual([view.round.number, view.round.state, view.round.ended, view.round.proposals.length], [2, "closed", "Roadmap still holds", 0]);
  step('   the agent said the Roadmap still holds, and Round 2 closed with "Roadmap still holds"');
});
