/**
 * Behavior under test (08-06-PLAN.md, REVW-03, D-134/D-139/D-140/D-141): the criteria rail composes
 * the item panel's own criteria list and shows each checked criterion's evidence, its freshness or
 * the fact that it has none, with a footer counting the checks that carry no evidence.
 *
 * The adapter mock lists ONLY what the rail may call; `invokeCommand` throws on any command it does
 * not know, so a status setter or any other write fails structurally (T-08-06-02).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CriteriaRail } from "../CriteriaRail";
import { ReviewSurface } from "../ReviewSurface";
import { bindingAllowedInLayer } from "../../state/keyboard";
import { AcceptanceCriteriaList } from "../../item-detail/AcceptanceCriteriaList";
import type { AcceptanceCriterionDto, EpicTaskRollupRowDto, ReviewCriterionStateDto } from "../../adapters/tauri";

const state = { current: [] as ReviewCriterionStateDto[] };
const checkMock = vi.fn();
const rollupMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => {
    if (command === "criterion_list") return Promise.resolve(state.current.map((s) => s.criterion));
    if (command === "review_criteria_state") return Promise.resolve(state.current);
    if (command === "criterion_revisions") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected command ${command}`));
  },
  reviewCriteriaState: () => Promise.resolve(state.current),
  reviewEpicTaskRollup: (...args: unknown[]) => rollupMock(...args),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  // The merge precheck (plan 08-07) is not under test here; it never resolves, so no merge action renders.
  reviewMergePrecheck: () => new Promise(() => {}),
  // The decline read (A-08(a), plan 08.1-21) is not under test here; it never resolves, so no decline UI renders.
  reviewChangesRequestState: () => new Promise(() => {}),
  reviewFiles: () =>
    Promise.resolve({
      target: { state: "resolved", postMerge: false, base: "epic", head: "task", projectId: "p1", epicId: "e1", taskId: "t1" },
      files: ["src/lib.rs", "src/other.rs"].map((path) => ({
        path,
        oldPath: null,
        status: "M",
        added: 1,
        removed: 1,
        binary: false,
      })),
    }),
  reviewFilePatch: () => Promise.resolve(PATCH),
  criterionCheckWithAnchor: (args: unknown) => {
    checkMock(args);
    return checkImpl.current(args as CheckArgs);
  },
}));

const PATCH = `diff --git a/src/lib.rs b/src/lib.rs
index 1111111..2222222 100644
--- a/src/lib.rs
+++ b/src/lib.rs
@@ -1,3 +1,3 @@
 fn main() {
-    let x = 1;
+    let x = 2;
 }
`;

interface CheckArgs {
  criterionId: string;
  anchor?: { path: string; side: "old" | "new"; lineStart: number; lineEnd: number };
}
/** Mirrors the core: a check sets checked and upserts the anchor (the sha is the core's). */
const checkImpl = {
  current: (args: CheckArgs): Promise<void> => {
    const sha = "0123456789abcdef";
    state.current = state.current.map((s) =>
      s.criterion.id !== args.criterionId
        ? s
        : {
            ...s,
            criterion: { ...s.criterion, checked: true },
            anchor: args.anchor ? { ...args.anchor, sha } : s.anchor,
          },
    );
    return Promise.resolve();
  },
};

const sha = "abcdef1234567890";
let nextId = 0;
function entry(
  overrides: {
    criterion?: Partial<AcceptanceCriterionDto>;
    anchor?: Partial<NonNullable<ReviewCriterionStateDto["anchor"]>> | null;
    staleness?: ReviewCriterionStateDto["staleness"];
  } = {},
): ReviewCriterionStateDto {
  nextId += 1;
  const id = `c${nextId}`;
  return {
    criterion: {
      id,
      parentType: "task",
      parentId: "t1",
      statement: `Criterion ${id}`,
      verificationHint: null,
      checked: true,
      rank: String(nextId),
      revision: 1,
      revisionOf: null,
      supersededAt: null,
      ...overrides.criterion,
    },
    anchor:
      overrides.anchor === null
        ? null
        : { path: "src/lib.rs", side: "new", lineStart: 10, lineEnd: 14, sha, ...overrides.anchor },
    staleness: overrides.staleness ?? null,
  };
}

