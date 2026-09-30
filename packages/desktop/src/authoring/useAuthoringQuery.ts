/**
 * The authoring proposal tray's one query layer (D-80/D-82, plan 05-07) — TanStack Query hooks
 * wrapping `adapters/tauri.ts`, following `board/useBoardQuery.ts`'s own shape exactly: a stable
 * query key, a thin transport wrapper so the seam stays behind `adapters/tauri.ts`'s own
 * single-invoke rule, and invalidation on the existing `board:changed` event rather than a second
 * live-update mechanism — deliberately NOT `subscribeAgentEvent` too. `handle_inbound_proposal_created`
 * (Rust, `commands/authoring.rs`) already re-emits `board:changed` for every `proposal_created`
 * event, so a second subscription here would be redundant AND would defeat the isolation
 * `SessionSurface.tsx`'s feed and this tray depend on (D-85): the tray updates while the feed
 * streams without the two re-rendering each other, which only holds if a feed-only `agent:event`
 * push never touches this query.
 *
 * `useProjectProposals` (plan 05-08) is the board-level triage lane's own project-scoped sibling
 * of `useRunProposals` — both read through this ONE module, so the tray and the lane can never
 * disagree about what is pending or what order things are in.
 *
 * This is the ONLY file under `packages/desktop/src/authoring` that imports from
 * `adapters/tauri.ts` — `ProposalTray.tsx`/`ProposalRow.tsx`/`ProposalAmendEditor.tsx`/
 * `board/TriageLane.tsx` all read/write through the hooks below, never the transport's own typed
 * wrappers directly (and, transitively, never its raw invoke seam either).
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptAuthoringProposal,
  acceptAuthoringSubtree,
  amendAuthoringProposal,
  authoringProposalLimitNotices,
  authoringProposalsDeferred,
  authoringProposalsForRun,
  authoringProposalsPending,
  deferAuthoringProposal,
  deferAuthoringProposalsBulk,
  mergeAuthoringProposal,
  rejectAuthoringProposal,
  rejectAuthoringProposalsBulk,
  subscribeBoardChanged,
  type ProposalWindowDto,
} from "../adapters/tauri";

/** `useRunProposals`' query key, keyed by `agentRunId` — mirrors `board/useBoardQuery.ts`'s own
 * `pendingPermissionRequestsQueryKey` shape. */
export function authoringProposalsQueryKey(agentRunId: string) {
  return ["authoring-proposals", agentRunId] as const;
}

/**
 * Every pending proposal staged for `agentRunId` (D-80/D-82) — the tray's own read.
 * `null`/`undefined` disables the query entirely (mirrors `usePendingPermissionRequests`'s own
 * gated-mount pattern). Invalidated on `board:changed` only — see the module doc comment above for
 * why `agent:event` is deliberately excluded.
 */
export function useRunProposals(agentRunId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!agentRunId) return undefined;
    const queryKey = authoringProposalsQueryKey(agentRunId);
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [agentRunId, queryClient]);

  return useQuery({
    queryKey: authoringProposalsQueryKey(agentRunId ?? "none"),
    queryFn: () => authoringProposalsForRun(agentRunId as string),
    enabled: Boolean(agentRunId),
  });
}

/** `useProjectProposals`' query key, keyed by `projectId` — the project-scoped sibling of
 * [`authoringProposalsQueryKey`], read by plan 05-08's board triage lane. */
export function projectProposalsQueryKey(projectId: string) {
  return ["authoring-proposals-pending", projectId] as const;
}

/**
 * Every pending proposal staged across `projectId` (D-82) — the board-level triage lane's own
 * read. `useRunProposals`' project-scoped sibling: same mutation hooks, same `board:changed`-only
 * invalidation discipline (see the module doc comment above), so the tray and the lane can never
 * disagree about what is pending or what order things are in. `null`/`undefined` disables the
 * query entirely, mirroring `useRunProposals`' own gated-mount pattern.
 */
export function useProjectProposals(projectId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return undefined;
    const queryKey = projectProposalsQueryKey(projectId);
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [projectId, queryClient]);

  return useQuery<ProposalWindowDto>({
    queryKey: projectProposalsQueryKey(projectId ?? "none"),
    queryFn: () => authoringProposalsPending(projectId as string),
    enabled: Boolean(projectId),
  });
}

