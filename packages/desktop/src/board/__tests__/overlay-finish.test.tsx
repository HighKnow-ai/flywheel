/**
 * 08.1 plan 15: the palette and the five pickers draw their boundary and elevation from the roles.
 *
 * Plan 07 measured that these six drew their visible edge from `--divider` (1.16 to 1.43 against the
 * ground), a decorative hairline where a control needs 3:1, and that they hard-coded a black scrim and
 * shadow that are wrong on a white ground. `theme/__tests__/contrast.test.ts` pins `--border-control`
 * at 3:1 in both modes, so referencing it is what makes the edge real. The tier follows the UI-SPEC's
 * overlay rule: a picker is a popover (shadow, no scrim); the palette is a sheet (scrim and shadow).
 */
import { describe, expect, it } from "vitest";
import appCss from "../../App.css?raw";
import palette from "../CommandPalette.tsx?raw";
import assignee from "../pickers/AssigneePicker.tsx?raw";
import parent from "../pickers/ParentPicker.tsx?raw";
import priority from "../pickers/PriorityPicker.tsx?raw";
import status from "../pickers/StatusPicker.tsx?raw";

const PICKERS = { assignee, parent, priority, status };

/** Source with comment lines removed, so a comment explaining the old literal is not a finding. */
const code = (source: string) => source.split("\n").filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line)).join("\n");

describe("the four pickers are popovers", () => {
  for (const [name, source] of Object.entries(PICKERS)) {
    it(`${name}: control-boundary edge, popover shadow, no scrim, no literal`, () => {
      const src = code(source);
      expect(src).toContain('border: "1px solid var(--border-popover)"');
      expect(src).not.toContain("var(--divider)");
      expect(src).toContain('boxShadow: "var(--shadow-popover)"');
      expect(src).not.toContain("--scrim");
      expect(src).not.toMatch(/rgba?\(|#[0-9a-fA-F]{6}/);
    });

    it(`${name}: the popover is padded so the chosen item's rule sits inside its edge, not on it`, () => {
      expect(code(source)).toContain('padding: "var(--space-sm)"');
    });

    it(`${name}: the chosen item reads like a selected row (surface shift and a 2px rule)`, () => {
      const src = code(source);
      expect(src).toContain("var(--row-surface-selected)");
      expect(src).toContain("2px solid var(--selection-rule)");
      expect(src).not.toMatch(/--accent-nontext/);
    });
  }
});

describe("the command palette is a sheet", () => {
  const src = code(palette);

  it("draws the scrim and the sheet shadow from the per-mode roles", () => {
    expect(src).toContain('background: "var(--scrim)"');
    expect(src).toContain('boxShadow: "var(--shadow-sheet)"');
    expect(src).not.toMatch(/rgba?\(|#[0-9a-fA-F]{6}/);
  });

  it("draws its panel edge from the sheet tier's edge role (lighter per tier in dark)", () => {
    expect(src).toContain('border: "1px solid var(--border-sheet)"');
  });

  it("rings its always-focused search field with the ink rule, inset off the dialog edge, never the brand", () => {
    expect(src).toContain("command-palette-search");
    expect(src).not.toMatch(/outlineOffset/);
    const rule = appCss.match(/\.command-palette-search:focus-visible\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "no :focus-visible rule for the palette search field").toContain("var(--selection-rule)");
    expect(rule).not.toContain("--focus-ring");
    expect(Number(rule.match(/outline-offset:\s*(-\d+)px/)?.[1]), "the ring must sit inside the dialog edge").toBeLessThanOrEqual(-4);
  });

  it("insets the list so the highlighted command's 2px rule sits inside the dialog edge", () => {
    expect(src).toMatch(/role="listbox"[\s\S]{0,160}padding: "var\(--space-sm\)"/);
  });

  it("marks the highlighted command neutrally, never with the brand", () => {
    expect(src).toContain("var(--row-surface-selected)");
    expect(src).toContain("2px solid var(--selection-rule)");
    expect(src).not.toMatch(/--accent-nontext|--accent-text/);
  });

  it("does not suppress the search field's keyboard focus ring", () => {
    expect(src).not.toMatch(/outline:\s*"none"/);
  });
});
