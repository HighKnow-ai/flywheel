/**
 * Behavior under test (plan 09-09 Task 2): the epic row's dispatch controls are a function of the
 * plan state the core reports. Every action is one call; the next state is the response's, never a
 * local guess; Stop confirms; and pause and stop say plainly that running sessions are not touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EpicDispatchControls } from "../EpicDispatchControls";
import { useUiStore } from "../../state/uiStore";
import type { DispatchPlanDto, DispatchTaskDto, PlanningRunDto } from "../../adapters/tauri";

const getMock = vi.fn();
const runMock = vi.fn();
const generateMock = vi.fn();
const pauseMock = vi.fn();
const resumeMock = vi.fn();
const stopMock = vi.fn();
const gateMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    dispatchPlanGet: (epicId: string) => getMock(epicId),
    dispatchPlanningRun: (epicId: string) => runMock(epicId),
    dispatchPlanGenerate: (epicId: string) => generateMock(epicId),
    dispatchPlanPause: (planId: string) => pauseMock(planId),
    dispatchPlanResume: (planId: string) => resumeMock(planId),
    dispatchPlanStop: (planId: string) => stopMock(planId),
    dispatchGateState: () => gateMock(),
    getSettings: () => Promise.resolve({ dispatchCap: { maxParallel: 4, occupiedSlots: 2 } }),
    subscribeDispatchGateChanged: () => Promise.resolve(() => {}),
  };
});

function task(taskId: string, wave: number, state = "planned"): DispatchTaskDto {
  return { taskId, taskKey: taskId.toUpperCase(), title: `Title ${taskId}`, wave, state, rationale: null, attention: null, entries: [] };
}

function plan(status: string, overrides: Partial<DispatchPlanDto> = {}): DispatchPlanDto {
  return {
    id: "plan-1",
    epicId: "epic-1",
    status,
    waveCursor: 2,
    edgesFrozen: status !== "draft",
    tasks: [task("t1", 1, "merged"), task("t2", 2, "running"), task("t3", 3)],
    edges: [],
    ...overrides,
  };
}

async function mount(current: DispatchPlanDto | null, run: PlanningRunDto | null = null) {
  getMock.mockReset().mockResolvedValue(current);
  runMock.mockReset().mockResolvedValue(run);
  generateMock.mockReset();
  pauseMock.mockReset();
  resumeMock.mockReset();
  stopMock.mockReset();
  gateMock.mockReset().mockResolvedValue({ state: "open", message: "Dispatch is open.", resumeAt: null });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <EpicDispatchControls epicId="epic-1" />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(getMock).toHaveBeenCalled());
  await waitFor(() => expect(runMock).toHaveBeenCalled());
  return utils;
}

beforeEach(() => {
  useUiStore.setState({ wavePlanSheetEpicId: null });
});

describe("EpicDispatchControls", () => {
  it("offers plan-fan-out, no wave position and no pause for an epic with no live plan", async () => {
    await mount(null);
    expect(await screen.findByRole("button", { name: "Plan fan-out" })).toBeInTheDocument();
    expect(screen.queryByText(/Wave \d/)).toBeNull();
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
  });

  it("treats a completed or aborted plan as no live plan", async () => {
    await mount(plan("completed"));
    expect(await screen.findByRole("button", { name: "Plan fan-out" })).toBeInTheDocument();
    expect(screen.queryByText(/Wave \d/)).toBeNull();
  });

  it("issues exactly one generate call and ignores a second click while it is in flight", async () => {
    await mount(null);
    let resolve: (r: PlanningRunDto) => void = () => {};
    generateMock.mockReturnValue(new Promise<PlanningRunDto>((r) => (resolve = r)));
    const button = await screen.findByRole("button", { name: "Plan fan-out" });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(generateMock).toHaveBeenCalledTimes(1);
    expect(generateMock).toHaveBeenCalledWith("epic-1");
    await act(async () => resolve({ runId: "run-1", epicId: "epic-1" }));
  });

  it("shows the refusal text when the core will not plan this epic", async () => {
    await mount(null);
    generateMock.mockRejectedValue("epic has nothing to plan: no backlog or todo tasks");
    fireEvent.click(await screen.findByRole("button", { name: "Plan fan-out" }));
    expect(await screen.findByText(/nothing to plan/)).toBeInTheDocument();
  });

  it("shows a running planning run as in progress, not as a blank draft and not as an offer to plan again", async () => {
    await mount(null, { runId: "run-1", epicId: "epic-1" });
    expect(await screen.findByText(/Planning in progress/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Plan fan-out" })).toBeNull();
    expect(screen.queryByRole("button", { name: /Review plan/ })).toBeNull();
  });

  it("offers review for a draft and opens the sheet for this epic", async () => {
    await mount(plan("draft"));
    fireEvent.click(await screen.findByRole("button", { name: "Review plan" }));
    expect(useUiStore.getState().wavePlanSheetEpicId).toBe("epic-1");
    expect(screen.queryByRole("button", { name: /Pause/ })).toBeNull();
    expect(screen.queryByText(/Wave \d/)).toBeNull();
  });

  it("shows a running plan's wave position and the cap's real occupancy, with pause and stop", async () => {
    await mount(plan("running"));
    expect(await screen.findByText("Wave 2 of 3")).toBeInTheDocument();
    expect(await screen.findByText(/2 of 4 agent slots in use/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
  });

  it("offers resume and stop, and no pause, for a paused plan", async () => {
    await mount(plan("paused"));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  });

  it("issues one pause call and shows the state the response reports", async () => {
    await mount(plan("running"));
    let resolve: (p: DispatchPlanDto) => void = () => {};
    pauseMock.mockReturnValue(new Promise<DispatchPlanDto>((r) => (resolve = r)));
    const pause = await screen.findByRole("button", { name: "Pause" });
    fireEvent.click(pause);
    await waitFor(() => expect(pause).toBeDisabled());
    fireEvent.click(pause);
    expect(pauseMock).toHaveBeenCalledTimes(1);
    expect(pauseMock).toHaveBeenCalledWith("plan-1");
    // Nothing flips until the response arrives.
    expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
    await act(async () => resolve(plan("paused")));
    expect(await screen.findByRole("button", { name: "Resume" })).toBeInTheDocument();
  });

  it("keeps the old state when the core refuses the pause", async () => {
    await mount(plan("running"));
    pauseMock.mockRejectedValue("plan is completed; it cannot be paused");
    fireEvent.click(await screen.findByRole("button", { name: "Pause" }));
    expect(await screen.findByText(/cannot be paused/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
  });

  it("issues one resume call", async () => {
    await mount(plan("paused"));
    resumeMock.mockResolvedValue(plan("running"));
    fireEvent.click(await screen.findByRole("button", { name: "Resume" }));
    await waitFor(() => expect(resumeMock).toHaveBeenCalledTimes(1));
    expect(resumeMock).toHaveBeenCalledWith("plan-1");
  });

  it("asks before stopping and issues no call until the confirmation is accepted", async () => {
    await mount(plan("running"));
    stopMock.mockResolvedValue(plan("aborted"));
    fireEvent.click(await screen.findByRole("button", { name: "Stop" }));
    expect(stopMock).not.toHaveBeenCalled();
    expect(screen.getByText(/Running sessions keep going/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Keep the plan" }));
    expect(stopMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    fireEvent.click(screen.getByRole("button", { name: "Stop the fan-out" }));
    await waitFor(() => expect(stopMock).toHaveBeenCalledTimes(1));
    expect(stopMock).toHaveBeenCalledWith("plan-1");
  });

  it("says in the pause wording that running sessions are not stopped", async () => {
    await mount(plan("running"));
    const pause = await screen.findByRole("button", { name: "Pause" });
    expect(pause).toHaveAttribute("title", expect.stringMatching(/running sessions are not stopped/i));
  });

  it("names a stuck task in the current wave so a blocked wave does not look like a slow one", async () => {
    const stuck = plan("running");
    stuck.tasks[1] = { ...stuck.tasks[1], state: "needs_attention", attention: "2 files are uncommitted" };
    await mount(stuck);
    expect(await screen.findByText(/1 stuck: T2/)).toBeInTheDocument();
  });

  it("says nothing about stuck tasks when none is", async () => {
    await mount(plan("running"));
    await screen.findByText("Wave 2 of 3");
    expect(screen.queryByText(/stuck/)).toBeNull();
  });

  it("shows the gate's reason and its action on a running plan, where the user looks when it seems stalled", async () => {
    await mount(plan("running"));
    gateMock.mockResolvedValue({ state: "paused", message: "The weekly allowance is used up.", resumeAt: null });
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <EpicDispatchControls epicId="epic-1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("The weekly allowance is used up.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Resume now" })).toBeInTheDocument();
  });

  it("shows no gate line on a draft, which is not starting any work", async () => {
    gateMock.mockResolvedValue({ state: "paused", message: "The weekly allowance is used up.", resumeAt: null });
    await mount(plan("draft"));
    await screen.findByRole("button", { name: "Review plan" });
    gateMock.mockResolvedValue({ state: "paused", message: "The weekly allowance is used up.", resumeAt: null });
    expect(screen.queryByText("The weekly allowance is used up.")).toBeNull();
  });
});
