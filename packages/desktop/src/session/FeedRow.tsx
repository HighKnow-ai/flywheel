/**
 * The session feed's rows (D-32, reshaped by Story #56 "the session feed is readable"): one row per
 * `FeedRowData`, switching on its kind. Not a chat UI — one speaker class per row, told apart by row
 * KIND, never by an avatar.
 *
 * - An agent turn renders as markdown, in full. Rows flow in the document at their own height; the
 *   fixed 32px slots that clipped every turn to one line are gone.
 * - A tool call is one compact row: the tool and its target, then its state — the first line of its
 *   output, "failed", or "running · 1m" while live. Expanded, its input reads as named fields and its
 *   output as text. Nothing in the feed is ever printed as JSON.
 * - A Proposal and an AskUserQuestion request are cards.
 *
 * Which log entries become which rows is `feedRows.ts`; this module is presentational only.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Bot,
  ChevronRight,
  CircleX,
  FilePlus,
  FileText,
  Globe,
  Kanban,
  LoaderCircle,
  MessageCircleQuestionMark,
  Pencil,
  Search,
  Terminal,
  UserRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "./Markdown";
import { QuestionForm, type QuestionPicks } from "./QuestionForm";
import {
  gitRetryText,
  payloadText,
  proposalKind,
  toolCallLabel,
  type FeedRowData,
  type QuestionPrompt,
} from "./feedRows";
import { describeToolCall, formatDuration, toolCallSeconds, type ToolKind, type ToolMetric } from "./toolVerbs";

export { feedRowText, toolCallLabel, toolCallTarget, type FeedRowData } from "./feedRows";

/** An expanded payload block's fixed max height (px): its own scroll absorbs a long payload. */
const EXPANDED_SUBBLOCK_MAX_HEIGHT = 240;

/** The character count above which an unrecognised line or an orphan result offers a disclosure
 * rather than printing in full. */
export const FEED_ROW_TRUNCATION_THRESHOLD = 120;

/** How deep `Fields` walks a nested payload before printing the rest as one line. */
const FIELDS_MAX_DEPTH = 4;

export interface FeedRowProps {
  row: FeedRowData;
  /** Only meaningful for a row that `isRowExpandable` says discloses. */
  expanded: boolean;
  onToggleExpand: () => void;
  /** Only meaningful for a `tool_call` row: the call the agent is running right now. */
  live?: boolean;
  /** The clock for a live row's "running" time. Omitted, the row ticks its own once a second. */
  now?: number;
  /** Issue #100: only for a `question` row whose question is still open. Present, the card is the
   * answer form; it never offers Allow or Deny. */
  onAnswerQuestion?: (picks: QuestionPicks) => Promise<void>;
  /** Issue #104: the open question's request id, under which its half-typed answer is kept. */
  questionDraftKey?: string;
}

/** Whether the OS reports a reduced-motion preference, checked once at mount. Guarded for an
 * environment with no `matchMedia` (this project's jsdom tests). */
export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function firstLine(text: string): string {
  return text.trim().split("\n")[0] ?? "";
}

/** Whether a row offers a disclosure control — a pure function of the row's data. */
export function isRowExpandable(row: FeedRowData): boolean {
  switch (row.kind) {
    case "tool_call":
      return true;
    case "tool_result": {
      const text = payloadText(row.output);
      return text.includes("\n") || text.length > FEED_ROW_TRUNCATION_THRESHOLD;
    }
    case "raw":
      return row.raw.length > FEED_ROW_TRUNCATION_THRESHOLD;
    default:
      return false;
  }
}

/** A first guess at a row's height (px), before the virtualizer measures the mounted row. Only a hint:
 * the measured height always wins, so a wrong guess costs a reflow, never a clipped or overlapping row.
 * It also stands in when an environment reports no layout (a zero measurement). */
export function feedRowEstimateSize(row: FeedRowData, expanded: boolean): number {
  const LINE = 20;
  switch (row.kind) {
    case "assistant_text":
    case "developer_turn":
      return 16 + LINE * row.text.split("\n").reduce((lines, line) => lines + Math.max(1, Math.ceil(line.length / 100)), 0);
    case "proposal":
      return 140;
    case "question":
      return 60 + row.questions.reduce((h, q) => h + 76 + 22 * q.options.length, 0);
    case "git_lock_exhausted":
      return 0;
    default:
      return expanded && isRowExpandable(row) ? 296 : 28;
  }
}

