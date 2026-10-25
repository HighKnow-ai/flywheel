/**
 * Behavior under test (Phase 10 plan 10-04, AGNT-08 / FLEET-01, D-165/D-180):
 * - A live row's spend cell is empty text — not `$0.00`, not a dash. A finished row whose cost never
 *   arrived is empty too. A failed row keeps the cost it incurred. With no row to show a spend for, the
 *   Spend column is left out (#208). Money reads through `lib/format.ts`, to two decimals.
 * - Tokens are labelled so `tokensIn` (which includes cache reads) cannot be read as the prompt size.
 * - The footer shows the total the core read computed, labelled as an estimate; with none, no total.
 * - A terminal row has a Dismiss control and a live row does not; "Dismiss finished" sends the ids of
 *   the DONE / FAILED band in one call; a click on the row itself acknowledges nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetListDto, FleetRowDto } from "../../adapters/tauri";
import { formatMoney } from "@/lib/format";
import { resetUiState } from "../../state/uiStore";
import { FleetSurface } from "../FleetSurface";

const fleetListMock = vi.fn<() => Promise<FleetListDto>>();
const acknowledgeMock = vi.fn<(id: string) => Promise<void>>();
const acknowledgeManyMock = vi.fn<(ids: string[]) => Promise<unknown[]>>();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    fleetList: () => fleetListMock(),
    fleetBlockedQueue: () => Promise.resolve([]),
    acknowledgeSession: (id: string) => acknowledgeMock(id),
    sessionAcknowledgeMany: (ids: string[]) => acknowledgeManyMock(ids),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

function row(overrides: Partial<FleetRowDto>): FleetRowDto {
  return {
    sessionId: "run-1",
    projectId: "proj-1",
    projectName: "Alpha",
    projectKeyPrefix: "ALP",
    projectStatus: "active",
    storyId: "story-1",
    storyKey: "ALP-1",
    storyTitle: "Wire the thing",
    storyState: "running",
    runStatus: "running",
    fleetState: "running",
    startedAt: new Date(Date.now() - 125_000).toISOString(),
    endedAt: null,
    blockedSince: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    doingTaskTitle: null,
    activity: { lines: [], truncated: false },
    ...overrides,
  };
}

const ENDED = "2026-10-12T01:00:00Z";
const failed = (id: string, extra: Partial<FleetRowDto> = {}) =>
  row({ sessionId: id, runStatus: "failed", fleetState: "failed", endedAt: ENDED, storyKey: id, ...extra });
const completed = (id: string, extra: Partial<FleetRowDto> = {}) =>
  row({ sessionId: id, runStatus: "completed", fleetState: "completed", endedAt: ENDED, storyKey: id, ...extra });

function list(rows: FleetRowDto[], visibleCostUsd: number | null = null): FleetListDto {
  return { rows, totalRows: rows.length, visibleCostUsd };
}

function renderFleet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetSurface onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const spendOf = (container: HTMLElement, runId: string) =>
  container.querySelector(`[data-run-id="${runId}"] [data-field="spend"]`) as HTMLElement;

beforeEach(() => {
  resetUiState();
  fleetListMock.mockReset();
  acknowledgeMock.mockReset().mockResolvedValue(undefined);
  acknowledgeManyMock.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe("spend cell", () => {
  it("is empty text for a running row, never $0.00", async () => {
    fleetListMock.mockResolvedValue(
      list([row({ sessionId: "live", costUsd: null }), completed("done", { costUsd: 1.25 })]),
    );
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    expect(spendOf(container, "live").textContent).toBe("");
    expect(container.textContent).not.toContain("$0.00");
  });

  it("leaves the Spend column out when no row has a spend to show", async () => {
    fleetListMock.mockResolvedValue(list([row({ sessionId: "live", costUsd: null })]));
    const { container } = renderFleet();
    await screen.findByText("Wire the thing");
    expect(screen.queryByRole("columnheader", { name: "Spend" })).toBeNull();
    expect(spendOf(container, "live")).toBeNull();
  });

  it("is empty even if a live row somehow carried a cost", async () => {
    fleetListMock.mockResolvedValue(
      list([row({ sessionId: "live", costUsd: 0.5 }), completed("done", { costUsd: 1.25 })]),
    );
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    expect(spendOf(container, "live").textContent).toBe("");
  });

  it("shows a completed row's recorded cost through formatMoney", async () => {
    fleetListMock.mockResolvedValue(list([completed("done", { costUsd: 1.25 })]));
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    expect(spendOf(container, "done").textContent).toBe(formatMoney(1.25));
  });

  it("shows a failed row's cost: it keeps what it spent before it failed", async () => {
    fleetListMock.mockResolvedValue(list([failed("bad", { costUsd: 0.42 })]));
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    expect(spendOf(container, "bad").textContent).toBe(formatMoney(0.42));
  });

  it("is empty text for a completed row whose cost was never recorded", async () => {
    fleetListMock.mockResolvedValue(list([completed("quiet", { costUsd: null }), completed("paid", { costUsd: 0.3 })]));
    const { container } = renderFleet();
    await screen.findAllByText("Dismiss");
    expect(spendOf(container, "quiet").textContent).toBe("");
  });

  it("labels the token figure so cache-inclusive input cannot read as the prompt size", async () => {
    fleetListMock.mockResolvedValue(list([completed("tok", { costUsd: 0.1, tokensIn: 1234567, tokensOut: 890 })]));
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    const tokens = spendOf(container, "tok").lastElementChild as HTMLElement;
    expect(tokens.textContent).toBe("1.23M in · 890 out");
    fireEvent.focus(tokens);
    expect((await screen.findByRole("tooltip")).textContent).toMatch(/include cache reads/);
  });
});

describe("footer total", () => {
  it("shows the core's total, labelled as an estimate and not a billed amount", async () => {
    fleetListMock.mockResolvedValue(list([failed("a", { costUsd: 1.5 }), completed("b", { costUsd: 0.25 })], 1.75));
    const { container } = renderFleet();
    const footer = await waitFor(() => {
      const el = container.querySelector("[data-fleet-footer]");
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(footer.textContent).toContain(formatMoney(1.75));
    expect(footer.textContent).toMatch(/estimate/i);
    expect(footer.textContent).toMatch(/not a billed amount/i);
  });

  it("renders no numeric total when no row carries a cost", async () => {
    fleetListMock.mockResolvedValue(list([completed("a")], null));
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    expect(container.querySelector("[data-fleet-footer]")).toBeNull();
    expect(container.textContent).not.toMatch(/\$\d/);
  });
});

describe("dismiss", () => {
  it("exists on a terminal row and not on a live one", async () => {
    fleetListMock.mockResolvedValue(list([row({ sessionId: "live" }), failed("done")]));
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    expect(container.querySelector('[data-run-id="done"] [data-field="dismiss"] button')).not.toBeNull();
    expect(container.querySelector('[data-run-id="live"] [data-field="dismiss"] button')).toBeNull();
  });

  it("acknowledges exactly that run when its Dismiss is pressed", async () => {
    fleetListMock.mockResolvedValue(list([failed("one"), failed("two")]));
    const { container } = renderFleet();
    await screen.findAllByText("Dismiss");
    fireEvent.click(container.querySelector('[data-run-id="two"] [data-field="dismiss"] button') as HTMLElement);
    expect(acknowledgeMock).toHaveBeenCalledTimes(1);
    expect(acknowledgeMock).toHaveBeenCalledWith("two");
  });

  it("Dismiss finished sends the ids of the terminal rows in one call and skips live rows", async () => {
    fleetListMock.mockResolvedValue(list([row({ sessionId: "live" }), failed("f1"), completed("c1")]));
    renderFleet();
    fireEvent.click(await screen.findByText("Dismiss finished"));
    expect(acknowledgeManyMock).toHaveBeenCalledTimes(1);
    expect(acknowledgeManyMock).toHaveBeenCalledWith(["f1", "c1"]);
  });

  it("says so when a single Dismiss fails instead of leaving the row with no message", async () => {
    acknowledgeMock.mockRejectedValueOnce(new Error("database is locked"));
    fleetListMock.mockResolvedValue(list([failed("one")]));
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    fireEvent.click(container.querySelector('[data-run-id="one"] [data-field="dismiss"] button') as HTMLElement);
    expect((await screen.findByRole("status")).textContent).toMatch(/Could not dismiss/);
  });

  it("reports how many runs a batch dismiss could not write, and nothing for a benign no-op", async () => {
    fleetListMock.mockResolvedValue(list([failed("f1"), completed("c1")]));
    acknowledgeManyMock.mockResolvedValueOnce([
      { sessionId: "f1", acknowledged: false, error: null }, // already acknowledged: not a failure
      { sessionId: "c1", acknowledged: false, error: "database is locked" },
    ]);
    renderFleet();
    fireEvent.click(await screen.findByText("Dismiss finished"));
    expect((await screen.findByRole("status")).textContent).toBe("Could not dismiss 1 of 2 runs.");
  });

  it("says so when the whole batch is refused", async () => {
    fleetListMock.mockResolvedValue(list([failed("f1")]));
    acknowledgeManyMock.mockRejectedValueOnce("refused: too many");
    renderFleet();
    fireEvent.click(await screen.findByText("Dismiss finished"));
    expect((await screen.findByRole("status")).textContent).toMatch(/Could not dismiss/);
  });

  it("is offered on the DONE / FAILED band only", async () => {
    fleetListMock.mockResolvedValue(list([row({ sessionId: "live" })]));
    renderFleet();
    await screen.findByText("Wire the thing");
    expect(screen.queryByText("Dismiss finished")).toBeNull();
  });

  it("acknowledges nothing when a finished row is merely clicked", async () => {
    fleetListMock.mockResolvedValue(list([failed("bad")]));
    const { container } = renderFleet();
    await screen.findByText("Dismiss");
    fireEvent.click(container.querySelector('[data-run-id="bad"]') as HTMLElement);
    expect(acknowledgeMock).not.toHaveBeenCalled();
    expect(acknowledgeManyMock).not.toHaveBeenCalled();
    expect(container.querySelector('[data-run-id="bad"]')).not.toBeNull();
  });
});
