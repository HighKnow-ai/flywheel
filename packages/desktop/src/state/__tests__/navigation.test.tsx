/**
 * Issue #104: clicking and navigation are predictable.
 *
 * The click model: a Story row (on the board, in the sidebar, in Waiting on you) opens the Story. The
 * live agent opens only from a control labelled as the session. Nothing opens a session on its own:
 * not Start, not Resume, not the launch sheet, not a new session event, not selecting a Story.
 * Back (the Back control and ⌘[) returns to the previous place.
 *
 * These tests mount the real shell (`<App />`) over a stubbed adapter where the question is where a
 * click lands, and the component alone where the question is what it calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../../App";
import { queryClient as appQueryClient } from "../../adapters/queryClient";
import type { AcceptanceCriterionDto, BlockedQueueEntryDto, RunSummaryDto, StoryDto, TaskDto } from "../../adapters/tauri";
import { BlockedQueue } from "../../fleet/BlockedQueue";
import { StoryView } from "../../board/StoryView";
import { resetUiState, useUiStore } from "../uiStore";

const PROJECT = { id: "p1", keyPrefix: "FLY", name: "Flywheel", repoPath: "/repo", defaultBranch: "main", status: "active" };

function story(id: string, key: string, title: string, state: string): StoryDto {
  return { id, projectId: "p1", epicId: "e1", key, title, description: null, state, runsAfterStoryId: null, rank: "a" };
}

const READY = story("s-ready", "FLY-1", "Ready one", "ready");
const RUNNING = story("s-run", "FLY-2", "Running one", "running");

function liveRun(id: string, storyId: string): RunSummaryDto {
  return {
    id,
    storyId,
    status: "running",
    startedAt: "2026-10-21T09:00:00Z",
    endedAt: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    externalSessionId: null,
    acknowledgedAt: null,
    abandonedReason: null,
    endingReason: null,
  };
}

const DOING: TaskDto = { id: "t1", storyId: "s-run", title: "Write the parser", state: "doing", droppedReason: null, rank: "a", note: null };

let boardChanged: ((payload: { projectId: string | null }) => void) | null = null;
let agentEvent: ((event: Record<string, unknown>) => void) | null = null;
const storyListForProject = vi.fn<(projectId: string) => Promise<StoryDto[]>>();
const storyStart = vi.fn();
const storyGet = vi.fn<(storyId: string) => Promise<StoryDto | null>>();
const startSession = vi.fn();
const checkSet = vi.fn<(criterionId: string, command: string) => Promise<void>>();
const criterionList = vi.fn<(storyId: string) => Promise<AcceptanceCriterionDto[]>>();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    invokeCommand: (command: string) => {
      if (command === "project_list") return Promise.resolve([PROJECT]);
      if (command === "launch_environment") return Promise.resolve({ path: "/usr/bin", pathWarning: null, claudeError: null });
      return Promise.resolve([]);
    },
    subscribeBoardChanged: (handler: (payload: { projectId: string | null }) => void) => {
      boardChanged = handler;
      return Promise.resolve(() => {});
    },
    subscribeAgentEvent: (handler: (event: Record<string, unknown>) => void) => {
      agentEvent = handler;
      return Promise.resolve(() => {});
    },
    subscribeMenuAction: () => Promise.resolve(() => {}),
    openFolderDialog: () => Promise.resolve(null),
    fleetWatchRun: () => Promise.resolve(),
    fleetList: () => Promise.resolve({ rows: [], totalRows: 0, visibleCostUsd: null }),
    fleetBlockedQueue: () => Promise.resolve([]),
    boardRecoverySummary: () => Promise.resolve({ recoveryCount: 0 }),
    pendingOrphans: () => Promise.resolve([]),
    milestoneList: () => Promise.resolve([]),
    storyListForProject: (projectId: string) => storyListForProject(projectId),
    storyGet: (storyId: string) => storyGet(storyId),
    storyStart: (storyId: string) => storyStart(storyId),
    startSession: (storyId: string) => startSession(storyId),
    storyStopped: () => Promise.resolve(null),
    storyContextPacketSize: () => Promise.resolve({ bytes: 400, approxTokens: 100, overSoftLimit: false }),
    blockedSummary: () => Promise.resolve({ blockedStoryIds: [], blockedCount: 0 }),
    taskList: (storyId: string) => Promise.resolve(storyId === "s-run" ? [DOING] : []),
    sessionsForStory: (storyId: string) => Promise.resolve(storyId === "s-run" ? [liveRun("run-live", "s-run")] : []),
    sessionSummariesForStory: () => Promise.resolve([]),
    criterionList: (storyId: string) => criterionList(storyId),
    checkSet: (criterionId: string, command: string) => checkSet(criterionId, command),
    checkRemove: () => Promise.resolve(),
    sessionLogWindow: (_id: string, offset: number, limit: number) => Promise.resolve({ entries: [], offset, limit, total: 0 }),
    pendingPermissionRequests: () => Promise.resolve([]),
    answerPermissionRequest: () => Promise.resolve(),
    answerQuestion: () => Promise.resolve(),
  };
});

beforeEach(() => {
  resetUiState();
  appQueryClient.clear();
  boardChanged = null;
  agentEvent = null;
  storyListForProject.mockReset().mockResolvedValue([READY, RUNNING]);
  storyStart.mockReset().mockResolvedValue({ id: "run-new", storyId: "s-ready", status: "running", permissionMode: "acceptEdits" });
  storyGet.mockReset().mockImplementation((id) => Promise.resolve([READY, RUNNING].find((s) => s.id === id) ?? null));
  startSession.mockReset().mockResolvedValue({ id: "run-relaunched", storyId: "s-run", status: "running", permissionMode: "acceptEdits" });
  checkSet.mockReset().mockResolvedValue(undefined);
  criterionList.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  resetUiState();
});

const sessionOpen = () => document.querySelector("[data-testid='session-feed-scroll']") !== null;

async function mountBoard() {
  render(<App />);
  return within(await screen.findByRole("list", { name: "Stories" }));
}

describe("selecting or opening a Story never opens its session", () => {
  it("board: a click on a Story row opens the Story, not its session", async () => {
    const board = await mountBoard();
    fireEvent.click(await board.findByRole("button", { name: "Open Story FLY-2 Running one" }));

    expect(await screen.findByRole("heading", { name: /Running one/ })).toBeInTheDocument();
    expect(useUiStore.getState().currentStoryId).toBe("s-run");
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(sessionOpen()).toBe(false);
  });

  it("board: the doing Task and the state word go to the Story too", async () => {
    const board = await mountBoard();
    fireEvent.click(await board.findByText("Doing: Write the parser"));
    expect(useUiStore.getState().currentStoryId).toBe("s-run");
    expect(useUiStore.getState().activeSessionId).toBeNull();

    act(() => useUiStore.getState().goBack());
    const again = within(await screen.findByRole("list", { name: "Stories" }));
    fireEvent.click(await again.findByText("Ready"));
    expect(useUiStore.getState().currentStoryId).toBe("s-ready");
  });

  it("board: Start starts the session and stays on the board", async () => {
    const board = await mountBoard();
    fireEvent.click(await board.findByRole("button", { name: "Start FLY-1" }));
    await waitFor(() => expect(storyStart).toHaveBeenCalledWith("s-ready"));
    await waitFor(() => expect(board.getByRole("button", { name: "Start FLY-1" })).not.toBeDisabled());
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(screen.getByRole("list", { name: "Stories" })).toBeInTheDocument();
  });

  it("a new session event or board change opens nothing", async () => {
    await mountBoard();
    await waitFor(() => expect(boardChanged).not.toBeNull());
    await waitFor(() => expect(agentEvent).not.toBeNull());
    storyListForProject.mockResolvedValue([{ ...READY, state: "running" }, RUNNING]);
    act(() => {
      agentEvent?.({ type: "session_started", runId: "run-new", storyId: "s-ready" });
      agentEvent?.({ type: "assistant_text", runId: "run-new", text: "Hello" });
      boardChanged?.({ projectId: "p1" });
    });
    await waitFor(() => expect(storyListForProject.mock.calls.length).toBeGreaterThan(1));
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(sessionOpen()).toBe(false);
  });

  it("the launch sheet's Start lands on the Story, not on the new session", async () => {
    useUiStore.setState({ launchSheetStoryId: "s-run" });
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Start Work" }));
    await waitFor(() => expect(startSession).toHaveBeenCalledWith("s-run"));
    await waitFor(() => expect(useUiStore.getState().currentStoryId).toBe("s-run"));
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().launchSheetStoryId).toBeNull();
  });

  it("Waiting on you: the Story key opens the Story, not the session", () => {
    renderQueue();
    fireEvent.click(screen.getByRole("button", { name: "Open Story FLY-2" }));
    expect(useUiStore.getState().currentStoryId).toBe("s-run");
    expect(useUiStore.getState().currentProjectId).toBe("p1");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });
});

describe("one explicit control opens a running Story's live session", () => {
  it("board: the row's Open session control", async () => {
    const board = await mountBoard();
    expect(board.queryByRole("button", { name: "Open live session of FLY-1" })).toBeNull();
    fireEvent.click(await board.findByRole("button", { name: "Open live session of FLY-2" }));
    expect(useUiStore.getState().activeSessionId).toBe("run-live");
    expect(useUiStore.getState().activeSessionStoryId).toBe("s-run");
    await waitFor(() => expect(sessionOpen()).toBe(true));
  });

  it("the Story view's Open session control", async () => {
    useUiStore.getState().openStory("p1", "s-run");
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Open live session of FLY-2" }));
    expect(useUiStore.getState().activeSessionId).toBe("run-live");
  });

  it("Waiting on you: the entry's Open session control", () => {
    renderQueue();
    fireEvent.click(screen.getByRole("button", { name: "Open live session of FLY-2" }));
    expect(useUiStore.getState().activeSessionId).toBe("run-q");
    expect(useUiStore.getState().activeSessionStoryId).toBe("s-run");
  });
});

describe("Back and ⌘[", () => {
  it("returns from the session to the Story, and from the Story to the board", async () => {
    const board = await mountBoard();
    fireEvent.click(await board.findByRole("button", { name: "Open Story FLY-2 Running one" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open live session of FLY-2" }));
    await waitFor(() => expect(sessionOpen()).toBe(true));

    fireEvent.keyDown(window, { key: "[", metaKey: true });
    expect(await screen.findByRole("heading", { name: /Running one/ })).toBeInTheDocument();
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().currentStoryId).toBe("s-run");

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByRole("list", { name: "Stories" })).toBeInTheDocument();
    expect(useUiStore.getState().currentStoryId).toBeNull();
  });

  it("the Story view says where you are: the project, then the Story", async () => {
    useUiStore.getState().openStory("p1", "s-run");
    render(<App />);
    const here = await screen.findByRole("navigation", { name: "You are here" });
    await waitFor(() => expect(here).toHaveTextContent(/Flywheel\s*\/\s*FLY-2/));
  });

  it("with nothing to go back to, Back lands on the project's board", () => {
    useUiStore.setState({ currentProjectId: "p1", currentStoryId: "s-run" });
    useUiStore.getState().goBack();
    expect(useUiStore.getState().currentStoryId).toBeNull();
  });

  it("choosing a project while a session shows lands on that project's board, one Back from the session", () => {
    useUiStore.setState({ currentProjectId: "p1" });
    useUiStore.getState().setActiveSessionId("run-1", "s-run");
    useUiStore.getState().setCurrentProjectId("p2");
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().currentProjectId).toBe("p2");
    useUiStore.getState().goBack();
    expect(useUiStore.getState().activeSessionId).toBe("run-1");
    expect(useUiStore.getState().currentProjectId).toBe("p1");
  });

  it("going to the place already showing adds nothing to Back", () => {
    useUiStore.getState().openStory("p1", "s-run");
    useUiStore.getState().openStory("p1", "s-run");
    expect(useUiStore.getState().navHistory).toHaveLength(1);
  });
});

describe("adding a Check to a criterion is a visible control on the Story", () => {
  function criterion(check: AcceptanceCriterionDto["check"]): AcceptanceCriterionDto {
    return { id: "c1", storyId: "s-run", statement: "Parses the header", accepted: false, acceptedAt: null, rank: "a", check };
  }

  function renderStory() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StoryView projectId="p1" projectName="Flywheel" storyId="s-run" onBack={() => {}} />
      </QueryClientProvider>,
    );
  }

  it("adds a Check to a criterion judged at review", async () => {
    criterionList.mockResolvedValue([criterion(null)]);
    renderStory();
    expect(await screen.findByText("No Check: judged at review")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add a Check to criterion 1" }));
    fireEvent.change(screen.getByLabelText("Check command for criterion 1"), { target: { value: "npm test -- parser" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Check" }));
    await waitFor(() => expect(checkSet).toHaveBeenCalledWith("c1", "npm test -- parser"));
  });

  it("shows an existing Check with its result, and offers to change or remove it", async () => {
    criterionList.mockResolvedValue([
      criterion({ id: "k1", command: "cargo test", timeoutSecs: 600, result: "failed", commitSha: "abc", stale: false, outputTail: null }),
    ]);
    renderStory();
    expect(await screen.findByText("cargo test")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change the Check of criterion 1" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove the Check of criterion 1" })).toBeInTheDocument();
  });
});

function renderQueue() {
  const entry: BlockedQueueEntryDto = {
    requestId: "req-1",
    toolName: "Bash",
    inputPayload: JSON.stringify({ command: "ls" }),
    createdAt: "2026-10-21T09:00:00Z",
    destructiveCategory: null,
    suggestedRule: "Bash(ls)",
    sessionId: "run-q",
    projectId: "p1",
    projectName: "Flywheel",
    projectKeyPrefix: "FLY",
    storyId: "s-run",
    storyKey: "FLY-2",
    storyTitle: "Running one",
    blockedSince: "2026-10-21T09:00:00Z",
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BlockedQueue entries={[entry]} now={Date.now()} />
    </QueryClientProvider>,
  );
}
