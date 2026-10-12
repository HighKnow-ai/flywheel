/**
 * Local UI state — the free-text search term, the in-progress filter selection, and the
 * currently selected item id. Held in Zustand, kept entirely separate from TanStack Query's
 * server-state cache (`board/useBoardQuery.ts`) — letting the two blur is what makes an eventual
 * web port painful, and the adapter seam only pays off if the split stays clean
 * (01-08-PLAN.md, `.claude/CLAUDE.md`'s stack guidance).
 *
 * Band-collapse state is NOT duplicated here — it already has its own home in
 * `board/collapseStore.ts` (01-04), which this module does not touch or re-export.
 *
 * The filter/search state here is a *draft*: nothing in this file ever calls the Tauri command
 * surface. `useBoardQuery.ts`'s `toFilterInput` translates a `BoardFilterDraft` into the shape
 * `board_list`/`board_search` accept, and the debounce that turns a raw keystroke into a query
 * lives there too (at the query boundary, not here — 01-UI-SPEC.md "Performance Contract").
 */
import { create } from "zustand";
// Type-only — erased at compile time, so this does not create a runtime circular dependency even
// though `board/useBoardQuery.ts` itself imports `BoardFilterDraft` from this module.
import type { BoardItemKind } from "../board/useBoardQuery";
import type { RunStatus } from "../legend/runStatus";

/**
 * The in-progress filter selection (BOARD-06): every field is an empty array when that dimension
 * is unfiltered — the same "empty means unfiltered" convention `core::query::filter::BoardFilter`
 * uses on the Rust side, so `toFilterInput` in `useBoardQuery.ts` is a direct, lossless
 * translation rather than a second filter model with its own edge cases.
 *
 * `epicIds`/`assigneeIds` carry `null` as an explicit member meaning "No epic"/"Unassigned" —
 * never a bare absence a caller has to infer.
 */
export interface BoardFilterDraft {
  statuses: string[];
  epicIds: (string | null)[];
  assigneeIds: (string | null)[];
  priorities: number[];
  estimates: number[];
  /** D-17: only items with an active worktree (epics: any child task has one, amendment A-04).
   * `false` is "this dimension is unfiltered" — there is no "only without a worktree" reading. */
  hasWorktree: boolean;
}

export const EMPTY_FILTER_DRAFT: BoardFilterDraft = {
  statuses: [],
  epicIds: [],
  assigneeIds: [],
  priorities: [],
  estimates: [],
  hasWorktree: false,
};

/** True when at least one filter dimension carries a value — the renderer's own signal for which
 * of the two empty-window states to show (01-UI-SPEC.md "State Inventory": "distinct copy...
 * clarifies filters are active"). Search alone (no filter chip) also counts as "filters active"
 * from the caller's perspective — see `Board`'s own combination of this with the search term. */
export function isFilterDraftActive(filter: BoardFilterDraft): boolean {
  return (
    filter.statuses.length > 0 ||
    filter.epicIds.length > 0 ||
    filter.assigneeIds.length > 0 ||
    filter.priorities.length > 0 ||
    filter.estimates.length > 0 ||
    filter.hasWorktree
  );
}

function toggleValue<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

/** Which row-level picker is open, if any (moved from `board/BoardView.tsx` — this plan's Task 1
 * folds the whole layer stack into this module so one place can answer "what layer is on top,"
 * per `state/keyboard.ts`'s layer model). One piece of state covers all four (status, priority,
 * estimate, assignee) rather than four parallel fields — they share the same
 * open/anchor/close shape. */
export type PickerKind = "status" | "priority" | "estimate" | "assignee" | "epic" | "issue-parent";

/** The in-flight Done-transition warning (D-08): moving an item to Done with unchecked criteria
 * warns but never blocks. The pending change is held here rather than applied optimistically —
 * `DoneWarning`'s Escape "reverts the status change" by the mutation simply never having been
 * sent (01-UI-SPEC.md State Inventory). Moved from `board/BoardView.tsx`'s inline `useState`
 * generic for the same cross-tree reasoning `PickerKind` moved for: `state/keyboard.ts`'s layer
 * model needs to see it from outside `BoardView`'s own tree. */
