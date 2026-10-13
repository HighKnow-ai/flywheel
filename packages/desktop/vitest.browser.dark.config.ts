import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import base from "./vitest.browser.config.ts";

/**
 * The browser arm under the dark appearance (Phase 8.1 plan 07, D-10 / D-19).
 *
 * Identical to `vitest.browser.config.ts` except for one thing: the Playwright context emulates
 * the dark colour scheme, so `@media (prefers-color-scheme: dark)` in `styles/tokens.css`
 * matches and the same test files measure the dark world. A separate config file rather than a
 * second `instances` entry is deliberate: per-instance context options are not documented as
 * available, and a second file is cheaper than discovering that at run time (RESEARCH Pattern 5).
 * Select it with `npm --prefix packages/desktop run test:browser:dark`.
 *
 * Note for anyone running the whole arm: the Phase 8 review tests write fixed-path UAT
 * screenshots into `.planning/`. Run under this config they overwrite the light ones; restore
 * them with `git checkout` before committing.
 */
export default mergeConfig(
  base,
  defineConfig({
    test: {
      // Read by `board/__tests__/browser/legibility.browser.test.tsx`, which fails if the engine
      // did not actually land in the scheme this config claims.
      env: { VITE_EXPECT_SCHEME: "dark" },
      browser: {
        provider: playwright({ contextOptions: { colorScheme: "dark" } }),
      },
    },
  }),
);
