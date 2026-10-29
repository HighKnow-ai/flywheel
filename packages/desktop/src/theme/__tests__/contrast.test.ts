import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../contrast";
import { MODES, PALETTES, MOTION, type Mode, type Palette } from "../tokens";
import { BASE, DESIGN, GLOBALS, declared, text } from "./stylesheets";

/**
 * The runnable assertion that owns every contrast number in the Andon world (docs/design/direction.md
 * § "Measured contrast per role"). The table in direction.md records what was measured at the point of
 * decision; this file asserts each role's FLOOR in both schemes, so a token can move only while its role
 * still clears it.
 *
 * Floors: text 4.5:1 (WCAG 1.4.3), non-text 3:1 (WCAG 1.4.11: the focus ring, a control boundary). Regions
 * are told apart by a ground step, the 1px --border edge and the card shadow together; a region pair is not
 * held to 3:1, but its step may not shrink below what direction.md measured, and in dark (where the ground
 * step is small) the edge is mandatory and asserted as drawn.
 *
 * The values are read where they are declared (ADR 0021, amendment of 2026-10-27): the shared roles in the
 * installed `@highknow/design` `theme.css`, Flywheel's roles in `styles/globals.css`.
 */

const AA_TEXT = 4.5;
const NON_TEXT = 3;

type Role = keyof Palette;
type Pair = [fg: Role, bg: Role];

/** Every text role on every ground it is drawn on, per direction.md. */
const TEXT_PAIRS: Record<string, Pair[]> = {
  "body text": [
    ["foreground", "card"],
    ["foreground", "background"],
    ["foreground", "muted"],
    ["foreground", "accent"],
    ["popoverForeground", "popover"],
  ],
  "secondary text": [
    ["mutedForeground", "card"],
    ["mutedForeground", "background"],
    ["mutedForeground", "muted"],
  ],
  "meta and chevrons": [["subtleForeground", "card"]],
  "primary button": [["primaryForeground", "primary"]],
  "running pill": [["running", "runningMuted"]],
  "link or running text": [["running", "card"]],
  "Waiting on you": [
    ["attentionForeground", "attention"],
    ["foreground", "attentionMuted"],
    ["mutedForeground", "attentionMuted"],
    ["subtleForeground", "attentionMuted"],
  ],
  "Stopped or failed": [["destructiveForeground", "destructive"]],
  "destructive text": [["destructiveText", "card"]],
  "neutral state pill": [
    ["secondaryForeground", "secondary"],
    ["mutedForeground", "secondary"],
  ],
  "selected row": [
    ["foreground", "runningMuted"],
    ["mutedForeground", "runningMuted"],
  ],
  sidebar: [
    ["sidebarForeground", "sidebar"],
    ["sidebarForeground", "sidebarAccent"],
    ["sidebarPrimaryForeground", "sidebarPrimary"],
  ],
  "strip text on a lamp": [
    ["stripForeground", "lamp"],
    ["stripForeground", "strip"],
  ],
  "strip secondary text on a lamp": [
    ["stripMutedForeground", "lamp"],
    ["stripMutedForeground", "strip"],
  ],
  "diff lines": [
    ["foreground", "diffInsert"],
    ["foreground", "diffDelete"],
    ["mutedForeground", "diffInsert"],
    ["mutedForeground", "diffDelete"],
  ],
};

/** Non-text roles that must be seen against what they sit on (3:1). */
const NON_TEXT_PAIRS: Record<string, Pair[]> = {
  "lit lamp on the strip": [["attention", "strip"]],
  "focus ring": [
    ["ring", "card"],
    ["ring", "background"],
    ["sidebarRing", "sidebar"],
  ],
  "control boundary": [["input", "card"]],
};

/**
 * Region steps: under 3:1 by design, carried by the ground step, the --border edge and the card shadow
 * together. Each floor is direction.md's measured value rounded down, so the step cannot quietly shrink.
 */
