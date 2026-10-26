#!/usr/bin/env node
/**
 * UAT 16 — Epic #59's exit test, offline and zero tokens (issue #130): "A one-line idea becomes an Epic
 * with Ready Stories, each with accepted criteria and Checks, entirely in Flywheel; a killed shaping
 * session resumes at the open Round."
 *
 * Drives the REAL sidecar (`packages/sidecar/dist/index.js`) and its REAL board MCP server, with a
 * scripted fake agent at the backend leaf (`packages/sidecar/test/fake-claude.mjs`, its scripted
 * board-call mode). The agent reads the shaping packet it was spawned with and answers the Stage the
 * packet names. The board's half runs through `uat_shaping_ops` (packages/core/tests/bin), which calls
 * the same core functions the desktop commands wrap; this script relays each board tool call between
 * the two, as `sidecar.rs` and the shaping router do, and plays the developer's clicks.
 *
 *   A. Challenge the spec. Shape starts a session; the agent posts Round 1: two questions and an ADR.
 *      The developer writes their own answer to one and presses Accept all recommended, which answers
 *      the other and leaves the ADR open, so the Round stays held.
 *   B. The session is killed mid-Round. The answers stay on the board; Continue shaping starts a fresh
 *      session whose packet carries the open Round with them and says to call `round_wait`, which takes
 *      the Round over. The developer answers the ADR Yes; the held call is answered with all three
 *      answers. The agent proposes the Epic's problem and exit test; the developer accepts both and
 *      closes Challenge the spec.
 *   C. Slice into Stories. The next session proposes two Stories, the second running after the first
 *      by the first one's proposal_id; the developer accepts both and closes the Stage.
 *   D. Write the Acceptance criteria. The next session proposes one criterion with a Check per Story;
 *      the developer accepts them and closes the Stage: the Epic and both Stories are Ready, each Story
 *      with its criterion and Check. The first Story's packet carries the accepted ADR to write verbatim, and
 *      the second Story's names it and the Story that writes it.
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

const ADR_PATH = "docs/adr/0001-live-verbs-come-from-the-tool-name.md";
const ADR_TEXT = "# Live verbs come from the tool name\n\nA feed row's live verb is derived from the tool being called, never from the model's prose.\n";
const PROBLEM = "A feed row says what a tool did, never what the agent is doing now.";
const EXIT_TEST = "A running tool call reads as its live verb in the feed.";
const OWN_ANSWER = "Only the developer watching the fleet";
const STORIES = [
  { title: "Live verbs for board tools", description: "Each board tool reads as a live verb; tested in tool-verbs." },
  { title: "The feed row shows the live verb", description: "The row swaps to the live verb while the call runs; tested in feed-row." },
];

/** The scripted agent: each step runs only in the session whose packet matches its `when`. */
const CHALLENGE_FIRST = String.raw`Then post the first Round of the Challenge the spec Stage with \x60round_post\x60`;
const CHALLENGE_OPEN = String.raw`Round 1 of the Challenge the spec Stage is still open`;
const SLICE = String.raw`This session works the second Stage, Slice into Stories`;
const CRITERIA = String.raw`This session works the third Stage, Write the Acceptance criteria`;
const AGENT_SCRIPT = [
  {
    when: CHALLENGE_FIRST,
    name: "round_post",
    arguments: {
      note: "This Round settles who reads the live verb and where the verb comes from.",
      questions: [
        {
          title: "Where the verb shows",
          question: "Should the live verb replace the row's past-tense summary while the call runs?",
          grounding: "Read the Epic's one line",
          recommended_answer: "Yes, only while the call runs",
          because: "The finished row keeps saying what the tool did",
        },
        {
          title: "Who reads it",
          question: "Is the reader every viewer of the feed?",
          grounding: "Read the Epic's one line",
          recommended_answer: "Yes, every viewer",
          because: "The feed has one audience",
        },
        {
          title: "Record where verbs come from",
          question: "Record \"live verbs come from the tool name\" as ADR 0001?",
          grounding: "No ADR in docs/adr/ says where a feed row's words come from",
          recommended_answer: "Yes",
          because: "Every later tool's row follows it",
          kind: "adr",
          adr: {
            path: ADR_PATH,
            text: ADR_TEXT,
            hard_to_reverse: "Every tool's row reads its verb from this rule",
            surprising: "A reader expects the model to describe its own action",
            losing_alternative: "Asking the model for a verb on each call",
          },
        },
      ],
    },
  },
  // The resumed session waits on the open Round, then proposes the spec it settled.
  { when: CHALLENGE_OPEN, name: "round_wait", arguments: {} },
  { when: CHALLENGE_OPEN, name: "propose_spec_change", arguments: { field: "problem", text: PROBLEM, why: "Round 1 settled the reader" } },
  { when: CHALLENGE_OPEN, name: "propose_spec_change", arguments: { field: "exit_test", text: EXIT_TEST, why: "Round 1 settled when it shows" } },
  // Slicing: the second Story runs after the first, named by the first one's proposal_id.
  { when: SLICE, name: "propose_story", arguments: STORIES[0] },
  {
    when: SLICE,
    name: "propose_story",
    arguments: { ...STORIES[1], runs_after: "{{result:propose_story:proposal_id}}", runs_after_reason: "reads its verbs" },
  },
  // Criteria: one with a Check per Story, the Story named by the key its packet shows.
  {
    when: CRITERIA,
    name: "propose_criterion",
    arguments: { story: String.raw`{{prompt:\n- ([A-Z]+-\d+) Live verbs for board tools}}`, statement: "Every board tool has a live verb", check: "npm test -- tool-verbs" },
  },
  {
    when: CRITERIA,
    name: "propose_criterion",
    arguments: { story: String.raw`{{prompt:\n- ([A-Z]+-\d+) The feed row shows}}`, statement: "A running call's row reads its live verb", check: "npm test -- feed-row" },
  },
];

