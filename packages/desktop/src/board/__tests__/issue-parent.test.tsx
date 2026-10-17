/**
 * Behavior under test (01-15-PLAN.md Task 3, G-01-EPIC-ASSIGN): the issue half of the fixed
 * three-level hierarchy — an issue can be filed under an epic or a task and shows where it sits —
 * and the creation-time nesting path: a new task can be nested under an epic via quick-add's Tab
 * affordance, and a new issue created from the palette is filed under whatever is currently
 * selected. Together with `epic-assign.test.tsx` (plan 01-14, the task-under-epic half), this
 * file is what the restored BOARD-01 tick in `planning-archive:.planning/REQUIREMENTS.md` rests on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { showStatusBands } from "./lens";
import { CommandPalette } from "../CommandPalette";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { BandCounts, BoardItem, IssueItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const EPIC_1: BoardItem = {
  id: "epic-1",
  key: "FLY-1",
  title: "First Epic",
  status: "backlog",
  rank: "10",
  priority: 0,
  epicId: null,
  kind: "epic",
};
const TASK_1: BoardItem = {
  id: "task-1",
  key: "FLY-2",
  title: "First Task",
  status: "backlog",
  rank: "20",
  priority: 0,
  epicId: null,
  kind: "task",
};

const ISSUE_NO_PARENT: IssueItem = {
  id: "issue-1",
  key: "FLY-3",
  title: "An unparented issue",
  kind: "idea",
  epicId: null,
  taskId: null,
};
const ISSUE_WITH_PARENT: IssueItem = {
  id: "issue-2",
  key: "FLY-4",
  title: "An issue parented to a task",
  kind: "bug",
  epicId: null,
  taskId: "task-1",
};

const ITEMS: BoardItem[] = [EPIC_1, TASK_1];
const ISSUES: IssueItem[] = [ISSUE_NO_PARENT, ISSUE_WITH_PARENT];

const PROJECT = {
  id: "proj-1",
  keyPrefix: "FLY",
  name: "Test Project",
  repoPath: "/tmp/test-project",
  defaultBranch: "main",
  status: "active",
};

beforeEach(() => {
  resetUiState();
  showStatusBands();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    // One registered project — `CommandPalette`'s own `useBoardQuery` (used to derive
    // `selectedItem` for the "Create Issue" command) is only `enabled` once it has a project id.
    if (command === "project_list") return Promise.resolve([PROJECT]);
    if (command === "board_list") {
      return Promise.resolve({
        items: ITEMS,
        issues: ISSUES,
        counts: { ...EMPTY_COUNTS, backlog: ITEMS.length },
      });
    }
    // The Epics group of the Set parent picker (and BoardRow's own pill) now resolve from the
    // roster (G-01-2, 01-18-PLAN.md), never from `items` — this suite's assertions need the same
    // epic `board_list` already returns to also be resolvable through `epic_list_all`.
    if (command === "epic_list_all") {
      return Promise.resolve({
        epics: [{ id: EPIC_1.id, key: EPIC_1.key, title: EPIC_1.title }],
        total: 1,
        truncated: false,
      });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

function renderBoard(onCreateTask: (title: string, epicId: string | null) => void = () => {}) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId="proj-1"
        items={ITEMS}
        issues={ISSUES}
        counts={{ ...EMPTY_COUNTS, backlog: ITEMS.length }}
        onCreateTask={onCreateTask}
      />
    </QueryClientProvider>,
  );
}

function renderBoardWithPalette() {
  const queryClient = new QueryClient();
  render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId="proj-1"
        items={ITEMS}
        issues={ISSUES}
        counts={{ ...EMPTY_COUNTS, backlog: ITEMS.length }}
        onCreateTask={() => {}}
      />
      <CommandPalette />
    </QueryClientProvider>,
  );
  return { queryClient };
}

function selectItem(id: string) {
  act(() => {
    useUiStore.getState().setSelectedItemId(id);
  });
}

/** Finds an issue row by its accessible name (`IssuesLane.tsx`'s `${key}, ${title}, ${kind}`
 * `aria-label`) and clicks its parent button — the button is the row's only `role="button"`. */
function openParentPicker(issueKeyPrefix: string) {
  const row = screen.getByRole("listitem", { name: new RegExp(`^${issueKeyPrefix}, `) });
  fireEvent.click(within(row).getByRole("button"));
}

