/**
 * Behavior under test (Phase 10 plan 10-06, FLEET-03, D-166):
 * - The subject key is a distinct secondary target with its own key (`b`): it switches to the row's
 *   project and hands the board a one-shot focus request, never also opens the session, and is absent
 *   on a row with no board subject. (The board that consumed the request was deleted by issue #38, so
 *   the end-to-end landing tests went with it.)
 * - Enter and a click on a fleet row open that run's session, handing the opener all four identifiers
 *   (run id, Story id, authoring stage, epic id) plus the row's mapped status, in one call (Finding 10,
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
import App from "../../App";
import { queryClient as appQueryClient } from "../../adapters/queryClient";
import { FleetSurface } from "../FleetSurface";

const fleetListMock = vi.fn<() => Promise<FleetListDto>>();
const invokeCommandMock = vi.fn();
const logWindowMock = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
    gitFacts: () => Promise.resolve(null),
    gitTruthFocusStory: () => Promise.resolve(),
    fleetList: () => fleetListMock(),
    fleetBlockedQueue: () => Promise.resolve([]),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    acknowledgeSession: () => Promise.resolve(),
    sessionAcknowledgeMany: () => Promise.resolve(),
    // The rest of what the real shell and a mounted session reach for (plan 11-15).
    fleetWatchRun: () => Promise.resolve(),
    subscribeMenuAction: () => Promise.resolve(() => {}),
    openFolderDialog: () => Promise.resolve(null),
    sessionLogWindow: (id: string, offset: number, limit: number) => logWindowMock(id, offset, limit),
    sessionRawWindow: (_id: string, offset: number, limit: number) => Promise.resolve({ entries: [], offset, limit, total: 0 }),
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
  const setActiveSessionId = vi.fn(original.setActiveSessionId);
  const setFleetSurface = vi.fn(original.setFleetSurface);
  const setCurrentProjectId = vi.fn(original.setCurrentProjectId);
  useUiStore.setState({ setActiveSessionId, setFleetSurface, setCurrentProjectId });
  return { setActiveSessionId, setFleetSurface, setCurrentProjectId };
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
  it("Enter on a selected row opens the session with its identifiers and the row's status", async () => {
    const spies = spyOnStore();
    await renderFleet([row({ sessionId: "run-t", storyId: "story-9" })]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(spies.setActiveSessionId).toHaveBeenCalledTimes(1);
    expect(spies.setActiveSessionId).toHaveBeenCalledWith("run-t", "story-9", null, "running");
  });

  it("a click on the row does the same thing as Enter", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ sessionId: "run-t", storyId: "story-9" })]);
    fireEvent.click(rowFor(container, "run-t"));
    expect(spies.setActiveSessionId).toHaveBeenCalledTimes(1);
    expect(spies.setActiveSessionId).toHaveBeenCalledWith("run-t", "story-9", null, "running");
  });

  it("a failed row hands the session its failed status, not the running default", async () => {
    const { container } = await renderFleet([
      row({ sessionId: "run-f", runStatus: "failed", fleetState: "failed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-f"));
    expect(useUiStore.getState().activeSessionId).toBe("run-f");
    expect(useUiStore.getState().activeSessionInitialStatus).toBe("failed");
  });

  it("an awaiting-review row opens as the completed run it is", async () => {
    const { container } = await renderFleet([
      row({ sessionId: "run-r", runStatus: "completed", fleetState: "awaiting_review", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-r"));
    expect(useUiStore.getState().activeSessionInitialStatus).toBe("completed");
  });

  it("Dismiss is its own action and never also opens the session", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ sessionId: "run-d", runStatus: "completed", fleetState: "completed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(within(rowFor(container, "run-d")).getByRole("button", { name: /Dismiss/ }));
    expect(spies.setActiveSessionId).not.toHaveBeenCalled();
  });

  it("opening a session leaves the fleet open, so popping the session lands on the fleet", async () => {
    const { container } = await renderFleet([row({ sessionId: "run-t" })]);
    fireEvent.click(rowFor(container, "run-t"));
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
    // The shell's order (`activeSurface`, plan 13-08): the session outranks the fleet...
    expect(
      activeSurface({
        settingsOpen: false,
        sessionOpen: true,
        fleetOpen: true,
        worktreeInventoryOpen: false,
        projectUnreachable: false,
      }),
    ).toBe("session");
    // ...so clearing the run, with the fleet field still set, leaves the fleet as the thing to render.
    act(() => useUiStore.getState().setActiveSessionId(null));
    const state = useUiStore.getState();
    expect(state.activeSessionId).toBeNull();
    expect(state.fleetSurface).not.toBeNull();
  });

  it("does nothing on Enter when no row is selected", async () => {
    const spies = spyOnStore();
    await renderFleet([row({ sessionId: "run-t" })]);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(spies.setActiveSessionId).not.toHaveBeenCalled();
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });
});


describe("the secondary target: the subject key reaches its board item", () => {
  it("activating it in another project switches the project and hands the board a focus request", async () => {
    useUiStore.setState({ currentProjectId: "proj-A" });
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ sessionId: "run-b", projectId: "proj-B", projectName: "Beta", storyId: "story-b7", storyKey: "BET-7" }),
    ]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    expect(spies.setCurrentProjectId).toHaveBeenCalledWith("proj-B");
    const state = useUiStore.getState();
    expect(state.currentProjectId).toBe("proj-B");
    expect(state.pendingFocusItemId).toBe("story-b7");
    expect(state.fleetSurface).toBeNull();
  });

  it("activating it does not also open the session", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([row({ sessionId: "run-b", storyId: "story-b7", storyKey: "BET-7" })]);
    fireEvent.click(within(rowFor(container, "run-b")).getByRole("button", { name: /Open BET-7 on the board/ }));
    expect(spies.setActiveSessionId).not.toHaveBeenCalled();
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("a row in an unreachable project exposes no target, because its board is not there to land on", async () => {
    const { container } = await renderFleet([row({ sessionId: "run-u", projectStatus: "unreachable" })]);
    expect(container.querySelector("[data-subject-target]")).toBeNull();
  });

  it("`b` reaches the selected row's item whatever its position, and never opens the session", async () => {
    const spies = spyOnStore();
    await renderFleet([
      row({ sessionId: "run-1", storyId: "story-1", storyKey: "ALP-1" }),
      row({ sessionId: "run-2", storyId: "story-2", storyKey: "ALP-2" }),
      row({ sessionId: "run-3", projectId: "proj-C", storyId: "story-3", storyKey: "CHA-3" }),
    ]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "b" });
    expect(useUiStore.getState().pendingFocusItemId).toBe("story-3");
    expect(useUiStore.getState().currentProjectId).toBe("proj-C");
    expect(spies.setActiveSessionId).not.toHaveBeenCalled();
  });

  it("two rows for the same Story each open their own run's session and both resolve the same item", async () => {
    const spies = spyOnStore();
    const { container } = await renderFleet([
      row({ sessionId: "run-x", storyId: "story-1", storyKey: "ALP-1", runStatus: "failed", fleetState: "failed" }),
      row({ sessionId: "run-y", storyId: "story-1", storyKey: "ALP-1", runStatus: "running", fleetState: "running" }),
    ]);
    fireEvent.click(rowFor(container, "run-x"));
    fireEvent.click(rowFor(container, "run-y"));
    expect(spies.setActiveSessionId.mock.calls.map((c) => c[0])).toEqual(["run-x", "run-y"]);
    for (const id of ["run-x", "run-y"]) {
      useUiStore.getState().setPendingFocusItemId(null);
      fireEvent.click(within(rowFor(container, id)).getByRole("button", { name: /Open ALP-1 on the board/ }));
      expect(useUiStore.getState().pendingFocusItemId).toBe("story-1");
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
const unhandled = new Set<string>();

function stubShellReads() {
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve([PROJECT_A, PROJECT_B]);
    // Fire-and-forget: the native menu's enabled-state sync (`state/menuSync.ts`). Nothing reads its answer.
    if (command === "menu_set_action_enabled") return Promise.resolve(undefined);
    unhandled.add(command);
    return Promise.resolve(undefined);
  });
}

const FEED_LINE = { type: "assistant_text", seq: 0, at: new Date().toISOString(), raw: "{}", text: "Reading the reconciliation module." };

/** The run in project B that every shell test starts from: live, with output on disk. */
const RUN_B = row({ sessionId: "run-b", projectId: "proj-B", projectName: "Beta", storyId: "story-b7", storyKey: "BET-7", storyTitle: "Beta seven" });

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
    expect(useUiStore.getState().activeSessionId).toBe("run-b");
    await waitFor(() => expect(logWindowMock).toHaveBeenCalled());
    expect(logWindowMock.mock.calls.every((call) => call[0] === "run-b"), "every log read names the row's own run").toBe(true);
    expect(await screen.findByText("Reading the reconciliation module.")).toBeInTheDocument();
  });

  it("a click on the row lands in the same place", async () => {
    const { container } = await mountShellOnFleet([RUN_B]);
    fireEvent.click(rowFor(container, "run-b"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(fleetRows().length).toBe(0);
    expect(useUiStore.getState().activeSessionId).toBe("run-b");
    expect(await screen.findByText("Reading the reconciliation module.")).toBeInTheDocument();
  });

  it("Back from the session returns to the fleet", async () => {
    const { container } = await mountShellOnFleet([RUN_B]);
    fireEvent.click(rowFor(container, "run-b"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());

    fireEvent.click(sessionBack() as HTMLElement);

    await waitFor(() => expect(fleetRows().length).toBe(1));
    expect(sessionBack(), "the session is gone").toBeNull();
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
  });

  // FINDING (plan 11-15, D-REV-51): the plan expects Back to land with "the same row focused". It does
  // not: the selection is local state in FleetSurface (`selectedRunId`), and the shell unmounts the whole
  // surface while the session is showing, so the row is unselected when the fleet returns. Held green as
  // an expected failure rather than asserted as correct; when the selection survives the round trip this
  // turns red, which is the cue to make it a plain `it`. Logged in deferred-items.md.
  it.fails("Back from the session returns to the fleet with the same row selected", async () => {
    const { container } = await mountShellOnFleet([RUN_B, row({ sessionId: "run-other", storyId: "story-o", storyKey: "ALP-2" })]);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    fireEvent.click(sessionBack() as HTMLElement);
    await waitFor(() => expect(fleetRows().length).toBe(2));
    const selected = container.querySelector("[data-selected='true']") as HTMLElement | null;
    expect(selected?.dataset.runId).toBe(useUiStore.getState().activeSessionId ?? "run-other");
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
      row({ sessionId: "run-f", projectId: "proj-B", runStatus: "failed", fleetState: "failed", endedAt: new Date().toISOString() }),
    ]);
    fireEvent.click(rowFor(container, "run-f"));
    await waitFor(() => expect(sessionBack()).not.toBeNull());
    expect(await screen.findByText(/This run has ended/)).toBeInTheDocument();
    expect(screen.queryByText("Starting session\u2026")).toBeNull();
  });
});
