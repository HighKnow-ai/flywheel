/**
 * Behaviour under test (issue #155, docs/mvp-spec.md §8): an In review Story shows its review card.
 * Failing Checks come first with their output; then each criterion with its Check chip and a checkbox
 * that accepts or withdraws it (`criterion_accept` / `criterion_unaccept`), a passed Check pre-ticking it
 * as a suggestion only. Merge is offered once every criterion is accepted; while a Check has not passed at
 * the branch's head the action is "Merge with failing Check", which confirms in an AlertDialog naming
 * those Checks. The board's row action for an In review Story is Open review.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReviewCard, OpenReviewControl } from "../ReviewCard";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { AdrDecisionDto, DecisionChangeDto, ReviewCheckDto, StoryDto, StoryReviewDto } from "../../adapters/tauri";

const storyReview = vi.fn();
const storyMerge = vi.fn();
const storyRequestChanges = vi.fn();
const storyAdrDecide = vi.fn(() => Promise.resolve());
const criterionAccept = vi.fn(() => Promise.resolve());
const criterionUnaccept = vi.fn(() => Promise.resolve());
const reviewFilePatch = vi.fn();
const storyChecksRerun = vi.fn();
let checksProgress: ((payload: { storyId: string; done: number; total: number }) => void) | null = null;
const notifySuccess = vi.fn();

vi.mock("../../lib/notify", () => ({
  notify: { success: (...args: unknown[]) => notifySuccess(...args), error: vi.fn(), dismiss: vi.fn() },
}));

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    storyReview: (...args: unknown[]) => storyReview(...args),
    storyMerge: (...args: unknown[]) => storyMerge(...args),
    storyRequestChanges: (...args: unknown[]) => storyRequestChanges(...args),
    storyAdrDecide: (...args: unknown[]) => storyAdrDecide(...(args as [])),
    criterionAccept: (...args: unknown[]) => criterionAccept(...(args as [])),
    criterionUnaccept: (...args: unknown[]) => criterionUnaccept(...(args as [])),
    reviewFilePatch: (...args: unknown[]) => reviewFilePatch(...args),
    storyChecksRerun: (...args: unknown[]) => storyChecksRerun(...args),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeChecksProgress: (handler: typeof checksProgress) => {
      checksProgress = handler;
      return Promise.resolve(() => {
        checksProgress = null;
      });
    },
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
  return {
    checkId: `k-${command}`,
    criterionId: `c-${command}`,
    command,
    result,
    stale,
    commitSha: "abc",
    outputTail,
    objections: [],
  };
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
      {
        id: "c1",
        statement: "The config parses.",
        accepted: false,
        acceptedAt: null,
        preTicked: true,
        check: check("cargo test config", "passed"),
      },
      {
        id: "c2",
        statement: "Errors name the line.",
        accepted: true,
        acceptedAt: "2026-10-23T09:05:00Z",
        preTicked: false,
        check: null,
      },
    ],
    openTasks: 1,
    failingChecks: [],
    liveSession: false,
    uncommitted: [],
    decisions: [],
    conflicts: [],
    rebaseComment: null,
    files: [],
    adrReviewPoints: [],
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
    const held = screen.getByRole("region", { name: "What holds Merge" });
    expect(within(held).getByText("Accept 1 more criterion to merge.")).toBeInTheDocument();
    fireEvent.click(merge);
    expect(storyMerge).not.toHaveBeenCalled();
  });

  it("merges in one click once every criterion is accepted and every Check passed", async () => {
    storyReview.mockResolvedValue(review({ criteria: review().criteria.map((c) => ({ ...c, accepted: true })) }));
    storyMerge.mockResolvedValue({
      mergeCommit: "def",
      baseBranch: "main",
      method: "checkout",
      failingChecksOverridden: 0,
      cleanupWarning: null,
    });
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
          {
            id: "c1",
            statement: "The config parses.",
            accepted: true,
            acceptedAt: "x",
            preTicked: false,
            check: stale,
          },
          { id: "c3", statement: "The tests pass.", accepted: true, acceptedAt: "x", preTicked: false, check: failed },
        ],
        failingChecks: [stale, failed],
      }),
    );
    storyMerge.mockResolvedValue({
      mergeCommit: "def",
      baseBranch: "main",
      method: "plumbing",
      failingChecksOverridden: 2,
      cleanupWarning: null,
    });
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
    storyReview.mockResolvedValue(review({ criteria: review().criteria.map((c) => ({ ...c, accepted: true })) }));
    storyMerge.mockRejectedValue(
      "main is checked out with uncommitted changes (README.md). Commit or stash them, then merge.",
    );
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Merge FLY-7" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("main is checked out with uncommitted changes");
  });

  it("names a live session and uncommitted work as what holds Merge", async () => {
    storyReview.mockResolvedValue(
      review({
        criteria: review().criteria.map((c) => ({ ...c, accepted: true })),
        liveSession: true,
        uncommitted: ["scratch.txt"],
      }),
    );
    renderCard();
    const held = await screen.findByRole("region", { name: "What holds Merge" });
    expect(within(held).getByText(/A session is live/)).toBeInTheDocument();
    expect(within(held).getByText(/scratch.txt/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge FLY-7" })).toHaveAttribute("aria-disabled", "true");
  });
});

const KEEP: AdrDecisionDto = { kind: "keep", whatIsWrong: null, shouldBe: null };

/** Issue #161: the Decisions section, ADR and glossary changes apart from the code. */
const DECISIONS: DecisionChangeDto[] = [
  {
    kind: "adr",
    path: "docs/adr/0002-repo-holds-knowledge.md",
    oldPath: null,
    status: "M",
    added: 2,
    removed: 0,
    newAdr: null,
    flags: [],
  },
  {
    kind: "adr",
    path: "docs/adr/0010-reviews-are-a-board-record.md",
    oldPath: null,
    status: "A",
    added: 30,
    removed: 0,
    newAdr: {
      title: "Reviews are a board record",
      barLines: {
        hardToReverse: "Every review reads it",
        surprising: "Bar lines usually live in the file",
        losingAlternative: "Parsing the ADR file",
        relatesTo: "ADR-0002",
      },
      barLinesFrom: "handoff",
      related: [{ path: "docs/adr/0002-repo-holds-knowledge.md", title: "The repo holds knowledge" }],
      proposalId: null,
      decision: KEEP,
    },
    flags: [],
  },
  {
    kind: "adr",
    path: "docs/adr/0011-bare.md",
    oldPath: null,
    status: "A",
    added: 4,
    removed: 0,
    newAdr: {
      title: "Written bare",
      barLines: null,
      barLinesFrom: null,
      related: [],
      proposalId: null,
      decision: KEEP,
    },
    flags: [],
  },
  { kind: "glossary", path: "GLOSSARY.md", oldPath: null, status: "M", added: 3, removed: 1, newAdr: null, flags: [] },
];

