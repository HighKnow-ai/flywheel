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
import { SidebarProvider } from "@/components/ui/sidebar";
import { ProjectRail } from "../ProjectRail";
import { ProjectUnreachable } from "../ProjectUnreachable";
import type { Project } from "../../board/useBoardQuery";
import type { FleetListDto, FleetRowDto } from "../../adapters/tauri";
import { resetUiState, useUiStore } from "../../state/uiStore";

const invokeCommandMock = vi.fn();
const fleetBlockedQueueMock = vi.fn(() => Promise.resolve<unknown[]>([]));
const fleetWaitingRoundsMock = vi.fn(() => Promise.resolve<unknown[]>([]));
const fleetListMock = vi.fn(() => Promise.resolve<FleetListDto>({ rows: [], totalRows: 0, visibleCostUsd: null }));
const storyGetMock = vi.fn((_storyId: string) => Promise.resolve<unknown>(null));
const needsYouListMock = vi.fn((_projectId: string) => Promise.resolve<unknown[]>([]));

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  fleetBlockedQueue: () => fleetBlockedQueueMock(),
  fleetList: () => fleetListMock(),
  fleetWaitingRounds: () => fleetWaitingRoundsMock(),
  fleetWatchRun: () => Promise.resolve(),
  boardRecoverySummary: (projectId: string) => invokeCommandMock("board_recovery_summary", { projectId }),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  projectHide: (projectId: string) => invokeCommandMock("project_hide", { projectId }),
  storyGet: (storyId: string) => storyGetMock(storyId),
  needsYouList: (projectId: string) => needsYouListMock(projectId),
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
  // The rail is the shell's Sidebar, so it renders inside the shell's SidebarProvider, as in `App.tsx`.
  return render(
    <QueryClientProvider client={queryClient}>
      <SidebarProvider>{node}</SidebarProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  fleetBlockedQueueMock.mockReset();
  fleetBlockedQueueMock.mockResolvedValue([]);
  fleetListMock.mockReset();
  fleetListMock.mockResolvedValue({ rows: [], totalRows: 0, visibleCostUsd: null });
  fleetWaitingRoundsMock.mockReset();
  fleetWaitingRoundsMock.mockResolvedValue([]);
  storyGetMock.mockReset();
  storyGetMock.mockResolvedValue(null);
  needsYouListMock.mockReset();
  needsYouListMock.mockResolvedValue([]);
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

  it("counts a shaping Round a live session waits on beside the requests, in its project too (issue #124)", async () => {
    fleetBlockedQueueMock.mockResolvedValue([{ requestId: "r1", projectId: "proj-1" }]);
    fleetWaitingRoundsMock.mockResolvedValue([
      { roundId: "round-1", roundNumber: 2, projectId: "proj-2", epicId: "e-8", epicKey: "OTH-8", epicTitle: "Epic shaping" },
    ]);
    renderWithClient(
      <ProjectRail
        projects={[project({}), project({ id: "proj-2", name: "Other", keyPrefix: "OTH" })]}
        currentProjectId="proj-1"
        onSelect={() => {}}
      />,
    );
    const row = await screen.findByRole("button", { name: "Open Waiting on you, 2 waiting" });
    expect(row.querySelector('[data-count="waiting"]')).toHaveTextContent("2");
    // The badge and the rows under the project agree: the Round has its row, which opens its Epic.
    fireEvent.click(await screen.findByRole("button", { name: "Open Epic OTH-8 Epic shaping, Round 2 Waiting on you" }));
    expect(useUiStore.getState().currentEpicId).toBe("e-8");
  });

  it("shows no figure at all when nothing is waiting", async () => {
    renderWithClient(
      <ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />,
    );
    await waitFor(() => expect(fleetBlockedQueueMock).toHaveBeenCalled());
    expect(document.querySelector('[data-count="waiting"]')).toBeNull();
  });

});

/** One Needs-you item, as `needs_you_list` returns it (issue #156). */
function needsYouItem(kind: string, id: string, extra: Record<string, unknown> = {}) {
  return {
    kind, rank: 1, id, since: "2026-10-20T10:00:00Z",
    record: { kind: "story", id: `s-${id}`, key: `FLY-${id}`, title: `Story ${id}`, state: null },
    sessionId: null, request: null, endingReason: null, missingWorktree: false, doingTaskTitle: null,
    exitTest: null, milestoneTitle: null, round: null, ...extra,
  };
}

