/**
 * The fleet surface (Phase 10 plan 10-01, FLEET-01/FLEET-04, D-163..D-170): every agent run across every
 * registered project in one flat list, in three fixed bands — NEEDS YOU, RUNNING, DONE / FAILED — with
 * the project as a COLUMN, never a grouping (D-164: a blocked agent in the fourth project must not fall
 * below the fold). Pushed into the shell and popped back out of like the session, triage, review and
 * settings surfaces (D-163); `App.tsx` mounts it.
 *
 * The Rust core does the banding, the ordering and the count (D-03): `useFleet` returns rows already in
 * band order, longest-waiting first, and this file only groups consecutive rows by `bandForState`. The
 * state vocabulary (word, mark, colour role) comes from `legend/runStatus.ts` — the one module that owns
 * it (Finding 14) — so a state is always a glyph plus a word, never colour alone.
 *
 * Elapsed times tick from `startedAt` on ONE interval for the whole list; no IPC per second (D-171).
 * A live row also carries its activity cell (plan 10-03, D-167): the newest feed row of that run's own
 * log, built by the session feed's `buildFeedRows` and worded by its `feedRowText`, so the fleet and
 * the session never tell different stories about the same moment. A row's primary
 * action is its session (plan 10-06, D-166); see `FleetRowView`.
 *
 * Plan 10-04 adds what a finished row cost (`SpendCell`), the labelled fleet total (`FleetFooter`) and
 * the dismiss actions. Dismissing is the user's explicit act and nothing else clears a row: opening a
 * session, a refresh and a restart all leave it (D-165). Plan 10-06 gives the list a selection model
 * (`j`/`k`, Enter) for the jumps; dismissal still has NO key — that restates 10-04's choice rather than
 * lifting it, because a key that clears the selected row one keystroke from Enter is how a finished run
 * gets cleared by accident. Dismiss stays a focusable button.
 */
import { useEffect, useState, type ComponentType, type MouseEvent } from "react";
import * as icons from "lucide-react";
import { acknowledgeAgentRun, agentRunAcknowledgeMany, type FleetActivityDto, type FleetRowDto } from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import {
  FLEET_BANDS,
  RUN_STATUS_COLOR_ROLES,
  RUN_STATUS_LABELS,
  RUN_STATUS_MARK_IDS,
  bandForState,
  formatAge,
  formatCostUsd,
  formatCount,
  isFleetState,
  isRunStatus,
  type FleetBandId,
  type FleetState,
} from "../legend/runStatus";
import { feedRowText } from "../session/FeedRow";
import { buildFeedRows } from "../session/SessionSurface";
import { nextSelectionId, useRegionBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import { BlockedQueue } from "./BlockedQueue";
import { useBlockedQueue, useFleet } from "./useFleet";
import "../styles/admin-surfaces.css";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** One clock for the whole list, ticking once a second while there is anything to age. */
function useNowTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** Grid shared by the header-less rows so the columns line up down the whole list. */
const ROW_COLUMNS = "minmax(150px, 190px) minmax(80px, 140px) 1fr minmax(120px, 1.4fr) minmax(90px, 1fr) 64px 76px";

/** The activity line's width in characters, ellipsis at the TAIL — the start of a line (the tool, the
 * first clause) is what says what the agent is doing. Applied to every row kind alike. */
export const ACTIVITY_MAX_CHARS = 80;

/** The mark for a value that could not be read — the same dash `formatAge` and `formatCostUsd` use. */
const ABSENT = "\u2014";

/** The first clause of narration: up to the first sentence or clause break, or the first line. */
function firstClause(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  const match = /[.!?:;]\s/.exec(firstLine);
  return match ? firstLine.slice(0, match.index + 1) : firstLine;
}

function clip(text: string): string {
  return text.length > ACTIVITY_MAX_CHARS ? `${text.slice(0, ACTIVITY_MAX_CHARS - 1)}\u2026` : text;
}

/** One tail line as the entry the feed expects: its parsed JSON, or the same `unknown` fallback
 * `session_log.rs` makes for a line that is not JSON (a line is never dropped). */
function parseTailLine(line: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(line);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // falls through to the unknown entry
  }
  return { type: "unknown", raw: line };
}

/** The one line a live row shows: the newest feed row of the tail, or `null` when there is none (an
 * empty tail, a tail that did not fit the window, or one that normalises to no row at all). */
