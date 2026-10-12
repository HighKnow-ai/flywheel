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
 * the session never tell different stories about the same moment. A row has no interactive target in
 * this plan; the spend column and the jumps into a session or a board item are later plans.
 */
import { useEffect, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import type { FleetActivityDto, FleetRowDto } from "../adapters/tauri";
import { MARKS_BY_ID } from "../legend/marks";
import {
  FLEET_BANDS,
  RUN_STATUS_COLOR_ROLES,
  RUN_STATUS_LABELS,
  RUN_STATUS_MARK_IDS,
  bandForState,
  formatAge,
  isFleetState,
  type FleetBandId,
  type FleetState,
} from "../legend/runStatus";
import { feedRowText } from "../session/FeedRow";
import { buildFeedRows } from "../session/SessionSurface";
import { useFleet } from "./useFleet";
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
const ROW_COLUMNS = "minmax(150px, 190px) minmax(80px, 140px) 1fr minmax(120px, 1.4fr) 64px";

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

export function FleetRowView({ row, now }: { row: FleetRowDto; now: number }) {
  const state: FleetState = isFleetState(row.fleetState) ? row.fleetState : "running";
  const mark = MARKS_BY_ID[RUN_STATUS_MARK_IDS[state]];
  const pulsing = state === "running" && !prefersReducedMotion();
  const subject = subjectLabel(row);
  const age = formatAge(ageSince(row, state), now);

  return (
    <div
      role="listitem"
      data-fleet-state={state}
      data-run-id={row.agentRunId}
      className="type-body"
      style={{
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
        {subject.key && <span className="type-label tabular-nums">{subject.key}</span>}
        {subject.key && subject.detail ? " " : ""}
        {subject.detail && <span style={{ color: "var(--text-muted-rack)" }}>{subject.detail}</span>}
      </span>
      <ActivityCell row={row} />
      <span
        className="type-label tabular-nums"
        data-field="age"
        aria-label={`In this state for ${age}`}
        style={{ color: "var(--text-muted-rack)", textAlign: "right" }}
      >
        {age}
      </span>
    </div>
  );
}

export function FleetBand({
  band,
  rows,
  now,
}: {
  band: { id: FleetBandId; header: string };
  rows: FleetRowDto[];
  now: number;
}) {
  return (
    <section data-band={band.id} aria-label={band.header}>
      <h2
        className="type-label"
        style={{
          margin: 0,
          padding: "var(--space-xs) var(--space-md)",
          minHeight: 28,
          display: "flex",
          alignItems: "center",
          color: "var(--text-muted-rack)",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        {band.header}
      </h2>
      <div role="list">
        {rows.map((row) => (
          <FleetRowView key={row.agentRunId} row={row} now={now} />
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
  const rows = fleet.data?.rows ?? [];
  const total = fleet.data?.totalRows ?? 0;
  const now = useNowTick(rows.length > 0);

  // The core orders rows by band, so grouping is a single pass over consecutive rows.
  const byBand = new Map<FleetBandId, FleetRowDto[]>();
  for (const row of rows) {
    const state: FleetState = isFleetState(row.fleetState) ? row.fleetState : "running";
    const band = bandForState(state);
    const bucket = byBand.get(band);
    if (bucket) bucket.push(row);
    else byBand.set(band, [row]);
  }
  const needYou = byBand.get("needs-you")?.length ?? 0;
  const countText =
    `${total} ${total === 1 ? "agent" : "agents"}` + (needYou > 0 ? ` · ${needYou} need you` : "");

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--text-primary-rack)" }}>
      <header className="admin-header">
        <button type="button" onClick={onClose} className="type-label admin-back">
          ← Board
        </button>
        <span className="type-heading">Fleet</span>
        <span
          className="type-label tabular-nums"
          aria-live="polite"
          style={{ marginLeft: "auto", color: "var(--text-muted-rack)" }}
        >
          {countText}
        </span>
      </header>
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
        {fleet.isError ? (
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
            <FleetBand key={band.id} band={band} rows={byBand.get(band.id) ?? []} now={now} />
          ))
        )}
      </div>
    </div>
  );
}
