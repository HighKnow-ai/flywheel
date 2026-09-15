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
 * The "agent" mark channel (02-03-PLAN.md Task 2, AGNT-06; plan 03-09 Task 2, WORK-06) — seven
 * marks published before any surface renders them: five run-status values, the orthogonal blocked
 * indicator, and the missing-worktree decision banner's own glyph (D-45).
 */
describe("agent channel", () => {
  const agentMarks = MARKS.filter((m) => m.channel === "agent");

  it("has exactly seven entries with the exact ids/glyphs/labels 02-UI-SPEC.md/03-UI-SPEC.md specify", () => {
    const expected = [
      { id: "run-running", glyph: "Loader", label: "Running" },
      { id: "run-blocked", glyph: "ShieldAlert", label: "Blocked" },
      { id: "run-completed", glyph: "CircleCheckBig", label: "Completed" },
      { id: "run-failed", glyph: "CircleX", label: "Failed" },
      { id: "run-interrupted", glyph: "CircleSlash", label: "Interrupted" },
      { id: "blocked-indicator", glyph: "ShieldAlert", label: "Blocked" },
      { id: "worktree-missing", glyph: "TriangleAlert", label: "Missing" },
    ];
    expect(agentMarks).toHaveLength(7);
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

  it("renders the worktree-missing mark with its printed word (03-UI-SPEC.md, D-45) — no mark may exist that the legend does not define", () => {
    render(<Legend />);
    const rows = screen.getAllByRole("listitem");
    const worktreeMissingRow = rows.find((row) => row.textContent?.includes("Missing"));
    expect(worktreeMissingRow, "legend row for the worktree-missing mark not found").toBeDefined();
  });
});
