/**
 * The board-level triage lane (D-82, plan 05-08) — every pending authoring proposal across the
 * whole project, in its own collapsible lane beside `IssuesLane`, so a wholly-staged new epic
 * (SHAPE-01's primary case — a proposal with no row anywhere else to hang a detail-panel section
 * on) is still visible and decidable after the session that drafted it has ended. This is the
 * whole staging decision made real: "if staged proposals died with the session, the session would
 * be the store of record" (05-CONTEXT.md) — the lane is where a session abandoned halfway leaves
 * real, decidable work behind.
 *
 * Structurally `IssuesLane.tsx`'s sibling: the same collapsible `type-heading` shell, the same
 * `headerStyle` `CSSProperties` object, the same chevron pair from `lucide-react`, the same
 * `type-label tabular-nums` count. Joined to `collapseStore.ts` (keyed `"proposals"`, per project)
 * rather than local `useState`, so the lane's own collapsed state survives a re-render exactly
 * like every other collapsible region on the board.
 *
 * Renders the SAME `ProposalRow` the tray does (D-92, plan 05-07) — grouped by `parentProposalId`
 * exactly as `ProposalTray.tsx` groups its own run-scoped list (`groupProposals` below is a
 * deliberate byte-for-byte copy of that function), applied here to a project-scoped list that can
 * span several different authoring runs at once, which the run-scoped tray never sees. Each row is
 * given ITS OWN `proposal.agentRunId` (never a lane-wide one), so `ProposalRow`'s internal
 * `useAcceptProposal`/`useRejectProposal` calls invalidate the correct run's own query regardless
 * of which run a given group belongs to.
 *
 * Adds only what the tray does not need: which epic (or "a new epic", D-84's fresh-epic case) a
 * group belongs to, and a route back into the run that produced it (`onOpenSession`).
 *
 * No lane-wide decision (D-95, SHAPE-04): the header carries a count and a collapse control and
 * nothing else — plan 05-06's accept-all source gate scans `packages/desktop/src`, which includes
 * this file.
 */
import type { CSSProperties } from "react";
import { useRef, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { ProposalRow } from "../authoring/ProposalRow";
import { useAcceptSubtreeForProject, useProjectProposals } from "../authoring/useAuthoringQuery";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { ROW_HEIGHT } from "./BoardRow";
import { useCollapseStore } from "./collapseStore";
import type { EpicSummary } from "./useBoardQuery";

/** The `collapseStore.ts` band key this lane uses — a project's status bands are keyed by their
 * own status string (`"backlog"`, `"todo"`, …); this lane is not a status band, so it gets a key
 * no status can ever collide with. */
const COLLAPSE_KEY = "proposals";

interface ProposalGroup {
  root: AuthoringProposalDto;
  children: AuthoringProposalDto[];
}

/**
 * Mirrors `authoring/ProposalTray.tsx`'s own `groupProposals` exactly (D-16: an orphaned child
 * whose named parent is no longer in the pending set — already decided, or from a different run
 * entirely — still renders on its own, never silently dropped). Applied here to a project-scoped
 * list spanning several different runs, which the run-scoped tray's own copy never has to handle.
 */
function groupProposals(proposals: AuthoringProposalDto[]): ProposalGroup[] {
  const byId = new Map(proposals.map((p) => [p.id, p] as const));
  const childrenByParent = new Map<string, AuthoringProposalDto[]>();
  for (const proposal of proposals) {
    if (proposal.parentProposalId && byId.has(proposal.parentProposalId)) {
      const list = childrenByParent.get(proposal.parentProposalId) ?? [];
      list.push(proposal);
      childrenByParent.set(proposal.parentProposalId, list);
    }
  }
  for (const list of childrenByParent.values()) {
    list.sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));
  }
  return proposals
    .filter((p) => !p.parentProposalId || !byId.has(p.parentProposalId))
    .map((root) => ({ root, children: childrenByParent.get(root.id) ?? [] }));
}

export interface TriageLaneProps {
  projectId?: string;
  /** The loaded epic roster, id -> summary (`BoardView.tsx`'s own `epicsById`) — resolves which
   * epic a group belongs to, the same lookup `IssuesLane.tsx`'s `parentsById` performs for an
   * issue's own parent. A group whose run carries no `epicId` (D-84: a fresh-epic session) renders
   * "a new epic" rather than blank or an internal id — the primary case this lane exists for. */
  epicsById?: Record<string, EpicSummary>;
  /** Opens the session that produced a proposal — `BoardView.tsx`'s own
   * `openLiveSessionForTask`-shaped entry point, generalised from resolving a run id FROM a task
   * to reading the run id the lane already has directly. `epicId` rides alongside so the opened
   * surface carries the same `activeAgentRunEpicId` a launch from anywhere else would. */
  onOpenSession?: (agentRunId: string, epicId: string | null) => void;
}

