/**
 * Behaviour under test (issue #50): the bare board lists the project's Stories with their state, keeps
 * that state live on `board:changed`, and Start reaches the core's `story_start` for a Ready Story. Writing a
 * Story by hand is `write-story.test.tsx` (issue #201).
 *
 * Issue #159: each row draws what the roster's one core read (`roster_rows`) says of it: its attention, the
 * *doing* Task or the open review's diff size, then its action or "criteria x/y · tasks x/y"; a row that needs
 * the developer is tinted and says why in a word; an Epic in Shaping carries its shaping marker.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTriageDrawer } from "../../proposals/triageStore";
import { StoryBoard } from "../StoryBoard";
import { PacketSize } from "../StoryControls";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, EpicProgressDto, MilestoneDto, RosterRowDto, StoryDto } from "../../adapters/tauri";

const milestoneList = vi.fn();
const milestoneCreate = vi.fn();
const milestoneProgress = vi.fn();
const proposalListForTriage = vi.fn();
const epicList = vi.fn();
const epicCreate = vi.fn();
const storyListForProject = vi.fn();
const storyWriteByHand = vi.fn();
const storyStart = vi.fn();
const storyContextPacketSize = vi.fn();
const rosterRows = vi.fn();
// The per-row reads the roster used to issue; it issues none of them now (#159).
const taskList = vi.fn();
const storyStopped = vi.fn();
const sessionsForStory = vi.fn();
let boardChanged: ((payload: { projectId: string }) => void) | null = null;

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    // The board mounts the Needs-you column (#156), which reads its list and rides the fleet's subscription.
    needsYouList: () => Promise.resolve([]),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    milestoneList: (...args: unknown[]) => milestoneList(...args),
    milestoneCreate: (...args: unknown[]) => milestoneCreate(...args),
    epicList: (...args: unknown[]) => epicList(...args),
    epicCreate: (...args: unknown[]) => epicCreate(...args),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    storyWriteByHand: (...args: unknown[]) => storyWriteByHand(...args),
    storyStart: (...args: unknown[]) => storyStart(...args),
    milestoneProgress: (...args: unknown[]) => milestoneProgress(...args),
    proposalListForTriage: (...args: unknown[]) => proposalListForTriage(...args),
    rosterRows: (...args: unknown[]) => rosterRows(...args),
    taskList: (...args: unknown[]) => taskList(...args),
    storyStopped: (...args: unknown[]) => storyStopped(...args),
    sessionsForStory: (...args: unknown[]) => sessionsForStory(...args),
    storyContextPacketSize: (...args: unknown[]) => storyContextPacketSize(...args),
    subscribeBoardChanged: (handler: (payload: { projectId: string }) => void) => {
      boardChanged = handler;
      return Promise.resolve(() => {});
    },
  };
});

function milestone(id: string, title: string): MilestoneDto {
  return { id, projectId: "p1", title, exitTest: null, state: "shaping", current: true, rank: "a" };
}

function epic(id: string, title: string, milestoneId = "m1", state = "shaping"): EpicDto {
  return {
    id,
    projectId: "p1",
    milestoneId,
    key: "FLY-1",
    title,
    problem: null,
    scope: null,
    outOfScope: null,
    exitTest: null,
    state,
    rank: "a",
  };
}

function story(id: string, key: string, title: string, state: string, epicId = "e1"): StoryDto {
  return { id, projectId: "p1", epicId, key, title, description: null, state, runsAfterStoryId: null, rank: "a" };
}

/** A row's figures as the core reads them, quiet unless overridden. */
function row(storyId: string, figures: Partial<RosterRowDto> = {}): RosterRowDto {
  return {
    storyId,
    attention: null,
    endingReason: null,
    liveSessionId: null,
    doingTaskTitle: null,
    criteriaMet: 0,
    criteriaTotal: 0,
    tasksDone: 0,
    tasksTotal: 0,
    review: null,
    canMakeReady: false,
    ...figures,
  };
}

