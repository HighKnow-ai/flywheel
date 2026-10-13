/**
 * The virtualized rack: fixed-height strips grouped into the five fixed status bands
 * (01-UI-SPEC.md "Board list", "Selected Direction"). Never horizontal columns — one vertical
 * rack, grouped into bands, sticky stamped band headers carrying their counts, with the
 * workflow-less Issues lane rendered beneath them (D-07).
 *
 * Virtualization uses an O(1) `estimateSize` lookup on row kind (`ROW_HEIGHT_BY_KIND`, 08.1
 * amendment A-03) — no `measureElement`, no per-row measurement — and overscan 8-12 rows
 * (01-UI-SPEC.md "Performance Contract", restated in 08.1-UI-SPEC.md).
 *
 * Owns roving-focus keyboard selection over the list (01-UI-SPEC.md "Keyboard Map" — `j`/`k`,
 * Home/End, Enter/`o` to open detail, `s` to open the status picker) and the item detail panel /
 * status picker overlays for the currently selected item.
 *
 * All of that keyboard dispatch reads through `state/keyboard.ts`'s `resolveBinding` — this file
 * contains no `event.key === '...'` switch of its own (01-09-PLAN.md Task 1). Selection is held as
 * the selected item's **id** in `state/uiStore.ts` (`selectedItemId`), never a row index, so it
 * survives a pushed delta reordering or shrinking the window (01-UI-SPEC.md "Focus & selection
 * model"). The Escape ladder (palette → detail panel → quick-add → clear selection,
 * `nextEscapeLayer`) is coordinated from the `useEffect` below, since it must be able to see
 * `state/uiStore.ts`'s `paletteOpen` even though `CommandPalette.tsx` mounts outside this tree.
 *
 * The whole layer stack — `activePicker`, `quickAddOpen`, `quickAddKind`, `pendingDone`, plus
 * `paletteOpen`/`detailItemId`/`deleteTarget` above — lives in `state/uiStore.ts`, not local
 * `useState`, so `state/keyboard.ts`'s layer model (`bindingAllowedInLayer`/`topLayer`) can see
 * the whole stack from outside this tree too (01-13-PLAN.md, G-01-FOCUS). This container's own
 * key handler (`handleContainerKeyDown` below) reads the same layer decision every global
 * binding does — no hand-rolled guard of its own.
 *
 * Quick-add's focus is delivered by a consume-once request (`quickAddFocusPending`,
 * `state/uiStore.ts`), not by mount-time `autoFocus`, because the row is virtualized and at
 * volume it is not mounted when the keystroke arrives (G-01-4, 01-19-PLAN.md). The scroll that
 * brings it into view is `virtualizer.scrollToIndex` — this file's first and only programmatic
 * scroll.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BoardRow, ROW_HEIGHT_BY_KIND, type RowKind } from "./BoardRow";
import { StatusBand } from "./StatusBand";
import { EpicHeaderRow, rollUpChangeFlags } from "./EpicHeaderRow";
import { ChallengeRow } from "./ChallengeRow";
import { summaryLine } from "./summaryLine";
import { IssuesLane } from "./IssuesLane";
import { TriageLane } from "./TriageLane";
import { useProjectProposals } from "../authoring/useAuthoringQuery";
import { QuickAdd } from "./QuickAdd";
import { DoneWarning } from "./DoneWarning";
import { DeleteConfirm } from "./DeleteConfirm";
import { StatusPicker } from "./pickers/StatusPicker";
import { PriorityPicker } from "./pickers/PriorityPicker";
import { EstimatePicker } from "./pickers/EstimatePicker";
import { AssigneePicker } from "./pickers/AssigneePicker";
import { ParentPicker, type ParentOption } from "./pickers/ParentPicker";
import { ItemDetailPanel, type DetailItem } from "../item-detail/ItemDetailPanel";
import { groupCollapseKey, useCollapseStore } from "./collapseStore";
import {
  bindingAllowedInLayer,
  boundarySelectionId,
  nextEscapeLayer,
  nextSelectionId,
  resolveBinding,
  topLayer,
  useGlobalBindings,
} from "../state/keyboard";
import { useUiStore, type PickerKind } from "../state/uiStore";
import {
  continueShapingEpic,
  epicHeaderTotal,
  epicRosterTruncationNotice,
  SEARCH_DEBOUNCE_MS,
  toFilterInput,
  useDebouncedValue,
  useEpicProgress,
  useFilteredEpics,
  useGroupItemsMany,
  openLiveSessionForTask,
  useActors,
  useBlockedSummary,
  useChangeFlags,
  useScopeFlags,
  useCreateEpic,
  useCreateIssue,
  useDeleteItem,
  useEpics,
  useForgeFlags,
  useRecoverySummary,
  useReorderItem,
  useSetAssignee,
  useSetEstimate,
  useSetIssueParent,
  useSetPriority,
  useSetStatus,
  useSetTaskEpic,
  useUpdateItem,
} from "./useBoardQuery";
import type { AuthoringProposalDto, EpicProgressDto } from "../adapters/tauri";
import type {
  Actor,
  BandCounts,
  BoardItem,
  BoardItemKind,
  EpicSummary,
  GroupBase,
  GroupScope,
  IssueItem,
} from "./useBoardQuery";

export const BAND_ORDER = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
type BandStatus = (typeof BAND_ORDER)[number];

const EMPTY_COLLAPSE: Record<string, boolean> = {};

const BAND_LABEL: Record<BandStatus, string> = {
  backlog: "Backlog",
  todo: "Todo",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
};

const BAND_COUNT_KEY: Record<BandStatus, keyof BandCounts> = {
  backlog: "backlog",
  todo: "todo",
  in_progress: "inProgress",
  in_review: "inReview",
  done: "done",
};

type RackRow =
  | { kind: "band-header"; status: BandStatus }
  /**
   * An epic (or, with `id: null`, the no-epic bucket) in the epic lens. `progress` is the
   * aggregate's. `item` is the epic's selection target, keyed by its id (the no-epic bucket has
   * none); it is built from the roster, so its status and priority are not known.
   */
  | {
      kind: "epic-header";
      id: string | null;
      epicKey?: string;
      title: string;
      progress: EpicProgressDto | undefined;
      /** The roster's own status and integration branch, for the header's sub-label. */
      status?: string;
      integrationBranch?: string | null;
      item?: BoardItem;
    }
  /** An open proposal on an expanded epic (D-08), read before the epic's tasks. */
  | { kind: "challenge"; proposal: AuthoringProposalDto; epicLabel: string }
  | { kind: "quick-add" }
  | { kind: "task"; item: BoardItem; posInSet: number; setSize: number | undefined };

/** The rows keyboard selection can land on: tasks, and epic headers that have a target. */
type SelectableRow = Extract<RackRow, { kind: "task" }> | (Extract<RackRow, { kind: "epic-header" }> & { item: BoardItem });

/** One group of the active lens: a status band or an epic, with where its rows come from. */
interface RackGroup {
  /** The status name, or the epic id (`null` for the no-epic bucket). */
  id: string | null;
  label: string;
  /** The header's count — from the list command's counts or the aggregate, never loaded rows. */
  count: number | undefined;
  /** Epic lens only: the roster's key and title, and the aggregate's figures for this epic. */
  epicKey?: string;
  title?: string;
  progress?: EpicProgressDto;
  status?: string;
  integrationBranch?: string | null;
  collapsed: boolean;
  scope: GroupScope;
  /** The row count its scoped fetch expects (see `useGroupItems`). */
  fetchTotal: number | undefined;
}

/** Mirrors the virtualizer's `overscan` below; exported so the volume fixture imports it. */
export const RACK_OVERSCAN = 10;

/**
 * The virtualizer's size function (D-13, A-03): an O(1) lookup on row kind. No DOM read, no
 * per-row measurement. The quick-add row is a text-entry row the height of a task.
 */
export function rackRowHeight(row: { kind: RowKind | "quick-add" }): number {
  return ROW_HEIGHT_BY_KIND[row.kind === "quick-add" ? "task" : row.kind];
}

/** This epic's aggregate. Once the aggregate has landed, an epic it omits has no tasks: a true zero. */
function progressFor(progress: EpicProgressDto[] | undefined, epicId: string | null): EpicProgressDto | undefined {
  if (!progress) return undefined;
  return (
    progress.find((p) => p.epicId === epicId) ?? {
      epicId,
      byStatus: [],
      total: 0,
      done: 0,
      agentsRunning: 0,
      agentsBlocked: 0,
      criteria: null,
    }
  );
}

/**
 * An epic header's selection target, built from the roster. Status comes from the board window when
 * the epic happens to be in it and is empty otherwise; priority and rank are not known, so the
 * pickers and reordering refuse a roster epic (see `openPickerFor`).
 */
function rosterEpicItem(id: string, key: string | undefined, title: string | undefined, window: BoardItem[]): BoardItem {
  return {
    id,
    kind: "epic",
    key: key ?? "",
    title: title ?? "",
    status: window.find((i) => i.id === id)?.status ?? "",
    rank: "",
    priority: 0,
    epicId: null,
  };
}

/**
 * A row's stable identity (RESEARCH Pattern 8): the virtualizer keys rows by this instead of by
 * index, so a row keeps its DOM node when a collapse shifts the rows around it. That is what lets
 * the rows below a collapse slide (the displacement transition) rather than swap content in place.
 */
const NO_KEYS: ReadonlyMap<string, number> = new Map();

