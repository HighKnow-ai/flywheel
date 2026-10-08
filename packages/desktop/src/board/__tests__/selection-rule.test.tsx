/**
 * A-06: selection on a task row is a 2px left rule PLUS, while the list has focus, a surface shift.
 * Once the list loses focus the row keeps the lighter rule on the idle surface (08.1-14 finish
 * review: the two selected surfaces were only 1.01 apart, so band-present against band-absent is the
 * second cue). This is the BoardRow half of the proof; theme/__tests__/contrast.test.ts proves the rule roles are perceptible, and
 * the browser arm paints a real row in WebKit (legibility.browser.test.tsx).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import appCss from "../../App.css?raw";
import { BoardRow } from "../BoardRow";
import type { BoardItem } from "../useBoardQuery";

const ITEM: BoardItem = {
  id: "t1",
  kind: "task",
  key: "FLY-9",
  title: "Add push retry",
  status: "todo",
  rank: "a0",
  priority: 2,
  epicId: null,
  estimate: null,
  criteriaChecked: 0,
  criteriaTotal: 0,
};

afterEach(cleanup);

function rule(props: { selected?: boolean; focused?: boolean }): string {
  render(<BoardRow item={ITEM} {...props} />);
  return screen.getByRole("listitem").style.borderLeft;
}

describe("the task row's 2px selection rule (A-06)", () => {
  it("is full ink while the list has focus, lighter once it has lost it, and transparent when idle", () => {
    const idle = rule({});
    cleanup();
    const unfocused = rule({ selected: true });
    cleanup();
    const focused = rule({ selected: true, focused: true });

    expect(focused).toContain("var(--selection-rule)");
    expect(unfocused).toContain("var(--selection-rule-unfocused)");
    expect(idle).toContain("transparent");
    expect(new Set([idle, unfocused, focused]).size, "idle, unfocused and focused must be three different rules").toBe(3);
  });

  it("is 2px wide in every state, so a row changing state never reflows", () => {
    for (const props of [{}, { selected: true }, { selected: true, focused: true }]) {
      expect(rule(props)).toMatch(/^2px solid /);
      cleanup();
    }
  });

  it("shifts the surface only while the list has focus: unfocused selection sits on the idle surface", () => {
    const surface = (props: { selected?: boolean; focused?: boolean }): string => {
      render(<BoardRow item={ITEM} {...props} />);
      const style = screen.getByRole("listitem").getAttribute("style") ?? "";
      cleanup();
      return style.match(/background:\s*([^;]+);/)?.[1] ?? "";
    };
    expect(surface({})).toBe("var(--row-surface)");
    expect(surface({ selected: true, focused: true })).toBe("var(--row-surface-selected)");
    // Band-present against band-absent: the unfocused row no longer carries a near-identical second band.
    expect(surface({ selected: true })).toBe("var(--row-surface)");
  });

  it("paints no focus ring from the `focused` prop: a pointer-driven selection shows only the rule", () => {
    // `focused` is true after a mouse click too (selected + the list holds DOM focus). If the ring were
    // an inline style driven by it, every click would leave a permanent blue rectangle and the brand
    // would be the cursor (D-12). The ring belongs to :focus-visible in App.css, asserted below.
    render(<BoardRow item={ITEM} selected focused />);
    const row = screen.getByRole("listitem");
    expect(row.style.outline).toBe("");
    expect(row.style.outlineOffset).toBe("");
    expect(row.getAttribute("style")).not.toContain("--focus-ring");
  });

  it("draws the ring on :focus-visible only, inset past the 2px rule (-4, not -2)", () => {
    const css = appCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const rule = css.match(/\.board-row:focus-visible\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(rule, "App.css has no .board-row:focus-visible rule").toContain("var(--focus-ring)");
    // The ring is 2px wide; an offset of -2 would paint it exactly over the 2px rule.
    expect(rule).toMatch(/outline-offset:\s*-4px/);
    expect(css).toMatch(/\.board-row[^{]*\{\s*outline:\s*none;?\s*\}/);
  });

  it("paints no per-status tint: the row's only background is the selection overlay", () => {
    render(<BoardRow item={{ ...ITEM, status: "in_review" }} />);
    expect(screen.getByRole("listitem").getAttribute("style")).not.toContain("--strip-");
  });
});
