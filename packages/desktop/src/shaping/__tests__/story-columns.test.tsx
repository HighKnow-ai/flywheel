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
import type { ProposalDto, StoryDto } from "../../adapters/tauri";

const proposalAccept = vi.fn();
const proposalAmend = vi.fn();
const proposalReject = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalAmend: (...args: unknown[]) => proposalAmend(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
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

function storyProposal(id: string, verb: string, payload: Record<string, unknown>, extra: Partial<ProposalDto> = {}): ProposalDto {
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

function newStory(id: string, title: string, rank: string, extra: Record<string, unknown> = {}, proposal: Partial<ProposalDto> = {}) {
  return storyProposal(
    id,
    "create",
    { title, description: `${title}: proposed.`, rank, runs_after_story_id: null, runs_after_proposal_id: null, runs_after_reason: null, ...extra },
    proposal,
  );
}

function renderColumns(stories: StoryDto[], proposals: ProposalDto[]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <StoryColumns stories={stories} proposals={proposals} queryKey={["board", "p1", "shaping-rounds", "e1"]} />
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
const FEED = story("s2", "FLY-12", "Feed row", "a2", { runsAfterStoryId: "s1", runsAfterReason: "shares `FeedRow.tsx`" });

beforeEach(() => {
  proposalAccept.mockReset().mockResolvedValue(undefined);
  proposalAmend.mockReset().mockResolvedValue(undefined);
  proposalReject.mockReset().mockResolvedValue(undefined);
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
      expect(within(ghost).getByRole("button", { name: new RegExp(`^${name} the proposed Story`) })).toBeInTheDocument();
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
      [newStory("p1", "Schema", "a1"), newStory("p2", "Feed", "a2", { runs_after_proposal_id: "p1", runs_after_reason: "reads its table" })],
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
    fireEvent.change(screen.getByPlaceholderText("Why not? (optional)"), { target: { value: "Fold it into the feed" } });
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
    expect(move).toHaveTextContent("Moves after FLY-12 Feed row");
    expect(move).toHaveTextContent("Needs the row first");
    const feed = screen.getByRole("listitem", { name: "2. FLY-12 Feed row" });
    const retire = within(feed).getByRole("group", { name: "Proposed retirement of FLY-12" });
    expect(retire).toHaveTextContent("Folded into the parser");
    fireEvent.click(within(retire).getByRole("button", { name: "Accept the retirement of FLY-12" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("r1"));
    expect(within(move).queryByRole("button", { name: /Amend/ })).toBeNull();
  });

  it("shrinks rejected Story Proposals to struck-through lines with their reason", () => {
    renderColumns([PARSER], [newStory("p1", "Schema", "a1", {}, { state: "rejected", rejectionReason: "Fold it into the feed" })]);
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