/** The icon for a tool's kind (direction.md § Icons: Read, Edit, Run, Search, board tool), so a Bash call, a
 * Read and a board write are told apart at a glance, each still beside its word. */
const KIND_ICONS: Record<ToolKind, LucideIcon> = {
  read: FileText,
  edit: Pencil,
  write: FilePlus,
  run: Terminal,
  search: Search,
  web: Globe,
  board: Kanban,
  agent: Bot,
  question: MessageCircleQuestionMark,
  other: Wrench,
};

export function toolIcon(toolName: string): LucideIcon {
  return KIND_ICONS[describeToolCall({ toolName, input: {} }).kind];
}

/** Re-renders once a second while `enabled`; the live row's own boundary, so the tick never
 * re-renders the rest of the feed. */
function useSecondTick(enabled: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [enabled]);
  return now;
}

/** How long a live call has been running: the newer of its last heartbeat and the clock since it
 * started, so the figure keeps moving between heartbeats and never runs behind one. */
export function runningSeconds(startedAt: string | undefined, heartbeatSeconds: number | undefined, nowMs: number): number {
  const started = startedAt ? Date.parse(startedAt) : Number.NaN;
  const byClock = Number.isNaN(started) ? 0 : Math.max(0, (nowMs - started) / 1000);
  return Math.floor(Math.max(byClock, heartbeatSeconds ?? 0));
}

function RunningFor({
  startedAt,
  heartbeatSeconds,
  now,
  className = "text-running",
}: {
  startedAt?: string;
  heartbeatSeconds?: number;
  now?: number;
  className?: string;
}) {
  const ticked = useSecondTick(now === undefined);
  const nowMs = now ?? ticked;
  const seconds = runningSeconds(startedAt, heartbeatSeconds, nowMs);
  return (
    <span className={cn("feed-call-state shrink-0 font-sans text-meta font-semibold tabular-nums", className)} data-state="running">
      {`running · ${formatDuration(seconds)}`}
    </span>
  );
}

/** A payload as named fields: an object as label/value pairs, a list as a list, text as text.
 * The one renderer for every tool input and structured output, so no payload reaches the feed as
 * JSON. */
