/**
 * Behavior under test (01-11-PLAN.md Task 3):
 * - `ProjectRail` renders nothing with zero projects, and the switcher chrome with one.
 * - An unreachable rail entry renders both a warning glyph and the literal word "Unreachable" —
 *   never a colour change alone (01-UI-SPEC.md "Accessibility").
 * - `⌘3` switches the open board to the third registered project (01-UI-SPEC.md "Project
 *   switcher (left rail)").
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
import { resetUiState } from "../../state/uiStore";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
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
    await screen.findByText("Alpha");

    fireEvent.keyDown(window, { key: "3", metaKey: true });

    await waitFor(() => expect(screen.getByText("Charlie")).toBeInTheDocument());
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
  });
});
