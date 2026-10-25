/**
 * The fleet surface and the worktree inventory at real row density, measured in WebKit (plan 11-15,
 * register items D-REV-47 and D-REV-54). jsdom has no layout engine, so "does the project column push
 * the age column out of the row" cannot be asked there; every assertion below is a `getBoundingClientRect`
 * or `scrollWidth` comparison, so an overflow fails the build without anyone looking at a screenshot.
 *
 * WHAT THIS SETTLES AND WHAT IT DOES NOT. It settles containment: every cell sits inside its row, no two
 * cells overlap, text that is allowed to be cut is cut with an ellipsis, text that must not be cut is not,
 * and a long project name leaves the row one line high with the age column still inside it. It does NOT
 * settle whether the layout is easy to scan, which is a human aesthetic judgement (D-REV-47), nor whether a
 * multi-second worktree walk leaves the window responsive (D-REV-54: needs the installed app).
 *
 * Widths. 1200 is the stage left after the project rail at the 1440 viewport; 900 is a deliberately
 * narrower stage; 652 is what a 900px window leaves beside the rail, where the fleet table drops its Project
 * and Doing columns (#208). The tables are `table-fixed`, so the Story column takes what the others leave
 * and every cell (the subject above all) must still be painted at 652.
 *
 * Provenance. Every row below is a SYNTHETIC fixture (the same shape the jsdom suites use), chosen to put
 * the longest text each column can carry into the row: it is a stress input, not a capture of a real fleet.
 *
 * Both colour schemes. The same file runs under `test:browser` and `test:browser:dark`; the first test
 * fails if the engine landed in the other scheme, so a dark run cannot silently measure the light world.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../../../styles/globals.css";
import type { FleetListDto, FleetRowDto, InventoryReason, WorktreeInventoryRowDto } from "../../../adapters/tauri";
import { FleetSurface } from "../../FleetSurface";
import { RECLAIM_REASONS, WorktreeInventory } from "../../WorktreeInventory";

const served = vi.hoisted(() => ({ fleet: undefined as unknown, inventory: undefined as unknown }));

vi.mock(import("../../../adapters/tauri"), async (importOriginal) => ({
  ...(await importOriginal()),
  fleetList: () => Promise.resolve(served.fleet as FleetListDto),
  fleetBlockedQueue: () => Promise.resolve([]),
  worktreeInventory: () => Promise.resolve(served.inventory as WorktreeInventoryRowDto[]),
  worktreeMeasure: () => Promise.resolve([]),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
}));

afterEach(cleanup);

const WIDTHS = [1200, 900, 652] as const;
const TOL = 0.5;

// ---------------------------------------------------------------------------------------------
// Fixtures: the longest text each column can carry.
// ---------------------------------------------------------------------------------------------

const LONG_PROJECT = "Meridian Logistics Platform Modernisation Programme (EMEA, Phase Two, Customer Facing)";
const LONG_TITLE =
  "Replace the legacy order reconciliation batch with an event-sourced projection that tolerates late and duplicate deliveries";
const LONG_NARRATION =
  "I am going to read the reconciliation module before I touch the projection, because the retry path decides how late events are handled and I do not want to guess.";

const line = (event: Record<string, unknown>) => JSON.stringify(event);

function fleetRow(id: string, overrides: Partial<FleetRowDto> = {}): FleetRowDto {
  return {
    sessionId: id,
    projectId: "proj-1",
    projectName: "Alpha",
    projectKeyPrefix: "ALP",
    projectStatus: "active",
    storyId: `story-${id}`,
    storyKey: `ALP-${id}`,
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

const ended = new Date(Date.now() - 3 * 3_600_000).toISOString();

/** One row per state the surface draws, plus the long-text stress rows. Core order: by band. */
function stressRows(): FleetRowDto[] {
  return [
    fleetRow("101", { fleetState: "blocked", runStatus: "blocked", blockedSince: new Date(Date.now() - 41 * 60_000).toISOString(), activity: { lines: [line({ type: "tool_call", seq: 1, toolName: "Bash", input: { command: "git push origin --delete feature/doomed" } })], truncated: false } }),
    fleetRow("102", { fleetState: "awaiting_review", runStatus: "completed", endedAt: ended, costUsd: 1.2345, tokensIn: 12_345_678, tokensOut: 987_654 }),
    fleetRow("103", { fleetState: "abandoned", runStatus: "abandoned", endedAt: ended }),
    fleetRow("104", { doingTaskTitle: "Task 1: wire the thing", activity: { lines: [line({ type: "assistant_text", seq: 1, text: LONG_NARRATION })], truncated: false } }),
    fleetRow("105", { storyTitle: LONG_TITLE, doingTaskTitle: LONG_TITLE, activity: { lines: [line({ type: "tool_call", seq: 1, toolName: "Read", input: { file_path: "packages/desktop/src-tauri/src/commands/some/deeply/nested/module/file.rs" } })], truncated: false } }),
    fleetRow("106", { projectName: LONG_PROJECT, storyTitle: LONG_TITLE }),
    fleetRow("107", { fleetState: "completed", runStatus: "completed", endedAt: ended, costUsd: 0.0421, tokensIn: 1_234_567, tokensOut: 45_678 }),
    fleetRow("108", { fleetState: "failed", runStatus: "failed", endedAt: ended, costUsd: 12.3456, tokensIn: 98_765_432, tokensOut: 8_765_432, projectName: LONG_PROJECT }),
    fleetRow("109", { fleetState: "interrupted", runStatus: "interrupted", endedAt: ended }),
  ];
}


