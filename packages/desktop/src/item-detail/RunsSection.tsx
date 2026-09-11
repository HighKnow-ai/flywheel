/**
 * The Runs section (02-UI-SPEC.md "Runs section", DATA-06/WORK-01/WORK-08/LINK-01) — a small
 * embedded section inside the item detail panel, following `ActivityTrail.tsx`'s embedded-list
 * shape and its relative-time-with-absolute-on-hover convention, reading through `useAgentRuns`
 * (`board/useBoardQuery.ts`, plan 02-07 Task 1).
 *
 * Absence is the design here too, matching `WorktreeSummary.tsx`'s own reasoning: a task with no
 * runs renders nothing at all, not an empty-state placeholder — the section's first appearance
 * IS the signal that work has started (State Inventory "No runs yet").
 *
 * Each row carries its run-status badge (glyph + word, resolved from `legend/marks.ts`'s `agent`
 * channel — the same published vocabulary `SessionSurface.tsx`'s own `RunStatusBadge` renders;
 * this file duplicates the small status/label/colour lookup tables locally rather than importing
 * SessionSurface's unexported component, following this codebase's own established per-file
 * duplication convention for small building blocks (`MONO_STACK` is already duplicated across
 * `FeedRow.tsx`/`RawLogView.tsx`/`SessionSurface.tsx`/`PermissionRequestCard.tsx`)), its relative
 * start time, a duration (terminal runs) or a live elapsed counter (running/blocked runs, ticking
 * once a second in its own isolated `RunRow` component so the tick never re-renders the whole
 * list), and its cost so far.
 *
 * `external_session_id` (D-30's session identity, plan 02-07/02-08's own SELECT-list extension —
 * see `key-decisions` in 02-08-SUMMARY.md) is rendered alongside the run's own identity in the
 * exact form `Run · session {external_session_id}` (02-UI-SPEC.md Discretion #1: one row carries
 * BOTH linked record types rather than a redundant third list) — a run with no session identity
 * yet renders "Run" alone, never a dangling "session" label.
 *
 * A blocked run's row mounts the compact `PermissionRequestCard` beneath it, reusing plan
 * 02-06's component — the ONE card, now living under the specific row it answers for rather than
 * as a generic panel-level mount (`ItemDetailPanel.tsx`'s prior compact mount, moved here).
 */
import { useEffect, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import { answerPermissionRequest, type RunSummaryDto } from "../adapters/tauri";
import { useAgentRuns, usePendingPermissionRequests } from "../board/useBoardQuery";
import { MARKS_BY_ID } from "../legend/marks";
import { PermissionRequestCard, type PermissionDecision } from "../session/PermissionRequestCard";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The five values `agent_runs.status` can hold (migration `0003_agent_runtime.sql`) — mirrors
 * `session/SessionSurface.tsx`'s own `RunStatus` type. */
export type RunStatus = "running" | "blocked" | "completed" | "failed" | "interrupted";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "interrupted"];

function isRunStatus(value: string): value is RunStatus {
  return value in RUN_STATUS_LABELS;
}

/** `agent_runs.status` -> the matching published `agent`-channel mark id (`legend/marks.ts`,
 * plan 02-03) — mirrors `SessionSurface.tsx`'s own lookup, never a second hand-typed glyph. */
const RUN_STATUS_MARK_ID: Record<RunStatus, string> = {
  running: "run-running",
  blocked: "run-blocked",
  completed: "run-completed",
  failed: "run-failed",
  interrupted: "run-interrupted",
};

/** 02-UI-SPEC.md's "Run Status" table — mirrors `SessionSurface.tsx`'s own colour lookup. */
const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  running: "var(--accent-text-rack)",
  blocked: "var(--blocked-text-rack)",
  completed: "var(--success-text-rack)",
  failed: "var(--destructive-text-rack)",
  interrupted: "var(--text-muted-rack)",
};

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

