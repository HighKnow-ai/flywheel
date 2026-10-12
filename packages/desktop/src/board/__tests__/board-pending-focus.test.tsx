/**
 * Behavior under test (Phase 10 plan 10-06 Task 2, FLEET-03, RESEARCH Finding 9): a request to focus a
 * board item that outlives `BoardView`'s project-change clearing effect.
 * - The request survives a project change while the clear still empties selection, detail and delete.
 * - It is consumed exactly once: the item is selected and its detail opens, and a later unrelated project
 *   change does not open it again.
 * - An item that arrives in a later window is still focused; it is not dropped.
 * - An item in a collapsed band is brought into view rather than reported missing.
 * - An item that never resolves clears the request and opens nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { showStatusBands } from "./lens";
import { useCollapseStore } from "../collapseStore";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const ITEMS: BoardItem[] = [
  { id: "1", key: "FLY-1", title: "First task", status: "backlog", rank: "10", priority: 0, epicId: null },
  { id: "2", key: "FLY-2", title: "Second task", status: "backlog", rank: "20", priority: 0, epicId: null },
  { id: "3", key: "FLY-3", title: "Third task", status: "backlog", rank: "30", priority: 0, epicId: null },
];

beforeEach(() => {
  resetUiState();
  showStatusBands();
  useCollapseStore.setState({ collapsedByProject: {} });
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
  vi.useRealTimers();
});

function board(projectId: string, items: BoardItem[], windowSettled: boolean) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <BoardView
        projectId={projectId}
        items={items}
        counts={{ ...EMPTY_COUNTS, backlog: items.length }}
        onCreateTask={() => {}}
        windowSettled={windowSettled}
      />
    </QueryClientProvider>
  );
}

describe("pendingFocusItemId", () => {
  it("survives a project change that clears selection, detail and delete", () => {
    useUiStore.setState({
      selectedItemId: "1",
      detailItemId: "1",
      deleteTarget: { kind: "task", id: "1", key: "FLY-1", title: "First task" },
    });
    const { rerender } = render(board("proj-1", ITEMS, false));
    useUiStore.getState().setPendingFocusItemId("elsewhere");
    // The new project's window has not arrived: the previous project's rows are still on screen.
    rerender(board("proj-2", ITEMS, false));

    const state = useUiStore.getState();
    expect(state.selectedItemId).toBeNull();
    expect(state.detailItemId).toBeNull();
    expect(state.deleteTarget).toBeNull();
    expect(state.pendingFocusItemId).toBe("elsewhere");
  });

  it("is consumed exactly once: focused, then not re-opened by a later project change", async () => {
    const { rerender } = render(board("proj-1", ITEMS, true));
    act(() => useUiStore.getState().setPendingFocusItemId("2"));

    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("2"));
    expect(useUiStore.getState().selectedItemId).toBe("2");
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();

    rerender(board("proj-3", ITEMS, true));
    expect(useUiStore.getState().selectedItemId).toBeNull();
    expect(useUiStore.getState().detailItemId).toBeNull();
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
  });

  it("the store's consume reads and clears in one call", () => {
    useUiStore.getState().setPendingFocusItemId("x");
    expect(useUiStore.getState().consumePendingFocusItemId()).toBe("x");
    expect(useUiStore.getState().consumePendingFocusItemId()).toBeNull();
  });

  it("opens the item for a request raised before the board mounted, after the mount-time clear", async () => {
    useUiStore.getState().setPendingFocusItemId("3");
    render(board("proj-2", ITEMS, true));
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("3"));
    expect(useUiStore.getState().selectedItemId).toBe("3");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("holds the request until an item that arrives in a later window resolves", async () => {
    useUiStore.getState().setPendingFocusItemId("4");
    const { rerender } = render(board("proj-2", ITEMS, false));
    expect(useUiStore.getState().pendingFocusItemId).toBe("4");
    expect(useUiStore.getState().detailItemId).toBeNull();

    const later: BoardItem[] = [
      ...ITEMS,
      { id: "4", key: "FLY-4", title: "Fourth task", status: "backlog", rank: "40", priority: 0, epicId: null },
    ];
    rerender(board("proj-2", later, true));
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("4"));
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
  });

  it("brings an item in a collapsed band into view instead of reporting it missing", async () => {
    useCollapseStore.setState({ collapsedByProject: { "proj-2": { backlog: true } } });
    useUiStore.getState().setPendingFocusItemId("2");
    render(board("proj-2", ITEMS, true));
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("2"));
    expect(useCollapseStore.getState().isCollapsed("proj-2", "backlog")).toBe(false);
  });

  it("clears a request whose item never resolves, once the window has settled, and opens nothing", async () => {
    useUiStore.getState().setPendingFocusItemId("gone");
    render(board("proj-2", ITEMS, true));
    await waitFor(() => expect(useUiStore.getState().pendingFocusItemId).toBeNull());
    expect(useUiStore.getState().selectedItemId).toBeNull();
    expect(useUiStore.getState().detailItemId).toBeNull();
  });

  it("does not give up while the window is still the previous project's", async () => {
    useUiStore.getState().setPendingFocusItemId("gone");
    render(board("proj-2", ITEMS, false));
    await Promise.resolve();
    expect(useUiStore.getState().pendingFocusItemId).toBe("gone");
  });

  it("is bounded: a request that a settled window never satisfies is dropped after the deadline", async () => {
    vi.useFakeTimers();
    // In the window but not in any row: a filter hides it from the band it belongs to.
    useUiStore.getState().setPendingFocusItemId("2");
    useCollapseStore.setState({ collapsedByProject: { "proj-2": { backlog: true } } });
    const frozen = vi.spyOn(useCollapseStore.getState(), "expand").mockImplementation(() => {});
    useCollapseStore.setState({ expand: frozen });
    render(board("proj-2", ITEMS, true));
    expect(useUiStore.getState().pendingFocusItemId).toBe("2");
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
    expect(useUiStore.getState().detailItemId).toBeNull();
    expect(useUiStore.getState().selectedItemId).toBeNull();
  });
});
