/**
 * Behavior under test (plan 11-11 Task 2, D-REV-41): a task whose run failed, was stopped, or whose
 * automatic merge found a conflict holds its wave. The wave plan sheet says why it is stuck and
 * offers the two ways out, Retry and Skip. Both are the Rust core's verbs: the sheet calls them once
 * and shows what the core answers, including a refusal in the core's own words.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WavePlanSheet } from "../WavePlanSheet";
import type { DispatchPlanDto, DispatchTaskDto } from "../../adapters/tauri";

const getMock = vi.fn();
const retryMock = vi.fn();
const skipMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    dispatchPlanGet: (epicId: string) => getMock(epicId),
    retryTask: (taskId: string) => retryMock(taskId),
    skipTask: (taskId: string) => skipMock(taskId),
  };
});

const FAILED_CAUSE = "The run failed, so this task holds its wave. Retry starts it again; Skip leaves it out.";
const STOPPED_CAUSE = "The run was stopped before it finished, so this task holds its wave.";
const CONFLICT_CAUSE = "Merging into flywheel/epic-1 found a conflict in shared.txt, so nothing landed.";

function task(overrides: Partial<DispatchTaskDto> & Pick<DispatchTaskDto, "taskId" | "taskKey">): DispatchTaskDto {
  return {
    title: `Title of ${overrides.taskKey}`,
    wave: 1,
    state: "merged",
    rationale: null,
    attention: null,
    entries: [],
    ...overrides,
  };
}

function plan(overrides: Partial<DispatchPlanDto> = {}): DispatchPlanDto {
  return {
    id: "plan-1",
    epicId: "epic-1",
    status: "running",
    waveCursor: 1,
    edgesFrozen: true,
    tasks: [
      task({ taskId: "t1", taskKey: "FLY-1", state: "failed", attention: FAILED_CAUSE }),
      task({ taskId: "t2", taskKey: "FLY-2", state: "stopped", attention: STOPPED_CAUSE }),
      task({ taskId: "t3", taskKey: "FLY-3", state: "conflict", attention: CONFLICT_CAUSE }),
      task({ taskId: "t4", taskKey: "FLY-4", state: "merged" }),
      task({ taskId: "t5", taskKey: "FLY-5", state: "running" }),
    ],
    edges: [],
    ...overrides,
  };
}

async function loaded(p: DispatchPlanDto = plan()) {
  getMock.mockReset().mockResolvedValue(p);
  retryMock.mockReset();
  skipMock.mockReset();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <WavePlanSheet epicId="epic-1" onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  await screen.findByRole("region", { name: "Wave 1" });
}

const row = (name: string) => screen.getByRole("listitem", { name });

describe("a stuck task in the wave plan sheet", () => {
  it("says why each of the three stuck states is stuck, in the core's words", async () => {
    await loaded();
    expect(within(row("FLY-1 Title of FLY-1")).getByText(FAILED_CAUSE)).toBeInTheDocument();
    expect(within(row("FLY-2 Title of FLY-2")).getByText(STOPPED_CAUSE)).toBeInTheDocument();
    expect(within(row("FLY-3 Title of FLY-3")).getByText(CONFLICT_CAUSE)).toBeInTheDocument();
  });

  it("offers Retry and Skip on the three stuck states and on nothing else", async () => {
    await loaded();
    for (const key of ["FLY-1", "FLY-2", "FLY-3"]) {
      expect(screen.getByRole("button", { name: `Retry ${key}` })).toBeEnabled();
      expect(screen.getByRole("button", { name: `Skip ${key}` })).toBeEnabled();
    }
    for (const key of ["FLY-4", "FLY-5"]) {
      expect(screen.queryByRole("button", { name: `Retry ${key}` })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: `Skip ${key}` })).not.toBeInTheDocument();
    }
  });

  it("calls retryTask exactly once with the task id, and shows the plan the core returns", async () => {
    await loaded();
    retryMock.mockResolvedValue(
      plan({
        tasks: [
          task({ taskId: "t1", taskKey: "FLY-1", state: "planned" }),
          task({ taskId: "t2", taskKey: "FLY-2", state: "stopped", attention: STOPPED_CAUSE }),
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry FLY-1" }));
    await waitFor(() => expect(within(row("FLY-1 Title of FLY-1")).getByText("Planned")).toBeInTheDocument());
    expect(retryMock).toHaveBeenCalledTimes(1);
    expect(retryMock).toHaveBeenCalledWith("t1");
    expect(skipMock).not.toHaveBeenCalled();
  });

  it("calls skipTask exactly once with the task id", async () => {
    await loaded();
    skipMock.mockResolvedValue(
      plan({ tasks: [task({ taskId: "t3", taskKey: "FLY-3", state: "skipped" })] }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Skip FLY-3" }));
    await waitFor(() => expect(within(row("FLY-3 Title of FLY-3")).getByText("Left out")).toBeInTheDocument());
    expect(skipMock).toHaveBeenCalledTimes(1);
    expect(skipMock).toHaveBeenCalledWith("t3");
    expect(retryMock).not.toHaveBeenCalled();
  });

  it("renders a refusal's own reason on that task, not a fixed string", async () => {
    await loaded();
    // A Tauri rejection is a bare string.
    retryMock.mockRejectedValue("That task has a run in progress. Stop the run first, then retry or skip it.");
    fireEvent.click(screen.getByRole("button", { name: "Retry FLY-2" }));
    const alert = await within(row("FLY-2 Title of FLY-2")).findByRole("alert");
    expect(alert).toHaveTextContent("That task has a run in progress. Stop the run first, then retry or skip it.");
    expect(within(row("FLY-1 Title of FLY-1")).queryByRole("alert")).not.toBeInTheDocument();

    skipMock.mockRejectedValue("Only a task whose run failed, was stopped, or whose merge found a conflict can be retried or skipped.");
    fireEvent.click(screen.getByRole("button", { name: "Skip FLY-2" }));
    await waitFor(() =>
      expect(within(row("FLY-2 Title of FLY-2")).getByRole("alert")).toHaveTextContent(/^Only a task whose run failed/),
    );
  });
});
