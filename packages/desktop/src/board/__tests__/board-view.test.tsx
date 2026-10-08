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
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView, rackRowHeight } from "../BoardView";
import { ROW_HEIGHT_BY_KIND } from "../BoardRow";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { useCollapseStore } from "../collapseStore";
import type { BandCounts, BoardItem } from "../useBoardQuery";
import { buildVolumeItems, MOUNTABLE_ROW_ESTIMATE, scrollBoardTo, VOLUME_ROW_COUNT } from "./volume";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardEpicProgress: (projectId: string) => invokeCommandMock("board_epic_progress", { projectId }),
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
  // The rack opens on the epic roster (A-01); the status-band cases below are the status lens.
  useUiStore.getState().setGroupingKey("status");
  useCollapseStore.setState({ collapsedByProject: {} });
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") {
      return Promise.resolve({
        epics: [{ id: "epic-1", key: "FLY-1", title: "Parent epic" }],
        total: 1,
        truncated: false,
      });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
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

  describe("row kinds and the height lookup (D-13, A-03)", () => {
    it("declares the four contract heights in one lookup keyed by row kind", () => {
      expect(ROW_HEIGHT_BY_KIND).toEqual({
        "epic-header": 64,
        challenge: 48,
        task: 32,
        "band-header": 28,
      });
    });

    it("renders a band header and a task at the heights the lookup records for their kinds", () => {
      const items: BoardItem[] = [
        { id: "1", key: "FLY-1", title: "First task", status: "backlog", rank: "80", priority: 0, epicId: null },
      ];
      renderBoard(items, { ...EMPTY_COUNTS, backlog: 1 });

      const band = screen.getByText("Backlog").closest(".status-band")?.parentElement;
      const task = screen.getByText("First task").closest(".displace-transition");
      expect(band?.style.height).toBe(`${ROW_HEIGHT_BY_KIND["band-header"]}px`);
      expect(task?.getAttribute("style")).toContain(`height: ${ROW_HEIGHT_BY_KIND.task}px`);
    });

    it("sizes all four kinds, and the quick-add row as a task, by lookup alone", () => {
      const task = { kind: "task" } as never;
      expect(rackRowHeight({ kind: "band-header" } as never)).toBe(28);
      expect(rackRowHeight({ kind: "epic-header" } as never)).toBe(64);
      expect(rackRowHeight({ kind: "challenge" } as never)).toBe(48);
      expect(rackRowHeight(task)).toBe(32);
      expect(rackRowHeight({ kind: "quick-add" } as never)).toBe(32);
    });

    it("sizes a row without reading the DOM, and returns the same value on a second call", () => {
      const rect = vi.spyOn(Element.prototype, "getBoundingClientRect");
      const row = { kind: "epic-header" } as never;
      expect(rackRowHeight(row)).toBe(rackRowHeight(row));
      expect(rect).not.toHaveBeenCalled();
      rect.mockRestore();
    });

    it("mounts only the window the viewport and overscan allow at volume", () => {
      const items = buildVolumeItems();
      renderBoard(items, { ...EMPTY_COUNTS, backlog: items.length });

      const mounted = screen.getAllByRole("listitem").length;
      expect(VOLUME_ROW_COUNT).toBeGreaterThan(MOUNTABLE_ROW_ESTIMATE);
      expect(mounted).toBeLessThanOrEqual(MOUNTABLE_ROW_ESTIMATE);
      expect(mounted).toBeGreaterThanOrEqual(Math.floor(800 / ROW_HEIGHT_BY_KIND.task));
    });
  });
});

// ---------------------------------------------------------------------------------------------
// The grouping lens (D-07, amendment A-02): one rack, two grouping keys.
// ---------------------------------------------------------------------------------------------

const ALPHA = { id: "epic-a", key: "FLY-1", title: "Alpha" };
const BETA = { id: "epic-b", key: "FLY-2", title: "Beta" };

function task(id: string, title: string, status: string, epicId: string | null): BoardItem {
  return { id, key: `K-${id}`, title, status, rank: id.padStart(4, "0"), priority: 0, epicId, kind: "task" };
}

function progress(epicId: string | null, total: number) {
  return { epicId, byStatus: [], total, done: 0, agentsRunning: 0, agentsBlocked: 0, criteria: null };
}