function useInvalidateRunProposals(agentRunId: string | null | undefined) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: authoringProposalsQueryKey(agentRunId ?? "none") });
}

/** Accept a pending proposal (D-92/D-96) — the ONLY path that materialises a staged proposal into
 * a real board row. Thin wrapper over `acceptAuthoringProposal`. */
export function useAcceptProposal(agentRunId: string | null | undefined) {
  const invalidate = useInvalidateRunProposals(agentRunId);
  return useMutation({
    mutationFn: (proposalId: string) => acceptAuthoringProposal(proposalId),
    onSuccess: invalidate,
  });
}

/** Reject a pending proposal with an optional reason (D-93) — a turn in the conversation the agent
 * sees, never a silent verdict. `reason` reaches the running session as a turn (plan 05-06's own
 * relay). Thin wrapper over [`rejectAuthoringProposal`]. */
export function useRejectProposal(agentRunId: string | null | undefined) {
  const invalidate = useInvalidateRunProposals(agentRunId);
  return useMutation({
    mutationFn: (input: { proposalId: string; reason?: string }) =>
      rejectAuthoringProposal(input.proposalId, input.reason),
    onSuccess: invalidate,
  });
}

/** Amend a pending proposal's payload to the developer's own text (D-94) — the row stays
 * `pending`; a later accept materialises this text, never the agent's original. `payload` is the
 * same `kind`-discriminated shape `AuthoringProposalDto.payload` carries. Thin wrapper over
 * [`amendAuthoringProposal`]. */
export function useAmendProposal(agentRunId: string | null | undefined) {
  const invalidate = useInvalidateRunProposals(agentRunId);
  return useMutation({
    mutationFn: (input: { proposalId: string; payload: Record<string, unknown> }) =>
      amendAuthoringProposal(input.proposalId, input.payload),
    onSuccess: invalidate,
  });
}

/** Accept a subtree — a proposed task together with its drafted criteria (D-95, the ONE bulk
 * path this surface offers; there is deliberately no accept-all). Thin wrapper over
 * [`acceptAuthoringSubtree`]. */
export function useAcceptSubtree(agentRunId: string | null | undefined) {
  const invalidate = useInvalidateRunProposals(agentRunId);
  return useMutation({
    mutationFn: (rootProposalId: string) => acceptAuthoringSubtree(rootProposalId),
    onSuccess: invalidate,
  });
}

function useInvalidateProjectProposals(projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({ queryKey: projectProposalsQueryKey(projectId ?? "none") });
}

/** Accept a subtree from the board-level triage lane (D-82/D-95) — [`useAcceptSubtree`]'s
 * project-scoped sibling. The lane spans every run in the project at once (unlike the run-scoped
 * tray), so the target run is never fixed at the hook's own construction — only the invalidation
 * scope (this project's own lane query) is. `rootProposalId` alone names which run's subtree to
 * accept; the backend resolves the rest server-side, exactly as [`useAcceptSubtree`] already does. */
export function useAcceptSubtreeForProject(projectId: string | null | undefined) {
  const invalidate = useInvalidateProjectProposals(projectId);
  return useMutation({
    mutationFn: (rootProposalId: string) => acceptAuthoringSubtree(rootProposalId),
    onSuccess: invalidate,
  });
}

/** [`useDeferredProposals`]' query key, keyed by `projectId` — [`projectProposalsQueryKey`]'s
 * deferred-filter sibling (D-102). */
export function deferredProposalsQueryKey(projectId: string) {
  return ["authoring-proposals-deferred", projectId] as const;
}

/**
 * Every DEFERRED proposal staged across `projectId` (D-102) — the deferred filter's own read,
 * mirroring [`useProjectProposals`]' shape exactly (same gated-mount pattern, same
 * `board:changed`-only invalidation discipline). `null`/`undefined` disables the query entirely.
 */
export function useDeferredProposals(projectId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return undefined;
    const queryKey = deferredProposalsQueryKey(projectId);
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [projectId, queryClient]);

  return useQuery<ProposalWindowDto>({
    queryKey: deferredProposalsQueryKey(projectId ?? "none"),
    queryFn: () => authoringProposalsDeferred(projectId as string),
    enabled: Boolean(projectId),
  });
}

