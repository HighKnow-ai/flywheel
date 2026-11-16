/**
 * UAT 19 (`scripts/uat/uat-19-board-and-review.mjs`) through the real UI: a Story goes from Ready to
 * Merged through Needs you, the triage drawer, a request for changes, the Decisions section and
 * Merge. The renderer, the core and the sidecar are the real ones; only the agent is scripted.
 * The doc is `docs/flows/review-and-merge.md`.
 */
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedReviewBoard } from "../seed";
import { ADR_PATH, COMMENTS, REVIEW_AGENT } from "../agents/review-agent";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

flow(
  "a Story goes from Ready to Merged through Needs you, triage, a request for changes and Merge",
  { doc: "review-and-merge.md", agentScript: REVIEW_AGENT, seed: async (core) => void (await seedReviewBoard(core)) },
  async ({ page, core, open, shot }) => {
    await open();
    const needsYou = page.getByRole("region", { name: /^Needs you/ });
    const openReview = needsYou.getByRole("button", { name: "Open review of FLY-2 Parser" });

    // Start: the agent works, files two Proposals and hands off, so the Story waits in Needs you.
    await page.getByRole("button", { name: "Start FLY-2" }).click();
    await expect(openReview).toBeVisible({ timeout: 60_000 });
    await expect(needsYou.getByRole("button", { name: "Accept the Amend criterion on FLY-2" })).toBeVisible();
    await shot("needs-you-after-handoff");

    // Triage: reject the New Story in the drawer, with a reason; accept the Amend criterion where it is drawn.
    await needsYou.getByRole("button", { name: "Triage 1 Proposal" }).click();
    const drawer = page.getByRole("dialog", { name: /Triage Proposals/ });
    await drawer.getByRole("button", { name: /^Reject New Story/ }).click();
    await drawer
      .getByRole("textbox", { name: "Why not? (optional)" })
      .fill("Out of this Epic: a separate Story for the next Milestone");
    await drawer.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(drawer.getByRole("button", { name: /^Reject New Story/ })).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(drawer).toBeHidden();
    await needsYou.getByRole("button", { name: "Accept the Amend criterion on FLY-2" }).click();
    await expect(needsYou.getByRole("button", { name: "Accept the Amend criterion on FLY-2" })).toBeHidden();
    await expect(needsYou.getByRole("button", { name: /^Triage/ })).toBeHidden();
    await shot("needs-you-after-triage");

    // Request changes: the comments close the review and a second session starts in the same worktree.
    await openReview.click();
    const card = page.getByRole("region", { name: "Review" });
    await expect(card.getByRole("button", { name: "Merge FLY-2" })).toBeDisabled();
    await card.getByRole("button", { name: "Request changes on FLY-2" }).click();
    await card.getByRole("textbox", { name: "What should change?" }).fill(COMMENTS);
    await card.getByRole("button", { name: "Send FLY-2 back to Running" }).click();

    // The second session adds a Task, commits the fix, re-runs the Checks and hands off again.
    // The page stays on the Story, whose review card now holds the second hand-off.
    await expect.poll(() => core.trace().filter((s) => s.label === "handoff").length, { timeout: 60_000 }).toBe(2);
    await expect(page.getByRole("region", { name: "FLY-2 Parser" })).toContainText("Tasks 3/3");
    const review = page.getByRole("region", { name: "Review" });
    await expect(review.getByRole("checkbox", { name: "The parser lives in src/parser.rs" })).toBeVisible();
    await expect(review.getByText("Suggested · Check passed at this commit: tick to accept.")).toBeVisible();
    await expect(review.getByRole("radio", { name: "Keep" })).toBeChecked();
    await shot("review-card");

    // Accept both criteria and Merge: the ADR is kept by default, so the decision needs no command.
    for (const statement of ["The parser lives in src/parser.rs", "A parse error names its line"]) {
      await review.getByRole("checkbox", { name: statement }).click();
      await expect(review.getByRole("checkbox", { name: statement })).toBeChecked();
    }
    const merge = review.getByRole("button", { name: "Merge FLY-2" });
    await expect(merge).toBeEnabled();
    await merge.click();
    await expect(page.getByText("FLY-2 merged into main")).toBeVisible();
    await expect(page.getByText("Worktree cleaned.")).toBeVisible();
    await page.getByRole("button", { name: "Open board" }).click();
    await expect(needsYou.getByRole("button", { name: "Confirm exit test of FLY-1 Parsing" })).toBeVisible();
    await shot("merged");

    // What the board and git say, read from the core and the repository, not from the screen.
    const mainHead = git(core.repo, "rev-parse", "main");
    expect(git(core.repo, "rev-list", "--parents", "-n", "1", mainHead).split(" ")).toHaveLength(3);
    expect(git(core.repo, "show", `main:${ADR_PATH}`)).toContain("Parse into a tree");
    expect(git(core.repo, "branch", "--list", "flywheel/*")).toBe("");
  },
);
