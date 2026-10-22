/**
 * The live session surface (D-31, plan 02-01 Task 1): a full content-area surface, pushed into
 * from a Story and popped back out of via the `← Back` affordance — never a tab inside the 480px
 * item detail panel and never a dockable pane. The board stays the board.
 *
 * Plan 02-02 Task 3 adds the Stop affordance and the run-status word. Plan 02-06 Task 2 mounts
 * the permission-request card's `feed` variant here, at the tail of the event list, and
 * suppresses the feed's follow-the-tail scroll for as long as any request is pending.
 *
 * Plan 02-07 Task 2 replaces the tracer's plain row-per-raw-event render with the real
 * structured feed (D-32): `useSessionFeed` (`board/useBoardQuery.ts`) pages a bounded window in
 * from the TAIL of the persisted log (D-33), older pages fetched as the user scrolls toward the
 * top of what is loaded — never the whole transcript in memory (PROC-07). `feedRows.ts` turns the
 * entries into rows (pairing, filtering, cards) and `FeedRow.tsx` renders each one.
 *
 * Story #56 replaced the fixed 32px virtual slots (which clipped every agent turn to one line of
 * unrendered markdown) with measured, variable-height virtual rows.
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Icon } from "../components/Icon";
import {
  answerPermissionRequest,
  answerQuestion,
  discardSession,
  sessionGet,
  stopSession,
  storyGet,
  subscribeAgentEvent,
} from "../adapters/tauri";
import { useSessionFeed, usePendingPermissionRequests } from "../board/useBoardQuery";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import { endingWords, formatWhen } from "../board/StoryBoard";
import { MARKS_BY_ID } from "../legend/marks";
import { StateBadge } from "../components/StateBadge";
import {
  RUN_STATUS_LABELS,
  TERMINAL_STATUSES,
  formatCostUsd,
  formatCount,
  formatAge,
  formatElapsed,
  isRunStatus,
} from "../legend/runStatus";
import type { RunStatus } from "../legend/runStatus";
import { useRegionBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import { PermissionRequestCard, type PermissionDecision } from "./PermissionRequestCard";
import { FeedRow, feedRowEstimateSize, prefersReducedMotion, useExpandedRows } from "./FeedRow";
import {
  ASK_USER_QUESTION_TOOL,
  buildFeedRows,
  findLiveCallKey,
  questionsFromPayload,
  sameQuestions,
  toolCallLabel,
  type FeedRowData,
} from "./feedRows";
import type { PendingPermissionRequest } from "./PermissionRequestCard";
import type { QuestionPicks } from "./QuestionForm";
import { RawLogView } from "./RawLogView";
import "./session.css";

const MONO_STACK = "var(--font-code)";

/**
 * Issue #100: which open question each unanswered question card in the feed answers, by row key. A
 * pending `AskUserQuestion` request is matched to the newest unanswered question row asking the same
 * questions; a request with no such row (its call not in the loaded window yet) stays in the card
 * below the feed, which answers it the same way.
 */
export function openQuestionRows(rows: FeedRowData[], pending: PendingPermissionRequest[]): Map<string, string> {
  const byRow = new Map<string, string>();
  for (const request of pending) {
    if (request.toolName !== ASK_USER_QUESTION_TOOL) continue;
    const questions = questionsFromPayload(request.inputPayload);
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const row = rows[i];
      if (row.kind === "question" && row.answer === undefined && !byRow.has(row.key) && sameQuestions(row.questions, questions)) {
        byRow.set(row.key, request.id);
        break;
      }
    }
  }
  return byRow;
}

/** The glyph-and-word run-status badge (02-UI-SPEC.md "Run Status", plan 02-07 Task 3) — never
 * colour alone. `run-running`'s `Loader` glyph carries the one continuous-motion exception this
 * product allows (Motion Additions: "signalling a process is alive right now, not decorating a
 * state change"); `.agent-pulse` (styles/globals.css) is omitted entirely under a reduced-motion
 * preference rather than merely zeroed, so the glyph stays static rather than freezing mid-pulse —
 * but it is never removed, the running state must stay legible either way. */