export function Fields({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === undefined || value === null || value === "") {
    return <span className="text-muted-foreground">none</span>;
  }
  if (typeof value === "string") {
    return value.includes("\n") ? <pre className="m-0 font-mono text-small break-words whitespace-pre-wrap">{value}</pre> : <span className="font-mono text-small break-words">{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") return <span>{String(value)}</span>;
  if (depth >= FIELDS_MAX_DEPTH) return <span>{payloadText(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-muted-foreground">none</span>;
    return (
      <ul className="m-0 list-disc pl-5">
        {value.map((item, i) => (
          <li key={i}>
            <Fields value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-muted-foreground">none</span>;
    return (
      <dl className="m-0 flex flex-col gap-1.5">
        {entries.map(([k, v]) => (
          <div key={k}>
            <dt className="text-meta font-semibold">{k}</dt>
            <dd className="m-0 break-words">
              <Fields value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span>{String(value)}</span>;
}

/** A tool's output: text as preformatted text, anything structured as fields. */
function OutputView({ output }: { output: unknown }) {
  if (typeof output === "string") return <pre className="m-0 font-mono text-small break-words whitespace-pre-wrap">{output || "(no output)"}</pre>;
  return <Fields value={output} />;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <ChevronRight
      aria-hidden="true"
      size={14}
      className={cn("shrink-0 text-subtle-foreground transition-transform duration-(--duration-state) ease-(--ease)", expanded && "rotate-90")}
    />
  );
}

/** A tool call or a result as one disclosure line: a bounded row with a chevron, an accent hover. */
const disclosureClass =
  "feed-disclosure feed-call -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-center gap-2.5 rounded-md px-2 py-1 text-left transition-colors duration-(--duration-state) ease-(--ease) hover:bg-accent";

/** Where a tool-call line sits: on a card (the feed), or on the graphite strip (the agent station). */
type LineSurface = "card" | "strip";

/** The right-hand metrics column: what the call returned (lines, exit status, Check results) and how
 * long it took. A failed call is neutral ink beside its icon; only a failed Check is red (direction.md
 * § Colour). */
function CallMetrics({ metrics, seconds, surface }: { metrics: ToolMetric[]; seconds?: number; surface: LineSurface }) {
  const onStrip = surface === "strip";
  if (metrics.length === 0 && seconds === undefined) return null;
  return (
    <span
      className={cn(
        "feed-call-metrics ml-auto inline-flex shrink-0 items-center gap-2.5 text-meta tabular-nums",
        onStrip ? "text-strip-muted-foreground" : "text-subtle-foreground",
      )}
    >
      {metrics.map((metric) => (
        <span
          key={metric.text}
          data-tone={metric.tone}
          className={cn(
            "inline-flex items-center gap-1",
            metric.tone !== "neutral" && "font-semibold",
            (metric.tone === "failed" || metric.tone === "ok") && (onStrip ? "text-strip-foreground" : "text-foreground"),
            // On the strip the line sits in a `dark` scope, so this is the red lifted for a dark ground.
            metric.tone === "failed-check" && "text-destructive-text",
          )}
        >
          {(metric.tone === "failed" || metric.tone === "failed-check") && (
            <CircleX aria-hidden="true" size={14} className={cn(metric.tone === "failed-check" && "text-destructive")} />
          )}
          {metric.text}
        </span>
      ))}
      {seconds !== undefined && <span>{formatDuration(seconds)}</span>}
    </span>
  );
}

/**
 * One tool call as a line: its kind's icon, the verb, what it acted on, then the metrics column, or the
 * running clock while it is live. The feed's rows and the agent station's live tail both draw it.
 */
export function ToolCallLine({
  row,
  live,
  now,
  surface = "card",
}: {
  row: Extract<FeedRowData, { kind: "tool_call" }>;
  live: boolean;
  now?: number;
  surface?: LineSurface;
}) {
  const described = describeToolCall(row);
  const KindIcon = KIND_ICONS[described.kind];
  const onStrip = surface === "strip";
  const verb = live ? described.liveVerb : described.verb;
  return (
    <>
      <KindIcon aria-hidden="true" size={16} className={cn("shrink-0", onStrip ? "text-strip-muted-foreground" : "text-muted-foreground")} />
      <span
        className={cn("feed-call-verb w-27 shrink-0 truncate text-small font-semibold", onStrip ? "text-strip-foreground" : "text-foreground")}
        title={verb}
      >
        {verb}
      </span>
      <span
        className={cn(
          "feed-call-target min-w-0 flex-1 truncate",
          described.targetIsCode ? "font-mono text-meta" : "text-small",
          onStrip ? "text-strip-muted-foreground" : "text-muted-foreground",
        )}
        title={described.target || undefined}
      >
        {described.target}
      </span>
      {live ? (
        // The live mark leads the clock, as the mockup's live dot does, so the clock right-aligns with the
        // durations above it. Running ink: on the strip the line's `dark` scope lifts it to the dark blue.
        // Under reduced motion the pulse class is omitted, so the mark is plain and never frozen mid-cycle.
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-running">
          <LoaderCircle aria-hidden="true" size={15} className={cn("feed-caret shrink-0", !prefersReducedMotion() && "agent-pulse")} />
          <RunningFor startedAt={row.startedAt} heartbeatSeconds={row.elapsedSeconds} now={now} />
        </span>
      ) : (
        <CallMetrics metrics={described.metrics} seconds={toolCallSeconds(row.startedAt, row.endedAt)} surface={surface} />
      )}
    </>
  );
}

/** A tool call's accessible name: the visible words in reading order, so the faces inside never split it. */
export function toolCallAccessibleName(row: Extract<FeedRowData, { kind: "tool_call" }>, live: boolean): string {
  const label = toolCallLabel(row.toolName, row.input, { live, output: row.output });
  const state = live ? "running" : describeToolCall(row).metrics.map((m) => m.text).join(", ");
  return [label, state].filter(Boolean).join(", ");
}

function ToolCallRow({
  row,
  expanded,
  onToggleExpand,
  live,
  now,
}: {
  row: Extract<FeedRowData, { kind: "tool_call" }>;
  expanded: boolean;
  onToggleExpand: () => void;
  live: boolean;
  now?: number;
}) {
  return (
    <div role="listitem" className="feed-row">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className={disclosureClass}
        data-live={live ? "true" : undefined}
        data-failed={row.isError ? "true" : undefined}
        aria-label={toolCallAccessibleName(row, live)}
      >
        <Chevron expanded={expanded} />
        <ToolCallLine row={row} live={live} now={now} />
      </button>

      {expanded && (
        <div
          className="feed-call-detail mt-1 mb-2 ml-6 overflow-y-auto rounded-md border border-border bg-muted px-3 py-2 text-small break-words"
          style={{ maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT }}
        >
          <div className="feed-detail-heading mb-1 text-meta font-semibold text-muted-foreground">Input</div>
          <Fields value={row.input} />
          {row.output !== undefined && (
            <>
              <div className="feed-detail-heading mt-2 mb-1 text-meta font-semibold text-muted-foreground">
                {row.isError ? "Error" : "Output"}
              </div>
              <OutputView output={row.output} />
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** A result whose call is not in the loaded window: its text, never the raw line. */
function ToolResultRow({
  row,
  expanded,
  onToggleExpand,
}: {
  row: Extract<FeedRowData, { kind: "tool_result" }>;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const text = payloadText(row.output);
  const expandable = isRowExpandable(row);
  const summary = `${row.isError ? "failed" : "result"} · ${firstLine(text).slice(0, FEED_ROW_TRUNCATION_THRESHOLD)}`;
  return (
    <div role="listitem" className="feed-row">
      {expandable ? (
        <button type="button" onClick={onToggleExpand} aria-expanded={expanded} className={disclosureClass}>
          <Chevron expanded={expanded} />
          <span className="feed-call-label min-w-0 truncate font-mono text-small text-muted-foreground">{summary}</span>
        </button>
      ) : (
        <span className="feed-call-label block truncate py-1 font-mono text-small text-muted-foreground">{summary}</span>
      )}
      {expandable && expanded && (
        <div
          className="feed-call-detail mt-1 mb-2 ml-6 overflow-y-auto rounded-md border border-border bg-muted px-3 py-2 text-small break-words"
          style={{ maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT }}
        >
          <OutputView output={row.output} />
        </div>
      )}
    </div>
  );
}

function ProposalCard({ row }: { row: Extract<FeedRowData, { kind: "proposal" }> }) {
  const input = row.input && typeof row.input === "object" && !Array.isArray(row.input) ? (row.input as Record<string, unknown>) : {};
  const { title, why, ...rest } = input;
  const kind = proposalKind(row.toolName);
  return (
    <div role="listitem" className="feed-row">
      <div className="session-card my-2 flex flex-col gap-1.5 border-l border-input py-1 pl-4" data-card="proposal">
        <span className="inline-flex items-center gap-1.5 text-meta font-semibold text-muted-foreground">
          <Kanban aria-hidden="true" size={14} />
          {kind ? `Proposal · ${kind}` : "Proposal"}
        </span>
        {typeof title === "string" && title && <span className="text-row font-semibold">{title}</span>}
        {typeof why === "string" && why && <p className="m-0 text-body break-words">{why}</p>}
        {Object.keys(rest).length > 0 && <Fields value={rest} />}
        {row.output !== undefined && (
          <span className={cn("text-small", row.isError ? "text-destructive-text" : "text-muted-foreground")}>
            {payloadText(row.output)}
          </span>
        )}
      </div>
    </div>
  );
}

function QuestionCard({
  questions,
  answer,
  onAnswer,
  draftKey,
}: {
  questions: QuestionPrompt[];
  answer?: unknown;
  onAnswer?: (picks: QuestionPicks) => Promise<void>;
  draftKey?: string;
}) {
  const heading = questions.length > 1 ? `The agent asks you ${questions.length} questions` : "The agent asks you a question";
  if (onAnswer && answer === undefined) {
    return (
      <div role="listitem" className="feed-row py-2">
        {/* A band across the session card's full width, never a card inside it. */}
        <div className="session-card -mx-5 border-y-2 border-attention" data-card="question" data-open="true">
          <div className="flex items-center gap-2.5 bg-attention px-5 py-2.5 text-attention-foreground">
            <MessageCircleQuestionMark aria-hidden="true" size={18} className="shrink-0" />
            <span className="text-row font-bold">{heading}</span>
            <span className="ml-auto text-small font-semibold">The session waits until you answer</span>
          </div>
          <div className="px-5 py-4">
            <QuestionForm questions={questions} onSubmit={onAnswer} draftKey={draftKey} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div role="listitem" className="feed-row py-2">
      <div className="session-card flex flex-col gap-2 border-l border-input py-1 pl-4" data-card="question">
        <span className="inline-flex items-center gap-1.5 text-meta font-semibold text-muted-foreground">
          <MessageCircleQuestionMark aria-hidden="true" size={14} />
          {questions.length > 1 ? `${questions.length} questions from the agent` : "Question from the agent"}
        </span>
        {questions.map((q, i) => (
          <div key={i} className="flex flex-col gap-1">
            {q.header && <span className="text-meta font-semibold text-muted-foreground">{q.header}</span>}
            <p className="m-0 text-body break-words">{q.question}</p>
            {q.options.length > 0 && (
              <ul className="m-0 flex flex-col gap-0.5 pl-5 text-small">
                {q.options.map((option, j) => (
                  <li key={j}>
                    <span className="font-semibold">{option.label}</span>
                    {option.description && (
                      <>
                        {": "}
                        <span className="text-muted-foreground">{option.description}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {answer !== undefined && (
          <span className="text-small text-muted-foreground">
            <span className="font-semibold text-foreground">Answered: </span>
            <span>{payloadText(answer)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

/** A one-line transient in the muted label role (a system notice, the git retry line). */
function SystemLine({ text }: { text: string }) {
  return (
    <div role="listitem" className="feed-row">
      <p className="m-0 py-0.5 text-small break-words text-muted-foreground">{text}</p>
    </div>
  );
}

/** An unrecognised line: clipped in the Mono stack, its full text behind a disclosure. The clipped
 * form is cut before it reaches the DOM, so a multi-kilobyte line never sits behind a CSS clip. */
function RawRow({ raw, expanded, onToggleExpand }: { raw: string; expanded: boolean; onToggleExpand: () => void }) {
  const expandable = raw.length > FEED_ROW_TRUNCATION_THRESHOLD;
  const showExpanded = expandable && expanded;
  return (
    <div role="listitem" className="feed-row flex items-start gap-1.5">
      {expandable && (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={showExpanded}
          aria-label={showExpanded ? "Collapse full text" : "Expand full text"}
          className="feed-disclosure mt-1 shrink-0 rounded-sm hover:bg-accent"
        >
          <Chevron expanded={showExpanded} />
        </button>
      )}
      <span
        className={cn(
          "min-w-0 font-mono text-small text-muted-foreground",
          showExpanded ? "overflow-y-auto break-words whitespace-pre-wrap" : "truncate",
        )}
        style={showExpanded ? { maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT } : undefined}
      >
        {showExpanded ? raw : raw.slice(0, FEED_ROW_TRUNCATION_THRESHOLD)}
      </span>
    </div>
  );
}

export function FeedRow({ row, expanded, onToggleExpand, live = false, now, onAnswerQuestion, questionDraftKey }: FeedRowProps) {
  switch (row.kind) {
    case "assistant_text":
      return (
        <div role="listitem" className="feed-row feed-turn flex gap-2.5 py-2 text-foreground">
          <Bot aria-hidden="true" size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
          <Markdown text={row.text} className="min-w-0 flex-1 text-body" />
        </div>
      );
    // Plan 05-12: the developer's own words, in the accent text role — a different speaker class.
    case "developer_turn":
      return (
        <div role="listitem" className="feed-row feed-turn flex gap-2.5 py-2 text-running">
          <UserRound aria-hidden="true" size={16} className="mt-0.5 shrink-0" />
          <Markdown text={row.text} className="min-w-0 flex-1 text-body" />
        </div>
      );
    case "system_notice":
      return <SystemLine text={row.text} />;
    // D-53: the retry line reuses the system/transient treatment, never a parallel one.
    case "git_retry":
      return <SystemLine text={gitRetryText(row.attempt, row.max)} />;
    // D-53: an explicit no-render case; exhaustion surfaces in the Activity Trail only.
    case "git_lock_exhausted":
      return null;
    case "tool_call":
      return <ToolCallRow row={row} expanded={expanded} onToggleExpand={onToggleExpand} live={live} now={now} />;
    case "tool_result":
      return <ToolResultRow row={row} expanded={expanded} onToggleExpand={onToggleExpand} />;
    case "proposal":
      return <ProposalCard row={row} />;
    case "question":
      return (
        <QuestionCard questions={row.questions} answer={row.answer} onAnswer={onAnswerQuestion} draftKey={questionDraftKey} />
      );
    case "raw":
      return <RawRow raw={row.raw} expanded={expanded} onToggleExpand={onToggleExpand} />;
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

/** One Set of expanded row keys for the whole feed (02-UI-SPEC.md: "a tool call the user has
 * expanded stays expanded as new events arrive below it"). */
export function useExpandedRows() {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  return { expanded, toggle };
}
