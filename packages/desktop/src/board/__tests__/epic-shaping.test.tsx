/**
 * Behaviour under test (issue #122): the Epic card on the board offers Shape only while the Epic is in
 * Shaping, and Open session in its place while the Epic's shaping session is live. Shape reaches the
 * core's `epic_shape` and keeps you on the board; Open session opens the session's feed. An Epic in
 * Shaping with no Story yet still has its card, so Shape is reachable from a one-line idea.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, MilestoneDto, MilestoneProgressDto, StoryDto } from "../../adapters/tauri";

const milestoneList = vi.fn();
const epicList = vi.fn();
const storyListForProject = vi.fn();
const milestoneProgress = vi.fn();
const epicShape = vi.fn();
const epicShapingSession = vi.fn();
const epicShapingRounds = vi.fn();
const shapingContinue = vi.fn();
let boardChanged: ((payload: { projectId: string }) => void) | null = null;

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    // The board mounts the Needs-you column (#156), which reads its list and rides the fleet's subscription.
    needsYouList: () => Promise.resolve([]),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    milestoneProgress: (...args: unknown[]) => milestoneProgress(...args),
    epicShape: (...args: unknown[]) => epicShape(...args),
    epicShapingSession: (...args: unknown[]) => epicShapingSession(...args),
    epicShapingRounds: (...args: unknown[]) => epicShapingRounds(...args),
    shapingContinue: (...args: unknown[]) => shapingContinue(...args),
    taskList: () => Promise.resolve([]),
    storyContextPacketSize: () => Promise.resolve({ bytes: 400, approxTokens: 100, overSoftLimit: false }),
    blockedSummary: () => Promise.resolve({ blockedStoryIds: [], waitingEpicIds: [], blockedCount: 0 }),
    subscribeBoardChanged: (handler: (payload: { projectId: string }) => void) => {
      boardChanged = handler;
      return Promise.resolve(() => {});
    },
  };
});

const M1: MilestoneDto = { id: "m1", projectId: "p1", title: "Shaping", exitTest: null, state: "shaping", current: true, rank: "a" };

function epic(id: string, key: string, title: string, state: string): EpicDto {
  return { id, projectId: "p1", milestoneId: "m1", key, title, problem: null, scope: null, outOfScope: null, exitTest: null, state, rank: id };
}

function story(id: string, epicId: string, state = "shaping"): StoryDto {
  return { id, projectId: "p1", epicId, key: `FLY-${id}`, title: `Story ${id}`, description: null, state, runsAfterStoryId: null, rank: "a" };
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" />
    </QueryClientProvider>,
  );
}

/** The Epic card whose heading is `title`. */
async function card(title: string) {
  return (await screen.findByRole("heading", { name: title })).closest("section") as HTMLElement;
}

beforeEach(() => {
  boardChanged = null;
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  milestoneList.mockReset().mockResolvedValue([M1]);
  epicList.mockReset().mockResolvedValue([epic("e1", "FLY-1", "Epic shaping", "shaping"), epic("e2", "FLY-2", "Board model", "ready")]);
  storyListForProject.mockReset().mockResolvedValue([story("10", "e1"), story("11", "e2", "ready")]);
  milestoneProgress.mockReset().mockResolvedValue(null);
  epicShape.mockReset().mockResolvedValue({ id: "run-s", epicId: "e1", status: "running", permissionMode: "dontAsk" });
  epicShapingSession.mockReset().mockResolvedValue(null);
  epicShapingRounds.mockReset().mockResolvedValue({ epic: epic("e1", "FLY-1", "Epic shaping", "shaping"), stages: [], rounds: [] });
  shapingContinue.mockReset().mockResolvedValue({ id: "run-2", epicId: "e1", status: "running", permissionMode: "dontAsk" });
});

