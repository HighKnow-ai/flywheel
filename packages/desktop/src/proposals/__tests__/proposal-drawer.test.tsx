/**
 * Behaviour under test (issue #162, docs/mvp-spec.md §5 "One row" and "Card"): Needs you shows the Proposals
 * running Stories filed as ONE row, "n from m Stories", whose Triage opens the drawer; the drawer groups them by
 * the record each lands on (each Epic in the core's Roadmap order, then "Roadmap · after this Milestone"), and each
 * card shows its kind, title, change, why, evidence and the Story that filed it, decided in place with Accept,
 * Amend and Reject on the existing commands. An Epic row's "n Proposals" opens the drawer at that Epic.
 *
 * The backend is a small stateful fake: a decision takes the Proposal off the list the next read returns, as the
 * core does, so the row's count and the drawer move together.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NeedsYouList } from "../../board/NeedsYou";
import { ProposalDrawer, ProposalsMarker } from "../ProposalDrawer";
import { useTriageDrawer } from "../triageStore";
import { resetUiState } from "../../state/uiStore";
import type { NeedsYouItemDto, TriageProposalDto } from "../../adapters/tauri";

const proposalAccept = vi.fn();
const proposalAmend = vi.fn();
const proposalReject = vi.fn();
const proposalListForTriage = vi.fn();
const needsYouList = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    needsYouList: (...args: unknown[]) => needsYouList(...args),
    proposalListForTriage: (...args: unknown[]) => proposalListForTriage(...args),
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalAmend: (...args: unknown[]) => proposalAmend(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

function card(id: string, verb: string, targetType: string, epicId: string | null, payload: Record<string, unknown>, filer: [string, string], extra: Partial<TriageProposalDto> = {}): TriageProposalDto {
  return {
    proposal: {
      id, projectId: "p1", sessionId: `ses-${filer[0]}`, epicId, verb, targetType, targetId: null, payload,
      rationale: `why ${id}`, state: "pending", createdAt: "2026-10-23T08:00:00Z", rejectionReason: null,
      stageId: null, roundId: null, evidence: `evidence ${id}`,
    },
    storyId: `s-${filer[0]}`, storyKey: filer[0], storyTitle: filer[1],
    epicKey: epicId ? `FLY-${epicId}` : null, epicTitle: epicId ? `Epic ${epicId}` : null, milestoneTitle: null,
    targetKey: null, targetTitle: null, reorder: null, ...extra,
  };
}

/** The criteria the New Story carries (issue #166): one proven by a Check, one judged at review. */
const CRITERIA = [
  { statement: "An empty line yields no token", check: "cargo test -p core --test lexer" },
  { statement: "The error names the line" },
];

/** What the core returns, in its order: Epic A's Proposals, then Epic B's, then the New Epic. */
function seed(): TriageProposalDto[] {
  return [
    card("p-new", "create", "story", "A", { title: "Empty-line recovery", description: "Skip it and go on", rank: null, criteria: CRITERIA }, ["FLY-2", "Parser"]),
    card("p-reorder", "reorder", "story", "A", { rank: "b" }, ["FLY-2", "Parser"], {
      targetKey: "FLY-4", targetTitle: "Printer", reorder: { nowAfter: "FLY-3", proposedAfter: "FLY-2" },
    }),
    card("p-retire", "retire", "story", "B", {}, ["FLY-5", "Lexer"], { targetKey: "FLY-6", targetTitle: "Old lexer" }),
    card("p-epic", "create", "epic", null, { milestone_id: "m-2", title: "Error recovery", problem: "One bad line stops the parse" }, ["FLY-5", "Lexer"], {
      milestoneTitle: "Relay",
    }),
  ];
}

let pending: TriageProposalDto[] = [];

function needsYouOf(): NeedsYouItemDto[] {
  if (pending.length === 0) return [];
  const stories = new Set(pending.map((t) => t.storyId)).size;
  const epics = new Set(pending.map((t) => t.proposal.epicId).filter(Boolean)).size;
  return [
    {
      kind: "proposals", rank: 5, id: "p1", since: "2026-10-23T08:00:00Z",
      record: { kind: "project", id: "p1", key: null, title: "", state: null },
      sessionId: null, request: null, endingReason: null, missingWorktree: false, doingTaskTitle: null,
      exitTest: null, milestoneTitle: null, round: null, conflicts: [], judgedOn: null,
      proposals: { count: pending.length, stories, epics, roadmap: pending.some((t) => t.proposal.epicId === null) },
    },
  ];
}

const decided = (id: string) => {
  pending = pending.filter((t) => t.proposal.id !== id);
  return Promise.resolve();
};

function renderBoardBits(extra: React.ReactNode = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <NeedsYouList projectId="p1" />
      {extra}
      <ProposalDrawer projectId="p1" />
    </QueryClientProvider>,
  );
}

