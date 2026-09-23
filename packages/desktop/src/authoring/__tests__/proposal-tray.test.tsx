/**
 * Behavior under test (plan 05-02 Task 3, D-80/D-82/D-88/D-96):
 * - The tray renders one row per pending proposal, with its title.
 * - A pending row renders no key-shaped text — D-96 allocates the project key at acceptance, so a
 *   staged proposal has none yet.
 * - Three synchronous clicks on Accept issue exactly one `authoring_proposal_accept` call (the
 *   sixth sibling of this codebase's own ackActingRef/answeringRef synchronous-guard pattern).
 * - `SessionSurface` mounts the tray ONLY when the run carries an `authoringStage`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalTray } from "../ProposalTray";
import { SessionSurface } from "../../session/SessionSurface";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  authoringProposalsForRun: (agentRunId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_for_run", { agentRunId, limit }),
  acceptAuthoringProposal: (proposalId: string) =>
    invokeCommandMock("authoring_proposal_accept", { proposalId }),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  // SessionSurface's own dependencies, for the "renders nothing without authoringStage" test.
  agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
  agentRunRawWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_raw_window", { agentRunId, offset, limit }),
  stopAgentRun: (agentRunId: string) => invokeCommandMock("agent_run_stop", { agentRunId }),
  discardSession: (agentRunId: string) => invokeCommandMock("agent_run_discard", { agentRunId }),
  pendingPermissionRequests: () => Promise.resolve([]),
  answerPermissionRequest: () => Promise.resolve(undefined),
}));

afterEach(() => {
  invokeCommandMock.mockReset();
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
    payload: { kind: "task", title: "Write the onboarding doc" },
    status: "pending",
    createdBy: "actor-agent",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("ProposalTray", () => {
  it("renders one row per pending proposal, with its title", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([
          makeProposal({ id: "prop-1", payload: { kind: "task", title: "Write the onboarding doc" } }),
          makeProposal({ id: "prop-2", payload: { kind: "task", title: "Add CSV export" } }),
        ]);
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<ProposalTray agentRunId="run-1" />);

    await waitFor(() => expect(screen.getByText("Write the onboarding doc")).toBeInTheDocument());
    expect(screen.getByText("Add CSV export")).toBeInTheDocument();
    expect(screen.getByText("2 pending proposals")).toBeInTheDocument();
  });

  it("a pending row renders no project-key-shaped text (D-96: the key is allocated only at acceptance)", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([makeProposal()]);
      }
      return Promise.resolve(undefined);
    });

    const { container } = renderWithClient(<ProposalTray agentRunId="run-1" />);

    await waitFor(() => expect(screen.getByText("Write the onboarding doc")).toBeInTheDocument());
    // A project key is `<PREFIX>-<number>` (D-10) — assert no such shape appears anywhere in the
    // rendered row, not merely that a specific literal key is absent.
    expect(container.textContent).not.toMatch(/\b[A-Z]{2,10}-\d+\b/);
  });

  it("three synchronous clicks on Accept issue exactly one authoring_proposal_accept call", async () => {
    let resolveAccept: (() => void) | undefined;
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([makeProposal()]);
      }
      if (command === "authoring_proposal_accept") {
        return new Promise<void>((resolve) => {
          resolveAccept = resolve;
        });
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<ProposalTray agentRunId="run-1" />);

    const acceptButton = await screen.findByRole("button", { name: "Accept" });
    acceptButton.click();
    acceptButton.click();
    acceptButton.click();

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_proposal_accept", { proposalId: "prop-1" }),
    );
    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_proposal_accept"),
    ).toHaveLength(1);
    resolveAccept?.();
  });

  it("renders nothing (zero rows, zero-pending heading) when the run has no pending proposals", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderWithClient(<ProposalTray agentRunId="run-1" />);

    await waitFor(() => expect(screen.getByText("0 pending proposals")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
  });
});

describe("SessionSurface mounts ProposalTray only when the run carries an authoringStage", () => {
  function mockSessionSurfaceReads() {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
  }

  it("does not render the tray region when authoringStage is absent", async () => {
    mockSessionSurfaceReads();
    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} />);

    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("agent_run_log_window", expect.anything()));
    expect(screen.queryByRole("region", { name: "Staged proposals" })).not.toBeInTheDocument();
  });

  it("renders the tray region when authoringStage is present", async () => {
    mockSessionSurfaceReads();
    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Staged proposals" })).toBeInTheDocument());
  });
});
