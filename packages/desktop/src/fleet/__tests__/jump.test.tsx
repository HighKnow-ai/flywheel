/**
 * Behavior under test (Phase 10 plan 10-06, FLEET-03, D-166):
 * - The subject key is a distinct secondary target with its own key (`b`): it switches to the row's
 *   project and hands the board a one-shot focus request, never also opens the session, and is absent
 *   on a row with no board subject. A jump into another project lands on the item, end to end.
 * - Enter and a click on a fleet row open that run's session, handing the opener all four identifiers
 *   (run id, task id, authoring stage, epic id) plus the row's mapped status, in one call (Finding 10,
 *   Pitfall 7).
 * - The fleet surface never clears itself before opening a session, so the session's own back action
 *   lands on the fleet (RESEARCH Pattern 4).
 *
 * Plan 11-15 (D-REV-51) adds the last describe block below: the same jumps, but mounted through the REAL
 * AppShell (rendered by `<App />`, its only export) over a stubbed adapter, so the assertion is about where
 * you LAND, which is `App.tsx`'s surface switch, not about what the row called. A component test of the
 * origin proves nothing about the destination (the D-REV-43 lesson).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FleetListDto, FleetRowDto } from "../../adapters/tauri";
import { activeSurface } from "../../state/keyboard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import appSource from "../../App.tsx?raw";
import App from "../../App";
import { queryClient as appQueryClient } from "../../adapters/queryClient";
import { FleetSurface } from "../FleetSurface";
import { BoardView } from "../../board/BoardView";
import { showStatusBands } from "../../board/__tests__/lens";
import type { BoardItem } from "../../board/useBoardQuery";

const fleetListMock = vi.fn<() => Promise<FleetListDto>>();
const invokeCommandMock = vi.fn();
const logWindowMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
    gitFacts: () => Promise.resolve(null),
    gitTruthFocusTask: () => Promise.resolve(),
    fleetList: () => fleetListMock(),
    fleetBlockedQueue: () => Promise.resolve([]),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    acknowledgeAgentRun: () => Promise.resolve(),
    agentRunAcknowledgeMany: () => Promise.resolve(),
    // The rest of what the real shell and a mounted session reach for (plan 11-15).
    fleetWatchRun: () => Promise.resolve(),
    subscribeMenuAction: () => Promise.resolve(() => {}),
    openFolderDialog: () => Promise.resolve(null),
    agentRunLogWindow: (id: string, offset: number, limit: number) => logWindowMock(id, offset, limit),
    agentRunRawWindow: (_id: string, offset: number, limit: number) => Promise.resolve({ entries: [], offset, limit, total: 0 }),
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

/** The real setters, wrapped so a test can assert what the surface called and with what. */
function spyOnStore() {
  const original = useUiStore.getState();
  const setActiveAgentRunId = vi.fn(original.setActiveAgentRunId);
  const setFleetSurface = vi.fn(original.setFleetSurface);
  const setCurrentProjectId = vi.fn(original.setCurrentProjectId);
  useUiStore.setState({ setActiveAgentRunId, setFleetSurface, setCurrentProjectId });
  return { setActiveAgentRunId, setFleetSurface, setCurrentProjectId };
}

async function renderFleet(rows: FleetRowDto[]) {
  fleetListMock.mockResolvedValue(list(rows));
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <FleetSurface onClose={() => {}} />
    </QueryClientProvider>,
  );
  await waitFor(() => expect(view.container.querySelector("[data-run-id]")).not.toBeNull());
  return view;
}

function rowFor(container: HTMLElement, runId: string): HTMLElement {
  const el = container.querySelector<HTMLElement>(`[data-run-id="${runId}"]`);
  if (!el) throw new Error(`no row for ${runId}`);
  return el;
}

