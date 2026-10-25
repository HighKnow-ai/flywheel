/**
 * Colour-vision-deficiency simulation and a separation metric (Phase 14 plan 08, VIS-03).
 *
 * What this implements, and from where:
 *
 *   SIMULATION. Machado, Oliveira and Fernandes (2009), "A Physiologically-based Model for Simulation
 *   of Color Vision Deficiency", IEEE TVCG 15(6), at severity 1.0 (a complete absence of the cone), one
 *   3x3 matrix per deficiency applied in LINEAR sRGB. The input is linearised with the same sRGB
 *   decoding `contrast.ts` uses, multiplied, clamped to [0, 1] and re-encoded. Every matrix row sums to 1,
 *   so a colour with no chroma maps to itself (asserted by cvd.test.ts).
 *
 *   METRIC. CIE76 colour difference, the Euclidean distance between the two colours in CIELAB (D65), taken
 *   on the SIMULATED pair, never on the originals: two colours a sighted person separates easily can be
 *   the same colour to someone else, and that is the case this measures.
 *
 *   ROUNDING (one rule, used here and nowhere else). A simulated colour is rounded to the nearest integer
 *   channel, 0 to 255, and is returned as a lowercase `#rrggbb`. The metric is computed from those
 *   rounded channels and rounded to two decimals. A pair is distinguishable when that rounded value is
 *   greater than or equal to the floor. The test applies the same rule, so a pair sitting on a floor is
 *   decided by the rule and not by a floating-point accident.
 *
 * No dependency. The reasons for the matrix family, the metric and the two floors, and the alternatives
 * rejected, are in 14-DIRECTION.md "CVD thresholds".
 */
import { hexToRgb, linearize } from "./contrast";

export type Deficiency = "protanopia" | "deuteranopia" | "tritanopia";
export const DEFICIENCIES: readonly Deficiency[] = ["protanopia", "deuteranopia", "tritanopia"];

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

/** Machado 2009, severity 1.0, applied to linear RGB. */
const MATRICES: Record<Deficiency, Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Inverse of `linearize`'s sRGB decoding, to a 0 to 255 channel (unrounded). */
const encode = (linear: number): number => {
  const c = Math.min(1, Math.max(0, linear));
  return 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
};

const toHex = (channels: number[]): string =>
  "#" + channels.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("");

/** `hex` as a person with `deficiency` sees it, as a lowercase `#rrggbb`. */
export function simulate(hex: string, deficiency: Deficiency): string {
  const lin = hexToRgb(hex).map(linearize);
  return toHex(MATRICES[deficiency].map((row) => encode(row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])));
}

export const simulateProtanopia = (hex: string): string => simulate(hex, "protanopia");
export const simulateDeuteranopia = (hex: string): string => simulate(hex, "deuteranopia");
export const simulateTritanopia = (hex: string): string => simulate(hex, "tritanopia");

/** sRGB hex to CIELAB under D65. */
function lab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(linearize);
  const xyz = [
    (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883,
  ];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = xyz.map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 colour difference between two `#rrggbb` colours, rounded to two decimals. 0 for equal, 100 for black on white. */
export function deltaE(a: string, b: string): number {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.round(Math.hypot(l1 - l2, a1 - a2, b1 - b2) * 100) / 100;
}

/** How far apart two colours are to a person with `deficiency`: the metric on the simulated pair. */
export function separation(a: string, b: string, deficiency: Deficiency): number {
  return deltaE(simulate(a, deficiency), simulate(b, deficiency));
}

/**
 * Floor for two INKS (a state word or glyph): the separation under which two category colours stop
 * being told apart at a glance without a side-by-side comparison. See 14-DIRECTION.md.
 */
export const TEXT_FLOOR = 10;

/**
 * Floor for two WASHES. A wash is a faint ground tint held to the luminance budget of the weakest text
 * role, so it cannot be a strong identifier; the glyph and the word identify. It need only be a
 * perceptible difference, which is the classical just-noticeable difference of 2.3. See 14-DIRECTION.md.
 */
export const WASH_FLOOR = 2.3;

/** Symmetric by construction: the metric is, and `>=` is the whole comparison. */
export function distinguishable(a: string, b: string, deficiency: Deficiency, floor: number): boolean {
  return separation(a, b, deficiency) >= floor;
}