/** Resolve a Lucide icon by name — the same by-name pattern every other surface in this codebase
 * uses, so no icon component is ever named directly (this file's own structural verify gate). */
function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The glyph-and-word run-status badge — never colour alone (T-02-17). Mirrors
 * `SessionSurface.tsx`'s own `RunStatusBadge`, duplicated locally per this file's own doc
 * comment above. */
function RunStatusBadge({ status }: { status: RunStatus }) {
  const mark = MARKS_BY_ID[RUN_STATUS_MARK_ID[status]];
  const pulsing = status === "running" && !prefersReducedMotion();
  return (
    <span
      className="type-label"
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", color: RUN_STATUS_COLOR[status] }}
    >
      <span aria-hidden="true" className={pulsing ? "agent-pulse" : undefined} style={{ display: "inline-flex" }}>
        <Icon name={mark?.glyph ?? "Circle"} />
      </span>
      {RUN_STATUS_LABELS[status]}
    </span>
  );
}

function formatCostUsd(value: number | null | undefined): string {
  return value == null ? "—" : `$${value.toFixed(4)}`;
}

/** A relative "Xm/Xh/Xd ago" label, the absolute timestamp carried in the entry's own `title`
 * attribute — mirrors `ActivityTrail.tsx`'s own `relativeTime`, duplicated locally per this
 * file's doc comment above. */
function relativeTime(iso: string): string {
  const deltaSeconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (deltaSeconds < 60) return "just now";
  const minutes = Math.round(deltaSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  return `${months}mo ago`;
}

/** `mm:ss` between two ISO timestamps — a terminal run's fixed duration. */
function formatSpan(startIso: string, endMs: number): string {
  const startMs = new Date(startIso).getTime();
  const deltaSeconds = Math.max(0, Math.round((endMs - startMs) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const seconds = deltaSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Re-renders once a second while `enabled` — mirrors `SessionSurface.tsx`'s own `useNowTick`,
 * duplicated locally so a running/blocked row's own elapsed counter never re-renders the whole
 * Runs section (the same isolated-re-render-boundary discipline `StatusStrip` established). */
function useNowTick(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}

async function handleAnswerPermission(requestId: string, decision: PermissionDecision) {
  await answerPermissionRequest(requestId, decision);
}

/** One run row, its own component so the elapsed-counter tick (running/blocked runs only) stays
 * an isolated re-render boundary rather than ticking the whole `RunsSection` list every second.
 *
 * `isActive` (plan 02-08 Task 3) marks the currently active/most-recent run — `RunsSection`'s
 * own first (newest) row, by construction of the newest-first read. That row alone carries the
 * primary `Watch Live`/`View` action button, the same visual weight `ItemDetailPanel.tsx`'s own
 * `Start Work` button carries when no run is active. Selecting any OTHER row (not the button —
 * the row itself) opens that run read-only in the same session surface (02-UI-SPEC.md "Runs
 * section": "no separate history viewer is built"). Both paths call the SAME `onOpenRun`
 * callback with the run's own id — there is exactly one way this component ever asks its caller
 * to open a run. */
function RunRow({
  run,
  isActive,
  onOpenRun,
}: {
  run: RunSummaryDto;
  isActive: boolean;
  onOpenRun: (agentRunId: string) => void;
}) {
  const status: RunStatus = isRunStatus(run.status) ? run.status : "running";
  const isTerminal = TERMINAL_STATUSES.includes(status);
  const isBlocked = status === "blocked";
  const now = useNowTick(!isTerminal);
  const absolute = new Date(run.startedAt).toLocaleString();

  const durationLabel = isTerminal && run.endedAt ? formatSpan(run.startedAt, new Date(run.endedAt).getTime()) : formatSpan(run.startedAt, now);

  const identityLine = run.externalSessionId ? `Run · session ${run.externalSessionId}` : "Run";

  // The compact permission-request card mounts under a blocked run's OWN row (02-UI-SPEC.md
  // "Runs section") — reusing the SAME `usePendingPermissionRequests(agentRunId)` query every
  // other mount point reads (Discretion #6), so answering here clears the session feed's `feed`
  // mount within one pushed-delta cycle. Disabled entirely for a non-blocked row (`enabled` guard
  // inside the hook itself).
  const pendingQuery = usePendingPermissionRequests(isBlocked ? run.id : undefined);
  const pendingRequests = pendingQuery.data ?? [];

  return (
    <div
      role="listitem"
      aria-label={identityLine}
      onClick={() => onOpenRun(run.id)}
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0, cursor: "pointer" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)", minWidth: 0 }}>
        <RunStatusBadge status={status} />
        <time
          className="type-label tabular-nums"
          dateTime={run.startedAt}
          title={absolute}
          style={{ color: "var(--text-muted-rack)" }}
        >
          {relativeTime(run.startedAt)}
        </time>
        <span
          className="type-label tabular-nums"
          aria-label={isTerminal ? "Duration" : "Elapsed time"}
          style={{ color: "var(--text-muted-rack)", minWidth: 48, textAlign: "right" }}
        >
          {durationLabel}
        </span>
        <span
          className="type-label tabular-nums"
          aria-label="Cost so far"
          style={{ color: "var(--text-muted-rack)", minWidth: 64, textAlign: "right" }}
        >
          {formatCostUsd(run.costUsd)}
        </span>
        {isActive && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onOpenRun(run.id);
            }}
            className="type-body"
            style={{
              marginLeft: "auto",
              background: "var(--accent-nontext)",
              border: "none",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: "pointer",
            }}
          >
            {isTerminal ? "View" : "Watch Live"}
          </button>
        )}
      </div>
      <span className="type-label" style={{ fontFamily: MONO_STACK, color: "var(--text-muted-rack)" }}>
        {identityLine}
      </span>
      {isBlocked && pendingRequests.length > 0 && (
        <div onClick={(event) => event.stopPropagation()}>
          <PermissionRequestCard variant="compact" requests={pendingRequests} onAnswer={handleAnswerPermission} />
        </div>
      )}
    </div>
  );
}

