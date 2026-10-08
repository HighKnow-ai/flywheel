/**
 * Typed mirror of styles/tokens.css, one palette per supported mode.
 *
 * A colour role is a value PER MODE. `LIGHT` and `DARK` are both a `Palette`, so a role declared
 * in one mode and not the other does not typecheck, and theme/__tests__/contrast.test.ts
 * iterates `MODES` so a mode added here is asserted the moment it exists. The test also parses
 * styles/tokens.css block by block and asserts each palette equals the block for its mode — a
 * wrong dark value cannot hide behind a right light one. If a value here drifts from the
 * stylesheet, that test names the role and the mode.
 *
 * Keys are the custom-property names in camelCase (`textPrimaryRack` -> `--text-primary-rack`).
 * Token names were NOT renamed in the 08.1 re-theme; the `rack` suffix is semantic debt.
 */

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export interface Palette {
  /** Ground. */
  surfaceDominant: string;
  /** Surface. */
  surfaceSecondary: string;
  /** Region separator: a hairline, deliberately below 3:1. */
  divider: string;
  /** A control's visible boundary: at least 3:1 against ground and surface. */
  borderControl: string;
  textPrimaryRack: string;
  textMutedRack: string;
  /** Brand as TEXT. Equals the brand in light; lifted in dark. */
  accentTextRack: string;
  /** Brand as a fill or edge (the progress fill). */
  accentNontext: string;
  focusRing: string;
  /** Done. */
  successTextRack: string;
  /** Failed. */
  destructiveTextRack: string;
  /** Blocked: an agent is waiting on the owner. */
  blockedTextRack: string;
  rowSurface: string;
  rowSurfaceHover: string;
  rowSurfaceSelected: string;
  rowSurfaceSelectedUnfocused: string;
  scrim: string;
  shadowPopover: string;
  shadowDialog: string;
  shadowSheet: string;
}

export const LIGHT: Palette = {
  surfaceDominant: "#ffffff",
  surfaceSecondary: "#f6f8fa",
  divider: "#d1d9e0",
  borderControl: "#7a828c",
  textPrimaryRack: "#1f2328",
  textMutedRack: "#59636e",
  accentTextRack: "#3c64dd",
  accentNontext: "#3c64dd",
  focusRing: "#3c64dd",
  successTextRack: "#1a7f37",
  destructiveTextRack: "#cf222e",
  blockedTextRack: "#9a6700",
  rowSurface: "rgba(0, 0, 0, 0)",
  rowSurfaceHover: "#fafbfc",
  rowSurfaceSelected: "#f6f8fa",
  rowSurfaceSelectedUnfocused: "#f8f9fb",
  scrim: "rgba(31, 35, 40, 0.4)",
  shadowPopover: "0 8px 24px rgba(31, 35, 40, 0.16)",
  shadowDialog: "0 12px 32px rgba(31, 35, 40, 0.2)",
  shadowSheet: "0 16px 48px rgba(31, 35, 40, 0.24)",
};

export const DARK: Palette = {
  surfaceDominant: "#0a0a0a",
  surfaceSecondary: "#0f0f0f",
  divider: "#1f1f1f",
  borderControl: "#707070",
  textPrimaryRack: "#ededed",
  textMutedRack: "#8b8b8b",
  accentTextRack: "#5175e1",
  accentNontext: "#3c64dd",
  focusRing: "#3c64dd",
  successTextRack: "#3fb950",
  destructiveTextRack: "#f85149",
  blockedTextRack: "#d29922",
  rowSurface: "rgba(0, 0, 0, 0)",
  rowSurfaceHover: "#0c0c0c",
  rowSurfaceSelected: "#0f0f0f",
  rowSurfaceSelectedUnfocused: "#0d0d0d",
  scrim: "rgba(0, 0, 0, 0.6)",
  shadowPopover: "0 8px 24px rgba(0, 0, 0, 0.6)",
  shadowDialog: "0 12px 32px rgba(0, 0, 0, 0.65)",
  shadowSheet: "0 16px 48px rgba(0, 0, 0, 0.7)",
};

export const PALETTES: Record<Mode, Palette> = { light: LIGHT, dark: DARK };

/**
 * Custom properties that exist only as `var()` aliases in styles/tokens.css (D-11: one surface
 * family, no second material). They carry no value of their own, so they are absent from
 * `Palette`; the contrast test asserts each is still declared and still points at its target.
 */
export const ALIASES = {
  stripBacklog: "surfaceDominant",
  stripTodo: "surfaceDominant",
  stripInProgress: "surfaceDominant",
  stripInReview: "surfaceDominant",
  stripDone: "surfaceDominant",
  textPrimaryStrip: "textPrimaryRack",
  textMutedStrip: "textMutedRack",
  accentTextStrip: "accentTextRack",
  destructiveStrip: "destructiveTextRack",
  blockedTextStrip: "blockedTextRack",
} as const satisfies Record<string, keyof Palette>;

/**
 * The single motion contract (mechanical settle, single-row displacement, never a fade).
 * Exactly one easing curve across the whole product.
 */
export const MOTION = {
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  durationSettle: "180ms",
  durationDisplace: "220ms",
} as const;