const REGION_FLOORS: Record<Mode, Record<string, [Role, Role, number]>> = {
  light: {
    "card vs floor": ["card", "background", 1.22],
    "strip vs floor": ["strip", "background", 14],
    "sidebar vs floor": ["sidebar", "background", 1.15],
    "border vs card": ["border", "card", 1.36],
    "border vs floor": ["border", "background", 1.11],
  },
  dark: {
    "card vs floor": ["card", "background", 1.14],
    "strip vs floor": ["strip", "background", 1.06],
    "sidebar vs floor": ["sidebar", "background", 1.04],
    "border vs card": ["border", "card", 1.26],
    "border vs floor": ["border", "background", 1.45],
  },
};

const cssName = (role: string): string => "--" + role.replace(/([a-z])([A-Z0-9])/g, "$1-$2").toLowerCase();

const SCHEMES = { light: declared(":root"), dark: declared(".dark") };
const BLOCKS: Record<Mode, Record<string, string>> = { light: SCHEMES.light.all, dark: SCHEMES.dark.all };

describe("globals.css adds Flywheel's roles and redeclares none of the design system's", () => {
  it.each(MODES)("%s", (mode) => {
    const { base, own } = SCHEMES[mode];
    expect(Object.keys(base).length, "the package's block was read").toBeGreaterThan(20);
    expect(Object.keys(own).filter((name) => name in base)).toEqual([]);
  });

  it("imports the package's theme, base styles and fonts, in that order, after Tailwind", () => {
    const imports = [...GLOBALS.matchAll(/^@import "([^"]+)";/gm)].map((m) => m[1]);
    expect(imports).toEqual([
      "tailwindcss",
      "@highknow/design/theme.css",
      "@highknow/design/base.css",
      "@highknow/design/fonts.css",
    ]);
  });
});

describe("relativeLuminance and contrastRatio", () => {
  it("are the WCAG formula", () => {
    expect(relativeLuminance("#ffffff")).toBe(1);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
  });
});

for (const mode of MODES) {
  const p = PALETTES[mode];
  const ratio = (a: Role, b: Role) => contrastRatio(p[a], p[b]);

  describe(`${mode}: the stylesheets and theme/tokens.ts agree`, () => {
    it.each(Object.keys(p) as Role[])("%s", (role) => {
      expect(BLOCKS[mode][cssName(role)], `${mode} ${cssName(role)}`).toBe(p[role]);
    });
  });

  describe(`${mode}: text roles clear 4.5:1`, () => {
    for (const [name, pairs] of Object.entries(TEXT_PAIRS)) {
      it(name, () => {
        for (const [fg, bg] of pairs) {
          expect(ratio(fg, bg), `${mode}: ${fg} ${p[fg]} on ${bg} ${p[bg]}`).toBeGreaterThanOrEqual(AA_TEXT);
        }
      });
    }
  });

  describe(`${mode}: non-text roles clear 3:1`, () => {
    for (const [name, pairs] of Object.entries(NON_TEXT_PAIRS)) {
      it(name, () => {
        for (const [fg, bg] of pairs) {
          expect(ratio(fg, bg), `${mode}: ${fg} ${p[fg]} on ${bg} ${p[bg]}`).toBeGreaterThanOrEqual(NON_TEXT);
        }
      });
    }
  });

  describe(`${mode}: region steps hold their measured floor`, () => {
    for (const [name, [a, b, floor]] of Object.entries(REGION_FLOORS[mode])) {
      it(name, () => {
        expect(ratio(a, b), `${mode}: ${a} ${p[a]} vs ${b} ${p[b]}`).toBeGreaterThanOrEqual(floor);
      });
    }

    it("draws the --border edge between every pair of neighbouring regions (it differs from both grounds)", () => {
      for (const ground of ["card", "background", "sidebar"] as const) {
        expect(p.border, `${mode}: border vs ${ground}`).not.toBe(p[ground]);
        expect(ratio("border", ground), `${mode}: border vs ${ground}`).toBeGreaterThan(1.03);
      }
    });
  });
}

describe("one meaning per colour", () => {
  it.each(MODES)(
    "%s: yellow, blue and red are three distinct hues, and no state colour doubles as a ground",
    (mode) => {
      const p = PALETTES[mode];
      const fills = [p.attention, p.primary, p.destructive];
      expect(new Set(fills).size).toBe(3);
      for (const ground of [p.background, p.card, p.sidebar, p.secondary, p.accent]) {
        expect(fills).not.toContain(ground);
      }
    },
  );

  it("keeps the pinned brand fill in both schemes and lifts only its text on dark (PRODUCT.md brand rule)", () => {
    expect(PALETTES.light.primary).toBe("#3c64dd");
    expect(PALETTES.dark.primary).toBe("#3c64dd");
    expect(PALETTES.dark.running).not.toBe(PALETTES.dark.primary);
    // The pinned fill on the dark card is under AA as text; the lift exists because of that.
    expect(contrastRatio(PALETTES.dark.primary, PALETTES.dark.card)).toBeLessThan(AA_TEXT);
  });
});

