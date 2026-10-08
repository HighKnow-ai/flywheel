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
import { useEffect, useRef, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import {
  acknowledgeAgentRun,
  answerPermissionRequest,
  type RunSummaryDto,
  type SessionSummaryDto,
} from "../adapters/tauri";
import { useAgentRuns, usePendingPermissionRequests, useTaskSessionSummaries } from "../board/useBoardQuery";
import { MARKS_BY_ID } from "../legend/marks";
import { PermissionRequestCard, type PermissionDecision } from "../session/PermissionRequestCard";
import "./item-detail.css";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The six values `agent_runs.status` can hold (migration `0003_agent_runtime.sql`, `abandoned`
 * added by migration `0006_recovery_statuses.sql`, D-49) — mirrors `session/SessionSurface.tsx`'s
 * own `RunStatus` type. */
export type RunStatus = "running" | "blocked" | "completed" | "failed" | "interrupted" | "abandoned";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  abandoned: "Abandoned",
};

const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "interrupted", "abandoned"];

function isRunStatus(value: string): value is RunStatus {
  return value in RUN_STATUS_LABELS;
}

/** `agent_runs.status` -> the matching published `agent`-channel mark id (`legend/marks.ts`,
 * plan 02-03; `abandoned` added plan 03-10, D-49) — mirrors `SessionSurface.tsx`'s own lookup,
 * never a second hand-typed glyph. */
const RUN_STATUS_MARK_ID: Record<RunStatus, string> = {
  running: "run-running",
  blocked: "blocked-indicator",
  completed: "run-completed",
  failed: "run-failed",
  interrupted: "run-interrupted",
  abandoned: "run-abandoned",
};

/** 02-UI-SPEC.md's "Run Status" table, extended by 03-UI-SPEC.md's "Color Additions" (`abandoned`
 * reuses the same `--destructive-text-rack` token `failed` already spends this budget on — zero
 * new colour tokens, distinguished by glyph and word alone) — mirrors `SessionSurface.tsx`'s own
 * colour lookup. */
const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  running: "var(--accent-text-rack)",
  blocked: "var(--blocked-text-rack)",
  completed: "var(--success-text-rack)",
  failed: "var(--destructive-text-rack)",
  interrupted: "var(--text-muted-rack)",
  abandoned: "var(--destructive-text-rack)",
};

/** The abandoned-run explanation + Acknowledge button's own answering/error state
 * (`session/PermissionRequestCard.tsx`'s `RowState` pattern) — guards a second press while
 * `acting`, and on failure leaves the button mounted with an inline message rather than clearing
 * optimistically (03-UI-SPEC.md E4 `error`, decided as a backstop: "the button stays mounted"). */
interface AcknowledgeState {
  acting: boolean;
  error: string | null;
}

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

/**
 * A run's own summary, mounted under its row (plan 04-09 Task 3) — resolves CONTEXT.md's open
 * question about where summaries render: not a separate top-level list, but a small card under
 * the specific run that produced it, the same way `PermissionRequestCard` mounts under a blocked
 * run's own row. A run with no summary renders no card (the caller never mounts this component
 * for one) — absence renders nothing, matching this file's own "renders nothing, not a
 * placeholder" convention.
 */
