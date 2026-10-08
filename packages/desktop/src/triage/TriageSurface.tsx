/**
 * The dedicated triage surface (D-103, plan 06-07) — `SessionSurface.tsx`'s sibling: same
 * header/body/action-bar shell (a "← Board" close control, a heading, a scrolling body), read in
 * full before writing this file, per this task's own `<read_first>`. Built because PROP-06's four
 * verbs — accept, reject, merge, defer — do not fit a 32px board row: merge needs a target picker
 * and defer needs a recall filter (D-103's own reasoning).
 *
 * Reuses the shipped `ProposalRow` (the SAME row `ProposalTray.tsx`/`board/TriageLane.tsx` render)
 * given the `"triage-surface"` keyboard region (plan 06-07 Task 1) and this surface's own
 * `onMerge`/`onDefer` callbacks — never a second row implementation. `groupProposals` below is a
 * deliberate byte-for-byte copy of `board/TriageLane.tsx`'s own function (which is itself a copy of
 * `authoring/ProposalTray.tsx`'s), applied here to whichever project-scoped window (pending or
 * deferred) is currently active.
 *
 * Per row, above what the tray shows: the run provenance (which run, which epic), the agent's
 * stated rationale as its own labelled block (D-99, PROP-07), a duplicate annotation when
 * `duplicateOf` is present (PROP-04, D-107 — the row stays in the queue, the annotation is a link
 * that reveals the candidate, never an action that decides the row), and a turn-pointer control
 * when `originLogOffset` is non-null (offset `0` is a real pointer, never treated as missing).
 *
 * Multi-select offers EXACTLY two bulk controls — "Reject selected" and "Defer selected" — wired to
 * `useRejectProposalsBulk`/`useDeferProposalsBulk`, each inert on an empty selection. There is no
 * bulk-accept control, label, handler or identifier anywhere in this file (D-104): accept stays
 * per-row/per-subtree because it is what mints canonical rows and burns a contiguous per-project
 * key. Merge is a two-step interaction — choosing merge opens `MergeTargetPicker` below, and only an
 * explicit target choice there ever calls `useMergeProposal`; there is no default target and no
 * single keystroke that completes a merge (D-101).
 *
 * Renders NO hex colour literal (token roles only) and no project-key-shaped text for a pending
 * proposal (D-96 — the key is allocated only at acceptance), matching the conventions `ProposalRow`
 * and `TriageLane` already hold themselves to.
 */
import { useEffect, useRef, useState, type ComponentType } from "react";
import * as icons from "lucide-react";
import type { AuthoringProposalDto, DuplicateCandidateDto } from "../adapters/tauri";
import { useBoardQuery, type EpicSummary } from "../board/useBoardQuery";
import { nextSelectionId, useRegionBindings } from "../state/keyboard";
import { ProposalRow } from "../authoring/ProposalRow";
import {
  useAcceptSubtreeForProject,
  useDeferProposal,
  useDeferProposalsBulk,
  useDeferredProposals,
  useMergeProposal,
  useProjectProposals,
  useProposalLimitNotices,
  useRejectProposalsBulk,
} from "../authoring/useAuthoringQuery";
import "../styles/admin-surfaces.css";

type IconComponent = ComponentType<{ size?: number; strokeWidth?: number }>;

function Icon({ name, size = 14 }: { name: string; size?: number }) {
  const Component = (icons as unknown as Record<string, IconComponent>)[name];
  if (!Component) return null;
  return <Component size={size} strokeWidth={2} />;
}

/** The stable substring `domain::authoring_proposal::ProposalUndecidable`'s `Display` impl always
 * carries — the same marker `authoring/ProposalRow.tsx`'s own (private) `isUndecidableError` checks
 * for. Duplicated here rather than imported: neither file exports it, matching this codebase's own
 * established convention of duplicating small pure checks across sibling files (e.g.
 * `groupProposals` itself, below). */
const MERGE_UNDECIDABLE_MARKER = "undecidable, not auto-rejected";

function isMergeUndecidableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes(MERGE_UNDECIDABLE_MARKER);
}

/** The payload's own title, for the bulk-selection checkbox's accessible name — mirrors
 * `ProposalRow.tsx`'s own (private) `payloadTitle` exactly, duplicated for the same reason
 * `MERGE_UNDECIDABLE_MARKER` above is. */
function payloadTitle(proposal: AuthoringProposalDto): string {
  const { payload } = proposal;
  if (typeof payload.title === "string") return payload.title;
  if (typeof payload.statement === "string") return payload.statement;
  if (typeof payload.assumption === "string") return payload.assumption;
  return "(untitled)";
}

interface ProposalGroup {
  root: AuthoringProposalDto;
  children: AuthoringProposalDto[];
}

