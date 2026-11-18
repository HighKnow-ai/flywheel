import { defineConfig, devices } from "@playwright/test";
import { testTimeScale } from "./src/test/time-scale";

/**
 * The end-to-end harness (`npm --prefix packages/desktop run e2e`): the real renderer in a real
 * browser, against the headless core and the real sidecar with a scripted fake agent. See
 * `e2e/README` in `packages/desktop/README.md`. Run it through that script: it stages the core first.
 *
 * WebKit is the engine behind the macOS WKWebView shell, so it is the first project. Chromium is the
 * second, for the same flows, because a locator that only one engine honours is a defect in the UI.
 */
// `e2e/run.mjs` picks a free port for each run and passes it down, so two runs on one machine (a
// developer's beside the gate runner's) never meet on one Vite server. Playwright loads this file again
// in every worker, so the port must come from the environment and never from a random pick here. 1430 is
// only the answer for `npx playwright test` run by hand.
const PORT = Number(process.env.FLYWHEEL_E2E_PORT ?? 1430);

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // TWO WORKERS. A worker runs one spec file at a time (`fullyParallel: false`). Each flow starts a core and a
  // sidecar of its own, on its own scratch root and ports, so two flows share nothing but the Vite server that
  // serves the renderer, which only reads (the isolation is audited in issue #1732). On the gate runner's Mac
  // (the four efficiency cores, a load of 15 to 80 from other agents) the suite took 468 s and 384 s at one
  // worker, 190 s and 296 s at two, and 258 s and 193 s at three. A third worker adds load and gains less
  // than the noise. `--workers=N` on the command line wins.
  workers: 2,
  fullyParallel: false,
  retries: 0,
  // Times FLYWHEEL_TEST_TIME_SCALE, which only a runner that knows it is slow sets (src/test/time-scale.ts).
  // At one worker the fleet flow took 22 s at a light load and 81 s at a heavy one, against this 120 s.
  timeout: 120_000 * testTimeScale(),
  expect: { timeout: 15_000 * testTimeScale() },
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
