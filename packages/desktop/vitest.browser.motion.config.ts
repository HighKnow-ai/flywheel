import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import base from "./vitest.browser.config.ts";

/**
 * The browser arm with the engine asked for reduced motion (Phase 8.1 plan 13, SC3 / T-08.1-34).
 *
 * Identical to `vitest.browser.config.ts` except for one thing: the Playwright context emulates
 * `prefers-reduced-motion: reduce`, so the stylesheet's reduce block matches and the same test
 * files measure the reduced world. Same shape as `vitest.browser.dark.config.ts`, for the same
 * reason (per-instance context options are not documented; a second file is cheaper).
 * Select it with `npm --prefix packages/desktop run test:browser:motion`.
 *
 * Note for anyone running the whole arm: the Phase 8 review tests write fixed-path UAT
 * screenshots into `.planning/`. Restore them with `git checkout` before committing.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      // Read by `board/__tests__/browser/motion.browser.test.tsx`, which fails if the engine did
      // not actually land in the setting this config claims.
      env: { VITE_EXPECT_MOTION: "reduce" },
      browser: {
        provider: playwright({ contextOptions: { reducedMotion: "reduce" } }),
      },
    },
  }),
);
