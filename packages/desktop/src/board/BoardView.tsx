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
 */
import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BoardRow, ROW_HEIGHT } from "./BoardRow";
import { StatusBand } from "./StatusBand";
import { IssuesLane } from "./IssuesLane";
import { QuickAdd } from "./QuickAdd";
import { DoneWarning } from "./DoneWarning";
import { StatusPicker } from "./pickers/StatusPicker";
import { PriorityPicker } from "./pickers/PriorityPicker";
import { EstimatePicker } from "./pickers/EstimatePicker";
import { AssigneePicker } from "./pickers/AssigneePicker";
import { ItemDetailPanel, type DetailItem } from "../item-detail/ItemDetailPanel";
import { useCollapseStore } from "./collapseStore";
import {
  useActors,
  useCreateIssue,
  useReorderItem,
  useSetAssignee,
  useSetEstimate,
  useSetPriority,
  useSetStatus,
  useUpdateItem,
} from "./useBoardQuery";
import type { Actor, BandCounts, BoardItem, BoardItemKind, IssueItem } from "./useBoardQuery";

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
  | { kind: "item"; item: BoardItem };

/** Which row-level picker is open, if any. One piece of state covers all four (status, priority,
 * estimate, assignee) rather than four parallel `useState` triples — they share the same
 * open/anchor/close shape. */
type PickerKind = "status" | "priority" | "estimate" | "assignee";

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
  onCreateTask: (title: string) => void;
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listFocused, setListFocused] = useState(false);
  const [activePicker, setActivePicker] = useState<{ kind: PickerKind; id: string } | null>(null);
  const [pickerAnchor, setPickerAnchor] = useState<AnchorRect | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  // D-08: moving an item to Done with unchecked criteria warns but never blocks. The pending
  // change is held here rather than applied optimistically — `DoneWarning`'s Escape "reverts the
  // status change" by the mutation simply never having been sent (01-UI-SPEC.md State Inventory).
  const [pendingDone, setPendingDone] = useState<{
    kind: BoardItemKind;
    id: string;
    status: string;
    checked: number;
    total: number;
  } | null>(null);

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
  const reorderItem = useReorderItem(projectId);
  const updateItem = useUpdateItem(projectId);
  const createIssue = useCreateIssue(projectId);

  // The `AssigneePicker`'s roster (BOARD-06) and the id -> actor lookup `BoardRow` resolves its
  // avatar/badge from — fetched once here, never by the row or the picker itself (opening a
  // picker issues no command; see `AssigneePicker.tsx`'s own doc comment).
  const actorsQuery = useActors();
  const actors = actorsQuery.data ?? [];
  const actorsById = useMemo<Record<string, Actor>>(
    () => Object.fromEntries(actors.map((actor) => [actor.id, actor])),
    [actors],
  );

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
      if (status === "backlog") {
        out.push({ kind: "quick-add" });
      }
      for (const item of byStatus.get(status) ?? []) {
        out.push({ kind: "item", item });
      }
    }
    return out;
  }, [items, collapsedByStatus]);

  const selectableItems = useMemo(
    () => rows.filter((r): r is { kind: "item"; item: BoardItem } => r.kind === "item"),
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

  function moveSelection(delta: number) {
    if (selectableItems.length === 0) return;
    const currentIndex = selectableItems.findIndex((r) => r.item.id === selectedId);
    const nextIndex =
      currentIndex === -1
        ? delta > 0
          ? 0
          : selectableItems.length - 1
        : Math.min(Math.max(currentIndex + delta, 0), selectableItems.length - 1);
    setSelectedId(selectableItems[nextIndex]?.item.id ?? null);
  }

  function handleContainerKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (activePicker || detailItemId) return; // overlays own their own keyboard handling

    // ⌘↑ / ⌘↓ reorder (D-11, BOARD-05) — checked ahead of the plain-arrow selection-move case
    // below, since both share the same base key.
    if (event.metaKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      if (selectedId) {
        event.preventDefault();
        reorderSelected(event.key === "ArrowUp" ? "up" : "down");
      }
      return;
    }

    switch (event.key) {
      case "j":
      case "ArrowDown":
        event.preventDefault();
        moveSelection(1);
        break;
      case "k":
      case "ArrowUp":
        event.preventDefault();
        moveSelection(-1);
        break;
      case "Home":
        event.preventDefault();
        setSelectedId(selectableItems[0]?.item.id ?? null);
        break;
      case "End":
        event.preventDefault();
        setSelectedId(selectableItems[selectableItems.length - 1]?.item.id ?? null);
        break;
      case "Enter":
      case "o":
        if (selectedId) {
          event.preventDefault();
          setDetailItemId(selectedId);
        }
        break;
      case "s":
        if (selectedId) {
          event.preventDefault();
          openPickerFor("status", selectedId);
        }
        break;
      case "p":
        if (selectedId) {
          event.preventDefault();
          openPickerFor("priority", selectedId);
        }
        break;
      case "e":
        if (selectedId) {
          event.preventDefault();
          openPickerFor("estimate", selectedId);
        }
        break;
      case "a":
        if (selectedId) {
          event.preventDefault();
          openPickerFor("assignee", selectedId);
        }
        break;
      case "Escape":
        setSelectedId(null);
        break;
      default:
        break;
    }
  }

  const selectedItem = selectableItems.find((r) => r.item.id === selectedId)?.item;

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
                  <QuickAdd onCreate={onCreateTask} />
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
          const pickedRow = selectableItems.find((r) => r.item.id === activePicker.id)?.item;
          if (!pickedRow) return null;
          const kind = pickedRow.kind ?? "task";
          const closePicker = () => setActivePicker(null);

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
    </div>
  );
}
