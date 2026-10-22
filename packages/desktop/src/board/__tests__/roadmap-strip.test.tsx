/**
 * Behaviour under test (issue #131, docs/mvp-spec.md §7 "Roadmap strip"): the strip above the Milestone
 * header lists every Milestone in Roadmap order (name, state, one-line Exit test). Dragging a row or the
 * keyboard move calls `milestone_move`; a Done or Dropped Milestone does not move. Clicking a row switches
 * the header and the roster to that Milestone. "+ Milestone" adds one from a one-line outcome.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, MilestoneDto, MilestoneProgressDto, StoryDto } from "../../adapters/tauri";

const milestoneList = vi.fn();
const milestoneMove = vi.fn();
const milestoneCreate = vi.fn();
const milestoneProgress = vi.fn();
const epicList = vi.fn();
const storyListForProject = vi.fn();

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

  it("offers the first Milestone on an empty Roadmap", async () => {
    milestoneList.mockResolvedValue([]);
    storyListForProject.mockResolvedValue([]);
    renderBoard();
    expect(await within(await strip()).findByText(/No Milestone yet/)).toBeInTheDocument();
    expect(within(await strip()).getByRole("button", { name: "Add a Milestone" })).toBeInTheDocument();
  });
});
