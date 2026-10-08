/**
 * One epic on the roster (08.1 A-01, D-05): the home surface's row. Reads left to right like the
 * compare row the owner adopted — title with a muted key sub-label, a progress bar with its printed
 * fraction, a task-distribution strip, the agents-running count and the proposals-waiting count.
 *
 * Every number here is the board-wide aggregate's (`EpicProgressDto`), never derived from the rows
 * that happen to be loaded: the board window is a page, an epic is not (RESEARCH Pitfall 1).
 *
 * Honesty (D-06): progress is tasks done over tasks total. Criteria are a finer second figure only
 * where they exist; an epic whose tasks carry none says "no criteria yet" in words, never a zero.
 * While the aggregate has not landed the row prints no figure at all — an unknown is not a zero.
 *
 * Colour is a data channel only (D-11): the fill is the brand's progress role (D-12), "done" is the
 * done role, and the other segments are neutral tones mixed from the text role, so no literal colour
 * is declared here. Meaning never rests on colour: the bar carries its fraction, each segment its own
 * label, and the legend line prints the counts in words.
 *
 * The row is a selection target keyed by the epic's id (plan 10's open limit): click selects and
 * toggles; the chevron button is the disclosure's semantic target. Selection takes the surface shift
 * only (A-06) — the 2px rule is a task-row mark.
 */
import type { CSSProperties } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { MARKS_BY_ID, statusMarkId } from "../legend/marks";
import { Icon } from "./BoardRow";
import type { ChangeFlagDto, EpicProgressDto } from "../adapters/tauri";

/** Display order of the distribution strip: finished work first, so the strip reads as a fill. */
const STRIP_ORDER = ["done", "in_review", "in_progress", "todo", "backlog"] as const;

const mix = (percent: number) =>
  `color-mix(in srgb, var(--text-primary-rack) ${percent}%, var(--surface-dominant))`;

/** Segment fills: "done" is the done role; the rest are neutral tonal steps, never a second palette. */
const SEGMENT_FILL: Record<string, string> = {
  done: "var(--success-text-rack)",
  in_review: mix(72),
  in_progress: mix(46),
  todo: mix(24),
  backlog: mix(9),
};

const statusLabel = (status: string) => MARKS_BY_ID[statusMarkId(status)]?.label ?? status;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What an epic's child tasks say together: summed measurable commits ahead, and any dirty tree. */
export interface EpicChange {
  ahead: number;
  dirty: boolean;
}

/**
 * Rolls the board-wide change flags up per epic (D-18) — a reduction over the one map the board
 * already fetched, never a query per epic. A flag whose base could not be resolved (`ahead: null`)
 * contributes nothing to the sum, so an epic whose children are all unmeasurable and clean renders
 * nothing rather than a zero it never measured. Keyed by the flag's epic; `null` is the no-epic bucket.
 */
export function rollUpChangeFlags(flags: readonly ChangeFlagDto[]): Map<string | null, EpicChange> {
  const byEpic = new Map<string | null, EpicChange>();
  for (const flag of flags) {
    const key = flag.epicId ?? null;
    const change = byEpic.get(key) ?? { ahead: 0, dirty: false };
    change.ahead += flag.ahead ?? 0;
    change.dirty ||= flag.dirty;
    byEpic.set(key, change);
  }
  return byEpic;
}

export interface EpicHeaderRowProps {
  /** The epic's id, or `null` for the "No epic" bucket (which has no selection target). */
  epicId: string | null;
  /** `undefined` for the no-epic bucket. */
  epicKey?: string;
  title: string;
  /** The aggregate for this epic; `undefined` until it lands. */
  progress?: EpicProgressDto;
  /** `undefined` until the proposal window lands; `0` is a measured zero. */
  pendingProposalCount?: number;
  /** The rolled-up change signal for this epic; `undefined` when no child task has a worktree. */
  change?: EpicChange;
  collapsed: boolean;
  selected?: boolean;
  focused?: boolean;
  onToggleCollapsed: () => void;
  onSelect?: () => void;
  onOpenDetail?: () => void;
}