beforeEach(() => {
  resetUiState();
  fleetListMock.mockReset();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) =>
    Promise.resolve(command === "actor_list" || command === "project_list" ? [] : undefined),
  );
  useUiStore.setState({ fleetSurface: { view: "fleet" } });
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe("the primary target: a row opens that run's session", () => {
  it("Enter on a selected task row opens the session with all four identifiers and the row's status", async () => {
    const spies = spyOnStore();
    await renderFleet([row({ agentRunId: "run-t", taskId: "task-9", epicId: null, authoringStage: null })]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(spies.setActiveAgentRunId).toHaveBeenCalledTimes(1);
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-t", "task-9", null, null, null, "running");
  });

  it("a click on the row does the same thing as Enter", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ agentRunId: "run-t", taskId: "task-9" })]);
    fireEvent.click(rowFor(container, "run-t"));
    expect(spies.setActiveAgentRunId).toHaveBeenCalledTimes(1);
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-t", "task-9", null, null, null, "running");
  });

  it("an epic-subject authoring row carries the epic id and the stage, with a null task id", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({
        agentRunId: "run-a",
        subjectKind: "authoring",
        taskId: null,
        taskKey: null,
        taskTitle: null,
        taskStatus: null,
        epicId: "epic-3",
        epicKey: "ALP-E3",
        authoringStage: "challenge",
      }),
    ]);
    fireEvent.click(rowFor(container, "run-a"));
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-a", null, "challenge", "epic-3", null, "running");
  });

  it("a row with neither task nor epic opens its session with nulls and does not throw", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({
        agentRunId: "run-n",
        subjectKind: "authoring",
        taskId: null,
        taskKey: null,
        taskTitle: null,
        taskStatus: null,
        epicId: null,
        epicKey: null,
        authoringStage: null,
      }),
    ]);
    expect(() => fireEvent.click(rowFor(container, "run-n"))).not.toThrow();
    expect(spies.setActiveAgentRunId).toHaveBeenCalledWith("run-n", null, null, null, null, "running");
  });

  it("a failed row hands the session its failed status, not the running default", async () => {
    const { container } = await renderFleet([
      row({ agentRunId: "run-f", runStatus: "failed", fleetState: "failed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-f"));
    expect(useUiStore.getState().activeAgentRunId).toBe("run-f");
    expect(useUiStore.getState().activeAgentRunInitialStatus).toBe("failed");
    // The shell reads that field and passes it down; without this the status is dropped on the way.
    expect(appSource).toMatch(/initialStatus=\{activeAgentRunInitialStatus\}/);
  });

  it("an awaiting-review row opens as the completed run it is", async () => {
    const { container } = await renderFleet([
      row({ agentRunId: "run-r", runStatus: "completed", fleetState: "awaiting_review", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-r"));
    expect(useUiStore.getState().activeAgentRunInitialStatus).toBe("completed");
  });

  it("Dismiss is its own action and never also opens the session", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ agentRunId: "run-d", runStatus: "completed", fleetState: "completed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(within(rowFor(container, "run-d")).getByRole("button", { name: /Dismiss/ }));
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
  });

  it("opening a session leaves the fleet open, so popping the session lands on the fleet", async () => {
    const { container } = await renderFleet([row({ agentRunId: "run-t" })]);
    fireEvent.click(rowFor(container, "run-t"));
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    // The shell's order (`activeSurface`, plan 13-08): the session outranks the fleet...
    expect(
      activeSurface({
        settingsOpen: false,
        triageOpen: false,
        reviewOpen: false,
        sessionOpen: true,
        fleetOpen: true,
        worktreeInventoryOpen: false,
        projectUnreachable: false,
      }),
    ).toBe("session");
    // ...so clearing the run, with the fleet field still set, leaves the fleet as the thing to render.
    act(() => useUiStore.getState().setActiveAgentRunId(null));
    const state = useUiStore.getState();
    expect(state.activeAgentRunId).toBeNull();
    expect(state.fleetSurface).not.toBeNull();
  });

  it("does nothing on Enter when no row is selected", async () => {
    const spies = spyOnStore();
    await renderFleet([row({ agentRunId: "run-t" })]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});

const NO_SUBJECT = {
  subjectKind: "authoring" as const,
  taskId: null,
  taskKey: null,
  taskTitle: null,
  taskStatus: null,
  epicId: null,
  epicKey: null,
  authoringStage: null,
};

describe("the secondary target: the subject key reaches its board item", () => {
  it("activating it in another project switches the project and hands the board a focus request", async () => {
    useUiStore.setState({ currentProjectId: "proj-A" });
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ agentRunId: "run-b", projectId: "proj-B", projectName: "Beta", taskId: "task-b7", taskKey: "BET-7" }),
    ]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    expect(spies.setCurrentProjectId).toHaveBeenCalledWith("proj-B");
    const state = useUiStore.getState();
    expect(state.currentProjectId).toBe("proj-B");
    expect(state.pendingFocusItemId).toBe("task-b7");
    expect(state.fleetSurface).toBeNull();
  });

  it("activating it does not also open the session", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ agentRunId: "run-b", taskId: "task-b7", taskKey: "BET-7" })]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeAgentRunId).toBeNull();
  });

  it("end to end: a row in project B, activated while A is current, lands on that item's detail", async () => {
    useUiStore.setState({ currentProjectId: "proj-A", selectedItemId: "a-1", detailItemId: "a-1" });
    const { container, unmount } = await renderFleet([
      row({ agentRunId: "run-b", projectId: "proj-B", projectName: "Beta", taskId: "task-b7", taskKey: "BET-7" }),
    ]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    unmount();

    // The shell now renders the board for the current project; the request is still waiting for it.
    const projectId = useUiStore.getState().currentProjectId as string;
    expect(projectId).toBe("proj-B");
    showStatusBands();
    const items: BoardItem[] = [
      { id: "task-b7", key: "BET-7", title: "Beta seven", status: "backlog", rank: "10", priority: 0, epicId: null },
    ];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BoardView
          projectId={projectId}
          items={items}
          counts={{ backlog: 1, todo: 0, inProgress: 0, inReview: 0, done: 0 }}
          onCreateTask={() => {}}
        />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("task-b7"));
    expect(useUiStore.getState().selectedItemId).toBe("task-b7");
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("an epic-subject row targets the epic, and opens the epic's detail rather than a review", async () => {
    const { container } = await renderFleet([
      row({
        agentRunId: "run-e",
        subjectKind: "epic",
        taskId: null,
        taskKey: null,
        taskTitle: null,
        taskStatus: null,
        epicId: "epic-4",
        epicKey: "ALP-E4",
      }),
    ]);
    fireEvent.click(within(rowFor(container, "run-e")).getByRole("button", { name: /Open ALP-E4 on the board/ }));
    expect(useUiStore.getState().pendingFocusItemId).toBe("epic-4");
    expect(useUiStore.getState().reviewSurface).toBeNull();
  });

  it("a row with no task and no epic renders no target element at all, and `b` does nothing on it", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ agentRunId: "run-n", ...NO_SUBJECT })]);
    expect(container.querySelector("[data-subject-target]")).toBeNull();
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "b" });
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
    expect(spies.setCurrentProjectId).not.toHaveBeenCalled();
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    // The session is still reachable from it.
    fireEvent.click(rowFor(container, "run-n"));
    expect(spies.setActiveAgentRunId).toHaveBeenCalledTimes(1);
  });

  it("a row in an unreachable project exposes no target, because its board is not there to land on", async () => {
    const { container } = await renderFleet([row({ agentRunId: "run-u", projectStatus: "unreachable" })]);
    expect(container.querySelector("[data-subject-target]")).toBeNull();
  });

  it("`b` reaches the selected row's item whatever its position, and never opens the session", async () => {
    const spies = spyOnStore();
    await renderFleet([
      row({ agentRunId: "run-1", taskId: "task-1", taskKey: "ALP-1" }),
      row({ agentRunId: "run-2", taskId: "task-2", taskKey: "ALP-2" }),
      row({ agentRunId: "run-3", projectId: "proj-C", taskId: "task-3", taskKey: "CHA-3" }),
    ]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "b" });
    expect(useUiStore.getState().pendingFocusItemId).toBe("task-3");
    expect(useUiStore.getState().currentProjectId).toBe("proj-C");
    expect(spies.setActiveAgentRunId).not.toHaveBeenCalled();
  });

  it("two rows for the same task each open their own run's session and both resolve the same item", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ agentRunId: "run-x", taskId: "task-1", taskKey: "ALP-1", runStatus: "failed", fleetState: "failed" }),
      row({ agentRunId: "run-y", taskId: "task-1", taskKey: "ALP-1", runStatus: "running", fleetState: "running" }),
    ]);
    fireEvent.click(rowFor(container, "run-x"));
    fireEvent.click(rowFor(container, "run-y"));
    expect(spies.setActiveAgentRunId.mock.calls.map((c) => c[0])).toEqual(["run-x", "run-y"]);
    for (const id of ["run-x", "run-y"]) {
      useUiStore.getState().setPendingFocusItemId(null);
      fireEvent.click(within(rowFor(container, id)).getByRole("button", { name: /Open ALP-1 on the board/ }));
      expect(useUiStore.getState().pendingFocusItemId).toBe("task-1");
    }
  });
});

