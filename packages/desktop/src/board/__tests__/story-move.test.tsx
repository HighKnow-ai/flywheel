/**
 * Behaviour under test (issue #168, docs/mvp-spec.md §7): creating an Epic or a Story and moving a Story
 * between Epics are reachable from visible controls. "+ Story" on an Epic card's heading opens Write a Story
 * with that Epic chosen; "+ Epic" in the Milestone header opens Add an Epic with the picked Milestone chosen;
 * "Move to Epic…" in the Story view is a Combobox of the project's open Epics, with a check on the Story's own, and
 * moves the Story to the one picked, saying so in a toast with Undo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { StoryView } from "../StoryView";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, MilestoneDto, MilestoneProgressDto, StoryDto } from "../../adapters/tauri";
import { at } from "../../test/present";

const milestoneList = vi.fn();
const milestoneProgress = vi.fn();
const epicList = vi.fn();
const epicCreate = vi.fn();
const storyListForProject = vi.fn();
const storyGet = vi.fn();
const storyMove = vi.fn();
const storyWriteByHand = vi.fn();
const notifySuccess = vi.fn();

vi.mock("@/lib/notify", () => ({
  notify: { success: (...args: unknown[]) => notifySuccess(...args), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    milestoneProgress: (...args: unknown[]) => milestoneProgress(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    epicCreate: (...args: unknown[]) => epicCreate(...args),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    storyGet: (...args: unknown[]) => storyGet(...args),
    storyMove: (...args: unknown[]) => storyMove(...args),
    storyWriteByHand: (...args: unknown[]) => storyWriteByHand(...args),
    roadmapRoundRead: () => Promise.resolve({ open: null, proposals: [], last: null }),
    epicShapingSession: () => Promise.resolve(null),
    milestoneShapingSession: () => Promise.resolve(null),
    milestoneShapingRounds: () => Promise.resolve({ milestone: null, stages: [], rounds: [] }),
    epicShapingRounds: () => Promise.resolve({ epic: null, stages: [], rounds: [] }),
    taskList: () => Promise.resolve([]),
    criterionList: () => Promise.resolve([]),
    sessionsForStory: () => Promise.resolve([]),
    storyStopped: () => Promise.resolve(null),
    storyContextPacketSize: () => Promise.resolve({ bytes: 4000, approxTokens: 1000, overSoftLimit: false }),
    blockedSummary: () => Promise.resolve({ blockedStoryIds: [], blockedCount: 0 }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

const MILESTONES: MilestoneDto[] = [
  {
    id: "m3",
    projectId: "p1",
    title: "Board",
    exitTest: "Cyril reads the board at a glance.",
    state: "in_progress",
    current: true,
    rank: "a",
  },
  { id: "m4", projectId: "p1", title: "Review", exitTest: null, state: "shaping", current: false, rank: "b" },
];

function epic(id: string, milestoneId: string, key: string, title: string, state: string): EpicDto {
  return {
    id,
    projectId: "p1",
    milestoneId,
    key,
    title,
    problem: null,
    scope: null,
    outOfScope: null,
    exitTest: null,
    state,
    rank: id,
  };
}

const EPICS: Record<string, EpicDto[]> = {
  m3: [
    epic("e1", "m3", "FLY-1", "Roster", "in_progress"),
    epic("e2", "m3", "FLY-2", "Needs you", "ready"),
    epic("e9", "m3", "FLY-9", "Old work", "done"),
  ],
  m4: [epic("e3", "m4", "FLY-3", "Merge", "shaping")],
};

function story(id: string, epicId: string, state: string): StoryDto {
  return {
    id,
    projectId: "p1",
    epicId,
    key: `FLY-${id}`,
    title: `Story ${id}`,
    description: null,
    state,
    runsAfterStoryId: null,
    rank: id,
  };
}

function progress(m: MilestoneDto): MilestoneProgressDto {
  const zero = {
    shaping: 0,
    ready: 0,
    running: 0,
    waitingOnYou: 0,
    stopped: 0,
    inReview: 0,
    merged: 0,
    dropped: 0,
    storiesTotal: 0,
  };
  return {
    milestoneId: m.id,
    title: m.title,
    exitTest: m.exitTest,
    state: m.state,
    current: m.current,
    nextMilestoneTitle: null,
    counts: zero,
    epicsDone: 0,
    epicsTotal: 2,
    epics: [],
  };
}

function wrap(node: React.ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  milestoneList.mockReset().mockResolvedValue(MILESTONES);
  milestoneProgress
    .mockReset()
    .mockImplementation((_p: string, id: string | null) =>
      Promise.resolve(progress(MILESTONES.find((m) => (id === null ? m.current : m.id === id)) ?? at(MILESTONES, 0))),
    );
  epicList.mockReset().mockImplementation((milestoneId: string) => Promise.resolve(EPICS[milestoneId] ?? []));
  epicCreate.mockReset().mockResolvedValue(epic("e5", "m3", "FLY-5", "Since you last looked", "shaping"));
  storyListForProject.mockReset().mockResolvedValue([story("10", "e1", "running"), story("20", "e2", "ready")]);
  storyGet.mockReset().mockResolvedValue(story("10", "e1", "running"));
  storyMove.mockReset().mockResolvedValue(undefined);
  storyWriteByHand.mockReset();
});

describe("+ Story on an Epic card", () => {
  it("opens Write a Story with the Milestone and that Epic already chosen", async () => {
    wrap(<StoryBoard projectId="p1" projectName="Threadfin" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add a Story to FLY-2 Needs you" }));
    const dialog = await screen.findByRole("dialog", { name: "Write a Story" });
    await waitFor(() =>
      expect(within(dialog).getByRole("combobox", { name: "Epic" })).toHaveTextContent("FLY-2 Needs you"),
    );
    expect(within(dialog).getByRole("combobox", { name: "Milestone" })).toHaveTextContent("Board");
  });

  it("is on every open Epic's card", async () => {
    wrap(<StoryBoard projectId="p1" projectName="Threadfin" />);
    expect(await screen.findByRole("button", { name: "Add a Story to FLY-1 Roster" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a Story to FLY-2 Needs you" })).toBeTruthy();
  });
});

describe("+ Epic in the Milestone header", () => {
  it("opens Add an Epic on the picked Milestone and adds the Epic there", async () => {
    wrap(<StoryBoard projectId="p1" projectName="Threadfin" />);
    fireEvent.click(await screen.findByRole("button", { name: "Add an Epic to Board" }));
    const dialog = await screen.findByRole("dialog", { name: "Add an Epic" });
    await waitFor(() => expect(within(dialog).getByRole("combobox", { name: "Milestone" })).toHaveTextContent("Board"));
    fireEvent.change(within(dialog).getByLabelText("Epic title"), { target: { value: "Since you last looked" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add Epic" }));
    await waitFor(() => expect(epicCreate).toHaveBeenCalledWith("m3", "Since you last looked"));
  });
});

describe("Move to Epic… in the Story view", () => {
  beforeEach(() => {
    // cmdk scrolls the highlighted option into view; jsdom has no layout to scroll.
    Element.prototype.scrollIntoView = vi.fn();
    notifySuccess.mockReset();
  });

  async function openPicker() {
    wrap(<StoryView projectId="p1" projectName="Threadfin" storyId="10" onBack={() => {}} />);
    const trigger = await screen.findByRole("combobox", { name: "Move FLY-10 to another Epic" });
    fireEvent.click(trigger);
    return screen.findByRole("listbox");
  }

  it("lists the project's open Epics under their Milestones, with a check on the Story's own", async () => {
    const list = await openPicker();
    await within(list).findByRole("option", { name: /FLY-2 Needs you/ });
    expect(within(list).getByRole("option", { name: /FLY-3 Merge/ })).toBeTruthy();
    const current = within(list).getByRole("option", { name: /FLY-1 Roster/ });
    expect(current).toHaveAttribute("data-checked", "true");
    expect(current).toHaveAttribute("aria-disabled", "true");
    expect(within(list).queryByRole("option", { name: /FLY-9 Old work/ })).toBeNull();
    expect(within(list).getByText("Board")).toBeTruthy();
    expect(within(list).getByText("Review")).toBeTruthy();
  });

  it("narrows the list as the Developer types", async () => {
    const list = await openPicker();
    await within(list).findByRole("option", { name: /FLY-2 Needs you/ });
    fireEvent.change(screen.getByPlaceholderText("Search Epics"), { target: { value: "merge" } });
    await waitFor(() => expect(within(list).queryByRole("option", { name: /FLY-2 Needs you/ })).toBeNull());
    expect(within(list).getByRole("option", { name: /FLY-3 Merge/ })).toBeTruthy();
  });

  it("moves the Story to the Epic picked, and says so with Undo", async () => {
    const list = await openPicker();
    fireEvent.click(await within(list).findByRole("option", { name: /FLY-3 Merge/ }));
    await waitFor(() => expect(storyMove).toHaveBeenCalledWith("10", "e3"));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith("Moved FLY-10 to FLY-3", expect.anything()));
    const { undo } = at(notifySuccess.mock.calls, 0)[1] as { undo: () => void };
    undo();
    await waitFor(() => expect(storyMove).toHaveBeenLastCalledWith("10", "e1"));
  });

  it("says why when the core refuses the move", async () => {
    storyMove.mockRejectedValue("FLY-3 is done; a Story moves only into an open Epic");
    const list = await openPicker();
    fireEvent.click(await within(list).findByRole("option", { name: /FLY-3 Merge/ }));
    expect(await screen.findByText("FLY-3 is done; a Story moves only into an open Epic")).toBeTruthy();
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it("is not offered on a closed Story", async () => {
    storyGet.mockResolvedValue(story("10", "e1", "merged"));
    wrap(<StoryView projectId="p1" projectName="Threadfin" storyId="10" onBack={() => {}} />);
    await screen.findByRole("heading", { name: /Story 10/ });
    expect(screen.queryByRole("combobox", { name: "Move FLY-10 to another Epic" })).toBeNull();
  });
});
