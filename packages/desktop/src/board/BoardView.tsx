/**
 * The virtualized rack: fixed-height strips grouped into the five fixed status bands
 * (01-UI-SPEC.md "Board list", "Selected Direction"). Never horizontal columns — one vertical
 * rack, grouped into bands, sticky stamped band headers carrying their counts.
 *
 * Virtualization uses a single constant `estimateSize` (no `measureElement`) and overscan 8-12
 * rows (01-UI-SPEC.md "Performance Contract"). Band headers share the same fixed row height as
 * item rows so the whole rack stays one uniform virtualized list — no per-row height branching.
 */
import { useMemo, useRef, type CSSProperties } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { BoardRow, ROW_HEIGHT } from "./BoardRow";
import { QuickAdd } from "./QuickAdd";
import type { BandCounts, BoardItem } from "./useBoardQuery";

const BAND_ORDER = ["backlog", "todo", "in_progress", "in_review", "done"] as const;
type BandStatus = (typeof BAND_ORDER)[number];

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
  items: BoardItem[];
  counts: BandCounts;
  onCreateTask: (title: string) => void;
}

export function BoardView({ items, counts, onCreateTask }: BoardViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rows = useMemo<RackRow[]>(() => {
    const byStatus = new Map<BandStatus, BoardItem[]>();
    for (const status of BAND_ORDER) byStatus.set(status, []);
    for (const item of items) {
      byStatus.get(item.status as BandStatus)?.push(item);
    }

    const out: RackRow[] = [];
    for (const status of BAND_ORDER) {
      out.push({ kind: "header", status });
      // Quick-add lives at the top of Backlog — the band new work always enters (D-09).
      if (status === "backlog") {
        out.push({ kind: "quick-add" });
      }
      for (const item of byStatus.get(status) ?? []) {
        out.push({ kind: "item", item });
      }
    }
    return out;
  }, [items]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  const containerStyle: CSSProperties = {
    height: "100%",
    overflow: "auto",
    background: "var(--surface-dominant)",
  };

  return (
    <div className="board-view" ref={parentRef} style={containerStyle} role="list" aria-label="Board">
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
              <div
                key={virtualRow.key}
                style={{
                  ...positionStyle,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "0 var(--space-md)",
                  background: "var(--surface-secondary)",
                  color: "var(--text-primary-rack)",
                }}
                className="type-heading"
              >
                <span>{BAND_LABEL[row.status]}</span>
                <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
                  {count}
                </span>
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
            <div key={virtualRow.key} style={positionStyle}>
              <BoardRow item={row.item} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
