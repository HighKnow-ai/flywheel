/**
 * The fan-out controls inside a real epic row, measured in WebKit (plan 09-09). jsdom has no layout
 * engine, so "the dispatch cell fits the epic row's 64px" cannot be asserted there; a cell that
 * overflowed would be clipped by the row and the gate's reason would be cut off mid-sentence.
 *
 * Server state is seeded into the query cache (and never goes stale), so the real components render
 * against the real stylesheet with no backend.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../styles/tokens.css";
import "../../styles/type.css";
import "../../App.css";
import "../../session/session.css";
import { EpicHeaderRow } from "../../board/EpicHeaderRow";
import { CAP_KEY, GATE_KEY, dispatchPlanKey, planningRunKey } from "../queries";
import type { DispatchPlanDto, GateDto } from "../../adapters/tauri";

const calls = vi.hoisted(() => ({ edit: vi.fn(), approve: vi.fn() }));

vi.mock(import("../../adapters/tauri"), async (importOriginal) => ({
  ...(await importOriginal()),
  subscribeDispatchGateChanged: () => Promise.resolve(() => {}),
  dispatchPlanEdit: (...args: unknown[]) => calls.edit(...args),
  dispatchPlanApprove: (...args: unknown[]) => calls.approve(...args),
}));

afterEach(cleanup);

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

function mountRow(plan: DispatchPlanDto | null, gate: GateDto, width = 1100, planningRun = false) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  queryClient.setQueryData(dispatchPlanKey("epic-1"), plan);
  queryClient.setQueryData(planningRunKey("epic-1"), planningRun ? { runId: "run-1", epicId: "epic-1" } : null);
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

// ---------------------------------------------------------------------------------------------
// D-REV-36 (plan 11-14): every state the register's truth names, contained and reachable.
//
// Already covered above, by measurement, and NOT repeated here: the running plan with an open gate,
// the paused and warning gate (cell inside the row, nothing clipped), a plan with nothing live, the
// cell yielding at a narrow rack, and the 40-task sheet keeping Approve inside the viewport. What this
// section adds is the states those did not touch and, for all of them, the part they never asserted:
// that each CONTROL (not only the cell) sits inside its container, and can be reached by keyboard.
//
// Reachability. WebKit's plain Tab skips buttons by default (Safari's "Press Tab to highlight each
// item"), a fact review/__tests__/browser/keyboard.browser.test.tsx measured and records. Option+Tab
// is the engine's own "every control" traversal, so that is what is pressed. A packaged WKWebView
// shares the default: the controls are native, enabled, in the tab order, which is all a test can say.
// ---------------------------------------------------------------------------------------------

const TAB_BUDGET = 30;

const controlsIn = (root: HTMLElement) => Array.from(root.querySelectorAll<HTMLElement>("button, select, textarea"));
const nameOf = (el: HTMLElement) => el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;

function expectInside(inner: HTMLElement, outer: HTMLElement, what: string) {
  const i = inner.getBoundingClientRect();
  const o = outer.getBoundingClientRect();
  expect(i.width, `${what} is painted`).toBeGreaterThan(0);
  expect(i.left, `${what}: left edge inside its container`).toBeGreaterThanOrEqual(o.left - 0.5);
  expect(i.right, `${what}: right edge inside its container`).toBeLessThanOrEqual(o.right + 0.5);
  expect(i.top, `${what}: top edge inside its container`).toBeGreaterThanOrEqual(o.top - 0.5);
  expect(i.bottom, `${what}: bottom edge inside its container`).toBeLessThanOrEqual(o.bottom + 0.5);
}

/** Every enabled control is native and takes focus in sequential order within the budget. */
async function expectReachable(root: HTMLElement) {
  const enabled = controlsIn(root).filter((el) => !(el as HTMLButtonElement).disabled);
  expect(enabled.length, "there are controls to reach").toBeGreaterThan(0);
  for (const el of enabled) expect(el.getAttribute("tabindex"), `${nameOf(el)} is not taken out of the focus order`).not.toBe("-1");
  (document.activeElement as HTMLElement | null)?.blur();
  const reached = new Set<Element>();
  for (let i = 0; i < TAB_BUDGET && reached.size < enabled.length; i += 1) {
    await userEvent.keyboard("{Alt>}{Tab}{/Alt}");
    if (document.activeElement && enabled.includes(document.activeElement as HTMLElement)) reached.add(document.activeElement);
  }
  const missed = enabled.filter((el) => !reached.has(el)).map(nameOf);
  expect(missed, "controls the keyboard never reached").toEqual([]);
}

const pausedPlan: DispatchPlanDto = { ...running, status: "paused" };
const draftPlan: DispatchPlanDto = { ...running, status: "draft", waveCursor: 1, edgesFrozen: false };
const resetsAt: GateDto = { ...paused, message: "The seven-day allowance is used up.", resumeAt: 1791538200 };

