/**
 * The Cycle region (Phase 14, RECD-09, D-01 to D-04), a non-virtualized sibling ABOVE the board's
 * list, never a row inside the virtualizer, so the list's O(1) size lookup is untouched.
 *
 * Hierarchy (`14-HIERARCHY.md`, written before this shape): the epic roster keeps the lead and this
 * region orients. Its three levels are internal to it and carried by type, weight, spacing and
 * position only, never by colour:
 *   1. the current Cycle: goal at the heading step, its counts and printed fraction beside it;
 *   2. the later Cycles: one body-step line each (goal, epic count), in rank order;
 *   3. the frame: the container, the divider, and the stated absences in muted ink.
 *
 * Every number is the command's, folded from every task of every epic in the Cycle; the printed
 * fraction is never recomputed from board rows the renderer happens to hold. Honesty (D-06): a Cycle
 * with no tasks, a Cycle with no epics, and a project with no active Cycle each say so in words,
 * never a zero percent, an empty bar or a blank. While the read has not landed nothing is printed:
 * an unknown is not a zero.
 *
 * The later list is bounded by the core's ceiling, not by this component: there is no scroll
 * container and no paging or expand control here (D-02 invents no second windowing rule). When the core
 * says `truncated`, the sentence below states how many are not shown, as `BoardView`'s
 * `epicRosterNotice` does for epics. The figure is a position, not a score: no trend, comparison or
 * target is drawn beside it, and no percentage is drawn at all: the printed figure is the fold's
 * integer pair as-is (so there is no rounding rule to name), which can be read aloud and reproduced.
 * Carries `EpicHeaderRow`'s D-06 honesty rule up one level. No literal colour is declared.
 */
import { useState, type CSSProperties } from "react";
import { CycleCloseDialog } from "./CycleCloseDialog";
import { useCycleRegionQuery } from "./useCycleRegionQuery";

const regionStyle: CSSProperties = {
  flex: "none",
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-sm)",
  padding: "var(--space-sm) var(--space-md)",
  borderBottom: "1px solid var(--divider)",
  background: "var(--surface-secondary)",
  color: "var(--text-primary-rack)",
};

const rowStyle: CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "var(--space-md)",
};

const listStyle: CSSProperties = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  display: "flex",
  flexDirection: "column",
  gap: "var(--space-xs)",
};

const muted: CSSProperties = { flex: "none", color: "var(--text-muted-rack)" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const epicsLabel = (n: number) => (n === 0 ? "no epics yet" : plural(n, "epic", "epics"));

export function CycleRegion({ projectId }: { projectId: string | undefined }) {
  const { data } = useCycleRegionQuery(projectId);
  const [closing, setClosing] = useState(false);
  if (!data) return null;

  const cycle = data.active;
  const notShown = data.total - data.listed;

  return (
    <section aria-label="Current cycle" data-cycle-region style={regionStyle}>
      {cycle ? (
        <div style={rowStyle}>
          <span className="type-heading" style={{ flex: 1, minWidth: 0 }}>
            {cycle.goal}
          </span>
          <span className="type-body" style={muted}>
            {epicsLabel(cycle.progress.epics)}
            {cycle.progress.agentsRunning > 0 ? `, ${cycle.progress.agentsRunning} running` : ""}
            {cycle.progress.agentsBlocked > 0 ? `, ${cycle.progress.agentsBlocked} blocked` : ""}
          </span>
          <span className="type-body" data-cycle-progress style={muted}>
            {cycle.progress.tasksTotal === 0
              ? "No tasks in this cycle yet"
              : `${cycle.progress.tasksDone}/${cycle.progress.tasksTotal} tasks done`}
          </span>
          {cycle.scopeDrift && (
            <span className="type-body" data-cycle-scope-drift style={muted}>
              {cycle.scopeDrift.sentence}
            </span>
          )}
          <button type="button" className="type-body control-edge confirm-action" onClick={() => setClosing(true)}>
            Close this cycle
          </button>
        </div>
      ) : (
        <span className="type-body" style={{ color: "var(--text-muted-rack)" }}>
          No cycle is active.
        </span>
      )}
      {data.later.length > 0 && (
        <ul aria-label="Later cycles" style={listStyle}>
          {data.later.map((line) => (
            <li key={line.id} className="type-body" data-cycle-line style={rowStyle}>
              <span style={{ flex: 1, minWidth: 0 }}>{line.goal}</span>
              {line.scopeDrift && (
                <span data-cycle-scope-drift style={muted}>
                  {line.scopeDrift.sentence}
                </span>
              )}
              <span style={muted}>{epicsLabel(line.epicCount)}</span>
            </li>
          ))}
        </ul>
      )}
      {data.truncated && (
        <p className="type-body" role="status" style={{ ...muted, margin: 0 }}>
          {`${plural(notShown, "more cycle", "more cycles")} ahead not shown (${data.total} open in all).`}
        </p>
      )}
      {closing && cycle && projectId && (
        <CycleCloseDialog
          projectId={projectId}
          cycleId={cycle.id}
          cycleGoal={cycle.goal}
          epics={cycle.unfinishedEpics}
          targets={data.later}
          onDone={() => setClosing(false)}
          onCancel={() => setClosing(false)}
        />
      )}
    </section>
  );
}
