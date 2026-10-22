import { describe, expect, it } from "vitest";
import { MARKS } from "../marks";
import { isIconName } from "../../components/Icon";

/**
 * The mark registry (legend/marks.ts): the glyph and word a few screens still look up by id until #107 moves
 * them onto components/StateBadge.tsx. The Legend surface that rendered it was retired with Mission Control.
 */
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

  it("resolves every glyph name in the icon registry (components/Icon.tsx), so a typo fails here, not at runtime", () => {
    for (const mark of MARKS) {
      expect(isIconName(mark.glyph), `mark "${mark.id}" names a glyph "${mark.glyph}" the registry does not carry`).toBe(true);
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
 * (D-88), the board row's CI-failure pill (D-124), the state vocabulary's two new marks, awaiting review and
 * merged (Phase 14 plan 04, D-19), and the board row's two graded change
 * annotations — commits ahead and uncommitted changes (D-15) — and the board row's scope-refusal
 * count (D-153).
 */
describe("agent channel", () => {
  const agentMarks = MARKS.filter((m) => m.channel === "agent");

  it("has exactly twenty-two entries with the exact ids/glyphs/labels 02-UI-SPEC.md/03-UI-SPEC.md/05-03-PLAN.md/07-08-PLAN.md/08.1-01-PLAN.md specify", () => {
    const expected = [
      { id: "run-running", glyph: "Loader", label: "Running" },
      { id: "run-completed", glyph: "CircleCheckBig", label: "Completed" },
      { id: "run-failed", glyph: "CircleX", label: "Failed" },
      { id: "run-interrupted", glyph: "CircleSlash", label: "Interrupted" },
      { id: "blocked-indicator", glyph: "ShieldAlert", label: "Waiting on you" },
      { id: "worktree-missing", glyph: "TriangleAlert", label: "Missing" },
      { id: "run-abandoned", glyph: "Unplug", label: "Abandoned" },
      { id: "recovery-needed", glyph: "TriangleAlert", label: "Needs Decision" },
      { id: "ci-failed", glyph: "CircleX", label: "CI failed" },
      { id: "change-ahead", glyph: "Triangle", label: "Commits ahead" },
      { id: "change-dirty", glyph: "Dot", label: "Uncommitted changes" },
      { id: "scope-denied", glyph: "ShieldBan", label: "Scope refusals" },
      { id: "destructive-gate", glyph: "OctagonAlert", label: "Destructive" },
      { id: "authoring-stage-challenge", glyph: "MessageCircleQuestion", label: "Challenge" },
      { id: "authoring-stage-decompose", glyph: "ListTree", label: "Decompose" },
      { id: "authoring-stage-criteria", glyph: "ListChecks", label: "Criteria" },
      { id: "proposal-pending", glyph: "FileClock", label: "Pending proposal" },
      { id: "worktree-reclaimable", glyph: "Recycle", label: "Reclaimable" },
      { id: "worktree-in-use", glyph: "Activity", label: "In use" },
      { id: "worktree-keep", glyph: "Lock", label: "Keep" },
      { id: "run-awaiting-review", glyph: "Eye", label: "Awaiting review" },
      { id: "run-merged", glyph: "GitMerge", label: "Merged" },
    ];
    expect(agentMarks).toHaveLength(22);
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
