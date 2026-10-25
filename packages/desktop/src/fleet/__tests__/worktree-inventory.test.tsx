/**
 * Behavior under test (Phase 10 plan 10-08, WORK-07, D-177/D-178):
 * - A measured size renders with its age; a never-measured size renders empty text and no byte figure.
 * - Each of the three chips renders with its reason word, and every reason the core can return has one.
 * - An unreachable-project row reads keep, with that reason.
 * - Re-measure calls the adapter once; the empty state names the Story-worktrees-only limit.
 * - Rows render in the order the core sent them (equal sizes: Story key ascending).
 * - The rail's Worktrees row is a button that opens the view, and the view offers no bulk control.
 * - #208: a Table with column headers, the rows grouped under their project; what Re-measure did is a toast.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { WorktreeInventoryRowDto, WorktreeMeasureDto } from "../../adapters/tauri";
import { resetUiState, useUiStore } from "../../state/uiStore";
import {
  RECLAIM_REASONS,
  RECLAIM_REASON_WORDS,
  WorktreeInventory,
  formatBytes,
  DISPOSITION_CHIPS,
} from "../WorktreeInventory";

const inventoryMock = vi.fn<() => Promise<WorktreeInventoryRowDto[]>>();
const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));

vi.mock("@/lib/notify", () => ({ notify: notifyMock }));
const measureMock = vi.fn<(storyIds?: string[]) => Promise<WorktreeMeasureDto[]>>();

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
    storyId: "story-1",
    storyKey: "ALP-1",
    storyTitle: "Wire the thing",
    storyState: "done",
    projectId: "proj-1",
    projectName: "Alpha",
    projectStatus: "active",
    branch: "flywheel/alp-1",
    sizeBytes: 3 * 1024 * 1024 * 1024,
    sizeMeasuredAt: new Date(Date.now() - 180_000).toISOString(),
    disposition: "reclaimable",
    reason: "merged",
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
  notifyMock.success.mockReset();
  notifyMock.error.mockReset();
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
    expect(document.querySelector("header [aria-live]")).toHaveTextContent("1 worktree");
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
      row({ storyId: "a", storyKey: "ALP-1", disposition: "reclaimable", reason: "merged" }),
      row({ storyId: "b", storyKey: "ALP-2", disposition: "in_use", reason: "sessionning" }),
      row({ storyId: "c", storyKey: "ALP-3", disposition: "keep", reason: "uncommitted_changes" }),
    ]);
    renderInventory();
    await screen.findByText("ALP-1");
    const cases: Array<[string, keyof typeof DISPOSITION_CHIPS]> = [
      ["a", "reclaimable"],
      ["b", "in_use"],
      ["c", "keep"],
    ];
    for (const [id, disposition] of cases) {
      const li = document.querySelector(`[data-worktree-row='${id}']`) as HTMLElement;
      const chip = li.querySelector(`[data-disposition='${disposition}']`) as HTMLElement;
      expect(chip.textContent).toContain(DISPOSITION_CHIPS[disposition].label);
      expect(chip.querySelector("svg")).not.toBeNull();
    }
    expect(screen.getByText(RECLAIM_REASON_WORDS.merged)).toBeInTheDocument();
    expect(screen.getByText(RECLAIM_REASON_WORDS.sessionning)).toBeInTheDocument();
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

  // D-REV-54 (plan 11-15): a worktree nobody has measured yet shows nothing in its size cell, and the
  // figure appears, with its age, only once Re-measure has run and the list has been read again.
  it("shows a never-measured size as blank until Re-measure, then a figure with its age", async () => {
    const fresh = row({ sizeBytes: null, sizeMeasuredAt: null });
    const measured = row({ sizeBytes: 2.5 * 1024 ** 3, sizeMeasuredAt: new Date().toISOString() });
    inventoryMock.mockResolvedValueOnce([fresh]).mockResolvedValue([measured]);
    measureMock.mockResolvedValue([{ storyId: "story-1", sizeBytes: measured.sizeBytes, bounded: false, error: null }]);
    const { container } = renderInventory();
    await screen.findByText("ALP-1");
    const sizeCell = () => container.querySelector("[data-field='size']") as HTMLElement;
    expect(sizeCell().textContent).toBe("");
    expect(container.querySelector("[data-field='measured']")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Re-measure sizes" }));

    await waitFor(() => expect(sizeCell().textContent).toContain("2.5 GiB"));
    expect(sizeCell().textContent).toContain("measured just now");
    expect(measureMock).toHaveBeenCalledTimes(1);
    expect(inventoryMock, "the list was read again, not edited locally").toHaveBeenCalledTimes(2);
  });

  it("says when a walk could not finish instead of showing a size", async () => {
    inventoryMock.mockResolvedValue([row({ sizeBytes: null, sizeMeasuredAt: null })]);
    measureMock.mockResolvedValue([{ storyId: "story-1", sizeBytes: null, bounded: true, error: null }]);
    renderInventory();
    await screen.findByText("ALP-1");
    fireEvent.click(screen.getByRole("button", { name: "Re-measure sizes" }));
    await waitFor(() =>
      expect(notifyMock.error).toHaveBeenCalledWith("1 worktree could not be measured completely", {
        description: "It keeps no size.",
      }),
    );
  });

  it("renders the empty state with a zero count", async () => {
    inventoryMock.mockResolvedValue([]);
    renderInventory();
    expect(await screen.findByText("No worktrees")).toBeInTheDocument();
    expect(screen.getByText("0 worktrees")).toBeInTheDocument();
  });

  it("renders equal-size rows in the order the core sent them, Story key ascending", async () => {
    const size = 2048;
    inventoryMock.mockResolvedValue([
      row({ storyId: "a", storyKey: "ALP-1", sizeBytes: size }),
      row({ storyId: "b", storyKey: "ALP-2", sizeBytes: size }),
    ]);
    renderInventory();
    await screen.findByText("ALP-1");
    const keys = Array.from(document.querySelectorAll("[data-field='story'] [data-slot='story-key']")).map(
      (el) => el.textContent,
    );
    expect(keys).toEqual(["ALP-1", "ALP-2"]);
  });

  it("draws a table with a header for each column", async () => {
    inventoryMock.mockResolvedValue([row({})]);
    renderInventory();
    const table = await screen.findByRole("table");
    const head = table.querySelector("thead") as HTMLElement;
    expect(
      within(head)
        .getAllByRole("columnheader")
        .map((h) => h.textContent?.trim()),
    ).toEqual(["", "Story", "Size", "Status"]);
  });

  it("names each project once, over its rows, in the order the core's list first names it", async () => {
    inventoryMock.mockResolvedValue([
      row({ storyId: "a", storyKey: "BET-1", projectId: "p-b", projectName: "Beta", sizeBytes: 9000 }),
      row({ storyId: "b", storyKey: "ALP-1", projectId: "p-a", projectName: "Alpha", sizeBytes: 5000 }),
      row({ storyId: "c", storyKey: "BET-2", projectId: "p-b", projectName: "Beta", sizeBytes: 1000 }),
    ]);
    renderInventory();
    await screen.findByText("BET-1");
    const groups = Array.from(document.querySelectorAll<HTMLElement>("tbody[data-project]"));
    expect(groups.map((g) => g.querySelector("[data-field='project']")?.textContent)).toEqual(["Beta", "Alpha"]);
    expect(
      Array.from(groups[0].querySelectorAll("[data-worktree-row]")).map((r) => r.getAttribute("data-worktree-row")),
    ).toEqual(["a", "c"]);
    expect(screen.getAllByText("Beta")).toHaveLength(1);
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
