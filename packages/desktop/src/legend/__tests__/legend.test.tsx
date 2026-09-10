import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import * as icons from "lucide-react";
import { MARKS } from "../marks";
import { Legend } from "../Legend";
import { STRIP } from "../../theme/tokens";

/**
 * The five strip tints are close in luminance by necessity, so the glyph and
 * the printed word are load-bearing rather than decorative (01-UI-SPEC.md
 * "Honest risk"). This test is what keeps a later simplification from
 * removing them, and what keeps the four row-state surfaces from silently
 * converging on the same value.
 */
describe("row-state surfaces", () => {
  it("are four pairwise-distinct values", () => {
    const values = [
      STRIP.rowSurface,
      STRIP.rowSurfaceHover,
      STRIP.rowSurfaceSelected,
      STRIP.rowSurfaceSelectedUnfocused,
    ];
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("MARKS registry", () => {
  it("gives every entry a non-empty glyph and label", () => {
    for (const mark of MARKS) {
      expect(mark.glyph.length).toBeGreaterThan(0);
      expect(mark.label.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate ids", () => {
    const ids = MARKS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every entry a non-empty meaning", () => {
    for (const mark of MARKS) {
      expect(mark.meaning.length).toBeGreaterThan(0);
    }
  });

  it("resolves every glyph name to a real lucide-react export — a typo fails here, not at runtime", () => {
    const iconNamespace = icons as unknown as Record<string, unknown>;
    for (const mark of MARKS) {
      expect(iconNamespace[mark.glyph], `mark "${mark.id}" names an unknown glyph "${mark.glyph}"`).toBeDefined();
    }
  });
});

/**
 * The "agent" mark channel (02-03-PLAN.md Task 2, AGNT-06) — six new marks published before any
 * surface renders them: five run-status values plus the orthogonal blocked indicator.
 */
describe("agent channel", () => {
  const agentMarks = MARKS.filter((m) => m.channel === "agent");

  it("has exactly six entries with the exact ids/glyphs/labels 02-UI-SPEC.md specifies", () => {
    const expected = [
      { id: "run-running", glyph: "Loader", label: "Running" },
      { id: "run-blocked", glyph: "ShieldAlert", label: "Blocked" },
      { id: "run-completed", glyph: "CircleCheckBig", label: "Completed" },
      { id: "run-failed", glyph: "CircleX", label: "Failed" },
      { id: "run-interrupted", glyph: "CircleSlash", label: "Interrupted" },
      { id: "blocked-indicator", glyph: "ShieldAlert", label: "Blocked" },
    ];
    expect(agentMarks).toHaveLength(6);
    for (const exp of expected) {
      const mark = agentMarks.find((m) => m.id === exp.id);
      expect(mark, `missing agent mark "${exp.id}"`).toBeDefined();
      expect(mark?.glyph).toBe(exp.glyph);
      expect(mark?.label).toBe(exp.label);
    }
  });

  it("states run-interrupted is a normal, user-initiated outcome, not an error (D-35)", () => {
    const mark = agentMarks.find((m) => m.id === "run-interrupted");
    expect(mark?.meaning).toMatch(/normal/i);
    expect(mark?.meaning).toMatch(/stopped/i);
  });
});

describe("Legend surface", () => {
  it("renders one row per MARKS entry", () => {
    render(<Legend />);
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(MARKS.length);
  });
});
