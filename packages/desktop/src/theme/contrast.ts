/**
 * WCAG 2.x relative luminance and contrast ratio.
 *
 * This is the runnable assertion 01-UI-SPEC.md's "Pinned brand, and the
 * lifts it requires" section calls for in place of a comment claiming a
 * ratio: "These ratios are not the proof — a runnable assertion is."
 *
 * Implements the standard formula: sRGB channel normalisation (divide by
 * 255), the piecewise linearisation at the 0.03928 threshold, the 2.4 gamma,
 * the 0.2126/0.7152/0.0722 luminance coefficients, and the
 * `(L1 + 0.05) / (L2 + 0.05)` contrast ratio (lighter colour first).
 */

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return [r, g, b];
}

function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a `#rrggbb` colour, in the range [0, 1]. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const [rLin, gLin, bLin] = [linearize(r), linearize(g), linearize(b)];
  return 0.2126 * rLin + 0.7152 * gLin + 0.0722 * bLin;
}

/** WCAG contrast ratio between two `#rrggbb` colours, in the range [1, 21]. */
export function contrastRatio(a: string, b: string): number {
  const lumA = relativeLuminance(a);
  const lumB = relativeLuminance(b);
  const lighter = Math.max(lumA, lumB);
  const darker = Math.min(lumA, lumB);
  return (lighter + 0.05) / (darker + 0.05);
}
