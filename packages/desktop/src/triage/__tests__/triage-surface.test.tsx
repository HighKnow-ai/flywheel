/**
 * Behavior under test (plan 06-07 Task 3, D-99/D-101/D-102/D-104, PROP-04/05/06/07):
 * - Three pending proposals render as three rows, each showing its rationale and its run
 *   provenance.
 * - A row carrying a duplicate candidate renders the annotation with the candidate's title, and
 *   the row is still present and still decidable (Accept/Reject stay enabled).
 * - Choosing merge opens the target picker and calls no mutation until a target is chosen.
 * - Choosing defer calls the defer mutation once, even under two synchronous activations.
 * - An empty pending window renders an explicit empty state; no verb is actionable.
 * - An empty selection leaves both bulk controls disabled and activating them issues no call.
 * - Two selected rows and "Reject selected" call the bulk-reject mutation once with both ids.
 * - The deferred filter switches the list to the deferred window, and defer is inert there.
 * - A limit notice renders when the notices hook returns one, naming the refused count.
 * - A row whose turn pointer is zero still renders the jump control and calls back with offset 0.
 * - No rendered control/label/accessible name on the surface offers accepting more than one
 *   proposal.
 *
 * `06-RESEARCH.md`/`06-VALIDATION.md` both record that no frontend test harness exists in this
 * repository. That is incorrect (this task supersedes it): `packages/desktop/package.json`
 * declares `"test": "vitest run"`, `vitest.config.ts` configures jsdom with a setup file, and 38
 * `*.test.ts`/`*.test.tsx` files already ship — this file is the 39th, exercised by the same
 * harness `board/__tests__/triage-lane.test.tsx` and `authoring/__tests__/proposal-tray.test.tsx`
 * already use. `TriageSurface`'s logic is validated at the component level here; the only thing
 * left to a human is visual judgement of the layout (see this plan's own `<human-check>`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TriageSurface } from "../TriageSurface";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  authoringProposalsPending: (projectId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_pending", { projectId, limit }),
  authoringProposalsDeferred: (projectId: string, limit?: number) =>
    invokeCommandMock("authoring_proposals_deferred", { projectId, limit }),
  authoringProposalLimitNotices: (projectId: string, limit?: number) =>
    invokeCommandMock("authoring_proposal_limit_notices", { projectId, limit }),
  acceptAuthoringProposal: (proposalId: string) =>
    invokeCommandMock("authoring_proposal_accept", { proposalId }),
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
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

afterEach(() => {
  invokeCommandMock.mockReset();
});

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

function countsFor(proposals: unknown[]) {
  return { pending: proposals.length, accepted: 0, rejected: 0, merged: 0, deferred: 0 };
}

function makeProposal(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "prop-1",
    agentRunId: "run-abc12345",
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
    rationale: "The onboarding doc is missing entirely.",
    originLogOffset: null,
    duplicateOf: null,
    duplicateScore: null,
    duplicateCandidate: null,
    ...overrides,
  };
}

interface MockWindows {
  pending?: ReturnType<typeof makeProposal>[];
  deferred?: ReturnType<typeof makeProposal>[];
  limitNotices?: Array<{
    agentRunId: string;
    taskId: string | null;
    limit: number;
    refusedCount: number;
    firstRefusedAt: string;
    lastRefusedAt: string;
  }>;
}

function setupMocks({ pending = [], deferred = [], limitNotices = [] }: MockWindows) {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "authoring_proposals_pending") {
      return Promise.resolve({ proposals: pending, counts: countsFor(pending) });
    }
    if (command === "authoring_proposals_deferred") {
      return Promise.resolve({ proposals: deferred, counts: countsFor(deferred) });
    }
    if (command === "authoring_proposal_limit_notices") return Promise.resolve(limitNotices);
    if (command === "board_list") {
      return Promise.resolve({
        items: [],
        issues: [],
        counts: { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 },
      });
    }
    return Promise.resolve(undefined);
  });
}

function renderSurface(onOpenSession = vi.fn(), onClose = vi.fn()) {
  return renderWithClient(
    <TriageSurface projectId="proj-1" epicsById={{ "epic-1": { id: "epic-1", key: "FLY-1", title: "Real epic" } }} onOpenSession={onOpenSession} onClose={onClose} />,
  );
}

describe("TriageSurface", () => {
  it("renders three rows for three pending proposals, each showing its rationale and its run provenance", async () => {
    setupMocks({
      pending: [
        makeProposal({ id: "p1", agentRunId: "run-11111111", payload: { kind: "task", title: "Task one" }, rationale: "Reason one" }),
        makeProposal({ id: "p2", agentRunId: "run-22222222", payload: { kind: "task", title: "Task two" }, rationale: "Reason two" }),
        makeProposal({ id: "p3", agentRunId: "run-33333333", payload: { kind: "task", title: "Task three" }, rationale: "Reason three" }),
      ],
    });

    renderSurface();

    await waitFor(() => expect(screen.getByText("Task one")).toBeInTheDocument());
    expect(screen.getByText("Task two")).toBeInTheDocument();
    expect(screen.getByText("Task three")).toBeInTheDocument();
    expect(screen.getByText("Reason one")).toBeInTheDocument();
    expect(screen.getByText("Reason two")).toBeInTheDocument();
    expect(screen.getByText("Reason three")).toBeInTheDocument();
    expect(screen.getByText("From session run-1111")).toBeInTheDocument();
  });

  it("a row carrying a duplicate candidate renders the annotation with the candidate's title, and stays decidable", async () => {
    setupMocks({
      pending: [
        makeProposal({
          duplicateOf: "task-existing",
          duplicateCandidate: { kind: "task", key: "FLY-9", title: "An existing near-duplicate task" },
        }),
      ],
    });

    renderSurface();

    await waitFor(() => expect(screen.getByText(/An existing near-duplicate task/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Accept" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).not.toBeDisabled();
  });

  it("choosing merge opens the target picker and calls no mutation until a target is chosen", async () => {
    setupMocks({ pending: [makeProposal({ epicId: "epic-1" })] });

    renderSurface();

    const mergeButton = await screen.findByRole("button", { name: "Merge" });
    fireEvent.click(mergeButton);

    const picker = await screen.findByRole("group", { name: "Choose a merge target" });
    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_proposal_merge"),
    ).toHaveLength(0);

    const targetButton = within(picker).getByRole("button", { name: /FLY-1 Real epic/ });
    fireEvent.click(targetButton);

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_proposal_merge", {
        proposalId: "prop-1",
        targetKind: "epic",
        targetId: "epic-1",
      }),
    );
  });

  it("choosing defer calls the defer mutation once, even under two synchronous activations", async () => {
    setupMocks({ pending: [makeProposal()] });
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "authoring_proposals_pending") {
        return Promise.resolve({ proposals: [makeProposal()], counts: countsFor([makeProposal()]) });
      }
      if (command === "authoring_proposals_deferred") return Promise.resolve({ proposals: [], counts: countsFor([]) });
      if (command === "authoring_proposal_limit_notices") return Promise.resolve([]);
      if (command === "board_list") {
        return Promise.resolve({ items: [], issues: [], counts: { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 } });
      }
      if (command === "authoring_proposal_defer") return new Promise(() => {});
      return Promise.resolve(undefined);
    });

    renderSurface();

    const deferButton = await screen.findByRole("button", { name: "Defer" });
    fireEvent.click(deferButton);
    fireEvent.click(deferButton);

    await waitFor(() =>
      expect(
        invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_proposal_defer"),
      ).toHaveLength(1),
    );
  });

  it("an empty pending window renders an explicit empty state, and no verb is actionable", async () => {
    setupMocks({ pending: [] });

    renderSurface();

    await waitFor(() => expect(screen.getByText("Nothing pending — the queue is clear.")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
  });

  it("an empty selection leaves both bulk controls disabled and activating them issues no call", async () => {
    setupMocks({ pending: [makeProposal()] });

    renderSurface();

    await waitFor(() => expect(screen.getByText("Write the onboarding doc")).toBeInTheDocument());
    const rejectSelected = screen.getByRole("button", { name: "Reject selected" });
    const deferSelected = screen.getByRole("button", { name: "Defer selected" });
    expect(rejectSelected).toBeDisabled();
    expect(deferSelected).toBeDisabled();

    fireEvent.click(rejectSelected);
    fireEvent.click(deferSelected);

    expect(
      invokeCommandMock.mock.calls.filter(([command]) =>
        ["authoring_proposals_reject_bulk", "authoring_proposals_defer_bulk"].includes(command),
      ),
    ).toHaveLength(0);
  });

  it("two selected rows and Reject selected call the bulk-reject mutation once with both ids", async () => {
    setupMocks({
      pending: [
        makeProposal({ id: "p1", payload: { kind: "task", title: "First task" } }),
        makeProposal({ id: "p2", payload: { kind: "task", title: "Second task" } }),
      ],
    });

    renderSurface();

    await waitFor(() => expect(screen.getByText("First task")).toBeInTheDocument());
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(2);
    fireEvent.click(checkboxes[0]);
    fireEvent.click(checkboxes[1]);

    const rejectSelected = screen.getByRole("button", { name: "Reject selected" });
    expect(rejectSelected).not.toBeDisabled();
    fireEvent.click(rejectSelected);

    await waitFor(() =>
      expect(invokeCommandMock).toHaveBeenCalledWith("authoring_proposals_reject_bulk", {
        proposalIds: expect.arrayContaining(["p1", "p2"]),
        reason: undefined,
      }),
    );
    expect(
      invokeCommandMock.mock.calls.filter(([command]) => command === "authoring_proposals_reject_bulk"),
    ).toHaveLength(1);
  });

  it("the deferred filter switches the list to the deferred window, and defer is inert there", async () => {
    setupMocks({
      pending: [makeProposal({ id: "p1", payload: { kind: "task", title: "Pending task" } })],
      deferred: [makeProposal({ id: "p2", payload: { kind: "task", title: "Deferred task" } })],
    });

    renderSurface();

    await waitFor(() => expect(screen.getByText("Pending task")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Deferred" }));

    await waitFor(() => expect(screen.getByText("Deferred task")).toBeInTheDocument());
    expect(screen.queryByText("Pending task")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Defer" })).not.toBeInTheDocument();
  });

  it("a limit notice renders when the notices hook returns one, naming the refused count", async () => {
    setupMocks({
      pending: [],
      limitNotices: [
        {
          agentRunId: "run-99999999",
          taskId: null,
          limit: 10,
          refusedCount: 3,
          firstRefusedAt: "2026-01-01T00:00:00.000Z",
          lastRefusedAt: "2026-01-01T00:05:00.000Z",
        },
      ],
    });

    renderSurface();

    await waitFor(() => expect(screen.getByText(/could not stage 3 more/)).toBeInTheDocument());
    expect(screen.getByText(/run-9999/)).toBeInTheDocument();
  });

  it("a row whose turn pointer is zero still renders the jump control and calls back with offset zero", async () => {
    const onOpenSession = vi.fn();
    setupMocks({
      pending: [makeProposal({ agentRunId: "run-zero123", epicId: "epic-1", originLogOffset: 0 })],
    });

    renderSurface(onOpenSession);

    const jumpButton = await screen.findByRole("button", { name: "Jump to the turn that produced this proposal" });
    fireEvent.click(jumpButton);

    expect(onOpenSession).toHaveBeenCalledWith("run-zero123", "epic-1", 0);
  });

  it("no rendered control, label or accessible name on the surface offers accepting more than one proposal", async () => {
    setupMocks({
      pending: [
        makeProposal({ id: "p1", payload: { kind: "task", title: "First task" } }),
        makeProposal({ id: "p2", payload: { kind: "task", title: "Second task" } }),
      ],
    });

    renderSurface();

    await waitFor(() => expect(screen.getByText("First task")).toBeInTheDocument());
    const buttons = screen.getAllByRole("button");
    const accessibleNames = buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");
    const acceptManyPattern = /accept.*(all|many|remaining|selected)/i;
    expect(accessibleNames.some((name) => acceptManyPattern.test(name))).toBe(false);
  });
});