/** Byte-for-byte copy of `board/TriageLane.tsx`'s own `groupProposals` (itself a copy of
 * `authoring/ProposalTray.tsx`'s) — an orphaned child whose named parent is not in the CURRENT
 * window (already decided elsewhere, or the window is the deferred one and the parent is still
 * pending) still renders on its own, never silently dropped (D-16). */
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

/** The flat, selectable row order — every root immediately followed by its own children, exactly
 * the order they render, mirroring `ProposalTray.tsx`'s own `flattenGroups` (the `j`/`k` movement
 * this surface's own `useRegionBindings` call below needs). */
function flattenGroups(groups: ProposalGroup[]): AuthoringProposalDto[] {
  return groups.flatMap((group) => [group.root, ...group.children]);
}

type MergeCandidate = { kind: "task" | "epic"; id: string; label: string };

/** D-101's own target picker — "a small component in this same file", requiring an explicit choice
 * before `useMergeProposal` is ever called. No default target: the list renders with nothing
 * pre-selected, and choosing is the only way a target reaches the mutation. */
function MergeTargetPicker({
  candidates,
  pending,
  onChoose,
  onCancel,
}: {
  candidates: MergeCandidate[];
  pending: boolean;
  onChoose: (candidate: MergeCandidate) => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Choose a merge target"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--space-xs)",
        padding: "var(--space-sm)",
        marginTop: "var(--space-xs)",
        border: "1px solid var(--divider)",
        borderRadius: "var(--radius-chrome)",
      }}
    >
      <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        Merge into…
      </span>
      {candidates.length === 0 && (
        <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
          No open tasks or epics to merge into yet.
        </span>
      )}
      {candidates.map((candidate) => (
        <button
          key={`${candidate.kind}-${candidate.id}`}
          type="button"
          disabled={pending}
          onClick={() => onChoose(candidate)}
          className="type-body admin-option"
        >
          {candidate.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onCancel}
        className="type-label control-edge admin-action"
        style={{ alignSelf: "flex-start" }}
      >
        Cancel
      </button>
    </div>
  );
}

function DuplicateAnnotation({ candidate }: { candidate: DuplicateCandidateDto }) {
  const [revealed, setRevealed] = useState(false);
  const label = candidate.key ? `${candidate.key} ${candidate.title}` : candidate.title;
  return (
    <div className="type-label" style={{ color: "var(--text-muted-rack)" }}>
      Possible duplicate of{" "}
      <button
        type="button"
        onClick={() => setRevealed((prev) => !prev)}
        className="type-label admin-link"
      >
        {label}
      </button>
      {revealed && <span> — a {candidate.kind}</span>}
    </div>
  );
}

function LimitNoticeBanner({
  agentRunId,
  limit,
  refusedCount,
}: {
  agentRunId: string;
  limit: number;
  refusedCount: number;
}) {
  return (
    <div
      role="status"
      className="type-label admin-notice"
    >
      <span aria-hidden="true" style={{ display: "inline-flex", color: "var(--text-muted-rack)" }}>
        <Icon name="TriangleAlert" />
      </span>
      Run {agentRunId.slice(0, 8)} hit its proposal limit of {limit} and could not stage {refusedCount} more — it
      was told to put them in its summary instead.
    </div>
  );
}

export interface TriageSurfaceProps {
  projectId: string;
  /** The epics-by-id roster the board already builds (`useEpics`, G-01-2) — resolves which epic a
   * row's provenance names, mirroring `board/TriageLane.tsx`'s own `epicsById` prop exactly. */
  epicsById: Record<string, EpicSummary>;
  /** Opens the session that produced a proposal, at the turn that produced it (D-99's turn
   * pointer) — `agentRunId`/`epicId` mirror `TriageLane.tsx`'s own `onOpenSession`; `logOffset` is
   * this surface's own addition, `null` when the row's `originLogOffset` was itself `null`. */
  onOpenSession: (agentRunId: string, epicId: string | null, logOffset: number | null) => void;
  onClose: () => void;
}

type ProposalFilter = "pending" | "deferred";

export function TriageSurface({ projectId, epicsById, onOpenSession, onClose }: TriageSurfaceProps) {
  const [filter, setFilter] = useState<ProposalFilter>("pending");

  const pendingWindow = useProjectProposals(projectId);
  const deferredWindow = useDeferredProposals(projectId);
  const activeWindow = filter === "pending" ? pendingWindow : deferredWindow;
  const proposals = activeWindow.data?.proposals ?? [];
  const groups = groupProposals(proposals);
  const flatRows = flattenGroups(groups);

  const limitNoticesQuery = useProposalLimitNotices(projectId);
  const limitNotices = limitNoticesQuery.data ?? [];

  // The merge target picker's own candidate roster — the project's full epic roster (already
  // loaded by the board, passed in as a prop) plus its currently-loaded task window
  // (`useBoardQuery`, D-03's own bounded window — "candidate tasks", not an exhaustive roster).
  const boardWindowQuery = useBoardQuery(projectId);
  const candidateTasks: MergeCandidate[] = (boardWindowQuery.data?.items ?? [])
    .filter((item) => item.kind !== "epic")
    .map((item) => ({ kind: "task", id: item.id, label: `${item.key} ${item.title}` }));
  const candidateEpics: MergeCandidate[] = Object.values(epicsById).map((epic) => ({
    kind: "epic",
    id: epic.id,
    label: `${epic.key} ${epic.title}`,
  }));
  const mergeCandidates: MergeCandidate[] = [...candidateEpics, ...candidateTasks];

  // The single keyboard-focused row (`j`/`k` moves it) — independent of `selectedIds` below, which
  // is the SEPARATE bulk-selection set. An empty window takes no focus, mirroring
  // `ProposalTray.tsx`'s own effect exactly.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  useEffect(() => {
    if (focusedId && !flatRows.some((p) => p.id === focusedId)) {
      setFocusedId(flatRows[0]?.id ?? null);
    } else if (!focusedId && flatRows.length > 0) {
      setFocusedId(flatRows[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatRows]);

  // The bulk-selection set (D-104) — checkboxes, never the keyboard-focused row above. Cleared on
  // every filter switch so a stale cross-filter selection can never survive into the other window.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setSelectedIds(new Set());
  }, [filter]);

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const rejectBulkMutation = useRejectProposalsBulk(projectId);
  const deferBulkMutation = useDeferProposalsBulk(projectId);

  function handleBulkReject() {
    if (selectedIds.size === 0) return;
    rejectBulkMutation.mutate(
      { proposalIds: Array.from(selectedIds) },
      { onSuccess: () => setSelectedIds(new Set()) },
    );
  }

  function handleBulkDefer() {
    if (selectedIds.size === 0 || filter !== "pending") return;
    deferBulkMutation.mutate(Array.from(selectedIds), { onSuccess: () => setSelectedIds(new Set()) });
  }

  useRegionBindings("triage-surface", "triage-surface", {
    "move-down": () => setFocusedId((current) => nextSelectionId(flatRows, current, 1)),
    "move-up": () => setFocusedId((current) => nextSelectionId(flatRows, current, -1)),
    "reject-selected-proposals": handleBulkReject,
    "defer-selected-proposals": handleBulkDefer,
  });

  // Subtree accept (D-95) — mirrors `board/TriageLane.tsx`'s own `acceptingSubtreeRef`/
  // `acceptingSubtreeIds` pair exactly: a `Set`, not a single boolean, because two DIFFERENT
  // subtree roots must both be able to act at once.
  const acceptSubtreeMutation = useAcceptSubtreeForProject(projectId);
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

  // Defer (D-102) — the invalidation-only hooks pass `null` as their own `agentRunId` (this
  // surface is project-scoped, spanning many runs; a tray-scoped invalidation has no fixed run to
  // target here, and the project/deferred/board invalidations the hooks ALSO perform are the ones
  // this surface actually needs).
  const deferMutation = useDeferProposal(null, projectId);

  // Merge (D-101) — a two-step interaction. `mergingProposalId` names the row whose picker is
  // open; choosing a target is the ONLY thing that calls `useMergeProposal`. `mergingRef` guards
  // two synchronous target-choice clicks in one tick (T-06-32), mirroring the ref pattern
  // `ProposalRow.tsx`'s own accept/reject already apply.
  const mergeMutation = useMergeProposal(null, projectId);
  const [mergingProposalId, setMergingProposalId] = useState<string | null>(null);
  const [mergeUndecidableIds, setMergeUndecidableIds] = useState<Set<string>>(new Set());
  const [mergeError, setMergeError] = useState<string | null>(null);
  const mergingRef = useRef(false);

  function handleChooseMergeTarget(proposalId: string, candidate: MergeCandidate) {
    if (mergingRef.current) return;
    mergingRef.current = true;
    setMergeError(null);
    mergeMutation.mutate(
      { proposalId, targetKind: candidate.kind, targetId: candidate.id },
      {
        onSuccess: () => {
          mergingRef.current = false;
          setMergingProposalId(null);
        },
        onError: (err) => {
          mergingRef.current = false;
          if (isMergeUndecidableError(err)) {
            setMergeUndecidableIds((prev) => new Set(prev).add(proposalId));
            setMergingProposalId(null);
          } else {
            setMergeError("Could not merge this proposal. Try again.");
          }
        },
      },
    );
  }

  const bulkRejectDisabled = selectedIds.size === 0;
  const bulkDeferDisabled = selectedIds.size === 0 || filter !== "pending";

  function renderRow(proposal: AuthoringProposalDto, indented: boolean, pendingChildCount: number) {
    const epic = proposal.epicId ? epicsById[proposal.epicId] : undefined;
    const epicLabel = epic ? `${epic.key} ${epic.title}` : "a new epic";
    const logOffset = proposal.originLogOffset;
    const title = payloadTitle(proposal);

    return (
      <div
        key={proposal.id}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-xs)",
          marginLeft: indented ? "var(--space-lg)" : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: "var(--space-sm)" }}>
          <input
            type="checkbox"
            aria-label={`Select "${title}" for a bulk action`}
            checked={selectedIds.has(proposal.id)}
            onChange={() => toggleSelected(proposal.id)}
            className="admin-check"
          />
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", gap: "var(--space-sm)", flexWrap: "wrap" }}>
              <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                From session {proposal.agentRunId.slice(0, 8)}
              </span>
              <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                For {epicLabel}
              </span>
              {logOffset !== null && (
                <button
                  type="button"
                  aria-label="Jump to the turn that produced this proposal"
                  onClick={() => onOpenSession(proposal.agentRunId, proposal.epicId, logOffset)}
                  className="type-label admin-link"
                >
                  Jump to turn
                </button>
              )}
            </div>

            <div style={{ display: "flex", flexDirection: "column" }}>
              <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
                Rationale
              </span>
              <span className="type-body">{proposal.rationale ?? "No rationale given."}</span>
            </div>

            {proposal.duplicateCandidate && <DuplicateAnnotation candidate={proposal.duplicateCandidate} />}

            <ProposalRow
              agentRunId={proposal.agentRunId}
              proposal={proposal}
              indented={false}
              selected={proposal.id === focusedId}
              onSelect={() => setFocusedId(proposal.id)}
              pendingChildCount={pendingChildCount}
              acceptingSubtree={acceptingSubtreeIds.has(proposal.id)}
              onAcceptSubtree={() => handleAcceptSubtree(proposal.id)}
              region="triage-surface"
              onMerge={() => setMergingProposalId(proposal.id)}
              onDefer={
                filter === "pending"
                  ? () => deferMutation.mutateAsync(proposal.id).then(() => undefined)
                  : undefined
              }
            />

            {mergingProposalId === proposal.id && (
              <>
                <MergeTargetPicker
                  candidates={mergeCandidates}
                  pending={mergeMutation.isPending}
                  onChoose={(candidate) => handleChooseMergeTarget(proposal.id, candidate)}
                  onCancel={() => setMergingProposalId(null)}
                />
                {mergeError && (
                  <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                    {mergeError}
                  </p>
                )}
              </>
            )}
            {mergeUndecidableIds.has(proposal.id) && (
              <p role="alert" className="type-label" style={{ margin: 0, color: "var(--destructive-text-rack)" }}>
                The task or epic chosen for this merge no longer exists.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column", color: "var(--text-primary-rack)" }}>
      <header className="admin-header">
        <button type="button" onClick={onClose} className="type-label admin-back">
          ← Board
        </button>
        <span className="type-heading">Triage</span>

        <span style={{ display: "inline-flex", gap: "var(--space-xs)" }}>
          <button
            type="button"
            aria-pressed={filter === "pending"}
            onClick={() => setFilter("pending")}
            className="type-label control-edge admin-choice"
          >
            Pending
          </button>
          <button
            type="button"
            aria-pressed={filter === "deferred"}
            onClick={() => setFilter("deferred")}
            className="type-label control-edge admin-choice"
          >
            Deferred
          </button>
        </span>

        <span style={{ marginLeft: "auto", display: "inline-flex", gap: "var(--space-sm)" }}>
          <button
            type="button"
            disabled={bulkRejectDisabled}
            onClick={handleBulkReject}
            className="type-label control-edge admin-action"
          >
            Reject selected
          </button>
          <button
            type="button"
            disabled={bulkDeferDisabled}
            onClick={handleBulkDefer}
            className="type-label control-edge admin-action"
          >
            Defer selected
          </button>
        </span>
      </header>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "var(--space-md)" }}>
        {limitNotices.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)", marginBottom: "var(--space-md)" }}>
            {limitNotices.map((notice) => (
              <LimitNoticeBanner
                key={notice.agentRunId}
                agentRunId={notice.agentRunId}
                limit={notice.limit}
                refusedCount={notice.refusedCount}
              />
            ))}
          </div>
        )}

        {proposals.length === 0 ? (
          <p className="type-body" style={{ color: "var(--text-muted-rack)" }}>
            {filter === "pending" ? "Nothing pending — the queue is clear." : "No deferred proposals."}
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-md)" }}>
            {groups.map((group) => (
              <div key={group.root.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
                {renderRow(group.root, false, group.children.length)}
                {group.children.map((child) => renderRow(child, true, 0))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
