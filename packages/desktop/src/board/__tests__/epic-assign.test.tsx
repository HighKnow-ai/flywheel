/**
 * Behavior under test (01-14-PLAN.md Task 3, G-01-EPIC-ASSIGN): the fixed three-level hierarchy
 * is reachable from the keyboard (`m`) and from the `⌘K` palette under its printed label ("Set
 * Epic"), and the choice a user makes in `ParentPicker` survives all the way to the
 * `task_set_epic` command argument and back into the row's rendered epic pill. The action is
 * refused on an epic row — an epic has no epic parent in a fixed three-level hierarchy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const EPIC_2: BoardItem = {
  id: "epic-2",
  key: "FLY-2",
  title: "Second Epic",
  status: "backlog",
  rank: "20",
  priority: 0,
  epicId: null,
  kind: "epic",
};
const TASK_1: BoardItem = {
  id: "task-1",
  key: "FLY-3",
  title: "First Task",
  status: "backlog",
  rank: "30",
  priority: 0,
  epicId: null,
  kind: "task",
};
const TASK_2: BoardItem = {
  id: "task-2",
  key: "FLY-4",
  title: "Second Task",
  status: "backlog",
  rank: "40",
  priority: 0,
  epicId: null,
  kind: "task",
};

const FIXTURE: BoardItem[] = [EPIC_1, EPIC_2, TASK_1, TASK_2];

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
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    // One registered project — the palette's own `useBoardQuery` (used to derive its "Selected
    // item" commands, including "Set Epic") is only `enabled` once it has a project id to query.
    if (command === "project_list") return Promise.resolve([PROJECT]);
    if (command === "board_list") {
      return Promise.resolve({
        items: FIXTURE,
        issues: [],
        counts: { ...EMPTY_COUNTS, backlog: FIXTURE.length },
      });
    }
    // The row pill now resolves an epic's key/title from the roster (G-01-2, 01-17-PLAN.md),
    // never from `items` — this suite's epic-pill assertion needs the same two epics `board_list`
    // already returns to also be resolvable through `epic_list_all`.
    if (command === "epic_list_all") {
      return Promise.resolve([
        { id: EPIC_1.id, key: EPIC_1.key, title: EPIC_1.title },
        { id: EPIC_2.id, key: EPIC_2.key, title: EPIC_2.title },
      ]);
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

function renderBoard(items: BoardItem[] = FIXTURE) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId="proj-1"
        items={items}
        counts={{ ...EMPTY_COUNTS, backlog: items.length }}
        onCreateTask={() => {}}
      />
    </QueryClientProvider>,
  );
}

function renderBoardWithPalette(items: BoardItem[] = FIXTURE) {
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

function selectItem(id: string) {
  act(() => {
    useUiStore.getState().setSelectedItemId(id);
  });
}

describe("epic-assign", () => {
  it("m_opens_the_epic_picker_for_a_selected_task_listing_no_epic_and_every_epic", async () => {
    renderBoard();
    selectItem("task-1");
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    const menu = await screen.findByRole("menu", { name: "Set epic" });
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByText("No epic")).toBeInTheDocument();
    // The options now resolve from the `useEpics()` roster query (G-01-2), which settles
    // asynchronously — `findByText` waits for it rather than asserting on the pre-fetch render.
    expect(await within(menu).findByText("FLY-1 First Epic")).toBeInTheDocument();
    expect(await within(menu).findByText("FLY-2 Second Epic")).toBeInTheDocument();
  });

  it("choosing_an_epic_calls_task_set_epic_with_the_task_and_epic_ids", async () => {
    renderBoard();
    selectItem("task-1");
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    await screen.findByRole("menu", { name: "Set epic" });
    fireEvent.click(await screen.findByText("FLY-1 First Epic"));

    await waitFor(() => {
      const call = invokeCommandMock.mock.calls.find(([command]) => command === "task_set_epic");
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ taskId: "task-1", epicId: "epic-1" });
    });
  });

  it("choosing_no_epic_calls_task_set_epic_with_a_null_epic_id", async () => {
    renderBoard();
    selectItem("task-1");
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    const menu = await screen.findByRole("menu", { name: "Set epic" });
    fireEvent.click(within(menu).getByText("No epic"));

    await waitFor(() => {
      const call = invokeCommandMock.mock.calls.find(([command]) => command === "task_set_epic");
      expect(call).toBeDefined();
      expect(call?.[1]).toMatchObject({ taskId: "task-1", epicId: null });
    });
  });

  it("the_epic_picker_option_list_excludes_the_selected_row_and_contains_no_task_rows", async () => {
    renderBoard();
    selectItem("task-1");
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    const menu = await screen.findByRole("menu", { name: "Set epic" });
    // The options now resolve from the `useEpics()` roster query (G-01-2), which settles
    // asynchronously — wait for the roster-sourced option before reading the full list.
    await within(menu).findByText("FLY-1 First Epic");
    const optionLabels = Array.from(menu.querySelectorAll('[role="menuitemradio"]')).map(
      (el) => el.textContent,
    );

    // Exactly "No epic" plus the two real epics — never the selected task itself, never the
    // other task.
    expect(optionLabels).toEqual(["No epic", "FLY-1 First Epic", "FLY-2 Second Epic"]);
    expect(optionLabels).not.toContain("FLY-3 First Task");
    expect(optionLabels).not.toContain("FLY-4 Second Task");
  });

  it("m_opens_no_menu_with_an_epic_selected", () => {
    renderBoard();
    selectItem("epic-1");
    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.keyDown(list, { key: "m" });

    expect(screen.queryByRole("menu", { name: "Set epic" })).not.toBeInTheDocument();
  });

  it("a_task_carrying_an_epic_id_renders_that_epics_key_and_title_in_the_row_pill", async () => {
    const items: BoardItem[] = [EPIC_1, { ...TASK_1, epicId: "epic-1" }];
    renderBoard(items);

    // The pill now resolves from the `useEpics()` roster query (G-01-2), which settles
    // asynchronously — `findByText` waits for it rather than asserting on the pre-fetch render.
    expect(await screen.findByText("FLY-1 First Epic")).toBeInTheDocument();
    expect(screen.queryByText("No epic")).not.toBeInTheDocument();
  });

  /** Reads the "Set Epic" option's `aria-disabled` inside `dialog`, polling with `waitFor` — the
   * palette's own `useBoardQuery` (which `selectedItem`'s kind is derived from) resolves
   * asynchronously after the dialog first renders. */
  async function setEpicDisabled(dialog: HTMLElement): Promise<string | null> {
    return waitFor(() => {
      const option = Array.from(dialog.querySelectorAll('[role="option"]')).find((el) =>
        el.textContent?.startsWith("Set Epic"),
      );
      expect(option).toBeDefined();
      return option?.getAttribute("aria-disabled") ?? null;
    });
  }

  it("the_palette_lists_a_set_epic_command_disabled_or_enabled_by_selection", async () => {
    renderBoardWithPalette();

    // Nothing selected — disabled.
    act(() => useUiStore.getState().setPaletteOpen(true));
    let dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(await setEpicDisabled(dialog)).toBe("true");
    act(() => useUiStore.getState().setPaletteOpen(false));

    // An epic selected — disabled (an epic has no epic parent).
    selectItem("epic-1");
    act(() => useUiStore.getState().setPaletteOpen(true));
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(await setEpicDisabled(dialog)).toBe("true");
    act(() => useUiStore.getState().setPaletteOpen(false));

    // A task selected — enabled.
    selectItem("task-1");
    act(() => useUiStore.getState().setPaletteOpen(true));
    dialog = await screen.findByRole("dialog", { name: "Command palette" });
    expect(await setEpicDisabled(dialog)).toBe("false");
  });
});
