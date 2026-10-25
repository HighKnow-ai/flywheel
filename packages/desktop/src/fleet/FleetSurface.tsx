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
 *
 * #58 adds the *doing* Task (`DoingTaskCell`): what each row's agent is doing now, read by the core from
 * the Story's Task checklist, and empty while no Task is doing.
 *
 * #208 puts the list on Table with column headers (State · Project · Story · Doing · Spend · Age), one card
 * whose header sticks while the rows scroll, each band a row group headed by its name and count. The doing
 * Task and the activity line share the Doing column (the Task above, the activity under it), a column no row
 * fills is left out, and the Story column takes whatever width is left. Money and ages go through
 * `lib/format.ts`. The header counts agents as GLOSSARY.md defines them (a live session) and labels the
 * list's length as runs, so the two figures never read as one disagreeing count. The view switch is Tabs.
 */
import { useEffect, useLayoutEffect, useState, type MouseEvent } from "react";
import { acknowledgeSession, sessionAcknowledgeMany, type FleetActivityDto, type FleetRowDto } from "../adapters/tauri";
import { StateBadge } from "../components/StateBadge";
import { ReadError } from "../components/ReadError";
import { StoryKey } from "../components/StoryKey";
import { FLEET_BANDS, bandForState, isFleetState, isRunStatus, type FleetBandId, type FleetState } from "../legend/runStatus";
import { feedRowText } from "../session/FeedRow";
import { buildFeedRows } from "../session/SessionSurface";
import { nextSelectionId, useRegionBindings } from "../state/keyboard";
import { useUiStore } from "../state/uiStore";
import { BlockedQueue } from "./BlockedQueue";
import { ageText, useBlockedQueue, useFleet, useWaitingRounds } from "./useFleet";
import { PageHeader, SurfaceBody } from "../shell/PageHeader";
import { agentCount, lampsFromFleet } from "../shell/AndonStrip";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatMoney, formatTokens } from "@/lib/format";
import { cn } from "@/lib/utils";

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

/** The activity line's width in characters, ellipsis at the TAIL — the start of a line (the tool, the
 * first clause) is what says what the agent is doing. Applied to every row kind alike. */
export const ACTIVITY_MAX_CHARS = 80;

/** The first clause of narration: up to the first sentence or clause break, or the first line. */
function firstClause(text: string): string {
  const firstLine = text.trim().split("\n")[0] ?? "";
  const match = /[.!?:;]\s/.exec(firstLine);
  return match ? firstLine.slice(0, match.index + 1) : firstLine;
}

