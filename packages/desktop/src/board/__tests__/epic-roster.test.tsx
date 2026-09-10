/**
 * Behavior under test (01-17-PLAN.md, UAT gap G-01-2): the epic pill resolves a task's epic
 * label from the project's full epic roster (`useEpics()`/`epic_list_all`), never from the
 * currently-loaded board window (`items`). The regression this file exists to catch: a task
 * whose epic sorts outside the loaded window must still render `KEY Title`, not the epic's raw
 * internal id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { FilterBar } from "../FilterBar";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { useBoardChangedSubscription } from "../useBoardQuery";
import type { BandCounts, BoardItem, IssueItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

// Captures the real handler `useBoardChangedSubscription` passes to `subscribeBoardChanged` —
// never `Promise.resolve(() => {})`, which would let a "the roster invalidates on board:changed"
// test pass while driving nothing (the same stubbing mistake 01-16-PLAN.md had to undo for the
// menu bridge). Tests invoke `capturedBoardChangedHandler?.()` to simulate the core's push.
let capturedBoardChangedHandler: (() => void) | undefined;

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: (handler: () => void) => {
    capturedBoardChangedHandler = handler;
    return Promise.resolve(() => {
      capturedBoardChangedHandler = undefined;
    });
  },
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const OUTSIDE_EPIC = { id: "epic-out-of-window", key: "FLY-7", title: "Outside the window" };

beforeEach(() => {
  resetUiState();
  capturedBoardChangedHandler = undefined;
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

function renderBoard(
  items: BoardItem[],
  projectId: string | undefined,
  issues: IssueItem[] = [],
) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId={projectId}
        items={items}
        issues={issues}
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

  it("renders the unresolved mark, never the raw id, when the roster cannot resolve an epic", async () => {
    const unresolvedId = "01M24BE37SW6X6EHZJ9J4MVY9X";
    const items: BoardItem[] = [
      {
        id: "task-1",
        key: "FLY-9",
        title: "Child task",
        status: "backlog",
        rank: "10",
        priority: 0,
        epicId: unresolvedId,
        kind: "task",
      },
    ];
    // The roster resolves to something that does NOT contain this task's epic id.
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve([OUTSIDE_EPIC]);
      return Promise.resolve(undefined);
    });

    const { container } = renderBoard(items, "proj-1");

    expect(await screen.findByText("Unknown epic")).toBeInTheDocument();
    expect(screen.queryByText(unresolvedId)).not.toBeInTheDocument();

    // No element may carry the id in ANY attribute (title, aria-label, data-*) either — a
    // tooltip or accessible-name leak must fail this test too, not only a visible-text leak.
    const leaking = Array.from(container.querySelectorAll("*")).filter((el) =>
      Array.from(el.attributes).some((attr) => attr.value.includes(unresolvedId)),
    );
    expect(leaking).toHaveLength(0);
  });

  it("renders the unresolved mark while the roster query is still pending", async () => {
    const items: BoardItem[] = [
      {
        id: "task-1",
        key: "FLY-9",
        title: "Child task",
        status: "backlog",
        rank: "10",
        priority: 0,
        epicId: "epic-still-loading",
        kind: "task",
      },
    ];
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return new Promise(() => {}); // never settles
      return Promise.resolve(undefined);
    });

    renderBoard(items, "proj-1");

    expect(await screen.findByText("Unknown epic")).toBeInTheDocument();
    expect(screen.queryByText("epic-still-loading")).not.toBeInTheDocument();
  });
});

describe("epic roster liveness (board:changed)", () => {
  const TASK_A: BoardItem = {
    id: "task-a",
    key: "FLY-9",
    title: "Task A",
    status: "backlog",
    rank: "10",
    priority: 0,
    epicId: "epic-a",
    kind: "task",
  };
  const TASK_B: BoardItem = {
    id: "task-b",
    key: "FLY-10",
    title: "Task B",
    status: "backlog",
    rank: "20",
    priority: 0,
    epicId: "epic-b",
    kind: "task",
  };

  function triggerBoardChanged() {
    act(() => {
      capturedBoardChangedHandler?.();
    });
  }

  /** Mounts the real `useBoardChangedSubscription` (normally wired once in `App.tsx`) alongside
   * `BoardView` in these tests, so `subscribeBoardChanged` actually gets called and
   * `capturedBoardChangedHandler` is populated — `BoardView` itself does not call this hook. */
  function Subscriber() {
    useBoardChangedSubscription();
    return null;
  }

  it("a board:changed push refreshes the epic roster, not only the board window", async () => {
    // Only epic-a is in the roster at first — epic-b's pill starts unresolved.
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([{ id: "epic-a", key: "FLY-1", title: "Epic A" }]);
      }
      return Promise.resolve(undefined);
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Subscriber />
        <BoardView
          projectId="proj-1"
          items={[TASK_A, TASK_B]}
          counts={{ ...EMPTY_COUNTS, backlog: 2 }}
          onCreateTask={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("FLY-1 Epic A")).toBeInTheDocument();
    expect(screen.getByText("Unknown epic")).toBeInTheDocument();

    const callsBeforePush = invokeCommandMock.mock.calls.filter(([c]) => c === "epic_list_all").length;

    // epic-b now exists in the roster too.
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([
          { id: "epic-a", key: "FLY-1", title: "Epic A" },
          { id: "epic-b", key: "FLY-2", title: "Epic B" },
        ]);
      }
      return Promise.resolve(undefined);
    });

    triggerBoardChanged();

    expect(await screen.findByText("FLY-2 Epic B")).toBeInTheDocument();
    expect(screen.queryByText("Unknown epic")).not.toBeInTheDocument();
    const callsAfterPush = invokeCommandMock.mock.calls.filter(([c]) => c === "epic_list_all").length;
    expect(callsAfterPush).toBeGreaterThan(callsBeforePush);
  });

  it("a renamed epic's pill updates without a manual refetch", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([{ id: "epic-a", key: "FLY-1", title: "Old Title" }]);
      }
      return Promise.resolve(undefined);
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Subscriber />
        <BoardView
          projectId="proj-1"
          items={[TASK_A]}
          counts={{ ...EMPTY_COUNTS, backlog: 1 }}
          onCreateTask={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("FLY-1 Old Title")).toBeInTheDocument();

    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([{ id: "epic-a", key: "FLY-1", title: "New Title" }]);
      }
      return Promise.resolve(undefined);
    });

    triggerBoardChanged();

    expect(await screen.findByText("FLY-1 New Title")).toBeInTheDocument();
    expect(screen.queryByText("FLY-1 Old Title")).not.toBeInTheDocument();
  });

  it("a deleted epic stops resolving", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([{ id: "epic-a", key: "FLY-1", title: "Epic A" }]);
      }
      return Promise.resolve(undefined);
    });

    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Subscriber />
        <BoardView
          projectId="proj-1"
          items={[TASK_A]}
          counts={{ ...EMPTY_COUNTS, backlog: 1 }}
          onCreateTask={() => {}}
        />
      </QueryClientProvider>,
    );

    expect(await screen.findByText("FLY-1 Epic A")).toBeInTheDocument();

    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    triggerBoardChanged();

    expect(await screen.findByText("Unknown epic")).toBeInTheDocument();
    expect(screen.queryByText("FLY-1 Epic A")).not.toBeInTheDocument();
    expect(screen.queryByText("epic-a")).not.toBeInTheDocument();
  });
});

