/**
 * Behavior under test (Phase 10 plan 10-06, FLEET-03, D-166):
 * - The subject key is a distinct secondary target with its own key (`b`): it switches to the row's
 *   project and hands the board a one-shot focus request, never also opens the session, and is absent
 *   on a row with no board subject. A jump into another project lands on the item, end to end.
 * - Enter and a click on a fleet row open that run's session, handing the opener all four identifiers
 *   (run id, task id, authoring stage, epic id) plus the row's mapped status, in one call (Finding 10,
 *   Pitfall 7).
 * - The fleet surface never clears itself before opening a session, so the session's own back action
 *   lands on the fleet (RESEARCH Pattern 4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetListDto, FleetRowDto } from "../../adapters/tauri";
import { resetUiState, useUiStore } from "../../state/uiStore";
import appSource from "../../App.tsx?raw";
import { FleetSurface } from "../FleetSurface";
import { BoardView } from "../../board/BoardView";
import { showStatusBands } from "../../board/__tests__/lens";
import type { BoardItem } from "../../board/useBoardQuery";

const fleetListMock = vi.fn<() => Promise<FleetListDto>>();
const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
    gitFacts: () => Promise.resolve(null),
    gitTruthFocusTask: () => Promise.resolve(),
    fleetList: () => fleetListMock(),
    fleetBlockedQueue: () => Promise.resolve([]),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    acknowledgeAgentRun: () => Promise.resolve(),
    agentRunAcknowledgeMany: () => Promise.resolve(),
  };
});

function row(overrides: Partial<FleetRowDto>): FleetRowDto {
  return {
    agentRunId: "run-1",
    projectId: "proj-1",
    projectName: "Alpha",
    projectKeyPrefix: "ALP",
    projectStatus: "active",
    subjectKind: "task",
    taskId: "task-1",
    taskKey: "ALP-1",
    taskTitle: "Wire the thing",
    taskStatus: "in_progress",
    epicId: null,
    epicKey: null,
    authoringStage: null,
    runStatus: "running",
    fleetState: "running",
    startedAt: new Date(Date.now() - 125_000).toISOString(),
    endedAt: null,
    blockedSince: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    activity: { lines: [], truncated: false },
    ...overrides,
  };
}

function list(rows: FleetRowDto[]): FleetListDto {
  return { rows, totalRows: rows.length, visibleCostUsd: null };
}

/** The real setters, wrapped so a test can assert what the surface called and with what. */
function spyOnStore() {
  const original = useUiStore.getState();
  const setActiveAgentRunId = vi.fn(original.setActiveAgentRunId);
  const setFleetSurface = vi.fn(original.setFleetSurface);
  const setCurrentProjectId = vi.fn(original.setCurrentProjectId);
  useUiStore.setState({ setActiveAgentRunId, setFleetSurface, setCurrentProjectId });
  return { setActiveAgentRunId, setFleetSurface, setCurrentProjectId };
}

async function renderFleet(rows: FleetRowDto[]) {
  fleetListMock.mockResolvedValue(list(rows));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FleetSurface onClose={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.container.querySelector("[data-run-id]")).not.toBeNull());
  return view;
}

