/**
 * Behavior under test (Phase 10 plan 10-01, FLEET-01/FLEET-04, D-164/D-169/D-170):
 * - The three band headers render in the fixed order, and only for bands that hold a row.
 * - Each of the six run states plus awaiting review renders its own word beside its mark.
 * - `interrupted` renders in the quiet class and under DONE / FAILED; `abandoned` in needs-you and under NEEDS YOU.
 * - The project is a column on every row, never a grouping.
 * - A run with no Story is still a row (an authoring run, a planning run, a run with no subject).
 * - The empty state renders its copy, no band header and a zero count; one run renders one header.
 * - #208: the list is a Table with column headers; the count is the strip's `agentCount` (GLOSSARY.md) and
 *   labels the rows that are not agents as ended runs; the view switch is Tabs.
 * - The "Fleet" open path: the store keeps the fleet open under a session, so popping the session
 *   (`setActiveSessionId(null)`) lands back on the fleet, and `App.tsx` checks the fleet branch
 *   BELOW the session branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetListDto, FleetRowDto, ShapingFleetRowDto } from "../../adapters/tauri";
import { RUN_STATUS_LABELS } from "../../legend/runStatus";
import { STATE_VOCABULARY } from "../../components/StateBadge";
import { activeSurface } from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { SessionSurface } from "../../session/SessionSurface";
import { FleetSurface } from "../FleetSurface";

const fleetListMock = vi.fn<() => Promise<FleetListDto>>();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    fleetList: () => fleetListMock(),
    fleetBlockedQueue: () => Promise.resolve([]),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    // The session surface's own reads, for the shared-vocabulary test below: an empty feed.
    sessionLogWindow: (_sessionId: string, offset: number, limit: number) =>
      Promise.resolve({ entries: [], offset, limit, total: 0 }),
    sessionRawWindow: (_sessionId: string, offset: number, limit: number) =>
      Promise.resolve({ entries: [], offset, limit, total: 0 }),
    pendingPermissionRequests: () => Promise.resolve([]),
  };
});

function row(overrides: Partial<FleetRowDto>): FleetRowDto {
  return {
    sessionId: "run-1",
    projectId: "proj-1",
    projectName: "Alpha",
    projectKeyPrefix: "ALP",
    projectStatus: "active",
    storyId: "story-1",
    storyKey: "ALP-1",
    storyTitle: "Wire the thing",
    storyState: "running",
    runStatus: "running",
    fleetState: "running",
    startedAt: new Date(Date.now() - 125_000).toISOString(),
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

function list(rows: FleetRowDto[]): FleetListDto {
  return { rows, totalRows: rows.length, visibleCostUsd: null };
}

function renderFleet() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <FleetSurface onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetUiState();
  fleetListMock.mockReset();
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe("FleetSurface bands", () => {
  it("renders the three band headers in the fixed order", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ sessionId: "r-blocked", fleetState: "blocked", runStatus: "blocked" }),
        row({ sessionId: "r-running", fleetState: "running" }),
        row({ sessionId: "r-failed", fleetState: "failed", runStatus: "failed", endedAt: new Date().toISOString() }),
      ]),
    );
    renderFleet();
    await screen.findByText("NEEDS YOU");
    const headers = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headers).toEqual(["NEEDS YOU", "RUNNING", "DONE / FAILED"]);
  });

  it("renders one word beside its mark for each of the six states plus awaiting review", async () => {
    const states = [
      "blocked",
      "awaiting_review",
      "abandoned",
      "running",
      "completed",
      "failed",
      "interrupted",
    ] as const;
    fleetListMock.mockResolvedValue(
      list(
        states.map((state, i) =>
          row({
            sessionId: `r-${state}`,
            storyKey: `ALP-${i + 1}`,
            fleetState: state,
            runStatus: state === "awaiting_review" ? "completed" : state,
            endedAt: new Date().toISOString(),
          }),
        ),
      ),
    );
    renderFleet();
    await screen.findByText("NEEDS YOU");
    const words = states.map((state) => {
      const item = document.querySelector(`[data-fleet-state="${state}"]`) as HTMLElement;
      expect(item, state).not.toBeNull();
      const stateCell = within(item).getByText(RUN_STATUS_LABELS[state]);
      // A mark glyph (an svg) sits beside the word: never colour alone.
      expect(stateCell.querySelector("svg"), state).not.toBeNull();
      return stateCell.textContent;
    });
    expect(new Set(words).size).toBe(7);
  });

  it("puts interrupted under DONE / FAILED in the quiet class, and abandoned under NEEDS YOU in needs-you", async () => {
    fleetListMock.mockResolvedValue(
      list([
        // The Story moved on (In review), so this interrupted run is history, not a Stopped Story.
        row({
          sessionId: "r-int",
          storyState: "in_review",
          fleetState: "interrupted",
          runStatus: "interrupted",
          endedAt: new Date().toISOString(),
        }),
        row({ sessionId: "r-ab", fleetState: "abandoned", runStatus: "abandoned" }),
      ]),
    );
    renderFleet();
    await screen.findByText("NEEDS YOU");
    const interrupted = document.querySelector('[data-fleet-state="interrupted"]') as HTMLElement;
    const abandoned = document.querySelector('[data-fleet-state="abandoned"]') as HTMLElement;
    expect(interrupted.closest("[data-band]")?.getAttribute("data-band")).toBe("done-failed");
    expect(abandoned.closest("[data-band]")?.getAttribute("data-band")).toBe("needs-you");
    const doneBandHeader = interrupted.closest("tbody")?.querySelector("h2")?.textContent;
    expect(doneBandHeader).toBe("DONE / FAILED");
    // Every state is drawn by the one component (components/StateBadge.tsx): `interrupted` is a normal
    // outcome and neutral, never red (D-169); an abandoned run lost its supervisor and is red.
    const interruptedBadge = within(interrupted).getByText("Interrupted") as HTMLElement;
    expect(interruptedBadge.getAttribute("data-tone")).toBe("neutral");
    expect((within(abandoned).getByText("Abandoned") as HTMLElement).getAttribute("data-tone")).toBe("destructive");
  });

  it("spends yellow on Waiting on you, blue on Running and red on failure, and nothing else (direction.md)", async () => {
    // One meaning per colour: every other state is a neutral pill told apart by its icon and word.
    const states = ["blocked", "abandoned", "failed", "running", "completed", "interrupted"] as const;
    fleetListMock.mockResolvedValue(
      list(
        states.map((state, i) =>
          row({
            sessionId: `r-${state}`,
            storyKey: `ALP-${i + 1}`,
            fleetState: state,
            runStatus: state,
            endedAt: new Date().toISOString(),
          }),
        ),
      ),
    );
    renderFleet();
    await screen.findByText("NEEDS YOU");
    const tones = states.map((state) => {
      const item = document.querySelector(`[data-fleet-state="${state}"]`) as HTMLElement;
      const badge = within(item).getByText(RUN_STATUS_LABELS[state]) as HTMLElement;
      return badge.getAttribute("data-tone");
    });
    expect(tones).toEqual(["attention", "destructive", "destructive", "running", "neutral", "neutral"]);
  });

  it("shows the project as a column on every row and never groups by it", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ sessionId: "a", projectName: "Alpha", startedAt: "2026-01-01T01:00:00Z" }),
        row({ sessionId: "b", projectName: "Bravo", startedAt: "2026-01-01T02:00:00Z" }),
        row({ sessionId: "c", projectName: "Alpha", startedAt: "2026-01-01T03:00:00Z" }),
      ]),
    );
    renderFleet();
    await screen.findByText("RUNNING");
    const projects = Array.from(document.querySelectorAll('[data-field="project"]')).map((e) => e.textContent);
    expect(projects).toEqual(["Alpha", "Bravo", "Alpha"]);
    // One band header only: no per-project grouping header was rendered.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });
});

describe("FleetSurface header and empty state", () => {
  it("renders the empty copy, a zero count and no band header with no run anywhere", async () => {
    fleetListMock.mockResolvedValue(list([]));
    renderFleet();
    expect(await screen.findByText("No agents running")).toBeInTheDocument();
    expect(screen.getByText("When an agent starts in any project, it appears here.")).toBeInTheDocument();
    expect(screen.getByText("0 agents")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 2 })).toHaveLength(0);
  });

  it("renders only that run's band header, and a singular count, with exactly one run", async () => {
    fleetListMock.mockResolvedValue(list([row({ fleetState: "blocked", runStatus: "blocked" })]));
    renderFleet();
    await screen.findByText("NEEDS YOU");
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
    expect(screen.getByText("1 agent")).toBeInTheDocument();
  });

  it("counts agents as the strip does, and labels the ended runs on their own", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ sessionId: "a", fleetState: "blocked", runStatus: "blocked" }),
        row({ sessionId: "b", fleetState: "awaiting_review", runStatus: "completed" }),
        row({ sessionId: "c", fleetState: "running" }),
      ]),
    );
    renderFleet();
    // The awaiting-review run has ended: it is a run on the list, not an agent.
    await waitFor(() => expect(screen.getByText("2 agents · 1 ended run")).toBeInTheDocument());
  });

  it("draws the list as a table with a header for every column it shows", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ sessionId: "a", doingTaskTitle: "Write the query" }),
        row({
          sessionId: "b",
          fleetState: "completed",
          runStatus: "completed",
          costUsd: 3.1,
          endedAt: new Date().toISOString(),
        }),
      ]),
    );
    renderFleet();
    const table = await screen.findByRole("table");
    const headers = within(table.querySelector("thead") as HTMLElement)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["State", "Project", "Story", "Doing", "Spend", "Age", "Actions"]);
    // Money reads through lib/format.ts: two decimals, never "$3.1000".
    expect(within(table).getByText("$3.10")).toBeInTheDocument();
  });

  it("leaves out a column no row fills", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ sessionId: "b", fleetState: "completed", runStatus: "completed", endedAt: new Date().toISOString() }),
      ]),
    );
    renderFleet();
    const table = await screen.findByRole("table");
    const headers = within(table.querySelector("thead") as HTMLElement)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toEqual(["State", "Project", "Story", "Age", "Actions"]);
  });
});

describe("the fleet opens under the session", () => {
  it("keeps the fleet open when a session is opened and then closed", () => {
    useUiStore.getState().setFleetSurface({ view: "fleet" });
    useUiStore.getState().setActiveSessionId("run-1", "story-1");
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    useUiStore.getState().setActiveSessionId(null);
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
  });

  it("checks the session before the fleet, and the fleet before an unreachable project, in the surface precedence", () => {
    // Moved from a source-position grep of `App.tsx` to the resolver itself (plan 13-08).
    const none = {
      settingsOpen: false,
      sessionOpen: false,
      fleetOpen: false,
      worktreeInventoryOpen: false,
      projectUnreachable: false,
    };
    expect(activeSurface({ ...none, sessionOpen: true, fleetOpen: true })).toBe("session");
    expect(activeSurface({ ...none, fleetOpen: true, projectUnreachable: true })).toBe("fleet");
  });
});

describe("the activity column", () => {
  it("renders no activity text for a failed row, even one that carries a tail", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({
          runStatus: "failed",
          fleetState: "failed",
          endedAt: new Date().toISOString(),
          activity: {
            lines: [JSON.stringify({ type: "assistant_text", seq: 1, text: "Still going." })],
            truncated: false,
          },
        }),
      ]),
    );
    renderFleet();
    // The first fleet row.
    const item = await waitFor(() => {
      const row = document.querySelector<HTMLElement>("[data-run-id]");
      if (!row) throw new Error("no fleet row yet");
      return row;
    });
    expect(within(item).queryByText("Still going.")).toBeNull();
    expect(item.querySelector('[data-field="activity"]')).toBeNull();
  });
});

describe("the vocabulary", () => {
  it("draws every fleet state, awaiting review included (D-19), from the one state vocabulary", () => {
    for (const state of Object.keys(RUN_STATUS_LABELS)) {
      expect(STATE_VOCABULARY[state as keyof typeof STATE_VOCABULARY], state).toBeDefined();
    }
  });
});

describe("a Stopped Story on the fleet", () => {
  it("reads Stopped, in red, on the newest ended run of a Running Story with no live session", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({
          sessionId: "r-dead",
          storyState: "running",
          fleetState: "interrupted",
          runStatus: "interrupted",
          endedAt: new Date().toISOString(),
        }),
      ]),
    );
    renderFleet();
    const dead = await waitFor(() => {
      const el = document.querySelector('[data-fleet-state="interrupted"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(within(dead).getByText("Stopped").getAttribute("data-tone")).toBe("destructive");
  });
});

describe("one vocabulary across the fleet and the session surface", () => {
  it("renders an abandoned run's word from the same map on both surfaces", async () => {
    fleetListMock.mockResolvedValue(
      list([row({ sessionId: "r-ab", fleetState: "abandoned", runStatus: "abandoned" })]),
    );
    const fleet = renderFleet();
    const fleetRow = await waitFor(() => {
      const el = document.querySelector('[data-fleet-state="abandoned"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    const fleetWord = within(fleetRow).getByText(RUN_STATUS_LABELS.abandoned).textContent;
    fleet.unmount();

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="r-ab" storyId="story-1" initialStatus="abandoned" onBack={() => {}} />
      </QueryClientProvider>,
    );
    const sessionWord = (await screen.findByText(RUN_STATUS_LABELS.abandoned)).textContent;
    expect(sessionWord).toBe(fleetWord);
    expect(sessionWord).toBe("Abandoned");
  });

  it("opens a terminal run with its caller-supplied status, not the running default", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <SessionSurface sessionId="r-failed" storyId="story-1" initialStatus="failed" onBack={() => {}} />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("Failed")).toBeInTheDocument();
    expect(screen.queryByText("Running")).not.toBeInTheDocument();
  });
});

describe("the fleet surface's two views (plan 10-05)", () => {
  it("shows the queue for the queue view, and moves to the fleet list from inside the surface", async () => {
    fleetListMock.mockResolvedValue({ rows: [], totalRows: 0, visibleCostUsd: null });
    useUiStore.getState().setFleetSurface({ view: "queue" });
    const { findByText, getByRole, findByRole } = renderFleet();
    expect(await findByText("Nothing is waiting on you")).toBeTruthy();
    expect(getByRole("tablist", { name: "Fleet views" })).toBeInTheDocument();
    expect(getByRole("tab", { name: "Waiting on you 0" })).toHaveAttribute("aria-selected", "true");

    // A Radix tab activates on the primary button's press.
    fireEvent.mouseDown(getByRole("tab", { name: "All agents" }), { button: 0 });
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    expect(await findByText("No agents running")).toBeTruthy();
    expect(await findByRole("tab", { name: "Waiting on you 0" })).toHaveAttribute("aria-selected", "false");
  });
});

describe("every live Story session across projects (#58)", () => {
  it("shows two Stories running in two projects, each with its Story, state, doing Task and elapsed time", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({
          sessionId: "r-a",
          storyKey: "ALP-1",
          storyTitle: "Wire the thing",
          doingTaskTitle: "Write the fleet query",
        }),
        row({
          sessionId: "r-b",
          projectId: "proj-2",
          projectName: "Beta",
          projectKeyPrefix: "BET",
          storyId: "story-2",
          storyKey: "BET-4",
          storyTitle: "Ship the other thing",
          fleetState: "blocked",
          runStatus: "blocked",
          doingTaskTitle: null,
        }),
      ]),
    );
    renderFleet();
    await screen.findByText("Write the fleet query");
    const a = document.querySelector('[data-run-id="r-a"]') as HTMLElement;
    const b = document.querySelector('[data-run-id="r-b"]') as HTMLElement;
    expect(within(a).getByText("Alpha")).toBeInTheDocument();
    expect(within(a).getByText("ALP-1")).toBeInTheDocument();
    expect(within(a).getByText("Wire the thing")).toBeInTheDocument();
    expect(within(a).getByText(RUN_STATUS_LABELS.running)).toBeInTheDocument();
    expect(a.querySelector('[data-field="doing-task"]')?.textContent).toBe("Write the fleet query");
    // A clock reading through lib/format.ts, ticking on the surface's one interval.
    expect(a.querySelector('[data-field="age"]')?.textContent).toMatch(/^2m \d\ds$/);

    expect(within(b).getByText("Beta")).toBeInTheDocument();
    expect(within(b).getByText("BET-4")).toBeInTheDocument();
    expect(within(b).getByText(RUN_STATUS_LABELS.blocked)).toBeInTheDocument();
    // No doing Task yet: the cell is there and says nothing, never a placeholder Task.
    expect(b.querySelector('[data-field="doing-task"]')?.textContent).toBe("");
  });

  it("opens the clicked row's session feed", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ sessionId: "r-b", projectId: "proj-2", projectName: "Beta", storyId: "story-2", storyKey: "BET-4" }),
      ]),
    );
    renderFleet();
    fireEvent.click(await screen.findByText("Wire the thing"));
    expect(useUiStore.getState().activeSessionId).toBe("r-b");
    expect(useUiStore.getState().activeSessionStoryId).toBe("story-2");
  });
});

describe("a live shaping session on All agents (issue #239)", () => {
  function shaping(overrides: Partial<ShapingFleetRowDto>): ShapingFleetRowDto {
    return {
      sessionId: "shape-1",
      projectId: "proj-1",
      projectName: "Alpha",
      projectKeyPrefix: "ALP",
      projectStatus: "active",
      subject: "epic",
      epicId: "epic-9",
      epicKey: "ALP-9",
      epicTitle: "Waitlist",
      milestoneId: null,
      milestoneTitle: null,
      runStatus: "running",
      fleetState: "running",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      blockedSince: null,
      activity: { lines: [], truncated: false },
      ...overrides,
    };
  }

  it("counts a shaping session working between Rounds once in the headline", async () => {
    fleetListMock.mockResolvedValue({ ...list([row({ sessionId: "r-a" })]), shapingRows: [shaping({})] });
    renderFleet();
    await waitFor(() => expect(screen.getByText("2 agents")).toBeInTheDocument());
  });

  it("lists it as a Running row naming its Epic, says Shaping, and opens the Epic's shaping view", async () => {
    fleetListMock.mockResolvedValue({ ...list([row({ sessionId: "r-a" })]), shapingRows: [shaping({})] });
    renderFleet();
    const table = await screen.findByRole("table");
    const headers = within(table.querySelector("thead") as HTMLElement)
      .getAllByRole("columnheader")
      .map((h) => h.textContent);
    expect(headers).toContain("Working on");
    const shapingRow = table.querySelector('[data-run-id="shape-1"]') as HTMLElement;
    expect(shapingRow.closest("[data-band]")).toHaveAttribute("data-band", "running");
    expect(within(shapingRow).getByText(RUN_STATUS_LABELS.running)).toBeInTheDocument();
    expect(within(shapingRow).getByText("ALP-9")).toBeInTheDocument();
    expect(within(shapingRow).getByText("Waitlist")).toBeInTheDocument();
    expect(shapingRow.querySelector('[data-field="doing-task"]')?.textContent).toBe("Shaping");
    // Live: nothing to dismiss.
    expect(within(shapingRow).queryByRole("button", { name: /Dismiss/ })).toBeNull();
    fireEvent.click(shapingRow);
    expect(useUiStore.getState().currentEpicId).toBe("epic-9");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("puts a held one under NEEDS YOU as Waiting on you, and names a Milestone's and the Roadmap's", async () => {
    fleetListMock.mockResolvedValue({
      ...list([]),
      shapingRows: [
        shaping({ fleetState: "blocked", blockedSince: new Date(Date.now() - 30_000).toISOString() }),
        shaping({
          sessionId: "shape-m",
          subject: "milestone",
          epicId: null,
          epicKey: null,
          epicTitle: null,
          milestoneId: "m-1",
          milestoneTitle: "Private beta",
        }),
        shaping({ sessionId: "shape-r", subject: "roadmap", epicId: null, epicKey: null, epicTitle: null }),
      ],
    });
    renderFleet();
    const table = await screen.findByRole("table");
    await waitFor(() => expect(screen.getByText("3 agents")).toBeInTheDocument());
    const held = table.querySelector('[data-run-id="shape-1"]') as HTMLElement;
    expect(held.closest("[data-band]")).toHaveAttribute("data-band", "needs-you");
    expect(within(held).getByText(RUN_STATUS_LABELS.blocked)).toBeInTheDocument();
    const milestone = table.querySelector('[data-run-id="shape-m"]') as HTMLElement;
    expect(within(milestone).getByText("Private beta")).toBeInTheDocument();
    const roadmap = table.querySelector('[data-run-id="shape-r"]') as HTMLElement;
    expect(within(roadmap).getByRole("button", { name: "Open the Alpha Roadmap" })).toHaveTextContent("Roadmap");
  });
});
