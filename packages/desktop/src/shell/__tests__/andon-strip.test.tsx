/**
 * The andon strip (issue #107, direction.md): one lamp per live Story session, lit yellow while it waits on
 * the developer, blue while its agent works, red while its Story is Stopped; Waiting on you first. A lamp
 * opens its Story, never its session (spec §7's click model).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetRowDto } from "../../adapters/tauri";
import { AndonStrip, lampCapacity, lampsFromFleet } from "../AndonStrip";
import { resetUiState, useUiStore } from "../../state/uiStore";

const fleetList = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    fleetList: () => fleetList(),
    fleetBlockedQueue: () => Promise.resolve([]),
    storyStopped: () => Promise.resolve({ sessionId: "r-dead", endingReason: "usage_limit", endedAt: null }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

function row(overrides: Partial<FleetRowDto>): FleetRowDto {
  return {
    sessionId: "r",
    projectId: "p1",
    projectName: "Flywheel",
    projectKeyPrefix: "FLY",
    projectStatus: "active",
    storyId: "s",
    storyKey: "FLY-1",
    storyTitle: "A Story",
    storyState: "running",
    runStatus: "running",
    fleetState: "running",
    startedAt: "2026-10-22T09:00:00Z",
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

const RUNNING = row({ sessionId: "r-run", storyId: "s-run", storyKey: "FLY-4", storyTitle: "Running one", doingTaskTitle: "Write the parser" });
const WAITING = row({ sessionId: "r-wait", storyId: "s-wait", storyKey: "FLY-6", storyTitle: "Waiting one", runStatus: "blocked", fleetState: "blocked", blockedSince: "2026-10-22T09:10:00Z" });
const DEAD = row({ sessionId: "r-dead", storyId: "s-dead", storyKey: "FLY-7", storyTitle: "Stopped one", runStatus: "interrupted", fleetState: "interrupted", endedAt: "2026-10-22T08:00:00Z" });
const DONE = row({ sessionId: "r-done", storyId: "s-done", storyKey: "FLY-3", storyTitle: "In review", storyState: "in_review", runStatus: "completed", fleetState: "awaiting_review", endedAt: "2026-10-22T07:00:00Z" });

beforeEach(() => {
  resetUiState();
  fleetList.mockReset().mockResolvedValue({ rows: [RUNNING, DONE, DEAD, WAITING], totalRows: 4, visibleCostUsd: null });
});

describe("lampsFromFleet", () => {
  it("lights Waiting on you first, then Running, then Stopped, and nothing for a handed-off Story", () => {
    expect(lampsFromFleet([RUNNING, DONE, DEAD, WAITING]).map((l) => [l.tone, l.row.storyKey])).toEqual([
      ["waiting", "FLY-6"],
      ["running", "FLY-4"],
      ["stopped", "FLY-7"],
    ]);
  });

  it("gives a Stopped Story one lamp, from its newest session, and none while a session of it is live", () => {
    const older = { ...DEAD, sessionId: "r-older", startedAt: "2026-10-21T09:00:00Z" };
    expect(lampsFromFleet([older, DEAD]).map((l) => l.row.sessionId)).toEqual(["r-dead"]);
    const resumed = { ...RUNNING, storyId: DEAD.storyId };
    expect(lampsFromFleet([DEAD, resumed]).map((l) => l.tone)).toEqual(["running"]);
  });
});

describe("lampCapacity", () => {
  it("shows every lamp that fits, and keeps room for the +n more lamp when some do not", () => {
    expect(lampCapacity(2000, 3)).toBe(3);
    expect(lampCapacity(800, 5)).toBe(2);
  });
});

describe("AndonStrip", () => {
  function renderStrip() {
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AndonStrip />
      </QueryClientProvider>,
    );
  }

  it("names each lamp's Story and what it waits on, is doing, or why it stopped", async () => {
    renderStrip();
    const lamps = within(await screen.findByRole("list", { name: "Live sessions" }));
    expect(await lamps.findByRole("button", { name: "Open Story FLY-6 Waiting one, Waiting on you" })).toHaveAttribute("data-lamp", "waiting");
    expect(lamps.getByRole("button", { name: "Open Story FLY-4 Running one, Running" })).toHaveTextContent("Doing: Write the parser");
    expect(await lamps.findByText(/Stopped: usage limit/)).toBeInTheDocument();
  });

  it("opens the Story, never the session, when a lamp is clicked", async () => {
    renderStrip();
    fireEvent.click(await screen.findByRole("button", { name: "Open Story FLY-6 Waiting one, Waiting on you" }));
    expect(useUiStore.getState().currentStoryId).toBe("s-wait");
    expect(useUiStore.getState().currentProjectId).toBe("p1");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("keeps its height and says so when no agent is running", async () => {
    fleetList.mockResolvedValue({ rows: [DONE], totalRows: 1, visibleCostUsd: null });
    renderStrip();
    expect(await screen.findByText("No agent running")).toBeInTheDocument();
  });
});
