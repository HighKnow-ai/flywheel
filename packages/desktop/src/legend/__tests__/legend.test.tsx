import { describe, expect, it } from "vitest";
import { MARKS } from "../marks";
import { STRIP } from "../../theme/tokens";

/**
 * The five strip tints are close in luminance by necessity, so the glyph and
 * the printed word are load-bearing rather than decorative (01-UI-SPEC.md
 * "Honest risk"). This test is what keeps a later simplification from
 * removing them, and what keeps the four row-state surfaces from silently
 * converging on the same value.
 */
describe("row-state surfaces", () => {
  it("are four pairwise-distinct values", () => {
    const values = [
      STRIP.rowSurface,
      STRIP.rowSurfaceHover,
      STRIP.rowSurfaceSelected,
      STRIP.rowSurfaceSelectedUnfocused,
    ];
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("MARKS registry", () => {
  it("gives every entry a non-empty glyph and label", () => {
    for (const mark of MARKS) {
      expect(mark.glyph.length).toBeGreaterThan(0);
      expect(mark.label.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    const ids = MARKS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