describe("the Epic card's shaping control (issue #122)", () => {
  it("offers Shape on an Epic in Shaping, and not on one out of Shaping", async () => {
    renderBoard();
    const shaping = await card("Epic shaping");
    expect(await within(shaping).findByRole("button", { name: "Shape FLY-1 Epic shaping" })).toBeEnabled();

    const ready = await card("Board model");
    expect(within(ready).queryByRole("button", { name: /^Shape/ })).toBeNull();
    expect(within(ready).queryByRole("button", { name: /shaping session/ })).toBeNull();
    expect(epicShapingSession).not.toHaveBeenCalledWith("e2");
  });

  it("Shape starts the shaping session through the core and keeps you on the board", async () => {
    renderBoard();
    fireEvent.click(await within(await card("Epic shaping")).findByRole("button", { name: /^Shape FLY-1/ }));
    await waitFor(() => expect(epicShape).toHaveBeenCalledWith("e1"));
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("shows Open session in place of Shape while the shaping session is live, and it opens the feed", async () => {
    epicShapingSession.mockImplementation((id: string) => Promise.resolve(id === "e1" ? "run-s" : null));
    renderBoard();
    const shaping = await card("Epic shaping");
    const open = await within(shaping).findByRole("button", { name: "Open shaping session of FLY-1" });
    expect(within(shaping).queryByRole("button", { name: /^Shape/ })).toBeNull();

    fireEvent.click(open);
    expect(useUiStore.getState().activeSessionId).toBe("run-s");
    expect(useUiStore.getState().activeSessionStoryId).toBeNull();
  });

  it("turns Shape into Open session when the core says the board changed", async () => {
    renderBoard();
    const shaping = await card("Epic shaping");
    await within(shaping).findByRole("button", { name: /^Shape FLY-1/ });
    epicShapingSession.mockResolvedValue("run-s");
    boardChanged?.({ projectId: "p1" });
    expect(await within(shaping).findByRole("button", { name: "Open shaping session of FLY-1" })).toBeInTheDocument();
  });

  it("names the core's refusal beside the control", async () => {
    epicShape.mockRejectedValue(new Error("Epic FLY-1 is ready; only a record in Shaping is shaped"));
    renderBoard();
    const shaping = await card("Epic shaping");
    fireEvent.click(await within(shaping).findByRole("button", { name: /^Shape FLY-1/ }));
    expect(await within(shaping).findByRole("alert")).toHaveTextContent("only a record in Shaping is shaped");
    expect(within(shaping).getByRole("button", { name: /^Shape FLY-1/ })).toBeEnabled();
  });

  it("shows an Epic in Shaping with no Story yet, so a one-line idea can be shaped", async () => {
    storyListForProject.mockResolvedValue([]);
    epicList.mockResolvedValue([epic("e1", "FLY-1", "Epic shaping", "shaping"), epic("e2", "FLY-2", "Board model", "ready")]);
    renderBoard();
    const shaping = await card("Epic shaping");
    expect(within(shaping).getByText("No Stories yet")).toBeInTheDocument();
    expect(await within(shaping).findByRole("button", { name: /^Shape FLY-1/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Board model" })).toBeNull();
  });

  it("offers Shape on an Epic of a Milestone picked on the Roadmap strip, not only the Current one", async () => {
    const later: MilestoneDto = { id: "m2", projectId: "p1", title: "Board and review", exitTest: null, state: "shaping", current: false, rank: "b" };
    milestoneList.mockResolvedValue([M1, later]);
    epicList.mockImplementation((milestoneId: string) =>
      Promise.resolve(milestoneId === "m2" ? [{ ...epic("e3", "FLY-3", "Roster", "shaping"), milestoneId: "m2" }] : [epic("e1", "FLY-1", "Epic shaping", "shaping")]),
    );
    storyListForProject.mockResolvedValue([story("10", "e1")]);
    useUiStore.getState().selectMilestone("p1", "m2");
    renderBoard();

    fireEvent.click(await within(await card("Roster")).findByRole("button", { name: /^Shape FLY-3/ }));
    await waitFor(() => expect(epicShape).toHaveBeenCalledWith("e3"));
    expect(screen.queryByRole("heading", { name: "Epic shaping" })).toBeNull();
  });

  it("carries the control on a card headed by the Current Milestone's progress bar", async () => {
    const progress: MilestoneProgressDto = {
      milestoneId: "m1",
      title: "Shaping",
      exitTest: null,
      state: "shaping",
      current: true,
      nextMilestoneTitle: null,
      counts: { shaping: 1, ready: 0, running: 0, inReview: 0, merged: 0, dropped: 0, waitingOnYou: 0, stopped: 0, storiesTotal: 1 },
      epicsDone: 0,
      epicsTotal: 1,
      epics: [
        {
          epicId: "e1",
          key: "FLY-1",
          title: "Epic shaping",
          state: "shaping",
          attention: null,
          counts: { shaping: 1, ready: 0, running: 0, inReview: 0, merged: 0, dropped: 0, waitingOnYou: 0, stopped: 0, storiesTotal: 1 },
        },
      ],
    };
    milestoneProgress.mockResolvedValue(progress);
    renderBoard();
    await waitFor(async () => {
      const shaping = await card("Epic shaping");
      expect(shaping.querySelector("[data-epic-id='e1']")).not.toBeNull();
    });
    expect(await within(await card("Epic shaping")).findByRole("button", { name: /^Shape FLY-1/ })).toBeInTheDocument();
  });
});

describe("the Epic card and its Rounds (issue #123)", () => {
  const heldRound = {
    id: "r1",
    stageId: "s1",
    stageKind: "challenge_spec",
    number: 1,
    note: "n",
    state: "open",
    waitingOnYou: true,
    postedAt: "2026-10-22T09:00:00Z",
    answeredAt: null,
    questions: [],
  };

  it("offers Answer in place of Open session while the shaping session waits on a Round, and it opens the Epic", async () => {
    epicShapingSession.mockImplementation((id: string) => Promise.resolve(id === "e1" ? "run-s" : null));
    epicShapingRounds.mockResolvedValue({ epic: epic("e1", "FLY-1", "Epic shaping", "shaping"), stages: [], rounds: [heldRound] });
    renderBoard();
    const shaping = await card("Epic shaping");
    const answer = await within(shaping).findByRole("button", { name: "Answer the Round on FLY-1" });
    expect(within(shaping).queryByRole("button", { name: /shaping session/ })).toBeNull();
    fireEvent.click(answer);
    expect(useUiStore.getState().currentEpicId).toBe("e1");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("an answered Round is not Waiting on you: the card offers Open session again", async () => {
    epicShapingSession.mockImplementation((id: string) => Promise.resolve(id === "e1" ? "run-s" : null));
    epicShapingRounds.mockResolvedValue({
      epic: epic("e1", "FLY-1", "Epic shaping", "shaping"),
      stages: [],
      rounds: [{ ...heldRound, state: "answered", waitingOnYou: false, answeredAt: "2026-10-22T10:00:00Z" }],
    });
    renderBoard();
    expect(await within(await card("Epic shaping")).findByRole("button", { name: "Open shaping session of FLY-1" })).toBeInTheDocument();
  });

  it("the Epic's chevron opens its shaping view at any time, and never its session", async () => {
    renderBoard();
    fireEvent.click(await within(await card("Epic shaping")).findByRole("button", { name: "Open FLY-1 Epic shaping and its Rounds" }));
    expect(useUiStore.getState().currentEpicId).toBe("e1");
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(within(await card("Board model")).queryByRole("button", { name: /and its Rounds/ })).toBeNull();
  });
});

describe("a shaping session killed mid-Round (issue #124)", () => {
  const openRound = {
    id: "r1",
    stageId: "s1",
    stageKind: "challenge_spec",
    number: 1,
    note: "n",
    state: "open",
    waitingOnYou: false,
    postedAt: "2026-10-22T09:00:00Z",
    answeredAt: null,
    questions: [],
  };
  const COUNTS = { shaping: 1, ready: 0, running: 0, inReview: 0, merged: 0, dropped: 0, waitingOnYou: 0, stopped: 0, storiesTotal: 1 };
  function progressWith(attention: string | null): MilestoneProgressDto {
    return {
      milestoneId: "m1",
      title: "Shaping",
      exitTest: null,
      state: "shaping",
      current: true,
      nextMilestoneTitle: null,
      counts: COUNTS,
      epicsDone: 0,
      epicsTotal: 1,
      epics: [{ epicId: "e1", key: "FLY-1", title: "Epic shaping", state: "shaping", attention, counts: COUNTS }],
    };
  }

  it("offers Continue shaping in place of Shape when a Round outlived its session, and keeps you on the board", async () => {
    epicShapingRounds.mockResolvedValue({ epic: epic("e1", "FLY-1", "Epic shaping", "shaping"), stages: [], rounds: [openRound] });
    renderBoard();
    const shaping = await card("Epic shaping");
    const resume = await within(shaping).findByRole("button", { name: "Continue shaping FLY-1 Epic shaping" });
    expect(within(shaping).queryByRole("button", { name: /^Shape FLY-1/ })).toBeNull();
    expect(within(shaping).queryByRole("button", { name: /Answer the Round/ })).toBeNull();

    fireEvent.click(resume);
    await waitFor(() => expect(shapingContinue).toHaveBeenCalledWith("e1"));
    expect(epicShape).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().currentEpicId).toBeNull();
  });

  it("an open Round with no live session reads Shaping Round waiting, never Waiting on you", async () => {
    milestoneProgress.mockResolvedValue(progressWith("round_waiting"));
    epicShapingRounds.mockResolvedValue({ epic: epic("e1", "FLY-1", "Epic shaping", "shaping"), stages: [], rounds: [openRound] });
    renderBoard();
    const shaping = await card("Epic shaping");
    const pill = await within(shaping).findByText("Shaping Round waiting");
    expect(pill.closest("[data-tone]")).toHaveAttribute("data-tone", "neutral");
    expect(within(shaping).queryByText("Waiting on you")).toBeNull();
  });

  it("a live session held on a Round reads Waiting on you in place of Shaping, with Answer", async () => {
    milestoneProgress.mockResolvedValue(progressWith("waiting_on_you"));
    epicShapingSession.mockResolvedValue("run-s");
    epicShapingRounds.mockResolvedValue({
      epic: epic("e1", "FLY-1", "Epic shaping", "shaping"),
      stages: [],
      rounds: [{ ...openRound, waitingOnYou: true }],
    });
    renderBoard();
    const shaping = await card("Epic shaping");
    const pill = await within(shaping).findByText("Waiting on you");
    expect(pill.closest("[data-tone]")).toHaveAttribute("data-tone", "attention");
    expect(await within(shaping).findByRole("button", { name: "Answer the Round on FLY-1" })).toBeInTheDocument();
  });

  it("a fresh session that has not picked the Round up yet offers Open session, not Answer", async () => {
    epicShapingSession.mockResolvedValue("run-2");
    epicShapingRounds.mockResolvedValue({ epic: epic("e1", "FLY-1", "Epic shaping", "shaping"), stages: [], rounds: [openRound] });
    renderBoard();
    const shaping = await card("Epic shaping");
    expect(await within(shaping).findByRole("button", { name: "Open shaping session of FLY-1" })).toBeInTheDocument();
    expect(within(shaping).queryByRole("button", { name: /Continue shaping/ })).toBeNull();
  });
});
