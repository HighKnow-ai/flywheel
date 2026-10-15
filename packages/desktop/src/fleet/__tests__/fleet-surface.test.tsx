/**
 * Behavior under test (Phase 10 plan 10-01, FLEET-01/FLEET-04, D-164/D-169/D-170):
 * - The three band headers render in the fixed order, and only for bands that hold a row.
 * - Each of the six run states plus awaiting review renders its own word beside its mark.
 * - `interrupted` renders on the muted role and under DONE / FAILED; `abandoned` under NEEDS YOU.
 * - The project is a column on every row, never a grouping.
 * - A run with no task is still a row (an authoring run, a planning run, a run with no subject).
 * - The empty state renders its copy, no band header and a zero count; one run renders one header.
 * - The "Fleet" open path: the store keeps the fleet open under a session, so popping the session
 *   (`setActiveAgentRunId(null)`) lands back on the fleet, and `App.tsx` checks the fleet branch
 *   BELOW the session branch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetListDto, FleetRowDto } from "../../adapters/tauri";
import { MARKS_BY_ID } from "../../legend/marks";
import { RUN_STATUS_LABELS, RUN_STATUS_MARK_IDS } from "../../legend/runStatus";
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
    agentRunLogWindow: (_agentRunId: string, offset: number, limit: number) =>
      Promise.resolve({ entries: [], offset, limit, total: 0 }),
    agentRunRawWindow: (_agentRunId: string, offset: number, limit: number) =>
      Promise.resolve({ entries: [], offset, limit, total: 0 }),
    pendingPermissionRequests: () => Promise.resolve([]),
  };
});

function row(overrides: Partial<FleetRowDto>): FleetRowDto {
  return {
    agentRunId: "run-1",
    projectId: "proj-1",
    projectName: "Alpha",
    projectKeyPrefix: "ALP",
    projectStatus: "active",
    subjectKind: "task",
    taskId: "task-1",
    taskKey: "ALP-1",
    taskTitle: "Wire the thing",
    taskStatus: "in_progress",
    epicId: null,
    epicKey: null,
    authoringStage: null,
    runStatus: "running",
    fleetState: "running",
    startedAt: new Date(Date.now() - 125_000).toISOString(),
    endedAt: null,
    blockedSince: null,
    costUsd: null,
    tokensIn: null,
    tokensOut: null,
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
        row({ agentRunId: "r-blocked", fleetState: "blocked", runStatus: "blocked" }),
        row({ agentRunId: "r-running", fleetState: "running" }),
        row({ agentRunId: "r-failed", fleetState: "failed", runStatus: "failed", endedAt: new Date().toISOString() }),
      ]),
    );
    renderFleet();
    await screen.findByText("NEEDS YOU");
    const headers = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(headers).toEqual(["NEEDS YOU", "RUNNING", "DONE / FAILED"]);
  });

  it("renders one word beside its mark for each of the six states plus awaiting review", async () => {
    const states = ["blocked", "awaiting_review", "abandoned", "running", "completed", "failed", "interrupted"] as const;
    fleetListMock.mockResolvedValue(
      list(
        states.map((state, i) =>
          row({
            agentRunId: `r-${state}`,
            taskKey: `ALP-${i + 1}`,
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

  it("puts interrupted under DONE / FAILED on the muted role, and abandoned under NEEDS YOU", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ agentRunId: "r-int", fleetState: "interrupted", runStatus: "interrupted", endedAt: new Date().toISOString() }),
        row({ agentRunId: "r-ab", fleetState: "abandoned", runStatus: "abandoned" }),
      ]),
    );
    renderFleet();
    await screen.findByText("NEEDS YOU");
    const interrupted = document.querySelector('[data-fleet-state="interrupted"]') as HTMLElement;
    const abandoned = document.querySelector('[data-fleet-state="abandoned"]') as HTMLElement;
    expect(interrupted.closest("[data-band]")?.getAttribute("data-band")).toBe("done-failed");
    expect(abandoned.closest("[data-band]")?.getAttribute("data-band")).toBe("needs-you");
    const doneBandHeader = interrupted.closest("section")?.querySelector("h2")?.textContent;
    expect(doneBandHeader).toBe("DONE / FAILED");
    const style = (within(interrupted).getByText("Interrupted") as HTMLElement).getAttribute("style") ?? "";
    expect(style).toContain("--text-muted-rack");
    expect(style).not.toContain("--destructive-text-rack");
  });

  it("shows the project as a column on every row and never groups by it", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ agentRunId: "a", projectName: "Alpha", startedAt: "2026-01-01T01:00:00Z" }),
        row({ agentRunId: "b", projectName: "Bravo", startedAt: "2026-01-01T02:00:00Z" }),
        row({ agentRunId: "c", projectName: "Alpha", startedAt: "2026-01-01T03:00:00Z" }),
      ]),
    );
    renderFleet();
    await screen.findByText("RUNNING");
    const projects = Array.from(document.querySelectorAll('[data-field="project"]')).map((e) => e.textContent);
    expect(projects).toEqual(["Alpha", "Bravo", "Alpha"]);
    // One band header only: no per-project grouping header was rendered.
    expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  });

  it("renders a run with no task as its own row with a subject", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ agentRunId: "plan", subjectKind: "epic", taskId: null, taskKey: null, taskTitle: null, epicId: "e1", epicKey: "ALP-E1" }),
        row({ agentRunId: "auth", subjectKind: "authoring", taskId: null, taskKey: null, taskTitle: null, authoringStage: "challenge" }),
        row({ agentRunId: "bare", subjectKind: "authoring", taskId: null, taskKey: null, taskTitle: null }),
      ]),
    );
    renderFleet();
    await screen.findByText("RUNNING");
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("ALP-E1")).toBeInTheDocument();
    expect(screen.getByText("Authoring · challenge")).toBeInTheDocument();
    expect(screen.getByText("Authoring")).toBeInTheDocument();
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
    expect(screen.getByText("1 agent · 1 need you")).toBeInTheDocument();
  });

  it("counts the agents and how many need the user", async () => {
    fleetListMock.mockResolvedValue(
      list([
        row({ agentRunId: "a", fleetState: "blocked", runStatus: "blocked" }),
        row({ agentRunId: "b", fleetState: "awaiting_review", runStatus: "completed" }),
        row({ agentRunId: "c", fleetState: "running" }),
      ]),
    );
    renderFleet();
    await waitFor(() => expect(screen.getByText("3 agents · 2 need you")).toBeInTheDocument());
  });
});

describe("the fleet opens under the session", () => {
  it("keeps the fleet open when a session is opened and then closed", () => {
    useUiStore.getState().setFleetSurface({ view: "fleet" });
    useUiStore.getState().setActiveAgentRunId("run-1", "task-1");
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    useUiStore.getState().setActiveAgentRunId(null);
    expect(useUiStore.getState().activeAgentRunId).toBeNull();
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
  });

  it("checks the session before the fleet, and the fleet before an unreachable project, in the surface precedence", () => {
    // Moved from a source-position grep of `App.tsx` to the resolver itself (plan 13-08).
    const none = {
      settingsOpen: false,
      triageOpen: false,
      reviewOpen: false,
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
    const item = (await screen.findAllByRole("listitem"))[0];
    expect(within(item).queryByText("Still going.")).toBeNull();
    expect(item.querySelector('[data-field="activity"]')?.textContent).toBe("");
  });
});

describe("the vocabulary", () => {
  it("maps awaiting review to the status channel's In Review mark and defines every mark id it names", () => {
    expect(RUN_STATUS_MARK_IDS.awaiting_review).toBe("status-in-review");
    for (const id of Object.values(RUN_STATUS_MARK_IDS)) {
      expect(MARKS_BY_ID[id], id).toBeDefined();
    }
  });
});

describe("one vocabulary across the fleet and the session surface", () => {
  it("renders an abandoned run's word from the same map on both surfaces", async () => {
    fleetListMock.mockResolvedValue(list([row({ agentRunId: "r-ab", fleetState: "abandoned", runStatus: "abandoned" })]));
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
        <SessionSurface agentRunId="r-ab" taskId="task-1" initialStatus="abandoned" onBack={() => {}} />
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
        <SessionSurface agentRunId="r-failed" taskId="task-1" initialStatus="failed" onBack={() => {}} />
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
    expect(await findByText("No agent is blocked")).toBeTruthy();
    expect(getByRole("button", { name: "Blocked 0" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(getByRole("button", { name: "All agents" }));
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    expect(await findByText("No agents running")).toBeTruthy();
    expect(await findByRole("button", { name: "Blocked 0" })).toHaveAttribute("aria-pressed", "false");
  });
});
