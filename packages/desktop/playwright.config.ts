import { defineConfig, devices } from "@playwright/test";

/**
 * The end-to-end harness (`npm --prefix packages/desktop run e2e`): the real renderer in a real
 * browser, against the headless core and the real sidecar with a scripted fake agent. See
 * `e2e/README` in `packages/desktop/README.md`. Run it through that script: it stages the core first.
 *
 * WebKit is the engine behind the macOS WKWebView shell, so it is the first project. Chromium is the
 * second, for the same flows, because a locator that only one engine honours is a defect in the UI.
 */
const PORT = 1430;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // One flow at a time: each starts a core and a sidecar, and the gate runner shares this Mac.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { outputFolder: "e2e-results/report", open: "never" }]],
  outputDir: "e2e-results/artifacts",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // Saved for every run, green or red: a trace and a screenshot of each flow are the artifacts.
    trace: "on",
    screenshot: "on",
  },
  projects: [
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } } },
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    // The Vite flag selects the WebSocket transport (`src/adapters/ws-transport.ts`).
    command: `npx vite --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    env: { VITE_FLYWHEEL_E2E: "1" },
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
