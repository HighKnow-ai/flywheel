#!/usr/bin/env node
/**
 * The desktop's browser arms, side by side (`npm --prefix packages/desktop run test:browser:arms`, the
 * `browser` job of CI): the layout-defect check, then the light, dark, reduced-motion and forced-colors arms.
 * Each arm is the npm script it always was, so one arm can still be run alone. This prints each arm's output
 * whole, in the order below, and exits 1 when any arm did.
 *
 * WHY SIDE BY SIDE (#1732). An arm waits on timers, on a browser and on the dev server; its CPU is idle most
 * of the time (the layout-defect run uses 4% of one core). At background priority on four efficiency cores
 * the five arms took 560, 50, 50, 50 and 5 s one after another, 12 minutes in all; the layout-defect run is
 * now 100 s (the walk is split in files and Vitest runs them side by side), and the five arms take 150 s.
 *
 * WHAT THE ARMS SHARE, AND HOW EACH IS KEPT APART:
 * - Vitest's cache (`<cacheDir>/vitest/`: the optimised dependencies and the last results). Each arm gets its
 *   own `FLYWHEEL_VITE_CACHE_DIR`, read by `vitest.browser.config.ts`.
 * - The dev server's port. Vitest takes the next free one when its own is taken, and each arm talks only to
 *   the server it started.
 * - The browser. Each arm starts its own, with its own profile.
 * - The files they write. The layout-defect run writes `target/critique-2026-10-m4/` (its own folder); the
 *   other arms write no file. (Screenshots are taken only when a run sets `CRITIQUE_SHOTS`/`SHOTS`, which this
 *   does not.)
 * - Nothing in `$HOME`: the browsers are the ones Playwright keeps in `~/Library/Caches/ms-playwright`, read-only.
 *
 * TWO AT A TIME, NOT FIVE. The layout-defect run is almost all waiting. The light, dark and motion arms are not:
 * each has a click-through that needs CPU (the Epic shaping flow, 3.5 s idle, a 15 s budget times
 * FLYWHEEL_TEST_TIME_SCALE). Run beside each other, with the layout run, on a loaded machine, that test took
 * 16.4 s of 15 s in all three arms (measured, #1732). One arm beside the layout run never did, so the pool is
 * two wide (fewer when FLYWHEEL_TEST_CONCURRENCY or the cores say so; see `scripts/lib/side-by-side.mjs`): the
 * layout run takes one lane and the other arms take the other, one after another. The longest arm is first,
 * so it starts at once.
 *
 *   node scripts/run-browser-arms.mjs            run every arm
 *   node scripts/run-browser-arms.mjs --list     print the commands and run nothing
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { concurrency, runAndReport } from "../../../scripts/lib/side-by-side.mjs";

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** How many arms run at once: the layout-defect run in one lane, the other arms one after another in the other. */
export const ARM_LANES = 2;

/** The arms, longest first: the name of its cache folder and the npm script of `package.json` that runs it. */
export const ARMS = [
  { name: "layout-defects", script: "test:layout-defects" },
  { name: "light", script: "test:browser" },
  { name: "dark", script: "test:browser:dark" },
  { name: "motion", script: "test:browser:motion" },
  { name: "forced-colors", script: "test:browser:forced-colors" },
];

/** One command per arm, with its own Vitest cache folder under `node_modules/.vite-arms/`. */
export function armCommands(desktop = DESKTOP) {
  return ARMS.map(({ name, script }) => ({
    argv: ["npm", "run", script],
    cwd: desktop,
    env: { FLYWHEEL_VITE_CACHE_DIR: path.join(desktop, "node_modules", ".vite-arms", name) },
    label: `npm run ${script}`,
  }));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--list")) {
    for (const c of armCommands()) process.stdout.write(`${c.label}  (cache ${c.env.FLYWHEEL_VITE_CACHE_DIR})\n`);
  } else if (
    (await runAndReport("browser arms", armCommands(), { cwd: DESKTOP, limit: Math.min(ARM_LANES, concurrency()) })) > 0
  ) {
    process.exitCode = 1;
  }
}
