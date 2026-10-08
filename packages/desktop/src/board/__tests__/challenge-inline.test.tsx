/**
 * Behavior under test (08.1-12, D-08, D-05 expand half, amendments A-01 and A-03):
 *
 * - Expanding an epic shows its open proposals (the agent's challenges) first, then its tasks, as
 *   rows of the ONE rack — one rows array, one virtualizer, the challenge height from the lookup.
 * - Accepting a challenge calls the EXISTING accept mutation with the proposal id and nothing else;
 *   the task appears and the epic's total moves through the existing `board:changed` invalidation.
 * - A failing accept leaves the challenge on the board and says so. Nothing is removed optimistically.
 * - The triage lane reads the same data through the same mutation, untouched.
 *
 * The "core" here is a small fake: it holds the proposals and the tasks, applies accept/reject to
 * them, and pushes `board:changed` the way `authoring_proposal_accept` does. Whether the real core
 * emits that event is the Rust command's own contract (commands/authoring.rs), not re-proved here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { TriageLane } from "../TriageLane";
import { ROW_HEIGHT_BY_KIND } from "../BoardRow";
import { resetUiState } from "../../state/uiStore";
import { useCollapseStore } from "../collapseStore";
import type { BandCounts, BoardItem } from "../useBoardQuery";

const invokeCommandMock = vi.fn();
let boardChangedHandlers: Array<() => void> = [];

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: (handler: () => void) => {
    boardChangedHandlers.push(handler);
    return Promise.resolve(() => {
      boardChangedHandlers = boardChangedHandlers.filter((h) => h !== handler);
    });
  },
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardEpicProgress: (projectId: string) => invokeCommandMock("board_epic_progress", { projectId }),
  boardChangeFlags: (projectId: string) => invokeCommandMock("board_change_flags", { projectId }),
  authoringProposalsPending: (projectId: string) => invokeCommandMock("authoring_proposals_pending", { projectId }),
  authoringRunForEpic: (epicId: string) => invokeCommandMock("authoring_run_for_epic", { epicId }),
  acceptAuthoringProposal: (proposalId: string) => invokeCommandMock("authoring_proposal_accept", { proposalId }),
  rejectAuthoringProposal: (proposalId: string, reason?: string) =>
    invokeCommandMock("authoring_proposal_reject", { proposalId, reason }),
  acceptAuthoringSubtree: (rootProposalId: string) =>
    invokeCommandMock("authoring_subtree_accept", { rootProposalId }),
}));

const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };
const ALPHA = { id: "epic-a", key: "FLY-1", title: "Alpha" };
const BETA = { id: "epic-b", key: "FLY-2", title: "Beta" };

interface Proposal {
  id: string;
  epicId: string | null;
  targetType: string;
  verb: string;
  title: string;
}

/** The fake core: what is pending, what the epic's tasks are, and whether accept should fail. */
let world: { proposals: Proposal[]; tasks: BoardItem[]; failAccept: boolean };

const task = (id: string, title: string, epicId = ALPHA.id): BoardItem => ({
  id,
  key: `FLY-${id.replace(/\D/g, "") || "9"}`,
  title,
  status: "todo",
  rank: id,
  priority: 0,
  epicId,
  kind: "task",
});

const proposal = (id: string, title: string, over: Partial<Proposal> = {}): Proposal => ({
  id,
  epicId: ALPHA.id,
  targetType: "task",
  verb: "create",
  title,
  ...over,
});

function pendingWindow() {
  const proposals = world.proposals.map((p, i) => ({
    id: p.id,
    agentRunId: "run-1",
    epicId: p.epicId,
    verb: p.verb,
    targetType: p.targetType,
    targetId: null,
    parentProposalId: null,
    position: String(i),
    payload: { kind: p.targetType, title: p.title },
    status: "pending",
    createdBy: "agent",
    createdAt: "2026-10-08T00:00:00Z",
    rationale: null,
    originLogOffset: null,
    duplicateOf: null,
    duplicateScore: null,
    duplicateCandidate: null,
  }));
  return { proposals, counts: { pending: proposals.length, accepted: 0, rejected: 0, merged: 0, deferred: 0 } };
}

/** `authoring_proposal_accept`'s effect: the proposal leaves, a task takes its place, the core pushes. */
function pushBoardChanged() {
  boardChangedHandlers.forEach((handler) => handler());
}