describe("issue-parent", () => {
  it("an_issue_row_renders_no_parent_or_the_parents_key", () => {
    renderBoard();

    const unparentedRow = screen.getByRole("listitem", { name: /^FLY-3, / });
    expect(within(unparentedRow).getByRole("button", { name: /No parent/ })).toBeInTheDocument();

    const parentedRow = screen.getByRole("listitem", { name: /^FLY-4, / });
    expect(within(parentedRow).getByRole("button", { name: /FLY-2/ })).toBeInTheDocument();
  });

  it("activating_the_parent_button_opens_a_set_parent_menu_with_no_parent_epics_and_tasks_groups", async () => {
    renderBoard();
    openParentPicker("FLY-3");

    const menu = await screen.findByRole("menu", { name: "Set parent" });
    expect(within(menu).getByText("No parent")).toBeInTheDocument();
    // The Epics group now resolves from the `useEpics()` roster query (G-01-2), which settles
    // asynchronously — `findByText` waits for it rather than asserting on the pre-fetch render.
    expect(await within(menu).findByText("FLY-1 First Epic")).toBeInTheDocument();
    expect(within(menu).getByText("Epics")).toBeInTheDocument();
    expect(within(menu).getByText("Tasks")).toBeInTheDocument();
    expect(within(menu).getByText("FLY-2 First Task")).toBeInTheDocument();
  });

  it("choosing_a_task_calls_issue_set_parent_with_the_issue_and_task_ids", async () => {
    renderBoard();
    openParentPicker("FLY-3");

    const menu = await screen.findByRole("menu", { name: "Set parent" });
    fireEvent.click(within(menu).getByText("FLY-2 First Task"));

    await waitFor(() => {
      const call = invokeCommandMock.mock.calls.find(([command]) => command === "issue_set_parent");
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ issueId: "issue-1", parentKind: "task", parentId: "task-1" });
    });
  });

  it("choosing_an_epic_calls_issue_set_parent_with_a_parent_kind_of_epic", async () => {
    renderBoard();
    openParentPicker("FLY-3");

    const menu = await screen.findByRole("menu", { name: "Set parent" });
    fireEvent.click(await within(menu).findByText("FLY-1 First Epic"));

    await waitFor(() => {
      const call = invokeCommandMock.mock.calls.find(([command]) => command === "issue_set_parent");
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ issueId: "issue-1", parentKind: "epic", parentId: "epic-1" });
    });
  });

  it("choosing_no_parent_calls_issue_set_parent_with_a_null_kind_and_id", async () => {
    renderBoard();
    // FLY-4 already carries a parent — exercises the detach path, not just the never-had-one one.
    openParentPicker("FLY-4");

    const menu = await screen.findByRole("menu", { name: "Set parent" });
    fireEvent.click(within(menu).getByText("No parent"));

    await waitFor(() => {
      const call = invokeCommandMock.mock.calls.find(([command]) => command === "issue_set_parent");
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ issueId: "issue-2", parentKind: null, parentId: null });
    });
  });

  /** The exact `useBoardQuery` cache key the palette's own board query resolves under once open
   * (`projectId="proj-1"`, no filter, no search — see `useBoardQuery.ts`'s `boardQueryKey` and
   * `toFilterInput`). `selectedItem` (and therefore `epicId`/`taskId` below) is derived from that
   * query's `items` — clicking "Create Issue" before it resolves races a stale, empty `items`
   * closure, which is what made this assertion flaky before this direct cache check replaced a
   * DOM-inferred readiness proxy. */
  const BOARD_QUERY_KEY = ["board", "proj-1", null, ""];

  async function findCreateIssueOption(
    queryClient: QueryClient,
    dialog: HTMLElement,
  ): Promise<HTMLElement> {
    await waitFor(() => {
      expect(queryClient.getQueryData(BOARD_QUERY_KEY)).toBeDefined();
    });
    return waitFor(() => {
      const option = Array.from(dialog.querySelectorAll('[role="option"]')).find((el) =>
        el.textContent?.startsWith("Create Issue"),
      );
      expect(option).toBeDefined();
      expect(option?.getAttribute("aria-disabled")).toBe("false");
      return option as HTMLElement;
    });
  }

  it("running_create_issue_from_the_palette_with_a_task_selected_passes_taskId", async () => {
    const { queryClient } = renderBoardWithPalette();
    selectItem("task-1");
    act(() => useUiStore.getState().setPaletteOpen(true));

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.click(await findCreateIssueOption(queryClient, dialog));

    await waitFor(() => {
      const call = invokeCommandMock.mock.calls.find(([command]) => command === "issue_create");
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ taskId: "task-1", epicId: undefined });
    });
  });

  it("running_create_issue_from_the_palette_with_an_epic_selected_passes_epicId", async () => {
    const { queryClient } = renderBoardWithPalette();
    selectItem("epic-1");
    act(() => useUiStore.getState().setPaletteOpen(true));

    const dialog = await screen.findByRole("dialog", { name: "Command palette" });
    fireEvent.click(await findCreateIssueOption(queryClient, dialog));

    await waitFor(() => {
      const call = invokeCommandMock.mock.calls.find(([command]) => command === "issue_create");
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ epicId: "epic-1", taskId: undefined });
    });
  });

  it("with_an_epic_selected_tab_in_quick_add_shows_the_epic_and_enter_carries_its_id", () => {
    const onCreateTask = vi.fn();
    renderBoard(onCreateTask);
    selectItem("epic-1");

    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "c" });

    const input = screen.getByLabelText("Quick add a task");
    const row = input.closest(".quick-add") as HTMLElement;

    fireEvent.keyDown(input, { key: "Tab" });
    expect(within(row).getByText("FLY-1")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Nested task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateTask).toHaveBeenCalledWith("Nested task", "epic-1");
  });

  it("shift_tab_clears_the_nesting_before_enter", () => {
    const onCreateTask = vi.fn();
    renderBoard(onCreateTask);
    selectItem("epic-1");

    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "c" });

    const input = screen.getByLabelText("Quick add a task");
    const row = input.closest(".quick-add") as HTMLElement;

    fireEvent.keyDown(input, { key: "Tab" });
    expect(within(row).getByText("FLY-1")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(within(row).queryByText("FLY-1")).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Un-nested task" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCreateTask).toHaveBeenCalledWith("Un-nested task", null);
  });

  it("with_quick_add_open_for_an_epic_tab_changes_nothing", () => {
    renderBoard();
    act(() => useUiStore.getState().openQuickAdd("epic"));

    const input = screen.getByLabelText("Quick add an epic");
    const row = input.closest(".quick-add") as HTMLElement;

    fireEvent.keyDown(input, { key: "Tab" });

    expect(within(row).queryByText("FLY-1")).not.toBeInTheDocument();
    expect(within(row).queryByText("FLY-2")).not.toBeInTheDocument();
  });
});
