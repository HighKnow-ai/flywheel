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
 *
 * The lesson this suite exists to institutionalise: "the symptom stopped" is not "the contract
 * holds." Beyond the tracer case and the collapse cases (which prove the fix), this file also
 * pins the owner's exact re-press wording, proves ⌘⇧N travels the identical funnel rather than a
 * second implementation, proves the focus request is consumed exactly once (never twice, never
 * stolen by an incidental re-mount), and re-asserts — at the volume that exposed each of
 * them — the two properties an earlier gap in this same phase already closed: G-01-1's layer
 * guard (a refused ⌘N must move nothing) and G-01-2's no-raw-identifier property (no rendered
 * text may ever be a raw internal id).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { useCollapseStore } from "../collapseStore";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { BandCounts, BoardItem, IssueItem } from "../useBoardQuery";
import {
  buildVolumeItems,
  DEEP_SCROLL_OFFSET,
  MOUNTABLE_ROW_ESTIMATE,
  scrollBoardTo,
  VOLUME_ROW_COUNT,
} from "./volume";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

// The shared, self-checking volume fixture (`./volume.ts`) — exceeds `MOUNTABLE_ROW_ESTIMATE`
// with margin, so this suite reaches the row the virtualizer does not mount yet.
const SIXTY_ROWS: BoardItem[] = buildVolumeItems();

beforeEach(() => {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "epic_list_all") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
});

/** Renders `BoardView` at volume with a 60-row backlog fixture. */
function renderVolumeBoard(items: BoardItem[] = SIXTY_ROWS, issues: IssueItem[] = []) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <BoardView
        projectId="proj-1"
        items={items}
        issues={issues}
        counts={{ ...EMPTY_COUNTS, backlog: items.length }}
        onCreateTask={() => {}}
      />
    </QueryClientProvider>,
  );
}

/** Opens the item detail panel by writing the store fields directly (exactly
 * `layer-guard.test.tsx`'s `openDetailPanel`) — this file is about what happens once a layer is
 * already on top, not about how it got there. Sets both `selectedItemId` and `detailItemId`
 * because `BoardView`'s panel renders off the SELECTED item, not off `detailItemId` alone. */
function openDetailPanel(id: string) {
  act(() => {
    useUiStore.getState().setSelectedItemId(id);
    useUiStore.getState().setDetailItemId(id);
  });
}

/** The scroll container by its `role="list"` / accessible name "Board" (`BoardView.tsx`'s
 * `aria-label="Board"` on the virtualized container). */
function boardContainer() {
  return screen.getByRole("list", { name: "Board" });
}

/** Scrolls `el` to `top` and fires a real `scroll` event so the virtualizer re-reads the offset —
 * mirrors a real browser's scroll, not a direct property write the virtualizer never observes.
 * Delegates to the shared `scrollBoardTo` (`./volume.ts`) — the *reader* half of the same jsdom
 * gap `test/setup.ts`'s `scrollTo` stub covers on the writer side — wrapped in `act` so React
 * flushes the resulting state update before the next assertion. */
function scrollTo(el: HTMLElement, top: number) {
  act(() => {
    scrollBoardTo(el, top);
  });
}

// This block runs first and proves the fixture's own precondition — hoisted into named cases of
// its own rather than left as an assumption inside a behavioral case, so a regression in the
// fixture (a `ROW_HEIGHT`/`overscan`/jsdom-viewport change eroding the margin, or the quick-add
// row mounting after all) reports as its own named failure, not a confusing failure buried
// inside a case that is really testing something else.
describe("the shared volume fixture's own adequacy (Task 1)", () => {
  it("the_volume_fixture_exceeds_what_the_harness_can_mount", () => {
    expect(VOLUME_ROW_COUNT).toBeGreaterThanOrEqual(50);
    expect(VOLUME_ROW_COUNT).toBeGreaterThan(MOUNTABLE_ROW_ESTIMATE);
    expect(VOLUME_ROW_COUNT - MOUNTABLE_ROW_ESTIMATE).toBeGreaterThanOrEqual(20);
  });

  it("the_quick_add_row_is_genuinely_unmounted_at_the_deep_scroll_offset", () => {
    renderVolumeBoard();
    const container = boardContainer();
    scrollTo(container, DEEP_SCROLL_OFFSET);

    expect(
      screen.queryByPlaceholderText("Type a title, press Enter to create…"),
    ).not.toBeInTheDocument();
  });
});

