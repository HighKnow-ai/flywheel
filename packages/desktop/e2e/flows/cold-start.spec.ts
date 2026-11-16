/**
 * The cold start as a flow (issue #1630): a Story's session is running when the app dies, and the
 * next start reconciles it. The core is the headless core, which runs the app's own start path
 * (`src-tauri/src/startup.rs`): login PATH, launch reconciliation, sidecar, scheduler. The doc is
 * `docs/flows/cold-start.md`.
 *
 * The first core is killed with SIGKILL, so it runs no exit step: the database still says the session
 * is `running`. The agent is killed with it. The second core starts on the same root, and its launch
 * reconciliation must write the session `abandoned`, and its scheduler must tick for the Story the
 * developer has open.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedReviewBoard, type Board } from "../seed";
import { COLD_START_AGENT, COLD_START_ENV } from "../agents/cold-start-agent";

let board: Board;

interface RunSummary {
  id: string;
  status: string;
}

flow(
  "a session left running when the app died is reconciled on the next start, and the scheduler ticks",
  {
    doc: "cold-start.md",
    agentScript: COLD_START_AGENT,
    agentEnv: COLD_START_ENV,
    seed: async (core) => {
      board = await seedReviewBoard(core);
    },
  },
  async ({ page, core, open, shot, crashAndRestart }) => {
    const storyKey = board.storyKey!;
    const storyId = board.storyId!;

    // Life one: the Story starts, its session runs and the agent writes a Task.
    await core.call("story_start", { storyId });
    await expect.poll(() => core.trace().some((s) => s.label === "task_add"), { timeout: 60_000 }).toBe(true);
    const before = await core.call<RunSummary[]>("sessions_for_story", { storyId });
    expect(before.map((r) => r.status)).toEqual(["running"]);

    // The app dies: no exit step runs. The next start finds the session still `running`.
    const second = await crashAndRestart();
    await second.armSchedulerTrace();
    await second.call("git_truth_focus_story", { storyId });

    // Launch reconciliation wrote the dead session `abandoned`; it is no live orphan to ask about.
    const after = await second.call<RunSummary[]>("sessions_for_story", { storyId });
    expect(after.map((r) => [r.id, r.status])).toEqual([[before[0].id, "abandoned"]]);
    expect(await second.call<unknown[]>("sessions_pending_orphans")).toEqual([]);

    // The scheduler started by the same path ticks on the open Story and reports its git facts.
    await expect.poll(() => second.trace().some((s) => s.label === "git_facts_tick"), { timeout: 30_000 }).toBe(true);

    // The renderer on the second core shows the board as reconciled.
    await open();
    await expect(page.getByText(storyKey).first()).toBeVisible();
    await shot("after-restart");
  },
);
