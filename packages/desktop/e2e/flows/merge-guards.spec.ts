/**
 * The two ways Merge says no, as a flow (issue #1845), through the real UI. Alpha reaches review with a failing
 * Check, and the developer merges it with "Merge with failing Check", which names the Check and records it as
 * overridden. Bravo reaches review on a branch that conflicts with `main`, and its card reads Rebase needed, holds
 * Merge and offers a request for changes that starts from the conflicting path. The doc is
 * `docs/flows/merge-guards.md`.
 *
 * The conflict is the developer's own commit on `main`, written by the test with git, between the two hand-offs.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedMergeGuardsBoard, type Board } from "../seed";
import { ALPHA_FILE, MERGE_GUARDS_AGENT, SHARED_FILE } from "../agents/merge-guards-agent";

let board: Board & { stories: { id: string; key?: string }[] };

flow(
  "a failing Check is merged only through its confirm, and a conflicting branch reads Rebase needed",
  {
    doc: "merge-guards.md",
    agentScript: MERGE_GUARDS_AGENT,
    seed: async (core) => {
      board = await seedMergeGuardsBoard(core);
    },
  },
  async ({ page, core, open, shot }) => {
    const [alpha, bravo] = board.stories;
    const git = (...args: string[]) => execFileSync("git", ["-C", core.repo, ...args], { encoding: "utf8" }).trim();
    await open();
    const needsYou = page.getByRole("region", { name: /^Needs you/ });

    // Start, one Story at a time so the agents' steps do not mix: each agent writes a Task, commits a file and
    // hands off, and the Story waits in Needs you.
    for (const story of [alpha, bravo]) {
      await page.getByRole("button", { name: `Start ${story.key}` }).click();
      await expect(needsYou.getByRole("button", { name: new RegExp(`^Open review of ${story.key} `) })).toBeVisible({
        timeout: 60_000,
      });
    }

    // The developer's own work lands on `main`: a `shared.txt` that Bravo's branch also adds, with other text.
    expect(git("rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    fs.writeFileSync(path.join(core.repo, SHARED_FILE), "main\n");
    git("add", SHARED_FILE);
    git("-c", "user.name=Developer", "-c", "user.email=developer@example.com", "commit", "-m", "main: shared.txt");

    // Alpha: its Check failed at the hand-off, so Merge is the one that says "with failing Check". It is held until
    // the criterion is accepted, and then the confirm names the Check before it merges.
    await needsYou.getByRole("button", { name: new RegExp(`^Open review of ${alpha.key} `) }).click();
    const card = page.getByRole("region", { name: "Review" });
    const mergeAlpha = card.getByRole("button", { name: `Merge ${alpha.key} with failing Check` });
    await expect(mergeAlpha).toBeDisabled();
    await expect(card.getByRole("region", { name: "Rebase needed" })).toHaveCount(0);
    const criterion = card.getByRole("checkbox", { name: "Alpha leaves its mark in alpha.txt" });
    await criterion.click();
    await expect(criterion).toBeChecked();
    await expect(mergeAlpha).toBeEnabled();
    await shot("alpha-failing-check");
    await mergeAlpha.click();
    const confirm = page.getByRole("alertdialog", { name: `Merge ${alpha.key} with failing Check?` });
    await expect(confirm.getByRole("list", { name: "Failing Checks" })).toContainText("test -f alpha.txt");
    await confirm.getByRole("button", { name: "Merge with 1 failing Check" }).click();
    await expect(page.getByText(`${alpha.key} merged into main`)).toBeVisible();
    await page.getByRole("button", { name: "Open board" }).click();

    // Bravo: its Check passed, but its branch conflicts with `main` in shared.txt. The card says Rebase needed
    // before anything else, holds Merge, and starts a request for changes from the conflict.
    await needsYou.getByRole("button", { name: new RegExp(`^Open review of ${bravo.key} `) }).click();
    const bravoCard = page.getByRole("region", { name: "Review" });
    const rebase = bravoCard.getByRole("region", { name: "Rebase needed" });
    await expect(rebase.getByRole("list", { name: "Conflicting files" })).toContainText(SHARED_FILE);
    await expect(bravoCard.getByRole("button", { name: `Merge ${bravo.key}`, exact: true })).toBeDisabled();
    await shot("bravo-rebase-needed");
    await rebase.getByRole("button", { name: `Request a rebase of ${bravo.key}` }).click();
    const comments = bravoCard.getByRole("textbox", { name: "What should change?" });
    await expect(comments).toHaveValue(/^Rebase needed: merging into main would conflict in shared\.txt\./);
    await bravoCard.getByRole("button", { name: "Cancel" }).click();
    await expect(comments).toHaveCount(0);

    // What git says: Alpha's note is on `main` with the developer's `shared.txt`, and Bravo's branch is still there.
    expect(git("show", `main:${ALPHA_FILE}`)).toBe("Alpha was here.");
    expect(git("show", `main:${SHARED_FILE}`)).toBe("main");
    expect(git("branch", "--list", "flywheel/*")).toContain("bravo");
    expect(git("branch", "--list", "flywheel/*")).not.toContain("alpha");
  },
);
