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
import { useEffect, useMemo, useRef, useState, type UIEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CirclePause, Ellipsis, FileText, Hourglass, ListTree, Square, SquareX, TriangleAlert, X } from "lucide-react";
import {
  answerPermissionRequest,
  answerQuestion,
  discardSession,
  sessionGet,
  sessionsForStory,
  stopSession,
  storyGet,
  storyStopped,
  subscribeAgentEvent,
  worktreeSummary,
} from "../adapters/tauri";
import { useSessionFeed, usePendingPermissionRequests } from "../board/useBoardQuery";
import { WriteStoryDialog } from "../board/WriteStoryDialog";
import { useBoardChangedInvalidation } from "../board/useBoardChangedInvalidation";
import { ResumeControl, endingWords } from "../board/StoryControls";
import { StateBadge } from "../components/StateBadge";
import { StoryKey } from "../components/StoryKey";
import { RelativeTime } from "../components/RelativeTime";
import { ConfirmDestructive } from "../components/ConfirmDestructive";
import { RUN_STATUS_LABELS, TERMINAL_STATUSES, formatAge, isRunStatus } from "../legend/runStatus";
import { formatDuration, formatMoney, formatSessionName, formatTokens } from "@/lib/format";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  ToggleGroup,
  ToggleGroupItem,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  cn,
} from "@highknow/design";
import type { RunStatus } from "../legend/runStatus";
import { useRegionBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import { PermissionRequestCard, RequestInCard, type PermissionDecision } from "./PermissionRequestCard";
import { FeedRow, feedRowEstimateSize, prefersReducedMotion, useExpandedRows } from "./FeedRow";
import {
  ASK_USER_QUESTION_TOOL,
  buildFeedRows,
  findLiveCallKey,
  questionsFromPayload,
  sameQuestions,
  toolCallLabel,
  usageLimitText,
  type FeedRowData,
} from "./feedRows";
import type { PendingPermissionRequest } from "./PermissionRequestCard";
import type { QuestionPicks } from "./QuestionForm";
import { RawLogView } from "./RawLogView";
import { useProjects } from "../board/useBoardQuery";
import { PageHeader } from "../shell/PageHeader";
import { Button } from "@/components/Button";

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
      if (
        row?.kind === "question" &&
        row.answer === undefined &&
        !byRow.has(row.key) &&
        sameQuestions(row.questions, questions)
      ) {
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
      const value = event?.[field];
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

/** How long a session has run, in seconds: from its start to its end, or to `now` while it runs. */
export function sessionSeconds(startedAt: string | undefined, endAtMs: number): number | undefined {
  const start = startedAt ? Date.parse(startedAt) : Number.NaN;
  if (Number.isNaN(start)) return undefined;
  return Math.max(0, (endAtMs - start) / 1000);
}

/** The header's meta line (issue #205): the clock with its label, how the session ended, then the token and
 * cost figures, all through `lib/format.ts`. The same line for a running, a waiting and an ended session; its
 * own component, so the clock's once-a-second tick re-renders this line and nothing else. */
function SessionMeta({
  entries,
  running,
  startedAt,
  endedAt,
  ending,
}: {
  entries: Record<string, unknown>[];
  running: boolean;
  /** The session's own start (its stored row). The first loaded line is only a fallback: once the feed
   * pages from the tail, that line is wherever the loaded window begins (issue #190). */
  startedAt: string | undefined;
  /** When the session ended, or `undefined` while it runs. An ended session's clock is its duration,
   * never the time since it started (issue #190: a three-minute run read `8813:39` six days later). */
  endedAt: string | undefined;
  /** How and when an ended session ended, from its stored row (docs/mvp-spec.md §4.5). */
  ending: { reason: string; at: string | null } | null;
}) {
  const now = useNowTick(running);
  const clockEnd = endedAt !== undefined && !Number.isNaN(Date.parse(endedAt)) ? Date.parse(endedAt) : now;
  const seconds = sessionSeconds(startedAt, clockEnd);
  const tokensIn = latestNumericField(entries, ["tokensIn", "inputTokens", "tokens_in"]);
  const tokensOut = latestNumericField(entries, ["tokensOut", "outputTokens", "tokens_out"]);
  const costUsd = latestNumericField(entries, ["totalCostUsd", "cost_usd"]);

  return (
    <p
      className="m-0 flex min-w-0 flex-wrap items-center gap-x-2 text-small text-muted-foreground"
      data-testid="session-meta"
    >
      <span className="whitespace-nowrap" data-testid="session-clock">
        {running ? "Elapsed " : "Duration "}
        <span className="font-semibold text-foreground tabular-nums" aria-label="Elapsed time">
          {formatDuration(seconds)}
        </span>
      </span>
      {ending && (
        <>
          <span aria-hidden="true">·</span>
          {/* When, then how: "Ended 8h ago · usage limit", the absolute time in RelativeTime's Tooltip. */}
          <span className="whitespace-nowrap" data-testid="session-ending">
            {"Ended"}
            {ending.at && (
              <>
                {" "}
                <RelativeTime at={ending.at} />
              </>
            )}
            {` · ${ending.reason}`}
          </span>
        </>
      )}
      {/* Figures or nothing. The backend reports totals once, on the terminal `result`, so for the whole
          of a running session there is nothing to print; dashes beside bare words read as broken data, not
          as absent data (08.1-17 closure). The line grows when the figures exist. */}
      {tokensIn !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap tabular-nums" aria-label="Tokens in">
            {formatTokens(tokensIn)} in
          </span>
        </>
      )}
      {tokensOut !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap tabular-nums" aria-label="Tokens out">
            {formatTokens(tokensOut)} out
          </span>
        </>
      )}
      {costUsd !== undefined && (
        <>
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap tabular-nums" aria-label="Cost">
            {formatMoney(costUsd)}
          </span>
        </>
      )}
    </p>
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
   * first frame; `"running"` is only the no-information fallback, used right after Start work when
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
    if (event?.type === "session_closed" && isRunStatus(event.reason)) {
      const result = event.result as { subtype?: string } | undefined;
      return {
        reason: event.reason,
        ...(result?.subtype !== undefined && { subtype: result.subtype }),
        ...(typeof event.detail === "string" && { detail: event.detail }),
      };
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
      <div role="listitem" className="mt-3 flex flex-col gap-1.5 rounded-md border border-border bg-muted px-4 py-3">
        <p className="m-0 flex items-center gap-2 text-body font-semibold">
          <span
            aria-hidden="true"
            className="flex size-5 items-center justify-center rounded-full bg-destructive text-destructive-foreground"
          >
            <X size={13} strokeWidth={2.5} />
          </span>
          {FAILED_RUN_GLOSS}
        </p>
        {info.subtype && <p className="m-0 font-mono text-small text-destructive-text">{info.subtype}</p>}
        {info.detail && (
          <div
            data-testid="terminal-detail"
            className="overflow-y-auto font-mono text-small break-words whitespace-pre-wrap text-muted-foreground"
            style={{ maxHeight: TERMINAL_DETAIL_MAX_HEIGHT }}
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
      className="mt-3 flex flex-col gap-1 rounded-md border border-border bg-muted px-4 py-3 text-small text-muted-foreground"
    >
      <span className="font-semibold text-foreground">{RUN_STATUS_LABELS[info.reason]}</span>
      {info.reason === "interrupted" && <p className="m-0">{TASK_STOPPED_GLOSS}</p>}
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
  return (
    <div role="listitem" className="mt-3 flex flex-col gap-1 rounded-md border border-border bg-muted px-4 py-3">
      <p className="m-0 flex items-center gap-2 text-body">
        <CirclePause aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
        {STOP_WARNING_GLOSS}
      </p>
      <p className="m-0 font-mono text-small text-muted-foreground">{warning}</p>
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
    <div role="listitem" className="mb-3 rounded-md border border-border bg-muted px-4 py-3">
      <p className="m-0 flex items-center gap-2 text-body">
        <TriangleAlert aria-hidden="true" size={16} className="shrink-0 text-muted-foreground" />
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
    <div role="listitem" className="py-1 text-body text-muted-foreground">
      Starting session…
    </div>
  );
}

/** The live status bar (issue #205: live status only). While the agent works it says what on and when it
 * last showed life (Story #56: a healthy run must not look stalled). A run waiting on you has its request
 * card, and an ended run its header and closing row, so neither repeats itself here. Its own component, so
 * its once-a-second tick re-renders this line and nothing else. */
function SessionFloor({ doing, lastActivityAt }: { doing: string | null; lastActivityAt: string | undefined }) {
  const now = useNowTick(true);
  const since = lastActivityAt ? ` Last activity ${formatAge(lastActivityAt, now)} ago.` : "";
  return (
    <p
      role="status"
      className="m-0 shrink-0 truncate border-t border-border px-5 py-2.5 text-small text-muted-foreground"
    >
      {doing ? (
        <>
          {"The agent is working: "}
          {/* The call the agent is in, set in the code face: a command never renders in the reading face. */}
          <span className="font-mono">{doing}</span>
          {`.${since}`}
        </>
      ) : (
        `The agent is working.${since}`
      )}
    </p>
  );
}

/**
 * A session Claude's usage limit ended (issue #205): when the limit resets, never the CLI's raw epoch, and the
 * next step where Cyril is looking. Resume when the Story is Stopped on this very session (the core would
 * refuse it otherwise), and Open Story.
 */
function UsageLimitAlert({
  resetsAt,
  story,
  canResume,
  onOpenStory,
}: {
  resetsAt: string | undefined;
  story: { id: string; key: string } | null;
  canResume: boolean;
  onOpenStory: (() => void) | null;
}) {
  const resetPending = resetsAt !== undefined && Date.parse(resetsAt) > Date.now();
  return (
    <Alert role="status" className="mt-3 px-4 py-3" data-testid="usage-limit-alert">
      <Hourglass aria-hidden="true" />
      <AlertTitle className="text-body font-semibold">{usageLimitText(resetsAt)}</AlertTitle>
      <AlertDescription className="text-small">
        {`Claude's usage limit ended this session. Its worktree stays exactly as the agent left it, and Resume starts a fresh session from the Context packet${resetPending ? " once the limit resets" : ""}.`}
      </AlertDescription>
      {(onOpenStory || (canResume && story)) && (
        <div className="col-start-2 mt-2.5 flex flex-wrap gap-2">
          {canResume && story && <ResumeControl story={story} />}
          {onOpenStory && (
            <Button variant="outline" size="sm" onClick={onOpenStory}>
              Open Story
            </Button>
          )}
        </div>
      )}
    </Alert>
  );
}

const SCROLL_TOP_FETCH_THRESHOLD_PX = 40;

/** The title of a run whose board item cannot be resolved (read failed, item gone, or no id). A live run
 * still needs its surface, so an unresolvable item degrades to this and never blanks or throws. */
const SESSION_FALLBACK_TITLE = "Session";

const DISCARD_FAILED = "Flywheel could not confirm this discard completed. The session may still be live — try again.";

/** Stop's consequence, the same words the Story view's Stop uses (`board/StoryControls.tsx`). */
const STOP_CONSEQUENCE =
  "The session ends now. Its worktree stays exactly as the agent left it, and Resume starts a fresh session from the Context packet.";

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
  const projectName = (useProjects().data ?? []).find((project) => project.id === itemHeader?.projectId)?.name ?? null;
  // Issue #205: the Story's worktree, against which every path and command in the feed reads relative.
  const { data: worktree } = useQuery({
    queryKey: ["session-worktree", storyId],
    queryFn: () => (storyId ? worktreeSummary(storyId) : Promise.resolve(null)).catch(() => null),
    enabled: Boolean(storyId),
    retry: false,
  });
  const root = worktree?.path ?? null;
  // The session by its ordinal ("Session 8"), from the same read and key as the Story's session list.
  const { data: storySessions } = useQuery({
    queryKey: ["board", itemHeader?.projectId, "sessions", storyId],
    queryFn: () => (storyId ? sessionsForStory(storyId) : Promise.resolve([])).catch(() => []),
    enabled: Boolean(storyId && itemHeader),
    retry: false,
  });
  const sessionIndex = (storySessions ?? []).findIndex((session) => session.id === sessionId);
  const sessionOrdinal = sessionIndex >= 0 && storySessions ? storySessions.length - sessionIndex : null;
  // Whether this very session left its Story Stopped, so Resume is the core's to accept (issue #205).
  const { data: stoppedOn } = useQuery({
    queryKey: ["board", itemHeader?.projectId, "stopped", storyId],
    queryFn: () => (storyId ? storyStopped(storyId) : Promise.resolve(null)).catch(() => null),
    enabled: Boolean(storyId && itemHeader),
    retry: false,
  });
  const [discardOpen, setDiscardOpen] = useState(false);
  const setCurrentProjectId = useUiStore((state) => state.setCurrentProjectId);
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
  // Issue #205: Stop confirms in ConfirmDestructive, as it does on the Story view. The promise is the
  // dialog's: pending while it runs, closed on success, open with the failure's message otherwise.
  const stopPromiseRef = useRef<Promise<void> | null>(null);
  function handleStop(): Promise<void> {
    // A second activation while the ref is set sends nothing — the synchronous-tick guard.
    if (stoppingRef.current && stopPromiseRef.current) return stopPromiseRef.current;
    stoppingRef.current = true;
    setStopping(true);
    const promise = stopSession(sessionId)
      .then((result) => {
        // Never cleared here: a successful stop drives `status` to a terminal value, `showStop`
        // goes false and the button unmounts — there is nothing left to guard.
        if (isRunStatus(result.status)) {
          setStatus(result.status);
        }
        setStopWarning(result.sidecarWarning);
      })
      .catch((error: unknown) => {
        // Clear the ref before re-enabling — a genuine failure must leave the control usable,
        // which matters more here than on any other surface: the alternative is an agent that
        // keeps spending.
        stoppingRef.current = false;
        stopPromiseRef.current = null;
        setStopping(false);
        throw error;
      });
    stopPromiseRef.current = promise;
    return promise;
  }

  // D-66/D-67, CTX-08 (plan 04-13): the phase's flagship action. One activation ends the session
  // — giving the agent's own closing summary a bounded window to land first — and lands the
  // developer on the launch sheet, pre-filled for the SAME Story, with no intermediate step.
  // Copies `handleStop`'s own structure line for line, including the ref-based double-activation
  // guard: React has not necessarily flushed the disabling re-render before a second activation in
  // the same synchronous tick.
  const discardPromiseRef = useRef<Promise<void> | null>(null);
  function handleDiscard(): Promise<void> {
    if (discardingRef.current && discardPromiseRef.current) return discardPromiseRef.current;
    discardingRef.current = true;
    setDiscarding(true);
    const promise = discardSession(sessionId)
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
        // On rejection the confirmation stays open and says so (ConfirmDestructive shows the message).
        // Clear the ref before re-enabling, matching `handleStop`'s own "a genuine failure must leave the
        // control usable" reasoning — a surfaced contradiction must never stand between the developer and
        // a fresh session.
        discardingRef.current = false;
        discardPromiseRef.current = null;
        setDiscarding(false);
        throw new Error(DISCARD_FAILED);
      });
    discardPromiseRef.current = promise;
    return promise;
  }

  const showStop = !storedEnded && !TERMINAL_STATUSES.includes(status);

  const entries = useMemo(() => feedQuery.data?.pages.flatMap((page) => page.entries) ?? [], [feedQuery.data]);
  const allRows = useMemo(() => buildFeedRows(entries), [entries]);
  // Issue #205: a session the usage limit ended closes on the usage-limit Alert, which says when the limit
  // resets and offers the next step; the notice it came from is not repeated as a row just above it.
  const usageLimitRow = useMemo(() => [...allRows].reverse().find((row) => row.kind === "usage_limit"), [allRows]);
  const endedByUsageLimit = storedEnded && (stored?.endingReason === "usage_limit" || usageLimitRow !== undefined);
  const feedRows = useMemo(
    () => (endedByUsageLimit ? allRows.filter((row) => row.kind !== "usage_limit") : allRows),
    [allRows, endedByUsageLimit],
  );
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
  const firstLoadedAt = entries.find((entry) => typeof entry.at === "string")?.at as string | undefined;
  // The clock runs while the session can still do work, and stops at its end otherwise.
  const clockStopped = storedEnded || TERMINAL_STATUSES.includes(status);

  // Virtualized with measured rows (Story #56): a long Story session logs thousands of events, so only a
  // window of rows is mounted. Rows are variable height (markdown turns, cards, expanded calls), so each
  // mounted row is measured (`measureElement`, re-measured by its ResizeObserver when it grows) and
  // `feedRowEstimateSize` is only the first guess. A zero measurement (no layout, as in jsdom) falls back
  // to the guess rather than collapsing every row onto the first.
  const rowVirtualizer = useVirtualizer({
    count: feedRows.length,
    getScrollElement: () => parentRef.current,
    // The virtualizer asks only for indexes below `count`, which is `feedRows.length`.
    estimateSize: (index) => {
      const row = feedRows[index];
      return row ? feedRowEstimateSize(row, expanded.has(row.key)) : 0;
    },
    getItemKey: (index) => feedRows[index]?.key ?? index,
    measureElement: (element) => {
      const measured = element.getBoundingClientRect().height;
      if (measured > 0) return measured;
      const row = feedRows[Number((element as HTMLElement).dataset.index)];
      return row ? feedRowEstimateSize(row, expanded.has(row.key)) : 0;
    },
    overscan: 10,
  });

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const el = event.currentTarget;
    if (
      el.scrollTop <= SCROLL_TOP_FETCH_THRESHOLD_PX &&
      feedQuery.hasPreviousPage &&
      !feedQuery.isFetchingPreviousPage
    ) {
      feedQuery.fetchPreviousPage();
    }
    // A feed opened at a turn (the triage jump) pages forward as the reader scrolls down; one opened at
    // the tail already follows the log to its end (`useSessionFeed`).
    if (
      el.scrollHeight > 0 &&
      el.scrollTop + el.clientHeight >= el.scrollHeight - SCROLL_TOP_FETCH_THRESHOLD_PX &&
      feedQuery.hasNextPage &&
      !feedQuery.isFetchingNextPage
    ) {
      feedQuery.fetchNextPage();
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
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        onBack={onBack}
        crumbs={[
          ...(projectName && itemHeader
            ? [
                {
                  label: projectName,
                  onSelect: () => setCurrentProjectId(itemHeader.projectId),
                  ariaLabel: `Open the ${projectName} board`,
                },
              ]
            : []),
          ...(itemHeader && storyId
            ? [
                {
                  label: itemHeader.key,
                  mono: true,
                  onSelect: () => openStory(itemHeader.projectId, storyId),
                  ariaLabel: `Open Story ${itemHeader.key}`,
                },
              ]
            : []),
          // The session by its ordinal, as the Story's session list names it (lib/format.ts); its id only
          // while the ordinal is unknown.
          sessionOrdinal ? { label: formatSessionName(sessionOrdinal) } : { label: sessionId, mono: true },
        ]}
        actions={itemHeader ? <WriteStoryDialog projectId={itemHeader.projectId} /> : undefined}
      />
      {/* One width for every surface of cards (DESIGN.md § Layout): up to 1240px, centred, so a feed line at 1920 stays readable. */}
      <div className="mx-auto flex min-h-0 w-full max-w-[calc(1240px+2.5rem)] flex-1 flex-col px-5 pb-5">
        <section
          aria-label="Session"
          className={cn(
            // Sized to its content (issue #205), up to the pane's height, where the feed scrolls inside it: a
            // short run or a waiting request is never a card stretched over a void.
            "flex min-h-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card",
            showStop && pendingRequests.length > 0 && "border-attention",
          )}
        >
          {/* One header for every run state (issue #205): the state, the Story's key and title, the view toggle and
          the live actions on one line; the clock, the ending and the figures on the line below. Running,
          waiting and ended differ only in the words inside, never in the layout. */}
          <header
            className="flex shrink-0 flex-col gap-1.5 border-b border-border px-5 py-3"
            data-testid="session-header"
          >
            <div className="flex min-w-0 items-center gap-3">
              <RunStatusBadge status={status} />
              {itemHeader && storyId ? (
                // Where the developer is (issue #104): the session's Story, which is one click away.
                <button
                  type="button"
                  aria-label={`Open Story ${headerText}`}
                  onClick={() => openStory(itemHeader.projectId, storyId)}
                  className="group flex min-w-0 flex-1 items-baseline gap-2 rounded-sm text-left"
                >
                  <StoryKey value={itemHeader.key} size="small" />
                  <span className="min-w-0 truncate text-section font-semibold underline-offset-4 group-hover:underline">
                    {itemHeader.title}
                  </span>
                </button>
              ) : (
                <span className="min-w-0 flex-1 truncate text-section font-semibold">{headerText}</span>
              )}

              <div className="ml-auto flex shrink-0 items-center gap-2">
                {/* Structured or Raw: a choice between two views, so a Toggle Group, never a label-swapping button. */}
                <ToggleGroup
                  type="single"
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-label="Feed view"
                  value={rawViewOpen ? "raw" : "structured"}
                  onValueChange={(value) => {
                    if (value) setRawViewOpen(value === "raw");
                  }}
                >
                  <ToggleGroupItem value="structured" aria-label="Structured">
                    <ListTree aria-hidden="true" />
                    {/* In a narrow window the icons carry the choice, so the Story's title keeps its room. */}
                    <span className="max-lg:sr-only">Structured</span>
                  </ToggleGroupItem>
                  <ToggleGroupItem value="raw" aria-label="Raw">
                    <FileText aria-hidden="true" />
                    <span className="max-lg:sr-only">Raw</span>
                  </ToggleGroupItem>
                </ToggleGroup>

                {showStop && (
                  // While a run is live the lead is Stop, the one action a running session offers. Outline, not
                  // filled: the next action on this screen is the agent's, or the answer it waits on. It confirms,
                  // as the Story view's Stop does (DESIGN.md § Feedback).
                  <ConfirmDestructive
                    trigger={
                      <Button variant="outline" size="sm" loading={stopping} disabled={discarding}>
                        <Square aria-hidden="true" />
                        Stop
                      </Button>
                    }
                    title={itemHeader ? `Stop ${itemHeader.key}'s agent?` : "Stop this session?"}
                    description={STOP_CONSEQUENCE}
                    confirmLabel="Stop the session"
                    icon={<Square aria-hidden="true" />}
                    onConfirm={handleStop}
                  />
                )}

                {showStop && (
                  // D-67: Discard ends the session and opens the launch sheet for the same Story. Never beside Stop
                  // as a bare word: it waits in the ⋯ menu and confirms what it does.
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="More session actions"
                        disabled={stopping || discarding}
                      >
                        <Ellipsis aria-hidden="true" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-auto min-w-52">
                      <DropdownMenuItem variant="destructive" onSelect={() => setDiscardOpen(true)}>
                        <SquareX aria-hidden="true" />
                        Discard and start fresh…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                <ConfirmDestructive
                  open={discardOpen}
                  onOpenChange={setDiscardOpen}
                  title={itemHeader ? `Discard ${itemHeader.key}'s session?` : "Discard this session?"}
                  description={
                    storyId
                      ? "The session ends now and the launch sheet opens for the same Story, to start a fresh session from its Context packet. The worktree stays exactly as the agent left it."
                      : "The session ends now. Nothing in the worktree is undone."
                  }
                  confirmLabel="Discard the session"
                  icon={<SquareX aria-hidden="true" />}
                  onConfirm={handleDiscard}
                />
              </div>
            </div>

            <SessionMeta
              entries={entries}
              running={!clockStopped}
              startedAt={stored?.startedAt ?? firstLoadedAt}
              endedAt={clockStopped ? (stored?.endedAt ?? lastActivityAt) : undefined}
              ending={storedEnded && stored ? { reason: endingWords(stored.endingReason), at: stored.endedAt } : null}
            />
          </header>

          <div className="flex min-h-0 flex-1 flex-col">
            {rawViewOpen ? (
              <RawLogView sessionId={sessionId} />
            ) : (
              <div
                ref={parentRef}
                onScroll={handleScroll}
                data-testid="session-feed-scroll"
                // A transcript reads from the top of its card, like the Story it serves; follow-the-tail keeps the
                // newest row in view once it outgrows the pane. A short run is a few rows under the header, never
                // a few rows under a blank page (critique 2026-10, minor observation).
                // A request card is a band across the card's foot, so nothing pads beneath it (issue #205).
                className={cn(
                  "flex min-h-0 flex-1 flex-col overflow-y-auto px-5 pt-4",
                  footerRequests.length > 0 ? "pb-0" : "pb-4",
                )}
              >
                <RequestInCard.Provider value={true}>
                  <div className="shrink-0">
                    {persistenceFailed && (
                      <PersistenceFailureBanner
                        text={
                          persistenceFailureText ??
                          "Flywheel could not write this session's log — the transcript below may be incomplete."
                        }
                      />
                    )}

                    {showStartingPulse && <StartingSessionRow />}

                    <div
                      role="list"
                      aria-label="Session events"
                      style={{ position: "relative", height: rowVirtualizer.getTotalSize(), width: "100%" }}
                    >
                      {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                        const row = feedRows[virtualRow.index];
                        if (!row) return null; // the virtualizer's items are all below `count`
                        const questionRequestId = questionRows.get(row.key);
                        return (
                          <div
                            key={row.key}
                            ref={rowVirtualizer.measureElement}
                            data-index={virtualRow.index}
                            data-row-key={row.key}
                            data-testid="feed-row-slot"
                            // Positioned, never sized: the row's own content sets its height and the virtualizer
                            // measures it, so a long turn is never clipped and never paints over the next row.
                            style={{
                              position: "absolute",
                              top: 0,
                              left: 0,
                              width: "100%",
                              minWidth: 0,
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                          >
                            <FeedRow
                              row={row}
                              expanded={expanded.has(row.key)}
                              onToggleExpand={() => toggle(row.key)}
                              live={row.key === liveRowKey}
                              {...(questionRequestId !== undefined && {
                                onAnswerQuestion: (picks: QuestionPicks) =>
                                  handleAnswerQuestion(questionRequestId, picks),
                                questionDraftKey: questionRequestId,
                              })}
                              root={root}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {endedByUsageLimit ? (
                      <UsageLimitAlert
                        resetsAt={usageLimitRow?.kind === "usage_limit" ? usageLimitRow.resetsAt : undefined}
                        story={itemHeader && storyId ? { id: storyId, key: itemHeader.key } : null}
                        canResume={stoppedOn?.sessionId === sessionId}
                        onOpenStory={itemHeader && storyId ? () => openStory(itemHeader.projectId, storyId) : null}
                      />
                    ) : (
                      terminalInfo && <TerminalRow info={terminalInfo} />
                    )}

                    {stopWarning && <StopWarningNotice warning={stopWarning} />}

                    {footerRequests.length > 0 && (
                      <div className="mt-4">
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
                </RequestInCard.Provider>
              </div>
            )}
            {showStop && status === "running" && pendingRequests.length === 0 && (
              <SessionFloor
                doing={
                  liveRow && liveRow.kind === "tool_call"
                    ? toolCallLabel(liveRow.toolName, liveRow.input, { live: true, root })
                    : null
                }
                lastActivityAt={lastActivityAt}
              />
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