function rowFor(container: HTMLElement, runId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-run-id="${runId}"]`);
  if (!el) throw new Error(`no row for ${runId}`);
  return el;
}

beforeEach(() => {
  resetUiState();
  fleetListMock.mockReset();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) =>
    Promise.resolve(command === "actor_list" || command === "project_list" ? [] : undefined),
  );
  useUiStore.setState({ fleetSurface: { view: "fleet" } });
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe("the primary target: a row opens that run's session", () => {
  it("Enter on a selected task row opens the session with all four identifiers and the row's status", async () => {
    const spies = spyOnStore();
    await renderFleet([row({ agentRunId: "run-t", taskId: "task-9", epicId: null, authoringStage: null })]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(spies.setActiveAgentRunId).toHaveBeenCalledTimes(1);
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-t", "task-9", null, null, null, "running");
  });

  it("a click on the row does the same thing as Enter", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ agentRunId: "run-t", taskId: "task-9" })]);
    fireEvent.click(rowFor(container, "run-t"));
    expect(spies.setActiveAgentRunId).toHaveBeenCalledTimes(1);
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-t", "task-9", null, null, null, "running");
  });

  it("an epic-subject authoring row carries the epic id and the stage, with a null task id", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({
        agentRunId: "run-a",
        subjectKind: "authoring",
        taskId: null,
        taskKey: null,
        taskTitle: null,
        taskStatus: null,
        epicId: "epic-3",
        epicKey: "ALP-E3",
        authoringStage: "challenge",
      }),
    ]);
    fireEvent.click(rowFor(container, "run-a"));
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-a", null, "challenge", "epic-3", null, "running");
  });

  it("a row with neither task nor epic opens its session with nulls and does not throw", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({
        agentRunId: "run-n",
        subjectKind: "authoring",
        taskId: null,
        taskKey: null,
        taskTitle: null,
        taskStatus: null,
        epicId: null,
        epicKey: null,
        authoringStage: null,
      }),
    ]);
    expect(() => fireEvent.click(rowFor(container, "run-n"))).not.toThrow();
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-n", null, null, null, null, "running");
  });

  it("a failed row hands the session its failed status, not the running default", async () => {
    const { container } = await renderFleet([
      row({ agentRunId: "run-f", runStatus: "failed", fleetState: "failed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-f"));
    expect(useUiStore.getState().activeAgentRunId).toBe("run-f");
    expect(useUiStore.getState().activeAgentRunInitialStatus).toBe("failed");
    // The shell reads that field and passes it down; without this the status is dropped on the way.
    expect(appSource).toMatch(/initialStatus=\{activeAgentRunInitialStatus\}/);
  });

  it("an awaiting-review row opens as the completed run it is", async () => {
    const { container } = await renderFleet([
      row({ agentRunId: "run-r", runStatus: "completed", fleetState: "awaiting_review", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-r"));
    expect(useUiStore.getState().activeAgentRunInitialStatus).toBe("completed");
  });

  it("Dismiss is its own action and never also opens the session", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ agentRunId: "run-d", runStatus: "completed", fleetState: "completed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(within(rowFor(container, "run-d")).getByRole("button", { name: /Dismiss/ }));
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
  });

  it("opening a session leaves the fleet open, so popping the session lands on the fleet", async () => {
    const { container } = await renderFleet([row({ agentRunId: "run-t" })]);
    fireEvent.click(rowFor(container, "run-t"));
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    // The shell's order: the session branch precedes the fleet branch...
    expect(appSource.indexOf("activeAgentRunId ? (")).toBeGreaterThan(-1);
    expect(appSource.indexOf("activeAgentRunId ? (")).toBeLessThan(appSource.indexOf("fleetSurface ? ("));
    // ...so clearing the run, with the fleet field still set, leaves the fleet as the thing to render.
    act(() => useUiStore.getState().setActiveAgentRunId(null));
    const state = useUiStore.getState();
    expect(state.activeAgentRunId).toBeNull();
    expect(state.fleetSurface).not.toBeNull();
  });

  it("does nothing on Enter when no row is selected", async () => {
    const spies = spyOnStore();
    await renderFleet([row({ agentRunId: "run-t" })]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

const NO_SUBJECT = {
  subjectKind: "authoring" as const,
  taskId: null,
  taskKey: null,
  taskTitle: null,
  taskStatus: null,
  epicId: null,
  epicKey: null,
  authoringStage: null,
};

describe("the secondary target: the subject key reaches its board item", () => {
  it("activating it in another project switches the project and hands the board a focus request", async () => {
    useUiStore.setState({ currentProjectId: "proj-A" });
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ agentRunId: "run-b", projectId: "proj-B", projectName: "Beta", taskId: "task-b7", taskKey: "BET-7" }),
    ]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    expect(spies.setCurrentProjectId).toHaveBeenCalledWith("proj-B");
    const state = useUiStore.getState();
    expect(state.currentProjectId).toBe("proj-B");
    expect(state.pendingFocusItemId).toBe("task-b7");
    expect(state.fleetSurface).toBeNull();
  });

  it("activating it does not also open the session", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ agentRunId: "run-b", taskId: "task-b7", taskKey: "BET-7" })]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeAgentRunId).toBeNull();
  });

  it("end to end: a row in project B, activated while A is current, lands on that item's detail", async () => {
    useUiStore.setState({ currentProjectId: "proj-A", selectedItemId: "a-1", detailItemId: "a-1" });
    const { container, unmount } = await renderFleet([
      row({ agentRunId: "run-b", projectId: "proj-B", projectName: "Beta", taskId: "task-b7", taskKey: "BET-7" }),
    ]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    unmount();

    // The shell now renders the board for the current project; the request is still waiting for it.
    const projectId = useUiStore.getState().currentProjectId as string;
    expect(projectId).toBe("proj-B");
    showStatusBands();
    const items: BoardItem[] = [
      { id: "task-b7", key: "BET-7", title: "Beta seven", status: "backlog", rank: "10", priority: 0, epicId: null },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardView
          projectId={projectId}
          items={items}
          counts={{ backlog: 1, todo: 0, inProgress: 0, inReview: 0, done: 0 }}
          onCreateTask={() => {}}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("task-b7"));
    expect(useUiStore.getState().selectedItemId).toBe("task-b7");
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("an epic-subject row targets the epic, and opens the epic's detail rather than a review", async () => {
    const { container } = await renderFleet([
      row({
        agentRunId: "run-e",
        subjectKind: "epic",
        taskId: null,
        taskKey: null,
        taskTitle: null,
        taskStatus: null,
        epicId: "epic-4",
        epicKey: "ALP-E4",
      }),
    ]);
    fireEvent.click(within(rowFor(container, "run-e")).getByRole("button", { name: /Open ALP-E4 on the board/ }));
    expect(useUiStore.getState().pendingFocusItemId).toBe("epic-4");
    expect(useUiStore.getState().reviewSurface).toBeNull();
  });

  it("a row with no task and no epic renders no target element at all, and `b` does nothing on it", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ agentRunId: "run-n", ...NO_SUBJECT })]);
    expect(container.querySelector("[data-subject-target]")).toBeNull();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "b" });
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
    expect(spies.setCurrentProjectId).not.toHaveBeenCalled();
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    // The session is still reachable from it.
    fireEvent.click(rowFor(container, "run-n"));
    expect(spies.setActiveAgentRunId).toHaveBeenCalledTimes(1);
  });

  it("a row in an unreachable project exposes no target, because its board is not there to land on", async () => {
    const { container } = await renderFleet([row({ agentRunId: "run-u", projectStatus: "unreachable" })]);
    expect(container.querySelector("[data-subject-target]")).toBeNull();
  });

  it("`b` reaches the selected row's item whatever its position, and never opens the session", async () => {
    const spies = spyOnStore();
    await renderFleet([
      row({ agentRunId: "run-1", taskId: "task-1", taskKey: "ALP-1" }),
      row({ agentRunId: "run-2", taskId: "task-2", taskKey: "ALP-2" }),
      row({ agentRunId: "run-3", projectId: "proj-C", taskId: "task-3", taskKey: "CHA-3" }),
    ]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "b" });
    expect(useUiStore.getState().pendingFocusItemId).toBe("task-3");
    expect(useUiStore.getState().currentProjectId).toBe("proj-C");
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
  });

  it("two rows for the same task each open their own run's session and both resolve the same item", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ agentRunId: "run-x", taskId: "task-1", taskKey: "ALP-1", runStatus: "failed", fleetState: "failed" }),
      row({ agentRunId: "run-y", taskId: "task-1", taskKey: "ALP-1", runStatus: "running", fleetState: "running" }),
    ]);
    fireEvent.click(rowFor(container, "run-x"));
    fireEvent.click(rowFor(container, "run-y"));
    expect(spies.setActiveAgentRunId.mock.calls.map((c) => c[0])).toEqual(["run-x", "run-y"]);
    for (const id of ["run-x", "run-y"]) {
      useUiStore.getState().setPendingFocusItemId(null);
      fireEvent.click(within(rowFor(container, id)).getByRole("button", { name: /Open ALP-1 on the board/ }));
      expect(useUiStore.getState().pendingFocusItemId).toBe("task-1");
    }
  });
});