/** The board with Milestone m1 Current, its Epic e1, these Stories in it, and the core's rows for them. */
function seedRoster(stories: StoryDto[], rows: RosterRowDto[]) {
  milestoneList.mockResolvedValue([milestone("m1", "M1")]);
  epicList.mockResolvedValue([epic("e1", "E1")]);
  storyListForProject.mockResolvedValue(stories);
  rosterRows.mockResolvedValue(rows);
}

/** The Story rows of Epic E1's card, once the core's rows have landed on them. */
async function rosterRowsOnScreen(count: number) {
  const list = await screen.findByRole("list", { name: "E1 Stories" });
  await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(count));
  await waitFor(() => expect(rosterRows).toHaveBeenCalled());
  return within(list).getAllByRole("listitem");
}

function renderBoard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  boardChanged = null;
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  milestoneList.mockReset().mockResolvedValue([]);
  milestoneCreate.mockReset().mockResolvedValue(milestone("m1", "M1"));
  epicList.mockReset().mockResolvedValue([]);
  epicCreate.mockReset().mockResolvedValue(epic("e1", "E1"));
  storyListForProject.mockReset().mockResolvedValue([]);
  storyWriteByHand.mockReset().mockResolvedValue(story("s1", "FLY-2", "S", "ready"));
  storyStart.mockReset().mockResolvedValue({ id: "run-1", storyId: "s1", status: "running", permissionMode: "acceptEdits" });
  storyContextPacketSize.mockReset().mockResolvedValue({ bytes: 4000, approxTokens: 1000, overSoftLimit: false });
  milestoneProgress.mockReset().mockResolvedValue(null);
  proposalListForTriage.mockReset().mockResolvedValue([]);
  rosterRows.mockReset().mockResolvedValue([]);
  taskList.mockReset().mockResolvedValue([]);
  storyStopped.mockReset().mockResolvedValue(null);
  sessionsForStory.mockReset().mockResolvedValue([]);
});

describe("PacketSize: the Context packet size (issue #51), shown in the Story view", () => {
  function renderSize(state: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <PacketSize story={story("s1", "FLY-2", "Sized", state)} />
      </QueryClientProvider>,
    );
  }

  it("shows the packet size without a warning under the soft limit", async () => {
    storyContextPacketSize.mockResolvedValue({ bytes: 4800, approxTokens: 1200, overSoftLimit: false });
    renderSize("ready");

    expect(await screen.findByText("Context packet ~1.2K tokens")).toBeInTheDocument();
    expect(screen.queryByText(/soft limit/)).toBeNull();
    expect(storyContextPacketSize).toHaveBeenCalledWith("s1");
  });

  it("warns above about 20K tokens", async () => {
    storyContextPacketSize.mockResolvedValue({ bytes: 100_000, approxTokens: 25_000, overSoftLimit: true });
    renderSize("running");

    expect(await screen.findByText("Context packet ~25.0K tokens, above the ~20K soft limit")).toBeInTheDocument();
  });
});

