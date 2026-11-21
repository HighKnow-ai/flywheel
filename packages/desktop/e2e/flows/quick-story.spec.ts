/**
 * A Quick Story (docs/adr/0044) as a flow, through the real UI: the developer writes one line in one field,
 * and a Story with the default criterion is written and started in one step, on the board like any other.
 * The doc is `docs/flows/quick-story.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedFleetBoard, type Board } from "../seed";
import { SUPERVISED_AGENT, SUPERVISED_ENV } from "../agents/supervised-agent";

let board: Board & { stories: { id: string; key?: string }[] };

const REQUEST = "Why does the build fail on main?";

interface Story {
  id: string;
  key: string;
  title: string;
  state: string;
  epicId: string;
}

flow(
  "a Quick Story is written with the default criterion and started in one step",
  {
    doc: "quick-story.md",
    agentScript: SUPERVISED_AGENT,
    agentEnv: SUPERVISED_ENV,
    seed: async (core) => {
      board = await seedFleetBoard(core);
    },
  },
  async ({ page, core, open, shot }) => {
    const stories = () => core.call<Story[]>("story_list_for_project", { projectId: board.projectId });
    const before = (await stories()).length;

    // S1: the developer opens Quick Story, writes one line and starts it.
    await open();
    await page.getByRole("button", { name: "Quick Story", exact: true }).click();
    await page.getByRole("textbox", { name: "Quick Story request" }).fill(REQUEST);
    await page.getByRole("button", { name: "Write and start the Quick Story" }).click();

    // The Story is on the board, Running, with its session; the dialog closed.
    await expect.poll(async () => (await stories()).length, { timeout: 30_000 }).toBe(before + 1);
    const quick = (await stories()).find((s) => s.title === REQUEST);
    expect(quick, "the Quick Story is on the board").toBeDefined();
    await expect
      .poll(async () => (await stories()).find((s) => s.title === REQUEST)?.state, { timeout: 30_000 })
      .toBe("running");
    const sessions = await core.call<{ status: string }[]>("sessions_for_story", { storyId: quick!.id });
    expect(sessions.map((s) => s.status)).toEqual(["running"]);
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // One default criterion, no Check, judged at review; and the Story sits in the Epic "Quick Stories".
    const criteria = await core.call<{ statement: string }[]>("criterion_list", { storyId: quick!.id });
    expect(criteria).toHaveLength(1);
    expect(criteria[0].statement).toMatch(/request in the Story description is done/);
    const epics = await core.call<{ id: string; title: string }[]>("epic_list", { milestoneId: board.milestoneId });
    expect(epics.find((e) => e.id === quick!.epicId)?.title).toBe("Quick Stories");
    await expect(
      page.getByRole("list", { name: /Stories$/ }).getByRole("button", { name: `Open Story ${quick!.key} ${REQUEST}` }),
    ).toBeVisible();
    await shot("quick-story-running");
  },
);
