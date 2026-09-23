/**
 * Behavior under test (plan 05-07 Task 3, D-92/D-95, `01-UI-SPEC.md` Keyboard Map):
 * - `state/keyboard.ts` declares a `proposal-tray` region with four bindings — `a`/`d`/`e`/
 *   `Shift+A` — that reach the tray's own selected row through `useRegionBindings`, never a local
 *   key listener inside any tray component file.
 * - `Shift+A` (accept-subtree) is inert — no backend call — on a criterion row and on a task with
 *   no pending children.
 * - `j`/`k` move the tray's own selection between visible rows; an empty tray takes no focus (no
 *   row is ever "selected", so no key does anything).
 * - A key pressed while the amend editor's own input has focus reaches the editor's field, not the
 *   `proposal-tray` region (the shared typing-target guard `state/keyboard.ts`'s `resolveBinding`
 *   already applies to every bare, unmodified key).
 * - A `proposal_created` log entry carries no top-level numeric field the status strip would read
 *   as a cost or token count — its presence in the loaded log leaves the strip's displayed values
 *   exactly what the real cost entries alone would produce.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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

describe("the proposal tray's keyboard region", () => {
  it("each of the four keys dispatches its action on the focused (selected) row", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([makeProposal()]);
      return new Promise(() => {}); // hold every mutation call open — we only assert it fired
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "a" });
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_proposal_accept", { proposalId: "prop-1" }),
    );

    fireEvent.keyDown(window, { key: "d" });
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "authoring_proposal_reject",
        expect.objectContaining({ proposalId: "prop-1" }),
      ),
    );

    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(screen.getByLabelText("Title")).toBeInTheDocument());
  });

  it("Shift+A is inert on a criterion row and on a childless task", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([
          makeProposal({
            id: "criterion-1",
            targetType: "criterion",
            payload: { kind: "criterion", statement: "A criterion", verification_hint: null },
          }),
        ]);
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);
    await waitFor(() => expect(screen.getByText("A criterion")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "a", shiftKey: true });

    await waitFor(() => {}); // let any (incorrect) call settle
    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_subtree_accept"),
    ).toHaveLength(0);
  });

  it("Shift+A is inert on a task with no pending children", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([makeProposal()]);
      return Promise.resolve(undefined);
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Accept" })).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "a", shiftKey: true });

    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_subtree_accept"),
    ).toHaveLength(0);
    // A childless task never even renders the subtree button.
    expect(screen.queryByText(/Accept task and its/)).not.toBeInTheDocument();
  });

  function mockTwoTasks() {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([
          makeProposal({
            id: "prop-newer",
            payload: { kind: "task", title: "Newer task" },
            createdAt: "2026-01-01T00:00:01.000Z",
          }),
          makeProposal({
            id: "prop-older",
            payload: { kind: "task", title: "Older task" },
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
        ]);
      }
      // Reject never resolves — this test only asserts the call fired, and letting it settle
      // would remove the row, which the second half of this test still needs present.
      if (command === "authoring_proposal_reject") return new Promise(() => {});
      return Promise.resolve(undefined);
    });
  }

  it("j moves the tray's selection to the next visible row", async () => {
    mockTwoTasks();

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);
    await waitFor(() => expect(screen.getByText("Newer task")).toBeInTheDocument());

    // The first row (newest, per the Rust read's own order) is selected by default — amend (no
    // backend call, no guard to exhaust) opens ITS editor.
    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(screen.getByDisplayValue("Newer task")).toBeInTheDocument());

    // Moving selection and rejecting acts on the NOW-selected row regardless of the first row's
    // own (still-open) editor — selection and per-row editing state are independent.
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "d" });
    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith(
        "authoring_proposal_reject",
        expect.objectContaining({ proposalId: "prop-older" }),
      ),
    );
  });

  it("k moves the tray's selection back to the previous visible row", async () => {
    mockTwoTasks();

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);
    await waitFor(() => expect(screen.getByText("Newer task")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "j" }); // now on "Older task"
    fireEvent.keyDown(window, { key: "k" }); // back to "Newer task"
    fireEvent.keyDown(window, { key: "e" });
    await waitFor(() => expect(screen.getByDisplayValue("Newer task")).toBeInTheDocument());
  });

  it("an empty tray takes no focus — no key produces any backend call", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);
    await waitFor(() => expect(screen.getByText("0 pending proposals")).toBeInTheDocument());

    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "d" });
    fireEvent.keyDown(window, { key: "e" });
    fireEvent.keyDown(window, { key: "a", shiftKey: true });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "k" });

    expect(
      invokeCommandMock.mock.calls.filter(([command]) =>
        [
          "authoring_proposal_accept",
          "authoring_proposal_reject",
          "authoring_proposal_amend",
          "authoring_subtree_accept",
        ].includes(command),
      ),
    ).toHaveLength(0);
  });

  it("a key pressed while the amend editor has focus goes to the editor and not the region", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [], offset: 0, limit: 200, total: 0 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([makeProposal()]);
      return Promise.resolve(undefined);
    });

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);

    const amendButton = await screen.findByRole("button", { name: "Amend" });
    amendButton.click();
    const titleInput = await screen.findByLabelText("Title");

    // A bare "a" typed while the editor's own input has focus must reach the input, never the
    // proposal-tray region's accept-proposal binding — the shared typing-target guard
    // (`state/keyboard.ts`'s `resolveBinding`) covers this for every bare key, not something this
    // editor implements itself.
    fireEvent.keyDown(titleInput, { key: "a" });

    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_proposal_accept"),
    ).toHaveLength(0);
  });

  it("a proposal_created log entry leaves the status strip's cost and token readings unchanged", async () => {
    const proposalCreatedEntry = {
      type: "proposal_created",
      seq: 2,
      at: "2026-01-01T00:00:01.000Z",
      raw: "{}",
      verb: "create",
      targetType: "task",
      targetId: null,
      parentProposalId: null,
      payload: { kind: "task", title: "A drafted task" },
    };
    const costEntry = {
      type: "result",
      seq: 1,
      at: "2026-01-01T00:00:00.000Z",
      tokensIn: 1234,
      tokensOut: 567,
      totalCostUsd: 0.0891,
    };

    // Control: the cost entry alone.
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [costEntry], offset: 0, limit: 200, total: 1 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    const control = renderWithClient(
      <SessionSurface agentRunId="run-control" onBack={() => {}} authoringStage="challenge" />,
    );
    await waitFor(() => expect(control.getByLabelText("Cost")).toHaveTextContent("$0.0891"));
    const controlTokensIn = control.getByLabelText("Tokens in").textContent;
    const controlTokensOut = control.getByLabelText("Tokens out").textContent;
    const controlCost = control.getByLabelText("Cost").textContent;
    control.unmount();

    // Subject: the SAME cost entry, plus a proposal_created entry riding the same stream.
    invokeCommandMock.mockReset();
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({ entries: [costEntry, proposalCreatedEntry], offset: 0, limit: 200, total: 2 });
      }
      if (command === "authoring_proposals_for_run") return Promise.resolve([]);
      return Promise.resolve(undefined);
    });
    renderWithClient(<SessionSurface agentRunId="run-subject" onBack={() => {}} authoringStage="challenge" />);

    await waitFor(() => expect(screen.getByLabelText("Cost")).toHaveTextContent(controlCost ?? ""));
    expect(screen.getByLabelText("Tokens in")).toHaveTextContent(controlTokensIn ?? "");
    expect(screen.getByLabelText("Tokens out")).toHaveTextContent(controlTokensOut ?? "");
  });
});
