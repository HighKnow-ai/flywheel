/**
 * Behavior under test (01-17-PLAN.md, UAT gap G-01-2): the epic pill resolves a task's epic
 * label from the project's full epic roster (`useEpics()`/`epic_list_all`), never from the
 * currently-loaded board window (`items`). The regression this file exists to catch: a task
 * whose epic sorts outside the loaded window must still render `KEY Title`, not the epic's raw
 * internal id.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { showStatusBands } from "./lens";
import { FilterBar } from "../FilterBar";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { useCollapseStore } from "../collapseStore";
import {
  bandHeaderTotal,
  epicHeaderTotal,
  epicRosterTruncationNotice,
  useBoardChangedSubscription,
  useEpicProgress,
  useGroupItems,
} from "../useBoardQuery";
import type { EpicProgressDto } from "../../adapters/tauri";
import type { BandCounts, BoardItem, EpicRoster, EpicSummary, IssueItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

/** Wraps a plain array into `epic_list_all`'s real wire shape (`EpicRoster`, plan 05-04) — every
 * mock in this file used to resolve `epic_list_all` to a bare array before the D-87/AR-01-04
 * closure added `total`/`truncated`; this keeps every existing fixture's array literal unchanged
 * while matching the shape `useEpics` actually parses today. `truncated` defaults to `false` since
 * none of this file's fixtures approach `EPIC_ROSTER_CEILING`. */
function epicRoster(epics: EpicSummary[], overrides: Partial<Pick<EpicRoster, "total" | "truncated">> = {}): EpicRoster {
  return { epics, total: overrides.total ?? epics.length, truncated: overrides.truncated ?? false };
}

// Captures EVERY handler registered against `subscribeBoardChanged` — never a single overwritable
// slot, which would let whichever subscriber mounts LAST silently win and every earlier one go
// undriven. Real Tauri `listen()` supports any number of independent listeners for the same event,
// and `BoardView` itself gained its own `subscribeBoardChanged` subscriber (plan 02-06 Task 3's
// `useBlockedSummary`) alongside `<Subscriber>`'s `useBoardChangedSubscription` below — a
// single-slot mock would have this second, equally real subscriber silently clobber the first.
// Tests invoke `triggerBoardChanged()` (below) to simulate the core's push reaching ALL of them,
// never `capturedBoardChangedHandler?.()` against one assumed handler (the stubbing mistake
// 01-16-PLAN.md had to undo for the menu bridge, generalised here to "one of potentially many").
let capturedBoardChangedHandlers: Array<() => void> = [];

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: (handler: () => void) => {
    capturedBoardChangedHandlers.push(handler);
    return Promise.resolve(() => {
      capturedBoardChangedHandlers = capturedBoardChangedHandlers.filter((h) => h !== handler);
    });
  },
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardEpicProgress: (projectId: string) => invokeCommandMock("board_epic_progress", { projectId }),
  boardChangeFlags: (projectId: string) => invokeCommandMock("board_change_flags", { projectId }),
  authoringProposalsPending: (projectId: string) => invokeCommandMock("authoring_proposals_pending", { projectId }),
  authoringRunForEpic: (epicId: string) => invokeCommandMock("authoring_run_for_epic", { epicId }),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const OUTSIDE_EPIC = { id: "epic-out-of-window", key: "FLY-7", title: "Outside the window" };

