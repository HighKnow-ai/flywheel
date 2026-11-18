/**
 * UAT 17 (`scripts/uat/uat-17-roadmap-round.mjs`) as a flow, through the real UI: a Milestone's exit test
 * is shaped in a Round, then confirming an Epic Done runs a roadmap Round that proposes a change, and
 * confirming a second Epic Done runs one that says the Roadmap still holds. The developer shapes in the
 * Milestone view, closes the Stage, confirms each Epic on the board and accepts the change on the Roadmap
 * strip. Every step of the developer is a control on the screen. The renderer, the core and the sidecar
 * are the real ones; only the agent is scripted. The doc is `docs/flows/roadmap-round.md`.
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
  async ({ page, core, open, shot }) => {
    const shaping = () => core.call<MilestoneShaping>("milestone_shaping_rounds", { milestoneId: board.milestoneId });
    const roadmap = () => core.call<RoadmapView>("roadmap_round_read", { projectId: board.projectId });
    const [rounds, strip] = board.epics;
    // The Round of the Milestone view, and the open roadmap Round's band on the Roadmap strip.
    const round = page.getByRole("heading", { name: /^Round 1\b/ }).locator("xpath=ancestor::section[1]");
    const band = page.locator("[data-slot=roadmap-round-band]");
    const lastRound = page.locator("[data-slot=roadmap-last-round]");
    const epicCard = (title: string) => page.getByRole("region", { name: title, exact: true });
    const confirmDone = async (epic: { key?: string }, title: string) => {
      await epicCard(title)
        .getByRole("button", { name: `Confirm exit test of ${epic.key} ${title}` })
        .click();
      await page
        .getByRole("alertdialog")
        .getByRole("button", { name: `Confirm ${epic.key} ${title} Done` })
        .click();
      await expect(page.getByRole("alertdialog")).toBeHidden();
    };

    await open();

    // A. S1-S3: the developer shapes the Milestone from the board. The Milestone view opens on the Round that
    // the agent posts, held and Waiting on you. The developer accepts every recommendation, and the held call ends.
    await page.getByRole("button", { name: "Shape the exit test of Shaping" }).click();
    await expect(round.getByText("Waiting on you")).toBeVisible();
    expect((await shaping()).rounds.filter((r) => r.waitingOnYou)).toHaveLength(1);
    await shot("round-held");
    await round.getByRole("button", { name: "Accept all recommended" }).click();
    await expect(round.getByText("Answered", { exact: true })).toBeVisible();

    // S4-S5: the agent proposes a sharper exit test, which is a ghost under the field. The developer accepts it.
    const ghost = page.getByRole("group", { name: "Proposed Exit test", exact: true });
    await expect(ghost).toContainText(SHARPER_EXIT_TEST);
    await expect.poll(async () => (await shaping()).proposals.length, { timeout: 60_000 }).toBe(1);
    const [exitTest] = (await shaping()).proposals;
    expect(exitTest.payload.exit_test).toBe(SHARPER_EXIT_TEST);
    await ghost.getByRole("button", { name: "Accept the proposed Exit test" }).click();
    await expect(page.getByRole("group", { name: "Exit test", exact: true })).toContainText(SHARPER_EXIT_TEST);
    await expect(ghost).toBeHidden();

    // S6: the developer closes the Exit test Stage, and the Milestone is Ready with the new exit test.
    await page.getByRole("button", { name: "Close Stage" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Close and make it Ready" }).click();
    await expect(page.getByText("The Exit test Stage is closed: the Milestone is Ready.")).toBeVisible();
    const shaped = await shaping();
    expect([shaped.milestone.state, shaped.milestone.exitTest]).toEqual(["ready", SHARPER_EXIT_TEST]);
    await shot("milestone-ready");

    // B. S7-S10: back on the board, the developer confirms Epic "Rounds" Done, which opens Round 1. The agent
    // proposes a New Epic and waits. The change is a ghost row on the Roadmap strip. The developer accepts it,
    // which answers the held call, and the Round closes with the change applied.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await confirmDone(rounds, "Rounds");
    await expect(band.getByRole("heading", { name: "Roadmap Round 1" })).toBeVisible();
    const change = page.getByRole("group", { name: 'Proposed: New Epic "Round history" in Milestone "Shaping"' });
    await expect(change).toBeVisible({ timeout: 60_000 });
    await expect(band.getByRole("status")).toContainText("Waiting on you · 0 of 1 decided");
    await shot("round-1-waiting");
    await expect.poll(async () => (await roadmap()).proposals.length, { timeout: 60_000 }).toBe(1);
    const [proposed] = (await roadmap()).proposals;
    expect(proposed.summary).toBe('New Epic "Round history" in Milestone "Shaping"');
    // S9 before S10: the developer's accept answers the agent's held `round_wait`, so the test waits
    // until that call is held. Accepting first is also correct (the call then returns at once), but
    // it is not the flow the diagram draws, and on a slow machine the agent's call came second.
    await expect
      .poll(() => core.trace().some((s) => s.from === "agent" && s.label === "round_wait"), { timeout: 60_000 })
      .toBe(true);
    await change.getByRole("button", { name: `Accept: ${proposed.summary}` }).click();
    await expect(band).toBeHidden();
    await expect(lastRound).toContainText("Roadmap Round 1 decided");
    await expect(epicCard("Round history")).toBeVisible();
    await expect.poll(async () => (await roadmap()).open, { timeout: 60_000 }).toBeNull();
    const closed = (await roadmap()).last!;
    expect([closed.number, closed.state, closed.proposalsFiled]).toEqual([1, "closed", 1]);
    const epics = await core.call<Epic[]>("epic_list", { milestoneId: board.milestoneId });
    expect(epics.find((e) => e.title === "Round history")?.state).toBe("shaping");

    // C. S11-S12: the developer confirms Epic "Roadmap strip" Done, which opens Round 2. The agent says the
    // Roadmap still holds. Round 1's session ends a moment after its Round closes, and the core allows one at a
    // time: the list of live sessions is empty on the screen, and the core's fleet has no shaping row.
    await expect(page.getByRole("list", { name: "Live sessions" })).toContainText("No agent running");
    await expect
      .poll(async () => (await core.call<{ shapingRows: unknown[] }>("fleet_list")).shapingRows.length, {
        timeout: 30_000,
      })
      .toBe(0);
    await confirmDone(strip, "Roadmap strip");
    await expect(lastRound).toContainText("Roadmap still holds", { timeout: 60_000 });
    await expect.poll(async () => (await roadmap()).last?.number, { timeout: 60_000 }).toBe(2);
    const holds = (await roadmap()).last!;
    expect([holds.state, holds.proposalsFiled]).toEqual(["closed", 0]);
    await shot("roadmap-holds");
  },
);