describe("StoryBoard: the Story list", () => {
  it("lists the project's Stories with their state, and offers Start only on a Ready one", async () => {
    storyListForProject.mockResolvedValue([
      story("s1", "FLY-2", "Ready one", "ready"),
      story("s2", "FLY-3", "Under review", "in_review"),
    ]);
    renderBoard();

    const list = await screen.findByRole("list", { name: "Stories" });
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(2));
    const [ready, review] = within(list).getAllByRole("listitem");
    expect(within(ready).getByText("FLY-2")).toBeInTheDocument();
    expect(within(ready).getByText("Ready")).toBeInTheDocument();
    expect(within(ready).getByRole("button", { name: "Start FLY-2" })).toBeInTheDocument();
    expect(within(review).getByText("In review")).toBeInTheDocument();
    expect(within(review).queryByRole("button", { name: /Start/ })).toBeNull();
    expect(storyListForProject).toHaveBeenCalledWith("p1");
  });

  it("changes a Story's state live when the core says the board changed", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "ready")]);
    renderBoard();
    const list = await screen.findByRole("list", { name: "Stories" });
    await within(list).findByText("Ready");

    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "running")]);
    await waitFor(() => expect(boardChanged).not.toBeNull());
    act(() => boardChanged?.({ projectId: "p1" }));

    await within(list).findByText("Running");
    expect(within(list).queryByText("Ready")).toBeNull();
  });

  it("shows Waiting on you, in yellow, in place of the state word of a Story whose session waits on you (#57)", async () => {
    seedRoster(
      [story("s1", "FLY-2", "Waiting one", "running"), story("s2", "FLY-3", "Busy one", "running")],
      [row("s1", { attention: "waiting_on_you", liveSessionId: "ses-1" }), row("s2", { liveSessionId: "ses-2" })],
    );
    renderBoard();

    const [waiting, busy] = await rosterRowsOnScreen(2);
    const flag = await within(waiting).findByText("Waiting on you");
    expect(flag.closest("[data-tone]")).toHaveAttribute("data-tone", "attention");
    expect(within(waiting).queryByText("Running")).toBeNull();
    expect(within(busy).getByText("Running")).toBeInTheDocument();
    expect(rosterRows).toHaveBeenCalledWith("m1");
  });

  it("drops Waiting on you live once the request is answered", async () => {
    seedRoster(
      [story("s1", "FLY-2", "Waiting one", "running")],
      [row("s1", { attention: "waiting_on_you", liveSessionId: "ses-1" })],
    );
    renderBoard();
    const [waiting] = await rosterRowsOnScreen(1);
    await within(waiting).findByText("Waiting on you");

    rosterRows.mockResolvedValue([row("s1", { liveSessionId: "ses-1" })]);
    await waitFor(() => expect(boardChanged).not.toBeNull());
    act(() => boardChanged?.({ projectId: "p1" }));

    await within(waiting).findByText("Running");
    expect(within(waiting).queryByText("Waiting on you")).toBeNull();
  });
  it("Start calls the core's story_start and stays on the board: it never opens the session (issue #104)", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "ready")]);
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Start FLY-2" }));

    await waitFor(() => expect(storyStart).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Start FLY-2" })).not.toBeDisabled());
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().currentStoryId).toBeNull();
  });

  it("shows the core's refusal when Start fails", async () => {
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Ready one", "ready")]);
    storyStart.mockRejectedValue(new Error("Start needs a Ready Story; this one is running"));
    renderBoard();
    fireEvent.click(await screen.findByRole("button", { name: "Start FLY-2" }));

    expect(await screen.findByText("Start needs a Ready Story; this one is running")).toBeInTheDocument();
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });
});