beforeEach(() => {
  resetUiState();
  showStatusBands();
  capturedBoardChangedHandlers = [];
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve(epicRoster([OUTSIDE_EPIC]));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster([OUTSIDE_EPIC]));
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
      // Every registered subscriber sees the push — matching the real core's `emit`, which
      // notifies every listener `listen()` ever registered, not just the first/last one.
      for (const handler of capturedBoardChangedHandlers) handler();
    });
  }

  /** Mounts the real `useBoardChangedSubscription` (normally wired once in `App.tsx`) alongside
   * `BoardView` in these tests, so `subscribeBoardChanged` actually gets called and
   * `capturedBoardChangedHandlers` is populated — `BoardView` itself has its own separate
   * subscriber too (plan 02-06 Task 3's `useBlockedSummary`), which is exactly why this file
   * tracks every handler rather than just one. */
  function Subscriber() {
    useBoardChangedSubscription();
    return null;
  }

  it("a board:changed push refreshes the epic roster, not only the board window", async () => {
    // Only epic-a is in the roster at first — epic-b's pill starts unresolved.
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve(epicRoster([{ id: "epic-a", key: "FLY-1", title: "Epic A" }]));
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
        return Promise.resolve(epicRoster([
          { id: "epic-a", key: "FLY-1", title: "Epic A" },
          { id: "epic-b", key: "FLY-2", title: "Epic B" },
        ]));
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
        return Promise.resolve(epicRoster([{ id: "epic-a", key: "FLY-1", title: "Old Title" }]));
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
        return Promise.resolve(epicRoster([{ id: "epic-a", key: "FLY-1", title: "New Title" }]));
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
        return Promise.resolve(epicRoster([{ id: "epic-a", key: "FLY-1", title: "Epic A" }]));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster([]));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster(THIRTEEN_EPICS));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster(unordered));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster(THIRTEEN_EPICS.slice(0, 2)));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster([]));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster(THIRTEEN_EPICS));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster(THIRTEEN_EPICS.slice(0, 1)));
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
        return Promise.resolve(epicRoster([
          { id: "epic-x", key: "FLY-1", title: "Out-of-window Epic X" },
          { id: "epic-y", key: "FLY-2", title: "Out-of-window Epic Y" },
        ]));
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
        return Promise.resolve(epicRoster([
          // Collides with the picked task's own id — a future fixture edge case, per the plan.
          { id: TASK.id, key: "FLY-9", title: "Windowed task" },
          { id: "epic-real", key: "FLY-3", title: "Real Epic" },
        ]));
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
      if (command === "epic_list_all") return Promise.resolve(epicRoster([]));
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
        return Promise.resolve(epicRoster([{ id: "epic-out", key: "FLY-7", title: "Out-of-window Epic" }]));
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
        return Promise.resolve(epicRoster([{ id: "epic-out", key: "FLY-7", title: "Out-of-window Epic" }]));
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

describe("epic roster truncation notice (D-16, D-87, plan 05-04 Task 2)", () => {
  const A_FEW_EPICS = [OUTSIDE_EPIC, { id: "epic-2", key: "FLY-8", title: "Second epic" }];

  it("epicRosterTruncationNotice returns null when the roster is not truncated", () => {
    expect(epicRosterTruncationNotice(epicRoster(A_FEW_EPICS))).toBeNull();
  });

  it("epicRosterTruncationNotice returns null for an undefined (still-loading) roster", () => {
    expect(epicRosterTruncationNotice(undefined)).toBeNull();
  });

  it("epicRosterTruncationNotice names the ceiling and the true total when truncated", () => {
    const notice = epicRosterTruncationNotice(epicRoster(A_FEW_EPICS, { total: 5013, truncated: true }));
    expect(notice).not.toBeNull();
    expect(notice).toContain("5000");
    expect(notice).toContain("5013");
  });

  it("BoardView renders the truncation notice when the roster reports truncated: true", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve(epicRoster(A_FEW_EPICS, { total: 5013, truncated: true }));
      }
      return Promise.resolve(undefined);
    });

    renderBoard([], "proj-1");

    expect(await screen.findByText(/Showing the first 5000 of 5013 epics/)).toBeInTheDocument();
  });

  it("BoardView renders no truncation notice when the roster is not truncated", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") return Promise.resolve(epicRoster(A_FEW_EPICS));
      return Promise.resolve(undefined);
    });

    renderBoard([], "proj-1");

    await screen.findByText("Backlog");
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });
});

// --- Phase 8.1 plan 05 (D-05/D-06): the roster's data. The aggregate is one board-wide query, and a
// group's rows come from the EXISTING list command with an explicit limit — the unscoped read is a
// 200-row window over 920 real rows (RESEARCH Correction 3), so a group larger than that is the
// only fixture that can fail.

/** Mirrors `commands/board.rs`'s `DEFAULT_LIMIT` — what a list read lands on when it passes none. */
const CORE_DEFAULT_LIMIT = 200;
/** Mirrors `commands/board.rs`'s `MAX_LIMIT` — the clamp the core applies to a renderer's limit. */
const CORE_MAX_LIMIT = 500;

interface FakeRow extends BoardItem {
  kind: "epic" | "task";
}

function fakeRow(i: number, kind: "epic" | "task", epicId: string | null, status: string): FakeRow {
  return {
    id: `${kind}-${i}`,
    kind,
    key: `FLY-${i}`,
    title: `${kind} ${i}`,
    status,
    rank: String(i).padStart(8, "0"),
    priority: 0,
    epicId,
  };
}

