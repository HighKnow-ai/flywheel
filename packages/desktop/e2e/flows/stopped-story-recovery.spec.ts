/**
 * Recovering a Stopped Story (issue #1845) as a flow, through the real UI: a Story's session is running when the
 * app dies and its worktree is gone when the app starts again. The developer recreates the worktree from Needs you,
 * resumes the Story with a note, stops the new session and drops the Story. The doc is
 * `docs/flows/stopped-story-recovery.md`.
 *
 * The first core is killed with SIGKILL, so it runs no exit step, and the test removes the Story's worktree folder
 * as a cleaning tool or a moved disk would. The second core starts on the same root: its launch reconciliation
 * writes the session `abandoned` and the worktree `missing`, which Needs you shows as Recreate worktree. The
 * Resume note is in the packet of the second session, which tells the scripted agent to write nothing.
 */
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedReviewBoard, type Board } from "../seed";
import { RESUME_NOTE, STOPPED_STORY_AGENT, STOPPED_STORY_ENV } from "../agents/stopped-story-agent";

let board: Board;

interface Worktree {
  branch: string;
  path: string;
  status: string;
}

interface Run {
  id: string;
  status: string;
}

flow(
  "a Story whose worktree vanished with the app is recreated from Needs you, resumed with a note, stopped and dropped",
  {
    doc: "stopped-story-recovery.md",
    agentScript: STOPPED_STORY_AGENT,
    agentEnv: STOPPED_STORY_ENV,
    seed: async (core) => {
      board = await seedReviewBoard(core);
    },
  },
  async ({ page, core, open, shot, crashAndRestart }) => {
    const storyKey = board.storyKey!;
    const storyId = board.storyId!;

    // Life one: the developer starts the Story, and the agent writes a Task.
    await open();
    await page.getByRole("button", { name: `Start ${storyKey}` }).click();
    await expect.poll(() => core.trace().some((s) => s.label === "task_add"), { timeout: 60_000 }).toBe(true);
    const worktree = await core.call<Worktree>("worktree_summary", { storyId });
    expect(worktree.status).toBe("active");
    expect(fs.existsSync(worktree.path)).toBe(true);

    // The app dies with the session running, and the Story's worktree folder is gone before it starts again.
    fs.rmSync(worktree.path, { recursive: true, force: true });
    const second = await crashAndRestart();

    // Life two: launch reconciliation wrote the session `abandoned` and the worktree `missing`. The Story is
    // Stopped, and Needs you offers Recreate worktree, not Resume, because Resume has nowhere to start.
    expect(await second.call<Worktree>("worktree_summary", { storyId })).toMatchObject({ status: "missing" });
    await open();
    const needsYou = page.getByRole("region", { name: /^Needs you/ });
    const recreate = needsYou.getByRole("button", { name: `Recreate the worktree of ${storyKey}` });
    await expect(recreate).toBeVisible({ timeout: 30_000 });
    await expect(needsYou.getByRole("button", { name: `Resume ${storyKey}` })).toHaveCount(0);
    await shot("worktree-missing");

    // Recreate worktree makes the folder again on the same branch, and the Resume the Story needed is offered.
    await recreate.click();
    const resume = needsYou.getByRole("button", { name: `Resume ${storyKey}` });
    await expect(resume).toBeVisible();
    expect(await second.call<Worktree>("worktree_summary", { storyId })).toMatchObject({
      status: "active",
      branch: worktree.branch,
      path: worktree.path,
    });
    expect(fs.existsSync(worktree.path)).toBe(true);

    // Resume with a note starts a fresh session in that worktree. The board does not leave the board.
    await resume.click();
    const resumeDialog = page.getByRole("dialog", { name: `Resume ${storyKey}` });
    await resumeDialog.getByRole("textbox", { name: `Resume note for ${storyKey}` }).fill(RESUME_NOTE);
    await shot("resume-dialog");
    await resumeDialog.getByRole("button", { name: `Start the new session for ${storyKey}` }).click();
    await expect(resumeDialog).toHaveCount(0);
    const runs = () => second.call<Run[]>("sessions_for_story", { storyId });
    await expect
      .poll(async () => (await runs()).map((r) => r.status).sort(), { timeout: 30_000 })
      .toEqual(["abandoned", "running"]);

    // The developer opens the Story and stops the new session. The Story is Stopped again, and offers Resume.
    await page
      .getByRole("list", { name: /Stories$/ })
      .getByRole("button", { name: `Open Story ${storyKey} Parser` })
      .click();
    await page.getByRole("button", { name: `Stop ${storyKey}` }).click();
    await page.getByRole("button", { name: "Stop the session" }).click();
    await expect.poll(async () => (await runs()).map((r) => r.status), { timeout: 30_000 }).not.toContain("running");
    await expect(page.getByRole("button", { name: `Resume ${storyKey}` })).toBeVisible();

    // Drop ends the Story on purpose: its worktree and branch are removed, and its record stays readable.
    await page.getByRole("button", { name: `Drop ${storyKey}` }).click();
    await page.getByRole("button", { name: "Drop the Story" }).click();
    await expect(page.getByText(`Dropped ${storyKey}`)).toBeVisible();
    await shot("dropped");

    // What the board and git say, read from the core and the repository, not from the screen.
    expect(await second.call("story_get", { storyId })).toMatchObject({ key: storyKey, state: "dropped" });
    expect(fs.existsSync(worktree.path)).toBe(false);
    expect(execFileSync("git", ["-C", core.repo, "branch", "--list", "flywheel/*"], { encoding: "utf8" }).trim()).toBe(
      "",
    );
  },
);
