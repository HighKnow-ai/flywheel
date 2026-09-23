/**
 * D-32's structured feed rows (02-UI-SPEC.md "Body — the structured feed", plan 02-07 Task 2):
 * one row per normalised `AgentEvent`, switching on its kind. This is not a chat UI — there is
 * exactly one speaker class per row, distinguished by row KIND, not by a per-message avatar, so
 * no row here renders avatar chrome.
 *
 * Pairing/filtering (which raw log entries become which `FeedRowData`) happens in
 * `SessionSurface.tsx`, which owns the full loaded window; this module is purely presentational —
 * one row in, one row out. No icon is imported from `lucide-react`/the marks registry here: the
 * only interactive glyph this file renders (the tool-call disclosure chevron) is a plain
 * text triangle, not a signal mark, so it never needs marks.ts's "always paired with a word"
 * discipline that governs status/priority glyphs.
 */
import { useState } from "react";

const MONO_STACK = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';

/** Common candidate fields a tool's `input` payload uses for its own human-readable "target" —
 * checked in order, first string match wins (02-UI-SPEC.md's own worked examples: `Bash · npm
 * test`, `Edit · src/board/BoardRow.tsx`). Falls back to an empty target rather than dumping the
 * whole payload onto the collapsed line, which the expand affordance exists to reveal instead. */
const TARGET_FIELD_CANDIDATES = ["command", "file_path", "path", "pattern", "url", "description"];

export function toolCallTarget(input: unknown): string {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const obj = input as Record<string, unknown>;
    for (const field of TARGET_FIELD_CANDIDATES) {
      if (typeof obj[field] === "string") return obj[field] as string;
    }
  }
  if (typeof input === "string") return input;
  return "";
}

/** One structured feed row's own data — the shape `SessionSurface.tsx`'s pairing/filtering step
 * produces from the raw windowed-read entries. `key` is a stable React key, independent of
 * whatever field(s) a given row kind happens to carry. */
export type FeedRowData =
  | { kind: "assistant_text"; key: string; text: string }
  // Task 2, plan 05-12: a turn the application sent into a live authoring session (the
  // developer's own typed message, or a system-generated relay — see `sidecar.rs`'s
  // `AuthoringTurnOrigin`) — its own row kind, never merged into `assistant_text` (that would
  // attribute the developer's own words to the agent) and never falling through to `raw` (that
  // would show the JSON-stringified line instead of the plain words).
  | { kind: "developer_turn"; key: string; text: string }
  | { kind: "tool_call"; key: string; toolName: string; input: unknown; output?: unknown }
  | { kind: "system_notice"; key: string; text: string }
  // D-53/plan 03-13 (03-UI-SPEC.md "Git lock-retry transient row"): the shim's retry notice,
  // reusing the system/transient row kind's own treatment rather than defining a parallel one —
  // `attempt`/`max` are the only interpolated values, per the Copywriting Contract.
  | { kind: "git_retry"; key: string; attempt: number; max: number }
  // D-53 (03-UI-SPEC.md "Git lock-exhaustion entry"): the event exists on the stream (the shim
  // emits it, the Rust core consumes it into the Activity Trail), but the FEED renders nothing
  // for it — exhaustion is a trail-only artifact, never a feed row, which is exactly the
  // signal-to-noise ratio D-53 protects. Carries no fields: the no-render case needs none.
  | { kind: "git_lock_exhausted"; key: string }
  | { kind: "raw"; key: string; raw: string };

export interface FeedRowProps {
  row: FeedRowData;
  /** Only meaningful for a `tool_call` row — ignored by every other kind. */
  expanded: boolean;
  onToggleExpand: () => void;
}

