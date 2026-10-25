/**
 * Behaviour under test (issue #127): slicing an Epic lays its Stories out as columns, left to right in
 * execution order. A pending New Story Proposal is a ghost column standing where the Story would land, decided
 * there (Accept, Amend, Reject); a pending move or retirement sits on its Story's column; a runs-after
 * constraint is drawn between the two Stories it links, with its one-line reason. Rejected Story Proposals
 * shrink to struck-through lines with their reason.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StoryColumns } from "../StoryColumns";
import type { AcceptanceCriterionDto, ProposalDto, StoryDto } from "../../adapters/tauri";
import { expectDecisionGroup } from "./decision-group";

const proposalAccept = vi.fn();
const proposalAmend = vi.fn();
const proposalReject = vi.fn();
const criterionList = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalAmend: (...args: unknown[]) => proposalAmend(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
    criterionList: (...args: unknown[]) => criterionList(...args),
  };
});

function story(id: string, key: string, title: string, rank: string, extra: Partial<StoryDto> = {}): StoryDto {
  return {
    id,
    projectId: "p1",
    epicId: "e1",
    key,
    title,
    description: `${title}: ships on its own.`,
    state: "shaping",
    runsAfterStoryId: null,
    runsAfterReason: null,
    rank,
    ...extra,
  };
}

function storyProposal(
  id: string,
  verb: string,
  payload: Record<string, unknown>,
  extra: Partial<ProposalDto> = {},
): ProposalDto {
  return {
    id,
    projectId: "p1",
    sessionId: "run-s",
    epicId: "e1",
    verb,
    targetType: "story",
    targetId: null,
    payload,
    rationale: null,
    state: "pending",
    createdAt: "2026-10-22T10:00:00Z",
    rejectionReason: null,
    stageId: "s2",
    roundId: null,
    ...extra,
  };
}

function newStory(
  id: string,
  title: string,
  rank: string,
  extra: Record<string, unknown> = {},
  proposal: Partial<ProposalDto> = {},
) {
  return storyProposal(
    id,
    "create",
    {
      title,
      description: `${title}: proposed.`,
      rank,
      runs_after_story_id: null,
      runs_after_proposal_id: null,
      runs_after_reason: null,
      ...extra,
    },
    proposal,
  );
}

function renderColumns(stories: StoryDto[], proposals: ProposalDto[], options: { criteria?: boolean } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryColumns
        projectId="p1"
        stories={stories}
        proposals={proposals}
        queryKey={["board", "p1", "shaping-rounds", "e1"]}
        criteria={options.criteria ?? false}
      />
    </QueryClientProvider>,
  );
}

/** The columns in execution order, by their accessible names. */
function columnNames() {
  const list = screen.getByRole("list", { name: "Stories in execution order" });
  return within(list)
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("aria-label"));
}

const PARSER = story("s1", "FLY-11", "Parser", "a0");
const FEED = story("s2", "FLY-12", "Feed row", "a2", {
  runsAfterStoryId: "s1",
  runsAfterReason: "shares `FeedRow.tsx`",
});

beforeEach(() => {
  proposalAccept.mockReset().mockResolvedValue(undefined);
  proposalAmend.mockReset().mockResolvedValue(undefined);
  proposalReject.mockReset().mockResolvedValue(undefined);
  criterionList.mockReset().mockResolvedValue([]);
});

