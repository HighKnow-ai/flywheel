/**
 * Behaviour under test (issue #52): a Story shows its *doing* Task and its Task checklist, which
 * stays live on `board:changed` (the agent writes it through its board tool), and the developer
 * can add, edit, reorder and drop Tasks, each through a core write. A drop needs a reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { useUiStore } from "../../state/uiStore";
import type { StoryDto, TaskDto } from "../../adapters/tauri";

const storyListForProject = vi.fn();
const taskList = vi.fn();
const taskAdd = vi.fn();
const taskRename = vi.fn();
const taskMove = vi.fn();
const taskSetState = vi.fn();
let boardChanged: ((payload: { projectId: string }) => void) | null = null;

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: () => Promise.resolve([]),
    epicList: () => Promise.resolve([]),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    taskList: (...args: unknown[]) => taskList(...args),
    taskAdd: (...args: unknown[]) => taskAdd(...args),
    taskRename: (...args: unknown[]) => taskRename(...args),
    taskMove: (...args: unknown[]) => taskMove(...args),
    taskSetState: (...args: unknown[]) => taskSetState(...args),
    subscribeBoardChanged: (handler: (payload: { projectId: string }) => void) => {
      boardChanged = handler;
      return Promise.resolve(() => {});
    },
  };
});

function story(id: string, key: string, state: string): StoryDto {
  return { id, projectId: "p1", epicId: "e1", key, title: `Story ${key}`, description: null, state, runsAfterStoryId: null, rank: "a" };
}

function task(id: string, title: string, state = "open", droppedReason: string | null = null): TaskDto {
  return { id, storyId: "s1", title, state, droppedReason, rank: id };
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" onStarted={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function openChecklist() {
  fireEvent.click(await screen.findByRole("button", { name: "Tasks of FLY-2" }));
  return screen.findByRole("list", { name: "FLY-2 Tasks" });
}

beforeEach(() => {
  boardChanged = null;
  useUiStore.setState({ currentProjectId: "p1" });
  storyListForProject.mockReset().mockResolvedValue([story("s1", "FLY-2", "running")]);
  taskList.mockReset().mockResolvedValue([task("t1", "Write the failing test", "done"), task("t2", "Make it pass", "doing"), task("t3", "Refactor")]);
  taskAdd.mockReset().mockResolvedValue(task("t4", "New"));
  taskRename.mockReset().mockResolvedValue(undefined);
  taskMove.mockReset().mockResolvedValue(undefined);
  taskSetState.mockReset().mockResolvedValue(undefined);
});

describe("A Story's Task checklist", () => {
  it("shows the doing Task on the Story and the checklist in order", async () => {
    renderBoard();
    expect(await screen.findByLabelText("FLY-2 is doing")).toHaveTextContent("Doing: Make it pass");
    expect(taskList).toHaveBeenCalledWith("s1");

    const list = await openChecklist();
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Write the failing test"),
      expect.stringContaining("Make it pass"),
      expect.stringContaining("Refactor"),
    ]);
    expect(within(rows[0]).getByText("Done")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Doing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tasks of FLY-2" })).toHaveTextContent("Tasks (1/3)");
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

  it("shows the core's refusal", async () => {
    taskMove.mockRejectedValue(new Error("Task \"x\" is not a Task of this Story"));
    renderBoard();
    await openChecklist();
    fireEvent.click(screen.getByRole("button", { name: "Move Refactor up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("is not a Task of this Story");
  });
});
