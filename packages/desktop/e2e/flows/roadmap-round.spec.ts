/**
 * UAT 17 (`scripts/uat/uat-17-roadmap-round.mjs`) as a flow: a Milestone's exit test is shaped in a
 * Round, then confirming an Epic Done runs a roadmap Round that proposes a change, and confirming a
 * second Epic Done runs one that says the Roadmap still holds. The core and the sidecar are the real
 * ones; only the agent is scripted. The doc is `docs/flows/roadmap-round.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedRoadmapBoard, type Board } from "../seed";
import { ROADMAP_AGENT, SHARPER_EXIT_TEST } from "../agents/roadmap-agent";

let board: Board & { epics: { id: string; key?: string }[] };

interface MilestoneShaping {
  milestone: { state: string; exitTest: string | null };
  stages: { id: string; state: string }[];
  rounds: { id: string; state: string; waitingOnYou: boolean }[];
  proposals: { id: string; state: string; payload: { exit_test?: string } }[];
}
interface RoadmapView {
  open: { number: number; waitingOnYou: boolean } | null;
  proposals: { id: string; state: string; summary: string }[];
  last: { number: number; state: string; proposalsFiled: number } | null;
}
interface Epic {
  title: string;
  state: string;
}

flow(
  "a Milestone's exit test is shaped, and confirming an Epic Done runs a roadmap Round",
  {
    doc: "roadmap-round.md",
    agentScript: ROADMAP_AGENT,
    seed: async (core) => {
      board = await seedRoadmapBoard(core);
    },
  },
  async ({ core }) => {
    const shaping = () => core.call<MilestoneShaping>("milestone_shaping_rounds", { milestoneId: board.milestoneId });
    const roadmap = () => core.call<RoadmapView>("roadmap_round_read", { projectId: board.projectId });
    const [rounds, strip] = board.epics;

    // A. The Milestone's shaping session posts a Round; the developer accepts every recommendation;
    // the agent proposes a sharper exit test; the developer accepts it and closes the Exit test Stage.
    await core.call("milestone_shape", { milestoneId: board.milestoneId });
    await expect
      .poll(async () => (await shaping()).rounds.filter((r) => r.waitingOnYou).length, { timeout: 60_000 })
      .toBe(1);
    await core.call("round_accept_all", { roundId: (await shaping()).rounds[0].id });
    await expect.poll(async () => (await shaping()).proposals.length, { timeout: 60_000 }).toBe(1);
    const [exitTest] = (await shaping()).proposals;
    expect(exitTest.payload.exit_test).toBe(SHARPER_EXIT_TEST);
    await core.call("proposal_accept", { proposalId: exitTest.id });
    const stage = (await shaping()).stages.find((s) => s.state === "open")!;
    await core.call("stage_close", { stageId: stage.id });
    const shaped = await shaping();
    expect([shaped.milestone.state, shaped.milestone.exitTest]).toEqual(["ready", SHARPER_EXIT_TEST]);

    // B. Confirming Epic "Rounds" Done opens Round 1. The agent proposes a new Epic and waits; the
    // developer accepts it, which answers the held call, and the Round closes with the change applied.
    const first = await core.call<{ outcome: string; roundNumber: number }>("epic_confirm_done", { epicId: rounds.id });
    expect([first.outcome, first.roundNumber]).toEqual(["opened", 1]);
    await expect.poll(async () => (await roadmap()).proposals.length, { timeout: 60_000 }).toBe(1);
    const [change] = (await roadmap()).proposals;
    expect(change.summary).toBe('New Epic "Round history" in Milestone "Shaping"');
    // S9 before S10: the developer's accept answers the agent's held `round_wait`, so the test waits
    // until that call is held. Accepting first is also correct (the call then returns at once), but
    // it is not the flow the diagram draws, and on a slow machine the agent's call came second.
    await expect
      .poll(() => core.trace().some((s) => s.from === "agent" && s.label === "round_wait"), { timeout: 60_000 })
      .toBe(true);
    await core.call("proposal_accept", { proposalId: change.id });
    await expect.poll(async () => (await roadmap()).open, { timeout: 60_000 }).toBeNull();
    const closed = (await roadmap()).last!;
    expect([closed.number, closed.state, closed.proposalsFiled]).toEqual([1, "closed", 1]);
    const epics = await core.call<Epic[]>("epic_list", { milestoneId: board.milestoneId });
    expect(epics.find((e) => e.title === "Round history")?.state).toBe("shaping");

    // C. Confirming Epic "Roadmap strip" Done opens Round 2. The agent says the Roadmap still holds.
    // Round 1's session ends a moment after its Round closes, and the core allows one at a time.
    await expect
      .poll(async () => (await core.call<{ shapingRows: unknown[] }>("fleet_list")).shapingRows.length, {
        timeout: 30_000,
      })
      .toBe(0);
    const second = await core.call<{ outcome: string; roundNumber: number }>("epic_confirm_done", { epicId: strip.id });
    expect([second.outcome, second.roundNumber]).toEqual(["opened", 2]);
    await expect.poll(async () => (await roadmap()).last?.number, { timeout: 60_000 }).toBe(2);
    const holds = (await roadmap()).last!;
    expect([holds.state, holds.proposalsFiled]).toEqual(["closed", 0]);
  },
);