function clip(text: string): string {
  return text.length > ACTIVITY_MAX_CHARS ? `${text.slice(0, ACTIVITY_MAX_CHARS - 1)}…` : text;
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

function isLiveRun(row: FleetRowDto): boolean {
  return row.runStatus === "running" || row.runStatus === "blocked";
}

/** A live row's activity, under its doing Task. One that cannot be read is said to assistive tech and
 * draws nothing: a column of dashes reads as a column of data (#208). The text is derived from this
 * render's tail alone, never the line it used to have. A terminal row renders nothing. */
function ActivityLine({ row }: { row: FleetRowDto }) {
  if (!isLiveRun(row)) return null;
  const line = activityLine(row.activity);
  return line === null ? (
    <span data-field="activity" data-absent="true" className="sr-only">
      No activity could be read
    </span>
  ) : (
    <span data-field="activity" title={line} className="block truncate text-meta text-muted-foreground">
      {line}
    </span>
  );
}

/** What the row's agent is doing now (docs/mvp-spec.md §7): the Story's *doing* Task, read from its Task
 * checklist by the core. Empty, with no placeholder, when no Task is doing: the agent has not written its
 * checklist yet, or is between Tasks. */
export function DoingTaskCell({ row }: { row: FleetRowDto }) {
  const title = row.doingTaskTitle;
  return (
    <span data-field="doing-task" title={title ? `Doing: ${title}` : undefined} className="block truncate text-small empty:hidden">
      {title ?? ""}
    </span>
  );
}

/** A run that has ended: the only kind that can be dismissed. A live run can be stopped, not cleared. */
function isTerminalRun(row: FleetRowDto): boolean {
  return !isLiveRun(row);
}

/** Whether the Spend column has anything to show for this row. */
function hasSpend(row: FleetRowDto): boolean {
  return isTerminalRun(row) && (row.costUsd != null || row.tokensIn != null || row.tokensOut != null);
}

/** Whether the Doing column has anything to show for this row. */
function hasDoing(row: FleetRowDto): boolean {
  return row.doingTaskTitle != null || isLiveRun(row);
}

/** What a finished run cost: the estimate in dollars, and under it the tokens. Blank — no text — for a
 * live run and for a figure that never arrived: an honest absence, never `$0.00`. A failed run keeps what
 * it spent before it failed. `tokensIn` is a sum that includes cache reads (Finding 11), so it is
 * labelled as such and reads larger than the prompt. */
export function SpendCell({ row }: { row: FleetRowDto }) {
  if (!isTerminalRun(row)) return <span data-field="spend" />;
  const tokens =
    row.tokensIn == null && row.tokensOut == null
      ? null
      : [
          row.tokensIn == null ? null : `${formatTokens(row.tokensIn)} in`,
          row.tokensOut == null ? null : `${formatTokens(row.tokensOut)} out`,
        ]
          .filter((part) => part !== null)
          .join(" · ");
  return (
    <span data-field="spend" className="flex flex-col items-end tabular-nums">
      {row.costUsd != null && (
        <span title="Estimated cost, not a billed amount" className="text-small">
          {formatMoney(row.costUsd)}
        </span>
      )}
      {tokens && (
        <span title="Input tokens include cache reads, so this is larger than the prompt size" className="text-meta text-muted-foreground">
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
    <footer data-fleet-footer className="shrink-0 text-right text-meta text-muted-foreground tabular-nums">
      Estimated spend, this fleet: {formatMoney(visibleCostUsd)} (Flywheel's own estimate from a bundled price
      table, not a billed amount)
    </footer>
  );
}

/** What the run is *about*: its Story's key and title. Every session serves exactly one Story. */
function subjectLabel(row: FleetRowDto): { key: string; detail: string | null } {
  return { key: row.storyKey, detail: row.storyTitle || null };
}

/** How long this row has been in its state: a blocked run counts from its oldest pending request, a
 * finished run from when it ended, anything else from when it started. */
function ageSince(row: FleetRowDto, state: FleetState): string | undefined {
  if (state === "blocked") return row.blockedSince ?? row.startedAt;
  if (bandForState(state) === "done-failed" || state === "awaiting_review") return row.endedAt ?? row.startedAt;
  return row.startedAt;
}

/** The board item a row's subject names: its Story. `null` for a project that is unreachable — its board
 * is replaced by the relocate screen, so the jump would land on something other than the item, and the row
 * shows no target (D-166: an affordance that looks like a link and goes nowhere is worse than a plain
 * label). */
export function subjectTargetId(row: FleetRowDto): string | null {
  if (row.projectStatus === "unreachable") return null;
  return row.storyId;
}

/** The row's secondary target (D-166, FLEET-03): the subject key as a button of its own, reaching the
 * board item. Its click is stopped here so it never also opens the session; the key `b` reaches the same
 * place from the selected row. Rendered only when the row has a board subject. */
export function SubjectTarget({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      data-subject-target
      className="rounded-sm font-mono text-meta whitespace-nowrap text-running tabular-nums underline-offset-4 hover:underline"
      aria-label={`Open Story ${label}`}
      title={`Open Story ${label}`}
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
 * surface needs to mount in its correct shape in ONE call — the run, its Story and its status
 * (`setActiveSessionId` sets them together). The status is the raw run status the
 * row is already showing — `awaiting_review` is a fleet-only state, the session knows that run as
 * `completed` — so a terminal run does not read "Running" while nothing re-reads it (Pitfall 7).
 *
 * The fleet field is deliberately NOT cleared here. The shell checks the fleet branch BELOW the session
 * branch (plan 10-01, Pattern 4), which is what makes the session's own back action land on the fleet.
 * Anything else that calls the opener with `null` while the fleet is open reveals the fleet; that is
 * intended. The triage surface clears itself first, which is the opposite pattern. */
function sessionOpenerArgs(row: FleetRowDto): Parameters<UiOpener> {
  const status = isRunStatus(row.runStatus) ? row.runStatus : null;
  return [row.sessionId, row.storyId, null, status];
}

type UiOpener = ReturnType<typeof useUiStore.getState>["setActiveSessionId"];

/** Which optional columns the table draws (#208): a column no row fills is left out, and so is one the card
 * is too narrow for. */
export interface FleetColumns {
  project: boolean;
  doing: boolean;
  spend: boolean;
}

/* The card widths below which a column gives way, Project first, then Doing, then Spend (whose total stays
 * in the footer). A 900px window leaves the card about 610px wide. The Story column has no width of its own
 * and takes what the others leave, so it stays the widest column at every width. Measured, not a container
 * query: a column hidden by CSS still counts toward a band header's `colSpan`, which then draws a phantom
 * column that takes the Story's width. */
const PROJECT_MIN_WIDTH = 896;
const DOING_MIN_WIDTH = 768;
const SPEND_MIN_WIDTH = 672;

/** The columns for these rows at this card width; an unmeasured card (no layout yet) shows every column. */
export function fleetColumns(rows: FleetRowDto[], cardWidth: number | null = null): FleetColumns {
  const fits = (min: number) => cardWidth === null || cardWidth >= min;
  return {
    project: fits(PROJECT_MIN_WIDTH),
    doing: rows.some(hasDoing) && fits(DOING_MIN_WIDTH),
    spend: rows.some(hasSpend) && fits(SPEND_MIN_WIDTH),
  };
}

/** The number of columns a row spans, for the band headers. */
function columnCount(columns: FleetColumns): number {
  return 4 + (columns.project ? 1 : 0) + (columns.doing ? 1 : 0) + (columns.spend ? 1 : 0);
}

const ALL_COLUMNS: FleetColumns = { project: true, doing: true, spend: true };

/** The width of the element `ref` is put on, kept current as it resizes; `null` until it has a layout. */
export function useWidth<T extends HTMLElement>(): [(node: T | null) => void, number | null] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (!node) return undefined;
    const measure = () => {
      const next = node.getBoundingClientRect().width;
      setWidth(next > 0 ? next : null);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

export function FleetRowView({
  row,
  now,
  columns = ALL_COLUMNS,
  selected = false,
  stopped = false,
  onOpenSession,
  onOpenSubject,
}: {
  row: FleetRowDto;
  now: number;
  columns?: FleetColumns;
  selected?: boolean;
  /** This run is the newest of a Running Story with no live session: its Story is Stopped, so the row
   * says so in red, as the board, the sidebar and the strip do. */
  stopped?: boolean;
  onOpenSession?: (row: FleetRowDto) => void;
  onOpenSubject?: (row: FleetRowDto) => void;
}) {
  const state: FleetState = isFleetState(row.fleetState) ? row.fleetState : "running";
  const pulsing = state === "running" && !prefersReducedMotion();
  const subject = subjectLabel(row);
  const age = ageText(ageSince(row, state), now);
  const [dismissFailed, setDismissFailed] = useState(false);

  return (
    <TableRow
      data-fleet-state={state}
      data-run-id={row.sessionId}
      data-selected={selected ? "true" : undefined}
      aria-current={selected ? "true" : undefined}
      onClick={() => onOpenSession?.(row)}
      className={cn(
        "h-13 border-border text-body hover:bg-accent",
        onOpenSession && "cursor-pointer",
        // The selected row takes the running tint (direction.md rule 4), never colour on the text alone.
        selected && "bg-running-muted hover:bg-running-muted",
        state === "blocked" && !selected && "bg-attention-muted hover:bg-attention-muted",
      )}
    >
      <TableCell data-field="state" className="pl-4">
        <span className="inline-flex">
          {stopped ? <StateBadge state="stopped" /> : <StateBadge state={state} pulse={pulsing} />}
        </span>
      </TableCell>
      {columns.project && (
        <TableCell data-field="project" title={row.projectName} className="truncate text-small text-muted-foreground">
          {row.projectName}
        </TableCell>
      )}
      <TableCell
        data-field="subject"
        title={subject.detail ? `${subject.key} ${subject.detail}`.trim() : subject.key}
        className="truncate"
      >
        {subjectTargetId(row) !== null && onOpenSubject ? (
          <SubjectTarget label={subject.key || "Story"} onOpen={() => onOpenSubject(row)} />
        ) : (
          subject.key && <StoryKey value={subject.key} />
        )}
        {subject.key && subject.detail ? " " : ""}
        {subject.detail && <span className="font-semibold">{subject.detail}</span>}
      </TableCell>
      {columns.doing && (
        <TableCell data-field="doing">
          <DoingTaskCell row={row} />
          <ActivityLine row={row} />
        </TableCell>
      )}
      {columns.spend && (
        <TableCell className="text-right">
          <SpendCell row={row} />
        </TableCell>
      )}
      <TableCell data-field="age" aria-label={`In this state for ${age}`} className="text-right text-small text-muted-foreground tabular-nums">
        {age}
      </TableCell>
      <TableCell data-field="dismiss" className="pr-4 text-right">
        {dismissFailed && (
          <span role="status" className="sr-only">
            Could not dismiss.
          </span>
        )}
        {isTerminalRun(row) && (
          <Button
            variant="ghost"
            size="sm"
            className={cn("text-muted-foreground", dismissFailed && "text-destructive-text")}
            aria-label={`Dismiss ${subject.key || "run"}`}
            title={dismissFailed ? "Could not dismiss. Try again." : undefined}
            onClick={(event: MouseEvent) => {
              // Its own act: a click here must not also bubble into the row and open the session.
              event.stopPropagation();
              setDismissFailed(false);
              void acknowledgeSession(row.sessionId).catch(() => setDismissFailed(true));
            }}
          >
            Dismiss
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

/** One band of the table: a row group headed by the band's name and count, then its rows. */
export function FleetBand({
  band,
  rows,
  now,
  columns = ALL_COLUMNS,
  selectedRunId = null,
  stoppedRunIds,
  onOpenSession,
  onOpenSubject,
}: {
  band: { id: FleetBandId; header: string };
  rows: FleetRowDto[];
  now: number;
  columns?: FleetColumns;
  selectedRunId?: string | null;
  stoppedRunIds?: Set<string>;
  onOpenSession?: (row: FleetRowDto) => void;
  onOpenSubject?: (row: FleetRowDto) => void;
}) {
  const [dismissNotice, setDismissNotice] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState(false);
  return (
    <TableBody data-band={band.id} aria-label={band.header} className="[&_tr:last-child]:border-b">
      <TableRow data-band-header className="border-border bg-muted hover:bg-muted">
        <TableHead scope="rowgroup" colSpan={columnCount(columns)} className="h-10 px-4">
          <div className="flex items-center gap-2">
            <h2 className="m-0 text-small font-semibold tracking-[0.02em] text-muted-foreground">{band.header}</h2>
            <span className="mr-auto text-small font-normal text-muted-foreground tabular-nums">{rows.length}</span>
            {band.id === "done-failed" && (
              <span className="flex items-center gap-2">
                {dismissNotice && (
                  <span role="status" className="text-meta font-normal text-destructive-text">
                    {dismissNotice}
                  </span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  loading={dismissing}
                  className="text-muted-foreground"
                  onClick={() => {
                    setDismissNotice(null);
                    setDismissing(true);
                    void sessionAcknowledgeMany(rows.filter(isTerminalRun).map((r) => r.sessionId))
                      .then((results) => {
                        // A write that failed is not "nothing to dismiss": only an `error` is reported.
                        const failed = results.filter((r) => r.error).length;
                        if (failed > 0) setDismissNotice(`Could not dismiss ${failed} of ${results.length} runs.`);
                      })
                      .catch(() => setDismissNotice("Could not dismiss the finished runs."))
                      .finally(() => setDismissing(false));
                  }}
                >
                  Dismiss finished
                </Button>
              </span>
            )}
          </div>
        </TableHead>
      </TableRow>
      {rows.map((row) => (
        <FleetRowView
          key={row.sessionId}
          row={row}
          now={now}
          columns={columns}
          selected={row.sessionId === selectedRunId}
          stopped={stoppedRunIds?.has(row.sessionId) ?? false}
          onOpenSession={onOpenSession}
          onOpenSubject={onOpenSubject}
        />
      ))}
    </TableBody>
  );
}

/** The card a fleet-wide table sits in: it fills the height it is given and no more, and its table scrolls
 * inside it under a header that stays put. Shared by All agents and Worktrees. */
export const TABLE_CARD =
  "mx-auto flex min-h-0 w-full max-w-[1240px] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-card [&>[data-slot=table-container]]:min-h-0 [&>[data-slot=table-container]]:flex-1 [&>[data-slot=table-container]]:overflow-auto";

/** The header row's look: sticky over the scrolling rows, on the card ground, ruled by a shadow so the rule
 * travels with it (a collapsed border would stay behind). */
export const STICKY_HEADER =
  "sticky top-0 z-10 bg-card shadow-[inset_0_-1px_0_var(--border)] [&_tr]:border-0 [&_th]:text-meta [&_th]:font-semibold [&_th]:text-muted-foreground";

function FleetTable({
  byBand,
  now,
  selectedRunId,
  stoppedRunIds,
  onOpenSession,
  onOpenSubject,
}: {
  byBand: Map<FleetBandId, FleetRowDto[]>;
  now: number;
  selectedRunId: string | null;
  stoppedRunIds: Set<string>;
  onOpenSession: (row: FleetRowDto) => void;
  onOpenSubject: (row: FleetRowDto) => void;
}) {
  const [cardRef, cardWidth] = useWidth<HTMLDivElement>();
  const columns = fleetColumns([...byBand.values()].flat(), cardWidth);
  return (
    <div ref={cardRef} data-fleet-table className={TABLE_CARD}>
      <Table className="table-fixed">
        <TableHeader className={STICKY_HEADER}>
          <TableRow>
            <TableHead className="w-44 pl-4">State</TableHead>
            {columns.project && <TableHead className="w-32">Project</TableHead>}
            <TableHead>Story</TableHead>
            {columns.doing && <TableHead className="w-[20%]">Doing</TableHead>}
            {columns.spend && <TableHead className="w-30 text-right">Spend</TableHead>}
            <TableHead className="w-20 text-right">Age</TableHead>
            <TableHead className="w-24 pr-4">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {FLEET_BANDS.filter((band) => byBand.has(band.id)).map((band) => (
          <FleetBand
            key={band.id}
            band={band}
            rows={byBand.get(band.id) ?? []}
            now={now}
            columns={columns}
            selectedRunId={selectedRunId}
            stoppedRunIds={stoppedRunIds}
            onOpenSession={onOpenSession}
            onOpenSubject={onOpenSubject}
          />
        ))}
      </Table>
    </div>
  );
}

/** The header's count: agents exactly as the strip counts them (`agentCount`, GLOSSARY.md: a live session,
 * Story or shaping), then the rows that are not agents (runs that have ended: Stopped, failed, In review,
 * done) labelled on their own, so the headline figure always matches the strip's. */
export function fleetCountText(agents: number, endedRuns: number): string {
  const head = `${agents} ${agents === 1 ? "agent" : "agents"}`;
  return endedRuns === 0 ? head : `${head} · ${endedRuns} ended ${endedRuns === 1 ? "run" : "runs"}`;
}

type FleetView = "fleet" | "queue";

export interface FleetSurfaceProps {
  onClose: () => void;
}

export function FleetSurface({ onClose }: FleetSurfaceProps) {
  const fleet = useFleet();
  const blocked = useBlockedQueue();
  // One surface, two views (plan 10-05): the banded list, or the queue of live blocks. A closed or
  // unset target reads as the fleet list.
  const view: FleetView = useUiStore((state) => state.fleetSurface?.view ?? "fleet");
  const setFleetSurface = useUiStore((state) => state.setFleetSurface);
  const setActiveSessionId = useUiStore((state) => state.setActiveSessionId);
  const openStory = useUiStore((state) => state.openStory);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const rows = fleet.data?.rows ?? [];
  const total = fleet.data?.totalRows ?? 0;
  const queue = blocked.data ?? [];
  // Issue #124: a shaping Round a live session is held on waits on you too, beside the requests.
  const waitingRounds = useWaitingRounds().data ?? [];
  const waitingTotal = queue.length + waitingRounds.length;
  const now = useNowTick(rows.length > 0 || waitingTotal > 0);
  // The strip's own rule for Stopped, so the fleet, the strip and the sidebar agree on which Story it is.
  const stoppedRunIds = new Set(
    lampsFromFleet(rows)
      // An abandoned run keeps its own word: it lost its supervisor, and it already reads red (D-169).
      .filter((lamp) => lamp.tone === "stopped" && lamp.row.fleetState !== "abandoned")
      .map((lamp) => lamp.row.sessionId),
  );

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
  const drawnRows = FLEET_BANDS.flatMap((band) => byBand.get(band.id) ?? []).map((r) => ({ ...r, id: r.sessionId }));
  const openSession = (row: FleetRowDto) => {
    setSelectedRunId(row.sessionId);
    setActiveSessionId(...sessionOpenerArgs(row));
  };
  // The secondary target: the row's Story, opened in its own project (issue #104). It replaces the
  // fleet, which stays one Back away. Opens nothing else — the session is the primary target.
  const openSubject = (row: FleetRowDto) => {
    const target = subjectTargetId(row);
    if (target === null) return;
    setSelectedRunId(row.sessionId);
    openStory(row.projectId, target);
  };
  const selectedRow = view === "fleet" ? drawnRows.find((r) => r.sessionId === selectedRunId) : undefined;
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
  const countText = fleetCountText(agentCount(rows, waitingRounds), total - rows.filter(isLiveRun).length);

  return (
    <Tabs
      value={view}
      onValueChange={(next) => setFleetSurface({ view: next === "queue" ? "queue" : "fleet" })}
      className="flex h-full min-h-0 flex-col gap-0"
    >
      <PageHeader
        onBack={onClose}
        crumbs={[{ label: view === "queue" ? "Waiting on you" : "All agents" }]}
        actions={
          <>
            {/* The headline count, the strip's own figure. Waiting on you's count is its tab's. */}
            {view === "fleet" && fleet.isSuccess && (
              <span aria-live="polite" data-fleet-count className="shrink-0 text-small whitespace-nowrap text-muted-foreground tabular-nums">
                {countText}
              </span>
            )}
            <TabsList aria-label="Fleet views" className="h-8.5 shrink-0">
              <TabsTrigger value="fleet" className="px-2.5">
                All agents
              </TabsTrigger>
              <TabsTrigger value="queue" className="px-2.5">
                Waiting on you{" "}
                <span className={cn("tabular-nums", waitingTotal > 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
                  {waitingTotal}
                </span>
              </TabsTrigger>
            </TabsList>
          </>
        }
      />
      <TabsContent value="fleet" className="flex min-h-0 flex-1 flex-col">
        <SurfaceBody className="flex flex-col gap-3 overflow-hidden">
          {fleet.isError ? (
            <ReadError title="Couldn't load the fleet" query={fleet} className="mx-auto max-w-[1240px]" />
          ) : fleet.isSuccess && rows.length === 0 ? (
            <Empty className="mx-auto max-w-[1240px] flex-none rounded-lg border border-solid border-border bg-card shadow-card">
              <EmptyHeader>
                <EmptyTitle className="text-section font-semibold">No agents running</EmptyTitle>
                <EmptyDescription>When an agent starts in any project, it appears here.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            rows.length > 0 && (
              <FleetTable
                byBand={byBand}
                now={now}
                selectedRunId={selectedRunId}
                stoppedRunIds={stoppedRunIds}
                onOpenSession={openSession}
                onOpenSubject={openSubject}
              />
            )
          )}
          <div className="mx-auto w-full max-w-[1240px] shrink-0 empty:hidden">
            <FleetFooter visibleCostUsd={fleet.data?.visibleCostUsd ?? null} />
          </div>
        </SurfaceBody>
      </TabsContent>
      <TabsContent value="queue" className="flex min-h-0 flex-1 flex-col">
        <SurfaceBody>
          <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-4">
            {blocked.isError ? (
              <ReadError title="Couldn't load what is waiting on you" query={blocked} />
            ) : (
              blocked.isSuccess && <BlockedQueue entries={queue} rounds={waitingRounds} now={now} />
            )}
          </div>
        </SurfaceBody>
      </TabsContent>
    </Tabs>
  );
}
