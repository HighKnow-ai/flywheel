/**
 * Behavior under test (Phase 10 plan 10-06, FLEET-03, D-166):
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

const fleetListMock = vi.fn<() => Promise<FleetListDto>>();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
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
