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
 * Both this tray and plan 05-08's board-level triage lane read `useRunProposals` — one query
 * layer, two surfaces, so the two can never disagree about what is pending.
 *
 * This is the ONLY file under `packages/desktop/src/authoring` that calls into the Tauri
 * transport — `ProposalTray.tsx`/`ProposalRow.tsx`/`ProposalAmendEditor.tsx` all read/write
 * through the hooks below, never `invokeCommand` directly.
 */
import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptAuthoringProposal,
  authoringProposalsForRun,
  invokeCommand,
  subscribeBoardChanged,
  type AuthoringProposalDto,
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
 * relay). Thin wrapper over `authoring_proposal_reject` — not yet a named export on
 * `adapters/tauri.ts`, so this hook calls `invokeCommand` directly, mirroring
 * `board/useBoardQuery.ts`'s own mixed pattern (several of its mutations call `invokeCommand`
 * inline rather than through a named wrapper). */
export function useRejectProposal(agentRunId: string | null | undefined) {
  const invalidate = useInvalidateRunProposals(agentRunId);
  return useMutation({
    mutationFn: (input: { proposalId: string; reason?: string }) =>
      invokeCommand<void>("authoring_proposal_reject", {
        proposalId: input.proposalId,
        reason: input.reason,
      }),
    onSuccess: invalidate,
  });
}

/** Amend a pending proposal's payload to the developer's own text (D-94) — the row stays
 * `pending`; a later accept materialises this text, never the agent's original. `payload` is the
 * same `kind`-discriminated shape `AuthoringProposalDto.payload` carries. Thin wrapper over
 * `authoring_proposal_amend`. */
export function useAmendProposal(agentRunId: string | null | undefined) {
  const invalidate = useInvalidateRunProposals(agentRunId);
  return useMutation({
    mutationFn: (input: { proposalId: string; payload: Record<string, unknown> }) =>
      invokeCommand<AuthoringProposalDto>("authoring_proposal_amend", {
        proposalId: input.proposalId,
        payload: input.payload,
      }),
    onSuccess: invalidate,
  });
}

/** Accept a subtree — a proposed task together with its drafted criteria (D-95, the ONE bulk
 * path this surface offers; there is deliberately no accept-all). Thin wrapper over
 * `authoring_subtree_accept`. */
export function useAcceptSubtree(agentRunId: string | null | undefined) {
  const invalidate = useInvalidateRunProposals(agentRunId);
  return useMutation({
    mutationFn: (rootProposalId: string) =>
      invokeCommand<void>("authoring_subtree_accept", { rootProposalId }),
    onSuccess: invalidate,
  });
}
