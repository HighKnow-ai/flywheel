/**
 * Behaviour under test (issue #54): a Running Story whose session died shows Stopped with its
 * ending label in place of the state word, Resume takes an optional one-line note and reaches the
 * core's `story_resume`, and the Story lists its sessions with ID, start and end, ending reason and
 * summary, each opening its feed.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryBoard } from "../StoryBoard";
import { useUiStore } from "../../state/uiStore";
import type { RunSummaryDto, SessionSummaryDto, StoryDto } from "../../adapters/tauri";

const storyListForProject = vi.fn();
const storyStopped = vi.fn();
const storyResume = vi.fn();
const storyDrop = vi.fn();
const sessionsForStory = vi.fn();
const sessionSummariesForStory = vi.fn();
const blockedSummary = vi.fn(() => Promise.resolve({ blockedStoryIds: [] as string[], blockedCount: 0 }));

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    milestoneList: () => Promise.resolve([]),
    storyListForProject: (...args: unknown[]) => storyListForProject(...args),
    storyStopped: (...args: unknown[]) => storyStopped(...args),
    storyResume: (...args: unknown[]) => storyResume(...args),
    storyDrop: (...args: unknown[]) => storyDrop(...args),
    sessionsForStory: (...args: unknown[]) => sessionsForStory(...args),
    sessionSummariesForStory: (...args: unknown[]) => sessionSummariesForStory(...args),
    blockedSummary: () => blockedSummary(),
    taskList: () => Promise.resolve([]),
    storyContextPacketSize: () => Promise.resolve({ bytes: 400, approxTokens: 100, overSoftLimit: false }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

function story(state: string): StoryDto {
  return { id: "s1", projectId: "p1", epicId: "e1", key: "FLY-2", title: "Parser", description: null, state, runsAfterStoryId: null, rank: "a" };
}

function run(id: string, endingReason: RunSummaryDto["endingReason"], endedAt: string | null): RunSummaryDto {
  return {
    id,
    storyId: "s1",
    status: endedAt ? "failed" : "running",
    startedAt: "2026-10-19T09:00:00Z",
    endedAt,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
    externalSessionId: null,
    acknowledgedAt: null,
    abandonedReason: null,
    endingReason,
  };
}

function renderBoard() {
  const onStarted = vi.fn();
  const onOpenSession = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryBoard projectId="p1" projectName="Threadfin" onStarted={onStarted} onOpenSession={onOpenSession} />
    </QueryClientProvider>,
  );
  return { onStarted, onOpenSession };
}

async function storyRow() {
  return within(await screen.findByRole("list", { name: "Stories" })).findByRole("listitem");
}

beforeEach(() => {
  useUiStore.setState({ currentProjectId: "p1" });
  storyListForProject.mockReset().mockResolvedValue([story("running")]);
  blockedSummary.mockReset().mockResolvedValue({ blockedStoryIds: [], blockedCount: 0 });
  storyStopped.mockReset().mockResolvedValue({ sessionId: "01JSESSIONDEAD", endingReason: "crash", endedAt: "2026-10-19T10:00:00Z" });
  storyResume.mockReset().mockResolvedValue({ id: "01JSESSIONNEXT", storyId: "s1", status: "running", permissionMode: "acceptEdits" });
  storyDrop.mockReset().mockResolvedValue(undefined);
  sessionsForStory.mockReset().mockResolvedValue([]);
  sessionSummariesForStory.mockReset().mockResolvedValue([]);
});

describe("StoryBoard: a Stopped Story (issue #54)", () => {
  it("shows Stopped with its ending label in place of the state word", async () => {
    renderBoard();
    const row = await storyRow();
    expect(await within(row).findByText("Stopped: crash")).toBeInTheDocument();
    expect(within(row).queryByText("Running")).toBeNull();
    expect(storyStopped).toHaveBeenCalledWith("s1");
  });

  it("never shows Waiting on you on a Stopped Story, even if a stale read still lists it (#57)", async () => {
    blockedSummary.mockResolvedValue({ blockedStoryIds: ["s1"], blockedCount: 1 });
    renderBoard();
    const row = await storyRow();
    expect(await within(row).findByText("Stopped: crash")).toBeInTheDocument();
    await waitFor(() => expect(blockedSummary).toHaveBeenCalled());
    expect(within(row).queryByText("Waiting on you")).toBeNull();
  });

  it("reads a clean exit without a hand-off as such", async () => {
    storyStopped.mockResolvedValue({ sessionId: "x", endingReason: "ended_without_hand_off", endedAt: null });
    renderBoard();
    expect(await within(await storyRow()).findByText("Stopped: ended without hand-off")).toBeInTheDocument();
  });

  it("keeps a Running Story with a live session Running, with no Resume", async () => {
    storyStopped.mockResolvedValue(null);
    renderBoard();
    const row = await storyRow();
    expect(await within(row).findByText("Running")).toBeInTheDocument();
    expect(within(row).queryByRole("button", { name: /Resume/ })).toBeNull();
  });

  it("resumes with a one-line note and opens the new session", async () => {
    const { onStarted } = renderBoard();
    const row = await storyRow();
    fireEvent.click(await within(row).findByRole("button", { name: "Resume FLY-2" }));
    fireEvent.change(within(row).getByLabelText("Resume note for FLY-2"), { target: { value: "Pick the parser back up" } });
    fireEvent.click(within(row).getByRole("button", { name: "Start the new session for FLY-2" }));

    await waitFor(() => expect(storyResume).toHaveBeenCalledWith("s1", "Pick the parser back up"));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("01JSESSIONNEXT", "s1"));
  });

  it("resumes with no note at all", async () => {
    renderBoard();
    const row = await storyRow();
    fireEvent.click(await within(row).findByRole("button", { name: "Resume FLY-2" }));
    fireEvent.click(within(row).getByRole("button", { name: "Start the new session for FLY-2" }));
    await waitFor(() => expect(storyResume).toHaveBeenCalledWith("s1", undefined));
  });

  it("shows the core's refusal", async () => {
    storyResume.mockRejectedValue(new Error("Resume needs a Stopped Story"));
    renderBoard();
    const row = await storyRow();
    fireEvent.click(await within(row).findByRole("button", { name: "Resume FLY-2" }));
    fireEvent.click(within(row).getByRole("button", { name: "Start the new session for FLY-2" }));
    expect(await within(row).findByText("Resume needs a Stopped Story")).toBeInTheDocument();
  });
});

describe("StoryBoard: Drop (issue #54)", () => {
  it("drops a Stopped Story only after the developer confirms", async () => {
    renderBoard();
    const row = await storyRow();
    fireEvent.click(await within(row).findByRole("button", { name: "Drop FLY-2" }));
    expect(storyDrop).not.toHaveBeenCalled();
    expect(within(row).getByText(/removes its worktree and branch, uncommitted work included/)).toBeInTheDocument();
    fireEvent.click(within(row).getByRole("button", { name: "Confirm drop of FLY-2" }));
    await waitFor(() => expect(storyDrop).toHaveBeenCalledWith("s1"));
  });

  it("cancelling the confirmation drops nothing", async () => {
    renderBoard();
    const row = await storyRow();
    fireEvent.click(await within(row).findByRole("button", { name: "Drop FLY-2" }));
    fireEvent.click(within(row).getByRole("button", { name: "Keep FLY-2" }));
    expect(storyDrop).not.toHaveBeenCalled();
    expect(within(row).queryByRole("button", { name: "Confirm drop of FLY-2" })).toBeNull();
  });

  it("shows the core's refusal while a session is live", async () => {
    storyStopped.mockResolvedValue(null);
    storyDrop.mockRejectedValue(new Error("FLY-2 has a live session. Stop the session first, then drop it."));
    renderBoard();
    const row = await storyRow();
    fireEvent.click(await within(row).findByRole("button", { name: "Drop FLY-2" }));
    fireEvent.click(within(row).getByRole("button", { name: "Confirm drop of FLY-2" }));
    expect(await within(row).findByText(/Stop the session first/)).toBeInTheDocument();
  });

  it("offers no Drop on a Merged or Dropped Story", async () => {
    storyListForProject.mockResolvedValue([story("merged")]);
    renderBoard();
    const row = await storyRow();
    await within(row).findByText("Merged");
    expect(within(row).queryByRole("button", { name: "Drop FLY-2" })).toBeNull();
  });
});

describe("StoryBoard: the Story's session list (issue #54)", () => {
  it("lists each session with its ID, start and end, ending reason and summary, and opens its feed", async () => {
    sessionsForStory.mockResolvedValue([
      run("01JSESSIONNEXT0000000000000", null, null),
      run("01JSESSIONDEAD0000000000000", "crash", "2026-10-19T10:00:00Z"),
    ]);
    const summary: SessionSummaryDto = {
      sessionId: "01JSESSIONDEAD0000000000000",
      createdAt: "2026-10-19T10:00:00Z",
      isStub: true,
      nextSessionMustKnow: "The previous session ended (crash) without handing off.",
      decisions: "",
    };
    sessionSummariesForStory.mockResolvedValue([summary]);
    const { onOpenSession } = renderBoard();
    const row = await storyRow();
    fireEvent.click(await within(row).findByRole("button", { name: "Sessions of FLY-2" }));

    const list = await within(row).findByRole("list", { name: "Sessions of FLY-2" });
    const items = await within(list).findAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(within(items[0]).getByText(/01JSESSIONNEXT/)).toBeInTheDocument();
    expect(within(items[0]).getByText("live")).toBeInTheDocument();
    expect(within(items[1]).getByText("crash")).toBeInTheDocument();
    expect(within(items[1]).getByText(/Stub summary/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/ended \(crash\) without handing off/)).toBeInTheDocument();
    expect(within(items[1]).getByText(/2026-10-19 10:00/)).toBeInTheDocument();

    fireEvent.click(within(items[1]).getByRole("button", { name: /Open feed/ }));
    expect(onOpenSession).toHaveBeenCalledWith("01JSESSIONDEAD0000000000000", "s1");
  });
});
