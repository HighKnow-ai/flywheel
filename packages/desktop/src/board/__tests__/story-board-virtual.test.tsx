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
import type { EpicDto, MilestoneDto, StoryDto } from "../../adapters/tauri";

const EPICS = 20;
const STORIES_PER_EPIC = 50;
const STORIES = EPICS * STORIES_PER_EPIC;
/** Far more than an 800px viewport shows, far fewer than the project holds. */
const ROW_BOUND = 60;

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: () => Promise.resolve([milestone]),
    epicList: () => Promise.resolve(epics),
    storyListForProject: () => Promise.resolve(stories),
    milestoneProgress: () => Promise.resolve(null),
    taskList: () => Promise.resolve([]),
    storyContextPacketSize: () => Promise.resolve({ bytes: 4000, approxTokens: 1000, overSoftLimit: false }),
    blockedSummary: () => Promise.resolve({ blockedStoryIds: [], blockedCount: 0 }),
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
  epicId: epics[Math.floor(i / STORIES_PER_EPIC)].id,
  key: `FLY-${i + 1}`,
  title: `Story ${i + 1}`,
  description: null,
  state: i % 3 === 0 ? "ready" : "merged",
  runsAfterStoryId: null,
  rank: pad(i, 4),
}));

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

    expect(await screen.findByRole("button", { name: `Open Story FLY-${STORIES} Story ${STORIES}` })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Epic 20" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open Story FLY-1 Story 1" })).not.toBeInTheDocument();
    expect(mountedRowIds().length).toBeLessThanOrEqual(ROW_BOUND);
  });

  it("opens the Story from a row scrolled into view", async () => {
    renderBoard();
    await screen.findByRole("button", { name: "Open Story FLY-1 Story 1" });

    scrollBoardTo(1_000_000);
    const row = (await screen.findByRole("button", { name: `Open Story FLY-${STORIES} Story ${STORIES}` })).closest("li")!;
    fireEvent.click(row);

    expect(useUiStore.getState().currentStoryId).toBe(`s${pad(STORIES, 4)}`);
  });

  it("keeps a focused row mounted while it scrolls out of view, so the keyboard never loses its place", async () => {
    renderBoard();
    const first = await screen.findByRole("button", { name: "Open Story FLY-2 Story 2" });
    act(() => first.focus());

    scrollBoardTo(1_000_000);

    await screen.findByRole("button", { name: `Open Story FLY-${STORIES} Story ${STORIES}` });
    expect(first.isConnected).toBe(true);
    expect(document.activeElement).toBe(first);
    expect(mountedRowIds().length).toBeLessThanOrEqual(ROW_BOUND + 1);
  });
});
