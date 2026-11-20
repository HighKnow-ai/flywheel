/**
 * Issue #1844 (ADR 0043) as a flow: the project lists a `.env` to copy and a `node_modules` folder to link in
 * `.flywheel/worktree-include`, and none of the two is tracked. The Story's worktree holds both, so the two
 * Checks that need them pass. The third Check runs a tool nobody installed and fails, and the review card says
 * dependencies are missing. The doc is `docs/flows/worktree-include.md`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedWorktreeIncludeBoard } from "../seed";
import { MONOREPO_AGENT } from "../agents/monorepo-agent";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

flow(
  "a Story whose Check needs untracked files gets them in its worktree and a failed install is named",
  {
    doc: "worktree-include.md",
    agentScript: MONOREPO_AGENT,
    seed: async (core) => {
      fs.writeFileSync(path.join(core.project, ".env"), "TOKEN=abc\n");
      fs.mkdirSync(path.join(core.project, "node_modules", "dep"), { recursive: true });
      fs.writeFileSync(path.join(core.project, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
      fs.mkdirSync(path.join(core.project, ".flywheel"), { recursive: true });
      fs.writeFileSync(
        path.join(core.project, ".flywheel", "worktree-include"),
        "# Not tracked, so a new worktree would lack them.\n.env\nlink: node_modules\n",
      );
      await seedWorktreeIncludeBoard(core);
    },
  },
  async ({ page, core, open, shot }) => {
    await open();
    const needsYou = page.getByRole("region", { name: /^Needs you/ });
    const openReview = needsYou.getByRole("button", { name: "Open review of FLY-2 Parser" });
    await page.getByRole("button", { name: "Start FLY-2" }).click();
    await expect(openReview).toBeVisible({ timeout: 60_000 });

    // The worktree holds a copy of .env and a link to the project's node_modules, and reads clean.
    const worktree = git(core.repo, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .at(-1); // the first one is the repository itself
    expect(worktree).toBeDefined();
    expect(fs.readFileSync(path.join(worktree!, ".env"), "utf8")).toBe("TOKEN=abc\n");
    expect(fs.lstatSync(path.join(worktree!, "node_modules")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(worktree!, "node_modules", "dep", "index.js"))).toBe(true);
    expect(git(worktree!, "status", "--porcelain")).not.toContain("node_modules");
    expect(git(worktree!, "status", "--porcelain")).not.toContain(".env");

    await openReview.click();
    const review = page.getByRole("region", { name: "Review" });
    // The two Checks that need the untracked files passed; the third failed and is named as missing.
    const failing = review.getByRole("region", { name: "1 Check not passing" });
    await expect(failing).toBeVisible();
    await expect(failing.getByText(/^Dependencies missing in this worktree\?/)).toBeVisible();
    await expect(failing.getByText("vitest-that-nobody-installed run")).toBeVisible();
    await expect(review.getByRole("checkbox", { name: "The app reads its token" })).toBeVisible();
    await expect(review.getByText("Suggested · Check passed at this commit: tick to accept.").first()).toBeVisible();
    await shot("review-card");
  },
);