function SessionSummaryCard({ summary }: { summary: SessionSummaryDto }) {
  const fileCount = summary.changedFiles.length;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
      <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        Summary · {fileCount} file{fileCount === 1 ? "" : "s"} changed
        {summary.autoGenerated && <> · auto-generated</>}
      </span>
      {summary.remains && (
        <p className="type-body" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          Remains: {summary.remains}
        </p>
      )}
      {summary.nextSessionMustKnow && (
        <p className="type-body" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          Next session must know: {summary.nextSessionMustKnow}
        </p>
      )}
    </div>
  );
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
  summary,
}: {
  run: RunSummaryDto;
  isActive: boolean;
  onOpenRun: (agentRunId: string) => void;
  /** This run's own summary, or `undefined` when none exists yet (plan 04-09 Task 3) — renders
   * no card at all rather than a placeholder. */
  summary: SessionSummaryDto | undefined;
}) {
  const status: RunStatus = isRunStatus(run.status) ? run.status : "running";
  const isTerminal = TERMINAL_STATUSES.includes(status);
  const isBlocked = status === "blocked";
  const isAbandoned = status === "abandoned";
  const now = useNowTick(!isTerminal);
  const absolute = new Date(run.startedAt).toLocaleString();

  // D-49/D-50's abandoned-run explanation and its one Acknowledge action — changes nothing about
  // the underlying record (the run is already abandoned, already terminal, already exactly what
  // it will remain); acknowledging is a statement that the user has seen it, not a repair.
  const [ackState, setAckState] = useState<AcknowledgeState>({ acting: false, error: null });
  // `ackState.acting` alone is not a sufficient guard against two clicks arriving in the same
  // synchronous tick (React's state update has not necessarily flushed to the DOM, and the
  // `disabled` attribute with it, before a second `.click()` fires) — mirrors
  // `item-detail/WorktreeSummary.tsx`'s own `actingRef` fix (plan 03-09) for the identical bug,
  // found here by this task's own failing test before it was anticipated by the plan.
  const ackActingRef = useRef(false);

  async function acknowledge() {
    if (ackActingRef.current) return;
    ackActingRef.current = true;
    setAckState({ acting: true, error: null });
    try {
      await acknowledgeAgentRun(run.id);
      // No local success state to set: the command's own board:changed emit invalidates
      // useAgentRuns, which re-reads and the row's own acknowledgedAt flips non-null — that
      // re-render is what removes this button, never a local optimistic flag.
    } catch {
      ackActingRef.current = false;
      setAckState({ acting: false, error: "Couldn't acknowledge this run. Try again." });
    }
  }

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
      className="run-row"
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
            // The Runs section's one leading action: the 2px ink edge (item-detail.css), as Start Work has.
            className="type-body control-edge detail-action detail-action-lead"
            style={{ marginLeft: "auto" }}
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
      {summary && (
        <div onClick={(event) => event.stopPropagation()}>
          <SessionSummaryCard summary={summary} />
        </div>
      )}
      {isAbandoned && (
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            {run.abandonedReason
              ? `Flywheel wasn't running to supervise this session — it was stopped at ${new Date(
                  run.abandonedReason,
                ).toLocaleString()} because Flywheel had died.`
              : "This run never finished, and Flywheel doesn't know why it stopped."}
          </span>
          {!run.acknowledgedAt && (
            <button
              type="button"
              disabled={ackState.acting}
              onClick={(event) => {
                event.stopPropagation();
                void acknowledge();
              }}
              className="type-body control-edge detail-action"
              style={{
                alignSelf: "flex-start",
                cursor: ackState.acting ? "default" : "pointer",
                opacity: ackState.acting ? 0.6 : 1,
              }}
            >
              Acknowledge
            </button>
          )}
          {ackState.error && (
            <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
              {ackState.error}
            </p>
          )}
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
  // Plan 04-09 Task 3: a run's own summary card mounts under its row, resolved from this SAME
  // task-scoped read for every run at once (never a per-run query) — a task with ten runs
  // resolves ten cards from one read, not ten.
  const summariesQuery = useTaskSessionSummaries(taskId);

  // E5 `loading`: render nothing while the read is in flight, for the same reason
  // `WorktreeSummary.tsx` does — the section's appearance means "there is a run."
  if (runsQuery.isPending) return null;

  const runs = runsQuery.data ?? [];

  // E5 `empty`: no runs yet — the section does not exist, not an empty-state placeholder.
  if (runs.length === 0) return null;

  const summariesByRunId = new Map((summariesQuery.data ?? []).map((summary) => [summary.agentRunId, summary]));

  return (
    <section aria-label="Runs" style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}>
      <header className="detail-section-head">
        <span className="type-body detail-section-title">Runs</span>
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
          <RunRow
            key={run.id}
            run={run}
            isActive={index === 0}
            onOpenRun={onOpenRun}
            summary={summariesByRunId.get(run.id)}
          />
        ))}
      </div>
    </section>
  );
}
