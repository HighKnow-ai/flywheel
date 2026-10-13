/**
 * The worktree inventory (Phase 10 plan 10-08, WORK-07, D-177/D-178): every task worktree across every
 * registered project with how much disk it uses, how old that figure is, and a chip plus a named reason
 * for what can be done with it. Pushed into the shell and popped back out of like the fleet surface;
 * `App.tsx` mounts it.
 *
 * Plan 10-09 (WORK-07, D-179) adds the reclaim: a checkbox on RECLAIMABLE rows only (an in-use or keep
 * row renders none, not a disabled one), a bar naming the count and the total bytes of the selection,
 * one confirmation, and a per-row result list. There is deliberately no select-all and no
 * reclaim-everything action: D-179 rejected it by name, because there would be no way to keep one. The
 * selection is ADVISORY. The core re-derives every row's eligibility when it acts, so a row an agent
 * started in since the list was read comes back refused and the view shows exactly that; the list is
 * refetched afterwards rather than edited locally, so what stays on screen is the server's current truth.
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
import { useRef, useState, type ComponentType } from "react";
import { createPortal } from "react-dom";
import * as icons from "lucide-react";
import { FocusScope } from "@radix-ui/react-focus-scope";
import { DismissableLayer } from "@radix-ui/react-dismissable-layer";
import { useQueryClient } from "@tanstack/react-query";
import {
  worktreeMeasure,
  worktreeReclaim,
  type InventoryReason,
  type ReclaimOutcomeDto,
  type WorktreeInventoryRowDto,
} from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import { formatAge } from "../legend/runStatus";
import { useWorktreeInventory, worktreeInventoryQueryKey } from "./useFleet";
import "../styles/admin-surfaces.css";
import "../styles/states-and-confirms.css";

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

/** The most worktrees one reclaim call may carry. The core refuses a longer list as a whole. */
export const RECLAIM_BATCH_CAP = 50;

/** One line of the result list: a snapshot of what the row was called when it was submitted, since a
 * removed row is gone from the refetched list. */
interface ResultLine {
  label: string;
  outcome: ReclaimOutcomeDto;
}

/** The sum of the measured sizes, and how many selected rows have no measurement. An unmeasured size
 * is absent, never zero, so the total says how many it leaves out. */
function selectionTotal(rows: WorktreeInventoryRowDto[]): { bytes: number; unmeasured: number } {
  let bytes = 0;
  let unmeasured = 0;
  for (const r of rows) {
    if (r.sizeBytes == null) unmeasured += 1;
    else bytes += r.sizeBytes;
  }
  return { bytes, unmeasured };
}

function totalWords({ bytes, unmeasured }: { bytes: number; unmeasured: number }, count: number): string {
  if (unmeasured === count) return "size not measured";
  return unmeasured === 0 ? formatBytes(bytes) : `${formatBytes(bytes)} measured, ${unmeasured} not measured`;
}

function worktreesWord(count: number): string {
  return `${count} ${count === 1 ? "worktree" : "worktrees"}`;
}

function outcomeWords(o: ReclaimOutcomeDto): string {
  if (o.removed) return "removed";
  if (o.reason != null) return `refused: ${RECLAIM_REASON_WORDS[o.reason]}`;
  return `refused: ${o.error ?? "not removed"}`;
}

/** The one confirmation (Dialog tier of the Overlay Rule: scrim, centred, asks for a decision). Cancel
 * holds the first focus and Escape or a click outside cancels, so a stray Enter cannot remove anything. */
function ReclaimConfirm({
  count,
  total,
  onConfirm,
  onCancel,
}: {
  count: number;
  total: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return createPortal(
    <FocusScope
      trapped
      loop
      asChild
      onMountAutoFocus={(event) => {
        event.preventDefault();
        cancelRef.current?.focus();
      }}
    >
      <DismissableLayer
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          onCancel();
        }}
        onPointerDownOutside={onCancel}
        asChild
      >
        <div role="alertdialog" aria-label={`Remove ${worktreesWord(count)}?`} className="confirm-scrim">
          <div className="type-body confirm-dialog">
            <h2 className="type-heading">Remove {worktreesWord(count)}?</h2>
            <p className="type-body">
              {total}. Their directories are removed from disk. Branches and commits are kept. A worktree with
              uncommitted changes, or one an agent has started in since the list was read, is refused and left
              alone.
            </p>
            <div className="confirm-actions">
              <button ref={cancelRef} type="button" autoFocus className="type-body control-edge confirm-action" onClick={onCancel}>
                Cancel
              </button>
              <button
                type="button"
                className="type-body control-edge confirm-action confirm-action-destructive"
                onClick={onConfirm}
              >
                <Icon name="Trash2" />
                Remove {worktreesWord(count)}
              </button>
            </div>
          </div>
        </div>
      </DismissableLayer>
    </FocusScope>,
    document.body,
  );
}

