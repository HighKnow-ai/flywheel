/**
 * Regression tests for G-01-FOCUS (01-13-PLAN.md): `useGlobalBindings` was a bare `window`
 * keydown listener with no idea which layer was on top. Radix's `FocusScope trapped` on the item
 * detail panel can trap Tab movement but cannot stop a window listener from opening a surface
 * outside the scope — a shortcut opened something and Radix immediately yanked focus back. The
 * fix is one central guard (`bindingAllowedInLayer`/`topLayer`, `state/keyboard.ts`), not five
 * per-consumer guards. Instances held here, each one a confirmed UAT symptom of the same root
 * cause:
 *   1. ⌘N/⌘⇧N open quick-add behind the detail panel (the headline misfocus symptom — the row
 *      appeared but typing landed in the panel)
 *   2. ⌘F and bare `/` steal focus to the search field from behind the panel
 *   3. ⌘1 switches project underneath an open panel
 *   4. ⌘⇧O opens the native folder dialog from behind a trapped scope
 *   5. ⌘K must still open the palette over the panel (the one binding a trapped layer may never
 *      strand the user without — BOARD-07), landing focus in the palette's own input, and a
 *      row-level picker must still refuse it (a picker already owns a single keypress of its own)
 *   6. A region-changing palette command (`Create Task`) must not be silently dropped by the new
 *      guard — it returns to the board layer first
 *   7. CR-01-review's CR-02 (01-REVIEW.md): `IssuesLane`'s parent-picker button is a POINTER path,
 *      not a keystroke — it must stand down under the same guard too. Every instance above drives
 *      the guard via `fireEvent.keyDown`; this one drives it via `fireEvent.click` to prove the
 *      guard also covers a click-triggered trapped `FocusScope` (`ParentPicker`), the gap that let
 *      a second trapped scope mount alongside the detail panel's.
 *
 * Reuses `keyboard-nav.test.tsx`'s `invokeCommand` mock shape and `QueryClientProvider` setup
 * rather than inventing a second harness. `BoardView`, `FilterBar` and `CommandPalette` are
 * rendered together so the search field and the palette are both mounted; `switch-project` and
 * `register-project` are owned by `App.tsx`'s `AppShell` (not rendered here), so two small probes
 * below re-register the exact same two-line handlers `AppShell` uses, over `useGlobalBindings`
 * itself — this is what proves the shared guard, not a per-consumer one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { CommandPalette } from "../CommandPalette";
import { FilterBar } from "../FilterBar";
import { useRegisterProjectFlow } from "../../projects/RegisterProjectFlow";
import {
  bindingAllowedInLayer,
  topLayer,
  useGlobalBindings,
  type LayerState,
  type UiLayer,
} from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { BandCounts, BoardItem, IssueItem, Project } from "../useBoardQuery";

const invokeCommandMock = vi.fn();
const openFolderDialogMock = vi.fn(() => Promise.resolve<string | null>(null));

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => openFolderDialogMock(),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const ITEMS: BoardItem[] = [
  { id: "1", key: "FLY-1", title: "First task", status: "backlog", rank: "10", priority: 0, epicId: null },
  { id: "2", key: "FLY-2", title: "Second task", status: "backlog", rank: "20", priority: 0, epicId: null },
];

// CR-02 instance (see the file doc comment's item 7): an unparented issue whose "No parent"
// button in `IssuesLane` renders in the same board pane as the item rack — not covered by the
// item detail panel's 480px width — so it must be reachable-but-refused while the panel is open,
// not silently unreachable (a click that does nothing would be indistinguishable from a bug that
// swallows the click for the wrong reason).
const ISSUES: IssueItem[] = [
  { id: "issue-1", key: "FLY-3", title: "An unparented issue", kind: "idea", epicId: null, taskId: null },
];

// Two projects so the ⌘1 assertion has something real to switch to.
const PROJECTS: Project[] = [
  { id: "proj-1", keyPrefix: "FLY", name: "Flywheel", repoPath: "/repo/flywheel", defaultBranch: "main", status: "active" },
  { id: "proj-2", keyPrefix: "ORC", name: "Orca", repoPath: "/repo/orca", defaultBranch: "main", status: "active" },
];

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve(PROJECTS);
    if (command === "board_list") {
      return Promise.resolve({ items: ITEMS, issues: [], counts: { ...EMPTY_COUNTS, backlog: ITEMS.length } });
    }
    if (command === "criterion_list") return Promise.resolve([]);
    if (command === "events_activity_trail") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
  openFolderDialogMock.mockReset();
  openFolderDialogMock.mockResolvedValue(null);
});

afterEach(() => {
  resetUiState();
});

/** Mirrors `App.tsx`'s `AppShell` registration for `switch-project` — that binding is owned by
 * `AppShell`, which this lighter harness deliberately does not render (the plan's own read_first:
 * "render BoardView, FilterBar and CommandPalette together"). Re-registering the same two-line
 * handler over the exported `useGlobalBindings` hook is what proves the SHARED guard blocks it,
 * rather than merely proving no consumer happens to be listening. */
