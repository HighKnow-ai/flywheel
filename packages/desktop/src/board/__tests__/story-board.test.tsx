/**
 * Behaviour under test (issue #50): the bare board writes a Milestone, an Epic and a Story with
 * criteria and Checks from visible controls, lists the project's Stories with their state, keeps
 * that state live on `board:changed`, and Start reaches the core's `story_start` for a Ready Story.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { useUiStore } from "../../state/uiStore";
import type { EpicDto, MilestoneDto, StoryDto } from "../../adapters/tauri";

const milestoneList = vi.fn();
const milestoneCreate = vi.fn();
const epicList = vi.fn();
const epicCreate = vi.fn();
const storyListForProject = vi.fn();
const storyWriteByHand = vi.fn();
const storyStart = vi.fn();
const storyContextPacketSize = vi.fn();
const blockedSummary = vi.fn();
let boardChanged: ((payload: { projectId: string }) => void) | null = null;

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    milestoneCreate: (...args: unknown[]) => milestoneCreate(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    epicCreate: (...args: unknown[]) => epicCreate(...args),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    storyWriteByHand: (...args: unknown[]) => storyWriteByHand(...args),
    storyStart: (...args: unknown[]) => storyStart(...args),
    taskList: () => Promise.resolve([]),
    storyContextPacketSize: (...args: unknown[]) => storyContextPacketSize(...args),
    blockedSummary: (...args: unknown[]) => blockedSummary(...args),
    subscribeBoardChanged: (handler: (payload: { projectId: string }) => void) => {
      boardChanged = handler;
      return Promise.resolve(() => {});
    },
  };
});

function milestone(id: string, title: string): MilestoneDto {
  return { id, projectId: "p1", title, exitTest: null, state: "shaping", current: true, rank: "a" };
}

function epic(id: string, title: string, milestoneId = "m1"): EpicDto {
  return {
    id,
    projectId: "p1",
    milestoneId,
    key: "FLY-1",
    title,
    problem: null,
    scope: null,
    outOfScope: null,
    exitTest: null,
    state: "shaping",
    rank: "a",
  };
}

function story(id: string, key: string, title: string, state: string): StoryDto {
  return { id, projectId: "p1", epicId: "e1", key, title, description: null, state, runsAfterStoryId: null, rank: "a" };
}

function renderBoard(onStarted = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return { onStarted };
}

/** Choose Milestone m1, wait for its Epics to load, then choose Epic e1. */
async function chooseEpic() {
  await screen.findByRole("option", { name: "M1" });
  fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "m1" } });
  await screen.findByRole("option", { name: "FLY-1 E1" });
  fireEvent.change(screen.getByLabelText("Epic"), { target: { value: "e1" } });
}

beforeEach(() => {
  boardChanged = null;
  useUiStore.setState({ currentProjectId: "p1" });
  milestoneList.mockReset().mockResolvedValue([]);
  milestoneCreate.mockReset().mockResolvedValue(milestone("m1", "M1"));
  epicList.mockReset().mockResolvedValue([]);
  epicCreate.mockReset().mockResolvedValue(epic("e1", "E1"));
  storyListForProject.mockReset().mockResolvedValue([]);
  storyWriteByHand.mockReset().mockResolvedValue(story("s1", "FLY-2", "S", "ready"));
  storyStart.mockReset().mockResolvedValue({ id: "run-1", storyId: "s1", status: "running", permissionMode: "acceptEdits" });
  storyContextPacketSize.mockReset().mockResolvedValue({ bytes: 4000, approxTokens: 1000, overSoftLimit: false });
  blockedSummary.mockReset().mockResolvedValue({ blockedStoryIds: [], blockedCount: 0 });
});