beforeEach(() => {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
  boardChangedHandlers = [];
  world = { proposals: [], tasks: [], failAccept: false };
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    switch (command) {
      case "actor_list":
        return Promise.resolve([]);
      case "epic_list_all":
        return Promise.resolve({ epics: [ALPHA, BETA], total: 2, truncated: false });
      case "board_epic_progress":
        return Promise.resolve([
          {
            epicId: ALPHA.id,
            byStatus: [{ status: "todo", count: world.tasks.length }],
            total: world.tasks.length,
            done: 0,
            agentsRunning: 0,
            agentsBlocked: 0,
            criteria: null,
          },
        ]);
      case "authoring_proposals_pending":
        return Promise.resolve(pendingWindow());
      case "board_change_flags":
        return Promise.resolve([]);
      case "authoring_run_for_epic":
        return Promise.resolve(null);
      case "board_list": {
        const filter = (args?.filter ?? {}) as { epicIds?: (string | null)[] };
        const wanted = filter.epicIds?.[0];
        return Promise.resolve({
          items: wanted === ALPHA.id ? world.tasks : [],
          issues: [],
          counts: EMPTY_COUNTS,
        });
      }
      case "authoring_proposal_accept": {
        if (world.failAccept) return Promise.reject(new Error("the core refused"));
        const id = (args as { proposalId: string }).proposalId;
        const accepted = world.proposals.find((p) => p.id === id);
        world.proposals = world.proposals.filter((p) => p.id !== id);
        if (accepted) world.tasks = [...world.tasks, task(`new-${id}`, accepted.title)];
        pushBoardChanged();
        return Promise.resolve(undefined);
      }
      case "authoring_proposal_reject": {
        const id = (args as { proposalId: string }).proposalId;
        world.proposals = world.proposals.filter((p) => p.id !== id);
        pushBoardChanged();
        return Promise.resolve(undefined);
      }
      default:
        return Promise.resolve(undefined);
    }
  });
});

afterEach(() => {
  resetUiState();
});

function renderBoard() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BoardView projectId="proj-1" items={[]} issues={[]} counts={EMPTY_COUNTS} onCreateTask={() => {}} />
    </QueryClientProvider>,
  );
}

// An empty board window opens quick-add at the head of the epic lens; it is not under test here.
const rowKeys = () =>
  Array.from(document.querySelectorAll("[data-row-key]"))
    .map((el) => el.getAttribute("data-row-key"))
    .filter((key) => key !== "quick-add");

const challengeKeys = () => rowKeys().filter((key) => key?.startsWith("challenge:"));

const rackRow = (key: string) => document.querySelector(`[data-row-key="${key}"]`) as HTMLElement | null;

async function epicRow(title = "Alpha"): Promise<HTMLElement> {
  return (await screen.findByLabelText(new RegExp(`^FLY-\\d+ ${title},`))) as HTMLElement;
}

/** Renders the board, waits for the roster and aggregate, and expands the Alpha epic. */
async function renderExpandedAlpha() {
  renderBoard();
  const row = await epicRow();
  await waitFor(() => expect(row).toHaveAccessibleName(/tasks done/));
  fireEvent.click(within(row).getByRole("button", { name: /^Expand/ }));
  return row;
}

