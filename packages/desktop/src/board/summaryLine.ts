/**
 * The home surface's "what this says" line (D-09): a fixed rule set over aggregates the board has
 * already fetched. Pure — plain objects in, a string out — so it costs nothing, is deterministic,
 * and cannot say anything the numbers do not. It reads no clock: a duration is passed in.
 *
 * An agent-written read of the board is deferred to its own phase; this function's signature is the
 * seam it will land behind. Nothing here prepares for it.
 *
 * Clauses run in order of the cost of waiting — what the owner must act on before what is merely
 * true. A clause with a zero count is left out; if none applies the line says so plainly rather than
 * rendering empty, because an empty block reads as a broken component.
 */
export interface BoardAggregates {
  /** Pending authoring proposals plus tasks that need a recovery decision. */
  decisionsPending: number;
  /** Tasks in review, across every epic and the no-epic bucket. */
  reviewable: number;
  agentsBlocked: number;
  /** How long the longest-blocked agent has waited. Absent when no duration was measured. */
  blockedForMs?: number;
  /** Tasks whose latest CI-bearing observation failed. */
  buildsFailing: number;
  agentsRunning: number;
  /** Epics (not the no-epic bucket) none of whose tasks carry criteria. */
  epicsWithoutCriteria: number;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function duration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return plural(minutes, "minute", "minutes");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return plural(hours, "hour", "hours");
  return plural(Math.floor(hours / 24), "day", "days");
}

export function summaryLine(a: BoardAggregates): string {
  const clauses: string[] = [];
  if (a.decisionsPending > 0) clauses.push(`${plural(a.decisionsPending, "decision", "decisions")} pending`);
  if (a.agentsBlocked > 0) {
    const blocked = `${plural(a.agentsBlocked, "agent", "agents")} blocked`;
    if (a.blockedForMs === undefined) clauses.push(blocked);
    else if (a.agentsBlocked === 1) clauses.push(`${blocked} for ${duration(a.blockedForMs)}`);
    else clauses.push(`${blocked}, the longest for ${duration(a.blockedForMs)}`);
  }
  if (a.buildsFailing > 0) clauses.push(`${plural(a.buildsFailing, "task has a failing build", "tasks have a failing build")}`);
  if (a.reviewable > 0) clauses.push(`${plural(a.reviewable, "item", "items")} ready to review`);
  if (a.agentsRunning > 0) clauses.push(`${plural(a.agentsRunning, "agent", "agents")} running`);
  if (a.epicsWithoutCriteria > 0) {
    clauses.push(`${plural(a.epicsWithoutCriteria, "epic has", "epics have")} no criteria yet`);
  }
  return clauses.length > 0 ? `${clauses.join(". ")}.` : "Nothing is waiting on you right now.";
}
