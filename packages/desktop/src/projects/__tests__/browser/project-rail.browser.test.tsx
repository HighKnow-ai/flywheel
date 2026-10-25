/**
 * Does the project rail fill the window's height at every size, and does the main pane scroll on its own (issue #191)?
 *
 * The bug: on the installed build the rail and its footer ended partway down the window, with the window
 * background below. The window itself had scrolled. `html`, `body`, `#root` and the shell were all exactly the
 * window's height, but absolutely positioned descendants of the main pane (the `sr-only` labels on Task rows,
 * among others) sit inside scroll containers that are not positioned, so their containing block is the initial
 * containing block, not the scroller. They were laid out at their place in the long, unscrolled content, far below
 * the window, and stretched the document's scrollable area to match. A wheel past the end of the main pane then
 * chained to the document and scrolled the whole shell, rail included.
 *
 * jsdom has no layout, so this runs the real `<App />` in WebKit (the engine closest to WKWebView) over the
 * critique's seeded fake backend, at the three window sizes the issue names, with a short main pane (the board)
 * and a long one (FLY-3, whose Story view runs to several screens).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import "../../../styles/globals.css";
import "../../../App.css";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import App from "../../../App";
import { installFixtureBackend } from "../../../test/critique/m2-fixture";

const SIZES = [
  [900, 600],
  [1440, 900],
  [1920, 1200],
] as const;

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await document.fonts.ready;
}

async function renderApp() {
  // The shipped page mounts into `#root`, which globals.css sizes to the window; render into the same node.
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
}

async function showLongPane() {
  await userEvent.click((await screen.findAllByRole("button", { name: /^Open Story FLY-3 / }))[0]);
  await screen.findByRole("heading", { name: /Sessions/ });
}

function rail(): HTMLElement {
  const nav = screen.getByRole("navigation", { name: "Projects" });
  const sidebar = nav.closest<HTMLElement>("[data-slot=sidebar]");
  expect(sidebar, "the rail is the shadcn Sidebar").not.toBeNull();
  return sidebar!;
}

/** The main pane's own scroller: the scroll container under `[data-slot=sidebar-inset]` with the most to scroll. */
function mainScroller(): HTMLElement {
  const inset = document.querySelector<HTMLElement>("[data-slot=sidebar-inset]");
  expect(inset, "the main pane is the shadcn SidebarInset").not.toBeNull();
  const scrollers = Array.from(inset!.querySelectorAll<HTMLElement>("*")).filter((el) =>
    ["auto", "scroll"].includes(getComputedStyle(el).overflowY),
  );
  return scrollers.sort((a, b) => b.scrollHeight - b.clientHeight - (a.scrollHeight - a.clientHeight))[0];
}

function expectRailFillsWindow(where: string) {
  const height = window.innerHeight;
  const box = rail().getBoundingClientRect();
  expect(box.top, `${where}: rail top`).toBe(0);
  expect(box.bottom, `${where}: rail bottom`).toBe(height);
  const footer = rail().querySelector<HTMLElement>("[data-slot=sidebar-footer]")!;
  expect(footer.getBoundingClientRect().bottom, `${where}: footer at the window's foot`).toBe(height);
  expect(screen.getByRole("button", { name: "Open Settings" }).getBoundingClientRect().bottom).toBeLessThanOrEqual(
    height,
  );
}

function expectWindowCannotScroll(where: string) {
  const doc = document.scrollingElement!;
  expect(doc.scrollHeight, `${where}: the document is no taller than the window`).toBe(window.innerHeight);
  window.scrollTo(0, 100_000);
  expect(window.scrollY, `${where}: the window does not scroll`).toBe(0);
}

