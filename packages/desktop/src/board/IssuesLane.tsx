/**
 * The Issues lane (D-07, 01-UI-SPEC.md "Board list"): issues are proposals and notes, not units
 * of work, so they render ungrouped by status — beneath the five status bands, never inside one
 * — each row showing key, title, kind, and (G-01-EPIC-ASSIGN, plan 01-15) a focusable parent
 * affordance naming the epic or task the issue sits under, or "No parent". No status glyph, no
 * criteria checked/total badge: issues carry neither (D-07's own contract), so this component
 * renders no such affordance.
 */
import type { CSSProperties } from "react";
import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { IssueItem } from "./useBoardQuery";
import { ROW_HEIGHT_BY_KIND } from "./BoardRow";
import { QuickAdd } from "./QuickAdd";

const KIND_LABEL: Record<string, string> = {
  bug: "Bug",
  idea: "Idea",
  question: "Question",
  risk: "Risk",
};

export interface IssuesLaneProps {
  issues: IssueItem[];
  /** Creates an issue of kind `idea` (D-09: quick-add captures a title only; a kind picker is
   * out of this plan's scope — see the SUMMARY's "Known Stubs"). */
  onCreateIssue?: (title: string) => void;
  /** Item id (an epic's or a task's own `id`, never an issue id) -> a small subject the parent
   * button renders. Built by `BoardView.tsx` from the same loaded window every other id -> item
   * lookup here uses (`epicsById`'s sibling), keyed exactly like it — an issue's `epicId`/`taskId`
   * is looked up directly against this map (G-01-EPIC-ASSIGN, plan 01-15). */
  parentsById?: Record<string, { key: string; title: string; kind: string }>;
  /** Opens the parent picker for one issue, anchored to the button that was clicked — mirrors
   * `BoardRow`'s own picker-opening callbacks (`onOpenStatusPicker` etc.), which also hand back
   * the element rather than reading `getBoundingClientRect()` themselves. */
  onOpenParentPicker?: (issue: IssueItem, anchorEl: HTMLElement) => void;
}

export function IssuesLane({ issues, onCreateIssue, parentsById, onOpenParentPicker }: IssuesLaneProps) {
  const [collapsed, setCollapsed] = useState(false);

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-xs)",
    height: ROW_HEIGHT_BY_KIND.task,
    padding: "0 var(--space-md)",
    background: "var(--surface-secondary)",
    color: "var(--text-primary-rack)",
    cursor: "pointer",
  };

  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-sm)",
    height: ROW_HEIGHT_BY_KIND.task,
    padding: "0 var(--space-md)",
    background: "var(--surface-dominant)",
    color: "var(--text-primary-rack)",
    borderBottom: "1px solid var(--divider)",
  };

  return (
    <div className="issues-lane" role="region" aria-label="Issues">
      <div
        className="type-heading"
        role="button"
        tabIndex={-1}
        aria-expanded={!collapsed}
        onClick={() => setCollapsed((c) => !c)}
        style={headerStyle}
      >
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
        </span>
        Issues
        <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
          {issues.length}
        </span>
      </div>
      {!collapsed &&
        issues.map((issue) => {
          // The epic or task this issue sits under, looked up the same way `BoardRow`'s epic
          // pill resolves its own parent (`epicsById`) — an issue holds exactly one parent at a
          // time (epic XOR task XOR none), so at most one of `epicId`/`taskId` is ever set.
          const parentId = issue.epicId ?? issue.taskId;
          const parent = parentId ? parentsById?.[parentId] : undefined;
          return (
            <div key={issue.id} role="listitem" aria-label={`${issue.key}, ${issue.title}, ${KIND_LABEL[issue.kind] ?? issue.kind}`} style={rowStyle}>
              <span className="type-body tabular-nums" style={{ flexShrink: 0, minWidth: 64, fontWeight: 600 }}>
                {issue.key}
              </span>
              <span
                className="type-body"
                title={issue.title}
                style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >
                {issue.title}
              </span>
              <button
                type="button"
                className="type-label"
                aria-label={`Parent of ${issue.key}: ${parent ? parent.key : "No parent"}. Press to change.`}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenParentPicker?.(issue, event.currentTarget);
                }}
                style={{
                  flexShrink: 0,
                  color: "var(--text-muted-rack)",
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                {parent ? parent.key : "No parent"}
              </button>
              <span className="type-label" style={{ flexShrink: 0, color: "var(--text-muted-rack)" }}>
                {KIND_LABEL[issue.kind] ?? issue.kind}
              </span>
            </div>
          );
        })}
      {!collapsed && onCreateIssue && (
        <QuickAdd
          onCreate={onCreateIssue}
          placeholder="Add an issue…"
          ariaLabel="Quick add an issue"
          background="var(--surface-dominant)"
        />
      )}
    </div>
  );
}