describe("StoryBoard: the Context packet size (issue #51)", () => {
  it("shows each open Story's packet size without a warning under the soft limit", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Small", "ready")]);
    storyContextPacketSize.mockResolvedValue({ bytes: 4800, approxTokens: 1200, overSoftLimit: false });
    renderBoard();

    const row = await within(await screen.findByRole("list", { name: "Stories" })).findByRole("listitem");
    expect(await within(row).findByText("Context packet ~1.2K tokens")).toBeInTheDocument();
    expect(within(row).queryByText(/soft limit/)).toBeNull();
    expect(storyContextPacketSize).toHaveBeenCalledWith("s1");
  });

  it("warns above about 20K tokens", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Big", "running")]);
    storyContextPacketSize.mockResolvedValue({ bytes: 100_000, approxTokens: 25_000, overSoftLimit: true });
    renderBoard();

    const row = await within(await screen.findByRole("list", { name: "Stories" })).findByRole("listitem");
    expect(await within(row).findByText("Context packet ~25.0K tokens, above the ~20K soft limit")).toBeInTheDocument();
  });

  it("does not size a closed Story", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Done", "merged")]);
    renderBoard();

    await screen.findByText("Merged");
    expect(storyContextPacketSize).not.toHaveBeenCalled();
  });

  it("re-reads the size when the core says the board changed", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Live", "ready")]);
    renderBoard();
    const row = await within(await screen.findByRole("list", { name: "Stories" })).findByRole("listitem");
    await within(row).findByText("Context packet ~1.0K tokens");

    storyContextPacketSize.mockResolvedValue({ bytes: 8000, approxTokens: 2000, overSoftLimit: false });
    await waitFor(() => expect(boardChanged).not.toBeNull());
    act(() => boardChanged?.({ projectId: "p1" }));
    expect(await within(row).findByText("Context packet ~2.0K tokens")).toBeInTheDocument();
  });
});

describe("StoryBoard: the Story list", () => {
  it("lists the project's Stories with their state, and offers Start only on a Ready one", async () => {
    storyListForProject.mockResolvedValue([
      story("s1", "FLY-2", "Ready one", "ready"),
      story("s2", "FLY-3", "Under review", "in_review"),
    ]);
    renderBoard();

    const list = await screen.findByRole("list", { name: "Stories" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    const [ready, review] = within(list).getAllByRole("listitem");
    expect(within(ready).getByText("FLY-2")).toBeInTheDocument();
    expect(within(ready).getByText("Ready")).toBeInTheDocument();
    expect(within(ready).getByRole("button", { name: "Start FLY-2" })).toBeInTheDocument();
    expect(within(review).getByText("In review")).toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: /Start/ })).toBeNull();
    expect(storyListForProject).toHaveBeenCalledWith("p1");
  });

  it("changes a Story's state live when the core says the board changed", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "ready")]);
    renderBoard();
    const list = await screen.findByRole("list", { name: "Stories" });
    await within(list).findByText("Ready");

    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "running")]);
    await waitFor(() => expect(boardChanged).not.toBeNull());
    act(() => boardChanged?.({ projectId: "p1" }));

    await within(list).findByText("Running");
    expect(within(list).queryByText("Ready")).toBeNull();
  });

  it("shows Waiting on you, tinted, in place of the state word of a Story whose session waits on you (#57)", async () => {
    storyListForProject.mockResolvedValue([
      story("s1", "FLY-2", "Waiting one", "running"),
      story("s2", "FLY-3", "Busy one", "running"),
    ]);
    blockedSummary.mockResolvedValue({ blockedStoryIds: ["s1"], blockedCount: 1 });
    renderBoard();

    const list = await screen.findByRole("list", { name: "Stories" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    const [waiting, busy] = within(list).getAllByRole("listitem");
    const flag = await within(waiting).findByText("Waiting on you");
    expect(flag.closest("[data-state-class]")).toHaveAttribute("data-state-class", "needs-you");
    expect(within(waiting).queryByText("Running")).toBeNull();
    expect(within(busy).getByText("Running")).toBeInTheDocument();
    expect(blockedSummary).toHaveBeenCalledWith("p1");
  });

  it("drops Waiting on you live once the request is answered", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Waiting one", "running")]);
    blockedSummary.mockResolvedValue({ blockedStoryIds: ["s1"], blockedCount: 1 });
    renderBoard();
    const list = await screen.findByRole("list", { name: "Stories" });
    await within(list).findByText("Waiting on you");

    blockedSummary.mockResolvedValue({ blockedStoryIds: [], blockedCount: 0 });
    await waitFor(() => expect(boardChanged).not.toBeNull());
    act(() => boardChanged?.({ projectId: "p1" }));

    await within(list).findByText("Running");
    expect(within(list).queryByText("Waiting on you")).toBeNull();
  });

  it("Start calls the core's story_start and hands the new session on", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "ready")]);
    const { onStarted } = renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Start FLY-2" }));

    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("run-1", "s1"));
    expect(storyStart).toHaveBeenCalledWith("s1");
  });

  it("shows the core's refusal when Start fails", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "ready")]);
    storyStart.mockRejectedValue(new Error("Start needs a Ready Story; this one is running"));
    const { onStarted } = renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Start FLY-2" }));

    expect(await screen.findByText("Start needs a Ready Story; this one is running")).toBeInTheDocument();
    expect(onStarted).not.toHaveBeenCalled();
  });
});

