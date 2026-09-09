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
import { StatusPicker } from "./pickers/StatusPicker";
import { ItemDetailPanel, type DetailItem } from "../item-detail/ItemDetailPanel";
import { useCollapseStore } from "./collapseStore";
import { useCreateIssue, useSetStatus, useUpdateItem } from "./useBoardQuery";
import type { BandCounts, BoardItem, IssueItem } from "./useBoardQuery";

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

export interface BoardViewProps {
  projectId?: string;
  items: BoardItem[];
  issues?: IssueItem[];
  counts: BandCounts;
  onCreateTask: (title: string) => void;
}

interface AnchorRect {
  top: number;
  left: number;
  bottom: number;
}

export function BoardView({ projectId, items, issues = [], counts, onCreateTask }: BoardViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const rowElRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [listFocused, setListFocused] = useState(false);
  const [statusPickerForId, setStatusPickerForId] = useState<string | null>(null);
  const [statusPickerAnchor, setStatusPickerAnchor] = useState<AnchorRect | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);

  // A stable module-level empty object — returning a fresh `{}` literal from the selector would
  // give Zustand's default reference-equality check a new value on every call, causing an
  // infinite re-render loop when no band is collapsed for this project yet.
  const collapsedByStatus =
    useCollapseStore((state) => state.collapsedByProject[projectId ?? ""]) ?? EMPTY_COLLAPSE;
  const toggleCollapsed = useCollapseStore((state) => state.toggle);

  const setStatus = useSetStatus(projectId);
  const updateItem = useUpdateItem(projectId);
  const createIssue = useCreateIssue(projectId);

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

  function openStatusPickerFor(id: string) {
    const el = rowElRefs.current.get(id);
    if (el) {
      const rect = el.getBoundingClientRect();
      setStatusPickerAnchor({ top: rect.top, left: rect.left, bottom: rect.bottom });
    }
    setStatusPickerForId(id);
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
    if (statusPickerForId || detailItemId) return; // overlays own their own keyboard handling
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
          openStatusPickerFor(selectedId);
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

  return (
    <div style={{ height: "100%", display: "flex" }}>
      <div
        className="board-view"
        ref={parentRef}
        style={{ ...containerStyle, flex: 1, minWidth: 0 }}
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
                  onSelect={() => setSelectedId(row.item.id)}
                  onOpenDetail={() => {
                    setSelectedId(row.item.id);
                    setDetailItemId(row.item.id);
                  }}
                  onOpenStatusPicker={() => {
                    setSelectedId(row.item.id);
                    openStatusPickerFor(row.item.id);
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

      {statusPickerForId &&
        statusPickerAnchor &&
        (() => {
          const pickedRow = selectableItems.find((r) => r.item.id === statusPickerForId)?.item;
          if (!pickedRow) return null;
          return (
            <StatusPicker
              currentStatus={pickedRow.status}
              anchorRect={statusPickerAnchor}
              onSelect={(status) => {
                setStatus.mutate({ kind: pickedRow.kind ?? "task", id: pickedRow.id, status });
                setStatusPickerForId(null);
              }}
              onClose={() => setStatusPickerForId(null)}
            />
          );
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
            } satisfies DetailItem
          }
          onClose={() => setDetailItemId(null)}
          onUpdateTitle={(title) =>
            updateItem.mutate({ kind: selectedItem.kind ?? "task", id: selectedItem.id, title })
          }
          onSetStatus={(status) =>
            setStatus.mutate({ kind: selectedItem.kind ?? "task", id: selectedItem.id, status })
          }
        />
      )}
    </div>
  );
}
