import { describe, expect, it } from "vitest";
import { existsSync, globSync, readFileSync } from "node:fs";
// The spec the allowlist mirrors, read as bytes. The test fails in both directions: code that spends the
// brand where the spec is silent, and a use the allowlist names that the spec no longer does. Vite's `?raw`
// refuses a path outside the package root, so the spec (a planning file) is read with node:fs instead.
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ""));
const REPO = HERE.slice(0, HERE.indexOf("/packages/desktop/"));
const SPEC_DIR = "08.1-visual-polish-brand-assets-and-confirmed-motion-inserted/08.1-UI-SPEC.md";
// The spec lives under `.planning/phases/` while its milestone is open and moves to
// `.planning/milestones/<version>-phases/` when `/gsd-new-milestone` archives it. Both are read, newest
// first, so a milestone boundary cannot silently turn this guard off — a missing spec must FAIL the
// test, never skip it. (It did go missing once, at the v0.1.0 archive.)
const specSource = new TextDecoder().decode(
  readFileSync(
    [
      `${REPO}/.planning/phases/${SPEC_DIR}`,
      ...globSync(`${REPO}/.planning/milestones/*-phases/${SPEC_DIR}`).sort().reverse(),
    ].find(existsSync) ??
      `${REPO}/.planning/phases/${SPEC_DIR}`,
  ),
);

/**
 * The brand rule (08.1-UI-SPEC.md § "The brand rule (D-12), and the rule it replaced"), widened by D-199 and
 * enforced the way contrast.test.ts enforces contrast: against the shipped bytes, never a transcribed value.
 *
 * Every production source file is read through `?raw` (tests excluded). Two things are asserted:
 *   1. a file spends the brand token only where BRAND_USES lists it, and as many times as it lists;
 *   2. no stylesheet or component draws a coloured side border of 2px or more, except the selection rule.
 */

/**
 * THE allowlist. It mirrors § "The brand rule" in 08.1-UI-SPEC.md: eight permitted uses (seven by D-199, the developer's turn by D-203)
 * plus the two existing uses plan 11-18 recorded without deciding. `spec` is a phrase that must appear in that section, so
 * widening the code without widening the document is a failing test. Widen both together, or neither.
 *
 * `count` is the number of occurrences outside comments; a new use in an already-listed file changes it and fails.
 */
const USE = {
  progress: { spec: "the progress fill" },
  commitsAhead: { spec: "the commits-ahead annotation text" },
  textAction: { spec: "text links and text actions" },
  runStatus: { spec: "the run status" },
  authoringStage: { spec: "the live authoring stage" },
  // Decided by D-203 (owner, 2026-10-14): colour is the feed's only channel telling the two speakers apart.
  developerTurn: { spec: "the developer's own turn in the authoring feed" },
  // Recorded by plan 11-18, not decided by D-199 (the spec says so in its own words).
  proposalCount: { spec: "the pending-proposal count on an epic row" },
  selection: { spec: "the text-selection highlight" },
} as const;

const BRAND_USES: Record<string, { count: number; uses: (keyof typeof USE)[] }> = {
  "App.css": { count: 1, uses: ["selection"] },
  "board/BoardRow.tsx": { count: 2, uses: ["commitsAhead", "proposalCount"] },
  "board/BoardView.tsx": { count: 1, uses: ["textAction"] },
  "board/EpicHeaderRow.tsx": { count: 2, uses: ["progress", "commitsAhead"] },
  "board/TriageLane.tsx": { count: 2, uses: ["textAction"] },
  "item-detail/ActivityTrail.tsx": { count: 1, uses: ["textAction"] },
  "item-detail/ForgeSection.tsx": { count: 3, uses: ["textAction"] },
  "legend/runStatus.ts": { count: 1, uses: ["runStatus"] },
  "recovery/OrphanRecoveryModal.tsx": { count: 1, uses: ["runStatus"] },
  "review/EpicRequestSheet.tsx": { count: 1, uses: ["textAction"] },
  "session/FeedRow.tsx": { count: 1, uses: ["developerTurn"] },
  "session/SessionSurface.tsx": { count: 1, uses: ["authoringStage"] },
};