function stringifyPayload(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** The shared "expanded" sub-block's fixed max height (px) — the SAME value `ToolCallRow`'s own
 * expanded payload block already used before this task, now named so the body-row presentation
 * component below can share it rather than duplicating the literal. Still a constant: the block's
 * own internal scroll is what absorbs a long payload, never the row's own reserved slot. */
const EXPANDED_SUBBLOCK_MAX_HEIGHT = 240;

function ToolCallRow({ row, expanded, onToggleExpand }: { row: Extract<FeedRowData, { kind: "tool_call" }>; expanded: boolean; onToggleExpand: () => void }) {
  const target = toolCallTarget(row.input);
  return (
    <div role="listitem" style={{ padding: "var(--space-xs) 0", minWidth: 0 }}>
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={expanded}
        className="type-body tabular-nums"
        style={{
          display: "flex",
          alignItems: "center",
          gap: "var(--space-xs)",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--text-muted-rack)",
          fontFamily: MONO_STACK,
          minWidth: 0,
          width: "100%",
          textAlign: "left",
        }}
      >
        <span aria-hidden="true" style={{ flexShrink: 0, display: "inline-block", transition: "none" }}>
          {expanded ? "▾" : "▸"}
        </span>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
          {row.toolName}
          {target ? ` · ${target}` : ""}
        </span>
      </button>

      {expanded && (
        <div
          style={{
            marginTop: "var(--space-xs)",
            marginLeft: "var(--space-md)",
            maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT,
            overflowY: "auto",
            fontFamily: MONO_STACK,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
            color: "var(--text-primary-rack)",
          }}
        >
          <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
            Input
          </div>
          <pre style={{ margin: "0 0 var(--space-sm) 0" }}>{stringifyPayload(row.input)}</pre>
          {row.output !== undefined && (
            <>
              <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                Output
              </div>
              <pre style={{ margin: 0 }}>{stringifyPayload(row.output)}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** The character count above which a text row is considered to have more to show than one
 * collapsed line can hold (G-02-3, Task 2). This is a PRESENTATION threshold — it decides only
 * whether a disclosure control is OFFERED. It never affects any row's height: `feedRowEstimateSize`
 * below still returns one of exactly two constants, so the fixed-size virtualization contract
 * (02-UI-SPEC.md "Performance Contract Additions") is untouched by this value. */
export const FEED_ROW_TRUNCATION_THRESHOLD = 120;

/** The text a given expandable row kind carries, for length-based expandability — `undefined` for
 * `tool_call`, whose expandability is unconditional (see `isRowExpandable` below) and does not
 * depend on any text length. */
function expandableRowText(row: FeedRowData): string | undefined {
  switch (row.kind) {
    case "assistant_text":
    case "developer_turn":
    case "system_notice":
      return row.text;
    // The Copywriting Contract's fixed retry line, apart from the two interpolated integers
    // (03-UI-SPEC.md's own wording, character for character) — computed here so `FeedRow`'s
    // "git_retry" case below can route through the exact same `ExpandableTextRow` call the
    // "system_notice" case already uses, rather than duplicating that JSX.
    case "git_retry":
      return `git: retrying after index lock (attempt ${row.attempt}/${row.max})…`;
    case "raw":
      return row.raw;
    default:
      return undefined;
  }
}

/** Whether a row offers a disclosure control at all — a PURE function of the row's own data,
 * deterministic and never a measurement of the rendered DOM (the distinction 02-UI-SPEC.md's
 * Performance Contract Additions requires). `tool_call` is always expandable, unchanged from
 * before this task: expanding it reveals its input/output payload, not "more of one line".
 * `assistant_text`, `system_notice` and `raw` are expandable only when their own text exceeds
 * `FEED_ROW_TRUNCATION_THRESHOLD` — a short row offers no control and cannot be expanded. */
export function isRowExpandable(row: FeedRowData): boolean {
  if (row.kind === "tool_call") return true;
  const text = expandableRowText(row);
  return typeof text === "string" && text.length > FEED_ROW_TRUNCATION_THRESHOLD;
}

/** The shared presentation for every body row kind that is plain text (`assistant_text`,
 * `system_notice`, `raw`) — D-32's "assistant text as prose" stays true under the G-02-3 clamp by
 * making that prose expandable rather than permanently one ellipsised line. Collapsed: the text on
 * one line, clipped exactly the way `ToolCallRow`'s label span already clips — hidden overflow, an
 * ellipsis, a no-wrap rule and a zero minimum width — AND capped to `FEED_ROW_TRUNCATION_THRESHOLD`
 * characters before it ever reaches the DOM, so a multi-kilobyte payload never sits in the document
 * behind a CSS clip (wasteful, and unreachable-until-expanded content should not exist at all).
 * Expanded (only reachable when `isRowExpandable` is true): the full text inside the same
 * fixed-max-height, internally-scrolling block `ToolCallRow`'s own expanded payload uses,
 * preserving whitespace and allowing long unbroken tokens to break. */
function ExpandableTextRow({
  row,
  roleClassName,
  color,
  mono,
  expanded,
  onToggleExpand,
}: {
  row: FeedRowData;
  roleClassName: string;
  color: string;
  mono?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
}) {
  const text = expandableRowText(row) ?? "";
  const expandable = isRowExpandable(row);
  const showExpanded = expandable && expanded;
  const collapsedText = text.length > FEED_ROW_TRUNCATION_THRESHOLD ? text.slice(0, FEED_ROW_TRUNCATION_THRESHOLD) : text;

  return (
    <div role="listitem" style={{ padding: "var(--space-xs) 0", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-xs)", minWidth: 0 }}>
        {expandable && (
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={showExpanded}
            aria-label={showExpanded ? "Collapse full text" : "Expand full text"}
            style={{
              flexShrink: 0,
              display: "inline-block",
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color,
              transition: "none",
            }}
          >
            {showExpanded ? "▾" : "▸"}
          </button>
        )}
        {showExpanded ? (
          <div
            className={roleClassName}
            style={{
              maxHeight: EXPANDED_SUBBLOCK_MAX_HEIGHT,
              overflowY: "auto",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              color,
              fontFamily: mono ? MONO_STACK : undefined,
              minWidth: 0,
            }}
          >
            {text}
          </div>
        ) : (
          <span
            className={roleClassName}
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
              color,
              fontFamily: mono ? MONO_STACK : undefined,
            }}
          >
            {collapsedText}
          </span>
        )}
      </div>
    </div>
  );
}

export function FeedRow({ row, expanded, onToggleExpand }: FeedRowProps) {
  switch (row.kind) {
    case "assistant_text":
      return (
        <ExpandableTextRow
          row={row}
          roleClassName="type-body"
          color="var(--text-primary-rack)"
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      );
    // Task 2, plan 05-12: the accent text token — the developer's own words read as a different
    // speaker class than the agent's `assistant_text` (`--text-primary-rack`) immediately above,
    // exactly what row kind exists to signal in this file.
    case "developer_turn":
      return (
        <ExpandableTextRow
          row={row}
          roleClassName="type-body"
          color="var(--accent-text-rack)"
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      );
    // D-53/plan 03-13: "git_retry" is routed through the SAME branch "system_notice" already
    // uses — reusing the existing system/transient row kind, not a parallel one (03-UI-SPEC.md's
    // own "no new visual component" instruction) — identical roleClassName/color, so a later
    // change to the transient treatment reaches this row automatically.
    case "system_notice":
    case "git_retry":
      return (
        <ExpandableTextRow
          row={row}
          roleClassName="type-micro"
          color="var(--text-muted-rack)"
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      );
    // D-53: an explicit no-render case, never a fallthrough to the unknown-event branch — a
    // silent fallthrough would render this event's raw payload as an unknown row, which is
    // exactly the noise D-53 protects against. Exhaustion surfaces in the Activity Trail only.
    case "git_lock_exhausted":
      return null;
    case "tool_call":
      return <ToolCallRow row={row} expanded={expanded} onToggleExpand={onToggleExpand} />;
    case "raw":
      return (
        <ExpandableTextRow
          row={row}
          roleClassName="type-body"
          color="var(--text-muted-rack)"
          mono
          expanded={expanded}
          onToggleExpand={onToggleExpand}
        />
      );
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

/** A fixed row height per kind (02-UI-SPEC.md "Performance Contract Additions": "a fixed
 * `estimateSize` per row kind... never measured"). `FEED_TOOL_ROW_EXPANDED_HEIGHT` is the expanded
 * height for EVERY expandable row kind, not the tool call's alone (G-02-3, Task 2) — its own
 * larger fixed height, still a constant, never derived from actual content length (the expanded
 * sub-block's own internal scroll is what absorbs a long payload). Its exported name and value are
 * unchanged from before this task, so no call site moves. */
export const FEED_ROW_HEIGHT = 32;
export const FEED_TOOL_ROW_EXPANDED_HEIGHT = 296;

/** Depends only on the row's kind and its expand state, never on the length of its content — a
 * ten-character and a ten-thousand-character row of the same kind return the identical constant,
 * which is exactly what keeps this a fixed-size virtualization contract rather than a measured
 * one (02-UI-SPEC.md "Performance Contract Additions"). */
export function feedRowEstimateSize(row: FeedRowData, expanded: boolean): number {
  if (isRowExpandable(row) && expanded) return FEED_TOOL_ROW_EXPANDED_HEIGHT;
  return FEED_ROW_HEIGHT;
}

/** A convenience hook-free helper so `SessionSurface.tsx` doesn't need its own `useState` per
 * row — one Set of expanded row keys is enough (02-UI-SPEC.md: "a tool call the user has
 * expanded stays expanded as new events arrive below it"). Exported for `SessionSurface.tsx`'s
 * own use; not a React hook itself. */
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
