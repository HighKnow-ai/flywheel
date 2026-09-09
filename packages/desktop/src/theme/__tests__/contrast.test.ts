import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../contrast";
import { RACK, STRIP, INK } from "../tokens";

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
