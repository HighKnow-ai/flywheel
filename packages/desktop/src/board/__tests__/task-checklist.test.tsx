/**
 * Behaviour under test (issue #52): a Story shows its *doing* Task and its Task checklist, which
 * stays live on `board:changed` (the agent writes it through its board tool), and the developer
 * can add, edit, reorder and drop Tasks, each through a core write. A drop needs a reason.
 * Issue #96: each Task's note shows under it, collapsed by default, and the developer can edit it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { StoryView } from "../StoryView";
import { useUiStore } from "../../state/uiStore";
import type { StoryDto, TaskDto } from "../../adapters/tauri";

const storyListForProject = vi.fn();
const taskList = vi.fn();
const taskAdd = vi.fn();
const taskRename = vi.fn();
const taskMove = vi.fn();
const taskSetState = vi.fn();
const taskSetNote = vi.fn();
let boardChanged: ((payload: { projectId: string }) => void) | null = null;
// The board row's doing Task comes from the roster's one read (#159); here it says what the checklist says.
const rosterRows = vi.fn(async () => {
  const tasks: TaskDto[] = await taskList("s1");
  return [
    {
      storyId: "s1",
      attention: null,
      endingReason: null,
      liveSessionId: null,
      doingTaskTitle: tasks.find((t) => t.state === "doing")?.title ?? null,
      criteriaMet: 0,
      criteriaTotal: 0,
      tasksDone: tasks.filter((t) => t.state === "done").length,
      tasksTotal: tasks.filter((t) => t.state !== "dropped").length,
      review: null,
    },
  ];
});

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    // The board mounts the Needs-you column (#156), which reads its list and rides the fleet's subscription.
    needsYouList: () => Promise.resolve([]),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    milestoneList: () =>
      Promise.resolve([{ id: "m1", projectId: "p1", title: "M1", exitTest: null, state: "ready", current: true, rank: "a" }]),
    epicList: () => Promise.resolve([]),
    milestoneProgress: () => Promise.resolve(null),
    rosterRows: () => rosterRows(),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    taskList: (...args: unknown[]) => taskList(...args),
    taskAdd: (...args: unknown[]) => taskAdd(...args),
    taskRename: (...args: unknown[]) => taskRename(...args),
    taskMove: (...args: unknown[]) => taskMove(...args),
    taskSetState: (...args: unknown[]) => taskSetState(...args),
    taskSetNote: (...args: unknown[]) => taskSetNote(...args),
    storyGet: () => Promise.resolve(story("s1", "FLY-2", "running")),
    subscribeBoardChanged: (handler: (payload: { projectId: string }) => void) => {
      boardChanged = handler;
      return Promise.resolve(() => {});
    },
  };
});

function story(id: string, key: string, state: string): StoryDto {
  return { id, projectId: "p1", epicId: "e1", key, title: `Story ${key}`, description: null, state, runsAfterStoryId: null, rank: "a" };
}

function task(id: string, title: string, state = "open", droppedReason: string | null = null, note: string | null = null): TaskDto {
  return { id, storyId: "s1", title, state, droppedReason, rank: id, note };
}

/** The board, or the Story view once a row opens a Story: the two places a Story's Tasks show. */
function Place() {
  const storyId = useUiStore((state) => state.currentStoryId);
  return storyId ? (
    <StoryView projectId="p1" projectName="Threadfin" storyId={storyId} onBack={() => {}} />
  ) : (
    <StoryBoard projectId="p1" projectName="Threadfin" />
  );
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <Place />
    </QueryClientProvider>,
  );
}

/** The checklist lives in the Story view: open the Story from its row. */
async function openChecklist() {
  fireEvent.click(await screen.findByRole("button", { name: "Open Story FLY-2 Story FLY-2" }));
  const list = await screen.findByRole("list", { name: "FLY-2 Tasks" });
  await within(list).findAllByRole("listitem");
  return list;
}

beforeEach(() => {
  boardChanged = null;
  useUiStore.setState({ currentProjectId: "p1", currentStoryId: null });
  storyListForProject.mockReset().mockResolvedValue([story("s1", "FLY-2", "running")]);
  taskList.mockReset().mockResolvedValue([task("t1", "Write the failing test", "done"), task("t2", "Make it pass", "doing"), task("t3", "Refactor")]);
  taskAdd.mockReset().mockResolvedValue(task("t4", "New"));
  taskRename.mockReset().mockResolvedValue(undefined);
  taskMove.mockReset().mockResolvedValue(undefined);
  taskSetState.mockReset().mockResolvedValue(undefined);
  taskSetNote.mockReset().mockResolvedValue(undefined);
});

