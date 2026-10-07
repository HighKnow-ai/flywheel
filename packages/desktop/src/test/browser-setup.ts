import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * The browser arm's setup. Deliberately NOT `src/test/setup.ts`: that file stubs
 * `HTMLElement.prototype.offsetWidth`/`offsetHeight` to fixed numbers and installs a fake
 * `Element.prototype.scrollTo`, both of which exist only because jsdom has no layout. Loading them
 * here would overwrite the real engine's measurements with constants — destroying the very thing
 * these tests run in a browser to measure.
 *
 * `globals: false`, so Testing Library's auto-cleanup does not self-register (same reason as the
 * jsdom setup file).
 */
afterEach(() => {
  cleanup();
});
