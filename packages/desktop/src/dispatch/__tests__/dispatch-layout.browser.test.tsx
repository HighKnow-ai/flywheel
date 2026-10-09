/**
 * The fan-out controls inside a real epic row, measured in WebKit (plan 09-09). jsdom has no layout
 * engine, so "the dispatch cell fits the epic row's 64px" cannot be asserted there; a cell that
 * overflowed would be clipped by the row and the gate's reason would be cut off mid-sentence.
 *
 * Server state is seeded into the query cache (and never goes stale), so the real components render
 * against the real stylesheet with no backend.
 */
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../styles/tokens.css";
import "../../styles/type.css";
import "../../App.css";
import "../../session/session.css";
import { EpicHeaderRow } from "../../board/EpicHeaderRow";
import { CAP_KEY, GATE_KEY, dispatchPlanKey, planningRunKey } from "../queries";
import type { DispatchPlanDto, GateDto } from "../../adapters/tauri";

vi.mock(import("../../adapters/tauri"), async (importOriginal) => ({
  ...(await importOriginal()),
  subscribeDispatchGateChanged: () => Promise.resolve(() => {}),
}));

const ROW_HEIGHT = 64;

const running: DispatchPlanDto = {
  id: "plan-1",
  epicId: "epic-1",
  status: "running",
  waveCursor: 2,
  edgesFrozen: true,
  edges: [],
  tasks: [
    { taskId: "t1", taskKey: "FLY-1", title: "One", wave: 1, state: "merged", rationale: null, attention: null, entries: [] },
    { taskId: "t2", taskKey: "FLY-2", title: "Two", wave: 2, state: "needs_attention", rationale: null, attention: "x", entries: [] },
    { taskId: "t3", taskKey: "FLY-3", title: "Three", wave: 3, state: "planned", rationale: null, attention: null, entries: [] },
  ],
};

const open: GateDto = { state: "open", message: "Dispatch is open.", resumeAt: null };
const paused: GateDto = {
  state: "paused",
  message: "The five-hour allowance for this account is used up, so nothing new will start until it resets.",
  resumeAt: null,
};
const warning: GateDto = {
  state: "warning",
  message: "Eighty percent of this week's allowance is used; the next wave will not start on its own.",
  resumeAt: null,
};

function mountRow(plan: DispatchPlanDto | null, gate: GateDto, width = 1100) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  queryClient.setQueryData(dispatchPlanKey("epic-1"), plan);
  queryClient.setQueryData(planningRunKey("epic-1"), null);
  queryClient.setQueryData(GATE_KEY, gate);
  queryClient.setQueryData(CAP_KEY, { maxParallel: 4, occupiedSlots: 3 });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <div className="epic-header-cell" style={{ width, height: ROW_HEIGHT, position: "relative" }}>
        <EpicHeaderRow
          epicId="epic-1"
          epicKey="FLY-9"
          title="Ship the fan-out"
          collapsed
          showDispatch
          onToggleCollapsed={() => {}}
        />
      </div>
    </QueryClientProvider>,
  );
  const row = utils.container.querySelector(".epic-header-row") as HTMLElement;
  const cell = utils.container.querySelector('[data-slot="dispatch"]') as HTMLElement | null;
  return { row, cell };
}

function expectInsideRow(row: HTMLElement, cell: HTMLElement) {
  const r = row.getBoundingClientRect();
  const c = cell.getBoundingClientRect();
  expect(c.top, "the cell starts inside the row").toBeGreaterThanOrEqual(r.top - 0.5);
  expect(c.bottom, "the cell ends inside the row").toBeLessThanOrEqual(r.bottom + 0.5);
  expect(cell.scrollHeight, "nothing inside the cell is clipped").toBeLessThanOrEqual(cell.clientHeight + 1);
}

describe("the dispatch cell in a real epic row", () => {
  it("fits a running plan with an open gate", () => {
    const { row, cell } = mountRow(running, open);
    expect(cell).not.toBeNull();
    expectInsideRow(row, cell as HTMLElement);
  });

  it("fits a paused gate with its reason and no known reset", () => {
    const { row, cell } = mountRow(running, paused);
    expect(cell?.textContent).toContain(paused.message);
    expectInsideRow(row, cell as HTMLElement);
  });

  it("fits a warning-tier gate with its reason and action", () => {
    const { row, cell } = mountRow(running, warning);
    expect(cell?.textContent).toContain(warning.message);
    expectInsideRow(row, cell as HTMLElement);
  });

  it("fits a plan with nothing live", () => {
    const { row, cell } = mountRow(null, open);
    expectInsideRow(row, cell as HTMLElement);
  });

  it("gives way before the title does when the rack is narrow", () => {
    const { cell } = mountRow(running, open, 600);
    expect(cell === null || getComputedStyle(cell).display === "none").toBe(true);
  });
});

describe("the wave plan sheet in WebKit", () => {
  it("keeps its dialog inside the viewport with Approve reachable, however many tasks the plan has", async () => {
    const { WavePlanSheet } = await import("../WavePlanSheet");
    const many: DispatchPlanDto = {
      ...running,
      status: "draft",
      edgesFrozen: false,
      tasks: Array.from({ length: 40 }, (_, i) => ({
        taskId: `t${i}`,
        taskKey: `FLY-${i}`,
        title: `Task number ${i} with a reasonably long title to wrap`,
        wave: (i % 4) + 1,
        state: "planned",
        rationale: null,
        attention: null,
        entries: ["packages/core/src/domain/some/long/path/file.rs", "docs/"],
      })),
      edges: [],
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    queryClient.setQueryData(dispatchPlanKey("epic-1"), many);
    render(
      <QueryClientProvider client={queryClient}>
        <WavePlanSheet epicId="epic-1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    const approve = Array.from(document.querySelectorAll("button")).find((b) => b.textContent === "Approve and start") as HTMLElement;
    const d = dialog.getBoundingClientRect();
    const a = approve.getBoundingClientRect();
    expect(d.top).toBeGreaterThanOrEqual(0);
    expect(d.bottom).toBeLessThanOrEqual(window.innerHeight + 0.5);
    expect(a.bottom).toBeLessThanOrEqual(d.bottom + 0.5);
    expect(a.top).toBeGreaterThanOrEqual(d.top);
  });
});
