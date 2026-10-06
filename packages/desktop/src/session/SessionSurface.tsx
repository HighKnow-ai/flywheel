/**
 * The live session surface (D-31, plan 02-01 Task 1): a full content-area surface, pushed into
 * from a task and popped back out of via the `← Board` affordance — never a tab inside the 480px
 * item detail panel and never a dockable pane. The board stays the board.
 *
 * Plan 02-02 Task 3 adds the Stop affordance and the run-status word. Plan 02-06 Task 2 mounts
 * the permission-request card's `feed` variant here, at the tail of the event list, and
 * suppresses the feed's follow-the-tail scroll for as long as any request is pending.
 *
 * Plan 02-07 Task 2 replaces the tracer's plain row-per-raw-event render with the real
 * structured feed (D-32): `useSessionFeed` (`board/useBoardQuery.ts`) pages a bounded window in
 * from the TAIL of the persisted log (D-33), older pages fetched as the user scrolls toward the
 * top of what is loaded — never the whole transcript in memory (PROC-07). `FeedRow.tsx` renders
 * one row per normalised event; `buildFeedRows` below is the pairing/filtering step that turns
 * the raw windowed-read entries into that row list — a `tool_call` paired with its own
 * `tool_result` by `toolName` (FIFO — no correlation id exists on either event), `init`/
 * `cost_update`/`permission_request`/`session_closed` suppressed from the row list (each is
 * either metadata the header/status-strip consumes elsewhere, or — for `session_closed` — the
 * terminal row's own data source), and any other kind falling back to a raw, verbatim row rather
 * than silently disappearing (T-02-33). Virtualized with this codebase's own
 * `@tanstack/react-virtual` configuration — a fixed size per row kind, `virtualizer.measure()`
 * (never `measureElement`) invalidating the size cache when a tool-call row's expand state
 * changes, matching Phase 1's explicit rejection of measured virtualization.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
  type UIEvent,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import * as icons from "lucide-react";
import {
  answerPermissionRequest,
  authoringStageAdvance,
  authoringStageReturn,
  discardSession,
  sendAuthoringTurn,
  stopAgentRun,
  subscribeAgentEvent,
} from "../adapters/tauri";
import { ProposalTray } from "../authoring/ProposalTray";
import { useRunProposals } from "../authoring/useAuthoringQuery";
import { useSessionFeed, usePendingPermissionRequests } from "../board/useBoardQuery";
import { MARKS_BY_ID } from "../legend/marks";
import { useRegionBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import { PermissionRequestCard, type PermissionDecision } from "./PermissionRequestCard";
import { FeedRow, feedRowEstimateSize, useExpandedRows, type FeedRowData } from "./FeedRow";
import { RawLogView } from "./RawLogView";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** The five values `agent_runs.status` can hold (migration `0003_agent_runtime.sql`). */
export type RunStatus = "running" | "blocked" | "completed" | "failed" | "interrupted";

const RUN_STATUS_LABELS: Record<RunStatus, string> = {
  running: "Running",
  blocked: "Blocked",
  completed: "Completed",
  failed: "Failed",
  interrupted: "Interrupted",
};

const TERMINAL_STATUSES: readonly RunStatus[] = ["completed", "failed", "interrupted"];

function isRunStatus(value: unknown): value is RunStatus {
  return typeof value === "string" && value in RUN_STATUS_LABELS;
}

/** `agent_runs.status` -> the matching published `agent`-channel mark id (`legend/marks.ts`,
 * plan 02-03) — the run-status badge's own glyph/label source, never a second hand-typed list. */
const RUN_STATUS_MARK_ID: Record<RunStatus, string> = {
  running: "run-running",
  blocked: "run-blocked",
  completed: "run-completed",
  failed: "run-failed",
  interrupted: "run-interrupted",
};

/** 02-UI-SPEC.md's "Run Status" table — running/interrupted reuse existing roles, the other
 * three are the colour roles plan 02-03 published. */
const RUN_STATUS_COLOR: Record<RunStatus, string> = {
  running: "var(--accent-text-rack)",
  blocked: "var(--blocked-text-rack)",
  completed: "var(--success-text-rack)",
  failed: "var(--destructive-text-rack)",
  interrupted: "var(--text-muted-rack)",
};

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

/** Resolve a Lucide icon by name — the same by-name pattern `ActivityTrail.tsx`/
 * `PermissionRequestCard.tsx` already use, so no icon component is ever named directly. */
function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** Whether the OS reports a reduced-motion preference — checked once at mount (no acceptance
 * criterion in this plan requires reacting to the preference changing mid-session). Guarded for
 * an environment with no `matchMedia` at all (this project's own jsdom test environment does not
 * implement it by default; a test asserting the reduced-motion path installs its own mock first). */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The glyph-and-word run-status badge (02-UI-SPEC.md "Run Status", plan 02-07 Task 3) — never
 * colour alone. `run-running`'s `Loader` glyph carries the one continuous-motion exception this
 * product allows (Motion Additions: "signalling a process is alive right now, not decorating a
 * state change"); `.agent-pulse` (styles/motion.css) is omitted entirely under a reduced-motion
 * preference rather than merely zeroed, so the glyph stays static rather than freezing mid-pulse —
 * but it is never removed, the running state must stay legible either way. */
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

/** The most recent numeric value found under any of `fields`, scanning newest-to-oldest — the
 * status strip's own opportunistic extraction (02-UI-SPEC.md "Cost/token status strip"). The
 * backend reports token counts and cost as SESSION TOTALS exactly once, on its terminal `result`
 * event — never accumulated per message (G-02-4's "Token accounting decision") — and carries them
 * as TOP-LEVEL fields (`inputTokens`/`outputTokens`/`totalCostUsd`) this scan already looks for, so
 * the counters legitimately read "—" for the duration of a running session and flip to the real
 * figures the moment the backend reports them; that is correct behaviour under this decision, not
 * residue of a defect. A caller with no matching field gets `undefined`, rendered as "—" rather
 * than a fabricated zero. */
function latestNumericField(entries: Record<string, unknown>[], fields: string[]): number | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const event = entries[i];
    for (const field of fields) {
      const value = event[field];
      if (typeof value === "number") return value;
    }
  }
  return undefined;
}

