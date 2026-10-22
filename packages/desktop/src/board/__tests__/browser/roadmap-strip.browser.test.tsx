/**
 * The Roadmap strip in WebKit (issue #131), with real layout, real key presses and a real drag.
 *
 * `roadmap-strip.test.tsx` asserts what each gesture asks of the core in jsdom, which has no layout and only
 * synthetic events. This file mounts the real shell (`<App />`) over the seeded fake backend the critique
 * harness uses (`test/critique/m2-fixture.ts`) and proves what jsdom cannot:
 * - the virtualised roster (#116) still starts below the Milestone header with the strip above it, and
 *   follows when the strip grows (its scroll margin is re-read);
 * - a native drag through the engine lands on `milestone_move` with the right anchor;
 * - the keyboard move keeps focus on the moved row's handle.
 *
 * What it does NOT prove: the Tauri IPC behind any read (the backend is the fixture), or that a packaged
 * WKWebView delivers the same drag events (this is Playwright's WebKit build).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import App from "../../../App";
import { answer } from "../../../test/critique/m2-fixture";

let moves: Record<string, unknown>[] = [];

async function boardReady() {
  const root = document.getElementById("root") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
  await screen.findByRole("list", { name: "Milestones in Roadmap order" });
}

function row(title: string): HTMLElement {
  return document.querySelector<HTMLElement>(`[data-milestone-title="${title}"]`) as HTMLElement;
}

/** The first Epic card's top edge sits below the Milestone header's bottom edge: nothing overlaps. */
async function expectRosterBelowHeader() {
  await waitFor(() => {
    const header = document.querySelector("[data-slot=milestone-header]") as HTMLElement;
    const card = document.querySelector("section[aria-labelledby^=epic-]") as HTMLElement;
    expect(header).toBeTruthy();
    expect(card).toBeTruthy();
    expect(card.getBoundingClientRect().top).toBeGreaterThanOrEqual(header.getBoundingClientRect().bottom);
  });
}

describe("the Roadmap strip in WebKit", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    moves = [];
    mockIPC(
      (cmd, payload) => {
        if (cmd === "milestone_move") moves.push(payload as Record<string, unknown>);
        return answer(cmd, payload as Record<string, unknown>);
      },
      { shouldMockEvents: true },
    );
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("keeps the virtualised roster below the header, also when the strip grows", async () => {
    await boardReady();
    await expectRosterBelowHeader();
    await userEvent.click(screen.getByRole("button", { name: "Add a Milestone" }));
    await screen.findByRole("textbox", { name: "New Milestone's outcome" });
    await expectRosterBelowHeader();
  });

  it("a native drag lands on milestone_move, before the row it is dropped on when moving up", async () => {
    await boardReady();
    await userEvent.dragAndDrop(row("One-week exit test"), row("Shaping"));
    await waitFor(() => expect(moves).toEqual([{ milestoneId: "m-5", beforeId: "m-3" }]));
  });

  it("the arrow keys on the handle move the Milestone and keep the focus there", async () => {
    await boardReady();
    const handle = within(row("Board and review")).getByRole("button", { name: "Move Board and review" });
    handle.focus();
    await userEvent.keyboard("{ArrowUp}");
    await waitFor(() => expect(moves).toEqual([{ milestoneId: "m-4", beforeId: "m-3" }]));
    expect(document.activeElement).toBe(handle);
  });
});