/**
 * In dark the ground step is about 1.1:1, so the 1px --border edge is the only thing that separates a card
 * from the floor (direction.md § Regions). Assert the shared surfaces DRAW it, and draw it in both schemes
 * (no `dark:` override removes it).
 */
describe("the mandatory 1px edge", () => {
  const SURFACES: Record<string, { file: string; pattern: RegExp }> = {
    Card: { file: "dist/components/ui/card.js", pattern: /"data-slot": "card"[\s\S]*?\bborder border-border\b/ },
    Dialog: { file: "dist/components/ui/dialog.js", pattern: /bg-popover[^"]*\bborder border-border\b/ },
    AlertDialog: { file: "dist/components/ui/alert-dialog.js", pattern: /bg-popover[^"]*\bborder border-border\b/ },
    Popover: { file: "dist/components/ui/popover.js", pattern: /bg-popover[^"]*\bborder border-border\b/ },
    DropdownMenu: { file: "dist/components/ui/dropdown-menu.js", pattern: /bg-popover[^"]*\bborder border-border\b/ },
    Sidebar: { file: "dist/components/ui/sidebar.js", pattern: /group-data-\[side=left\]:border-r/ },
  };

  it.each(Object.entries(SURFACES))("%s draws its --border edge", (_name, { file, pattern }) => {
    const source = text(DESIGN + file);
    expect(source, `${file} draws the edge`).toMatch(pattern);
    expect(source, `${file} never removes the edge in dark`).not.toMatch(/dark:border-(0|none|transparent)\b/);
  });

  it("the base styles paint every element's default border in --border, so a bare `border` is the edge", () => {
    expect(BASE).toMatch(/\* \{\s*@apply border-border;/);
  });
});

describe("motion", () => {
  it("the stylesheets declare the one curve (HighKnow's ease-out-quint) and the durations theme/tokens.ts records", () => {
    const root = BLOCKS.light;
    expect(root["--ease-out-quint"]).toBe(MOTION.easeOutQuint);
    expect(root["--ease"]).toBe(MOTION.ease);
    expect(root["--duration-feedback"]).toBe(MOTION.durationFeedback);
    expect(root["--duration-state"]).toBe(MOTION.durationState);
    expect(root["--duration-lamp"]).toBe(MOTION.durationLamp);
    expect(root["--duration-overlay"]).toBe(MOTION.durationOverlay);
    expect(root["--duration-overlay-exit"]).toBe(MOTION.durationOverlayExit);
  });

  it("keeps each duration in its band, and an exit faster than its entrance", () => {
    const ms = (value: string) => Number.parseInt(value, 10);
    expect(ms(MOTION.durationFeedback)).toBeGreaterThanOrEqual(100);
    expect(ms(MOTION.durationFeedback)).toBeLessThanOrEqual(150);
    expect(ms(MOTION.durationState)).toBeGreaterThanOrEqual(160);
    expect(ms(MOTION.durationLamp)).toBeLessThanOrEqual(240);
    expect(ms(MOTION.durationOverlay)).toBeGreaterThanOrEqual(240);
    expect(ms(MOTION.durationOverlay)).toBeLessThanOrEqual(320);
    expect(ms(MOTION.durationOverlayExit)).toBeLessThan(ms(MOTION.durationOverlay));
  });

  it("under prefers-reduced-motion takes movement away but keeps the durations, so colour and opacity still cross-fade", () => {
    const reduced = BASE.slice(BASE.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).not.toMatch(/--duration-state: 0s;/);
    expect(reduced).not.toMatch(/transition-duration: 0s !important;/);
    expect(reduced).toMatch(/--tw-enter-translate-y: 0 !important;/);
    expect(reduced).toMatch(/--tw-enter-scale: 1 !important;/);
  });
});
