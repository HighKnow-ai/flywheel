/**
 * Typed mirror of styles/globals.css: the Andon colour tokens, one palette per scheme (docs/design/direction.md
 * § Tokens). Keys are the custom-property names in camelCase (`mutedForeground` -> `--muted-foreground`).
 *
 * `LIGHT` and `DARK` are both a `Palette`, so a role declared in one scheme and not the other does not
 * typecheck. theme/__tests__/contrast.test.ts parses globals.css block by block (`:root` for light, `.dark`
 * for dark), asserts each palette equals its block, and asserts every per-role floor in both schemes. The test,
 * not a comment, owns the numbers.
 */

export const MODES = ["light", "dark"] as const;
export type Mode = (typeof MODES)[number];

export interface Palette {
  /** The floor the cards sit on. */
  background: string;
  /** Body text. */
  foreground: string;
  /** Cards, panels. */
  card: string;
  cardForeground: string;
  /** Popovers and dialogs. */
  popover: string;
  popoverForeground: string;
  /** Brand blue as a fill: the filled primary button, the Running fill, the lamp bulb. */
  primary: string;
  primaryForeground: string;
  /** Brand blue as text and icons: Running, the doing Task, links. HighKnow's brand ink on light, its lift #7d99ff on dark. */
  running: string;
  /** The Running pill ground and the selected row: HighKnow's brand wash on light. */
  runningMuted: string;
  /** A hairline in the brand hue, edging a running-muted surface: HighKnow's brand hair on light. */
  runningBorder: string;
  /** Safety yellow: Waiting on you, and nothing else. */
  attention: string;
  attentionForeground: string;
  /** The tint of a row or card that needs you. */
  attentionMuted: string;
  /** Red as a fill: Stopped and failed. */
  destructive: string;
  destructiveForeground: string;
  /** Red as text: Drop and other destructive text buttons. */
  destructiveText: string;
  /** Neutral pills, the secondary button ground, inset panels. */
  secondary: string;
  secondaryForeground: string;
  muted: string;
  /** Secondary text. */
  mutedForeground: string;
  /** Meta, chevrons, timestamps, placeholders. */
  subtleForeground: string;
  /** Hover. */
  accent: string;
  accentForeground: string;
  /** Card edges, row rules, region edges: under 3:1 by design, never a control boundary. */
  border: string;
  /** Control boundaries (inputs, outline buttons, radios): at least 3:1. */
  input: string;
  /** The focus ring. */
  ring: string;
  sidebar: string;
  sidebarForeground: string;
  /** The current project or Story: a raised card in the sidebar. */
  sidebarPrimary: string;
  sidebarPrimaryForeground: string;
  sidebarAccent: string;
  sidebarAccentForeground: string;
  sidebarBorder: string;
  sidebarRing: string;
  /** Graphite: the andon strip, the lead count box, the live-agent station. Hardware, not a state. */
  strip: string;
  stripForeground: string;
  stripMutedForeground: string;
  /** An unlit lamp. */
  lamp: string;
  /** The ground of a line a diff adds, on the review card. Nothing else. */
  diffInsert: string;
  /** The ground of a line a diff removes, on the review card. Nothing else. */
  diffDelete: string;
  /** Stacked bar: Merged · In review · Running · Ready. */
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
}

export const LIGHT: Palette = {
  background: "#e6e8ec",
  foreground: "#12151c",
  card: "#ffffff",
  cardForeground: "#12151c",
  popover: "#ffffff",
  popoverForeground: "#12151c",
  primary: "#3c64dd",
  primaryForeground: "#ffffff",
  running: "#22409c",
  runningMuted: "#eef1fd",
  runningBorder: "#c8d2f7",
  attention: "#ffd400",
  attentionForeground: "#14120a",
  attentionMuted: "#fff7cc",
  destructive: "#c0223a",
  destructiveForeground: "#ffffff",
  destructiveText: "#c0223a",
  secondary: "#f4f5f7",
  secondaryForeground: "#12151c",
  muted: "#f4f5f7",
  mutedForeground: "#4a5261",
  subtleForeground: "#676d79",
  accent: "#eef0f3",
  accentForeground: "#12151c",
  border: "#cdd2dd",
  input: "#8792a6",
  ring: "#3c64dd",
  sidebar: "#f8f9fa",
  sidebarForeground: "#12151c",
  sidebarPrimary: "#ffffff",
  sidebarPrimaryForeground: "#12151c",
  sidebarAccent: "#e9ebef",
  sidebarAccentForeground: "#12151c",
  sidebarBorder: "#e4e7ee",
  sidebarRing: "#3c64dd",
  strip: "#17191e",
  stripForeground: "#f2f3f5",
  stripMutedForeground: "#a4a9b3",
  lamp: "#25282f",
  diffInsert: "#e3f4e7",
  diffDelete: "#fce6e4",
  chart1: "#12151c",
  chart2: "#7d838f",
  chart3: "#3c64dd",
  chart4: "#c3c7ce",
};

export const DARK: Palette = {
  background: "#0b0c0e",
  foreground: "#eceef1",
  card: "#1a1c20",
  cardForeground: "#eceef1",
  popover: "#1a1c20",
  popoverForeground: "#eceef1",
  primary: "#3c64dd",
  primaryForeground: "#ffffff",
  running: "#7d99ff",
  runningMuted: "#19213a",
  runningBorder: "#2c3a6b",
  attention: "#ffd400",
  attentionForeground: "#14120a",
  attentionMuted: "#352d00",
  destructive: "#c0223a",
  destructiveForeground: "#ffffff",
  destructiveText: "#ff6b82",
  secondary: "#23262b",
  secondaryForeground: "#eceef1",
  muted: "#23262b",
  mutedForeground: "#a0a6b1",
  subtleForeground: "#90969f",
  accent: "#23262b",
  accentForeground: "#eceef1",
  border: "#2c2f36",
  input: "#6e7480",
  ring: "#7d99ff",
  sidebar: "#121316",
  sidebarForeground: "#eceef1",
  sidebarPrimary: "#1a1c20",
  sidebarPrimaryForeground: "#eceef1",
  sidebarAccent: "#1e2025",
  sidebarAccentForeground: "#eceef1",
  sidebarBorder: "#2c2f36",
  sidebarRing: "#7d99ff",
  strip: "#000000",
  stripForeground: "#f2f3f5",
  stripMutedForeground: "#9aa0aa",
  lamp: "#1a1c20",
  diffInsert: "#142a1b",
  diffDelete: "#351816",
  chart1: "#eceef1",
  chart2: "#7d838f",
  chart3: "#3c64dd",
  chart4: "#4a4f58",
};

export const PALETTES: Record<Mode, Palette> = { light: LIGHT, dark: DARK };

/**
 * The one motion contract (DESIGN.md § Motion, direction.md rule 7): one curve and five durations. Feedback
 * acknowledges a press, state changes a value in place, the lamp lighting is the one authored moment, and an
 * overlay or a disclosure enters on the overlay duration and leaves faster on its exit.
 */
export const MOTION = {
  /** HighKnow's ease-out-quint, the shared easing token. */
  easeOutQuint: "cubic-bezier(0.16, 1, 0.3, 1)",
  /** The name the screens use: an alias of the shared token. */
  ease: "var(--ease-out-quint)",
  durationFeedback: "120ms",
  durationState: "160ms",
  durationLamp: "240ms",
  durationOverlay: "260ms",
  durationOverlayExit: "180ms",
} as const;