describe("challenge rows above the epic's tasks (D-08)", () => {
  it("emits two challenge rows followed by ten task rows, in that order", async () => {
    world.proposals = [proposal("p-1", "Challenge the retry budget"), proposal("p-2", "Challenge the timeout")];
    world.tasks = Array.from({ length: 10 }, (_, i) => task(`t-${i}`, `Task ${i}`));

    await renderExpandedAlpha();

    await waitFor(() => expect(rowKeys()).toHaveLength(1 + 2 + 10 + 1)); // epic, challenges, tasks, Beta
    expect(rowKeys().slice(0, 13)).toEqual([
      "epic:epic-a",
      "challenge:p-1",
      "challenge:p-2",
      ...Array.from({ length: 10 }, (_, i) => `task:t-${i}`),
    ]);
  });

  it("emits only task rows, and no challenge element at all, for an epic with no open proposals", async () => {
    world.tasks = [task("t-0", "Task 0"), task("t-1", "Task 1")];

    await renderExpandedAlpha();

    await waitFor(() => expect(rackRow("task:t-1")).not.toBeNull());
    expect(challengeKeys()).toEqual([]);
    expect(document.querySelector("[data-challenge-id]")).toBeNull();
    expect(screen.queryByLabelText(/^Proposed /)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Accept / })).not.toBeInTheDocument();
  });

  it("gives a proposal on another epic to that epic only", async () => {
    world.proposals = [proposal("p-b", "Belongs to Beta", { epicId: BETA.id })];
    world.tasks = [task("t-0", "Task 0")];

    await renderExpandedAlpha();

    await waitFor(() => expect(rackRow("task:t-0")).not.toBeNull());
    expect(challengeKeys()).toEqual([]);
  });

  it("renders a challenge row at the challenge height from the row-kind lookup", async () => {
    world.proposals = [proposal("p-1", "Challenge the retry budget")];
    world.tasks = [task("t-0", "Task 0")];

    await renderExpandedAlpha();

    await waitFor(() => expect(rackRow("task:t-0")).not.toBeNull());
    expect(rackRow("challenge:p-1")!.style.height).toBe(`${ROW_HEIGHT_BY_KIND.challenge}px`);
    expect(rackRow("task:t-0")!.style.height).toBe(`${ROW_HEIGHT_BY_KIND.task}px`);
  });

  it("shows the challenge text with accept and reject, each named for the epic it concerns", async () => {
    world.proposals = [proposal("p-1", "Challenge the retry budget")];
    world.tasks = [task("t-0", "Task 0")];

    await renderExpandedAlpha();

    const challenge = await screen.findByLabelText(/^Proposed task on FLY-1 Alpha: Challenge the retry budget/);
    expect(within(challenge).getByText("Challenge the retry budget")).toBeInTheDocument();
    const accept = within(challenge).getByRole("button", { name: /^Accept .*Challenge the retry budget.* on FLY-1 Alpha/ });
    const reject = within(challenge).getByRole("button", { name: /^Reject .*Challenge the retry budget.* on FLY-1 Alpha/ });
    expect(accept).toHaveTextContent("Accept");
    expect(reject).toHaveTextContent("Reject");
  });

  it("keeps challenge rows in the one rack: the same rows container as the epic header, one board", async () => {
    world.proposals = [proposal("p-1", "Challenge the retry budget")];
    world.tasks = [task("t-0", "Task 0")];

    await renderExpandedAlpha();

    await waitFor(() => expect(rackRow("task:t-0")).not.toBeNull());
    expect(document.querySelectorAll(".board-view")).toHaveLength(1);
    expect(document.querySelectorAll('[role="list"]')).toHaveLength(1);
    expect(rackRow("challenge:p-1")!.parentElement).toBe(rackRow("epic:epic-a")!.parentElement);
    expect(rackRow("challenge:p-1")!.parentElement).toBe(rackRow("task:t-0")!.parentElement);
  });

  it("removes the challenge rows along with the task rows when the epic collapses", async () => {
    world.proposals = [proposal("p-1", "Challenge the retry budget")];
    world.tasks = [task("t-0", "Task 0")];

    const row = await renderExpandedAlpha();
    await waitFor(() => expect(rackRow("challenge:p-1")).not.toBeNull());

    fireEvent.click(within(row).getByRole("button", { name: /^Collapse/ }));

    await waitFor(() => expect(rackRow("challenge:p-1")).toBeNull());
    expect(rackRow("task:t-0")).toBeNull();
  });
});

