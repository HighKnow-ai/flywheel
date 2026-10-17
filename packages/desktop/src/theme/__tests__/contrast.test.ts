import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../contrast";
import { ALIASES, MODES, PALETTES, type Mode, type Palette } from "../tokens";
// Vite's `?raw` import (declared by `vite/client.d.ts`, referenced from `src/vite-env.d.ts`) reads
// the file's real contents at import/transform time — this is what keeps the drift-check assertion
// below honest against the value the product actually ships, not a hand-copied literal.
import tokensCssSource from "../../styles/tokens.css?raw";
// The glyph's ink is read from the components that paint it, not restated here, so a recolour of
// the Dot is measured rather than missed (D-REV-09).

/**
 * The runnable assertion that owns every contrast number in the product (08.1-DIRECTION.md:
 * "The table is not the proof"). Driven by `MODES`, not by two hand-written sections, so a mode
 * added to `theme/tokens.ts` is asserted the moment it exists.
 */

const AA_TEXT = 4.5;
const NON_TEXT = 3;

type Role = keyof Palette;

/** The state vocabulary's five classes (Phase 14, D-15) and the `Palette` key of one of their roles. */
const STATE_CLASSES = ["NeedsYou", "Running", "Failed", "Merged", "Quiet"] as const;
const stateRole = (cls: (typeof STATE_CLASSES)[number], role: "Text" | "Wash" | "Edge" | "Mark"): Role =>
  `state${cls}${role}` as Role;

/** Roles that paint text. Each must clear 4.5:1 on every surface text can sit on. */
const TEXT_ROLES: Role[] = [
  "textPrimaryRack",
  "textMutedRack",
  "textPlaceholder",
  "accentTextRack",
  "successTextRack",
  "destructiveTextRack",
  "blockedTextRack",
  ...STATE_CLASSES.map((c) => stateRole(c, "Text")),
];

/** Roles that paint a fill or an edge. Each must clear 3:1 (WCAG 1.4.11). */
const NON_TEXT_ROLES: Role[] = [
  "accentNontext",
  "focusRing",
  "borderControl",
  "borderPopover",
  "borderDialog",
  "borderSheet",
  // The state vocabulary's `mark` carries its own 3:1 floor; `edge` is a 1px boundary (D-18).
  ...STATE_CLASSES.flatMap((c) => [stateRole(c, "Mark"), stateRole(c, "Edge")]),
];

/** Every opaque ground a row's text can land on. `rowSurface` is transparent, so it is the ground. */
const SURFACES: Role[] = [
  "surfaceDominant",
  "surfaceSecondary",
  "rowSurfaceHover",
  "rowSurfaceSelected",
  "rowSurfaceSelectedUnfocused",
  // Phase 14 plan 08 (VIS-04): a state wash is a ground in its own right, so every role in the lists above
  // is measured on it by the loops below. The quiet wash is the transparent rest value, as `rowSurface`
  // is, so it is the ground and not a separate surface.
  ...STATE_CLASSES.filter((c) => c !== "Quiet").map((c) => stateRole(c, "Wash")),
];

/** The selected band's gap to the ground that shipped with the 08.1-14 closure: a floor, not a target. */
const SELECTED_BAND_FLOOR: Record<Mode, number> = { light: 1.07, dark: 1.035 };

/** What the finish reviewer asked for (08.1-14 closure, finding 4). Asserted unreachable below. */
const REVIEWER_BAND_TARGET: Record<Mode, number> = { light: 1.12, dark: 1.08 };

/**
 * The surface that is `gap` away from `ground` when darkened (light) or lightened (dark) toward `ink`.
 * Mixing toward the text colour is how a row wash is made, so this is the family any stronger band
 * would come from; the search is over the mix fraction, not over hand-picked hexes.
 */
function bandAtGap(ground: string, ink: string, gap: number): string {
  const channel = (hex: string, i: number): number => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  const mixed = (p: number): string =>
    "#" + [0, 1, 2].map((i) => Math.round(channel(ground, i) + (channel(ink, i) - channel(ground, i)) * p).toString(16).padStart(2, "0")).join("");
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 24; step += 1) {
    const mid = (lo + hi) / 2;
    if (contrastRatio(mixed(mid), ground) >= gap) hi = mid;
    else lo = mid;
  }
  return mixed(hi);
}