/** Routes the lens's reads: the roster, the aggregate, and ONE scoped `board_list` per group. */
function mockLensBoard(opts: {
  epics?: { id: string; key: string; title: string }[];
  aggregate?: ReturnType<typeof progress>[];
  byEpic?: Record<string, BoardItem[]>;
  byStatus?: Record<string, BoardItem[]>;
}) {
  const epics = opts.epics ?? [ALPHA, BETA];
  invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve({ epics, total: epics.length, truncated: false });
    if (command === "board_epic_progress") return Promise.resolve(opts.aggregate ?? []);
    if (command === "board_list") {
      const filter = (args?.filter ?? {}) as { epicIds?: (string | null)[]; statuses?: string[] };
      const items = filter.epicIds
        ? (opts.byEpic?.[String(filter.epicIds[0])] ?? [])
        : filter.statuses
          ? (opts.byStatus?.[filter.statuses[0]] ?? [])
          : [];
      return Promise.resolve({ items, issues: [], counts: EMPTY_COUNTS });
    }
    return Promise.resolve(undefined);
  });
}

/** The rack's group headers only: the Issues and Triage lanes below it also carry `aria-expanded`. */
function groupHeaders(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".status-band"));
}

function groupHeader(label: RegExp): HTMLElement {
  const match = groupHeaders().find((el) => label.test(el.textContent ?? ""));
  if (!match) throw new Error(`No group header matching ${label}`);
  return match;
}

