/**
 * A-06: selection on a task row is a surface shift PLUS a 2px left rule, and the rule carries the
 * focus distinction — the two selected surfaces are only 1.011 / 1.014 apart. This is the BoardRow
 * half of the proof; theme/__tests__/contrast.test.ts proves the rule roles are perceptible, and
 * the browser arm paints a real row in WebKit (legibility.browser.test.tsx).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
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

  it("keeps the keyboard-focus ring clear of the rule: inset past it, not over it", () => {
    render(<BoardRow item={ITEM} selected focused />);
    const row = screen.getByRole("listitem");
    expect(row.style.outline).toContain("var(--focus-ring)");
    // The ring is 2px wide; an offset of -2 would paint it exactly over the 2px rule.
    expect(row.style.outlineOffset).toBe("-4px");
  });

  it("paints no per-status tint: the row's only background is the selection overlay", () => {
    render(<BoardRow item={{ ...ITEM, status: "in_review" }} />);
    expect(screen.getByRole("listitem").getAttribute("style")).not.toContain("--strip-");
  });
});