describe("FilterBar epic chips (01-18-PLAN.md Task 1, G-01-2)", () => {
  function renderFilterBar(projectId: string | undefined) {
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <FilterBar projectId={projectId} />
      </QueryClientProvider>,
    );
  }

  // 13 distinct epics — the exact count the UAT board (1,067 items / 13 epics) surfaced only 4
  // of via the old windowed derivation.
  const THIRTEEN_EPICS = Array.from({ length: 13 }, (_, i) => ({
    id: `epic-${i}`,
    key: `FLY-${i + 1}`,
    title: `Epic ${i}`,
  }));

  it("lists every epic in the project, not only those in the loaded window", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve(THIRTEEN_EPICS);
      return Promise.resolve(undefined);
    });

    renderFilterBar("proj-1");

    for (const epic of THIRTEEN_EPICS) {
      expect(await screen.findByText(`${epic.key} ${epic.title}`)).toBeInTheDocument();
    }
  });

  it("renders the chips in the roster's order", async () => {
    // Deliberately not alphabetical/id-sorted — proves the chip row does not re-sort.
    const unordered = [THIRTEEN_EPICS[5], THIRTEEN_EPICS[0], THIRTEEN_EPICS[9]];
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve(unordered);
      return Promise.resolve(undefined);
    });

    renderFilterBar("proj-1");

    await screen.findByText(`${unordered[0].key} ${unordered[0].title}`);
    const epicChips = document.getElementById("filter-epic");
    const labels = Array.from(epicChips?.querySelectorAll("button") ?? []).map((b) => b.textContent);
    expect(labels).toEqual([
      "No epic",
      ...unordered.map((epic) => `${epic.key} ${epic.title}`),
    ]);
  });

  it("still renders the No epic chip first", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve(THIRTEEN_EPICS.slice(0, 2));
      return Promise.resolve(undefined);
    });

    renderFilterBar("proj-1");

    await screen.findByText(`${THIRTEEN_EPICS[0].key} ${THIRTEEN_EPICS[0].title}`);
    const epicChips = document.getElementById("filter-epic");
    const firstButton = epicChips?.querySelector("button");
    expect(firstButton?.textContent).toBe("No epic");

    fireEvent.click(firstButton as HTMLButtonElement);
    expect(useUiStore.getState().filterDraft.epicIds).toEqual([null]);
  });

  it("renders only the No epic chip for a project with no epics", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderFilterBar("proj-1");

    await waitFor(() => {
      expect(invokeCommandMock).toHaveBeenCalledWith("epic_list_all", { projectId: "proj-1" });
    });
    const epicChips = document.getElementById("filter-epic");
    const buttons = Array.from(epicChips?.querySelectorAll("button") ?? []).map((b) => b.textContent);
    expect(buttons).toEqual(["No epic"]);
  });

  it("issues no epic_list_all call without a project id", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve(THIRTEEN_EPICS);
      return Promise.resolve(undefined);
    });

    renderFilterBar(undefined);

    expect(await screen.findByLabelText("Search items")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Backlog" })).toBeInTheDocument();
    expect(invokeCommandMock).not.toHaveBeenCalledWith("epic_list_all", expect.anything());
  });

  it("selecting an epic chip writes only to the filter draft", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve(THIRTEEN_EPICS.slice(0, 1));
      return Promise.resolve(undefined);
    });

    renderFilterBar("proj-1");

    const chip = await screen.findByText(`${THIRTEEN_EPICS[0].key} ${THIRTEEN_EPICS[0].title}`);
    fireEvent.click(chip);

    expect(useUiStore.getState().filterDraft.epicIds).toEqual([THIRTEEN_EPICS[0].id]);
    // FilterBar owns no row rendering at all — selecting a chip must not trigger any
    // client-side re-filtering of a row list inside this component (the plan's prohibition).
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });
});