export interface PendingDone {
  kind: BoardItemKind;
  id: string;
  status: string;
  checked: number;
  total: number;
  /** The item's key, so the warning names the task it is about. */
  key?: string;
  /** The row's viewport rectangle when the request was raised, so the warning opens under it. */
  anchorRect?: { top: number; left: number; bottom: number };
}

/** What the fleet surface (Phase 10, D-163) is showing: the banded fleet list, or (plan 10-05) the
 * blocked queue. One field, one surface, two views; `null` means the fleet is closed. */
export interface FleetSurfaceTarget {
  view: "fleet" | "queue";
}

/** What the review surface is open for: a task or an epic, plus its key and title for the header. */
export interface ReviewSurfaceTarget {
  scope: "task" | "epic";
  itemId: string;
  label: string;
  /** Set when an epic review was reached from a task's review (the scope toggle), so toggling back
   * returns to that same task. Absent when the surface was opened on the epic directly. */
  fromTask?: { itemId: string; label: string };
}

/** The board's grouping key (D-07, amendment A-02): the one rack groups its rows by epic (the
 * home surface, A-01) or by status (the five bands, the "everything in review" sweep). A lens over
 * one board — not a second surface. It has no keybinding (A-02 grants none). */
export type GroupingKey = "epic" | "status";