describe("StoryBoard: rows from the roster's one core read (issue #159)", () => {
  it("shows an In review row's diff size and Open review, saying In review, untinted (#202)", async () => {
    seedRoster(
      [story("s1", "FLY-2", "Under review", "in_review")],
      [row("s1", { criteriaMet: 2, criteriaTotal: 5, tasksDone: 1, tasksTotal: 1, review: { files: 3, added: 40, removed: 7 } })],
    );
    renderBoard();

    const [review] = await rosterRowsOnScreen(1);
    expect(await within(review).findByText("+40 −7 · 3 files")).toBeInTheDocument();
    expect(within(review).getByRole("button", { name: "Open review of FLY-2" })).toBeInTheDocument();
    expect(within(review).getByText("In review")).toBeInTheDocument();
    expect(review).not.toHaveAttribute("data-needs-you");
    expect(review.className).not.toMatch(/bg-attention-muted/);
    // The row offers its action, not the counts.
    expect(within(review).queryByText(/criteria/)).toBeNull();
  });

  it("answers a row Waiting on you from the session the core named, tinted and saying Waiting on you", async () => {
    seedRoster(
      [story("s1", "FLY-2", "Waiting one", "running")],
      [row("s1", { attention: "waiting_on_you", liveSessionId: "ses-1", doingTaskTitle: "Wire the command" })],
    );
    renderBoard();

    const [waiting] = await rosterRowsOnScreen(1);
    expect(await within(waiting).findByText("Doing: Wire the command")).toBeInTheDocument();
    expect(waiting).toHaveAttribute("data-needs-you", "waiting");
    expect(waiting.className).toMatch(/bg-attention-muted/);
    fireEvent.click(within(waiting).getByRole("button", { name: "Answer FLY-2" }));

    expect(useUiStore.getState().activeSessionId).toBe("ses-1");
  });

  it("offers Resume on a Stopped row, says why it stopped and what it was doing, untinted (#202)", async () => {
    seedRoster(
      [story("s1", "FLY-2", "Stopped one", "running")],
      [row("s1", { attention: "stopped", endingReason: "crash", doingTaskTitle: "Half done" })],
    );
    renderBoard();

    const [stopped] = await rosterRowsOnScreen(1);
    expect(await within(stopped).findByText("Stopped: crash")).toBeInTheDocument();
    expect(within(stopped).getByText("· was doing “Half done”")).toBeInTheDocument();
    expect(within(stopped).getByRole("button", { name: "Resume FLY-2" })).toBeInTheDocument();
    expect(within(stopped).getByText("Stopped")).toBeInTheDocument();
    expect(stopped).not.toHaveAttribute("data-needs-you");
    expect(stopped.className).not.toMatch(/bg-attention-muted/);
  });

  it("opens a Running row's live session from the session the core named, untinted", async () => {
    seedRoster(
      [story("s1", "FLY-2", "Busy one", "running")],
      [row("s1", { liveSessionId: "ses-1", doingTaskTitle: "Draw the row" })],
    );
    renderBoard();

    const [busy] = await rosterRowsOnScreen(1);
    expect(await within(busy).findByText("Doing: Draw the row")).toBeInTheDocument();
    expect(busy).not.toHaveAttribute("data-needs-you");
    fireEvent.click(within(busy).getByRole("button", { name: "Open live session of FLY-2" }));

    expect(useUiStore.getState().activeSessionId).toBe("ses-1");
  });

  it("shows criteria x/y · tasks x/y on a row with no action, leaving out a count with nothing in it (#202)", async () => {
    seedRoster(
      [story("s1", "FLY-2", "Being shaped", "shaping"), story("s2", "FLY-3", "Half way", "shaping")],
      [
        row("s1", { criteriaMet: 0, criteriaTotal: 2 }),
        row("s2", { criteriaMet: 1, criteriaTotal: 3, tasksDone: 2, tasksTotal: 4 }),
      ],
    );
    renderBoard();

    const [criteriaOnly, both] = await rosterRowsOnScreen(2);
    expect(await within(criteriaOnly).findByText("criteria 0/2")).toBeInTheDocument();
    expect(within(both).getByText("criteria 1/3 · tasks 2/4")).toBeInTheDocument();
    expect(criteriaOnly).not.toHaveAttribute("data-needs-you");
  });

  it("shows no counts where they say nothing: a Merged or Dropped row, or one with no criterion and no Task (#202)", async () => {
    seedRoster(
      [
        story("s1", "FLY-2", "Done one", "merged"),
        story("s2", "FLY-3", "Gone one", "dropped"),
        story("s3", "FLY-4", "Bare one", "shaping"),
      ],
      [
        row("s1", { criteriaMet: 4, criteriaTotal: 4, tasksDone: 3, tasksTotal: 3 }),
        row("s2", { criteriaMet: 0, criteriaTotal: 2 }),
        row("s3"),
      ],
    );
    renderBoard();

    const rows = await rosterRowsOnScreen(3);
    await waitFor(() => expect(rows[1]).toHaveTextContent("Dropped: kept readable, no worktree"));
    for (const each of rows) expect(within(each).queryByText(/criteria|tasks/)).toBeNull();
    expect(within(rows[0]).queryByRole("button", { name: /FLY-2$/ })).toBeNull();
  });

  it("issues no read per row: one roster read for the Milestone", async () => {
    seedRoster(
      [
        story("s1", "FLY-2", "Waiting", "running"),
        story("s2", "FLY-3", "Stopped", "running"),
        story("s3", "FLY-4", "Ready", "ready"),
        story("s4", "FLY-5", "Review", "in_review"),
      ],
      [
        row("s1", { attention: "waiting_on_you", liveSessionId: "ses-1" }),
        row("s2", { attention: "stopped", endingReason: "crash" }),
        row("s3"),
        row("s4", { review: { files: 1, added: 1, removed: 0 } }),
      ],
    );
    renderBoard();

    await rosterRowsOnScreen(4);
    await screen.findByRole("button", { name: "Answer FLY-2" });
    expect(rosterRows).toHaveBeenCalledTimes(1);
    expect(taskList).not.toHaveBeenCalled();
    expect(storyStopped).not.toHaveBeenCalled();
    expect(sessionsForStory).not.toHaveBeenCalled();
    expect(storyContextPacketSize).not.toHaveBeenCalled();
  });

  it("marks an Epic in Shaping with where its shaping has got to", async () => {
    seedRoster([story("s1", "FLY-2", "One", "shaping")], [row("s1")]);
    const counts = {
      shaping: 1, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, storiesTotal: 1,
    };
    const progress: EpicProgressDto = {
      epicId: "e1",
      key: "FLY-1",
      title: "E1",
      state: "shaping",
      counts,
      attention: null,
      shaping: { stageKind: "slice", stageRank: 2, roundNumber: 3, roundOpen: true, answered: 2, questions: 5 },
    };
    milestoneProgress.mockResolvedValue({
      milestoneId: "m1",
      title: "M1",
      exitTest: null,
      state: "shaping",
      current: true,
      nextMilestoneTitle: null,
      counts,
      epicsDone: 0,
      epicsTotal: 1,
      epics: [progress],
    });
    renderBoard();

    const card = (await screen.findByRole("list", { name: "E1 Stories" })).closest("section")!;
    expect(
      await within(card).findByText("Stage 2 of 3, Slice into Stories · Round 3 · 2 of 5 answered"),
    ).toBeInTheDocument();
  });
});

