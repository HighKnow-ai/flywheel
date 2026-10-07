/**
 * Reading real painted colour out of a real engine.
 *
 * `review.css` expresses every diff row tint as `color-mix(in srgb, <token> 12%, transparent)`.
 * `color-mix` is resolved by the browser, and the result is partly transparent, so the colour a
 * reader actually sees is the composite of that tint over whatever is behind it. Neither half of
 * that exists in jsdom: `getComputedStyle` there hands back the unresolved `color-mix(...)` text
 * and there is no compositing at all. These helpers do what the engine does — read the resolved
 * value, then alpha-composite up the ancestor chain to the first opaque layer — so a contrast
 * number measured here is the number on screen.
 *
 * The WCAG arithmetic itself is NOT re-implemented: `relativeLuminance` is imported from
 * `theme/contrast.ts`, the same function `theme/__tests__/contrast.test.ts` asserts the palette
 * with, so the browser arm and the token arm cannot drift apart on the formula.
 */
import { relativeLuminance } from "../../../theme/contrast";

export type Rgba = [number, number, number, number];

/** Parses the forms a browser returns from `getComputedStyle`: `rgb()`, `rgba()`, `color(srgb …)`
 * and the `transparent` keyword. Throws on anything else rather than guessing — a silently
 * mis-parsed colour would make every assertion below meaningless. */
export function parseColor(value: string): Rgba {
  const text = value.trim();
  if (text === "transparent" || text === "") return [0, 0, 0, 0];

  const rgb = text.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const parts = rgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    return [r, g, b, a];
  }

  // Safari/WebKit returns wide-gamut-capable `color(srgb r g b / a)` for `color-mix(in srgb, …)`.
  const srgb = text.match(/^color\(srgb\s+([^)]+)\)$/i);
  if (srgb) {
    const parts = srgb[1].split(/[,/\s]+/).filter(Boolean).map(Number);
    const [r, g, b] = parts;
    const a = parts.length > 3 ? parts[3] : 1;
    return [r * 255, g * 255, b * 255, a];
  }

  throw new Error(`unparseable computed colour: ${JSON.stringify(value)}`);
}

/** `front` composited over `back` (source-over), both premultiplied out to plain sRGB. */
function over(front: Rgba, back: Rgba): Rgba {
  const a = front[3] + back[3] * (1 - front[3]);
  if (a === 0) return [0, 0, 0, 0];
  const channel = (i: 0 | 1 | 2) => (front[i] * front[3] + back[i] * back[3] * (1 - front[3])) / a;
  return [channel(0), channel(1), channel(2), a];
}

export function toHex([r, g, b]: Rgba): string {
  const byte = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
  return `#${byte(r)}${byte(g)}${byte(b)}`;
}

/**
 * The opaque colour actually painted behind `el`: every ancestor background from `el` outwards,
 * composited front-to-back, stopping at the first fully opaque one. `document.documentElement`'s
 * canvas is the floor; if even that is transparent the engine paints white, so white is the base.
 */
export function effectiveBackground(el: Element): Rgba {
  const layers: Rgba[] = [];
  for (let node: Element | null = el; node; node = node.parentElement) {
    const colour = parseColor(getComputedStyle(node).backgroundColor);
    if (colour[3] === 0) continue;
    layers.push(colour);
    if (colour[3] >= 1) break;
  }
  let composite: Rgba = [255, 255, 255, 1];
  for (let i = layers.length - 1; i >= 0; i -= 1) composite = over(layers[i], composite);
  return composite;
}

/** The colour of `el`'s text, composited over what is behind it (a token colour may itself carry
 * alpha). */
export function effectiveForeground(el: Element): Rgba {
  const colour = parseColor(getComputedStyle(el).color);
  if (colour[3] >= 1) return colour;
  return over(colour, effectiveBackground(el));
}

/** WCAG contrast ratio between the text of `el` and the surface painted behind it. */
export function paintedContrast(el: Element): number {
  const fg = relativeLuminance(toHex(effectiveForeground(el)));
  const bg = relativeLuminance(toHex(effectiveBackground(el)));
  const lighter = Math.max(fg, bg);
  const darker = Math.min(fg, bg);
  return (lighter + 0.05) / (darker + 0.05);
}
