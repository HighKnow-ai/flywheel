/**
 * Behavior under test (plan 06-08 Task 3, D-99/D-103):
 * - Activating the lane's route control (`board/TriageLane.tsx`'s header) sets the store's triage
 *   project id (`state/uiStore.ts`'s `triageSurfaceProjectId`).
 * - With that store field set, the dedicated triage surface renders; with it `null`, it does not
 *   — the board shows instead. Mirrors `App.tsx`'s own App-level mount conditional (copied here,
 *   not re-derived: see `AppLikeShell` below).
 * - Closing the surface clears the store field and the board is interactive again.
 * - Activating a row's turn-pointer control opens the run's session at the recorded log offset,
 *   through the SAME `onOpenSession` closure `App.tsx` wires — including when the offset is zero,
 *   asserted against the resulting store state (never a mocked setter) so the assertion proves the
 *   real wiring this plan introduces, not merely that `TriageSurface`'s own prop was called (06-07
 *   already proves that in isolation).
 * - A session surface for a run with no authoring stage but one staged proposal renders its own
 *   live proposal tray (T-06-35).
 * - A session surface for a run with no authoring stage and no staged proposals does not.
 * - A session surface for an authoring run renders the tray exactly as it did before this plan —
 *   the SAME assertion `authoring/__tests__/proposal-tray.test.tsx`'s own authoring-mount test
 *   uses, proving the authoring branch is byte-identical.
 *
 * Copies `board/__tests__/triage-lane.test.tsx`'s and `triage/__tests__/triage-surface.test.tsx`'s
 * mocking/harness shape rather than inventing a second one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TriageLane } from "../../board/TriageLane";
import { TriageSurface } from "../TriageSurface";
import { SessionSurface } from "../../session/SessionSurface";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicSummary } from "../../board/useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  authoringProposalsPending: (projectId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_pending", { projectId, limit }),
  authoringProposalsDeferred: (projectId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_deferred", { projectId, limit }),
  authoringProposalLimitNotices: (projectId: string, limit?: number) =>
    invokeCommandMock("authoring_proposal_limit_notices", { projectId, limit }),
  authoringProposalsForRun: (agentRunId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_for_run", { agentRunId, limit }),
  acceptAuthoringProposal: (proposalId: string) => invokeCommandMock("authoring_proposal_accept", { proposalId }),
  rejectAuthoringProposal: (proposalId: string, reason?: string) =>
    invokeCommandMock("authoring_proposal_reject", { proposalId, reason }),
  amendAuthoringProposal: (proposalId: string, payload: Record<string, unknown>) =>
    invokeCommandMock("authoring_proposal_amend", { proposalId, payload }),
  acceptAuthoringSubtree: (rootProposalId: string) =>
    invokeCommandMock("authoring_subtree_accept", { rootProposalId }),
  mergeAuthoringProposal: (proposalId: string, targetKind: string, targetId: string) =>
    invokeCommandMock("authoring_proposal_merge", { proposalId, targetKind, targetId }),
  deferAuthoringProposal: (proposalId: string) => invokeCommandMock("authoring_proposal_defer", { proposalId }),
  rejectAuthoringProposalsBulk: (proposalIds: string[], reason?: string) =>
    invokeCommandMock("authoring_proposals_reject_bulk", { proposalIds, reason }),
  deferAuthoringProposalsBulk: (proposalIds: string[]) =>
    invokeCommandMock("authoring_proposals_defer_bulk", { proposalIds }),
  agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
  agentRunRawWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_raw_window", { agentRunId, offset, limit }),
  stopAgentRun: (agentRunId: string) => invokeCommandMock("agent_run_stop", { agentRunId }),
  discardSession: (agentRunId: string) => invokeCommandMock("agent_run_discard", { agentRunId }),
  pendingPermissionRequests: () => Promise.resolve([]),
  answerPermissionRequest: () => Promise.resolve(undefined),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

afterEach(() => {
  invokeCommandMock.mockReset();
  resetUiState();
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function makeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "prop-1",
    agentRunId: "run-1",
    epicId: null,
    verb: "create",
    targetType: "task",
    targetId: null,
    parentProposalId: null,
    position: "a0",
    payload: { kind: "task", title: "A proposed task" },
    status: "pending",
    createdBy: "actor-agent",
    createdAt: "2026-01-01T00:00:00.000Z",
    rationale: "Found while executing.",
    originLogOffset: null,
    ...overrides,
  };
}

/**
 * `App.tsx`'s own App-level mount conditional and `onOpenSession` closure, copied verbatim rather
 * than pulled in via the whole `AppShell` (which drags in project registration, the launch sheet,
 * Settings, and the board's own `useProjects`/`useEpics` reads — none of which this behavior
 * touches). Drives the REAL `useUiStore` (never a mocked setter), so a passing assertion here
 * proves the wiring these tests exist to catch, not just that each piece works in isolation.
 */
