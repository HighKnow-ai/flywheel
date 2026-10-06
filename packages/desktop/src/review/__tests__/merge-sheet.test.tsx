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

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => {
    if (command === "criterion_list") return Promise.resolve(criteria.current.map((s) => s.criterion));
    if (command === "review_criteria_state") return Promise.resolve(criteria.current);
    if (command === "criterion_revisions") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected command ${command}`));
  },
  reviewCriteriaState: () => Promise.resolve(criteria.current),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  reviewFiles: () =>
    Promise.resolve({
      target: { state: "resolved", postMerge: false, base: "flywheel/epic", head: "flywheel/task", projectId: "p1", epicId: "e1", taskId: "t1" },
      files: [{ path: "src/lib.rs", oldPath: null, status: "M", added: 1, removed: 1, binary: false }],
    }),
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

function renderSurface() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSurface scope="task" itemId="t1" label="FLY-9 Add retry" onBack={() => {}} />
    </QueryClientProvider>,
  );
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
