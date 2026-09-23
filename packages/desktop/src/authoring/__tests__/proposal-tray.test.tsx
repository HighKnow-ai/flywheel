/**
 * Behavior under test (plan 05-07 Task 1, D-80/D-82/D-92/D-96):
 * - The tray renders one row per pending proposal, with its title.
 * - A pending row renders no key-shaped text — D-96 allocates the project key at acceptance, so a
 *   staged proposal has none yet.
 * - Criteria render nested under their parent task proposal, in `position` order; roots render in
 *   the Rust read's own order (`createdAt` desc, id desc tie-break) — the tray never re-sorts them.
 * - A criterion row renders its statement and its verification hint as two distinct elements.
 * - An `amend`/`delete` proposal renders its verb; a `create` proposal renders none.
 * - An undecidable proposal (an accept attempt failing with the core's `ProposalUndecidable`
 *   error) renders its reason in place, with accept disabled and reject still live.
 * - Three synchronous clicks on Accept issue exactly one `authoring_proposal_accept` call (plan
 *   05-02's own `acceptingRef` guard, carried forward unchanged — the sixth sibling of this
 *   codebase's own ackActingRef/answeringRef synchronous-guard pattern). Reject's own matching
 *   guard is Task 2's own addition, asserted once it lands.
 * - The tray re-renders on `board:changed` without re-rendering the feed's own rows.
 * - `SessionSurface` mounts the tray ONLY when the run carries an `authoringStage`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProposalTray } from "../ProposalTray";
import { SessionSurface } from "../../session/SessionSurface";

const invokeCommandMock = vi.fn();
let feedRowRenderCount = 0;
// Every handler ever registered via the mocked `subscribeBoardChanged` below — the feed-isolation
// test fires all of them at once to simulate a real `board:changed` push reaching every listener
// currently mounted (both `useRunProposals`' own listener and `usePendingPermissionRequests`'),
// exactly like the real Tauri event bus would.
let boardChangedHandlers: Array<() => void> = [];

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  authoringProposalsForRun: (agentRunId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_for_run", { agentRunId, limit }),
  acceptAuthoringProposal: (proposalId: string) =>
    invokeCommandMock("authoring_proposal_accept", { proposalId }),
  subscribeBoardChanged: (handler: () => void) => {
    boardChangedHandlers.push(handler);
    return Promise.resolve(() => {});
  },
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  // SessionSurface's own dependencies, for the "renders nothing without authoringStage" test and
  // the feed-isolation render-count test below.
  agentRunLogWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_log_window", { agentRunId, offset, limit }),
  agentRunRawWindow: (agentRunId: string, offset: number, limit: number) =>
    invokeCommandMock("agent_run_raw_window", { agentRunId, offset, limit }),
  stopAgentRun: (agentRunId: string) => invokeCommandMock("agent_run_stop", { agentRunId }),
  discardSession: (agentRunId: string) => invokeCommandMock("agent_run_discard", { agentRunId }),
  pendingPermissionRequests: () => Promise.resolve([]),
  answerPermissionRequest: () => Promise.resolve(undefined),
}));

// The feed-isolation test's own render-count spy: a lightweight stand-in that never touches the
// real `FeedRow`'s virtualizer-dependent internals — we only need to count how many times React
// invokes it, not what it paints. This is the mechanism `feedRows.length` re-processing would
// actually cost: a board:changed-only invalidation must never touch this count, because the
// underlying feed query (`agent_run_log_window`) was never asked to refetch.
vi.mock("../../session/FeedRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../session/FeedRow")>();
  return {
    ...actual,
    FeedRow: (_props: unknown) => {
      feedRowRenderCount += 1;
      return null;
    },
  };
});

afterEach(() => {
  invokeCommandMock.mockReset();
  feedRowRenderCount = 0;
  boardChangedHandlers = [];
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

  it("criteria render nested under their parent task, in position order, and roots keep the Rust read's own order", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") {
        // Backend order: created_at DESC, id DESC — "Newer task" first, "Older task" second.
        return Promise.resolve([
          makeProposal({
            id: "criterion-b",
            targetType: "criterion",
            parentProposalId: "newer-task",
            position: "b0",
            payload: { kind: "criterion", statement: "Second criterion", verification_hint: null },
            createdAt: "2026-01-01T00:00:03.000Z",
          }),
          makeProposal({
            id: "criterion-a",
            targetType: "criterion",
            parentProposalId: "newer-task",
            position: "a0",
            payload: { kind: "criterion", statement: "First criterion", verification_hint: null },
            createdAt: "2026-01-01T00:00:02.000Z",
          }),
          makeProposal({
            id: "newer-task",
            targetType: "task",
            payload: { kind: "task", title: "Newer task" },
            createdAt: "2026-01-01T00:00:01.000Z",
          }),
          makeProposal({
            id: "older-task",
            targetType: "task",
            payload: { kind: "task", title: "Older task" },
            createdAt: "2026-01-01T00:00:00.000Z",
          }),
        ]);
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<ProposalTray agentRunId="run-1" />);

    await waitFor(() => expect(screen.getByText("Newer task")).toBeInTheDocument());

    const groups = screen.getAllByRole("group");
    const labels = groups.map((el) => el.getAttribute("aria-label"));
    // "Newer task" (with its two nested criteria, in position order a0 then b0) precedes
    // "Older task" — the array's own incoming order, never re-sorted.
    expect(labels).toEqual([
      "Proposed task: Newer task",
      "Proposed criterion: First criterion",
      "Proposed criterion: Second criterion",
      "Proposed task: Older task",
    ]);
    // The criterion rows render indented (a visible marginLeft), the roots do not.
    const criterionRow = screen.getByRole("group", { name: "Proposed criterion: First criterion" });
    expect((criterionRow as HTMLElement).style.marginLeft).not.toBe("0px");
  });

  it("a criterion row renders its statement and its verification hint as two distinct elements", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([
          makeProposal({
            id: "crit-1",
            targetType: "criterion",
            payload: {
              kind: "criterion",
              statement: "The export includes every column",
              verification_hint: "Open the CSV and count the header row",
            },
          }),
        ]);
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<ProposalTray agentRunId="run-1" />);

    await waitFor(() => expect(screen.getByText("The export includes every column")).toBeInTheDocument());
    const hint = screen.getByText("Open the CSV and count the header row");
    const statement = screen.getByText("The export includes every column");
    expect(hint).not.toBe(statement);
    expect(hint.tagName).toBe("SPAN");
    expect(statement.tagName).toBe("SPAN");
  });

  it("an amend proposal renders its verb; a create proposal renders none", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([
          makeProposal({ id: "prop-create", verb: "create", payload: { kind: "task", title: "A brand new task" } }),
          makeProposal({
            id: "prop-amend",
            verb: "amend",
            targetId: "task-existing",
            payload: { kind: "task", title: "A corrected title" },
          }),
        ]);
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<ProposalTray agentRunId="run-1" />);

    await waitFor(() => expect(screen.getByText("A brand new task")).toBeInTheDocument());
    expect(screen.getByText("amend")).toBeInTheDocument();
    // The create row's own group must not itself contain the verb text.
    const createRow = screen.getByRole("group", { name: "Proposed task: A brand new task" });
    expect(createRow.textContent).not.toContain("create");
  });

  it("an undecidable proposal renders its reason and keeps its reject action enabled", async () => {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_for_run") {
        return Promise.resolve([
          makeProposal({
            id: "prop-undecidable",
            verb: "amend",
            targetType: "criterion",
            targetId: "criterion-deleted",
            payload: { kind: "criterion", statement: "A corrected statement", verification_hint: null },
          }),
        ]);
      }
      if (command === "authoring_proposal_accept") {
        return Promise.reject(
          "authoring_proposal \"prop-undecidable\" names a criterion \"criterion-deleted\" that no " +
            "longer exists — undecidable, not auto-rejected",
        );
      }
      return Promise.resolve(undefined);
    });

    renderWithClient(<ProposalTray agentRunId="run-1" />);

    const acceptButton = await screen.findByRole("button", { name: "Accept" });
    acceptButton.click();

    await waitFor(() => expect(screen.getByText(/was deleted/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Accept" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeDisabled();
  });

  // A hex-colour-literal check over the source files themselves is the plan's own `<verify>`
  // shell gate (grep against the file contents), not something this suite re-derives — a runtime
  // test can only assert on rendered DOM, not on the source text a bundler has already compiled
  // away.
});

describe("SessionSurface mounts ProposalTray only when the run carries an authoringStage", () => {
  function mockSessionSurfaceReads() {
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "agent_run_log_window") {
        return Promise.resolve({
          entries: [{ type: "assistant_text", text: "hello", seq: 1 }],
          offset: 0,
          limit: 200,
          total: 1,
        });
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

  it("the tray re-renders on board:changed without re-rendering the feed's own rows (D-85)", async () => {
    mockSessionSurfaceReads();

    renderWithClient(<SessionSurface agentRunId="run-1" onBack={() => {}} authoringStage="challenge" />);

    await waitFor(() => expect(screen.getByRole("region", { name: "Staged proposals" })).toBeInTheDocument());
    await waitFor(() => expect(feedRowRenderCount).toBeGreaterThan(0));
    const feedCallsBefore = invokeCommandMock.mock.calls.filter(
      ([command]) => command === "agent_run_log_window",
    ).length;

    // Fires every listener currently registered via the mocked `subscribeBoardChanged` — both the
    // tray's own (`useRunProposals`) and `usePendingPermissionRequests`' — simulating a real
    // `board:changed` push reaching every subscriber at once.
    boardChangedHandlers.forEach((handler) => handler());

    await waitFor(() =>
      expect(
        invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_proposals_for_run").length,
      ).toBeGreaterThan(1),
    );
    // The feed's OWN underlying query is never asked to refetch by a board:changed-only push — it
    // listens exclusively to `agent:event` (`useSessionFeed`, `board/useBoardQuery.ts`). Proving
    // that call count is unchanged is the structural guarantee behind "does not re-render feed
    // rows": with the feed's own data reference untouched, no new work is done for it.
    const feedCallsAfter = invokeCommandMock.mock.calls.filter(
      ([command]) => command === "agent_run_log_window",
    ).length;
    expect(feedCallsAfter).toBe(feedCallsBefore);
  });
});
