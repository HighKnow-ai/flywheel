import { describe, expect, it } from "vitest";
import { deltaE } from "../cvd";
import { MODES, PALETTES, type Palette } from "../tokens";

/**
 * Phase 14 plan 09 (VIS-06): how far each state wash sits from the ground it is drawn on, as the demonstration
 * board showed it. `contrast.test.ts` proves a wash can be no STRONGER than the weakest text role allows, and
 * `cvd.test.ts` proves the washes tell apart; neither says a wash can be SEEN. A wash held under every text floor
 * can sit 1.02 from the ground and read as nothing, which is what the dark needs-you wash did (14-04's finding).
 *
 * Measured with the same CIE76 difference `cvd.ts` uses, against the mode's ground, because the WCAG ratio is a
 * luminance ratio and says nothing about a tint's chroma. The numbers below are what the shipped values measure.
 */
const WASHES = ["NeedsYou", "Running", "Failed", "Merged"] as const;
const wash = (p: Palette, cls: (typeof WASHES)[number]) => p[`state${cls}Wash` as keyof Palette];

describe("state wash visibility against the ground", () => {
  it.each(MODES)("%s: every wash is a perceptible tint, not a rounding of the ground", (mode) => {
    const p = PALETTES[mode];
    for (const cls of WASHES) {
      expect(deltaE(wash(p, cls), p.surfaceDominant), `${mode} ${cls} wash against the ground`).toBeGreaterThanOrEqual(3.5);
    }
  });

  it("light: the class that asks something of the developer carries a wash that is plainly a plate, the strongest of the four", () => {
    const p = PALETTES.light;
    const needsYou = deltaE(wash(p, "NeedsYou"), p.surfaceDominant);
    expect(needsYou, "needs-you wash against the ground").toBeGreaterThanOrEqual(15);
    for (const cls of WASHES.filter((c) => c !== "NeedsYou")) {
      expect(needsYou, `needs-you against ${cls}`).toBeGreaterThan(deltaE(wash(p, cls), p.surfaceDominant));
    }
  });

  it("dark: the needs-you wash is as strong as the budget allows and that is faint (recorded, not hidden)", () => {
    // 14-DIRECTION.md, Ground lightness floor: the dark wash is bounded by the brand text lift (4.51 on the running
    // wash). A search over every colour within 15 degrees of the hue that clears every text and non-text floor and
    // the CVD wash floor found 4.79 at best, against 4.43 shipped. Nothing inside the envelope makes it read as a
    // plate, so the ink, the glyph and the word carry a dark needs-you state, and the wash only tints.
    const p = PALETTES.dark;
    const needsYou = deltaE(wash(p, "NeedsYou"), p.surfaceDominant);
    expect(needsYou).toBeGreaterThanOrEqual(3.5);
    expect(needsYou, "if this now exceeds 15 the finding in 14-DIRECTION.md is out of date").toBeLessThan(15);
  });
});
