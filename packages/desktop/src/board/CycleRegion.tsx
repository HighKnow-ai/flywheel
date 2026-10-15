/**
 * The current Cycle's goal and progress, on the board surface without navigating to them (Phase 14
 * plan 14-01, RECD-09, D-01). A non-virtualized sibling ABOVE the board's list, never a row inside
 * the virtualizer, so the list's O(1) size lookup is untouched.
 *
 * Every number is the command's, folded from every task of every epic in the Cycle; the printed
 * fraction is never recomputed from board rows the renderer happens to hold. Honesty (D-06): a Cycle
 * with no tasks says so in words, never a zero percent or an empty bar, and a project with no
 * active Cycle says that. While the read has not landed nothing is printed: an unknown is not a
 * zero. No literal colour is declared; spacing and type come from the existing tokens.
 *
 * Hierarchy and visual weight are tuned later (plans 14-02 and 14-09); this slice draws nothing
 * that would have to be unwound.
 */
import type { CSSProperties } from "react";
import { useCycleRegionQuery } from "./useCycleRegionQuery";

const regionStyle: CSSProperties = {
  flex: "none",
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-md)",
  padding: "var(--space-sm) var(--space-md)",
  borderBottom: "1px solid var(--divider)",
  background: "var(--surface-secondary)",
  color: "var(--text-primary-rack)",
};

export function CycleRegion({ projectId }: { projectId: string | undefined }) {
  const { data } = useCycleRegionQuery(projectId);
  if (!data) return null;

  const cycle = data.active;
  if (!cycle) {
    return (
      <section aria-label="Current cycle" data-cycle-region style={regionStyle}>
        <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
          No cycle is active.
        </span>
      </section>
    );
  }

  const { tasksDone, tasksTotal } = cycle.progress;
  return (
    <section aria-label="Current cycle" data-cycle-region style={regionStyle}>
      <span className="type-heading" style={{ flex: 1, minWidth: 0 }}>
        {cycle.goal}
      </span>
      <span className="type-body" data-cycle-progress style={{ flex: "none", color: "var(--text-muted-rack)" }}>
        {tasksTotal === 0 ? "No tasks in this cycle yet" : `${tasksDone}/${tasksTotal} tasks done`}
      </span>
    </section>
  );
}
