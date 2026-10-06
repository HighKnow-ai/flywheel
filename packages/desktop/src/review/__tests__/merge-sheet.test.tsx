/**
 * Behavior under test (08-07-PLAN.md, REVW-04, D-146, D-122): the review surface offers a Merge
 * action only for a task whose precheck resolved; the confirm sheet states every consequence
 * before the write (source, target, counts, criteria without evidence, uncommitted files, will
 * conflict); opening and cancelling write nothing; confirming passes the task id alone.
 *
 * The adapter mock lists ONLY what the surface and the sheet may call. There is no status setter
 * in it, and `invokeCommand` rejects any command it does not know, so an attempt to move a board
 * item's status fails structurally rather than as a soft assertion (D-122).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewSurface } from "../ReviewSurface";
import type {
  AcceptanceCriterionDto,
  MergePreviewDto,
  ReviewCriterionStateDto,
} from "../../adapters/tauri";

const criteria = { current: [] as ReviewCriterionStateDto[] };
const gitFactsResult = { current: { uncommitted: [] as unknown[] } as { uncommitted: unknown[] } | null };
const precheck = { current: null as MergePreviewDto | null };
const precheckMock = vi.fn();
const mergeMock = vi.fn();
const startRunMock = vi.fn();
const openEditorMock = vi.fn();
const filesMock = vi.fn();
const commandsSeen: string[] = [];
const integratedNow = { current: false };
const boardChanged = new Set<() => void>();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => {
    commandsSeen.push(command);
    if (command === "criterion_list") return Promise.resolve(criteria.current.map((s) => s.criterion));
    if (command === "review_criteria_state") return Promise.resolve(criteria.current);
    if (command === "criterion_revisions") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected command ${command}`));
  },
  reviewCriteriaState: () => Promise.resolve(criteria.current),
  subscribeBoardChanged: (handler: () => void) => {
    boardChanged.add(handler);
    return Promise.resolve(() => boardChanged.delete(handler));
  },
  startAgentRun: (...args: unknown[]) => startRunMock(...args),
  worktreeOpen: (...args: unknown[]) => openEditorMock(...args),
  reviewFiles: () => {
    filesMock();
    return Promise.resolve({
      target: {
        state: "resolved",
        postMerge: integratedNow.current,
        base: "flywheel/epic",
        head: "flywheel/task",
        projectId: "p1",
        epicId: "e1",
        taskId: "t1",
      },
      files: [{ path: "src/lib.rs", oldPath: null, status: "M", added: 1, removed: 1, binary: false }],
    });
  },
  reviewFilePatch: () => Promise.resolve(""),
  criterionCheckWithAnchor: () => Promise.resolve(),
  gitFacts: () => Promise.resolve(gitFactsResult.current),
  reviewMergePrecheck: (taskId: string) => {
    precheckMock(taskId);
    return Promise.resolve(precheck.current);
  },
  reviewMergeTask: (...args: unknown[]) => mergeMock(...args),
}));

function ready(overrides: Partial<Extract<MergePreviewDto, { state: "ready" }>> = {}): MergePreviewDto {
  return {
    state: "ready",
    epicKey: "FLY-7",
    sourceBranch: "flywheel/fly-9-add-retry",
    targetBranch: "flywheel/fly-7-integration",
    commitCount: 3,
    fileCount: 2,
    conflictedFiles: [],
    ...overrides,
  };
}

let nextId = 0;
function criterion(overrides: { checked?: boolean; anchored?: boolean } = {}): ReviewCriterionStateDto {
  nextId += 1;
  const id = `c${nextId}`;
  const base: AcceptanceCriterionDto = {
    id,
    parentType: "task",
    parentId: "t1",
    statement: `Criterion ${id}`,
    verificationHint: null,
    checked: overrides.checked ?? true,
    rank: String(nextId),
    revision: 1,
    revisionOf: null,
    supersededAt: null,
  };
  return {
    criterion: base,
    anchor: overrides.anchored
      ? { path: "src/lib.rs", side: "new", lineStart: 1, lineEnd: 2, sha: "abcdef1234567890" }
      : null,
    staleness: null,
  };
}

const onBack = vi.fn();
const onOpenSession = vi.fn();

function renderSurface() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSurface scope="task" itemId="t1" label="FLY-9 Add retry" onBack={onBack} onOpenSession={onOpenSession} />
    </QueryClientProvider>,
  );
}

/** Open the sheet, wait for its figures, confirm, and return the dialog. */
async function confirmMerge() {
  const dialog = await openSheet();
  await within(dialog).findByText(/3 commits/);
  fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
  return dialog;
}