export function activityLine(activity: FleetActivityDto): string | null {
  if (activity.truncated || activity.lines.length === 0) return null;
  const rows = buildFeedRows(activity.lines.map(parseTailLine));
  const last = rows[rows.length - 1];
  if (!last) return null;
  const text = feedRowText(last);
  const line = last.kind === "assistant_text" ? firstClause(text) : text;
  return line.trim() === "" ? null : clip(line);
}

/** A live row's activity, or an explicit dash when it cannot be read — never the line it used to have:
 * the text is derived from this render's tail alone. A terminal row renders nothing. */
function ActivityCell({ row }: { row: FleetRowDto }) {
  if (row.runStatus !== "running" && row.runStatus !== "blocked") return <span data-field="activity" />;
  const line = activityLine(row.activity);
  return line === null ? (
    <span
      data-field="activity"
      data-absent="true"
      title="No activity could be read"
      style={{ color: "var(--text-muted-rack)" }}
    >
      {ABSENT}
    </span>
  ) : (
    <span
      data-field="activity"
      title={line}
      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--text-muted-rack)" }}
    >
      {line}
    </span>
  );
}

/** A run that has ended: the only kind that can be dismissed. A live run can be stopped, not cleared. */
function isTerminalRun(row: FleetRowDto): boolean {
  return row.runStatus !== "running" && row.runStatus !== "blocked";
}

/** What a finished run cost. Blank — an empty span, no text — for a live run and for a figure that
 * never arrived: an honest absence, never `$0.00` and never the dash `formatAge` uses for "no time".
 * A failed run keeps what it spent before it failed. `tokensIn` is a sum that includes cache reads
 * (Finding 11), so it is labelled as such and reads larger than the prompt. */
export function SpendCell({ row }: { row: FleetRowDto }) {
  if (!isTerminalRun(row)) return <span data-field="spend" />;
  const tokens =
    row.tokensIn == null && row.tokensOut == null
      ? null
      : [
          row.tokensIn == null ? null : `${formatCount(row.tokensIn)} in incl. cache`,
          row.tokensOut == null ? null : `${formatCount(row.tokensOut)} out`,
        ]
          .filter((part) => part !== null)
          .join(" \u00b7 ");
  return (
    <span
      data-field="spend"
      className="tabular-nums"
      style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
    >
      {row.costUsd != null && <span title="Estimated cost, not a billed amount">{formatCostUsd(row.costUsd)}</span>}
      {row.costUsd != null && tokens ? " " : ""}
      {tokens && (
        <span
          className="type-label"
          title="Input tokens include cache reads, so this is larger than the prompt size"
          style={{ color: "var(--text-muted-rack)" }}
        >
          {tokens}
        </span>
      )}
    </span>
  );
}

/** The fleet's visible spend, as the core read summed it. Renders nothing when no row carries a cost.
 * The wording says it is Flywheel's own estimate from a bundled price table — not a billed amount. */
export function FleetFooter({ visibleCostUsd }: { visibleCostUsd: number | null }) {
  if (visibleCostUsd == null) return null;
  return (
    <footer
      data-fleet-footer
      className="type-label tabular-nums"
      style={{
        padding: "var(--space-xs) var(--space-md)",
        borderTop: "1px solid var(--divider)",
        color: "var(--text-muted-rack)",
        textAlign: "right",
      }}
    >
      Estimated spend, this fleet: {formatCostUsd(visibleCostUsd)} (Flywheel's own estimate from a bundled price
      table, not a billed amount)
    </footer>
  );
}

/** What the run is *about*: a task key and title, an epic key, an authoring stage — or, for a run with
 * no subject at all, just the word for what kind of run it is. Never empty (Finding 10). */
function subjectLabel(row: FleetRowDto): { key: string; detail: string | null } {
  if (row.subjectKind === "task") {
    return { key: row.taskKey ?? "Task", detail: row.taskTitle };
  }
  if (row.subjectKind === "epic") {
    return { key: row.epicKey ?? "Epic", detail: "Planning" };
  }
  const stage = row.authoringStage ? `Authoring · ${row.authoringStage}` : "Authoring";
  return { key: row.epicKey ?? "", detail: stage };
}

/** How long this row has been in its state: a blocked run counts from its oldest pending request, a
 * finished run from when it ended, anything else from when it started. */
function ageSince(row: FleetRowDto, state: FleetState): string | undefined {
  if (state === "blocked") return row.blockedSince ?? row.startedAt;
  if (bandForState(state) === "done-failed" || state === "awaiting_review") return row.endedAt ?? row.startedAt;
  return row.startedAt;
}

