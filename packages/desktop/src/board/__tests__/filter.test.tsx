/**
 * Behavior under test (01-08-PLAN.md Task 3 — the component bullet, BOARD-06):
 * - With an empty result, the filter-empty-result state renders, and its copy is not the
 *   empty-project copy (01-UI-SPEC.md "State Inventory"/"Copywriting Contract").
 * - `FilterBar` toggles a status chip through `state/uiStore.ts` and shows "Clear Filters" only
 *   once a filter or the search term is active.
 * - The has-worktree chip (08.1-08, D-17, amendment A-04): on sets the draft and the next board
 *   query carries `hasWorktree: true`; off clears it and the query carries it ABSENT, never
 *   `false`; the accessible name says in words what it narrows to; Clear Filters clears it; and
 *   the bar narrows no rows itself (D-03).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView, type EmptyStateContent } from "../BoardView";
import { FilterBar } from "../FilterBar";
import { EMPTY_FILTER_DRAFT, resetUiState, useUiStore } from "../../state/uiStore";
import { toFilterInput, useBoardQuery, type BandCounts } from "../useBoardQuery";

// Plan 02-06 Task 3 gave `BoardView` its own `subscribeBoardChanged` subscriber
// (`useBlockedSummary`) — this file previously rendered `BoardView` with no `adapters/tauri` mock
// at all, which produces a genuine unhandled rejection now that `BoardView` calls
// `subscribeBoardChanged` directly (see `workflow.test.tsx`'s identical fix for the full
// explanation). This file's own assertions are unaffected either way.
const { invokeCommand } = vi.hoisted(() => ({
  invokeCommand: vi.fn((..._args: unknown[]) => Promise.resolve(undefined)),
}));
vi.mock("../../adapters/tauri", () => ({
  invokeCommand,
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
  invokeCommand.mockClear();
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

describe("has-worktree chip (D-17, amendment A-04)", () => {
  const chipName = /active worktree/i;

  function boardCalls() {
    return invokeCommand.mock.calls.filter(([name]) => name === "board_list" || name === "board_search");
  }

  function queryWrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
  }

  it("turning it on sets the draft field and the next board query carries the dimension", async () => {
    renderWithQueryClient(<FilterBar />);
    fireEvent.click(screen.getByRole("button", { name: chipName }));
    expect(useUiStore.getState().filterDraft.hasWorktree).toBe(true);

    renderHook(() => useBoardQuery("proj-1", useUiStore.getState().filterDraft, ""), {
      wrapper: queryWrapper,
    });
    await waitFor(() =>
      expect(invokeCommand).toHaveBeenCalledWith("board_list", {
        projectId: "proj-1",
        filter: { hasWorktree: true },
      }),
    );
  });

  it("turning it off clears the draft field and the next query carries it unset, not false", async () => {
    renderWithQueryClient(<FilterBar />);
    fireEvent.click(screen.getByRole("button", { name: chipName }));
    fireEvent.click(screen.getByRole("button", { name: chipName }));
    expect(useUiStore.getState().filterDraft.hasWorktree).toBe(false);

    // Off is ABSENT on the wire: no `filter` at all when it is the only dimension, and no
    // `hasWorktree` key when another dimension is active. `false` would mean "only rows without
    // a worktree", which nothing asks for.
    expect(toFilterInput(useUiStore.getState().filterDraft)).toBeUndefined();
    const withStatus = toFilterInput({ ...EMPTY_FILTER_DRAFT, statuses: ["todo"] });
    expect(withStatus).toEqual({ statuses: ["todo"] });
    expect(withStatus && "hasWorktree" in withStatus).toBe(false);

    renderHook(() => useBoardQuery("proj-1", useUiStore.getState().filterDraft, ""), {
      wrapper: queryWrapper,
    });
    await waitFor(() =>
      expect(invokeCommand).toHaveBeenCalledWith("board_list", { projectId: "proj-1", filter: undefined }),
    );
  });

  it("names in words what it narrows to, not a glyph alone", () => {
    renderWithQueryClient(<FilterBar />);
    const chip = screen.getByRole("button", { name: chipName });
    expect(chip).toHaveAttribute("aria-pressed", "false");
    expect(chip.getAttribute("aria-label") ?? chip.textContent).toMatch(/only items with an active worktree/i);
    // WCAG label-in-name: the visible text is contained in the accessible name.
    expect(chip.getAttribute("aria-label")).toContain(chip.textContent ?? "");
    fireEvent.click(chip);
    expect(chip).toHaveAttribute("aria-pressed", "true");
  });

  it("Clear Filters clears it along with the other dimensions", () => {
    renderWithQueryClient(<FilterBar />);
    fireEvent.click(screen.getByRole("button", { name: chipName }));
    fireEvent.click(screen.getByRole("button", { name: "Backlog" }));
    fireEvent.click(screen.getByRole("button", { name: /Clear Filters/ }));
    expect(useUiStore.getState().filterDraft).toEqual(EMPTY_FILTER_DRAFT);
    expect(useUiStore.getState().filterDraft.hasWorktree).toBe(false);
  });

  it("changes the request and nothing else: the bar issues no board query and narrows no rows", () => {
    renderWithQueryClient(<FilterBar />);
    fireEvent.click(screen.getByRole("button", { name: chipName }));
    expect(boardCalls()).toEqual([]);
  });
});
