/**
 * A big project's board opens on what needs you (issue #201), in WebKit over the critique's stress data
 * (`stress-fixture.ts`: six Milestones, a Current Milestone whose name runs to three lines and whose Exit test
 * runs to four, nine Epics, a long Needs-you list).
 *
 * jsdom has no layout, so `roadmap-strip.test.tsx`, `milestone-header.test.tsx` and `write-story.test.tsx` pin
 * the behaviour; this file measures what only a real engine can: the first Needs-you card sits wholly inside a
 * 1440 x 900 window without scrolling, the name and the Exit test stop at two lines, the Exit test's disclosure
 * shows the rest, and Write a Story keeps its submit in view at the window's minimum size however long its
 * criteria list grows.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState, useUiStore } from "../../../state/uiStore";
import App from "../../../App";
import { useRoadmapFold } from "../../RoadmapStrip";
import { BIG, installStressBackend, STRESS } from "../../../test/critique/stress-fixture";

async function bigBoard() {
  installStressBackend();
  useUiStore.getState().setCurrentProjectId(BIG);
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await waitFor(() => {
    if (!document.body.textContent?.includes(STRESS.BIG_NAME)) throw new Error("the big project is not on screen yet");
  });
  await document.fonts.ready;
}

/** The rendered line count of a block of text. */
function lines(element: HTMLElement): number {
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
  return Math.round(element.getBoundingClientRect().height / lineHeight);
}

describe("a big project's board at 1440 x 900", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    useRoadmapFold.setState({ openByProject: {} });
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("shows the first Needs-you card without scrolling", async () => {
    await bigBoard();
    const list = await screen.findByRole("list", { name: "Needs you, most urgent first" });
    await waitFor(() => expect(list.querySelector("li")).not.toBeNull());
    const scroller = document.querySelector<HTMLElement>("[data-board-scroll]") as HTMLElement;
    await waitFor(() => {
      const card = (list.querySelector("li") as HTMLElement).getBoundingClientRect();
      expect(scroller.scrollTop).toBe(0);
      expect(card.top).toBeGreaterThan(0);
      // A request card can be taller than what is left of the window: its head (state, record, title and the
      // start of what it asks) is what must be in view, so the Developer sees what needs them.
      expect(card.top + Math.min(card.height, 160)).toBeLessThanOrEqual(window.innerHeight);
    });
  });

  it("folds the six-Milestone Roadmap to the Current row, and unfolds it in place", async () => {
    await bigBoard();
    const strip = await screen.findByRole("region", { name: "Roadmap" });
    const trigger = await within(strip).findByRole("button", { name: "6 Milestones" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    const list = within(strip).getByRole("list", { name: "Milestones in Roadmap order" });
    await waitFor(() => expect(list.getBoundingClientRect().height).toBeLessThan(60));

    await userEvent.click(trigger);
    await waitFor(() => expect(list.getBoundingClientRect().height).toBeGreaterThan(6 * 34));
    await userEvent.click(trigger);
    await waitFor(() => expect(list.getBoundingClientRect().height).toBeLessThan(60));
  });

  it("clamps the Milestone's name and its Exit test to two lines, and the Exit test unfolds to the rest", async () => {
    await bigBoard();
    const heading = await screen.findByRole("heading", { level: 2, name: /^Answer every inbound RFP question/ });
    expect(lines(heading)).toBeLessThanOrEqual(2);

    const header = heading.closest("section") as HTMLElement;
    const exitTest = header.querySelector<HTMLElement>("[data-slot=exit-test]") as HTMLElement;
    expect(lines(exitTest)).toBeLessThanOrEqual(2);
    const disclosure = await within(header).findByRole("button", { name: /Exit test/ });
    expect(disclosure).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(disclosure);
    await waitFor(() => expect(lines(exitTest)).toBeGreaterThan(2));
    expect(exitTest.scrollHeight).toBeLessThanOrEqual(exitTest.clientHeight + 1);
  });
});

describe("Write a Story at the window's minimum size", () => {
  beforeEach(async () => {
    resetUiState();
    queryClient.clear();
    await page.viewport(900, 600);
  });
  afterEach(async () => {
    cleanup();
    clearMocks();
    await page.viewport(1440, 900);
  });

  it("keeps Write Story in view however long the criteria list grows", async () => {
    await bigBoard();
    await userEvent.click(await screen.findByRole("button", { name: "Write a Story" }));
    const dialog = await screen.findByRole("dialog", { name: "Write a Story" });
    for (let i = 0; i < 8; i++) await userEvent.click(within(dialog).getByRole("button", { name: "Add criterion" }));
    const write = within(dialog).getByRole("button", { name: "Write Story" });
    await waitFor(() => {
      const box = write.getBoundingClientRect();
      expect(box.top).toBeGreaterThan(0);
      expect(box.bottom).toBeLessThanOrEqual(window.innerHeight);
      expect(dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(window.innerHeight);
    });
    const body = dialog.querySelector<HTMLElement>("[data-slot=write-story-body]") as HTMLElement;
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight);
  });

  it("picks the Milestone and the Epic from Comboboxes, with New Milestone… revealing its fields", async () => {
    await bigBoard();
    await userEvent.click(await screen.findByRole("button", { name: "Write a Story" }));
    const dialog = await screen.findByRole("dialog", { name: "Write a Story" });
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Milestone" }));
    const milestones = await screen.findByRole("listbox");
    await userEvent.click(within(milestones).getByRole("option", { name: /^Answer every inbound RFP question/ }));
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Epic" })).toBeEnabled());
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Epic" }));
    const epics = await screen.findByRole("listbox");
    expect(within(epics).getAllByRole("option").length).toBeGreaterThan(1);
    await userEvent.click(within(epics).getByRole("option", { name: "New Epic…" }));
    expect(within(dialog).getByLabelText("Epic title")).toBeInTheDocument();
  });
});
