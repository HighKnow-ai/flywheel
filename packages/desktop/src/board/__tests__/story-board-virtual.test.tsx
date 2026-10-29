/**
 * Behaviour under test (issue #116): the Epic-grouped board stays instant on a project of 1,000 Stories
 * (PRODUCT.md, performance is a design constraint). Only the rows near the viewport are in the DOM; scrolling
 * brings the rest in, a row still opens its Story, and a focused row stays mounted while it scrolls away.
 *
 * jsdom has no layout: `src/test/setup.ts` gives every element an 800px `offsetHeight`, which the virtualizer
 * reads as the viewport, and every measured row reports zero height, so the board falls back to its estimates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, MilestoneDto, RosterRowDto, StoryDto } from "../../adapters/tauri";
import { at } from "../../test/present";

const EPICS = 20;
const STORIES_PER_EPIC = 50;
const STORIES = EPICS * STORIES_PER_EPIC;
/** Far more than an 800px viewport shows, far fewer than the project holds. */
const ROW_BOUND = 60;

/** Every command the board reaches, by name, so a test can see which reads it issued (#159). */
const { calls } = vi.hoisted(() => ({ calls: vi.fn() }));

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  // Read lazily: the fixtures below are declared after this hoisted factory.
  const recorded =
    (name: string, value: () => unknown) =>
    (...args: unknown[]) => {
      calls(name, ...args);
      return Promise.resolve(value());
    };
  return {
    ...actual,
    // The board mounts the Needs-you column (#156), which reads its list and rides the fleet's subscription.
    needsYouList: () => Promise.resolve([]),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    milestoneList: recorded("milestoneList", () => [milestone]),
    epicList: recorded("epicList", () => epics),
    storyListForProject: recorded("storyListForProject", () => stories),
    milestoneProgress: recorded("milestoneProgress", () => null),
    rosterRows: recorded("rosterRows", () => rows),
    // The reads a row used to issue for itself.
    taskList: recorded("taskList", () => []),
    storyStopped: recorded("storyStopped", () => null),
    sessionsForStory: recorded("sessionsForStory", () => []),
    storyContextPacketSize: recorded("storyContextPacketSize", () => ({
      bytes: 4000,
      approxTokens: 1000,
      overSoftLimit: false,
    })),
    blockedSummary: recorded("blockedSummary", () => ({ blockedStoryIds: [], blockedCount: 0 })),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

const milestone: MilestoneDto = {
  id: "m1",
  projectId: "p1",
  title: "M1",
  exitTest: null,
  state: "shaping",
  current: true,
  rank: "a",
};

const pad = (n: number, width: number) => String(n).padStart(width, "0");

const epics: EpicDto[] = Array.from({ length: EPICS }, (_, i) => ({
  id: `e${pad(i + 1, 2)}`,
  projectId: "p1",
  milestoneId: "m1",
  key: `FLY-E${i + 1}`,
  title: `Epic ${i + 1}`,
  problem: null,
  scope: null,
  outOfScope: null,
  exitTest: null,
  state: "shaping",
  rank: pad(i, 2),
}));

const stories: StoryDto[] = Array.from({ length: STORIES }, (_, i) => ({
  id: `s${pad(i + 1, 4)}`,
  projectId: "p1",
  epicId: at(epics, Math.floor(i / STORIES_PER_EPIC)).id,
  key: `FLY-${i + 1}`,
  title: `Story ${i + 1}`,
  description: null,
  state: at(["ready", "merged", "running", "running", "running", "in_review"] as const, i % 6),
  runsAfterStoryId: null,
  rank: pad(i, 4),
}));

/** The core's figures for every row: a Running Story is in turn working, Waiting on you and Stopped. */
const rows: RosterRowDto[] = stories.map((story, i) => ({
  storyId: story.id,
  attention: i % 6 === 3 ? "waiting_on_you" : i % 6 === 4 ? "stopped" : null,
  endingReason: i % 6 === 4 ? "crash" : null,
  liveSessionId: i % 6 === 2 || i % 6 === 3 ? `ses-${story.id}` : null,
  doingTaskTitle: i % 6 === 2 ? "Wire the command" : null,
  criteriaMet: 1,
  criteriaTotal: 2,
  tasksDone: 1,
  tasksTotal: 3,
  review: i % 6 === 5 ? { files: 3, added: 40, removed: 7 } : null,
  canMakeReady: false,
}));

/** The names of the commands issued, once each. */
function issued(): string[] {
  return [...new Set(calls.mock.calls.map(([name]) => name as string))].sort();
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" />
    </QueryClientProvider>,
  );
}

