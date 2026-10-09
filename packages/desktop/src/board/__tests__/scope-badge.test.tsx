/**
 * Behavior under test (09-06-PLAN.md Task 3, D-153): a task that fought its declared file-set
 * twenty times looks different on the board from one that never did. The count badge is absent
 * (not a printed zero) for a task with no refusals, named for a screen reader, defined in the
 * published legend, and fed by ONE project-wide read rather than a query per row.
 *
 * The adapter module (the product's only `invoke` site) is stubbed, so these cases exercise the
 * real hook, the real id-keyed map in `BoardView` and the real row render.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as icons from "lucide-react";
import { BoardRow } from "../BoardRow";
import { BoardView } from "../BoardView";
import { showStatusBands } from "./lens";
import { MARKS_BY_ID } from "../../legend/marks";
import { resetUiState } from "../../state/uiStore";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardScopeFlags: (projectId: string) => invokeCommandMock("board_scope_flags", { projectId }),
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

const ITEMS: BoardItem[] = [task(1, "Three"), task(2, "Twenty"), task(3, "None"), task(4, "Also none")];

beforeEach(() => {
  resetUiState();
  showStatusBands();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve({ epics: [], total: 0, truncated: false });
    if (command === "board_scope_flags") {
      // A task with no refusals is absent from the answer, not present with zero.
      return Promise.resolve([
        { taskId: "task-1", count: 3 },
        { taskId: "task-2", count: 20 },
      ]);
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
});

function renderBoard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardView projectId="proj-1" items={ITEMS} counts={COUNTS} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
}

function rowFor(key: string): HTMLElement {
  const row = screen.getAllByRole("listitem").find((el) => el.getAttribute("aria-label")?.startsWith(`${key},`));
  if (!row) throw new Error(`no row for ${key}`);
  return row;
}

describe("scope-refusal badge, end to end through BoardView (D-153)", () => {
  it("a task with three refusals shows a badge reading three, named for what it counts", async () => {
    renderBoard();
    await waitFor(() => expect(within(rowFor("FLY-1")).getByRole("img", { name: /3 .*refus/i })).toBeInTheDocument());
    expect(within(rowFor("FLY-1")).getByRole("img", { name: /3 .*refus/i })).toHaveTextContent("3");
  });

  it("a task with twenty refusals shows twenty, visibly unlike one with none", async () => {
    renderBoard();
    await waitFor(() => expect(within(rowFor("FLY-2")).getByRole("img", { name: /20 .*refus/i })).toHaveTextContent("20"));
    expect(within(rowFor("FLY-3")).queryByRole("img", { name: /refus/i })).not.toBeInTheDocument();
  });

  it("a task absent from the answer renders no badge element and no placeholder", async () => {
    renderBoard();
    await waitFor(() => expect(within(rowFor("FLY-1")).getByRole("img", { name: /refus/i })).toBeInTheDocument());
    const row = rowFor("FLY-3");
    expect(row.querySelector('[data-testid="scope-badge"]')).toBeNull();
    expect(row).not.toHaveAccessibleName(/refus/i);
  });

  it("the whole board is served by exactly one scope-flags read, never one per row", async () => {
    renderBoard();
    await waitFor(() => expect(within(rowFor("FLY-1")).getByRole("img", { name: /refus/i })).toBeInTheDocument());
    const calls = invokeCommandMock.mock.calls.filter(([command]) => command === "board_scope_flags");
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ projectId: "proj-1" });
  });
});

describe("BoardRow scope badge", () => {
  const item = task(9, "Row alone");

  it("renders nothing for zero and for an absent prop", () => {
    const { rerender } = render(<BoardRow item={item} scopeDenied={0} />);
    expect(screen.queryByTestId("scope-badge")).not.toBeInTheDocument();
    rerender(<BoardRow item={item} />);
    expect(screen.queryByTestId("scope-badge")).not.toBeInTheDocument();
  });

  it("singular reads '1 scope refusal' and the row's own accessible name gains the count", () => {
    render(<BoardRow item={item} scopeDenied={1} />);
    expect(screen.getByRole("img", { name: "1 scope refusal" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveAccessibleName(/, 1 scope refusal$/);
  });

  it("is a count, not an alert: it is not a button and carries no field-* class", () => {
    render(<BoardRow item={item} scopeDenied={4} />);
    const badge = screen.getByTestId("scope-badge");
    expect(badge.className.split(/\s+/).some((c) => c.startsWith("field-"))).toBe(false);
    expect(screen.queryByRole("button", { name: /refus/i })).not.toBeInTheDocument();
  });
});

describe("legend registration and the no-polling rule", () => {
  it("scope-denied is a registered mark with a real icon, label and meaning", () => {
    const mark = MARKS_BY_ID["scope-denied"];
    expect(mark, 'missing mark "scope-denied"').toBeDefined();
    expect((icons as unknown as Record<string, unknown>)[mark.glyph]).toBeDefined();
    expect(mark.label.length).toBeGreaterThan(0);
    expect(mark.meaning.length).toBeGreaterThan(0);
  });

  it("the row names the glyph through the registry, not directly", async () => {
    const source = await import("../BoardRow.tsx?raw");
    expect(source.default).toMatch(/scopeDeniedMark\?\.glyph/);
  });

  it("the board query module gained no polling interval", async () => {
    const source = await import("../useBoardQuery.ts?raw");
    const code = (source.default as string).split("\n").filter((l) => !/^\s*(\*|\/)/.test(l)).join("\n");
    expect(code).not.toMatch(/refetchInterval/);
  });
});