async function openDrawer() {
  renderBoardBits();
  fireEvent.click(await screen.findByRole("button", { name: "Triage 4 Proposals" }));
  const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
  await within(drawer).findByText("Empty-line recovery");
  return drawer;
}

function cardOf(id: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-proposal-card="${id}"]`);
  if (!el) throw new Error(`no card ${id}`);
  return el;
}

beforeEach(() => {
  resetUiState();
  useTriageDrawer.getState().closeTriage();
  pending = seed();
  needsYouList.mockReset().mockImplementation(() => Promise.resolve(needsYouOf()));
  proposalListForTriage.mockReset().mockImplementation(() => Promise.resolve(pending));
  proposalAccept.mockReset().mockImplementation(decided);
  proposalAmend.mockReset().mockImplementation(decided);
  proposalReject.mockReset().mockImplementation(decided);
});

afterEach(() => {
  cleanup();
  useTriageDrawer.getState().closeTriage();
});

describe("Proposals in Needs you and the triage drawer", () => {
  it("Needs you shows one Proposals row, n from m Stories, and where they land", async () => {
    renderBoardBits();
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-kind="proposals"]');
      if (!el) throw new Error("no Proposals row");
      return el;
    });
    expect(document.querySelectorAll('[data-kind="proposals"]')).toHaveLength(1);
    expect(within(row).getByText("Proposals")).toBeInTheDocument();
    expect(within(row).getByText("4 from 2 Stories")).toBeInTheDocument();
    expect(within(row).getByText("On 2 Epics and the Roadmap")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: "Triage 4 Proposals" })).toBeInTheDocument();
  });

  it("Triage opens the drawer grouped by Epic, then the Roadmap, each card complete", async () => {
    const drawer = await openDrawer();
    expect(proposalListForTriage).toHaveBeenCalledWith("p1");
    const headings = (await within(drawer).findAllByRole("heading", { level: 3 })).map((h) => h.textContent);
    expect(headings).toEqual(["FLY-AEpic A2", "FLY-BEpic B1", "Roadmap · after this Milestone1"]);
    const ids = [...drawer.querySelectorAll<HTMLElement>("[data-proposal-card]")].map((c) => c.dataset.proposalCard);
    expect(ids).toEqual(["p-new", "p-reorder", "p-retire", "p-epic"]);

    const story = cardOf("p-new");
    expect(within(story).getByText("New Story")).toBeInTheDocument();
    expect(within(story).getByText("Empty-line recovery")).toBeInTheDocument();
    expect(within(story).getByText("Why: why p-new")).toBeInTheDocument();
    expect(within(story).getByText("evidence p-new")).toBeInTheDocument();
    expect(within(story).getByText("FLY-2")).toBeInTheDocument();
    expect(within(story).getByText("Parser")).toBeInTheDocument();

    // A Reorder's change is a before and after; it carries no text, so no Amend.
    const reorder = cardOf("p-reorder");
    expect(within(reorder).getByText("Reorder")).toBeInTheDocument();
    expect(within(reorder).getByText("after FLY-3").tagName).toBe("DEL");
    expect(within(reorder).getByText("after FLY-2").tagName).toBe("INS");
    expect(within(reorder).queryByRole("button", { name: /^Amend/ })).toBeNull();

    expect(within(cardOf("p-retire")).getByText("Retire Story")).toBeInTheDocument();
    const epic = cardOf("p-epic");
    expect(within(epic).getByText("New Epic")).toBeInTheDocument();
    expect(within(epic).getByText("Created in Shaping, in Milestone “Relay”")).toBeInTheDocument();
  });

  it("Accept lands the Proposal, takes it off the drawer and the row, and moves the keyboard to the next card", async () => {
    const drawer = await openDrawer();
    fireEvent.click(within(cardOf("p-reorder")).getByRole("button", { name: "Accept Reorder “FLY-4 Printer”" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("p-reorder"));
    await waitFor(() => expect(drawer.querySelector('[data-proposal-card="p-reorder"]')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(within(cardOf("p-retire")).getByRole("button", { name: /^Accept/ })));
    expect(within(drawer).getByRole("status")).toHaveTextContent("Decided. 3 Proposals left to triage.");
    await waitFor(() => expect(screen.getByText("3 from 2 Stories")).toBeInTheDocument());
  });

  it("Amend edits a New Story's title and description and accepts the edit in one act", async () => {
    await openDrawer();
    const story = cardOf("p-new");
    fireEvent.click(within(story).getByRole("button", { name: "Amend New Story “Empty-line recovery”" }));
    const title = within(story).getByRole("textbox", { name: "Title" });
    expect(within(story).getByText("Why: why p-new")).toBeInTheDocument();
    fireEvent.change(title, { target: { value: "Recover from an empty line" } });
    fireEvent.change(within(story).getByRole("textbox", { name: "Description" }), { target: { value: "" } });
    fireEvent.click(within(story).getByRole("button", { name: "Accept edit to New Story “Empty-line recovery”" }));
    await waitFor(() =>
      expect(proposalAmend).toHaveBeenCalledWith("p-new", { title: "Recover from an empty line", description: null, rank: null, criteria: CRITERIA }),
    );
  });

  it("Reject keeps the developer's reason", async () => {
    await openDrawer();
    const retire = cardOf("p-retire");
    fireEvent.click(within(retire).getByRole("button", { name: "Reject Retire Story “FLY-6 Old lexer”" }));
    fireEvent.change(within(retire).getByRole("textbox", { name: "Why not? (optional)" }), { target: { value: "Still needed" } });
    fireEvent.click(within(retire).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("p-retire", "Still needed"));
  });

  it("deciding every card empties the drawer and takes the row off Needs you", async () => {
    const drawer = await openDrawer();
    for (const id of ["p-new", "p-reorder", "p-retire", "p-epic"]) {
      fireEvent.click(within(cardOf(id)).getByRole("button", { name: /^Accept/ }));
      await waitFor(() => expect(drawer.querySelector(`[data-proposal-card="${id}"]`)).toBeNull());
    }
    expect(await within(drawer).findByText("Nothing to triage")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector('[data-kind="proposals"]')).toBeNull());
  });

  it("an Epic row's n Proposals opens the drawer at that Epic's group", async () => {
    renderBoardBits(<ProposalsMarker projectId="p1" epic={{ id: "B", title: "Epic B" }} count={1} />);
    fireEvent.click(await screen.findByRole("button", { name: "Triage 1 Proposal on Epic B" }));
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await within(drawer).findByText("Old lexer");
    await waitFor(() => expect(document.activeElement?.textContent).toBe("FLY-BEpic B1"));
  });

  // Issue #165: a duplicate waits in the drawer, flagged with what it repeats; accepting the original closes it.
  it("a duplicate's card says what it repeats, and accepting the original takes both off the drawer", async () => {
    pending = [
      ...seed(),
      card("p-dup", "create", "story", "A", { title: "empty-line recovery", rank: null }, ["FLY-5", "Lexer"], {
        duplicate: { proposalId: "p-new", title: "Empty-line recovery", storyKey: "FLY-2" },
      }),
    ];
    // As the core does: accepting the original rejects its duplicates in the same transaction.
    proposalAccept.mockImplementation((id: string) => {
      pending = pending.filter((t) => t.proposal.id !== id && t.duplicate?.proposalId !== id);
      return Promise.resolve();
    });
    renderBoardBits();
    fireEvent.click(await screen.findByRole("button", { name: "Triage 5 Proposals" }));
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await within(drawer).findByText("empty-line recovery");

    const dup = cardOf("p-dup");
    expect(dup.dataset.duplicate).toBe("p-new");
    const flag = within(dup).getByText(/^Duplicate of/).closest("[data-duplicate-of]") as HTMLElement;
    expect(flag).toHaveTextContent("Duplicate of “Empty-line recovery”, filed by FLY-2. Accepting that one closes this one.");
    expect(cardOf("p-new").querySelector("[data-duplicate-of]")).toBeNull();
    expect(within(cardOf("p-new")).queryByText(/Duplicate of/)).toBeNull();

    fireEvent.click(within(cardOf("p-new")).getByRole("button", { name: "Accept New Story “Empty-line recovery”" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("p-new"));
    await waitFor(() => expect(drawer.querySelector('[data-proposal-card="p-dup"]')).toBeNull());
    expect(drawer.querySelector('[data-proposal-card="p-new"]')).toBeNull();
    expect(within(drawer).getByRole("status")).toHaveTextContent("Decided. 3 Proposals left to triage.");
  });

  it("an Epic with no pending Proposal carries no marker", () => {
    renderBoardBits(<ProposalsMarker projectId="p1" epic={{ id: "C", title: "Epic C" }} count={0} />);
    expect(screen.queryByRole("button", { name: /Proposals? on Epic C/ })).toBeNull();
  });

  it("a New Story's card lists the criteria it carries, each with its Check or judged at review (issue #166)", async () => {
    const drawer = await openDrawer();
    const list = within(drawer).getByRole("list", { name: "Proposed Acceptance criteria" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "An empty line yields no tokenCheck: cargo test -p core --test lexer",
      "The error names the lineJudged at review",
    ]);
    expect(within(cardOf("p-new")).getByText("2 Acceptance criteria")).toBeTruthy();
    expect(within(cardOf("p-reorder")).queryByRole("list", { name: "Proposed Acceptance criteria" })).toBeNull();
  });
});
