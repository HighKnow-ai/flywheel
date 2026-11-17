/// <reference types="vite/client" />
/**
 * Part 4 of 6 of the Milestone 2 to 4 walk (issues #102, #192): 17 screens, each rendered, clicked to and
 * checked for layout defects at four window sizes. The steps the parts share, and why the walk is 6 files, are
 * in `m2-walk.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import {
  setReviewInFixture,
  setNeedsYouExtras,
  setRoadmapRound,
  setShapingSessionLive,
  shapeMilestoneInFixture,
} from "./m2-fixture";
import { CRITIQUE_RUN, writeDefectReport } from "./capture";
import { boardReady, click, registerHooks, shot } from "./m2-walk";

describe.runIf(CRITIQUE_RUN)("M2 to M4 flow screens (part 4 of 6)", () => {
  afterAll(() => writeDefectReport("m2-flow-4"));
  registerHooks();

  it("57 Milestone shaping at the window's minimum width (issue #132)", async () => {
    shapeMilestoneInFixture("waiting");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on Board and review");
      await screen.findByRole("group", { name: "Proposed Exit test" });
      await shot("57-milestone-shaping-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("69 Milestone shaping: the exit test edited by hand, its pending ghost still under it (issue #149)", async () => {
    shapeMilestoneInFixture("waiting");
    await boardReady();
    await click("Answer the Round on Board and review");
    await screen.findByRole("group", { name: "Proposed Exit test" });
    await click("Edit Exit test");
    await screen.findByRole("textbox", { name: "Exit test" });
    await shot("69-milestone-shaping-edit-exit-test");
  });

  it("70 project board: Since you last looked, unfolded above the roster (issue #167)", async () => {
    await boardReady();
    await click(/7 events since you last looked/);
    await screen.findByRole("list", { name: "Since you last looked" });
    await shot("70-since-you-last-looked");
  });

  it("71 review card: the failing Check first with its output, a pre-ticked criterion still to accept (issue #155)", async () => {
    await boardReady();
    await click("Open review of FLY-3");
    await screen.findByRole("region", { name: "1 Check not passing" });
    await shot("71-review-card-judging");
  });

  it("72 review card: Merge with failing Check confirms, naming the Check (issue #155)", async () => {
    setReviewInFixture("override");
    await boardReady();
    await click("Open review of FLY-3");
    await click("Merge FLY-3 with failing Check");
    await screen.findByRole("alertdialog");
    await shot("72-review-card-merge-with-failing-check");
  });

  it("73 review card: every criterion accepted, every Check passed, Merge filled (issue #155)", async () => {
    setReviewInFixture("ready");
    await boardReady();
    await click("Open review of FLY-3");
    await screen.findByRole("button", { name: "Merge FLY-3" });
    await shot("73-review-card-ready");
  });

  it("85 review card: the Decisions section, each new ADR with its bar lines, related ADRs and Keep (issue #161)", async () => {
    setReviewInFixture("decisions");
    await boardReady();
    await click("Open review of FLY-3");
    const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
    section.scrollIntoView({ block: "start" });
    await shot("85-review-card-decisions");
  });

  it("86 review card: the Decisions section at the window's minimum width (issue #161)", async () => {
    setReviewInFixture("decisions");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open review of FLY-3");
      const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
      section.scrollIntoView({ block: "start" });
      await shot("86-review-card-decisions-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("88 review card: the warnings and each changed file's diff (issue #157)", async () => {
    setReviewInFixture("judging", { taskOpen: true });
    await boardReady();
    await click("Open review of FLY-3");
    const files = await screen.findByRole("region", { name: "3 changed files" });
    await screen.findByRole("group", { name: "Diff of packages/desktop/src/theme/tokens.ts" });
    (await screen.findByRole("region", { name: "Warnings" })).scrollIntoView({ block: "start" });
    expect(files).toBeTruthy();
    await shot("88-review-card-files");
  });

  it("89 review card: Re-run Checks says what the run recorded (issue #157)", async () => {
    await boardReady();
    await click("Open review of FLY-3");
    await click("Re-run Checks");
    await screen.findByText("Ran 2 Checks at 9f3c2ab: 1 passed, 1 failed.");
    await shot("89-review-card-rerun-checks");
  });

  it("74 board: an In review Story's row offers Open review (issue #155)", async () => {
    await boardReady();
    (await screen.findByRole("button", { name: "Open review of FLY-3" })).scrollIntoView({ block: "center" });
    await shot("74-board-open-review");
  });

  it("75 Needs you: the ranked column beside the roster, and each project's figure in the sidebar (issue #156)", async () => {
    setNeedsYouExtras(true);
    await boardReady();
    await screen.findByRole("list", { name: "Needs you, most urgent first" });
    await shot("75-needs-you-column");
  });

  it("76 Needs you, scrolled: Stopped, a missing worktree, Review, Confirm exit test and Rounds no session works (issue #156)", async () => {
    setNeedsYouExtras(true);
    setShapingSessionLive(false);
    setRoadmapRound("idle");
    await boardReady();
    const column = await screen.findByRole("region", { name: /^Needs you/ });
    await screen.findByText("Round 2 · No live session: your answers are kept");
    // The board scrolls the column to its top, where it sticks; then the column scrolls its own list.
    column.scrollIntoView({ block: "start" });
    column.scrollTop = column.scrollHeight;
    await shot("76-needs-you-column-decisions");
  });

  it("77 Needs you at the window's minimum width: the top bar's button opens it as a Sheet (issue #156)", async () => {
    setNeedsYouExtras(true);
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click(/^Open Needs you/);
      await screen.findByRole("dialog");
      await shot("77-needs-you-sheet-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("78 Needs you: confirming an Epic's exit test from its card (issue #156)", async () => {
    setNeedsYouExtras(true);
    await boardReady();
    await click("Confirm exit test of FLY-12 Milestone and Roadmap shaping");
    await screen.findByRole("alertdialog");
    await shot("78-needs-you-confirm-exit-test");
  });

  it("92 review card: Rebase needed names the conflicting files first, Merge held (issue #158)", async () => {
    setReviewInFixture("rebase");
    await boardReady();
    await click("Open review of FLY-3");
    await screen.findByRole("region", { name: "Rebase needed" });
    await shot("92-review-card-rebase-needed");
  });

  it("93 review card: Request changes writes the review points in the footer (issue #158)", async () => {
    setReviewInFixture("judging");
    await boardReady();
    await click("Open review of FLY-3");
    await click("Request changes on FLY-3");
    await userEvent.type(
      await screen.findByRole("textbox", { name: "What should change?" }),
      "Lift subtle-foreground on the dark card until it clears 4.5:1.{Enter}Record the lift in direction.md.",
    );
    (await screen.findByRole("button", { name: "Send FLY-3 back to Running" })).scrollIntoView({ block: "end" });
    await shot("93-review-card-request-changes");
  });
});