describe("StoryBoard: an Epic row's Proposals (issue #162)", () => {
  const counts = {
    shaping: 0, ready: 0, running: 1, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, storiesTotal: 1,
  };
  // The drawer's open state lives in its own store, which outlives a render.
  beforeEach(() => useTriageDrawer.getState().closeTriage());

  function seedProgress(proposals: number) {
    seedRoster([story("s1", "FLY-2", "Running one", "running")], [row("s1")]);
    const progress: EpicProgressDto = { epicId: "e1", key: "FLY-1", title: "E1", state: "in_progress", counts, attention: null, proposals };
    milestoneProgress.mockResolvedValue({
      milestoneId: "m1", title: "M1", exitTest: null, state: "in_progress", current: true, nextMilestoneTitle: null,
      counts, epicsDone: 0, epicsTotal: 1, epics: [progress],
    });
  }

  it("shows n Proposals on the Epic row while it has pending ones, and it opens the triage drawer", async () => {
    seedProgress(2);
    renderBoard();
    const marker = await screen.findByRole("button", { name: "Triage 2 Proposals on E1" });
    expect(marker).toHaveTextContent("2 Proposals");
    fireEvent.click(marker);
    expect(await screen.findByRole("dialog", { name: /Triage Proposals/ })).toBeInTheDocument();
    await waitFor(() => expect(proposalListForTriage).toHaveBeenCalledWith("p1"));
  });

  it("carries no marker once none is pending", async () => {
    seedProgress(0);
    renderBoard();
    await screen.findByRole("list", { name: "E1 Stories" });
    await waitFor(() => expect(document.querySelector("[data-epic-id=e1]")).not.toBeNull());
    expect(screen.queryByRole("button", { name: /Proposals? on E1/ })).toBeNull();
  });
});

