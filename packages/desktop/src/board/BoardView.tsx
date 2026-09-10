/**
 * The virtualized rack: fixed-height strips grouped into the five fixed status bands
 * (01-UI-SPEC.md "Board list", "Selected Direction"). Never horizontal columns — one vertical
 * rack, grouped into bands, sticky stamped band headers carrying their counts, with the
 * workflow-less Issues lane rendered beneath them (D-07).
 *
 * Virtualization uses a single constant `estimateSize` (no `measureElement`) and overscan 8-12
 * rows (01-UI-SPEC.md "Performance Contract"). Band headers share the same fixed row height as
 * item rows so the whole rack stays one uniform virtualized list — no per-row height branching.
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
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BoardRow, ROW_HEIGHT } from "./BoardRow";
import { StatusBand } from "./StatusBand";
import { IssuesLane } from "./IssuesLane";
import { QuickAdd } from "./QuickAdd";
import { DoneWarning } from "./DoneWarning";
import { DeleteConfirm } from "./DeleteConfirm";
import { StatusPicker } from "./pickers/StatusPicker";
import { PriorityPicker } from "./pickers/PriorityPicker";
import { EstimatePicker } from "./pickers/EstimatePicker";
import { AssigneePicker } from "./pickers/AssigneePicker";
import { ParentPicker, type ParentOption } from "./pickers/ParentPicker";
import { ItemDetailPanel, type DetailItem } from "../item-detail/ItemDetailPanel";
import { useCollapseStore } from "./collapseStore";
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
  useActors,
  useCreateEpic,
  useCreateIssue,
  useDeleteItem,
  useEpics,
  useReorderItem,
  useSetAssignee,
  useSetEstimate,
  useSetIssueParent,
  useSetPriority,
  useSetStatus,
  useSetTaskEpic,
  useUpdateItem,
} from "./useBoardQuery";
import type { Actor, BandCounts, BoardItem, BoardItemKind, EpicSummary, IssueItem } from "./useBoardQuery";

const BAND_ORDER = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
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
  | { kind: "header"; status: BandStatus }
  | { kind: "quick-add" }
  | { kind: "item"; item: BoardItem; posInSet: number };

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
}

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
}: BoardViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
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
  // Whether the Backlog-top quick-add row is currently nested under `quickAddIndentTarget`
  // (G-01-EPIC-ASSIGN, plan 01-15). Genuinely local — not layer state — so it stays as a plain
  // `useState`, not a `uiStore` field.
  const [quickAddIndented, setQuickAddIndented] = useState(false);
  // D-08: moving an item to Done with unchecked criteria warns but never blocks. The pending
  // change is held here rather than applied optimistically — `DoneWarning`'s Escape "reverts the
  // status change" by the mutation simply never having been sent (01-UI-SPEC.md State Inventory).
  const pendingDone = useUiStore((state) => state.pendingDone);
  const setPendingDone = useUiStore((state) => state.setPendingDone);

  // A stable module-level empty object — returning a fresh `{}` literal from the selector would
  // give Zustand's default reference-equality check a new value on every call, causing an
  // infinite re-render loop when no band is collapsed for this project yet.
  const collapsedByStatus =
    useCollapseStore((state) => state.collapsedByProject[projectId ?? ""]) ?? EMPTY_COLLAPSE;
  const toggleCollapsed = useCollapseStore((state) => state.toggle);

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
  const epics = epicsQuery.data ?? [];
  const epicsById = useMemo<Record<string, EpicSummary>>(
    () => Object.fromEntries(epics.map((epic) => [epic.id, epic])),
    [epics],
  );

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

  const rows = useMemo<RackRow[]>(() => {
    const byStatus = new Map<BandStatus, BoardItem[]>();
    for (const status of BAND_ORDER) byStatus.set(status, []);
    for (const item of items) {
      byStatus.get(item.status as BandStatus)?.push(item);
    }

    const out: RackRow[] = [];
    for (const status of BAND_ORDER) {
      out.push({ kind: "header", status });
      if (collapsedByStatus[status]) continue;
      // Quick-add lives at the top of Backlog — the band new work always enters (D-09).
      if (status === "backlog" && effectiveQuickAddOpen) {
        out.push({ kind: "quick-add" });
      }
      (byStatus.get(status) ?? []).forEach((item, index) => {
        out.push({ kind: "item", item, posInSet: index + 1 });
      });
    }
    return out;
  }, [items, collapsedByStatus, effectiveQuickAddOpen]);

  const selectableItems = useMemo(
    () => rows.filter((r): r is { kind: "item"; item: BoardItem; posInSet: number } => r.kind === "item"),
    [rows],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

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
      setPendingDone({ kind, id, status, checked, total });
      return;
    }
    setStatus.mutate({ kind, id, status });
  }

  /** Opens any of the four row-level pickers (status/priority/estimate/assignee) for `id`,
   * anchored to that row's real screen coordinates (`StatusPicker.tsx`'s doc comment explains
   * why a portal positioned from `getBoundingClientRect()` is required rather than CSS
   * `position: absolute` inside the row). Opening issues no command — only a selection made
   * inside the picker does. */
  function openPickerFor(kind: PickerKind, id: string) {
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
    if (!selectedId || !selectedItem) return;
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
   * quick-add's own "which kind am I creating" state has a single writer. */
  function openQuickAdd(kind: BoardItemKind) {
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
    height: "100%",
    overflow: "auto",
    background: "var(--surface-dominant)",
  };

  const isEmptyWindow = items.length === 0 && issues.length === 0;

  return (
    <div style={{ height: "100%", display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
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
            const positionStyle: CSSProperties = {
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            };

            if (row.kind === "header") {
              const count = counts[BAND_COUNT_KEY[row.status]];
              return (
                <div key={virtualRow.key} style={positionStyle}>
                  <StatusBand
                    label={BAND_LABEL[row.status]}
                    count={count}
                    collapsed={Boolean(collapsedByStatus[row.status])}
                    onToggleCollapsed={() => toggleCollapsed(projectId ?? "", row.status)}
                  />
                </div>
              );
            }

            if (row.kind === "quick-add") {
              return (
                <div key={virtualRow.key} style={positionStyle}>
                  <QuickAdd
                    autoFocus
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
                // `prefers-reduced-motion` zeroes `--duration-displace` (motion.css), so the
                // state change still applies instantly rather than being removed.
                className="displace-transition"
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
                  setSize={counts[BAND_COUNT_KEY[row.item.status as BandStatus]]}
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
                className="type-body"
                onClick={emptyState.onCta}
                style={{
                  padding: "var(--space-xs) var(--space-md)",
                  borderRadius: "var(--radius-chrome)",
                  border: "1px solid var(--divider)",
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
              status: selectedItem.status,
              projectId,
            } satisfies DetailItem
          }
          onClose={() => setDetailItemId(null)}
          onUpdateTitle={(title) =>
            updateItem.mutate({ kind: selectedItem.kind ?? "task", id: selectedItem.id, title })
          }
          onSetStatus={(status) => requestStatusChange(selectedItem.kind ?? "task", selectedItem.id, status)}
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
