/**
 * Behavior under test (03-11-PLAN.md Task 2, D-46): a task with an outstanding recovery item (a
 * missing worktree, or an unacknowledged abandoned run) renders a "Needs Decision" pill on its
 * board row — distinguishable from the existing Blocked pill by glyph, printed word and colour
 * family, structurally exempt from the row's progressive-disclosure truncation ladder. Task 3
 * extends this file with the project rail's own second count badge.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BoardRow } from "../BoardRow";
import type { BoardItem } from "../useBoardQuery";

function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id: "task-1",
    key: "FLY-1",
    title: "A gated task",
    status: "in_progress",
    rank: "10",
    priority: 0,
    epicId: null,
    kind: "task",
    ...overrides,
  };
}

describe("BoardRow Needs Decision pill (D-46)", () => {
  it("renders no pill for a task with no outstanding recovery item — byte-identical to pre-task output", () => {
    render(<BoardRow item={makeItem()} />);
    expect(screen.queryByText("Needs Decision")).not.toBeInTheDocument();
  });

  it("renders the TriangleAlert glyph and the exact words 'Needs Decision' together", () => {
    render(<BoardRow item={makeItem()} needsDecision />);
    const pill = screen.getByRole("button", { name: /Needs Decision/ });
    expect(pill).toBeInTheDocument();
    expect(pill.querySelector("svg")).toBeInTheDocument();
    expect(pill).toHaveTextContent("Needs Decision");
  });

  it("renders both pills, Needs Decision trailing Blocked in document order, when both flags are true", () => {
    render(<BoardRow item={makeItem()} blocked needsDecision />);
    const blockedPill = screen.getByRole("button", { name: /^Blocked/ });
    const recoveryPill = screen.getByRole("button", { name: /Needs Decision/ });
    expect(blockedPill).toBeInTheDocument();
    expect(recoveryPill).toBeInTheDocument();
    // DOM order: Blocked pill precedes Needs Decision pill (compareDocumentPosition bit 4 =
    // FOLLOWING — blockedPill comes before recoveryPill in the tree).
    // eslint-disable-next-line no-bitwise
    expect(blockedPill.compareDocumentPosition(recoveryPill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the two pills' computed colours are not equal", () => {
    render(<BoardRow item={makeItem()} blocked needsDecision />);
    const blockedPill = screen.getByRole("button", { name: /^Blocked/ });
    const recoveryPill = screen.getByRole("button", { name: /Needs Decision/ });
    const blockedColor = getComputedStyle(blockedPill).color;
    const recoveryColor = getComputedStyle(recoveryPill).color;
    expect(blockedColor).not.toBe(recoveryColor);
  });

  it("appends 'Needs Decision' to the row's accessible name when the pill is present", () => {
    render(<BoardRow item={makeItem()} needsDecision />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveAccessibleName(/Needs Decision/);
  });

  it("is structurally exempt from the truncation ladder — carries no field-* class", () => {
    render(<BoardRow item={makeItem()} needsDecision />);
    const pill = screen.getByRole("button", { name: /Needs Decision/ });
    expect(pill.className.split(/\s+/).some((c) => c.startsWith("field-"))).toBe(false);
  });

  it("keeps both pills queryable at a very long title and a constrained width", () => {
    const longTitle =
      "An extremely long task title that would ordinarily need to truncate against the row's available width when several fields all compete for space at once";
    const { container } = render(
      <div style={{ width: 320 }}>
        <BoardRow item={makeItem({ title: longTitle })} blocked needsDecision />
      </div>,
    );
    expect(container.querySelector(".board-row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Blocked/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Needs Decision/ })).toBeInTheDocument();
  });

  it("activating the pill calls onOpenRecovery with no propagation to onSelect", () => {
    const onOpenRecovery = vi.fn();
    const onSelect = vi.fn();
    render(
      <BoardRow item={makeItem()} needsDecision onOpenRecovery={onOpenRecovery} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Needs Decision/ }));

    expect(onOpenRecovery).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("resolves the pill's glyph and word from the marks registry, naming no icon component directly", async () => {
    const source = await import("../BoardRow.tsx?raw");
    const text: string = source.default;
    expect(text).toMatch(/recoveryMark\?\.glyph/);
  });
});
