/**
 * Behavior under test (01-07-PLAN.md Task 3, component bullet): `⌘↓` on the selected row issues
 * exactly one reorder command, and the selection stays on the same item id — selection tracks
 * identity, never the row's index (01-UI-SPEC.md Keyboard Map: "selection tracks the selected
 * item's id, never its list index").
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { showStatusBands } from "./lens";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

// These cases are about the status bands; the rack opens on the epic roster (A-01).
beforeEach(() => {
  showStatusBands();
});

const EMPTY_COUNTS: BandCounts = {
  backlog: 0,
  todo: 0,
  inProgress: 0,
  inReview: 0,
  done: 0,
};

const ITEMS: BoardItem[] = [
  { id: "1", key: "FLY-1", title: "First task", status: "backlog", rank: "10", priority: 0, epicId: null },
  { id: "2", key: "FLY-2", title: "Second task", status: "backlog", rank: "20", priority: 0, epicId: null },
  { id: "3", key: "FLY-3", title: "Third task", status: "backlog", rank: "30", priority: 0, epicId: null },
];

function renderBoard() {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });

  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId="proj-1"
        items={ITEMS}
        counts={{ ...EMPTY_COUNTS, backlog: ITEMS.length }}
        onCreateTask={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("BoardView reorder (⌘↑ / ⌘↓)", () => {
  it("⌘↓ issues exactly one reorder call and keeps the selection on the same item id", async () => {
    renderBoard();

    const list = screen.getByRole("list", { name: "Board" });
    // Home selects the first selectable row (item "1"); one `j` moves to the second (item "2").
    fireEvent.keyDown(list, { key: "Home" });
    fireEvent.keyDown(list, { key: "j" });

    const secondRow = await screen.findByText("Second task");
    expect(secondRow.closest('[role="listitem"]')).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(list, { key: "ArrowDown", metaKey: true });

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("task_reorder", { taskId: "2", direction: "down" }),
    );
    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "task_reorder"),
    ).toHaveLength(1);

    // Selection tracks the item id, not the row index — the moved item's own row is still the
    // one marked selected.
    const secondRowAfter = await screen.findByText("Second task");
    expect(secondRowAfter.closest('[role="listitem"]')).toHaveAttribute("aria-selected", "true");
  });

  it("without a selection, ⌘↓ issues no reorder call", async () => {
    renderBoard();

    const list = screen.getByRole("list", { name: "Board" });
    await screen.findByText("First task");

    fireEvent.keyDown(list, { key: "ArrowDown", metaKey: true });

    // Give any accidental async mutation a turn to fire before asserting its absence.
    await Promise.resolve();
    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "task_reorder"),
    ).toHaveLength(0);
  });
});
