import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { resolve } from "node:path";

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

export default defineConfig({
  plugins: [react()],
  // The two UAT screenshots are written into the phase folder at the repo root, which is outside
  // this package's Vite root; without this the write is refused by `server.fs.strict`.
  server: { fs: { allow: [REPO_ROOT] } },
  test: {
    include: ["src/**/*.browser.test.tsx"],
    setupFiles: ["./src/test/browser-setup.ts"],
    globals: false,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: "webkit" }],
      viewport: { width: 1440, height: 900 },
    },
  },
});