interface UiState {
  groupingKey: GroupingKey;
  setGroupingKey: (key: GroupingKey) => void;
  searchTerm: string;
  filterDraft: BoardFilterDraft;
  selectedItemId: string | null;
  /**
   * Whether the command palette overlay is open (01-09-PLAN.md, `board/CommandPalette.tsx`) —
   * lives here, not as `CommandPalette`-local state, because the Escape ladder in
   * `BoardView.tsx` (`state/keyboard.ts`'s `nextEscapeLayer`) must be able to read it even though
   * `CommandPalette` is mounted at the app-shell level, outside `BoardView`'s own tree.
   */
  paletteOpen: boolean;
  /** The currently viewed project (01-UI-SPEC.md "Project switcher", `⌘1`-`⌘9`) — `null` means
   * "no explicit choice yet," in which case `AppShell` falls back to the first registered
   * project, exactly as it did before this field existed. */
  currentProjectId: string | null;
  /** The item detail panel's open item, if any (Escape ladder step 2). Held here rather than as
   * `BoardView`-local state so `CommandPalette.tsx`'s "Open selected item" command (generated
   * from the board-list binding table, 01-09-PLAN.md Task 2) can drive it from outside
   * `BoardView`'s own tree, exactly like `selectedItemId`. */
  detailItemId: string | null;
  /** The pending destructive-delete target, if any (⌘⌫, threat T-01-25) — same cross-tree
   * reasoning as `detailItemId`: `CommandPalette.tsx`'s "Delete" hot action sets this too. */
  deleteTarget: { kind: BoardItemKind; id: string; key: string; title: string } | null;
  /** The currently open row-level picker, if any (moved from `BoardView`-local state — this
   * plan's Task 1). Lives here for the same cross-tree reasoning as `detailItemId` above, and so
   * `state/keyboard.ts`'s layer model can read it without an import cycle back into
   * `board/BoardView.tsx`. */
  activePicker: { kind: PickerKind; id: string } | null;
  /** Whether quick-add is open (moved from `BoardView`-local state — 01-UI-SPEC.md "Quick-add"
   * is on-demand: `c`/`⌘N` opens it, or the project has zero items). */
  quickAddOpen: boolean;
  /** Which kind quick-add is currently composing (moved from `BoardView`-local state). `⌘N`
   * opens it for a task, `⌘⇧N` for an epic; both funnel through `openQuickAdd` below so this pair
   * keeps a single writer. */
  quickAddKind: BoardItemKind;
  /** The in-flight Done-transition warning, if any (D-08; moved from `BoardView`-local state). */
  pendingDone: PendingDone | null;
  /**
   * A one-shot request that quick-add's own focus effect (`board/QuickAdd.tsx`) consumes
   * (G-01-4, 01-19-PLAN.md Task 1). This is what lets a row the virtualizer mounts *late* —
   * because the board was scrolled past it, or its band was collapsed — still receive the
   * cursor, and what makes pressing ⌘N a second time re-deliver focus even though `quickAddOpen`
   * is already `true` (an effect keyed only on `quickAddOpen` would not re-fire on that second
   * press, since there is no state change to re-run it). Set by `openQuickAdd` below, cleared by
   * `setQuickAddOpen(false)` and by whichever component actually moves the cursor — exactly one
   * consumer clears it per raise, so the request is honoured once and never twice.
   */
  quickAddFocusPending: boolean;
  /** The agent run id currently occupying the session surface (D-31, plan 02-01), or `null` when
   * the board is showing. Lives here — not as `App.tsx`-local state — for the same cross-tree
   * reasoning `detailItemId` documents: `ItemDetailPanel.tsx`'s "Start Work" affordance is mounted
   * deep inside `BoardView`'s tree, but the session surface it routes to replaces the whole
   * board/detail layout at the `AppShell` level. */
  activeAgentRunId: string | null;
  /** The task id `activeAgentRunId` belongs to (plan 04-13, D-66/D-67) — set together with
   * `activeAgentRunId` at every call site that opens the live session surface, each of which
   * already has the task id in scope (the launch sheet's own `taskId` prop, `RunsSection.tsx`'s
   * task-scoped `taskId` prop, `openLiveSessionForTask`'s own parameter). Exists so the session
   * surface's Discard verb can hand off to the launch sheet for the SAME task without adding a
   * new backend read — the session surface itself has no other source for this id. */
  activeAgentRunTaskId: string | null;
  /** `activeAgentRunId`'s own `authoringStage` (D-88, plan 05-02), or `null` for an ordinary
   * task-execution run — set together with `activeAgentRunId`/`activeAgentRunTaskId` at the one
   * call site that opens an authoring session (`BoardView.tsx`'s `shape-epic` handler). This is
   * what `SessionSurface.tsx` reads to decide whether to mount `ProposalTray` at all: the tray has
   * no other source for "is this run an authoring session." */
  activeAgentRunAuthoringStage: string | null;
  /** `activeAgentRunId`'s own `epicId` (D-84, plan 05-09) — `null` for an ordinary task-execution
   * run AND for a fresh-epic authoring run (SHAPE-01's own case), `Some` only for an authoring run
   * reopening an existing epic (SHAPE-05). Set together with `activeAgentRunId`/
   * `activeAgentRunAuthoringStage`. Exists for the same reason `activeAgentRunTaskId` does: the
   * Discard hand-off needs the epic id to prime a fresh authoring launch for the SAME epic, and
   * the session surface has no other source for it. */
  activeAgentRunEpicId: string | null;
  /** A one-shot initial position for the session feed (D-99, plan 06-08) — `null` for every
   * pre-existing call site (the default, unchanged behaviour: the feed opens at its tail exactly
   * as before). Set together with `activeAgentRunId` only by the triage surface's turn-pointer
   * jump (`App.tsx`'s `TriageSurface` `onOpenSession`), which is the one caller that has a
   * recorded log offset to open at rather than "whatever the tail currently is". */
  activeAgentRunInitialLogOffset: number | null;
  /** The status the opener already knows for `activeAgentRunId` (Phase 10 plan 10-06, Pitfall 7), or
   * `null` for every caller that does not — the session then falls back to its running default. Set
   * only by the fleet, whose row is already showing the run's real status; without it a terminal run
   * reads "Running" until something else re-reads it, which nothing does. */
  activeAgentRunInitialStatus: RunStatus | null;
  /** The task id the launch sheet (D-27, plan 02-04) is currently open for, or `null` when it is
   * closed. Lives here for the same cross-tree reasoning as `activeAgentRunId`: the sheet is
   * mounted once at the `App.tsx` level (a peer of `CommandPalette`, per its own "briefing gate
   * before anything is spawned" role), but it is triggered from `ItemDetailPanel.tsx`'s "Start
   * Work" affordance (deep inside `BoardView`'s tree) and from the board-list `start-work` action
   * id (`w`) — neither of which imports the sheet component itself. */
  launchSheetTaskId: string | null;
  /** The epic whose wave plan sheet (plan 09-09) is open, or `null` when it is closed. Mounted once at
   * the `App.tsx` level like the launch sheet; opened from the epic row's dispatch controls, which sit
   * deep in `BoardView`'s tree and do not import the sheet. */
  wavePlanSheetEpicId: string | null;
  /** D-66's authoring hand-off (plan 05-09): the epic id a Discard on an authoring run wants a
   * fresh authoring launch primed for, or `null` (not `undefined`) to distinguish "not pending" —
   * an object rather than a bare `string | null` field because a fresh-epic authoring run's own
   * epic id IS `null`, so a bare field could not tell "no hand-off pending" from "hand-off pending
   * for a new epic" apart. Mirrors `launchSheetTaskId`'s own cross-tree reasoning: no authoring
   * launch surface consumes this yet (Discretion item, `05-CONTEXT.md`), but the channel exists so
   * a future one has somewhere to read the hand-off from without a second backend round trip. */
  launchSheetAuthoringHandoff: { epicId: string | null } | null;
  /** Whether the Settings surface (D-39, plan 02-10) is currently open — same cross-tree
   * reasoning as `activeAgentRunId`/`launchSheetTaskId`: the surface is mounted once at the
   * `App.tsx` level (a peer of the board/session surface, replacing the same content area), but
   * opened from the native menu bridge, the global `⌘,` binding, and the command palette, none of
   * which import the surface component itself. */
  settingsOpen: boolean;
  /** The project the dedicated triage surface (D-103, plan 06-08) is currently open for, or
   * `null` when it is closed. Lives here for the same cross-tree reasoning `activeAgentRunId`/
   * `launchSheetTaskId`/`settingsOpen` document: the surface is mounted once at the `App.tsx`
   * level, a peer of the session surface, but it is opened from `board/TriageLane.tsx`'s header
   * (deep inside `BoardView`'s tree), which does not import the surface component itself. */
  triageSurfaceProjectId: string | null;
  /** The item the review surface (Phase 8 plan 08-01) is open for, or `null` when closed — same
   * cross-tree reasoning as the triage field above: mounted once in `App.tsx`, opened from the
   * item detail panel's Review button. `label` is the item's key and title for the surface header. */
  reviewSurface: ReviewSurfaceTarget | null;
  /** Whether the fleet surface (Phase 10, D-163) is open, and which view — same cross-tree
   * reasoning as the fields above: mounted once in `App.tsx`, opened from the project rail's Fleet
   * row, the global `open-fleet` binding, the palette and the native menu, none of which import the
   * surface. `null` when closed. */
  fleetSurface: FleetSurfaceTarget | null;
  setSearchTerm: (term: string) => void;
  toggleStatus: (status: string) => void;
  toggleEpic: (epicId: string | null) => void;
  toggleAssignee: (assigneeId: string | null) => void;
  togglePriority: (priority: number) => void;
  toggleEstimate: (estimate: number) => void;
  toggleHasWorktree: () => void;
  clearFilters: () => void;
  setSelectedItemId: (id: string | null) => void;
  setPaletteOpen: (open: boolean) => void;
  setCurrentProjectId: (id: string | null) => void;
  setDetailItemId: (id: string | null) => void;
  setDeleteTarget: (target: UiState["deleteTarget"]) => void;
  setActivePicker: (picker: UiState["activePicker"]) => void;
  setQuickAddOpen: (open: boolean) => void;
  setQuickAddKind: (kind: BoardItemKind) => void;
  /** Sets `quickAddKind` and `quickAddOpen` together in one `set` call — `BoardView.tsx`'s own
   * `openQuickAdd` helper becomes a call to this so "which kind am I creating" keeps a single
   * writer even now that two fields are involved. */
  openQuickAdd: (kind: BoardItemKind) => void;
  setPendingDone: (pending: PendingDone | null) => void;
  /** Clears `quickAddFocusPending`. Exactly one consumer calls this per raise — the component
   * that actually moved the cursor (`board/QuickAdd.tsx`'s focus effect) — so a request is
   * honoured once and never twice (G-01-4). */
  clearQuickAddFocusPending: () => void;
  /** Sets `activeAgentRunId` and `activeAgentRunTaskId` together in one `set` call (plan 04-13) —
   * mirrors `openQuickAdd`'s own "N related fields, one writer" shape. `taskId` defaults to
   * `null` so every pre-existing call site (none of which needs to change) keeps working exactly
   * as before. */
  setActiveAgentRunId: (
    agentRunId: string | null,
    taskId?: string | null,
    authoringStage?: string | null,
    epicId?: string | null,
    initialLogOffset?: number | null,
    initialStatus?: RunStatus | null,
  ) => void;
  setLaunchSheetTaskId: (taskId: string | null) => void;
  setWavePlanSheetEpicId: (epicId: string | null) => void;
  /** Opens the authoring hand-off channel for `epicId` (`null` for a fresh epic) — the Discard
   * verb's own call, mirroring `setLaunchSheetTaskId`'s shape. */
  setLaunchSheetAuthoringHandoff: (epicId: string | null) => void;
  /** Clears the authoring hand-off channel — the future authoring launch surface's own consume
   * call, mirroring `setLaunchSheetTaskId(null)`'s "closed" convention. */
  clearLaunchSheetAuthoringHandoff: () => void;
  setSettingsOpen: (open: boolean) => void;
  /** Opens/closes the dedicated triage surface for `projectId` (`null` to close) — the route
   * control's own call, mirroring `setLaunchSheetTaskId`'s "one field, one writer" shape. */
  setTriageSurfaceProjectId: (projectId: string | null) => void;
  /** Opens/closes the review surface (`null` to close). */
  setReviewSurface: (target: ReviewSurfaceTarget | null) => void;
  /** Opens/closes the fleet surface (`null` to close). */
  setFleetSurface: (target: FleetSurfaceTarget | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  searchTerm: "",
  filterDraft: EMPTY_FILTER_DRAFT,
  selectedItemId: null,
  paletteOpen: false,
  currentProjectId: null,
  detailItemId: null,
  deleteTarget: null,
  activePicker: null,
  quickAddOpen: false,
  groupingKey: "epic",
  setGroupingKey: (key) => set({ groupingKey: key }),
  quickAddKind: "task",
  pendingDone: null,
  quickAddFocusPending: false,
  activeAgentRunId: null,
  activeAgentRunTaskId: null,
  activeAgentRunAuthoringStage: null,
  activeAgentRunEpicId: null,
  activeAgentRunInitialLogOffset: null,
  activeAgentRunInitialStatus: null,
  launchSheetTaskId: null,
  wavePlanSheetEpicId: null,
  launchSheetAuthoringHandoff: null,
  settingsOpen: false,
  triageSurfaceProjectId: null,
  reviewSurface: null,
  fleetSurface: null,

  setSearchTerm: (term) => set({ searchTerm: term }),

  toggleStatus: (status) =>
    set((state) => ({
      filterDraft: { ...state.filterDraft, statuses: toggleValue(state.filterDraft.statuses, status) },
    })),

  toggleEpic: (epicId) =>
    set((state) => ({
      filterDraft: { ...state.filterDraft, epicIds: toggleValue(state.filterDraft.epicIds, epicId) },
    })),

  toggleAssignee: (assigneeId) =>
    set((state) => ({
      filterDraft: {
        ...state.filterDraft,
        assigneeIds: toggleValue(state.filterDraft.assigneeIds, assigneeId),
      },
    })),

  togglePriority: (priority) =>
    set((state) => ({
      filterDraft: {
        ...state.filterDraft,
        priorities: toggleValue(state.filterDraft.priorities, priority),
      },
    })),

  toggleEstimate: (estimate) =>
    set((state) => ({
      filterDraft: {
        ...state.filterDraft,
        estimates: toggleValue(state.filterDraft.estimates, estimate),
      },
    })),

  toggleHasWorktree: () =>
    set((state) => ({
      filterDraft: { ...state.filterDraft, hasWorktree: !state.filterDraft.hasWorktree },
    })),

  // Clears the search term too — "Clear Filters" (Copywriting Contract) is the one recovery
  // action offered from the empty-filter-result state, and a lingering search term with no
  // filter chips would still leave the board looking "stuck" after the user asks to clear it.
  clearFilters: () => set({ filterDraft: EMPTY_FILTER_DRAFT, searchTerm: "" }),

  setSelectedItemId: (id) => set({ selectedItemId: id }),
  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setCurrentProjectId: (id) => set({ currentProjectId: id }),
  setDetailItemId: (id) => set({ detailItemId: id }),
  setDeleteTarget: (target) => set({ deleteTarget: target }),
  setActivePicker: (picker) => set({ activePicker: picker }),
  // Closing quick-add also clears any outstanding focus request (G-01-4) — an Escape that closes
  // the row while a request is still unconsumed must not leave a stale request that a later,
  // unrelated mount would pick up.
  setQuickAddOpen: (open) =>
    set(open ? { quickAddOpen: open } : { quickAddOpen: open, quickAddFocusPending: false }),
  setQuickAddKind: (kind) => set({ quickAddKind: kind }),
  // Sets `quickAddKind`, `quickAddOpen` AND `quickAddFocusPending` together in one `set` call —
  // preserves this function's existing single-writer property now that a third field is
  // involved (G-01-4, 01-19-PLAN.md Task 1).
  openQuickAdd: (kind) => set({ quickAddKind: kind, quickAddOpen: true, quickAddFocusPending: true }),
  setPendingDone: (pending) => set({ pendingDone: pending }),
  clearQuickAddFocusPending: () => set({ quickAddFocusPending: false }),
  setActiveAgentRunId: (
    agentRunId,
    taskId = null,
    authoringStage = null,
    epicId = null,
    initialLogOffset = null,
    initialStatus = null,
  ) =>
    set({
      activeAgentRunId: agentRunId,
      activeAgentRunTaskId: taskId,
      activeAgentRunAuthoringStage: authoringStage,
      activeAgentRunEpicId: epicId,
      activeAgentRunInitialLogOffset: initialLogOffset,
      activeAgentRunInitialStatus: initialStatus,
    }),
  setLaunchSheetTaskId: (taskId) => set({ launchSheetTaskId: taskId }),
  setWavePlanSheetEpicId: (epicId) => set({ wavePlanSheetEpicId: epicId }),
  setLaunchSheetAuthoringHandoff: (epicId) => set({ launchSheetAuthoringHandoff: { epicId } }),
  clearLaunchSheetAuthoringHandoff: () => set({ launchSheetAuthoringHandoff: null }),
  setSettingsOpen: (open) => set({ settingsOpen: open }),
  setTriageSurfaceProjectId: (projectId) => set({ triageSurfaceProjectId: projectId }),
  setReviewSurface: (target) => set({ reviewSurface: target }),
  setFleetSurface: (target) => set({ fleetSurface: target }),
}));

