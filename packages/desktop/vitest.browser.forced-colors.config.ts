import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import base from "./vitest.browser.config.ts";

/**
 * The browser arm with the engine in forced-colors mode (Phase 14 plan 08, criterion 3, T-14-08-04).
 *
 * Forced colors is the system (a Windows contrast theme: `forced-colors: active`) replacing the page's colours with
 * a small system palette. Everything in `styles/tokens.css` is then discarded, so whatever still tells one state from
 * another is the glyph, the word and any boundary: exactly what this arm measures. jsdom does not model the
 * substitution at all, so it is observable only in an engine.
 *
 * THE ENGINE IS CHROMIUM, NOT WEBKIT, and that is a measurement, not a preference. The other arms use WebKit because
 * the macOS shell renders in WKWebView. Forced colors is a Windows mechanism and the Windows shell renders in WebView2,
 * which is Chromium. Run under WebKit with `forcedColors: "active"`, `matchMedia("(forced-colors: active)")` reports
 * true but the engine substitutes nothing (a token colour such as rgb(150, 103, 8) was still the computed `color`),
 * so a WebKit arm would pass whether or not the product survives the substitution. The self-check in the test
 * file catches exactly that: it asserts the substitution happened, not only the media query.
 *
 * Differs from `vitest.browser.config.ts` in three things: the Playwright context emulates `forcedColors: "active"`,
 * the one instance is Chromium, and `include` is narrowed to the forced-colors test. The narrowing is required, not
 * tidiness: every other browser test MEASURES painted colour (contrast, tints, rings), which forced colors removes by
 * definition, so they fail here for the right reason and say nothing about the product. They run in the ordinary,
 * dark and motion arms. `mergeConfig` is not used (as the dark and motion arms
 * do) because it concatenates arrays, which would run WebKit as well; the shape is otherwise the same and is a
 * separate file for the same reason (per-instance context options are not documented as available).
 * Select it with `npm --prefix packages/desktop run test:browser:forced-colors`.
 * This arm writes no screenshots, so it carries no fixed-path warning.
 */
export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ["src/**/forced-colors.browser.test.tsx"],
    // Read by `board/__tests__/browser/forced-colors.browser.test.tsx`, which fails if the engine did not
    // actually land in the mode this config claims (and, in every other arm, if it landed there by accident).
    env: { VITE_EXPECT_FORCED_COLORS: "active" },
    browser: {
      ...base.test?.browser,
      provider: playwright({ contextOptions: { forcedColors: "active" } }),
      instances: [{ browser: "chromium" }],
    },
  },
});
