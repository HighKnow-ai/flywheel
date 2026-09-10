/**
 * UAT gap G-01-4 (01-19-PLAN.md): opening quick-add (⌘N/⌘⇧N) must land the keyboard cursor in its
 * input from any scroll position and any band-collapse state, so a task or epic can be created and
 * typed without touching the mouse.
 *
 * This is the first suite in this repo to render the board ABOVE the virtualizer's overscan
 * window. The largest fixture anywhere else (`epic-roster.test.tsx`) is 13 rows, and at that size
 * the quick-add row is always mounted (`overscan: 10` in `BoardView.tsx`'s `useVirtualizer` call
 * comfortably covers it) — this defect is structurally unreachable under test below this volume.
 * Two consecutive gaps in this phase (G-01-2 and G-01-4) had the same root shape: an assumption
 * that holds at small N and is false at volume. Every fixture in this repo other than this one is
 * small enough to hide both. A change to `BoardView.tsx`'s virtualization, to `ROW_HEIGHT`, to
 * `overscan`, or to `BAND_ORDER` should be re-checked here first.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
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

// 60 exceeds the roughly 30 rows the 800px jsdom viewport (`test/setup.ts`'s `offsetHeight` stub)
// plus `overscan: 10` at `ROW_HEIGHT` 40 can mount, with margin.
const SIXTY_ROWS: BoardItem[] = Array.from({ length: 60 }, (_, i) => ({
  id: `task-${i}`,
  key: `FLY-${i + 1}`,
  title: `Backlog task ${i}`,
  status: "backlog",
  rank: String(i + 1).padStart(4, "0"),
  priority: 0,
  epicId: null,
  kind: "task",
}));

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

/** Renders `BoardView` at volume with a 60-row backlog fixture. */
function renderVolumeBoard(items: BoardItem[] = SIXTY_ROWS) {
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

/** The scroll container by its `role="list"` / accessible name "Board" (`BoardView.tsx`'s
 * `aria-label="Board"` on the virtualized container). */
function boardContainer() {
  return screen.getByRole("list", { name: "Board" });
}

/** Scrolls `el` to `top` and fires a real `scroll` event so the virtualizer re-reads the offset —
 * mirrors a real browser's scroll, not a direct property write the virtualizer never observes. */
function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    el.scrollTop = top;
    fireEvent.scroll(el);
  });
}

describe("cmd_n_focuses_quick_add_when_the_row_is_scrolled_out_of_the_mounted_window", () => {
  it("cmd_n_focuses_quick_add_when_the_row_is_scrolled_out_of_the_mounted_window", async () => {
    renderVolumeBoard();
    const container = boardContainer();

    // Scroll away from the top — far enough that the quick-add row (near the very top of the
    // rack) falls outside the virtualizer's mounted + overscanned window.
    scrollTo(container, 1600);

    // Assert the defect precondition BEFORE pressing ⌘N — without this, the test could pass at
    // any volume and would prove nothing.
    expect(
      screen.queryByPlaceholderText("Type a title, press Enter to create…"),
    ).not.toBeInTheDocument();
    const activeBefore = document.activeElement;
    const scrollTopBefore = container.scrollTop;

    fireEvent.keyDown(window, { key: "n", metaKey: true });

    await waitFor(() => {
      expect(
        screen.getByPlaceholderText("Type a title, press Enter to create…"),
      ).toBeInTheDocument();
    });
    const input = screen.getByPlaceholderText("Type a title, press Enter to create…");
    expect(document.activeElement).toBe(input);
    expect(container.scrollTop).toBeLessThan(scrollTopBefore);
    expect(document.activeElement).not.toBe(activeBefore);
    await waitFor(() => {
      expect(useUiStore.getState().quickAddFocusPending).toBe(false);
    });
  });
});
