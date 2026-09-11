/**
 * Behavior under test (01-08-PLAN.md Task 3 — the component bullet, BOARD-06):
 * - With an empty result, the filter-empty-result state renders, and its copy is not the
 *   empty-project copy (01-UI-SPEC.md "State Inventory"/"Copywriting Contract").
 * - `FilterBar` toggles a status chip through `state/uiStore.ts` and shows "Clear Filters" only
 *   once a filter or the search term is active.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView, type EmptyStateContent } from "../BoardView";
import { FilterBar } from "../FilterBar";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { BandCounts } from "../useBoardQuery";

// Plan 02-06 Task 3 gave `BoardView` its own `subscribeBoardChanged` subscriber
// (`useBlockedSummary`) — this file previously rendered `BoardView` with no `adapters/tauri` mock
// at all, which produces a genuine unhandled rejection now that `BoardView` calls
// `subscribeBoardChanged` directly (see `workflow.test.tsx`'s identical fix for the full
// explanation). This file's own assertions are unaffected either way.
vi.mock("../../adapters/tauri", () => ({
  invokeCommand: () => Promise.resolve(undefined),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  blockedSummary: () => Promise.resolve({ blockedTaskIds: [], blockedCount: 0 }),
}));

const EMPTY_COUNTS: BandCounts = {
  backlog: 0,
  todo: 0,
  inProgress: 0,
  inReview: 0,
  done: 0,
};

function renderWithQueryClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  resetUiState();
});

describe("empty-window state copy", () => {
  const emptyProjectState: EmptyStateContent = {
    heading: "This board is empty",
    body: "Start typing below to create your first task or epic. Press Enter to save it.",
  };
  const emptyFilterResultState: EmptyStateContent = {
    heading: "No items match these filters",
    body: "Try removing a filter or clearing the search.",
    ctaLabel: "Clear Filters",
    onCta: () => {},
  };

  it("renders the empty-filter-result copy, distinct from the empty-project copy", () => {
    renderWithQueryClient(
      <BoardView
        projectId="proj-1"
        items={[]}
        counts={EMPTY_COUNTS}
        onCreateTask={() => {}}
        emptyState={emptyFilterResultState}
      />,
    );

    expect(screen.getByText("No items match these filters")).toBeInTheDocument();
    expect(screen.getByText("Try removing a filter or clearing the search.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clear Filters" })).toBeInTheDocument();
    expect(screen.queryByText("This board is empty")).not.toBeInTheDocument();
  });

  it("renders the empty-project copy when supplied, distinct from the empty-filter-result copy", () => {
    renderWithQueryClient(
      <BoardView
        projectId="proj-1"
        items={[]}
        counts={EMPTY_COUNTS}
        onCreateTask={() => {}}
        emptyState={emptyProjectState}
      />,
    );

    expect(screen.getByText("This board is empty")).toBeInTheDocument();
    expect(
      screen.getByText("Start typing below to create your first task or epic. Press Enter to save it."),
    ).toBeInTheDocument();
    expect(screen.queryByText("No items match these filters")).not.toBeInTheDocument();
    // The empty-project state offers no "Clear Filters" CTA — there is nothing to clear.
    expect(screen.queryByRole("button", { name: "Clear Filters" })).not.toBeInTheDocument();
  });

  it("renders neither empty-state copy when no `emptyState` prop is supplied (pre-01-08 behavior)", () => {
    renderWithQueryClient(
      <BoardView projectId="proj-1" items={[]} counts={EMPTY_COUNTS} onCreateTask={() => {}} />,
    );

    expect(screen.queryByText("This board is empty")).not.toBeInTheDocument();
    expect(screen.queryByText("No items match these filters")).not.toBeInTheDocument();
  });
});

describe("FilterBar", () => {
  it("toggles a status chip through the uiStore", () => {
    renderWithQueryClient(<FilterBar />);

    expect(useUiStore.getState().filterDraft.statuses).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(useUiStore.getState().filterDraft.statuses).toEqual(["backlog"]);

    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    expect(useUiStore.getState().filterDraft.statuses).toEqual([]);
  });

  it("shows Clear Filters only once a filter or the search term is active", () => {
    renderWithQueryClient(<FilterBar />);

    expect(screen.queryByRole("button", { name: /Clear Filters/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Search items"), { target: { value: "crash" } });
    expect(screen.getByRole("button", { name: /Clear Filters/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Clear Filters/ }));
    expect(useUiStore.getState().searchTerm).toBe("");
    expect(screen.queryByRole("button", { name: /Clear Filters/ })).not.toBeInTheDocument();
  });
});