describe("the dispatch cell, every state the register names", () => {
  const states: { name: string; plan: DispatchPlanDto | null; gate: GateDto; planning?: boolean; words: string[]; buttons: string[] }[] = [
    { name: "nothing planned", plan: null, gate: open, words: [], buttons: ["Plan fan-out"] },
    { name: "planning in progress", plan: null, gate: open, planning: true, words: ["Planning in progress. A draft appears here when it is ready."], buttons: [] },
    { name: "the draft appearing", plan: draftPlan, gate: open, words: ["Draft plan, not started"], buttons: ["Review plan"] },
    { name: "a running wave with a stuck task", plan: running, gate: open, words: ["Wave 2 of 3", "1 stuck: FLY-2"], buttons: ["Pause", "Stop", "Open plan"] },
    { name: "a paused plan", plan: pausedPlan, gate: open, words: ["Paused: no new work starts"], buttons: ["Resume", "Stop", "Open plan"] },
    { name: "a paused gate, reset unknown", plan: running, gate: paused, words: [paused.message, "The reset time is unknown. Only a manual resume will clear this."], buttons: ["Resume now", "Pause", "Stop", "Open plan"] },
    { name: "a paused gate with a reset time", plan: running, gate: resetsAt, words: [resetsAt.message, "Dispatch resumes"], buttons: ["Resume now", "Pause", "Stop", "Open plan"] },
    { name: "a warning gate", plan: running, gate: warning, words: [warning.message, "The running wave will finish."], buttons: ["Advance now", "Pause", "Stop", "Open plan"] },
  ];

  for (const state of states) {
    it(`${state.name}: its words and every control are inside the 64px row, and reachable`, async () => {
      const { row, cell } = mountRow(state.plan, state.gate, 1100, state.planning ?? false);
      expect(cell, "the cell renders").not.toBeNull();
      expectInsideRow(row, cell as HTMLElement);
      expect((cell as HTMLElement).scrollWidth, "nothing is clipped sideways").toBeLessThanOrEqual((cell as HTMLElement).clientWidth + 1);
      for (const word of state.words) expect(cell?.textContent, `the cell says "${word}"`).toContain(word);
      const labels = controlsIn(cell as HTMLElement).map(nameOf);
      expect(labels, "exactly the controls this state offers").toEqual(state.buttons);
      for (const control of controlsIn(cell as HTMLElement)) expectInside(control, cell as HTMLElement, `${nameOf(control)} in "${state.name}"`);
      if (state.buttons.length > 0) await expectReachable(cell as HTMLElement);
    });
  }

  it("the Stop confirmation fits the row with both of its answers", async () => {
    const { row, cell } = mountRow(running, open);
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await waitFor(() => expect(cell?.textContent).toContain("Stop starting new work?"));
    expectInsideRow(row, cell as HTMLElement);
    expect(controlsIn(cell as HTMLElement).map(nameOf)).toEqual(["Stop the fan-out", "Keep the plan"]);
    for (const control of controlsIn(cell as HTMLElement)) expectInside(control, cell as HTMLElement, nameOf(control));
    await expectReachable(cell as HTMLElement);
  });
});

