/// <reference types="vite/client" />
/**
 * Part 1 of 2 of the stress screens (issue #192): 18 screens, each rendered over `stress-fixture.ts` or
 * as an empty or error state, and checked for layout defects at four window sizes. The steps the parts share are
 * in `stress-steps.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { useUiStore } from "../../state/uiStore";
import { useTriageDrawer } from "../../proposals/triageStore";
import { BIG } from "./stress-fixture";
import { at } from "../present";
import { capture, CRITIQUE_RUN, settle, writeDefectReport } from "./capture";
import { LONG_STORY, REVIEW_STORY, bigBoard, click, registerHooks } from "./stress-steps";

describe.runIf(CRITIQUE_RUN)("Stress screens (part 1 of 2)", () => {
  afterAll(() => writeDefectReport("stress-1"));
  registerHooks();

  it("s01 board of a big project: long names, nine Epics, fifty Stories", async () => {
    await bigBoard();
    await capture("s01-stress-board");
  });

  it("s02 board of a big project, the roster scrolled to its end", async () => {
    await bigBoard();
    const all = await screen.findAllByText(/Per-tenant monthly token budget|Show cost per RFP|Okta SAML/);
    const last = at(all, all.length - 1);
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
    const fold = (await screen.findAllByRole("button", { name: /since you last looked/i })).find((b) =>
      b.hasAttribute("aria-expanded"),
    ) as HTMLElement;
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
    const failed = at(calls, calls.length - 1);
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
    // Issue #205: Structured | Raw is a Toggle Group.
    await userEvent.click(await screen.findByRole("radio", { name: "Raw" }));
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
    const toggles = await within(card).findAllByRole("button", {
      name: /patch-sheet-xml-in-place|shared-strings-index/,
    });
    for (const t of toggles.slice(0, 2)) await userEvent.click(t);
    at(toggles, 0).scrollIntoView({ block: "start" });
    await capture("s17-stress-review-files");
  });
});