const toProp = (key: string): string => `--${key.replace(/([A-Z])/g, "-$1").toLowerCase()}`;
const escapeRe = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Every custom-property name the stylesheet declared before the 08.1 re-theme. Token names stay
 * exactly as they were (re-theme by value, not by name), so none may disappear.
 */
const LEGACY_NAMES = [
  "--accent-nontext", "--accent-text-rack", "--accent-text-strip", "--blocked-text-rack",
  "--blocked-text-strip", "--destructive-strip", "--destructive-text-rack", "--divider",
  "--focus-ring", "--radius-chrome", "--row-surface", "--row-surface-hover",
  "--row-surface-selected", "--row-surface-selected-unfocused", "--space-2xl", "--space-3xl",
  "--space-lg", "--space-md", "--space-sm", "--space-xl", "--space-xs", "--strip-backlog",
  "--strip-done", "--strip-in-progress", "--strip-in-review", "--strip-todo",
  "--success-text-rack", "--surface-dominant", "--surface-secondary", "--text-muted-rack",
  "--text-muted-strip", "--text-primary-rack", "--text-primary-strip",
];

const DARK_BLOCK_START = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)\s*\{/;

/**
 * The declarations of ONE mode's block: the root block for light (everything before the dark
 * colour-scheme media query), the media block for dark (everything from it on). Comments are
 * stripped first so prose in them is never read as a declaration. Matching a mode against only
 * its own block is the point: with a property declared in both, a whole-file match passes
 * whenever EITHER block carries the value (RESEARCH Pitfall 3).
 */
function declarations(mode: Mode, css: string): Map<string, string> {
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const at = source.search(DARK_BLOCK_START);
  const block = mode === "dark" ? (at === -1 ? "" : source.slice(at)) : at === -1 ? source : source.slice(0, at);
  return new Map(Array.from(block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g), (m) => [m[1], m[2].trim()]));
}

/** What in the `mode` palette does not match that mode's block of the stylesheet. */
function driftErrors(mode: Mode, css: string): string[] {
  const declared = declarations(mode, css);
  const errors: string[] = [];
  for (const [key, value] of Object.entries(PALETTES[mode])) {
    const prop = toProp(key);
    if (declared.get(prop) !== value) {
      errors.push(`${mode}: expected "${prop}: ${value};" in its own block, found ${JSON.stringify(declared.get(prop) ?? null)}`);
    }
  }
  return errors;
}

/** Roles declared in one mode's palette and absent from another's. */
function roleSetErrors(palettes: Record<string, object>): string[] {
  const all = new Set(Object.values(palettes).flatMap((p) => Object.keys(p)));
  return Object.entries(palettes).flatMap(([mode, p]) =>
    [...all].filter((role) => !(role in p)).map((role) => `${mode} is missing role "${role}"`),
  );
}

describe("relativeLuminance", () => {
  it("is 1 for white", () => {
    expect(relativeLuminance("#ffffff")).toBe(1);
  });

  it("is 0 for black", () => {
    expect(relativeLuminance("#000000")).toBe(0);
  });
});

describe("contrastRatio", () => {
  it("is 21 for white on black", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBe(21);
  });
});

