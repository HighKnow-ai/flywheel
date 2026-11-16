/**
 * The exit test's preflight (issue #1600) as a flow: the project is the `flywheel/` folder of a larger
 * repository. The Story runs in a worktree of the whole repository, at the same folder; the Check runs
 * in the project folder; the merge lands on `main` under `flywheel/`, and nothing lands at the root.
 * The doc is `docs/flows/monorepo-layout.md`.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedMonorepoBoard } from "../seed";
import { MONOREPO_AGENT } from "../agents/monorepo-agent";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

flow(
  "a Story of a project in a monorepo folder runs in that folder of its worktree and merges under it",
  {
    doc: "monorepo-layout.md",
    layout: "monorepo",
    agentScript: MONOREPO_AGENT,
    seed: async (core) => void (await seedMonorepoBoard(core)),
  },
  async ({ page, core, open, shot }) => {
    expect(path.relative(core.repo, core.project)).toBe("flywheel");
    await open();
    const needsYou = page.getByRole("region", { name: /^Needs you/ });
    const openReview = needsYou.getByRole("button", { name: "Open review of FLY-2 Parser" });
    await page.getByRole("button", { name: "Start FLY-2" }).click();
    await expect(openReview).toBeVisible({ timeout: 60_000 });

    // The agent's commit is under flywheel/ in the Story's branch, not at the repository's root.
    const branch = git(core.repo, "branch", "--list", "flywheel/*", "--format=%(refname:short)").split("\n")[0];
    expect(branch).not.toBe("");
    expect(git(core.repo, "ls-tree", "-r", "--name-only", branch)).toContain("flywheel/src/parser.rs");
    expect(git(core.repo, "ls-tree", "--name-only", branch).split("\n")).not.toContain("src");

    await openReview.click();
    const review = page.getByRole("region", { name: "Review" });
    // The Check ran in the project folder of the worktree: `test -f src/parser.rs` passes only there.
    await expect(review.getByText("Suggested · Check passed at this commit: tick to accept.")).toBeVisible();
    await review.getByRole("checkbox", { name: "The parser lives in src/parser.rs" }).click();
    await shot("review-card");
    await review.getByRole("button", { name: "Merge FLY-2" }).click();
    await expect(page.getByText("FLY-2 merged into main")).toBeVisible();
    await expect(page.getByText("Worktree cleaned.")).toBeVisible();

    expect(git(core.repo, "show", "main:flywheel/src/parser.rs")).toContain("Parses a file");
    expect(git(core.repo, "ls-tree", "--name-only", "main").split("\n")).not.toContain("src");
    expect(git(core.repo, "ls-tree", "--name-only", "main", "other/")).toBe("other/README.md");
    expect(git(core.repo, "branch", "--list", "flywheel/*")).toBe("");
  },
);
