/**
 * 08.1 plan 18: what the admin group's finish pass pins at the source level. jsdom cannot paint;
 * `browser/admin-group.browser.test.tsx` measures the same decisions in WebKit. The group is settings, the
 * permission-rules table and the legend. (The triage surface and the authoring tray were deleted by issue #38.)
 *
 *  1. No brand-filled action and no on-accent ink (owner decision 2026-10-08), no destructive fill.
 *  2. A chosen value is an ink edge and a foot rule, never a fill. A lead is a 2px ink edge. Neither is brand.
 *  3. No focus ring driven by a prop (the roving-tabindex defect class); selection is the neutral rule.
 *  4. The rules table is hairlines and spacing: no zebra, no tinted row.
 *  5. Every text field draws its boundary from the control role.
 *  6. Agent-authored proposal text reaches the DOM through React's text path only (T-08.1-51).
 *
 * It reads the shipped stylesheet, not the DOM: jsdom stubs CSS, so a class name asserted on an element proves
 * nothing about the rule behind it (the lesson of the deleted `agent-pulse`, 08.1-17).
 */
import { describe, expect, it } from "vitest";
import css from "../../styles/admin-surfaces.css?raw";
import settings from "../SettingsSurface.tsx?raw";
import rules from "../PermissionRulesTable.tsx?raw";
import legend from "../../legend/Legend.tsx?raw";

const SOURCES = { settings, rules, legend };