export interface RunsSectionProps {
  taskId: string;
  /** Called with an `agent_runs.id` whenever the user selects a run to open — either the active
   * row's primary `Watch Live`/`View` button, or any other row (plan 02-08 Task 3). The caller
   * (`ItemDetailPanel.tsx` -> `board/BoardView.tsx`) routes this into the ONE session surface,
   * live or terminal — this component itself decides nothing about routing. */
  onOpenRun: (agentRunId: string) => void;
}

/** The Runs section's own maximum height (E5 `overflow`) — a task with many runs scrolls WITHIN
 * this section rather than growing the panel unbounded; the bounded server-side read (plan 02-07
 * Task 1, `AGENT_RUNS_FOR_TASK_MAX_LIMIT`) already caps how much this could ever need to hold. */
const RUNS_LIST_MAX_HEIGHT = 320;

export function RunsSection({ taskId, onOpenRun }: RunsSectionProps) {
  const runsQuery = useAgentRuns(taskId);

  // E5 `loading`: render nothing while the read is in flight, for the same reason
  // `WorktreeSummary.tsx` does — the section's appearance means "there is a run."
  if (runsQuery.isPending) return null;

  const runs = runsQuery.data ?? [];

  // E5 `empty`: no runs yet — the section does not exist, not an empty-state placeholder.
  if (runs.length === 0) return null;

  return (
    <section aria-label="Runs" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}>
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          Runs
        </span>
      </header>
      <div
        role="list"
        aria-label="Agent runs"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-md)",
          maxHeight: RUNS_LIST_MAX_HEIGHT,
          overflowY: "auto",
          minWidth: 0,
        }}
      >
        {runs.map((run, index) => (
          <RunRow key={run.id} run={run} isActive={index === 0} onOpenRun={onOpenRun} />
        ))}
      </div>
    </section>
  );
}