/** The whole fake board: one big epic, a big no-epic bucket, and the epic rows themselves (which —
 * like the real core — carry a null epic id, so the core's no-epic bucket includes them). */
const BIG_EPIC = "epic-big";
const FAKE_BOARD: FakeRow[] = (() => {
  const rows: FakeRow[] = [];
  let i = 0;
  for (let n = 0; n < 230; n += 1) rows.push(fakeRow((i += 1), "task", BIG_EPIC, n < 40 ? "done" : "backlog"));
  for (let n = 0; n < 250; n += 1) rows.push(fakeRow((i += 1), "task", null, "in_review"));
  rows.push(fakeRow((i += 1), "epic", null, "in_progress"));
  rows.push(fakeRow((i += 1), "epic", null, "backlog"));
  return rows;
})();

/** A fake `board_list` that behaves like the core where it matters: applies the epic and status
 * dimensions it is handed and truncates at the limit it is handed (default 200, clamped to 500). */
function installFakeBoardList() {
  invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve(epicRoster([OUTSIDE_EPIC]));
    if (command !== "board_list") return Promise.resolve(undefined);
    const filter = (args?.filter ?? {}) as { epicIds?: (string | null)[]; statuses?: string[] };
    const limit = Math.min(Math.max((args?.limit as number | undefined) ?? CORE_DEFAULT_LIMIT, 1), CORE_MAX_LIMIT);
    const rows = FAKE_BOARD.filter(
      (r) =>
        (!filter.epicIds || filter.epicIds.includes(r.epicId)) &&
        (!filter.statuses || filter.statuses.includes(r.status)),
    );
    return Promise.resolve({ items: rows.slice(0, limit), issues: [], counts: { ...EMPTY_COUNTS } });
  });
}

function hookWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** The args of the first `board_list` call — asserting one happened, so a hook that never fetched
 * fails on that fact rather than on a destructuring error. */
function firstListArgs(): { limit: number; filter?: Record<string, unknown>; projectId?: string } {
  const calls = invokeCommandMock.mock.calls.filter(([command]) => command === "board_list");
  expect(calls.length, "the scoped fetch must call board_list").toBeGreaterThan(0);
  return calls[0][1] as { limit: number; filter?: Record<string, unknown>; projectId?: string };
}