/** Comment lines out, so a doc comment may still say what the old code did. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

/** One rule's declaration block, by its exact selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]":()-]/g, "\\$&");
  const match = css.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} is not declared in admin-surfaces.css`).toBeTruthy();
  return match![2];
}

describe("the admin group draws its actions, it does not fill them", () => {
  it.each(Object.entries(SOURCES))("%s paints no brand fill, no destructive fill and no on-accent ink", (_name, source) => {
    expect(code(source)).not.toMatch(/--accent-nontext|--text-on-accent|--destructive-strip/);
    expect(code(source)).not.toMatch(/background:\s*"var\(--(destructive|accent)/);
    expect(code(source)).not.toMatch(/--accent-text/);
  });

  it("admin-surfaces.css never fills anything with the brand or a destructive role", () => {
    expect(code(css)).not.toMatch(/background[^;]*var\(--(accent|destructive|focus-ring)/);
    expect(code(css)).not.toMatch(/--text-on-accent/);
  });

  it("holds no literal colour, scrim or shadow, here or in any component of the group", () => {
    for (const [name, source] of Object.entries({ ...SOURCES, css })) {
      expect(code(source), name).not.toMatch(/rgba?\(|#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![0-9a-zA-Z-])/);
    }
  });

  it(".admin-action is a transparent ground with ink text, hovered on the quiet inset wash and not the divider", () => {
    const body = rule(".admin-action");
    expect(body).toMatch(/background:\s*transparent/);
    expect(body).toMatch(/color:\s*var\(--text-primary-rack\)/);
    const hover = rule(".admin-action:hover:not(:disabled)");
    expect(hover).toMatch(/box-shadow:\s*inset 0 0 0 1000px var\(--row-surface-hover\)/);
    expect(hover).not.toMatch(/--divider/);
  });

  it("the lead is a 2px ink edge with the pixel given back by padding, and is not brand", () => {
    const body = rule(".admin-action.admin-action-lead");
    expect(body).toMatch(/border:\s*2px solid var\(--selection-rule\)/);
    expect(body).toMatch(/padding:\s*calc\(var\(--space-xs\) - 1px\) calc\(var\(--space-md\) - 1px\)/);
    expect(body).not.toMatch(/accent|background/);
  });

  it("every button in the group is control-edged, or is navigation, a link or a menu row", () => {
    for (const [name, source] of Object.entries({ settings, rules })) {
      const buttons = code(source).match(/<button\b(?:=>|[^>])*>/g) ?? [];
      expect(buttons.length, `${name}: no buttons found, so the check would be vacuous`).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button, `${name}: a button with no drawn class`).toMatch(/control-edge|admin-back|admin-link|admin-option/);
      }
    }
  });
});

describe("08.1 group-five finish-review closure: the settings table, the checkboxes, the merge picker, the subtree", () => {
  it("the rules table is a column capped at 900px, not a band across the window", () => {
    expect(rule(".admin-table")).toMatch(/max-width:\s*900px/);
  });

  it("a bulk-selection box is a drawn square, not the engine's circle", () => {
    const body = rule(".admin-check");
    expect(body).toMatch(/appearance:\s*none/);
    expect(body).toMatch(/border:\s*1px solid var\(--border-control\)/);
    expect(body).toMatch(/border-radius:\s*var\(--radius-mark\)/);
    expect(rule(".admin-check:checked::after")).toMatch(/border:\s*solid var\(--text-primary-rack\)/);
  });

});

describe("a chosen value is not an action", () => {
  it("the chosen segment is an ink edge and a 2px ink foot rule on no fill", () => {
    const body = rule('.admin-choice[aria-checked="true"],\n.admin-choice[aria-pressed="true"]');
    expect(body).toMatch(/border-color:\s*var\(--selection-rule\)/);
    expect(body).toMatch(/box-shadow:\s*inset 0 -2px 0 var\(--selection-rule\)/);
    expect(body).not.toMatch(/background|accent/);
  });

  it("settings uses it for its segmented controls, and the old fills are gone", () => {
    expect(code(settings)).toMatch(/control-edge admin-choice/);
    expect(code(settings)).not.toMatch(/background:\s*selected/);
  });

  it("does not change weight when chosen: a segment that grows pushes its neighbours along", () => {
    expect(rule('.admin-choice[aria-checked="true"],\n.admin-choice[aria-pressed="true"]')).not.toMatch(/font-weight/);
    expect(rule(".admin-choice")).not.toMatch(/font-weight/);
  });
});

describe("selection is the board's neutral rule, and no ring hangs off a prop", () => {
  it("no component in the group sets an inline outline", () => {
    for (const [name, source] of Object.entries(SOURCES)) {
      expect(code(source), name).not.toMatch(/outline/);
    }
  });

});

describe("the permission-rules table reads through hairlines and spacing", () => {
  it("has no zebra striping, no tinted row and no fill in the group stylesheet", () => {
    expect(css).not.toMatch(/nth-child|nth-of-type|:odd|:even/);
    expect(code(css)).not.toMatch(/\.admin-table[^{]*\{[^}]*background/);
  });

  it("lines its columns up on one grid and underlines every row with a hairline", () => {
    expect(rule(".admin-table-row")).toMatch(/display:\s*grid/);
    expect(rule(".admin-table-row")).toMatch(/grid-template-columns:/);
    expect(rule(".admin-table-row")).toMatch(/border-bottom:\s*1px solid var\(--divider\)/);
  });

  it("labels its columns, so four bare words are not left to be inferred", () => {
    for (const heading of ["Project", "Tool", "Decision", "Granted"]) {
      expect(rules).toContain(`>${heading}</span>`);
    }
  });
});

describe("fields and text", () => {
  it("every input and textarea except a checkbox draws its boundary from the control role", () => {
    for (const [name, source] of Object.entries({ settings })) {
      const fields = code(source).match(/<(?:input|textarea)\b(?:=>|[^>])*>/g) ?? [];
      expect(fields.length, `${name}: no fields found, so the check would be vacuous`).toBeGreaterThan(0);
      for (const field of fields) expect(field, `${name}: a field with no control edge`).toMatch(/control-edge/);
    }
  });

  it("a field's focus ring is the ink rule, and a checkbox does not take the system accent", () => {
    const ring = rule(".admin-field:focus-visible");
    expect(ring).toMatch(/outline:\s*2px solid var\(--selection-rule\)/);
    expect(rule(".admin-check")).toMatch(/accent-color:\s*var\(--text-primary-rack\)/);
  });

  it("an inline text action is ink and underlined, not brand", () => {
    const body = rule(".admin-link");
    expect(body).toMatch(/color:\s*var\(--text-primary-rack\)/);
    expect(body).toMatch(/text-decoration:\s*underline/);
  });
});