/** Resets every UI field back to its initial value — the shared reset four test suites
 * (`board/__tests__/keyboard-nav.test.tsx`, `board/__tests__/palette.test.tsx`,
 * `board/__tests__/filter.test.tsx`, `projects/__tests__/project-rail.test.tsx`) previously
 * hand-wrote their own copy of. Zustand's `set`/`setState` merges rather than replaces, so any
 * field a hand-written reset forgot silently leaked between tests — exporting the reset here
 * removes that whole class of drift (this plan's Task 1/Task 3). */
export function resetUiState() {
  useUiStore.setState({
    groupingKey: "epic",
    searchTerm: "",
    filterDraft: EMPTY_FILTER_DRAFT,
    selectedItemId: null,
    paletteOpen: false,
    currentProjectId: null,
    detailItemId: null,
    deleteTarget: null,
    activePicker: null,
    quickAddOpen: false,
    quickAddKind: "task",
    pendingDone: null,
    quickAddFocusPending: false,
    activeAgentRunId: null,
    activeAgentRunTaskId: null,
    activeAgentRunAuthoringStage: null,
    activeAgentRunEpicId: null,
    activeAgentRunInitialLogOffset: null,
    activeAgentRunInitialStatus: null,
    launchSheetTaskId: null,
    wavePlanSheetEpicId: null,
    launchSheetAuthoringHandoff: null,
    settingsOpen: false,
    triageSurfaceProjectId: null,
    reviewSurface: null,
    fleetSurface: null,
  });
}