for (const mode of MODES) {
  const p = PALETTES[mode];

  describe(`${mode} mode contrast`, () => {
    it("every text role clears 4.5:1 on every surface", () => {
      for (const role of TEXT_ROLES) {
        for (const surface of SURFACES) {
          expect(
            contrastRatio(p[role], p[surface]),
            `${mode}: ${role} ${p[role]} on ${surface} ${p[surface]}`,
          ).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
    });

    it("every non-text role clears 3:1 on every surface", () => {
      for (const role of NON_TEXT_ROLES) {
        for (const surface of SURFACES) {
          expect(
            contrastRatio(p[role], p[surface]),
            `${mode}: ${role} ${p[role]} on ${surface} ${p[surface]}`,
          ).toBeGreaterThanOrEqual(NON_TEXT);
        }
      }
    });

    // Phase 14 plan 04. A wash is a ground in its own right: every text role in the product, state inks
    // included, must still clear AA drawn on it. The quiet wash is the transparent rest value (no tint).
    it("every state wash keeps every text role at 4.5:1, and the five inks and washes are pairwise distinct", () => {
      const washes = STATE_CLASSES.filter((c) => c !== "Quiet").map((c) => stateRole(c, "Wash"));
      for (const wash of washes) {
        for (const role of TEXT_ROLES) {
          expect(
            contrastRatio(p[role], p[wash]),
            `${mode}: ${role} ${p[role]} on ${wash} ${p[wash]}`,
          ).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
      for (const part of ["Text", "Wash"] as const) {
        const values = STATE_CLASSES.map((c) => p[stateRole(c, part)]);
        expect(new Set(values).size, `${mode}: state ${part} values must be pairwise distinct`).toBe(values.length);
      }
    });

    it("the quiet class is the muted ink and carries no tint", () => {
      expect(p.stateQuietText).toBe(p.textMutedRack);
      expect(p.stateQuietMark).toBe(p.textMutedRack);
      expect(p.stateQuietEdge).toBe(p.borderControl);
      expect(p.stateQuietWash).toBe(p.rowSurface);
    });

    it("the control boundary clears 3:1 on ground and surface", () => {
      expect(contrastRatio(p.borderControl, p.surfaceDominant)).toBeGreaterThanOrEqual(NON_TEXT);
      expect(contrastRatio(p.borderControl, p.surfaceSecondary)).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it("the divider is a decorative hairline, deliberately NOT a control boundary", () => {
      // Measured (ground / surface): light 1.43 / 1.34, dark 1.42 / 1.37. A region separator,
      // not an interactive edge — which is exactly why `borderControl` exists as its own role.
      // Do not "fix" this hairline up to 3:1: that would turn every rule in the product into a
      // heavy line. It must stay visible at all and must not be what a control draws its edge from.
      for (const surface of ["surfaceDominant", "surfaceSecondary"] as const) {
        const ratio = contrastRatio(p.divider, p[surface]);
        expect(ratio, `${mode}: divider on ${surface}`).toBeGreaterThanOrEqual(1.1);
        expect(ratio, `${mode}: divider on ${surface}`).toBeLessThan(NON_TEXT);
      }
      expect(p.borderControl).not.toBe(p.divider);
    });

    // A-06(b). The legend test below only proves the four row-state HEX STRINGS differ; the two
    // selected surfaces are 1.011 (light) / 1.014 (dark) apart, which no eye separates. These are
    // the assertions that the selected-but-unfocused obligation is PERCEPTIBLE, not merely distinct.
    it("both selection rules are visible on every row surface (3:1)", () => {
      for (const role of ["selectionRule", "selectionRuleUnfocused"] as const) {
        for (const surface of SURFACES) {
          expect(
            contrastRatio(p[role], p[surface]),
            `${mode}: ${role} ${p[role]} on ${surface} ${p[surface]}`,
          ).toBeGreaterThanOrEqual(NON_TEXT);
        }
      }
    });

    it("the focused rule is told apart from the unfocused rule by at least 3:1", () => {
      expect(
        contrastRatio(p.selectionRule, p.selectionRuleUnfocused),
        `${mode}: focused vs unfocused selection rule`,
      ).toBeGreaterThanOrEqual(NON_TEXT);
    });

    it("the rule, not the surface, carries the focus distinction (the surfaces are within 1.05)", () => {
      // Pins WHY the rule roles exist: if someone widens the surface gap this stays true and
      // merely becomes redundant; if they close the rule gap the test above fails.
      expect(contrastRatio(p.rowSurfaceSelected, p.rowSurfaceSelectedUnfocused)).toBeLessThan(1.05);
    });

    // 08.1-14 finish review, finding 4. The reviewer asked for a selected band of 1.12 (light) and
    // 1.08 (dark) against the ground. Plan 07 had already found why the band is weak: every text role
    // sits on it, and the weakest ones (blocked in light, the dark brand text lift) run out of margin
    // first. These three assertions keep that argument runnable rather than prose.
    it("every text role clears 4.5:1 on both selected surfaces, named (not only inside the loop above)", () => {
      for (const surface of ["rowSurfaceSelected", "rowSurfaceSelectedUnfocused"] as const) {
        for (const role of TEXT_ROLES) {
          expect(
            contrastRatio(p[role], p[surface]),
            `${mode}: ${role} ${p[role]} on ${surface} ${p[surface]}`,
          ).toBeGreaterThanOrEqual(AA_TEXT);
        }
      }
    });

    it("the selected band is as strong as it was when this was measured (it may not be quietly softened)", () => {
      expect(contrastRatio(p.rowSurfaceSelected, p.surfaceDominant)).toBeGreaterThanOrEqual(SELECTED_BAND_FLOOR[mode]);
    });

    it("the finish reviewer's stronger band is NOT reachable: at that gap a text role falls under 4.5:1", () => {
      const surface = bandAtGap(p.surfaceDominant, p.textPrimaryRack, REVIEWER_BAND_TARGET[mode]);
      const worst = Math.min(...TEXT_ROLES.map((role) => contrastRatio(p[role], surface)));
      expect(worst, `${mode}: worst text role on ${surface}, the reviewer's target band`).toBeLessThan(AA_TEXT);
    });

    // 08.1-17 closure: the dark placeholder was about 8.5:1 against light's 2.3:1, so a dark field looked
    // already typed in. The role is a step below muted in BOTH modes and the two modes sit within 0.1 of
    // each other on the ground: matched on ratio, which is what the eye reads, not on hex distance.
    it("the placeholder is a step below muted, and the two modes agree on its ratio", () => {
      const onGround = (role: Role) => contrastRatio(p[role], p.surfaceDominant);
      expect(onGround("textPlaceholder"), `${mode}: placeholder is quieter than muted`).toBeLessThan(onGround("textMutedRack"));
      const other = PALETTES[mode === "light" ? "dark" : "light"];
      expect(
        Math.abs(onGround("textPlaceholder") - contrastRatio(other.textPlaceholder, other.surfaceDominant)),
        "light and dark placeholders differ in ratio",
      ).toBeLessThan(0.3);
    });

    it("the four row-state surfaces are pairwise distinct", () => {
      const values = [p.rowSurface, p.rowSurfaceHover, p.rowSurfaceSelected, p.rowSurfaceSelectedUnfocused];
      expect(new Set(values).size).toBe(values.length);
    });
  });
}

/**
 * 08.1-15 finish review, findings 4 and 5: the dark world was missing three things the light world
 * has, and one token had been "authored" by copying it. These are the runnable form of each.
 */
describe("dark carries what light carries (08.1-15 closure)", () => {
  const { light, dark } = PALETTES;

  it("the dark hairline has the light hairline's weight on the ground (it was 1.20 against 1.43)", () => {
    const l = contrastRatio(light.divider, light.surfaceDominant);
    const d = contrastRatio(dark.divider, dark.surfaceDominant);
    expect(d, `dark divider ${dark.divider} on the ground`).toBeGreaterThanOrEqual(l - 0.05);
  });

  it("dark says the overlay tier with edge lightness: popover < dialog < sheet, each lighter than the last", () => {
    const edge = (role: Role) => contrastRatio(dark[role], dark.surfaceDominant);
    expect(edge("borderPopover")).toBeGreaterThan(edge("borderControl") - 1e-9);
    expect(edge("borderDialog")).toBeGreaterThan(edge("borderPopover"));
    expect(edge("borderSheet")).toBeGreaterThan(edge("borderDialog"));
  });

  it("the dark shadows cannot carry the tier (so the edge must): the three sit within a hair of each other", () => {
    const alpha = (shadow: string) => Number(shadow.match(/rgba\(0, 0, 0, ([\d.]+)\)/)?.[1]);
    expect(alpha(dark.shadowSheet) - alpha(dark.shadowPopover)).toBeLessThan(0.15);
  });

  it("the dark scrim leaves the board readable behind a modal (0.6 over near-black erased it)", () => {
    const alpha = Number(dark.scrim.match(/([\d.]+)\)$/)?.[1]);
    expect(alpha).toBeLessThanOrEqual(0.4);
    expect(alpha).toBe(Number(light.scrim.match(/([\d.]+)\)$/)?.[1]));
  });
});

/**
 * Roles whose value is the SAME in both modes because that is the design, each with the reason.
 * Everything else must differ. The list is asserted to be true (an entry that has since diverged
 * fails), so it cannot rot into a blanket exemption. `--focus-ring` shipped identical in both blocks:
 * written twice, authored once.
 */
const SAME_BY_DESIGN: Partial<Record<Role, string>> = {
  accentNontext: "the pinned brand fill (progress); the dark lift applies to brand TEXT only",
  rowSurface: "the transparent rest state",
  stateQuietWash: "the quiet class has no tint: the transparent rest value, as rowSurface",
};

/**
 * `--text-on-accent` (white on the brand fill) was retired in 08.1-20: the finish passes redrew every
 * primary button with a control edge, so nothing paints a brand fill under text any more. A
 * declared-but-unreferenced role is the kind someone later wires back up (the same reasoning that
 * retired `--duration-displace`), and ink on the brand is 3.05:1, so a revival would fail AA.
 */
describe("retired token roles stay retired", () => {
  it("--text-on-accent is declared nowhere", () => {
    expect(tokensCssSource).not.toMatch(/--text-on-accent\s*:/);
    expect(Object.keys(PALETTES.light)).not.toContain("textOnAccent");
  });
});

describe("no token is declared identically in both modes unless that is the design", () => {
  const roles = Object.keys(PALETTES.light) as Role[];

  it("the typed palettes", () => {
    const same = roles.filter((r) => PALETTES.light[r] === PALETTES.dark[r] && !(r in SAME_BY_DESIGN));
    expect(same, `declared identically in LIGHT and DARK, i.e. not authored for dark: ${same.join(", ")}`).toEqual([]);
  });

  it("the stylesheet's two blocks, for every name both declare (not only the mirrored roles)", () => {
    const light = declarations("light", tokensCssSource);
    const dark = declarations("dark", tokensCssSource);
    const allowed = new Set(Object.keys(SAME_BY_DESIGN).map(toProp));
    const same = [...dark.keys()].filter((name) => light.get(name) === dark.get(name) && !allowed.has(name));
    expect(same, `declared with one value in both blocks: ${same.join(", ")}`).toEqual([]);
  });

  it("the exemptions are true (an entry that has diverged must be deleted)", () => {
    for (const role of Object.keys(SAME_BY_DESIGN) as Role[]) {
      expect(PALETTES.light[role], `${role} is listed as same-by-design but differs`).toBe(PALETTES.dark[role]);
    }
  });

  it("would have caught the original --focus-ring (identical in both blocks)", () => {
    const regressed = tokensCssSource.replace(/(--focus-ring:\s*)#5175e1/, "$1#3c64dd");
    expect(regressed).not.toBe(tokensCssSource);
    const light = declarations("light", regressed);
    const dark = declarations("dark", regressed);
    expect(light.get("--focus-ring")).toBe(dark.get("--focus-ring"));
  });
});

describe("brand lift", () => {
  const worstSurface = (p: Palette): string =>
    SURFACES.map((s) => p[s]).reduce((worst, s) =>
      contrastRatio("#ffffff", s) < contrastRatio("#ffffff", worst) ? s : worst,
    );

  it("light mode needs no lift: the brand text is the brand, and clears AA on its own", () => {
    expect(PALETTES.light.accentTextRack).toBe(PALETTES.light.accentNontext);
  });

  it("dark mode needs one: the unlifted brand clears 3:1 for a fill but fails 4.5:1 for text", () => {
    const dark = PALETTES.dark;
    const ratio = contrastRatio(dark.accentNontext, dark.surfaceSecondary);
    expect(ratio).toBeGreaterThanOrEqual(NON_TEXT);
    expect(ratio).toBeLessThan(AA_TEXT);
    expect(dark.accentTextRack).not.toBe(dark.accentNontext);
  });

  it("the dark lift is the minimum step that clears AA, not the retired over-lift", () => {
    const dark = PALETTES.dark;
    const ratio = contrastRatio(dark.accentTextRack, worstSurface(dark));
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio, "over-lifted: drifts further from the pinned hue than necessary").toBeLessThanOrEqual(5);
    expect(dark.accentTextRack).not.toBe("#7d99ff");
  });
});

describe("token names", () => {
  it("every custom-property name that existed before the re-theme is still declared", () => {
    for (const name of LEGACY_NAMES) {
      expect(tokensCssSource, `${name} was removed from styles/tokens.css`).toMatch(
        new RegExp(`${escapeRe(name)}\\s*:`),
      );
    }
  });

  it("every alias is still declared and still points at its target", () => {
    for (const [alias, target] of Object.entries(ALIASES)) {
      expect(tokensCssSource, `${toProp(alias)} must alias var(${toProp(target)})`).toMatch(
        new RegExp(`${escapeRe(toProp(alias))}:\\s*var\\(${escapeRe(toProp(target))}\\)\\s*;`),
      );
    }
  });
});

describe("typed mirror drift", () => {
  it.each(MODES)("the %s palette equals the stylesheet", (mode) => {
    expect(driftErrors(mode, tokensCssSource)).toEqual([]);
  });
});

/**
 * RESEARCH Pitfall 3: with the same property declared in two blocks, a check that matches against
 * the whole file passes whenever EITHER block carries the mirrored value. These cases corrupt
 * the stylesheet's dark block alone and demand rejection, for every role.
 */
/** `css` with one declaration inside the dark block rewritten (or removed when `value` is null). */
function withDarkDeclaration(css: string, role: Role, value: string | null): string {
  const at = css.search(DARK_BLOCK_START);
  expect(at, "styles/tokens.css has no dark colour-scheme block").toBeGreaterThan(-1);
  const declaration = new RegExp(`${escapeRe(toProp(role))}:\\s*${escapeRe(PALETTES.dark[role])}\\s*;`);
  const tail = css.slice(at);
  expect(tail, `dark block does not declare ${toProp(role)}`).toMatch(declaration);
  return css.slice(0, at) + tail.replace(declaration, () => (value === null ? "" : `${toProp(role)}: ${value};`));
}

describe("block-aware drift check (a wrong dark value cannot hide behind a right light one)", () => {
  const roles = Object.keys(PALETTES.dark) as Role[];

  it.each(roles)("a wrong dark value for %s is rejected, and light is unaffected", (role) => {
    const corrupted = withDarkDeclaration(tokensCssSource, role, "#010203");
    expect(driftErrors("dark", corrupted), `dark ${role} drift went undetected`).not.toEqual([]);
    expect(driftErrors("light", corrupted)).toEqual([]);
  });

  it.each(roles)("a dark block that omits %s is rejected", (role) => {
    const corrupted = withDarkDeclaration(tokensCssSource, role, null);
    expect(driftErrors("dark", corrupted), `omitted dark ${role} went undetected`).not.toEqual([]);
  });

  it("a role present in one mode's mirror but missing from the other is rejected", () => {
    const { textMutedRack: _dropped, ...darkMissingOne } = PALETTES.dark;
    expect(roleSetErrors({ light: PALETTES.light, dark: darkMissingOne })).not.toEqual([]);
    expect(roleSetErrors({ light: PALETTES.light, dark: PALETTES.dark })).toEqual([]);
  });
});

/** `css` with one declaration inside the ROOT (light) block rewritten, or removed when `value` is null. */
function withLightDeclaration(css: string, role: Role, value: string | null): string {
  const at = css.search(DARK_BLOCK_START);
  const declaration = new RegExp(`${escapeRe(toProp(role))}:\\s*${escapeRe(PALETTES.light[role])}\\s*;`);
  const head = css.slice(0, at);
  expect(head, `root block does not declare ${toProp(role)}`).toMatch(declaration);
  return head.replace(declaration, () => (value === null ? "" : `${toProp(role)}: ${value};`)) + css.slice(at);
}

const STATE_ROLES = Object.keys(PALETTES.light).filter((k) => k.startsWith("state")) as Role[];

describe("a state role declared in only one block is rejected, in both directions (VIS-04, empty)", () => {
  it("there are twenty state roles to guard", () => {
    expect(STATE_ROLES).toHaveLength(20);
  });

  it.each(STATE_ROLES)("a root block that omits %s is rejected, and the dark block is unaffected", (role) => {
    const corrupted = withLightDeclaration(tokensCssSource, role, null);
    expect(driftErrors("light", corrupted), `omitted light ${role} went undetected`).not.toEqual([]);
    expect(driftErrors("dark", corrupted)).toEqual([]);
  });

  it.each(STATE_ROLES)("a wrong light value for %s is rejected, and dark is unaffected", (role) => {
    const corrupted = withLightDeclaration(tokensCssSource, role, "#010203");
    expect(driftErrors("light", corrupted), `light ${role} drift went undetected`).not.toEqual([]);
    expect(driftErrors("dark", corrupted)).toEqual([]);
  });
});

/**
 * The encoding rule (VIS-04, encoding). The comparison is byte equality on the text the stylesheet ships:
 * `#FFF`, `#AA7409`, `rgb(170, 116, 9)` and `hsl(...)` are the same colour to an engine and four different
 * strings to this test, and each is a drift error rather than a match. The one non-hex value a state may
 * declare is the quiet wash, the transparent rest value, spelled exactly as `--row-surface` spells it.
 */
const TRANSPARENT = "rgba(0, 0, 0, 0)";
function encodingErrors(mode: Mode, css: string): string[] {
  return [...declarations(mode, css)]
    .filter(([name]) => name.startsWith("--state-"))
    .filter(([name, value]) => !(/^#[0-9a-f]{6}$/.test(value) || (name === "--state-quiet-wash" && value === TRANSPARENT)))
    .map(([name, value]) => `${mode}: ${name} is spelled ${JSON.stringify(value)}; byte equality on the shipped text needs a lowercase six-digit hex`);
}

describe("state values are lowercase six-digit hex in the shipped text (VIS-04, encoding)", () => {
  it.each(MODES)("the %s block spells every state declaration that way", (mode) => {
    expect(declarations(mode, tokensCssSource).size, "the block parsed to nothing").toBeGreaterThan(20);
    expect(encodingErrors(mode, tokensCssSource)).toEqual([]);
  });

  it.each([
    ["uppercase", "#AA7409"],
    ["three-digit", "#a70"],
    ["functional rgb", "rgb(170, 116, 9)"],
    ["functional hsl", "hsl(40, 90%, 35%)"],
  ])("a %s spelling of a state colour is a drift error, not a match", (_name, spelling) => {
    const corrupted = withDarkDeclaration(tokensCssSource, "stateNeedsYouText", spelling);
    expect(encodingErrors("dark", corrupted)).toHaveLength(1);
    expect(driftErrors("dark", corrupted)).not.toEqual([]);
    expect(encodingErrors("light", corrupted)).toEqual([]);
  });

  it("the transparent quiet wash is spelled one way only", () => {
    const corrupted = withDarkDeclaration(tokensCssSource, "stateQuietWash", "transparent");
    expect(encodingErrors("dark", corrupted)).toHaveLength(1);
  });
});

/**
 * The floors are real edges (VIS-04, adjacency). A pair is built at each floor with the file's own
 * constructor: the grey that `bandAtGap` returns as the first one at or over the floor, then the next
 * grey one 8-bit step toward the ground, which must fall under it. The loops above use
 * `toBeGreaterThanOrEqual`, so a pair exactly at a floor passes and one step under fails.
 */
describe("the contrast floors are edges, asserted on both sides", () => {
  const grey = (hex: string): number => parseInt(hex.slice(1, 3), 16);
  const hexGrey = (n: number): string => "#" + n.toString(16).padStart(2, "0").repeat(3);

  it.each([
    ["text, 4.5:1", AA_TEXT],
    ["non-text, 3:1", NON_TEXT],
  ] as const)("%s: the first grey at the floor passes and the next step toward the ground fails", (_name, floor) => {
    const at = bandAtGap("#ffffff", "#000000", floor);
    expect(contrastRatio(at, "#ffffff"), `${at} is the first grey at ${floor}`).toBeGreaterThanOrEqual(floor);
    const lighter = hexGrey(grey(at) + 1);
    expect(contrastRatio(lighter, "#ffffff"), `${lighter} is one step under ${floor}`).toBeLessThan(floor);
  });

  it("the same edge holds on the dark ground (lightening toward the ink)", () => {
    const at = bandAtGap("#000000", "#ffffff", AA_TEXT);
    expect(contrastRatio(at, "#000000")).toBeGreaterThanOrEqual(AA_TEXT);
    const darker = hexGrey(grey(at) - 1);
    expect(contrastRatio(darker, "#000000")).toBeLessThan(AA_TEXT);
  });
});