// ---------------------------------------------------------------------------------------------
// Measurement helpers.
// ---------------------------------------------------------------------------------------------

const rect = (el: Element) => el.getBoundingClientRect();

function expectInside(inner: Element, outer: Element, what: string) {
  const i = rect(inner);
  const o = rect(outer);
  expect(i.width, `${what} is painted`).toBeGreaterThan(0);
  expect(i.left, `${what}: left edge inside its container`).toBeGreaterThanOrEqual(o.left - TOL);
  expect(i.right, `${what}: right edge inside its container`).toBeLessThanOrEqual(o.right + TOL);
  expect(i.top, `${what}: top edge inside its container`).toBeGreaterThanOrEqual(o.top - TOL);
  expect(i.bottom, `${what}: bottom edge inside its container`).toBeLessThanOrEqual(o.bottom + TOL);
}

/** The box the text itself paints, which can differ from its cell's box when the text overflows. */
function textRect(el: Element): DOMRect {
  const range = document.createRange();
  range.selectNodeContents(el);
  return range.getBoundingClientRect();
}

/** A cell whose content is not allowed to be cut: nothing hangs outside its own box. */
function expectNotCut(cell: Element, what: string) {
  expect(cell.scrollWidth, `${what}: content wider than its cell`).toBeLessThanOrEqual(cell.clientWidth + 1);
}

/** A cell that may be cut must say so: hidden overflow with an ellipsis, on a single line. */
function expectEllipsisWhenCut(cell: HTMLElement, what: string) {
  if (cell.scrollWidth <= cell.clientWidth + 1) return;
  const style = getComputedStyle(cell);
  expect(style.overflowX, `${what} is cut, so overflow must be hidden`).toBe("hidden");
  expect(style.textOverflow, `${what} is cut, so it must end in an ellipsis`).toBe("ellipsis");
  expect(style.whiteSpace, `${what} is cut, so it must not wrap`).toBe("nowrap");
}

/** Whether a cell is drawn at this width (a narrow card leaves the Project and Doing columns out). */
const shown = (el: Element | null): el is HTMLElement => el !== null && getComputedStyle(el).display !== "none";
const fieldOf = (row: Element, name: string) => row.querySelector<HTMLElement>(`[data-field="${name}"]`) as HTMLElement;
const visibleCells = (row: Element) => Array.from(row.querySelectorAll<HTMLElement>(":scope > td")).filter(shown);

