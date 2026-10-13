/**
 * One group header — a status band or, in the epic lens (08.1 A-02), an epic. One component for
 * both: the grouping key changes what a group IS, not how its header collapses. Originally: one sticky stamped band header (01-UI-SPEC.md "Board list", "Selected Direction") — one per
 * entry of the fixed five-state workflow, carrying the state name and its item count. The count
 * stays visible even when a band is collapsed (BOARD-08: legibility of scale, not just render
 * speed), so it is passed and rendered unconditionally here rather than hidden on collapse.
 *
 * Collapse state is a local UI preference (Zustand, per-project) held by the caller — never
 * written to the database, since it is not board data (01-UI-SPEC.md "Board list").
 */
import { ChevronDown, ChevronRight } from "lucide-react";

export interface StatusBandProps {
  label: string;
  /** `undefined` while the aggregate that supplies it has not loaded — renders nothing, never a 0. */
  count?: number;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

export function StatusBand({ label, count, collapsed, onToggleCollapsed }: StatusBandProps) {
  return (
    <div
      className="status-band type-heading"
      role="button"
      tabIndex={-1}
      aria-expanded={!collapsed}
      onClick={onToggleCollapsed}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        height: "100%",
        padding: "0 var(--space-md)",
        background: "var(--surface-secondary)",
        color: "var(--text-primary-rack)",
        cursor: "pointer",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: "var(--space-xs)" }}>
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
        </span>
        {label}
      </span>
      <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
        {count}
      </span>
    </div>
  );
}