// ---------------------------------------------------------------------------------------------
// D-REV-51 (plan 11-15): where a fleet row takes you, asserted at the AppShell.
//
// `<App />` renders AppShell with the real project rail, the real board for the current project, the real
// item detail panel and the real session surface. Only the adapter is stubbed: `invokeCommand` answers the
// project and board reads, `fleetList` serves the rows, and the session's log window serves the run's feed.
// What this does NOT cover: the Tauri IPC behind those reads, a project whose epic roster loads slowly, and
// how the key-as-button reads at row density in a WKWebView (no WebDriver) - those stay in the register.
// ---------------------------------------------------------------------------------------------

const PROJECT_A = { id: "proj-A", keyPrefix: "ALP", name: "Alpha", repoPath: "/repo/alpha", defaultBranch: "main", status: "active" };
const PROJECT_B = { id: "proj-B", keyPrefix: "BET", name: "Beta", repoPath: "/repo/beta", defaultBranch: "main", status: "active" };
const BOARDS: Record<string, BoardItem[]> = {
  "proj-A": [{ id: "task-a1", key: "ALP-1", title: "Alpha one", status: "backlog", rank: "10", priority: 0, epicId: null }],
  "proj-B": [{ id: "task-b7", key: "BET-7", title: "Beta seven", status: "backlog", rank: "10", priority: 0, epicId: null }],
};
const unhandled = new Set<string>();
/** Per-project delay for the board read, so a slow roster can be modelled. */
const boardDelayMs: Record<string, number> = {};

