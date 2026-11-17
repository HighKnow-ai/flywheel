/// <reference types="vite/client" />
/**
 * Part 6 of 6 of the Milestone 2 to 4 walk (issues #102, #192): 17 screens, each rendered, clicked to and
 * checked for layout defects at four window sizes. The steps the parts share, and why the walk is 6 files, are
 * in `m2-walk.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, it } from "vitest";
import { screen } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { at } from "../present";
import { CRITIQUE_RUN, settle, writeDefectReport } from "./capture";
import {
  boardReady,
  click,
  criteriaShaping,
  exitTestScene,
  openStory,
  registerHooks,
  roadmapStrip,
  rosterRowInView,
  shot,
  storyColumnsInView,
} from "./m2-walk";

describe.runIf(CRITIQUE_RUN)("M2 to M4 flow screens (part 6 of 6)", () => {
  afterAll(() => writeDefectReport("m2-flow-6"));
  registerHooks();

  it("60 Milestone header: every Epic Done, Confirm exit test (issue #134)", async () => {
    exitTestScene("milestone");
    await boardReady();
    await screen.findByRole("button", { name: "Confirm exit test of Shaping" });
    await roadmapStrip();
    await shot("60-milestone-confirm-exit-test");
  });

  it("61 Roadmap strip: a Done confirmed while a Round was open is noted on its band (issue #134)", async () => {
    exitTestScene("noted");
    await boardReady();
    await screen.findByText("Also noted: Epic FLY-8 done.");
    await roadmapStrip();
    await shot("61-roadmap-round-noted-trigger");
  });

  it("62 Another Milestone picked at the window's minimum width: Confirm exit test in Shaping's strip row (issue #134)", async () => {
    exitTestScene("milestone");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click(/^Board and review,/);
      await screen.findByRole("button", { name: "Confirm exit test of Shaping" });
      await roadmapStrip();
      await shot("62-milestone-row-confirm-exit-test-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("63 Epic shaping: the criteria Stage, criteria under each Story column and ghost criteria (issue #128)", async () => {
    criteriaShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByText("Accept all recommended answers every open question at once");
    await storyColumnsInView();
    await shot("63-epic-shaping-criteria");
  });

  it("64 Epic shaping: the Stage bar lists each Story with no criterion (issue #128)", async () => {
    criteriaShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByRole("list", { name: "Still open" });
    await shot("64-epic-shaping-criteria-stage-open");
  });

  it("65 Epic shaping: amending a proposed criterion under its Story (issue #128)", async () => {
    criteriaShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click(/^Amend the proposed criterion A pending spec change/);
    await screen.findByRole("textbox", { name: "Criterion" });
    await storyColumnsInView();
    await shot("65-epic-shaping-amend-criterion");
  });

  it("66 Epic shaping: confirming the last Stage's close, which makes the Epic and its Stories Ready (issue #128)", async () => {
    criteriaShaping({ closable: true });
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByText(/It is the Epic's last Stage/);
    await click("Close Stage");
    await screen.findByRole("alertdialog");
    await shot("66-epic-shaping-criteria-close-confirm");
  });

  it("68 Epic shaping: the last Stage closed, the Epic and its Stories Ready (issue #128)", async () => {
    criteriaShaping({ closable: true });
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click("Close Stage");
    await click("Close and make the Epic Ready");
    await screen.findByText("Every Stage is closed: shaping is done.");
    await screen.findByText(/the Epic and its 4 Stories are Ready/);
    await shot("68-epic-shaping-criteria-closed");
  });

  it("67 Epic shaping at the window's minimum width: criteria under the Story columns (issue #128)", async () => {
    criteriaShaping();
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open FLY-8 Epic shaping and its Rounds");
      await screen.findByText("Accept all recommended answers every open question at once");
      await storyColumnsInView();
      await shot("67-epic-shaping-criteria-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("116 board: + Story on an Epic card opens Write a Story with that Epic chosen (issue #168)", async () => {
    await boardReady();
    await userEvent.click(at(await screen.findAllByRole("button", { name: /^Add a Story to / }), 0));
    await screen.findByRole("dialog", { name: "Write a Story" });
    await shot("116-board-add-story-on-epic-card");
  });

  it("117 board: + Epic in the Milestone header opens Add an Epic on that Milestone (issue #168)", async () => {
    await boardReady();
    await click(/^Add an Epic to /);
    await screen.findByRole("dialog", { name: "Add an Epic" });
    await shot("117-board-add-epic-in-milestone-header");
  });

  it("118 Story view: Move to Epic lists the other open Epics under their Milestones (issue #168)", async () => {
    await boardReady();
    await openStory("FLY-4", "Make clicking and navigation predictable");
    await userEvent.click(await screen.findByRole("combobox", { name: "Move FLY-4 to another Epic" }));
    await screen.findByRole("listbox");
    await shot("118-story-move-to-epic");
  });

  it("119 Story view at the window's minimum width: Move to Epic beside Drop (issue #168)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await openStory("FLY-4", "Make clicking and navigation predictable");
      await userEvent.click(await screen.findByRole("combobox", { name: "Move FLY-4 to another Epic" }));
      await screen.findByRole("listbox");
      await shot("119-story-move-to-epic-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("83 board: roster rows from one core read, the rows that need you tinted with a word (issue #159)", async () => {
    await boardReady();
    await rosterRowInView("FLY-5");
    await shot("83-board-roster-rows");
  });

  it("84 board: an Epic in Shaping carries its shaping marker (issue #159)", async () => {
    await boardReady();
    await rosterRowInView("FLY-10");
    await shot("84-board-epic-shaping-marker");
  });

  it("87 board at the window's minimum width: the roster rows (issue #159)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await rosterRowInView("FLY-5");
      await shot("87-board-roster-rows-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("16 navigation: picking a project while the fleet is open", async () => {
    await boardReady();
    await click("Open fleet");
    await settle();
    await click("highknow-web");
    await shot("16-nav-project-click-keeps-fleet");
  });
});
