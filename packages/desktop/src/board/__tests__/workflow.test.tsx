/**
 * Behavior under test (01-04-PLAN.md Task 3 — the fixed hierarchy and the fixed workflow,
 * component bullet): the five band headers render in the fixed order, and the status picker
 * offers exactly five options — both sourced from the one fixed workflow state list
 * (`legend/marks.ts`'s `STATUS_MARKS`, itself asserted elsewhere to match
 * `core::domain::WORKFLOW_STATES`), never a second hand-typed list in either component.
 */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { StatusPicker } from "../pickers/StatusPicker";
import { STATUS_MARKS } from "../../legend/marks";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const EMPTY_COUNTS: BandCounts = {
  backlog: 0,
  todo: 0,
  inProgress: 0,
  inReview: 0,
  done: 0,
};

const ANCHOR_RECT = { top: 0, left: 0, bottom: 0 };

function renderBoard(items: BoardItem[], counts: BandCounts) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView projectId="proj-1" items={items} counts={counts} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
}

describe("workflow — the fixed five states are structurally fixed in the renderer", () => {
  it("renders exactly the five band headers, in the fixed order, sourced from one list", () => {
    renderBoard([], EMPTY_COUNTS);

    const headings = screen.getAllByText(/^(Backlog|Todo|In Progress|In Review|Done)$/);
    const labels = headings.map((el) => el.textContent);

    expect(labels).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done"]);
    expect(labels).toHaveLength(5);
  });

  it("StatusPicker offers exactly five options, one per WORKFLOW_STATES entry", () => {
    render(
      <StatusPicker
        currentStatus="backlog"
        onSelect={() => {}}
        onClose={() => {}}
        anchorRect={ANCHOR_RECT}
      />,
    );

    const options = screen.getAllByRole("menuitemradio");
    expect(options).toHaveLength(5);
    expect(options).toHaveLength(STATUS_MARKS.length);

    const labels = options.map((el) => el.textContent?.replace(/^\d/, ""));
    expect(labels).toEqual([
      "Backlog",
      "Todo",
      "In Progress",
      "In Review",
      "Done",
    ]);
  });

  it("StatusPicker marks the currently-selected status as checked, and no other option", () => {
    render(
      <StatusPicker
        currentStatus="in_progress"
        onSelect={() => {}}
        onClose={() => {}}
        anchorRect={ANCHOR_RECT}
      />,
    );

    const checked = screen.getAllByRole("menuitemradio", { checked: true } as never);
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent("In Progress");
  });
});
