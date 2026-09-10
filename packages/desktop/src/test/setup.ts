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

/**
 * `@tanstack/virtual-core`'s `elementScroll` (the function `scrollToIndex` ultimately calls)
 * invokes `instance.scrollElement?.scrollTo?.({ top, behavior })` — an *optional* call. jsdom
 * 30.0.1 implements `Element.prototype.scrollTop` as a stored, settable property, but implements
 * NO `Element.prototype.scrollTo` at all (verified: `typeof el.scrollTo === "undefined"`). Without
 * this stub, `scrollToIndex` is a silent no-op in every test — it throws nothing and moves
 * nothing — so a scroll-into-view regression test (G-01-4, 01-19-PLAN.md Task 1) would pass for
 * the wrong reason if this were missing. Accepts either a plain number (the legacy one-arg form)
 * or an options object; writes the vertical target onto the element's own `scrollTop`, clamped at
 * a floor of zero, then dispatches a `scroll` event so any listener (the virtualizer included)
 * re-reads the new offset — mirroring a real browser's async-but-eventually-consistent scroll.
 */
if (typeof Element.prototype.scrollTo === "undefined") {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: function scrollTo(this: Element, arg?: number | ScrollToOptions) {
      const top = typeof arg === "number" ? arg : arg?.top;
      if (typeof top === "number") {
        this.scrollTop = Math.max(0, top);
      }
      this.dispatchEvent(new Event("scroll"));
    },
  });
}
