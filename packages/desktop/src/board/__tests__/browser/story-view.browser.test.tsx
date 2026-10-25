/**
 * The Story view's title in WebKit (issue #204), over the critique's seeded backend (`m2-fixture.ts`) with one
 * Story's title stretched to 200 characters.
 *
 * jsdom has no layout, so `story-view.test.tsx` can only check that the heading names the whole title. This file
 * measures what the clamp is for: at 900 × 600 the title takes at most three lines and the live agent's station
 * starts inside the window, "Show full title" unclamps it in place, and the clamp holds at every window size the
 * critique checks.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { page } from "vitest/browser";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState, useUiStore } from "../../../state/uiStore";
import App from "../../../App";
import { answer } from "../../../test/critique/m2-fixture";

const LONG_TITLE = (
  "Make clicking and navigation predictable across the board, the Story view, the session feed and every dialog, " +
  "so the Developer never loses the place they were reading when an agent writes to the board"
).slice(0, 200);

async function openLongStory() {
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  act(() => useUiStore.getState().openStory("p-fly", "s-4"));
  const heading = await screen.findByRole("heading", {
    level: 1,
    name: new RegExp(`^FLY-4 ${LONG_TITLE.slice(0, 40)}`),
  });
  return heading;
}

/** How many lines of text an element draws: its height over its computed line height. */
function lines(element: HTMLElement): number {
  const lineHeight = parseFloat(getComputedStyle(element).lineHeight);
  return Math.round(element.getBoundingClientRect().height / lineHeight);
}

describe("the Story view's title in WebKit", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    mockIPC(
      (cmd, payload) => {
        const args = payload as Record<string, unknown> | undefined;
        const base = answer(cmd, args);
        if (cmd === "story_get" && args?.storyId === "s-4" && base) return { ...(base as object), title: LONG_TITLE };
        return base;
      },
      { shouldMockEvents: true },
    );
  });
  afterEach(async () => {
    cleanup();
    clearMocks();
    await page.viewport(1440, 900);
  });

  it("takes at most three lines at 900 × 600, with the station still in the window", async () => {
    expect(LONG_TITLE).toHaveLength(200);
    await page.viewport(900, 600);
    const heading = await openLongStory();
    await waitFor(() => expect(lines(heading)).toBeLessThanOrEqual(3));
    expect(lines(heading)).toBeGreaterThanOrEqual(2);
    // The clamp hides the rest, so the full title is one click away.
    const show = await screen.findByRole("button", { name: "Show full title" });
    const station = await screen.findByRole("region", { name: "Live agent" });
    expect(station.getBoundingClientRect().top).toBeLessThan(window.innerHeight);

    show.click();
    await waitFor(() => expect(lines(heading)).toBeGreaterThan(3));
    const less = screen.getByRole("button", { name: "Show less" });
    expect(less).toHaveAttribute("aria-expanded", "true");
    less.click();
    await waitFor(() => expect(lines(heading)).toBeLessThanOrEqual(3));
  });

  it.each([
    [1280, 800],
    [1440, 900],
    [1920, 1200],
  ])("takes at most three lines at %i × %i", async (width, height) => {
    await page.viewport(width, height);
    const heading = await openLongStory();
    await waitFor(() => expect(lines(heading)).toBeLessThanOrEqual(3));
    const card = heading.closest("section") as HTMLElement;
    // The title card's actions never squeeze the title into a sliver: it keeps most of the card's width.
    expect(heading.getBoundingClientRect().width).toBeGreaterThan(card.getBoundingClientRect().width * 0.45);
    expect(within(card).getByRole("button", { name: /Drop FLY-4/ })).toBeTruthy();
  });
});
