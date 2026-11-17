/// <reference types="vite/client" />
/**
 * Part 2 of 6 of the Milestone 2 to 4 walk (issues #102, #192): 17 screens, each rendered, clicked to and
 * checked for layout defects at four window sizes. The steps the parts share, and why the walk is 6 files, are
 * in `m2-walk.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, it } from "vitest";
import { screen } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { offerAdrsInShaping, setShapingSessionLive } from "./m2-fixture";
import { CRITIQUE_RUN, settle, writeDefectReport } from "./capture";
import { boardReady, click, openStory, registerHooks, shot } from "./m2-walk";

describe.runIf(CRITIQUE_RUN)("M2 to M4 flow screens (part 2 of 6)", () => {
  afterAll(() => writeDefectReport("m2-flow-2"));
  registerHooks();

  it("19 Stop confirmation from the agent station (issue #118)", async () => {
    await boardReady();
    await openStory("FLY-4", "Make clicking and navigation predictable");
    await click("Stop FLY-4");
    await screen.findByRole("alertdialog");
    await shot("19-story-stop-confirm");
  });

  it("20 Roadmap strip: another Milestone picked switches the header and roster (issue #131)", async () => {
    await boardReady();
    await click(/^Board and review, Shaping/);
    await screen.findByRole("region", { name: "Board and review" });
    await shot("20-roadmap-other-milestone");
  });

  it("21 Roadmap strip: + Milestone takes a one-line outcome (issue #131)", async () => {
    await boardReady();
    await click("Add a Milestone");
    await userEvent.type(
      await screen.findByRole("textbox", { name: "New Milestone's outcome" }),
      "Relay: the board on a phone",
    );
    await shot("21-roadmap-add-milestone");
  });

  it("22 Roadmap strip: dragging a Milestone shows where it lands (issue #131)", async () => {
    await boardReady();
    const row = (title: string) =>
      document.querySelector<HTMLElement>(`[data-milestone-title="${title}"]`) as HTMLElement;
    const transfer = new DataTransfer();
    row("One-week exit test").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    await settle(100);
    row("Board and review").dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    await screen.findByText("One-week exit test");
    await shot("22-roadmap-dragging");
    row("One-week exit test").dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  });

  it("23 Epic shaping: the Round dock waiting on you beside the Epic card (issue #123)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await screen.findByRole("region", { name: /Round 2/ });
    await shot("23-epic-shaping-round-dock");
  });

  it("24 Epic shaping: answering a question differently (issue #123)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await click("Answer question 3 differently");
    await screen.findByRole("textbox", { name: "Your answer to question 3" });
    await shot("24-epic-shaping-answer-differently");
  });

  it("26 board: an Epic whose shaping session waits on a Round offers Answer (issue #123)", async () => {
    await boardReady();
    const answer = await screen.findByRole("button", { name: "Answer the Round on FLY-8" });
    answer.scrollIntoView({ block: "center" });
    await shot("26-board-epic-answer");
  });

  it("25 Epic shaping at the window's minimum width: the dock first (issue #123)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      await screen.findByRole("region", { name: /Round 2/ });
      await shot("25-epic-shaping-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("27 Epic shaping: spec changes as ghost fields, a rejected one struck through (issue #125)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    const ghost = await screen.findByRole("group", { name: "Proposed Scope" });
    ghost.scrollIntoView({ block: "start" });
    await shot("27-epic-shaping-ghost-fields");
  });

  it("28 Epic shaping: amending a proposed spec change (issue #125)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await click("Amend the proposed Exit test");
    const field = await screen.findByRole("textbox", { name: "Your Exit test" });
    field.closest("[role=group]")?.scrollIntoView({ block: "center" });
    await shot("28-epic-shaping-amend");
  });

  it("29 Epic shaping: rejecting a proposed spec change with a reason (issue #125)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await click("Reject the proposed Scope");
    const reason = await screen.findByRole("textbox", { name: "Why not? (optional)" });
    await userEvent.type(reason, "Accept all is out of this Epic");
    reason.closest("[role=group]")?.scrollIntoView({ block: "center" });
    await shot("29-epic-shaping-reject-reason");
  });

  it("30 Epic shaping at the window's minimum width: rejecting a ghost field (issue #125)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      await click("Reject the proposed Scope");
      const reason = await screen.findByRole("textbox", { name: "Why not? (optional)" });
      await userEvent.type(reason, "Accept all is out of this Epic");
      reason.closest("[role=group]")?.scrollIntoView({ block: "center" });
      await shot("30-epic-shaping-ghost-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("31 board: a killed shaping session leaves Shaping Round waiting and Continue shaping (issue #124)", async () => {
    setShapingSessionLive(false);
    await boardReady();
    // The Epic card's own control: Needs you beside the roster (#156) offers Continue shaping too.
    const resume = (await screen.findAllByRole("button", { name: "Continue shaping FLY-8 Epic shaping" })).find((b) =>
      b.closest("section[aria-labelledby^='epic-']"),
    );
    resume?.scrollIntoView({ block: "center" });
    await shot("31-board-epic-continue-shaping");
  });

  it("32 Epic shaping: the open Round with no live session keeps its answers, Continue shaping on its band (issue #124)", async () => {
    setShapingSessionLive(false);
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByRole("region", { name: /Round 2/ });
    await shot("32-epic-shaping-continue");
  });

  it("33 Epic shaping: an ADR offered as a question, the draft beside its bar lines (issue #129)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const adr = await screen.findByRole("group", { name: "Question 5: Record the Stage close" });
    adr.scrollIntoView({ block: "center" });
    await shot("33-epic-shaping-adr-question");
  });

  it("34 Epic shaping: the Epic card's ADR and glossary chips (issue #129)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const chips = await screen.findByRole("list", { name: "ADRs and glossary" });
    chips.closest("section")?.scrollIntoView({ block: "start" });
    await shot("34-epic-shaping-adr-chips");
  });

  it("36 Epic shaping: an ADR answered Yes folds to a settled line (issue #129)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const folded = await screen.findByRole("group", { name: "Question 3: Record the shaping record" });
    folded.scrollIntoView({ block: "center" });
    await shot("36-epic-shaping-adr-answered");
  });
});
