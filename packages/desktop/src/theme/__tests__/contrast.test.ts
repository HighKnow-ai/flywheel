import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../contrast";
import { ALIASES, MODES, PALETTES, type Mode, type Palette } from "../tokens";
// Vite's `?raw` import (declared by `vite/client.d.ts`, referenced from `src/vite-env.d.ts`) reads
// the file's real contents at import/transform time — this is what keeps the drift-check assertion
// below honest against the value the product actually ships, not a hand-copied literal.
import tokensCssSource from "../../styles/tokens.css?raw";

/**
 * The runnable assertion that owns every contrast number in the product (08.1-DIRECTION.md:
 * "The table is not the proof"). Driven by `MODES`, not by two hand-written sections, so a mode
 * added to `theme/tokens.ts` is asserted the moment it exists.
 */

const AA_TEXT = 4.5;
const NON_TEXT = 3;

type Role = keyof Palette;

/** Roles that paint text. Each must clear 4.5:1 on every surface text can sit on. */
const TEXT_ROLES: Role[] = [
  "textPrimaryRack",
  "textMutedRack",
  "accentTextRack",
  "successTextRack",
  "destructiveTextRack",
  "blockedTextRack",
];

/** Roles that paint a fill or an edge. Each must clear 3:1 (WCAG 1.4.11). */
const NON_TEXT_ROLES: Role[] = ["accentNontext", "focusRing", "borderControl"];

/** Every opaque ground a row's text can land on. `rowSurface` is transparent, so it is the ground. */
const SURFACES: Role[] = [
  "surfaceDominant",
  "surfaceSecondary",
  "rowSurfaceHover",
  "rowSurfaceSelected",
  "rowSurfaceSelectedUnfocused",
];

