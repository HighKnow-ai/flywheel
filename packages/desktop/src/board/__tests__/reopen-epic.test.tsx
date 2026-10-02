/**
 * Behavior under test (05-10-PLAN.md Task 1, D-91): reopening an existing epic's authoring
 * session is one action from two places — the board row (`r`, `board-list` region) and
 * `ItemDetailPanel.tsx`'s own Continue Shaping section — both calling the ONE shared
 * `continueShapingEpic` entry point (`useBoardQuery.ts`). An epic with a running/blocked
 * authoring session routes straight to it and starts no second run (asserted by a call count on
 * `authoring_run_start`); an epic with none opens the authoring launch sheet (via
 * `launchSheetAuthoringHandoff`) instead of starting blind. The keyboard binding itself
 * (`continue-shaping`, `r`) is asserted against `state/keyboard.ts` directly.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { resolveBinding } from "../../state/keyboard";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  authoringRunForEpic: (epicId: string) => invokeCommandMock("authoring_run_for_epic", { epicId }),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  // `ItemDetailPanel`'s `GitFactsSection` (Phase 7 plan 07-01) calls these two directly, not
  // through `invokeCommand` — mocked here for the same reason `openFolderDialog` is.
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const EPIC_1: BoardItem = {
  id: "epic-1",
  key: "FLY-1",
  title: "An existing epic",
  status: "backlog",
  rank: "10",
  priority: 0,
  epicId: null,
  kind: "epic",
};
const TASK_1: BoardItem = {
  id: "task-1",
  key: "FLY-2",
  title: "An ordinary task",
  status: "backlog",
  rank: "20",
  priority: 0,
  epicId: null,
  kind: "task",
};

const FIXTURE: BoardItem[] = [EPIC_1, TASK_1];

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") {
      return Promise.resolve({ epics: [{ id: EPIC_1.id, key: EPIC_1.key, title: EPIC_1.title }], total: 1, truncated: false });
    }
    if (command === "authoring_run_for_epic") return Promise.resolve(null);
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

function selectItem(id: string) {
  act(() => {
    useUiStore.getState().setSelectedItemId(id);
  });
}

describe("continue-shaping keyboard binding (state/keyboard.ts)", () => {
  it("r resolves to continue-shaping in the board-list region", () => {
    const binding = resolveBinding({ key: "r", metaKey: false, shiftKey: false, target: document.body }, "board-list");
    expect(binding?.id).toBe("continue-shaping");
  });
});

describe("reopen-epic — the board-row door", () => {
  it("r on a selected epic row with no running session calls authoring_run_for_epic and opens the authoring launch sheet", async () => {
    renderBoard();
    selectItem(EPIC_1.id);
    const list = screen.getByRole("list", { name: "Board" });

    fireEvent.keyDown(list, { key: "r" });

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_run_for_epic", { epicId: EPIC_1.id }),
    );
    await waitFor(() =>
      expect(useUiStore.getState().launchSheetAuthoringHandoff).toEqual({ epicId: EPIC_1.id }),
    );
    expect(useUiStore.getState().activeAgentRunId).toBeNull();
  });

  it("r on a selected TASK row is refused (no-op) — only an epic has a shaping session of its own", async () => {
    renderBoard();
    selectItem(TASK_1.id);
    const list = screen.getByRole("list", { name: "Board" });

    fireEvent.keyDown(list, { key: "r" });

    // No fixed sync-vs-async race to wait for — the guard is synchronous (a `kind` check before
    // any call), so the absence of the call is assertable immediately.
    expect(invokeCommandMock).not.toHaveBeenCalledWith("authoring_run_for_epic", expect.anything());
    expect(useUiStore.getState().launchSheetAuthoringHandoff).toBeNull();
  });

  it("an epic with a running authoring session routes to it and starts no second run, asserted by a call count", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "epic_list_all") {
        return Promise.resolve({ epics: [{ id: EPIC_1.id, key: EPIC_1.key, title: EPIC_1.title }], total: 1, truncated: false });
      }
      if (command === "authoring_run_for_epic") {
        return Promise.resolve({
          id: "run-already-running",
          epicId: EPIC_1.id,
          status: "running",
          authoringStage: "decompose",
          resumed: true,
        });
      }
      return Promise.resolve(undefined);
    });
    renderBoard();
    selectItem(EPIC_1.id);
    const list = screen.getByRole("list", { name: "Board" });

    fireEvent.keyDown(list, { key: "r" });

    await waitFor(() =>
      expect(useUiStore.getState().activeAgentRunId).toBe("run-already-running"),
    );
    expect(useUiStore.getState().activeAgentRunAuthoringStage).toBe("decompose");
    expect(useUiStore.getState().activeAgentRunEpicId).toBe(EPIC_1.id);
    // The launch sheet never opens for the already-running case — routing is direct.
    expect(useUiStore.getState().launchSheetAuthoringHandoff).toBeNull();
    // The call count itself: `authoring_run_start` is never invoked on this path — the running
    // run's own id is all `continueShapingEpic` ever needed.
    expect(invokeCommandMock).not.toHaveBeenCalledWith("authoring_run_start", expect.anything());
  });
});

describe("reopen-epic — the item-detail-panel door", () => {
  it('the "Continue Shaping" section calls the SAME shared entry point as the board-row action', async () => {
    renderBoard();
    selectItem(EPIC_1.id);
    act(() => {
      useUiStore.getState().setDetailItemId(EPIC_1.id);
    });

    const button = await screen.findByRole("button", { name: "Continue Shaping" });
    fireEvent.click(button);

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_run_for_epic", { epicId: EPIC_1.id }),
    );
    await waitFor(() =>
      expect(useUiStore.getState().launchSheetAuthoringHandoff).toEqual({ epicId: EPIC_1.id }),
    );
  });

  it("renders no Continue Shaping button for a task's own detail panel", async () => {
    renderBoard();
    selectItem(TASK_1.id);
    act(() => {
      useUiStore.getState().setDetailItemId(TASK_1.id);
    });

    await waitFor(() => expect(screen.getAllByText(TASK_1.key).length).toBeGreaterThan(0));
    expect(screen.queryByRole("button", { name: "Continue Shaping" })).not.toBeInTheDocument();
  });
});