/** What the real app does on `board:changed`: every live read is invalidated and refetched. */
async function fireBoardChanged() {
  boardChanged.forEach((handler) => handler());
}

async function openSheet() {
  fireEvent.click(await screen.findByRole("button", { name: "Merge" }));
  return screen.findByRole("dialog", { name: "Merge sheet" });
}

beforeEach(() => {
  criteria.current = [];
  gitFactsResult.current = { uncommitted: [] };
  precheck.current = ready();
  precheckMock.mockClear();
  mergeMock.mockReset();
  startRunMock.mockReset();
  openEditorMock.mockReset();
  openEditorMock.mockResolvedValue(undefined);
  filesMock.mockClear();
  onBack.mockClear();
  onOpenSession.mockClear();
  commandsSeen.length = 0;
  integratedNow.current = false;
  boardChanged.clear();
  nextId = 0;
});

describe("the Merge action", () => {
  it("is offered for a task whose precheck resolved", async () => {
    renderSurface();
    expect(await screen.findByRole("button", { name: "Merge" })).toBeInTheDocument();
  });

  it("is not offered when the precheck refused, and the nothing-to-merge refusal is stated", async () => {
    precheck.current = { state: "refused", category: "nothingToMerge" };
    renderSurface();
    expect(await screen.findByText(/Nothing to merge/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
  });

  it("is not offered to an epic-less task, and the surface names the task-level request path", async () => {
    precheck.current = { state: "refused", category: "noEpic" };
    renderSurface();
    expect(await screen.findByText(/needs an epic with a cut integration branch/)).toBeInTheDocument();
    expect(screen.getByText(/open a request for it from the item panel/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
  });
});

describe("the confirm sheet", () => {
  it("shows the source branch, the target branch and the commit and file counts", async () => {
    renderSurface();
    const dialog = await openSheet();
    expect(await within(dialog).findByText(/Merge flywheel\/fly-9-add-retry → flywheel\/fly-7-integration/)).toBeInTheDocument();
    expect(within(dialog).getByText(/3 commits, 2 files, into FLY-7/)).toBeInTheDocument();
  });

  it("states how many criteria were checked without evidence", async () => {
    criteria.current = [criterion(), criterion(), criterion({ anchored: true })];
    renderSurface();
    const dialog = await openSheet();
    expect(await within(dialog).findByText("2 criteria checked without evidence.")).toBeInTheDocument();
  });

  it("omits the no-evidence line when every checked criterion has evidence", async () => {
    criteria.current = [criterion({ anchored: true }), criterion({ checked: false })];
    renderSurface();
    const dialog = await openSheet();
    await within(dialog).findByText(/3 commits/);
    expect(within(dialog).queryByText(/checked without evidence/)).not.toBeInTheDocument();
  });

  it("warns about uncommitted files and says a merge will not carry them", async () => {
    gitFactsResult.current = { uncommitted: [{ code: "M", path: "a.txt" }, { code: "??", path: "b.txt" }, { code: "M", path: "c.txt" }] };
    renderSurface();
    const dialog = await openSheet();
    expect(await within(dialog).findByText(/3 files uncommitted in the worktree/)).toBeInTheDocument();
    expect(within(dialog).getByText(/a merge will not carry them/)).toBeInTheDocument();
  });

  it("shows no uncommitted warning for a clean worktree", async () => {
    renderSurface();
    const dialog = await openSheet();
    await within(dialog).findByText(/3 commits/);
    expect(within(dialog).queryByText(/uncommitted/)).not.toBeInTheDocument();
  });

  it("shows a will-conflict hint naming the conflicted files", async () => {
    precheck.current = ready({ conflictedFiles: ["src/a.rs", "src/b.rs"] });
    renderSurface();
    const dialog = await openSheet();
    expect(await within(dialog).findByText(/Will conflict in 2 files/)).toBeInTheDocument();
    expect(within(dialog).getByText("src/a.rs")).toBeInTheDocument();
    expect(within(dialog).getByText("src/b.rs")).toBeInTheDocument();
  });

  it("opening the sheet performs no write", async () => {
    renderSurface();
    const dialog = await openSheet();
    await within(dialog).findByText(/3 commits/);
    expect(mergeMock).not.toHaveBeenCalled();
  });

  it("cancelling makes no further call and closes the sheet", async () => {
    renderSurface();
    const dialog = await openSheet();
    await within(dialog).findByText(/3 commits/);
    const readsBefore = precheckMock.mock.calls.length;
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Merge sheet" })).not.toBeInTheDocument());
    expect(mergeMock).not.toHaveBeenCalled();
    expect(precheckMock.mock.calls.length).toBe(readsBefore);
  });

  it("confirming calls the merge command with the task id alone", async () => {
    mergeMock.mockReturnValue(new Promise(() => {}));
    renderSurface();
    const dialog = await openSheet();
    await within(dialog).findByText(/3 commits/);
    fireEvent.click(within(dialog).getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(mergeMock).toHaveBeenCalledTimes(1));
    const args = mergeMock.mock.calls[0];
    expect(args).toHaveLength(1);
    expect(args[0]).toBe("t1");
  });

  it("renders no Merge action while the merge is in flight, and a second activation does nothing", async () => {
    mergeMock.mockReturnValue(new Promise(() => {}));
    renderSurface();
    const dialog = await openSheet();
    await within(dialog).findByText(/3 commits/);
    const confirm = within(dialog).getByRole("button", { name: "Merge" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    expect(await within(dialog).findByText("Merging…")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge" })).not.toBeInTheDocument();
    expect(mergeMock).toHaveBeenCalledTimes(1);
  });
});

describe("the three outcomes", () => {
  it("reports a success as integrated into the epic, naming the merge commit, and pushes nothing", async () => {
    mergeMock.mockResolvedValue({
      kind: "merged",
      epicKey: "FLY-7",
      targetBranch: "flywheel/fly-7-integration",
      mergeCommit: "0123456789abcdef0123456789abcdef01234567",
    });
    renderSurface();
    const dialog = await confirmMerge();
    expect(await within(dialog).findByText(/Integrated into FLY-7/)).toBeInTheDocument();
    expect(within(dialog).getByText("0123456")).toBeInTheDocument();
    expect(within(dialog).getByText(/Nothing was pushed/)).toBeInTheDocument();
  });

  it("raises the integrated mark on the task once the surface's reads refresh", async () => {
    mergeMock.mockImplementation(() => {
      integratedNow.current = true;
      return Promise.resolve({ kind: "merged", epicKey: "FLY-7", targetBranch: "t", mergeCommit: "0123456789abcdef" });
    });
    renderSurface();
    expect(screen.queryByText("Integrated")).not.toBeInTheDocument();
    await confirmMerge();
    await screen.findByText(/Integrated into FLY-7/);
    await fireBoardChanged();
    expect(await screen.findByText("Integrated")).toBeInTheDocument();
  });

  it("refreshes the surface's own reads after an outcome with no manual action", async () => {
    mergeMock.mockResolvedValue({ kind: "merged", epicKey: "FLY-7", targetBranch: "t", mergeCommit: "0123456789abcdef" });
    renderSurface();
    await confirmMerge();
    await screen.findByText(/Integrated into FLY-7/);
    const before = filesMock.mock.calls.length;
    await fireBoardChanged();
    await waitFor(() => expect(filesMock.mock.calls.length).toBeGreaterThan(before));
  });

  it("moves no status: nothing outside the criteria and review reads is ever invoked", async () => {
    mergeMock.mockResolvedValue({ kind: "merged", epicKey: "FLY-7", targetBranch: "t", mergeCommit: "0123456789abcdef" });
    renderSurface();
    await confirmMerge();
    await screen.findByText(/Integrated into FLY-7/);
    expect(commandsSeen.filter((c) => /status/i.test(c.replace("review_criteria_state", "")))).toEqual([]);
  });

  it("reports an already-integrated result with no merge commit", async () => {
    mergeMock.mockResolvedValue({ kind: "alreadyIntegrated" });
    renderSurface();
    const dialog = await confirmMerge();
    expect(await within(dialog).findByText(/Nothing was merged/)).toBeInTheDocument();
    expect(within(dialog).getByText(/is already contained in/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/merge commit/)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Integrated into/)).not.toBeInTheDocument();
  });

  it("reports a conflict as aborted with nothing changed, listing every conflicted file", async () => {
    mergeMock.mockResolvedValue({ kind: "conflicted", files: ["src/a.rs", "src/b.rs", "docs/c.md"] });
    renderSurface();
    const dialog = await confirmMerge();
    expect(await within(dialog).findByText(/Merge aborted — 3 conflicts, nothing changed/)).toBeInTheDocument();
    for (const path of ["src/a.rs", "src/b.rs", "docs/c.md"]) {
      expect(within(dialog).getByText(path)).toBeInTheDocument();
    }
  });

  it("starts a resolving session with the conflict as its brief, clearing the review surface first", async () => {
    mergeMock.mockResolvedValue({ kind: "conflicted", files: ["src/a.rs", "src/b.rs"] });
    startRunMock.mockResolvedValue({ id: "run-1", taskId: "t1", status: "running", permissionMode: "acceptEdits" });
    renderSurface();
    const dialog = await confirmMerge();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Start a session to resolve" }));
    await waitFor(() => expect(onOpenSession).toHaveBeenCalledTimes(1));

    const [taskId, mode, brief] = startRunMock.mock.calls[0];
    expect(taskId).toBe("t1");
    expect(mode).toBe("acceptEdits");
    expect(brief).toContain("src/a.rs");
    expect(brief).toContain("src/b.rs");
    expect(brief).toContain("flywheel/fly-7-integration");
    expect(onOpenSession).toHaveBeenCalledWith("run-1", null, null);
    // The surface clears itself BEFORE the session takes the screen.
    expect(onBack.mock.invocationCallOrder[0]).toBeLessThan(onOpenSession.mock.invocationCallOrder[0]);
  });

  it("opens the task's worktree in the editor through the existing affordance", async () => {
    mergeMock.mockResolvedValue({ kind: "conflicted", files: ["src/a.rs"] });
    renderSurface();
    const dialog = await confirmMerge();
    fireEvent.click(await within(dialog).findByRole("button", { name: "Open in editor" }));
    await waitFor(() => expect(openEditorMock).toHaveBeenCalledWith("t1", "editor"));
  });

  it("names a merge already running for the epic and offers no retry", async () => {
    mergeMock.mockRejectedValue("mergeInFlight:FLY-7");
    renderSurface();
    const dialog = await confirmMerge();
    expect(await within(dialog).findByText(/A merge into FLY-7 is already running/)).toBeInTheDocument();
    const buttons = within(dialog).getAllByRole("button");
    expect(buttons.map((b) => b.textContent)).toEqual(["Close"]);
  });

  it("reports a failed merge without raw git output", async () => {
    mergeMock.mockRejectedValue("mergeFailed");
    renderSurface();
    const dialog = await confirmMerge();
    expect(await within(dialog).findByText(/The merge did not complete and nothing was recorded/)).toBeInTheDocument();
  });

  it("says plainly when a merge landed in git but could not be recorded", async () => {
    mergeMock.mockRejectedValue("eventNotRecorded");
    renderSurface();
    const dialog = await confirmMerge();
    expect(await within(dialog).findByText(/landed in git, but Flywheel could not record it/)).toBeInTheDocument();
  });

  it("never shows an unrecognised rejection's raw text", async () => {
    mergeMock.mockRejectedValue("fatal: could not read from remote repository /private/path");
    renderSurface();
    const dialog = await confirmMerge();
    expect(await within(dialog).findByText("The merge could not be started.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/private\/path/)).not.toBeInTheDocument();
  });
});
