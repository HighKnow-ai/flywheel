/**
 * Behavior under test (03-01-PLAN.md Task 2, 03-UI-SPEC.md "Worktree removal", E1): every
 * porcelain status code prints an honest word (never a blank cell, never the raw code); the
 * refusal heading's plural is derived from `dirtyCount`, not `entries.length`; a 400-entry
 * response still renders every row inside a scrollable region with no cap and no "and N more";
 * a failed check renders the read-failure state with no Remove button; and a partial/unparseable
 * porcelain response renders the Dirty refusal rather than the Clean confirm.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WorktreeRemovalDialog } from "../WorktreeRemovalDialog";
import type { WorktreeRemovalCheckDto } from "../../adapters/tauri";

const worktreeRemovalCheckMock = vi.fn();
const worktreeRemoveMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  worktreeRemovalCheck: (taskId: string) => worktreeRemovalCheckMock(taskId),
  worktreeRemove: (taskId: string) => worktreeRemoveMock(taskId),
}));

function renderDialog(taskId = "task-1") {
  // `retry: false` — a rejected `worktreeRemovalCheck` must resolve to `isError` immediately;
  // TanStack Query's default 3-retry backoff would otherwise stretch the error test past a
  // reasonable `waitFor` timeout.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <WorktreeRemovalDialog taskId={taskId} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

function dirtyResponse(entries: WorktreeRemovalCheckDto["entries"]): WorktreeRemovalCheckDto {
  return { taskKey: "FLY-1", path: "/Users/cyril/Flywheel/FLY/FLY-1", branch: "flywheel/fly-1", entries, dirtyCount: entries.length };
}

describe("WorktreeRemovalDialog", () => {
  it("renders every porcelain status word, including the fallback for an unrecognized code", async () => {
    worktreeRemovalCheckMock.mockResolvedValue(
      dirtyResponse([
        { code: "M", path: "modified.txt" },
        { code: "A", path: "added.txt" },
        { code: "D", path: "deleted.txt" },
        { code: "??", path: "untracked.txt" },
        { code: "R", path: "renamed.txt" },
      ]),
    );
    renderDialog();

    expect(await screen.findByText("Modified")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Deleted")).toBeInTheDocument();
    expect(screen.getByText("Untracked")).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });

  it("reads the plural directly from dirtyCount, not entries.length", async () => {
    worktreeRemovalCheckMock.mockResolvedValue(dirtyResponse([{ code: "M", path: "one.txt" }]));
    renderDialog();

    expect(await screen.findByText("Can't remove — 1 uncommitted change")).toBeInTheDocument();
  });

  it("reads the plural form for a count greater than one", async () => {
    const entries = Array.from({ length: 7 }, (_, i) => ({ code: "M", path: `file-${i}.txt` }));
    worktreeRemovalCheckMock.mockResolvedValue(dirtyResponse(entries));
    renderDialog();

    expect(await screen.findByText("Can't remove — 7 uncommitted changes")).toBeInTheDocument();
  });

  it("renders 400 dirty entries inside a scrollable region with the OK button still reachable and no cap text", async () => {
    const entries = Array.from({ length: 400 }, (_, i) => ({ code: "M", path: `file-${i}.txt` }));
    worktreeRemovalCheckMock.mockResolvedValue(dirtyResponse(entries));
    renderDialog();

    await screen.findByText("Can't remove — 400 uncommitted changes");
    expect(screen.getAllByRole("listitem")).toHaveLength(400);
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
    expect(screen.queryByText(/and \d+ more/i)).not.toBeInTheDocument();
  });

  it("renders no Remove button when the check query settles in an error state", async () => {
    worktreeRemovalCheckMock.mockRejectedValue(new Error("boom"));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByText(/could not read this worktree's status/i)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "OK" })).toBeInTheDocument();
  });

  it("renders the Dirty refusal, never the Clean confirm, when the porcelain response is partial/unparseable", async () => {
    // dirtyCount > 0 but no parseable entries — a truncated/unparseable porcelain read.
    worktreeRemovalCheckMock.mockResolvedValue({
      taskKey: "FLY-1",
      path: "/Users/cyril/Flywheel/FLY/FLY-1",
      branch: "flywheel/fly-1",
      entries: [],
      dirtyCount: 3,
    } satisfies WorktreeRemovalCheckDto);
    renderDialog();

    expect(await screen.findByText("Can't remove — 3 uncommitted changes")).toBeInTheDocument();
    expect(screen.getByText("This list may be incomplete.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("renders the Clean confirm when the check comes back with zero dirty entries", async () => {
    worktreeRemovalCheckMock.mockResolvedValue(dirtyResponse([]));
    renderDialog();

    expect(await screen.findByText("Remove worktree for FLY-1?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});
