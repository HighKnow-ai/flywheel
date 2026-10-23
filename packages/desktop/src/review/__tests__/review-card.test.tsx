/**
 * Behaviour under test (issue #155, docs/mvp-spec.md §8): an In review Story shows its review card.
 * Failing Checks come first with their output; then each criterion with its Check chip and a checkbox
 * that accepts or withdraws it (`criterion_accept` / `criterion_unaccept`), a passed Check pre-ticking it
 * as a suggestion only. Merge is offered once every criterion is accepted; while a Check has not passed at
 * the branch's head the action is "Merge with failing Check", which confirms in an AlertDialog naming
 * those Checks. The board's row action for an In review Story is Open review.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewCard, OpenReviewControl } from "../ReviewCard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { ReviewCheckDto, StoryDto, StoryReviewDto } from "../../adapters/tauri";

const storyReview = vi.fn();
const storyMerge = vi.fn();
const criterionAccept = vi.fn(() => Promise.resolve());
const criterionUnaccept = vi.fn(() => Promise.resolve());

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    storyReview: (...args: unknown[]) => storyReview(...args),
    storyMerge: (...args: unknown[]) => storyMerge(...args),
    criterionAccept: (...args: unknown[]) => criterionAccept(...(args as [])),
    criterionUnaccept: (...args: unknown[]) => criterionUnaccept(...(args as [])),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

const story: StoryDto = {
  id: "s1",
  projectId: "p1",
  epicId: "e1",
  key: "FLY-7",
  title: "Parse the config",
  description: null,
  state: "in_review",
  runsAfterStoryId: null,
  runsAfterReason: null,
  rank: "a",
};

function check(command: string, result: string, stale = false, outputTail: string | null = null): ReviewCheckDto {
  return { checkId: `k-${command}`, criterionId: `c-${command}`, command, result, stale, commitSha: "abc", outputTail };
}

function review(overrides: Partial<StoryReviewDto> = {}): StoryReviewDto {
  return {
    storyId: "s1",
    storyKey: "FLY-7",
    storyState: "in_review",
    headSha: "abc",
    review: {
      id: "r1",
      openedAt: "2026-10-23T09:00:00Z",
      baseSha: "000",
      headSha: "abc",
      files: 3,
      added: 42,
      removed: 7,
      openTasks: 1,
      checkObjections: [],
      adrNotes: [],
    },
    criteria: [
      { id: "c1", statement: "The config parses.", accepted: false, acceptedAt: null, preTicked: true, check: check("cargo test config", "passed") },
      { id: "c2", statement: "Errors name the line.", accepted: true, acceptedAt: "2026-10-23T09:05:00Z", preTicked: false, check: null },
    ],
    openTasks: 1,
    failingChecks: [],
    liveSession: false,
    uncommitted: [],
    ...overrides,
  };
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ReviewCard projectId="p1" story={story} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetUiState();
});

describe("the review card", () => {
  it("shows each criterion with its Check chip and a checkbox that accepts or withdraws it", async () => {
    storyReview.mockResolvedValue(review());
    renderCard();

    const criteria = await screen.findByRole("list", { name: "FLY-7 criteria to accept" });
    const first = within(criteria).getByRole("checkbox", { name: /The config parses/ });
    expect(first).not.toBeChecked();
    expect(within(criteria).getByText(/Check passed at this commit/)).toBeInTheDocument();
    expect(within(criteria).getByText("cargo test config")).toBeInTheDocument();
    expect(within(criteria).getByText("Judged at review")).toBeInTheDocument();

    fireEvent.click(first);
    await waitFor(() => expect(criterionAccept).toHaveBeenCalledWith("c1"));

    fireEvent.click(within(criteria).getByRole("checkbox", { name: /Errors name the line/ }));
    await waitFor(() => expect(criterionUnaccept).toHaveBeenCalledWith("c2"));
  });

  it("says what the hand-off left: the diff's size and the Tasks not done", async () => {
    storyReview.mockResolvedValue(review());
    renderCard();
    expect(await screen.findByText("3 files · +42 −7")).toBeInTheDocument();
    expect(screen.getByText("1 Task not done")).toBeInTheDocument();
  });

  it("holds Merge until every criterion is accepted, saying how many are left", async () => {
    storyReview.mockResolvedValue(review());
    renderCard();
    const merge = await screen.findByRole("button", { name: "Merge FLY-7" });
    expect(merge).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Accept 1 more criterion to merge.")).toBeInTheDocument();
    fireEvent.click(merge);
    expect(storyMerge).not.toHaveBeenCalled();
  });

  it("merges in one click once every criterion is accepted and every Check passed", async () => {
    storyReview.mockResolvedValue(
      review({ criteria: review().criteria.map((c) => ({ ...c, accepted: true })) }),
    );
    storyMerge.mockResolvedValue({ mergeCommit: "def", baseBranch: "main", method: "checkout", failingChecksOverridden: 0, cleanupWarning: null });
    renderCard();
    const merge = await screen.findByRole("button", { name: "Merge FLY-7" });
    expect(merge).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: /failing Check/ })).not.toBeInTheDocument();
    fireEvent.click(merge);
    await waitFor(() => expect(storyMerge).toHaveBeenCalledWith("s1", false));
  });

  it("lists failing Checks first, and Merge with failing Check confirms naming them", async () => {
    const failed = check("npm test", "failed", false, "1 test failed: parses_empty");
    const stale = check("cargo test config", "passed", true);
    storyReview.mockResolvedValue(
      review({
        criteria: [
          { id: "c1", statement: "The config parses.", accepted: true, acceptedAt: "x", preTicked: false, check: stale },
          { id: "c3", statement: "The tests pass.", accepted: true, acceptedAt: "x", preTicked: false, check: failed },
        ],
        failingChecks: [stale, failed],
      }),
    );
    storyMerge.mockResolvedValue({ mergeCommit: "def", baseBranch: "main", method: "plumbing", failingChecksOverridden: 2, cleanupWarning: null });
    renderCard();

    const failing = await screen.findByRole("region", { name: "2 Checks not passing" });
    expect(within(failing).getByText("npm test")).toBeInTheDocument();
    expect(within(failing).getByText("1 test failed: parses_empty")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Merge FLY-7" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Merge FLY-7 with failing Check" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("npm test")).toBeInTheDocument();
    expect(within(dialog).getByText("cargo test config")).toBeInTheDocument();
    expect(storyMerge).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Merge with 2 failing Checks" }));
    await waitFor(() => expect(storyMerge).toHaveBeenCalledWith("s1", true));
  });

  it("shows a refused Merge's reason as the core wrote it", async () => {
    storyReview.mockResolvedValue(
      review({ criteria: review().criteria.map((c) => ({ ...c, accepted: true })) }),
    );
    storyMerge.mockRejectedValue("main is checked out with uncommitted changes (README.md). Commit or stash them, then merge.");
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Merge FLY-7" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("main is checked out with uncommitted changes");
  });

  it("names a live session and uncommitted work as what holds Merge", async () => {
    storyReview.mockResolvedValue(
      review({ criteria: review().criteria.map((c) => ({ ...c, accepted: true })), liveSession: true, uncommitted: ["scratch.txt"] }),
    );
    renderCard();
    expect(await screen.findByText(/A session is live/)).toBeInTheDocument();
    expect(screen.getByText(/scratch.txt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge FLY-7" })).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Open review", () => {
  it("opens the Story, where the review card is", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <OpenReviewControl projectId="p1" story={story} />
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open review of FLY-7" }));
    expect(useUiStore.getState().currentStoryId).toBe("s1");
  });
});
