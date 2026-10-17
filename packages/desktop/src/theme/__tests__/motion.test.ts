import { describe, expect, it } from "vitest";
import { MOTION } from "../tokens";

/**
 * The four durations the owner confirmed on 2026-10-08 (D-21) and the one that predates the phase, as the
 * typed motion export records them.
 */

const NEW_DURATIONS = ["durationPanel", "durationCollapse", "durationPalette", "durationSelect"] as const;
const LEGACY_DURATIONS = ["durationSettle"] as const;

describe("motion durations", () => {
  it("records each of the four as a millisecond value", () => {
    for (const key of NEW_DURATIONS) {
      expect(key in MOTION, `MOTION.${key} exists`).toBe(true);
      expect(MOTION[key], `MOTION.${key}`).toMatch(/^\d+ms$/);
    }
  });

  it("keeps the pre-existing settle duration, which other stylesheets reference", () => {
    for (const key of LEGACY_DURATIONS) {
      expect(key in MOTION, `MOTION.${key} exists`).toBe(true);
    }
  });

  it("keeps the retired displace token retired in the typed export", () => {
    // Owner decision 2026-10-08: row travel rides --duration-collapse; a declared-but-unreferenced
    // constant is the kind of dead value someone later "fixes" by wiring it back up.
    expect("durationDisplace" in MOTION).toBe(false);
  });
});
