/**
 * Behaviour under test (issue #166, docs/mvp-spec.md §2): a New Story a running Story proposed is accepted into
 * Shaping with its criteria, and the developer makes it Ready with Make Ready. The Story view offers Make Ready on a
 * Shaping Story whose Epic's shaping is closed (the core's `story_make_ready_offer`); while the Story has no
 * criterion it is held, saying why. A Story whose Epic is still being shaped, or past Shaping, is not offered it.
 * On the board, the row of such a Story offers Make Ready as its one next action (`canMakeReady` from the roster's
 * one read).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryView } from "../StoryView";
import { StoryBoard } from "../StoryBoard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { AcceptanceCriterionDto, EpicDto, MakeReadyOfferDto, MilestoneDto, RosterRowDto, StoryDto } from "../../adapters/tauri";

const storyGet = vi.fn();
const storyMakeReady = vi.fn();
const storyMakeReadyOffer = vi.fn();
const criterionList = vi.fn();
const milestoneList = vi.fn();
const epicList = vi.fn();
const storyListForProject = vi.fn();
const rosterRows = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    storyGet: (...args: unknown[]) => storyGet(...args),
    storyMakeReady: (...args: unknown[]) => storyMakeReady(...args),
    storyMakeReadyOffer: (...args: unknown[]) => storyMakeReadyOffer(...args),
    criterionList: (...args: unknown[]) => criterionList(...args),
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    rosterRows: (...args: unknown[]) => rosterRows(...args),
    milestoneProgress: () => Promise.resolve(null),
    epicProgress: () => Promise.resolve([]),
    roadmapRoundRead: () => Promise.resolve({ open: null, proposals: [], last: null }),
    epicShapingSession: () => Promise.resolve(null),
    milestoneShapingSession: () => Promise.resolve(null),
    needsYouList: () => Promise.resolve([]),
    taskList: () => Promise.resolve([]),
    sessionsForStory: () => Promise.resolve([]),
    storyStopped: () => Promise.resolve(null),
    storyContextPacketSize: () => Promise.resolve({ bytes: 4000, approxTokens: 1000, overSoftLimit: false }),
    blockedSummary: () => Promise.resolve({ blockedStoryIds: [], blockedCount: 0 }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

function story(state: string, key = "FLY-12"): StoryDto {
  return {
    id: "s12", projectId: "p1", epicId: "e1", key, title: "Empty-line recovery", description: "Skip an empty line",
    state, runsAfterStoryId: null, rank: "z",
  };
}

const CRITERION: AcceptanceCriterionDto = {
  id: "c1", storyId: "s12", statement: "An empty line yields no token", accepted: false, acceptedAt: null, rank: "a",
  check: null,
};

function offer(value: MakeReadyOfferDto) {
  storyMakeReadyOffer.mockResolvedValue(value);
}

function renderView() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <StoryView projectId="p1" projectName="Threadfin" storyId="s12" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  storyGet.mockReset().mockResolvedValue(story("shaping"));
  storyMakeReady.mockReset().mockResolvedValue(undefined);
  storyMakeReadyOffer.mockReset();
  criterionList.mockReset().mockResolvedValue([CRITERION]);
  milestoneList.mockReset();
  epicList.mockReset();
  storyListForProject.mockReset();
  rosterRows.mockReset();
});

describe("Make Ready in the Story view", () => {
  it("is offered on a Shaping Story whose Epic's shaping is closed, and makes it Ready", async () => {
    offer({ offered: true, refusal: null });
    renderView();
    const button = await screen.findByRole("button", { name: "Make FLY-12 Ready" });
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("An empty line yields no token")).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(storyMakeReady).toHaveBeenCalledWith("s12"));
    expect(storyMakeReadyOffer).toHaveBeenCalledWith("s12");
  });

  it("is held while the Story has no criterion, saying why", async () => {
    criterionList.mockResolvedValue([]);
    offer({ offered: true, refusal: "FLY-12 has no Acceptance criterion yet; a Story needs one before it is Ready" });
    renderView();
    const button = (await screen.findByRole("button", { name: "Make FLY-12 Ready" })) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByText(/^Make Ready waits: FLY-12 has no Acceptance criterion yet/)).toBeTruthy();
    fireEvent.click(button);
    expect(storyMakeReady).not.toHaveBeenCalled();
  });

  it("is not offered while the Epic is still being shaped", async () => {
    offer({ offered: false, refusal: "FLY-1 is still being shaped; closing its Write the Acceptance criteria Stage makes FLY-12 Ready" });
    renderView();
    await waitFor(() => expect(storyMakeReadyOffer).toHaveBeenCalled());
    await screen.findByText("An empty line yields no token");
    expect(screen.queryByRole("button", { name: "Make FLY-12 Ready" })).toBeNull();
  });

  it("is not asked for once the Story is past Shaping: a Ready Story offers Start", async () => {
    storyGet.mockResolvedValue(story("ready"));
    renderView();
    await screen.findByRole("button", { name: "Start FLY-12" });
    expect(screen.queryByRole("button", { name: "Make FLY-12 Ready" })).toBeNull();
    expect(storyMakeReadyOffer).not.toHaveBeenCalled();
  });

  it("shows the core's refusal when Make Ready fails", async () => {
    offer({ offered: true, refusal: null });
    storyMakeReady.mockRejectedValue(new Error("FLY-1 is still being shaped"));
    renderView();
    fireEvent.click(await screen.findByRole("button", { name: "Make FLY-12 Ready" }));
    expect(await screen.findByText("FLY-1 is still being shaped")).toBeTruthy();
  });
});

describe("Make Ready on the board row", () => {
  const milestone: MilestoneDto = { id: "m1", projectId: "p1", title: "M1", exitTest: null, state: "in_progress", current: true, rank: "a" };
  const epic: EpicDto = {
    id: "e1", projectId: "p1", milestoneId: "m1", key: "FLY-1", title: "E1", problem: null, scope: null, outOfScope: null,
    exitTest: null, state: "ready", rank: "a",
  };
  function row(storyId: string, canMakeReady: boolean): RosterRowDto {
    return {
      storyId, attention: null, endingReason: null, liveSessionId: null, doingTaskTitle: null,
      criteriaMet: 0, criteriaTotal: canMakeReady ? 1 : 0, tasksDone: 0, tasksTotal: 0, review: null, canMakeReady,
    };
  }

  it("is the row's one next action where the core says it can be made Ready", async () => {
    milestoneList.mockResolvedValue([milestone]);
    epicList.mockResolvedValue([epic]);
    const bare = { ...story("shaping", "FLY-13"), id: "s13", title: "No criterion yet" };
    storyListForProject.mockResolvedValue([story("shaping"), bare]);
    rosterRows.mockResolvedValue([row("s12", true), row("s13", false)]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <StoryBoard projectId="p1" projectName="Threadfin" />
      </QueryClientProvider>,
    );
    const list = await screen.findByRole("list", { name: "E1 Stories" });
    const button = await within(list).findByRole("button", { name: "Make FLY-12 Ready" });
    expect(within(list).queryByRole("button", { name: "Make FLY-13 Ready" })).toBeNull();
    expect(within(list).getByText("criteria 0/0 · tasks 0/0")).toBeTruthy();
    fireEvent.click(button);
    await waitFor(() => expect(storyMakeReady).toHaveBeenCalledWith("s12"));
  });
});
