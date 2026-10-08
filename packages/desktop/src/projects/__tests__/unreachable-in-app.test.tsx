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
  subscribeMenuAction: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  gitFacts: () => Promise.resolve(null),
  gitTruthFocusTask: () => Promise.resolve(),
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
    const surface = heading.parentElement as HTMLElement;
    expect(within(surface).getByRole("button", { name: "Locate Project…" })).toBeInTheDocument();
    // The heading is the first thing on the surface: nothing restates it above.
    expect(surface.firstElementChild).toBe(heading);
    expect(within(surface).queryByText("Unreachable")).toBeNull();
  });
});
