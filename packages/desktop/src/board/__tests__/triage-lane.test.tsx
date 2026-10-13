/**
 * Behavior under test (plan 05-08 Task 2, D-82/D-92/D-95/D-96):
 * - The lane renders one row per pending proposal, and drafted criteria nest under their task.
 * - The header count matches the row count and stays visible when the lane is collapsed.
 * - A proposal for a not-yet-existing epic (`epicId: null`, D-84's fresh-epic session) renders
 *   with a "a new epic" label rather than blank or an internal id.
 * - Each group names its originating run and offers a route into it (`onOpenSession`).
 * - Per-row accept and reject call the shared mutation hooks (the same command names the tray
 *   uses — `authoring_proposal_accept`/`authoring_proposal_reject`).
 * - The lane header offers no accept/reject/amend/decision control (D-95, SHAPE-04).
 * - A proposal belonging to a run that has already reached a terminal status still renders with
 *   its actions enabled (plan 05-08 Task 3(b), D-82/D-83: staging outlives the session).
 * - The lane renders nothing at all (not an empty shell) when there are no pending proposals.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TriageLane } from "../TriageLane";
import { useCollapseStore } from "../collapseStore";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  authoringProposalsPending: (projectId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_pending", { projectId, limit }),
  acceptAuthoringProposal: (proposalId: string) =>
    invokeCommandMock("authoring_proposal_accept", { proposalId }),
  rejectAuthoringProposal: (proposalId: string, reason?: string) =>
    invokeCommandMock("authoring_proposal_reject", { proposalId, reason }),
  acceptAuthoringSubtree: (rootProposalId: string) =>
    invokeCommandMock("authoring_subtree_accept", { rootProposalId }),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

afterEach(() => {
  invokeCommandMock.mockReset();
  // `collapseStore` is a module-level Zustand singleton (never remounted between tests) — reset
  // its collapsed-by-project map so one test's collapse toggle can never leak into the next.
  useCollapseStore.setState({ collapsedByProject: {} });
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

function mockPendingWindow(proposals: ReturnType<typeof makeProposal>[]) {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "authoring_proposals_pending") {
      return Promise.resolve({
        proposals,
        counts: {
          pending: proposals.length,
          accepted: 0,
          rejected: 0,
        },
      });
    }
    return Promise.resolve(undefined);
  });
}

describe("TriageLane", () => {
  it("renders one row per pending proposal, and nests a drafted criterion under its task", async () => {
    mockPendingWindow([
      makeProposal({ id: "task-1", payload: { kind: "task", title: "Write the onboarding doc" } }),
      makeProposal({
        id: "criterion-1",
        parentProposalId: "task-1",
        targetType: "criterion",
        payload: { kind: "criterion", statement: "Docs cover the login flow", verification_hint: "Read them" },
      }),
    ]);

    renderWithClient(<TriageLane projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Write the onboarding doc")).toBeInTheDocument());
    expect(screen.getByText("Docs cover the login flow")).toBeInTheDocument();
    expect(screen.getByText("Read them")).toBeInTheDocument();
  });

  it("the header count matches the row count and survives collapsing", async () => {
    mockPendingWindow([
      makeProposal({ id: "task-1", payload: { kind: "task", title: "First proposed task" } }),
      makeProposal({ id: "task-2", payload: { kind: "task", title: "Second proposed task" } }),
    ]);

    renderWithClient(<TriageLane projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("First proposed task")).toBeInTheDocument());
    const region = screen.getByRole("region", { name: "Proposals" });
    const header = within(region).getByRole("button", { name: /Proposals/ });
    expect(within(header).getByText("2")).toBeInTheDocument();

    fireEvent.click(header);

    expect(screen.queryByText("First proposed task")).not.toBeInTheDocument();
    expect(within(header).getByText("2")).toBeInTheDocument();
  });

  it('a proposal for a not-yet-existing epic renders with a "a new epic" label', async () => {
    mockPendingWindow([
      makeProposal({ id: "task-1", epicId: null, payload: { kind: "task", title: "An unhomed task" } }),
    ]);

    renderWithClient(<TriageLane projectId="proj-1" epicsById={{}} />);

    await waitFor(() => expect(screen.getByText("An unhomed task")).toBeInTheDocument());
    expect(screen.getByText("For a new epic")).toBeInTheDocument();
  });

  it("names an existing epic when the proposal targets a reopened one", async () => {
    mockPendingWindow([
      makeProposal({ id: "task-1", epicId: "epic-1", payload: { kind: "task", title: "A task under a real epic" } }),
    ]);

    renderWithClient(
      <TriageLane
        projectId="proj-1"
        epicsById={{ "epic-1": { id: "epic-1", key: "FLY-1", title: "Real epic" } }}
      />,
    );

    await waitFor(() => expect(screen.getByText("A task under a real epic")).toBeInTheDocument());
    expect(screen.getByText(/FLY-1 Real epic/)).toBeInTheDocument();
    expect(screen.queryByText(/a new epic/)).not.toBeInTheDocument();
  });

  it("each row names its originating run and offers a route into it", async () => {
    mockPendingWindow([
      makeProposal({ id: "task-1", agentRunId: "run-abc12345", payload: { kind: "task", title: "Routed task" } }),
    ]);
    const onOpenSession = vi.fn();

    renderWithClient(<TriageLane projectId="proj-1" onOpenSession={onOpenSession} />);

    await waitFor(() => expect(screen.getByText("Routed task")).toBeInTheDocument());
    const routeButton = screen.getByText(/From session/);
    fireEvent.click(routeButton);

    expect(onOpenSession).toHaveBeenCalledWith("run-abc12345", null);
  });

  it("per-row accept calls authoring_proposal_accept, and reject calls authoring_proposal_reject", async () => {
    mockPendingWindow([
      makeProposal({ id: "task-1", payload: { kind: "task", title: "Acceptable task" } }),
    ]);

    renderWithClient(<TriageLane projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Acceptable task")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_proposal_accept", { proposalId: "task-1" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "authoring_proposal_reject",
        expect.objectContaining({ proposalId: "task-1" }),
      ),
    );
  });

  it("the lane header offers no accept, reject or amend control", async () => {
    mockPendingWindow([
      makeProposal({ id: "task-1", payload: { kind: "task", title: "Some proposed task" } }),
    ]);

    renderWithClient(<TriageLane projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Some proposed task")).toBeInTheDocument());
    const region = screen.getByRole("region", { name: "Proposals" });
    const header = within(region).getByRole("button", { name: /Proposals/ });
    expect(within(header).queryByText("Accept")).not.toBeInTheDocument();
    expect(within(header).queryByText("Reject")).not.toBeInTheDocument();
    expect(within(header).queryByText("Amend")).not.toBeInTheDocument();
  });

  it("renders a proposal belonging to a terminal run with its actions enabled (D-82/D-83: staging outlives the session)", async () => {
    // The lane's own read (`query::authoring::list_pending_proposals`) is scoped to proposal
    // status, never run status — a proposal from a run that has already reached `completed`/
    // `failed`/`interrupted`/`abandoned` is indistinguishable, on the wire, from one whose run is
    // still `running`. This is the React half of the property `authoring_proposal.rs`'s own
    // `a_pending_proposal_survives_its_run_reaching_*` tests prove on the Rust side: the row
    // renders exactly the same, with accept/reject enabled, regardless of what became of the
    // session that produced it.
    mockPendingWindow([
      makeProposal({
        id: "task-1",
        agentRunId: "run-ended",
        payload: { kind: "task", title: "Left behind by an ended session" },
      }),
    ]);

    renderWithClient(<TriageLane projectId="proj-1" />);

    await waitFor(() => expect(screen.getByText("Left behind by an ended session")).toBeInTheDocument());
    const acceptButton = screen.getByRole("button", { name: "Accept" });
    const rejectButton = screen.getByRole("button", { name: "Reject" });
    expect(acceptButton).toBeEnabled();
    expect(rejectButton).toBeEnabled();

    fireEvent.click(acceptButton);
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_proposal_accept", { proposalId: "task-1" }),
    );
  });

  it("renders nothing at all when there are no pending proposals", async () => {
    mockPendingWindow([]);

    const { container } = renderWithClient(<TriageLane projectId="proj-1" />);

    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("authoring_proposals_pending", expect.anything()));
    expect(screen.queryByRole("region", { name: "Proposals" })).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });
});
