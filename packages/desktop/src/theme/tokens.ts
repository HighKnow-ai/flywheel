/**
 * Typed mirror of styles/tokens.css.
 *
 * These constants exist so theme/__tests__/contrast.test.ts asserts contrast
 * ratios against the values the product actually ships, not against literals
 * re-typed into the test (01-UI-SPEC.md: "These ratios are not the proof — a
 * runnable assertion is"). If a value here drifts from tokens.css, the two
 * files disagree and nothing catches it automatically — keep them in lockstep
 * by hand until a build step generates one from the other.
 */

/** Rack (dark chrome) token roles. */
export const RACK = {
  surfaceDominant: "#171b22",
  surfaceSecondary: "#1e232b",
  divider: "#2c333e",
  textPrimary: "#eef1f6",
  textMuted: "#9aa4b5",
  accentText: "#7d99ff",
  accentNonText: "#3c64dd",
} as const;

/** Strip stock (the content plane) — five workflow-state tints plus row-state overlays. */
export const STRIP = {
  backlog: "#e6e1d6",
  todo: "#dfe4ea",
  inProgress: "#efe6c8",
  inReview: "#e6ddec",
  done: "#dde9dc",
  rowSurface: "rgba(23, 27, 34, 0)",
  rowSurfaceHover: "rgba(60, 100, 221, 0.06)",
  rowSurfaceSelected: "rgba(60, 100, 221, 0.14)",
  rowSurfaceSelectedUnfocused: "rgba(74, 82, 97, 0.14)",
  /**
   * The reference strip-stock swatch 01-UI-SPEC.md's "Pinned brand, and the
   * lifts it requires" table measures brand-accent (and destructive) text
   * legibility against — a measurement-only reference distinct from the five
   * per-status tints above, with no corresponding CSS custom property since
   * nothing in the product renders it directly.
   */
  referenceStock: "#ddd6c6",
} as const;

/**
 * Agent signal vocabulary (02-UI-SPEC.md "Color Additions") — the four new colour roles Phase 2
 * introduces for the run-status/blocked signals. Only `blockedTextRack`/`blockedTextStrip` is a
 * pair; `successTextRack`/`destructiveTextRack` render on rack surfaces only in this phase. Kept
 * byte-identical to `styles/tokens.css`'s matching custom properties — asserted by
 * `theme/__tests__/contrast.test.ts`, not merely by convention.
 */
export const AGENT = {
  successTextRack: "#5fbf8e",
  destructiveTextRack: "#d9776c",
  blockedTextRack: "#dda845",
  blockedTextStrip: "#7a4e19",
} as const;

/** Ink and accents on strip stock. */
export const INK = {
  textPrimary: "#1e232b",
  textMuted: "#4a5261",
  accentText: "#2d4fb8",
  focusRing: "#3c64dd",
  destructive: "#9c351c",
} as const;

/**
 * The single motion contract (01-UI-SPEC.md "Motion" — mechanical settle,
 * single-row displacement, never a fade). Exactly one easing curve across the
 * whole product.
 */
export const MOTION = {
  ease: "cubic-bezier(0.16, 1, 0.3, 1)",
  durationSettle: "180ms",
  durationDisplace: "220ms",
} as const;