// ---------------------------------------------------------------------------------------------
// Mounting.
// ---------------------------------------------------------------------------------------------

async function mountFleet(rows: FleetRowDto[], width: number, height = 1000) {
  served.fleet = { rows, totalRows: rows.length, visibleCostUsd: 14.6821 } satisfies FleetListDto;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <div data-stage style={{ width, height }}>
        <FleetSurface onClose={() => {}} />
      </div>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(utils.container.querySelectorAll("tr[data-run-id]")).toHaveLength(rows.length));
  return utils.container;
}

async function mountInventory(rows: WorktreeInventoryRowDto[], width: number, height = 1000) {
  served.inventory = rows;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <div data-stage style={{ width, height }}>
        <WorktreeInventory onClose={() => {}} />
      </div>
    </QueryClientProvider>,
  );
  await waitFor(() => expect(utils.container.querySelectorAll("[data-worktree-row]")).toHaveLength(rows.length));
  return utils.container;
}

describe("the engine is in the scheme this run claims to measure", () => {
  it("lands in the scheme the config asked for", () => {
    const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    expect(dark ? "dark" : "light", "the config asked for one scheme and the engine landed in the other").toBe(
      import.meta.env.VITE_EXPECT_SCHEME ?? "light",
    );
  });
});

// ---------------------------------------------------------------------------------------------
// D-REV-47, #208: the fleet surface's table.
// ---------------------------------------------------------------------------------------------

