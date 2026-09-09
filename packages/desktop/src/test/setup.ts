import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * `vitest.config.ts` sets `globals: false`, so Testing Library's auto-detection of a global
 * `afterEach` for its automatic unmount-between-tests cleanup does not fire. Without this,
 * `render()` calls across tests in the same file accumulate DOM nodes, and text queries that are
 * unique within one render (e.g. a "No epic" pill) start matching leftover nodes from an earlier
 * test's render too.
 */
afterEach(() => {
  cleanup();
});

/**
 * `@tanstack/react-virtual` measures its scroll container via `element.offsetWidth`/
 * `offsetHeight` (see `getRect` in `@tanstack/virtual-core`). jsdom does not implement layout, so
 * these default to `0` for every element — without a fixed viewport size here, every virtualized
 * list (BoardView, and any future virtualized surface) would compute an empty visible range and
 * render zero rows in tests, regardless of how many items were supplied.
 */
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // jsdom has no ResizeObserver. `@tanstack/react-virtual` checks for its presence and no-ops
  // gracefully when absent (it still measures once via offsetWidth/offsetHeight below), but a
  // defined stub avoids every future consumer needing to guard against a missing global.
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  value: 800,
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  value: 1200,
});