function renderRail(scope: "task" | "epic" = "task", itemId = "t1") {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CriteriaRail scope={scope} itemId={itemId} selection={null} onCheck={() => {}} onFocusChange={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.current = [];
  nextId = 0;
  checkMock.mockClear();
  rollupMock.mockReset();
  rollupMock.mockResolvedValue([]);
  opened = 0;
});

describe("CriteriaRail epic roll-up (D-132)", () => {
  const row = (over: Partial<EpicTaskRollupRowDto>): EpicTaskRollupRowDto => ({
    taskId: "t1",
    key: "FLY-1",
    title: "First task",
    status: "todo",
    checked: 2,
    total: 3,
    withEvidence: 1,
    withoutEvidence: 1,
    ...over,
  });

  it("lists every task of the epic with its checked-of-total and without-evidence counts", async () => {
    rollupMock.mockResolvedValue([row({}), row({ taskId: "t2", key: "FLY-2", title: "Second task", checked: 0, total: 0, withEvidence: 0, withoutEvidence: 0 })]);
    renderRail("epic", "e1");
    const region = await screen.findByRole("region", { name: "Task criteria roll-up" });
    expect(within(region).getByText("FLY-1")).toBeInTheDocument();
    expect(within(region).getByText(/First task/)).toBeInTheDocument();
    expect(within(region).getByText(/2\/3 criteria checked, 1 without evidence/)).toBeInTheDocument();
    expect(within(region).getByText("FLY-2")).toBeInTheDocument();
    expect(within(region).getByText("no criteria")).toBeInTheDocument();
    expect(rollupMock).toHaveBeenCalledWith("e1");
  });

  it("renders no section and issues no roll-up read in task scope", async () => {
    rollupMock.mockResolvedValue([row({})]);
    renderRail("task", "t1");
    await screen.findByText("Acceptance criteria");
    expect(screen.queryByRole("region", { name: "Task criteria roll-up" })).toBeNull();
    expect(rollupMock).not.toHaveBeenCalled();
  });

  it("renders nothing at all for an epic with no tasks — no heading, no placeholder", async () => {
    renderRail("epic", "e1");
    await screen.findByText("Acceptance criteria");
    await waitFor(() => expect(rollupMock).toHaveBeenCalled());
    expect(screen.queryByRole("region", { name: "Task criteria roll-up" })).toBeNull();
    expect(screen.queryByText("Tasks")).toBeNull();
  });
});

describe("CriteriaRail", () => {
  it("renders its header even when the item has zero criteria", async () => {
    renderRail();
    expect(await screen.findByText("Acceptance criteria")).toBeInTheDocument();
    expect(screen.getByText("0/0")).toBeInTheDocument();
  });

  it("renders a checked anchored criterion's path, range and short sha", async () => {
    state.current = [entry()];
    renderRail();
    expect(await screen.findByText(/src\/lib\.rs:10–14 \(new\) @ abcdef1/)).toBeInTheDocument();
    expect(screen.queryByText("No evidence")).not.toBeInTheDocument();
  });

  it("renders the no-evidence marker for a checked criterion with no anchor", async () => {
    state.current = [entry({ anchor: null })];
    renderRail();
    expect(await screen.findByText("No evidence")).toBeInTheDocument();
  });

  it("renders neither an evidence clause nor a no-evidence marker for an unchecked criterion", async () => {
    state.current = [entry({ criterion: { checked: false }, anchor: null })];
    renderRail();
    await screen.findByText("Criterion c1");
    expect(screen.queryByText("No evidence")).not.toBeInTheDocument();
    expect(screen.queryByText(/@ /)).not.toBeInTheDocument();
  });

  it("renders the fresh marker when the anchor's file is untouched", async () => {
    state.current = [entry({ staleness: { state: "untouched", commits: null } })];
    renderRail();
    expect(await screen.findByText("Evidence current")).toBeInTheDocument();
  });

  it("renders the stale marker naming the commit count, and the criterion stays checked", async () => {
    state.current = [entry({ staleness: { state: "changed", commits: 3 } })];
    renderRail();
    expect(await screen.findByText(/Evidence changed — 3 commits since/)).toBeInTheDocument();
    expect(screen.getByRole("listitem", { name: /, checked$/ })).toBeInTheDocument();
  });

  it("renders the stale marker for a moved-or-changed file", async () => {
    state.current = [entry({ staleness: { state: "movedOrChanged", commits: null } })];
    renderRail();
    expect(await screen.findByText(/Evidence changed — file moved or changed/)).toBeInTheDocument();
  });

  it("never renders the fresh marker for an unknown staleness, and says the commit is gone", async () => {
    state.current = [entry({ staleness: { state: "unknown", commits: null } })];
    renderRail();
    expect(await screen.findByText(/recorded commit can no longer be found/)).toBeInTheDocument();
    expect(screen.queryByText("Evidence current")).not.toBeInTheDocument();
  });

  it("counts criteria checked without evidence in the footer", async () => {
    state.current = [entry({ anchor: null }), entry({ anchor: null }), entry()];
    renderRail();
    expect(await screen.findByText("2 criteria checked without evidence")).toBeInTheDocument();
  });

  it("renders no footer count when every checked criterion has evidence", async () => {
    state.current = [entry(), entry({ criterion: { checked: false }, anchor: null })];
    renderRail();
    await screen.findByText("Criterion c1");
    expect(screen.queryByText(/checked without evidence/)).not.toBeInTheDocument();
  });

  it("still renders a revised criterion's revision marker from the shared row", async () => {
    state.current = [entry({ criterion: { revision: 2, revisionOf: "root" } })];
    renderRail();
    expect(await screen.findByRole("button", { name: "Show prior wording" })).toBeInTheDocument();
  });
});

