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

// jsdom has no `scrollIntoView`; cmdk (every Combobox and the command palette) scrolls its selected item into
// view with it as soon as a list opens.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
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
 *
 * IN-01 (01-REVIEW.md, closed in 01-21-PLAN.md Task 3): the floor clamp above is also joined by a
 * CEILING clamp, but not as the review's fix sketch suggested (`scrollHeight - offsetHeight`,
 * applied unconditionally). Verified directly against this repo's jsdom: every element reports
 * `scrollHeight === 0` and `clientHeight === 0`, because jsdom implements no layout at all — which
 * is exactly why this file already has to stub `offsetHeight` at 800 above. Applying the review's
 * clamp unguarded would compute `max(0, 0 - 800) = 0` for every element and silently clamp EVERY
 * programmatic scroll to zero, disabling the volume suite's `DEEP_SCROLL_OFFSET` and making the
 * G-01-4 regression tests pass for the wrong reason — the precise failure mode this stub exists to
 * prevent. The ceiling is therefore live ONLY when the target element reports a positive
 * `scrollHeight` (a caller that has explicitly given it one, as the test proving this does); it is
 * a complete no-op under jsdom's default zero-layout reality, leaving `DEEP_SCROLL_OFFSET` and
 * every other unclamped caller in this suite exactly as they were.
 */
if (typeof Element.prototype.scrollTo === "undefined") {
  Object.defineProperty(Element.prototype, "scrollTo", {
    configurable: true,
    value: function scrollTo(this: Element, arg?: number | ScrollToOptions) {
      const top = typeof arg === "number" ? arg : arg?.top;
      if (typeof top === "number") {
        let target = Math.max(0, top);
        if (this.scrollHeight > 0) {
          const visibleHeight = this.clientHeight || (this as unknown as HTMLElement).offsetHeight;
          const maxScrollTop = Math.max(0, this.scrollHeight - visibleHeight);
          target = Math.min(target, maxScrollTop);
        }
        this.scrollTop = target;
      }
      this.dispatchEvent(new Event("scroll"));
    },
  });
}
