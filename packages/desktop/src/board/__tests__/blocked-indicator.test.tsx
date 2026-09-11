/**
 * Behavior under test (02-06-PLAN.md Task 3, D-37, AGNT-06): a task whose most recent agent run is
 * blocked renders a pill on its board row (layered onto the existing status glyph, never replacing
 * it, structurally exempt from the row's progressive-disclosure truncation ladder) and the current
 * project's rail entry gains a numeral count badge — absence, never a visible zero, at neither
 * surface with no blocked run.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BoardRow } from "../BoardRow";
import { ProjectRail } from "../../projects/ProjectRail";
import type { BoardItem, Project } from "../useBoardQuery";

const invokeCommandMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string, args?: Record<string, unknown>) => invokeCommandMock(command, args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  openFolderDialog: () => Promise.resolve(null),
  blockedSummary: (projectId: string) => invokeCommandMock("board_blocked_summary", { projectId }),
}));

function makeItem(overrides: Partial<BoardItem> = {}): BoardItem {
  return {
    id: "task-1",
    key: "FLY-1",
    title: "A gated task",
    status: "in_progress",
    rank: "10",
    priority: 0,
    epicId: null,
    kind: "task",
    ...overrides,
  };
}

describe("BoardRow blocked indicator (D-37)", () => {
  it("renders no pill for a task with no blocked run", () => {
    render(<BoardRow item={makeItem()} />);
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
  });

  it("renders the ShieldAlert glyph and the exact word 'Blocked' together for a blocked run", () => {
    render(<BoardRow item={makeItem()} blocked />);
    const pill = screen.getByRole("button", { name: /Blocked/ });
    expect(pill).toBeInTheDocument();
    expect(pill.querySelector("svg")).toBeInTheDocument();
    expect(pill).toHaveTextContent("Blocked");
  });

  it("leaves the row's own five-state status glyph unchanged — a blocked In Progress task still shows the In Progress glyph", () => {
    render(<BoardRow item={makeItem({ status: "in_progress" })} blocked />);
    expect(screen.getByRole("button", { name: /^Status: In Progress\./ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Blocked/ })).toBeInTheDocument();
  });

  it("is structurally exempt from the truncation ladder — carries no field-* class, the same mechanism that exempts the criteria count", () => {
    render(<BoardRow item={makeItem()} blocked />);
    const pill = screen.getByRole("button", { name: /Blocked/ });
    expect(pill.className.split(/\s+/).some((c) => c.startsWith("field-"))).toBe(false);
    // Still present regardless — proving it survives the narrowest width the ladder supports,
    // since App.css's `@container` rules only ever target `.field-*` classes.
    expect(pill).toBeInTheDocument();
  });

  it("activating the pill calls onOpenBlocked without also firing the row's own onSelect", () => {
    const onOpenBlocked = vi.fn();
    const onSelect = vi.fn();
    render(<BoardRow item={makeItem()} blocked onOpenBlocked={onOpenBlocked} onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: /Blocked/ }));

    expect(onOpenBlocked).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("resolves the pill's glyph and word from the marks registry, naming no icon component directly, and never references a notification API", async () => {
    const source = await import("../BoardRow.tsx?raw");
    const text: string = source.default;
    expect(text).toMatch(/blockedMark\?\.glyph/);
    expect(text).not.toMatch(/notification|notify/i);
  });
});

describe("ProjectRail blocked count badge (D-37)", () => {
  const PROJECT: Project = {
    id: "proj-1",
    keyPrefix: "FLY",
    name: "Flywheel",
    repoPath: "/repo",
    defaultBranch: "main",
    status: "reachable",
  };

  function renderRail(blockedCount: number) {
    invokeCommandMock.mockReset();
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "board_blocked_summary") {
        return Promise.resolve({ blockedTaskIds: [], blockedCount });
      }
      return Promise.resolve(undefined);
    });
    const queryClient = new QueryClient();
    return render(
      <QueryClientProvider client={queryClient}>
        <ProjectRail projects={[PROJECT]} currentProjectId={PROJECT.id} onSelect={() => {}} />
      </QueryClientProvider>,
    );
  }

  it("renders no badge element at zero blocked tasks", async () => {
    renderRail(0);
    // Give the (disabled-until-resolved) query a tick to settle before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTitle(/task.*waiting on you/)).not.toBeInTheDocument();
  });

  it("renders a numeral equal to the count above zero", async () => {
    renderRail(3);
    expect(await screen.findByText("3")).toBeInTheDocument();
  });

  it("renders the singular tooltip at exactly one blocked task", async () => {
    renderRail(1);
    expect(await screen.findByTitle("1 task waiting on you")).toBeInTheDocument();
  });

  it("renders the plural tooltip above one blocked task", async () => {
    renderRail(4);
    expect(await screen.findByTitle("4 tasks waiting on you")).toBeInTheDocument();
  });
});