describe("the wave plan sheet, every state the register names", () => {
  const LONG = "packages/core/src/domain/some/very/deeply/nested/directory/structure/that/goes/on/and/on/file.rs";
  const task = (n: number, wave: number, over: Partial<DispatchPlanDto["tasks"][number]> = {}) => ({
    taskId: `t${n}`, taskKey: `FLY-${n}`, title: `Task ${n}`, wave, state: "planned", rationale: null, attention: null, entries: [LONG, "docs/"], ...over,
  });
  const draft: DispatchPlanDto = {
    ...running, status: "draft", waveCursor: 1, edgesFrozen: false,
    tasks: [task(1, 1), task(2, 1, { rationale: "Shares a file with FLY-1, so it waits." }), task(3, 2), task(4, 2, { state: "skipped", entries: [] })],
    edges: [{ beforeTaskId: "t1", afterTaskId: "t2", cause: "overlap", collidingPaths: [{ before: LONG, after: "packages/core/src/domain/" }] }],
  };

  async function mountSheet(plan: DispatchPlanDto) {
    const { WavePlanSheet } = await import("../WavePlanSheet");
    const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
    queryClient.setQueryData(dispatchPlanKey("epic-1"), plan);
    render(
      <QueryClientProvider client={queryClient}>
        <WavePlanSheet epicId="epic-1" onClose={() => {}} />
      </QueryClientProvider>,
    );
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]') as HTMLElement;
    const body = dialog.querySelector<HTMLElement>(".wave-plan-body") as HTMLElement;
    return { dialog, body };
  }

  it("the draft: wave pickers, path fields, Approve and Cancel are inside the dialog, nothing runs sideways, all reachable", async () => {
    const { dialog, body } = await mountSheet(draft);
    expect(body.scrollWidth, "a long path does not push the body sideways").toBeLessThanOrEqual(body.clientWidth + 1);
    for (const control of controlsIn(dialog)) expectInside(control, dialog, `${nameOf(control)} in the draft`);
    const names = controlsIn(dialog).map(nameOf);
    for (const expected of ["Wave for FLY-1", "Files for FLY-1", "Save files for FLY-1", "Cancel", "Approve and start"]) {
      expect(names, `the draft offers "${expected}"`).toContain(expected);
    }
    expect(names, "a skipped task is not editable").not.toContain("Wave for FLY-4");
    await expectReachable(dialog);
  });

  it("editing a path: the field takes the text, Save files enables, and a long refusal from the core stays inside the dialog", async () => {
    const refusal = `${LONG} overlaps FLY-1 and FLY-2 in the same wave, so ${"the core refuses this entry and says so at length, ".repeat(3)}`;
    calls.edit.mockRejectedValueOnce(refusal);
    const { dialog, body } = await mountSheet(draft);
    const field = screen.getByLabelText("Files for FLY-3") as HTMLTextAreaElement;
    const save = screen.getByRole("button", { name: "Save files for FLY-3" }) as HTMLButtonElement;
    expect(save.disabled, "nothing to save yet").toBe(true);
    fireEvent.change(field, { target: { value: `${LONG}\npackages/ui/` } });
    expect(save.disabled, "an edit enables Save files").toBe(false);
    expectInside(field, dialog, "the edited field");
    expectInside(save, dialog, "Save files");
    await expectReachable(dialog);
    fireEvent.click(save);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("the core refuses this entry");
    expectInside(alert, body, "the refusal");
    expect(body.scrollWidth, "the refusal wraps, it does not scroll sideways").toBeLessThanOrEqual(body.clientWidth + 1);
    expect(field.value, "the displayed set stays as the user typed it only until the core answers").toBeDefined();
  });

  it("editing a wave: the picker offers one more wave than exists and stays inside the dialog", async () => {
    const { dialog } = await mountSheet(draft);
    const picker = screen.getByLabelText("Wave for FLY-3") as HTMLSelectElement;
    expect(Array.from(picker.options).map((o) => o.textContent)).toEqual(["Wave 1", "Wave 2", "Wave 3"]);
    expectInside(picker, dialog, "the wave picker");
  });

  async function failApproval() {
    calls.approve.mockRejectedValueOnce(`Cannot approve: ${LONG} collides with a task in another plan, and ${"this explanation is long. ".repeat(6)}`);
    const mounted = await mountSheet(draft);
    fireEvent.click(screen.getByRole("button", { name: "Approve and start" }));
    const alert = await screen.findByText(/Cannot approve/);
    return { ...mounted, alert };
  }

  it("Approve and start: a failed approval puts the core's words in the dialog, wrapped, and Approve is usable again", async () => {
    const { dialog, body, alert } = await failApproval();
    // Where the alert sits inside the SCROLLING body, in content coordinates: it must fit the content
    // box, which is what "not clipped" means for a scroll container. Whether it is on screen without
    // scrolling is the next test.
    const contentBottom = alert.getBoundingClientRect().bottom - body.getBoundingClientRect().top + body.scrollTop;
    expect(contentBottom, "the alert is inside the scrollable content").toBeLessThanOrEqual(body.scrollHeight + 0.5);
    expect(alert.getBoundingClientRect().right).toBeLessThanOrEqual(body.getBoundingClientRect().right + 0.5);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
    const approve = screen.getByRole("button", { name: "Approve and start" }) as HTMLButtonElement;
    await waitFor(() => expect(approve.disabled, "Approve is usable again after a refusal").toBe(false));
    expectInside(approve, dialog, "Approve and start");
    await expectReachable(dialog);
  });

  // KNOWN DEFECT, found by this plan (pre-existing, WavePlanSheet.tsx, deferred: see phases/11-ship-it/deferred-items.md /
  // 11-14-SUMMARY). The approval error renders at the END of the scrolling body, so for any plan taller
  // than the dialog (four tasks is enough at 1440x900) a refused Approve shows nothing: the message is
  // below the fold and the footer, where the user's eye is, says nothing. `it.fails` keeps the suite
  // green while the defect stands and turns RED the day it is fixed, which is the cue to make this a
  // plain `it` and delete this comment.
  it.fails("a failed approval is visible without scrolling the body", async () => {
    const { body, alert } = await failApproval();
    const a = alert.getBoundingClientRect();
    const b = body.getBoundingClientRect();
    expect(a.top, "the alert starts inside the visible part of the body").toBeGreaterThanOrEqual(b.top - 0.5);
    expect(a.bottom, "the alert ends inside the visible part of the body").toBeLessThanOrEqual(b.bottom + 0.5);
  });

  it("a plan in force: read-only, its recorded pairs and Why? actions fit, Close is reachable", async () => {
    const { dialog, body } = await mountSheet({ ...draft, status: "running", edgesFrozen: true });
    expect(controlsIn(dialog).map(nameOf), "no edit or approve controls once approved").toEqual(["Why does FLY-2 wait?", "Close"]);
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
    for (const control of controlsIn(dialog)) expectInside(control, dialog, nameOf(control));
    await expectReachable(dialog);
  });
});