describe.each(WIDTHS)("the fleet table at %ipx", (width) => {
  it("draws a header cell over every column it shows, and every row carries one cell per column", async () => {
    const container = await mountFleet(stressRows(), width);
    const headers = Array.from(container.querySelectorAll<HTMLElement>("thead th")).filter(shown);
    const words = headers.map((h) => h.textContent?.trim());
    expect(words.slice(0, 1)).toEqual(["State"]);
    expect(words).toContain("Story");
    expect(words).toContain("Age");
    for (const row of Array.from(container.querySelectorAll<HTMLElement>("tr[data-run-id]"))) {
      expect(visibleCells(row), `row ${row.dataset.runId}`).toHaveLength(headers.length);
    }
    // The Story column takes whatever width is left, so it is the widest at every width.
    const story = headers.find((h) => h.textContent === "Story") as HTMLElement;
    for (const header of headers) expect(rect(story).width, `Story is wider than ${header.textContent}`).toBeGreaterThanOrEqual(rect(header).width - TOL);
  });

  it("cuts only what may be cut, and cuts it with an ellipsis; the state, age and dismiss cells are never cut", async () => {
    const container = await mountFleet(stressRows(), width);
    for (const row of Array.from(container.querySelectorAll<HTMLElement>("tr[data-run-id]"))) {
      const name = `${row.dataset.fleetState} row ${row.dataset.runId}`;
      for (const field of ["state", "age", "dismiss"]) expectNotCut(fieldOf(row, field), `${name}, ${field}`);
      for (const field of ["project", "subject", "doing-task", "activity"]) {
        const cell = fieldOf(row, field);
        if (shown(cell) && cell.offsetParent !== null && !cell.classList.contains("sr-only")) expectEllipsisWhenCut(cell, `${name}, ${field}`);
      }
      const spend = fieldOf(row, "spend");
      if (spend) for (const line of Array.from(spend.children)) expectNotCut(line, `${name}, spend`);
    }
  });

  it("shows the glyph and the word of every state inside the state cell", async () => {
    const container = await mountFleet(stressRows(), width);
    const states = new Set<string>();
    for (const row of Array.from(container.querySelectorAll<HTMLElement>("tr[data-run-id]"))) {
      const cell = fieldOf(row, "state");
      const name = `${row.dataset.fleetState} state cell`;
      states.add(row.dataset.fleetState ?? "");
      const glyph = cell.querySelector("svg");
      expect(glyph, `${name} has its glyph`).not.toBeNull();
      expectInside(glyph as Element, cell, `${name}, glyph`);
      expect(cell.textContent?.trim().length, `${name} has its word`).toBeGreaterThan(0);
      const text = textRect(cell);
      expect(text.right, `${name}: the word ends inside the cell`).toBeLessThanOrEqual(rect(cell).right + TOL);
      expect(text.left, `${name}: the glyph starts inside the cell`).toBeGreaterThanOrEqual(rect(cell).left - TOL);
    }
    expect(states.size, "the fixture draws seven different states").toBe(7);
  });

  it("keeps a long project name and a long title to one line, so their row is no taller than another", async () => {
    const container = await mountFleet(stressRows(), width);
    const byId = (id: string) => container.querySelector<HTMLElement>(`[data-run-id="${id}"]`) as HTMLElement;
    const long = byId("106");
    const short = byId("107");
    expect(rect(long).height, "a long project name or title must not make its row taller").toBeCloseTo(rect(short).height, 0);
    const subject = fieldOf(long, "subject");
    expect(getComputedStyle(subject).textOverflow, "a long title is cut with an ellipsis").toBe("ellipsis");
    const project = fieldOf(long, "project");
    if (shown(project)) {
      expect(getComputedStyle(project).textOverflow, "a long project name must be cut with an ellipsis").toBe("ellipsis");
      expect(project.scrollWidth, "the fixture really is longer than the column (else this proves nothing)").toBeGreaterThan(project.clientWidth + 1);
    }
    const age = fieldOf(long, "age");
    expectInside(age, long, "age cell of the long-name row");
    expect(textRect(age).right, "the age text stays inside the row").toBeLessThanOrEqual(rect(long).right + TOL);
  });

  it("heads each band with its name and count on one line, with Dismiss finished inside the done band's header", async () => {
    const container = await mountFleet(stressRows(), width);
    const bands = Array.from(container.querySelectorAll<HTMLElement>("tbody[data-band]"));
    expect(bands.map((b) => b.dataset.band)).toEqual(["needs-you", "running", "done-failed"]);
    const words = bands.map((band) => {
      const heading = band.querySelector("h2") as HTMLElement;
      const bar = band.querySelector("th") as HTMLElement;
      expectInside(heading, bar, `${band.dataset.band} header within its bar`);
      expectNotCut(heading, `${band.dataset.band} header`);
      const lineHeight = parseFloat(getComputedStyle(heading).lineHeight);
      expect(rect(heading).height, `${band.dataset.band} header is one line`).toBeLessThanOrEqual(lineHeight + 1);
      const dismissAll = Array.from(bar.querySelectorAll("button")).find((b) => b.textContent === "Dismiss finished");
      if (band.dataset.band === "done-failed") {
        expect(dismissAll, "the done band offers Dismiss finished").toBeDefined();
        expectInside(dismissAll as Element, bar, "Dismiss finished");
      } else {
        expect(dismissAll, `${band.dataset.band} offers no Dismiss finished`).toBeUndefined();
      }
      return heading.textContent;
    });
    expect(words).toEqual(["NEEDS YOU", "RUNNING", "DONE / FAILED"]);
  });

  it("holds the top bar, the count and the estimate footer inside the surface, with no sideways scroll", async () => {
    const container = await mountFleet(stressRows(), width);
    const stage = container.querySelector("[data-stage]") as HTMLElement;
    const header = container.querySelector("header") as HTMLElement;
    for (const child of Array.from(header.children)) expectInside(child, header, `header child "${child.textContent}"`);
    expectInside(container.querySelector("[data-fleet-count]") as HTMLElement, stage, "agent count");
    const footer = container.querySelector("[data-fleet-footer]") as HTMLElement;
    expectInside(footer, stage, "estimate footer");
    expectNotCut(footer, "estimate footer");
    expect(stage.scrollWidth, "the surface does not scroll sideways").toBeLessThanOrEqual(stage.clientWidth + 1);
    const scroller = container.querySelector("[data-fleet-table] > [data-slot='table-container']") as HTMLElement;
    expect(scroller.scrollWidth, "the table does not scroll sideways").toBeLessThanOrEqual(scroller.clientWidth + 1);
  });

  it("keeps the column headers in view while the rows scroll under them", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => fleetRow(`${200 + i}`));
    const container = await mountFleet(rows, width, 600);
    const scroller = container.querySelector("[data-fleet-table] > [data-slot='table-container']") as HTMLElement;
    expect(scroller.scrollHeight, "the fixture overflows the card").toBeGreaterThan(scroller.clientHeight);
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const head = container.querySelector("thead") as HTMLElement;
    expect(Math.abs(rect(head).top - rect(scroller).top), "the header row sticks to the top of the card").toBeLessThanOrEqual(1);
    const stage = container.querySelector("[data-stage]") as HTMLElement;
    expect(rect(scroller).bottom, "the card ends inside the window").toBeLessThanOrEqual(rect(stage).bottom + TOL);
  });
});

