import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../contrast";
import { RACK, STRIP, INK, AGENT } from "../tokens";
// Vite's `?raw` import (declared by `vite/client.d.ts`, referenced from `src/vite-env.d.ts`) reads
// the file's real contents at import/transform time — this is what keeps the drift-check assertion
// below honest against the value the product actually ships, not a hand-copied literal.
import tokensCssSource from "../../styles/tokens.css?raw";

/**
 * The runnable assertion 01-UI-SPEC.md calls for in place of a comment
 * claiming a ratio ("These ratios are not the proof — a runnable assertion
 * is"). Every pair listed in "Pinned brand, and the lifts it requires" and
 * "Measured starting palette" has a corresponding assertion here, imported
 * from the shipped token constants — not re-typed literals — so a future
 * palette revision cannot quietly drop below AA without this suite failing.
 */
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

  it("clears AA for brand-coloured text on the rack (accentText on surfaceSecondary)", () => {
    expect(contrastRatio(RACK.accentText, RACK.surfaceSecondary)).toBeGreaterThanOrEqual(4.5);
  });

  it("clears AA for brand-coloured text on strip stock (INK.accentText on the reference stock)", () => {
    expect(contrastRatio(INK.accentText, STRIP.referenceStock)).toBeGreaterThanOrEqual(4.5);
  });

  it("pins accentNonText to non-text-only use: clears 3:1 but stays below 4.5:1 on the rack", () => {
    const ratio = contrastRatio(RACK.accentNonText, RACK.surfaceSecondary);
    expect(ratio).toBeGreaterThanOrEqual(3);
    expect(ratio).toBeLessThan(4.5);
  });

  it("clears AA for primary and muted rack text on surfaceSecondary", () => {
    expect(contrastRatio(RACK.textPrimary, RACK.surfaceSecondary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(RACK.textMuted, RACK.surfaceSecondary)).toBeGreaterThanOrEqual(4.5);
  });

  it("clears AA for ink on every one of the five strip-stock tints", () => {
    const tints = [STRIP.backlog, STRIP.todo, STRIP.inProgress, STRIP.inReview, STRIP.done];
    for (const tint of tints) {
      expect(contrastRatio(INK.textPrimary, tint)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("clears AA for destructive ink on the reference stock", () => {
    expect(contrastRatio(INK.destructive, STRIP.referenceStock)).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * The agent signal vocabulary's four new colour roles (02-UI-SPEC.md "Color Additions"). Every
 * ratio below is the runnable assertion the spec calls for in place of the table's own measured
 * numbers — imported from the shipped `AGENT` token constants, not re-typed literals.
 */
describe("AGENT tokens", () => {
  it("success-text-rack scores at least 7.0:1 against both rack surfaces", () => {
    expect(contrastRatio(AGENT.successTextRack, RACK.surfaceDominant)).toBeGreaterThanOrEqual(7.0);
    expect(contrastRatio(AGENT.successTextRack, RACK.surfaceSecondary)).toBeGreaterThanOrEqual(7.0);
  });

  it("destructive-text-rack scores at least 5.0:1 against both rack surfaces", () => {
    expect(contrastRatio(AGENT.destructiveTextRack, RACK.surfaceDominant)).toBeGreaterThanOrEqual(5.0);
    expect(contrastRatio(AGENT.destructiveTextRack, RACK.surfaceSecondary)).toBeGreaterThanOrEqual(5.0);
  });

  it("blocked-text-rack scores at least 7.0:1 against both rack surfaces", () => {
    expect(contrastRatio(AGENT.blockedTextRack, RACK.surfaceDominant)).toBeGreaterThanOrEqual(7.0);
    expect(contrastRatio(AGENT.blockedTextRack, RACK.surfaceSecondary)).toBeGreaterThanOrEqual(7.0);
  });

  it("blocked-text-strip scores at least 4.5:1 against every one of the five workflow strip tints", () => {
    // Per-tint, not a representative swatch — a single failing tint must fail this test rather
    // than being averaged away (02-03-PLAN.md Task 1's own acceptance criterion).
    const tints = [STRIP.backlog, STRIP.todo, STRIP.inProgress, STRIP.inReview, STRIP.done];
    for (const tint of tints) {
      expect(
        contrastRatio(AGENT.blockedTextStrip, tint),
        `blocked-text-strip must clear 4.5:1 against strip tint ${tint}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("every AGENT key has a matching custom property in styles/tokens.css", () => {
    // camelCase key -> "--kebab-case" custom property name, e.g. successTextRack ->
    // --success-text-rack — the exact naming transform styles/tokens.css and theme/tokens.ts
    // already follow for every existing token group.
    const toCustomProperty = (key: string): string =>
      `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;

    for (const [key, value] of Object.entries(AGENT)) {
      const customProperty = toCustomProperty(key);
      const pattern = new RegExp(`${customProperty}:\\s*${value}\\s*;`);
      expect(
        tokensCssSource,
        `missing or mismatched custom property for AGENT.${key} — expected "${customProperty}: ${value};" in styles/tokens.css`,
      ).toMatch(pattern);
    }
  });
});