function formatElapsed(startIso: string | undefined, nowMs: number): string {
  if (!startIso) return "0:00";
  const startMs = new Date(startIso).getTime();
  if (Number.isNaN(startMs)) return "0:00";
  const deltaSeconds = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  const minutes = Math.floor(deltaSeconds / 60);
  const seconds = deltaSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatCount(value: number | undefined): string {
  return value === undefined ? "—" : value.toLocaleString();
}

function formatCostUsd(value: number | undefined): string {
  return value === undefined ? "—" : `$${value.toFixed(4)}`;
}

/** Re-renders once a second while `enabled` — the status strip's own elapsed-time ticker. Its
 * own isolated re-render boundary (`StatusStrip` below, not the header/feed) is what keeps this
 * tick from re-rendering the rest of the surface (02-UI-SPEC.md Performance Contract Additions:
 * "an isolated re-render boundary... matching the board's... 'one row moves, the rack does not
 * re-render' thesis"). */
function useNowTick(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);
  return now;
}

/** The right-aligned cost/token status strip (02-UI-SPEC.md "Cost/token status strip") — its own
 * component so the elapsed-time tick's re-render never reaches the header chrome or the feed. */
function StatusStrip({
  entries,
  running,
}: {
  entries: Record<string, unknown>[];
  running: boolean;
}) {
  const now = useNowTick(running);
  const startedAt = typeof entries[0]?.at === "string" ? (entries[0].at as string) : undefined;
  const tokensIn = latestNumericField(entries, ["tokensIn", "inputTokens", "tokens_in"]);
  const tokensOut = latestNumericField(entries, ["tokensOut", "outputTokens", "tokens_out"]);
  const costUsd = latestNumericField(entries, ["totalCostUsd", "cost_usd"]);

  return (
    <div
      style={{
        marginLeft: "auto",
        display: "flex",
        alignItems: "center",
        gap: "var(--space-md)",
        color: "var(--text-muted-rack)",
      }}
    >
      <span className="type-label tabular-nums" aria-label="Elapsed time">
        {formatElapsed(startedAt, now)}
      </span>
      <span className="type-label tabular-nums" aria-label="Tokens in">
        {formatCount(tokensIn)} in
      </span>
      <span className="type-label tabular-nums" aria-label="Tokens out">
        {formatCount(tokensOut)} out
      </span>
      <span className="type-label tabular-nums" aria-label="Cost">
        {formatCostUsd(costUsd)}
      </span>
    </div>
  );
}

/** D-88's three named stages, in their fixed order — mirrors
 * `core::domain::authoring_session::AUTHORING_STAGES` exactly (that Rust constant's own doc
 * comment: "the single list every reader ... derives from"). The stage indicator below renders
 * every one of these, always, so the developer can see both where the session is and that there
 * are exactly three — a bare "Stage: decompose" label would hide the shape of the machine. */
export const AUTHORING_STAGES = ["challenge", "decompose", "criteria"] as const;

const AUTHORING_STAGE_LABELS: Record<string, string> = {
  challenge: "Challenge",
  decompose: "Decompose",
  criteria: "Criteria",
};

/** `authoring_stage` value -> the matching published `agent`-channel mark id (`legend/marks.ts`,
 * plan 05-03) — mirrors `RUN_STATUS_MARK_ID`'s own role for run status, above. */
const AUTHORING_STAGE_MARK_ID: Record<string, string> = {
  challenge: "authoring-stage-challenge",
  decompose: "authoring-stage-decompose",
  criteria: "authoring-stage-criteria",
};

/** The stage AFTER `stage` in `AUTHORING_STAGES`' fixed order, or `undefined` at `criteria` —
 * there is nowhere further forward to go (mirrors `AuthoringStage::next`'s own `None` at the last
 * stage). */
function nextAuthoringStage(stage: string): string | undefined {
  const index = AUTHORING_STAGES.indexOf(stage as (typeof AUTHORING_STAGES)[number]);
  return index === -1 ? undefined : AUTHORING_STAGES[index + 1];
}

/** The stage BEFORE `stage`, or `undefined` at `challenge` — there is nothing earlier to return
 * to. The "way back" control below only renders when this returns a real stage. Exported so
 * `CommandPalette.tsx`'s `return-stage` entry can compute the same target without a second,
 * independently-maintained copy of D-88's fixed stage order. */
export function previousAuthoringStage(stage: string): string | undefined {
  const index = AUTHORING_STAGES.indexOf(stage as (typeof AUTHORING_STAGES)[number]);
  return index > 0 ? AUTHORING_STAGES[index - 1] : undefined;
}

/** The stage indicator (D-88, plan 05-03) — its own independently-rendering sibling of
 * `StatusStrip`, mounted the same way (never woven into `FeedRow.tsx`). Shows all three stages in
 * their fixed order with the current one marked (current = `--accent-text-rack`, the same role
 * `RUN_STATUS_COLOR.running` already reuses; the others = `--text-muted-rack`) — no new colour
 * token, reusing the existing agent signal vocabulary block. */
function AuthoringStageIndicator({ stage }: { stage: string }) {
  return (
    <span
      role="list"
      aria-label="Authoring stage"
      style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-md)" }}
    >
      {AUTHORING_STAGES.map((candidate) => {
        const isCurrent = candidate === stage;
        const mark = MARKS_BY_ID[AUTHORING_STAGE_MARK_ID[candidate]];
        return (
          <span
            key={candidate}
            role="listitem"
            aria-current={isCurrent ? "step" : undefined}
            className="type-label"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "var(--space-xs)",
              color: isCurrent ? "var(--accent-text-rack)" : "var(--text-muted-rack)",
            }}
          >
            <span aria-hidden="true" style={{ display: "inline-flex" }}>
              <Icon name={mark?.glyph ?? "Circle"} size={12} />
            </span>
            {AUTHORING_STAGE_LABELS[candidate]}
          </span>
        );
      })}
    </span>
  );
}

const ADVANCE_STAGE_GLOSS =
  "The agent may recommend advancing, but only you can advance the stage — it can never advance itself.";

/** The Advance/Return controls (D-90, plan 05-03) — the one gate the whole mechanism depends on,
 * exposed here as the two verbs `authoring_stage_advance`/`authoring_stage_return` back. Purely
 * presentational: `onAdvance`/`onReturn` are the SAME synchronously-guarded handlers the `n`
 * keyboard binding calls (`SessionSurface`'s own `handleAdvanceStage`/`handleReturnStage`), so a
 * click and a keypress can never race each other into two backend calls. */
