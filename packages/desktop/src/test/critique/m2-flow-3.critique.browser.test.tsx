/// <reference types="vite/client" />
/**
 * Part 3 of 6 of the Milestone 2 to 4 walk (issues #102, #192): 18 screens, each rendered, clicked to and
 * checked for layout defects at four window sizes. The steps the parts share, and why the walk is 6 files, are
 * in `m2-walk.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, it } from "vitest";
import { screen } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { offerAdrsInShaping, setRoadmapRound, shapeMilestoneInFixture } from "./m2-fixture";
import { CRITIQUE_RUN, writeDefectReport } from "./capture";
import { boardReady, click, closableShaping, registerHooks, roadmapStrip, shot } from "./m2-walk";

describe.runIf(CRITIQUE_RUN)("M2 to M4 flow screens (part 3 of 6)", () => {
  afterAll(() => writeDefectReport("m2-flow-3"));
  registerHooks();

  it("37 Epic shaping: only the ADR is left, Accept all is off and says why (issue #129)", async () => {
    offerAdrsInShaping(true, true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const adr = await screen.findByRole("group", { name: "Question 5: Record the Stage close" });
    await screen.findByText("Only the ADR is left: answer it Yes or No.");
    adr.scrollIntoView({ block: "end" });
    await shot("37-epic-shaping-adr-only-left");
  });

  it("35 Epic shaping at the window's minimum width: an ADR question (issue #129)", async () => {
    offerAdrsInShaping(true);
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      const adr = await screen.findByRole("group", { name: "Question 5: Record the Stage close" });
      adr.scrollIntoView({ block: "start" });
      await shot("35-epic-shaping-adr-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("38 Epic shaping: the Stage bar lists what keeps the Stage open (issue #126)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    await screen.findByRole("list", { name: "Still open" });
    await shot("38-epic-shaping-stage-bar-open");
  });

  it("39 Epic shaping: nothing open, Close Stage is the next action (issue #126)", async () => {
    offerAdrsInShaping(true);
    closableShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByText(/Nothing in Challenge the spec is open/);
    await shot("39-epic-shaping-stage-closable");
  });

  it("40 Epic shaping: confirming Close Stage (issue #126)", async () => {
    offerAdrsInShaping(true);
    closableShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click("Close Stage");
    await screen.findByRole("alertdialog");
    await shot("40-epic-shaping-close-stage-confirm");
  });

  it("42 Epic shaping: the Slice Stage just opened, the Challenge Rounds below it (issue #126)", async () => {
    offerAdrsInShaping(true);
    closableShaping({ closed: true });
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByRole("heading", { name: "No Round yet in Slice into Stories" });
    await shot("42-epic-shaping-slice-opened");
  });

  it("41 Epic shaping at the window's minimum width: the Stage bar with open items (issue #126)", async () => {
    offerAdrsInShaping(true);
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      await screen.findByRole("list", { name: "Still open" });
      await shot("41-epic-shaping-stage-bar-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("43 Roadmap strip: Revisit roadmap, and the last Round said the Roadmap still holds (issue #133)", async () => {
    setRoadmapRound("holds");
    await boardReady();
    await screen.findByText("Roadmap still holds");
    await roadmapStrip();
    await shot("43-roadmap-revisit-holds");
  });

  it("44 Roadmap strip: the roadmap Round is reading the Roadmap (issue #133)", async () => {
    setRoadmapRound("working");
    await boardReady();
    await screen.findByText("The agent is reading the Roadmap");
    await roadmapStrip();
    await shot("44-roadmap-round-reading");
  });

  it("45 Roadmap strip: Waiting on you, three ghost rows and a rejected change (issue #133)", async () => {
    setRoadmapRound("waiting");
    await boardReady();
    await screen.findByRole("group", { name: /^Proposed: New Milestone "Relay and mobile"/ });
    await roadmapStrip();
    await shot("45-roadmap-ghost-rows");
  });

  it("46 Roadmap strip: Amend a proposed Milestone in place (issue #133)", async () => {
    setRoadmapRound("waiting");
    await boardReady();
    await click(/^Amend: New Milestone "Relay and mobile"/);
    await screen.findByRole("textbox", { name: "Outcome" });
    await roadmapStrip();
    await shot("46-roadmap-ghost-amend");
  });

  it("47 Roadmap strip: an open roadmap Round with no live session, Continue and Dismiss (issue #133)", async () => {
    setRoadmapRound("idle");
    await boardReady();
    await screen.findByText("No live session: your decisions are kept");
    await click("Dismiss Roadmap Round 2, rejecting 3 undecided changes");
    await screen.findByText(/Dismissing rejects the 3 undecided changes/);
    await roadmapStrip();
    await shot("47-roadmap-round-dismiss");
  });

  it("48 Waiting on you queue: a roadmap Round beside an Epic's Round (issue #133)", async () => {
    setRoadmapRound("waiting");
    await boardReady();
    await click(/^Open Waiting on you/);
    const item = await screen.findByRole("listitem", { name: "Roadmap Round 2 of the flywheel Roadmap" });
    item.scrollIntoView({ block: "center" });
    await shot("48-queue-roadmap-round");
  });

  it("49 Roadmap strip at the window's minimum width: ghost rows (issue #133)", async () => {
    setRoadmapRound("waiting");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await screen.findByRole("group", { name: /^Proposed: New Milestone "Relay and mobile"/ });
      await roadmapStrip();
      await shot("49-roadmap-ghost-rows-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("53 board: a Milestone in Shaping offers Shape on its strip row and in its header (issue #132)", async () => {
    await boardReady();
    await userEvent.click(await screen.findByRole("button", { name: /^Board and review, Shaping/ }));
    await screen.findByRole("heading", { name: "Board and review" });
    await shot("53-board-milestone-shape");
  });

  it("54 Milestone shaping: Round 1 of Exit test waiting on you beside the exit test and its ghost (issue #132)", async () => {
    shapeMilestoneInFixture("waiting");
    await boardReady();
    await click("Answer the Round on Board and review");
    await screen.findByRole("group", { name: "Proposed Exit test" });
    await shot("54-milestone-shaping-waiting");
  });

  it("55 Milestone shaping: nothing open, closing Exit test makes the Milestone Ready (issue #132)", async () => {
    shapeMilestoneInFixture("closable");
    await boardReady();
    await userEvent.click(await screen.findByRole("button", { name: /^Board and review, Shaping/ }));
    await click("Open the exit test of Board and review and its Rounds");
    await screen.findByText(/makes the Milestone Ready/);
    await shot("55-milestone-shaping-closable");
  });

  it("56 Milestone shaping: confirming Close Stage on Exit test (issue #132)", async () => {
    shapeMilestoneInFixture("closable");
    await boardReady();
    await userEvent.click(await screen.findByRole("button", { name: /^Board and review, Shaping/ }));
    await click("Open the exit test of Board and review and its Rounds");
    await click("Close Stage");
    await screen.findByRole("alertdialog");
    await shot("56-milestone-shaping-close-confirm");
  });
});
