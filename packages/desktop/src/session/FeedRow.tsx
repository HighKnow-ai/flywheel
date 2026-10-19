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
import { formatAge } from "../legend/runStatus";
import { Markdown } from "./Markdown";
import {
  gitRetryText,
  payloadText,
  proposalKind,
  toolCallLabel,
  type FeedRowData,
  type QuestionPrompt,
} from "./feedRows";
import "./session.css";

export { feedRowText, toolCallLabel, toolCallTarget, type FeedRowData } from "./feedRows";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

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
      return 60 + row.questions.reduce((h, q) => h + 40 + 22 * q.options.length, 0);
    case "git_lock_exhausted":
      return 0;
    default:
      return expanded && isRowExpandable(row) ? 296 : 28;
  }
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

function RunningFor({ startedAt, heartbeatSeconds, now }: { startedAt?: string; heartbeatSeconds?: number; now?: number }) {
  const ticked = useSecondTick(now === undefined);
  const nowMs = now ?? ticked;
  const seconds = runningSeconds(startedAt, heartbeatSeconds, nowMs);
  return (
    <span className="type-label tabular-nums feed-call-state" data-state="running">
      {`running · ${formatAge(new Date(nowMs - seconds * 1000).toISOString(), nowMs)}`}
    </span>
  );
}

/** A payload as named fields: an object as label/value pairs, a list as a list, text as text.
 * The one renderer for every tool input and structured output, so no payload reaches the feed as
 * JSON. */
