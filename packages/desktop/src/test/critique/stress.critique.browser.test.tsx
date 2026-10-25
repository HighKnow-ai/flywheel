/// <reference types="vite/client" />
/**
 * The screens the M2-to-M4 walk does not reach, and every screen again on stress data (issue #192).
 *
 * The walk (`m2-flow.critique.browser.test.tsx`) runs on clean data. This file renders the real `<App />` over
 * `stress-fixture.ts`: a project with a long name and path, fifty-odd Stories with long titles, a session log
 * shaped like real Claude CLI output, many Needs-you items and Proposals, a review with twenty-six files; plus
 * the empty projects, first run, Register project, an unreachable project, Settings, Worktrees, an orphaned run,
 * a missing `claude`, a read that fails, the launch sheet, the palette and the Merge dialogs. Each screen goes
 * through `capture()`: four window sizes, the layout-defect check, and in the critique run a screenshot.
 *
 * Screens are named `s<nn>-…` so they sort after the walk's numbered ones.
 */
import { Component, type ReactNode } from "react";
import { afterAll, afterEach, beforeEach, describe, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import { queryClient } from "../../adapters/queryClient";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { useTriageDrawer } from "../../proposals/triageStore";
import App from "../../App";
import { setReviewInFixture } from "./m2-fixture";
import { BIG, installStressBackend, setBigReviewMergeable, STRESS, type StressOptions } from "./stress-fixture";
import { capture, CRITIQUE_RUN, settle, writeDefectReport } from "./capture";

const { LONG_STORY, REVIEW_STORY } = STRESS;

/** Catches a render error, so a screen that crashes (as s33 did before #197) fails its own test, not the whole run. */
class CrashBoundary extends Component<{ children: ReactNode }, { crashed: boolean }> {
  state = { crashed: false };
  static getDerivedStateFromError() {
    return { crashed: true };
  }
  render() {
    return this.state.crashed ? <p role="alert">The app crashed</p> : this.props.children;
  }
}

async function renderApp(options: StressOptions = {}, before?: () => void) {
  installStressBackend(options);
  before?.();
  const root = document.getElementById("root") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(
    <CrashBoundary>
      <App />
    </CrashBoundary>,
    { container: root },
  );
  await settle(700);
}

async function bigBoard(before?: () => void, options: StressOptions = {}) {
  await renderApp(options, () => {
    useUiStore.getState().setCurrentProjectId(BIG);
    before?.();
  });
  await waitFor(() => {
    if (!document.body.textContent?.includes(STRESS.BIG_NAME)) throw new Error("the big project is not on screen yet");
  });
  if (!before) await screen.findAllByText(/Answer every inbound RFP question/);
  await settle();
}

async function click(label: string | RegExp, container: HTMLElement | null = null) {
  const scope = container ? within(container) : screen;
  await userEvent.click((await scope.findAllByRole("button", { name: label }))[0]);
}

describe.runIf(CRITIQUE_RUN)("Stress screens", () => {
  afterAll(() => writeDefectReport("stress"));
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    useTriageDrawer.getState().closeTriage();
    setReviewInFixture("judging");
    setBigReviewMergeable(false);
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("s01 board of a big project: long names, nine Epics, fifty Stories", async () => {
    await bigBoard();
    await capture("s01-stress-board");
  });

  it("s02 board of a big project, the roster scrolled to its end", async () => {
    await bigBoard();
    const all = await screen.findAllByText(/Per-tenant monthly token budget|Show cost per RFP|Okta SAML/);
    const last = all[all.length - 1];
    last.scrollIntoView({ block: "end" });
    await capture("s02-stress-board-scrolled");
  });

  it("s03 Needs you of a big project, scrolled to its last items", async () => {
    await bigBoard();
    const column = await screen.findByRole("region", { name: /^Needs you/ });
    const items = column.querySelectorAll("li");
    items[items.length - 1]?.scrollIntoView({ block: "end" });
    await capture("s03-stress-needs-you-scrolled");
  });

  it("s04 Needs you as a Sheet at the window's minimum width, on stress data", async () => {
    await page.viewport(900, 600);
    try {
      await bigBoard();
      await click(/^Open Needs you/);
      await screen.findByRole("dialog");
      await capture("s04-stress-needs-you-sheet-min-width", { sizes: [{ width: 900, height: 600 }] });
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("s05 Since you last looked, thirty of sixty-four events", async () => {
    await bigBoard();
    const fold = (await screen.findAllByRole("button", { name: /since you last looked/i })).find((b) => b.hasAttribute("aria-expanded")) as HTMLElement;
    if (fold.getAttribute("aria-expanded") !== "true") await userEvent.click(fold);
    (await screen.findByRole("list", { name: "Since you last looked" })).scrollIntoView({ block: "center" });
    await capture("s05-stress-since-you-last-looked");
  });

  it("s06 Story view: a 200-character title, 24 Tasks, 8 criteria with long Checks, 7 sessions", async () => {
    await bigBoard(() => useUiStore.getState().openStory(BIG, LONG_STORY.id));
    await screen.findAllByText(/Keep shared strings deduplicated/);
    await capture("s06-stress-story-view");
  });

  it("s07 Story view scrolled to its sessions", async () => {
    await bigBoard(() => useUiStore.getState().openStory(BIG, LONG_STORY.id));
    const sessions = await screen.findByRole("list", { name: `Sessions of ${LONG_STORY.key}` });
    sessions.scrollIntoView({ block: "end" });
    await capture("s07-stress-story-sessions");
  });

  it("s08 session feed of a real-shaped Claude CLI log, live", async () => {
    await bigBoard(() => useUiStore.getState().setActiveSessionId("ses-b1", LONG_STORY.id));
    await screen.findAllByText(/All six formatting tests pass now/);
    await capture("s08-stress-feed-live");
  });

  it("s09 session feed scrolled up through hooks, rate limits and failed commands", async () => {
    await bigBoard(() => useUiStore.getState().setActiveSessionId("ses-b1", LONG_STORY.id));
    await screen.findAllByText(/All six formatting tests pass now/);
    const feed = document.querySelector<HTMLElement>('[role="log"], [aria-label*="feed" i]');
    const scroller = feed?.closest<HTMLElement>(".overflow-y-auto") ?? feed;
    if (scroller) scroller.scrollTop = Math.max(0, scroller.scrollHeight / 2);
    await settle();
    await capture("s09-stress-feed-scrolled");
  });

  it("s10 session feed: a failed command expanded with its long output", async () => {
    await bigBoard(() => useUiStore.getState().setActiveSessionId("ses-b1", LONG_STORY.id));
    await screen.findAllByText(/All six formatting tests pass now/);
    const calls = await screen.findAllByRole("button", { name: /preserve-formatting\.test\.ts/ });
    const failed = calls[calls.length - 1];
    await userEvent.click(failed);
    failed.scrollIntoView({ block: "start" });
    await capture("s10-stress-feed-failed-call");
  });

  it("s11 session feed of a session ended by the usage limit", async () => {
    await bigBoard(() => useUiStore.getState().setActiveSessionId("ses-b0", LONG_STORY.id));
    await screen.findAllByText(/Picking up from the hand-off/);
    await capture("s11-stress-feed-ended");
  });

  it("s35 session feed of the 168-line synthetic log #190 was reproduced from, scrolled to its end", async () => {
    await bigBoard(() => useUiStore.getState().setActiveSessionId("ses-bsyn", LONG_STORY.id));
    await settle(1200);
    await capture("s35-synthetic-feed");
  });

  it("s12 session feed, View raw", async () => {
    await bigBoard(() => useUiStore.getState().setActiveSessionId("ses-b1", LONG_STORY.id));
    await click("View raw");
    await screen.findAllByText(/raw stream-json/);
    await capture("s12-stress-feed-raw");
  });

  it("s13 All agents across ten projects", async () => {
    await bigBoard(() => useUiStore.getState().setFleetSurface({ view: "fleet" }));
    await screen.findAllByText(new RegExp(LONG_STORY.key));
    await capture("s13-stress-fleet");
  });

  it("s14 Waiting on you queue: a long force-push, a long docker command, a long question", async () => {
    await bigBoard(() => useUiStore.getState().setFleetSurface({ view: "queue" }));
    await screen.findAllByText(/force-with-lease/);
    await capture("s14-stress-waiting-queue");
  });

  it("s15 Triage drawer with eighteen Proposals", async () => {
    await bigBoard(() => useTriageDrawer.getState().openTriage(BIG));
    await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await capture("s15-stress-triage-drawer");
  });

  it("s16 review card: 26 files on long paths, a long failing Check, an uncommitted file", async () => {
    await bigBoard(() => useUiStore.getState().openStory(BIG, REVIEW_STORY.id));
    await screen.findByRole("region", { name: "Review" });
    await capture("s16-stress-review-card");
  });

  it("s17 review card scrolled to its files, two diffs open", async () => {
    await bigBoard(() => useUiStore.getState().openStory(BIG, REVIEW_STORY.id));
    const card = await screen.findByRole("region", { name: "Review" });
    const toggles = await within(card).findAllByRole("button", { name: /patch-sheet-xml-in-place|shared-strings-index/ });
    for (const t of toggles.slice(0, 2)) await userEvent.click(t);
    toggles[0].scrollIntoView({ block: "start" });
    await capture("s17-stress-review-files");
  });

  it("s18 Merge with a failing Check: the confirmation", async () => {
    setBigReviewMergeable(true);
    await bigBoard(() => useUiStore.getState().openStory(BIG, REVIEW_STORY.id));
    const card = await screen.findByRole("region", { name: "Review" });
    await userEvent.click((await within(card).findAllByRole("button", { name: new RegExp(`^Merge ${REVIEW_STORY.key}`) }))[0]);
    await screen.findByRole("alertdialog");
    await capture("s18-stress-merge-confirm");
  });

  it("s19 Merge on clean data: every criterion accepted, one Check still failing, the confirmation", async () => {
    setReviewInFixture("override");
    await renderApp();
    await screen.findAllByText("Make clicking and navigation predictable");
    await click("Open review of FLY-3");
    const card = await screen.findByRole("region", { name: "Review" });
    await userEvent.click((await within(card).findAllByRole("button", { name: /^Merge FLY-3/ }))[0]);
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
    await renderApp({ noProjects: true, pickedFolder: "/Users/cymarechal/code/customer-demo-environments-for-the-q4-enterprise-roadshow" });
    await userEvent.click((await screen.findAllByRole("button", { name: /folder|register|add/i }))[0]);
    await settle();
    await capture("s25-register-project");
  });

  it("s26 Register project failed", async () => {
    await renderApp({
      noProjects: true,
      pickedFolder: "/Users/cymarechal/Downloads/not-a-repo",
      registerError: "/Users/cymarechal/Downloads/not-a-repo is not a git repository (git rev-parse --show-toplevel exited 128)",
    });
    await userEvent.click((await screen.findAllByRole("button", { name: /folder|register|add/i }))[0]);
    await settle();
    const confirm = screen.queryAllByRole("button", { name: /register|add|continue/i });
    if (confirm.length) await userEvent.click(confirm[0]);
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
  });

  it("s30 the board when its reads fail", async () => {
    await renderApp({ failing: ["roster_rows", "milestone_progress", "needs_you_list"] }, () => useUiStore.getState().setCurrentProjectId(BIG));
    await settle(1500);
    await capture("s30-board-read-error");
  });

  it("s31 the Story view when its reads fail", async () => {
    await renderApp({ failing: ["task_list", "criterion_list", "sessions_for_story"] }, () => useUiStore.getState().openStory(BIG, LONG_STORY.id));
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