/** A project's Needs-you figure: the count beside its row, inside the row's own menu item. */
function needsYouFigure(projectName: string): HTMLElement | null {
  const row = screen.getByRole("button", { name: new RegExp(`^${projectName}`) });
  return row.closest("li")!.querySelector<HTMLElement>('[data-count="needs-you"]');
}

describe("ProjectRail's per-project figure is the Needs-you item count (issue #156)", () => {
  const two = [project({}), project({ id: "proj-2", name: "Other", keyPrefix: "OTH" })];

  it("shows each project's Needs-you count, read from that project's own list", async () => {
    needsYouListMock.mockImplementation((projectId: string) =>
      Promise.resolve(
        projectId === "proj-1"
          ? [needsYouItem("stopped", "1"), needsYouItem("review", "2"), needsYouItem("confirm_exit_test", "3")]
          : [needsYouItem("gated_action", "9")],
      ),
    );
    renderWithClient(<ProjectRail projects={two} currentProjectId="proj-1" onSelect={() => {}} />);
    await waitFor(() => expect(needsYouFigure("Flywheel")).toHaveTextContent("3"));
    await waitFor(() => expect(needsYouFigure("Other")).toHaveTextContent("1"));
    expect(needsYouListMock).toHaveBeenCalledWith("proj-1");
    expect(needsYouListMock).toHaveBeenCalledWith("proj-2");
  });

  it("is never the attention Badge: yellow is Waiting on you's own count (issue #200)", async () => {
    needsYouListMock.mockImplementation((projectId: string) =>
      Promise.resolve(
        projectId === "proj-1"
          ? [needsYouItem("review", "2")]
          : [
              needsYouItem("shaping_round", "r", {
                round: { roundId: "r", roundNumber: 1, subject: "epic", waitingOnYou: true, answered: 0, questions: 2 },
              }),
            ],
      ),
    );
    renderWithClient(<ProjectRail projects={two} currentProjectId="proj-1" onSelect={() => {}} />);
    await waitFor(() => expect(needsYouFigure("Other")).toHaveTextContent("1"));
    expect(needsYouFigure("Flywheel")).toHaveAttribute("data-variant", "secondary");
    expect(needsYouFigure("Other")).toHaveAttribute("data-variant", "secondary");
    expect(document.querySelectorAll('[data-variant="attention"]')).toHaveLength(0);
  });

  it("shows no figure for a project nothing needs, and no separate Needs decision figure", async () => {
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    await waitFor(() => expect(needsYouListMock).toHaveBeenCalled());
    expect(document.querySelector('[data-count="needs-you"]')).toBeNull();
    expect(screen.queryByText("Needs decision")).toBeNull();
    expect(screen.queryByRole("button", { name: "Open decisions" })).toBeNull();
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
  it("offers Locate project… and Remove from Flywheel…, and no automatic-recovery affordance (#210)", () => {
    renderWithClient(
      <ProjectUnreachable
        project={project({ id: "proj-3", name: "Orphaned Repo", repoPath: "/Users/dev/orphaned-repo" })}
      />,
    );

    // The top bar's Search, then the surface's two answers: nothing that scans, retries or guesses.
    const names = screen.getAllByRole("button").map((button) => button.textContent);
    expect(names).toEqual(["Search⌘K", "Remove from Flywheel…", "Locate project…"]);
    expect(screen.getByText("Flywheel expected Orphaned Repo here")).toBeInTheDocument();
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

describe("ProjectRail's Remove from Flywheel (D-200, closes D-REV-29; issue #200)", () => {
  const alpha = project({ id: "p1", name: "Alpha", keyPrefix: "ALP" });
  const dupe = project({ id: "p2", name: "Alpha", keyPrefix: "ALP", status: "unreachable" });
  const beta = project({ id: "p3", name: "Beta", keyPrefix: "BET" });

  /** Opens the project's own menu and picks Remove from Flywheel… in it. */
  async function openConfirmation(rowName: string) {
    const trigger = screen.getByRole("button", { name: `Project actions for ${rowName}` });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove from Flywheel…" }));
    return screen.findByRole("alertdialog");
  }

  it("is not in the footer: it lives in each project's own menu", () => {
    renderWithClient(<ProjectRail projects={[alpha, beta]} currentProjectId="p1" onSelect={() => {}} />);
    expect(screen.queryByRole("button", { name: "Remove from Flywheel…" })).toBeNull();
    expect(screen.getByRole("button", { name: "Project actions for Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Project actions for Beta" })).toBeInTheDocument();
  });

  it("asks first, naming what is kept, and calls project_hide only after the confirmation", async () => {
    invokeCommandMock.mockResolvedValue(undefined);
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={() => {}} />);

    const confirmation = await openConfirmation("Alpha, Unreachable");
    expect(invokeCommandMock).not.toHaveBeenCalledWith("project_hide", expect.anything());
    expect(within(confirmation).getByRole("heading", { name: "Remove Alpha from Flywheel?" })).toBeInTheDocument();
    for (const kept of ["board", "worktrees", "runs", "activity trail"]) {
      expect(confirmation).toHaveTextContent(kept);
    }
    expect(confirmation).toHaveTextContent("nothing is deleted");

    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove from Flywheel" }));
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("project_hide", { projectId: "p2" }));
    expect(invokeCommandMock.mock.calls.filter(([command]) => command === "project_hide")).toHaveLength(1);
  });

  it("removes any project from its own row, not only the current one", async () => {
    invokeCommandMock.mockResolvedValue(undefined);
    const onSelect = vi.fn();
    renderWithClient(<ProjectRail projects={[alpha, beta]} currentProjectId="p1" onSelect={onSelect} />);
    const confirmation = await openConfirmation("Beta");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove from Flywheel" }));
    await waitFor(() => expect(invokeCommandMock).toHaveBeenCalledWith("project_hide", { projectId: "p3" }));
    // Removing a project that is not the one on screen leaves the developer where they are.
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("selects another project afterwards when the removed one was current", async () => {
    invokeCommandMock.mockResolvedValue(undefined);
    const onSelect = vi.fn();
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={onSelect} />);

    const confirmation = await openConfirmation("Alpha, Unreachable");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove from Flywheel" }));

    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect).toHaveBeenCalledWith(alpha);
  });

  it("calls nothing when the confirmation is cancelled", async () => {
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={() => {}} />);
    const confirmation = await openConfirmation("Alpha, Unreachable");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Cancel" }));
    expect(invokeCommandMock).not.toHaveBeenCalledWith("project_hide", expect.anything());
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("keeps the project and says why when the hide fails", async () => {
    invokeCommandMock.mockRejectedValue(new Error("project not found"));
    const onSelect = vi.fn();
    renderWithClient(<ProjectRail projects={[alpha, dupe]} currentProjectId="p2" onSelect={onSelect} />);
    const confirmation = await openConfirmation("Alpha, Unreachable");
    fireEvent.click(within(confirmation).getByRole("button", { name: "Remove from Flywheel" }));
    expect(await within(confirmation).findByRole("alert")).toHaveTextContent("project not found");
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
        fleetRow({ sessionId: "r-done", storyId: "s-3", storyKey: "FLY-3", storyTitle: "Finished", storyState: "in_review", fleetState: "awaiting_review", runStatus: "completed" }),
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
      "Open Story FLY-1 First, doing Write the query",
      "Open FLY-1 First session",
    ]);
    expect(within(threadfin).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open Story THF-2 Second",
      "Open THF-2 Second session",
    ]);
    expect(screen.queryByText("FLY-3")).not.toBeInTheDocument();
    // The session waiting on you is flagged by the hand named Waiting on you, never "Blocked"; the busy one is not.
    expect(within(threadfin).getByRole("img", { name: "Waiting on you" })).toBeInTheDocument();
    expect(within(flywheel).queryByRole("img", { name: "Waiting on you" })).toBeNull();
  });

  it("keeps a Stopped Story under its project, flagged Stopped, with no session control", async () => {
    fleetListMock.mockResolvedValue({
      rows: [
        fleetRow({ sessionId: "r-run", storyKey: "FLY-1", storyTitle: "First" }),
        fleetRow({ sessionId: "r-dead", storyId: "s-7", storyKey: "FLY-7", storyTitle: "Halted", storyState: "running", fleetState: "interrupted", runStatus: "interrupted", endedAt: new Date().toISOString() }),
      ],
      totalRows: 2,
      visibleCostUsd: null,
    });
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    const list = await screen.findByRole("list", { name: "Flywheel running sessions" });
    await waitFor(() =>
      expect(within(list).getAllByRole("button").map((b) => b.getAttribute("aria-label"))).toEqual([
        "Open Story FLY-1 First",
        "Open FLY-1 First session",
        "Open Story FLY-7 Halted, Stopped",
      ]),
    );
    expect(within(list).getByRole("img", { name: "Stopped" })).toBeInTheDocument();
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

  it("opens the session's feed only from its explicit Session control", async () => {
    fleetListMock.mockResolvedValue({
      rows: [fleetRow({ sessionId: "r-run", storyId: "s-1", storyKey: "FLY-1", storyTitle: "First" })],
      totalRows: 1,
      visibleCostUsd: null,
    });
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    const control = await screen.findByRole("button", { name: "Open FLY-1 First session" });
    expect(control).toHaveTextContent("Session");
    fireEvent.click(control);
    expect(useUiStore.getState().activeSessionId).toBe("r-run");
    expect(useUiStore.getState().activeSessionStoryId).toBe("s-1");
    expect(useUiStore.getState().activeSessionInitialStatus).toBe("running");
  });
});

describe("the sidebar's click model and current place (issue #104)", () => {
  it("a running row opens its Story, never its session", async () => {
    fleetListMock.mockResolvedValue({
      rows: [fleetRow({ sessionId: "r-run", projectId: "proj-1", storyId: "s-1", storyKey: "FLY-1", storyTitle: "First" })],
      totalRows: 1,
      visibleCostUsd: null,
    });
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Story FLY-1 First" }));
    expect(useUiStore.getState().currentStoryId).toBe("s-1");
    expect(useUiStore.getState().currentProjectId).toBe("proj-1");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("marks the current project, and the current Story's running row", async () => {
    fleetListMock.mockResolvedValue({
      rows: [
        fleetRow({ sessionId: "r-1", projectId: "proj-1", storyId: "s-1", storyKey: "FLY-1", storyTitle: "First" }),
        fleetRow({ sessionId: "r-2", projectId: "proj-1", storyId: "s-2", storyKey: "FLY-2", storyTitle: "Second" }),
      ],
      totalRows: 2,
      visibleCostUsd: null,
    });
    useUiStore.setState({ currentProjectId: "proj-1", activeSessionId: "r-2", activeSessionStoryId: "s-2" });
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Flywheel" })).toHaveAttribute("aria-current", "true");
    expect(await screen.findByRole("button", { name: "Open Story FLY-2 Second" })).toHaveAttribute("aria-current", "location");
    expect(screen.getByRole("button", { name: "Open FLY-2 Second session" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: "Open Story FLY-1 First" })).not.toHaveAttribute("aria-current");
  });

  it("marks the open Story under its project even when it is not running", async () => {
    storyGetMock.mockResolvedValue({
      id: "s-9",
      projectId: "proj-1",
      epicId: "e1",
      key: "FLY-9",
      title: "Quiet",
      description: null,
      state: "ready",
      runsAfterStoryId: null,
      rank: "a",
    });
    useUiStore.setState({ currentProjectId: "proj-1", currentStoryId: "s-9" });
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    expect(await screen.findByRole("button", { name: "Open Story FLY-9 Quiet" })).toHaveAttribute("aria-current", "location");
  });
});

describe("the rail raises where the developer is, whichever project that is (issue #200)", () => {
  const two = [project({}), project({ id: "proj-2", name: "Threadfin", keyPrefix: "THF" })];

  it("with another project's live session open, raises that project and that Story", async () => {
    fleetListMock.mockResolvedValue({
      rows: [fleetRow({ sessionId: "r-2", projectId: "proj-2", storyId: "s-2", storyKey: "THF-2", storyTitle: "Second" })],
      totalRows: 1,
      visibleCostUsd: null,
    });
    // The board behind is still Flywheel's; the session on screen is Threadfin's.
    useUiStore.setState({ currentProjectId: "proj-1", activeSessionId: "r-2", activeSessionStoryId: "s-2" });
    renderWithClient(<ProjectRail projects={two} currentProjectId="proj-1" onSelect={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Threadfin" })).toHaveAttribute("aria-current", "true"),
    );
    expect(screen.getByRole("button", { name: "Flywheel" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Open Story THF-2 Second" })).toHaveAttribute("aria-current", "location");
  });

  it("with another project's finished session open, raises that project and lists its Story", async () => {
    fleetListMock.mockResolvedValue({
      rows: [
        fleetRow({
          sessionId: "r-9",
          projectId: "proj-2",
          storyId: "s-9",
          storyKey: "THF-9",
          storyTitle: "Done already",
          storyState: "in_review",
          runStatus: "completed",
          fleetState: "awaiting_review",
          endedAt: new Date().toISOString(),
        }),
      ],
      totalRows: 1,
      visibleCostUsd: null,
    });
    useUiStore.setState({ currentProjectId: "proj-1", activeSessionId: "r-9", activeSessionStoryId: "s-9" });
    renderWithClient(<ProjectRail projects={two} currentProjectId="proj-1" onSelect={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Threadfin" })).toHaveAttribute("aria-current", "true"),
    );
    const list = screen.getByRole("list", { name: "Threadfin running sessions" });
    expect(within(list).getByRole("button", { name: "Open Story THF-9 Done already" })).toHaveAttribute(
      "aria-current",
      "location",
    );
  });

  it("with another project's Story open, raises that project and that Story", async () => {
    storyGetMock.mockResolvedValue({
      id: "s-5", projectId: "proj-2", epicId: "e1", key: "THF-5", title: "Quiet",
      description: null, state: "ready", runsAfterStoryId: null, rank: "a",
    });
    useUiStore.getState().openStory("proj-2", "s-5");
    renderWithClient(<ProjectRail projects={two} currentProjectId="proj-2" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "Threadfin" })).toHaveAttribute("aria-current", "true");
    expect(await screen.findByRole("button", { name: "Open Story THF-5 Quiet" })).toHaveAttribute("aria-current", "location");
  });
});

describe("the rail collapses to icons (issue #200)", () => {
  it("⌘B collapses it and expands it again", async () => {
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    const sidebar = screen.getByRole("navigation", { name: "Projects" }).closest("[data-slot=sidebar]")!;
    expect(sidebar).toHaveAttribute("data-state", "expanded");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    await waitFor(() => expect(sidebar).toHaveAttribute("data-state", "collapsed"));
    expect(sidebar).toHaveAttribute("data-collapsible", "icon");
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    await waitFor(() => expect(sidebar).toHaveAttribute("data-state", "expanded"));
  });

  it("carries no native title tooltips: every hint is a Tooltip", () => {
    renderWithClient(
      <ProjectRail
        projects={[project({}), project({ id: "proj-2", name: "Threadfin", keyPrefix: "THF", status: "unreachable" })]}
        currentProjectId="proj-1"
        onSelect={() => {}}
      />,
    );
    const sidebar = screen.getByRole("navigation", { name: "Projects" });
    expect(sidebar.querySelectorAll("[title]")).toHaveLength(0);
  });
});

describe("the rail's All agents figure is the strip's agent count (issues #199, #200)", () => {
  it("counts live Story sessions and live shaping sessions, never a finished one", async () => {
    fleetListMock.mockResolvedValue({
      rows: [
        fleetRow({ sessionId: "r-run" }),
        fleetRow({ sessionId: "r-wait", storyId: "s-2", fleetState: "blocked", runStatus: "blocked" }),
        fleetRow({ sessionId: "r-done", storyId: "s-3", runStatus: "completed", fleetState: "awaiting_review" }),
      ],
      totalRows: 3,
      visibleCostUsd: null,
    });
    fleetWaitingRoundsMock.mockResolvedValue([
      { roundId: "round-1", roundNumber: 2, sessionId: "shaping-1", projectId: "proj-1", epicId: "e-8", epicKey: "FLY-8", epicTitle: "Epic shaping" },
    ]);
    renderWithClient(<ProjectRail projects={[project({})]} currentProjectId="proj-1" onSelect={() => {}} />);
    const fleet = screen.getByRole("button", { name: "Open fleet" });
    await waitFor(() => expect(fleet.querySelector('[data-count="agents"]')).toHaveTextContent("3"));
  });
});