describe("parent pickers and issues lane resolve epics from the roster (01-18-PLAN.md Task 2, G-01-2)", () => {
  function selectItem(id: string) {
    act(() => {
      useUiStore.getState().setSelectedItemId(id);
    });
  }

  /** Finds an issue row by its accessible name (`IssuesLane.tsx`'s `${key}, ${title}, ${kind}`
   * `aria-label`) and clicks its parent button — mirrors `issue-parent.test.tsx`'s own helper. */
  function openParentPicker(issueKeyPrefix: string) {
    const row = screen.getByRole("listitem", { name: new RegExp(`^${issueKeyPrefix}, `) });
    fireEvent.click(within(row).getByRole("button"));
  }

  const TASK: BoardItem = {
    id: "task-only",
    key: "FLY-9",
    title: "Windowed task",
    status: "backlog",
    rank: "10",
    priority: 0,
    epicId: null,
    kind: "task",
  };

  it("offers an epic that is not in the loaded window as a Set epic option", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([
          { id: "epic-x", key: "FLY-1", title: "Out-of-window Epic X" },
          { id: "epic-y", key: "FLY-2", title: "Out-of-window Epic Y" },
        ]);
      }
      return Promise.resolve(undefined);
    });

    // The window holds only the task row — no epic rows at all.
    renderBoard([TASK], "proj-1");
    selectItem(TASK.id);
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    const menu = await screen.findByRole("menu", { name: "Set epic" });
    expect(await within(menu).findByText("FLY-1 Out-of-window Epic X")).toBeInTheDocument();
    expect(within(menu).getByText("FLY-2 Out-of-window Epic Y")).toBeInTheDocument();
  });

  it("never offers the picked row as its own epic", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([
          // Collides with the picked task's own id — a future fixture edge case, per the plan.
          { id: TASK.id, key: "FLY-9", title: "Windowed task" },
          { id: "epic-real", key: "FLY-3", title: "Real Epic" },
        ]);
      }
      return Promise.resolve(undefined);
    });

    renderBoard([TASK], "proj-1");
    selectItem(TASK.id);
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    const menu = await screen.findByRole("menu", { name: "Set epic" });
    expect(await within(menu).findByText("FLY-3 Real Epic")).toBeInTheDocument();
    expect(within(menu).queryByText("FLY-9 Windowed task")).not.toBeInTheDocument();
  });

  it("renders the No epic empty option when the project has no epics", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderBoard([TASK], "proj-1");
    selectItem(TASK.id);
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    const menu = await screen.findByRole("menu", { name: "Set epic" });
    expect(within(menu).getByText("No epic")).toBeInTheDocument();
    const optionLabels = Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map(
      (el) => el.textContent,
    );
    expect(optionLabels).toEqual(["No epic"]);
  });

  it("offers an out-of-window epic in the Set parent picker's Epics group", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([{ id: "epic-out", key: "FLY-7", title: "Out-of-window Epic" }]);
      }
      return Promise.resolve(undefined);
    });

    const issue: IssueItem = {
      id: "issue-1",
      key: "FLY-8",
      title: "An unparented issue",
      kind: "idea",
      epicId: null,
      taskId: null,
    };

    // items holds only the task — no epic rows — proving the Epics group is roster-sourced.
    renderBoard([TASK], "proj-1", [issue]);
    openParentPicker("FLY-8");

    const menu = await screen.findByRole("menu", { name: "Set parent" });
    expect(await within(menu).findByText("FLY-7 Out-of-window Epic")).toBeInTheDocument();
    expect(within(menu).getByText("Epics")).toBeInTheDocument();
    expect(within(menu).getByText("Tasks")).toBeInTheDocument();
    expect(within(menu).getByText("FLY-9 Windowed task")).toBeInTheDocument();
  });

  it("resolves an issue's out-of-window parent epic on its lane button", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve([{ id: "epic-out", key: "FLY-7", title: "Out-of-window Epic" }]);
      }
      return Promise.resolve(undefined);
    });

    const issue: IssueItem = {
      id: "issue-1",
      key: "FLY-8",
      title: "An issue under an out-of-window epic",
      kind: "idea",
      epicId: "epic-out",
      taskId: null,
    };

    renderBoard([TASK], "proj-1", [issue]);

    const row = await screen.findByRole("listitem", { name: /^FLY-8, / });
    // The parent button's label resolves from the roster-backed `parentsById` (G-01-2), which
    // settles asynchronously — `findByRole` waits for it rather than asserting on the pre-fetch
    // render (which reads "No parent" until the roster resolves).
    expect(await within(row).findByRole("button", { name: /FLY-7/ })).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /No parent/ })).not.toBeInTheDocument();
  });
});