function ProjectSwitcherProbe() {
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  useGlobalBindings({
    "switch-project": (binding) => {
      const project = PROJECTS[binding.projectIndex ?? -1];
      if (project) setCurrentProjectId(project.id);
    },
  });
  return null;
}

/** Same reasoning as `ProjectSwitcherProbe` above, for `register-project` — reuses the SAME
 * shared `useRegisterProjectFlow` hook `App.tsx`/`CommandPalette.tsx` call, never a re-derived
 * copy. */
function RegisterProjectProbe() {
  const { registerProjectFlow } = useRegisterProjectFlow();
  useGlobalBindings({
    "register-project": () => {
      void registerProjectFlow();
    },
  });
  return null;
}

function renderHarness(items: BoardItem[] = ITEMS, issues: IssueItem[] = []) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <FilterBar items={items} isFetching={false} />
      <BoardView
        projectId="proj-1"
        items={items}
        issues={issues}
        counts={{ ...EMPTY_COUNTS, backlog: items.length }}
        onCreateTask={() => {}}
      />
      <CommandPalette />
      <ProjectSwitcherProbe />
      <RegisterProjectProbe />
    </QueryClientProvider>,
  );
}

/** Opens the item detail panel the way the plan directs: driving the store directly (Task 1's
 * fields), never simulating the keystroke that opens it — this file is about what happens once
 * the panel IS open, not about how it got there. Sets both `selectedItemId` and `detailItemId`
 * since `BoardView`'s panel renders off the SELECTED item, not off `detailItemId` alone. */
function openDetailPanel(id: string) {
  act(() => {
    useUiStore.getState().setSelectedItemId(id);
    useUiStore.getState().setDetailItemId(id);
  });
}