function AuthoringStageControls({
  stage,
  advancing,
  returning,
  onAdvance,
  onReturn,
}: {
  stage: string;
  advancing: boolean;
  returning: boolean;
  onAdvance: () => void;
  onReturn: () => void;
}) {
  const next = nextAuthoringStage(stage);
  const previous = previousAuthoringStage(stage);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--space-sm)" }}>
      {previous && (
        <button
          type="button"
          onClick={onReturn}
          disabled={returning}
          aria-label={`Return to ${previous}`}
          className="type-label"
          style={{
            background: "transparent",
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            padding: "var(--space-xs) var(--space-sm)",
            cursor: returning ? "default" : "pointer",
          }}
        >
          ← {AUTHORING_STAGE_LABELS[previous]}
        </button>
      )}
      <button
        type="button"
        onClick={onAdvance}
        disabled={advancing || !next}
        aria-label={next ? `Advance to ${next}` : "Advance (already at the last stage)"}
        title={ADVANCE_STAGE_GLOSS}
        className="type-label"
        style={{
          background: next ? "var(--accent-nontext)" : "transparent",
          border: next ? "none" : "1px solid var(--divider)",
          borderRadius: "var(--radius-chrome)",
          color: "var(--text-primary-rack)",
          padding: "var(--space-xs) var(--space-md)",
          cursor: advancing || !next ? "default" : "pointer",
          opacity: !next ? 0.6 : 1,
        }}
      >
        {advancing ? "Advancing…" : next ? `Advance to ${next}` : "At last stage"}
      </button>
    </span>
  );
}

/**
 * The composer (SHAPE-01, plan 05-12 Task 1) — the one seam between the developer and a live
 * authoring session's conversation. Rendered by `SessionSurface` only when `stage` is non-null
 * and the run is not terminal (the same `showStop` condition the Stop/Discard controls already
 * gate on). Copies `stoppingRef`/`advancingStageRef`'s own synchronous-dispatch-guard shape: a
 * click and a keypress (or two synchronous clicks) can never race into two calls. Calls the named
 * `sendAuthoringTurn` wrapper only — never the transport directly, keeping this file's own
 * zero-direct-call property true.
 */
