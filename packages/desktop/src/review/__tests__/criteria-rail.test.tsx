/**
 * Behavior under test (08-06-PLAN.md, REVW-03, D-134/D-139/D-140/D-141): the criteria rail composes
 * the item panel's own criteria list and shows each checked criterion's evidence, its freshness or
 * the fact that it has none, with a footer counting the checks that carry no evidence.
 *
 * The adapter mock lists ONLY what the rail may call; `invokeCommand` throws on any command it does
 * not know, so a status setter or any other write fails structurally (T-08-06-02).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CriteriaRail } from "../CriteriaRail";
import { AcceptanceCriteriaList } from "../../item-detail/AcceptanceCriteriaList";
import type { AcceptanceCriterionDto, ReviewCriterionStateDto } from "../../adapters/tauri";

const state = { current: [] as ReviewCriterionStateDto[] };

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => {
    if (command === "criterion_list") return Promise.resolve(state.current.map((s) => s.criterion));
    if (command === "review_criteria_state") return Promise.resolve(state.current);
    if (command === "criterion_revisions") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected command ${command}`));
  },
  reviewCriteriaState: () => Promise.resolve(state.current),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
}));

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
        : { path: "src/lib.rs", side: "new", lineStart: 10, lineEnd: 14, sha: "abcdef1234567890", ...overrides.anchor },
    staleness: overrides.staleness ?? null,
  };
}

function renderRail() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CriteriaRail scope="task" itemId="t1" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.current = [];
  nextId = 0;
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