/** The board item a row's subject names: its task, or for an epic or an authoring run on an existing epic,
 * that epic. `null` when the run has no board subject at all (a fresh-epic authoring run), and also for a
 * project that is unreachable — its board is replaced by the relocate screen, so the jump would land on
 * something other than the item. Either way the row shows no target (D-166: an affordance that looks like
 * a link and goes nowhere is worse than a plain label). */
export function subjectTargetId(row: FleetRowDto): string | null {
  if (row.projectStatus === "unreachable") return null;
  return row.taskId ?? row.epicId ?? null;
}

/** The row's secondary target (D-166, FLEET-03): the subject key as a button of its own, reaching the
 * board item. Its click is stopped here so it never also opens the session; the key `b` reaches the same
 * place from the selected row. Rendered only when the row has a board subject. */
export function SubjectTarget({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      data-subject-target
      className="type-label tabular-nums"
      aria-label={`Open ${label} on the board`}
      title={`Open ${label} on the board`}
      onClick={(event: MouseEvent) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {label}
    </button>
  );
}

/** The row's primary action (D-166, FLEET-03): open this run's session, handing over everything the
 * surface needs to mount in its correct shape in ONE call. `agent_runs.task_id` and `epic_id` are both
 * nullable and mutually exclusive (Finding 10), so an authoring or planning run carries an epic or
 * nothing; `setActiveAgentRunId` documents that every call site sets the four together, and the session
 * will not mount its proposal tray without the stage and the epic. The status is the raw run status the
 * row is already showing — `awaiting_review` is a fleet-only state, the session knows that run as
 * `completed` — so a terminal run does not read "Running" while nothing re-reads it (Pitfall 7).
 *
 * The fleet field is deliberately NOT cleared here. The shell checks the fleet branch BELOW the session
 * branch (plan 10-01, Pattern 4), which is what makes the session's own back action land on the fleet.
 * Anything else that calls the opener with `null` while the fleet is open reveals the fleet; that is
 * intended. The triage surface clears itself first, which is the opposite pattern. */
function sessionOpenerArgs(row: FleetRowDto): Parameters<UiOpener> {
  const status = isRunStatus(row.runStatus) ? row.runStatus : null;
  return [row.agentRunId, row.taskId, row.authoringStage, row.epicId, null, status];
}

type UiOpener = ReturnType<typeof useUiStore.getState>["setActiveAgentRunId"];

export function FleetRowView({
  row,
  now,
  selected = false,
  onOpenSession,
  onOpenSubject,
}: {
  row: FleetRowDto;
  now: number;
  selected?: boolean;
  onOpenSession?: (row: FleetRowDto) => void;
  onOpenSubject?: (row: FleetRowDto) => void;
}) {
  const state: FleetState = isFleetState(row.fleetState) ? row.fleetState : "running";
  const mark = MARKS_BY_ID[RUN_STATUS_MARK_IDS[state]];
  const pulsing = state === "running" && !prefersReducedMotion();
  const subject = subjectLabel(row);
  const age = formatAge(ageSince(row, state), now);
  const [dismissFailed, setDismissFailed] = useState(false);

  return (
    <div
      role="listitem"
      data-fleet-state={state}
      data-run-id={row.agentRunId}
      data-selected={selected ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      className="type-body"
      onClick={() => onOpenSession?.(row)}
      style={{
        cursor: onOpenSession ? "pointer" : undefined,
        // The codebase's "selected" grammar: a left rule in --selection-rule, never colour on the text.
        boxShadow: selected ? "inset 4px 0 0 var(--selection-rule)" : undefined,
        display: "grid",
        gridTemplateColumns: ROW_COLUMNS,
        alignItems: "center",
        gap: "var(--space-md)",
        minHeight: 32,
        padding: "var(--space-xs) var(--space-md)",
        borderBottom: "1px solid var(--divider)",
      }}
    >
      <span
        className="type-label"
        data-field="state"
        style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-xs)", color: RUN_STATUS_COLOR_ROLES[state] }}
      >
        <span aria-hidden="true" className={pulsing ? "agent-pulse" : undefined} style={{ display: "inline-flex" }}>
          <Icon name={mark?.glyph ?? "Circle"} />
        </span>
        {RUN_STATUS_LABELS[state]}
      </span>
      <span data-field="project" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {row.projectName}
      </span>
      <span
        data-field="subject"
        title={subject.detail ? `${subject.key} ${subject.detail}`.trim() : subject.key}
        style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      >
        {subjectTargetId(row) !== null && onOpenSubject ? (
          <SubjectTarget label={subject.key || (row.taskId ? "Task" : "Epic")} onOpen={() => onOpenSubject(row)} />
        ) : (
          subject.key && <span className="type-label tabular-nums">{subject.key}</span>
        )}
        {subject.key && subject.detail ? " " : ""}
        {subject.detail && <span style={{ color: "var(--text-muted-rack)" }}>{subject.detail}</span>}
      </span>
      <ActivityCell row={row} />
      <SpendCell row={row} />
      <span
        className="type-label tabular-nums"
        data-field="age"
        aria-label={`In this state for ${age}`}
        style={{ color: "var(--text-muted-rack)", textAlign: "right" }}
      >
        {age}
      </span>
      <span data-field="dismiss" style={{ textAlign: "right" }}>
        {dismissFailed && (
          <span role="status" className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            Could not dismiss.{" "}
          </span>
        )}
        {isTerminalRun(row) && (
          <button
            type="button"
            className="type-label"
            aria-label={`Dismiss ${subject.key || "run"}`}
            onClick={(event: MouseEvent) => {
              // Its own act: a click here must not also bubble into the row and open the session.
              event.stopPropagation();
              setDismissFailed(false);
              void acknowledgeAgentRun(row.agentRunId).catch(() => setDismissFailed(true));
            }}
          >
            Dismiss
          </button>
        )}
      </span>
    </div>
  );
}

export function FleetBand({
  band,
  rows,
  now,
  selectedRunId = null,
  onOpenSession,
  onOpenSubject,
}: {
  band: { id: FleetBandId; header: string };
  rows: FleetRowDto[];
  now: number;
  selectedRunId?: string | null;
  onOpenSession?: (row: FleetRowDto) => void;
  onOpenSubject?: (row: FleetRowDto) => void;
}) {
  const [dismissNotice, setDismissNotice] = useState<string | null>(null);
  return (
    <section data-band={band.id} aria-label={band.header}>
      <div
        style={{
          padding: "var(--space-xs) var(--space-md)",
          minHeight: 28,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          color: "var(--text-muted-rack)",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <h2 className="type-label" style={{ margin: 0 }}>
          {band.header}
        </h2>
        {band.id === "done-failed" && (
          <span>
            {dismissNotice && (
              <span role="status" className="type-label" style={{ marginRight: "var(--space-sm)" }}>
                {dismissNotice}
              </span>
            )}
            <button
              type="button"
              className="type-label"
              onClick={() => {
                setDismissNotice(null);
                void agentRunAcknowledgeMany(rows.filter(isTerminalRun).map((r) => r.agentRunId))
                  .then((results) => {
                    // A write that failed is not "nothing to dismiss": only an `error` is reported.
                    const failed = results.filter((r) => r.error).length;
                    if (failed > 0) setDismissNotice(`Could not dismiss ${failed} of ${results.length} runs.`);
                  })
                  .catch(() => setDismissNotice("Could not dismiss the finished runs."));
              }}
            >
              Dismiss finished
            </button>
          </span>
        )}
      </div>
      <div role="list">
        {rows.map((row) => (
          <FleetRowView
            key={row.agentRunId}
            row={row}
            now={now}
            selected={row.agentRunId === selectedRunId}
            onOpenSession={onOpenSession}
            onOpenSubject={onOpenSubject}
          />
        ))}
      </div>
    </section>
  );
}

export interface FleetSurfaceProps {
  onClose: () => void;
}

export function FleetSurface({ onClose }: FleetSurfaceProps) {
  const fleet = useFleet();
  const blocked = useBlockedQueue();
  // One surface, two views (plan 10-05): the banded list, or the queue of live blocks. A closed or
  // unset target reads as the fleet list.
  const view = useUiStore((state) => state.fleetSurface?.view ?? "fleet");
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const setActiveAgentRunId = useUiStore((state) => state.setActiveAgentRunId);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
  const setPendingFocusItemId = useUiStore((state) => state.setPendingFocusItemId);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const rows = fleet.data?.rows ?? [];
  const total = fleet.data?.totalRows ?? 0;
  const queue = blocked.data ?? [];
  const now = useNowTick(rows.length > 0 || queue.length > 0);

  // The core orders rows by band, so grouping is a single pass over consecutive rows.
  const byBand = new Map<FleetBandId, FleetRowDto[]>();
  for (const row of rows) {
    const state: FleetState = isFleetState(row.fleetState) ? row.fleetState : "running";
    const band = bandForState(state);
    const bucket = byBand.get(band);
    if (bucket) bucket.push(row);
    else byBand.set(band, [row]);
  }
  // Selection moves through the rows in the order they are drawn: band by band, as grouped above.
  const drawnRows = FLEET_BANDS.flatMap((band) => byBand.get(band.id) ?? []).map((r) => ({ ...r, id: r.agentRunId }));
  const openSession = (row: FleetRowDto) => {
    setSelectedRunId(row.agentRunId);
    setActiveAgentRunId(...sessionOpenerArgs(row));
  };
  // The secondary target: switch to the row's project, leave a one-shot request for the board to act on
  // (the board's own project-change clear would undo anything set directly, Finding 9), and close the
  // fleet so the board shows. Opens nothing else — the session is the primary target, not this one.
  const openSubject = (row: FleetRowDto) => {
    const target = subjectTargetId(row);
    if (target === null) return;
    setSelectedRunId(row.agentRunId);
    setCurrentProjectId(row.projectId);
    setPendingFocusItemId(target);
    setFleetSurface(null);
  };
  const selectedRow = view === "fleet" ? drawnRows.find((r) => r.agentRunId === selectedRunId) : undefined;
  // The queue view owns `a`/`d`/shift-`a` through its keyboard-owner card, and the layer refuses those
  // ids here anyway; this surface registers nothing while the queue is showing.
  useRegionBindings(
    "fleet-surface",
    "fleet-surface",
    view === "fleet"
      ? {
          "move-down": () => setSelectedRunId((current) => nextSelectionId(drawnRows, current, 1)),
          "move-up": () => setSelectedRunId((current) => nextSelectionId(drawnRows, current, -1)),
          "open-fleet-row": () => {
            if (selectedRow) openSession(selectedRow);
          },
          "open-fleet-row-subject": () => {
            if (selectedRow) openSubject(selectedRow);
          },
        }
      : {},
  );
  const needYou = byBand.get("needs-you")?.length ?? 0;
  const countText =
    `${total} ${total === 1 ? "agent" : "agents"}` + (needYou > 0 ? ` · ${needYou} need you` : "");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--text-primary-rack)" }}>
      <header className="admin-header">
        <button type="button" onClick={onClose} className="type-label admin-back">
          ← Board
        </button>
        <span className="type-heading">{view === "queue" ? "Blocked queue" : "Fleet"}</span>
        <div role="group" aria-label="Fleet views" style={{ display: "flex", gap: "var(--space-xs)" }}>
          <button
            type="button"
            className="type-label"
            aria-pressed={view === "fleet"}
            onClick={() => setFleetSurface({ view: "fleet" })}
          >
            All agents
          </button>
          <button
            type="button"
            className="type-label tabular-nums"
            aria-pressed={view === "queue"}
            onClick={() => setFleetSurface({ view: "queue" })}
          >
            {`Blocked ${queue.length}`}
          </button>
        </div>
        <span
          className="type-label tabular-nums"
          aria-live="polite"
          style={{ marginLeft: "auto", color: "var(--text-muted-rack)" }}
        >
          {view === "queue" ? `${queue.length} blocked` : countText}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {view === "queue" ? (
          blocked.isError ? (
            <p role="alert" className="type-body" style={{ padding: "var(--space-lg)", color: "var(--destructive-text-rack)" }}>
              Could not load the blocked queue. It will retry on the next change.
            </p>
          ) : (
            blocked.isSuccess && <BlockedQueue entries={queue} now={now} />
          )
        ) : fleet.isError ? (
          <p role="alert" className="type-body" style={{ padding: "var(--space-lg)", color: "var(--destructive-text-rack)" }}>
            Could not load the fleet. It will retry on the next change.
          </p>
        ) : fleet.isSuccess && rows.length === 0 ? (
          <div style={{ padding: "var(--space-lg)", display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
            <span className="type-heading">No agents running</span>
            <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
              When an agent starts in any project, it appears here.
            </span>
          </div>
        ) : (
          FLEET_BANDS.filter((band) => byBand.has(band.id)).map((band) => (
            <FleetBand
              key={band.id}
              band={band}
              rows={byBand.get(band.id) ?? []}
              now={now}
              selectedRunId={selectedRunId}
              onOpenSession={openSession}
              onOpenSubject={openSubject}
            />
          ))
        )}
      </div>
      {view === "fleet" && <FleetFooter visibleCostUsd={fleet.data?.visibleCostUsd ?? null} />}
    </div>
  );
}