function AuthoringComposer({ agentRunId }: { agentRunId: string }) {
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendingRef = useRef(false);

  function handleSend() {
    // A second activation while the ref is set invokes nothing — mirrors `handleStop`'s own
    // synchronous-tick guard above.
    if (sendingRef.current) return;
    const trimmed = draft.trim();
    if (trimmed.length === 0) return;
    sendingRef.current = true;
    setSending(true);
    setError(null);
    sendAuthoringTurn(agentRunId, trimmed)
      .then(() => {
        setDraft("");
      })
      .catch(() => {
        // The typed text is deliberately NOT cleared here — a developer who pressed send is
        // entitled to both a worded explanation and the words they typed, still in the box.
        setError("Could not send your message. Try again.");
      })
      .finally(() => {
        sendingRef.current = false;
        setSending(false);
      });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Plain Enter submits; Shift+Enter inserts a newline — matching
    // `ProposalAmendEditor.tsx`'s own field handler. The bare-key Advance binding
    // (`state/keyboard.ts`'s `advance-stage`, key `n`) needs no handling here at all:
    // `resolveBinding`'s own `isTypingTarget` guard already declines a bare unmodified key
    // while this composer holds focus (confirmed by a test, not reimplemented here).
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  }

  return (
    <div
      style={{
        borderTop: "1px solid var(--divider)",
        padding: "var(--space-md)",
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
      }}
    >
      <label
        htmlFor="authoring-turn-composer"
        className="type-label"
        style={{ color: "var(--text-muted-rack)" }}
      >
        Message
      </label>
      <textarea
        id="authoring-turn-composer"
        aria-label="Message"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        rows={3}
        className="type-body"
        style={{
          background: "transparent",
          border: "1px solid var(--divider)",
          borderRadius: "var(--radius-chrome)",
          color: "inherit",
          padding: "var(--space-xs) var(--space-sm)",
          resize: "vertical",
          fontFamily: "inherit",
        }}
      />
      {error && (
        <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
          {error}
        </p>
      )}
      <div>
        <button
          type="button"
          onClick={handleSend}
          disabled={sending}
          className="type-body"
          style={{
            background: "var(--accent-nontext)",
            border: "none",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            padding: "var(--space-xs) var(--space-md)",
            cursor: sending ? "default" : "pointer",
          }}
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}

/** The gate-missing banner (T-05-03-01, plan 05-03) — the `system_notice` `startAuthoringSession`
 * emits when `writeHookSettings` fails, rendered with `PersistenceFailureBanner`'s own visual
 * shape (reused directly, below): visible, non-blocking, once per run (this surface's own
 * `gateMissingText` state is set once and never cleared). Fallback text for the (never actually
 * reached in production, since the sidecar always supplies real text) case where the event's own
 * `text` field is somehow absent. */
const GATE_MISSING_FALLBACK_TEXT =
  "The challenge-stage gate could not be installed for this session — a proposal could be staged before the stage advances.";

export interface SessionSurfaceProps {
  agentRunId: string;
  onBack: () => void;
  /** The task this run belongs to (D-66/D-67, plan 04-13) — `null` only for a caller that has not
   * been updated to thread it through yet (defensive; every current caller supplies it). Needed
   * so `handleDiscard` can hand off to the launch sheet for the SAME task on resolution — the
   * surface has no other source for this id (it is never itself queried from the backend). */
  taskId?: string | null;
  /** The epic this run belongs to (D-84/D-86, plan 05-09) — `null` for an ordinary task-execution
   * run AND for a fresh-epic authoring run alike. Needed so `handleDiscard` can hand off to a
   * fresh authoring launch for the SAME epic on resolution, mirroring `taskId`'s own reasoning:
   * the surface has no other source for this id. */
  epicId?: string | null;
  /** The run's status when this surface first mounts. Defaults to `"running"` — in this phase
   * the surface is only ever pushed into right after Start Work; a later plan that adds a "View"
   * affordance for an already-terminal run should pass its real starting status here instead of
   * relying on this default. */
  initialStatus?: RunStatus;
  /** D-88/D-84 (plan 05-02): the run's `agent_runs.authoring_stage`, or `null`/`undefined` for an
   * ordinary task-execution run. `ProposalTray` mounts beside the feed ONLY when this is present —
   * an authoring run's own distinguishing fact, carried from `App.tsx`'s `activeAgentRunAuthoringStage`
   * (`state/uiStore.ts`), since this surface never itself queries which kind of run it is showing. */
  authoringStage?: string | null;
  /** A one-shot initial position for the feed (D-99, plan 06-08) — `null`/`undefined` (the
   * default) preserves this surface's existing "open at the tail" behaviour byte-for-byte, for
   * every pre-existing call site. Set only by the triage surface's turn-pointer jump
   * (`App.tsx`'s `activeAgentRunInitialLogOffset`), which has a recorded log offset to open at
   * rather than "whatever the tail currently is" — threaded straight into `useSessionFeed`. */
  initialFeedOffset?: number | null;
}

/** Event kinds the feed suppresses from its own row list — each is either consumed elsewhere
 * (`init`/`cost_update`/`result` feed the header/status-strip; `permission_request` is the
 * dedicated `PermissionRequestCard` mount below) or is the terminal row's own data source
 * (`session_closed`, resolved by `findTerminalInfo`) — a standalone `result` normally arrives
 * immediately before `session_closed` and would otherwise render as a redundant raw line right
 * before the real terminal row appears. Suppressing is not dropping: nothing here is a candidate
 * for the raw-fallback rule below, because each is already rendered somewhere. */
const SUPPRESSED_EVENT_TYPES = new Set([
  "init",
  "cost_update",
  "result",
  "permission_request",
  "session_closed",
  // D-53/plan 03-13: the exhaustion notice's own row is a hard no — see `buildFeedRows` below,
  // which never even lets one of these reach `FeedRow.tsx`'s own (defense-in-depth) no-render
  // case. Suppressed here for the same reason `session_closed` is: it is rendered elsewhere (the
  // Activity Trail), never as a feed row at all.
  "git_lock_exhausted",
  // Task 3, plan 05-12: the backend restating a turn the Rust core has already recorded — the
  // developer_turn row (Task 2, above) is where that content renders. Suppressing here is not
  // dropping: the same words are already on screen, written by the component that knows who
  // actually said them.
  "backend_echo",
]);

/** A stable React/expand-tracking key for one raw log entry — `seq` (every normalised
 * `AgentEvent` carries one, AGNT-01) is preferred because it never shifts when the tail page's
 * own OFFSET changes as the log crosses a page boundary; a malformed line (session_log.rs's own
 * synthesized `unknown` entry) falls back to its `line` number, and the flattened array position
 * is the last resort for a genuinely shapeless entry. */
function keyForEvent(event: Record<string, unknown>, index: number): string {
  if (typeof event.seq === "number") return `seq-${event.seq}`;
  // Task 2, plan 05-12: a `developer_turn` entry (the application's own record of a turn it sent,
  // `sidecar.rs`'s `build_authoring_turn_line`) carries no `seq` at all — it is written directly
  // to the session log by the Rust core, never through the sidecar's own per-session seq counter.
  // Without this branch it would fall straight to the `idx-${index}` last resort below, which
  // shifts as older pages load (this function's own comment on `seq`'s general preference) —
  // `turnId` is the one field every such entry carries that is BOTH present and stable, so it is
  // checked ahead of the line-number fallback.
  if (typeof event.turnId === "string") return `turn-${event.turnId}`;
  if (typeof event.line === "number") return `line-${event.line}`;
  return `idx-${index}`;
}

function rawTextFor(event: Record<string, unknown>): string {
  if (typeof event.raw === "string") return event.raw;
  try {
    return JSON.stringify(event);
  } catch {
    return String(event);
  }
}

/**
 * Turn the flattened, ascending-chronological windowed-read entries into the feed's own row
 * list (D-32). A `tool_call` is paired with the next same-`toolName` `tool_result` (FIFO per
 * tool name — the sidecar's own `AgentEvent` union carries no call-correlation id, so exact
 * pairing under concurrent same-named calls is a known, accepted simplification; every event
 * still renders SOMETHING regardless, per T-02-33). An unpaired `tool_result` (no matching
 * pending call, or no `toolName` at all) falls back to a raw row rather than disappearing.
 */
export function buildFeedRows(entries: Record<string, unknown>[]): FeedRowData[] {
  const rows: FeedRowData[] = [];
  const pendingByTool = new Map<string, number[]>();

  entries.forEach((event, index) => {
    const type = typeof event.type === "string" ? event.type : "unknown";
    const key = keyForEvent(event, index);

    if (type === "tool_result") {
      const toolName = typeof event.toolName === "string" ? event.toolName : undefined;
      const queue = toolName ? pendingByTool.get(toolName) : undefined;
      if (queue && queue.length > 0) {
        const targetIndex = queue.shift() as number;
        const target = rows[targetIndex];
        if (target && target.kind === "tool_call") {
          rows[targetIndex] = { ...target, output: event.output };
        }
        return;
      }
      rows.push({ kind: "raw", key, raw: rawTextFor(event) });
      return;
    }

    if (SUPPRESSED_EVENT_TYPES.has(type)) return;

    if (type === "assistant_text") {
      rows.push({ kind: "assistant_text", key, text: typeof event.text === "string" ? event.text : "" });
      return;
    }

    // Task 2, plan 05-12: a turn the application sent into this session (`sidecar.rs`'s
    // `build_authoring_turn_line`) — its own row kind, never the generic raw fallback below (which
    // would show the JSON-stringified line) and never merged into `assistant_text` above (which
    // would attribute the developer's own words to the agent).
    if (type === "developer_turn") {
      rows.push({ kind: "developer_turn", key, text: typeof event.text === "string" ? event.text : "" });
      return;
    }

    if (type === "tool_call") {
      const toolName = typeof event.toolName === "string" ? event.toolName : "tool";
      rows.push({ kind: "tool_call", key, toolName, input: event.input });
      const queue = pendingByTool.get(toolName) ?? [];
      queue.push(rows.length - 1);
      pendingByTool.set(toolName, queue);
      return;
    }

    if (type === "system_notice") {
      rows.push({ kind: "system_notice", key, text: typeof event.text === "string" ? event.text : "" });
      return;
    }

    // D-53/plan 03-13: the shim's retry notice — routed to FeedRow.tsx's own "git_retry" case,
    // which reuses the system/transient row kind's exact treatment. `git_lock_exhausted` is
    // suppressed above (SUPPRESSED_EVENT_TYPES) and never reaches this point at all.
    if (type === "git_retry") {
      rows.push({
        kind: "git_retry",
        key,
        attempt: typeof event.attempt === "number" ? event.attempt : 0,
        max: typeof event.max === "number" ? event.max : 0,
      });
      return;
    }

    // Anything else — including session_log.rs's own `unknown` entry for a malformed line —
    // never disappears (T-02-33).
    rows.push({ kind: "raw", key, raw: rawTextFor(event) });
  });

  return rows;
}

interface TerminalInfo {
  reason: RunStatus;
  subtype?: string;
  /** The backend's own explanation of why the session ended (G-02-2) — the sidecar's retained
   * stderr tail, or a spawn error's message, carried on the terminal event's `detail` field.
   * Absent, not empty, when there is nothing to show. */
  detail?: string;
}

/** The terminal row's own data source (D-35's "exactly one `session_closed` event, ever") — the
 * LAST such event in the loaded window, since a run only ever closes once. */
export function findTerminalInfo(entries: Record<string, unknown>[]): TerminalInfo | undefined {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const event = entries[i];
    if (event.type === "session_closed" && isRunStatus(event.reason)) {
      const result = event.result as { subtype?: string } | undefined;
      const detail = typeof event.detail === "string" ? event.detail : undefined;
      return { reason: event.reason, subtype: result?.subtype, detail };
    }
  }
  return undefined;
}