// ---------------------------------------------------------------------------------------------
// D-REV-54, #208: the worktree inventory's table.
// ---------------------------------------------------------------------------------------------

const DISPOSITION_OF: Record<InventoryReason, WorktreeInventoryRowDto["disposition"]> = {
  merged: "reclaimable",
  dropped: "reclaimable",
  sessionning: "in_use",
  blocked: "in_use",
  uncommitted_changes: "keep",
  project_unreachable: "keep",
  directory_missing: "keep",
  story_open: "keep",
};

function inventoryRow(id: string, reason: InventoryReason, overrides: Partial<WorktreeInventoryRowDto> = {}): WorktreeInventoryRowDto {
  return {
    storyId: id,
    storyKey: `ALP-${id}`,
    storyTitle: "Wire the thing",
    storyState: "merged",
    projectId: "proj-1",
    projectName: "Alpha",
    projectStatus: "active",
    branch: `flywheel/alp-${id}`,
    sizeBytes: 3 * 1024 ** 3,
    sizeMeasuredAt: new Date(Date.now() - 180_000).toISOString(),
    disposition: DISPOSITION_OF[reason],
    reason,
    ...overrides,
  };
}

/** Every reason the core can return, so every chip word is the widest of its kind once; plus the
 * stress rows: a long project and title, the widest size, a never-measured size and a measurement a month
 * old. */
function inventoryRows(): WorktreeInventoryRowDto[] {
  return [
    ...RECLAIM_REASONS.map((reason, i) => inventoryRow(`${i + 1}`, reason)),
    inventoryRow("20", "merged", { projectId: "proj-2", projectName: LONG_PROJECT, storyTitle: LONG_TITLE }),
    inventoryRow("21", "merged", { sizeBytes: 1023.9 * 1024 ** 4, sizeMeasuredAt: new Date(Date.now() - 40 * 86_400_000).toISOString() }),
    inventoryRow("22", "uncommitted_changes", { sizeBytes: null, sizeMeasuredAt: null }),
  ];
}

