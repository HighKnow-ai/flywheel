/**
 * Behavior under test (Phase 10 plan 10-09, WORK-07, D-179):
 * - Only reclaimable rows carry a checkbox; an in-use and a keep row carry none.
 * - Selecting rows renders a bar with the count and the sum of their sizes in the rows' own format.
 * - Confirming calls the reclaim wrapper once with exactly the selected ids; cancelling calls nothing.
 * - #208: the header's select-all Checkbox selects every reclaimable row and nothing else, any row can still
 *   be cleared before the one confirmation (ConfirmDestructive), and nothing submits without a selection.
 * - A mixed result shows both outcomes with the refused row's reason and claims no overall success; a
 *   reclaim that removed everything says so in a toast. A call that fails outright keeps the
 *   confirmation open with the failure.
 * - The inventory is refetched after the call, and the selection keeps refused ids and drops removed ones.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReclaimOutcomeDto, WorktreeInventoryRowDto } from "../../adapters/tauri";
import { resetUiState } from "../../state/uiStore";
import { RECLAIM_REASON_WORDS, WorktreeInventory } from "../WorktreeInventory";

const inventoryMock = vi.fn<() => Promise<WorktreeInventoryRowDto[]>>();
const notifyMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), dismiss: vi.fn() }));

vi.mock("@/lib/notify", () => ({ notify: notifyMock }));
const reclaimMock = vi.fn<(ids: string[]) => Promise<ReclaimOutcomeDto[]>>();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    worktreeInventory: () => inventoryMock(),
    worktreeMeasure: () => Promise.resolve([]),
    worktreeReclaim: (ids: string[]) => reclaimMock(ids),
    fleetList: () => Promise.resolve({ rows: [], totalRows: 0, visibleCostUsd: null }),
    fleetBlockedQueue: () => Promise.resolve([]),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

const MIB = 1024 * 1024;

function row(overrides: Partial<WorktreeInventoryRowDto>): WorktreeInventoryRowDto {
  return {
    storyId: "t1",
    storyKey: "ALP-1",
    storyTitle: "One",
    storyState: "done",
    projectId: "p1",
    projectName: "Alpha",
    projectStatus: "active",
    branch: "flywheel/alp-1",
    sizeBytes: 512 * MIB,
    sizeMeasuredAt: new Date(Date.now() - 60_000).toISOString(),
    disposition: "reclaimable",
    reason: "merged",
    ...overrides,
  };
}

const ROWS = [
  row({ storyId: "a", storyKey: "ALP-1", sizeBytes: 512 * MIB }),
  row({ storyId: "b", storyKey: "ALP-2", sizeBytes: 1024 * MIB, reason: "merged" }),
  row({ storyId: "c", storyKey: "ALP-3", disposition: "in_use", reason: "sessionning" }),
  row({ storyId: "d", storyKey: "ALP-4", disposition: "keep", reason: "uncommitted_changes" }),
];

function renderInventory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorktreeInventory onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const box = (label: string) => screen.getByRole("checkbox", { name: new RegExp(`${label} for reclaim`) });
const checked = (el: HTMLElement) => el.getAttribute("aria-checked") === "true";
const selectAll = () => screen.getByRole("checkbox", { name: /^Select every worktree that can be reclaimed/ });

async function selectAndConfirm(...keys: string[]) {
  for (const k of keys) fireEvent.click(box(k));
  fireEvent.click(screen.getByRole("button", { name: "Reclaim" }));
  fireEvent.click(await screen.findByRole("button", { name: /^Reclaim \d+ worktrees?$/ }));
}

beforeEach(() => {
  resetUiState();
  inventoryMock.mockReset();
  reclaimMock.mockReset();
  notifyMock.success.mockReset();
  inventoryMock.mockResolvedValue(ROWS);
});
afterEach(cleanup);

describe("selection", () => {
  it("renders a checkbox on reclaimable rows only", async () => {
    renderInventory();
    await screen.findByText("ALP-1");
    expect(document.querySelectorAll("[data-worktree-row] [role='checkbox']")).toHaveLength(2);
    for (const id of ["c", "d"]) {
      expect(document.querySelector(`[data-worktree-row='${id}'] [role='checkbox']`)).toBeNull();
    }
  });

  it("names the count and the summed size of the selection in the rows' own format", async () => {
    renderInventory();
    await screen.findByText("ALP-1");
    expect(document.querySelector("[data-reclaim-bar]")).toBeNull();
    fireEvent.click(box("ALP-1"));
    fireEvent.click(box("ALP-2"));
    const bar = document.querySelector("[data-field='selection']") as HTMLElement;
    expect(bar.textContent).toContain("2 worktrees");
    expect(bar.textContent).toContain("1.5 GiB");
  });

  it("says how many selected rows were never measured instead of counting them as zero", async () => {
    inventoryMock.mockResolvedValue([ROWS[0], row({ storyId: "n", storyKey: "ALP-9", sizeBytes: null, sizeMeasuredAt: null })]);
    renderInventory();
    await screen.findByText("ALP-1");
    fireEvent.click(box("ALP-1"));
    fireEvent.click(box("ALP-9"));
    expect((document.querySelector("[data-field='selection']") as HTMLElement).textContent).toContain(
      "512.0 MiB measured, 1 not measured",
    );
  });

  it("offers no Reclaim without a selection", async () => {
    renderInventory();
    await screen.findByText("ALP-1");
    expect(screen.queryByRole("button", { name: "Reclaim" })).toBeNull();
    expect(document.querySelector("[data-reclaim-bar]")).toBeNull();
  });

  it("selects every reclaimable row from the header, and lets one be kept before confirming", async () => {
    renderInventory();
    await screen.findByText("ALP-1");
    expect(selectAll()).toHaveAttribute("aria-checked", "false");
    fireEvent.click(selectAll());
    expect(checked(box("ALP-1"))).toBe(true);
    expect(checked(box("ALP-2"))).toBe(true);
    expect((document.querySelector("[data-field='selection']") as HTMLElement).textContent).toContain("2 worktrees");
    // Keep one: the header shows a partial selection, and nothing has been submitted.
    fireEvent.click(box("ALP-2"));
    expect(selectAll()).toHaveAttribute("aria-checked", "mixed");
    expect((document.querySelector("[data-field='selection']") as HTMLElement).textContent).toContain("1 worktree");
    expect(reclaimMock).not.toHaveBeenCalled();
    // A second press of a partial select-all selects them all again; a third clears them.
    fireEvent.click(selectAll());
    expect(checked(box("ALP-2"))).toBe(true);
    fireEvent.click(selectAll());
    expect(checked(box("ALP-1"))).toBe(false);
    expect(document.querySelector("[data-reclaim-bar]")).toBeNull();
  });
});

describe("confirmation", () => {
  it("calls the reclaim wrapper once with exactly the selected ids after one confirmation naming the total", async () => {
    reclaimMock.mockResolvedValue([
      { storyId: "a", removed: true, reason: "merged", error: null },
      { storyId: "b", removed: true, reason: "merged", error: null },
    ]);
    renderInventory();
    await screen.findByText("ALP-1");
    fireEvent.click(box("ALP-1"));
    fireEvent.click(box("ALP-2"));
    fireEvent.click(screen.getByRole("button", { name: "Reclaim" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Reclaim 2 worktrees?");
    expect(dialog).toHaveTextContent("1.5 GiB");
    expect(reclaimMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Reclaim 2 worktrees" }));
    await waitFor(() => expect(reclaimMock).toHaveBeenCalledTimes(1));
    expect(reclaimMock.mock.calls[0][0]).toEqual(["a", "b"]);
  });

  it("calls nothing when the confirmation is cancelled", async () => {
    renderInventory();
    await screen.findByText("ALP-1");
    fireEvent.click(box("ALP-1"));
    fireEvent.click(screen.getByRole("button", { name: "Reclaim" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(reclaimMock).not.toHaveBeenCalled();
    expect(checked(box("ALP-1"))).toBe(true);
  });
});

describe("results", () => {
  const mixed: ReclaimOutcomeDto[] = [
    { storyId: "a", removed: true, reason: "merged", error: null },
    { storyId: "b", removed: false, reason: "uncommitted_changes", error: null },
  ];

  it("shows both outcomes with the refusal's reason and claims no overall success", async () => {
    reclaimMock.mockResolvedValue(mixed);
    renderInventory();
    await screen.findByText("ALP-1");
    await selectAndConfirm("ALP-1", "ALP-2");
    const result = await waitFor(() => {
      const el = document.querySelector("[data-reclaim-result]") as HTMLElement;
      expect(el).not.toBeNull();
      return el;
    });
    expect(result.querySelector("[data-reclaim-outcome='removed']")).toHaveTextContent("Alpha ALP-1 removed");
    expect(result.querySelector("[data-reclaim-outcome='refused']")).toHaveTextContent(
      `Alpha ALP-2 refused: ${RECLAIM_REASON_WORDS.uncommitted_changes}`,
    );
    expect(result).toHaveTextContent("1 of 2 removed");
    expect(document.body.textContent).not.toMatch(/success|all removed|complete/i);
  });

  it("refetches the inventory after the call, drops removed ids from the selection and keeps refused ones", async () => {
    reclaimMock.mockResolvedValue(mixed);
    renderInventory();
    await screen.findByText("ALP-1");
    const before = inventoryMock.mock.calls.length;
    await selectAndConfirm("ALP-1", "ALP-2");
    await waitFor(() => expect(inventoryMock.mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(checked(box("ALP-2"))).toBe(true));
    expect(checked(box("ALP-1"))).toBe(false);
    // The server's current list is what stays on screen: the "removed" row is still listed here
    // because the mock still returns it; nothing was deleted from the view locally.
    expect(screen.getByText("ALP-1")).toBeInTheDocument();
  });

  it("shows a removal error as that row's refusal", async () => {
    reclaimMock.mockResolvedValue([{ storyId: "a", removed: false, reason: null, error: "worktree is locked" }]);
    renderInventory();
    await screen.findByText("ALP-1");
    await selectAndConfirm("ALP-1");
    expect(await screen.findByText("refused: worktree is locked")).toBeInTheDocument();
  });

  it("reports a call that failed outright in the confirmation and removes nothing from the view", async () => {
    reclaimMock.mockRejectedValue(new Error("boom"));
    renderInventory();
    await screen.findByText("ALP-1");
    await selectAndConfirm("ALP-1");
    const dialog = await screen.findByRole("alertdialog");
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("boom");
    expect(document.querySelector("[data-reclaim-result]")).toBeNull();
    expect(notifyMock.success).not.toHaveBeenCalled();
    // The dialog hides the page from assistive tech while it is open; the selection behind it is kept.
    expect(checked(screen.getByRole("checkbox", { name: /ALP-1 for reclaim/, hidden: true }))).toBe(true);
  });

  it("says in a toast what a reclaim that removed everything freed, and closes the confirmation", async () => {
    reclaimMock.mockResolvedValue([
      { storyId: "a", removed: true, reason: "merged", error: null },
      { storyId: "b", removed: true, reason: "merged", error: null },
    ]);
    renderInventory();
    await screen.findByText("ALP-1");
    await selectAndConfirm("ALP-1", "ALP-2");
    await waitFor(() =>
      expect(notifyMock.success).toHaveBeenCalledWith("Reclaimed 2 worktrees", {
        description: "1.5 GiB freed. Branches and commits are kept.",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(document.querySelector("[data-reclaim-result]")).toBeNull();
  });
});