function rackRowKey(row: RackRow): string {
  switch (row.kind) {
    case "band-header":
      return `band:${row.status}`;
    case "epic-header":
      return `epic:${row.id ?? "none"}`;
    case "challenge":
      return `challenge:${row.proposal.id}`;
    case "quick-add":
      return "quick-add";
    case "task":
      return `task:${row.item.id}`;
  }
}

/** `Epic`/`Task`/`Issue` — the exact wording `DeleteConfirm`'s heading (Copywriting Contract)
 * requires, derived from a `BoardItemKind` rather than hand-typed at each call site. */
function itemTypeLabel(kind: BoardItemKind): "Epic" | "Task" {
  return kind === "epic" ? "Epic" : "Task";
}

/** The centered overlay shown when the (possibly filtered/searched) window holds no epics, tasks
 * or issues at all (01-UI-SPEC.md "State Inventory" — the empty-project and empty-filter-result
 * states, distinguished by the caller via `EmptyStateContent`'s copy, never by this component).
 * `pointerEvents: "none"` on the wrapper (except the CTA button) keeps the band headers and
 * quick-add row underneath still interactive — the empty-project state's quick-add row stays
 * "already visible and focused" exactly as before this prop existed. */
export interface EmptyStateContent {
  heading: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
}

export interface BoardViewProps {
  projectId?: string;
  items: BoardItem[];
  issues?: IssueItem[];
  counts: BandCounts;
  /** `epicId` is `null` for every call site in this plan — plan 01-15's nested quick-add is what
   * ever supplies a non-null value, from the epic under which a task is created inline. */
  onCreateTask: (title: string, epicId: string | null) => void;
  /** `undefined` preserves this component's pre-01-08 behavior exactly (headers + quick-add
   * only, no overlay) — existing callers/tests that never pass this prop are unaffected. */
  emptyState?: EmptyStateContent;
  /** False while `items` is still the previous project's window kept on screen during a project switch
   * (`placeholderData: keepPreviousData`). A pending focus request is only given up on once the window
   * is the right project's, so a jump into another project is not abandoned against stale rows. Omitted
   * means settled, which is every caller that has no such placeholder. */
  windowSettled?: boolean;
}

/** How long a pending focus request may wait for its row before it is dropped. A backstop for the
 * cases no signal covers (a group fetch that fails, a filter that hides the item): the request is
 * cleared and the board stays as it was, rather than waiting forever and firing at some later,
 * unrelated moment. */
const PENDING_FOCUS_DEADLINE_MS = 4000;

interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
}

