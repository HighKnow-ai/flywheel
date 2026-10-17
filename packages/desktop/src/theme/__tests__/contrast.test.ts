import { describe, expect, it } from "vitest";
import { contrastRatio, relativeLuminance } from "../contrast";
import { MODES, PALETTES, type Mode, type Palette } from "../tokens";

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
  it("--text-on-accent is not a palette role", () => {
    expect(Object.keys(PALETTES.light)).not.toContain("textOnAccent");
  });
});

describe("no token is declared identically in both modes unless that is the design", () => {
  const roles = Object.keys(PALETTES.light) as Role[];

  it("the typed palettes", () => {
    const same = roles.filter((r) => PALETTES.light[r] === PALETTES.dark[r] && !(r in SAME_BY_DESIGN));
    expect(same, `declared identically in LIGHT and DARK, i.e. not authored for dark: ${same.join(", ")}`).toEqual([]);
  });

  it("the exemptions are true (an entry that has diverged must be deleted)", () => {
    for (const role of Object.keys(SAME_BY_DESIGN) as Role[]) {
      expect(PALETTES.light[role], `${role} is listed as same-by-design but differs`).toBe(PALETTES.dark[role]);
    }
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

describe("the two typed palettes declare the same roles", () => {
  it("a role present in one mode's mirror but missing from the other is rejected", () => {
    const { textMutedRack: _dropped, ...darkMissingOne } = PALETTES.dark;
    expect(roleSetErrors({ light: PALETTES.light, dark: darkMissingOne })).not.toEqual([]);
    expect(roleSetErrors({ light: PALETTES.light, dark: PALETTES.dark })).toEqual([]);
  });
});

const STATE_ROLES = Object.keys(PALETTES.light).filter((k) => k.startsWith("state")) as Role[];

describe("the state roles (VIS-04)", () => {
  it("there are twenty state roles to guard", () => {
    expect(STATE_ROLES).toHaveLength(20);
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