describe("StoryColumns", () => {
  it("lays the Stories out left to right in execution order, with ghost columns where pending Stories would land", () => {
    renderColumns([FEED, PARSER], [newStory("p1", "Schema", "a1"), newStory("p2", "Polish", "a3")]);
    expect(columnNames()).toEqual([
      "1. FLY-11 Parser",
      "2. Proposed Story: Schema",
      "3. FLY-12 Feed row",
      "4. Proposed Story: Polish",
    ]);
    const ghost = screen.getByRole("listitem", { name: "2. Proposed Story: Schema" });
    expect(ghost).toHaveAttribute("data-state", "pending");
    expect(within(ghost).getByText("Schema: proposed.")).toBeInTheDocument();
    for (const name of ["Accept", "Amend", "Reject"]) {
      expect(
        within(ghost).getByRole("button", { name: new RegExp(`^${name} the proposed Story`) }),
      ).toBeInTheDocument();
    }
  });

  it("leaves a dropped Story out of the order", () => {
    renderColumns([PARSER, story("s3", "FLY-13", "Gone", "a1", { state: "dropped" })], []);
    expect(columnNames()).toEqual(["1. FLY-11 Parser"]);
  });

  it("shows the constraint between the two Stories it links, with its reason", () => {
    renderColumns([PARSER, FEED], []);
    const constraints = screen.getByRole("list", { name: "Runs-after constraints" });
    const item = within(constraints).getByRole("listitem");
    expect(item).toHaveTextContent("FLY-12 runs after FLY-11");
    expect(item).toHaveTextContent("shares `FeedRow.tsx`");
    // Drawn from the column it runs after to its own: columns 1 and 2.
    expect(item).toHaveAttribute("data-from", "1");
    expect(item).toHaveAttribute("data-to", "2");
    expect(item).toHaveAttribute("data-provisional", "false");
  });

  it("draws a pending Story's constraint as provisional, even when it runs after another pending Story", () => {
    renderColumns(
      [PARSER],
      [
        newStory("p1", "Schema", "a1"),
        newStory("p2", "Feed", "a2", { runs_after_proposal_id: "p1", runs_after_reason: "reads its table" }),
      ],
    );
    const item = within(screen.getByRole("list", { name: "Runs-after constraints" })).getByRole("listitem");
    expect(item).toHaveTextContent("Feed runs after Schema");
    expect(item).toHaveTextContent("reads its table");
    expect(item).toHaveAttribute("data-from", "2");
    expect(item).toHaveAttribute("data-to", "3");
    expect(item).toHaveAttribute("data-provisional", "true");
  });

  it("accepts a pending Story from its ghost column", async () => {
    renderColumns([PARSER], [newStory("p1", "Schema", "a1")]);
    fireEvent.click(screen.getByRole("button", { name: "Accept the proposed Story Schema" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("p1"));
  });

  it("amends a pending Story's title, description and reason, keeping its place and what it runs after", async () => {
    const pending = newStory("p1", "Feed", "a1", { runs_after_story_id: "s1", runs_after_reason: "shares the parser" });
    renderColumns([PARSER], [pending]);
    fireEvent.click(screen.getByRole("button", { name: "Amend the proposed Story Feed" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Feed row" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "The row, tested." } });
    fireEvent.change(screen.getByLabelText("Why it runs after FLY-11"), { target: { value: "shares `FeedRow.tsx`" } });
    fireEvent.click(screen.getByRole("button", { name: "Accept edit to the proposed Story Feed" }));
    await waitFor(() =>
      expect(proposalAmend).toHaveBeenCalledWith("p1", {
        ...(pending.payload as Record<string, unknown>),
        title: "Feed row",
        description: "The row, tested.",
        runs_after_reason: "shares `FeedRow.tsx`",
      }),
    );
  });

  it("rejects a pending Story with an optional reason", async () => {
    renderColumns([], [newStory("p1", "Schema", "a1")]);
    fireEvent.click(screen.getByRole("button", { name: "Reject the proposed Story Schema" }));
    fireEvent.change(screen.getByPlaceholderText("Why not? (optional)"), {
      target: { value: "Fold it into the feed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("p1", "Fold it into the feed"));
  });

  it("puts a pending move or retirement on its Story's column, saying where it would land", async () => {
    renderColumns(
      [PARSER, FEED],
      [
        storyProposal("m1", "reorder", { rank: "a3" }, { targetId: "s1", rationale: "Needs the row first" }),
        storyProposal("r1", "retire", {}, { targetId: "s2", rationale: "Folded into the parser" }),
      ],
    );
    const parser = screen.getByRole("listitem", { name: "1. FLY-11 Parser" });
    const move = within(parser).getByRole("group", { name: "Proposed move of FLY-11" });
    expect(move).toHaveTextContent(/Moves after\s*FLY-12\s*Feed row/);
    expect(move).toHaveTextContent("Needs the row first");
    const feed = screen.getByRole("listitem", { name: "2. FLY-12 Feed row" });
    const retire = within(feed).getByRole("group", { name: "Proposed retirement of FLY-12" });
    expect(retire).toHaveTextContent("Folded into the parser");
    fireEvent.click(within(retire).getByRole("button", { name: "Accept the retirement of FLY-12" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("r1"));
    expect(within(move).queryByRole("button", { name: /Amend/ })).toBeNull();
  });

  it("shrinks rejected Story Proposals to struck-through lines with their reason", () => {
    renderColumns(
      [PARSER],
      [newStory("p1", "Schema", "a1", {}, { state: "rejected", rejectionReason: "Fold it into the feed" })],
    );
    expect(columnNames()).toEqual(["1. FLY-11 Parser"]);
    const rejected = screen.getByRole("group", { name: "Rejected Story Schema" });
    expect(within(rejected).getByText("Schema").tagName).toBe("DEL");
    expect(rejected).toHaveTextContent("Your reason: Fold it into the feed");
  });

  it("says what slicing will show before any Story is proposed", () => {
    renderColumns([], []);
    expect(screen.getByText(/No Story yet/)).toBeInTheDocument();
  });
});

// Issue #128: writing the Acceptance criteria. Each Story column stacks its criteria under its description, each
// with its Check as a chip or "judged at review"; a pending criterion Proposal is a ghost card under its Story,
// decided there.
function criterion(id: string, storyId: string, statement: string, command: string | null): AcceptanceCriterionDto {
  return {
    id,
    storyId,
    statement,
    accepted: false,
    acceptedAt: null,
    rank: id,
    check: command
      ? { id: `k-${id}`, command, timeoutSecs: 600, result: "not_run", commitSha: null, stale: false, outputTail: null }
      : null,
  };
}

function criterionProposal(
  id: string,
  storyId: string,
  statement: string,
  check: string | null,
  extra: Partial<ProposalDto> = {},
) {
  return storyProposal(
    id,
    "create",
    { story_id: storyId, statement, ...(check ? { check_command: check } : {}) },
    { targetType: "criterion", stageId: "s3", ...extra },
  );
}

function column(name: string) {
  return screen.getByRole("listitem", { name });
}

describe("StoryColumns: criteria (issue #128)", () => {
  it("stacks each Story's criteria under its column, with the Check as a chip or judged at review", async () => {
    criterionList.mockImplementation(async (storyId: string) =>
      storyId === "s1"
        ? [
            criterion("c1", "s1", "A malformed line is skipped", "cargo test -p core --test parser"),
            criterion("c2", "s1", "The error reads plainly", null),
          ]
        : [],
    );
    renderColumns([PARSER, FEED], [], { criteria: true });
    const parser = column("1. FLY-11 Parser");
    const list = await within(parser).findByRole("list", { name: "FLY-11 Acceptance criteria" });
    const rows = await within(list).findAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("span")?.textContent)).toEqual([
      "A malformed line is skipped",
      "The error reads plainly",
    ]);
    expect(within(rows[0]).getByText("Not run")).toBeInTheDocument();
    expect(within(rows[0]).getByText("cargo test -p core --test parser")).toBeInTheDocument();
    expect(within(rows[1]).getByText(/judged at review/i)).toBeInTheDocument();
    // A Story with no criterion yet says so where its criteria will go.
    expect(await within(column("2. FLY-12 Feed row")).findByText("No criterion yet")).toBeInTheDocument();
  });

  it("leaves the criteria out while slicing", () => {
    renderColumns([PARSER], []);
    expect(within(column("1. FLY-11 Parser")).queryByRole("list", { name: "FLY-11 Acceptance criteria" })).toBeNull();
    expect(criterionList).not.toHaveBeenCalled();
  });

  it("draws a pending criterion as a ghost card under its Story and accepts it there", async () => {
    criterionList.mockResolvedValue([]);
    renderColumns(
      [PARSER, FEED],
      [
        criterionProposal("pc1", "s2", "The row shows the live verb", "npm test -- feed-row"),
        criterionProposal("pc2", "s2", "It reads calmly", null),
      ],
      {
        criteria: true,
      },
    );
    const feed = column("2. FLY-12 Feed row");
    const ghost = within(feed).getByRole("group", { name: "Proposed criterion: The row shows the live verb" });
    expect(ghost).toHaveAttribute("data-state", "pending");
    expect(within(ghost).getByText("npm test -- feed-row")).toBeInTheDocument();
    expect(
      within(within(feed).getByRole("group", { name: "Proposed criterion: It reads calmly" })).getByText(
        /judged at review/i,
      ),
    ).toBeInTheDocument();
    expect(within(column("1. FLY-11 Parser")).queryByRole("group", { name: /Proposed criterion/ })).toBeNull();

    fireEvent.click(
      within(ghost).getByRole("button", { name: "Accept the proposed criterion The row shows the live verb" }),
    );
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("pc1"));
  });

  it("amends a pending criterion's statement and Check, never its Story", async () => {
    criterionList.mockResolvedValue([]);
    renderColumns([PARSER], [criterionProposal("pc1", "s1", "It parses", "cargo test")], { criteria: true });
    const ghost = within(column("1. FLY-11 Parser")).getByRole("group", { name: "Proposed criterion: It parses" });
    fireEvent.click(within(ghost).getByRole("button", { name: "Amend the proposed criterion It parses" }));
    fireEvent.change(within(ghost).getByLabelText("Criterion"), { target: { value: "A malformed line is skipped" } });
    fireEvent.change(within(ghost).getByLabelText("Check command (blank: judged at review)"), {
      target: { value: "  " },
    });
    fireEvent.click(within(ghost).getByRole("button", { name: "Accept edit to the proposed criterion It parses" }));
    await waitFor(() =>
      expect(proposalAmend).toHaveBeenCalledWith("pc1", {
        story_id: "s1",
        statement: "A malformed line is skipped",
        check_command: null,
      }),
    );
  });

  it("rejects a pending criterion with an optional reason, and shows it struck through", async () => {
    criterionList.mockResolvedValue([]);
    renderColumns([PARSER], [criterionProposal("pc1", "s1", "It parses", null)], { criteria: true });
    const ghost = within(column("1. FLY-11 Parser")).getByRole("group", { name: "Proposed criterion: It parses" });
    fireEvent.click(within(ghost).getByRole("button", { name: "Reject the proposed criterion It parses" }));
    fireEvent.change(within(ghost).getByPlaceholderText("Why not? (optional)"), {
      target: { value: "Not observable" },
    });
    fireEvent.click(within(ghost).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("pc1", "Not observable"));
  });

  it("shrinks a rejected criterion to a struck-through line with its reason", () => {
    renderColumns(
      [PARSER],
      [criterionProposal("pc1", "s1", "It is pretty", null, { state: "rejected", rejectionReason: "Not observable" })],
      {
        criteria: true,
      },
    );
    const rejected = screen.getByRole("group", { name: "Rejected criterion on FLY-11: It is pretty" });
    expect(within(rejected).getByText("It is pretty").tagName).toBe("DEL");
    expect(rejected).toHaveTextContent("Your reason: Not observable");
  });
});

describe("StoryColumns: one decision group, columns that scroll (issue #211)", () => {
  it("decides a ghost Story, a move, a retirement and a criterion through the same Button Group", async () => {
    criterionList.mockResolvedValue([]);
    renderColumns(
      [PARSER, FEED],
      [
        newStory("p1", "Schema", "a1"),
        storyProposal("m1", "reorder", { rank: "a3" }, { targetId: "s1" }),
        storyProposal("r1", "retire", {}, { targetId: "s2" }),
        criterionProposal("pc1", "s2", "The row shows the live verb", null),
      ],
      { criteria: true },
    );
    expectDecisionGroup(column("2. Proposed Story: Schema"), "the proposed Story Schema");
    expectDecisionGroup(screen.getByRole("group", { name: "Proposed move of FLY-11" }), "the move of FLY-11", {
      amend: false,
    });
    expectDecisionGroup(
      screen.getByRole("group", { name: "Proposed retirement of FLY-12" }),
      "the retirement of FLY-12",
      { amend: false },
    );
    expectDecisionGroup(
      screen.getByRole("group", { name: "Proposed criterion: The row shows the live verb" }),
      "the proposed criterion The row shows the live verb",
    );
  });

  it("numbers the columns with order chips: ink for a Story, dashed for a proposed one", () => {
    renderColumns([PARSER], [newStory("p1", "Schema", "a1")]);
    const ink = column("1. FLY-11 Parser").querySelector("[data-slot=badge][data-tone]");
    const ghost = column("2. Proposed Story: Schema").querySelector("[data-slot=badge][data-tone]");
    expect(ink).toHaveAttribute("data-tone", "ink");
    expect(ink).toHaveTextContent("1");
    expect(ghost).toHaveAttribute("data-tone", "ghost");
    expect(ghost).toHaveTextContent("2");
  });

  it("puts the columns and their brackets in one horizontal Scroll Area, named by the heading", () => {
    renderColumns([PARSER, FEED], []);
    // The section and the strip inside it are both named by the heading; the strip is the Scroll Area.
    const region = screen.getAllByRole("region", { name: "Stories" }).find((r) => r.dataset.slot === "scroll-area");
    if (!region) throw new Error("no Scroll Area region");
    const viewport = region.querySelector("[data-slot=scroll-area-viewport]") as HTMLElement;
    expect(within(viewport).getByRole("list", { name: "Stories in execution order" })).toBeInTheDocument();
    expect(within(viewport).getByRole("list", { name: "Runs-after constraints" })).toBeInTheDocument();
  });
});