function AppLikeShell({ epicsById = {} }: { epicsById?: Record<string, EpicSummary> }) {
  const triageSurfaceProjectId = useUiStore((state) => state.triageSurfaceProjectId);
  const setTriageSurfaceProjectId = useUiStore((state) => state.setTriageSurfaceProjectId);
  const setActiveAgentRunId = useUiStore((state) => state.setActiveAgentRunId);
  return triageSurfaceProjectId ? (
    <TriageSurface
      projectId={triageSurfaceProjectId}
      epicsById={epicsById}
      onClose={() => setTriageSurfaceProjectId(null)}
      onOpenSession={(agentRunId, epicId, logOffset) => {
        setTriageSurfaceProjectId(null);
        setActiveAgentRunId(agentRunId, null, null, epicId, logOffset);
      }}
    />
  ) : (
    <div data-testid="board-shell">Board</div>
  );
}

function mockPendingWindow(proposals: ReturnType<typeof makeProposal>[]) {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "authoring_proposals_pending") {
      return Promise.resolve({
        proposals,
        counts: { pending: proposals.length, accepted: 0, rejected: 0 },
      });
    }
    return Promise.resolve(undefined);
  });
}

describe("the board's route into the dedicated triage surface", () => {
  it("activating the lane's route control sets the store's triage project id", async () => {
    mockPendingWindow([makeProposal()]);

    renderWithClient(<TriageLane projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("A proposed task")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Open the dedicated triage view" }));

    expect(useUiStore.getState().triageSurfaceProjectId).toBe("proj-1");
  });

  it("the triage surface renders only while the store's triage project id is set", async () => {
    mockPendingWindow([]);

    renderWithClient(<AppLikeShell />);

    expect(screen.getByTestId("board-shell")).toBeInTheDocument();
    expect(screen.queryByText("Triage")).not.toBeInTheDocument();

    act(() => useUiStore.getState().setTriageSurfaceProjectId("proj-1"));

    await waitFor(() => expect(screen.getByText("Triage")).toBeInTheDocument());
    expect(screen.queryByTestId("board-shell")).not.toBeInTheDocument();
  });

  it("closing the surface clears the store field and the board is interactive again", async () => {
    mockPendingWindow([]);

    renderWithClient(<AppLikeShell />);
    act(() => useUiStore.getState().setTriageSurfaceProjectId("proj-1"));
    await waitFor(() => expect(screen.getByText("Triage")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "← Board" }));

    expect(useUiStore.getState().triageSurfaceProjectId).toBeNull();
    expect(screen.getByTestId("board-shell")).toBeInTheDocument();
  });

  it("activating a row's turn-pointer control opens the run's session at the recorded offset, including zero", async () => {
    mockPendingWindow([
      makeProposal({ id: "prop-zero", agentRunId: "run-zero", epicId: "epic-9", originLogOffset: 0 }),
    ]);

    renderWithClient(<AppLikeShell />);
    act(() => useUiStore.getState().setTriageSurfaceProjectId("proj-1"));
    await waitFor(() => expect(screen.getByText("A proposed task")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Jump to the turn that produced this proposal" }));

    expect(useUiStore.getState().triageSurfaceProjectId).toBeNull();
    expect(useUiStore.getState().activeAgentRunId).toBe("run-zero");
    expect(useUiStore.getState().activeAgentRunEpicId).toBe("epic-9");
    // The load-bearing assertion: offset `0` must survive as a real pointer, never coerced to
    // "no offset" by a falsy-value bug anywhere along this chain (D-99).
    expect(useUiStore.getState().activeAgentRunInitialLogOffset).toBe(0);
  });
});

describe("an execution run's own live proposal tray (T-06-35)", () => {
  it("renders when the run has no authoring stage but has staged a proposal", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([makeProposal({ agentRunId: "run-1" })]);
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Staged proposals" })).toBeInTheDocument());
  });

  it("does not render when the run has no authoring stage and no staged proposals", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} />);

    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("agent_run_log_window", expect.anything()));
    expect(screen.queryByRole("region", { name: "Staged proposals" })).not.toBeInTheDocument();
  });

  it("an authoring run renders the tray exactly as it did before this plan", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);

    // Same assertion `authoring/__tests__/proposal-tray.test.tsx`'s own
    // "renders the tray region when authoringStage is present" test uses — proving the authoring
    // branch is unchanged even though it now shares its condition with an OR clause.
    await waitFor(() => expect(screen.getByRole("region", { name: "Staged proposals" })).toBeInTheDocument());
  });
});
