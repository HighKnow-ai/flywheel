/**
 * Phase 14 plan 14-01 (RECD-09): the Cycle region renders the command's goal and fraction, states
 * an absence in words, and sits outside the virtualized list.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardView } from "../BoardView";
import { CycleRegion } from "../CycleRegion";
import { resetUiState } from "../../state/uiStore";
import type { CycleRegionDto } from "../../adapters/tauri";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  boardEpicProgress: (projectId: string) => invokeCommandMock("board_epic_progress", { projectId }),
  cycleRegion: (projectId: string) => invokeCommandMock("cycle_region", { projectId }),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
}));

const ACTIVE_CYCLE = {
  id: "c1",
  key: "FLY-9",
  goal: "Ship the board",
  exitCriteria: null,
  state: "active",
  rank: "1",
  progress: { epics: 2, tasksTotal: 10, tasksDone: 3, agentsRunning: 0, agentsBlocked: 0 },
};
const NO_ROSTER = { later: [], total: 1, listed: 1, truncated: false };
const ACTIVE: CycleRegionDto = { active: ACTIVE_CYCLE, ...NO_ROSTER };
const LATER = [
  { id: "c2", key: "FLY-10", goal: "Reviews land", epicCount: 3 },
  { id: "c3", key: "FLY-11", goal: "Relay", epicCount: 0 },
];

function respondWith(region: CycleRegionDto) {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "cycle_region") return Promise.resolve(region);
    if (command === "epic_list_all") return Promise.resolve({ epics: [], total: 0, truncated: false });
    return Promise.resolve(undefined);
  });
}

function renderWith(ui: React.ReactElement) {
  return render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
});

afterEach(() => resetUiState());

describe("CycleRegion", () => {
  it("renders the goal and the command's fraction", async () => {
    respondWith(ACTIVE);
    renderWith(<CycleRegion projectId="proj-1" />);
    expect(await screen.findByText("Ship the board")).toBeTruthy();
    expect(screen.getByText("3/10 tasks done")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Current cycle" })).toBeTruthy();
  });

  it("states an absence in words when no cycle is active", async () => {
    respondWith({ active: null, later: [], total: 0, listed: 0, truncated: false });
    renderWith(<CycleRegion projectId="proj-1" />);
    expect(await screen.findByText("No cycle is active.")).toBeTruthy();
  });

  it("prints the fold's integer pair as-is at a count above one board page", async () => {
    respondWith({
      ...ACTIVE,
      active: { ...ACTIVE_CYCLE, progress: { ...ACTIVE_CYCLE.progress, tasksTotal: 940, tasksDone: 412 } },
    });
    renderWith(<CycleRegion projectId="proj-1" />);
    expect(await screen.findByText("412/940 tasks done")).toBeTruthy();
    expect(document.querySelector("[data-cycle-region]")!.textContent).not.toMatch(/%/);
  });

  it("says so in words, not as a zero, when the cycle holds no tasks", async () => {
    respondWith({
      ...ACTIVE,
      active: { ...ACTIVE_CYCLE, progress: { ...ACTIVE_CYCLE.progress, tasksTotal: 0, tasksDone: 0 } },
    });
    renderWith(<CycleRegion projectId="proj-1" />);
    expect(await screen.findByText("No tasks in this cycle yet")).toBeTruthy();
  });

  it("renders each later cycle as one line with its goal and epic count, in order", async () => {
    respondWith({ ...ACTIVE, later: LATER, total: 3, listed: 3 });
    renderWith(<CycleRegion projectId="proj-1" />);
    const list = await screen.findByRole("list", { name: "Later cycles" });
    const lines = within(list).getAllByRole("listitem");
    expect(lines.map((l) => l.textContent)).toEqual(["Reviews land3 epics", "Relayno epics yet"]);
  });

  it("shows the roadmap ahead even when no cycle is active", async () => {
    respondWith({ active: null, later: LATER, total: 2, listed: 2, truncated: false });
    renderWith(<CycleRegion projectId="proj-1" />);
    expect(await screen.findByText("No cycle is active.")).toBeTruthy();
    expect(screen.getByText("Reviews land")).toBeTruthy();
  });

  it("prints how many cycles are not shown, naming the real total, when truncated", async () => {
    respondWith({ ...ACTIVE, later: LATER, total: 503, listed: 500, truncated: true });
    renderWith(<CycleRegion projectId="proj-1" />);
    const notice = await screen.findByRole("status");
    expect(notice.textContent).toContain("3 more cycles ahead not shown");
    expect(notice.textContent).toContain("503");
  });

  it("prints no truncation line when the roster is complete", async () => {
    respondWith({ ...ACTIVE, later: LATER, total: 3, listed: 3 });
    renderWith(<CycleRegion projectId="proj-1" />);
    await screen.findByRole("list", { name: "Later cycles" });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("is mounted on the board outside the element carrying className board-view", async () => {
    respondWith(ACTIVE);
    const { container } = renderWith(
      <BoardView
        projectId="proj-1"
        items={[]}
        counts={{ backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 }}
        onCreateTask={() => {}}
      />,
    );
    const region = await screen.findByRole("region", { name: "Current cycle" });
    const list = container.querySelector(".board-view");
    expect(list).not.toBeNull();
    expect(list!.contains(region)).toBe(false);
    expect(region.compareDocumentPosition(list!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
