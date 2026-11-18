/**
 * Merge in a project that takes changes by pull request (issue #1757, ADR 0042) as a flow. The developer
 * names GitHub as the project's forge in the Landing dialog; the agent works and hands off; Merge pushes
 * the Story's branch, opens a pull request with auto-merge on, and the Story is Landing, not Merged. The
 * forge merges the request; "Check now" asks it, and the Story is Merged and its worktree is cleaned. The
 * doc is `docs/flows/story-landing.md`.
 *
 * The forge CLI is a stub (`agents/forge-stub.ts`) that records its calls and answers from files, and the
 * remote is the scratch repository's own bare `remote.git`. The renderer, the core and the sidecar are the
 * real ones; only the agent and `gh` are scripted.
 */
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { flow } from "../fixtures";
import { seedReviewBoard } from "../seed";
import { MONOREPO_AGENT } from "../agents/monorepo-agent";
import { makeForgeStub, REQUEST_URL } from "../agents/forge-stub";

const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" }).trim();

const stub = makeForgeStub();
test.afterAll(() => stub.remove());

flow(
  "a Story of a project that lands by pull request is Landing until the forge merges the request",
  {
    doc: "story-landing.md",
    agentScript: MONOREPO_AGENT,
    agentEnv: { FLYWHEEL_FORGE_PATH: stub.dir },
    seed: async (core) => void (await seedReviewBoard(core)),
  },
  async ({ page, core, open, shot }) => {
    await open();
    const mainBefore = git(core.repo, "rev-parse", "main");

    // The project's menu names the forge: the scratch remote's URL is a file path, which no host names.
    await page.getByRole("button", { name: "Project actions for Threadfin" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Landing…" }).click();
    const dialog = page.getByRole("dialog", { name: "Landing for Threadfin" });
    await expect(dialog.getByRole("radio", { name: "Pull request" })).toBeChecked();
    await dialog.getByRole("combobox", { name: "Forge" }).selectOption("github");
    await shot("landing-dialog");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(dialog).toHaveCount(0);

    // The agent works and hands off.
    const needsYou = page.getByRole("region", { name: /^Needs you/ });
    await page.getByRole("button", { name: "Start FLY-2" }).click();
    await needsYou.getByRole("button", { name: "Open review of FLY-2 Parser" }).click({ timeout: 60_000 });
    const review = page.getByRole("region", { name: "Review" });
    for (const statement of ["The parser lives in src/parser.rs", "A parse error names the line"]) {
      await review.getByRole("checkbox", { name: statement }).click();
      await expect(review.getByRole("checkbox", { name: statement })).toBeChecked();
    }

    // Merge opens the request, and the Story waits for the forge.
    await review.getByRole("button", { name: "Merge FLY-2" }).click();
    await expect(page.getByText("FLY-2 is landing: pull request opened")).toBeVisible();
    const landing = page.getByRole("region", { name: "Landing" });
    await expect(landing).toContainText("The pull request is open");
    await expect(landing).toContainText(REQUEST_URL);
    await shot("landing");

    const calls = stub.calls();
    expect(calls[0]).toBe("auth status");
    expect(calls.some((c) => /^pr create --base main --head flywheel\//.test(c))).toBe(true);
    expect(calls.some((c) => c.endsWith(`${REQUEST_URL} --auto --squash`))).toBe(true);
    // The branch is on the remote, the local base branch did not move, and the worktree waits.
    expect(git(core.repo, "ls-remote", "origin", "refs/heads/flywheel/*")).not.toBe("");
    expect(git(core.repo, "rev-parse", "main")).toBe(mainBefore);
    expect(git(core.repo, "branch", "--list", "flywheel/*")).not.toBe("");

    // The forge merges the request: Check now moves the Story to Merged and cleans up.
    stub.setRequestState("MERGED");
    await landing.getByRole("button", { name: "Check FLY-2 now" }).click();
    await expect(page.getByRole("region", { name: "FLY-2 Parser" })).toContainText("Merged");
    await expect(page.getByRole("region", { name: "Landing" })).toHaveCount(0);
    expect(git(core.repo, "branch", "--list", "flywheel/*")).toBe("");
    expect(git(core.repo, "rev-parse", "main")).toBe(mainBefore);
    await shot("merged");
  },
);