describe("the Decisions section", () => {
  it("lists ADR and glossary changes apart with a count, each new ADR with its bar lines, related ADRs and Keep selected", async () => {
    storyReview.mockResolvedValue(review({ decisions: DECISIONS }));
    renderCard();

    const section = await screen.findByRole("region", { name: "Decisions, 4 changes" });
    const card = within(section).getByRole("group", { name: /Reviews are a board record/ });
    expect(within(card).getByText("docs/adr/0010-reviews-are-a-board-record.md")).toBeInTheDocument();
    const bar = within(card).getByRole("list", { name: "Bar lines" });
    expect(within(bar).getByText("Every review reads it")).toBeInTheDocument();
    expect(within(bar).getByText("Bar lines usually live in the file")).toBeInTheDocument();
    expect(within(bar).getByText("Parsing the ADR file")).toBeInTheDocument();
    expect(within(card).getByText(/from the hand-off/)).toBeInTheDocument();
    const related = within(card).getByRole("list", { name: "Related live ADRs" });
    expect(within(related).getByText("The repo holds knowledge")).toBeInTheDocument();
    expect(within(card).getByRole("radio", { name: "Keep" })).toBeChecked();

    const bare = within(section).getByRole("group", { name: /Written bare/ });
    expect(within(bare).getByText("No bar lines")).toBeInTheDocument();
    expect(within(bare).getByRole("radio", { name: "Keep" })).toBeChecked();

    expect(within(section).getByText("docs/adr/0002-repo-holds-knowledge.md")).toBeInTheDocument();
    expect(within(section).getByText("GLOSSARY.md")).toBeInTheDocument();
    expect(within(section).queryByRole("group", { name: /GLOSSARY/ })).toBeNull();
  });

  it("is left out when the Story changes no ADR and no glossary term", async () => {
    storyReview.mockResolvedValue(review());
    renderCard();
    await screen.findByRole("list", { name: "FLY-7 criteria to accept" });
    expect(screen.queryByRole("region", { name: /Decisions/ })).toBeNull();
  });
});

