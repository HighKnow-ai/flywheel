/**
 * The worktree inventory (Phase 10 plan 10-08, WORK-07, D-177/D-178): every task worktree across every
 * registered project with how much disk it uses, how old that figure is, and a chip plus a named reason
 * for what can be done with it. Pushed into the shell and popped back out of like the fleet surface;
 * `App.tsx` mounts it. It is READ-ONLY: the multi-select and the reclaim batch are plan 10-09's.
 *
 * The Rust core derives the disposition and its reason (`reclaim_eligibility`) and orders the list
 * (size descending, task key ascending); this file only renders them. A size is the core's cached
 * measurement and is always shown with its age (D-116's grammar: a figure is labelled with how old it is,
 * never pretended live). A worktree that was never measured renders BLANK, never `0 B`: absence is not
 * zero. Sizes are binary (KiB, MiB, GiB) with one decimal above a kibibyte, since they are allocated
 * blocks and `du` reports them the same way.
 *
 * The inventory lists TASK worktrees only. An epic's integration worktree is a real directory under the
 * same root but has no `worktrees` row (`task_id` is unique and not null), so it cannot appear here; the
 * empty state says so rather than letting the user conclude the directories are gone.
 */
import { useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { worktreeMeasure, type WorktreeInventoryRowDto, type InventoryReason } from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import { formatAge } from "../legend/runStatus";
import { useWorktreeInventory, worktreeInventoryQueryKey } from "./useFleet";
import "../styles/admin-surfaces.css";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** Every reason the core's `ReclaimReason` can return, so a test can prove each one has a word. */
export const RECLAIM_REASONS: readonly InventoryReason[] = [
  "task_done",
  "merged",
  "agent_running",
  "blocked",
  "uncommitted_changes",
  "project_unreachable",
  "directory_missing",
  "task_open",
];

/** The word printed beside the chip for each reason. */
export const RECLAIM_REASON_WORDS: Record<InventoryReason, string> = {
  task_done: "task done",
  merged: "merged into its epic",
  agent_running: "agent running",
  blocked: "agent blocked on you",
  uncommitted_changes: "uncommitted changes",
  project_unreachable: "project unreachable",
  directory_missing: "directory missing",
  task_open: "task still open",
};

const CHIP_MARK_IDS = {
  reclaimable: "worktree-reclaimable",
  in_use: "worktree-in-use",
  keep: "worktree-keep",
} as const;

const UNITS = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** A byte count as `512 B`, `4.0 KiB`, `1.4 GiB`. Only ever called with a measured size. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return unit === 0 ? `${bytes} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
}

/** The age of a measurement: `measured 3m ago`, via the fleet's own compact age. */
export function formatMeasuredAge(measuredAtIso: string, nowMs: number): string {
  return `measured ${formatAge(measuredAtIso, nowMs)} ago`;
}

function Chip({ row }: { row: WorktreeInventoryRowDto }) {
  const mark = MARKS_BY_ID[CHIP_MARK_IDS[row.disposition]];
  return (
    <span data-field="disposition" data-disposition={row.disposition} style={{ display: "inline-flex", gap: "var(--space-xs)", alignItems: "center" }}>
      <span className="type-label" style={{ display: "inline-flex", gap: "var(--space-xs)", alignItems: "center" }}>
        <Icon name={mark.glyph} />
        {mark.label}
      </span>
      <span data-field="reason" className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        {RECLAIM_REASON_WORDS[row.reason]}
      </span>
    </span>
  );
}

function Row({ row, now }: { row: WorktreeInventoryRowDto; now: number }) {
  return (
    <li
      data-worktree-row={row.taskId}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 1fr) minmax(80px, 100px) minmax(160px, 1.4fr) minmax(280px, 2fr)",
        gap: "var(--space-md)",
        alignItems: "center",
        padding: "var(--space-xs) var(--space-md)",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <span data-field="project" className="type-body" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.projectName}
      </span>
      <span data-field="task" className="type-label tabular-nums" title={row.taskTitle}>
        {row.taskKey}
      </span>
      <span data-field="size" className="type-body tabular-nums">
        {row.sizeBytes == null ? "" : formatBytes(row.sizeBytes)}
        {row.sizeBytes != null && row.sizeMeasuredAt != null && (
          <span data-field="measured" className="type-label" style={{ marginLeft: "var(--space-xs)", color: "var(--text-muted-rack)" }}>
            {formatMeasuredAge(row.sizeMeasuredAt, now)}
          </span>
        )}
      </span>
      <Chip row={row} />
    </li>
  );
}

export function WorktreeInventory({ onClose }: { onClose: () => void }) {
  const inventory = useWorktreeInventory();
  const queryClient = useQueryClient();
  const [measuring, setMeasuring] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const rows = inventory.data ?? [];
  const now = Date.now();

  const remeasure = async () => {
    setMeasuring(true);
    setNotice(null);
    try {
      const results = await worktreeMeasure();
      const incomplete = results.filter((r) => r.bounded || r.error !== null).length;
      if (incomplete > 0) {
        setNotice(
          `${incomplete} ${incomplete === 1 ? "worktree" : "worktrees"} could not be measured completely and ${
            incomplete === 1 ? "keeps" : "keep"
          } no size.`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
    } catch {
      setNotice("Could not measure the worktrees.");
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--text-primary-rack)" }}>
      <header className="admin-header">
        <button type="button" onClick={onClose} className="type-label admin-back">
          ← Board
        </button>
        <span className="type-heading">WORKTREES</span>
        <button type="button" className="type-label" disabled={measuring} onClick={() => void remeasure()}>
          {measuring ? "Measuring…" : "Re-measure sizes"}
        </button>
        <span
          className="type-label tabular-nums"
          aria-live="polite"
          style={{ marginLeft: "auto", color: "var(--text-muted-rack)" }}
        >
          {`${rows.length} ${rows.length === 1 ? "worktree" : "worktrees"}`}
        </span>
      </header>
      {notice !== null && (
        <p role="status" className="type-label" style={{ padding: "var(--space-xs) var(--space-md)", color: "var(--text-muted-rack)" }}>
          {notice}
        </p>
      )}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {inventory.isError ? (
          <p role="alert" className="type-body" style={{ padding: "var(--space-lg)", color: "var(--destructive-text-rack)" }}>
            Could not load the worktrees. It will retry on the next change.
          </p>
        ) : inventory.isSuccess && rows.length === 0 ? (
          <div style={{ padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            <span className="type-heading">No worktrees</span>
            <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
              A task gets a worktree when work starts on it, and it appears here. Only task worktrees are listed:
              an epic's integration worktree has no task, so it is not tracked here even though its directory
              exists.
            </span>
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {rows.map((row) => (
              <Row key={row.taskId} row={row} now={now} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
