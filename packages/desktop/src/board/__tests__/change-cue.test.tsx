/**
 * Behavior under test (08.1-01-PLAN.md Task 3, D-15/D-16): a task whose worktree has real changes
 * behind it says so on its board row — a graded annotation (commits ahead, uncommitted changes),
 * never a fifth alert pill, never colour alone — fed by ONE board-wide query, defined in the
 * published legend, and named for a screen reader.
 *
 * The adapter module (the product's only `invoke` site) is stubbed, so these cases exercise the
 * real hook, the real id-keyed map in `BoardView` and the real row render — the end-to-end half
 * that is testable without a WebDriver harness.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as icons from "lucide-react";
import { BoardRow } from "../BoardRow";
import { BoardView } from "../BoardView";
import { useChangeFlags } from "../useBoardQuery";
import { MARKS_BY_ID } from "../../legend/marks";
import { resetUiState } from "../../state/uiStore";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();
let boardChangedHandler: (() => void) | undefined;

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: (handler: () => void) => {
    boardChangedHandler = handler;
    return Promise.resolve(() => {
      boardChangedHandler = undefined;
    });
  },
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardChangeFlags: (projectId: string) => invokeCommandMock("board_change_flags", { projectId }),
}));

const COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 4, inReview: 0, done: 0 };

function task(n: number, title: string): BoardItem {
  return {
    id: `task-${n}`,
    key: `FLY-${n}`,
    title,
    status: "in_progress",
    rank: String(10 * n),
    priority: 0,
    epicId: null,
    kind: "task",
  };
}

const ITEMS: BoardItem[] = [task(1, "Ahead"), task(2, "Dirty"), task(3, "No worktree"), task(4, "Unmeasurable")];

beforeEach(() => {
  resetUiState();
  boardChangedHandler = undefined;
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve({ epics: [], total: 0, truncated: false });
    if (command === "board_change_flags") {
      return Promise.resolve([
        { taskId: "task-1", ahead: 3, dirty: false },
        { taskId: "task-2", ahead: 0, dirty: true },
        // task-3 has no worktree: no entry at all.
        { taskId: "task-4", ahead: null, dirty: false },
      ]);
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function renderBoard() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView projectId="proj-1" items={ITEMS} counts={COUNTS} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
}

function rowFor(key: string): HTMLElement {
  const row = screen.getAllByRole("listitem").find((el) => el.getAttribute("aria-label")?.startsWith(`${key},`));
  if (!row) throw new Error(`no row for ${key}`);
  return row;
}

describe("board row change annotation, end to end through BoardView (D-15, D-16)", () => {
  it("a task ahead of its base shows the commits-ahead annotation and its accessible name ends with the count", async () => {
    renderBoard();
    await waitFor(() => expect(rowFor("FLY-1")).toHaveAccessibleName(/, 3 commits ahead$/));
    expect(within(rowFor("FLY-1")).getByRole("img", { name: "3 commits ahead" })).toBeInTheDocument();
  });

  it("a task with a dirty worktree shows the uncommitted-changes annotation and says so in its accessible name", async () => {
    renderBoard();
    await waitFor(() => expect(rowFor("FLY-2")).toHaveAccessibleName(/, uncommitted changes$/));
    expect(within(rowFor("FLY-2")).getByRole("img", { name: "uncommitted changes" })).toBeInTheDocument();
    // Level with its base (ahead 0) is not announced as a count.
    expect(within(rowFor("FLY-2")).queryByRole("img", { name: /commits? ahead/ })).not.toBeInTheDocument();
  });

  it("a task absent from the flag map renders neither annotation and its accessible name gains nothing", async () => {
    renderBoard();
    await waitFor(() => expect(rowFor("FLY-1")).toHaveAccessibleName(/commits ahead/));
    const row = rowFor("FLY-3");
    expect(within(row).queryByRole("img")).not.toBeInTheDocument();
    expect(row).not.toHaveAccessibleName(/ahead|uncommitted/);
  });

  it("a task whose base cannot be measured renders neither annotation — absence of a number is not a zero", async () => {
    renderBoard();
    await waitFor(() => expect(rowFor("FLY-1")).toHaveAccessibleName(/commits ahead/));
    const row = rowFor("FLY-4");
    expect(within(row).queryByRole("img")).not.toBeInTheDocument();
    expect(row).not.toHaveAccessibleName(/ahead|uncommitted/);
  });

  it("the whole board is served by exactly one change-flags query, never one per row", async () => {
    renderBoard();
    await waitFor(() => expect(rowFor("FLY-1")).toHaveAccessibleName(/commits ahead/));
    const calls = invokeCommandMock.mock.calls.filter(([command]) => command === "board_change_flags");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ projectId: "proj-1" });
  });
});

describe("BoardRow change annotation (D-15)", () => {
  const item = task(9, "Row alone");

  it("singular count reads '1 commit ahead'", () => {
    render(<BoardRow item={item} changeFlag={{ ahead: 1, dirty: false }} />);
    expect(screen.getByRole("img", { name: "1 commit ahead" })).toBeInTheDocument();
  });

  it("both signals together read in a fixed order, the count first", () => {
    render(<BoardRow item={item} changeFlag={{ ahead: 2, dirty: true }} />);
    expect(screen.getByRole("listitem")).toHaveAccessibleName(/, 2 commits ahead, uncommitted changes$/);
  });

  it("is structurally exempt from the truncation ladder — carries no field-* class", () => {
    render(<BoardRow item={item} changeFlag={{ ahead: 2, dirty: true }} />);
    for (const mark of screen.getAllByRole("img")) {
      expect(mark.className.split(/\s+/).some((c) => c.startsWith("field-"))).toBe(false);
    }
  });

  it("is a graded annotation, not an alert pill — it is not a button", () => {
    render(<BoardRow item={item} changeFlag={{ ahead: 2, dirty: true }} />);
    expect(screen.queryByRole("button", { name: /ahead|uncommitted/ })).not.toBeInTheDocument();
  });
});

describe("legend registration (no mark may exist the legend does not define)", () => {
  it.each(["change-ahead", "change-dirty"])("%s is a registered mark with a real icon, label and meaning", (id) => {
    const mark = MARKS_BY_ID[id];
    expect(mark, `missing mark "${id}"`).toBeDefined();
    expect((icons as unknown as Record<string, unknown>)[mark.glyph]).toBeDefined();
    expect(mark.label.length).toBeGreaterThan(0);
    expect(mark.meaning.length).toBeGreaterThan(0);
  });

  it("the row names no icon component directly — glyph and words come from the registry", async () => {
    const source = await import("../BoardRow.tsx?raw");
    const text: string = source.default;
    expect(text).toMatch(/changeAheadMark\?\.glyph/);
    expect(text).toMatch(/changeDirtyMark\?\.glyph/);
  });
});

describe("useChangeFlags (D-16)", () => {
  it("coalesces a burst of board:changed events into one refresh, not one sweep per event", async () => {
    const queryClient = new QueryClient();
    const { result } = renderHook(() => useChangeFlags("proj-1"), { wrapper: wrapper(queryClient) });
    const calls = () => invokeCommandMock.mock.calls.filter(([c]) => c === "board_change_flags").length;

    await waitFor(() => expect(result.current.data).toBeDefined());
    await waitFor(() => expect(boardChangedHandler).toBeDefined());
    expect(calls()).toBe(1);

    for (let i = 0; i < 5; i += 1) boardChangedHandler?.();

    // Not immediately — the refresh is held for the coalescing window...
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(calls()).toBe(1);
    // ...then exactly one refresh serves the whole burst.
    await waitFor(() => expect(calls()).toBe(2), { timeout: 3000 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(calls()).toBe(2);
  });

  it("issues no query at all while no project is selected", () => {
    const queryClient = new QueryClient();
    renderHook(() => useChangeFlags(undefined), { wrapper: wrapper(queryClient) });
    expect(invokeCommandMock.mock.calls.filter(([c]) => c === "board_change_flags")).toHaveLength(0);
  });
});
