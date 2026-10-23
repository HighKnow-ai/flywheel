/**
 * Behaviour under test (issue #134, docs/mvp-spec.md §3): Confirm exit test shows on an Epic card only once
 * every Story is Merged or Dropped (and shaping is closed), and on a Milestone's row and header only once
 * every Epic is Done (the picked Milestone's in its header, any other's on its row). Confirm asks first, saying
 * what Round the click starts, then calls the core's confirmation, which starts it; Not met, in the same dialog,
 * reopens shaping. A session that cannot start is said even once the record is Done and the control gone. A
 * Done confirmed while a Round is open is noted on that Round's band.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type {
  EpicDto,
  MilestoneDto,
  MilestoneProgressDto,
  RoadmapRoundDto,
  RoadmapRoundViewDto,
  StoryDto,
} from "../../adapters/tauri";

const milestoneList = vi.fn();
const milestoneProgress = vi.fn();
const epicList = vi.fn();
const storyListForProject = vi.fn();
const roadmapRoundRead = vi.fn();
const epicConfirmDone = vi.fn();
const milestoneConfirmDone = vi.fn();
const epicSetState = vi.fn();
const milestoneSetState = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    // The board mounts the Needs-you column (#156), which reads its list and rides the fleet's subscription.
    needsYouList: () => Promise.resolve([]),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    milestoneProgress: (...args: unknown[]) => milestoneProgress(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    roadmapRoundRead: (...args: unknown[]) => roadmapRoundRead(...args),
    epicConfirmDone: (...args: unknown[]) => epicConfirmDone(...args),
    milestoneConfirmDone: (...args: unknown[]) => milestoneConfirmDone(...args),
    epicSetState: (...args: unknown[]) => epicSetState(...args),
    milestoneSetState: (...args: unknown[]) => milestoneSetState(...args),
    epicShapingSession: () => Promise.resolve(null),
    milestoneShapingSession: () => Promise.resolve(null),
    milestoneShapingRounds: () => Promise.resolve({ milestone: null, stages: [], rounds: [] }),
    epicShapingRounds: () => Promise.resolve({ epic: null, stages: [], rounds: [] }),
    taskList: () => Promise.resolve([]),
    storyContextPacketSize: () => Promise.resolve({ bytes: 4000, approxTokens: 1000, overSoftLimit: false }),
    blockedSummary: () => Promise.resolve({ blockedStoryIds: [], blockedCount: 0 }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

function milestone(overrides: Partial<MilestoneDto> = {}): MilestoneDto {
  return {
    id: "m3", projectId: "p1", title: "Shaping", exitTest: "Cyril shapes a Milestone's exit test.", state: "in_progress",
    current: true, rank: "a", epicsDone: 1, epicsTotal: 2, ...overrides,
  };
}

function epic(id: string, key: string, title: string, state: string): EpicDto {
  return {
    id, projectId: "p1", milestoneId: "m3", key, title, problem: null, scope: null, outOfScope: null,
    exitTest: `${title} is done end to end.`, state, rank: id,
  };
}

function story(id: string, epicId: string, state: string): StoryDto {
  return { id, projectId: "p1", epicId, key: `FLY-${id}`, title: `Story ${id}`, description: null, state, runsAfterStoryId: null, rank: id };
}

function progress(m: MilestoneDto): MilestoneProgressDto {
  const zero = { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, storiesTotal: 0 };
  return {
    milestoneId: m.id, title: m.title, exitTest: m.exitTest, state: m.state, current: m.current, nextMilestoneTitle: null,
    counts: zero, epicsDone: m.epicsDone ?? 0, epicsTotal: m.epicsTotal ?? 0, epics: [],
  };
}

const NO_ROUND: RoadmapRoundViewDto = { open: null, proposals: [], last: null };

function round(overrides: Partial<RoadmapRoundDto> = {}): RoadmapRoundDto {
  return {
    id: "rr1", number: 1, state: "open", triggerType: "epic_done", triggerLabel: "Epic FLY-1 done", waitingOnYou: false,
    sessionLive: true, sessionId: "ses-r", postedAt: "2026-10-22T09:00:00Z", closedAt: null, proposalsFiled: 0,
    notedTriggers: [], ...overrides,
  };
}

let roadmap: MilestoneDto[];

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" />
    </QueryClientProvider>,
  );
}

async function card(title: string) {
  return (await screen.findByRole("heading", { name: title })).closest("section") as HTMLElement;
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  roadmap = [milestone()];
  milestoneList.mockReset().mockImplementation(() => Promise.resolve(roadmap));
  milestoneProgress.mockReset().mockImplementation((_project: string, id: string | null) =>
    Promise.resolve(progress(roadmap.find((m) => (id === null ? m.current : m.id === id)) ?? roadmap[0])),
  );
  epicList.mockReset().mockResolvedValue([
    epic("e1", "FLY-1", "Rounds", "in_progress"),
    epic("e2", "FLY-2", "Ghost rows", "in_progress"),
    epic("e3", "FLY-3", "Slicing", "shaping"),
  ]);
  storyListForProject.mockReset().mockResolvedValue([
    story("10", "e1", "merged"),
    story("11", "e1", "dropped"),
    story("20", "e2", "merged"),
    story("21", "e2", "in_review"),
    story("30", "e3", "merged"),
  ]);
  roadmapRoundRead.mockReset().mockResolvedValue(NO_ROUND);
  epicConfirmDone.mockReset().mockResolvedValue({ outcome: "opened", roundNumber: 1, sessionId: "ses-r", sessionError: null });
  milestoneConfirmDone.mockReset().mockResolvedValue({ outcome: "opened", roundNumber: 1, sessionId: "ses-r", sessionError: null });
  epicSetState.mockReset().mockResolvedValue(undefined);
  milestoneSetState.mockReset().mockResolvedValue(undefined);
});

describe("Confirm exit test on an Epic card", () => {
  it("shows only when every Story is Merged or Dropped and shaping is closed", async () => {
    renderBoard();
    const rounds = await card("Rounds");
    expect(await within(rounds).findByRole("button", { name: "Confirm exit test of FLY-1 Rounds" })).toBeTruthy();
    // A Story still In review: not yet.
    expect(within(await card("Ghost rows")).queryByRole("button", { name: /Confirm exit test/ })).toBeNull();
  });

  it("does not show on an Epic in Shaping, whose next act is shaping", async () => {
    epicList.mockResolvedValue([epic("e3", "FLY-3", "Slicing", "shaping")]);
    renderBoard();
    const slicing = await card("Slicing");
    expect(await within(slicing).findByRole("button", { name: "Shape FLY-3 Slicing" })).toBeTruthy();
    expect(within(slicing).queryByRole("button", { name: /Confirm exit test/ })).toBeNull();
  });

  it("Decline, in the dialog, reopens shaping, and no Round starts", async () => {
    renderBoard();
    fireEvent.click(await within(await card("Rounds")).findByRole("button", { name: "Confirm exit test of FLY-1 Rounds" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Not met: reopen shaping on FLY-1 Rounds" }));
    await waitFor(() => expect(epicSetState).toHaveBeenCalledWith("e1", "shaping"));
    expect(epicConfirmDone).not.toHaveBeenCalled();
    expect(await screen.findByText("Shaping reopened on FLY-1 Rounds.")).toBeTruthy();
  });

  it("Confirm asks first, naming the exit test and the short Round it starts, then confirms Done", async () => {
    renderBoard();
    fireEvent.click(await within(await card("Rounds")).findByRole("button", { name: "Confirm exit test of FLY-1 Rounds" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Confirm the exit test of Rounds?" });
    expect(within(dialog).getByText("Rounds is done end to end.")).toBeTruthy();
    expect(within(dialog).getByText(/short roadmap Round on "Shaping"/)).toBeTruthy();
    expect(epicConfirmDone).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm FLY-1 Rounds Done" }));
    await waitFor(() => expect(epicConfirmDone).toHaveBeenCalledWith("e1"));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(await screen.findByText("FLY-1 Rounds is Done. Roadmap Round 1 started, on the Roadmap strip.")).toBeTruthy();
  });

  it("says the trigger is noted when a roadmap Round is already open", async () => {
    roadmapRoundRead.mockResolvedValue({ open: round({ number: 2 }), proposals: [], last: null });
    renderBoard();
    fireEvent.click(await within(await card("Rounds")).findByRole("button", { name: "Confirm exit test of FLY-1 Rounds" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(await within(dialog).findByText(/Roadmap Round 2 is already open, so no second Round starts/)).toBeTruthy();
  });

  it("says the Round's session could not start, even once the Epic reads Done and its control is gone", async () => {
    epicConfirmDone.mockImplementation(async () => {
      // The board refetches after the confirmation: the Epic is Done now.
      epicList.mockResolvedValue([
        epic("e1", "FLY-1", "Rounds", "done"),
        epic("e2", "FLY-2", "Ghost rows", "in_progress"),
      ]);
      return { outcome: "opened", roundNumber: 1, sessionId: null, sessionError: "claude is not on PATH" };
    });
    renderBoard();
    fireEvent.click(await within(await card("Rounds")).findByRole("button", { name: "Confirm exit test of FLY-1 Rounds" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Confirm FLY-1 Rounds Done" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Rounds is Done" });
    expect(within(dialog).getByText("claude is not on PATH")).toBeTruthy();
    expect(within(dialog).getByText(/Continue it from the Roadmap strip/)).toBeTruthy();
    // Behind the modal dialog the board is hidden from the accessibility tree, hence `hidden: true`.
    await waitFor(() => expect(screen.queryAllByRole("button", { name: /Confirm exit test of FLY-1/, hidden: true })).toHaveLength(0));
    expect(screen.getByRole("alertdialog", { name: "Rounds is Done" })).toBeTruthy();
  });
});

describe("Confirm exit test on a Milestone", () => {
  it("shows only once every Epic is Done", async () => {
    renderBoard();
    const strip = await screen.findByRole("region", { name: "Roadmap" });
    await within(strip).findByRole("button", { name: /^Shaping,/ });
    expect(screen.queryByRole("button", { name: /Confirm exit test of Shaping/ })).toBeNull();
  });

  it("shows in the header of the picked Milestone, and on the row of any other", async () => {
    roadmap = [
      milestone({ id: "m2", title: "Supervised", current: false, rank: "0", epicsDone: 3, epicsTotal: 3, state: "in_progress" }),
      milestone({ epicsDone: 2, epicsTotal: 2, state: "shaping" }),
    ];
    renderBoard();
    const strip = await screen.findByRole("region", { name: "Roadmap" });
    const header = await screen.findByRole("region", { name: "Shaping" });
    expect(await within(header).findByRole("button", { name: "Confirm exit test of Shaping" })).toBeTruthy();
    // The picked row leaves its slot empty: the header carries the control.
    expect(within(strip).queryByRole("button", { name: "Confirm exit test of Shaping" })).toBeNull();
    fireEvent.click(await within(strip).findByRole("button", { name: "Confirm exit test of Supervised" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/starts a Roadmap Round/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm Supervised Done" }));
    await waitFor(() => expect(milestoneConfirmDone).toHaveBeenCalledWith("m2"));
  });

  it("a Milestone in Shaping is never declined; one In progress reopens its shaping", async () => {
    roadmap = [milestone({ epicsDone: 2, epicsTotal: 2, state: "shaping" })];
    renderBoard();
    fireEvent.click(await within(await screen.findByRole("region", { name: "Shaping" })).findByRole("button", { name: "Confirm exit test of Shaping" }));
    expect(within(await screen.findByRole("alertdialog")).queryByRole("button", { name: /reopen shaping/ })).toBeNull();
    cleanup();

    roadmap = [milestone({ epicsDone: 2, epicsTotal: 2 })];
    renderBoard();
    fireEvent.click(await within(await screen.findByRole("region", { name: "Shaping" })).findByRole("button", { name: "Confirm exit test of Shaping" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Not met: reopen shaping on Shaping" }));
    await waitFor(() => expect(milestoneSetState).toHaveBeenCalledWith("m3", "shaping"));
  });
});

describe("A Done confirmed while a roadmap Round is open", () => {
  it("is noted on the Round's band", async () => {
    roadmapRoundRead.mockResolvedValue({
      open: round({ sessionLive: false, sessionId: null, notedTriggers: ["Epic FLY-2 done"] }),
      proposals: [],
      last: null,
    });
    renderBoard();
    const strip = await screen.findByRole("region", { name: "Roadmap" });
    expect(await within(strip).findByText("Also noted: Epic FLY-2 done.")).toBeTruthy();
    expect(within(strip).getByText(/The Round's next session reads it\./)).toBeTruthy();
  });
});
