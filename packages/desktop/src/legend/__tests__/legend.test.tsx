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
 * The "agent" mark channel (02-03-PLAN.md Task 2, AGNT-06; plan 03-09 Task 2, WORK-06; plan
 * 03-10 Task 2, D-49; plan 03-11 Task 2, D-46; plan 03-12 Task 2, D-56/D-57; plan 05-03 Task 3,
 * D-88; phase 07 plan 07-08 Task 2, D-124) — fifteen marks published before any surface renders
 * them: five run-status values, the orthogonal blocked indicator, the missing-worktree decision
 * banner's own glyph (D-45), the abandoned-run badge's own glyph (D-49), the row-level "Needs
 * Decision" rollup pill's own glyph (D-46), the destructive-action gate card's own stop-sign glyph
 * (D-56), the three-stage authoring machine's own marks, the proposal tray's pending-proposal mark
 * (D-88), and the board row's CI-failure pill (D-124).
 */
describe("agent channel", () => {
  const agentMarks = MARKS.filter((m) => m.channel === "agent");

  it("has exactly fifteen entries with the exact ids/glyphs/labels 02-UI-SPEC.md/03-UI-SPEC.md/05-03-PLAN.md/07-08-PLAN.md specify", () => {
    const expected = [
      { id: "run-running", glyph: "Loader", label: "Running" },
      { id: "run-blocked", glyph: "ShieldAlert", label: "Blocked" },
      { id: "run-completed", glyph: "CircleCheckBig", label: "Completed" },
      { id: "run-failed", glyph: "CircleX", label: "Failed" },
      { id: "run-interrupted", glyph: "CircleSlash", label: "Interrupted" },
      { id: "blocked-indicator", glyph: "ShieldAlert", label: "Blocked" },
      { id: "worktree-missing", glyph: "TriangleAlert", label: "Missing" },
      { id: "run-abandoned", glyph: "Unplug", label: "Abandoned" },
      { id: "recovery-needed", glyph: "TriangleAlert", label: "Needs Decision" },
      { id: "ci-failed", glyph: "CircleX", label: "CI failed" },
      { id: "destructive-gate", glyph: "OctagonAlert", label: "Destructive" },
      { id: "authoring-stage-challenge", glyph: "MessageCircleQuestion", label: "Challenge" },
      { id: "authoring-stage-decompose", glyph: "ListTree", label: "Decompose" },
      { id: "authoring-stage-criteria", glyph: "ListChecks", label: "Criteria" },
      { id: "proposal-pending", glyph: "FileClock", label: "Pending proposal" },
    ];
    expect(agentMarks).toHaveLength(15);
    for (const exp of expected) {
      const mark = agentMarks.find((m) => m.id === exp.id);
      expect(mark, `missing agent mark "${exp.id}"`).toBeDefined();
      expect(mark?.glyph).toBe(exp.glyph);
      expect(mark?.label).toBe(exp.label);
    }
  });

  it("D-46: the pending-proposal mark is a distinct signal, never the blocked-run glyph/wording", () => {
    const mark = agentMarks.find((m) => m.id === "proposal-pending");
    expect(mark?.glyph).not.toBe("ShieldAlert");
    expect(mark?.label.toLowerCase()).not.toBe("blocked");
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

  it("renders the recovery-needed mark with its printed word (03-UI-SPEC.md, D-46) — no mark may exist that the legend does not define", () => {
    render(<Legend />);
    const rows = screen.getAllByRole("listitem");
    const recoveryNeededRow = rows.find((row) => row.textContent?.includes("Needs Decision"));
    expect(recoveryNeededRow, "legend row for the recovery-needed mark not found").toBeDefined();
  });

  it("renders the destructive-gate mark with its printed word (03-UI-SPEC.md, D-56) — no mark may exist that the legend does not define", () => {
    render(<Legend />);
    const rows = screen.getAllByRole("listitem");
    const destructiveGateRow = rows.find((row) => row.textContent?.includes("Destructive"));
    expect(destructiveGateRow, "legend row for the destructive-gate mark not found").toBeDefined();
  });

  it.each([
    ["criterion-no-evidence", "No evidence"],
    ["criterion-anchor-fresh", "Evidence current"],
    ["criterion-anchor-stale", "Evidence changed"],
    ["integrated", "Integrated"],
  ])(
    "defines and renders the Phase 8 mark %s with its printed word (D-139/D-140/D-141) — no mark may exist that the legend does not define",
    (id, label) => {
      const mark = MARKS.find((m) => m.id === id);
      expect(mark, `missing mark "${id}"`).toBeDefined();
      expect(mark?.meaning.length).toBeGreaterThan(0);
      render(<Legend />);
      const row = screen.getAllByRole("listitem").find((r) => r.textContent?.includes(label));
      expect(row, `legend row for "${id}" not found`).toBeDefined();
    },
  );
});
