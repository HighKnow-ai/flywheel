/**
 * Behavior under test (08.1-21-PLAN.md Task 3, A-08(a)): the review surface can say no. A decision
 * pair, `Request changes` then `Merge`, sits in a group named "Review decision" directly after the
 * criteria rail, inside the criteria column; the review header holds no Merge.
 *
 * Fixtures are THRE-58's own three seeded criteria, verbatim, on a task that is `in_progress` (the
 * state of every real worktree task on the live board). Nothing here writes to a real database: the
 * adapter is mocked, and it is STRICT: `invokeCommand` rejects any command it does not list, so a
 * generic status setter reached from the surface fails structurally. The one status-moving command
 * the review tree may name is `reviewRequestChanges`, and it is called with a task id alone.
 *
 * jsdom stubs CSS, so nothing here asserts a style: `finish.test.tsx` reads the shipped stylesheet
 * and `browser/review-group.browser.test.tsx` measures WebKit.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewSurface } from "../ReviewSurface";
import type {
  AcceptanceCriterionDto,
  ChangesRequestStateDto,
  MergePreviewDto,
  ReviewCriterionStateDto,
} from "../../adapters/tauri";

const THRE_58 = [
  "Tab and Shift+Tab cycle within the dialog; the diff registers the trap handler on open and removes it on close.",
  "Closing the dialog returns focus to the element that held it before it opened.",
  "Initial focus lands on the first focusable control inside the dialog.",
];

type Decline = ChangesRequestStateDto | "pending" | "error";
const decline = { current: { state: "ready", uncheckedCount: 3 } as Decline };
const precheck = { current: null as MergePreviewDto | null };
const target = { current: { postMerge: false, epicId: "e1" as string | null } };
const requestMock = vi.fn();
const stateReads = vi.fn();
const commandsSeen: string[] = [];

vi.mock("../../adapters/tauri", () => ({
  invokeCommand: (command: string) => {
    commandsSeen.push(command);
    if (command === "criterion_list") return Promise.resolve(criteria().map((s) => s.criterion));
    if (command === "review_criteria_state") return Promise.resolve(criteria());
    if (command === "criterion_revisions") return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected command ${command}`));
  },
  reviewCriteriaState: () => Promise.resolve(criteria()),
  reviewEpicTaskRollup: () => Promise.resolve([]),
  subscribeBoardChanged: () => Promise.resolve(() => {}),
  reviewFiles: () =>
    Promise.resolve({
      target: {
        state: "resolved",
        postMerge: target.current.postMerge,
        base: "flywheel/epic",
        head: "flywheel/task",
        projectId: "p1",
        epicId: target.current.epicId,
        taskId: "t1",
      },
      files: [{ path: "src/lib.rs", oldPath: null, status: "M", added: 1, removed: 1, binary: false }],
    }),
  reviewFilePatch: () => Promise.resolve(""),
  criterionCheckWithAnchor: () => Promise.resolve(),
  gitFacts: () => Promise.resolve({ uncommitted: [] }),
  reviewMergePrecheck: () => Promise.resolve(precheck.current),
  reviewMergeTask: () => Promise.reject(new Error("the merge is not under test here")),
  reviewChangesRequestState: (taskId: string) => {
    stateReads(taskId);
    if (decline.current === "pending") return new Promise(() => {});
    if (decline.current === "error") return Promise.reject(new Error("failed:review_changes_request_state:read"));
    return Promise.resolve(decline.current);
  },
  reviewRequestChanges: (...args: unknown[]) => requestMock(...args),
}));

function criteria(): ReviewCriterionStateDto[] {
  return THRE_58.map((statement, i) => {
    const criterion: AcceptanceCriterionDto = {
      id: `c${i + 1}`,
      parentType: "task",
      parentId: "t1",
      statement,
      verificationHint: null,
      checked: false,
      rank: String((i + 1) * 100),
      revision: 1,
      revisionOf: null,
      supersededAt: null,
    };
    return { criterion, anchor: null, staleness: null };
  });
}

const READY: MergePreviewDto = {
  state: "ready",
  epicKey: "FLY-7",
  sourceBranch: "flywheel/thre-58-wire-up-the-focus-trap",
  targetBranch: "flywheel/thre-8-integration",
  commitCount: 3,
  fileCount: 2,
  conflictedFiles: [],
};

function renderSurface(props: { scope?: "task" | "epic" } = {}) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ReviewSurface
        scope={props.scope ?? "task"}
        itemId={props.scope === "epic" ? "e1" : "t1"}
        label="THRE-58 Wire up the focus trap #41"
        onBack={() => {}}
      />
    </QueryClientProvider>,
  );
}

const group = () => screen.findByRole("group", { name: "Review decision" });

beforeEach(() => {
  decline.current = { state: "ready", uncheckedCount: 3 };
  precheck.current = READY;
  target.current = { postMerge: false, epicId: "e1" };
  requestMock.mockReset().mockImplementation(() => {
    decline.current = { state: "sentBack", uncheckedCount: 3 };
    return Promise.resolve(3);
  });
  stateReads.mockReset();
  commandsSeen.length = 0;
});

describe("placement", () => {
  it("puts the decision group directly after the rail, inside the criteria column, Request changes first", async () => {
    const { container } = renderSurface();
    const foot = await group();
    const rail = screen.getByRole("complementary", { name: "Criteria rail" });

    expect(rail.nextElementSibling).toBe(foot);
    expect(foot.parentElement).toBe(rail.parentElement);

    const names = within(foot)
      .getAllByRole("button")
      .map((b) => b.textContent?.trim());
    expect(names).toEqual(["Request changes", "Merge"]);

    const header = container.querySelector("header") as HTMLElement;
    expect(within(header).queryByRole("button", { name: "Merge" })).toBeNull();
    expect(within(header).queryByRole("button", { name: "Request changes" })).toBeNull();
  });

  it("renders no foot in epic scope, and none for an integrated task", async () => {
    const epic = renderSurface({ scope: "epic" });
    await screen.findByRole("complementary", { name: "Criteria rail" });
    expect(screen.queryByRole("group", { name: "Review decision" })).toBeNull();
    epic.unmount();

    target.current = { postMerge: true, epicId: "e1" };
    renderSurface();
    await screen.findByText(/merged:/);
    expect(screen.queryByRole("group", { name: "Review decision" })).toBeNull();
  });

  it("still offers the decline for a task with no epic, when ready", async () => {
    target.current = { postMerge: false, epicId: null };
    precheck.current = { state: "refused", category: "noEpic" };
    renderSurface();
    const foot = await group();
    expect(within(foot).getByRole("button", { name: "Request changes" })).toBeInTheDocument();
    expect(within(foot).queryByRole("button", { name: "Merge" })).toBeNull();
  });
});

describe("the ready decline", () => {
  it("says what it will send before the click, and the button is described by that line", async () => {
    renderSurface();
    const foot = await group();
    const line = "Request changes sends 3 unchecked criteria back to the agent.";
    expect(within(foot).getByText(line)).toBeInTheDocument();
    expect(within(foot).getByRole("button", { name: "Request changes" })).toHaveAccessibleDescription(line);
  });

  it("uses the singular for one criterion", async () => {
    decline.current = { state: "ready", uncheckedCount: 1 };
    renderSurface();
    const foot = await group();
    expect(within(foot).getByText("Request changes sends 1 unchecked criterion back to the agent.")).toBeInTheDocument();
  });

  it("calls the adapter once with the task id as the whole input, then shows the board's answer and keeps Merge", async () => {
    renderSurface();
    const foot = await group();
    fireEvent.click(within(foot).getByRole("button", { name: "Request changes" }));

    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(requestMock.mock.calls[0]).toEqual(["t1"]);

    const note = "Sent back to the agent: 3 unchecked criteria. They go into the next session's briefing.";
    expect(await screen.findByText(note)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
    expect(screen.getByRole("button", { name: "Merge" })).toBeInTheDocument();
  });

  it("uses the singular in the sent-back note too", async () => {
    decline.current = { state: "sentBack", uncheckedCount: 1 };
    renderSurface();
    expect(
      await screen.findByText("Sent back to the agent: 1 unchecked criterion. They go into the next session's briefing."),
    ).toBeInTheDocument();
  });
});

describe("a write that does not land", () => {
  it("a failure keeps the button, says so, and shows no sent-back note", async () => {
    requestMock.mockReset().mockRejectedValue("failed:review_request_changes:write");
    renderSurface();
    const foot = await group();
    fireEvent.click(within(foot).getByRole("button", { name: "Request changes" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not send this back. Reload the review and try again.");
    expect(screen.getByRole("button", { name: "Request changes" })).toBeInTheDocument();
    expect(screen.queryByText(/Sent back to the agent/)).toBeNull();
  });

  it("a refusal shows no alert and the surface re-reads and says what the board now says", async () => {
    requestMock.mockReset().mockImplementation(() => {
      decline.current = { state: "refused", category: "nothingUnchecked" };
      return Promise.reject(new Error("refused:nothingUnchecked"));
    });
    renderSurface();
    const foot = await group();
    fireEvent.click(within(foot).getByRole("button", { name: "Request changes" }));

    expect(
      await screen.findByText(
        "Every criterion is checked, so there is nothing to send back. Uncheck the one that is not met to request changes.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });
});

describe("what the read says", () => {
  it("every criterion checked: the surface's own voice, no button", async () => {
    decline.current = { state: "refused", category: "nothingUnchecked" };
    renderSurface();
    expect(
      await screen.findByText(
        "Every criterion is checked, so there is nothing to send back. Uncheck the one that is not met to request changes.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });

  it("no criteria at all: the surface's own voice, no button", async () => {
    decline.current = { state: "refused", category: "noCriteria" };
    renderSurface();
    expect(
      await screen.findByText(
        "This task has no acceptance criteria, so there is nothing to send back. Add the criterion that is not met to request changes.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Request changes" })).toBeNull();
  });

  it.each(["notInFlight", "integrated"] as const)("%s offers no button and says nothing", async (category) => {
    decline.current = { state: "refused", category };
    renderSurface();
    // Merge is still there, so the foot exists: the point is that the decline adds nothing to it.
    const foot = await group();
    await waitFor(() => expect(stateReads).toHaveBeenCalled());
    expect(within(foot).queryByRole("button", { name: "Request changes" })).toBeNull();
    expect(within(foot).queryByText(/send(s)? .*back|nothing to send back|Sent back/)).toBeNull();
    expect(within(foot).getAllByRole("button")).toHaveLength(1);
  });

  it.each(["pending", "error"] as const)("a read that is %s shows no decline UI and leaves Merge as it was", async (mode) => {
    decline.current = mode;
    renderSurface();
    const foot = await group();
    await waitFor(() => expect(stateReads).toHaveBeenCalled());
    expect(within(foot).getAllByRole("button").map((b) => b.textContent?.trim())).toEqual(["Merge"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders nothing at all when there is nothing to show: absence is the design", async () => {
    precheck.current = { state: "refused", category: "nothingToMerge" };
    decline.current = { state: "refused", category: "notInFlight" };
    renderSurface();
    await screen.findByText(/Nothing to merge/);
    await waitFor(() => expect(stateReads).toHaveBeenCalled());
    expect(screen.queryByRole("group", { name: "Review decision" })).toBeNull();
  });
});

describe("which action leads", () => {
  it("with Merge refused, Request changes still renders on the secondary class and nothing carries the lead class", async () => {
    precheck.current = { state: "refused", category: "nothingToMerge" };
    renderSurface();
    const foot = await group();
    const button = within(foot).getByRole("button", { name: "Request changes" });
    expect(button).toHaveClass("review-secondary");
    expect(foot.querySelector(".review-action")).toBeNull();
    expect(within(foot).queryByRole("button", { name: "Merge" })).toBeNull();
  });

  it("with both offered, Merge leads and Request changes is the secondary", async () => {
    renderSurface();
    const foot = await group();
    expect(within(foot).getByRole("button", { name: "Merge" })).toHaveClass("control-edge", "review-action");
    const decline = within(foot).getByRole("button", { name: "Request changes" });
    expect(decline).toHaveClass("control-edge", "review-secondary");
    expect(decline).not.toHaveClass("review-action");
  });
});

describe("the review tree has no generic status writer (D-122, narrowed by A-08(a))", () => {
  it("makes no command the strict adapter does not list, and never a status command", async () => {
    renderSurface();
    const foot = await group();
    fireEvent.click(within(foot).getByRole("button", { name: "Request changes" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(commandsSeen.filter((c) => /status/.test(c))).toEqual([]);
    // Reads only. `epic_list_all` is the scope toggle's roster read, which the strict mock rejects (harmlessly).
    const allowed = ["criterion_list", "review_criteria_state", "criterion_revisions", "epic_list_all"];
    expect(commandsSeen.filter((c) => !allowed.includes(c))).toEqual([]);
  });
});