/**
 * Every throttled run's notice across `projectId` (plan 06-05, D-112) — DERIVED, on every call,
 * from the `proposal.limit_exhausted` events those runs' refusals appended. Mirrors
 * [`useProjectProposals`]' gated-mount and `board:changed`-only invalidation shape.
 */
export function useProposalLimitNotices(projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  const queryKey = ["authoring-proposal-limit-notices", projectId ?? "none"] as const;

  useEffect(() => {
    if (!projectId) return undefined;
    let unlisten: (() => void) | undefined;
    let cancelled = false;

    subscribeBoardChanged(() => queryClient.invalidateQueries({ queryKey })).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, queryClient]);

  return useQuery({
    queryKey,
    queryFn: () => authoringProposalLimitNotices(projectId as string),
    enabled: Boolean(projectId),
  });
}

/** Merge a pending task/epic/issue proposal into an existing task or epic (D-101) — attaches one
 * child issue, never mutating the target's own row. Invalidates the run-scoped AND project-scoped
 * proposal queries plus the board query, because a merge mints a real issue a board lane renders
 * (unlike accept/reject/defer, which touch no board-rendered row a board query would need to
 * re-read beyond the proposal lists themselves). Thin wrapper over [`mergeAuthoringProposal`]. */
export function useMergeProposal(agentRunId: string | null | undefined, projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  const invalidateRun = useInvalidateRunProposals(agentRunId);
  const invalidateProject = useInvalidateProjectProposals(projectId);
  return useMutation({
    mutationFn: (input: { proposalId: string; targetKind: "task" | "epic"; targetId: string }) =>
      mergeAuthoringProposal(input.proposalId, input.targetKind, input.targetId),
    onSuccess: () => {
      invalidateRun();
      invalidateProject();
      queryClient.invalidateQueries({ queryKey: ["board"] });
    },
  });
}

/** Defer a pending proposal (D-102) — mints nothing, stays recallable through
 * [`useDeferredProposals`]. Invalidates the run-scoped AND project-scoped pending queries plus
 * this project's own deferred query, so a deferred row appears there immediately. Thin wrapper
 * over [`deferAuthoringProposal`]. */
export function useDeferProposal(agentRunId: string | null | undefined, projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  const invalidateRun = useInvalidateRunProposals(agentRunId);
  const invalidateProject = useInvalidateProjectProposals(projectId);
  return useMutation({
    mutationFn: (proposalId: string) => deferAuthoringProposal(proposalId),
    onSuccess: () => {
      invalidateRun();
      invalidateProject();
      queryClient.invalidateQueries({ queryKey: deferredProposalsQueryKey(projectId ?? "none") });
    },
  });
}

/** Bulk-reject every pending id in a selection (D-104) — the first of the two bulk paths this
 * surface offers; there is deliberately no bulk-accept. Invalidates the project-scoped pending
 * query, mirroring [`useAcceptSubtreeForProject`]'s own project-scoped invalidation. Thin wrapper
 * over [`rejectAuthoringProposalsBulk`]. */
export function useRejectProposalsBulk(projectId: string | null | undefined) {
  const invalidate = useInvalidateProjectProposals(projectId);
  return useMutation({
    mutationFn: (input: { proposalIds: string[]; reason?: string }) =>
      rejectAuthoringProposalsBulk(input.proposalIds, input.reason),
    onSuccess: invalidate,
  });
}

/** Bulk-defer every pending id in a selection (D-104) — [`useRejectProposalsBulk`]'s sibling.
 * Invalidates both the project-scoped pending query and this project's own deferred query, since a
 * bulk defer moves rows from one to the other. Thin wrapper over [`deferAuthoringProposalsBulk`]. */
export function useDeferProposalsBulk(projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  const invalidatePending = useInvalidateProjectProposals(projectId);
  return useMutation({
    mutationFn: (proposalIds: string[]) => deferAuthoringProposalsBulk(proposalIds),
    onSuccess: () => {
      invalidatePending();
      queryClient.invalidateQueries({ queryKey: deferredProposalsQueryKey(projectId ?? "none") });
    },
  });
}