describe.each(WIDTHS)("the worktree table at %ipx", (width) => {
  it("renders a chip and a reason for every row inside its cell, and a checkbox only where a row can be reclaimed", async () => {
    const rows = inventoryRows();
    const container = await mountInventory(rows, width);
    const items = Array.from(container.querySelectorAll<HTMLElement>("[data-worktree-row]"));
    expect(items).toHaveLength(rows.length);
    const reasonsSeen = new Set<string>();
    for (const item of items) {
      const name = `worktree row ${item.dataset.worktreeRow}`;
      const chip = item.querySelector<HTMLElement>('[data-field="disposition"]') as HTMLElement;
      const reason = chip.querySelector<HTMLElement>('[data-field="reason"]') as HTMLElement;
      expect(reason.textContent?.trim().length, `${name} has its reason`).toBeGreaterThan(0);
      reasonsSeen.add(reason.textContent ?? "");
      expect(chip.querySelector("svg"), `${name}: the chip carries its glyph, never colour alone`).not.toBeNull();
      const cell = chip.closest("td") as HTMLElement;
      expectInside(chip.firstElementChild as Element, cell, `${name}, chip`);
      expectInside(reason, cell, `${name}, reason`);
      const box = item.querySelector<HTMLElement>('[role="checkbox"]');
      if (item.querySelector('[data-disposition="reclaimable"]')) {
        expect(box, `${name} is reclaimable, so it has a checkbox`).not.toBeNull();
        expectInside(box as Element, item, `${name}, checkbox`);
      } else {
        expect(box, `${name} is not reclaimable, so it has no checkbox`).toBeNull();
      }
    }
    expect(reasonsSeen.size, "all eight reason words were rendered and are distinct").toBe(8);
  });

  it("never cuts the size cell, even for the widest size with a month-old measurement", async () => {
    const container = await mountInventory(inventoryRows(), width);
    for (const item of Array.from(container.querySelectorAll<HTMLElement>("[data-worktree-row]"))) {
      expectNotCut(item.querySelector('[data-field="size"]') as HTMLElement, `size cell of row ${item.dataset.worktreeRow}`);
    }
    const widest = container.querySelector('[data-worktree-row="21"] [data-field="size"]') as HTMLElement;
    expect(widest.textContent).toContain("1023.9 TiB");
    expect(widest.textContent).toContain("measured ");
  });

  it("names a long project once, on one line, and cuts a long title instead of growing its row", async () => {
    const container = await mountInventory(inventoryRows(), width);
    const group = container.querySelector('tbody[data-project="proj-2"]') as HTMLElement;
    const project = group.querySelector<HTMLElement>('[data-field="project"]') as HTMLElement;
    expectEllipsisWhenCut(project, "a long project name");
    expect(rect(project).height, "the project's name is one line").toBeLessThanOrEqual(parseFloat(getComputedStyle(project).lineHeight) + 1);
    const long = container.querySelector('[data-worktree-row="20"]') as HTMLElement;
    const short = container.querySelector('[data-worktree-row="1"]') as HTMLElement;
    expect(rect(long).height, "a long title must not make its row taller").toBeCloseTo(rect(short).height, 0);
  });

  it("does not scroll sideways", async () => {
    const container = await mountInventory(inventoryRows(), width);
    const scroller = container.querySelector("[data-worktree-table] > [data-slot='table-container']") as HTMLElement;
    expect(scroller.scrollWidth, "the table does not scroll sideways").toBeLessThanOrEqual(scroller.clientWidth + 1);
  });

  it("keeps the header and the Reclaim bar in view while the rows scroll between them", async () => {
    const rows = Array.from({ length: 40 }, (_, i) => inventoryRow(`${100 + i}`, "merged"));
    const container = await mountInventory(rows, width, 600);
    (container.querySelector('[data-worktree-row="100"] [role="checkbox"]') as HTMLElement).click();
    await waitFor(() => expect(container.querySelector("[data-reclaim-bar]")).not.toBeNull());
    const scroller = container.querySelector("[data-worktree-table] > [data-slot='table-container']") as HTMLElement;
    expect(scroller.scrollHeight, "the fixture overflows the card").toBeGreaterThan(scroller.clientHeight);
    scroller.scrollTop = scroller.scrollHeight;
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const stage = container.querySelector("[data-stage]") as HTMLElement;
    const bar = container.querySelector("[data-reclaim-bar]") as HTMLElement;
    expectInside(bar, stage, "the Reclaim bar");
    expect(Math.abs(rect(container.querySelector("thead") as HTMLElement).top - rect(scroller).top)).toBeLessThanOrEqual(1);
  });
});