export function EpicHeaderRow({
  epicId,
  epicKey,
  title,
  progress,
  pendingProposalCount,
  change,
  collapsed,
  selected = false,
  focused = false,
  onToggleCollapsed,
  onSelect,
  onOpenDetail,
}: EpicHeaderRowProps) {
  const name = epicKey ? `${epicKey} ${title}` : title;
  const counts = new Map((progress?.byStatus ?? []).map((s) => [s.status, s.count]));
  const total = progress?.total ?? 0;
  const done = progress?.done ?? 0;
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;
  const fraction = `${done} of ${total}`;

  const parts: string[] = [];
  if (progress) {
    parts.push(`${fraction} tasks done`);
    parts.push(plural(progress.agentsRunning, "agent running", "agents running"));
  }
  if (pendingProposalCount !== undefined) {
    parts.push(plural(pendingProposalCount, "proposal waiting", "proposals waiting"));
  }
  const aheadCount = change?.ahead ?? 0;
  const aheadLabel = plural(aheadCount, "commit ahead", "commits ahead");
  const isDirty = change?.dirty ?? false;
  if (aheadCount > 0) parts.push(`${aheadLabel} across its tasks`);
  if (isDirty) parts.push("uncommitted changes");
  const accessibleName = [name, ...parts].join(", ");

  const surface = focused
    ? "var(--row-surface-selected)"
    : selected
      ? "var(--row-surface-selected-unfocused)"
      : "var(--row-surface)";

  const rowStyle: CSSProperties = {
    // The column template lives in App.css (`.epic-header-row`), because a container query cannot
    // rewrite an inline style: the ladder sheds the distribution strip as the rack narrows.
    display: "grid",
    alignItems: "center",
    height: "100%",
    padding: "0 var(--space-md)",
    background: surface,
    color: "var(--text-primary-rack)",
    borderBottom: "1px solid var(--divider)",
    // The keyboard ring is `.epic-header-row:focus-visible` in App.css, not an inline outline: `focused`
    // is also true after a mouse click, and a click must not leave the brand on the row (D-12).
    cursor: "pointer",
  };

  const truncate: CSSProperties = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };
  const stat: CSSProperties = { display: "flex", flexDirection: "column", alignItems: "flex-end" };

  function handleClick() {
    onSelect?.();
    onToggleCollapsed();
  }

  return (
    <div
      className="epic-header-row"
      data-epic-id={epicId ?? "none"}
      role="listitem"
      aria-label={accessibleName}
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      style={rowStyle}
      onClick={handleClick}
      onDoubleClick={onOpenDetail}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)", minWidth: 0 }}>
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${name}`}
          tabIndex={-1}
          style={{
            display: "inline-flex",
            flexShrink: 0,
            padding: 0,
            background: "transparent",
            border: "none",
            color: "var(--text-muted-rack)",
            cursor: "pointer",
          }}
        >
          {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="type-heading" title={title} style={truncate}>
            {title}
          </div>
          <div className="type-label" style={{ ...truncate, color: "var(--text-muted-rack)" }}>
            {epicKey ?? "Tasks without an epic"}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0 }}>
        {progress && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: "var(--space-sm)" }}>
              <div
                role="progressbar"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label={`${name} progress: ${fraction} tasks done`}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: "var(--radius-mark)",
                  overflow: "hidden",
                  background: mix(9),
                }}
              >
                <div style={{ width: `${percent}%`, height: "100%", background: "var(--accent-nontext)" }} />
              </div>
              <span className="type-label tabular-nums" style={{ flexShrink: 0, fontWeight: 600 }}>
                {fraction}
              </span>
            </div>
            <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
              {progress.criteria ? `${progress.criteria.checked} of ${progress.criteria.total} criteria` : "no criteria yet"}
            </span>
          </>
        )}
      </div>

      <div className="field-epic-distribution" style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", minWidth: 0 }}>
        {progress && (
          <>
            <div
              role="group"
              aria-label="Task distribution by status"
              style={{
                display: "flex",
                height: 6,
                gap: 1,
                borderRadius: "var(--radius-mark)",
                overflow: "hidden",
                background: "var(--surface-dominant)",
              }}
            >
              {STRIP_ORDER.filter((status) => (counts.get(status) ?? 0) > 0).map((status) => {
                const count = counts.get(status) as number;
                return (
                  <span
                    key={status}
                    role="img"
                    aria-label={`${count} ${statusLabel(status)}`}
                    style={{ flexGrow: count, flexBasis: 0, background: SEGMENT_FILL[status] }}
                  />
                );
              })}
            </div>
            {/* Not truncated: this is a line of counts, and a clipped count ("186 o…") is the one thing a
                counting surface cannot do. It wraps instead; the cell has the height for three lines. */}
            <span data-slot="distribution-label" className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
              {`${counts.get("in_progress") ?? 0} active, ${counts.get("in_review") ?? 0} in review, ${total - done} open`}
            </span>
          </>
        )}
      </div>

      <div style={stat} data-slot="agents">
        {progress && (
          <span role="img" aria-label={plural(progress.agentsRunning, "agent running", "agents running")} style={stat}>
            <strong className="type-body tabular-nums" style={{ color: progress.agentsRunning ? undefined : "var(--text-muted-rack)" }}>
              {progress.agentsRunning}
            </strong>
            <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
              agents
            </span>
          </span>
        )}
      </div>

      <div style={stat} data-slot="proposals">
        {pendingProposalCount !== undefined && (
          <span
            role="img"
            aria-label={plural(pendingProposalCount, "proposal waiting", "proposals waiting")}
            style={stat}
          >
            <strong className="type-body tabular-nums" style={{ color: pendingProposalCount ? undefined : "var(--text-muted-rack)" }}>
              {pendingProposalCount}
            </strong>
            <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
              proposals
            </span>
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "var(--space-xs)" }} data-slot="change">
        {aheadCount > 0 && (
          <span
            role="img"
            aria-label={aheadLabel}
            title={MARKS_BY_ID["change-ahead"]?.meaning}
            className="type-label tabular-nums"
            style={{ display: "inline-flex", alignItems: "center", gap: 2, color: "var(--accent-text-rack)" }}
          >
            <Icon name={MARKS_BY_ID["change-ahead"]?.glyph ?? "Triangle"} size={12} />
            {aheadCount}
          </span>
        )}
        {isDirty && (
          <span
            role="img"
            aria-label="uncommitted changes"
            title={MARKS_BY_ID["change-dirty"]?.meaning}
            style={{ display: "inline-flex", alignItems: "center", color: "var(--text-muted-rack)" }}
          >
            <Icon name={MARKS_BY_ID["change-dirty"]?.glyph ?? "Dot"} size={12} />
          </span>
        )}
      </div>
    </div>
  );
}