describe("StoryBoard: the roster reads at a glance (issue #202)", () => {
  it("tints only a row Waiting on you; Stopped and In review rows stay plain", async () => {
    seedRoster(
      [
        story("s1", "FLY-2", "Waiting", "running"),
        story("s2", "FLY-3", "Stopped", "running"),
        story("s3", "FLY-4", "Review", "in_review"),
        story("s4", "FLY-5", "Busy", "running"),
      ],
      [
        row("s1", { attention: "waiting_on_you", liveSessionId: "ses-1" }),
        row("s2", { attention: "stopped", endingReason: "crash" }),
        row("s3", { review: { files: 1, added: 1, removed: 0 } }),
        row("s4", { liveSessionId: "ses-4" }),
      ],
    );
    renderBoard();

    const rows = await rosterRowsOnScreen(4);
    await screen.findByRole("button", { name: "Answer FLY-2" });
    const tinted = rows.filter((each) => /bg-attention-muted/.test(each.className));
    expect(tinted).toEqual([rows[0]]);
    expect(rows[0]).toHaveAttribute("data-needs-you", "waiting");
  });

  it("lists live Epics first and folds the Done ones into one disclosure at the end, which opens on click", async () => {
    milestoneList.mockResolvedValue([milestone("m1", "M1")]);
    epicList.mockResolvedValue([epic("e1", "Shipped", "m1", "done"), epic("e2", "Live", "m1", "in_progress")]);
    storyListForProject.mockResolvedValue([
      story("s1", "FLY-2", "Old work", "merged", "e1"),
      story("s2", "FLY-3", "New work", "running", "e2"),
    ]);
    rosterRows.mockResolvedValue([row("s1"), row("s2")]);
    renderBoard();

    const live = await screen.findByRole("list", { name: "Live Stories" });
    const fold = await screen.findByRole("button", { name: /1 Epic done/ });
    expect(fold).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("list", { name: "Shipped Stories" })).toBeNull();
    expect(live.compareDocumentPosition(fold) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    fireEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    const shipped = await screen.findByRole("list", { name: "Shipped Stories" });
    expect(await within(shipped).findByText("Old work")).toBeInTheDocument();
  });

  it("shows no fold while no Epic is Done", async () => {
    seedRoster([story("s1", "FLY-2", "One", "ready")], [row("s1")]);
    renderBoard();
    await rosterRowsOnScreen(1);
    expect(screen.queryByRole("button", { name: /Epics? done/ })).toBeNull();
  });

  it("shows Skeleton rows while the roster loads", async () => {
    milestoneList.mockResolvedValue([milestone("m1", "M1")]);
    storyListForProject.mockReturnValue(new Promise(() => {}));
    renderBoard();
    const loading = await screen.findByLabelText("Loading the roster");
    expect(loading.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(3);
  });

  it("shows ReadError with Try again when the Stories cannot be read, and Try again reads them again", async () => {
    milestoneList.mockResolvedValue([milestone("m1", "M1")]);
    storyListForProject.mockRejectedValue(new Error("core went away"));
    renderBoard();

    expect(await screen.findByText("Couldn't load the roster")).toBeInTheDocument();
    const calls = storyListForProject.mock.calls.length;
    storyListForProject.mockResolvedValue([story("s1", "FLY-2", "Back", "ready")]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(storyListForProject.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByText("Back")).toBeInTheDocument();
  });

  it("shows ReadError with Try again over the Stories when the roster's one read fails", async () => {
    seedRoster([story("s1", "FLY-2", "One", "running")], []);
    rosterRows.mockRejectedValue(new Error("roster_rows failed"));
    renderBoard();

    expect(await screen.findByText("Couldn't load the roster")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "E1 Stories" })).toBeInTheDocument();
    const calls = rosterRows.mock.calls.length;
    rosterRows.mockResolvedValue([row("s1", { attention: "waiting_on_you", liveSessionId: "ses-1" })]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(rosterRows.mock.calls.length).toBeGreaterThan(calls));
    expect(await screen.findByRole("button", { name: "Answer FLY-2" })).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load the roster")).toBeNull();
  });

  it("draws every key with StoryKey, one width for the project's longest key", async () => {
    seedRoster(
      [story("s1", "PRESALES-1001", "Long key", "ready"), story("s2", "PRESALES-7", "Short key", "ready")],
      [row("s1"), row("s2")],
    );
    renderBoard();
    const [long, short] = await rosterRowsOnScreen(2);
    const keyOf = (el: HTMLElement) => el.querySelector<HTMLElement>("[data-slot=story-key]")!;
    expect(keyOf(long)).toHaveTextContent("PRESALES-1001");
    expect(keyOf(long).style.minWidth).toBe("13ch");
    expect(keyOf(short).style.minWidth).toBe("13ch");
  });
});