/** The shared "expanded" sub-block's fixed max height (px) — matches
 * `FeedRow.tsx`'s own `EXPANDED_SUBBLOCK_MAX_HEIGHT` (G-02-3's containment pattern for a long,
 * internally-scrolling block), duplicated here rather than imported since `FeedRow.tsx` does not
 * export it and this module already duplicates `MONO_STACK` the same way. */
const TERMINAL_DETAIL_MAX_HEIGHT = 240;

const FAILED_RUN_GLOSS = "This run ended in an error. The worktree was left as-is — nothing was lost.";

/** D-35's Stop gloss, generalised for a conversation (plan 05-09): a task run's worktree is left
 * exactly as the agent left it (PROC-06 — nothing committed on the user's behalf); an authoring
 * run has no worktree, so the true reassurance is that every proposal it staged is still sitting
 * on the board, untouched, waiting on a decision. Neither sentence mentions the other subject. */
const TASK_STOPPED_GLOSS =
  "This run was stopped. The worktree was left exactly as the agent left it — nothing was lost.";
const AUTHORING_STOPPED_GLOSS =
  "This conversation was stopped. Every staged proposal is still waiting on the board.";

function TerminalRow({ info, isAuthoring }: { info: TerminalInfo; isAuthoring: boolean }) {
  if (info.reason === "failed") {
    return (
      <div
        role="listitem"
        style={{
          marginTop: "var(--space-sm)",
          padding: "var(--space-sm) var(--space-md)",
          background: "var(--surface-secondary)",
          borderRadius: "var(--radius-chrome)",
        }}
      >
        <p className="type-body" style={{ margin: 0, color: "var(--text-primary-rack)" }}>
          {FAILED_RUN_GLOSS}
        </p>
        {info.subtype && (
          <p
            className="type-label"
            style={{ margin: "var(--space-xs) 0 0 0", fontFamily: MONO_STACK, color: "var(--destructive-text-rack)" }}
          >
            {info.subtype}
          </p>
        )}
        {info.detail && (
          <div
            data-testid="terminal-detail"
            className="type-label"
            style={{
              marginTop: "var(--space-xs)",
              maxHeight: TERMINAL_DETAIL_MAX_HEIGHT,
              overflowY: "auto",
              fontFamily: MONO_STACK,
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color: "var(--text-muted-rack)",
            }}
          >
            {info.detail}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      role="listitem"
      className="type-label"
      style={{ marginTop: "var(--space-sm)", padding: "var(--space-sm) var(--space-md)", color: "var(--text-muted-rack)" }}
    >
      {RUN_STATUS_LABELS[info.reason]}
      {info.reason === "interrupted" && (
        <p style={{ margin: "var(--space-xs) 0 0 0" }}>
          {isAuthoring ? AUTHORING_STOPPED_GLOSS : TASK_STOPPED_GLOSS}
        </p>
      )}
    </div>
  );
}

const STOP_WARNING_GLOSS = "Flywheel could not confirm the agent process actually stopped.";

/** The "stop was recorded but the sidecar could not confirm it" notice (plan 02-11, CR-04) —
 * `02-UI-SPEC.md` specifies no presentation for this case, so this reuses E2's terminal-row
 * pattern (a one-line human gloss above the machine detail, in the Mono role) at the
 * **interrupted** weight: `--text-muted-rack` and the CircleSlash mark, never the failed run's
 * `--destructive-text-rack` stripe or CircleX glyph, because the run DID reach `interrupted`. */
function StopWarningNotice({ warning }: { warning: string }) {
  const mark = MARKS_BY_ID["run-interrupted"];
  return (
    <div
      role="listitem"
      style={{
        marginTop: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--surface-secondary)",
        borderRadius: "var(--radius-chrome)",
      }}
    >
      <p
        className="type-body"
        style={{
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          color: "var(--text-primary-rack)",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted-rack)" }}>
          <Icon name={mark?.glyph ?? "CircleSlash"} />
        </span>
        {STOP_WARNING_GLOSS}
      </p>
      <p
        className="type-label"
        style={{ margin: "var(--space-xs) 0 0 0", fontFamily: MONO_STACK, color: "var(--text-muted-rack)" }}
      >
        {warning}
      </p>
    </div>
  );
}

/** The "this run's persisted transcript may be incomplete" banner (plan 02-12, CR-03/PROC-07) —
 * `02-UI-SPEC.md` specifies no presentation for this case either, so it reuses the exact same
 * muted notice treatment `StopWarningNotice` above established: `--text-muted-rack`, a single
 * one-line human sentence, no destructive styling. Rendered ABOVE the feed and OUTSIDE the
 * virtualizer's row list — it is surface state, not a feed row, so it survives paging and never
 * competes with the bounded-window property `buildFeedRows`/`useSessionFeed` maintain. */
function PersistenceFailureBanner({ text }: { text: string }) {
  return (
    <div
      role="listitem"
      style={{
        marginBottom: "var(--space-sm)",
        padding: "var(--space-sm) var(--space-md)",
        background: "var(--surface-secondary)",
        borderRadius: "var(--radius-chrome)",
      }}
    >
      <p
        className="type-body"
        style={{
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          color: "var(--text-primary-rack)",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted-rack)" }}>
          <Icon name="TriangleAlert" />
        </span>
        {text}
      </p>
    </div>
  );
}

/** The user must never see an empty scroll area while the process starts (02-UI-SPEC.md State
 * Inventory: "empty"/"loading" both resolve to this same pulse row) — replaced the moment the
 * first real event arrives, never accumulating above it (it renders only while `feedRows` is
 * empty). */
function StartingSessionRow() {
  return (
    <div role="listitem" className="type-body" style={{ padding: "var(--space-xs) 0", color: "var(--text-muted-rack)" }}>
      Starting session…
    </div>
  );
}

const SCROLL_TOP_FETCH_THRESHOLD_PX = 40;

export function SessionSurface({
  agentRunId,
  onBack,
  taskId = null,
  epicId = null,
  initialStatus = "running",
  authoringStage = null,
  initialFeedOffset = null,
}: SessionSurfaceProps) {
  const [status, setStatus] = useState<RunStatus>(initialStatus);
  const [stopping, setStopping] = useState(false);
  // `stopping` alone is not a sufficient guard against two activations in one synchronous tick —
  // React has not necessarily flushed the re-render that disables the Stop button before a
  // second `.click()` fires — and a ref reads and writes synchronously with no such window
  // (mirrors `item-detail/RunsSection.tsx`'s `ackActingRef` / `recovery/OrphanRecoveryModal.tsx`'s
  // `killingRef`, 03-17-PLAN.md Task 1). `stopping` stays the source of truth for what renders;
  // this ref only guards dispatch.
  const stoppingRef = useRef(false);
  // Discard's own pair of the same guard (D-66/D-67, plan 04-13) — copies `stopping`/`stoppingRef`
  // structure exactly, for the same reason: the discard's own bounded wait can run up to eight
  // seconds, so the window for a second synchronous activation before React flushes the disabled
  // attribute is, if anything, more likely to matter here, not less.
  const [discarding, setDiscarding] = useState(false);
  const discardingRef = useRef(false);
  const [stopWarning, setStopWarning] = useState<string | null>(null);
  const setLaunchSheetTaskId = useUiStore((state) => state.setLaunchSheetTaskId);
  const setReviewSurface = useUiStore((state) => state.setReviewSurface);
  // D-66's hand-off, generalised for a conversation (plan 05-09): an authoring run's Discard
  // primes a fresh authoring launch for the SAME epic rather than the task launch sheet — see
  // `handleDiscard` below.
  const setLaunchSheetAuthoringHandoff = useUiStore((state) => state.setLaunchSheetAuthoringHandoff);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [persistenceFailureText, setPersistenceFailureText] = useState<string | null>(null);
  const [rawViewOpen, setRawViewOpen] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const { expanded, toggle } = useExpandedRows();

  // D-88 (plan 05-03): the run's OWN live stage — initialised from the mount-time
  // `authoringStage` prop, then advanced/returned by the handlers below. `null` for an ordinary
  // task-execution run, matching the prop's own `null`/`undefined` meaning.
  const [stage, setStage] = useState<string | null>(authoringStage ?? null);
  // T-05-03-01: set once, never cleared — the gate-missing banner stays visible for the rest of
  // this run once its notice has arrived.
  const [gateMissingText, setGateMissingText] = useState<string | null>(null);

  // D-90 (plan 05-03): synchronously-guarded advance/return, shared by the `n` keyboard binding
  // below AND `AuthoringStageControls`' own buttons — the SAME `ackActingRef`/`answeringRef`/
  // `stoppingRef` pattern this codebase applies repeatedly (`PermissionRequestCard.tsx`,
  // `ProposalTray.tsx`, `handleStop`/`handleDiscard` above), so a click and a keypress can never
  // race each other into two backend calls.
  const [advancingStage, setAdvancingStage] = useState(false);
  const advancingStageRef = useRef(false);
  const [returningStage, setReturningStage] = useState(false);
  const returningStageRef = useRef(false);

  function handleAdvanceStage() {
    if (advancingStageRef.current || !stage) return;
    const next = nextAuthoringStage(stage);
    if (!next) return;
    advancingStageRef.current = true;
    setAdvancingStage(true);
    authoringStageAdvance(agentRunId)
      .then((resolved) => setStage(resolved))
      .catch(() => {
        // Best-effort — no dedicated error surface specified for this control; the stage
        // indicator simply stays at its prior value and the developer can try again.
      })
      .finally(() => {
        advancingStageRef.current = false;
        setAdvancingStage(false);
      });
  }

  function handleReturnStage() {
    if (returningStageRef.current || !stage) return;
    const previous = previousAuthoringStage(stage);
    if (!previous) return;
    returningStageRef.current = true;
    setReturningStage(true);
    authoringStageReturn(agentRunId, previous)
      .then((resolved) => setStage(resolved))
      .catch(() => {
        // Best-effort, mirroring handleAdvanceStage above.
      })
      .finally(() => {
        returningStageRef.current = false;
        setReturningStage(false);
      });
  }

  // The "View raw" toggle (02-UI-SPEC.md "View raw" affordance, plan 02-07 Task 3) — subscribes
  // to the `toggle-raw-view` action id rather than owning a key of its own; the window-level
  // listener lives inside `useRegionBindings` (state/keyboard.ts), not here. `advance-stage`
  // (plan 05-03) joins the same call: `n` in this region re-enters `handleAdvanceStage` above —
  // the exact function the Advance button's own `onClick` calls — so it is a no-op for an ordinary
  // task-execution run (`stage` is `null`) or once already at `criteria`, and cannot double-fire
  // alongside a synchronous button click.
  useRegionBindings("session-surface", "session-surface", {
    "toggle-raw-view": () => setRawViewOpen((prev) => !prev),
    "advance-stage": handleAdvanceStage,
  });

  const feedQuery = useSessionFeed(agentRunId, initialFeedOffset);

  // T-06-35 (plan 06-08): the execution-run half of the tray's mount condition, derived from the
  // SAME run-scoped query `ProposalTray.tsx` itself reads through (`useRunProposals`) — never a
  // run-kind flag or a second FETCH SHAPE. Disabled (`null`) whenever `authoringStage` is set: an
  // authoring run already mounts the tray unconditionally via the OR's first clause below, so a
  // second live subscriber to the exact query `ProposalTray.tsx`'s OWN mount is about to open
  // would be pure churn there — a second concurrent subscriber to the same query key was
  // reproduced live to disrupt `authoring/__tests__/proposal-keyboard.test.tsx`'s per-row `e`/`d`
  // keyboard dispatch (an extra render cycle racing the window keydown listener's own
  // effect-cleanup/re-add churn, `state/keyboard.ts`'s `useRegionBindings`). Enabled only for the
  // one case that actually needs it: an ordinary task-execution run, where this is the sole reader
  // until the condition below decides to mount the tray at all.
  const runProposalsQuery = useRunProposals(authoringStage ? null : agentRunId);
  const hasStagedProposals = (runProposalsQuery.data?.length ?? 0) > 0;

  // The permission-request card's `feed` mount (AGNT-06, plan 02-06 Task 2) — this run's pending
  // set, read from the ONE shared query the item detail panel's compact mount also reads for the
  // same `agentRunId`, so answering in either place clears both (Discretion #6).
  const pendingQuery = usePendingPermissionRequests(agentRunId);
  const pendingRequests = pendingQuery.data ?? [];

  async function handleAnswer(requestId: string, decision: PermissionDecision) {
    await answerPermissionRequest(requestId, decision);
  }

  // The terminal status word arrives through the same pushed delta a live `agent:event` push
  // drives (a `session_closed` event's `reason`, plan 02-02 D-35) — never from `stopAgentRun`'s
  // own resolved promise, which is why the Stop control below never assumes its own write landed.
  // `useSessionFeed` itself owns invalidating the windowed read on this same subscription.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeAgentEvent((event) => {
      if (event.type === "session_closed" && isRunStatus(event.reason)) {
        setStatus(event.reason);
      }
      // The incomplete-transcript banner (plan 02-12, CR-03/PROC-07): the Rust-side reader loop
      // emits this SAME `agent:event` channel's synthetic `system_notice` the first time this
      // run's session-log persist fails. Scoped to THIS surface's own run — a notice for a
      // different run must never show here (one run's I/O fault stays scoped to that run).
      if (event.flywheelPersistenceFailure === true && event.runId === agentRunId) {
        setPersistenceFailed(true);
        setPersistenceFailureText(typeof event.text === "string" ? event.text : null);
      }
      // T-05-03-01 (plan 05-03): the challenge-stage gate could not be installed for this
      // session — scoped to THIS surface's own run, mirroring the persistence-failure notice
      // immediately above exactly.
      if (event.flywheelStageGateMissing === true && event.runId === agentRunId) {
        setGateMissingText(typeof event.text === "string" ? event.text : GATE_MISSING_FALLBACK_TEXT);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentRunId]);

  // The command's own resolution now carries the status Flywheel RECORDED (plan 02-11, CR-04) —
  // the terminal write is never gated on the sidecar's acknowledgement, so this promise always
  // resolves once the command succeeds. A real `session_closed` push (the effect above) remains
  // the source for what the agent process actually did and still wins if it arrives; this is an
  // ADDITIONAL source, guarded by `isRunStatus` so an unexpected string can never widen the
  // status union. `.catch` stays the genuine-failure path — the terminal write itself failed.
  function handleStop() {
    // A second activation while the ref is set invokes nothing — the synchronous-tick guard.
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    stopAgentRun(agentRunId)
      .then((result) => {
        // Never cleared here: a successful stop drives `status` to a terminal value, `showStop`
        // goes false and the button unmounts — there is nothing left to guard.
        if (isRunStatus(result.status)) {
          setStatus(result.status);
        }
        setStopWarning(result.sidecarWarning);
      })
      .catch(() => {
        // Clear the ref before re-enabling — a genuine failure must leave the control usable,
        // which matters more here than on any other surface: the alternative is an agent that
        // keeps spending.
        stoppingRef.current = false;
        setStopping(false);
      });
  }

  // D-66/D-67, CTX-08 (plan 04-13): the phase's flagship action. One activation ends the session
  // — giving the agent's own closing summary a bounded window to land first — and lands the
  // developer on the launch sheet, pre-filled for the SAME task, with no intermediate step.
  // Copies `handleStop`'s own structure line for line, including the ref-based double-activation
  // guard: React has not necessarily flushed the disabling re-render before a second activation in
  // the same synchronous tick.
  function handleDiscard() {
    if (discardingRef.current) return;
    discardingRef.current = true;
    setDiscarding(true);
    discardSession(agentRunId)
      .then((result) => {
        // Mirrors `handleStop`'s own resolution handling exactly — a real `session_closed` push
        // (the effect above) remains the source for what the agent process actually did and still
        // wins if it arrives; this is an ADDITIONAL source.
        if (isRunStatus(result.status)) {
          setStatus(result.status);
        }
        setStopWarning(result.sidecarWarning);
        // One action in, one Enter out (D-67): land on the launch sheet, pre-filled for this
        // run's own task, the instant the discard resolves — no intermediate confirmation.
        // Plan 05-09: an authoring run (`stage` non-null — set once at mount from the
        // `authoringStage` prop and never cleared) has no task and no worktree, so its own
        // discard hand-off primes a fresh authoring launch for the SAME epic instead — carrying
        // `epicId` (possibly `null`, for a fresh-epic run) through the SAME `uiStore` channel
        // shape `taskId` uses for the task case.
        if (stage !== null) {
          setLaunchSheetAuthoringHandoff(epicId);
        } else if (taskId) {
          setLaunchSheetTaskId(taskId);
        }
      })
      .catch(() => {
        // On rejection, reuse the SAME muted `StopWarningNotice` treatment `handleStop` never
        // needed a rejection path for — the plan's own instruction: no second notice component.
        // Clear the ref before re-enabling, matching `handleStop`'s own "a genuine failure must
        // leave the control usable" reasoning — a surfaced contradiction must never stand between
        // the developer and a fresh session.
        discardingRef.current = false;
        setDiscarding(false);
        setStopWarning(
          "Flywheel could not confirm this discard completed. The session may still be live — try again.",
        );
      });
  }

  const showStop = !TERMINAL_STATUSES.includes(status);

  const entries = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.entries) ?? [],
    [feedQuery.data],
  );
  const feedRows = useMemo(() => buildFeedRows(entries), [entries]);
  const terminalInfo = useMemo(() => findTerminalInfo(entries), [entries]);
  const showStartingPulse = feedRows.length === 0 && !terminalInfo;

  const rowVirtualizer = useVirtualizer({
    count: feedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => feedRowEstimateSize(feedRows[index], expanded.has(feedRows[index].key)),
    overscan: 10,
  });

  // A tool-call row's expand/collapse toggle changes its OWN fixed size (never a measured one —
  // `feedRowEstimateSize` still returns one of exactly two constants); `measure()` invalidates
  // the virtualizer's cached sizes so the new `estimateSize` output takes effect. This is not
  // `measureElement` (DOM-based, per-row measurement) — it is a deterministic recomputation from
  // the same fixed-size function.
  useEffect(() => {
    rowVirtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    if (
      event.currentTarget.scrollTop <= SCROLL_TOP_FETCH_THRESHOLD_PX &&
      feedQuery.hasPreviousPage &&
      !feedQuery.isFetchingPreviousPage
    ) {
      feedQuery.fetchPreviousPage();
    }
  }

  // Follow-the-tail (02-UI-SPEC.md Performance Contract) — suppressed for as long as ANY
  // permission request is pending, and resumes the instant none is (this effect re-runs on
  // `pendingRequests.length` transitioning back to zero, which is exactly "resume once answered").
  // Also suppressed for the whole lifetime of a surface opened at an explicit `initialFeedOffset`
  // (D-99, plan 06-08's turn-pointer jump): a developer who just jumped to a specific turn came to
  // read THAT point, not to be snapped straight back to the tail the instant its page loads. Every
  // pre-existing caller passes no offset, so this is a pure addition — the effect's own behaviour
  // for `initialFeedOffset == null` is byte-identical to before.
  useEffect(() => {
    if (pendingRequests.length > 0 || initialFeedOffset != null) return;
    // Optional call, not just optional chaining on the ref: jsdom (this project's test
    // environment) implements no `Element.prototype.scrollIntoView` at all — a real browser always
    // has it, but a test asserting this behaviour installs its own spy first.
    tailRef.current?.scrollIntoView?.({ block: "end" });
  }, [feedRows.length, pendingRequests.length, terminalInfo, initialFeedOffset]);

  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        flexDirection: "column",
        color: "var(--text-primary-rack)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-md)",
          padding: "var(--space-md)",
          borderBottom: "1px solid var(--divider)",
        }}
      >
        <button
          type="button"
          onClick={onBack}
          className="type-label"
          style={{ background: "transparent", border: "none", color: "inherit", cursor: "pointer" }}
        >
          ← Board
        </button>
        <span className="type-heading">Session</span>
        <RunStatusBadge status={status} />

        <StatusStrip entries={entries} running={status === "running" || status === "blocked"} />

        {stage && (
          <>
            <AuthoringStageIndicator stage={stage} />
            <AuthoringStageControls
              stage={stage}
              advancing={advancingStage}
              returning={returningStage}
              onAdvance={handleAdvanceStage}
              onReturn={handleReturnStage}
            />
          </>
        )}

        <button
          type="button"
          onClick={() => setRawViewOpen((prev) => !prev)}
          className="type-label"
          style={{
            background: "transparent",
            border: "1px solid var(--divider)",
            borderRadius: "var(--radius-chrome)",
            color: "var(--text-primary-rack)",
            padding: "var(--space-xs) var(--space-md)",
            cursor: "pointer",
          }}
        >
          {rawViewOpen ? "View structured" : "View raw"}
        </button>

        {showStop && (
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping || discarding}
            className="type-label"
            style={{
              background: "transparent",
              border: "1px solid var(--divider)",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: stopping || discarding ? "default" : "pointer",
            }}
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}

        {showStop && (
          // D-67: the flagship verb, beside Stop — never a modifier folded into it. Styled with
          // the same filled-accent treatment the launch sheet's own primary action
          // (`LaunchSheet.tsx`'s "Start Work" button) uses, so the control this hands off TO and
          // the control that starts this hand-off read as one visual family.
          <button
            type="button"
            onClick={handleDiscard}
            disabled={stopping || discarding}
            className="type-label"
            style={{
              background: "var(--accent-nontext)",
              border: "none",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: stopping || discarding ? "default" : "pointer",
            }}
          >
            {discarding ? "Discarding…" : "Discard"}
          </button>
        )}

        {!showStop && taskId && (
          // D-133: a finished run is the moment review is most likely wanted. The review branch
          // sits ahead of the session branch in the surface chain, so setting the store field is
          // the whole navigation — no second path.
          <button
            type="button"
            onClick={() => setReviewSurface({ scope: "task", itemId: taskId, label: "This task" })}
            className="type-label"
            style={{
              background: "var(--accent-nontext)",
              border: "none",
              borderRadius: "var(--radius-chrome)",
              color: "var(--text-primary-rack)",
              padding: "var(--space-xs) var(--space-md)",
              cursor: "pointer",
            }}
          >
            Review changes
          </button>
        )}
      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      {/* The feed side of this row (SHAPE-01, plan 05-12): the raw/structured view above, the
          composer below it — both inside this ONE column, so the proposal tray (below) keeps its
          own separate column regardless of which view is active. */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {rawViewOpen ? (
        <RawLogView agentRunId={agentRunId} />
      ) : (
        <div
          ref={parentRef}
          onScroll={handleScroll}
          data-testid="session-feed-scroll"
          style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)" }}
        >
          {persistenceFailed && (
            <PersistenceFailureBanner
              text={persistenceFailureText ?? "Flywheel could not write this session's log — the transcript below may be incomplete."}
            />
          )}

          {gateMissingText && <PersistenceFailureBanner text={gateMissingText} />}

          {showStartingPulse && <StartingSessionRow />}

          <div role="list" aria-label="Session events" style={{ position: "relative", height: rowVirtualizer.getTotalSize(), width: "100%" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = feedRows[virtualRow.index];
              return (
                <div
                  key={row.key}
                  data-testid="feed-row-slot"
                  // G-02-3: this wrapper occupies EXACTLY the height the virtualizer reserved
                  // for this row (`virtualRow.size`, produced by `feedRowEstimateSize`'s fixed
                  // per-row-kind constant — never corrected by measurement) and clips anything
                  // that exceeds it. `feedRowEstimateSize` decided where the NEXT row starts, so
                  // a row free to paint past its own reservation paints over every row
                  // positioned after it — which is exactly what gap G-02-3 reported.
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: virtualRow.size,
                    overflow: "hidden",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <FeedRow row={row} expanded={expanded.has(row.key)} onToggleExpand={() => toggle(row.key)} />
                </div>
              );
            })}
          </div>

          {terminalInfo && <TerminalRow info={terminalInfo} isAuthoring={stage !== null} />}

          {stopWarning && <StopWarningNotice warning={stopWarning} />}

          {pendingRequests.length > 0 && (
            <div style={{ marginTop: "var(--space-md)" }}>
              <PermissionRequestCard variant="feed" requests={pendingRequests} onAnswer={handleAnswer} />
            </div>
          )}

          <div ref={tailRef} />
        </div>
      )}
      {/* SHAPE-01 (plan 05-12): the same condition Stop/Discard already gate on — an authoring
          run (`stage` non-null) that has not yet reached a terminal status. */}
      {stage && showStop && <AuthoringComposer agentRunId={agentRunId} />}
      </div>
      {(authoringStage || hasStagedProposals) && (
        // D-88: the proposal tray mounts for every authoring run (unchanged, byte-identical
        // branch) OR — T-06-35, plan 06-08 — for an ordinary task-execution run that has staged at
        // least one proposal (`hasStagedProposals` above). `ProposalTray.tsx` itself is untouched
        // and run-kind agnostic by construction: it queries by `agentRunId` alone
        // (`useRunProposals`), so mounting it here for an execution run needs no new prop, no run
        // kind passed in, and no second component — a sibling panel beside the feed, never woven
        // into FeedRow.tsx's per-event rendering (ProposalTray.tsx's own doc comment).
        <div
          style={{
            width: 320,
            flexShrink: 0,
            borderLeft: "1px solid var(--divider)",
            padding: "var(--space-md)",
            overflowY: "auto",
          }}
        >
          <ProposalTray agentRunId={agentRunId} />
        </div>
      )}
      </div>
    </div>
  );
}