function stubShellReads() {
  invokeCommandMock.mockImplementation((command: string, args?: Record<string, unknown>) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve([PROJECT_A, PROJECT_B]);
    if (command === "board_list" || command === "board_search") {
      const projectId = (args?.projectId as string) ?? "";
      const items = BOARDS[projectId] ?? [];
      const window = { items, issues: [], counts: { backlog: items.length, todo: 0, inProgress: 0, inReview: 0, done: 0 } };
      const delay = boardDelayMs[projectId] ?? 0;
      return delay > 0 ? new Promise((resolve) => setTimeout(() => resolve(window), delay)) : Promise.resolve(window);
    }
    // Fire-and-forget: the native menu's enabled-state sync (`state/menuSync.ts`). Nothing reads its answer.
    if (command === "menu_set_action_enabled") return Promise.resolve(undefined);
    unhandled.add(command);
    return Promise.resolve(undefined);
  });
}

const FEED_LINE = { type: "assistant_text", seq: 0, at: new Date().toISOString(), raw: "{}", text: "Reading the reconciliation module." };

/** The run in project B that every shell test starts from: live, with output on disk. */
const RUN_B = row({ agentRunId: "run-b", projectId: "proj-B", projectName: "Beta", taskId: "task-b7", taskKey: "BET-7", taskTitle: "Beta seven" });

async function mountShellOnFleet(rows: FleetRowDto[], currentProjectId = "proj-A") {
  useUiStore.setState({ currentProjectId, fleetSurface: { view: "fleet" } });
  fleetListMock.mockResolvedValue(list(rows));
  const view = render(<App />);
  await waitFor(() => expect(view.container.querySelector("[data-run-id]")).not.toBeNull());
  return view;
}