/** The token definitions themselves are not uses. */
const DEFINITIONS = new Set(["styles/tokens.css", "theme/tokens.ts"]);

const sources = import.meta.glob(
  ["../../**/*.{ts,tsx,css}", "!../../**/__tests__/**", "!../../**/*.test.*", "!../../test/**"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** Strip block comments, and line comments in code files (a `//` inside a string is a ponytail below). */
// ponytail: a `//` inside a string literal loses the rest of its line; it can only hide a use, never invent one.
function code(path: string, text: string): string {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, "");
  return path.endsWith(".css") ? noBlock : noBlock.replace(/(^|[^:\w"'`])\/\/.*$/gm, "$1");
}

/** A glob key is relative to this file (src/theme/__tests__); return the path under src/. */
function fromSrc(key: string): string {
  const parts = ["theme", "__tests__"];
  for (const seg of key.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return parts.join("/");
}

const files = Object.entries(sources)
  // Vite shortens a key to the nearest relative form (`../tokens.ts`), so resolve it back to a path under src/.
  .map(([path, text]) => [fromSrc(path), text] as const)
  .filter(([path]) => !DEFINITIONS.has(path))
  .map(([path, text]) => [path, code(path, text)] as const);

const BRAND = /--accent-(?:text-rack|text-strip|nontext)\b|#3c64dd|#5175e1/gi;

describe("the brand rule (08.1-UI-SPEC.md, widened by D-199 and D-203)", () => {
  it("reads real source (a stubbed ?raw would pass vacuously)", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(([p]) => p === "App.css")).toBe(true);
    expect(files.find(([p]) => p === "App.css")![1]).toContain("::selection");
  });

  it("spends the brand token only where the allowlist lists it, as often as it lists", () => {
    const found: Record<string, number> = {};
    for (const [path, text] of files) {
      const n = text.match(BRAND)?.length ?? 0;
      if (n > 0) found[path] = n;
    }
    const expected = Object.fromEntries(Object.entries(BRAND_USES).map(([p, u]) => [p, u.count]));
    expect(found, "a brand-token use outside BRAND_USES: widen 08.1-UI-SPEC.md § The brand rule AND the allowlist, or remove the use").toEqual(
      expected,
    );
  });

  it("lists only uses the spec names", () => {
    const spec = specSource.replace(/\s+/g, " ");
    const section = spec.slice(spec.indexOf("The brand rule (D-12)"));
    const named = new Set(Object.values(BRAND_USES).flatMap((u) => u.uses));
    for (const key of named) {
      expect(section, `08.1-UI-SPEC.md § The brand rule does not name "${USE[key].spec}"`).toContain(USE[key].spec);
    }
  });

  it("draws no coloured side border of 2px or more outside the selection rule", () => {
    // The craft floor's side-border ban (craft-floor.md). A-06 reserves the 2px side rule for selection, in
    // `--selection-rule`; `transparent` is the unselected half of the same rule.
    const SIDE = /(\d+)px solid ([^;`"',]+)/g;
    const ALLOWED = /^(?:var\(--selection-rule\)|\$\{selectionRule\}|transparent)$/;
    const offenders: string[] = [];
    for (const [path, text] of files) {
      // Per line, so both branches of `a ? "2px solid x" : "2px solid y"` are read.
      for (const line of text.split("\n").filter((l) => /border-?(?:left|right)\b(?!-)/i.test(l))) {
        for (const m of line.matchAll(SIDE)) {
          if (Number(m[1]) >= 2 && !ALLOWED.test(m[2].trim())) offenders.push(`${path}: ${m[0].trim()}`);
        }
      }
    }
    expect(offenders, "a coloured side stripe: use the control edge, or the selection rule").toEqual([]);
  });
});
