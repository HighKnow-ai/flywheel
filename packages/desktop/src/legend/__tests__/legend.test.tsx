import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import * as icons from "lucide-react";
import { MARKS } from "../marks";
import { Legend } from "../Legend";
import { MODES, PALETTES } from "../../theme/tokens";
import marksSource from "../marks.ts?raw";
import legendSource from "../Legend.tsx?raw";
import adminCss from "../../styles/admin-surfaces.css?raw";

/**
 * The glyph and the printed word carry every status, because colour is no longer even a redundant
 * channel (D-11 removed the paper tints). This test is what keeps the four row-state surfaces from
 * silently converging on the same value; the selection rule that actually tells two of them apart is
 * pinned further down.
 */
describe("row-state surfaces", () => {
  it.each(MODES)("are four pairwise-distinct values in %s", (mode) => {
    const p = PALETTES[mode];
    const values = [p.rowSurface, p.rowSurfaceHover, p.rowSurfaceSelected, p.rowSurfaceSelectedUnfocused];
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
 * (D-88), the board row's CI-failure pill (D-124), and the board row's two graded change
 * annotations — commits ahead and uncommitted changes (D-15) — and the board row's scope-refusal
 * count (D-153).
 */
describe("agent channel", () => {
  const agentMarks = MARKS.filter((m) => m.channel === "agent");

  it("has exactly twenty entries with the exact ids/glyphs/labels 02-UI-SPEC.md/03-UI-SPEC.md/05-03-PLAN.md/07-08-PLAN.md/08.1-01-PLAN.md specify", () => {
    const expected = [
      { id: "run-running", glyph: "Loader", label: "Running" },
      { id: "run-completed", glyph: "CircleCheckBig", label: "Completed" },
      { id: "run-failed", glyph: "CircleX", label: "Failed" },
      { id: "run-interrupted", glyph: "CircleSlash", label: "Interrupted" },
      { id: "blocked-indicator", glyph: "ShieldAlert", label: "Blocked" },
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
    ];
    expect(agentMarks).toHaveLength(20);
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

/** Comment lines out, so a doc comment may still say what the old code did. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");

/** One rule's declaration block in the group stylesheet, by its exact selector. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.[\]":()-]/g, "\\$&");
  const match = adminCss.match(new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  expect(match, `${selector} is not declared in admin-surfaces.css`).toBeTruthy();
  return match![2];
}

const rowFor = (label: string) => {
  const row = screen.getAllByRole("listitem").find((r) => r.textContent?.includes(label));
  expect(row, `legend row "${label}" not found`).toBeDefined();
  return row as HTMLElement;
};

/**
 * 08.1 plan 18. The legend is the published contract for every mark in the product, so it is allowed
 * to say only what the product draws. D-11 removed the tint channel; A-05 changed two glyphs; A-06 made
 * the 2px rule, not the surface, the thing that tells a selected row from an unfocused one.
 */
describe("the legend tells the truth about the world 08.1 built", () => {
  it("retires the paper tint: no strip-stock id, no strip token and no strip ink anywhere in the registry or the surface", () => {
    expect(code(marksSource)).not.toMatch(/strip-/);
    expect(code(legendSource)).not.toMatch(/--strip-|--text-primary-strip/);
    expect(MARKS.filter((m) => m.channel === "status").map((m) => m.id)).toEqual([
      "status-backlog",
      "status-todo",
      "status-in-progress",
      "status-in-review",
      "status-done",
    ]);
  });

  it("describes no outline-only glyph as filled", () => {
    for (const mark of MARKS.filter((m) => m.channel === "status")) {
      expect(mark.meaning, `${mark.id} says "filled" of an outline glyph`).not.toMatch(/\bfilled\b/i);
    }
  });

  it("gives the commits-ahead and dirty cues the glyphs A-05 approved, and gives them to nothing else", () => {
    const glyph = (id: string) => MARKS.find((m) => m.id === id)?.glyph;
    expect(glyph("change-ahead")).toBe("Triangle");
    expect(glyph("change-dirty")).toBe("Dot");
    for (const g of ["Triangle", "Dot"]) {
      const users = MARKS.filter((m) => m.glyph === g).map((m) => m.id);
      expect(users, `the ${g} glyph must mean one thing`).toHaveLength(1);
    }
  });

  it("no longer claims the accent marks the current project (D-12: the brand carries progress, never position)", () => {
    const current = MARKS.find((m) => m.id === "project-current");
    expect(current?.meaning).not.toMatch(/accent|brand|blue/i);
    expect(current?.meaning).toMatch(/neutral|page ground|lift/i);
  });

  it("says what the focus ring is in the brand colour, and where the ink rule stands in for it", () => {
    const focus = MARKS.find((m) => m.id === "focus-ring");
    expect(focus?.meaning).toMatch(/brand/i);
    expect(focus?.meaning).toMatch(/ink/i);
  });

  it("draws the selection rule on the selected-row swatches, because the two surfaces are 1.011 apart (A-06(b))", () => {
    render(<Legend />);
    const swatch = (label: string) => rowFor(label).querySelector("[aria-hidden]") as HTMLElement;
    const focused = swatch("Selected row");
    const unfocused = swatch("Selected, unfocused row");
    const idle = swatch("Idle row");
    expect(focused.style.borderLeftWidth).toBe("2px");
    expect(focused.style.borderLeftColor).toBe("var(--selection-rule)");
    expect(unfocused.style.borderLeftWidth).toBe("2px");
    expect(unfocused.style.borderLeftColor).toBe("var(--selection-rule-unfocused)");
    expect(idle.style.borderLeftColor).not.toMatch(/selection-rule/);
  });

  it("paints no status swatch in a tint: a status glyph sits on the same neutral swatch as a priority glyph", () => {
    render(<Legend />);
    const bg = (label: string) => (rowFor(label).querySelector("[aria-hidden]") as HTMLElement).style.background;
    expect(bg("In Progress")).toBe(bg("Urgent"));
    expect(bg("Done")).toBe(bg("Urgent"));
  });

  it("defines the epic roster's two graphic marks, the progress fill and the task-distribution strip", () => {
    render(<Legend />);
    expect(MARKS.find((m) => m.id === "epic-progress")?.channel).toBe("epic");
    expect(MARKS.find((m) => m.id === "epic-distribution")?.channel).toBe("epic");
    expect(rowFor("Epic progress").textContent).toMatch(/tasks done/i);
    expect(rowFor("Task distribution").textContent).toMatch(/status/i);
  });

  it("pins the registry by exact per-channel count, so removing or adding a mark is one change with its count", () => {
    const counts: Record<string, number> = {};
    for (const mark of MARKS) counts[mark.channel] = (counts[mark.channel] ?? 0) + 1;
    expect(counts).toEqual({
      "row-state": 4,
      focus: 1,
      status: 5,
      priority: 5,
      epic: 5,
      criteria: 7,
      estimate: 3,
      assignee: 4,
      project: 3,
      agent: 20,
    });
    expect(MARKS).toHaveLength(57);
  });
});

/**
 * 08.1 group-five finish-review closure. The legend is the published contract, so it may not publish two rows
 * that cannot be told apart, a swatch that is not the mark, or an argument with a reviewer.
 */
describe("the legend can be used to tell its marks apart (08.1 finish-review closure)", () => {
  it("publishes no two marks under one heading with the same printed label", () => {
    // Per channel: "Medium" is both a priority and an estimate, under two headings and two different glyphs.
    // Two rows titled "Blocked" under Agent, wearing one shield, were the defect.
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const mark of MARKS) {
      const key = `${mark.channel}/${mark.label.toLowerCase()}`;
      if (seen.has(key)) clashes.push(`${mark.id} and ${seen.get(key)} are both "${mark.label}"`);
      seen.set(key, mark.id);
    }
    expect(clashes).toEqual([]);
  });

  it("carries one Blocked mark with both contexts, not two rows with the same word and the same shield", () => {
    const blocked = MARKS.filter((m) => m.label === "Blocked");
    expect(blocked.map((m) => m.id)).toEqual(["blocked-indicator"]);
    expect(blocked[0].meaning).toMatch(/run/i);
    expect(blocked[0].meaning).toMatch(/task row/i);
    expect(MARKS.find((m) => m.id === "run-blocked")).toBeUndefined();
  });

  it("gives No epic and No evidence different glyphs, because both can sit on one task row", () => {
    const glyph = (id: string) => MARKS.find((m) => m.id === id)?.glyph;
    expect(glyph("epic-pill-none")).not.toBe(glyph("criterion-no-evidence"));
  });

  it("states what a mark means and nothing else: no decision id, no design history, no argument with a reviewer", () => {
    const offenders = MARKS.filter((m) =>
      /\b[DAG]-\d+\b|UI-SPEC|copy-paste|precedent|\bplan \d|ShieldAlert|PLAN\.md/i.test(m.meaning + " " + m.label),
    ).map((m) => m.id);
    expect(offenders).toEqual([]);
  });

  it("draws a swatch as the row draws the mark: the estimate letter, the triangle with its count, the fraction", () => {
    render(<Legend />);
    const swatch = (label: string) => rowFor(label).querySelector("[aria-hidden]") as HTMLElement;
    // The estimate rows by id, because "Medium" is also a priority.
    const estimateRows = screen.getAllByRole("listitem").filter((r) => /^[SML]:/.test(r.querySelector(".legend-meaning")?.textContent ?? ""));
    expect(estimateRows.map((r) => (r.querySelector("[aria-hidden]") as HTMLElement).textContent)).toEqual(["S", "M", "L"]);
    for (const row of estimateRows) expect(row.querySelector("[aria-hidden] svg"), "no icon on the row").toBeNull();
    expect(swatch("Commits ahead").querySelector("svg")).not.toBeNull();
    expect(swatch("Commits ahead").textContent).toBe("3");
    expect(swatch("Criteria checked/total").textContent).toBe("2/5");
    expect(swatch("Criteria checked/total").querySelector("svg")).toBeNull();
    // A mark with no sample is still its glyph.
    expect(swatch("Backlog").querySelector("svg")).not.toBeNull();
  });
});

describe("the legend is navigable (08.1 finish-review closure)", () => {
  it("opens with an index of every channel, as links and not list items", () => {
    render(<Legend />);
    const nav = screen.getByRole("navigation", { name: "Legend channels" });
    const channels = new Set(MARKS.map((m) => m.channel));
    expect(channels.size).toBe(10);
    expect(nav.querySelectorAll("a")).toHaveLength(10);
    expect(within(nav).queryAllByRole("listitem")).toHaveLength(0);
    for (const a of Array.from(nav.querySelectorAll("a"))) {
      expect(document.getElementById(a.getAttribute("href")!.slice(1)), a.textContent ?? "").not.toBeNull();
    }
  });

  it("gives the embedded form the title the dialog has, and only the dialog a Close", () => {
    const { unmount } = render(<Legend />);
    expect(screen.getByRole("heading", { level: 1, name: "Legend" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Close legend" })).toBeNull();
    unmount();
    render(<Legend onClose={() => {}} />);
    expect(screen.getByRole("heading", { level: 1, name: "Legend" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close legend" })).toBeInTheDocument();
  });

  it("keeps the channel heading in view while its rows scroll, on the surface it sits on", () => {
    const body = rule(".legend-channel > h2");
    expect(body).toMatch(/position:\s*sticky/);
    expect(body).toMatch(/top:\s*0/);
    expect(body).toMatch(/background:\s*var\(--legend-ground\)/);
    expect(rule(".legend-dialog")).toMatch(/--legend-ground:\s*var\(--surface-secondary\)/);
    // Inside the dialog's own scroll the heading cancels its padding, or it would hang 24px below the top.
    expect(rule(".legend-dialog .legend-channel > h2")).toMatch(/top:\s*calc\(var\(--space-lg\) \* -1\)/);
  });
});

describe("the legend overlay is a dialog on the dialog tier (UI-SPEC § Overlay Rule)", () => {
  it("draws its scrim, shadow and edge from the roles, never a literal, and holds no inline colour", () => {
    expect(code(legendSource)).not.toMatch(/rgba?\(|#[0-9a-fA-F]{6}/);
    expect(rule(".legend-scrim")).toMatch(/background:\s*var\(--scrim\)/);
    const dialog = rule(".legend-dialog");
    expect(dialog).toMatch(/box-shadow:\s*var\(--shadow-dialog\)/);
    expect(dialog).toMatch(/border:\s*1px solid var\(--border-dialog\)/);
    expect(dialog).toMatch(/border-radius:\s*var\(--radius-chrome\)/);
    expect(dialog).not.toMatch(/--border-(popover|sheet)|--shadow-(popover|sheet)/);
  });

  it("opens at full value on the first frame: no opacity, no animation, no transition on the scrim or the dialog", () => {
    expect(rule(".legend-scrim")).not.toMatch(/opacity|animation|transition/);
    expect(rule(".legend-dialog")).not.toMatch(/opacity|animation|transition/);
  });

  it("mounts the scrim and the dialog with those classes", () => {
    render(<Legend onClose={() => {}} />);
    const dialog = screen.getByRole("dialog", { name: "Legend" });
    expect(dialog.className).toContain("legend-dialog");
    expect(dialog.parentElement?.className).toContain("legend-scrim");
  });
});