const sessionBack = () => document.querySelector<HTMLElement>(".session-back");
const fleetRows = () => document.querySelectorAll("[data-run-id]");

describe("AppShell: where a fleet row takes you", () => {
  beforeEach(() => {
    appQueryClient.clear();
    unhandled.clear();
    for (const key of Object.keys(boardDelayMs)) delete boardDelayMs[key];
    logWindowMock.mockReset();
    logWindowMock.mockImplementation((_id: string, offset: number, limit: number) =>
      Promise.resolve({ entries: [FEED_LINE], offset, limit, total: 1 }),
    );
    stubShellReads();
  });

  it("Enter on a selected row replaces the fleet with that run's session, reading that run's log", async () => {
    await mountShellOnFleet([RUN_B]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(fleetRows().length, "the fleet gave way to the session").toBe(0);
    expect(useUiStore.getState().activeAgentRunId).toBe("run-b");
    await waitFor(() => expect(logWindowMock).toHaveBeenCalled());
    expect(logWindowMock.mock.calls.every((call) => call[0] === "run-b"), "every log read names the row's own run").toBe(true);
    expect(await screen.findByText("Reading the reconciliation module.")).toBeInTheDocument();
  });

  it("a click on the row lands in the same place", async () => {
    const { container } = await mountShellOnFleet([RUN_B]);
    fireEvent.click(rowFor(container, "run-b"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(fleetRows().length).toBe(0);
    expect(useUiStore.getState().activeAgentRunId).toBe("run-b");
    expect(await screen.findByText("Reading the reconciliation module.")).toBeInTheDocument();
  });

  it("Back from the session returns to the fleet", async () => {
    const { container } = await mountShellOnFleet([RUN_B]);
    fireEvent.click(rowFor(container, "run-b"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());

    fireEvent.click(sessionBack() as HTMLElement);

    await waitFor(() => expect(fleetRows().length).toBe(1));
    expect(sessionBack(), "the session is gone").toBeNull();
    expect(useUiStore.getState().activeAgentRunId).toBeNull();
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
  });

  // FINDING (plan 11-15, D-REV-51): the plan expects Back to land with "the same row focused". It does
  // not: the selection is local state in FleetSurface (`selectedRunId`), and the shell unmounts the whole
  // surface while the session is showing, so the row is unselected when the fleet returns. Held green as
  // an expected failure rather than asserted as correct; when the selection survives the round trip this
  // turns red, which is the cue to make it a plain `it`. Logged in deferred-items.md.
  it.fails("Back from the session returns to the fleet with the same row selected", async () => {
    const { container } = await mountShellOnFleet([RUN_B, row({ agentRunId: "run-other", taskId: "task-o", taskKey: "ALP-2" })]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    fireEvent.click(sessionBack() as HTMLElement);
    await waitFor(() => expect(fleetRows().length).toBe(2));
    const selected = container.querySelector("[data-selected='true']") as HTMLElement | null;
    expect(selected?.dataset.runId).toBe(useUiStore.getState().activeAgentRunId ?? "run-other");
  });

  it("the subject key on a row in another project lands on that item's detail panel, in that project", async () => {
    await mountShellOnFleet([RUN_B], "proj-A");
    expect(useUiStore.getState().currentProjectId).toBe("proj-A");

    fireEvent.click(await screen.findByRole("button", { name: /Open BET-7 on the board/ }));

    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("task-b7"));
    expect(fleetRows().length, "the fleet gave way to the board").toBe(0);
    expect(useUiStore.getState().currentProjectId, "the project switched, not only the surface").toBe("proj-B");
    expect(useUiStore.getState().pendingFocusItemId, "the one-shot request was consumed").toBeNull();
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent, "the panel is about BET-7, not a stale item from project A").toContain("BET-7");
    expect(screen.getByText("Beta", { selector: ".board-header" }), "the board on screen is B's").toBeInTheDocument();
    expect(document.querySelector("[data-run-id]")).toBeNull();
    // The panel's own secondary reads (criterion_list, epic_list_all, events_activity_trail,
    // review_criteria_state) get `undefined` from this stub and are not asserted here: this test is about
    // WHICH item and WHICH project the jump lands on, not about what the panel goes on to show.
  });

  // The register's "a project whose roster loads slowly": while B's board is still loading, the shell keeps
  // A's rows on screen (keepPreviousData). The jump must not be judged against them, and must still land
  // once B's items arrive.
  it("a jump into a project whose board loads slowly waits for it and then lands on the item", async () => {
    boardDelayMs["proj-B"] = 600;
    await mountShellOnFleet([RUN_B], "proj-A");
    fireEvent.click(await screen.findByRole("button", { name: /Open BET-7 on the board/ }));
    await waitFor(() => expect(useUiStore.getState().currentProjectId).toBe("proj-B"));
    expect(useUiStore.getState().detailItemId, "B's board has not arrived, so nothing is open yet").toBeNull();
    expect(useUiStore.getState().pendingFocusItemId, "the request is held, not dropped").toBe("task-b7");

    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("task-b7"), { timeout: 3000 });
    expect(useUiStore.getState().pendingFocusItemId).toBeNull();
    expect((await screen.findByRole("dialog")).textContent).toContain("BET-7");
  });

  it("the key `b` does the same from the keyboard, and never opens the session", async () => {
    await mountShellOnFleet([RUN_B], "proj-A");
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "b" });
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("task-b7"));
    expect(useUiStore.getState().currentProjectId).toBe("proj-B");
    expect(useUiStore.getState().activeAgentRunId).toBeNull();
    expect(sessionBack()).toBeNull();
  });

  it("a subject in the project already showing lands on its detail without switching project", async () => {
    await mountShellOnFleet([row({ agentRunId: "run-a", projectId: "proj-A", projectName: "Alpha", taskId: "task-a1", taskKey: "ALP-1" })], "proj-A");
    fireEvent.click(await screen.findByRole("button", { name: /Open ALP-1 on the board/ }));
    await waitFor(() => expect(useUiStore.getState().detailItemId).toBe("task-a1"));
    expect(useUiStore.getState().currentProjectId).toBe("proj-A");
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("opening a session from the fleet reaches for no command the stub does not know about", async () => {
    // A stubbed command answering `undefined` could hide a real read the shell makes; list them so a
    // new one is a conscious addition to the stub, not a silent hole.
    const { container } = await mountShellOnFleet([RUN_B]);
    fireEvent.click(rowFor(container, "run-b"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect([...unhandled].sort()).toEqual([]);
  });

  const noLog = () =>
    logWindowMock.mockImplementation((_id: string, offset: number, limit: number) =>
      Promise.resolve({ entries: [], offset, limit, total: 0 }),
    );

  it("a live run with nothing on disk yet opens a session that says it is starting", async () => {
    noLog();
    const { container } = await mountShellOnFleet([RUN_B]);
    fireEvent.click(rowFor(container, "run-b"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(await screen.findByText("Starting session\u2026")).toBeInTheDocument();
  });

  // FINDING (plan 11-15, D-REV-51): a FINISHED run whose log is empty (a run that failed before writing
  // a line, or whose log was removed) opens a session that reads "Starting session..." above "This run
  // has ended. Nothing more will be added to this transcript." The fleet row is a plain jump with no
  // output check, and the session's empty-feed row does not look at the run's status. Pre-existing and in
  // SessionSurface, which this plan does not edit; held as an expected failure, not asserted as correct,
  // and logged in deferred-items.md. When it is fixed this turns red: make it a plain `it`.
  it.fails("a finished run with no output opens a session that does not claim to be starting", async () => {
    noLog();
    const { container } = await mountShellOnFleet([
      row({ agentRunId: "run-f", projectId: "proj-B", runStatus: "failed", fleetState: "failed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-f"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(await screen.findByText(/This run has ended/)).toBeInTheDocument();
    expect(screen.queryByText("Starting session\u2026")).toBeNull();
  });
});
