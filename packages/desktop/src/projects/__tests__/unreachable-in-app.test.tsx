/**
 * 08.1 group-six finish-review closure. The unreachable-project surface was captured as a component on its
 * own, with no rail beside it, which raised the question of whether it replaces the whole window and strands
 * the user's healthy projects. It does not: this renders the REAL app with one healthy and one unreachable
 * project and proves the rail is on screen and still switches.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import App from "../../App";
import { resetUiState } from "../../state/uiStore";
import type { Project } from "../../board/useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  fleetBlockedQueue: () => Promise.resolve([]),
  fleetWatchRun: () => Promise.resolve(),
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusStory: () => Promise.resolve(),
}));

const PROJECTS: Project[] = [
  { id: "proj-1", keyPrefix: "FLY", name: "Flywheel", repoPath: "/repo/flywheel", defaultBranch: "main", status: "active" },
  { id: "proj-2", keyPrefix: "GONE", name: "Gone", repoPath: "/repo/gone", defaultBranch: "main", status: "unreachable" },
];

beforeEach(() => {
  resetUiState();
  invokeCommandMock.mockReset();
  invokeCommandMock.mockImplementation((command: string) => {
    if (command === "actor_list") return Promise.resolve([]);
    if (command === "project_list") return Promise.resolve(PROJECTS);
    if (command === "board_list") {
      return Promise.resolve({ items: [], issues: [], counts: { backlog: 0, todo: 0, inProgress: 0, inReview: 0, done: 0 } });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  resetUiState();
  cleanup();
});

describe("the unreachable project inside the real app", () => {
  it("keeps the project rail on screen, with the healthy project one click away", async () => {
    render(<App />);
    const rail = await screen.findByRole("navigation", { name: "Projects" });
    fireEvent.click(within(rail).getByRole("button", { name: "Gone, Unreachable" }));

    await screen.findByRole("heading", { name: "Can’t find this project" });
    // The rail is still there, with BOTH projects in it.
    const railNow = screen.getByRole("navigation", { name: "Projects" });
    expect(within(railNow).getByRole("button", { name: "Gone, Unreachable" })).toBeInTheDocument();
    expect(within(railNow).getByRole("button", { name: "Flywheel" })).toBeInTheDocument();

    // And the healthy project is reachable from it: the surface gives way to its board.
    fireEvent.click(within(railNow).getByRole("button", { name: "Flywheel" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Can’t find this project" })).toBeNull());
  });

  it("has no eyebrow above its heading", async () => {
    render(<App />);
    const rail = await screen.findByRole("navigation", { name: "Projects" });
    fireEvent.click(within(rail).getByRole("button", { name: "Gone, Unreachable" }));
    const heading = await screen.findByRole("heading", { name: "Can’t find this project" });
    const surface = heading.closest("[data-slot=project-unreachable]") as HTMLElement;
    expect(within(surface).getByRole("button", { name: "Locate project…" })).toBeInTheDocument();
    // Above the heading is only its icon: no text restates it.
    const header = heading.closest("[data-slot=empty-header]") as HTMLElement;
    const before = Array.from(header.children).slice(0, Array.from(header.children).indexOf(heading.parentElement as Element));
    expect(before.map((node) => node.textContent).join("")).toBe("");
    expect(within(surface).queryByText("Unreachable")).toBeNull();
  });

  it("keeps the top bar, naming the project, with Search (critique F7)", async () => {
    render(<App />);
    const rail = await screen.findByRole("navigation", { name: "Projects" });
    fireEvent.click(within(rail).getByRole("button", { name: "Gone, Unreachable" }));
    const heading = await screen.findByRole("heading", { name: "Can’t find this project" });
    const surface = heading.closest("[data-slot=project-unreachable]") as HTMLElement;
    const crumbs = within(surface).getByRole("navigation", { name: "You are here" });
    expect(within(crumbs).getByText("Gone")).toBeInTheDocument();
    expect(within(surface).getByRole("button", { name: "Search, ⌘K" })).toBeInTheDocument();
  });
});
