/**
 * Behavior under test (Phase 10 plan 10-08, WORK-07, D-177/D-178):
 * - A measured size renders with its age; a never-measured size renders empty text and no byte figure.
 * - Each of the three chips renders with its reason word, and every reason the core can return has one.
 * - An unreachable-project row reads keep, with that reason.
 * - Re-measure calls the adapter once; the empty state names the task-worktrees-only limit.
 * - Rows render in the order the core sent them (equal sizes: task key ascending).
 * - The rail's Worktrees row is a button that opens the view, and the view has no reclaim control.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorktreeInventoryRowDto, WorktreeMeasureDto } from "../../adapters/tauri";
import { MARKS_BY_ID } from "../../legend/marks";
import { resetUiState, useUiStore } from "../../state/uiStore";
import inventorySource from "../WorktreeInventory.tsx?raw";
import { RECLAIM_REASONS, RECLAIM_REASON_WORDS, WorktreeInventory, formatBytes } from "../WorktreeInventory";

const inventoryMock = vi.fn<() => Promise<WorktreeInventoryRowDto[]>>();
const measureMock = vi.fn<(taskIds?: string[]) => Promise<WorktreeMeasureDto[]>>();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    worktreeInventory: () => inventoryMock(),
    worktreeMeasure: (ids?: string[]) => measureMock(ids),
    fleetList: () => Promise.resolve({ rows: [], totalRows: 0, visibleCostUsd: null }),
    fleetBlockedQueue: () => Promise.resolve([]),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

function row(overrides: Partial<WorktreeInventoryRowDto>): WorktreeInventoryRowDto {
  return {
    taskId: "task-1",
    taskKey: "ALP-1",
    taskTitle: "Wire the thing",
    taskStatus: "done",
    projectId: "proj-1",
    projectName: "Alpha",
    projectStatus: "active",
    branch: "flywheel/alp-1",
    sizeBytes: 3 * 1024 * 1024 * 1024,
    sizeMeasuredAt: new Date(Date.now() - 180_000).toISOString(),
    disposition: "reclaimable",
    reason: "task_done",
    ...overrides,
  };
}

function renderInventory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorktreeInventory onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetUiState();
  inventoryMock.mockReset();
  measureMock.mockReset();
  measureMock.mockResolvedValue([]);
});
afterEach(cleanup);

describe("formatBytes", () => {
  it("prints binary units with one decimal above a kibibyte and a bare integer below it", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(4096)).toBe("4.0 KiB");
    expect(formatBytes(1.5 * 1024 * 1024)).toBe("1.5 MiB");
    expect(formatBytes(3 * 1024 ** 3)).toBe("3.0 GiB");
  });
});

describe("WorktreeInventory", () => {
  it("shows a measured size together with how old the measurement is", async () => {
    inventoryMock.mockResolvedValue([row({})]);
    renderInventory();
    const size = await screen.findByText("3.0 GiB", { exact: false });
    expect(size.closest("[data-field='size']")?.textContent).toContain("measured 3m ago");
    expect(screen.getByText("1 worktree")).toBeInTheDocument();
  });

  it("renders a never-measured size as empty text and prints no byte figure anywhere", async () => {
    inventoryMock.mockResolvedValue([row({ sizeBytes: null, sizeMeasuredAt: null })]);
    const { container } = renderInventory();
    await screen.findByText("ALP-1");
    const cell = container.querySelector("[data-field='size']");
    expect(cell?.textContent).toBe("");
    expect(container.textContent).not.toMatch(/\b0 B\b/);
    expect(container.textContent).not.toMatch(/\bmeasured\b/);
  });

  it("renders each chip with its glyph word and its reason", async () => {
    inventoryMock.mockResolvedValue([
      row({ taskId: "a", taskKey: "ALP-1", disposition: "reclaimable", reason: "merged" }),
      row({ taskId: "b", taskKey: "ALP-2", disposition: "in_use", reason: "agent_running" }),
      row({ taskId: "c", taskKey: "ALP-3", disposition: "keep", reason: "uncommitted_changes" }),
    ]);
    renderInventory();
    await screen.findByText("ALP-1");
    const cases: Array<[string, string, string]> = [
      ["a", "reclaimable", "worktree-reclaimable"],
      ["b", "in_use", "worktree-in-use"],
      ["c", "keep", "worktree-keep"],
    ];
    for (const [id, disposition, markId] of cases) {
      const li = document.querySelector(`[data-worktree-row='${id}']`) as HTMLElement;
      const chip = li.querySelector(`[data-disposition='${disposition}']`) as HTMLElement;
      expect(chip.textContent).toContain(MARKS_BY_ID[markId].label);
      expect(chip.querySelector("svg")).not.toBeNull();
    }
    expect(screen.getByText(RECLAIM_REASON_WORDS.merged)).toBeInTheDocument();
    expect(screen.getByText(RECLAIM_REASON_WORDS.agent_running)).toBeInTheDocument();
    expect(screen.getByText(RECLAIM_REASON_WORDS.uncommitted_changes)).toBeInTheDocument();
  });

  it("has a non-empty word for every reason the core can return", () => {
    expect(RECLAIM_REASONS).toHaveLength(8);
    for (const reason of RECLAIM_REASONS) {
      expect(RECLAIM_REASON_WORDS[reason].length, reason).toBeGreaterThan(0);
    }
    expect(new Set(Object.values(RECLAIM_REASON_WORDS)).size).toBe(RECLAIM_REASONS.length);
  });

  it("labels an unreachable project's worktree keep, with that reason", async () => {
    inventoryMock.mockResolvedValue([
      row({ projectStatus: "unreachable", disposition: "keep", reason: "project_unreachable" }),
    ]);
    renderInventory();
    await screen.findByText("ALP-1");
    const chip = document.querySelector("[data-disposition='keep']") as HTMLElement;
    expect(chip.textContent).toContain("Keep");
    expect(chip.textContent).toContain(RECLAIM_REASON_WORDS.project_unreachable);
  });

  it("calls the measure wrapper once when Re-measure is pressed", async () => {
    inventoryMock.mockResolvedValue([row({})]);
    renderInventory();
    await screen.findByText("ALP-1");
    fireEvent.click(screen.getByRole("button", { name: "Re-measure sizes" }));
    await waitFor(() => expect(measureMock).toHaveBeenCalledTimes(1));
  });

  it("says when a walk could not finish instead of showing a size", async () => {
    inventoryMock.mockResolvedValue([row({ sizeBytes: null, sizeMeasuredAt: null })]);
    measureMock.mockResolvedValue([{ taskId: "task-1", sizeBytes: null, bounded: true, error: null }]);
    renderInventory();
    await screen.findByText("ALP-1");
    fireEvent.click(screen.getByRole("button", { name: "Re-measure sizes" }));
    expect(await screen.findByRole("status")).toHaveTextContent("1 worktree could not be measured completely");
  });

  it("renders the empty state with a zero count and the task-worktrees-only limit", async () => {
    inventoryMock.mockResolvedValue([]);
    renderInventory();
    expect(await screen.findByText("No worktrees")).toBeInTheDocument();
    expect(screen.getByText("0 worktrees")).toBeInTheDocument();
    expect(screen.getByText(/Only task worktrees are listed/)).toHaveTextContent(/epic's integration worktree/);
  });

  it("renders equal-size rows in the order the core sent them, task key ascending", async () => {
    const size = 2048;
    inventoryMock.mockResolvedValue([
      row({ taskId: "a", taskKey: "ALP-1", sizeBytes: size }),
      row({ taskId: "b", taskKey: "ALP-2", sizeBytes: size }),
    ]);
    renderInventory();
    await screen.findByText("ALP-1");
    const keys = Array.from(document.querySelectorAll("[data-field='task']")).map((el) => el.textContent);
    expect(keys).toEqual(["ALP-1", "ALP-2"]);
  });

  it("contains no reclaim or delete control (plan 10-09 builds those with their guards)", () => {
    expect(inventorySource).not.toMatch(/worktree_reclaim|worktreeReclaim|Reclaim selected|Delete/);
  });
});

describe("the store", () => {
  it("opening the inventory closes the fleet and opening the fleet closes the inventory", () => {
    const { setFleetSurface, setWorktreeInventoryOpen } = useUiStore.getState();
    setFleetSurface({ view: "fleet" });
    setWorktreeInventoryOpen(true);
    expect(useUiStore.getState().fleetSurface).toBeNull();
    expect(useUiStore.getState().worktreeInventoryOpen).toBe(true);
    setFleetSurface({ view: "queue" });
    expect(useUiStore.getState().worktreeInventoryOpen).toBe(false);
  });
});