const toProp = (key: string): string => `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every custom-property name the stylesheet declared before the 08.1 re-theme. Token names stay
 * exactly as they were (re-theme by value, not by name), so none may disappear.
 */
const LEGACY_NAMES = [
  "--accent-nontext", "--accent-text-rack", "--accent-text-strip", "--blocked-text-rack",
  "--blocked-text-strip", "--destructive-strip", "--destructive-text-rack", "--divider",
  "--focus-ring", "--radius-chrome", "--radius-strip", "--row-surface", "--row-surface-hover",
  "--row-surface-selected", "--row-surface-selected-unfocused", "--space-2xl", "--space-3xl",
  "--space-lg", "--space-md", "--space-sm", "--space-xl", "--space-xs", "--strip-backlog",
  "--strip-done", "--strip-in-progress", "--strip-in-review", "--strip-todo",
  "--success-text-rack", "--surface-dominant", "--surface-secondary", "--text-muted-rack",
  "--text-muted-strip", "--text-primary-rack", "--text-primary-strip",
];

/** What in `palette` does not match the stylesheet. */
function driftErrors(mode: Mode, css: string): string[] {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(PALETTES[mode])) {
    const prop = toProp(key);
    if (!new RegExp(`${escapeRe(prop)}:\\s*${escapeRe(value)}\\s*;`).test(css)) {
      errors.push(`${mode}: expected "${prop}: ${value};" in styles/tokens.css`);
    }
  }
  return errors;
}

describe("relativeLuminance", () => {
  it("is 1 for white", () => {
    expect(relativeLuminance("#ffffff")).toBe(1);
  });

  it("is 0 for black", () => {
    expect(relativeLuminance("#000000")).toBe(0);
  });
});

describe("contrastRatio", () => {
  it("is 21 for white on black", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
  });
});

for (const mode of MODES) {
  const p = PALETTES[mode];

  describe(`${mode} mode contrast`, () => {
    it("every text role clears 4.5:1 on every surface", () => {
      for (const role of TEXT_ROLES) {
        for (const surface of SURFACES) {
          expect(
            contrastRatio(p[role], p[surface]),
            `${mode}: ${role} ${p[role]} on ${surface} ${p[surface]}`,
          ).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
    });

    it("every non-text role clears 3:1 on every surface", () => {
      for (const role of NON_TEXT_ROLES) {
        for (const surface of SURFACES) {
          expect(
            contrastRatio(p[role], p[surface]),
            `${mode}: ${role} ${p[role]} on ${surface} ${p[surface]}`,
          ).toBeGreaterThanOrEqual(NON_TEXT);
        }
      }
    });

    it("the control boundary clears 3:1 on ground and surface", () => {
      expect(contrastRatio(p.borderControl, p.surfaceDominant)).toBeGreaterThanOrEqual(NON_TEXT);
      expect(contrastRatio(p.borderControl, p.surfaceSecondary)).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it("the divider is a decorative hairline, deliberately NOT a control boundary", () => {
      // Measured (ground / surface): light 1.43 / 1.34, dark 1.20 / 1.16. A region separator,
      // not an interactive edge — which is exactly why `borderControl` exists as its own role.
      // Do not "fix" this hairline up to 3:1: that would turn every rule in the product into a
      // heavy line. It must stay visible at all and must not be what a control draws its edge from.
      for (const surface of ["surfaceDominant", "surfaceSecondary"] as const) {
        const ratio = contrastRatio(p.divider, p[surface]);
        expect(ratio, `${mode}: divider on ${surface}`).toBeGreaterThanOrEqual(1.1);
        expect(ratio, `${mode}: divider on ${surface}`).toBeLessThan(NON_TEXT);
      }
      expect(p.borderControl).not.toBe(p.divider);
    });

    it("the four row-state surfaces are pairwise distinct", () => {
      const values = [p.rowSurface, p.rowSurfaceHover, p.rowSurfaceSelected, p.rowSurfaceSelectedUnfocused];
      expect(new Set(values).size).toBe(values.length);
    });
  });
}

describe("brand lift", () => {
  const worstSurface = (p: Palette): string =>
    SURFACES.map((s) => p[s]).reduce((worst, s) =>
      contrastRatio("#ffffff", s) < contrastRatio("#ffffff", worst) ? s : worst,
    );

  it("light mode needs no lift: the brand text is the brand, and clears AA on its own", () => {
    expect(PALETTES.light.accentTextRack).toBe(PALETTES.light.accentNontext);
  });

  it("dark mode needs one: the unlifted brand clears 3:1 for a fill but fails 4.5:1 for text", () => {
    const dark = PALETTES.dark;
    const ratio = contrastRatio(dark.accentNontext, dark.surfaceSecondary);
    expect(ratio).toBeGreaterThanOrEqual(NON_TEXT);
    expect(ratio).toBeLessThan(AA_TEXT);
    expect(dark.accentTextRack).not.toBe(dark.accentNontext);
  });

  it("the dark lift is the minimum step that clears AA, not the retired over-lift", () => {
    const dark = PALETTES.dark;
    const ratio = contrastRatio(dark.accentTextRack, worstSurface(dark));
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio, "over-lifted: drifts further from the pinned hue than necessary").toBeLessThanOrEqual(5);
    expect(dark.accentTextRack).not.toBe("#7d99ff");
  });
});

describe("token names", () => {
  it("every custom-property name that existed before the re-theme is still declared", () => {
    for (const name of LEGACY_NAMES) {
      expect(tokensCssSource, `${name} was removed from styles/tokens.css`).toMatch(
        new RegExp(`${escapeRe(name)}\\s*:`),
      );
    }
  });

  it("every alias is still declared and still points at its target", () => {
    for (const [alias, target] of Object.entries(ALIASES)) {
      expect(tokensCssSource, `${toProp(alias)} must alias var(${toProp(target)})`).toMatch(
        new RegExp(`${escapeRe(toProp(alias))}:\\s*var\\(${escapeRe(toProp(target))}\\)\\s*;`),
      );
    }
  });
});

describe("typed mirror drift", () => {
  it.each(MODES)("the %s palette equals the stylesheet", (mode) => {
    expect(driftErrors(mode, tokensCssSource)).toEqual([]);
  });
});
