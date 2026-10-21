import { defineConfig, mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import base from "./vitest.browser.config.ts";

/**
 * The design-critique screenshot run (issue #102): the browser arm, limited to
 * `src/test/critique/`, in one colour scheme chosen by `CRITIQUE_SCHEME` (`light` or `dark`).
 * Screenshots land in the git-ignored `target/critique-2026-10/`. Not part of CI.
 */
const scheme = process.env.CRITIQUE_SCHEME === "dark" ? "dark" : "light";

export default mergeConfig(
  base,
  defineConfig({
    test: {
      include: ["src/test/critique/*.critique.browser.test.tsx"],
      env: { VITE_CRITIQUE_SCHEME: scheme },
      browser: {
        provider: playwright({ contextOptions: { colorScheme: scheme } }),
      },
    },
  }),
);