export function Fields({ value, depth = 0 }: { value: unknown; depth?: number }): ReactNode {
  if (value === undefined || value === null || value === "") {
    return <span style={{ color: "var(--text-muted-rack)" }}>none</span>;
  }
  if (typeof value === "string") {
    return value.includes("\n") ? <pre className="feed-field-text">{value}</pre> : <span>{value}</span>;
  }
  if (typeof value === "number" || typeof value === "boolean") return <span>{String(value)}</span>;
  if (depth >= FIELDS_MAX_DEPTH) return <span>{payloadText(value)}</span>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <span style={{ color: "var(--text-muted-rack)" }}>none</span>;
    return (
      <ul className="feed-field-list">
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
    if (entries.length === 0) return <span style={{ color: "var(--text-muted-rack)" }}>none</span>;
    return (
      <dl className="feed-fields">
        {entries.map(([k, v]) => (
          <div key={k} className="feed-field">
            <dt className="type-label">{k}</dt>
            <dd>
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
  if (typeof output === "string") return <pre className="feed-field-text">{output || "(no output)"}</pre>;
  return <Fields value={output} />;
}

function Chevron({ expanded }: { expanded: boolean }) {
  return (
    <span aria-hidden="true" style={{ flexShrink: 0, display: "inline-block", transition: "none" }}>
      {expanded ? "▾" : "▸"}
    </span>
  );
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
  const outputLine = row.output !== undefined ? firstLine(payloadText(row.output)) : "";
  return (
    <div role="listitem" className="feed-row">
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="feed-disclosure feed-call type-body tabular-nums"
        data-live={live ? "true" : undefined}
        style={{ fontFamily: MONO_STACK }}
      >
        <Chevron expanded={expanded} />
        <span className="feed-call-label">{toolCallLabel(row.toolName, row.input)}</span>
        {live ? (
          <>
            <RunningFor startedAt={row.startedAt} heartbeatSeconds={row.elapsedSeconds} now={now} />
            {/* The live mark: a block caret after the call. Under reduced motion the pulse class is
                omitted, so the caret is a plain, fully legible mark and never frozen mid-cycle. */}
            <span aria-hidden="true" className={prefersReducedMotion() ? "feed-caret" : "feed-caret agent-pulse"}>
              ▍
            </span>
          </>
        ) : row.isError ? (
          <span className="type-label feed-call-state" data-state="failed">
            failed
          </span>
        ) : (
          !expanded && outputLine && <span className="type-label feed-call-output">{outputLine}</span>
        )}
      </button>

      {expanded && (
        <div className="feed-call-detail" style={{ maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT }}>
          <div className="type-label feed-detail-heading">Input</div>
          <Fields value={row.input} />
          {row.output !== undefined && (
            <>
              <div className="type-label feed-detail-heading">{row.isError ? "Error" : "Output"}</div>
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
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={expanded}
          className="feed-disclosure feed-call type-body"
          style={{ fontFamily: MONO_STACK }}
        >
          <Chevron expanded={expanded} />
          <span className="feed-call-label">{summary}</span>
        </button>
      ) : (
        <span className="type-body feed-call-label" style={{ fontFamily: MONO_STACK, color: "var(--text-muted-rack)" }}>
          {summary}
        </span>
      )}
      {expandable && expanded && (
        <div className="feed-call-detail" style={{ maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT }}>
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
      <div className="session-card feed-card" data-card="proposal">
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          {kind ? `Proposal · ${kind}` : "Proposal"}
        </span>
        {typeof title === "string" && title && <span className="type-heading">{title}</span>}
        {typeof why === "string" && why && <p className="type-body feed-card-text">{why}</p>}
        {Object.keys(rest).length > 0 && <Fields value={rest} />}
        {row.output !== undefined && (
          <span className="type-label" style={{ color: row.isError ? "var(--destructive-text-rack)" : "var(--text-muted-rack)" }}>
            {payloadText(row.output)}
          </span>
        )}
      </div>
    </div>
  );
}

function QuestionCard({ questions, answer }: { questions: QuestionPrompt[]; answer?: unknown }) {
  return (
    <div role="listitem" className="feed-row">
      <div className="session-card feed-card" data-card="question">
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          {questions.length > 1 ? `${questions.length} questions from the agent` : "Question from the agent"}
        </span>
        {questions.map((q, i) => (
          <div key={i} className="feed-question">
            {q.header && (
              <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                {q.header}
              </span>
            )}
            <p className="type-body feed-card-text">{q.question}</p>
            {q.options.length > 0 && (
              <ul className="feed-field-list">
                {q.options.map((option, j) => (
                  <li key={j}>
                    <span style={{ fontWeight: 600 }}>{option.label}</span>
                    {option.description && (
                      <>
                        {" — "}
                        <span style={{ color: "var(--text-muted-rack)" }}>{option.description}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {answer !== undefined && (
          <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            {payloadText(answer)}
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
      <p className="type-label" style={{ margin: 0, color: "var(--text-muted-rack)", overflowWrap: "anywhere" }}>
        {text}
      </p>
    </div>
  );
}

/** An unrecognised line: clipped in the Mono stack, its full text behind a disclosure. The clipped
 * form is cut before it reaches the DOM, so a multi-kilobyte line never sits behind a CSS clip. */
function RawRow({ raw, expanded, onToggleExpand }: { raw: string; expanded: boolean; onToggleExpand: () => void }) {
  const expandable = raw.length > FEED_ROW_TRUNCATION_THRESHOLD;
  const showExpanded = expandable && expanded;
  return (
    <div role="listitem" className="feed-row" style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-xs)" }}>
      {expandable && (
        <button
          type="button"
          onClick={onToggleExpand}
          aria-expanded={showExpanded}
          aria-label={showExpanded ? "Collapse full text" : "Expand full text"}
          className="feed-disclosure"
          style={{ flexShrink: 0, background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "var(--text-muted-rack)" }}
        >
          <Chevron expanded={showExpanded} />
        </button>
      )}
      <span
        className="type-body"
        style={{
          minWidth: 0,
          color: "var(--text-muted-rack)",
          fontFamily: MONO_STACK,
          ...(showExpanded
            ? { maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT, overflowY: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }
            : { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }),
        }}
      >
        {showExpanded ? raw : raw.slice(0, FEED_ROW_TRUNCATION_THRESHOLD)}
      </span>
    </div>
  );
}

export function FeedRow({ row, expanded, onToggleExpand, live = false, now }: FeedRowProps) {
  switch (row.kind) {
    case "assistant_text":
      return (
        <div role="listitem" className="feed-row feed-turn" style={{ color: "var(--text-primary-rack)" }}>
          <Markdown text={row.text} className="type-body" />
        </div>
      );
    // Plan 05-12: the developer's own words, in the accent text role — a different speaker class.
    case "developer_turn":
      return (
        <div role="listitem" className="feed-row feed-turn" style={{ color: "var(--accent-text-rack)" }}>
          <Markdown text={row.text} className="type-body" />
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
      return <QuestionCard questions={row.questions} answer={row.answer} />;
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