export function TriageLane({ projectId, epicsById, onOpenSession }: TriageLaneProps) {
  const collapseKeyProject = projectId ?? "";
  const collapsed = useCollapseStore((state) => state.isCollapsed(collapseKeyProject, COLLAPSE_KEY));
  const toggleCollapsed = useCollapseStore((state) => state.toggle);

  const proposalsQuery = useProjectProposals(projectId);
  const proposals = proposalsQuery.data?.proposals ?? [];
  const pendingCount = proposalsQuery.data?.counts.pending ?? proposals.length;
  const groups = groupProposals(proposals);

  const acceptSubtreeMutation = useAcceptSubtreeForProject(projectId);
  // Mirrors `ProposalTray.tsx`'s own `acceptingSubtreeRef`/`acceptingSubtreeIds` pair exactly: a
  // `Set` (not a single boolean) because two DIFFERENT subtree roots — even across two different
  // runs here — must both be able to act at once; only a repeat of the SAME root is suppressed.
  const acceptingSubtreeRef = useRef<Set<string>>(new Set());
  const [acceptingSubtreeIds, setAcceptingSubtreeIds] = useState<Set<string>>(new Set());

  function handleAcceptSubtree(rootId: string) {
    if (acceptingSubtreeRef.current.has(rootId)) return;
    acceptingSubtreeRef.current.add(rootId);
    setAcceptingSubtreeIds(new Set(acceptingSubtreeRef.current));
    acceptSubtreeMutation.mutate(rootId, {
      onError: () => {
        acceptingSubtreeRef.current.delete(rootId);
        setAcceptingSubtreeIds(new Set(acceptingSubtreeRef.current));
      },
    });
  }

  // Renders nothing at all — not an empty shell a developer would have to notice and dismiss —
  // when there are no pending proposals anywhere in the project. Mirrors the header-count
  // contract the other way round: a collapsed lane with proposals still reports its own scale, but
  // a lane with nothing to report is not shown at all.
  if (proposals.length === 0) return null;

  const headerStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: "var(--space-xs)",
    height: ROW_HEIGHT,
    padding: "0 var(--space-md)",
    background: "var(--surface-secondary)",
    color: "var(--text-primary-rack)",
    cursor: "pointer",
  };

  const groupHeaderStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "var(--space-sm)",
    padding: "var(--space-sm) var(--space-md) 0",
  };

  const groupWrapperStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    gap: "var(--space-xs)",
    paddingBottom: "var(--space-sm)",
    background: "var(--surface-dominant)",
    borderBottom: "1px solid var(--divider)",
  };

  return (
    <div className="triage-lane" role="region" aria-label="Proposals">
      <div
        className="type-heading"
        role="button"
        tabIndex={-1}
        aria-expanded={!collapsed}
        onClick={() => toggleCollapsed(collapseKeyProject, COLLAPSE_KEY)}
        style={headerStyle}
      >
        <span aria-hidden="true" style={{ display: "inline-flex" }}>
          {collapsed ? <ChevronRight size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
        </span>
        Proposals
        <span className="type-label tabular-nums" style={{ color: "var(--text-muted-rack)" }}>
          {pendingCount}
        </span>
      </div>
      {!collapsed &&
        groups.map((group) => {
          const epic = group.root.epicId ? epicsById?.[group.root.epicId] : undefined;
          const epicLabel = epic ? `${epic.key} ${epic.title}` : "a new epic";
          return (
            <div key={group.root.id} style={groupWrapperStyle}>
              <div style={groupHeaderStyle}>
                <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                  For {epicLabel}
                </span>
                <button
                  type="button"
                  className="type-label"
                  aria-label={`Open the session that produced this proposal`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpenSession?.(group.root.agentRunId, group.root.epicId);
                  }}
                  style={{
                    flexShrink: 0,
                    color: "var(--accent-text-rack)",
                    background: "transparent",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }}
                >
                  From session {group.root.agentRunId.slice(0, 8)}
                </button>
              </div>
              <ProposalRow
                agentRunId={group.root.agentRunId}
                proposal={group.root}
                indented={false}
                selected={false}
                onSelect={() => {}}
                pendingChildCount={group.children.length}
                acceptingSubtree={acceptingSubtreeIds.has(group.root.id)}
                onAcceptSubtree={() => handleAcceptSubtree(group.root.id)}
              />
              {group.children.map((child) => (
                <ProposalRow
                  key={child.id}
                  agentRunId={child.agentRunId}
                  proposal={child}
                  indented
                  selected={false}
                  onSelect={() => {}}
                  pendingChildCount={0}
                  acceptingSubtree={false}
                  onAcceptSubtree={() => {}}
                />
              ))}
            </div>
          );
        })}
    </div>
  );
}
