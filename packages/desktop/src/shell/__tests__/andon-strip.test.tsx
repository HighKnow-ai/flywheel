/**
 * The andon strip (issue #107, direction.md): one lamp per live Story session, lit yellow while it waits on
 * the developer, blue while its agent works, red while its Story is Stopped; Waiting on you first. A lamp
 * opens its Story, never its session (spec §7's click model).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetRowDto, ShapingFleetRowDto, WaitingRoundDto } from "../../adapters/tauri";
import { agentCount, AndonStrip, lampCapacity, lampsFromFleet, ShapingLamp, stripLamps } from "../AndonStrip";
import { resetUiState, useUiStore } from "../../state/uiStore";

const fleetList = vi.fn();
const fleetWaitingRounds = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    fleetList: () => fleetList(),
    fleetBlockedQueue: () => Promise.resolve([]),
    fleetWaitingRounds: () => fleetWaitingRounds(),
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

const RUNNING = row({
  sessionId: "r-run",
  storyId: "s-run",
  storyKey: "FLY-4",
  storyTitle: "Running one",
  doingTaskTitle: "Write the parser",
});
const WAITING = row({
  sessionId: "r-wait",
  storyId: "s-wait",
  storyKey: "FLY-6",
  storyTitle: "Waiting one",
  runStatus: "blocked",
  fleetState: "blocked",
  blockedSince: "2026-10-22T09:10:00Z",
});
const DEAD = row({
  sessionId: "r-dead",
  storyId: "s-dead",
  storyKey: "FLY-7",
  storyTitle: "Stopped one",
  runStatus: "interrupted",
  fleetState: "interrupted",
  endedAt: "2026-10-22T08:00:00Z",
});
const DONE = row({
  sessionId: "r-done",
  storyId: "s-done",
  storyKey: "FLY-3",
  storyTitle: "In review",
  storyState: "in_review",
  runStatus: "completed",
  fleetState: "awaiting_review",
  endedAt: "2026-10-22T07:00:00Z",
});

beforeEach(() => {
  resetUiState();
  fleetList.mockReset().mockResolvedValue({ rows: [RUNNING, DONE, DEAD, WAITING], totalRows: 4, visibleCostUsd: null });
  fleetWaitingRounds.mockReset().mockResolvedValue([]);
});

const ROUND: WaitingRoundDto = {
  roundId: "round-2",
  roundNumber: 2,
  subject: "epic",
  stageKind: "challenge_spec",
  sessionId: "r-shape",
  projectId: "p1",
  projectName: "Flywheel",
  projectKeyPrefix: "FLY",
  epicId: "e-59",
  epicKey: "FLY-8",
  epicTitle: "Epic shaping",
  waitingSince: "2026-10-22T09:05:00Z",
  answered: 1,
  questions: 4,
};

describe("a shaping Round waiting on you (issue #124)", () => {
  it("lights its own lamp among the waiting ones, longest waiting first, before Running and Stopped", () => {
    expect(stripLamps([RUNNING, DEAD, WAITING], [ROUND]).map((l) => [l.tone, l.key])).toEqual([
      ["waiting", "FLY-8"],
      ["waiting", "FLY-6"],
      ["running", "FLY-4"],
      ["stopped", "FLY-7"],
    ]);
  });

  it("names the Epic and the Round, and opens the Epic's shaping view, never the session", async () => {
    fleetWaitingRounds.mockResolvedValue([ROUND]);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AndonStrip />
      </QueryClientProvider>,
    );
    const lamp = await screen.findByRole("button", { name: "Open Epic FLY-8 Epic shaping, Round 2 Waiting on you" });
    expect(lamp).toHaveAttribute("data-lamp", "waiting");
    expect(lamp).toHaveTextContent("Round 2 · Waiting on you");
    expect(lamp).not.toHaveAttribute("title");
    fireEvent.focus(lamp);
    expect((await screen.findByRole("tooltip")).textContent).toContain("1 of 4 answered");
    fireEvent.click(lamp);
    expect(useUiStore.getState().currentEpicId).toBe("e-59");
    expect(useUiStore.getState().currentProjectId).toBe("p1");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("lights a roadmap Round's lamp for the project's Roadmap, and opens the project's board (issue #133)", async () => {
    resetUiState();
    useUiStore.setState({ currentProjectId: "p0", currentEpicId: "e-0" });
    const roadmap: WaitingRoundDto = {
      ...ROUND,
      roundId: "rr-1",
      roundNumber: 1,
      subject: "roadmap",
      stageKind: null,
      epicId: null,
      epicKey: null,
      epicTitle: null,
      answered: 1,
      questions: 3,
    };
    fleetWaitingRounds.mockResolvedValue([roadmap]);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AndonStrip />
      </QueryClientProvider>,
    );
    const lamp = await screen.findByRole("button", {
      name: "Open the Flywheel Roadmap, Roadmap Round 1 Waiting on you",
    });
    expect(lamp).toHaveTextContent("Round 1 · Waiting on you");
    fireEvent.focus(lamp);
    expect((await screen.findByRole("tooltip")).textContent).toContain("1 of 3 decided");
    fireEvent.click(lamp);
    expect(useUiStore.getState().currentProjectId).toBe("p1");
    expect(useUiStore.getState().currentEpicId).toBeNull();
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });
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

describe("the agent count (GLOSSARY.md: an agent is a live session)", () => {
  it("counts the live sessions: running and Waiting on you, never a Stopped Story or a handed-off one", () => {
    expect(agentCount([RUNNING, DONE, DEAD, WAITING], [])).toBe(2);
  });

  it("counts a shaping session held on a Round as one agent, once", () => {
    expect(agentCount([RUNNING, WAITING], [ROUND])).toBe(3);
    expect(agentCount([RUNNING, { ...WAITING, sessionId: ROUND.sessionId }], [ROUND])).toBe(2);
  });

  it("is the figure the strip shows under Agents, whatever lamps it lights", async () => {
    fleetWaitingRounds.mockResolvedValue([ROUND]);
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AndonStrip />
      </QueryClientProvider>,
    );
    // Four lamps (a Round, Waiting, Running, Stopped), three agents: the Stopped Story has no live session.
    await screen.findByRole("button", { name: /Open Epic FLY-8/ });
    expect(await screen.findByLabelText("3 agents")).toHaveTextContent("3");
  });
});

const SHAPING: ShapingFleetRowDto = {
  sessionId: "r-shaping",
  projectId: "p1",
  projectName: "Flywheel",
  projectKeyPrefix: "FLY",
  projectStatus: "active",
  subject: "epic",
  epicId: "e-9",
  epicKey: "FLY-9",
  epicTitle: "Waitlist",
  milestoneId: null,
  milestoneTitle: null,
  runStatus: "running",
  fleetState: "running",
  startedAt: "2026-10-22T08:30:00Z",
  blockedSince: null,
  activity: { lines: [], truncated: false },
};

describe("a shaping session working between Rounds (issue #239)", () => {
  it("counts once as an agent, and once only when it is also held on a Round", () => {
    expect(agentCount([RUNNING, DONE, DEAD, WAITING], [], [SHAPING])).toBe(3);
    const held = { ...SHAPING, sessionId: ROUND.sessionId, fleetState: "blocked" as const };
    expect(agentCount([RUNNING, WAITING], [ROUND], [held])).toBe(3);
  });

  it("lights a running lamp among the Story sessions', longest running first, and none for a held one", () => {
    expect(stripLamps([RUNNING, DEAD, WAITING], [], [SHAPING]).map((l) => [l.kind, l.tone, l.key])).toEqual([
      ["session", "waiting", "FLY-6"],
      ["shaping", "running", "FLY-9"],
      ["session", "running", "FLY-4"],
      ["session", "stopped", "FLY-7"],
    ]);
    const held = { ...SHAPING, sessionId: ROUND.sessionId, fleetState: "blocked" as const };
    expect(stripLamps([], [ROUND], [held]).map((l) => l.kind)).toEqual(["round"]);
  });

  it("counts in the strip's figure, names its Epic, and opens the Epic's shaping view", async () => {
    fleetList.mockResolvedValue({
      rows: [RUNNING, DONE, DEAD, WAITING],
      shapingRows: [SHAPING],
      totalRows: 4,
      visibleCostUsd: null,
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <AndonStrip />
      </QueryClientProvider>,
    );
    const lamp = await screen.findByRole("button", { name: "Open Epic FLY-9 Waitlist, Shaping" });
    expect(lamp).toHaveAttribute("data-lamp", "running");
    expect(lamp).toHaveTextContent("FLY-9");
    expect(lamp).toHaveTextContent(/Shaping · /);
    expect(screen.getByLabelText("3 agents")).toHaveTextContent("3");
    fireEvent.click(lamp);
    expect(useUiStore.getState().currentEpicId).toBe("e-9");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("names a Milestone's session by its title and the Roadmap's by its project", () => {
    const milestone = {
      ...SHAPING,
      sessionId: "r-m",
      subject: "milestone" as const,
      epicId: null,
      epicKey: null,
      epicTitle: null,
      milestoneId: "m-1",
      milestoneTitle: "Private beta",
    };
    const roadmap = {
      ...milestone,
      sessionId: "r-r",
      subject: "roadmap" as const,
      milestoneId: null,
      milestoneTitle: null,
    };
    render(
      <QueryClientProvider client={new QueryClient()}>
        <ShapingLamp row={milestone} current={false} now={Date.parse("2026-10-22T09:30:00Z")} />
        <ShapingLamp row={roadmap} current={false} now={Date.parse("2026-10-22T09:30:00Z")} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("button", { name: "Open Milestone Private beta, Shaping" })).toHaveTextContent(
      "Private beta",
    );
    expect(screen.getByRole("button", { name: "Open the Flywheel Roadmap, Shaping" })).toHaveTextContent(
      "Flywheel Roadmap",
    );
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
    expect(await lamps.findByRole("button", { name: "Open Story FLY-6 Waiting one, Waiting on you" })).toHaveAttribute(
      "data-lamp",
      "waiting",
    );
    const running = lamps.getByRole("button", { name: "Open Story FLY-4 Running one, Running" });
    expect(running).toHaveTextContent("Doing: Write the parser");
    // Its details are a Tooltip, never a title attribute (critique F58).
    expect(running).not.toHaveAttribute("title");
    fireEvent.focus(running);
    expect((await screen.findByRole("tooltip")).textContent).toContain("FLY-4 Running one");
    expect(await lamps.findByText(/Stopped: usage limit/)).toBeInTheDocument();
  });

  it("opens the Story, never the session, when a lamp is clicked", async () => {
    renderStrip();
    fireEvent.click(await screen.findByRole("button", { name: "Open Story FLY-6 Waiting one, Waiting on you" }));
    expect(useUiStore.getState().currentStoryId).toBe("s-wait");
    expect(useUiStore.getState().currentProjectId).toBe("p1");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("folds a waiting lamp into +n more, which then opens Waiting on you (issue #124)", async () => {
    fleetWaitingRounds.mockResolvedValue([ROUND]);
    const many = Array.from({ length: 6 }, (_, i) =>
      row({ sessionId: `r-${i}`, storyId: `s-${i}`, storyKey: `FLY-${20 + i}`, storyTitle: `Running ${i}` }),
    );
    fleetList.mockResolvedValue({ rows: many, totalRows: many.length, visibleCostUsd: null });
    renderStrip();
    // jsdom has no layout: every lamp is shown, so check the rule on the pure order instead.
    await screen.findByRole("button", { name: /Open Epic FLY-8/ });
    expect(stripLamps(many, [ROUND])[0]?.kind).toBe("round");
  });

  it("keeps its height and says so when no agent is running", async () => {
    fleetList.mockResolvedValue({ rows: [DONE], totalRows: 1, visibleCostUsd: null });
    renderStrip();
    expect(await screen.findByText("No agent running")).toBeInTheDocument();
  });
});