describe("answering a challenge where it is read (D-08)", () => {
  const acceptCalls = () => invokeCommandMock.mock.calls.filter(([c]) => c === "authoring_proposal_accept");
  const rejectCalls = () => invokeCommandMock.mock.calls.filter(([c]) => c === "authoring_proposal_reject");

  async function challengeFor(title: string): Promise<HTMLElement> {
    return (await screen.findByLabelText(new RegExp(`^Proposed task on FLY-1 Alpha: ${title}`))) as HTMLElement;
  }

  it("calls the existing accept mutation with the proposal id and nothing else", async () => {
    world.proposals = [proposal("p-1", "Add a retry budget")];
    world.tasks = [task("t-0", "Task 0")];
    await renderExpandedAlpha();

    fireEvent.click(within(await challengeFor("Add a retry budget")).getByRole("button", { name: /^Accept / }));

    await waitFor(() => expect(acceptCalls()).toHaveLength(1));
    expect(acceptCalls()[0]).toEqual(["authoring_proposal_accept", { proposalId: "p-1" }]);
  });

  it("shows the newly created task in the epic, and removes the accepted challenge, without a reload", async () => {
    world.proposals = [proposal("p-1", "Add a retry budget")];
    world.tasks = [task("t-0", "Task 0")];
    await renderExpandedAlpha();

    fireEvent.click(within(await challengeFor("Add a retry budget")).getByRole("button", { name: /^Accept / }));

    await waitFor(() => expect(rackRow("task:new-p-1")).not.toBeNull());
    expect(within(rackRow("task:new-p-1")!).getByText("Add a retry budget")).toBeInTheDocument();
    await waitFor(() => expect(rackRow("challenge:p-1")).toBeNull());
    expect(challengeKeys()).toEqual([]);
    expect(rowKeys().indexOf("task:t-0")).toBeLessThan(rowKeys().indexOf("task:new-p-1"));
  });

  it("raises the epic's progress total by one, because the aggregate is invalidated too", async () => {
    world.proposals = [proposal("p-1", "Add a retry budget")];
    world.tasks = [task("t-0", "Task 0"), task("t-1", "Task 1"), task("t-2", "Task 2")];
    const row = await renderExpandedAlpha();
    await waitFor(() => expect(within(row).getByText("0 of 3")).toBeInTheDocument());
    const aggregateCalls = () => invokeCommandMock.mock.calls.filter(([c]) => c === "board_epic_progress").length;
    const before = aggregateCalls();

    fireEvent.click(within(await challengeFor("Add a retry budget")).getByRole("button", { name: /^Accept / }));

    await waitFor(() => expect(within(row).getByText("0 of 4")).toBeInTheDocument());
    expect(aggregateCalls()).toBeGreaterThan(before);
  });

  it("calls the existing reject mutation and removes the row without creating a task", async () => {
    world.proposals = [proposal("p-1", "Add a retry budget")];
    world.tasks = [task("t-0", "Task 0")];
    const row = await renderExpandedAlpha();
    await waitFor(() => expect(within(row).getByText("0 of 1")).toBeInTheDocument());

    fireEvent.click(within(await challengeFor("Add a retry budget")).getByRole("button", { name: /^Reject / }));

    await waitFor(() => expect(rejectCalls()).toHaveLength(1));
    expect(rejectCalls()[0]).toEqual(["authoring_proposal_reject", { proposalId: "p-1", reason: undefined }]);
    await waitFor(() => expect(rackRow("challenge:p-1")).toBeNull());
    expect(acceptCalls()).toHaveLength(0);
    expect(rowKeys().filter((key) => key?.startsWith("task:"))).toEqual(["task:t-0"]);
    expect(within(row).getByText("0 of 1")).toBeInTheDocument();
  });

  it("leaves the challenge on the board and surfaces the error when an accept fails", async () => {
    world.proposals = [proposal("p-1", "Add a retry budget")];
    world.tasks = [task("t-0", "Task 0")];
    world.failAccept = true;
    await renderExpandedAlpha();
    const challenge = await challengeFor("Add a retry budget");

    fireEvent.click(within(challenge).getByRole("button", { name: /^Accept / }));

    expect(await within(challenge).findByRole("alert")).toHaveTextContent(/Could not accept/);
    expect(acceptCalls()).toHaveLength(1);
    expect(rackRow("challenge:p-1")).not.toBeNull();
    expect(rowKeys().filter((key) => key?.startsWith("task:"))).toEqual(["task:t-0"]);
    // Still decidable: the buttons come back, so the owner can retry or reject.
    expect(within(challenge).getByRole("button", { name: /^Accept / })).toBeEnabled();
  });

  it("does not issue a second accept for two clicks in the same tick", async () => {
    world.proposals = [proposal("p-1", "Add a retry budget")];
    world.tasks = [task("t-0", "Task 0")];
    await renderExpandedAlpha();
    const accept = within(await challengeFor("Add a retry budget")).getByRole("button", { name: /^Accept / });

    fireEvent.click(accept);
    fireEvent.click(accept);

    await waitFor(() => expect(acceptCalls()).toHaveLength(1));
  });

  it("leaves the triage lane working: it reads the same proposal and accepts through the same command", async () => {
    world.proposals = [proposal("p-1", "Add a retry budget")];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TriageLane projectId="proj-1" />
      </QueryClientProvider>,
    );

    const lane = await screen.findByRole("region", { name: "Proposals" });
    await waitFor(() => expect(within(lane).getByText("Add a retry budget")).toBeInTheDocument());
    fireEvent.click(within(lane).getByRole("button", { name: "Accept" }));

    await waitFor(() => expect(acceptCalls()).toHaveLength(1));
    expect(acceptCalls()[0]).toEqual(["authoring_proposal_accept", { proposalId: "p-1" }]);
  });
});
