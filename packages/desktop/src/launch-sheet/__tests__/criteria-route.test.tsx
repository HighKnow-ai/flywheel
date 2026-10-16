/**
 * Behavior under test (phase 15 plan 06, D-11/D-12/D-13): a run on a task with no criteria routes
 * through drafting INSIDE the launch sheet and does not dispatch until the contract is decided; a
 * pending draft keeps the sheet in that state without drafting again; and "Proceed without
 * criteria" is one recorded call, never a hidden one. Start Work is what is blocked, never the task.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LaunchSheet } from "../LaunchSheet";

const previewMock = vi.fn();
const startMock = vi.fn();
const coverageMock = vi.fn();
const waiveMock = vi.fn();
const invokeMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    previewContextPacket: (taskId: string) => previewMock(taskId),
    startAgentRun: (taskId: string, mode: string, instruction?: string) => startMock(taskId, mode, instruction),
    taskCriterionCoverage: (taskId: string) => coverageMock(taskId),
    waiveTaskCriteria: (taskId: string) => waiveMock(taskId),
    invokeCommand: (command: string, args?: Record<string, unknown>) => invokeMock(command, args),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

function packet() {
  return {
    taskKey: "FLY-42",
    taskTitle: "Wire the launch sheet",
    taskDescription: null,
    epicTitle: null,
    epicDescription: null,
    criteria: [],
    summaries: [],
    compaction: { total: 0, foldedCount: 0, verbatimCount: 0, foldedRange: null, verbatimRange: null, sentence: null },
    decisions: [],
    drift: [],
    branch: "flywheel/fly-42",
    baseRef: "main",
    worktreePath: "/w/FLY-42",
    diff: null,
    renderedPrompt: "# Wire the launch sheet",
  };
}

function coverage(currentCount: number, pendingDraftCount: number) {
  return {
    currentCount,
    pendingDraftCount,
    hasCoverage: currentCount > 0 || pendingDraftCount > 0,
    judgementOnlyCount: 0,
    projectId: "project-1",
  };
}

/** The criteria list's own reads, so the composed `AcceptanceCriteriaList` renders. */
function installInvoke(criteria: unknown[] = []) {
  invokeMock.mockReset().mockImplementation((command: string) => {
    if (command === "criterion_list") return Promise.resolve(criteria);
    if (command === "review_criteria_state") return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
}

const READS = new Set(["criterion_list", "review_criteria_state"]);
const mutationsIssued = () => invokeMock.mock.calls.filter(([command]) => !READS.has(command as string));

function renderSheet() {
  const onClose = vi.fn();
  const onStarted = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LaunchSheet taskId="task-1" onClose={onClose} onStarted={onStarted} />
    </QueryClientProvider>,
  );
  return { onClose, onStarted };
}

const startWork = () => screen.getByRole("button", { name: "Start Work" });

beforeEach(() => {
  previewMock.mockReset().mockResolvedValue(packet());
  startMock.mockReset().mockResolvedValue({ id: "run-1" });
  coverageMock.mockReset();
  waiveMock.mockReset().mockResolvedValue(undefined);
  installInvoke();
});

describe("launch sheet criteria route", () => {
  it("blocks Start Work, names why, and issues no run when the task has no criteria", async () => {
    coverageMock.mockResolvedValue(coverage(0, 0));
    renderSheet();

    await waitFor(() => expect(screen.getByText(/no acceptance criteria/i)).toBeInTheDocument());
    expect(startWork()).toBeDisabled();

    fireEvent.click(startWork());
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Launch sheet" }), { key: "Enter", metaKey: true });
    expect(startMock).not.toHaveBeenCalled();
  });

  it("composes AcceptanceCriteriaList itself, not a sheet-local editor", async () => {
    coverageMock.mockResolvedValue(coverage(0, 0));
    renderSheet();

    // Only AcceptanceCriteriaList renders this statement input (autoOpenWhenEmpty).
    expect(await screen.findByLabelText("New criterion statement")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Acceptance criteria" })).toBeInTheDocument();
  });

  it("shows no drafting route and enables Start Work once a criterion is current", async () => {
    coverageMock.mockResolvedValue(coverage(1, 0));
    renderSheet();

    await waitFor(() => expect(coverageMock).toHaveBeenCalled());
    await waitFor(() => expect(startWork()).toBeEnabled());
    expect(screen.queryByRole("region", { name: "Acceptance criteria" })).not.toBeInTheDocument();
    expect(screen.queryByText(/no acceptance criteria/i)).not.toBeInTheDocument();
  });

  it("keeps Start Work blocked on a pending draft and drafts nothing again", async () => {
    coverageMock.mockResolvedValue(coverage(0, 1));
    const view = renderSheet();

    await waitFor(() => expect(screen.getByText(/waiting for your decision/i)).toBeInTheDocument());
    expect(startWork()).toBeDisabled();
    view.onClose.mockClear();

    // Re-render churn: a late refetch of the coverage must not issue any write.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mutationsIssued()).toEqual([]);
    expect(waiveMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });

  it("records the waiver once under two synchronous activations, then enables Start Work", async () => {
    coverageMock.mockResolvedValue(coverage(0, 0));
    renderSheet();

    const proceed = await screen.findByRole("button", { name: "Proceed without criteria" });
    fireEvent.click(proceed);
    fireEvent.click(proceed);

    await waitFor(() => expect(startWork()).toBeEnabled());
    expect(waiveMock).toHaveBeenCalledTimes(1);
    expect(waiveMock).toHaveBeenCalledWith("task-1");
  });

  it.each([
    ["a hand-made task", coverage(0, 0)],
    ["an agent-proposed task with a draft waiting", coverage(0, 1)],
  ])("takes the same route for %s", async (_label, response) => {
    coverageMock.mockResolvedValue(response);
    renderSheet();

    expect(await screen.findByRole("region", { name: "Acceptance criteria" })).toBeInTheDocument();
    expect(startWork()).toBeDisabled();
    expect(screen.getByRole("button", { name: "Proceed without criteria" })).toBeEnabled();
  });

  it("issues no mutation when the sheet is opened and cancelled", async () => {
    coverageMock.mockResolvedValue(coverage(0, 0));
    const { onClose } = renderSheet();

    await screen.findByRole("region", { name: "Acceptance criteria" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mutationsIssued()).toEqual([]);
    expect(waiveMock).not.toHaveBeenCalled();
    expect(startMock).not.toHaveBeenCalled();
  });
});
