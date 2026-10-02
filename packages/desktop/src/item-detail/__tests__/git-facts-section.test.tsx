/**
 * Behavior under test (07-01-PLAN.md Task 3, LINK-02/LINK-09): a task whose `git_facts` resolves
 * to `null` renders nothing; `ahead: 0, behind: 0` renders an up-to-date reading, not a blank; a
 * non-resolving target renders a sentence naming it and no numeric figure; every rendered
 * ahead/behind figure carries its fetch age; an empty commit list renders the branch row without
 * error; a truncated commit count renders a "+N earlier commits" line; uncommitted changes render
 * using the removal dialog's own status words; and opening/closing the panel calls the focus
 * command with the task id, then `null`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GitFactsSection } from "../GitFactsSection";
import type { GitFactsDto } from "../../adapters/tauri";

const gitFactsMock = vi.fn();
const gitTruthFocusTaskMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  gitFacts: (taskId: string) => gitFactsMock(taskId),
  gitTruthFocusTask: (taskId: string | null) => gitTruthFocusTaskMock(taskId),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

function renderSection(taskId = "task-1") {
  const queryClient = new QueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <GitFactsSection taskId={taskId} />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

function baseFacts(overrides: Partial<GitFactsDto> = {}): GitFactsDto {
  return {
    branch: "flywheel/fly-42-add-git-facts",
    worktreePath: "/Users/cyril/Flywheel/proj/FLY-42",
    targetRef: "origin/main",
    ahead: 0,
    behind: 0,
    lastFetchAt: null,
    commits: [],
    commitsTruncated: 0,
    uncommitted: [],
    ...overrides,
  };
}

beforeEach(() => {
  gitFactsMock.mockReset();
  gitTruthFocusTaskMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("GitFactsSection", () => {
  it("renders nothing at all for a task with no worktree", async () => {
    gitFactsMock.mockResolvedValue(null);
    const { container } = renderSection();

    await waitFor(() => expect(gitFactsMock).toHaveBeenCalledWith("task-1"));
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing while the read is in flight", () => {
    gitFactsMock.mockReturnValue(new Promise(() => {}));
    const { container } = renderSection();

    expect(container).toBeEmptyDOMElement();
  });

  it("renders an up-to-date reading, not a blank, for ahead: 0, behind: 0", async () => {
    gitFactsMock.mockResolvedValue(baseFacts({ ahead: 0, behind: 0, lastFetchAt: null }));
    renderSection();

    expect(await screen.findByText(/up to date/i)).toBeInTheDocument();
  });

  it("withholds the figure and names the target when ahead/behind cannot be measured", async () => {
    gitFactsMock.mockResolvedValue(
      baseFacts({ ahead: null, behind: null, targetRef: "origin/flywheel/epic/fly-9" }),
    );
    renderSection();

    expect(await screen.findByText(/not reachable locally/i)).toBeInTheDocument();
    expect(screen.getByText("origin/flywheel/epic/fly-9")).toBeInTheDocument();
    expect(screen.queryByText(/ahead/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+ behind/i)).not.toBeInTheDocument();
  });

  it("pairs a rendered ahead/behind figure with its fetch age in one line, 'never fetched' when null", async () => {
    gitFactsMock.mockResolvedValue(baseFacts({ ahead: 2, behind: 1, lastFetchAt: null }));
    renderSection();

    const line = await screen.findByText(/2 ahead, 1 behind/i);
    expect(line.textContent).toMatch(/never fetched/i);
  });

  it("pairs a rendered ahead/behind figure with a real fetch age when lastFetchAt is set", async () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    gitFactsMock.mockResolvedValue(baseFacts({ ahead: 3, behind: 0, lastFetchAt: fiveMinutesAgo }));
    renderSection();

    const line = await screen.findByText(/3 ahead, 0 behind/i);
    expect(line.textContent).toMatch(/as of \d+m ago/i);
  });

  it("renders the branch row with an empty commit list, not an error, when there are no commits", async () => {
    gitFactsMock.mockResolvedValue(baseFacts({ commits: [] }));
    renderSection();

    expect(await screen.findByText("flywheel/fly-42-add-git-facts")).toBeInTheDocument();
    expect(screen.queryByText(/earlier commits/i)).not.toBeInTheDocument();
  });

  it("renders a commit row for each commit and a +N earlier commits line when truncated", async () => {
    gitFactsMock.mockResolvedValue(
      baseFacts({
        commits: [
          { sha: "a".repeat(40), shortSha: "aaaaaaa", subject: "add feature", committedAt: new Date().toISOString() },
          { sha: "b".repeat(40), shortSha: "bbbbbbb", subject: "fix bug", committedAt: new Date().toISOString() },
        ],
        commitsTruncated: 7,
      }),
    );
    renderSection();

    expect(await screen.findByText("add feature")).toBeInTheDocument();
    expect(screen.getByText("fix bug")).toBeInTheDocument();
    expect(screen.getByText("aaaaaaa")).toBeInTheDocument();
    expect(screen.getByText("+7 earlier commits")).toBeInTheDocument();
  });

  it("renders no change rows for an empty uncommitted list", async () => {
    gitFactsMock.mockResolvedValue(baseFacts({ uncommitted: [] }));
    renderSection();

    await screen.findByText("flywheel/fly-42-add-git-facts");
    expect(screen.queryByText("Modified")).not.toBeInTheDocument();
    expect(screen.queryByText("Untracked")).not.toBeInTheDocument();
  });

  it("renders one row per uncommitted entry using the removal dialog's own status words", async () => {
    gitFactsMock.mockResolvedValue(
      baseFacts({
        uncommitted: [
          { code: "M ", path: "src/app.ts" },
          { code: "??", path: "src/new.ts" },
        ],
      }),
    );
    renderSection();

    expect(await screen.findByText("Modified")).toBeInTheDocument();
    expect(screen.getByText("src/app.ts")).toBeInTheDocument();
    expect(screen.getByText("Untracked")).toBeInTheDocument();
    expect(screen.getByText("src/new.ts")).toBeInTheDocument();
  });

  it("calls the focus command with the task id on mount and with null on unmount", async () => {
    gitFactsMock.mockResolvedValue(baseFacts());
    const { unmount } = renderSection("task-focus-1");

    await waitFor(() => expect(gitTruthFocusTaskMock).toHaveBeenCalledWith("task-focus-1"));

    unmount();

    await waitFor(() => expect(gitTruthFocusTaskMock).toHaveBeenCalledWith(null));
  });
});
