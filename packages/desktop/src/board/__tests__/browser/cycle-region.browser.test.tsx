/**
 * Phase 14 plan 09 (criterion 5, D-03, D-04): the STRUCTURAL half of `14-HIERARCHY.md`, held in an engine.
 *
 * The statement says the epic roster keeps the lead and the Cycle region orients; the region has three levels
 * (the current Cycle loud, later Cycles quiet, the frame recessive) carried by type scale, weight, spacing and
 * position, never by colour. Every property pinned here is a LAYOUT property jsdom cannot measure: computed type,
 * computed weight, wrapped line counts, what is on screen at the review width, DOM containment against the
 * virtualizer. They are read from `getComputedStyle` and the box model, not from the stylesheet text.
 *
 * What this does NOT assert is the perceptual half: "the region reads as the focal arrangement". That is the
 * owner's judgement in plan 14-10 and a `verification: backstop` truth of plan 14-09. A test claiming to assert it
 * would be a test claiming to be a person. What is held is the structure the judgement rests on, so that a later
 * change that flattens the hierarchy FAILS rather than merely looking slightly worse.
 *
 * The data is hostile on purpose and realistic for a roadmap-derived board: the demonstration board's Cycle goals
 * are whole roadmap paragraphs (300 to 400 characters, one of them the full goal plus its metadata), because a
 * Cycle's goal is written by a person and has no length limit.
 *
 * Runs in the ordinary arm and the dark arm (`--config vitest.browser.dark.config.ts`); each also writes one
 * capture for the development record, the scheme named in the path so the dark run does not overwrite the light
 * one. The owner's verdict screenshot is plan 14-10's, taken from the running application.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { page } from "vitest/browser";
import "../../../styles/tokens.css";
import "../../../styles/type.css";
import "../../../styles/motion.css";
import "../../../App.css";
import { BoardView } from "../../BoardView";
import { resetUiState } from "../../../state/uiStore";
import { useCollapseStore } from "../../collapseStore";
import { contrastRatio } from "../../../theme/contrast";
import type { BandCounts } from "../../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../../adapters/tauri", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../adapters/tauri")>()),
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardEpicProgress: (projectId: string) => invokeCommandMock("board_epic_progress", { projectId }),
  boardChangeFlags: (projectId: string) => invokeCommandMock("board_change_flags", { projectId }),
  authoringProposalsPending: (projectId: string) => invokeCommandMock("authoring_proposals_pending", { projectId }),
  authoringRunForEpic: (epicId: string) => invokeCommandMock("authoring_run_for_epic", { epicId }),
  cycleRegion: (projectId: string) => invokeCommandMock("cycle_region", { projectId }),
}));

const scheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
const OUT = "../../../../../../.impeccable/review";
const EMPTY_COUNTS: BandCounts = { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 };

const LONG_GOAL =
  "Cyril sees where the work stands without going to look: the current Cycle's goal and progress and the roadmap ahead of it, folded from real counts, and the board finally carries saturated state colour on a surface worth looking at, with colour as the fastest channel and never the only one. Mode: mvp Depends on: Phase 13 Requirements: RECD-08, RECD-09, RECD-10, VIS-01, VIS-02, VIS-03, VIS-04, VIS-06, VIS-07 Success Criteria (what must be TRUE):";
const LATER_GOALS = [
  "The encoding work is gone. File-sets, acceptance criteria and decomposition arrive drafted by an agent and are accepted one item at a time, the hand-typed path field survives only as an escape hatch, and the product can tell reflex acceptance from good drafting rather than assuming. Mode: mvp Depends on: Phase 14",
  "Cyril states a problem, is challenged on it, and walks away with a PRD whose slots and acceptance bar are structured board data he signs off on, and an agent that reaches a real fork proposes the decision rather than choosing silently. Mode: mvp",
  "Cyril adjudicates evidence instead of reading a diff cold, an agent with no memory of having written the code reports, per criterion, what it found and where.",
  "The direction lands on the information architecture the milestone built, dark-first with a light mode derived from it.",
];
const EPICS = Array.from({ length: 8 }, (_, i) => ({
  id: `epic-${i}`,
  key: `FLY-${i + 1}`,
  title: `Epic ${i + 1}: a roster entry`,
  status: "in_progress",
  integrationBranch: null,
}));
const REGION = {
  active: {
    id: "c1",
    key: "FLY-1",
    goal: LONG_GOAL,
    exitCriteria: null,
    state: "active",
    rank: "1",
    unfinishedEpics: [],
    scopeDrift: { epicsAdded: 10, epicsRemoved: 0, sentence: "10 epics added since this Cycle started" },
    progress: { epics: 10, tasksTotal: 27, tasksDone: 7, agentsRunning: 1, agentsBlocked: 1 },
  },
  later: LATER_GOALS.map((goal, i) => ({ id: `c${i + 2}`, key: `FLY-${i + 2}`, goal, epicCount: i, scopeDrift: null })),
  total: 5,
  listed: 5,
  truncated: false,
};

beforeEach(() => {
  resetUiState();
  useCollapseStore.setState({ collapsedByProject: {} });
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    switch (command) {
      case "cycle_region":
        return Promise.resolve(REGION);
      case "actor_list":
      case "board_change_flags":
        return Promise.resolve([]);
      case "epic_list_all":
        return Promise.resolve({ epics: EPICS, total: EPICS.length, truncated: false });
      case "board_epic_progress":
        return Promise.resolve(
          EPICS.map((e) => ({ epicId: e.id, byStatus: [{ status: "todo", count: 3 }], total: 3, done: 0, agentsRunning: 0, agentsBlocked: 0, criteria: null })),
        );
      case "authoring_proposals_pending":
        return Promise.resolve({ proposals: [], counts: { pending: 0, accepted: 0, rejected: 0, merged: 0, deferred: 0 } });
      case "board_list":
      case "board_search":
        return Promise.resolve({
          items: EPICS.map((e) => ({ id: e.id, key: e.key, title: e.title, status: e.status, rank: "a0", priority: 0, epicId: null, kind: "epic" })),
          issues: [],
          counts: EMPTY_COUNTS,
        });
      default:
        return Promise.resolve(null);
    }
  });
});

/** The board as the window lays it out at the review width, with the height the pane has under the header and filters. */
async function renderBoard() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <div style={{ height: 560, width: 1200 }}>
        <BoardView projectId="proj-1" items={[]} issues={[]} counts={EMPTY_COUNTS} onCreateTask={() => {}} />
      </div>
    </QueryClientProvider>,
  );
  const region = await screen.findByRole("region", { name: "Current cycle" });
  await waitFor(() => expect(document.querySelectorAll(".epic-header-row").length).toBeGreaterThanOrEqual(3));
  return region;
}

