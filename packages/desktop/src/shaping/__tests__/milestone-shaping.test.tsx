/**
 * Behaviour under test (issue #132, docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap"): a Milestone in
 * Shaping offers Shape on its Roadmap strip row and in its header. Shape starts a shaping session on the
 * Milestone through `milestone_shape` and opens the Milestone's shaping view: the one-step Stage bar with Exit
 * test, the Milestone card with its exit test and its neighbours, and the Round dock. An exit test the agent
 * proposes is a ghost over the exit test, decided in place. Closing Exit test with nothing open confirms that
 * it makes the Milestone Ready. A Milestone's Round a live session is held on is Waiting on you: Answer opens
 * the view, and its lamp names the Milestone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { RoadmapStrip } from "../../board/RoadmapStrip";
import { MilestoneHeader } from "../../board/MilestoneHeader";
import { MilestoneShapingView } from "../MilestoneShapingView";
import { RoundLamp } from "../../shell/AndonStrip";
import { activeSurface } from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type {
  MilestoneDto,
  MilestoneProgressDto,
  MilestoneShapingDto,
  ProposalDto,
  RoundDto,
  StageStatusDto,
  WaitingRoundDto,
} from "../../adapters/tauri";

const milestoneList = vi.fn();
const milestoneProgress = vi.fn();
const milestoneShape = vi.fn();
const milestoneShapingSession = vi.fn();
const milestoneShapingRounds = vi.fn();
const milestoneShapingContinue = vi.fn();
const proposalAccept = vi.fn();
const milestoneUpdate = vi.fn();
const stageClose = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    milestoneProgress: (...args: unknown[]) => milestoneProgress(...args),
    milestoneShape: (...args: unknown[]) => milestoneShape(...args),
    milestoneShapingSession: (...args: unknown[]) => milestoneShapingSession(...args),
    milestoneShapingRounds: (...args: unknown[]) => milestoneShapingRounds(...args),
    milestoneShapingContinue: (...args: unknown[]) => milestoneShapingContinue(...args),
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    milestoneUpdate: (...args: unknown[]) => milestoneUpdate(...args),
    stageClose: (...args: unknown[]) => stageClose(...args),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

function milestone(id: string, title: string, state: string, overrides: Partial<MilestoneDto> = {}): MilestoneDto {
  return { id, projectId: "p1", title, exitTest: `${title} passes its exit test.`, state, current: false, rank: id, ...overrides };
}

const BOARD = milestone("m0", "Board model", "done");
const SHAPING = milestone("m1", "Shaping", "shaping", { current: true, exitTest: "Shaping works" });
const ROADMAP = milestone("m2", "Roadmap", "ready");

const EXIT_TEST_OPEN = { id: "s1", kind: "exit_test", state: "open", rank: 1 };

function status(overrides: Partial<StageStatusDto> = {}): StageStatusDto {
  return { stageId: "s1", openItems: [], warnings: [], next: null, closable: true, ...overrides };
}

function view(overrides: Partial<MilestoneShapingDto> = {}): MilestoneShapingDto {
  return { milestone: SHAPING, stages: [EXIT_TEST_OPEN], rounds: [], proposals: [], openStageStatus: status(), ...overrides };
}

const OPEN_ROUND: RoundDto = {
  id: "r1",
  stageId: "s1",
  stageKind: "exit_test",
  number: 1,
  note: "Settles what the exit test observes.",
  state: "open",
  waitingOnYou: true,
  postedAt: "2026-10-23T09:00:00Z",
  answeredAt: null,
  questions: [
    {
      id: "q1",
      number: 1,
      title: "Observable",
      question: "Is the exit test observed in the app?",
      grounding: "docs/mvp-spec.md §3",
      recommendedAnswer: "Yes",
      because: "A date is not observable",
      answer: null,
      answeredWith: null,
      answeredAt: null,
    },
  ],
};

const GHOST: ProposalDto = {
  id: "pr1",
  projectId: "p1",
  sessionId: "run-m",
  epicId: null,
  verb: "amend",
  targetType: "milestone",
  targetId: "m1",
  payload: { title: null, exit_test: "Cyril shapes a Milestone's exit test in the dock." },
  rationale: "Round 1 settled it",
  state: "pending",
  rejectionReason: null,
  decidedBy: null,
  createdAt: "2026-10-23T09:10:00Z",
  stageId: "s1",
  roundId: "r1",
} as ProposalDto;

function wrap(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  milestoneList.mockReset().mockResolvedValue([BOARD, SHAPING, ROADMAP]);
  milestoneProgress.mockReset().mockResolvedValue(null);
  milestoneShape.mockReset().mockResolvedValue({ id: "run-m", milestoneId: "m1", status: "running", permissionMode: "dontAsk" });
  milestoneShapingSession.mockReset().mockResolvedValue(null);
  milestoneShapingRounds.mockReset().mockResolvedValue(view({ stages: [], openStageStatus: null }));
  milestoneShapingContinue.mockReset().mockResolvedValue({ id: "run-2", milestoneId: "m1", status: "running", permissionMode: "dontAsk" });
  proposalAccept.mockReset().mockResolvedValue(undefined);
  milestoneUpdate.mockReset().mockResolvedValue(undefined);
  stageClose.mockReset().mockResolvedValue({ closedStageId: "s1", opened: null, session: null, launchError: null, sidecarWarning: null });
});

describe("Shape on a Milestone (issue #132)", () => {
  // The strip leaves the picked row's slot empty (its header carries the control), so pick another one.
  beforeEach(() => useUiStore.getState().selectMilestone("p1", "m2"));

  it("is offered on the strip row of a Milestone in Shaping, and on no other row", async () => {
    wrap(<RoadmapStrip projectId="p1" />);
    expect(await screen.findByRole("button", { name: "Shape the exit test of Shaping" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Shape the exit test of Board model" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Shape the exit test of Roadmap" })).toBeNull();
  });

  it("leaves the picked row's slot empty: the Milestone header below carries its control", async () => {
    useUiStore.getState().selectMilestone("p1", "m1");
    wrap(<RoadmapStrip projectId="p1" />);
    await screen.findByRole("button", { name: /^Shaping, Shaping/ });
    expect(screen.queryByRole("button", { name: "Shape the exit test of Shaping" })).toBeNull();
  });

  it("says why Shape was refused on the strip, as the button's description", async () => {
    milestoneShape.mockRejectedValue("claude is not on PATH");
    wrap(<RoadmapStrip projectId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Shape the exit test of Shaping" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("claude is not on PATH");
    expect(screen.getByRole("button", { name: "Shape the exit test of Shaping" })).toHaveAccessibleDescription(/claude is not on PATH/);
    expect(useUiStore.getState().currentMilestoneId).toBeNull();
  });

  it("starts the shaping session through the core and opens the Milestone's shaping view", async () => {
    wrap(<RoadmapStrip projectId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Shape the exit test of Shaping" }));
    await waitFor(() => expect(milestoneShape).toHaveBeenCalledWith("m1"));
    await waitFor(() => expect(useUiStore.getState().currentMilestoneId).toBe("m1"));
    const state = useUiStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(activeSurface({ settingsOpen: false, sessionOpen: false, fleetOpen: false, worktreeInventoryOpen: false, projectUnreachable: false, milestoneOpen: true })).toBe("milestone");
    // Back returns to the board the Shape was pressed on.
    state.goBack();
    expect(useUiStore.getState().currentMilestoneId).toBeNull();
  });

  it("is offered in the Milestone header too, beside a chevron that opens the view", async () => {
    const progress: MilestoneProgressDto = {
      milestoneId: "m1",
      title: "Shaping",
      exitTest: "Shaping works",
      state: "shaping",
      current: true,
      nextMilestoneTitle: "Roadmap",
      counts: { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, storiesTotal: 0 },
      epicsDone: 0,
      epicsTotal: 0,
      epics: [],
    };
    milestoneProgress.mockResolvedValue(progress);
    wrap(<MilestoneHeader projectId="p1" />);
    expect(await screen.findByRole("button", { name: "Shape the exit test of Shaping" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Open the exit test of Shaping and its Rounds" }));
    expect(useUiStore.getState().currentMilestoneId).toBe("m1");
  });

  it("turns into Answer while a live session waits on the Milestone's Round, and Answer opens the view", async () => {
    milestoneShapingSession.mockResolvedValue("run-m");
    milestoneShapingRounds.mockResolvedValue(view({ rounds: [OPEN_ROUND] }));
    wrap(<RoadmapStrip projectId="p1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Answer the Round on Shaping" }));
    expect(useUiStore.getState().currentMilestoneId).toBe("m1");
  });
});

describe("the Milestone's shaping view (issue #132)", () => {
  function renderView() {
    wrap(<MilestoneShapingView projectId="p1" projectName="Threadfin" milestoneId="m1" onBack={() => {}} />);
  }

  it("opens the dock with the Exit test Stage, the exit test and its neighbours", async () => {
    milestoneShapingSession.mockResolvedValue("run-m");
    milestoneShapingRounds.mockResolvedValue(view());
    renderView();
    const stages = await screen.findByRole("region", { name: "Stages" });
    const step = within(stages).getByRole("listitem");
    expect(step).toHaveAttribute("aria-current", "step");
    expect(step).toHaveTextContent("Exit test, open, Stage 1 of 1");
    expect(await screen.findByRole("heading", { name: "No Round yet" })).toBeInTheDocument();
    expect(screen.getByText(/reading the Milestone, the Roadmap around it/)).toBeInTheDocument();

    const card = screen.getByRole("region", { name: "Shaping" });
    expect(within(card).getByText("Shaping works")).toBeInTheDocument();
    expect(await within(card).findByText("Milestone 2 of 3")).toBeInTheDocument();
    expect(within(card).getByText("Board model passes its exit test.")).toBeInTheDocument();
    expect(within(card).getByText("Roadmap passes its exit test.")).toBeInTheDocument();
  });

  it("draws a proposed exit test as a ghost over the exit test and accepts it in place", async () => {
    milestoneShapingRounds.mockResolvedValue(view({ proposals: [GHOST], openStageStatus: status({ closable: false }) }));
    renderView();
    const ghost = await screen.findByRole("group", { name: "Proposed Exit test" });
    expect(within(ghost).getByText("Cyril shapes a Milestone's exit test in the dock.")).toBeInTheDocument();
    expect(within(ghost).getByText("Why: Round 1 settled it")).toBeInTheDocument();
    fireEvent.click(within(ghost).getByRole("button", { name: "Accept the proposed Exit test" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("pr1"));
  });

  it("closes Exit test with nothing open after confirming it makes the Milestone Ready", async () => {
    milestoneShapingRounds.mockResolvedValue(view());
    renderView();
    const stages = await screen.findByRole("region", { name: "Stages" });
    expect(within(stages).getByText(/makes the Milestone Ready/)).toBeInTheDocument();
    fireEvent.click(within(stages).getByRole("button", { name: "Close Stage" }));
    expect(await screen.findByRole("alertdialog", { name: "Close the Exit test Stage?" })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Close and make it Ready" }));
    await waitFor(() => expect(stageClose).toHaveBeenCalledWith("s1"));
    expect(await within(stages).findByText("The Exit test Stage is closed: the Milestone is Ready.")).toBeInTheDocument();
  });
});

describe("editing a Milestone by hand on its card (issue #149)", () => {
  function renderView() {
    return wrap(<MilestoneShapingView projectId="p1" projectName="Threadfin" milestoneId="m1" onBack={() => {}} />);
  }

  it("edits the exit test in place through milestone_update, the pending ghost still under it", async () => {
    milestoneShapingRounds.mockResolvedValue(view({ proposals: [GHOST] }));
    renderView();
    const card = await screen.findByRole("region", { name: "Shaping" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit Exit test" }));
    const field = within(card).getByRole("textbox", { name: "Exit test" });
    expect(field).toHaveValue("Shaping works");
    expect(within(card).getByRole("group", { name: "Proposed Exit test" })).toBeInTheDocument();

    fireEvent.change(field, { target: { value: "  Cyril shapes an exit test.  " } });
    fireEvent.click(within(card).getByRole("button", { name: "Save Exit test" }));
    await waitFor(() => expect(milestoneUpdate).toHaveBeenCalledWith("m1", "Shaping", "Cyril shapes an exit test."));
    await waitFor(() => expect(within(card).queryByRole("textbox", { name: "Exit test" })).not.toBeInTheDocument());
    expect(within(card).getByRole("group", { name: "Proposed Exit test" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Edit Exit test" })).toHaveFocus();
  });

  it("clears a blanked exit test, and Escape leaves it as it was", async () => {
    milestoneShapingRounds.mockResolvedValue(view());
    renderView();
    const card = await screen.findByRole("region", { name: "Shaping" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit Exit test" }));
    fireEvent.keyDown(within(card).getByRole("textbox", { name: "Exit test" }), { key: "Escape" });
    expect(within(card).queryByRole("textbox", { name: "Exit test" })).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Edit Exit test" })).toHaveFocus();
    expect(milestoneUpdate).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole("button", { name: "Edit Exit test" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Exit test" }), { target: { value: "   " } });
    fireEvent.click(within(card).getByRole("button", { name: "Save Exit test" }));
    await waitFor(() => expect(milestoneUpdate).toHaveBeenCalledWith("m1", "Shaping", null));
  });

  it("edits the title in place, Enter saving it, and keeps a blank title open with the reason", async () => {
    milestoneShapingRounds.mockResolvedValue(view({ proposals: [GHOST] }));
    renderView();
    const card = await screen.findByRole("region", { name: "Shaping" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit title" }));
    const title = within(card).getByRole("textbox", { name: "Title" });
    expect(title).toHaveValue("Shaping");
    expect(within(card).getByRole("group", { name: "Proposed Exit test" })).toBeInTheDocument();

    fireEvent.change(title, { target: { value: " " } });
    fireEvent.submit(title);
    expect(await within(card).findByRole("alert")).toHaveTextContent("A Milestone needs a title");
    expect(milestoneUpdate).not.toHaveBeenCalled();

    fireEvent.change(title, { target: { value: "Shaping a Milestone" } });
    fireEvent.submit(title);
    await waitFor(() => expect(milestoneUpdate).toHaveBeenCalledWith("m1", "Shaping a Milestone", "Shaping works"));
  });

  it("says why a save was refused and keeps the draft", async () => {
    milestoneUpdate.mockRejectedValue("a Done Milestone is frozen; put later changes in a new Milestone");
    milestoneShapingRounds.mockResolvedValue(view());
    renderView();
    const card = await screen.findByRole("region", { name: "Shaping" });
    fireEvent.click(within(card).getByRole("button", { name: "Edit Exit test" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Exit test" }), { target: { value: "Something else" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save Exit test" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("Could not save Exit test: a Done Milestone is frozen");
    expect(within(card).getByRole("textbox", { name: "Exit test" })).toHaveValue("Something else");
  });

  it("offers no Edit on a Done or Dropped Milestone", async () => {
    for (const state of ["done", "dropped"]) {
      milestoneShapingRounds.mockResolvedValue(view({ milestone: { ...SHAPING, state } }));
      const { unmount } = renderView();
      const card = await screen.findByRole("region", { name: "Shaping" });
      expect(within(card).queryByRole("button", { name: /^Edit/ })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("a Milestone's Round Waiting on you (issue #132)", () => {
  it("lights a lamp that names the Milestone and opens its shaping view", () => {
    const round: WaitingRoundDto = {
      roundId: "r1",
      roundNumber: 1,
      subject: "milestone",
      stageKind: "exit_test",
      sessionId: "run-m",
      projectId: "p1",
      projectName: "Threadfin",
      projectKeyPrefix: "FLY",
      epicId: null,
      epicKey: null,
      epicTitle: null,
      milestoneId: "m1",
      milestoneTitle: "Shaping",
      waitingSince: "2026-10-23T09:00:00Z",
      answered: 0,
      questions: 2,
    };
    render(<RoundLamp round={round} current={false} now={Date.parse("2026-10-23T09:05:00Z")} />);
    fireEvent.click(screen.getByRole("button", { name: "Open Milestone Shaping, Round 1 Waiting on you" }));
    expect(useUiStore.getState().currentMilestoneId).toBe("m1");
    expect(useUiStore.getState().currentEpicId).toBeNull();
  });
});
