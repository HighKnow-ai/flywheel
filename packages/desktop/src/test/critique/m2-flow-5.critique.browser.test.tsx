/// <reference types="vite/client" />
/**
 * Part 5 of 6 of the Milestone 2 to 4 walk (issues #102, #192): 18 screens, each rendered, clicked to and
 * checked for layout defects at four window sizes. The steps the parts share, and why the walk is 6 files, are
 * in `m2-walk.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, it } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { useTriageDrawer } from "../../proposals/triageStore";
import {
  setMakeReadyInFixture,
  setReviewInFixture,
  setJudgedOnInFixture,
  setTriageInFixture,
  setTriageDuplicateInFixture,
} from "./m2-fixture";
import { at } from "../present";
import { CRITIQUE_RUN, writeDefectReport } from "./capture";
import {
  boardReady,
  click,
  exitTestScene,
  openStory,
  registerHooks,
  rosterRowInView,
  shot,
  slicingShaping,
  storyColumnsInView,
} from "./m2-walk";

describe.runIf(CRITIQUE_RUN)("M2 to M4 flow screens (part 5 of 6)", () => {
  afterAll(() => writeDefectReport("m2-flow-5"));
  registerHooks();

  it("96 Needs you: the Proposals row, 4 from 3 Stories, and FLY-1's 3 Proposals on the roster (issue #162)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-kind="proposals"]');
      if (!el) throw new Error("no Proposals row yet");
      return el;
    });
    await screen.findByRole("button", { name: /^Triage 3 Proposals on/ });
    const column = await screen.findByRole("region", { name: /^Needs you/ });
    column.scrollIntoView({ block: "start" });
    row.scrollIntoView({ block: "nearest" });
    await shot("96-needs-you-proposals-row");
  });

  it("97 Triage drawer: grouped by Epic, then the Roadmap, each card with its change, why, evidence and filer (issue #162)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 4 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await within(drawer).findByText("Keyboard-first supervision");
    await shot("97-triage-drawer");
  });

  it("98 Triage drawer: Amend opens a New Story's title and description, the why kept in sight (issue #162)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 4 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await userEvent.click(await within(drawer).findByRole("button", { name: /^Amend New Story “Keyboard shortcuts/ }));
    await within(drawer).findByRole("textbox", { name: "Title" });
    await shot("98-triage-drawer-amend");
  });

  it("100 Needs you: judged-on changes ranked with Review, each with its before and after (issue #163)", async () => {
    setJudgedOnInFixture(true);
    await boardReady();
    const card = await screen.findByRole("group", { name: "Criterion, before and after" });
    card.closest("li")?.scrollIntoView({ block: "center" });
    await shot("100-needs-you-judged-on");
  });

  it("101 Needs you: editing a judged-on change in place (issue #163)", async () => {
    setJudgedOnInFixture(true);
    await boardReady();
    await click("Edit the Amend criterion on FLY-5");
    const field = await screen.findByRole("textbox", { name: "Your criterion" });
    field.closest("li")?.scrollIntoView({ block: "center" });
    await shot("101-needs-you-judged-on-edit");
  });

  it("108 Triage drawer: a duplicate New Story names what it repeats and who filed it (issue #165)", async () => {
    setTriageInFixture(true);
    setTriageDuplicateInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 5 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    const flag = await waitFor(() => {
      const el = drawer.querySelector<HTMLElement>("[data-duplicate-of]");
      if (!el) throw new Error("no duplicate flag yet");
      return el;
    });
    flag.closest("li")?.scrollIntoView({ block: "center" });
    await shot("108-triage-drawer-duplicate");
    setTriageDuplicateInFixture(false);
  });

  it("104 review card: the Decisions section's flags, and Not an ADR and Wrong decision beside Keep (issue #164)", async () => {
    setReviewInFixture("adr_flags");
    await boardReady();
    await click("Open review of FLY-3");
    const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
    await screen.findByText("Wording or supersede?");
    section.scrollIntoView({ block: "start" });
    await shot("104-review-card-adr-flags");
  });

  it("105 review card: a marked ADR holds Merge, and the composer lists the ADR review points it sends (issue #164)", async () => {
    setReviewInFixture("adr_flags");
    await boardReady();
    await click("Open review of FLY-3");
    await click("Request changes on FLY-3");
    await screen.findByRole("list", { name: "Also sent: 4 ADR review points" });
    (await screen.findByRole("button", { name: "Send FLY-3 back to Running" })).scrollIntoView({ block: "end" });
    await shot("105-review-card-adr-review-points");
  });

  it("106 review card: the flags and the three choices at the window's minimum width (issue #164)", async () => {
    setReviewInFixture("adr_flags");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open review of FLY-3");
      const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
      await screen.findByText("Wording or supersede?");
      section.scrollIntoView({ block: "start" });
      await shot("106-review-card-adr-flags-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("112 Triage drawer: a New Story's card lists the criteria it carries, each with its Check (issue #166)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 4 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    const list = at(await within(drawer).findAllByRole("list", { name: "Proposed Acceptance criteria" }), 0);
    list.scrollIntoView({ block: "center" });
    await shot("112-triage-drawer-new-story-criteria");
  });

  it("113 board: an accepted New Story's row offers Make Ready (issue #166)", async () => {
    setMakeReadyInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await rosterRowInView("FLY-12");
    await screen.findAllByRole("button", { name: "Make FLY-12 Ready" });
    await shot("113-board-make-ready-row");
  });

  it("114 Story view: Make Ready on a Shaping Story with its criteria (issue #166)", async () => {
    setMakeReadyInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await openStory("FLY-12", "Keyboard shortcuts for the roster's row actions");
    await screen.findByRole("heading", { name: /Keyboard shortcuts for the roster's row actions/ });
    await screen.findAllByRole("button", { name: "Make FLY-12 Ready" });
    await shot("114-story-view-make-ready");
  });

  it("115 Story view: Make Ready waits while the Story has no criterion (issue #166)", async () => {
    setMakeReadyInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await openStory("FLY-13", "Measure the board's first paint on a 40-Story project");
    await screen.findByText(/Make Ready waits/);
    await shot("115-story-view-make-ready-waits");
  });

  it("50 Epic shaping: slicing, the Stories as columns with ghost columns and their constraints (issue #127)", async () => {
    slicingShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await storyColumnsInView();
    await shot("50-epic-shaping-story-columns");
  });

  it("51 Epic shaping: amending a proposed Story in its ghost column (issue #127)", async () => {
    slicingShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click("Amend the proposed Story Slice an Epic into Stories as ghost columns");
    await screen.findByRole("textbox", { name: "Title" });
    await storyColumnsInView();
    await shot("51-epic-shaping-amend-story");
  });

  it("52 Epic shaping at the window's minimum width: the Story columns scroll sideways (issue #127)", async () => {
    slicingShaping();
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open FLY-8 Epic shaping and its Rounds");
      await storyColumnsInView();
      await shot("52-epic-shaping-story-columns-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("58 Epic card: every Story Merged, Confirm exit test (issue #134)", async () => {
    exitTestScene("epic");
    await boardReady();
    const confirm = await screen.findByRole("button", {
      name: "Confirm exit test of FLY-1 Design system and a legible app",
    });
    confirm.closest("section")?.scrollIntoView({ block: "center" });
    await shot("58-epic-confirm-exit-test");
  });

  it("59 Confirming an Epic's exit test: the dialog names the short roadmap Round it starts, and Not met (issue #134)", async () => {
    exitTestScene("epic");
    await boardReady();
    await click("Confirm exit test of FLY-1 Design system and a legible app");
    await screen.findByRole("alertdialog");
    await shot("59-epic-confirm-exit-test-dialog");
  });
});
