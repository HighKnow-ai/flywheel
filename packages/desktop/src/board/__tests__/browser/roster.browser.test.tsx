/**
 * The roster reads at a glance (issue #202), measured in WebKit: no Story key wraps at any of the four window
 * sizes, on a project whose keys are as long as the stress project's ("PRESALES-1001"), every title starts in
 * one column after its key, and the Done Epics fold at the end and open on click.
 *
 * jsdom has no layout, so whether a key breaks across lines can only be seen here. The real `<App />` runs over
 * the critique's seeded fixture backend with its keys and titles stretched.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import "../../../styles/globals.css";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import App from "../../../App";
import { answer, installFixtureBackend } from "../../../test/critique/m2-fixture";
import type { EpicDto, StoryDto } from "../../../adapters/tauri";

type Args = Record<string, unknown> | undefined;

const SIZES = [
  [900, 600],
  [1280, 800],
  [1440, 900],
  [1920, 1200],
] as const;

const LONG_TITLE =
  "Carry the presales qualification checklist through to the proposal so that nothing the customer said in discovery is lost on the way to a quote";

/** A Done Epic in the Current Milestone, all Merged: it should fold at the end of the roster. */
const DONE_EPIC: EpicDto = {
  id: "e-done",
  projectId: "p-fly",
  milestoneId: "m-3",
  key: "FLY-90",
  title: "Ship the first board",
  problem: null,
  scope: null,
  outOfScope: null,
  exitTest: null,
  state: "done",
  rank: "0",
};
const DONE_STORIES: StoryDto[] = [1, 2].map((n) => ({
  id: `s-done-${n}`,
  projectId: "p-fly",
  epicId: "e-done",
  key: `FLY-9${n}`,
  title: `Finished work ${n}`,
  description: null,
  state: "merged",
  runsAfterStoryId: null,
  rank: `0${n}`,
}));

/** "FLY-4" becomes "PRESALES-1004": the stress project's key prefix, four digits. */
const presales = (key: string) => key.replace(/^FLY-(\d+)$/, (_, n: string) => `PRESALES-${1000 + Number(n)}`);

function installStressedBackend() {
  installFixtureBackend();
  mockIPC(
    (cmd, payload) => {
      const args = payload as Args;
      if (cmd === "epic_list" && args?.milestoneId === "m-3") return [DONE_EPIC, ...(answer(cmd, args) as EpicDto[])];
      const base = answer(cmd, args);
      if (cmd === "story_list_for_project" && args?.projectId === "p-fly") {
        return [...DONE_STORIES, ...(base as StoryDto[])].map((story, index) => ({
          ...story,
          key: presales(story.key),
          title: index % 3 === 0 ? LONG_TITLE : story.title,
        }));
      }
      return base;
    },
    { shouldMockEvents: true },
  );
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 500));
  await document.fonts.ready;
}

async function renderBoard() {
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
  await settle();
}

/** Every mounted roster row's key and title boxes. */
function rowBoxes() {
  return Array.from(document.querySelectorAll<HTMLElement>("li[data-story-id]")).map((row) => {
    const key = row.querySelector<HTMLElement>("[data-slot=story-key]")!;
    const title = key.nextElementSibling as HTMLElement;
    return { row, key, title, text: key.textContent ?? "" };
  });
}

function expectKeysOnOneLine(where: string) {
  const rows = rowBoxes();
  expect(rows.length, `${where}: rows are mounted`).toBeGreaterThan(3);
  const titleLefts = new Set<number>();
  for (const { key, title, text } of rows) {
    const lineHeight = parseFloat(getComputedStyle(key).lineHeight);
    const box = key.getBoundingClientRect();
    expect(key.getClientRects().length, `${where}: ${text} is one box`).toBe(1);
    expect(box.height, `${where}: ${text} is one line`).toBeLessThan(lineHeight * 1.5);
    expect(key.scrollWidth, `${where}: ${text} is not clipped`).toBeLessThanOrEqual(Math.ceil(box.width));
    const titleBox = title.getBoundingClientRect();
    expect(titleBox.left, `${where}: ${text}'s title starts after its key`).toBeGreaterThanOrEqual(box.right);
    expect(Math.abs(titleBox.top - box.top), `${where}: ${text}'s title is on the key's line`).toBeLessThan(lineHeight);
    titleLefts.add(Math.round(titleBox.left));
  }
  expect([...titleLefts], `${where}: every title starts in one column`).toHaveLength(1);
}

describe("the roster reads at a glance (issue #202)", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    installStressedBackend();
  });
  afterEach(async () => {
    cleanup();
    clearMocks();
    await page.viewport(1440, 900);
  });

  for (const [width, height] of SIZES) {
    it(`never wraps a Story key at ${width} × ${height}`, async () => {
      await page.viewport(width, height);
      await renderBoard();
      expectKeysOnOneLine(`${width}×${height}`);
    });
  }

  it("folds the Done Epic at the end of the roster and opens it on click", async () => {
    await renderBoard();
    const fold = await screen.findByRole("button", { name: /1 Epic done/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Ship the first board Stories" })).toBeNull();
    const cards = Array.from(document.querySelectorAll("section[aria-labelledby^=epic-]"));
    for (const card of cards) {
      expect(card.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }

    fold.scrollIntoView({ block: "center" });
    await userEvent.click(fold);
    const done = await screen.findByRole("list", { name: "Ship the first board Stories" });
    const finished = await within(done).findByText("Finished work 2");
    // Visible once the disclosure has grown (or, under reduced motion, faded) in.
    await waitFor(() => expect(finished).toBeVisible());
    await settle();
    expectKeysOnOneLine("Done Epics open");
  });
});