describe("the item panel's own criteria list (D-140)", () => {
  it("renders the no-evidence marker for a checked criterion with no anchor", async () => {
    state.current = [entry({ anchor: null })];
    render(
      <QueryClientProvider client={new QueryClient()}>
        <AcceptanceCriteriaList parentType="task" parentId="t1" />
      </QueryClientProvider>,
    );
    expect(await screen.findByText("No evidence")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------------------------
// Select lines, then check (Task 2, D-139/D-140)
// ---------------------------------------------------------------------------------------------

function renderSurface() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSurface scope="task" itemId="t1" label="FLY-1 A task" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

let opened = 0; // diffs open so far in this render; reset per test
async function openFile(name: string) {
  const row = await screen.findByRole("button", { name: new RegExp(name.replace(".", "\\.")) });
  fireEvent.click(row);
  await waitFor(() => expect(document.querySelectorAll("table.review-diff").length).toBeGreaterThan(opened));
  opened += 1;
}

/** The gutter cell of the nth change of a kind (insert / delete / normal) in the first open diff. */
function gutter(kind: "insert" | "delete" | "normal", n = 0): HTMLElement {
  const cells = document.querySelectorAll<HTMLElement>(`.diff-gutter-${kind}`);
  const cell = cells[n * 2 + (kind === "delete" ? 0 : 1)] ?? cells[n];
  if (!cell) throw new Error(`no ${kind} gutter`);
  return cell;
}

function selectedRows() {
  return document.querySelectorAll(".diff-gutter-selected");
}

/** Focus the first criterion with the list's own `j`, as a keyboard user would. */
function focusFirstCriterion() {
  fireEvent.keyDown(screen.getByRole("list", { name: "Criteria" }), { key: "j" });
}

function checkButton() {
  return screen.getByRole("button", { name: /against the selected lines/ });
}

describe("select lines, then check", () => {
  beforeEach(() => {
    state.current = [entry({ criterion: { checked: false }, anchor: null })];
  });

  it("adds a clicked change to the selection and renders it selected, then removes it on a second click", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    expect(selectedRows().length).toBe(0);
    fireEvent.click(gutter("insert"));
    expect(selectedRows().length).toBeGreaterThan(0);
    fireEvent.click(gutter("insert"));
    expect(selectedRows().length).toBe(0);
  });

  it("selecting lines alone writes nothing (T-08-06-01)", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("insert"));
    fireEvent.click(gutter("delete"));
    await screen.findByText(/Selected: src\/lib\.rs/);
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("records the selected path, range and new side when a criterion is checked against it", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("normal", 0)); // ` fn main() {` -> new line 1
    fireEvent.click(gutter("insert")); // new line 2
    fireEvent.click(checkButton());
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    const args = checkMock.mock.calls[0][0];
    expect(args).toMatchObject({
      scope: "task",
      itemId: "t1",
      criterionId: "c1",
      anchor: { path: "src/lib.rs", side: "new", lineStart: 1, lineEnd: 2 },
    });
  });

  it("passes no sha — the core resolves it", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("insert"));
    fireEvent.click(checkButton());
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    const args = checkMock.mock.calls[0][0];
    expect(args).not.toHaveProperty("sha");
    expect(args.anchor).not.toHaveProperty("sha");
  });

  it("anchors a deletion-only selection to the old side", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("delete"));
    fireEvent.click(checkButton());
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(checkMock.mock.calls[0][0].anchor).toMatchObject({ side: "old", lineStart: 2, lineEnd: 2 });
  });

  it("anchors a mixed deletion-and-insertion selection to the new side", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("delete"));
    fireEvent.click(gutter("insert"));
    fireEvent.click(checkButton());
    await waitFor(() => expect(checkMock).toHaveBeenCalled());
    expect(checkMock.mock.calls[0][0].anchor).toMatchObject({ side: "new", lineStart: 2, lineEnd: 2 });
  });

  it("checks with no selection and omits the anchor fields entirely", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(checkButton());
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    const args = checkMock.mock.calls[0][0];
    expect(args).not.toHaveProperty("anchor");
    expect(Object.keys(args).sort()).toEqual(["criterionId", "itemId", "scope"]);
  });

  it("shows the criterion checked with its evidence after the check, without a manual refresh", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("insert"));
    fireEvent.click(checkButton());
    expect(await screen.findByText(/src\/lib\.rs:2 \(new\) @ 0123456/)).toBeInTheDocument();
    expect(screen.queryByText("No evidence")).not.toBeInTheDocument();
  });

  it("shows a plain check as no evidence after the check", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(checkButton());
    expect(await screen.findByText("No evidence")).toBeInTheDocument();
    expect(await screen.findByText("1 criterion checked without evidence")).toBeInTheDocument();
  });

  it("replaces a criterion's anchor when it is checked again against a new selection", async () => {
    state.current = [entry({ anchor: { path: "src/lib.rs", lineStart: 1, lineEnd: 1 } })];
    renderSurface();
    await openFile("src/lib.rs");
    await screen.findByText(/src\/lib\.rs:1 \(new\) @ abcdef1/);
    fireEvent.click(gutter("insert"));
    fireEvent.click(checkButton());
    expect(await screen.findByText(/src\/lib\.rs:2 \(new\) @ 0123456/)).toBeInTheDocument();
  });

  it("replaces the selection when a change in a second file is selected", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("insert"));
    await screen.findByText(/Selected: src\/lib\.rs:2/);
    await openFile("src/other.rs");
    const second = document.querySelectorAll<HTMLElement>("table.review-diff")[1];
    fireEvent.click(second.querySelectorAll<HTMLElement>(".diff-gutter-delete")[0]);
    expect(await screen.findByText(/Selected: src\/other\.rs:2 \(old\)/)).toBeInTheDocument();
    expect(screen.queryByText(/Selected: src\/lib\.rs/)).not.toBeInTheDocument();
  });

  it("renders a badge on an anchored line while its file is open, naming the criterion", async () => {
    state.current = [entry({ anchor: { path: "src/lib.rs", lineStart: 2, lineEnd: 2 } })];
    renderSurface();
    await openFile("src/lib.rs");
    const badge = await waitFor(() => {
      const el = document.querySelector(".review-anchor-widget");
      if (!el) throw new Error("no badge yet");
      return el as HTMLElement;
    });
    expect(within(badge).getByText(/Evidence for: Criterion c\d/)).toBeInTheDocument();
    expect(badge.className, "the badge's edge is the neutral control edge, not a side stripe (D-199)").toContain("control-edge");
  });

  it("checks the focused criterion against the selection with the c key", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("insert"));
    focusFirstCriterion();
    fireEvent.keyDown(screen.getByRole("list", { name: "Criteria" }), { key: "c" });
    await waitFor(() => expect(checkMock).toHaveBeenCalledTimes(1));
    expect(checkMock.mock.calls[0][0].anchor).toMatchObject({ path: "src/lib.rs", lineStart: 2, lineEnd: 2 });
  });

  it("does nothing on c when no criterion is focused", async () => {
    renderSurface();
    await openFile("src/lib.rs");
    fireEvent.click(gutter("insert"));
    fireEvent.keyDown(screen.getByRole("list", { name: "Criteria" }), { key: "c" });
    expect(checkMock).not.toHaveBeenCalled();
  });

  it("refuses the check key outside the review layer", () => {
    expect(bindingAllowedInLayer("check-with-selection", "review-surface")).toBe(true);
    expect(bindingAllowedInLayer("check-with-selection", "board")).toBe(false);
  });
});
