import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import base from "./vitest.browser.config.ts";

/**
 * The design-critique harness (issues #102, #192): the browser arm, limited to `src/test/critique/`, in one
 * colour scheme chosen by `CRITIQUE_SCHEME` (`light` or `dark`). Every screen is captured at four window sizes
 * and run through the layout-defect check (`src/test/critique/capture.ts`).
 *
 * - `npm run test:critique`: both schemes, `CRITIQUE_SHOTS=1`, screenshots into the git-ignored
 *   `target/critique-2026-10-m4/`.
 * - `npm run test:layout-defects`: light, no screenshots. The CI step.
 *
 * The walk and the stress screens are eight files (`m2-flow-1` to `m2-flow-6`, `stress-1`, `stress-2`), and Vitest
 * runs the files side by side, each in its own page with its own viewport (#1732): a screen waits on timers, not
 * on the CPU (4% of one core for the whole run), so one worker for each file is the right size. VITEST_MAX_WORKERS
 * overrides `maxWorkers` here, as the gate sets it to four for the CPU-bound arms, so `test:layout-defects` sets
 * it to 8 itself.
 */
const scheme = process.env.CRITIQUE_SCHEME === "dark" ? "dark" : "light";

const config = mergeConfig(
  base,
  defineConfig({
    test: {
      env: { VITE_CRITIQUE_SCHEME: scheme, VITE_CRITIQUE_SHOTS: process.env.CRITIQUE_SHOTS === "1" ? "1" : "0" },
      // Four sizes per screen, each settled (and shot, in the critique run).
      testTimeout: 90_000,
      browser: {
        provider: playwright({ contextOptions: { colorScheme: scheme } }),
      },
    },
  }),
);

// `mergeConfig` concatenates arrays, so the base arm's `include` would run every browser test here too, and
// its `exclude` (which leaves this folder out) would leave out every test here.
config.test!.include = ["src/test/critique/*.critique.browser.test.tsx"];
config.test!.exclude = [...configDefaults.exclude];

export default config;
