import { configDefaults, defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "node:path";
import { testTimeScale } from "./src/test/time-scale";

/**
 * The real-browser arm of the suite (Phase 8 UAT items 1, 2 and 6).
 *
 * `vitest.config.ts` runs everything in jsdom, which has no layout engine, no `color-mix()`
 * resolution and no native button activation. Three Phase 08 verifications are *about* exactly
 * those three things:
 *
 *   - UAT 1: whether the diff's `color-mix()` row tints keep every syntax-token colour legible.
 *     `getComputedStyle` in jsdom returns the unresolved `color-mix(...)` text, so the ratio
 *     cannot be measured there at all.
 *   - UAT 2: whether the reader's scroll position survives checking a criterion. jsdom reports
 *     `scrollHeight === 0` for every element (see `src/test/setup.ts`), so nothing can scroll and
 *     the assertion would pass vacuously.
 *   - UAT 6: whether Enter/Space on a focused button still activate it through the `window`-level
 *     region bindings (CR-03). `__tests__/keyboard-activation.test.tsx` says so itself: "jsdom does
 *     not synthesize a click from Enter on a focused button", so it *models* the WebView rule
 *     rather than measuring it.
 *
 * WebKit is the browser because the macOS Tauri shell renders in WKWebView; it is the closest
 * engine to the one that actually ships. The viewport is a realistic review width — the surface
 * lays its three panes out with `clamp()`, so width is load-bearing for UAT 1 and 2.
 */
const REPO_ROOT = resolve(import.meta.dirname, "../..");

/**
 * A cache of its own for this run, when the caller names one. Vitest keeps the optimised dependencies and
 * the last run's results in `<cacheDir>/vitest/`, and two runs that share it overwrite each other's files.
 * `scripts/run-browser-arms.mjs` runs the arms side by side and gives each its own; a run of one arm does
 * not set it and uses Vite's default, as before.
 */
const cacheDir = process.env["FLYWHEEL_VITE_CACHE_DIR"];

export default defineConfig({
  ...(cacheDir ? { cacheDir } : {}),
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  // The two UAT screenshots are written into the phase folder at the repo root, which is outside
  // this package's Vite root; without this the write is refused by `server.fs.strict`.
  server: { fs: { allow: [REPO_ROOT] } },
  test: {
    include: ["src/**/*.browser.test.tsx"],
    // The design-critique harness (`src/test/critique/`) runs under `vitest.critique.config.ts` alone. Its
    // files check `CRITIQUE_RUN` and skip themselves here, but a skipped file still loads the whole app and
    // its fixtures first, and there are eight of them since the walk was split to run side by side (#1732).
    exclude: [...configDefaults.exclude, "src/test/critique/**"],
    setupFiles: ["./src/test/browser-setup.ts"],
    globals: false,
    // The jsdom arm's budget (`vitest.config.ts`). Vitest bounds every Playwright action by what is left of the
    // test's timeout, so the 5 s default made a long click-through (the Epic exit test takes 3.5 s idle) fail as
    // "locator.click: Timeout 450ms exceeded" on a loaded runner, with the click not at fault.
    // Times FLYWHEEL_TEST_TIME_SCALE (src/test/time-scale.ts), as the jsdom arm.
    testTimeout: 15000 * testTimeScale(),
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "webkit" }],
      viewport: { width: 1440, height: 900 },
    },
  },
});