function RunStatusBadge({ status }: { status: RunStatus }) {
  const pulsing = status === "running" && !prefersReducedMotion();
  return <StateBadge state={status} pulse={pulsing} />;
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
        color: "var(--muted-foreground)",
      }}
    >
      <span className="type-label tabular-nums" aria-label="Elapsed time">
        {formatElapsed(startedAt, now)}
      </span>
      {/* Figures or nothing. The backend reports totals once, on the terminal `result`, so for the whole
          of a running session there is nothing to print; three dashes beside two bare words read as
          broken data, not as absent data (08.1-17 closure). The meter grows when the figures exist. */}
      {tokensIn !== undefined && (
        <span className="type-label tabular-nums" aria-label="Tokens in">
          {formatCount(tokensIn)} in
        </span>
      )}
      {tokensOut !== undefined && (
        <span className="type-label tabular-nums" aria-label="Tokens out">
          {formatCount(tokensOut)} out
        </span>
      )}
      {costUsd !== undefined && (
        <span className="type-label tabular-nums" aria-label="Cost">
          {formatCostUsd(costUsd)}
        </span>
      )}
    </div>
  );
}

export interface SessionSurfaceProps {
  sessionId: string;
  onBack: () => void;
  /** The Story this session belongs to (D-66/D-67) — `null` only for a caller that has not threaded
   * it through. Needed so `handleDiscard` can hand off to the launch sheet for the SAME Story on
   * resolution, and so the header can name the Story. */
  storyId?: string | null;
  /** The run's status when this surface first mounts. A caller that already knows it (the fleet,
   * whose row is showing a `failed` run) passes it here so the surface agrees with that row from the
   * first frame; `"running"` is only the no-information fallback, used right after Start Work when
   * nothing but a live session is possible (Phase 10 plan 10-01, RESEARCH Pitfall 7 — nothing
   * re-reads the status on mount, so a terminal run opened without this reads "Running" for good). */
  initialStatus?: RunStatus | null;
  /** A one-shot initial position for the feed (D-99, plan 06-08) — `null`/`undefined` (the
   * default) preserves this surface's existing "open at the tail" behaviour byte-for-byte, for
   * every pre-existing call site. Set only by the triage surface's turn-pointer jump
   * (`App.tsx`'s `activeSessionInitialLogOffset`), which has a recorded log offset to open at
   * rather than "whatever the tail currently is" — threaded straight into `useSessionFeed`. */
  initialFeedOffset?: number | null;
}

/** Re-exported for the fleet's activity cell, which reads the same rows (`fleet/FleetSurface.tsx`). */
export { buildFeedRows } from "./feedRows";

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

/** D-35's Stop gloss: a Story run's worktree is left exactly as the agent left it (PROC-06 —
 * nothing committed on the user's behalf). */
const TASK_STOPPED_GLOSS =
  "This run was stopped. The worktree was left exactly as the agent left it — nothing was lost.";

