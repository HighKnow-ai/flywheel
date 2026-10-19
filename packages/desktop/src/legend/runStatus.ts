/**
 * The ONE run-status vocabulary (Phase 10 plan 10-01, RESEARCH Finding 14): the words, `agent`-channel
 * mark ids for a run's status, plus the fleet's derived `awaiting_review` state and its
 * three bands. The runs section, the session surface and the fleet surface all import from here;
 * none declares its own copy, so a seventh state or a re-worded label is a one-file change.
 *
 * Never colour alone (T-02-17): every state is a glyph (via its mark id in `legend/marks.ts`) plus a word.
 * The colour is not declared here: `legend/StateBadge.tsx` draws a state in its class's colour (Phase 14, D-17),
 * so a state's colour is the same wherever it is drawn.
 *
 * This module also owns the three formatters the session surface and the runs section used to declare
 * separately (elapsed time, token count, dollar cost), so a figure reads the same on every surface.
 */

/** The six values `sessions.status` can hold (the baseline migration; `abandoned` is D-49). */
export type RunStatus = "running" | "blocked" | "completed" | "failed" | "interrupted" | "abandoned";

/** A fleet row's state (D-168): the run status, except a `completed` run whose Story is not yet Done
 * reads `awaiting_review`. Derived by the Rust core's fleet read and stored in no column. */
export type FleetState = RunStatus | "awaiting_review";

export const RUN_STATUS_LABELS: Record<FleetState, string> = {
  running: "Running",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
  abandoned: "Abandoned",
  awaiting_review: "Awaiting review",
};

/** `sessions.status` / fleet state -> the published mark id (`legend/marks.ts`). `awaiting_review` has its
 * own `agent`-channel mark since Phase 14 (D-19); it used to reuse the `status` channel's In Review mark
 * (D-170), which left the state undefined in the registry in its own right. */
export const RUN_STATUS_MARK_IDS: Record<FleetState, string> = {
  running: "run-running",
  blocked: "blocked-indicator",
  completed: "run-completed",
  failed: "run-failed",
  interrupted: "run-interrupted",
  abandoned: "run-abandoned",
  awaiting_review: "run-awaiting-review",
};

export const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "interrupted", "abandoned"];

/** Narrows an arbitrary string (a wire value, an event reason) to a run status. */
export function isRunStatus(value: unknown): value is RunStatus {
  return isFleetState(value) && value !== "awaiting_review";
}

/** Narrows an arbitrary string from the fleet read to a fleet state. */
export function isFleetState(value: unknown): value is FleetState {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(RUN_STATUS_LABELS, value);
}

export type FleetBandId = "needs-you" | "running" | "done-failed";

/** The three bands in their fixed order (D-164) with their header text. The Rust core orders rows by
 * band in SQL; the renderer only groups. */
export const FLEET_BANDS: readonly { id: FleetBandId; header: string }[] = [
  { id: "needs-you", header: "NEEDS YOU" },
  { id: "running", header: "RUNNING" },
  { id: "done-failed", header: "DONE / FAILED" },
];

/** Which band a state sits in: blocked, awaiting review and abandoned need the user; `interrupted` is
 * a finished run and sits with completed and failed (D-169). */
export function bandForState(state: FleetState): FleetBandId {
  switch (state) {
    case "blocked":
    case "awaiting_review":
    case "abandoned":
      return "needs-you";
    case "running":
      return "running";
    default:
      return "done-failed";
  }
}

/** `m:ss` since `startIso` — the session status strip's elapsed readout. */
export function formatElapsed(startIso: string | undefined, nowMs: number): string {
  if (!startIso) return "0:00";
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return "0:00";
  const deltaSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const seconds = deltaSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** A compact whole-unit age ("45s", "12m", "3h 5m", "2d") for a fleet row, where a ticking `m:ss` would
 * read as noise. Zero-clamped; an unparseable timestamp reads "—". */
export function formatAge(sinceIso: string | undefined, nowMs: number): string {
  if (!sinceIso) return "—";
  const sinceMs = new Date(sinceIso).getTime();
  if (Number.isNaN(sinceMs)) return "—";
  const seconds = Math.max(0, Math.floor((nowMs - sinceMs) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

export function formatCount(value: number): string {
  return value.toLocaleString();
}

/** Four-decimal dollars; a missing figure reads "—", never `$0.0000`. */
export function formatCostUsd(value: number | null | undefined): string {
  return value == null ? "—" : `$${value.toFixed(4)}`;
}
