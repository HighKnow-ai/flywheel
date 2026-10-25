/**
 * Story #118: the Story's agent station, as the Andon mockup draws it. While a session is live it
 * offers Stop (confirmed first, as direction.md asks of Stop and Drop) and a live tail of the agent's
 * last few tool calls, each worded as the feed words it. Nothing here opens the session on its own.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryView, stationTail } from "../StoryView";
import { buildFeedRows } from "../../session/feedRows";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { RunSummaryDto, StoryDto } from "../../adapters/tauri";

const sessionsForStory = vi.fn();
const sessionLogWindow = vi.fn();
const stopSession = vi.fn();
const blockedSummary = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    storyGet: () => Promise.resolve(STORY),
    storyStopped: () => Promise.resolve(null),
    sessionsForStory: (...args: unknown[]) => sessionsForStory(...args),
    sessionSummariesForStory: () => Promise.resolve([]),
    sessionLogWindow: (...args: unknown[]) => sessionLogWindow(...args),
    stopSession: (...args: unknown[]) => stopSession(...args),
    blockedSummary: () => blockedSummary(),
    taskList: () => Promise.resolve([]),
    criterionList: () => Promise.resolve([]),
    storyContextPacketSize: () => Promise.resolve({ bytes: 400, approxTokens: 100, overSoftLimit: false }),
    milestoneList: () => Promise.resolve([]),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

const STORY: StoryDto = {
  id: "s1", projectId: "p1", epicId: "e1", key: "FLY-4", title: "Predictable clicks", description: null,
  state: "running", runsAfterStoryId: null, rank: "a",
};

const LIVE: RunSummaryDto = {
  id: "ses-live", storyId: "s1", status: "running", startedAt: "2026-10-19T09:00:00Z", endedAt: null,
  costUsd: null, tokensIn: null, tokensOut: null, externalSessionId: null, acknowledgedAt: null,
  abandonedReason: null, endingReason: null,
};

let seq = 0;
const ev = (fields: Record<string, unknown>) => ({ seq: seq++, at: "2026-10-19T09:01:00Z", raw: "{}", ...fields });
const call = (id: string, toolName: string, input: unknown) => ev({ type: "tool_call", toolName, input, toolUseId: id });
const result = (id: string, output: unknown) => ev({ type: "tool_result", toolUseId: id, output });

const LOG = [
  call("a", "Read", { file_path: "src/App.tsx" }),
  result("a", "1\n2\n3"),
  ev({ type: "assistant_text", text: "Found it." }),
  call("b", "Grep", { pattern: "setActiveSessionId" }),
  result("b", "a.ts:1\nb.ts:2"),
  call("c", "mcp__flywheel-board__task_add", { titles: ["Clear the open session"] }),
  result("c", '{"tasks":[]}'),
  call("d", "Edit", { file_path: "src/state/uiStore.ts", old_string: "a", new_string: "a\nb" }),
  result("d", "updated"),
  call("e", "Bash", { command: "npm test" }),
];

function renderStory() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryView projectId="p1" projectName="Threadfin" storyId="s1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1" });
  sessionsForStory.mockReset().mockResolvedValue([LIVE]);
  sessionLogWindow.mockReset().mockResolvedValue({ entries: LOG, offset: 0, limit: 50, total: LOG.length });
  stopSession.mockReset().mockResolvedValue({ status: "interrupted", sidecarWarning: null });
  blockedSummary.mockReset().mockResolvedValue({ blockedStoryIds: [], blockedCount: 0 });
});

describe("the agent station (Story #118)", () => {
  it("shows the last few tool calls as plain verbs, newest last, the one in flight running", async () => {
    renderStory();
    const station = await screen.findByRole("region", { name: "Live agent" });
    const tail = await within(station).findByRole("list", { name: "Last tool calls" });
    const lines = within(tail).getAllByRole("listitem");
    expect(lines.map((line) => line.querySelector(".feed-call-verb")?.textContent)).toEqual([
      "Searched",
      "Added Task",
      "Edited",
      "Running",
    ]);
    expect(lines[3]).toHaveTextContent("npm test");
    expect(lines[3]).toHaveTextContent(/running · /);
    expect(station.innerHTML).not.toContain("mcp__");
  });

  it("names the session and the agent's pace: session n, how long, last activity", async () => {
    sessionsForStory.mockResolvedValue([LIVE, { ...LIVE, id: "ses-old", endedAt: "2026-10-19T08:00:00Z" }]);
    renderStory();
    const station = await screen.findByRole("region", { name: "Live agent" });
    expect(await within(station).findByText(/^Session 2 · .+ · last activity .+ ago$/)).toBeInTheDocument();
  });

  it("interleaves the agent's newest turn among the calls, one line, at most one", () => {
    const rows = buildFeedRows([
      call("x1", "Read", { file_path: "a.ts" }),
      ev({ type: "assistant_text", text: "Old turn." }),
      call("x2", "Read", { file_path: "b.ts" }),
      ev({ type: "assistant_text", text: "**Found it.** Moving the check first.\n\nMore." }),
      call("x3", "Bash", { command: "npm test" }),
    ]);
    const tail = stationTail(rows);
    expect(tail.map((row) => row.kind)).toEqual(["tool_call", "tool_call", "assistant_text", "tool_call"]);
  });

  it("stops the live session only after the developer confirms, and opens nothing", async () => {
    renderStory();
    const station = await screen.findByRole("region", { name: "Live agent" });
    fireEvent.click(await within(station).findByRole("button", { name: "Stop FLY-4" }));
    expect(stopSession).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Keep running" }));
    expect(stopSession).not.toHaveBeenCalled();

    fireEvent.click(within(station).getByRole("button", { name: "Stop FLY-4" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop the session" }));
    await waitFor(() => expect(stopSession).toHaveBeenCalledWith("ses-live"));
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("says so when Flywheel could not confirm the stop", async () => {
    stopSession.mockResolvedValue({ status: "interrupted", sidecarWarning: "the sidecar did not answer" });
    renderStory();
    const station = await screen.findByRole("region", { name: "Live agent" });
    fireEvent.click(await within(station).findByRole("button", { name: "Stop FLY-4" }));
    fireEvent.click(await screen.findByRole("button", { name: "Stop the session" }));
    expect(await screen.findByText(/could not confirm the agent process actually stopped/)).toBeInTheDocument();
  });

  it("keeps Stop and the tail while the session waits on you, beside Answer", async () => {
    blockedSummary.mockResolvedValue({ blockedStoryIds: ["s1"], blockedCount: 1 });
    renderStory();
    const station = await screen.findByRole("region", { name: "Live agent" });
    expect(await within(station).findByRole("button", { name: "Answer FLY-4" })).toBeInTheDocument();
    expect(within(station).getByRole("button", { name: "Stop FLY-4" })).toBeInTheDocument();
    expect(await within(station).findByRole("list", { name: "Last tool calls" })).toBeInTheDocument();
  });

  it("is not drawn without a live session", async () => {
    sessionsForStory.mockResolvedValue([{ ...LIVE, endedAt: "2026-10-19T10:00:00Z" }]);
    renderStory();
    await screen.findByRole("heading", { name: /Predictable clicks/ });
    await waitFor(() => expect(sessionsForStory).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Live agent" })).toBeNull();
  });
});

describe("+ Epic beside + Story (Story #118)", () => {
  it("the Story view's top bar offers both", async () => {
    renderStory();
    await screen.findByRole("heading", { name: /Predictable clicks/ });
    const bar = screen.getByRole("navigation", { name: "You are here" }).closest("header") as HTMLElement;
    expect(within(bar).getByRole("button", { name: "Add an Epic" })).toBeInTheDocument();
    expect(within(bar).getByRole("button", { name: "Write a Story" })).toBeInTheDocument();
  });
});