describe("StoryBoard: the hand-written Story form", () => {
  it("creates a Milestone from its visible controls", async () => {
    renderBoard();
    fireEvent.change(await screen.findByLabelText("Milestone title"), { target: { value: "  M1  " } });
    fireEvent.change(screen.getByLabelText("Exit test"), { target: { value: "It ships" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Milestone" }));

    await waitFor(() => expect(milestoneCreate).toHaveBeenCalledWith("p1", "M1", "It ships"));
  });

  it("creates an Epic only inside a chosen Milestone", async () => {
    milestoneList.mockResolvedValue([milestone("m1", "M1")]);
    renderBoard();

    const addEpic = await screen.findByRole("button", { name: "Add Epic" });
    fireEvent.change(screen.getByLabelText("Epic title"), { target: { value: "E1" } });
    expect(addEpic).toBeDisabled();

    await screen.findByRole("option", { name: "M1" });
    fireEvent.change(screen.getByLabelText("Milestone"), { target: { value: "m1" } });
    expect(addEpic).toBeEnabled();
    fireEvent.click(addEpic);
    await waitFor(() => expect(epicCreate).toHaveBeenCalledWith("m1", "E1"));
  });

  it("writes a Story with its criteria and Checks inside the chosen Epic", async () => {
    milestoneList.mockResolvedValue([milestone("m1", "M1")]);
    epicList.mockResolvedValue([epic("e1", "E1")]);
    renderBoard();

    const create = await screen.findByRole("button", { name: "Create Story" });
    fireEvent.change(screen.getByLabelText("Story title"), { target: { value: "Start a Story" } });
    fireEvent.change(screen.getByLabelText("Criterion 1"), { target: { value: "It starts" } });
    expect(create).toBeDisabled();

    await chooseEpic();
    await waitFor(() => expect(create).toBeEnabled());

    fireEvent.change(screen.getByLabelText("Check command 1"), { target: { value: "cargo test" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    fireEvent.change(screen.getByLabelText("Criterion 2"), { target: { value: "It shows its state" } });
    fireEvent.click(screen.getByRole("button", { name: "Add criterion" }));
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "why" } });
    fireEvent.click(create);

    await waitFor(() =>
      expect(storyWriteByHand).toHaveBeenCalledWith("e1", "Start a Story", "why", [
        { statement: "It starts", checkCommand: "cargo test" },
        { statement: "It shows its state", checkCommand: null },
      ]),
    );
    await waitFor(() => expect(screen.getByLabelText("Story title")).toHaveValue(""));
  });

  it("cannot create a Story without a criterion", async () => {
    milestoneList.mockResolvedValue([milestone("m1", "M1")]);
    epicList.mockResolvedValue([epic("e1", "E1")]);
    renderBoard();
    await chooseEpic();
    fireEvent.change(screen.getByLabelText("Story title"), { target: { value: "No criteria" } });

    expect(screen.getByRole("button", { name: "Create Story" })).toBeDisabled();
  });

  it("shows the core's refusal and keeps the draft", async () => {
    milestoneList.mockResolvedValue([milestone("m1", "M1")]);
    epicList.mockResolvedValue([epic("e1", "E1")]);
    storyWriteByHand.mockRejectedValue(new Error("Epic is done; a new Story goes into an open Epic"));
    renderBoard();
    await chooseEpic();
    fireEvent.change(screen.getByLabelText("Story title"), { target: { value: "Kept" } });
    fireEvent.change(screen.getByLabelText("Criterion 1"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Story" }));

    expect(await screen.findByText("Epic is done; a new Story goes into an open Epic")).toBeInTheDocument();
    expect(screen.getByLabelText("Story title")).toHaveValue("Kept");
  });
});
