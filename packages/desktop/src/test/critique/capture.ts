/// <reference types="vite/client" />
/**
 * One capture of a screen at every window size (issue #192): the critique harness's shared step.
 *
 * `capture(name)` takes the page as the walk left it and, for each of the four window sizes, resizes the
 * viewport, lets the layout settle, runs the layout-defect check (`layout-defects.ts`) and, in the critique run,
 * writes a screenshot. The sizes are the window's minimum (900 × 600), two laptop sizes and a large desktop.
 *
 * Two runs use it:
 *
 * - `npm run test:critique` (both schemes, `CRITIQUE_SHOTS` on): PNGs to the git-ignored
 *   `target/critique-2026-10-m4/`, named `<screen>-<w>x<h>-<scheme>.png`, and every defect found to
 *   `layout-defects-<scheme>.json` beside them. The committed copies in `docs/design/critique-2026-10-m4/` are a
 *   chosen set of those PNGs converted with `cwebp -q 78`;
 * - `npm run test:layout-defects` (light only, no screenshots): the CI step. It fails on any defect that is not a
 *   known one below.
 */
import { expect } from "vitest";
import { commands, page } from "vitest/browser";
import { findLayoutDefects, type LayoutDefect, type LayoutDefectKind } from "./layout-defects";

export const SCHEME = (import.meta.env.VITE_CRITIQUE_SCHEME as string | undefined) ?? "light";
/** Whether this run writes screenshots (the critique run) or only checks the layout (CI). */
export const SHOTS = import.meta.env.VITE_CRITIQUE_SHOTS === "1";
/** Whether this run is a critique or layout-defect run at all: the ordinary browser arm skips the harness. */
export const CRITIQUE_RUN = Boolean(import.meta.env.VITE_CRITIQUE_SCHEME);

export const SIZES = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
  { width: 900, height: 600 },
  { width: 1920, height: 1200 },
] as const;

/** Relative to the test files in `src/test/critique/` (screenshots) and to the package root (written files). */
const SHOT_DIR = "../../../../../target/critique-2026-10-m4";
const FILE_DIR = "../../target/critique-2026-10-m4";

/**
 * Defects seen and filed, which the check reports but does not fail on until their Story lands. Each names the
 * Story that fixes it; remove the entry in the PR that merges the fix.
 */
interface KnownDefect {
  issue: number;
  kind: LayoutDefectKind;
  /** The screens it shows on. */
  screen: RegExp;
  /** Matched against the defect's `where`, when only some elements are known. */
  where?: RegExp;
}

export const KNOWN_DEFECTS: KnownDefect[] = [];

export interface CaptureRecord {
  screen: string;
  size: string;
  defects: (LayoutDefect & { known: number | null })[];
}

const records: CaptureRecord[] = [];

export async function settle(ms = 600) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await document.fonts.ready;
  // Two frames, so a ResizeObserver (the virtualised feed, the Needs-you breakpoint) has measured and re-rendered.
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

function knownIssue(screen: string, defect: LayoutDefect): number | null {
  const hit = KNOWN_DEFECTS.find(
    (k) => k.kind === defect.kind && k.screen.test(screen) && (!k.where || k.where.test(defect.where)),
  );
  return hit?.issue ?? null;
}

/**
 * Shoot and check the current page at every size. `sizes` narrows the set for a state that only exists at some
 * sizes (a Sheet that opens below 1280px); `restore` is the viewport left behind for the next step of the walk.
 */
export async function capture(
  screen: string,
  {
    sizes = SIZES,
    restore = { width: 1440, height: 900 },
  }: { sizes?: readonly { width: number; height: number }[]; restore?: { width: number; height: number } } = {},
) {
  const unknown: string[] = [];
  try {
    for (const size of sizes) {
      await page.viewport(size.width, size.height);
      await settle(SHOTS ? 500 : 250);
      const label = `${size.width}x${size.height}`;
      const defects = findLayoutDefects().map((d) => ({ ...d, known: knownIssue(screen, d) }));
      records.push({ screen, size: label, defects });
      for (const d of defects) if (d.known === null) unknown.push(`${label} ${d.kind}: ${d.detail} at ${d.where}`);
      if (SHOTS) await page.screenshot({ path: `${SHOT_DIR}/${screen}-${label}-${SCHEME}.png` });
    }
  } finally {
    await page.viewport(restore.width, restore.height);
  }
  expect.soft(unknown, `layout defects on ${screen}`).toEqual([]);
}

/** Write every defect this file found (known ones too) next to the screenshots. Call from `afterAll`. */
export async function writeDefectReport(file: string) {
  if (records.length === 0) return;
  await commands.writeFile(`${FILE_DIR}/layout-defects-${file}-${SCHEME}.json`, JSON.stringify(records, null, 2));
}
