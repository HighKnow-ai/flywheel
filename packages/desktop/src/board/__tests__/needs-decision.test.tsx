/**
 * Behavior under test (03-11-PLAN.md Tasks 2 and 3, D-46): a task with an outstanding recovery
 * item (a missing worktree, or an unacknowledged abandoned run) renders a "Needs Decision" pill on
 * its board row — distinguishable from the existing Blocked pill by glyph, printed word and colour
 * family, structurally exempt from the row's progressive-disclosure truncation ladder — and the
 * current project's rail gains a second, visually distinct count badge, never merged with the
 * existing Blocked count.
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
  subscribeAgentEvent: () => Promise.resolve(() => {}),
  fleetBlockedQueue: () => invokeCommandMock("fleet_blocked_queue", undefined),
  openFolderDialog: () => Promise.resolve(null),
  blockedSummary: (projectId: string) => invokeCommandMock("board_blocked_summary", { projectId }),
  boardRecoverySummary: (projectId: string) => invokeCommandMock("board_recovery_summary", { projectId }),
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

describe("BoardRow Needs Decision pill (D-46)", () => {
  it("renders no pill for a task with no outstanding recovery item — byte-identical to pre-task output", () => {
    render(<BoardRow item={makeItem()} />);
    expect(screen.queryByText("Needs Decision")).not.toBeInTheDocument();
  });

  it("renders the TriangleAlert glyph and the exact words 'Needs Decision' together", () => {
    render(<BoardRow item={makeItem()} needsDecision />);
    const pill = screen.getByRole("button", { name: /Needs Decision/ });
    expect(pill).toBeInTheDocument();
    expect(pill.querySelector("svg")).toBeInTheDocument();
    expect(pill).toHaveTextContent("Needs Decision");
  });

  it("renders both pills, Needs Decision trailing Blocked in document order, when both flags are true", () => {
    render(<BoardRow item={makeItem()} blocked needsDecision />);
    const blockedPill = screen.getByRole("button", { name: /^Blocked/ });
    const recoveryPill = screen.getByRole("button", { name: /Needs Decision/ });
    expect(blockedPill).toBeInTheDocument();
    expect(recoveryPill).toBeInTheDocument();
    // DOM order: Blocked pill precedes Needs Decision pill (compareDocumentPosition bit 4 =
    // FOLLOWING — blockedPill comes before recoveryPill in the tree).
    // eslint-disable-next-line no-bitwise
    expect(blockedPill.compareDocumentPosition(recoveryPill) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("the two pills are told apart by glyph and word, not colour: both are needs-you (D-15, Phase 14 plan 09)", () => {
    render(<BoardRow item={makeItem()} blocked needsDecision />);
    const blockedPill = screen.getByRole("button", { name: /^Blocked/ });
    const recoveryPill = screen.getByRole("button", { name: /Needs Decision/ });
    expect(blockedPill.querySelector("[data-state-class]")?.getAttribute("data-state-class")).toBe("needs-you");
    expect(recoveryPill.querySelector("[data-state-class]")?.getAttribute("data-state-class")).toBe("needs-you");
    expect(blockedPill.textContent).not.toBe(recoveryPill.textContent);
    expect(blockedPill.querySelector("svg")?.innerHTML).not.toBe(recoveryPill.querySelector("svg")?.innerHTML);
  });

  it("appends 'Needs Decision' to the row's accessible name when the pill is present", () => {
    render(<BoardRow item={makeItem()} needsDecision />);
    const row = screen.getByRole("listitem");
    expect(row).toHaveAccessibleName(/Needs Decision/);
  });

  it("is structurally exempt from the truncation ladder — carries no field-* class", () => {
    render(<BoardRow item={makeItem()} needsDecision />);
    const pill = screen.getByRole("button", { name: /Needs Decision/ });
    expect(pill.className.split(/\s+/).some((c) => c.startsWith("field-"))).toBe(false);
  });

  it("keeps both pills queryable at a very long title and a constrained width", () => {
    const longTitle =
      "An extremely long task title that would ordinarily need to truncate against the row's available width when several fields all compete for space at once";
    const { container } = render(
      <div style={{ width: 320 }}>
        <BoardRow item={makeItem({ title: longTitle })} blocked needsDecision />
      </div>,
    );
    expect(container.querySelector(".board-row")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Blocked/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Needs Decision/ })).toBeInTheDocument();
  });

  it("activating the pill calls onOpenRecovery with no propagation to onSelect", () => {
    const onOpenRecovery = vi.fn();
    const onSelect = vi.fn();
    render(
      <BoardRow item={makeItem()} needsDecision onOpenRecovery={onOpenRecovery} onSelect={onSelect} />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Needs Decision/ }));

    expect(onOpenRecovery).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("resolves the pill's glyph and word from the marks registry, naming no icon component directly", async () => {
    const source = await import("../BoardRow.tsx?raw");
    const text: string = source.default;
    // Since Phase 14 plan 09 the glyph and word come from the registry through StateBadge, not from this file.
    expect(text).toMatch(/<StateBadge state="needs_decision"/);
    expect(text).not.toMatch(/recoveryMark\?\.glyph/);
  });
});

describe("ProjectRail second count badge (D-46)", () => {
  const PROJECT: Project = {
    id: "proj-1",
    keyPrefix: "FLY",
    name: "Flywheel",
    repoPath: "/repo",
    defaultBranch: "main",
    status: "reachable",
  };

  function renderRail(blockedCount: number, recoveryCount: number) {
    invokeCommandMock.mockReset();
    invokeCommandMock.mockImplementation((command: string) => {
      if (command === "fleet_blocked_queue") {
        // Plan 10-05: the rail's count is the fleet-wide queue's length (FLEET-02), no longer the
        // current project's `board_blocked_summary`.
        return Promise.resolve(Array.from({ length: blockedCount }, (_, i) => ({ requestId: `req-${i}` })));
      }
      if (command === "board_recovery_summary") {
        return Promise.resolve({ recoveryTaskIds: [], recoveryCount });
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

  it("renders no badge at all when both counts are zero", async () => {
    renderRail(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTitle(/need.*a decision/)).not.toBeInTheDocument();
    expect(screen.queryByTitle(/waiting on you/)).not.toBeInTheDocument();
  });

  it("renders exactly one badge (the Blocked one) when the recovery count is zero but the blocked count is not", async () => {
    renderRail(2, 0);
    expect(await screen.findByTitle("2 agents waiting on you")).toBeInTheDocument();
    expect(screen.queryByTitle(/need.*a decision/)).not.toBeInTheDocument();
  });

  it("renders two figures in different data-channel colours when both counts are non-zero", async () => {
    renderRail(2, 3);
    const blockedBadge = await screen.findByTitle("2 agents waiting on you");
    const recoveryBadge = await screen.findByTitle("3 tasks need a decision.");
    expect(blockedBadge).toBeInTheDocument();
    expect(recoveryBadge).toBeInTheDocument();
    // D-11: colour is a data channel, so the figures carry the colour and no fill (plan 08.1-14).
    expect(getComputedStyle(blockedBadge).color).not.toBe(getComputedStyle(recoveryBadge).color);
  });

  it("renders the singular tooltip at exactly one task needing a decision", async () => {
    renderRail(0, 1);
    expect(await screen.findByTitle("1 task needs a decision.")).toBeInTheDocument();
  });

  it("renders the plural tooltip above one task needing a decision", async () => {
    renderRail(0, 4);
    expect(await screen.findByTitle("4 tasks need a decision.")).toBeInTheDocument();
  });

  it("never combines the two counts into one number", async () => {
    renderRail(2, 3);
    expect(await screen.findByText("2")).toBeInTheDocument();
    expect(await screen.findByText("3")).toBeInTheDocument();
    expect(screen.queryByText("5")).not.toBeInTheDocument();
  });
});