function ReclaimBar({
  rows,
  busy,
  onReclaim,
}: {
  rows: WorktreeInventoryRowDto[];
  busy: boolean;
  onReclaim: () => void;
}) {
  const over = rows.length > RECLAIM_BATCH_CAP;
  return (
    <div
      data-reclaim-bar
      className="type-body"
      style={{ display: "flex", gap: "var(--space-md)", alignItems: "center", padding: "var(--space-xs) var(--space-md)", borderBottom: "1px solid var(--divider)" }}
    >
      <span data-field="selection" className="tabular-nums">
        {`Reclaim ${worktreesWord(rows.length)} · ${totalWords(selectionTotal(rows), rows.length)}`}
      </span>
      {over && (
        <span role="status" className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          {`At most ${RECLAIM_BATCH_CAP} at a time.`}
        </span>
      )}
      <button type="button" className="type-label control-edge" disabled={busy || over} onClick={onReclaim}>
        {busy ? "Removing…" : "Reclaim"}
      </button>
    </div>
  );
}

function ReclaimResultList({ lines }: { lines: ResultLine[] }) {
  const removed = lines.filter((l) => l.outcome.removed).length;
  return (
    <section data-reclaim-result style={{ padding: "var(--space-xs) var(--space-md)", borderBottom: "1px solid var(--divider)" }}>
      <h3 className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        {`Result · ${removed} of ${lines.length} removed`}
      </h3>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {lines.map(({ label, outcome }) => (
          <li
            key={outcome.taskId}
            data-reclaim-outcome={outcome.removed ? "removed" : "refused"}
            data-task-id={outcome.taskId}
            className="type-body"
            style={{ display: "flex", gap: "var(--space-xs)", alignItems: "center" }}
          >
            <Icon name={outcome.removed ? "Check" : "X"} />
            <span>{label}</span>
            {" "}
            <span>{outcomeWords(outcome)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
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

function Row({
  row,
  now,
  selected,
  onToggle,
}: {
  row: WorktreeInventoryRowDto;
  now: number;
  selected: boolean;
  onToggle: () => void;
}) {
  return (
    <li
      data-worktree-row={row.taskId}
      style={{
        display: "grid",
        gridTemplateColumns: "20px minmax(120px, 1fr) minmax(80px, 100px) minmax(160px, 1.4fr) minmax(280px, 2fr)",
        gap: "var(--space-md)",
        alignItems: "center",
        padding: "var(--space-xs) var(--space-md)",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      {/* Only a reclaimable row can be selected. An in-use or keep row renders no checkbox at all: an
          affordance that looks live and is not is worse than its absence. */}
      {row.disposition === "reclaimable" ? (
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Select ${row.projectName} ${row.taskKey} for reclaim`}
        />
      ) : (
        <span aria-hidden="true" />
      )}
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [results, setResults] = useState<ResultLine[] | null>(null);
  const rows = inventory.data ?? [];
  const now = Date.now();
  // The selection can only ever name rows that are reclaimable in the CURRENT list, so a row that
  // came back in use after a refusal drops out of it instead of sitting selected and unselectable.
  const selectedRows = rows.filter((r) => r.disposition === "reclaimable" && selected.has(r.taskId));

  const toggle = (taskId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });

  const reclaim = async () => {
    setConfirming(false);
    setReclaiming(true);
    setNotice(null);
    const submitted = selectedRows.map((r) => ({ id: r.taskId, label: `${r.projectName} ${r.taskKey}` }));
    try {
      const outcomes = await worktreeReclaim(submitted.map((r) => r.id));
      const labels = new Map(submitted.map((r) => [r.id, r.label]));
      setResults(outcomes.map((outcome) => ({ label: labels.get(outcome.taskId) ?? outcome.taskId, outcome })));
      // Removed rows leave the selection; refused rows stay in it so a retry costs no re-selection.
      const gone = new Set(outcomes.filter((o) => o.removed).map((o) => o.taskId));
      setSelected((prev) => new Set([...prev].filter((id) => !gone.has(id))));
    } catch {
      setNotice("Could not reclaim the worktrees. Nothing is reported as removed; the list below is current.");
    } finally {
      setReclaiming(false);
      // Refetch rather than edit the list: a refused row reappears with its real disposition.
      await queryClient.invalidateQueries({ queryKey: worktreeInventoryQueryKey() });
    }
  };

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
      {selectedRows.length > 0 && (
        <ReclaimBar rows={selectedRows} busy={reclaiming} onReclaim={() => setConfirming(true)} />
      )}
      {results !== null && results.length > 0 && <ReclaimResultList lines={results} />}
      {confirming && selectedRows.length > 0 && (
        <ReclaimConfirm
          count={selectedRows.length}
          total={totalWords(selectionTotal(selectedRows), selectedRows.length)}
          onConfirm={() => void reclaim()}
          onCancel={() => setConfirming(false)}
        />
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
              <Row key={row.taskId} row={row} now={now} selected={selected.has(row.taskId)} onToggle={() => toggle(row.taskId)} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
