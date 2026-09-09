/**
 * Behavior under test (01-09-PLAN.md Task 3): the single binding table's ambiguity guard, the
 * board-list navigation keys, the Escape ladder, and selection tracking an item id across a
 * pushed delta — both the reorder half (nothing to prove structurally beyond "the id is
 * unchanged") and the "selected item leaves the window" half (falls to the nearest surviving id
 * in the previous order, never resets to the top).
 *
 * Follows `reorder.test.tsx`'s (01-07) Testing Library setup: `invokeCommand` is mocked so no
 * real Tauri bridge is required, and every assertion reads through rendered DOM state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { CommandPalette } from "../CommandPalette";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const ITEMS: BoardItem[] = [
  { id: "1", key: "FLY-1", title: "First task", status: "backlog", rank: "10", priority: 0, epicId: null },
  { id: "2", key: "FLY-2", title: "Second task", status: "backlog", rank: "20", priority: 0, epicId: null },
  { id: "3", key: "FLY-3", title: "Third task", status: "backlog", rank: "30", priority: 0, epicId: null },
];

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

function renderBoard(items: BoardItem[], counts: BandCounts = { ...EMPTY_COUNTS, backlog: items.length }) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView projectId="proj-1" items={items} counts={counts} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
}

function renderBoardWithPalette(items: BoardItem[]) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId="proj-1"
        items={items}
        counts={{ ...EMPTY_COUNTS, backlog: items.length }}
        onCreateTask={() => {}}
      />
      <CommandPalette />
    </QueryClientProvider>,
  );
}

describe("keyboard-nav", () => {
  it("letters_do_not_fire_while_typing", async () => {
    renderBoard(ITEMS);
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "Home" });
    expect(useUiStore.getState().selectedItemId).toBe("1");
    fireEvent.keyDown(list, { key: "c" }); // opens quick-add

    // Simulate the bubbled event from quick-add's own title input (mounted inside the same
    // board-list container) — a bare "s" while a text field is the real event target must not
    // open the status picker.
    const quickAddInput = await screen.findByPlaceholderText("Type a title, press Enter to create…");
    fireEvent.keyDown(quickAddInput, { key: "s" });

    expect(screen.queryByRole("menu", { name: "Set status" })).not.toBeInTheDocument();
  });

  it("navigation_is_a_no_op_on_an_empty_board", () => {
    renderBoard([]);
    const list = screen.getByRole("list", { name: "Board" });

    expect(() => {
      fireEvent.keyDown(list, { key: "j" });
      fireEvent.keyDown(list, { key: "k" });
      fireEvent.keyDown(list, { key: "Home" });
      fireEvent.keyDown(list, { key: "End" });
    }).not.toThrow();

    expect(useUiStore.getState().selectedItemId).toBeNull();
    expect(list).toBeInTheDocument();
  });

  it("rows_announce_their_true_position", () => {
    renderBoard(ITEMS, { ...EMPTY_COUNTS, backlog: 40 });

    const row = screen.getByText("Second task").closest('[role="listitem"]');
    expect(row).toHaveAttribute("aria-setsize", "40");
    expect(row).toHaveAttribute("aria-posinset", "2");
  });

  it("selection_follows_the_item_across_a_reorder", async () => {
    const { rerender } = renderBoard(ITEMS);
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "j" });
    expect(useUiStore.getState().selectedItemId).toBe("2");

    const queryClient = new QueryClient();
    const reordered = [ITEMS[2], ITEMS[0], ITEMS[1]];
    rerender(
      <QueryClientProvider client={queryClient}>
        <BoardView
          projectId="proj-1"
          items={reordered}
          counts={{ ...EMPTY_COUNTS, backlog: reordered.length }}
          onCreateTask={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(useUiStore.getState().selectedItemId).toBe("2");
    const row = await screen.findByText("Second task");
    expect(row.closest('[role="listitem"]')).toHaveAttribute("aria-selected", "true");
  });

  it("selection_falls_to_the_nearest_survivor_when_filtered_out", async () => {
    const { rerender } = renderBoard(ITEMS);
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "j" });
    expect(useUiStore.getState().selectedItemId).toBe("2");

    const queryClient = new QueryClient();
    const filtered = [ITEMS[0], ITEMS[2]]; // item "2" removed from the window
    rerender(
      <QueryClientProvider client={queryClient}>
        <BoardView
          projectId="proj-1"
          items={filtered}
          counts={{ ...EMPTY_COUNTS, backlog: filtered.length }}
          onCreateTask={() => {}}
        />
      </QueryClientProvider>,
    );

    // Falls to the nearest survivor in the previous order ("3", item 2's next-door neighbour) —
    // not "1" (the first row), which is what an implementation that merely resets on loss would
    // produce.
    expect(useUiStore.getState().selectedItemId).toBe("3");
    const row = await screen.findByText("Third task");
    expect(row.closest('[role="listitem"]')).toHaveAttribute("aria-selected", "true");
  });

  it("escape_closes_one_layer_per_press", async () => {
    renderBoardWithPalette(ITEMS);
    const list = screen.getByRole("list", { name: "Board" });

    fireEvent.keyDown(list, { key: "Home" }); // select item "1"
    fireEvent.keyDown(list, { key: "c" }); // open quick-add
    fireEvent.keyDown(list, { key: "Enter" }); // open the detail panel
    fireEvent.keyDown(window, { key: "k", metaKey: true }); // open the palette

    expect(useUiStore.getState().paletteOpen).toBe(true);
    expect(useUiStore.getState().detailItemId).toBe("1");
    expect(useUiStore.getState().selectedItemId).toBe("1");
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Type a title, press Enter to create…")).toBeInTheDocument();

    // Press 1: closes the palette.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(useUiStore.getState().detailItemId).toBe("1");

    // Press 2: closes the detail panel.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().detailItemId).toBeNull();
    expect(screen.getByPlaceholderText("Type a title, press Enter to create…")).toBeInTheDocument();

    // Press 3: closes quick-add.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByPlaceholderText("Type a title, press Enter to create…")).not.toBeInTheDocument();
    expect(useUiStore.getState().selectedItemId).toBe("1");

    // Press 4: clears selection.
    fireEvent.keyDown(window, { key: "Escape" });
    expect(useUiStore.getState().selectedItemId).toBeNull();

    // Press 5: nothing left open or selected — a no-op.
    expect(() => fireEvent.keyDown(window, { key: "Escape" })).not.toThrow();
    expect(useUiStore.getState().selectedItemId).toBeNull();
  });
});