describe("layer-guard", () => {
  it("cmd_n_and_cmd_shift_n_do_not_open_quick_add_over_the_detail_panel", () => {
    renderHarness();
    openDetailPanel("1");

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(useUiStore.getState().quickAddOpen).toBe(false);
    expect(screen.queryByPlaceholderText("Type a title, press Enter to create…")).not.toBeInTheDocument();

    fireEvent.keyDown(window, { key: "n", metaKey: true, shiftKey: true });
    expect(useUiStore.getState().quickAddOpen).toBe(false);
    expect(screen.queryByPlaceholderText("Type an epic title, press Enter to create…")).not.toBeInTheDocument();
  });

  it("cmd_f_and_bare_slash_do_not_steal_focus_from_the_detail_panel", () => {
    renderHarness();
    openDetailPanel("1");
    const activeBefore = document.activeElement;

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(activeBefore);

    fireEvent.keyDown(window, { key: "/" });
    expect(document.activeElement).toBe(activeBefore);
  });

  it("cmd_1_does_not_switch_project_over_the_detail_panel", () => {
    renderHarness();
    openDetailPanel("1");

    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(useUiStore.getState().currentProjectId).toBeNull();
  });

  it("cmd_shift_o_does_not_open_the_folder_dialog_over_the_detail_panel", () => {
    renderHarness();
    openDetailPanel("1");

    fireEvent.keyDown(window, { key: "o", metaKey: true, shiftKey: true });
    expect(openFolderDialogMock).not.toHaveBeenCalled();
  });

  it("clicking_the_issue_lane_parent_button_does_not_open_a_second_trapped_scope_over_the_detail_panel", () => {
    // CR-02 regression (01-REVIEW.md): a POINTER path, not a keystroke — every other test in this
    // file drives the guard via `fireEvent.keyDown`. `IssuesLane`'s "No parent" button used to
    // reach `setActivePicker` through a raw `onClick` that never consulted `topLayer`/
    // `bindingAllowedInLayer`, so it could mount `ParentPicker`'s trapped `FocusScope` while the
    // detail panel's own trapped scope was still open — exactly the "two trapped scopes at once"
    // class G-01-FOCUS closed for every keyboard path.
    renderHarness(ITEMS, ISSUES);
    openDetailPanel("1");

    const issueRow = screen.getByRole("listitem", { name: /^FLY-3, / });
    fireEvent.click(within(issueRow).getByRole("button", { name: /No parent/ }));

    expect(useUiStore.getState().activePicker).toBeNull();
    expect(screen.queryByRole("menu", { name: "Set parent" })).not.toBeInTheDocument();
    // The panel itself is undisturbed by the refused click.
    expect(useUiStore.getState().detailItemId).toBe("1");
  });

  it("clicking_the_issue_lane_parent_button_still_opens_the_picker_with_nothing_else_open", async () => {
    // The positive case, proving the guard refuses only when a higher layer is on top — not
    // unconditionally, which would be indistinguishable from breaking the feature outright.
    renderHarness(ITEMS, ISSUES);

    const issueRow = screen.getByRole("listitem", { name: /^FLY-3, / });
    fireEvent.click(within(issueRow).getByRole("button", { name: /No parent/ }));

    expect(useUiStore.getState().activePicker).toEqual({ kind: "issue-parent", id: "issue-1" });
    expect(await screen.findByRole("menu", { name: "Set parent" })).toBeInTheDocument();
  });

  it("cmd_k_still_opens_the_palette_over_the_detail_panel_with_focus_in_its_own_input", async () => {
    renderHarness();
    openDetailPanel("1");

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(useUiStore.getState().paletteOpen).toBe(true);
    // The panel stays open BEHIND the palette — it is not closed to make room for it.
    expect(useUiStore.getState().detailItemId).toBe("1");
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
    const searchInput = screen.getByRole("textbox", { name: "Command search" });
    expect(document.activeElement).toBe(searchInput);
  });

  it("cmd_k_does_not_open_the_palette_over_a_row_level_picker", () => {
    renderHarness();
    act(() => {
      useUiStore.getState().setActivePicker({ kind: "status", id: "1" });
    });

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
  });

  it("with_nothing_open_every_global_binding_still_fires", async () => {
    renderHarness();

    fireEvent.keyDown(window, { key: "n", metaKey: true });
    expect(await screen.findByPlaceholderText("Type a title, press Enter to create…")).toBeInTheDocument();
    expect(useUiStore.getState().quickAddOpen).toBe(true);

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Search items" }));

    fireEvent.keyDown(window, { key: "1", metaKey: true });
    expect(useUiStore.getState().currentProjectId).toBe(PROJECTS[0].id);
  });

  it("running_create_task_from_the_palette_closes_the_detail_panel_and_opens_quick_add", async () => {
    renderHarness();
    openDetailPanel("1");
    act(() => {
      useUiStore.getState().setPaletteOpen(true);
    });

    // The option's accessible name concatenates its label AND its group span
    // ("Create Task" + "Create") with no separator — `palette.test.tsx`'s own
    // `palette_covers_every_binding` test hits the same thing and matches with `startsWith`, so
    // an anchored regex is used here instead of an exact string.
    const option = await screen.findByRole("option", { name: /^Create Task/ });
    fireEvent.click(option);

    // The region-changing command is not silently dropped by the new guard: it returns to the
    // board layer first (`closeToBoard`/`returnToBoardLayer`), THEN the synthesized `⌘N`
    // reaches the window listener as an admitted "board"-layer keystroke.
    expect(useUiStore.getState().paletteOpen).toBe(false);
    expect(useUiStore.getState().detailItemId).toBeNull();
    expect(useUiStore.getState().quickAddOpen).toBe(true);
    expect(useUiStore.getState().quickAddKind).toBe("task");
  });

  describe("the pure layer model", () => {
    const CLOSED: LayerState = { paletteOpen: false, detailOpen: false, pickerOpen: false, quickAddOpen: false };

    it("topLayer_returns_the_fixed_precedence_order", () => {
      expect(topLayer(CLOSED)).toBe("board");
      expect(topLayer({ ...CLOSED, quickAddOpen: true })).toBe("quick-add");
      expect(topLayer({ ...CLOSED, quickAddOpen: true, detailOpen: true })).toBe("detail");
      expect(topLayer({ ...CLOSED, detailOpen: true, pickerOpen: true })).toBe("picker");
      expect(topLayer({ ...CLOSED, pickerOpen: true, paletteOpen: true })).toBe("palette");
    });

    it("bindingAllowedInLayer_admits_open_palette_everywhere_except_picker_and_palette_and_refuses_every_other_action_outside_board_and_quick_add", () => {
      const layers: UiLayer[] = ["board", "quick-add", "detail", "picker", "palette"];
      for (const layer of layers) {
        expect(bindingAllowedInLayer("open-palette", layer)).toBe(layer !== "picker" && layer !== "palette");
      }
      for (const layer of layers) {
        const expectedElsewhere = layer === "board" || layer === "quick-add";
        expect(bindingAllowedInLayer("focus-search", layer)).toBe(expectedElsewhere);
        expect(bindingAllowedInLayer("move-down", layer)).toBe(expectedElsewhere);
        expect(bindingAllowedInLayer("switch-project", layer)).toBe(expectedElsewhere);
      }
    });
  });
});
