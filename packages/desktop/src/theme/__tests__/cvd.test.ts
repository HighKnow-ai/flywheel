import { describe, expect, it } from "vitest";
import {
  DEFICIENCIES,
  TEXT_FLOOR,
  WASH_FLOOR,
  deltaE,
  distinguishable,
  separation,
  simulate,
  simulateDeuteranopia,
  simulateProtanopia,
  simulateTritanopia,
  type Deficiency,
} from "../cvd";
import { MODES, PALETTES, type Palette } from "../tokens";

/**
 * The three signal colours stay distinguishable to a person with protanopia, deuteranopia or tritanopia
 * (docs/design/direction.md § Colour: one meaning per colour). The method, the metric and the floors are
 * stated in theme/cvd.ts; this file opens with the primitives (a pair test on a broken transform is worse
 * than none) and then loops over every unordered pair of tones.
 *
 * Meaning never rests on colour: every state also carries its icon and word (components/StateBadge.tsx).
 * This proves the colour channel, the fastest one, does not collapse two tones for anyone.
 */

const TONES = ["attention", "running", "destructive", "neutral"] as const;
type Tone = (typeof TONES)[number];
type Part = "Fill" | "Ink";
const FLOORS: Record<Part, number> = { Fill: WASH_FLOOR, Ink: TEXT_FLOOR };

/**
 * What a tone paints. `Fill` is the pill ground (yellow, the Running pill's blue tint, red, the neutral grey);
 * `Ink` is the strongest mark it draws on a card (the yellow fill, the Running text, the red fill, body ink).
 */
function colourOf(p: Palette, tone: Tone, part: Part): string {
  const table: Record<Tone, Record<Part, keyof Palette>> = {
    attention: { Fill: "attention", Ink: "attention" },
    running: { Fill: "runningMuted", Ink: "running" },
    destructive: { Fill: "destructive", Ink: "destructive" },
    neutral: { Fill: "secondary", Ink: "foreground" },
  };
  return p[table[tone][part]];
}

/** Every unordered pair, each once, in declaration order. */
function unorderedPairs<T>(items: readonly T[]): [T, T][] {
  return items.flatMap((a, i) => items.slice(i + 1).map((b): [T, T] => [a, b]));
}

const grey = (n: number): string => "#" + n.toString(16).padStart(2, "0").repeat(3);

/** The first grey above mid-grey that is at least `floor` away from mid-grey: the floor, at one 8-bit step. */
function firstGreyAtFloor(floor: number): number {
  for (let n = 129; n <= 255; n += 1) if (deltaE(grey(128), grey(n)) >= floor) return n;
  throw new Error(`no grey reaches a separation of ${floor}`);
}