/** Issue #164: the flags, and Not an ADR and Wrong decision beside Keep. */
const FLAGGED: DecisionChangeDto[] = [
  {
    ...DECISIONS[0],
    flags: [{ kind: "wording_or_supersede", number: null, takenBy: null, baseBranch: null, superseded: null }],
  },
  {
    ...DECISIONS[1],
    flags: [
      {
        kind: "renumber",
        number: 10,
        takenBy: "docs/adr/0010-landed-meanwhile.md",
        baseBranch: "main",
        superseded: null,
      },
      {
        kind: "supersession_line_missing",
        number: 2,
        takenBy: null,
        baseBranch: null,
        superseded: "docs/adr/0002-repo-holds-knowledge.md",
      },
    ],
  },
  DECISIONS[2],
];

function withDecision(change: DecisionChangeDto, decision: AdrDecisionDto): DecisionChangeDto {
  return { ...change, newAdr: change.newAdr && { ...change.newAdr, decision } };
}

describe("ADR flags and decisions", () => {
  it("shows the wording, renumber and supersession flags on their changes, and the three choices on a new ADR", async () => {
    storyReview.mockResolvedValue(review({ decisions: FLAGGED }));
    renderCard();

    const section = await screen.findByRole("region", { name: "Decisions, 3 changes" });
    const edited = within(section)
      .getByText("docs/adr/0002-repo-holds-knowledge.md", { selector: "li > div > code" })
      .closest("li")!;
    expect(within(edited).getByText("Wording or supersede?")).toBeInTheDocument();
    expect(within(edited).getByText(/A line other than Status: changed/)).toBeInTheDocument();

    const card = within(section).getByRole("group", { name: /Reviews are a board record/ });
    const flags = within(card).getByRole("list", { name: "Flags" });
    expect(within(flags).getByText("Renumber")).toBeInTheDocument();
    expect(within(flags).getByText(/ADR-0010 is already taken on main by/)).toBeInTheDocument();
    expect(within(flags).getByText("docs/adr/0010-landed-meanwhile.md")).toBeInTheDocument();
    expect(within(flags).getByText("Supersession line missing")).toBeInTheDocument();

    const choices = within(card).getByRole("radiogroup", { name: "Decision on Reviews are a board record" });
    expect(within(choices).getByRole("radio", { name: "Keep" })).toBeChecked();
    expect(within(choices).getByRole("radio", { name: "Not an ADR" })).not.toBeChecked();
    expect(within(choices).getByRole("radio", { name: "Wrong decision" })).not.toBeChecked();

    const bare = within(section).getByRole("group", { name: /Written bare/ });
    expect(within(bare).queryByRole("list", { name: "Flags" })).toBeNull();
  });

  it("stores Not an ADR on the pick, and Wrong decision only once both fields are filled", async () => {
    storyReview.mockResolvedValue(review({ decisions: FLAGGED }));
    renderCard();
    const card = await screen.findByRole("group", { name: /Reviews are a board record/ });

    fireEvent.click(within(card).getByRole("radio", { name: "Not an ADR" }));
    await waitFor(() =>
      expect(storyAdrDecide).toHaveBeenCalledWith(
        "s1",
        "docs/adr/0010-reviews-are-a-board-record.md",
        "not_an_adr",
        null,
        null,
      ),
    );

    fireEvent.click(within(card).getByRole("radio", { name: "Wrong decision" }));
    const wrong = within(card).getByRole("textbox", { name: "What is wrong?" });
    const should = within(card).getByRole("textbox", { name: "What should it be?" });
    fireEvent.click(within(card).getByRole("button", { name: "Record Wrong decision" }));
    expect(within(card).getByText("Say both what is wrong and what it should be.")).toBeInTheDocument();
    expect(storyAdrDecide).toHaveBeenCalledTimes(1);

    fireEvent.change(wrong, { target: { value: "It keeps the lock across the git call" } });
    fireEvent.change(should, { target: { value: "Release the lock first" } });
    fireEvent.click(within(card).getByRole("button", { name: "Record Wrong decision" }));
    await waitFor(() =>
      expect(storyAdrDecide).toHaveBeenLastCalledWith(
        "s1",
        "docs/adr/0010-reviews-are-a-board-record.md",
        "wrong_decision",
        "It keeps the lock across the git call",
        "Release the lock first",
      ),
    );
  });

  it("holds Merge while an ADR is marked, and the composer sends the ADR review points even with no comment", async () => {
    const points = [
      "Delete `docs/adr/0010-reviews-are-a-board-record.md`; keep the decision out of docs/adr.",
      "Add a `Status: superseded by ADR-0010` line to `docs/adr/0002-repo-holds-knowledge.md`, which `docs/adr/0010-reviews-are-a-board-record.md` supersedes.",
    ];
    storyReview.mockResolvedValue(
      review({
        criteria: review().criteria.map((c) => ({ ...c, accepted: true })),
        decisions: [withDecision(FLAGGED[1], { kind: "not_an_adr", whatIsWrong: null, shouldBe: null })],
        adrReviewPoints: points,
      }),
    );
    storyRequestChanges.mockResolvedValue({
      id: "run2",
      storyId: "s1",
      status: "running",
      permissionMode: "acceptEdits",
    });
    renderCard();

    const card = await screen.findByRole("group", { name: /Reviews are a board record/ });
    expect(within(card).getByRole("radio", { name: "Not an ADR" })).toBeChecked();
    expect(
      within(card).getByText(/Merge waits\. Request changes asks the agent to delete the file/),
    ).toBeInTheDocument();
    const merge = screen.getByRole("button", { name: "Merge FLY-7" });
    expect(merge).toHaveAttribute("aria-disabled", "true");
    expect(
      within(screen.getByRole("region", { name: "What holds Merge" })).getByText(
        "docs/adr/0010-reviews-are-a-board-record.md is marked Not an ADR: request changes, or set it back to Keep.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(merge);
    expect(storyMerge).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Request changes on FLY-7" }));
    const also = screen.getByRole("list", { name: "Also sent: 2 ADR review points" });
    expect(within(also).getByText(points[0])).toBeInTheDocument();
    expect(within(also).getByText(points[1])).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send FLY-7 back to Running" }));
    await waitFor(() => expect(storyRequestChanges).toHaveBeenCalledWith("s1", ""));
  });

  it("shows a recorded Wrong decision's answers, and Keep clears it", async () => {
    storyReview.mockResolvedValue(
      review({
        decisions: [
          withDecision(DECISIONS[1], {
            kind: "wrong_decision",
            whatIsWrong: "It keeps the lock",
            shouldBe: "Release it first",
          }),
        ],
      }),
    );
    renderCard();
    const card = await screen.findByRole("group", { name: /Reviews are a board record/ });
    expect(within(card).getByRole("radio", { name: "Wrong decision" })).toBeChecked();
    expect(within(card).getByRole("textbox", { name: "What is wrong?" })).toHaveValue("It keeps the lock");
    expect(within(card).getByRole("textbox", { name: "What should it be?" })).toHaveValue("Release it first");
    expect(within(card).queryByRole("button", { name: "Record Wrong decision" })).toBeNull();
    expect(
      within(card).getByText(/sends both answers as one review point on the code and the ADR/),
    ).toBeInTheDocument();

    fireEvent.click(within(card).getByRole("radio", { name: "Keep" }));
    await waitFor(() =>
      expect(storyAdrDecide).toHaveBeenCalledWith(
        "s1",
        "docs/adr/0010-reviews-are-a-board-record.md",
        "keep",
        null,
        null,
      ),
    );
  });
});

describe("Request changes", () => {
  it("sends the Story back to Running with the comments typed in the footer", async () => {
    storyReview.mockResolvedValue(review());
    storyRequestChanges.mockResolvedValue({
      id: "run2",
      storyId: "s1",
      status: "running",
      permissionMode: "acceptEdits",
    });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Request changes on FLY-7" }));
    const comments = screen.getByRole("textbox", { name: "What should change?" });
    expect(comments).toHaveFocus();
    const send = screen.getByRole("button", { name: "Send FLY-7 back to Running" });
    fireEvent.click(send);
    expect(storyRequestChanges).not.toHaveBeenCalled();
    expect(screen.getByText("Write at least one review point.")).toBeInTheDocument();

    fireEvent.change(comments, { target: { value: "Name the line in each error.\nCover an empty file." } });
    fireEvent.click(send);
    await waitFor(() =>
      expect(storyRequestChanges).toHaveBeenCalledWith("s1", "Name the line in each error.\nCover an empty file."),
    );
  });

  it("closes the composer on Cancel without sending, and keeps Merge the one filled action", async () => {
    storyReview.mockResolvedValue(review());
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Request changes on FLY-7" }));
    expect(screen.queryByRole("button", { name: "Merge FLY-7" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("textbox", { name: "What should change?" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge FLY-7" })).toBeInTheDocument();
    expect(storyRequestChanges).not.toHaveBeenCalled();
  });

  it("shows a refused or failed request as the core wrote it", async () => {
    storyReview.mockResolvedValue(review());
    storyRequestChanges.mockRejectedValue("FLY-7 has a live session. Stop it before requesting changes.");
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Request changes on FLY-7" }));
    fireEvent.change(screen.getByRole("textbox", { name: "What should change?" }), { target: { value: "Cover it." } });
    fireEvent.click(screen.getByRole("button", { name: "Send FLY-7 back to Running" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("has a live session");
  });
});

describe("Rebase needed", () => {
  const rebaseComment =
    "Rebase needed: merging into main would conflict in README.md, src/config.rs. Rebase this branch on main, resolve those conflicts, and re-run the Checks before handing off.";

  it("names the conflicting paths first and holds Merge", async () => {
    storyReview.mockResolvedValue(
      review({
        criteria: review().criteria.map((c) => ({ ...c, accepted: true })),
        conflicts: ["README.md", "src/config.rs"],
        rebaseComment,
      }),
    );
    renderCard();
    const rebase = await screen.findByRole("region", { name: "Rebase needed" });
    expect(within(rebase).getByText("README.md")).toBeInTheDocument();
    expect(within(rebase).getByText("src/config.rs")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Merge FLY-7" })).toHaveAttribute("aria-disabled", "true");
    expect(
      within(screen.getByRole("region", { name: "What holds Merge" })).getByText(
        /Rebase needed: merging would conflict in 2 files/,
      ),
    ).toBeInTheDocument();
  });

  it("sends the Story back with the paths in a pre-filled comment", async () => {
    storyReview.mockResolvedValue(review({ conflicts: ["README.md", "src/config.rs"], rebaseComment }));
    storyRequestChanges.mockResolvedValue({
      id: "run2",
      storyId: "s1",
      status: "running",
      permissionMode: "acceptEdits",
    });
    renderCard();
    const rebase = await screen.findByRole("region", { name: "Rebase needed" });
    fireEvent.click(within(rebase).getByRole("button", { name: "Request a rebase of FLY-7" }));
    expect(screen.getByRole("textbox", { name: "What should change?" })).toHaveValue(rebaseComment);
    fireEvent.click(screen.getByRole("button", { name: "Send FLY-7 back to Running" }));
    await waitFor(() => expect(storyRequestChanges).toHaveBeenCalledWith("s1", rebaseComment));
  });
});

const PATCH = [
  "diff --git a/src/config.rs b/src/config.rs",
  "index 1111111..2222222 100644",
  "--- a/src/config.rs",
  "+++ b/src/config.rs",
  "@@ -1,3 +1,4 @@",
  " fn parse() {",
  "-    todo!()",
  "+    let text = read();",
  "+    toml::from_str(&text)",
  " }",
  "",
].join("\n");

/** The card's issue #157 shape: a failed Check with an objection, a passing Check with one, Tasks left, two files. */
function fullReview(): StoryReviewDto {
  const failed = {
    ...check("npm test", "failed", false, "1 test failed: parses_empty"),
    criterionId: "c3",
    objections: [{ why: "parses_empty tests a case the spec rules out.", command: "npm test" }],
  };
  const passed = {
    ...check("cargo test config", "passed"),
    criterionId: "c1",
    objections: [{ why: "It runs only the unit tests.", command: "cargo test -p config" }],
  };
  return review({
    criteria: [
      { id: "c1", statement: "The config parses.", accepted: false, acceptedAt: null, preTicked: true, check: passed },
      { id: "c3", statement: "The tests pass.", accepted: false, acceptedAt: null, preTicked: false, check: failed },
    ],
    failingChecks: [failed],
    openTasks: 2,
    files: [
      { path: "src/config.rs", oldPath: null, status: "M", added: 2, removed: 1, binary: false },
      { path: "assets/logo.png", oldPath: null, status: "A", added: null, removed: null, binary: true },
    ],
  });
}

describe("the review card's order, objections, files and Re-run Checks (issue #157)", () => {
  it("lays out failing Checks, then criteria, then warnings, then the changed files", async () => {
    storyReview.mockResolvedValue(fullReview());
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    renderCard();

    const failing = await screen.findByRole("region", { name: "1 Check not passing" });
    const criteria = screen.getByRole("list", { name: "FLY-7 criteria to accept" });
    const warnings = screen.getByRole("region", { name: "Warnings" });
    const files = screen.getByRole("region", { name: "2 changed files" });
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(failing, criteria)).toBe(true);
    expect(follows(criteria, warnings)).toBe(true);
    expect(follows(warnings, files)).toBe(true);
    expect(within(warnings).getByText("2 Tasks not done")).toBeInTheDocument();
  });

  it("shows each Check objection beside its Check, naming the command the agent objected to when it changed", async () => {
    storyReview.mockResolvedValue(fullReview());
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    renderCard();

    const failing = await screen.findByRole("region", { name: "1 Check not passing" });
    expect(within(failing).getByText("parses_empty tests a case the spec rules out.")).toBeInTheDocument();

    const criteria = screen.getByRole("list", { name: "FLY-7 criteria to accept" });
    const first = within(criteria).getAllByRole("listitem")[0];
    expect(within(first).getByText("It runs only the unit tests.")).toBeInTheDocument();
    expect(within(first).getByText("cargo test -p config")).toBeInTheDocument();
    // A failing Check's objection is shown once, in the failing panel, not again on its criterion.
    expect(screen.getAllByText("parses_empty tests a case the spec rules out.")).toHaveLength(1);
  });

  it("lists the changed files and renders each file's patch as a diff", async () => {
    storyReview.mockResolvedValue(fullReview());
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    renderCard();

    const files = await screen.findByRole("region", { name: "2 changed files" });
    expect(within(files).getByText("src/config.rs")).toBeInTheDocument();
    expect(within(files).getByText("assets/logo.png")).toBeInTheDocument();
    await waitFor(() => expect(reviewFilePatch).toHaveBeenCalledWith("s1", "src/config.rs", null));
    expect(reviewFilePatch).toHaveBeenCalledTimes(1);

    const diff = await within(files).findByRole("group", { name: "Diff of src/config.rs" });
    expect(within(diff).getByText("toml::from_str(&text)", { exact: false })).toBeInTheDocument();
    expect(within(diff).getByText("todo!()", { exact: false })).toBeInTheDocument();
    expect(within(files).getByText("Binary file: not shown.")).toBeInTheDocument();

    fireEvent.click(within(files).getByRole("button", { name: /src\/config\.rs/ }));
    expect(within(files).queryByRole("group", { name: "Diff of src/config.rs" })).not.toBeInTheDocument();
  });

  it("says when a file's patch is too large to show", async () => {
    storyReview.mockResolvedValue(fullReview());
    reviewFilePatch.mockResolvedValue({ patch: "", tooLarge: true });
    renderCard();
    expect(await screen.findByText(/too large to show here/)).toBeInTheDocument();
  });

  it("re-runs the Checks and says what the run recorded", async () => {
    storyReview.mockResolvedValue(fullReview());
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    storyChecksRerun.mockResolvedValue({ commitSha: "9f3c2ab0d1", passed: 1, failed: 1, timedOut: 0 });
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Re-run Checks" }));
    await waitFor(() => expect(storyChecksRerun).toHaveBeenCalledWith("s1"));
    expect(await screen.findByText("Ran 2 Checks at 9f3c2ab: 1 passed, 1 failed.")).toBeInTheDocument();
  });

  it("holds Re-run Checks while a session is live", async () => {
    storyReview.mockResolvedValue({ ...fullReview(), liveSession: true });
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    renderCard();
    const rerun = await screen.findByRole("button", { name: "Re-run Checks" });
    expect(rerun).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(rerun);
    expect(storyChecksRerun).not.toHaveBeenCalled();
  });

  it("shows the core's refusal of a Re-run Checks as written", async () => {
    storyReview.mockResolvedValue(fullReview());
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    storyChecksRerun.mockRejectedValue("A session of FLY-7 is live: stop it before re-running its Checks.");
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Re-run Checks" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("stop it before re-running its Checks");
  });
});

/** A promise the test settles by hand, to look at a control while its action runs. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function changedFiles(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    path: `src/file-${i + 1}.rs`,
    oldPath: null,
    status: "M",
    added: i + 1,
    removed: 0,
    binary: false,
  }));
}

describe("Merge in reach, pending, and saying it landed (issue #207)", () => {
  const accepted = () => review({ criteria: review().criteria.map((c) => ({ ...c, accepted: true })) });

  it("shows Merge pending while it runs, then toasts that it landed with Open board", async () => {
    storyReview.mockResolvedValue(accepted());
    const merging = deferred<unknown>();
    storyMerge.mockReturnValue(merging.promise);
    useUiStore.getState().openStory("p1", "s1");
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Merge FLY-7" }));
    const merge = screen.getByRole("button", { name: "Merge FLY-7" });
    expect(merge).toHaveAttribute("aria-busy", "true");
    expect(merge).toHaveTextContent(/^Merge$/);
    expect(
      screen.getByText("Merging FLY-7: writing the merge commit, then removing the worktree."),
    ).toBeInTheDocument();
    fireEvent.click(merge);
    expect(storyMerge).toHaveBeenCalledTimes(1);

    await act(async () => {
      merging.resolve({
        mergeCommit: "def",
        baseBranch: "main",
        method: "checkout",
        failingChecksOverridden: 0,
        cleanupWarning: null,
        adrsLinked: [],
      });
    });
    await waitFor(() => expect(notifySuccess).toHaveBeenCalledTimes(1));
    const [title, options] = notifySuccess.mock.calls[0] as [
      string,
      { description: string; action: { label: string; onClick: () => void } },
    ];
    expect(title).toBe("FLY-7 merged into main");
    expect(options.description).toBe("Worktree cleaned.");
    expect(options.action.label).toBe("Open board");
    options.action.onClick();
    expect(useUiStore.getState().currentStoryId).toBeNull();
    expect(useUiStore.getState().currentProjectId).toBe("p1");
  });

  it("says in the toast when Merge landed but could not clean the worktree", async () => {
    storyReview.mockResolvedValue(accepted());
    storyMerge.mockResolvedValue({
      mergeCommit: "def",
      baseBranch: "trunk",
      method: "plumbing",
      failingChecksOverridden: 0,
      cleanupWarning: "The worktree at /tmp/x could not be removed.",
      adrsLinked: [],
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Merge FLY-7" }));
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
    expect(notifySuccess.mock.calls[0]?.[0]).toBe("FLY-7 merged into trunk");
    expect((notifySuccess.mock.calls[0]?.[1] as { description: string }).description).toBe(
      "The worktree at /tmp/x could not be removed.",
    );
  });

  it("shows Re-run Checks pending with its step and a Progress bar as each Check ends", async () => {
    storyReview.mockResolvedValue(fullReview());
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    const running = deferred<unknown>();
    storyChecksRerun.mockReturnValue(running.promise);
    renderCard();

    fireEvent.click(await screen.findByRole("button", { name: "Re-run Checks" }));
    expect(screen.getByRole("button", { name: "Re-run Checks" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("Running 2 Checks")).toBeInTheDocument();
    await waitFor(() => expect(checksProgress).not.toBeNull());
    act(() => checksProgress?.({ storyId: "s1", done: 1, total: 2 }));
    expect(screen.getByText("Running 2 Checks · 1/2")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Checks run" })).toHaveAttribute("aria-valuenow", "1");
    act(() => checksProgress?.({ storyId: "other", done: 2, total: 9 }));
    expect(screen.getByText("Running 2 Checks · 1/2")).toBeInTheDocument();

    await act(async () => running.resolve({ commitSha: "9f3c2ab0d1", passed: 2, failed: 0, timedOut: 0 }));
    expect(await screen.findByText("Ran 2 Checks at 9f3c2ab: 2 passed, 0 failed.")).toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-run Checks" })).not.toHaveAttribute("aria-busy");
  });

  it("folds every diff past a few files, and its file index opens the one it names", async () => {
    storyReview.mockResolvedValue(review({ files: changedFiles(8) }));
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    renderCard();

    const files = await screen.findByRole("region", { name: "8 changed files" });
    expect(reviewFilePatch).not.toHaveBeenCalled();
    const index = within(files).getByRole("navigation", { name: "File index" });
    expect(within(index).getAllByRole("link")).toHaveLength(8);
    fireEvent.click(within(index).getByRole("link", { name: /src\/file-3\.rs/ }));
    await waitFor(() => expect(reviewFilePatch).toHaveBeenCalledWith("s1", "src/file-3.rs", null));
    expect(within(files).getByRole("button", { name: /^src\/file-3\.rs/ })).toHaveAttribute("aria-expanded", "true");
    expect(within(files).getByRole("button", { name: /^src\/file-4\.rs/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("opens every diff of a short review, and Collapse all folds them", async () => {
    storyReview.mockResolvedValue(review({ files: changedFiles(3) }));
    reviewFilePatch.mockResolvedValue({ patch: PATCH, tooLarge: false });
    renderCard();
    const files = await screen.findByRole("region", { name: "3 changed files" });
    await waitFor(() => expect(reviewFilePatch).toHaveBeenCalledTimes(3));
    fireEvent.click(within(files).getByRole("button", { name: "Collapse all" }));
    for (const row of within(files).getAllByRole("button", { name: /^src\/file-/ })) {
      expect(row).toHaveAttribute("aria-expanded", "false");
    }
    fireEvent.click(within(files).getByRole("button", { name: "Expand all" }));
    for (const row of within(files).getAllByRole("button", { name: /^src\/file-/ })) {
      expect(row).toHaveAttribute("aria-expanded", "true");
    }
  });

  it("names what holds Merge in an Alert, and keeps a one-line summary beside Merge", async () => {
    storyReview.mockResolvedValue(review({ liveSession: true }));
    renderCard();
    const held = await screen.findByRole("region", { name: "What holds Merge" });
    expect(within(held).getByText("A session is live: stop it before merging.")).toBeInTheDocument();
    expect(within(held).getByText("Accept 1 more criterion to merge.")).toBeInTheDocument();
    const merge = screen.getByRole("button", { name: "Merge FLY-7" });
    expect(merge).toHaveAccessibleDescription(/A session is live/);
    const footer = merge.closest("footer")!;
    expect(within(footer).getByText("A session is live: stop it before merging.")).toBeInTheDocument();
    expect(within(footer).getByText("+1 more")).toBeInTheDocument();
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
