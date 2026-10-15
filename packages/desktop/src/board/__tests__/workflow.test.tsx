/**
 * Behavior under test (01-04-PLAN.md Task 3 — the fixed hierarchy and the fixed workflow,
 * component bullet): the five band headers render in the fixed order, sourced from the one fixed
 * workflow state list (`legend/marks.ts`'s `STATUS_MARKS`, itself asserted elsewhere to match
 * `core::domain::WORKFLOW_STATES`), never a second hand-typed list.
 *
 * Phase 13 plan 07 (DRFT-04, D-19): status is derived from git and forge state, so it is read-only
 * on the card. The picker that used to offer the five options is deleted; the cases below assert
 * its absence and that the value is still shown.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { showStatusBands } from "./lens";
import { BoardRow } from "../BoardRow";
import type { BandCounts, BoardItem } from "../useBoardQuery";

// Plan 02-06 Task 3 gave `BoardView` its own `subscribeBoardChanged` subscriber
// (`useBlockedSummary`) — this file previously rendered `BoardView` with no `adapters/tauri` mock
// at all (every query settling into a harmlessly-ignored rejection, since none of this file's own
// assertions depend on query data). `subscribeBoardChanged`'s real `listen()` call rejects
// synchronously outside a real Tauri context, and unlike `invokeCommand`'s rejections (silently
// absorbed by react-query's own query-error handling), nothing here ever attached a `.catch()` to
// that specific promise — surfacing as a genuine unhandled rejection now that `BoardView` calls it
// directly. A minimal mock (matching every sibling test file's own convention) removes the noise
// without asserting anything new; this file's own tests are unaffected either way.
vi.mock("../../adapters/tauri", () => ({
  invokeCommand: () => Promise.resolve(undefined),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  blockedSummary: () => Promise.resolve({ blockedTaskIds: [], blockedCount: 0 }),
}));

// These cases are about the status bands; the rack opens on the epic roster (A-01).
beforeEach(() => {
  showStatusBands();
});

const EMPTY_COUNTS: BandCounts = {
  backlog: 0,
  todo: 0,
  inProgress: 0,
  inReview: 0,
  done: 0,
};

function makeItem(status: string): BoardItem {
  return { id: "task-1", key: "FLY-1", title: "A task", status, rank: "10", priority: 0, epicId: null, kind: "task" };
}

function renderBoard(items: BoardItem[], counts: BandCounts) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView projectId="proj-1" items={items} counts={counts} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
}

describe("workflow — the fixed five states are structurally fixed in the renderer", () => {
  it("renders exactly the five band headers, in the fixed order, sourced from one list", () => {
    renderBoard([], EMPTY_COUNTS);

    const headings = screen.getAllByText(/^(Backlog|Todo|In Progress|In Review|Done)$/);
    const labels = headings.map((el) => el.textContent);

    expect(labels).toEqual(["Backlog", "Todo", "In Progress", "In Review", "Done"]);
    expect(labels).toHaveLength(5);
  });

  it("status is a read-only value on the card: stated in the row's name, offering no control", () => {
    const { container } = render(<BoardRow item={makeItem("in_progress")} />);

    expect(screen.getByRole("listitem")).toHaveAccessibleName(/, In Progress,/);
    expect(screen.queryByRole("button", { name: /^Status:/ })).toBeNull();
    // The glyph is the first child of the row, hidden from assistive tech and inert under a click.
    const glyph = container.querySelector(".board-row > span") as HTMLElement;
    expect(glyph).toHaveAttribute("aria-hidden", "true");
    fireEvent.click(glyph);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("menuitemradio")).toBeNull();
  });

  it("the `s` key no longer opens anything: the board has no status-setting binding", async () => {
    const { resolveBinding } = await import("../../state/keyboard");
    const event = new KeyboardEvent("keydown", { key: "s" });
    expect(resolveBinding(event, "board-list")).toBeFalsy();
  });

  it("the deleted picker is gone from the component tree and nothing imports it", async () => {
    const boardView = (await import("../BoardView.tsx?raw")).default;
    const boardRow = (await import("../BoardRow.tsx?raw")).default;
    const palette = (await import("../CommandPalette.tsx?raw")).default;
    const detail = (await import("../../item-detail/ItemDetailPanel.tsx?raw")).default;
    for (const source of [boardView, boardRow, palette, detail]) {
      expect(source).not.toMatch(/pickers\/Status/);
      expect(source).not.toMatch(/useSetStatus|task_set_status|epic_set_status/);
    }
  });
});
