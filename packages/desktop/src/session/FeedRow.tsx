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
  | { kind: "tool_call"; key: string; toolName: string; input: unknown; output?: unknown }
  | { kind: "system_notice"; key: string; text: string }
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
            maxHeight: 240,
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

export function FeedRow({ row, expanded, onToggleExpand }: FeedRowProps) {
  switch (row.kind) {
    case "assistant_text":
      return (
        <div role="listitem" className="type-body" style={{ padding: "var(--space-xs) 0", color: "var(--text-primary-rack)", overflowWrap: "anywhere" }}>
          {row.text}
        </div>
      );
    case "system_notice":
      return (
        <div role="listitem" className="type-micro" style={{ padding: "var(--space-xs) 0", color: "var(--text-muted-rack)" }}>
          {row.text}
        </div>
      );
    case "tool_call":
      return <ToolCallRow row={row} expanded={expanded} onToggleExpand={onToggleExpand} />;
    case "raw":
      return (
        <div
          role="listitem"
          className="type-body"
          style={{
            padding: "var(--space-xs) 0",
            color: "var(--text-muted-rack)",
            fontFamily: MONO_STACK,
            whiteSpace: "pre-wrap",
            overflowWrap: "anywhere",
          }}
        >
          {row.raw}
        </div>
      );
    default: {
      const exhaustive: never = row;
      return exhaustive;
    }
  }
}

/** A fixed row height per kind (02-UI-SPEC.md "Performance Contract Additions": "a fixed
 * `estimateSize` per row kind... never measured"). An EXPANDED tool-call row is the one exception
 * — its own larger fixed height, still a constant, never derived from actual content length
 * (the expanded sub-block's own internal scroll is what absorbs a long payload). */
export const FEED_ROW_HEIGHT = 32;
export const FEED_TOOL_ROW_EXPANDED_HEIGHT = 296;

export function feedRowEstimateSize(row: FeedRowData, expanded: boolean): number {
  if (row.kind === "tool_call" && expanded) return FEED_TOOL_ROW_EXPANDED_HEIGHT;
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
