/**
 * Behavior under test (07-08-PLAN.md Task 2, D-124): a task whose most recent CI-bearing forge
 * observation recorded a failure renders a CI-failure pill on its board row — distinguishable from
 * the existing Blocked/Needs Decision pills by glyph and printed word, structurally exempt from
 * the row's progressive-disclosure truncation ladder — and the pill reaches no status-column
 * write of any kind (D-122's forward-only rule stays the status column's only owner).
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { BoardRow } from "../BoardRow";
import type { BoardItem } from "../useBoardQuery";

function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id: "task-1",
    key: "FLY-1",
    title: "A task with a red build",
    status: "in_progress",
    rank: "10",
    priority: 0,
    epicId: null,
    kind: "task",
    ...overrides,
  };
}

describe("BoardRow CI-failure pill (D-124)", () => {
  it("renders no pill for a task with no CI-failure flag — byte-identical to pre-task output", () => {
    render(<BoardRow item={makeItem()} />);
    expect(screen.queryByText("CI failed")).not.toBeInTheDocument();
  });

  it("renders the CircleX glyph and the exact words 'CI failed' together", () => {
    render(<BoardRow item={makeItem()} ciFailed />);
    const pill = screen.getByRole("button", { name: /CI failed/ });
    expect(pill).toBeInTheDocument();
    expect(pill.querySelector("svg")).toBeInTheDocument();
    expect(pill).toHaveTextContent("CI failed");
  });

  it("trails the Blocked and Needs Decision pills in document order when all three are present", () => {
    render(<BoardRow item={makeItem()} blocked needsDecision ciFailed />);
    const blockedPill = screen.getByRole("button", { name: /^Blocked/ });
    const recoveryPill = screen.getByRole("button", { name: /Needs Decision/ });
    const ciPill = screen.getByRole("button", { name: /CI failed/ });

    // eslint-disable-next-line no-bitwise
    expect(blockedPill.compareDocumentPosition(recoveryPill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise
    expect(recoveryPill.compareDocumentPosition(ciPill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("appends 'CI failed' to the row's accessible name when the pill is present", () => {
    render(<BoardRow item={makeItem()} ciFailed />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveAccessibleName(/CI failed/);
  });

  it("is structurally exempt from the truncation ladder — carries no field-* class", () => {
    render(<BoardRow item={makeItem()} ciFailed />);
    const pill = screen.getByRole("button", { name: /CI failed/ });
    expect(pill.className.split(/\s+/).some((c) => c.startsWith("field-"))).toBe(false);
  });

  it("activating the pill calls onOpenCiFailed with no propagation to onSelect", () => {
    const onOpenCiFailed = vi.fn();
    const onSelect = vi.fn();
    render(<BoardRow item={makeItem()} ciFailed onOpenCiFailed={onOpenCiFailed} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /CI failed/ }));

    expect(onOpenCiFailed).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("never changes the row's status display — no status-column write in this file", async () => {
    const source = await import("../BoardRow.tsx?raw");
    const text: string = source.default;
    expect(text).not.toMatch(/setStatus|task_set_status/);
  });

  it("keeps the status glyph read-only beside the pill (DRFT-04, D-19): no button, no picker callback", () => {
    render(<BoardRow item={makeItem()} ciFailed />);
    expect(screen.getByRole("listitem")).toHaveAccessibleName(/, In Progress,/);
    expect(screen.queryByRole("button", { name: /^Status:/ })).not.toBeInTheDocument();
  });

  it("resolves the pill's glyph and word from the marks registry, naming no icon component directly", async () => {
    const source = await import("../BoardRow.tsx?raw");
    const text: string = source.default;
    expect(text).toMatch(/ciFailedMark\?\.glyph/);
  });
});
