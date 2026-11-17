/// <reference types="vite/client" />
/**
 * Part 2 of 2 of the stress screens (issue #192): 17 screens, each rendered over `stress-fixture.ts` or
 * as an empty or error state, and checked for layout defects at four window sizes. The steps the parts share are
 * in `stress-steps.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { useUiStore } from "../../state/uiStore";
import { setReviewInFixture } from "./m2-fixture";
import { BIG, setBigReviewMergeable } from "./stress-fixture";
import { at } from "../present";
import { capture, CRITIQUE_RUN, settle, SIZES, writeDefectReport } from "./capture";
import { LONG_STORY, REVIEW_STORY, bigBoard, click, registerHooks, renderApp } from "./stress-steps";

describe.runIf(CRITIQUE_RUN)("Stress screens (part 2 of 2)", () => {
  afterAll(() => writeDefectReport("stress-2"));
  registerHooks();

  it("s18 Merge with a failing Check: the confirmation", async () => {
    setBigReviewMergeable(true);
    await bigBoard(() => useUiStore.getState().openStory(BIG, REVIEW_STORY.id));
    const card = await screen.findByRole("region", { name: "Review" });
    await userEvent.click(
      at(await within(card).findAllByRole("button", { name: new RegExp(`^Merge ${REVIEW_STORY.key}`) }), 0),
    );
    const dialog = await screen.findByRole("alertdialog");
    await capture("s18-stress-merge-confirm");
    // Issue #207: once a known defect, now held. The failing Check's command runs past 150 characters, and at
    // 900 x 600 the confirm, its command and its buttons stay inside the window.
    await page.viewport(900, 600);
    await settle(250);
    const command = within(dialog).getByText(/preserve-formatting\.test\.ts/, { selector: "code" });
    expect(command.textContent?.length ?? 0).toBeGreaterThanOrEqual(150);
    for (const element of [dialog, command, ...within(dialog).getAllByRole("button")]) {
      const box = element.getBoundingClientRect();
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(window.innerWidth);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
    }
    await page.viewport(1440, 900);
  });

  it("s19 Merge on clean data: every criterion accepted, one Check still failing, the confirmation", async () => {
    setReviewInFixture("override");
    await renderApp();
    await screen.findAllByText("Make clicking and navigation predictable");
    await click("Open review of FLY-3");
    const card = await screen.findByRole("region", { name: "Review" });
    await userEvent.click(at(await within(card).findAllByRole("button", { name: /^Merge FLY-3/ }), 0));
    await screen.findByRole("alertdialog");
    await capture("s19-clean-merge-with-failing-check-confirm");
  });

  it("s20 Settings: credentials per project and many permission rules", async () => {
    await bigBoard(() => useUiStore.getState().setSettingsOpen(true));
    await screen.findAllByText(/docker compose -f infra/);
    await capture("s20-stress-settings");
  });

  it("s21 Worktrees: twenty-two worktrees on long branch names", async () => {
    await bigBoard(() => useUiStore.getState().setWorktreeInventoryOpen(true));
    await screen.findAllByText(/presales-1001/i);
    await capture("s21-stress-worktrees");
  });

  it("s22 an empty project: no Milestone yet", async () => {
    await renderApp({}, () => useUiStore.getState().setCurrentProjectId("p-empty"));
    await screen.findAllByText("scratch");
    await capture("s22-empty-project");
  });

  it("s23 a project with a Milestone and no Epic", async () => {
    await renderApp({}, () => useUiStore.getState().setCurrentProjectId("p-fresh"));
    await screen.findAllByText(/Rebuild a laptop from zero/);
    await capture("s23-milestone-without-epics");
  });

  it("s24 first run: no project registered", async () => {
    await renderApp({ noProjects: true });
    await capture("s24-first-run");
  });

  it("s25 Register project: the folder picked, its key prefix to confirm", async () => {
    await renderApp({
      noProjects: true,
      pickedFolder: "/Users/cymarechal/code/customer-demo-environments-for-the-q4-enterprise-roadshow",
    });
    await userEvent.click(at(await screen.findAllByRole("button", { name: /folder|register|add/i }), 0));
    await settle();
    await capture("s25-register-project");
  });

  it("s26 Register project failed", async () => {
    await renderApp({
      noProjects: true,
      pickedFolder: "/Users/cymarechal/Downloads/not-a-repo",
      registerError:
        "/Users/cymarechal/Downloads/not-a-repo is not a git repository (git rev-parse --show-toplevel exited 128)",
    });
    await userEvent.click(at(await screen.findAllByRole("button", { name: /folder|register|add/i }), 0));
    await settle();
    const confirm = screen.queryAllByRole("button", { name: /register|add|continue/i });
    const [first] = confirm;
    if (first) await userEvent.click(first);
    await settle();
    await capture("s26-register-project-error");
  });

  it("s27 a project whose folder is gone", async () => {
    await renderApp({}, () => useUiStore.getState().setCurrentProjectId("p-gone"));
    await screen.findAllByText(/legacy-billing-service/);
    await capture("s27-project-unreachable");
  });

  it("s28 an orphaned agent process found at launch", async () => {
    await renderApp({ orphans: true });
    await screen.findByRole("alertdialog");
    await capture("s28-orphan-recovery");
  });

  it("s29 claude not found on PATH", async () => {
    await renderApp({ claudeMissing: true });
    await screen.findAllByText(/was not found on PATH/);
    await capture("s29-claude-missing");
    // #210 (critique F6): the Alert sits in the flow under the andon strip at every size, never over a lamp.
    for (const size of SIZES) {
      await page.viewport(size.width, size.height);
      await settle(250);
      const strip = screen.getByRole("region", { name: "Agents" }).getBoundingClientRect();
      const alert = screen.getByRole("alert", { name: "Launch environment" }).getBoundingClientRect();
      expect
        .soft(alert.top, `${size.width}x${size.height}: the Alert's top against the strip's bottom`)
        .toBeGreaterThanOrEqual(strip.bottom);
    }
    await page.viewport(1440, 900);
  });

  it("s30 the board when its reads fail", async () => {
    await renderApp({ failing: ["roster_rows", "milestone_progress", "needs_you_list"] }, () =>
      useUiStore.getState().setCurrentProjectId(BIG),
    );
    await settle(1500);
    await capture("s30-board-read-error");
  });

  it("s31 the Story view when its reads fail", async () => {
    await renderApp({ failing: ["task_list", "criterion_list", "sessions_for_story"] }, () =>
      useUiStore.getState().openStory(BIG, LONG_STORY.id),
    );
    await settle(1500);
    await capture("s31-story-read-error");
  });

  it("s32 the launch sheet for a Ready Story", async () => {
    const ready = (await import("./m2-fixture")).SEED.STORIES.find((s) => s.projectId === BIG && s.state === "ready");
    await bigBoard(() => useUiStore.getState().setLaunchSheetStoryId(ready?.id ?? null));
    await screen.findByRole("dialog");
    await capture("s32-launch-sheet");
  });

  // #197 fixed the crash this scene first found (CommandDialog rendered its items outside cmdk's <Command>).
  it("s33 the command palette over a big project", async () => {
    await bigBoard();
    await click("Search, ⌘K");
    await screen.findByRole("dialog");
    await userEvent.keyboard("pre");
    await capture("s33-command-palette");
  });

  it("s34 Write a Story on a big project: nine Epics to pick from", async () => {
    await bigBoard();
    await click("Write a Story");
    await screen.findByRole("dialog");
    await capture("s34-stress-write-story");
  });
});
