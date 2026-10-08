import { describe, expect, it } from "vitest";
import { MOTION } from "../tokens";
// Raw source of the stylesheet the product actually ships: the drift guard (08.1 SC4 / D-21)
// compares the typed mirror against this text, not against a hand-copied literal.
import motionCssSource from "../../styles/motion.css?raw";

/**
 * The four durations the owner confirmed on 2026-10-08 (D-21), the one that predates the phase, and the rule that
 * every one of them is zeroed under `prefers-reduced-motion`. Block-aware for the same reason
 * `contrast.test.ts` is: a whole-file match passes whenever EITHER block carries the value.
 */

const NEW_DURATIONS = ["durationPanel", "durationCollapse", "durationPalette", "durationSelect"] as const;
const LEGACY_DURATIONS = ["durationSettle"] as const;
const ALL_DURATIONS = [...NEW_DURATIONS, ...LEGACY_DURATIONS] as const;

const toProp = (key: string): string => `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;

const REDUCE_BLOCK_START = /@media\s*\(\s*prefers-reduced-motion:\s*reduce\s*\)\s*\{/;

/** The stylesheet split at the reduced-motion media query, comments stripped. */
function blocks(css: string): { normal: Map<string, string>; reduced: Map<string, string>; reducedSource: string } {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = source.search(REDUCE_BLOCK_START);
  const normalSource = at === -1 ? source : source.slice(0, at);
  const reducedSource = at === -1 ? "" : source.slice(at);
  const read = (block: string) =>
    new Map(Array.from(block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g), (m) => [m[1], m[2].trim()] as const));
  return { normal: read(normalSource), reduced: read(reducedSource), reducedSource };
}

/** Everything in `css` that disagrees with the typed motion export. */
function driftErrors(css: string): string[] {
  const { normal, reduced, reducedSource } = blocks(css);
  const errors: string[] = [];
  for (const key of ALL_DURATIONS) {
    const prop = toProp(key);
    if (!(key in MOTION)) errors.push(`MOTION has no "${key}"`);
    else if (normal.get(prop) !== MOTION[key]) {
      errors.push(`expected "${prop}: ${MOTION[key]};" in the normal block, found ${JSON.stringify(normal.get(prop) ?? null)}`);
    }
    if (reduced.get(prop) !== "0s") {
      errors.push(`expected "${prop}: 0s;" in the reduced-motion block, found ${JSON.stringify(reduced.get(prop) ?? null)}`);
    }
  }
  // A property zeroed under reduced motion that the normal block never declares is a dead override.
  for (const prop of reduced.keys()) {
    if (prop.startsWith("--duration-") && !normal.has(prop)) {
      errors.push(`"${prop}" is zeroed under reduced motion but never declared in the normal block`);
    }
  }
  if (!/animation-duration:\s*0s\s*!important/.test(reducedSource)) errors.push("blanket animation rule missing");
  if (!/transition-duration:\s*0s\s*!important/.test(reducedSource)) errors.push("blanket transition rule missing");
  return errors;
}

describe("motion durations", () => {
  it("reads the real stylesheet, not vitest's empty CSS stub", () => {
    expect(motionCssSource).toContain("--ease");
  });

  it("names four durations, one per motion the contract names", () => {
    const { normal } = blocks(motionCssSource);
    for (const key of NEW_DURATIONS) {
      expect(normal.has(toProp(key)), `${toProp(key)} declared`).toBe(true);
      expect(key in MOTION, `MOTION.${key} exists`).toBe(true);
    }
  });

  it("declares each of the four with the value recorded in the typed export", () => {
    const { normal } = blocks(motionCssSource);
    for (const key of NEW_DURATIONS) {
      expect(MOTION[key], `MOTION.${key}`).toMatch(/^\d+ms$/);
      expect(normal.get(toProp(key)), toProp(key)).toBe(MOTION[key]);
    }
  });

  it("zeroes all four, and the pre-existing one, under reduced motion, with the blanket rule intact", () => {
    const { reduced, reducedSource } = blocks(motionCssSource);
    for (const key of ALL_DURATIONS) {
      expect(reduced.get(toProp(key)), toProp(key)).toBe("0s");
    }
    expect(reducedSource).toMatch(/animation-duration:\s*0s\s*!important/);
    expect(reducedSource).toMatch(/transition-duration:\s*0s\s*!important/);
  });

  it("fails a duration that is in the typed export but missing from the stylesheet", () => {
    const css = motionCssSource.replace(/\s*--duration-palette:\s*[^;]+;/, "");
    expect(driftErrors(css).join("\n")).toContain("--duration-palette");
  });

  it("fails a duration zeroed in the reduce block but absent from the normal block", () => {
    const at = motionCssSource.search(REDUCE_BLOCK_START);
    const normal = motionCssSource.slice(0, at).replace(/\s*--duration-select:\s*[^;]+;/, "");
    const css = normal + motionCssSource.slice(at);
    expect(driftErrors(css).join("\n")).toContain("never declared in the normal block");
  });

  it("fails a value that drifted in either direction", () => {
    const css = motionCssSource.replace(/--duration-panel:\s*[^;]+;/, "--duration-panel: 999ms;");
    expect(driftErrors(css).join("\n")).toContain("--duration-panel");
    const unzeroed = motionCssSource.replace(/--duration-collapse:\s*0s;/, "--duration-collapse: 180ms;");
    expect(driftErrors(unzeroed).join("\n")).toContain("--duration-collapse");
  });

  it("keeps the pre-existing settle duration, which other stylesheets reference", () => {
    const { normal } = blocks(motionCssSource);
    for (const key of LEGACY_DURATIONS) {
      expect(normal.get(toProp(key)), toProp(key)).toBe(MOTION[key]);
    }
  });

  it("keeps the retired displace token retired, in the stylesheet and the typed export", () => {
    // Owner decision 2026-10-08: row travel rides --duration-collapse; a declared-but-unreferenced
    // constant is the kind of dead value someone later "fixes" by wiring it back up.
    expect(motionCssSource.replace(/\/\*[\s\S]*?\*\//g, "")).not.toContain("--duration-displace");
    expect("durationDisplace" in MOTION).toBe(false);
  });

  it("agrees with the typed export in full, today", () => {
    expect(driftErrors(motionCssSource)).toEqual([]);
  });
});