describe("cmd_n_focuses_quick_add_when_the_row_is_scrolled_out_of_the_mounted_window", () => {
  it("cmd_n_focuses_quick_add_when_the_row_is_scrolled_out_of_the_mounted_window", async () => {
    renderVolumeBoard();
    const container = boardContainer();

    // Scroll away from the top — far enough that the quick-add row (near the very top of the
    // rack) falls outside the virtualizer's mounted + overscanned window.
    scrollTo(container, DEEP_SCROLL_OFFSET);

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

describe("a collapsed Backlog band can no longer swallow the quick-add row (Task 2)", () => {
  it("cmd_n_expands_a_collapsed_backlog_band_and_focuses_the_row", async () => {
    act(() => {
      useCollapseStore.getState().toggle("proj-1", "backlog");
    });
    renderVolumeBoard();
    const container = boardContainer();
    scrollTo(container, DEEP_SCROLL_OFFSET);

    expect(
      screen.queryByPlaceholderText("Type a title, press Enter to create…"),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "n", metaKey: true });

    const input = await screen.findByPlaceholderText("Type a title, press Enter to create…");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("expanding_backlog_for_quick_add_leaves_every_other_band_alone", async () => {
    act(() => {
      useCollapseStore.getState().toggle("proj-1", "backlog");
      useCollapseStore.getState().toggle("proj-1", "done");
    });
    renderVolumeBoard();

    fireEvent.keyDown(window, { key: "n", metaKey: true });

    await waitFor(() => {
      expect(useCollapseStore.getState().collapsedByProject["proj-1"]?.backlog).toBe(false);
    });
    expect(useCollapseStore.getState().collapsedByProject["proj-1"]?.done).toBe(true);
    expect(useCollapseStore.getState().collapsedByProject["proj-2"]).toBeUndefined();
  });

  it("a_collapsed_backlog_band_at_the_top_of_the_board_still_focuses", async () => {
    act(() => {
      useCollapseStore.getState().toggle("proj-1", "backlog");
    });
    renderVolumeBoard();

    fireEvent.keyDown(window, { key: "n", metaKey: true });

    const input = await screen.findByPlaceholderText("Type a title, press Enter to create…");
    await waitFor(() => {
      expect(document.activeElement).toBe(input);
    });
  });

  it("expand_is_idempotent_and_does_not_toggle_an_already_expanded_band", async () => {
    renderVolumeBoard();

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await screen.findByPlaceholderText("Type a title, press Enter to create…");
    act(() => {
      useUiStore.getState().setQuickAddOpen(false);
    });
    fireEvent.keyDown(window, { key: "n", metaKey: true });

    await screen.findByPlaceholderText("Type a title, press Enter to create…");
    expect(useCollapseStore.getState().collapsedByProject["proj-1"]?.backlog).not.toBe(true);
  });
});

// The cases below separate "the symptom stopped" from "the contract holds" — the owner's exact
// re-press wording, the epic path travelling the same funnel, the consume-once guarantee, both
// of this plan's prohibitions (G-01-1's layer guard and G-01-2's no-raw-identifier property), and
// the two preserved defaults (empty board, issues lane). Task 3 edits no production file — a
// failure here belongs in Task 1's or Task 2's files.

describe("the re-press case — the owner's literal words", () => {
  it("cmd_n_refocuses_quick_add_when_it_is_already_open_but_focus_moved_away", async () => {
    renderVolumeBoard();

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    const input = await screen.findByPlaceholderText("Type a title, press Enter to create…");
    await waitFor(() => expect(document.activeElement).toBe(input));

    act(() => {
      input.blur();
    });
    expect(document.activeElement).not.toBe(input);

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    await waitFor(() => expect(document.activeElement).toBe(input));
  });
});

describe("the epic keystroke — the same path, not a second implementation", () => {
  it("cmd_shift_n_focuses_quick_add_for_an_epic_at_volume", async () => {
    renderVolumeBoard();
    const container = boardContainer();
    scrollTo(container, DEEP_SCROLL_OFFSET);

    expect(
      screen.queryByPlaceholderText("Type an epic title, press Enter to create…"),
    ).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });

    const input = await screen.findByPlaceholderText("Type an epic title, press Enter to create…");
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(useUiStore.getState().quickAddKind).toBe("epic");
  });
});

describe("the consume-once case", () => {
  it("scrolling_the_row_back_into_view_does_not_steal_focus_a_second_time", async () => {
    renderVolumeBoard();
    const container = boardContainer();
    scrollTo(container, DEEP_SCROLL_OFFSET);

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    const input = await screen.findByPlaceholderText("Type a title, press Enter to create…");
    await waitFor(() => expect(document.activeElement).toBe(input));

    act(() => {
      input.blur();
    });
    expect(document.activeElement).not.toBe(input);

    // Scroll far down (the row unmounts), then back to the top (it re-mounts).
    scrollTo(container, DEEP_SCROLL_OFFSET);
    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("Type a title, press Enter to create…"),
      ).not.toBeInTheDocument();
    });
    scrollTo(container, 0);

    const remounted = await screen.findByPlaceholderText("Type a title, press Enter to create…");
    expect(document.activeElement).not.toBe(remounted);
    expect(useUiStore.getState().quickAddFocusPending).toBe(false);
  });

  it("escaping_quick_add_clears_an_unconsumed_focus_request", async () => {
    renderVolumeBoard();
    const container = boardContainer();
    scrollTo(container, DEEP_SCROLL_OFFSET);

    // Open quick-add through the store, then close it again in the same batch, before React
    // ever commits a render with the request outstanding — the row never gets the chance to
    // mount and consume it. A stale request must not survive to be picked up by an unrelated
    // later mount.
    act(() => {
      useUiStore.getState().openQuickAdd("task");
      useUiStore.getState().setQuickAddOpen(false);
    });

    expect(useUiStore.getState().quickAddOpen).toBe(false);
    expect(useUiStore.getState().quickAddFocusPending).toBe(false);
  });
});

