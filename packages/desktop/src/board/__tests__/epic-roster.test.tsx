/**
 * Behavior under test (01-17-PLAN.md, UAT gap G-01-2): the epic pill resolves a task's epic
 * label from the project's full epic roster (`useEpics()`/`epic_list_all`), never from the
 * currently-loaded board window (`items`). The regression this file exists to catch: a task
 * whose epic sorts outside the loaded window must still render `KEY Title`, not the epic's raw
 * internal id.
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

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const OUTSIDE_EPIC = { id: "epic-out-of-window", key: "FLY-7", title: "Outside the window" };

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve([OUTSIDE_EPIC]);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

function renderBoard(items: BoardItem[], projectId: string | undefined) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId={projectId}
        items={items}
        counts={{ ...EMPTY_COUNTS, backlog: items.length }}
        onCreateTask={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("epic roster", () => {
  it("resolves a task's epic label from the roster even when items holds no epic rows at all (the regression)", async () => {
    const items: BoardItem[] = [
      {
        id: "task-1",
        key: "FLY-9",
        title: "Child task",
        status: "backlog",
        rank: "10",
        priority: 0,
        epicId: "epic-out-of-window",
        kind: "task",
      },
    ];

    renderBoard(items, "proj-1");

    expect(await screen.findByText("FLY-7 Outside the window")).toBeInTheDocument();
    expect(screen.queryByText("epic-out-of-window")).not.toBeInTheDocument();
  });

  it("still renders No epic for a task with a null epic id", async () => {
    const items: BoardItem[] = [
      {
        id: "task-1",
        key: "FLY-9",
        title: "Orphan task",
        status: "backlog",
        rank: "10",
        priority: 0,
        epicId: null,
        kind: "task",
      },
    ];

    renderBoard(items, "proj-1");

    expect(await screen.findByText("No epic")).toBeInTheDocument();
  });

  it("resolves the pill from the roster, not from a stale epic row in items", async () => {
    const items: BoardItem[] = [
      {
        id: "epic-out-of-window",
        key: "FLY-7",
        title: "Stale windowed title",
        status: "backlog",
        rank: "05",
        priority: 0,
        epicId: null,
        kind: "epic",
      },
      {
        id: "task-1",
        key: "FLY-9",
        title: "Child task",
        status: "backlog",
        rank: "10",
        priority: 0,
        epicId: "epic-out-of-window",
        kind: "task",
      },
    ];

    renderBoard(items, "proj-1");

    expect(await screen.findByText("FLY-7 Outside the window")).toBeInTheDocument();
    expect(screen.queryByText("FLY-7 Stale windowed title")).not.toBeInTheDocument();
  });

  it("invokes epic_list_all with the project id", async () => {
    renderBoard([], "proj-1");

    await screen.findByText("Backlog");
    expect(invokeCommandMock).toHaveBeenCalledWith("epic_list_all", { projectId: "proj-1" });
  });

  it("issues no epic_list_all call and still renders the band headers when projectId is undefined", async () => {
    renderBoard([], undefined);

    await screen.findByText("Backlog");
    expect(invokeCommandMock).not.toHaveBeenCalledWith("epic_list_all", expect.anything());
  });
});