const cs = (el: Element) => getComputedStyle(el);
const px = (v: string) => parseFloat(v);

/** The type step a class resolves to, read from the engine so this file names no pixel size of its own. */
function typeStep(cls: string): { size: number; weight: number } {
  const probe = document.createElement("span");
  probe.className = cls;
  document.body.appendChild(probe);
  const out = { size: px(cs(probe).fontSize), weight: Number(cs(probe).fontWeight) };
  probe.remove();
  return out;
}

/** `rgb(r, g, b)` or `rgba(...)` to `#rrggbb` (alpha ignored: the region paints opaque ink on an opaque surface). */
function hex(rgb: string): string {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
}

const goalOf = (region: HTMLElement) => region.querySelector<HTMLElement>(".type-heading")!;
const laterGoals = (region: HTMLElement) =>
  Array.from(region.querySelectorAll<HTMLElement>("[data-cycle-line]")).map((li) => li.firstElementChild as HTMLElement);
const lines = (el: HTMLElement) => Math.round(el.getBoundingClientRect().height / px(cs(el).lineHeight));

describe("the Cycle region realises the structure of 14-HIERARCHY.md", () => {
  it("runs in the colour scheme this config claims", () => {
    expect(scheme).toBe(import.meta.env.VITE_EXPECT_SCHEME ?? "light");
  });

  it("has three measurably distinct levels: the loud goal outsizes and outweighs the quiet line, by a step and not a rounding", async () => {
    const region = await renderBoard();
    const loud = cs(goalOf(region));
    const quiet = cs(laterGoals(region)[0]);
    expect(px(loud.fontSize) - px(quiet.fontSize), "type size gap").toBeGreaterThanOrEqual(2);
    expect(Number(loud.fontWeight) - Number(quiet.fontWeight), "weight gap").toBeGreaterThanOrEqual(200);
    expect(px(loud.fontSize)).toBe(typeStep("type-heading").size);
    expect(px(quiet.fontSize)).toBe(typeStep("type-body").size);
  });

  it("keeps the lead with the roster: its title is at least as prominent as the region's loud level, and the roster is not outweighed", async () => {
    const region = await renderBoard();
    const loud = cs(goalOf(region));
    const rosterTitle = cs(document.querySelector(".epic-header-row .type-heading")!);
    expect(px(rosterTitle.fontSize)).toBeGreaterThanOrEqual(px(loud.fontSize));
    expect(Number(rosterTitle.fontWeight)).toBeGreaterThanOrEqual(Number(loud.fontWeight));

    // "The region as a whole outweighs the roster" is the statement's step-1 fail. Measured as area on screen:
    // the region is shorter than the pane the roster scrolls in, and the roster shows real rows beneath it.
    const pane = document.querySelector<HTMLElement>(".board-view")!.getBoundingClientRect();
    expect(region.getBoundingClientRect().height, "region taller than the roster's own pane").toBeLessThan(pane.height);
    const visibleRows = Array.from(document.querySelectorAll(".epic-header-row")).filter((row) => {
      const r = row.getBoundingClientRect();
      return r.top >= pane.top - 1 && r.bottom <= pane.bottom + 1;
    });
    expect(visibleRows.length, "epic rows fully on screen under the region").toBeGreaterThanOrEqual(3);
  });

  it.each([716, 900, 936, 960, 1016, 1180, 1200])(
    "keeps the roster row whole and its title readable at a %ipx board pane (716 is the 900px window minimum, 1016 the default window)",
    async (width) => {
      // The roster keeps the hierarchy lead (14-HIERARCHY.md section 1). Found on the running application at the default
      // window: every roster title read "1..." and, once the ladder shed the distribution strip, the row broke into two
      // lines. Two defects in the container ladder (App.css): its first rung came at 900px although the full template's
      // fixed columns, gaps and padding already take 976px, and the strip it meant to shed carries an inline
      // `display: flex` that a class rule cannot beat, so the template lost a column and the cell stayed. 160px is the
      // title the ladder's own first rung left at 900px (900 - 740 of fixed columns); this holds every rung to it.
      render(
        <QueryClientProvider client={new QueryClient()}>
          <div style={{ height: 560, width }}>
            <BoardView projectId="proj-1" items={[]} issues={[]} counts={EMPTY_COUNTS} onCreateTask={() => {}} />
          </div>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(document.querySelectorAll(".epic-header-row").length).toBeGreaterThanOrEqual(3));
      const row = document.querySelector<HTMLElement>(".epic-header-row")!;
      const title = row.querySelector<HTMLElement>(".type-heading")!;
      expect(title.getBoundingClientRect().width, "roster title width").toBeGreaterThanOrEqual(160);
      const box = row.getBoundingClientRect();
      const strays = Array.from(row.children)
        .filter((cell) => cs(cell).display !== "none")
        .filter((cell) => {
          const r = cell.getBoundingClientRect();
          return r.bottom > box.bottom + 1 || r.right > box.right + 1;
        })
        .map((cell) => cell.textContent);
      expect(strays, "cells that fell out of the row's single line").toEqual([]);
      // The template and the cells must agree: a rung that drops a column has to drop the cell that owned it.
      // The ladder reads the CELL's width (the pane less the scrollbar), not the pane's.
      const cellWidth = row.closest<HTMLElement>(".epic-header-cell")!.clientWidth;
      const strip = row.querySelector<HTMLElement>(".field-epic-distribution")!;
      expect(cs(strip).display === "none", "distribution strip hidden exactly when the ladder has shed it").toBe(cellWidth <= 1160);
    },
  );

  it("is a sibling above the virtualizer, not a descendant of the element carrying the board-view class", async () => {
    const region = await renderBoard();
    const list = document.querySelector(".board-view")!;
    expect(list.contains(region)).toBe(false);
    expect(region.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("has exactly one element at the loud type treatment: nothing else in the region competes with the current Cycle", async () => {
    const region = await renderBoard();
    const loud = typeStep("type-heading");
    const atLoud = Array.from(region.querySelectorAll<HTMLElement>("*")).filter(
      (el) => px(cs(el).fontSize) >= loud.size && Number(cs(el).fontWeight) >= loud.weight && (el.textContent ?? "").trim() !== "",
    );
    // The goal is the only element; its own text node is not a second element.
    expect(atLoud).toEqual([goalOf(region)]);
  });

  it("holds the later Cycles at ONE quiet treatment, one line each, in rank order (not a gradient of three)", async () => {
    const region = await renderBoard();
    const goals = laterGoals(region);
    expect(goals).toHaveLength(LATER_GOALS.length);
    const signature = (el: HTMLElement) => [cs(el).fontSize, cs(el).fontWeight, cs(el).color, cs(el).lineHeight].join("|");
    expect(new Set(goals.map(signature)).size, "every later line shares one treatment").toBe(1);
    expect(goals.map((g) => lines(g)), "each later line is one line").toEqual(goals.map(() => 1));
    expect(goals.map((g) => g.textContent)).toEqual(LATER_GOALS);
  });

  it("wraps no goal into a block that pushes the roster off screen, and clips no count, with the full text still in the document", async () => {
    const region = await renderBoard();
    expect(lines(goalOf(region)), "the loud goal").toBeLessThanOrEqual(2);
    expect(goalOf(region).textContent, "clamped to the eye, not cut from the document").toBe(LONG_GOAL);
    const clipped = Array.from(region.querySelectorAll<HTMLElement>("[data-cycle-progress], [data-cycle-scope-drift], button, li > span:last-child"))
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => el.textContent);
    expect(clipped, "counts that do not fit their box").toEqual([]);
    const box = region.getBoundingClientRect();
    for (const el of region.querySelectorAll<HTMLElement>("[data-cycle-progress], [data-cycle-scope-drift], button")) {
      expect(el.getBoundingClientRect().right, `${el.textContent} runs past the region`).toBeLessThanOrEqual(box.right + 1);
    }
  });

  it("never widens the shell that holds it: a goal's length is not an intrinsic width (found on the running application)", async () => {
    // The application shell is a flex row whose content child is `flex: 1` with no `min-width: 0`, so a flex item
    // sizes to the max-content of whatever is inside it. A 400-character goal on one clamped line is exactly that,
    // and it pushed the whole board (filter bar and close control included) past the window's right edge.
    render(
      <QueryClientProvider client={new QueryClient()}>
        <div data-shell style={{ display: "flex", height: 560, width: 1200 }}>
          <div style={{ flex: 1, minHeight: 0 }}>
            <BoardView projectId="proj-1" items={[]} issues={[]} counts={EMPTY_COUNTS} onCreateTask={() => {}} />
          </div>
        </div>
      </QueryClientProvider>,
    );
    const region = await screen.findByRole("region", { name: "Current cycle" });
    const shell = document.querySelector<HTMLElement>("[data-shell]")!;
    expect(shell.scrollWidth, "the shell scrolls sideways").toBeLessThanOrEqual(shell.clientWidth);
    expect(region.getBoundingClientRect().right, "the region runs past the shell").toBeLessThanOrEqual(shell.getBoundingClientRect().right + 1);
    const close = screen.getByRole("button", { name: "Close this cycle" });
    expect(close.getBoundingClientRect().right, "the close control is off screen").toBeLessThanOrEqual(shell.getBoundingClientRect().right + 1);
  });

  it("clears its contrast obligation on every text element, from the engine's computed colours on the region's own surface", async () => {
    const region = await renderBoard();
    const surface = hex(cs(region).backgroundColor);
    const texts = Array.from(region.querySelectorAll<HTMLElement>("*")).filter((el) =>
      Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? "").trim() !== ""),
    );
    expect(texts.length).toBeGreaterThanOrEqual(8);
    for (const el of texts) {
      expect(contrastRatio(hex(cs(el).color), surface), `"${(el.textContent ?? "").slice(0, 40)}" on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("carries no state colour: the region's hierarchy is type, weight, spacing and position (14-HIERARCHY.md section 3)", async () => {
    const region = await renderBoard();
    expect(region.querySelectorAll("[data-state-class]").length).toBe(0);
  });

  it("is captured at the review viewport for the development record, the scheme in the path", async () => {
    await renderBoard();
    await page.screenshot({ path: `${OUT}/cycle-region-built-${scheme}-1200x560.png` });
  });
});