describe("the project rail spans the window (issue #191)", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    installFixtureBackend();
  });
  afterEach(async () => {
    cleanup();
    clearMocks();
    window.scrollTo(0, 0);
    await page.viewport(1440, 900);
  });

  for (const [width, height] of SIZES) {
    it(`fills ${width} × ${height} with a short main pane`, async () => {
      await page.viewport(width, height);
      await renderApp();
      await settle();
      expectWindowCannotScroll(`${width}×${height} short`);
      expectRailFillsWindow(`${width}×${height} short`);
    });

    it(`fills ${width} × ${height} with a long main pane, and scrolling it leaves the rail in place`, async () => {
      await page.viewport(width, height);
      await renderApp();
      await showLongPane();
      await settle();
      expectWindowCannotScroll(`${width}×${height} long`);
      expectRailFillsWindow(`${width}×${height} long`);

      const scroller = mainScroller();
      expect(scroller.scrollHeight, "the long pane overflows its scroller").toBeGreaterThan(scroller.clientHeight);
      const railBefore = rail().getBoundingClientRect().toJSON();
      scroller.scrollTop = scroller.scrollHeight;
      await settle();
      expect(scroller.scrollTop, "the main pane scrolled").toBeGreaterThan(0);
      expect(rail().getBoundingClientRect().toJSON(), "the rail did not move").toEqual(railBefore);
      expectWindowCannotScroll(`${width}×${height} long, scrolled`);
      expectRailFillsWindow(`${width}×${height} long, scrolled`);
    });
  }
});

/**
 * ⌘B folds the rail to icons and back (issue #200), and folded it still spans the window at every size the
 * critique checks; each icon row names itself in a Tooltip, and a project shows its full name in one.
 */
describe("⌘B folds the rail to icons (issue #200)", () => {
  const FOUR_SIZES = [
    [900, 600],
    [1280, 800],
    [1440, 900],
    [1920, 1200],
  ] as const;

  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    installFixtureBackend();
  });
  afterEach(async () => {
    cleanup();
    clearMocks();
    window.scrollTo(0, 0);
    await page.viewport(1440, 900);
  });

  async function toggle() {
    await userEvent.keyboard("{Meta>}b{/Meta}");
    // The width change runs on the state duration; wait it out.
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  function railWidth(): number {
    return rail().querySelector<HTMLElement>("[data-slot=sidebar-container]")!.getBoundingClientRect().width;
  }

  for (const [width, height] of FOUR_SIZES) {
    it(`folds and unfolds at ${width} × ${height}, filling the window's height both ways`, async () => {
      await page.viewport(width, height);
      await renderApp();
      await settle();
      expect(railWidth(), "open, the rail is 248px").toBe(248);
      expectRailFillsWindow(`${width}×${height} open`);

      await toggle();
      expect(rail()).toHaveAttribute("data-state", "collapsed");
      expect(railWidth(), "folded, the rail is a 56px column").toBe(56);
      expectRailFillsWindow(`${width}×${height} folded`);
      expectWindowCannotScroll(`${width}×${height} folded`);
      // The main pane takes the room the rail gave up.
      const inset = document.querySelector<HTMLElement>("[data-slot=sidebar-inset]")!.getBoundingClientRect();
      expect(inset.left).toBe(56);
      expect(inset.right).toBe(width);
      // Every row still fits the column: nothing spills past its edge.
      for (const button of rail().querySelectorAll<HTMLElement>("[data-slot=sidebar-menu-button]")) {
        expect(button.getBoundingClientRect().right, button.getAttribute("aria-label") ?? "").toBeLessThanOrEqual(56);
      }

      await toggle();
      expect(rail()).toHaveAttribute("data-state", "expanded");
      expect(railWidth()).toBe(248);
    });
  }

  it("names every folded row in a Tooltip, and a project by its full name", async () => {
    await renderApp();
    await settle();
    await toggle();
    const settings = screen.getByRole("button", { name: "Open Settings" });
    await userEvent.hover(settings);
    await expect.poll(() => screen.queryByRole("tooltip")?.textContent ?? "").toContain("Settings");
    await userEvent.unhover(settings);
    await userEvent.hover(screen.getByRole("button", { name: "highknow-web" }));
    await expect.poll(() => screen.queryByRole("tooltip")?.textContent ?? "").toContain("highknow-web");
  });
});
