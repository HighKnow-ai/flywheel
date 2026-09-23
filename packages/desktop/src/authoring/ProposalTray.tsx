/**
 * The proposal tray (D-80/D-82/D-92/D-95, plan 05-07) — a sibling panel beside the feed on
 * `SessionSurface.tsx`, reading its own query (`useAuthoringQuery.ts`'s `useRunProposals`) rather
 * than being woven into `FeedRow.tsx`'s per-event rendering — the same independent-re-render
 * boundary `StatusStrip`/`PermissionRequestCard` already use, which is what lets the tray update
 * while the feed streams without re-rendering the virtualized feed.
 *
 * Renders one row per pending proposal (`ProposalRow.tsx`), a drafted criterion nested under the
 * task it belongs to (grouped by `parentProposalId`, children ordered by staging `position`, roots
 * left in the order the Rust read already returns them — `created_at DESC, id DESC` — so the two
 * can never disagree). An orphaned drafted criterion, whose named parent proposal is no longer in
 * the pending set (already decided), still renders — nothing here is ever silently dropped (D-16).
 *
 * Owns the accept-subtree guard, keyed by root id (a `Set`, mirroring
 * `recovery/OrphanRecoveryModal.tsx`'s `killingRef`) since two different subtrees must both be
 * able to act at once, and only a repeat of the same one is suppressed. Owns the tray's own
 * selection (`j`/`k`/arrow keys move it via `state/keyboard.ts`'s `nextSelectionId`, the same
 * idiom the board list uses — an empty tray takes no focus).
 */
import { useEffect, useRef, useState } from "react";
import type { AuthoringProposalDto } from "../adapters/tauri";
import { nextSelectionId, useRegionBindings } from "../state/keyboard";
import { useAcceptSubtree, useRunProposals } from "./useAuthoringQuery";
import { ProposalRow } from "./ProposalRow";

export interface ProposalTrayProps {
  /** The authoring run this tray is mounted against. `null`/`undefined` disables the underlying
   * query entirely (mirrors `PermissionRequestCard`'s own `agentRunId`-gated mount pattern). */
  agentRunId: string | null | undefined;
}

interface ProposalGroup {
  root: AuthoringProposalDto;
  children: AuthoringProposalDto[];
}

/**
 * Groups the flat, backend-ordered list into roots-with-children. A proposal counts as a root
 * either because it carries no `parentProposalId`, or because its named parent is not itself in
 * the current pending set (already decided, or otherwise gone) — an orphaned drafted criterion
 * still renders on its own, never silently dropped (D-16). Preserves the incoming array's own root
 * order rather than re-sorting; children are sorted by their own staging `position`.
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

/** The flat, selectable row order — every root immediately followed by its own children, in
 * exactly the order they render, which is what `nextSelectionId` needs to move through the tray
 * one visible row at a time. */
function flattenGroups(groups: ProposalGroup[]): AuthoringProposalDto[] {
  return groups.flatMap((group) => [group.root, ...group.children]);
}

export function ProposalTray({ agentRunId }: ProposalTrayProps) {
  const proposalsQuery = useRunProposals(agentRunId);
  const proposals = proposalsQuery.data ?? [];
  const groups = groupProposals(proposals);
  const flat = flattenGroups(groups);

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // An empty tray takes no focus, and a row removed from the list (accepted/rejected, here or
  // from another surface reading the same query) can never stay "selected" — both close the same
  // window a stale id would otherwise leave open.
  useEffect(() => {
    if (selectedId && !flat.some((p) => p.id === selectedId)) {
      setSelectedId(flat[0]?.id ?? null);
    } else if (!selectedId && flat.length > 0) {
      setSelectedId(flat[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flat]);

  // Tray-wide selection movement — `j`/`k`/arrow keys — lives HERE, once, shared by every row
  // below; each row's own `useRegionBindings` call (inside `ProposalRow.tsx`) owns only its own
  // guarded accept/reject/amend/subtree-accept verbs, gated on `selected`. No key handler lives in
  // any tray component's own `onKeyDown`/`addEventListener` — both hooks register through
  // `state/keyboard.ts`'s shared window listener.
  useRegionBindings("proposal-tray", "proposal-tray", {
    "move-down": () => setSelectedId((current) => nextSelectionId(flat, current, 1)),
    "move-up": () => setSelectedId((current) => nextSelectionId(flat, current, -1)),
  });

  const acceptSubtreeMutation = useAcceptSubtree(agentRunId);
  // The root ids currently in flight for a subtree accept. A row's own `acceptingSubtree` prop
  // alone is not a sufficient guard against two activations in one synchronous tick — React has
  // not necessarily flushed the disabling re-render before a second click fires — and a ref reads
  // and writes synchronously with no such window. A `Set` rather than a single boolean because two
  // DIFFERENT subtree roots must both be able to act at once; only a repeat of the SAME one is
  // suppressed (mirrors `recovery/OrphanRecoveryModal.tsx`'s `killingRef`).
  const acceptingSubtreeRef = useRef<Set<string>>(new Set());
  const [acceptingSubtreeIds, setAcceptingSubtreeIds] = useState<Set<string>>(new Set());

  function handleAcceptSubtree(rootId: string) {
    if (acceptingSubtreeRef.current.has(rootId)) return;
    acceptingSubtreeRef.current.add(rootId);
    setAcceptingSubtreeIds(new Set(acceptingSubtreeRef.current));
    acceptSubtreeMutation.mutate(rootId, {
      onError: () => {
        // A genuine failure must leave the control usable — the guard entry is released only on
        // this path; on success the accepted members leave the pending list on refetch and can
        // never re-activate, so the entry is deliberately never released there.
        acceptingSubtreeRef.current.delete(rootId);
        setAcceptingSubtreeIds(new Set(acceptingSubtreeRef.current));
      },
    });
  }

  return (
    <div
      role="region"
      aria-label="Staged proposals"
      style={{ display: "flex", flexDirection: "column", gap: "var(--space-sm)", minWidth: 0 }}
    >
      <span className="type-label" style={{ color: "var(--text-muted-rack)" }}>
        {proposals.length} pending proposal{proposals.length === 1 ? "" : "s"}
      </span>
      {groups.map((group) => (
        <div key={group.root.id} style={{ display: "flex", flexDirection: "column", gap: "var(--space-xs)" }}>
          <ProposalRow
            agentRunId={agentRunId as string}
            proposal={group.root}
            indented={false}
            selected={group.root.id === selectedId}
            onSelect={() => setSelectedId(group.root.id)}
            pendingChildCount={group.children.length}
            acceptingSubtree={acceptingSubtreeIds.has(group.root.id)}
            onAcceptSubtree={() => handleAcceptSubtree(group.root.id)}
          />
          {group.children.map((child) => (
            <ProposalRow
              key={child.id}
              agentRunId={agentRunId as string}
              proposal={child}
              indented
              selected={child.id === selectedId}
              onSelect={() => setSelectedId(child.id)}
              pendingChildCount={0}
              acceptingSubtree={false}
              onAcceptSubtree={() => {}}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