export function BoardView({
  projectId,
  items,
  issues = [],
  counts,
  onCreateTask,
  emptyState,
  windowSettled = true,
}: BoardViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  // The set of project ids whose Backlog band the CURRENT quick-add-reachability episode has
  // already auto-expanded for (CR-01, 01-VERIFICATION.md truth #22; CR-01 residual, 01-REVIEW.md
  // 2026-09-10 incremental review) — not a single scalar. A scalar (boolean OR a bare project-id
  // string) can only remember the ONE most-recently-seen episode, so it cannot distinguish
  // "project A, already handled" from "project A, not yet handled" once a DIFFERENT project's
  // episode has been recorded in between. `App.tsx` renders `<Board projectId={project.id} …>`
  // with no React key (App.tsx:212), so this component is not remounted when `projectId`
  // changes — only the prop updates — which means a project switch sequence longer than one hop
  // (A -> B -> A again) is a real, reachable scenario, not a hypothetical: a scalar guard treats
  // the return to A as a brand-new episode and silently re-expands a Backlog the user deliberately
  // re-collapsed. A `Set` keyed on project id remembers every project this episode has already
  // seeded, independent of visit order, so the switched-to project's collapsed Backlog is still
  // expanded once AND a round trip back to an earlier project does not re-trigger the expansion.
  // See the expand-Backlog effect below for how this set is used.
  const backlogAutoExpandedRef = useRef<Set<string>>(new Set());
  // Selection is an item id, held in the shared store (01-09-PLAN.md Task 1) — never a row index
  // — so it survives a pushed delta reordering the window, and so `CommandPalette.tsx` (mounted
  // outside this tree) can read/drive it too.
  const selectedId = useUiStore((state) => state.selectedItemId);
  const setSelectedId = useUiStore((state) => state.setSelectedItemId);
  // Both held in the shared store, not local state — `CommandPalette.tsx`'s "Open selected item"
  // and "Delete" commands (generated from the board-list binding table, Task 2) drive them from
  // outside this tree, exactly like `selectedItemId` above (see `state/uiStore.ts`'s doc comments).
  const detailItemId = useUiStore((state) => state.detailItemId);
  const setDetailItemId = useUiStore((state) => state.setDetailItemId);
  const deleteTarget = useUiStore((state) => state.deleteTarget);
  const setDeleteTarget = useUiStore((state) => state.setDeleteTarget);
  // The command palette (`CommandPalette.tsx`, mounted outside this tree) is the one other
  // surface that can open over the item detail panel — subscribed here (not just read via
  // `getState()`) so `<ItemDetailPanel trapped={!paletteOpen}>` below re-renders the moment the
  // palette opens or closes (01-13-PLAN.md, G-01-FOCUS instance 5).
  const paletteOpen = useUiStore((state) => state.paletteOpen);
  const [listFocused, setListFocused] = useState(false);
  // The rest of the layer stack lives in `state/uiStore.ts` too (01-13-PLAN.md Task 1) — not
  // local `useState` — so `state/keyboard.ts`'s layer model can see it from outside this tree.
  // `pickerAnchor` stays local: it is screen geometry the picker's portal needs, not layer state.
  const activePicker = useUiStore((state) => state.activePicker);
  const setActivePicker = useUiStore((state) => state.setActivePicker);
  const [pickerAnchor, setPickerAnchor] = useState<AnchorRect | null>(null);
  // Quick-add is on demand (`c`/`⌘N` opens it; 01-UI-SPEC.md "Quick-add", "Surface Inventory") —
  // `effectiveQuickAddOpen` below additionally forces it open for a project with zero items, per
  // the empty-board default ("quick-add is already visible and focused," State Inventory).
  const quickAddOpen = useUiStore((state) => state.quickAddOpen);
  const setQuickAddOpen = useUiStore((state) => state.setQuickAddOpen);
  const quickAddKind = useUiStore((state) => state.quickAddKind);
  const storeOpenQuickAdd = useUiStore((state) => state.openQuickAdd);
  // The one-shot focus request (G-01-4, 01-19-PLAN.md) — consumed by the scroll effect below (to
  // release its negative-index guard) and by `QuickAdd.tsx`'s own focus effect (to move the
  // cursor). Guarding on this flag rather than on `quickAddOpen` is what keeps a refused ⌘N from
  // scrolling the board or moving focus (the layer guard never sets this flag for a refused
  // keystroke — see `openQuickAdd` below).
  const quickAddFocusPending = useUiStore((state) => state.quickAddFocusPending);
  const clearQuickAddFocusPending = useUiStore((state) => state.clearQuickAddFocusPending);
  // Whether the Backlog-top quick-add row is currently nested under `quickAddIndentTarget`
  // (G-01-EPIC-ASSIGN, plan 01-15). Genuinely local — not layer state — so it stays as a plain
  // `useState`, not a `uiStore` field.
  const [quickAddIndented, setQuickAddIndented] = useState(false);
  // D-08: moving an item to Done with unchecked criteria warns but never blocks. The pending
  // change is held here rather than applied optimistically — `DoneWarning`'s Escape "reverts the
  // status change" by the mutation simply never having been sent (01-UI-SPEC.md State Inventory).
  const pendingDone = useUiStore((state) => state.pendingDone);
  const setPendingDone = useUiStore((state) => state.setPendingDone);
  // The launch sheet (D-27, plan 02-04) is mounted once at the App.tsx level, a peer of
  // CommandPalette — this board only ever opens it by name (the task id), never imports the
  // sheet component itself, exactly as `detailItemId`/`activePicker` are opened by id above.
  const setLaunchSheetTaskId = useUiStore((state) => state.setLaunchSheetTaskId);
  const setReviewSurface = useUiStore((state) => state.setReviewSurface);
  // The live session surface (D-31, plan 02-01), mounted once at the `App.tsx` level like the
  // launch sheet above — opened by id only, from `ItemDetailPanel.tsx`'s Runs section (a specific
  // run id) or from `open-live-session`'s board-list `l` key / palette command below (resolved
  // through the ONE shared `openLiveSessionForTask` entry point, plan 02-08 Task 3).
  const setActiveAgentRunId = useUiStore((state) => state.setActiveAgentRunId);

  // A stable module-level empty object — returning a fresh `{}` literal from the selector would
  // give Zustand's default reference-equality check a new value on every call, causing an
  // infinite re-render loop when no band is collapsed for this project yet.
  const collapsedByStatus =
    useCollapseStore((state) => state.collapsedByProject[projectId ?? ""]) ?? EMPTY_COLLAPSE;
  const toggleCollapsed = useCollapseStore((state) => state.toggle);
  const expandBand = useCollapseStore((state) => state.expand);
  const collapseBand = useCollapseStore((state) => state.collapse);

  const setStatus = useSetStatus(projectId);
  const setPriority = useSetPriority(projectId);
  const setEstimate = useSetEstimate(projectId);
  const setAssignee = useSetAssignee(projectId);
  const setTaskEpic = useSetTaskEpic(projectId);
  const setIssueParent = useSetIssueParent(projectId);
  const reorderItem = useReorderItem(projectId);
  const updateItem = useUpdateItem(projectId);
  const createIssue = useCreateIssue(projectId);
  const createEpic = useCreateEpic(projectId);
  const deleteItem = useDeleteItem(projectId);

  // Switching projects must not carry a stale selection/detail/delete-target over onto a
  // different project's items (and, as a side effect, resets any leftover state between test
  // renders that reuse the same singleton `uiStore` — 01-09-PLAN.md keyboard-nav/palette test
  // suites rely on this).
  useEffect(() => {
    setSelectedId(null);
    setDetailItemId(null);
    setDeleteTarget(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // "Selection follows a pushed delta" (01-UI-SPEC.md "Focus & selection model") has two halves.
  // Reordering needs no code here at all: `selectedId` is an id, so a rank change that leaves the
  // item in `items` leaves `selectedId` untouched and the row it now labels simply moves. The
  // other half — the selected id being REMOVED from the window (deleted, or newly excluded by an
  // active filter) — does need code: fall to the next-nearest surviving id in the *previous*
  // order, never reset to the top. `prevItemsRef` is what "previous order" means here; it is
  // updated at the end of every run, so the comparison is always against the window one delta ago.
  const prevItemsRef = useRef<BoardItem[]>(items);
  useEffect(() => {
    const prevItems = prevItemsRef.current;
    if (selectedId && !items.some((item) => item.id === selectedId)) {
      const prevIndex = prevItems.findIndex((item) => item.id === selectedId);
      if (prevIndex !== -1) {
        const stillPresent = new Set(items.map((item) => item.id));
        let nearest: string | null = null;
        for (let offset = 1; offset < prevItems.length && nearest === null; offset++) {
          const after = prevItems[prevIndex + offset];
          const before = prevItems[prevIndex - offset];
          if (after && stillPresent.has(after.id)) nearest = after.id;
          else if (before && stillPresent.has(before.id)) nearest = before.id;
        }
        setSelectedId(nearest);
      }
    }
    prevItemsRef.current = items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items]);

  // The `AssigneePicker`'s roster (BOARD-06) and the id -> actor lookup `BoardRow` resolves its
  // avatar/badge from — fetched once here, never by the row or the picker itself (opening a
  // picker issues no command; see `AssigneePicker.tsx`'s own doc comment).
  const actorsQuery = useActors();
  const actors = actorsQuery.data ?? [];
  const actorsById = useMemo<Record<string, Actor>>(
    () => Object.fromEntries(actors.map((actor) => [actor.id, actor])),
    [actors],
  );

  // Epic id -> epic summary, the project's full roster (BOARD-06, G-01-2) — fetched once here
  // via `useEpics`, never derived from the currently loaded window. The prior derivation
  // (`items.filter(i => i.kind === "epic")`) was UAT gap G-01-2 itself: any epic sorting outside
  // `board_list`'s 200-row page had no entry, so `BoardRow`'s pill fell back to the raw internal
  // `epic_id` ULID. `BoardRow`'s pill and (from plan 01-18) `FilterBar`'s chips and both
  // `ParentPicker` option lists all resolve against this same roster.
  const epicsQuery = useEpics(projectId);
  const epics = epicsQuery.data?.epics ?? [];
  const epicsById = useMemo<Record<string, EpicSummary>>(
    () => Object.fromEntries(epics.map((epic) => [epic.id, epic])),
    [epics],
  );
  // D-16: a roster past EPIC_ROSTER_CEILING is surfaced, never silently shortened — closes
  // `01-SECURITY.md` AR-01-04 without reopening G-01-2 (plan 05-04).
  const epicRosterNotice = epicRosterTruncationNotice(epicsQuery.data);

  // The grouping key (D-07, A-02): one rack, one query, two lenses. Each group's rows come from the
  // SAME scoped `board_list` (`useGroupItemsMany`) whichever key is active — so the in-review
  // sweep is not capped by the board window's page, and the active filter and search narrow every
  // group the same way they narrow the window (D-03).
  const groupingKey = useUiStore((state) => state.groupingKey);
  const setGroupingKey = useUiStore((state) => state.setGroupingKey);
  const filterDraft = useUiStore((state) => state.filterDraft);
  const searchTerm = useUiStore((state) => state.searchTerm);
  const debouncedTerm = useDebouncedValue(searchTerm, SEARCH_DEBOUNCE_MS);
  const groupBase = useMemo<GroupBase>(
    () => ({ filter: toFilterInput(filterDraft), term: debouncedTerm }),
    [filterDraft, debouncedTerm],
  );
  // The aggregate is every epic header's source (D-05/D-06); the status lens never reads it.
  const progress = useEpicProgress(projectId, groupingKey === "epic").data;

  // D-37's board-visible blocked signal (plan 02-06 Task 3) — one project-scoped read, never a
  // per-row query, so `BoardRow`'s pill and the project rail's own read (`ProjectRail.tsx`) always
  // agree on which tasks are blocked at any given moment.
  const blockedSummaryQuery = useBlockedSummary(projectId);
  const blockedTaskIds = useMemo(
    () => new Set(blockedSummaryQuery.data?.blockedTaskIds ?? []),
    [blockedSummaryQuery.data],
  );

  // D-46's board-visible "recovery needed" signal (plan 03-11 Task 2) — one project-scoped read,
  // mirroring `blockedSummaryQuery` above exactly, so `BoardRow`'s Needs Decision pill and the
  // project rail's own read (`ProjectRail.tsx`) always agree on which tasks have an outstanding
  // recovery item.
  const recoverySummaryQuery = useRecoverySummary(projectId);
  const recoveryTaskIds = useMemo(
    () => new Set(recoverySummaryQuery.data?.recoveryTaskIds ?? []),
    [recoverySummaryQuery.data],
  );

  // D-124's board-row CI-failure pill (phase 07 plan 07-08) — one project-scoped read, mirroring
  // `blockedSummaryQuery`/`recoverySummaryQuery` above exactly, never a per-row query.
  const forgeFlagsQuery = useForgeFlags(projectId);
  const ciFailedTaskIds = useMemo(
    () => new Set(forgeFlagsQuery.data?.filter((flag) => flag.ciFailed).map((flag) => flag.taskId) ?? []),
    [forgeFlagsQuery.data],
  );

  // D-15/D-16's change annotation (Phase 8.1 plan 01) — ONE board-wide read for every row's
  // commits-ahead / uncommitted state, keyed by task id; never a per-row or per-epic query.
  const changeFlagsQuery = useChangeFlags(projectId);
  const changeFlagsByTaskId = useMemo(
    () => new Map((changeFlagsQuery.data ?? []).map((flag) => [flag.taskId, flag])),
    [changeFlagsQuery.data],
  );
  // D-153's scope-refusal badge (phase 09 plan 06) — ONE project-wide read, keyed by task id. A task
  // with no refusal is absent from the map, and its row renders no badge.
  const scopeFlagsQuery = useScopeFlags(projectId);
  const scopeDeniedByTaskId = useMemo(
    () => new Map((scopeFlagsQuery.data ?? []).map((flag) => [flag.taskId, flag.count])),
    [scopeFlagsQuery.data],
  );
  // The same map, reduced per epic for the roster (D-18) — no second query.
  const changeByEpicId = useMemo(() => rollUpChangeFlags(changeFlagsQuery.data ?? []), [changeFlagsQuery.data]);

  // D-82's epic-row pending-proposal count (plan 05-08 Task 3) — derived client-side from the
  // SAME project-scoped proposal window `TriageLane.tsx` reads through `useProjectProposals`
  // (TanStack Query dedupes the identical query key, so this is a second subscriber to the same
  // cached read, never a second network round trip). Never joins `blockedTaskIds`/`recoveryTaskIds`
  // above or `board_blocked_summary` (T-05-08's own rule: a pending proposal burns no money, D-46).
  const proposalsQuery = useProjectProposals(projectId);
  const pendingProposalsByEpicId = useMemo(() => {
    const byEpic: Record<string, AuthoringProposalDto[]> = {};
    for (const proposal of proposalsQuery.data?.proposals ?? []) {
      if (!proposal.epicId) continue;
      (byEpic[proposal.epicId] ??= []).push(proposal);
    }
    return byEpic;
  }, [proposalsQuery.data]);
  // The count on an epic's header and the challenge rows under it are the same list, so they cannot
  // disagree (D-08).
  const pendingProposalCountByEpicId = useMemo(
    () => Object.fromEntries(Object.entries(pendingProposalsByEpicId).map(([id, list]) => [id, list.length])),
    [pendingProposalsByEpicId],
  );

  // D-09's "what this says" line: a fixed rule set over aggregates already fetched above — no query
  // of its own, no agent. It reads the epic aggregate, so it belongs to the epic lens, and it waits
  // for that aggregate rather than print a read of a board it has not seen.
  const summaryText = useMemo(() => {
    if (groupingKey !== "epic" || !progress) return null;
    return summaryLine({
      decisionsPending: (proposalsQuery.data?.counts.pending ?? 0) + recoveryTaskIds.size,
      reviewable: progress.reduce((sum, p) => sum + (p.byStatus.find((s) => s.status === "in_review")?.count ?? 0), 0),
      agentsBlocked: blockedSummaryQuery.data?.blockedCount ?? 0,
      buildsFailing: ciFailedTaskIds.size,
      agentsRunning: progress.reduce((sum, p) => sum + p.agentsRunning, 0),
      epicsWithoutCriteria: progress.filter((p) => p.epicId !== null && p.criteria === null).length,
    });
  }, [groupingKey, progress, proposalsQuery.data, recoveryTaskIds, blockedSummaryQuery.data, ciFailedTaskIds]);

  // Item id -> {key, title, kind} for both epics and tasks — `IssuesLane.tsx` looks an issue's
  // `epicId`/`taskId` up against this map to render its parent button (G-01-EPIC-ASSIGN, plan
  // 01-15). The **epic half** is built from the project's full roster (`useEpics`, G-01-2, plan
  // 01-18), so an issue whose parent epic sorts outside the loaded window still resolves — the
  // roster wins on a key collision so an epic's label has one source. The **task half** is still
  // the loaded window, deliberately: tasks are the unbounded set D-03's windowing exists for, and
  // a per-id parent-resolution command for tasks is accepted debt, not an oversight (see
  // `01-17-PLAN.md`'s `<assumption_delta_decision>` and this plan's own design-decision note) — a
  // task parent outside the window still reads `No parent`.
  const parentsById = useMemo<Record<string, { key: string; title: string; kind: string }>>(
    () => ({
      ...Object.fromEntries(
        items.map((item) => [item.id, { key: item.key, title: item.title, kind: item.kind ?? "task" }]),
      ),
      ...Object.fromEntries(epics.map((epic) => [epic.id, { key: epic.key, title: epic.title, kind: "epic" }])),
    }),
    [items, epics],
  );

  // Quick-add is a layer of its own (Escape ladder step 3) — an empty project still shows it,
  // pre-focused, per the empty-board default (State Inventory), independent of whether the user
  // has explicitly opened it via `c`/`⌘N`.
  const effectiveQuickAddOpen = quickAddOpen || items.length === 0;

  const filteredEpics = useFilteredEpics(projectId, groupBase, groupingKey === "epic");

  const groups = useMemo<RackGroup[]>(() => {
    if (groupingKey === "status") {
      return BAND_ORDER.map((status) => {
        const count = counts[BAND_COUNT_KEY[status]];
        return {
          id: status,
          label: BAND_LABEL[status],
          count,
          collapsed: Boolean(collapsedByStatus[groupCollapseKey("status", status)]),
          scope: { kind: "status", status },
          fetchTotal: count,
        };
      });
    }
    const collapsedOf = (id: string | null) => collapsedByStatus[groupCollapseKey("epic", id)] ?? true;
    // A-04 `any-child`: under a filter the roster narrows to the epics the core returned rows for, so a
    // header is never an empty shell. No answer yet, or one that may be cut short, narrows nothing.
    const standing = filteredEpics.data && !filteredEpics.data.truncated ? new Set(filteredEpics.data.epicIds) : null;
    const out: RackGroup[] = (standing ? epics.filter((epic) => standing.has(epic.id)) : epics).map((epic) => {
      const total = epicHeaderTotal(progress, epic.id) ?? (progress ? 0 : undefined);
      return {
        id: epic.id,
        label: `${epic.key} ${epic.title}`,
        epicKey: epic.key,
        title: epic.title,
        status: epic.status,
        integrationBranch: epic.integrationBranch,
        progress: progressFor(progress, epic.id),
        count: total,
        collapsed: collapsedOf(epic.id),
        scope: { kind: "epic", epicId: epic.id },
        fetchTotal: total,
      };
    });
    const noEpicTasks = epicHeaderTotal(progress, null);
    if ((!progress || (noEpicTasks ?? 0) > 0) && (!standing || filteredEpics.data!.hasNoEpicTasks)) {
      out.push({
        id: null,
        label: "No epic",
        title: "No epic",
        progress: progressFor(progress, null),
        count: noEpicTasks,
        collapsed: collapsedOf(null),
        scope: { kind: "epic", epicId: null },
        // The core's epic filter puts the epic rows themselves in this bucket (their own epic id is
        // null), so the fetch must be sized for tasks PLUS epics; the rows are dropped below.
        fetchTotal: noEpicTasks === undefined ? undefined : noEpicTasks + epics.length,
      });
    }
    return out;
  }, [groupingKey, counts, collapsedByStatus, epics, progress, filteredEpics.data]);

  const fetchedGroups = useGroupItemsMany(
    projectId,
    groups.map((g) => ({ scope: g.scope, total: g.fetchTotal, enabled: !g.collapsed })),
    groupBase,
  );

  const rows = useMemo<RackRow[]>(() => {
    const out: RackRow[] = [];
    // Quick-add lives at the top of Backlog in the status lens (D-09) — the band new work always
    // enters. The epic lens has no Backlog band, so it leads the rack instead.
    if (groupingKey === "epic" && effectiveQuickAddOpen) out.push({ kind: "quick-add" });
    groups.forEach((group, index) => {
      out.push(
        groupingKey === "status"
          ? { kind: "band-header", status: group.id as BandStatus }
          : {
              kind: "epic-header",
              id: group.id,
              epicKey: group.epicKey,
              title: group.title ?? group.label,
              progress: group.progress,
              status: group.status,
              integrationBranch: group.integrationBranch,
              item: group.id ? rosterEpicItem(group.id, group.epicKey, group.title, items) : undefined,
            },
      );
      if (group.collapsed) return;
      if (groupingKey === "status" && group.id === "backlog" && effectiveQuickAddOpen) {
        out.push({ kind: "quick-add" });
      }
      // D-08: an epic's open challenges are read before its tasks — answering one may change what
      // the tasks are. They are rows of this same array, so the size function covers them and there
      // is still one virtualizer. An epic with none emits nothing: the absence is the information.
      if (groupingKey === "epic" && group.id) {
        for (const proposal of pendingProposalsByEpicId[group.id] ?? []) {
          out.push({ kind: "challenge", proposal, epicLabel: group.label });
        }
      }
      // Until a group's scoped fetch lands, show what the board window already holds for it, so
      // an expanded group never blanks (01-UI-SPEC.md "State Inventory": no re-skeleton).
      const content =
        fetchedGroups[index]?.items ??
        items.filter((item) =>
          group.scope.kind === "status" ? item.status === group.scope.status : item.epicId === group.scope.epicId,
        );
      // An epic row is a header in the epic lens, never a task row. Discriminated on `kind`, never
      // on `epicId`: an epic's own epic id is null, so the no-epic bucket contains the epic rows.
      const tasks = groupingKey === "epic" ? content.filter((item) => (item.kind ?? "task") !== "epic") : content;
      tasks.forEach((item, position) => {
        out.push({ kind: "task", item, posInSet: position + 1, setSize: group.count ?? tasks.length });
      });
    });
    return out;
  }, [groupingKey, groups, fetchedGroups, items, effectiveQuickAddOpen, pendingProposalsByEpicId]);

  // Rows that are new to the rack since the last rows array, each with its order among them, so an
  // expanding group reads as growing (`row-enter`, motion.css: a top-down wipe in which each row
  // takes an equal share of the collapse duration). Derived from the rows array and not from what the virtualizer mounts:
  // scrolling mounts rows that already existed and must not animate. The first populated rack and
  // a rack that was empty animate nothing (the board loading is not a group opening).
  // ponytail: a new row that is off-screen when its group opens plays the animation when it first
  // scrolls into view, until the rows array next changes; harmless, and fixing it needs a timer.
  const previousRowKeys = useRef<ReadonlySet<string>>(new Set());
  const enteringRowKeys = useMemo(() => {
    const previous = previousRowKeys.current;
    if (previous.size === 0) return NO_KEYS;
    const entering = new Map<string, number>();
    for (const row of rows) {
      const key = rackRowKey(row);
      if (!previous.has(key)) entering.set(key, entering.size);
    }
    return entering;
  }, [rows]);
  useEffect(() => {
    previousRowKeys.current = new Set(rows.map(rackRowKey));
  }, [rows]);

  const selectableItems = useMemo(
    () => rows.filter((r): r is SelectableRow => r.kind === "task" || (r.kind === "epic-header" && r.item !== undefined)),
    [rows],
  );

  // A request from another surface to land on one item (Phase 10 plan 10-06, Finding 9). This effect is
  // declared AFTER the project-change clear above on purpose: effects run in declaration order, and the
  // clear writes to the store synchronously, so by the time this one reads and acts, the clear is
  // already behind it and cannot win. The clear itself is untouched — other callers rely on a project
  // switch dropping a stale selection.
  const pendingFocusItemId = useUiStore((state) => state.pendingFocusItemId);
  const consumePendingFocusItemId = useUiStore((state) => state.consumePendingFocusItemId);
  const epicRosterLoaded = !epicsQuery.isPending;
  useEffect(() => {
    if (!pendingFocusItemId) return;
    // Resolved: it is one of the rows. Take the request (read-and-clear) and land on it.
    if (selectableItems.some((r) => r.item.id === pendingFocusItemId)) {
      const id = consumePendingFocusItemId();
      if (id) {
        setSelectedId(id);
        setDetailItemId(id);
      }
      return;
    }
    // Loaded but not a row: its group is collapsed. Open that group; the rows change and this runs again.
    const loaded = items.find((item) => item.id === pendingFocusItemId);
    if (loaded && (groupingKey === "status" || (loaded.kind ?? "task") !== "epic")) {
      const groupKey = groupCollapseKey(groupingKey, groupingKey === "status" ? loaded.status : loaded.epicId);
      // An epic group starts collapsed, a status band open. Only open one that is actually closed: an
      // open group that still has no row for the item is waiting on its fetch, and re-opening it would
      // rebuild the rows and re-run this effect forever. The deadline below ends that wait.
      if (collapsedByStatus[groupKey] ?? groupingKey === "epic") expandBand(projectId ?? "", groupKey);
      return;
    }
    // Not in the window and not in the epic roster either, and both are this project's: it cannot be
    // found here. Say nothing and open nothing — an unrelated item or an empty panel would read as the
    // wrong answer.
    if (!loaded && windowSettled && epicRosterLoaded && !epics.some((epic) => epic.id === pendingFocusItemId)) {
      consumePendingFocusItemId();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocusItemId, selectableItems, items, windowSettled, epicRosterLoaded, epics, groupingKey, projectId, collapsedByStatus]);
  useEffect(() => {
    if (!pendingFocusItemId) return undefined;
    const timer = setTimeout(() => {
      // Only this request: a newer one replaced the id and this timer with it.
      if (useUiStore.getState().pendingFocusItemId === pendingFocusItemId) consumePendingFocusItemId();
    }, PENDING_FOCUS_DEADLINE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocusItemId]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => rackRowHeight(rows[index]),
    getItemKey: (index) => rackRowKey(rows[index]),
    overscan: RACK_OVERSCAN,
  });

  // The quick-add row's index within `rows`, or `-1` when there is none (G-01-4). Derived rather
  // than hard-coded to `1`: the index is only `1` while Backlog is first in `BAND_ORDER` and
  // expanded — a collapsed Backlog (the expand-Backlog effect further below) changes exactly one
  // of those conditions.
  const quickAddRowIndex = useMemo(() => rows.findIndex((row) => row.kind === "quick-add"), [rows]);

  // Scrolls the quick-add row into view by the minimum distance (G-01-4, 01-19-PLAN.md Task 1).
  // Guarded on the PENDING FLAG, not on `quickAddOpen` — a refused ⌘N never sets
  // `quickAddFocusPending` (see `openQuickAdd`/`useGlobalBindings` below), so this effect never
  // scrolls the board out from under a trapped layer. The negative-index guard is what makes this
  // effect compose with the expand-Backlog effect below: the first pass (Backlog still
  // collapsed) finds no row and returns early; the expansion re-runs this effect with a real
  // index on the following render. `align: "auto"` is the minimum-distance alignment
  // 01-UI-SPEC.md's "Focus & selection model" asks for ("the viewport scrolls the minimum amount
  // needed to keep it visible — it never resets to the top of the list").
  useEffect(() => {
    if (!quickAddFocusPending || quickAddRowIndex < 0) return;
    virtualizer.scrollToIndex(quickAddRowIndex, { align: "auto" });
  }, [quickAddFocusPending, quickAddRowIndex, virtualizer]);

  // G-01-4's second, independent failure path: the `rows` memo above skips the quick-add
  // insertion entirely while Backlog is collapsed (`if (collapsedByStatus[status]) continue;`),
  // so no amount of scrolling can produce a focusable input — `quickAddRowIndex` stays `-1` and
  // the scroll effect's guard never releases. Keyed on `effectiveQuickAddOpen` rather than on the
  // focus-request flag, deliberately: a quick-add opened by ANY route (⌘N, `c`, the command
  // palette, the native menu bridge, or the empty-board default) needs a band it can actually
  // appear in — the layer guard upstream already refuses the keystroke for a trapped layer, so a
  // refused ⌘N never sets `quickAddOpen` and therefore never reaches this effect either.
  // Expanding is the honest outcome rather than rendering the row under a collapsed header,
  // because the item the user is about to create lands in Backlog and must be visible once
  // created. `if (collapsedByStatus[status]) continue;` in the `rows` memo is left untouched —
  // it is correct for every other band, and this fix belongs at the state layer, not the row
  // projection.
  //
  // CR-01 (01-VERIFICATION.md truth #22): this effect used to re-assert the expansion on EVERY
  // render where `effectiveQuickAddOpen && collapsedByStatus.backlog` both held, which is not
  // "expand when quick-add opens" but "quick-add being reachable implies Backlog is expanded,
  // forever" — the user's own collapse click was undone on the very next render, and because
  // `effectiveQuickAddOpen` is permanently true on a zero-item project, the toggle was inert for
  // that project's entire lifetime. Band collapse is a user-owned preference (01-UI-SPEC.md
  // "Board list") this effect may SEED once per reachability episode but must never re-assert.
  // `backlogAutoExpandedRef` makes that one-time: the set holds every project id this episode has
  // already expanded Backlog for, so every subsequent render of the same episode — for that
  // project OR any other project already recorded in the set — returns without writing.
  //
  // CR-01 residual (01-REVIEW.md, incremental review): the FIRST shipped fix used a scalar
  // (single project id) here instead of a set, which passes a one-way project switch (A -> B) but
  // fails a round trip (A -> B -> A again): the scalar only remembers the most-recently-seen
  // project, so returning to A reads as a brand-new episode and silently re-expands the Backlog
  // the user just re-collapsed. A `Set` remembers every project the episode has already seeded,
  // independent of visit order, closing that gap by construction.
  //
  // Clearing the WHOLE set when quick-add stops being reachable is what makes the NEXT open a
  // fresh episode for every project — that transition is the end of the reachability episode,
  // not just a fact about the current project, so every project's "already seeded" memory expires
  // together. The `collapsedByStatus.backlog` check stays — it is what makes the write
  // conditional at all, because `collapseStore.expand` builds a fresh `collapsedByProject` object
  // even when the value it writes is unchanged, and an unconditional call would re-render this
  // component and re-run this effect forever.
  useEffect(() => {
    const key = projectId ?? "";
    if (!effectiveQuickAddOpen) {
      backlogAutoExpandedRef.current.clear();
      return;
    }
    if (backlogAutoExpandedRef.current.has(key)) return;
    backlogAutoExpandedRef.current.add(key);
    if (collapsedByStatus.backlog) {
      expandBand(key, "backlog");
    }
  }, [effectiveQuickAddOpen, collapsedByStatus, projectId, expandBand]);

  /**
   * The single point every status change funnels through, whether it originated from the
   * row-level picker (`s`) or from the detail panel's own picker (D-08). Moving to Done with
   * unchecked criteria (total > 0, checked < total) does not call the mutation immediately —
   * it raises `DoneWarning` and waits for one keypress. Every other transition commits at once.
   */
  function requestStatusChange(kind: BoardItemKind, id: string, status: string) {
    const item = selectableItems.find((r) => r.item.id === id)?.item;
    const checked = item?.criteriaChecked ?? 0;
    const total = item?.criteriaTotal ?? 0;
    if (status === "done" && total > 0 && checked < total) {
      // Anchored to the row it concerns, when that row is on screen (the same rect the pickers anchor to).
      const rect = rowElRefs.current.get(id)?.getBoundingClientRect();
      setPendingDone({
        kind,
        id,
        status,
        checked,
        total,
        key: item?.key,
        anchorRect: rect ? { top: rect.top, left: rect.left, bottom: rect.bottom } : undefined,
      });
      return;
    }
    setStatus.mutate({ kind, id, status });
  }

  /** A selection target built from the roster knows no status or priority to edit from the rack. */
  function isRosterEpic(id: string) {
    return selectableItems.some((r) => r.kind === "epic-header" && r.item.id === id);
  }

  /** Opens any of the four row-level pickers (status/priority/estimate/assignee) for `id`,
   * anchored to that row's real screen coordinates (`StatusPicker.tsx`'s doc comment explains
   * why a portal positioned from `getBoundingClientRect()` is required rather than CSS
   * `position: absolute` inside the row). Opening issues no command — only a selection made
   * inside the picker does. */
  function openPickerFor(kind: PickerKind, id: string) {
    if (isRosterEpic(id)) return;
    const el = rowElRefs.current.get(id);
    if (el) {
      const rect = el.getBoundingClientRect();
      setPickerAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
    }
    setActivePicker({ kind, id });
  }

  /** `⌘↑`/`⌘↓` (01-UI-SPEC.md Keyboard Map, D-11, BOARD-05) — reorders the selected item within
   * its priority band and leaves the selection on the moved item (the mutation changes `rank`,
   * never `id`, so `selectedId` needs no update). */
  function reorderSelected(direction: "up" | "down") {
    if (!selectedId || !selectedItem || isRosterEpic(selectedId)) return;
    reorderItem.mutate({ kind: selectedItem.kind ?? "task", id: selectedId, direction });
  }

  /** `nextSelectionId`/`boundarySelectionId` (`state/keyboard.ts`) are the one implementation
   * both this keyboard path and `CommandPalette.tsx`'s "Move selection down"/"Jump to first row"
   * commands call — "what does moving mean" is derived once. */
  function moveSelection(delta: number) {
    setSelectedId(nextSelectionId(selectableItems.map((r) => r.item), selectedId, delta));
  }

  /** `c` (board-list) / `⌘N` (global) — opens quick-add for a task; `⌘⇧N` (global, via
   * `useGlobalBindings` below) opens it for an epic. Both funnel through this one setter pair so
   * quick-add's own "which kind am I creating" state has a single writer.
   *
   * This is also the ONLY writer of `quickAddOpen: true` in the renderer — every route in
   * (`c`, ⌘N, ⌘⇧N, the command palette, the forwarded native `menu:action`) reaches this
   * function, and a keystroke refused by the layer guard (`bindingAllowedInLayer`) never calls
   * it, so a refused press still writes nothing here either. An explicit new open request is a
   * fresh rising edge (CR-01) distinct from the passive "quick-add became reachable" episode the
   * effect above seeds: a user who deliberately collapsed Backlog and then pressed the
   * accelerator again gets a focusable row, not a silent no-op that strands a raised
   * `quickAddFocusPending` with nowhere to land. */
  function openQuickAdd(kind: BoardItemKind) {
    if (collapsedByStatus.backlog) {
      expandBand(projectId ?? "", "backlog");
    }
    storeOpenQuickAdd(kind);
  }

  /** ⌘⌫ (threat T-01-25) — always opens the named confirmation; the mutation itself is only
   * issued from `confirmDelete` below, never directly from a keystroke. */
  function requestDelete(item: BoardItem) {
    setDeleteTarget({ kind: item.kind ?? "task", id: item.id, key: item.key, title: item.title });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    deleteItem.mutate({ kind: deleteTarget.kind, id: deleteTarget.id });
    if (selectedId === deleteTarget.id) setSelectedId(null);
    if (detailItemId === deleteTarget.id) setDetailItemId(null);
    setDeleteTarget(null);
  }

  function handleContainerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const binding = resolveBinding(event, "board-list");
    if (!binding) return;
    // The same layer decision `useGlobalBindings` makes for every global binding
    // (`state/keyboard.ts`'s `bindingAllowedInLayer`/`topLayer`) — a superset of the old
    // three-field check this replaces: board-list keys now also stand down under the Done
    // warning and under an open palette, both of which the old check missed.
    const layer = topLayer({
      paletteOpen,
      detailOpen: detailItemId !== null,
      pickerOpen: activePicker !== null || deleteTarget !== null || pendingDone !== null,
      quickAddOpen,
    });
    if (!bindingAllowedInLayer(binding.id, layer)) return;
    event.preventDefault();

    switch (binding.id) {
      case "move-down":
        moveSelection(1);
        break;
      case "move-up":
        moveSelection(-1);
        break;
      case "select-first":
        setSelectedId(boundarySelectionId(selectableItems.map((r) => r.item), "first"));
        break;
      case "select-last":
        setSelectedId(boundarySelectionId(selectableItems.map((r) => r.item), "last"));
        break;
      case "open-detail":
        if (selectedId) setDetailItemId(selectedId);
        break;
      case "expand-row":
      case "collapse-row":
        // A-09: Right/Left disclose the focused epic header. Idempotent by design (a set, not a flip),
        // and only where an epic header row exists to be disclosed — never in the status lens.
        if (selectedId && isRosterEpic(selectedId)) {
          const setOpen = binding.id === "expand-row" ? expandBand : collapseBand;
          setOpen(projectId ?? "", groupCollapseKey("epic", selectedId));
        }
        break;
      case "create-task":
        openQuickAdd("task");
        break;
      case "open-status-picker":
        if (selectedId) openPickerFor("status", selectedId);
        break;
      case "open-priority-picker":
        if (selectedId) openPickerFor("priority", selectedId);
        break;
      case "open-estimate-picker":
        if (selectedId) openPickerFor("estimate", selectedId);
        break;
      case "open-assignee-picker":
        if (selectedId) openPickerFor("assignee", selectedId);
        break;
      case "open-epic-picker":
        // Refused on an epic row — a no-op, not an error toast — because the fixed three-level
        // hierarchy gives an epic no epic parent of its own (G-01-EPIC-ASSIGN).
        if (selectedId && selectedItem && (selectedItem.kind ?? "task") === "task") {
          openPickerFor("epic", selectedId);
        }
        break;
      case "reorder-up":
        if (selectedId) reorderSelected("up");
        break;
      case "reorder-down":
        if (selectedId) reorderSelected("down");
        break;
      case "delete-item":
        if (selectedItem) requestDelete(selectedItem);
        break;
      case "start-work":
        // Only a task has a worktree of its own to run an agent in (D-37) — a no-op on an epic
        // row, matching `open-epic-picker`'s own task-only refusal above.
        if (selectedId && selectedItem && (selectedItem.kind ?? "task") === "task") {
          setLaunchSheetTaskId(selectedId);
        }
        break;
      case "open-review": {
        // D-133: one keystroke, scope from the row kind. An issue carries no acceptance criteria
        // (D-05/D-06/D-07), so it opens nothing.
        const kind = selectedItem?.kind ?? "task";
        if (selectedId && selectedItem && (kind === "task" || kind === "epic")) {
          setReviewSurface({
            scope: kind,
            itemId: selectedId,
            label: `${selectedItem.key} ${selectedItem.title}`,
          });
        }
        break;
      }
      case "open-live-session":
        // Same task-only refusal as `start-work` above (D-37). Resolution of "which run is
        // active" is the ONE shared `openLiveSessionForTask` entry point (`useBoardQuery.ts`) —
        // a task with no runs yet resolves to a no-op, never a route change or an error.
        if (selectedId && selectedItem && (selectedItem.kind ?? "task") === "task") {
          void openLiveSessionForTask(selectedId);
        }
        break;
      case "continue-shaping":
        // Refused on a task row — the fixed three-level hierarchy gives only an epic a shaping
        // session of its own (D-91, plan 05-10). Resolution of "is a session already running for
        // this epic" is the ONE shared `continueShapingEpic` entry point (`useBoardQuery.ts`),
        // the same one `ItemDetailPanel`'s own Continue Shaping section below calls.
        if (selectedId && selectedItem && (selectedItem.kind ?? "task") === "epic") {
          void continueShapingEpic(selectedId);
        }
        break;
      default:
        break;
    }
  }

  const selectedItem = selectableItems.find((r) => r.item.id === selectedId)?.item;

  // The epic Tab would nest a new task under — the selected epic itself, or the selected task's
  // own epic resolved through `epicsById` (the same lookup `BoardRow`'s epic pill already uses).
  // `null` while quick-add is composing an epic (an epic has no epic parent, the same rule the
  // `m` keystroke applies — G-01-EPIC-ASSIGN, plan 01-15).
  const quickAddIndentTarget = useMemo(() => {
    if (quickAddKind === "epic" || !selectedItem) return null;
    if ((selectedItem.kind ?? "task") === "epic") {
      return { id: selectedItem.id, key: selectedItem.key, title: selectedItem.title };
    }
    const epic = selectedItem.epicId ? epicsById[selectedItem.epicId] : undefined;
    return epic ? { id: epic.id, key: epic.key, title: epic.title } : null;
  }, [quickAddKind, selectedItem, epicsById]);

  // Reset the nesting choice whenever quick-add closes or switches kind — a stale "indented"
  // flag must never survive into the next quick-add composition.
  useEffect(() => {
    setQuickAddIndented(false);
  }, [quickAddOpen, quickAddKind]);

  // `⌘N`/`⌘⇧N` must open quick-add regardless of which region currently owns focus — the
  // board-list container's own `resolveBinding` call above only fires while the list itself is
  // focused, so this project's board also registers the same two global action ids directly.
  useGlobalBindings({
    "create-task": () => openQuickAdd("task"),
    "create-epic": () => openQuickAdd("epic"),
  });

  // The Escape ladder (01-UI-SPEC.md "Focus & selection model") — exactly one layer closes per
  // press, in the fixed order palette → detail panel → quick-add → clear selection. A capture-
  // phase `window` listener runs ahead of every layer's own Radix `DismissableLayer` (which also
  // listens on `document`, one step later in the capture chain), so `stopPropagation` here fully
  // owns the keystroke and no two layers can ever close on the same press.
  useEffect(() => {
    // The bare `KeyboardEvent` name is shadowed in this file by React's own generic type (this
    // module's top-of-file import for `handleContainerKeyDown`'s synthetic-event param) — spell
    // out `globalThis.KeyboardEvent` so this native `window` listener is typed against the real
    // DOM event, not React's.
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Read the whole layer stack from the store at keystroke time (01-13-PLAN.md Task 2) —
      // this listener is registered once (empty deps below), so it must never see a stale
      // closure over `detailItemId`/`quickAddOpen`/etc.
      const state = useUiStore.getState();
      const layer = nextEscapeLayer({
        paletteOpen: state.paletteOpen,
        detailOpen: state.detailItemId !== null,
        quickAddOpen: state.quickAddOpen,
        // A row-level picker, `DeleteConfirm`, and `DoneWarning` all already own their own
        // Escape (Radix `DismissableLayer`, or — for `DoneWarning` — its own self-focused
        // Enter/Escape handling) — the ladder steps aside for any of them, exactly as it does
        // for a picker (see `nextEscapeLayer`'s doc comment).
        pickerOpen: state.activePicker !== null || state.deleteTarget !== null || state.pendingDone !== null,
        hasSelection: state.selectedItemId !== null,
      });
      if (!layer) return;
      event.preventDefault();
      event.stopPropagation();
      switch (layer) {
        case "palette":
          state.setPaletteOpen(false);
          break;
        case "detail":
          state.setDetailItemId(null);
          break;
        case "quick-add":
          state.setQuickAddOpen(false);
          break;
        case "selection":
          state.setSelectedItemId(null);
          break;
      }
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  const containerStyle: CSSProperties = {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    background: "var(--surface-dominant)",
  };

  const isEmptyWindow = items.length === 0 && issues.length === 0;

  return (
    // `overflowX: clip`: the detail panel slides in from beyond the trailing edge (`panel-slide-in`,
    // motion.css), and without this its off-screen start would flash a horizontal scrollbar.
    <div style={{ height: "100%", display: "flex", overflowX: "clip" }}>
      <div style={{ flex: 1, minWidth: 0, position: "relative", display: "flex", flexDirection: "column" }}>
      <div
        role="group"
        aria-label="Group the board by epic or status"
        style={{
          flex: "none",
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          padding: "var(--space-xs) var(--space-md)",
          borderBottom: "1px solid var(--divider)",
          background: "var(--surface-dominant)",
        }}
      >
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          Group by
        </span>
        {(["epic", "status"] as const).map((key) => (
          <button
            key={key}
            type="button"
            className="type-label"
            aria-label={`Group by ${key}`}
            aria-pressed={groupingKey === key}
            onClick={() => setGroupingKey(key)}
            style={{
              padding: "var(--space-xs) var(--space-sm)",
              borderRadius: "var(--radius-chrome)",
              border: `1px solid ${groupingKey === key ? "var(--border-control)" : "transparent"}`,
              background: "transparent",
              color: groupingKey === key ? "var(--text-primary-rack)" : "var(--text-muted-rack)",
              cursor: "pointer",
              textTransform: "capitalize",
            }}
          >
            {key}
          </button>
        ))}
      </div>
      {summaryText && (
        <p
          data-summary-line
          className="type-body"
          title={summaryText}
          style={{
            flex: "none",
            margin: 0,
            padding: "var(--space-sm) var(--space-md)",
            borderBottom: "1px solid var(--divider)",
            background: "var(--surface-dominant)",
            color: "var(--text-primary-rack)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {summaryText}
        </p>
      )}
      {epicRosterNotice && (
        <div
          role="status"
          className="type-body"
          style={{
            padding: "var(--space-xs) var(--space-md)",
            background: "var(--surface-secondary)",
            borderBottom: "1px solid var(--divider)",
            color: "var(--text-muted-rack)",
          }}
        >
          {epicRosterNotice}
        </div>
      )}
      <div
        className="board-view"
        ref={parentRef}
        style={containerStyle}
        role="list"
        aria-label="Board"
        tabIndex={0}
        onFocus={() => setListFocused(true)}
        onBlur={() => setListFocused(false)}
        onKeyDown={handleContainerKeyDown}
      >
        <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const enterOrder = enteringRowKeys.get(String(virtualRow.key));
            const rowClass = enterOrder === undefined ? "displace-transition" : "displace-transition row-enter";
            const epicRowClass = `${rowClass} epic-header-cell`;
            const positionStyle: CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
              ...(enterOrder === undefined
                ? {}
                : ({ "--enter-i": enterOrder, "--enter-n": enteringRowKeys.size } as CSSProperties)),
            };


            if (row.kind === "band-header") {
              const count = counts[BAND_COUNT_KEY[row.status]];
              return (
                <div key={virtualRow.key} data-row-key={virtualRow.key} className={rowClass} style={positionStyle}>
                  <StatusBand
                    label={BAND_LABEL[row.status]}
                    count={count}
                    collapsed={Boolean(collapsedByStatus[groupCollapseKey("status", row.status)])}
                    onToggleCollapsed={() =>
                      toggleCollapsed(projectId ?? "", groupCollapseKey("status", row.status))
                    }
                  />
                </div>
              );
            }

            if (row.kind === "epic-header") {
              const key = groupCollapseKey("epic", row.id);
              const epicItemId = row.item?.id;
              return (
                <div key={virtualRow.key} data-row-key={virtualRow.key} className={epicRowClass} style={positionStyle}>
                  <EpicHeaderRow
                    epicId={row.id}
                    epicKey={row.epicKey}
                    title={row.title}
                    progress={row.progress}
                    status={row.status}
                    integrationBranch={row.integrationBranch}
                    pendingProposalCount={
                      row.id && proposalsQuery.data ? (pendingProposalCountByEpicId[row.id] ?? 0) : undefined
                    }
                    change={changeByEpicId.get(row.id)}
                    showDispatch={row.id !== null}
                    collapsed={collapsedByStatus[key] ?? true}
                    selected={epicItemId !== undefined && epicItemId === selectedId}
                    focused={epicItemId !== undefined && epicItemId === selectedId && listFocused}
                    onToggleCollapsed={() => toggleCollapsed(projectId ?? "", key, true)}
                    onSelect={epicItemId ? () => setSelectedId(epicItemId) : undefined}
                    onOpenDetail={epicItemId ? () => setDetailItemId(epicItemId) : undefined}
                  />
                </div>
              );
            }

            if (row.kind === "challenge") {
              return (
                <div key={virtualRow.key} data-row-key={virtualRow.key} className={rowClass} style={positionStyle}>
                  <ChallengeRow proposal={row.proposal} epicLabel={row.epicLabel} />
                </div>
              );
            }

            if (row.kind === "quick-add") {
              return (
                <div key={virtualRow.key} data-row-key={virtualRow.key} className={rowClass} style={positionStyle}>
                  <QuickAdd
                    // Mount-time focus is now the empty-board default only (G-01-4) — every
                    // on-demand open goes through `focusPending` below instead, since the row is
                    // virtualized and at volume is not mounted when the keystroke arrives.
                    autoFocus={items.length === 0}
                    focusPending={quickAddFocusPending}
                    onFocusHandled={clearQuickAddFocusPending}
                    onCreate={(title, epicId) =>
                      quickAddKind === "epic" ? createEpic.mutate(title) : onCreateTask(title, epicId)
                    }
                    onEscape={() => setQuickAddOpen(false)}
                    placeholder={
                      quickAddKind === "epic"
                        ? "Type an epic title, press Enter to create…"
                        : undefined
                    }
                    ariaLabel={quickAddKind === "epic" ? "Quick add an epic" : undefined}
                    indentTarget={quickAddIndentTarget}
                    indented={quickAddIndented}
                    onIndentChange={setQuickAddIndented}
                  />
                </div>
              );
            }

            return (
              <div
                key={virtualRow.key}
                // `displace-transition` (motion.css) is the single-row-displacement animation
                // (01-UI-SPEC.md "Motion", "Selected Direction — Signature interaction"): only
                // the transform this row's own reorder changes is ever animated — the rest of
                // the rack keeps its position, since a swap moves at most two adjacent rows.
                // `prefers-reduced-motion` zeroes `--duration-collapse` (motion.css), so the
                // state change still applies instantly rather than being removed.
                data-row-key={virtualRow.key}
                className={rowClass}
                style={positionStyle}
                ref={(el) => {
                  if (el) rowElRefs.current.set(row.item.id, el);
                  else rowElRefs.current.delete(row.item.id);
                }}
              >
                <BoardRow
                  item={row.item}
                  selected={row.item.id === selectedId}
                  focused={row.item.id === selectedId && listFocused}
                  actorsById={actorsById}
                  epicsById={epicsById}
                  posInSet={row.posInSet}
                  setSize={row.setSize}
                  blocked={blockedTaskIds.has(row.item.id)}
                  needsDecision={recoveryTaskIds.has(row.item.id)}
                  ciFailed={ciFailedTaskIds.has(row.item.id)}
                  changeFlag={changeFlagsByTaskId.get(row.item.id)}
                  scopeDenied={scopeDeniedByTaskId.get(row.item.id)}
                  pendingProposalCount={pendingProposalCountByEpicId[row.item.id] ?? 0}
                  hideEpicPill={groupingKey === "epic"}
                  onSelect={() => setSelectedId(row.item.id)}
                  onOpenDetail={() => {
                    setSelectedId(row.item.id);
                    setDetailItemId(row.item.id);
                  }}
                  onOpenStatusPicker={() => {
                    setSelectedId(row.item.id);
                    openPickerFor("status", row.item.id);
                  }}
                  onOpenPriorityPicker={() => {
                    setSelectedId(row.item.id);
                    openPickerFor("priority", row.item.id);
                  }}
                  onOpenEstimatePicker={() => {
                    setSelectedId(row.item.id);
                    openPickerFor("estimate", row.item.id);
                  }}
                  onOpenAssigneePicker={() => {
                    setSelectedId(row.item.id);
                    openPickerFor("assignee", row.item.id);
                  }}
                  onOpenBlocked={() => {
                    // Same destination as double-clicking the row (opens the item detail panel);
                    // Task 2 already renders the compact permission-request card there whenever a
                    // pending request exists — this IS the fastest path from "I see something
                    // needs me" to "I answered it" (D-37).
                    setSelectedId(row.item.id);
                    setDetailItemId(row.item.id);
                  }}
                  onOpenRecovery={() => {
                    // Same destination as the Blocked pill and double-clicking the row — opens
                    // the item detail panel (D-46, plan 03-11). No target-section mechanism exists
                    // on the panel yet to scroll straight to WorktreeSummary/RunsSection, so this
                    // opens the panel plainly; see this plan's SUMMARY.md for the named gap.
                    setSelectedId(row.item.id);
                    setDetailItemId(row.item.id);
                  }}
                  onOpenCiFailed={() => {
                    // Same destination as the other two pills — opens the item detail panel,
                    // which renders ForgeSection's own CI result and link out (D-124, phase 07
                    // plan 07-08).
                    setSelectedId(row.item.id);
                    setDetailItemId(row.item.id);
                  }}
                />
              </div>
            );
          })}
        </div>
        <IssuesLane
          issues={issues}
          onCreateIssue={(title) => createIssue.mutate({ title, kind: "idea" })}
          parentsById={parentsById}
          onOpenParentPicker={(issue, anchorEl) => {
            // CR-02: this is a click path, not a keystroke, but it opens the same kind of
            // trapped FocusScope (`ParentPicker`) a keyboard-driven picker does — it must stand
            // down under the same layer guard `handleContainerKeyDown` above already applies, or
            // it can mount a second trapped scope while e.g. the item detail panel's is still
            // active (the exact G-01-FOCUS failure class this phase closed for keyboard paths).
            const layer = topLayer({
              paletteOpen,
              detailOpen: detailItemId !== null,
              pickerOpen: activePicker !== null || deleteTarget !== null || pendingDone !== null,
              quickAddOpen,
            });
            if (layer !== "board" && layer !== "quick-add") return;
            const rect = anchorEl.getBoundingClientRect();
            setPickerAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
            setActivePicker({ kind: "issue-parent", id: issue.id });
          }}
        />
        <TriageLane
          projectId={projectId}
          epicsById={epicsById}
          onOpenSession={(agentRunId, epicId) => setActiveAgentRunId(agentRunId, null, null, epicId)}
        />
      </div>

      {isEmptyWindow && emptyState && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            // The band headers and quick-add row underneath stay interactive (the
            // empty-project state's quick-add row is "already visible and focused" exactly as
            // before this overlay existed) — only the CTA button below opts back into pointer
            // events.
            pointerEvents: "none",
          }}
        >
          <div
            className="empty-board-state"
            style={{
              pointerEvents: "auto",
              textAlign: "center",
              maxWidth: 420,
              padding: "var(--space-lg)",
              borderRadius: "var(--radius-chrome)",
              background: "var(--surface-secondary)",
              border: "1px solid var(--divider)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-sm)",
              alignItems: "center",
            }}
          >
            <h2 className="type-heading" style={{ margin: 0, color: "var(--text-primary-rack)" }}>
              {emptyState.heading}
            </h2>
            <p className="type-body" style={{ margin: 0, color: "var(--text-muted-rack)" }}>
              {emptyState.body}
            </p>
            {emptyState.ctaLabel && emptyState.onCta && (
              <button
                type="button"
                className="type-body control-edge"
                onClick={emptyState.onCta}
                style={{
                  padding: "var(--space-xs) var(--space-md)",
                  background: "var(--surface-dominant)",
                  color: "var(--accent-text-rack)",
                  cursor: "pointer",
                }}
              >
                {emptyState.ctaLabel}
              </button>
            )}
          </div>
        </div>
      )}
      </div>

      {activePicker &&
        pickerAnchor &&
        (() => {
          const closePicker = () => setActivePicker(null);

          // The "issue-parent" kind resolves its subject from `issues`, not `selectableItems` —
          // an issue is never a `BoardItem` and never appears there. Resolved once, ahead of the
          // switch below, so the other five kinds keep resolving from `selectableItems` exactly
          // as before rather than duplicating this whole block (G-01-EPIC-ASSIGN, plan 01-15).
          if (activePicker.kind === "issue-parent") {
            const pickedIssue = issues.find((i) => i.id === activePicker.id);
            if (!pickedIssue) return null;
            // Two labelled runs in one list — every epic first, then every task — reusing plan
            // 01-14's `ParentPicker` with grouped options rather than a second picker component.
            // The Epics group is the project's full roster (`useEpics`, G-01-2, plan 01-18), so
            // an out-of-window epic still reparents correctly; the Tasks group stays windowed,
            // deliberately (see `parentsById`'s comment above).
            const parentOptions: ParentOption[] = [
              ...epics.map((epic) => ({ id: epic.id, label: `${epic.key} ${epic.title}`, group: "Epics" })),
              ...items
                .filter((item) => (item.kind ?? "task") === "task")
                .map((task) => ({ id: task.id, label: `${task.key} ${task.title}`, group: "Tasks" })),
            ];
            return (
              <ParentPicker
                ariaLabel="Set parent"
                emptyLabel="No parent"
                currentId={pickedIssue.taskId ?? pickedIssue.epicId}
                options={parentOptions}
                anchorRect={pickerAnchor}
                onSelect={(id) => {
                  if (id === null) {
                    setIssueParent.mutate({ issueId: pickedIssue.id, parentKind: null, parentId: null });
                  } else {
                    // Decide the chosen id's kind by testing roster membership FIRST, falling
                    // back to the windowed `items` lookup for tasks — a chosen id that is in the
                    // roster is an epic even if it sorts outside the loaded window, so it can
                    // never be silently misfiled as a task the way a windowed-only lookup would.
                    const parentKind = epicsById[id] ? "epic" : "task";
                    setIssueParent.mutate({ issueId: pickedIssue.id, parentKind, parentId: id });
                  }
                  closePicker();
                }}
                onClose={closePicker}
              />
            );
          }

          const pickedRow = selectableItems.find((r) => r.item.id === activePicker.id)?.item;
          if (!pickedRow) return null;
          const kind = pickedRow.kind ?? "task";

          switch (activePicker.kind) {
            case "status":
              return (
                <StatusPicker
                  currentStatus={pickedRow.status}
                  anchorRect={pickerAnchor}
                  onSelect={(status) => {
                    requestStatusChange(kind, pickedRow.id, status);
                    closePicker();
                  }}
                  onClose={closePicker}
                />
              );
            case "priority":
              return (
                <PriorityPicker
                  currentPriority={pickedRow.priority}
                  anchorRect={pickerAnchor}
                  onSelect={(priority) => {
                    setPriority.mutate({ kind, id: pickedRow.id, priority });
                    closePicker();
                  }}
                  onClose={closePicker}
                />
              );
            case "estimate":
              return (
                <EstimatePicker
                  currentEstimate={pickedRow.estimate ?? null}
                  anchorRect={pickerAnchor}
                  onSelect={(estimate) => {
                    setEstimate.mutate({ kind, id: pickedRow.id, estimate });
                    closePicker();
                  }}
                  onClose={closePicker}
                />
              );
            case "assignee":
              return (
                <AssigneePicker
                  currentAssigneeId={pickedRow.assigneeId ?? null}
                  actors={actors}
                  anchorRect={pickerAnchor}
                  onSelect={(assigneeId) => {
                    setAssignee.mutate({ kind, id: pickedRow.id, assigneeId });
                    closePicker();
                  }}
                  onClose={closePicker}
                />
              );
            case "epic": {
              // Every epic in the project's full roster (`useEpics`, G-01-2, plan 01-18) except
              // the picked row itself, regardless of which epics are in the loaded window — the
              // same roster `epicsById` and `FilterBar`'s epic chips already use.
              const epicOptions: ParentOption[] = epics
                .filter((epic) => epic.id !== pickedRow.id)
                .map((epic) => ({ id: epic.id, label: `${epic.key} ${epic.title}` }));
              return (
                <ParentPicker
                  ariaLabel="Set epic"
                  emptyLabel="No epic"
                  currentId={pickedRow.epicId}
                  options={epicOptions}
                  anchorRect={pickerAnchor}
                  onSelect={(epicId) => {
                    setTaskEpic.mutate({ taskId: pickedRow.id, epicId });
                    closePicker();
                  }}
                  onClose={closePicker}
                />
              );
            }
            default:
              return null;
          }
        })()}

      {detailItemId && selectedItem && (
        <ItemDetailPanel
          item={
            {
              id: selectedItem.id,
              kind: selectedItem.kind ?? "task",
              key: selectedItem.key,
              title: selectedItem.title,
              // Empty for an epic reached from the roster, whose status is not known here.
              status: selectedItem.status || undefined,
              projectId,
              // A roster epic is a placeholder with no rank, and its priority/estimate are not known (see
              // `rosterEpicItem`): print them only for a loaded row, never the placeholder's `0`.
              priority: selectedItem.rank ? selectedItem.priority : undefined,
              estimate: selectedItem.rank ? selectedItem.estimate : undefined,
            } satisfies DetailItem
          }
          onClose={() => setDetailItemId(null)}
          onUpdateTitle={(title) =>
            updateItem.mutate({ kind: selectedItem.kind ?? "task", id: selectedItem.id, title })
          }
          onSetStatus={(status) => requestStatusChange(selectedItem.kind ?? "task", selectedItem.id, status)}
          onStartWork={() => setLaunchSheetTaskId(selectedItem.id)}
          onReview={() =>
            setReviewSurface({
              scope: selectedItem.kind === "epic" ? "epic" : "task",
              itemId: selectedItem.id,
              label: `${selectedItem.key} ${selectedItem.title}`,
            })
          }
          onOpenRun={(agentRunId) => setActiveAgentRunId(agentRunId, selectedItem.id)}
          onContinueShaping={() => void continueShapingEpic(selectedItem.id)}
          // The palette renders over this panel by design (the Escape ladder's fixed order) —
          // release the trap while the palette owns focus so the panel stays open instead of
          // fighting Radix's `FocusScope` for it (01-13-PLAN.md, G-01-FOCUS instance 5).
          trapped={!paletteOpen}
        />
      )}

      {pendingDone && (
        <DoneWarning
          checked={pendingDone.checked}
          total={pendingDone.total}
          itemKey={pendingDone.key}
          anchorRect={pendingDone.anchorRect}
          onConfirm={() => {
            setStatus.mutate({ kind: pendingDone.kind, id: pendingDone.id, status: pendingDone.status });
            setPendingDone(null);
          }}
          onCancel={() => setPendingDone(null)}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          itemType={itemTypeLabel(deleteTarget.kind)}
          itemKey={deleteTarget.key}
          title={deleteTarget.title}
          onConfirm={confirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
