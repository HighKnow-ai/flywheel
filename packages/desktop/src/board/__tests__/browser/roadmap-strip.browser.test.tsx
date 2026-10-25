/**
 * The Roadmap strip in WebKit (issue #131), over the critique's seeded backend (`m2-fixture.ts`).
 *
 * `roadmap-strip.test.tsx` pins the behaviour in jsdom, which has no layout and synthesises every event.
 * This file checks what only a real engine can: the virtualised roster (#116) still starts below the
 * Milestone header with the strip mounted above it (its scroll margin is re-read as the strip loads), and
 * the engine's own drag events and key presses reach `milestone_move` with the right anchor.
 *
 * It does not prove the Tauri IPC behind the reads (they are mocked), nor that a packaged WKWebView starts
 * a drag from a mouse gesture the way Playwright's WebKit build does.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import App from "../../../App";
import { answer } from "../../../test/critique/m2-fixture";

const moves: Record<string, unknown>[] = [];

async function boardReady() {
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
  return screen.findByRole("region", { name: "Roadmap" });
}

function row(title: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-milestone-title="${title}"]`) as HTMLElement;
}

describe("the Roadmap strip in WebKit", () => {
  beforeEach(() => {
    moves.length = 0;
    resetUiState();
    queryClient.clear();
    mockIPC(
      (cmd, payload) => {
        if (cmd === "milestone_move") {
          moves.push(payload as Record<string, unknown>);
          return null;
        }
        return answer(cmd, payload as Record<string, unknown> | undefined);
      },
      { shouldMockEvents: true },
    );
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("keeps the virtualised roster below the Milestone header and Since you last looked, with the strip above them", async () => {
    const strip = await boardReady();
    await within(strip).findByRole("list", { name: "Milestones in Roadmap order" });
    const header = await screen.findByRole("region", { name: "Shaping" });
    const since = await screen.findByRole("region", { name: "Since you last looked" });
    const firstCard = await screen.findByRole("region", { name: "Design system and a legible app" });
    await waitFor(() => {
      const stripBox = strip.getBoundingClientRect();
      const headerBox = header.getBoundingClientRect();
      const sinceBox = since.getBoundingClientRect();
      const cardBox = firstCard.getBoundingClientRect();
      expect(headerBox.top).toBeGreaterThanOrEqual(stripBox.bottom);
      expect(sinceBox.top).toBeGreaterThanOrEqual(headerBox.bottom);
      expect(cardBox.top).toBeGreaterThanOrEqual(sinceBox.bottom);
      // The gap-4 between regions, not an overlap or a hole left by a stale scroll margin.
      expect(sinceBox.top - headerBox.bottom).toBeLessThan(24);
      expect(cardBox.top - sinceBox.bottom).toBeLessThan(24);
    });
    // Unfolding the timeline pushes the roster down rather than sliding under it.
    since.querySelector("button")?.click();
    await within(since).findByRole("list", { name: "Since you last looked" });
    await waitFor(() => {
      const sinceBox = since.getBoundingClientRect();
      const cardBox = firstCard.getBoundingClientRect();
      expect(sinceBox.height).toBeGreaterThan(100);
      expect(cardBox.top).toBeGreaterThanOrEqual(sinceBox.bottom);
      expect(cardBox.top - sinceBox.bottom).toBeLessThan(24);
    });
  });

  it("a drag dropped on another row moves the Milestone just before or after it", async () => {
    await boardReady();
    await waitFor(() => expect(row("One-week exit test")).toBeTruthy());
    const transfer = new DataTransfer();
    row("One-week exit test").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    await waitFor(() => expect(row("One-week exit test").className).toContain("opacity-50"));
    row("Shaping").dispatchEvent(
      new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }),
    );
    await waitFor(() => expect(row("Shaping").dataset.drop).toBe("before"));
    row("Shaping").dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await waitFor(() => expect(moves).toEqual([{ milestoneId: "m-5", beforeId: "m-3" }]));
  });

  it("the arrow keys on a move handle move the Milestone, and Alt with an arrow on its row does too", async () => {
    await boardReady();
    const handle = await screen.findByRole("button", { name: "Move Board and review" });
    handle.focus();
    await userEvent.keyboard("{ArrowDown}");
    await waitFor(() => expect(moves).toEqual([{ milestoneId: "m-4", beforeId: null }]));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Move Board and review" }));

    screen.getByRole("button", { name: /^Board and review,/ }).focus();
    await userEvent.keyboard("{Alt>}{ArrowUp}{/Alt}");
    await waitFor(() => expect(moves[1]).toEqual({ milestoneId: "m-4", beforeId: "m-3" }));
  });

  it("a click on a row switches the header to that Milestone", async () => {
    await boardReady();
    await userEvent.click(await screen.findByRole("button", { name: /^Board and review,/ }));
    expect(await screen.findByRole("region", { name: "Board and review" })).toBeTruthy();
    expect(await screen.findByText("No Stories in this Milestone yet")).toBeTruthy();
  });
});