function mountedRowIds(): string[] {
  return Array.from(document.querySelectorAll("li[data-story-id]")).map((li) => li.getAttribute("data-story-id")!);
}

function scrollBoardTo(top: number) {
  const scroller = document.querySelector<HTMLElement>("[data-board-scroll]");
  if (!scroller) throw new Error("the board has no scroll container");
  act(() => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  calls.mockClear();
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
});

describe("StoryBoard: 1,000 Stories across 20 Epics (issue #116)", () => {
  it("mounts only the rows near the viewport", async () => {
    renderBoard();
    await screen.findByRole("button", { name: "Open Story FLY-1 Story 1" });

    const mounted = mountedRowIds();
    expect(mounted.length).toBeGreaterThan(0);
    expect(mounted.length).toBeLessThanOrEqual(ROW_BOUND);
    expect(document.querySelectorAll("section[aria-labelledby^='epic-']").length).toBeLessThan(EPICS);
    expect(screen.getByRole("heading", { name: "Epic 1" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Epic 20" })).not.toBeInTheDocument();
  });

  it("mounts the rows in Story order, so Tab walks them in the order they read", async () => {
    renderBoard();
    await screen.findByRole("button", { name: "Open Story FLY-1 Story 1" });

    const mounted = mountedRowIds();
    expect(mounted).toEqual([...mounted].sort());
    expect(mounted[0]).toBe("s0001");
  });

  it("brings the far rows in when the board scrolls, and keeps the count bounded", async () => {
    renderBoard();
    await screen.findByRole("button", { name: "Open Story FLY-1 Story 1" });

    scrollBoardTo(1_000_000);

    expect(
      await screen.findByRole("button", { name: `Open Story FLY-${STORIES} Story ${STORIES}` }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Epic 20" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Story FLY-1 Story 1" })).not.toBeInTheDocument();
    expect(mountedRowIds().length).toBeLessThanOrEqual(ROW_BOUND);
  });

  it("opens the Story from a row scrolled into view", async () => {
    renderBoard();
    await screen.findByRole("button", { name: "Open Story FLY-1 Story 1" });

    scrollBoardTo(1_000_000);
    const row = (await screen.findByRole("button", { name: `Open Story FLY-${STORIES} Story ${STORIES}` })).closest(
      "li",
    )!;
    fireEvent.click(row);

    expect(useUiStore.getState().currentStoryId).toBe(`s${pad(STORIES, 4)}`);
  });

  it("keeps a focused row mounted while it scrolls out of view, so the keyboard never loses its place", async () => {
    renderBoard();
    // The row once its Epic is read: until then the Stories sit in a card of their own.
    await screen.findByRole("heading", { name: "Epic 1" });
    const first = screen.getByRole("button", { name: "Open Story FLY-2 Story 2" });
    act(() => first.focus());

    scrollBoardTo(1_000_000);

    await screen.findByRole("button", { name: `Open Story FLY-${STORIES} Story ${STORIES}` });
    expect(first.isConnected).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(mountedRowIds().length).toBeLessThanOrEqual(ROW_BOUND + 1);
  });

  it("issues no read per row: the whole roster is one core read, however far it scrolls (issue #159)", async () => {
    renderBoard();
    await screen.findByRole("button", { name: "Open Story FLY-1 Story 1" });
    // The rows have their figures: a Waiting on you row offers Answer, an In review row its diff size.
    await screen.findByRole("button", { name: "Answer FLY-4" });
    expect(screen.getAllByText("+40 −7 · 3 files").length).toBeGreaterThan(0);

    scrollBoardTo(1_000_000);
    await screen.findByRole("button", { name: `Open Story FLY-${STORIES} Story ${STORIES}` });

    expect(issued()).toEqual(["epicList", "milestoneList", "milestoneProgress", "rosterRows", "storyListForProject"]);
    const rosterReads = calls.mock.calls.filter(([name]) => name === "rosterRows");
    expect(rosterReads).toEqual([["rosterRows", "m1"]]);
  });
});
