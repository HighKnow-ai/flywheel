/**
 * Behavior under test (01-11-PLAN.md Task 3):
 * - `ProjectRail` renders nothing with zero projects, and the switcher chrome with one.
 * - An unreachable rail entry renders both a warning glyph and the literal word "Unreachable" —
 *   never a colour change alone (01-UI-SPEC.md "Accessibility").
 * - `⌘3` switches the open board to the third registered project (01-UI-SPEC.md "Project
 *   switcher (left rail)").
 * - "Remove from Flywheel…" (D-200) asks first, naming the board, worktrees, runs and trail as
 *   kept; calls `project_hide` exactly once and only after the confirmation; a hidden project is
 *   absent from the rail; and the rail selects another project afterwards.
 * - `ProjectUnreachable` offers exactly one action, and nothing that tries again on its own,
 *   searches the disk, or fixes the mismatch without the user's explicit choice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "../../App";
import { ProjectRail } from "../ProjectRail";
import { ProjectUnreachable } from "../ProjectUnreachable";
import type { Project } from "../../board/useBoardQuery";
import type { FleetListDto, FleetRowDto } from "../../adapters/tauri";
import { resetUiState, useUiStore } from "../../state/uiStore";

const invokeCommandMock = vi.fn();
const fleetBlockedQueueMock = vi.fn(() => Promise.resolve<unknown[]>([]));
const fleetListMock = vi.fn(() => Promise.resolve<FleetListDto>({ rows: [], totalRows: 0, visibleCostUsd: null }));

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  fleetBlockedQueue: () => fleetBlockedQueueMock(),
  fleetList: () => fleetListMock(),
  fleetWatchRun: () => Promise.resolve(),
  boardRecoverySummary: (projectId: string) => invokeCommandMock("board_recovery_summary", { projectId }),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  projectHide: (projectId: string) => invokeCommandMock("project_hide", { projectId }),
}));

function project(overrides: Partial<Project>): Project {
  return {
    id: "proj-1",
    keyPrefix: "FLY",
    name: "Flywheel",
    repoPath: "/repo",
    defaultBranch: "main",
    status: "active",
    ...overrides,
  };
}

function renderWithClient(node: React.ReactElement) {
  const queryClient = new QueryClient();
  return render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  fleetBlockedQueueMock.mockReset();
  fleetBlockedQueueMock.mockResolvedValue([]);
  fleetListMock.mockReset();
  fleetListMock.mockResolvedValue({ rows: [], totalRows: 0, visibleCostUsd: null });
});

afterEach(() => {
  resetUiState();
  cleanup();
});

describe("ProjectRail", () => {
  it("renders nothing with zero projects", () => {
    renderWithClient(<ProjectRail projects={[]} currentProjectId={undefined} onSelect={() => {}} />);
    expect(screen.queryByRole("navigation", { name: "Projects" })).not.toBeInTheDocument();
  });

  it("renders the switcher chrome once at least one project is registered", () => {
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    expect(screen.getByRole("navigation", { name: "Projects" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Flywheel" })).toBeInTheDocument();
  });

  it("renders an unreachable entry with a warning glyph and the literal word Unreachable", () => {
    renderWithClient(
      <ProjectRail
        projects={[project({ id: "proj-2", name: "Threadfin", keyPrefix: "THF", status: "unreachable" })]}
        currentProjectId="proj-2"
        onSelect={() => {}}
      />,
    );

    const entry = screen.getByRole("button", { name: "Threadfin, Unreachable" });
    // The visible label may carry an invisible soft hyphen (U+00AD) at the syllable boundary so
    // the ~60px rail column wraps it cleanly instead of breaking the word mid-character
    // (`ProjectRail.tsx`'s own comment on the choice) — strip it before the exact-text match so
    // this assertion still reads the DOM as showing the literal word, exactly as a sighted user
    // sees it and exactly as the button's own `aria-label` (asserted above) already states it.
    const unreachableLabel = within(entry).getByText(
      (content) => content.replace(/\u00AD/gi, "") === "Unreachable",
    );
    expect(unreachableLabel).toBeInTheDocument();
    // The warning glyph is an `aria-hidden` icon — its presence is asserted via the accessible
    // name above (which only reads "Unreachable" because of it) plus a real SVG in the DOM,
    // never a colour change alone (01-UI-SPEC.md "Accessibility").
    expect(entry.querySelector("svg")).not.toBeNull();
  });
});

describe("ProjectRail's Fleet entry point (Phase 10, D-163)", () => {
  it("renders the Fleet row as a button that opens the fleet surface", () => {
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    const fleetGroup = screen.getByRole("group", { name: "Fleet" });
    const row = within(fleetGroup).getByRole("button", { name: "Open fleet" });
    expect(row.tagName).toBe("BUTTON");
    expect(useUiStore.getState().fleetSurface).toBeNull();
    fireEvent.click(row);
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
  });
});

describe("ProjectRail's Worktrees entry point (Phase 10 plan 10-08, WORK-07)", () => {
  it("renders the Worktrees row as a button that opens the inventory", () => {
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    const fleetGroup = screen.getByRole("group", { name: "Fleet" });
    const row = within(fleetGroup).getByRole("button", { name: "Open worktree inventory" });
    expect(row.tagName).toBe("BUTTON");
    expect(useUiStore.getState().worktreeInventoryOpen).toBe(false);
    fireEvent.click(row);
    expect(useUiStore.getState().worktreeInventoryOpen).toBe(true);
  });
});

describe("ProjectRail's Waiting on you row (#57, docs/mvp-spec.md §4.1)", () => {
  it("puts Waiting on you at the top of the sidebar, above the projects, as a button that opens the queue", () => {
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    const groups = screen.getAllByRole("group").map((g) => g.getAttribute("aria-labelledby"));
    expect(groups[0]).toBe("rail-waiting");
    const group = screen.getByRole("group", { name: "Waiting on you" });
    const row = within(group).getByRole("button", { name: "Open Waiting on you" });
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "queue" });
  });

  it("never words it Blocked", () => {
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("counts waiting requests across every project, not just the current project's share", async () => {
    // Two waiting requests in project A, one in project B; the current project is A.
    fleetBlockedQueueMock.mockResolvedValue([
      { requestId: "r1", projectId: "proj-1" },
      { requestId: "r2", projectId: "proj-1" },
      { requestId: "r3", projectId: "proj-2" },
    ]);
    renderWithClient(
      <ProjectRail
        projects={[project({}), project({ id: "proj-2", name: "Other", keyPrefix: "OTH" })]}
        currentProjectId="proj-1"
        onSelect={() => {}}
      />,
    );
    const row = await screen.findByRole("button", { name: "Open Waiting on you, 3 waiting" });
    expect(row.querySelector('[data-count="waiting"]')).toHaveTextContent("3");
  });

  it("shows no figure at all when nothing is waiting", async () => {
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    await waitFor(() => expect(fleetBlockedQueueMock).toHaveBeenCalled());
    expect(document.querySelector('[data-count="waiting"]')).toBeNull();
  });

  it("keeps the waiting count and the needs-decision count as separate figures, and Needs decision opens the fleet list", async () => {
    invokeCommandMock.mockImplementation((command: string) =>
      command === "board_recovery_summary"
        ? Promise.resolve({ recoveryTaskIds: [], recoveryCount: 4 })
        : Promise.resolve(undefined),
    );
    fleetBlockedQueueMock.mockResolvedValue([{ requestId: "r1" }, { requestId: "r2" }]);
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    const waiting = await screen.findByRole("button", { name: /Open Waiting on you/ });
    const decision = await screen.findByRole("button", { name: "Open decisions" });
    expect(waiting.querySelector('[data-count="waiting"]')).toHaveTextContent("2");
    expect(decision.querySelector('[data-count="needs-decision"]')).toHaveTextContent("4");
    expect(screen.queryByText("6")).not.toBeInTheDocument();
    fireEvent.click(decision);
    expect(useUiStore.getState().fleetSurface).toEqual({ view: "fleet" });
  });
});

describe("ProjectRail's own proposal-badge absence (plan 05-09, D-46/D-82)", () => {
  // D-46's rule is that only money-burning work blocks; a pending authoring proposal burns
  // nothing (the session that staged it may already have ended). D-82 already answered where
  // "waiting on me at all" surfaces instead: the board-level triage lane and the epic-row count,
  // never this rail. A source-scanning gate (mirroring this codebase's own established idiom for
  // "a property that must never quietly return") is the structural companion to that reading —
  // it fails the moment a future edit wires a third badge here, whether or not any behavioral
  // test happens to render it yet.
  it("contains no proposal-badge source at all — the rail renders blocked/recovery counts only", () => {
    const source = ProjectRail.toString();
    expect(source.toLowerCase()).not.toContain("proposal");
  });
});

describe("ProjectUnreachable", () => {
  it("offers exactly one action and no automatic-recovery affordance", () => {
    renderWithClient(
      <ProjectUnreachable
        project={project({ id: "proj-3", name: "Orphaned Repo", repoPath: "/Users/dev/orphaned-repo" })}
      />,
    );

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent("Locate Project…");
    expect(screen.getByText(/Orphaned Repo/)).toBeInTheDocument();
    expect(screen.getByText(/\/Users\/dev\/orphaned-repo/)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was scanned or guessed automatically/)).toBeInTheDocument();
  });
});

describe("project switching via the keyboard (⌘1-⌘9)", () => {
  it("⌘3 switches the open board to the third registered project", async () => {
    const projects: Project[] = [
      project({ id: "p1", name: "Alpha", keyPrefix: "ALP" }),
      project({ id: "p2", name: "Bravo", keyPrefix: "BRV" }),
      project({ id: "p3", name: "Charlie", keyPrefix: "CHR" }),
    ];

    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "project_list") return Promise.resolve(projects);
      if (command === "actor_list") return Promise.resolve([]);
      if (command === "board_list") {
        return Promise.resolve({
          items: [],
          issues: [],
          counts: { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 },
        });
      }
      return Promise.resolve(undefined);
    });

    render(<App />);

    // Defaults to the first registered project.
    await screen.findAllByText("Alpha");

    fireEvent.keyDown(window, { key: "3", metaKey: true });

    // The rail now names every project, so the open board is read from the current-position mark.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Charlie" })).toHaveAttribute("aria-current", "true"),
    );
    expect(screen.getByRole("button", { name: "Alpha" })).not.toHaveAttribute("aria-current");
  });
});

describe("ProjectRail's Remove from Flywheel (D-200, closes D-REV-29)", () => {
  const alpha = project({ id: "p1", name: "Alpha", keyPrefix: "ALP" });
  const dupe = project({ id: "p2", name: "Alpha", keyPrefix: "ALP", status: "unreachable" });

  function openConfirmation() {
    fireEvent.click(screen.getByRole("button", { name: "Remove from Flywheel…" }));
  }

  it("asks first, naming what is kept, and calls project_hide only after the confirmation", async () => {
    invokeCommandMock.mockResolvedValue(undefined);
    const onSelect = vi.fn();
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={onSelect} />);

    openConfirmation();
    expect(invokeCommandMock).not.toHaveBeenCalledWith("project_hide", expect.anything());
    const confirmation = screen.getByRole("group", { name: "Remove Alpha from Flywheel" });
    for (const kept of ["board", "worktrees", "runs", "activity trail"]) {
      expect(confirmation).toHaveTextContent(kept);
    }
    expect(confirmation).toHaveTextContent("nothing is deleted");

    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove from Flywheel" }));
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("project_hide", { projectId: "p2" }));
    expect(invokeCommandMock.mock.calls.filter(([command]) => command === "project_hide")).toHaveLength(1);
  });

  it("selects another project afterwards rather than rendering an empty surface", async () => {
    invokeCommandMock.mockResolvedValue(undefined);
    const onSelect = vi.fn();
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={onSelect} />);

    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Remove from Flywheel" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith(alpha);
  });

  it("calls nothing when the confirmation is declined", () => {
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={() => {}} />);
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    expect(invokeCommandMock).not.toHaveBeenCalledWith("project_hide", expect.anything());
    expect(screen.queryByRole("group", { name: /Remove Alpha from Flywheel/ })).not.toBeInTheDocument();
  });

  it("keeps the project and says why when the hide fails", async () => {
    invokeCommandMock.mockRejectedValue(new Error("project not found"));
    const onSelect = vi.fn();
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={onSelect} />);
    openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Remove from Flywheel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("project not found");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("a hidden project is absent from the rail once the list no longer carries it", () => {
    renderWithClient(<ProjectRail projects={[alpha]} currentProjectId="p1" onSelect={() => {}} />);
    expect(screen.getAllByRole("button", { name: /^Alpha/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Alpha, Unreachable" })).not.toBeInTheDocument();
  });
});

function fleetRow(overrides: Partial<FleetRowDto>): FleetRowDto {
  return {
    sessionId: "run-1",
    projectId: "proj-1",
    projectName: "Flywheel",
    projectKeyPrefix: "FLY",
    projectStatus: "active",
    storyId: "story-1",
    storyKey: "FLY-1",
    storyTitle: "Wire the thing",
    storyState: "running",
    runStatus: "running",
    fleetState: "running",
    startedAt: new Date().toISOString(),
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

describe("ProjectRail's running sessions per project (#58)", () => {
  it("lists each project's live sessions under that project, and no finished one", async () => {
    fleetListMock.mockResolvedValue({
      rows: [
        fleetRow({ sessionId: "r-blocked", projectId: "proj-2", storyId: "s-2", storyKey: "THF-2", storyTitle: "Second", fleetState: "blocked", runStatus: "blocked" }),
        fleetRow({ sessionId: "r-run", storyKey: "FLY-1", storyTitle: "First", doingTaskTitle: "Write the query" }),
        fleetRow({ sessionId: "r-done", storyId: "s-3", storyKey: "FLY-3", storyTitle: "Finished", fleetState: "failed", runStatus: "failed" }),
      ],
      totalRows: 3,
      visibleCostUsd: null,
    });
    renderWithClient(
      <ProjectRail
        projects={[project({}), project({ id: "proj-2", name: "Threadfin", keyPrefix: "THF" })]}
        currentProjectId="proj-1"
        onSelect={() => {}}
      />,
    );
    const flywheel = await screen.findByRole("list", { name: "Flywheel running sessions" });
    const threadfin = screen.getByRole("list", { name: "Threadfin running sessions" });
    expect(within(flywheel).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open FLY-1 First session, doing Write the query",
    ]);
    expect(within(threadfin).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open THF-2 Second session",
    ]);
    expect(screen.queryByText("FLY-3")).not.toBeInTheDocument();
    // The session waiting on you is flagged with the word, never "Blocked"; the busy one is not.
    expect(within(threadfin).getByText("Waiting on you")).toBeInTheDocument();
    expect(within(flywheel).queryByText("Waiting on you")).toBeNull();
  });

  it("flags a session from the derived fleet state, not its stored status", async () => {
    // Stored as blocked but holding nothing: the core reads it as running.
    fleetListMock.mockResolvedValue({
      rows: [fleetRow({ sessionId: "r-1", storyKey: "FLY-1", storyTitle: "First", fleetState: "running", runStatus: "blocked" })],
      totalRows: 1,
      visibleCostUsd: null,
    });
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    const list = await screen.findByRole("list", { name: "Flywheel running sessions" });
    expect(within(list).queryByText("Waiting on you")).toBeNull();
  });

  it("renders no session list for a project with nothing running", async () => {
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    await waitFor(() => expect(fleetListMock).toHaveBeenCalled());
    expect(screen.queryByRole("list", { name: "Flywheel running sessions" })).not.toBeInTheDocument();
  });

  it("opens the session's feed when a running session is clicked", async () => {
    fleetListMock.mockResolvedValue({
      rows: [fleetRow({ sessionId: "r-run", storyId: "s-1", storyKey: "FLY-1", storyTitle: "First" })],
      totalRows: 1,
      visibleCostUsd: null,
    });
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open FLY-1 First session" }));
    expect(useUiStore.getState().activeSessionId).toBe("r-run");
    expect(useUiStore.getState().activeSessionStoryId).toBe("s-1");
    expect(useUiStore.getState().activeSessionInitialStatus).toBe("running");
  });
});