describe("simulation primitives", () => {
  it.each(DEFICIENCIES)("%s leaves a colour with no chroma unchanged", (deficiency) => {
    for (const g of ["#000000", "#404040", "#808080", "#c0c0c0", "#ffffff"]) {
      expect(simulate(g, deficiency), `${deficiency} changed the grey ${g}`).toBe(g);
    }
  });

  it("the three deficiencies are three transforms, not one applied three times", () => {
    const red = "#db1f2f";
    const results = [simulateProtanopia(red), simulateDeuteranopia(red), simulateTritanopia(red)];
    expect(new Set(results).size, `red simulated as ${results.join(", ")}`).toBe(3);
    for (const result of results) expect(result, "the simulation changed nothing").not.toBe(red);
  });

  it("the named exports are the generic one with the deficiency fixed", () => {
    expect(simulateProtanopia("#db1f2f")).toBe(simulate("#db1f2f", "protanopia"));
    expect(simulateDeuteranopia("#db1f2f")).toBe(simulate("#db1f2f", "deuteranopia"));
    expect(simulateTritanopia("#db1f2f")).toBe(simulate("#db1f2f", "tritanopia"));
  });

  it("is deterministic and always returns a lowercase six-digit hex", () => {
    for (const d of DEFICIENCIES) {
      const once = simulate("#9150d3", d);
      expect(simulate("#9150d3", d)).toBe(once);
      expect(once).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(deltaE("#9150d3", "#10798e")).toBe(deltaE("#9150d3", "#10798e"));
  });

  it("the metric is zero for the same colour, and 100 for black against white", () => {
    expect(deltaE("#9150d3", "#9150d3")).toBe(0);
    expect(deltaE("#000000", "#ffffff")).toBe(100);
  });

  it("is rounded by one rule: to two decimals, so a value on the floor is decided by the rule", () => {
    const d = deltaE("#db1f2f", "#10798e");
    expect(Math.round(d * 100) / 100).toBe(d);
  });
});

describe("distinguishability", () => {
  it("is symmetric: the verdict does not depend on which colour is named first", () => {
    for (const d of DEFICIENCIES) {
      for (const floor of [WASH_FLOOR, TEXT_FLOOR, 25]) {
        expect(distinguishable("#db1f2f", "#966708", d, floor)).toBe(distinguishable("#966708", "#db1f2f", d, floor));
      }
      expect(separation("#db1f2f", "#966708", d)).toBe(separation("#966708", "#db1f2f", d));
    }
  });

  it.each([
    ["text", TEXT_FLOOR],
    ["wash", WASH_FLOOR],
  ] as const)("a pair exactly at the %s floor passes and one 8-bit step below it fails", (_name, floor) => {
    const at = firstGreyAtFloor(floor);
    for (const d of DEFICIENCIES) {
      expect(deltaE(grey(128), grey(at)), "the constructed pair is at or above the floor").toBeGreaterThanOrEqual(floor);
      expect(distinguishable(grey(128), grey(at), d, floor), `${d}: a pair at the ${floor} floor must pass`).toBe(true);
      expect(deltaE(grey(128), grey(at - 1)), "the next step down is below the floor").toBeLessThan(floor);
      expect(distinguishable(grey(128), grey(at - 1), d, floor), `${d}: a pair one step below the ${floor} floor must fail`).toBe(false);
    }
  });

  it("the comparison itself is >=: a separation passes its own value and fails one rounding unit above it", () => {
    for (const d of DEFICIENCIES) {
      const s = separation("#db1f2f", "#10798e", d);
      expect(distinguishable("#db1f2f", "#10798e", d, s)).toBe(true);
      expect(distinguishable("#db1f2f", "#10798e", d, Math.round((s + 0.01) * 100) / 100)).toBe(false);
    }
  });

  it("identical colours are never distinguishable", () => {
    for (const d of DEFICIENCIES) expect(distinguishable("#966708", "#966708", d, 0.01)).toBe(false);
  });

  it("the floors are ordered: a wash is a ground tint, held to a lower floor than an ink", () => {
    expect(WASH_FLOOR).toBeLessThan(TEXT_FLOOR);
    expect(WASH_FLOOR).toBeGreaterThan(0);
  });
});

describe("every pair of tones is distinguishable under every deficiency", () => {
  it("covers the four tones, six pairs", () => {
    expect(unorderedPairs(TONES)).toHaveLength(6);
  });

  for (const mode of MODES) {
    for (const part of ["Fill", "Ink"] as const) {
      for (const deficiency of DEFICIENCIES as readonly Deficiency[]) {
        it(`${mode}: ${part.toLowerCase()} values, ${deficiency}`, () => {
          const p = PALETTES[mode];
          const floor = FLOORS[part];
          const collisions: string[] = [];
          for (const [a, b] of unorderedPairs(TONES)) {
            const ca = colourOf(p, a, part);
            const cb = colourOf(p, b, part);
            if (!distinguishable(ca, cb, deficiency, floor)) {
              collisions.push(`${mode}: ${a} ${ca} vs ${b} ${cb} collide under ${deficiency}: separation ${separation(ca, cb, deficiency)} < ${floor}`);
            }
          }
          expect(collisions, collisions.join("\n")).toEqual([]);
        });
      }
    }
  }
});
