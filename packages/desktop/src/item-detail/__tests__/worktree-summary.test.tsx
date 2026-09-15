/**
 * Behavior under test (02-08-PLAN.md Task 1, 02-UI-SPEC.md "Worktree summary", E6): a task with
 * no worktree renders nothing at all; a task with a worktree renders its branch and absolute path
 * in the Mono role; a long path renders with left-truncation styling while the full string stays
 * in the DOM; the copy affordance copies the full, untruncated path; a null branch renders an
 * inline notice for the missing field while the path still renders; no editor/terminal affordance
 * is ever rendered.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorktreeSummary } from "../WorktreeSummary";
import type { WorktreeSummaryDto } from "../../adapters/tauri";

const worktreeSummaryMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  worktreeSummary: (taskId: string) => worktreeSummaryMock(taskId),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

function renderSummary(taskId = "task-1") {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <WorktreeSummary taskId={taskId} />
    </QueryClientProvider>,
  );
}

const LONG_PATH = "/Users/cyril/Flywheel/threadfin-project/FLY-42-add-worktree-summary";

describe("WorktreeSummary", () => {
  it("renders nothing at all for a task with no worktree", async () => {
    worktreeSummaryMock.mockResolvedValue(null);
    const { container } = renderSummary();

    await waitFor(() => expect(worktreeSummaryMock).toHaveBeenCalledWith("task-1"));
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/worktree/i)).not.toBeInTheDocument();
  });

  it("renders nothing while the read is in flight", () => {
    worktreeSummaryMock.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderSummary();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the branch and path, both in the Mono role", async () => {
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const branchNode = await screen.findByText("flywheel/fly-42");
    const pathNode = screen.getByText("/Users/cyril/Flywheel/proj/FLY-42");
    expect(branchNode.style.fontFamily).toMatch(/ui-monospace/);
    expect(pathNode.style.fontFamily).toMatch(/ui-monospace/);
  });

  it("renders a long path with left-truncation styling and never wraps to a second row", async () => {
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: LONG_PATH, status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const pathNode = await screen.findByText(LONG_PATH);
    // The full string stays in the DOM (jsdom performs no layout/visual truncation) — the
    // left-truncation contract is proven by the CSS declarations themselves.
    expect(pathNode.style.direction).toBe("rtl");
    expect(pathNode.style.textAlign).toBe("left");
    expect(pathNode.style.textOverflow).toBe("ellipsis");
    expect(pathNode.style.whiteSpace).toBe("nowrap");
    // "project and task segments still present" — the tail of the path is what a left-truncation
    // preserves; asserting the full text is present is the DOM-level proof available under jsdom.
    expect(pathNode.textContent).toContain("threadfin-project/FLY-42-add-worktree-summary");
  });

  it("copying the path places the full untruncated path on the clipboard, not the elided string", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });

    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: LONG_PATH, status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    const copyButton = await screen.findByRole("button", { name: "Copy worktree path" });
    copyButton.click();

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(LONG_PATH));
  });

  it("renders an inline notice for a null branch while still rendering the path", async () => {
    const summary = { branch: null, path: "/Users/cyril/Flywheel/proj/FLY-42" } as unknown as WorktreeSummaryDto;
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    expect(await screen.findByText("Branch unavailable")).toBeInTheDocument();
    expect(screen.getByText("/Users/cyril/Flywheel/proj/FLY-42")).toBeInTheDocument();
  });

  it("renders an inline notice for a null path while still rendering the branch", async () => {
    const summary = { branch: "flywheel/fly-42", path: null } as unknown as WorktreeSummaryDto;
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    expect(await screen.findByText("Path unavailable")).toBeInTheDocument();
    expect(screen.getByText("flywheel/fly-42")).toBeInTheDocument();
  });

  it("renders no editor or terminal affordance", async () => {
    const summary: WorktreeSummaryDto = { branch: "flywheel/fly-42", path: "/Users/cyril/Flywheel/proj/FLY-42", status: "active" };
    worktreeSummaryMock.mockResolvedValue(summary);
    renderSummary();

    await screen.findByText("flywheel/fly-42");
    expect(screen.queryByRole("button", { name: /open in editor/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /open in terminal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reveal in finder/i })).not.toBeInTheDocument();
  });
});