await runScript("uat-16", "UAT 16 — a one-line Epic shaped to Ready Stories, through a killed session (zero tokens)", async (harness) => {
  const bin = resolveHarnessBinary("uat_shaping_ops");
  if (bin === undefined) {
    throw new Error(
      "HARNESS PRECONDITION FAILED: the uat_shaping_ops binary was not found under target/{debug,release} — " +
        "run `cargo build -p flywheel-core --bin uat_shaping_ops --bin uat_session_env` first",
    );
  }
  const env = { ...process.env, FLYWHEEL_APP_DATA_DIR: harness.appDataDir };
  const ops = (...args) => {
    const r = spawnSync(bin, args, { encoding: "utf8", env });
    if (r.status !== 0) throw new Error(`uat_shaping_ops ${args[0]} failed (${r.status}): ${r.stderr.trim()}`);
    return JSON.parse(r.stdout.trim().split("\n").at(-1));
  };

  const { workPath } = harness.createRepoWithRemote();
  const seeded = ops("seed", workPath);
  const epicId = seeded.epicId;
  const epic = () => ops("epic", epicId);
  step(`seeded Epic ${seeded.epicKey} "${seeded.title}": a one-line idea, nothing else written`);

  const sidecar = await harness.startSidecar({ env: { FLYWHEEL_CLAUDE_BIN: FAKE_CLAUDE } });

  /**
   * Spawn a shaping session as the desktop does and relay its board calls until it ends. A held call is
   * handed to `onHeld(event)`, which plays the developer and returns the release that answers it, or
   * `"kill"` to kill the session there. The sidecar's `session_closed` is applied as the desktop
   * applies it. Returns what the scripted agent printed and the `session_closed` event.
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
    let closed;
    for (;;) {
      const event = await sidecar.waitForEvent(
        (e) =>
          sidecar.events.indexOf(e) >= cursor &&
          mine(e) &&
          ((e.type === "board_tool_request" && !handled.has(e.requestId)) || e.type === "session_closed"),
        SESSION_TIMEOUT_MS,
        `session ${runId}'s next board call or its end`,
      );
      if (event.type === "session_closed") {
        closed = event;
        break;
      }
      handled.add(event.requestId);
      const { answer } = ops("tool-call", runId, event.requestId, event.tool, JSON.stringify(event.args ?? {}));
      if (answer !== null) {
        await sidecar.request({ op: "board_tool_answer", runId, requestId: event.requestId, ...answer });
        continue;
      }
      step(`   ${event.tool} is held: Waiting on you`);
      const release = onHeld(event);
      if (release === "kill") {
        await sidecar.request({ op: "kill", runId });
        continue;
      }
      assert.ok(release, `the developer's answer releases the held ${event.tool}`);
      assert.equal(release.requestId, event.requestId);
      await sidecar.request({ op: "board_tool_answer", runId, requestId: release.requestId, ...release.answer });
    }
    ops("session-closed", JSON.stringify(closed));

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
    return { printed, closed };
  }
  const calls = (printed, name) => printed.filter((l) => l.type === "board_call_result" && l.name === name);
  const assertAllAnswered = (printed, names) => {
    for (const name of names) {
      const made = calls(printed, name);
      assert.ok(made.length > 0 && made.every((c) => !c.isError), `${name} was called and answered without error: ${JSON.stringify(printed)}`);
    }
  };
  const acceptPending = (targetType) => {
    const pending = epic().proposals.filter((p) => p.state === "pending" && p.targetType === targetType);
    for (const p of pending) ops("decide", p.id);
    return pending;
  };

  // ---- A. Challenge the spec: Round 1, answered in part ---------------------------------------------
  const shaping = ops("shape", epicId);
  assert.match(shaping.spawn.prompt, new RegExp(`^# Shaping packet: Epic ${seeded.epicKey} `));
  assert.match(shaping.spawn.prompt, new RegExp(CHALLENGE_FIRST));
  step("A. Shape: a shaping session starts on the Epic's packet, which says to post the first Round of Challenge the spec");

  const a = await runSession(shaping, (event) => {
    assert.equal(event.tool, "round_post", "the first session is held on its Round");
    const round = epic().rounds[0];
    assert.deepEqual(round.questions.map((q) => q.kind), ["question", "question", "adr"]);
    assert.ok(round.waitingOnYou, "the Round is Waiting on you");
    const own = ops("answer", round.questions[1].id, "own", OWN_ANSWER);
    assert.equal(own.release, null, "one answer does not release the Round");
    const all = ops("accept-all", round.id);
    assert.equal(all.release, null, "Accept all leaves the ADR question open, so the Round stays held");
    step(`   the developer writes "${OWN_ANSWER}" for question 2 and presses Accept all recommended: question 1 answered, the ADR left open`);
    step("   the session is killed mid-Round");
    return "kill";
  });
  assert.equal(calls(a.printed, "round_post").length, 0, "the killed session's round_post was never answered");

  // ---- B. The killed session's Round survives; Continue shaping resumes it --------------------------
  let view = epic();
  assert.equal(view.liveSession, null, "no shaping session is live after the kill");
  let round = view.rounds[0];
  assert.equal(round.state, "open");
  assert.equal(round.waitingOnYou, false, "no live session is held on the Round");
  assert.deepEqual(
    round.questions.map((q) => [q.answer, q.answeredWith]),
    [["Yes, only while the call runs", "recommended"], [OWN_ANSWER, "own"], [null, null]],
    "the answers given before the kill are on the board",
  );
  step(`B. after the kill (${a.closed.reason}): no live session, Round 1 open with 2 of 3 answers kept`);

  const resumed = ops("continue", epicId);
  for (const line of [
    "#### Round 1 (open, 2 of 3 answered)",
    "Answer (your recommendation, accepted): Yes, only while the call runs",
    `Answer (the developer's own words): ${OWN_ANSWER}`,
    "Answer: not answered yet",
    "Then call `round_wait`",
  ]) {
    assert.ok(resumed.spawn.prompt.includes(line), `the resumed packet carries ${JSON.stringify(line)}`);
  }
  step("   Continue shaping: the fresh packet carries the open Round with both answers and says to call round_wait");

  const b = await runSession(resumed, (event) => {
    assert.equal(event.tool, "round_wait", "the resumed session waits on the open Round");
    const taken = epic().rounds[0];
    assert.equal(taken.sessionId, resumed.spawn.runId, "round_wait took the Round over");
    assert.ok(taken.waitingOnYou, "the Round is Waiting on you again");
    const yes = ops("answer", taken.questions[2].id, "own", "Yes");
    step("   the developer answers the ADR question Yes: the Round is complete");
    return yes.release;
  });
  assertAllAnswered(b.printed, ["round_wait", "propose_spec_change"]);
  const waited = JSON.parse(calls(b.printed, "round_wait")[0].text);
  assert.deepEqual(
    waited.answers.map((x) => x.answer),
    ["Yes, only while the call runs", OWN_ANSWER, "Yes"],
    "round_wait is answered with every answer, the ones given before the kill too",
  );
  assert.ok(!calls(b.printed, "round_post").length, "the resumed session did not post the Round again");
  step("   round_wait was answered with all three answers; the agent proposed the problem and the exit test");

  view = epic();
  const adr = view.proposals.find((p) => p.targetType === "adr");
  assert.ok(adr && adr.state === "accepted", "the ADR's Yes filed an accepted ADR Proposal on the Epic");
  assert.equal(view.rounds[0].questions[2].adrProposalId, adr.id);
  const specs = acceptPending("epic");
  assert.equal(specs.length, 2, "two spec changes wait on the developer");
  view = epic();
  assert.deepEqual([view.spec.problem, view.spec.exitTest], [PROBLEM, EXIT_TEST]);
  assert.equal(view.open.closable, true, `nothing is left open in Challenge the spec: ${JSON.stringify(view.open)}`);
  const challenge = ops("close-stage", epicId);
  assert.deepEqual([challenge.closed, challenge.opened, challenge.endedSession], ["challenge_spec", "slice", null]);
  assert.ok(challenge.next, "closing the Stage starts the next Stage's session");
  step("   the developer accepts both spec changes and closes Challenge the spec: Slice into Stories opens");

  // ---- C. Slice into Stories ----------------------------------------------------------------------
  assert.match(challenge.next.spawn.prompt, new RegExp(SLICE));
  const c = await runSession(challenge.next, (event) => assert.fail(`nothing holds a slicing session that posts no Round: ${event.tool}`));
  assertAllAnswered(c.printed, ["propose_story"]);
  assert.equal(calls(c.printed, "propose_story").length, 2);
  const storyProposals = acceptPending("story");
  assert.equal(storyProposals.length, 2, "two New Stories wait on the developer");
  view = epic();
  assert.deepEqual(
    view.stories.map((s) => [s.title, s.state]),
    STORIES.map((s) => [s.title, "shaping"]),
  );
  assert.deepEqual([view.stories[1].runsAfter, view.stories[1].runsAfterReason], [view.stories[0].key, "reads its verbs"]);
  const slice = ops("close-stage", epicId);
  assert.deepEqual([slice.closed, slice.opened], ["slice", "criteria"]);
  step(`C. the agent proposed two Stories, ${view.stories[1].key} running after ${view.stories[0].key}; accepted, and Slice closed`);

  // ---- D. Write the Acceptance criteria -----------------------------------------------------------
  assert.match(slice.next.spawn.prompt, new RegExp(CRITERIA));
  const d = await runSession(slice.next, (event) => assert.fail(`nothing holds a criteria session that posts no Round: ${event.tool}`));
  assertAllAnswered(d.printed, ["propose_criterion"]);
  assert.equal(acceptPending("criterion").length, 2, "one criterion per Story waits on the developer");
  const criteria = ops("close-stage", epicId);
  assert.deepEqual([criteria.closed, criteria.opened, criteria.next], ["criteria", null, null], "the last Stage starts no session");
  assert.equal(criteria.madeReady.length, 2);
  step("D. the agent proposed a criterion with a Check per Story; accepted, and Write the Acceptance criteria closed");

  // ---- The exit test --------------------------------------------------------------------------------
  view = epic();
  assert.equal(view.state, "ready", "the Epic is Ready");
  assert.deepEqual(view.stages.map((s) => [s.kind, s.state]), [["challenge_spec", "closed"], ["slice", "closed"], ["criteria", "closed"]]);
  assert.equal(view.open, null, "no Stage is left open");
  assert.equal(view.liveSession, null);
  const checks = { [STORIES[0].title]: "npm test -- tool-verbs", [STORIES[1].title]: "npm test -- feed-row" };
  for (const s of view.stories) {
    assert.equal(s.state, "ready", `${s.key} is Ready`);
    assert.equal(s.criteria.length, 1, `${s.key} has its criterion`);
    assert.deepEqual([s.criteria[0].check, s.criteria[0].timeoutSecs], [checks[s.title], 600], `${s.key}'s criterion has its Check`);
  }
  step(`   ${seeded.epicKey} is Ready, with ${view.stories.map((s) => `${s.key} Ready (Check \`${s.criteria[0].check}\`)`).join(" and ")}`);

  const packet = ops("story-packet", view.stories[0].id).packet;
  assert.ok(
    packet.includes(`Accepted for this Epic but not in the repo yet; write it verbatim at \`${ADR_PATH}\``),
    `the Story packet carries the accepted ADR:\n${packet}`,
  );
  assert.ok(packet.includes(ADR_TEXT.trim()), "with its whole text");
  const later = ops("story-packet", view.stories[1].id).packet;
  assert.ok(!later.includes(ADR_TEXT.trim()), "a later Story's packet does not carry the ADR's text");
  assert.ok(
    later.includes(`Accepted for this Epic but not in the repo yet: \`${ADR_PATH}\`. ${view.stories[0].key} writes it, the Epic's first Story`),
    `a later Story's packet names the ADR and the Story that writes it:\n${later}`,
  );
  step(`   ${view.stories[0].key}'s Context packet carries ADR ${ADR_PATH}, accepted in Round 1, to write verbatim; ${view.stories[1].key}'s names it`);
});