describe("prohibition 1 — G-01-1's layer guard, asserted at volume", () => {
  it("cmd_n_over_the_detail_panel_scrolls_nothing_and_moves_no_focus", () => {
    renderVolumeBoard();
    openDetailPanel("task-0");
    const container = boardContainer();
    scrollTo(container, DEEP_SCROLL_OFFSET);
    const activeBefore = document.activeElement;
    const scrollTopBefore = container.scrollTop;

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });

    expect(useUiStore.getState().quickAddOpen).toBe(false);
    expect(useUiStore.getState().quickAddFocusPending).toBe(false);
    expect(container.scrollTop).toBe(scrollTopBefore);
    expect(document.activeElement).toBe(activeBefore);
  });

  it("a_picker_layer_also_refuses_cmd_n_without_scrolling", () => {
    renderVolumeBoard();
    act(() => {
      useUiStore.getState().setActivePicker({ kind: "status", id: "task-0" });
    });
    const container = boardContainer();
    scrollTo(container, DEEP_SCROLL_OFFSET);
    const activeBefore = document.activeElement;
    const scrollTopBefore = container.scrollTop;

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });

    expect(useUiStore.getState().quickAddOpen).toBe(false);
    expect(useUiStore.getState().quickAddFocusPending).toBe(false);
    expect(container.scrollTop).toBe(scrollTopBefore);
    expect(document.activeElement).toBe(activeBefore);
  });
});

describe("prohibition 2 and the preserved defaults", () => {
  it("the_empty_board_still_opens_quick_add_pre_focused", async () => {
    renderVolumeBoard([]);

    const input = await screen.findByPlaceholderText("Type a title, press Enter to create…");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("the_issues_lane_quick_add_never_takes_focus_on_load", async () => {
    const issue: IssueItem = {
      id: "issue-1",
      key: "FLY-100",
      title: "An issue",
      kind: "idea",
      epicId: null,
      taskId: null,
    };
    renderVolumeBoard(SIXTY_ROWS, [issue]);

    const issuesQuickAdd = await screen.findByLabelText("Quick add an issue");
    expect(document.activeElement).not.toBe(issuesQuickAdd);
  });

  it("no_row_renders_a_raw_internal_identifier_at_volume", () => {
    // Deliberately a re-assertion of plan 01-17/01-18's property (G-01-2) at the volume where it
    // first surfaced, not a new requirement — a real leak would match this pattern, since every
    // id in this fixture is a real Crockford-base32-shaped string of the right length.
    const { container } = renderVolumeBoard();
    const ulidPattern = /\b[0-9A-HJKMNP-TV-Z]{26}\b/i;
    expect(container.textContent ?? "").not.toMatch(ulidPattern);
  });
});