describe("the grouping lens (D-07, A-02)", () => {
  it("opens on the epic roster and switches key from a control that names both lenses in words", () => {
    resetUiState();
    mockLensBoard({ aggregate: [progress("epic-a", 3), progress("epic-b", 2), progress(null, 1)] });
    renderBoard([], EMPTY_COUNTS);

    expect(useUiStore.getState().groupingKey).toBe("epic");
    const group = screen.getByRole("group", { name: "Group the board by epic or status" });
    expect(within(group).getByRole("button", { name: "Group by epic" })).toHaveAttribute("aria-pressed", "true");
    expect(within(group).getByRole("button", { name: "Group by status" })).toHaveAttribute("aria-pressed", "false");
  });

  it("with the key set to status, renders the five bands in order with the counts it was given", () => {
    renderBoard([], { backlog: 7, todo: 6, inProgress: 5, inReview: 181, done: 3 });

    const headers = groupHeaders().map((el) => el.textContent);
    expect(headers).toEqual(["Backlog7", "Todo6", "In Progress5", "In Review181", "Done3"]);
  });

  it("takes header counts from the counts and the aggregate, never from the rows it has loaded", async () => {
    // Status lens: 181 in review, none of them in the loaded window.
    renderBoard([task("1", "Only loaded row", "backlog", null)], { ...EMPTY_COUNTS, backlog: 1, inReview: 181 });
    expect(groupHeader(/^In Review/)).toHaveTextContent("181");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("with the key set to epic, renders one header per epic plus the no-epic bucket, counted from the aggregate", async () => {
    resetUiState();
    mockLensBoard({ aggregate: [progress("epic-a", 3), progress("epic-b", 2), progress(null, 5)] });
    renderBoard([], EMPTY_COUNTS);

    await waitFor(() => expect(groupHeaders()).toHaveLength(3));
    expect(groupHeaders().map((el) => el.textContent)).toEqual(["FLY-1 Alpha3", "FLY-2 Beta2", "No epic5"]);
    // Collapsed by default: nothing is loaded, and every number above is still the aggregate's.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("expands an epic in place from one scoped fetch, and leaves the epic rows of the no-epic bucket out", async () => {
    resetUiState();
    mockLensBoard({
      epics: [ALPHA],
      aggregate: [progress("epic-a", 2), progress(null, 1)],
      byEpic: {
        "epic-a": [task("1", "Alpha one", "todo", "epic-a"), task("2", "Alpha two", "todo", "epic-a")],
        null: [
          task("3", "Orphan task", "backlog", null),
          { ...task("9", "Alpha as a row", "todo", null), kind: "epic" },
        ],
      },
    });
    renderBoard([], EMPTY_COUNTS);

    await waitFor(() => expect(groupHeaders()).toHaveLength(2));
    fireEvent.click(groupHeader(/FLY-1 Alpha/));
    fireEvent.click(groupHeader(/No epic/));

    expect(await screen.findByText("Alpha one")).toBeInTheDocument();
    expect(screen.getByText("Alpha two")).toBeInTheDocument();
    expect(await screen.findByText("Orphan task")).toBeInTheDocument();
    // The epic's own row is a header, not a task row (discriminated on kind, never on epic_id).
    expect(screen.queryByText("Alpha as a row")).not.toBeInTheDocument();
    const boardLists = invokeCommandMock.mock.calls.filter(([command]) => command === "board_list");
    expect(boardLists.length).toBe(2);
  });

  it("keeps one rack, one list element and one content fetcher across a switch of key", async () => {
    resetUiState();
    mockLensBoard({ aggregate: [progress("epic-a", 1)], byStatus: { backlog: [task("1", "A task", "backlog", null)] } });
    renderBoard([task("1", "A task", "backlog", null)], { ...EMPTY_COUNTS, backlog: 1 });

    const list = screen.getByRole("list", { name: "Board" });
    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));

    expect(screen.getAllByRole("list", { name: "Board" })).toHaveLength(1);
    expect(screen.getByRole("list", { name: "Board" })).toBe(list);
    expect(groupHeader(/^Backlog/)).toBeInTheDocument();
    await waitFor(() => {
      const commands = new Set(invokeCommandMock.mock.calls.map(([command]) => command));
      expect(commands.has("board_list")).toBe(true);
      // No second list-by-group command exists: group content only ever comes from `board_list`.
      expect([...commands].filter((c) => /group|by_epic|by_status/.test(String(c)))).toEqual([]);
    });
  });

  it("tracks collapse per group within the active key, so an epic and a band of the same name do not share it", async () => {
    resetUiState();
    // An epic whose id is literally a status name.
    mockLensBoard({
      epics: [{ id: "done", key: "FLY-7", title: "Gamma" }],
      aggregate: [progress("done", 1)],
      byEpic: { done: [task("1", "Gamma task", "todo", "done")] },
      byStatus: { done: [task("2", "Finished task", "done", null)] },
    });
    renderBoard([task("2", "Finished task", "done", null)], { ...EMPTY_COUNTS, done: 1 });

    await waitFor(() => expect(() => groupHeader(/FLY-7 Gamma/)).not.toThrow());
    fireEvent.click(groupHeader(/FLY-7 Gamma/)); // expand the epic named "done"
    expect(groupHeader(/FLY-7 Gamma/)).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByRole("button", { name: "Group by status" }));
    expect(groupHeader(/^Done/)).toHaveAttribute("aria-expanded", "true"); // the band is untouched
    fireEvent.click(groupHeader(/^Done/)); // collapse the band
    expect(groupHeader(/^Done/)).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByRole("button", { name: "Group by epic" }));
    expect(groupHeader(/FLY-7 Gamma/)).toHaveAttribute("aria-expanded", "true"); // the epic is untouched
  });

  it("shows every in-review item across all epics, past the core's default row limit", async () => {
    const IN_REVIEW = 250; // larger than board_list's default 200
    const review = Array.from({ length: IN_REVIEW }, (_, i) => task(String(1000 + i), `Review task ${i}`, "in_review", i % 2 ? "epic-a" : "epic-b"));
    mockLensBoard({ byStatus: { in_review: review } });
    renderBoard([task("1", "Window task", "backlog", null)], { ...EMPTY_COUNTS, backlog: 1, inReview: IN_REVIEW });

    expect(await screen.findByText("Review task 0")).toBeInTheDocument();
    const call = invokeCommandMock.mock.calls.find(
      ([command, args]) => command === "board_list" && (args as { filter?: { statuses?: string[] } })?.filter?.statuses?.[0] === "in_review",
    );
    expect((call?.[1] as { limit: number }).limit).toBe(IN_REVIEW);

    act(() => scrollBoardTo(screen.getByRole("list", { name: "Board" }), 1_000_000));
    expect(await screen.findByText(`Review task ${IN_REVIEW - 1}`)).toBeInTheDocument();
  });
});
