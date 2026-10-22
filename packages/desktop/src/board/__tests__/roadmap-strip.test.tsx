/**
 * Behaviour under test (issue #131, docs/mvp-spec.md §7 "Roadmap strip"): the strip above the Milestone
 * header lists every Milestone in Roadmap order (name, state, one-line Exit test). Dragging a row or the
 * keyboard move calls `milestone_move`; a Done or Dropped Milestone does not move. Clicking a row switches
 * the header and the roster to that Milestone. "+ Milestone" adds one from a one-line outcome.
 *
 * Issue #133: Revisit roadmap starts a roadmap Round; the Round's band says where it is, Dismiss closes it
 * with no change, and each Roadmap Proposal is a ghost row under the Milestone it lands on, with Accept,
 * Amend and Reject; a rejected one is struck through with its reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type {
  EpicDto,
  MilestoneDto,
  MilestoneProgressDto,
  RoadmapProposalDto,
  RoadmapRoundDto,
  RoadmapRoundViewDto,
  StoryDto,
} from "../../adapters/tauri";

const milestoneList = vi.fn();
const milestoneMove = vi.fn();
const milestoneCreate = vi.fn();
const milestoneProgress = vi.fn();
const epicList = vi.fn();
const storyListForProject = vi.fn();
const roadmapRoundRead = vi.fn();
const roadmapRevisit = vi.fn();
const roadmapRoundDismiss = vi.fn();
const proposalAccept = vi.fn();
const proposalAmend = vi.fn();
const proposalReject = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    milestoneMove: (...args: unknown[]) => milestoneMove(...args),
    milestoneCreate: (...args: unknown[]) => milestoneCreate(...args),
    milestoneProgress: (...args: unknown[]) => milestoneProgress(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    roadmapRoundRead: (...args: unknown[]) => roadmapRoundRead(...args),
    roadmapRevisit: (...args: unknown[]) => roadmapRevisit(...args),
    roadmapRoundDismiss: (...args: unknown[]) => roadmapRoundDismiss(...args),
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalAmend: (...args: unknown[]) => proposalAmend(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
    taskList: () => Promise.resolve([]),
    storyContextPacketSize: () => Promise.resolve({ bytes: 4000, approxTokens: 1000, overSoftLimit: false }),
    blockedSummary: () => Promise.resolve({ blockedStoryIds: [], blockedCount: 0 }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

function milestone(id: string, title: string, state: string, overrides: Partial<MilestoneDto> = {}): MilestoneDto {
  return { id, projectId: "p1", title, exitTest: `${title} passes its exit test.`, state, current: false, rank: id, ...overrides };
}

const ROADMAP: MilestoneDto[] = [
  milestone("m1", "Clean cut", "done"),
  milestone("m2", "Supervised execution", "dropped"),
  milestone("m3", "Shaping", "in_progress", { current: true }),
  milestone("m4", "Board and review", "shaping", { exitTest: null }),
  milestone("m5", "One-week exit test", "shaping"),
];

function epic(id: string, title: string, milestoneId: string): EpicDto {
  return {
    id, projectId: "p1", milestoneId, key: id.toUpperCase(), title, problem: null, scope: null, outOfScope: null,
    exitTest: null, state: "shaping", rank: "a",
  };
}

function story(id: string, title: string, epicId: string): StoryDto {
  return { id, projectId: "p1", epicId, key: id.toUpperCase(), title, description: null, state: "ready", runsAfterStoryId: null, rank: "a" };
}

function progress(m: MilestoneDto): MilestoneProgressDto {
  const zero = { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, storiesTotal: 0 };
  return {
    milestoneId: m.id, title: m.title, exitTest: m.exitTest, state: m.state, current: m.current, nextMilestoneTitle: null,
    counts: zero, epicsDone: 0, epicsTotal: 0, epics: [],
  };
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" />
    </QueryClientProvider>,
  );
}

async function strip() {
  return screen.findByRole("region", { name: "Roadmap" });
}

async function rowOf(title: string) {
  const list = await within(await strip()).findByRole("list", { name: "Milestones in Roadmap order" });
  const button = await within(list).findByRole("button", { name: new RegExp(`^${title},`) });
  return button.closest("li") as HTMLElement;
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  milestoneList.mockReset().mockResolvedValue(ROADMAP);
  milestoneMove.mockReset().mockResolvedValue(undefined);
  milestoneCreate.mockReset().mockResolvedValue(milestone("m6", "Relay", "shaping"));
  milestoneProgress.mockReset().mockImplementation((_project: string, id: string | null) => {
    const m = id === null ? ROADMAP.find((x) => x.current) : ROADMAP.find((x) => x.id === id);
    return Promise.resolve(m ? progress(m) : null);
  });
  epicList.mockReset().mockImplementation((milestoneId: string) =>
    Promise.resolve(
      milestoneId === "m3" ? [epic("e3", "Roadmap shaping", "m3")] : milestoneId === "m4" ? [epic("e4", "Review drawer", "m4")] : [],
    ),
  );
  storyListForProject.mockReset().mockResolvedValue([story("s3", "Ghost rows", "e3"), story("s4", "Diff view", "e4")]);
  roadmapRoundRead.mockReset().mockResolvedValue(NO_ROUND);
  roadmapRevisit.mockReset().mockResolvedValue({ id: "ses-r", projectId: "p1", status: "running", permissionMode: "dontAsk" });
  roadmapRoundDismiss.mockReset().mockResolvedValue(undefined);
  proposalAccept.mockReset().mockResolvedValue(undefined);
  proposalAmend.mockReset().mockResolvedValue(undefined);
  proposalReject.mockReset().mockResolvedValue(undefined);
});

const NO_ROUND: RoadmapRoundViewDto = { open: null, proposals: [], last: null };

function round(overrides: Partial<RoadmapRoundDto> = {}): RoadmapRoundDto {
  return {
    id: "rr1", number: 1, state: "open", triggerType: "revisit", triggerLabel: "Revisit roadmap", waitingOnYou: false,
    sessionLive: true, sessionId: "ses-r", postedAt: "2026-10-22T09:00:00Z", closedAt: null, proposalsFiled: 0, ...overrides,
  };
}

function proposal(id: string, verb: string, targetType: string, summary: string, overrides: Partial<RoadmapProposalDto> = {}): RoadmapProposalDto {
  return {
    id, projectId: "p1", sessionId: "ses-r", epicId: null, verb, targetType, targetId: null, payload: {}, rationale: "Asked twice",
    state: "pending", createdAt: "2026-10-22T09:01:00Z", rejectionReason: null, stageId: null, roundId: "rr1", summary,
    anchorMilestoneId: null, ...overrides,
  };
}

const NEW_MILESTONE = proposal("p-new", "create", "milestone", "New Milestone \"Mobile\"", {
  payload: { title: "Mobile", exit_test: null },
});
const RETIRE_BOARD = proposal("p-retire", "retire", "milestone", "Retire Milestone \"Board and review\"", {
  targetId: "m4", anchorMilestoneId: "m4",
});
const NEW_EPIC = proposal("p-epic", "create", "epic", "New Epic \"Ghost rows\" in Milestone \"Shaping\"", {
  payload: { milestone_id: "m3", title: "Ghost rows", problem: null }, anchorMilestoneId: "m3",
});
const REJECTED = proposal("p-no", "create", "milestone", "New Milestone \"Teams\"", {
  state: "rejected", rejectionReason: "Not before the one-week test",
});

describe("RoadmapStrip: one row per Milestone", () => {
  it("lists every Milestone in Roadmap order with its state and one-line Exit test", async () => {
    renderBoard();
    const list = await within(await strip()).findByRole("list", { name: "Milestones in Roadmap order" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(5));
    const titles = within(list).getAllByRole("listitem").map((li) => li.getAttribute("data-milestone-title"));
    expect(titles).toEqual(["Clean cut", "Supervised execution", "Shaping", "Board and review", "One-week exit test"]);

    const current = await rowOf("Shaping");
    expect(within(current).getByText("In progress")).toBeInTheDocument();
    expect(within(current).getByText("Shaping passes its exit test.")).toBeInTheDocument();
    expect(within(current).getByText("Current")).toBeInTheDocument();
    expect(within(await rowOf("Board and review")).getByText("Exit test not written yet")).toBeInTheDocument();
    expect(within(await rowOf("Clean cut")).getByText("Done")).toBeInTheDocument();
  });

  it("selects the Current Milestone until another is picked", async () => {
    renderBoard();
    const current = await rowOf("Shaping");
    expect(within(current).getByRole("button", { name: /^Shaping,/ })).toHaveAttribute("aria-current", "true");
    expect(within(await rowOf("Board and review")).getByRole("button", { name: /^Board and review,/ })).not.toHaveAttribute(
      "aria-current",
    );
  });
});

describe("RoadmapStrip: click switches the header and the roster", () => {
  it("shows the Current Milestone's Epics only, then another Milestone's when its row is clicked", async () => {
    renderBoard();
    expect(await screen.findByRole("region", { name: "Shaping" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Roadmap shaping" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Review drawer" })).toBeNull();
    expect(milestoneProgress).toHaveBeenCalledWith("p1", null);

    fireEvent.click(within(await rowOf("Board and review")).getByRole("button", { name: /^Board and review,/ }));

    expect(await screen.findByRole("region", { name: "Board and review" })).toBeInTheDocument();
    expect(milestoneProgress).toHaveBeenCalledWith("p1", "m4");
    expect(await screen.findByRole("heading", { name: "Review drawer" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Roadmap shaping" })).toBeNull();
    expect(useUiStore.getState().selectedMilestoneByProject).toEqual({ p1: "m4" });
    expect(within(await rowOf("Board and review")).getByRole("button", { name: /^Board and review,/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("says so when the picked Milestone has no Stories yet", async () => {
    renderBoard();
    fireEvent.click(within(await rowOf("One-week exit test")).getByRole("button", { name: /^One-week exit test,/ }));
    expect(await screen.findByText("No Stories in this Milestone yet")).toBeInTheDocument();
  });
});

describe("RoadmapStrip: drag and the keyboard move call milestone_move", () => {
  it("drops a row moved up just before the row it lands on", async () => {
    renderBoard();
    const dragged = await rowOf("One-week exit test");
    const target = await rowOf("Shaping");
    fireEvent.dragStart(dragged, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.dragOver(target, { dataTransfer: { dropEffect: "" } });
    fireEvent.drop(target, { dataTransfer: {} });
    await waitFor(() => expect(milestoneMove).toHaveBeenCalledWith("m5", "m3"));
  });

  it("drops a row moved down just after the row it lands on", async () => {
    renderBoard();
    const dragged = await rowOf("Shaping");
    fireEvent.dragStart(dragged, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.drop(await rowOf("Board and review"), { dataTransfer: {} });
    await waitFor(() => expect(milestoneMove).toHaveBeenCalledWith("m3", "m5"));

    milestoneMove.mockClear();
    fireEvent.dragStart(await rowOf("Shaping"), { dataTransfer: { setData: () => {}, effectAllowed: "" } });
    fireEvent.drop(await rowOf("One-week exit test"), { dataTransfer: {} });
    await waitFor(() => expect(milestoneMove).toHaveBeenCalledWith("m3", null));
  });

  it("moves with Alt and the arrow keys on a row, and with the arrow keys on its move handle", async () => {
    renderBoard();
    const row = await rowOf("Board and review");
    fireEvent.keyDown(within(row).getByRole("button", { name: /^Board and review,/ }), { key: "ArrowUp", altKey: true });
    await waitFor(() => expect(milestoneMove).toHaveBeenCalledWith("m4", "m3"));

    milestoneMove.mockClear();
    fireEvent.keyDown(within(row).getByRole("button", { name: "Move Board and review" }), { key: "ArrowDown" });
    await waitFor(() => expect(milestoneMove).toHaveBeenCalledWith("m4", null));
    expect(await screen.findByText("Moved Board and review to position 5 of 5")).toBeInTheDocument();
  });

  it("never moves a Done or Dropped Milestone", async () => {
    renderBoard();
    for (const title of ["Clean cut", "Supervised execution"]) {
      const row = await rowOf(title);
      expect(row).toHaveAttribute("draggable", "false");
      expect(within(row).queryByRole("button", { name: `Move ${title}` })).toBeNull();
      fireEvent.keyDown(within(row).getByRole("button", { name: new RegExp(`^${title},`) }), { key: "ArrowDown", altKey: true });
      fireEvent.dragStart(row, { dataTransfer: { setData: () => {}, effectAllowed: "" } });
      fireEvent.drop(await rowOf("One-week exit test"), { dataTransfer: {} });
    }
    expect(milestoneMove).not.toHaveBeenCalled();
  });

  it("shows the core's refusal", async () => {
    milestoneMove.mockRejectedValue("a Done Milestone is frozen and keeps its place on the Roadmap");
    renderBoard();
    fireEvent.keyDown(within(await rowOf("Shaping")).getByRole("button", { name: "Move Shaping" }), { key: "ArrowUp" });
    expect(await screen.findByText(/keeps its place on the Roadmap/)).toBeInTheDocument();
  });
});

describe("RoadmapStrip: + Milestone", () => {
  it("adds a Milestone from a one-line outcome and picks it", async () => {
    renderBoard();
    fireEvent.click(within(await strip()).getByRole("button", { name: "Add a Milestone" }));
    const input = screen.getByRole("textbox", { name: "New Milestone's outcome" });
    fireEvent.change(input, { target: { value: "  Relay  " } });
    fireEvent.submit(input.closest("form") as HTMLFormElement);
    await waitFor(() => expect(milestoneCreate).toHaveBeenCalledWith("p1", "Relay"));
    await waitFor(() => expect(useUiStore.getState().selectedMilestoneByProject).toEqual({ p1: "m6" }));
    expect(screen.queryByRole("textbox", { name: "New Milestone's outcome" })).toBeNull();
  });

  it("Escape closes the field and gives the focus back to + Milestone", async () => {
    renderBoard();
    const add = within(await strip()).getByRole("button", { name: "Add a Milestone" });
    fireEvent.click(add);
    expect(add).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "New Milestone's outcome" }), { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "New Milestone's outcome" })).toBeNull();
    expect(document.activeElement).toBe(add);
    expect(milestoneCreate).not.toHaveBeenCalled();
  });

  it("offers the first Milestone on an empty Roadmap", async () => {
    milestoneList.mockResolvedValue([]);
    storyListForProject.mockResolvedValue([]);
    renderBoard();
    expect(await within(await strip()).findByText(/No Milestone yet/)).toBeInTheDocument();
    expect(within(await strip()).getByRole("button", { name: "Add a Milestone" })).toBeInTheDocument();
  });
});

describe("RoadmapStrip: the roadmap Round (issue #133)", () => {
  it("Revisit roadmap starts the Round, and its band says the agent is reading without opening the session", async () => {
    renderBoard();
    const revisit = await within(await strip()).findByRole("button", { name: "Revisit roadmap" });
    roadmapRoundRead.mockResolvedValue({ open: round(), proposals: [], last: null });
    fireEvent.click(revisit);
    await waitFor(() => expect(roadmapRevisit).toHaveBeenCalledWith("p1"));
    expect(await within(await strip()).findByRole("heading", { name: "Roadmap Round 1" })).toBeInTheDocument();
    expect(within(await strip()).getByRole("status")).toHaveTextContent("The agent is reading the Roadmap");
    expect(within(await strip()).queryByRole("button", { name: "Revisit roadmap" })).toBeNull();
    expect(useUiStore.getState().activeSessionId).toBeNull();
    fireEvent.click(within(await strip()).getByRole("button", { name: "Open session" }));
    expect(useUiStore.getState().activeSessionId).toBe("ses-r");
  });

  it("shows each proposed change as a ghost row under the Milestone it lands on, a new Milestone at the end", async () => {
    roadmapRoundRead.mockResolvedValue({
      open: round({ waitingOnYou: true, proposalsFiled: 4 }),
      proposals: [NEW_MILESTONE, RETIRE_BOARD, NEW_EPIC, REJECTED],
      last: null,
    });
    renderBoard();
    const list = await within(await strip()).findByRole("list", { name: "Milestones in Roadmap order" });
    await waitFor(() => expect(list.querySelectorAll("[data-slot=roadmap-ghost-row]")).toHaveLength(4));
    const order = within(list)
      .getAllByRole("listitem")
      .map((li) => li.getAttribute("data-milestone-title") ?? li.querySelector("[role=group]")?.getAttribute("aria-label") ?? li.getAttribute("aria-label"));
    expect(order).toEqual([
      "Clean cut",
      "Supervised execution",
      "Shaping",
      'Proposed: New Epic "Ghost rows" in Milestone "Shaping"',
      "Board and review",
      'Proposed: Retire Milestone "Board and review"',
      "One-week exit test",
      'Proposed: New Milestone "Mobile"',
      'Rejected: New Milestone "Teams"',
    ]);
    expect(within(await strip()).getByRole("status")).toHaveTextContent("Waiting on you · 1 of 4 decided");
    expect(await strip()).toHaveAttribute("data-round-waiting", "true");
    const rejected = within(list).getByRole("listitem", { name: 'Rejected: New Milestone "Teams"' });
    expect(within(rejected).getByText("Your reason: Not before the one-week test")).toBeInTheDocument();
  });

  it("Accept, Amend and Reject decide a ghost row in place", async () => {
    roadmapRoundRead.mockResolvedValue({ open: round({ waitingOnYou: true }), proposals: [NEW_MILESTONE, RETIRE_BOARD], last: null });
    renderBoard();
    const retire = await screen.findByRole("group", { name: 'Proposed: Retire Milestone "Board and review"' });
    expect(within(retire).queryByRole("button", { name: /^Amend/ })).toBeNull();
    fireEvent.click(within(retire).getByRole("button", { name: 'Accept: Retire Milestone "Board and review"' }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("p-retire"));

    const created = screen.getByRole("group", { name: 'Proposed: New Milestone "Mobile"' });
    fireEvent.click(within(created).getByRole("button", { name: 'Amend: New Milestone "Mobile"' }));
    const outcome = within(created).getByRole("textbox", { name: "Outcome" });
    expect(outcome).toHaveValue("Mobile");
    fireEvent.change(outcome, { target: { value: "Mobile, read-only" } });
    fireEvent.change(within(created).getByRole("textbox", { name: "Exit test (optional)" }), { target: { value: "A phone reads the board" } });
    fireEvent.click(within(created).getByRole("button", { name: "Accept edit" }));
    await waitFor(() =>
      expect(proposalAmend).toHaveBeenCalledWith("p-new", { title: "Mobile, read-only", exit_test: "A phone reads the board" }),
    );

    fireEvent.click(within(retire).getByRole("button", { name: 'Reject: Retire Milestone "Board and review"' }));
    fireEvent.change(within(retire).getByRole("textbox", { name: "Why not? (optional)" }), { target: { value: "Still needed" } });
    fireEvent.click(within(retire).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("p-retire", "Still needed"));
  });

  it("Dismiss closes the Round, asking first when it would reject undecided changes", async () => {
    roadmapRoundRead.mockResolvedValue({ open: round({ waitingOnYou: true }), proposals: [NEW_MILESTONE], last: null });
    renderBoard();
    fireEvent.click(await within(await strip()).findByRole("button", { name: "Dismiss Roadmap Round 1, changing nothing" }));
    expect(roadmapRoundDismiss).not.toHaveBeenCalled();
    expect(within(await strip()).getByText("Dismissing rejects the undecided change.")).toBeInTheDocument();
    fireEvent.click(within(await strip()).getByRole("button", { name: "Dismiss Round" }));
    await waitFor(() => expect(roadmapRoundDismiss).toHaveBeenCalledWith("rr1"));
  });

  it("offers Continue on a Round with no live session, and says when the Roadmap still holds", async () => {
    roadmapRoundRead.mockResolvedValue({ open: round({ sessionLive: false }), proposals: [], last: null });
    renderBoard();
    expect(await within(await strip()).findByRole("status")).toHaveTextContent("No live session: your decisions are kept");
    fireEvent.click(within(await strip()).getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(roadmapRevisit).toHaveBeenCalledWith("p1"));

    roadmapRoundRead.mockResolvedValue({ open: null, proposals: [], last: round({ state: "closed", closedAt: new Date().toISOString() }) });
    cleanupAndRender();
    expect(await within(await strip()).findByText("Roadmap still holds")).toBeInTheDocument();
    expect(within(await strip()).getByRole("button", { name: "Revisit roadmap" })).toBeInTheDocument();
  });
});

function cleanupAndRender() {
  document.body.innerHTML = "";
  renderBoard();
}
