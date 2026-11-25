/**
 * Quit and open again (issue #1786, step 4): the developer works on the board, quits Flywheel the way the app
 * quits, and opens it again. The board comes back as it was left. The core is the headless core, which runs
 * the app's own start path; the second core starts on the same data. The doc is `docs/flows/quit-and-reopen.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedReviewBoard, type Board } from "../seed";

let board: Board;

interface StoryRow {
  id: string;
  key: string;
  title: string;
  state: string;
}

flow(
  "a board left by a quit is the same board after the app opens again",
  {
    doc: "quit-and-reopen.md",
    agentScript: [],
    seed: async (core) => {
      board = await seedReviewBoard(core);
    },
  },
  async ({ page, core, open, shot, quitAndRestart }) => {
    await open();
    await expect(page.getByText(board.storyKey!).first()).toBeVisible();
    const before = await core.call<StoryRow[]>("story_list_for_project", { projectId: board.projectId });
    expect(before.length).toBeGreaterThan(0);
    await shot("before-quit");

    // The developer quits: the core ends its sessions and the sidecar, with no SIGKILL, and starts again.
    const second = await quitAndRestart();
    const after = await second.call<StoryRow[]>("story_list_for_project", { projectId: board.projectId });
    expect(after.map((s) => [s.id, s.key, s.title, s.state])).toEqual(
      before.map((s) => [s.id, s.key, s.title, s.state]),
    );

    await open();
    await expect(page.getByText(board.storyKey!).first()).toBeVisible();
    await shot("after-reopen");
  },
);