describe("scoped group content (D-05, RESEARCH Correction 3)", () => {
  it("the fixture's groups exceed the default limit, or these tests could not fail", () => {
    expect(FAKE_BOARD.filter((r) => r.epicId === BIG_EPIC).length).toBeGreaterThan(CORE_DEFAULT_LIMIT);
    expect(FAKE_BOARD.filter((r) => r.epicId === null).length).toBeGreaterThan(CORE_DEFAULT_LIMIT);
  });

  it("expanding an epic fetches its rows through the epic dimension with a limit that covers the group", async () => {
    installFakeBoardList();
    const { result } = renderHook(() => useGroupItems("proj-1", { kind: "epic", epicId: BIG_EPIC }, 230), {
      wrapper: hookWrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const args = firstListArgs();
    expect(args).toMatchObject({ projectId: "proj-1", filter: { epicIds: [BIG_EPIC] } });
    expect(args.limit).toBe(230);
    expect(result.current.data?.items).toHaveLength(230);
    expect(result.current.data?.truncated).toBe(false);
  });

  it("expanding the no-epic bucket returns every one of its tasks, not the default window", async () => {
    installFakeBoardList();
    // 250 orphan tasks plus the two epic rows the core's no-epic bucket also yields.
    const { result } = renderHook(() => useGroupItems("proj-1", { kind: "epic", epicId: null }, 252), {
      wrapper: hookWrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const args = firstListArgs();
    expect(args).toMatchObject({ filter: { epicIds: [null] } });
    expect(args.limit).toBeGreaterThan(CORE_DEFAULT_LIMIT);
    const tasks = (result.current.data?.items ?? []).filter((r) => r.kind === "task");
    expect(tasks).toHaveLength(250);
  });

  it("a status band is fetched through the status dimension", async () => {
    installFakeBoardList();
    const { result } = renderHook(() => useGroupItems("proj-1", { kind: "status", status: "in_review" }, 250), {
      wrapper: hookWrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const args = firstListArgs();
    expect(args).toMatchObject({ filter: { statuses: ["in_review"] } });
    expect(result.current.data?.items).toHaveLength(250);
    expect(result.current.data?.items.every((r) => r.status === "in_review")).toBe(true);
  });

  it("a group past the core's clamp reports truncation instead of looking complete", async () => {
    installFakeBoardList();
    const { result } = renderHook(() => useGroupItems("proj-1", { kind: "epic", epicId: BIG_EPIC }, 900), {
      wrapper: hookWrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(firstListArgs().limit).toBe(CORE_MAX_LIMIT);
    expect(result.current.data?.truncated).toBe(true);
  });

  it("header totals come from the aggregate and the counts field, never from rows in memory", () => {
    const progress: EpicProgressDto[] = [
      { epicId: BIG_EPIC, byStatus: [], total: 230, done: 40, agentsRunning: 0, agentsBlocked: 0, criteria: null },
    ];
    // Only 200 of the epic's 230 rows are "loaded" anywhere — the header must still say 230.
    expect(epicHeaderTotal(progress, BIG_EPIC)).toBe(230);
    expect(epicHeaderTotal(progress, "no-such-epic")).toBeUndefined();
    const counts: BandCounts = { backlog: 4, todo: 3, inProgress: 2, inReview: 181, done: 2 };
    expect(bandHeaderTotal(counts, "in_review")).toBe(181);
    expect(bandHeaderTotal(counts, "in_progress")).toBe(2);
    expect(bandHeaderTotal(undefined, "backlog")).toBeUndefined();
  });

  it("does no narrowing of its own: whatever the core returns is what the hook returns", async () => {
    const stray = fakeRow(9999, "task", "some-other-epic", "done");
    invokeCommandMock.mockImplementation((command: string) =>
      Promise.resolve(
        command === "board_list" ? { items: [stray], issues: [], counts: { ...EMPTY_COUNTS } } : undefined,
      ),
    );
    const { result } = renderHook(() => useGroupItems("proj-1", { kind: "epic", epicId: BIG_EPIC }, 1), {
      wrapper: hookWrapper(new QueryClient()),
    });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.items).toEqual([stray]);
  });
});

describe("useEpicProgress (D-05/D-06, D-16)", () => {
  const PROGRESS: EpicProgressDto[] = [
    { epicId: "e1", byStatus: [{ status: "todo", count: 2 }], total: 2, done: 0, agentsRunning: 1, agentsBlocked: 0, criteria: null },
    { epicId: "e2", byStatus: [{ status: "todo", count: 3 }], total: 3, done: 0, agentsRunning: 0, agentsBlocked: 0, criteria: { checked: 0, total: 3 } },
  ];

  it("serves the whole board with one query and re-runs on a board change", async () => {
    invokeCommandMock.mockImplementation((command: string) =>
      Promise.resolve(command === "board_epic_progress" ? PROGRESS : undefined),
    );
    const { result } = renderHook(() => useEpicProgress("proj-1"), { wrapper: hookWrapper(new QueryClient()) });

    await waitFor(() => expect(result.current.data).toEqual(PROGRESS));
    const progressCalls = () => invokeCommandMock.mock.calls.filter(([c]) => c === "board_epic_progress");
    expect(progressCalls()).toHaveLength(1);
    expect(progressCalls()[0][1]).toEqual({ projectId: "proj-1" });

    await act(async () => {
      capturedBoardChangedHandlers.forEach((h) => h());
    });
    await waitFor(() => expect(progressCalls()).toHaveLength(2));
  });

  it("keeps no criteria distinct from zero checked criteria", async () => {
    invokeCommandMock.mockImplementation((command: string) =>
      Promise.resolve(command === "board_epic_progress" ? PROGRESS : undefined),
    );
    const { result } = renderHook(() => useEpicProgress("proj-1"), { wrapper: hookWrapper(new QueryClient()) });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const byId = new Map(result.current.data?.map((p) => [p.epicId, p]));
    expect(byId.get("e1")?.criteria).toBeNull();
    expect(byId.get("e2")?.criteria).toEqual({ checked: 0, total: 3 });
  });

  it("issues no query without a project", () => {
    invokeCommandMock.mockClear();
    renderHook(() => useEpicProgress(undefined), { wrapper: hookWrapper(new QueryClient()) });
    expect(invokeCommandMock.mock.calls.filter(([c]) => c === "board_epic_progress")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------------------------
// The epic header row (08.1-11, D-05/D-06/D-18): the roster is the home surface, and every number
// on an epic row comes from the board-wide aggregate, never from the rows that happen to be loaded.
// ---------------------------------------------------------------------------------------------

const ALPHA = { id: "epic-a", key: "FLY-1", title: "Alpha" };
const BETA = { id: "epic-b", key: "FLY-2", title: "Beta" };

function epicDto(epicId: string | null, over: Partial<EpicProgressDto> = {}): EpicProgressDto {
  return { epicId, byStatus: [], total: 0, done: 0, agentsRunning: 0, agentsBlocked: 0, criteria: null, ...over };
}

function pendingProposals(epicIds: string[]) {
  const proposals = epicIds.map((epicId, i) => ({
    id: `p-${i}`, agentRunId: "run-1", epicId, verb: "create", targetType: "task", targetId: null,
    parentProposalId: null, position: String(i), payload: { kind: "task", title: `Proposed ${i}` },
    status: "pending", createdBy: "agent", createdAt: "2026-10-08T00:00:00Z", rationale: null,
    originLogOffset: null, duplicateOf: null, duplicateScore: null, duplicateCandidate: null,
  }));
  return { proposals, counts: { pending: proposals.length, accepted: 0, rejected: 0, merged: 0, deferred: 0 } };
}

interface RosterFixture {
  epics?: EpicSummary[];
  aggregate: EpicProgressDto[];
  proposals?: string[];
  changeFlags?: { taskId: string; epicId: string | null; ahead: number | null; dirty: boolean }[];
  byEpic?: Record<string, BoardItem[]>;
}

function renderRoster(fx: RosterFixture, windowItems: BoardItem[] = []) {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
  const epics = fx.epics ?? [ALPHA];
  invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve(epicRoster(epics));
    if (command === "board_epic_progress") return Promise.resolve(fx.aggregate);
    if (command === "authoring_proposals_pending") return Promise.resolve(pendingProposals(fx.proposals ?? []));
    if (command === "board_change_flags") return Promise.resolve(fx.changeFlags ?? []);
    if (command === "authoring_run_for_epic") return Promise.resolve(null);
    if (command === "board_list") {
      const filter = (args?.filter ?? {}) as { epicIds?: (string | null)[] };
      return Promise.resolve({
        items: filter.epicIds ? (fx.byEpic?.[String(filter.epicIds[0])] ?? []) : [],
        issues: [],
        counts: EMPTY_COUNTS,
      });
    }
    return Promise.resolve(undefined);
  });
  return renderBoard(windowItems, "proj-1");
}

/** The epic header row for a title, once the roster and the aggregate have both landed. */
async function epicRow(title: string): Promise<HTMLElement> {
  const el = await screen.findByLabelText(new RegExp(`^FLY-\\d+ ${title},`));
  return el as HTMLElement;
}

describe("epic header row (D-05, D-06)", () => {
  it("draws a 12-of-60 epic at 20 percent and prints the figure", async () => {
    renderRoster({ aggregate: [epicDto("epic-a", { total: 60, done: 12 })] });

    const row = await epicRow("Alpha");
    const bar = within(row).getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "20");
    expect(bar).toHaveAccessibleName(/12 of 60 tasks done/);
    expect(within(row).getByText("12 of 60")).toBeInTheDocument();
  });

  it("prints the criteria position as a finer second figure where criteria exist", async () => {
    renderRoster({ aggregate: [epicDto("epic-a", { total: 60, done: 12, criteria: { checked: 1, total: 3 } })] });

    const row = await epicRow("Alpha");
    expect(within(row).getByText("12 of 60")).toBeInTheDocument();
    expect(within(row).getByText("1 of 3 criteria")).toBeInTheDocument();
    expect(within(row).queryByText("no criteria yet")).not.toBeInTheDocument();
  });

  it("says 'no criteria yet' in words for an epic without criteria, and renders no percentage at all", async () => {
    renderRoster({ aggregate: [epicDto("epic-a", { total: 60, done: 0, criteria: null })] });

    const row = await epicRow("Alpha");
    expect(within(row).getByText("no criteria yet")).toBeInTheDocument();
    expect(within(row).queryByText(/criteria$/)).not.toBeInTheDocument();
    expect(row.textContent).not.toContain("%");
  });

  it("prints a true statement, never a figure, while the aggregate has not landed", async () => {
    resetUiState();
    useCollapseStore.setState({ collapsedByProject: {} });
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "epic_list_all") return Promise.resolve(epicRoster([ALPHA]));
      if (command === "board_epic_progress") return new Promise(() => {}); // never lands
      if (command === "actor_list") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    renderBoard([], "proj-1");

    const row = await screen.findByLabelText(/^FLY-1 Alpha/);
    expect(within(row).queryByText("no criteria yet")).not.toBeInTheDocument();
    expect(within(row).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("counts the agents running on the epic, with a name that says what the number counts", async () => {
    renderRoster({ aggregate: [epicDto("epic-a", { total: 5, agentsRunning: 2 })] });

    const row = await epicRow("Alpha");
    const agents = within(row).getByLabelText("2 agents running");
    expect(agents).toHaveTextContent("2");
  });

  it("counts the proposals waiting on the owner in their own slot, named for what they count", async () => {
    renderRoster({ aggregate: [epicDto("epic-a", { total: 5 })], proposals: ["epic-a", "epic-a", "epic-a", "epic-a", "epic-b"] });

    const row = await epicRow("Alpha");
    const proposals = await within(row).findByLabelText("4 proposals waiting");
    expect(proposals).toHaveTextContent("4");
    expect(proposals.closest("[data-slot]")).toHaveAttribute("data-slot", "proposals");
  });

  it("draws one distribution segment per status present, proportional to the aggregate, each labelled", async () => {
    renderRoster({
      aggregate: [
        epicDto("epic-a", {
          total: 46,
          done: 15,
          byStatus: [
            { status: "backlog", count: 14 },
            { status: "todo", count: 15 },
            { status: "in_progress", count: 16 },
            { status: "in_review", count: 0 },
            { status: "done", count: 15 },
          ],
        }),
      ],
    });

    const row = await epicRow("Alpha");
    const strip = within(row).getByRole("group", { name: /task distribution/i });
    const segments = within(strip).getAllByRole("img");
    expect(segments.map((s) => s.getAttribute("aria-label"))).toEqual([
      "15 Done",
      "16 In Progress",
      "15 Todo",
      "14 Backlog",
    ]);
    expect(segments.map((s) => (s as HTMLElement).style.flexGrow)).toEqual(["15", "16", "15", "14"]);
  });

  it("reads every number from the aggregate even when fewer of the epic's task rows are loaded than it has tasks", async () => {
    const loaded: BoardItem[] = [
      { id: "t1", key: "FLY-11", title: "Loaded one", status: "todo", rank: "1", priority: 0, epicId: "epic-a", kind: "task" },
      { id: "t2", key: "FLY-12", title: "Loaded two", status: "todo", rank: "2", priority: 0, epicId: "epic-a", kind: "task" },
    ];
    renderRoster(
      { aggregate: [epicDto("epic-a", { total: 60, done: 12 })], byEpic: { "epic-a": loaded } },
      loaded,
    );

    const row = await epicRow("Alpha");
    fireEvent.click(within(row).getByRole("button", { name: /expand/i }));
    await screen.findByText("Loaded two");

    // The fixture only works if the loaded rows really are fewer than the epic's total.
    const loadedRows = screen.getAllByText(/^Loaded /);
    expect(loadedRows).toHaveLength(2);
    expect(loadedRows.length).toBeLessThan(60);
    expect(within(await epicRow("Alpha")).getByText("12 of 60")).toBeInTheDocument();
  });

  it("is a selection target keyed by the epic's id, reaching detail and continue-shaping from the keyboard", async () => {
    renderRoster({ aggregate: [epicDto("epic-a", { total: 5 })] });

    const row = await epicRow("Alpha");
    fireEvent.click(row);
    expect(useUiStore.getState().selectedItemId).toBe("epic-a");
    expect(row).toHaveAttribute("aria-selected", "true");

    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(useUiStore.getState().detailItemId).toBe("epic-a");
    act(() => useUiStore.getState().setDetailItemId(null));

    fireEvent.keyDown(list, { key: "r" });
    await waitFor(() => expect(useUiStore.getState().launchSheetAuthoringHandoff).toEqual({ epicId: "epic-a" }));
  });

  it("moves selection onto an epic header with j and k", async () => {
    renderRoster({ epics: [ALPHA, BETA], aggregate: [epicDto("epic-a", { total: 1 }), epicDto("epic-b", { total: 1 })] });
    await epicRow("Beta");
    const list = screen.getByRole("list", { name: "Board" });

    fireEvent.keyDown(list, { key: "j" });
    expect(useUiStore.getState().selectedItemId).toBe("epic-a");
    fireEvent.keyDown(list, { key: "j" });
    expect(useUiStore.getState().selectedItemId).toBe("epic-b");
  });
});
