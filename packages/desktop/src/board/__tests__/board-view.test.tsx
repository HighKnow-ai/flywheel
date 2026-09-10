/**
 * Behavior under test (01-03-PLAN.md Task 3): `BoardView` renders the five band headers in the
 * fixed order even when every band is empty, and renders one strip per row of the supplied
 * window (01-UI-SPEC.md "Board list" — the five status groups are fixed, never reorderable,
 * never hideable as a set).
 *
 * The epic-pill case (G-01-2, 01-17-PLAN.md) mocks `../../adapters/tauri` — the pill now resolves
 * an epic's key/title from the `epic_list_all` roster query, never from a `kind: "epic"` row in
 * `items`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { resetUiState } from "../../state/uiStore";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

const EMPTY_COUNTS: BandCounts = {
  backlog: 0,
  todo: 0,
  inProgress: 0,
  inReview: 0,
  done: 0,
};

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") {
      return Promise.resolve([{ id: "epic-1", key: "FLY-1", title: "Parent epic" }]);
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

function renderBoard(items: BoardItem[], counts: BandCounts) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView projectId="proj-1" items={items} counts={counts} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
}

describe("BoardView", () => {
  it("renders the five band headers in the fixed order even when every band is empty", () => {
    renderBoard([], EMPTY_COUNTS);

    const headings = screen.getAllByText(/^(Backlog|Todo|In Progress|In Review|Done)$/);
    const labels = headings.map((el) => el.textContent);
    expect(labels).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done"]);
  });

  it("renders one strip per row of the supplied window", () => {
    const items: BoardItem[] = [
      { id: "1", key: "FLY-1", title: "First task", status: "backlog", rank: "80", priority: 0, epicId: null },
      { id: "2", key: "FLY-2", title: "Second task", status: "todo", rank: "80", priority: 2, epicId: null },
      { id: "3", key: "FLY-3", title: "Third task", status: "done", rank: "80", priority: 4, epicId: "epic-1" },
    ];
    const counts: BandCounts = { ...EMPTY_COUNTS, backlog: 1, todo: 1, done: 1 };

    renderBoard(items, counts);

    for (const item of items) {
      expect(screen.getByText(item.key)).toBeInTheDocument();
      expect(screen.getByText(item.title)).toBeInTheDocument();
    }
    expect(screen.getAllByRole("listitem")).toHaveLength(items.length);
  });

  it("shows the No epic pill for a task whose epic_id is NULL (D-13)", () => {
    const items: BoardItem[] = [
      { id: "1", key: "FLY-1", title: "Orphan task", status: "backlog", rank: "80", priority: 0, epicId: null },
    ];
    renderBoard(items, { ...EMPTY_COUNTS, backlog: 1 });

    expect(screen.getByText("No epic")).toBeInTheDocument();
  });

  it("shows the epic's human-readable key/title in the epic pill, resolved from the roster, not the raw epic_id ULID (G-01-2)", async () => {
    const items: BoardItem[] = [
      {
        id: "2",
        key: "FLY-2",
        title: "Child task",
        status: "backlog",
        rank: "80",
        priority: 0,
        epicId: "epic-1",
      },
    ];
    renderBoard(items, { ...EMPTY_COUNTS, backlog: 1 });

    expect(await screen.findByText("FLY-1 Parent epic")).toBeInTheDocument();
    expect(screen.queryByText("epic-1")).not.toBeInTheDocument();
  });
});