describe("A Story's Task checklist", () => {
  it("shows the doing Task on the Story and the checklist in order", async () => {
    renderBoard();
    expect(await screen.findByLabelText("FLY-2 is doing")).toHaveTextContent("Doing: Make it pass");

    const list = await openChecklist();
    expect(taskList).toHaveBeenCalledWith("s1");
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Write the failing test"),
      expect.stringContaining("Make it pass"),
      expect.stringContaining("Refactor"),
    ]);
    // A Task's state is its icon, with the word as its accessible name and tooltip.
    expect(within(rows[0]).getByRole("img", { name: "Done" })).toBeInTheDocument();
    expect(within(rows[1]).getByRole("img", { name: "Doing" })).toBeInTheDocument();
    expect(await screen.findByLabelText("1 of 3 Tasks done")).toHaveTextContent("1/3");
  });

  it("follows the agent's writes live when the core says the board changed", async () => {
    renderBoard();
    await screen.findByLabelText("FLY-2 is doing");

    taskList.mockResolvedValue([task("t1", "Write the failing test", "done"), task("t2", "Make it pass", "done"), task("t3", "Refactor", "doing")]);
    await waitFor(() => expect(boardChanged).not.toBeNull());
    act(() => boardChanged?.({ projectId: "p1" }));

    await waitFor(() => expect(screen.getByLabelText("FLY-2 is doing")).toHaveTextContent("Doing: Refactor"));
  });

  it("adds a Task at the end of the checklist", async () => {
    renderBoard();
    await openChecklist();
    fireEvent.change(screen.getByLabelText("New Task for FLY-2"), { target: { value: "  Write the docs  " } });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await waitFor(() => expect(taskAdd).toHaveBeenCalledWith("s1", "Write the docs"));
  });

  it("edits a Task's title", async () => {
    renderBoard();
    await openChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Edit Refactor" }));
    fireEvent.change(screen.getByLabelText("Title of Refactor"), { target: { value: "Refactor the parser" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(taskRename).toHaveBeenCalledWith("t3", "Refactor the parser"));
  });

  it("reorders Tasks up and down", async () => {
    renderBoard();
    await openChecklist();
    expect(screen.getByRole("button", { name: "Move Write the failing test up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Refactor down" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move Refactor up" }));
    await waitFor(() => expect(taskMove).toHaveBeenCalledWith("t3", "t2"));
    fireEvent.click(screen.getByRole("button", { name: "Move Write the failing test down" }));
    await waitFor(() => expect(taskMove).toHaveBeenCalledWith("t1", "t3"));
    fireEvent.click(screen.getByRole("button", { name: "Move Make it pass down" }));
    await waitFor(() => expect(taskMove).toHaveBeenCalledWith("t2", null));
  });

  it("drops a Task only with a reason, and shows the reason once dropped", async () => {
    renderBoard();
    await openChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Drop Refactor" }));
    const confirm = screen.getByRole("button", { name: "Confirm drop" });
    expect(confirm).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Reason for dropping Refactor"), { target: { value: "not needed" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(taskSetState).toHaveBeenCalledWith("t3", "dropped", "not needed"));

    taskList.mockResolvedValue([task("t3", "Refactor", "dropped", "not needed")]);
    act(() => boardChanged?.({ projectId: "p1" }));
    expect(await screen.findByText("Dropped: not needed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Drop Refactor" })).toBeNull();
  });

  it("shows each Task's note collapsed by default, and opens it on demand", async () => {
    const survey = "Board tools live in task_tool.rs.\nLeft: the UI.";
    taskList.mockResolvedValue([task("t1", "Survey the repo", "doing", null, survey), task("t2", "Build")]);
    renderBoard();
    await openChecklist();

    const show = screen.getByRole("button", { name: "Show note of Survey the repo" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    expect(show).toHaveTextContent("Note");
    expect(screen.queryByText(/Board tools live in task_tool\.rs/)).toBeNull();
    expect(screen.getByRole("button", { name: "Show note of Build" })).toHaveTextContent("No note");

    fireEvent.click(show);
    const region = screen.getByRole("region", { name: "Note of Survey the repo" });
    expect(region).toHaveTextContent("Board tools live in task_tool.rs.");
    expect(region).toHaveTextContent("Left: the UI.");
    expect(screen.getByRole("button", { name: "Hide note of Survey the repo" })).toHaveAttribute("aria-expanded", "true");
  });

  it("lets the developer edit a Task's note, written through the core", async () => {
    taskList.mockResolvedValue([task("t1", "Survey the repo", "doing", null, "Old note")]);
    renderBoard();
    await openChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Show note of Survey the repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit note of Survey the repo" }));
    const text = screen.getByLabelText("Note text of Survey the repo");
    expect(text).toHaveValue("Old note");
    fireEvent.change(text, { target: { value: "  Skip the survey: see docs/notes.md  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(taskSetNote).toHaveBeenCalledWith("t1", "Skip the survey: see docs/notes.md"));
  });

  it("shows the core's refusal", async () => {
    taskMove.mockRejectedValue(new Error("Task \"x\" is not a Task of this Story"));
    renderBoard();
    await openChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Move Refactor up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("is not a Task of this Story");
  });
});