function TerminalRow({ info }: { info: TerminalInfo }) {
  if (info.reason === "failed") {
    return (
      <div
        role="listitem"
        className="session-notice"
        style={{ marginTop: "var(--space-sm)" }}
      >
        <p className="type-body" style={{ margin: 0, color: "var(--foreground)" }}>
          {FAILED_RUN_GLOSS}
        </p>
        {info.subtype && (
          <p
            className="type-label"
            style={{ margin: "var(--space-xs) 0 0 0", fontFamily: MONO_STACK, color: "var(--destructive-text)" }}
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
              color: "var(--muted-foreground)",
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
      style={{ marginTop: "var(--space-sm)", padding: "var(--space-sm) var(--space-md)", color: "var(--muted-foreground)" }}
    >
      {RUN_STATUS_LABELS[info.reason]}
      {info.reason === "interrupted" && (
        <p style={{ margin: "var(--space-xs) 0 0 0" }}>
          {TASK_STOPPED_GLOSS}
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
      className="session-notice"
      style={{ marginTop: "var(--space-sm)" }}
    >
      <p
        className="type-body"
        style={{
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          color: "var(--foreground)",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--muted-foreground)" }}>
          <Icon name={mark?.glyph ?? "CircleSlash"} />
        </span>
        {STOP_WARNING_GLOSS}
      </p>
      <p
        className="type-label"
        style={{ margin: "var(--space-xs) 0 0 0", fontFamily: MONO_STACK, color: "var(--muted-foreground)" }}
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
      className="session-notice"
      style={{ marginBottom: "var(--space-sm)" }}
    >
      <p
        className="type-body"
        style={{
          margin: 0,
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          color: "var(--foreground)",
        }}
      >
        <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--muted-foreground)" }}>
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
    <div role="listitem" className="type-body" style={{ padding: "var(--space-xs) 0", color: "var(--muted-foreground)" }}>
      Starting session…
    </div>
  );
}

/** Every state has a floor, so the surface never ends in blank ground (08.1-17 closure). It states who
 * the run is waiting on; while the agent works it says what on and when it last showed life (Story
 * #56: a healthy run must not look stalled). Its own component, so its once-a-second tick re-renders
 * this line and nothing else. */
function SessionFloor({
  ended,
  waitingOnYou,
  running,
  doing,
  lastActivityAt,
}: {
  ended: boolean;
  waitingOnYou: boolean;
  running: boolean;
  doing: string | null;
  lastActivityAt: string | undefined;
}) {
  const working = running && !waitingOnYou && !ended;
  const now = useNowTick(working);
  let text: string;
  if (ended) text = "This run has ended. Nothing more will be added to this transcript.";
  else if (waitingOnYou) text = "Waiting on you: answer the permission request above.";
  else if (working) {
    const what = doing ? `The agent is working: ${doing}.` : "The agent is working.";
    text = lastActivityAt ? `${what} Last activity ${formatAge(lastActivityAt, now)} ago.` : what;
  } else text = "Waiting on the agent.";
  return (
    <p role="status" className="session-floor type-label" title={text}>
      {text}
    </p>
  );
}

const SCROLL_TOP_FETCH_THRESHOLD_PX = 40;

/** The title of a run whose board item cannot be resolved (read failed, item gone, or no id). A live run
 * still needs its surface, so an unresolvable item degrades to this and never blanks or throws. */
const SESSION_FALLBACK_TITLE = "Session";

export function SessionSurface({
  sessionId,
  onBack,
  storyId = null,
  initialStatus = null,
  initialFeedOffset = null,
}: SessionSurfaceProps) {
  // What this view has heard: the caller's status, then any `session_closed` push or Stop/Discard
  // result. It is only a fallback for the stored row below (issue #110).
  const [heardStatus, setStatus] = useState<RunStatus>(initialStatus ?? "running");
  // Issue #110: the session's stored row is the source of truth for whether it has ended, how and
  // when. Without it, a finished session opened from its Story read "Running" with a Stop button,
  // because nothing but a live push ever moved the status off its "running" default. Re-read on
  // every board change, since the core writes the end after it pushes `session_closed`.
  const storedQueryKey = useMemo(() => ["session", sessionId], [sessionId]);
  const { data: stored } = useQuery({
    queryKey: storedQueryKey,
    queryFn: () =>
      sessionGet(sessionId)
        .then((row) => row ?? null)
        .catch(() => null),
    retry: false,
  });
  useBoardChangedInvalidation({ kind: "account" }, [storedQueryKey]);
  const storedEnded =
    stored != null &&
    (stored.endedAt !== null || (isRunStatus(stored.status) && TERMINAL_STATUSES.includes(stored.status)));
  const status: RunStatus = storedEnded && isRunStatus(stored.status) ? stored.status : heardStatus;
  // Core Value (finish-review four-1): the header names the Story this session serves. A failed or
  // empty read resolves to `null` and the header says "Session".
  const { data: itemHeader } = useQuery({
    queryKey: ["session-header", storyId],
    queryFn: () =>
      (storyId ? storyGet(storyId) : Promise.resolve(null))
        .then((story) => (story ? { key: story.key, title: story.title, projectId: story.projectId } : null))
        .catch(() => null),
    enabled: Boolean(storyId),
    retry: false,
  });
  const headerText = itemHeader ? `${itemHeader.key} ${itemHeader.title}` : SESSION_FALLBACK_TITLE;
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
  const setLaunchSheetStoryId = useUiStore((state) => state.setLaunchSheetStoryId);
  const openStory = useUiStore((state) => state.openStory);
  const [persistenceFailed, setPersistenceFailed] = useState(false);
  const [persistenceFailureText, setPersistenceFailureText] = useState<string | null>(null);
  const [rawViewOpen, setRawViewOpen] = useState(false);
  const tailRef = useRef<HTMLDivElement>(null);
  const parentRef = useRef<HTMLDivElement>(null);
  const { expanded, toggle } = useExpandedRows();

  // The "View raw" toggle (02-UI-SPEC.md "View raw" affordance, plan 02-07 Task 3) — subscribes
  // to the `toggle-raw-view` action id rather than owning a key of its own; the window-level
  // listener lives inside `useRegionBindings` (state/keyboard.ts), not here.
  useRegionBindings("session-surface", "session-surface", {
    "toggle-raw-view": () => setRawViewOpen((prev) => !prev),
  });

  const feedQuery = useSessionFeed(sessionId, initialFeedOffset);

  // The permission-request card's `feed` mount (AGNT-06, plan 02-06 Task 2) — this run's pending
  // set, read from the ONE shared query the item detail panel's compact mount also reads for the
  // same `sessionId`, so answering in either place clears both (Discretion #6).
  const pendingQuery = usePendingPermissionRequests(sessionId);
  const pendingRequests = pendingQuery.data ?? [];

  async function handleAnswer(requestId: string, decision: PermissionDecision, rule?: string) {
    await answerPermissionRequest(requestId, decision, rule);
  }

  async function handleAnswerQuestion(requestId: string, picks: QuestionPicks) {
    await answerQuestion(requestId, picks);
  }

  // The terminal status word arrives through the same pushed delta a live `agent:event` push
  // drives (a `session_closed` event's `reason`, plan 02-02 D-35) — never from `stopSession`'s
  // own resolved promise, which is why the Stop control below never assumes its own write landed.
  // `useSessionFeed` itself owns invalidating the windowed read on this same subscription.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeAgentEvent((event) => {
      // Another session's close is not this one's (issue #110).
      if (event.type === "session_closed" && event.runId === sessionId && isRunStatus(event.reason)) {
        setStatus(event.reason);
      }
      // The incomplete-transcript banner (plan 02-12, CR-03/PROC-07): the Rust-side reader loop
      // emits this SAME `agent:event` channel's synthetic `system_notice` the first time this
      // run's session-log persist fails. Scoped to THIS surface's own run — a notice for a
      // different run must never show here (one run's I/O fault stays scoped to that run).
      if (event.flywheelPersistenceFailure === true && event.runId === sessionId) {
        setPersistenceFailed(true);
        setPersistenceFailureText(typeof event.text === "string" ? event.text : null);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
    stopSession(sessionId)
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
  // developer on the launch sheet, pre-filled for the SAME Story, with no intermediate step.
  // Copies `handleStop`'s own structure line for line, including the ref-based double-activation
  // guard: React has not necessarily flushed the disabling re-render before a second activation in
  // the same synchronous tick.
  function handleDiscard() {
    if (discardingRef.current) return;
    discardingRef.current = true;
    setDiscarding(true);
    discardSession(sessionId)
      .then((result) => {
        // Mirrors `handleStop`'s own resolution handling exactly — a real `session_closed` push
        // (the effect above) remains the source for what the agent process actually did and still
        // wins if it arrives; this is an ADDITIONAL source.
        if (isRunStatus(result.status)) {
          setStatus(result.status);
        }
        setStopWarning(result.sidecarWarning);
        // One action in, one Enter out (D-67): land on the launch sheet, pre-filled for this
        // session's own Story, the instant the discard resolves — no intermediate confirmation.
        if (storyId) {
          setLaunchSheetStoryId(storyId);
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

  const showStop = !storedEnded && !TERMINAL_STATUSES.includes(status);

  const entries = useMemo(
    () => feedQuery.data?.pages.flatMap((page) => page.entries) ?? [],
    [feedQuery.data],
  );
  const feedRows = useMemo(() => buildFeedRows(entries), [entries]);
  // Issue #100: an open question is answered in its own feed card; whatever has no card stays below.
  const questionRows = useMemo(() => openQuestionRows(feedRows, pendingRequests), [feedRows, pendingRequests]);
  const footerRequests = useMemo(() => {
    const answeredInFeed = new Set(questionRows.values());
    return pendingRequests.filter((r) => !answeredInFeed.has(r.id));
  }, [pendingRequests, questionRows]);
  const terminalInfo = useMemo(() => findTerminalInfo(entries), [entries]);
  const showStartingPulse = feedRows.length === 0 && !terminalInfo;
  // The call in flight: the newest tool call that has no result yet, while the run is running. A notice
  // after it (a retry) does not end it. A call left unpaired in a finished or blocked run is not live, so
  // it never pulses.
  const liveRowKey = status === "running" ? findLiveCallKey(feedRows) : null;
  const liveRow = liveRowKey ? feedRows.find((row) => row.key === liveRowKey) : undefined;
  // The newest entry of any kind, rows or not: a reasoning block or a heartbeat is not a row, but it is
  // the agent showing signs of life, which is what tells a working run from a stalled one.
  const lastActivityAt = [...entries].reverse().find((entry) => typeof entry.at === "string")?.at as string | undefined;

  // Virtualized with measured rows (Story #56): a long Story session logs thousands of events, so only a
  // window of rows is mounted. Rows are variable height (markdown turns, cards, expanded calls), so each
  // mounted row is measured (`measureElement`, re-measured by its ResizeObserver when it grows) and
  // `feedRowEstimateSize` is only the first guess. A zero measurement (no layout, as in jsdom) falls back
  // to the guess rather than collapsing every row onto the first.
  const rowVirtualizer = useVirtualizer({
    count: feedRows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => feedRowEstimateSize(feedRows[index], expanded.has(feedRows[index].key)),
    getItemKey: (index) => feedRows[index].key,
    measureElement: (element) => {
      const measured = element.getBoundingClientRect().height;
      if (measured > 0) return measured;
      const row = feedRows[Number((element as HTMLElement).dataset.index)];
      return row ? feedRowEstimateSize(row, expanded.has(row.key)) : 0;
    },
    overscan: 10,
  });

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
        color: "var(--foreground)",
      }}
    >
      <header className="session-header">
        <button type="button" onClick={onBack} className="session-back type-label">
          ← Back
        </button>
        {itemHeader && storyId ? (
          // Where the developer is (issue #104): the session's Story, which is one click away. The
          // control keeps the title's look; it only gains a destination.
          <button
            type="button"
            className="type-heading session-title"
            title={`Open Story ${headerText}`}
            aria-label={`Open Story ${headerText}`}
            onClick={() => openStory(itemHeader.projectId, storyId)}
            style={{ padding: 0, border: "none", background: "none", color: "inherit", font: "inherit", textAlign: "left", cursor: "pointer" }}
          >
            {headerText}
          </button>
        ) : (
          <span className="type-heading session-title" title={headerText}>
            {headerText}
          </span>
        )}
        <RunStatusBadge status={status} />
        {storedEnded && stored && (
          // How and when an ended session ended (docs/mvp-spec.md §4.5), the same words the Story's
          // session list uses.
          <span className="type-label" data-testid="session-ending" style={{ color: "var(--muted-foreground)" }}>
            {`Ended: ${endingWords(stored.endingReason)} · ${formatWhen(stored.startedAt)}${
              stored.endedAt ? ` to ${formatWhen(stored.endedAt)}` : ""
            }`}
          </span>
        )}

        <StatusStrip entries={entries} running={status === "running" || status === "blocked"} />

        <button
          type="button"
          onClick={() => setRawViewOpen((prev) => !prev)}
          className="control-edge session-action type-label"
        >
          {rawViewOpen ? "View structured" : "View raw"}
        </button>

        {showStop && (
          // While a run is live the lead is Stop, the one action a running session offers. It was on Discard,
          // the most destructive control on the page (08.1-17 closure).
          <button
            type="button"
            onClick={handleStop}
            disabled={stopping || discarding}
            className="control-edge session-action session-action-lead type-label"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        )}

        {showStop && (
          // D-67: the flagship verb, beside Stop — never a modifier folded into it. Never the lead while a
          // run is live: it ends the session and starts another, so it sits on the plain control edge and
          // Stop leads. Not filled: the brand carries progress, never an action.
          <button
            type="button"
            onClick={handleDiscard}
            disabled={stopping || discarding}
            className="control-edge session-action type-label"
          >
            {discarding ? "Discarding…" : "Discard"}
          </button>
        )}

      </header>

      <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
      {rawViewOpen ? (
        <RawLogView sessionId={sessionId} />
      ) : (
        <div
          ref={parentRef}
          onScroll={handleScroll}
          data-testid="session-feed-scroll"
          // A transcript sits on the floor like a terminal's: the newest row at the bottom edge, growing upward.
          // `margin-top: auto` on the one child (not `justify-content: flex-end`) so a transcript taller than
          // the pane still scrolls from its top. The first 30 seconds of a run are a few rows, not a blank page.
          style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)", display: "flex", flexDirection: "column" }}
        >
          <div style={{ marginTop: "auto", flexShrink: 0 }}>
          {persistenceFailed && (
            <PersistenceFailureBanner
              text={persistenceFailureText ?? "Flywheel could not write this session's log — the transcript below may be incomplete."}
            />
          )}

          {showStartingPulse && <StartingSessionRow />}

          <div role="list" aria-label="Session events" style={{ position: "relative", height: rowVirtualizer.getTotalSize(), width: "100%" }}>
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const row = feedRows[virtualRow.index];
              return (
                <div
                  key={row.key}
                  ref={rowVirtualizer.measureElement}
                  data-index={virtualRow.index}
                  data-testid="feed-row-slot"
                  // Positioned, never sized: the row's own content sets its height and the virtualizer
                  // measures it, so a long turn is never clipped and never paints over the next row.
                  style={{ position: "absolute", top: 0, left: 0, width: "100%", minWidth: 0, transform: `translateY(${virtualRow.start}px)` }}
                >
                  <FeedRow
                    row={row}
                    expanded={expanded.has(row.key)}
                    onToggleExpand={() => toggle(row.key)}
                    live={row.key === liveRowKey}
                    onAnswerQuestion={
                      questionRows.has(row.key)
                        ? (picks) => handleAnswerQuestion(questionRows.get(row.key) as string, picks)
                        : undefined
                    }
                    questionDraftKey={questionRows.get(row.key)}
                  />
                </div>
              );
            })}
          </div>

          {terminalInfo && <TerminalRow info={terminalInfo} />}

          {stopWarning && <StopWarningNotice warning={stopWarning} />}

          {footerRequests.length > 0 && (
            <div style={{ marginTop: "var(--space-md)" }}>
              <PermissionRequestCard
                variant="feed"
                requests={footerRequests}
                onAnswer={handleAnswer}
                onAnswerQuestion={handleAnswerQuestion}
              />
            </div>
          )}

          <div ref={tailRef} />
          </div>
        </div>
      )}
      <SessionFloor
        ended={!showStop}
        waitingOnYou={pendingRequests.length > 0}
        running={status === "running"}
        doing={liveRow && liveRow.kind === "tool_call" ? toolCallLabel(liveRow.toolName, liveRow.input) : null}
        lastActivityAt={lastActivityAt}
      />
      </div>
      </div>
    </div>
  );
}
