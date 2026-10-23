/**
 * Behaviour under test (issue #156, docs/mvp-spec.md §2 "Needs you", §7): Needs you draws the core's ranked
 * list in its order, each item with its kind, its record, a one-line detail and its action, and each action
 * works where it is: Allow once and Deny on a request (the permission-request card), Resume on a Stopped
 * Story, Recreate worktree on a missing one, Open review, Confirm exit test, Answer on a held Round and
 * Continue shaping on one no session works. Yellow is Waiting on you only. On the board it is a column beside
 * the roster.
 *
 * Issue #163: a judged-on change (an Amend criterion, or a Story session's Amend Epic spec) is its own item,
 * ranked with Review, showing its before and after, and decided in place: Accept, Edit, Reject.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NeedsYouList, NeedsYouSheetButton } from "../NeedsYou";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { NeedsYouItemDto } from "../../adapters/tauri";

const needsYouList = vi.fn();
const answerPermissionRequest = vi.fn();
const storyResume = vi.fn();
const worktreeRecreate = vi.fn();
const shapingContinue = vi.fn();
const epicConfirmDone = vi.fn();
const proposalAccept = vi.fn();
const proposalAmend = vi.fn();
const proposalReject = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    needsYouList: (...args: unknown[]) => needsYouList(...args),
    answerPermissionRequest: (...args: unknown[]) => answerPermissionRequest(...args),
    answerQuestion: () => Promise.resolve(),
    storyResume: (...args: unknown[]) => storyResume(...args),
    worktreeRecreate: (...args: unknown[]) => worktreeRecreate(...args),
    shapingContinue: (...args: unknown[]) => shapingContinue(...args),
    epicConfirmDone: (...args: unknown[]) => epicConfirmDone(...args),
    proposalAccept: (...args: unknown[]) => proposalAccept(...args),
    proposalAmend: (...args: unknown[]) => proposalAmend(...args),
    proposalReject: (...args: unknown[]) => proposalReject(...args),
    roadmapRoundRead: () => Promise.resolve({ open: null, last: null, proposals: [] }),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
  };
});

function item(kind: NeedsYouItemDto["kind"], id: string, extra: Partial<NeedsYouItemDto> = {}): NeedsYouItemDto {
  return {
    kind,
    rank: 1,
    id,
    since: "2026-10-23T09:00:00Z",
    record: { kind: "story", id: `s-${id}`, key: `FLY-${id}`, title: `Story ${id}`, state: null },
    sessionId: null,
    request: null,
    endingReason: null,
    missingWorktree: false,
    doingTaskTitle: null,
    exitTest: null,
    milestoneTitle: null,
    round: null,
    conflicts: [],
    proposals: null,
    judgedOn: null,
    ...extra,
  };
}

const RANKED: NeedsYouItemDto[] = [
  item("gated_action", "1", {
    sessionId: "ses-1",
    request: { id: "req-1", toolName: "Bash", inputPayload: '{"command":"git push --force origin main"}', destructiveCategory: "force-push", suggestedRule: null },
  }),
  item("permission_request", "2", {
    sessionId: "ses-2",
    request: { id: "req-2", toolName: "Bash", inputPayload: '{"command":"npm test"}', destructiveCategory: null, suggestedRule: "Bash(npm test:*)" },
  }),
  item("stopped", "3", { rank: 2, sessionId: "ses-3", endingReason: "crash", doingTaskTitle: "Wire the parser" }),
  item("stopped", "4", { rank: 2, missingWorktree: true }),
  item("review", "5", { rank: 3 }),
  item("confirm_exit_test", "e-6", {
    rank: 4,
    record: { kind: "epic", id: "e-6", key: "FLY-E6", title: "Roster", state: null },
    exitTest: "Cyril can tell at a glance what every Story is doing",
    milestoneTitle: "Board and review",
  }),
  item("shaping_round", "r-7", {
    rank: 6,
    record: { kind: "epic", id: "e-7", key: "FLY-E7", title: "Shaping held", state: null },
    round: { roundId: "r-7", roundNumber: 2, subject: "epic", waitingOnYou: true, answered: 1, questions: 3 },
  }),
  item("shaping_round", "r-8", {
    rank: 6,
    record: { kind: "epic", id: "e-8", key: "FLY-E8", title: "Shaping dead", state: null },
    round: { roundId: "r-8", roundNumber: 1, subject: "epic", waitingOnYou: false, answered: 0, questions: 2 },
  }),
];

function renderList(node = <NeedsYouList projectId="p1" />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}

async function cards() {
  renderList();
  const list = await screen.findByRole("list", { name: "Needs you, most urgent first" });
  return (await within(list).findAllByRole("listitem")).filter((li) => li.parentElement === list);
}

function cardOf(id: string): HTMLElement {
  const card = document.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
  if (!card) throw new Error(`no card ${id}`);
  return card;
}

beforeEach(() => {
  resetUiState();
  needsYouList.mockReset();
  needsYouList.mockResolvedValue(RANKED);
  answerPermissionRequest.mockReset();
  answerPermissionRequest.mockResolvedValue(undefined);
  storyResume.mockReset();
  storyResume.mockResolvedValue(undefined);
  worktreeRecreate.mockReset();
  worktreeRecreate.mockResolvedValue(undefined);
  shapingContinue.mockReset();
  shapingContinue.mockResolvedValue({});
  epicConfirmDone.mockReset();
  for (const write of [proposalAccept, proposalAmend, proposalReject]) {
    write.mockReset();
    write.mockResolvedValue(undefined);
  }
});

afterEach(() => {
  cleanup();
  resetUiState();
});

describe("Needs you", () => {
  it("draws the items in the core's ranked order, one card each", async () => {
    const list = await cards();
    expect(needsYouList).toHaveBeenCalledWith("p1");
    expect(list.map((li) => li.getAttribute("data-kind"))).toEqual(RANKED.map((i) => i.kind));
  });

  it("shows each item's kind, record and one-line detail", async () => {
    await cards();
    // A Gated action: Waiting on you, its record, and the literal command on its card.
    const gated = cardOf("1");
    expect(within(gated).getAllByText("Waiting on you").length).toBeGreaterThan(0);
    expect(within(gated).getByText("Gated action")).toBeInTheDocument();
    expect(within(gated).getByRole("button", { name: "Open Story FLY-1 Story 1" })).toBeInTheDocument();
    expect(within(gated).getByText("git push --force origin main")).toBeInTheDocument();

    const stopped = cardOf("3");
    expect(within(stopped).getByText("Stopped")).toBeInTheDocument();
    expect(within(stopped).getByText("Stopped: crash · was doing “Wire the parser”")).toBeInTheDocument();

    expect(within(cardOf("4")).getByText("Missing worktree")).toBeInTheDocument();
    expect(within(cardOf("4")).getByText(/worktree is missing from disk/)).toBeInTheDocument();
    expect(within(cardOf("5")).getByText("In review")).toBeInTheDocument();

    const confirm = cardOf("e-6");
    expect(within(confirm).getByText("Confirm exit test", { selector: "[data-slot=badge]" })).toBeInTheDocument();
    expect(within(confirm).getByRole("button", { name: "Open Epic FLY-E6 Roster" })).toBeInTheDocument();
    expect(within(confirm).getByText("Cyril can tell at a glance what every Story is doing")).toBeInTheDocument();

    expect(within(cardOf("r-7")).getByText("Round 2 · 1 of 3 answered")).toBeInTheDocument();
    expect(within(cardOf("r-8")).getByText("Shaping Round waiting")).toBeInTheDocument();
    expect(within(cardOf("r-8")).getByText("Round 1 · No live session: your answers are kept")).toBeInTheDocument();
  });

  it("wears yellow only where a live session is held: the requests and the held Round", async () => {
    await cards();
    const lit = Array.from(document.querySelectorAll("[data-attention=waiting]")).map((el) => el.getAttribute("data-item-id"));
    expect(lit).toEqual(["1", "2", "r-7"]);
    expect(cardOf("3")).toHaveAttribute("data-attention", "stopped");
  });

  it("answers a Gated action in place, Deny leading, and refetches", async () => {
    await cards();
    const gated = cardOf("1");
    const deny = within(gated).getByRole("button", { name: "Deny" });
    const allow = within(gated).getByRole("button", { name: "Allow once" });
    expect(deny.compareDocumentPosition(allow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(allow);
    await waitFor(() => expect(answerPermissionRequest).toHaveBeenCalledWith("req-1", "allow", undefined));
    await waitFor(() => expect(needsYouList).toHaveBeenCalledTimes(2));
  });

  it("allows a permission request once, in place", async () => {
    await cards();
    fireEvent.click(within(cardOf("2")).getByRole("button", { name: "Allow once" }));
    await waitFor(() => expect(answerPermissionRequest).toHaveBeenCalledWith("req-2", "allow", undefined));
  });

  it("resumes a Stopped Story in place, opening nothing", async () => {
    await cards();
    fireEvent.click(within(cardOf("3")).getByRole("button", { name: "Resume FLY-3" }));
    fireEvent.click(await screen.findByRole("button", { name: "Start the new session for FLY-3" }));
    await waitFor(() => expect(storyResume).toHaveBeenCalledWith("s-3", undefined));
    expect(useUiStore.getState().activeSessionId).toBeNull();
    expect(useUiStore.getState().currentStoryId).toBeNull();
  });

  it("recreates a missing worktree in place", async () => {
    await cards();
    fireEvent.click(within(cardOf("4")).getByRole("button", { name: "Recreate the worktree of FLY-4" }));
    await waitFor(() => expect(worktreeRecreate).toHaveBeenCalledWith("s-4"));
  });

  it("labels a conflicting Review item Rebase needed, naming the paths (issue #158)", async () => {
    needsYouList.mockResolvedValue([item("review", "5", { rank: 3, conflicts: ["README.md", "src/lib.rs"] })]);
    await cards();
    const card = cardOf("5");
    expect(within(card).getByText("Rebase needed")).toBeInTheDocument();
    expect(within(card).getByText("Merging would conflict in README.md, src/lib.rs: request a rebase from its review")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Open review of FLY-5 Story 5" })).toBeInTheDocument();
  });

  it("Open review opens the Story view, never the session", async () => {
    await cards();
    fireEvent.click(within(cardOf("5")).getByRole("button", { name: "Open review of FLY-5 Story 5" }));
    expect(useUiStore.getState().currentStoryId).toBe("s-5");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("confirms an Epic's exit test through the same dialog the Epic card uses", async () => {
    await cards();
    fireEvent.click(within(cardOf("e-6")).getByRole("button", { name: "Confirm exit test of FLY-E6 Roster" }));
    expect(await screen.findByText("Confirm the exit test of Roster?")).toBeInTheDocument();
    epicConfirmDone.mockResolvedValue({ outcome: "started", roundNumber: 1, sessionError: null });
    fireEvent.click(screen.getByRole("button", { name: "Confirm FLY-E6 Roster Done" }));
    await waitFor(() => expect(epicConfirmDone).toHaveBeenCalledWith("e-6"));
  });

  it("Answer on a held Round opens its Epic's shaping view; Continue shaping starts a session and stays", async () => {
    await cards();
    fireEvent.click(within(cardOf("r-8")).getByRole("button", { name: "Continue shaping FLY-E8 Shaping dead" }));
    await waitFor(() => expect(shapingContinue).toHaveBeenCalledWith("e-8"));
    expect(useUiStore.getState().currentEpicId).toBeNull();

    fireEvent.click(within(cardOf("r-7")).getByRole("button", { name: "Answer Round 2 of FLY-E7 Shaping held" }));
    expect(useUiStore.getState().currentEpicId).toBe("e-7");
  });

  it("a record opens its Story", async () => {
    await cards();
    fireEvent.click(within(cardOf("3")).getByRole("button", { name: "Open Story FLY-3 Story 3" }));
    expect(useUiStore.getState().currentStoryId).toBe("s-3");
  });

  it("fills only the first card's primary action; every other is an outline (one filled primary per region)", async () => {
    await cards();
    const filled = Array.from(document.querySelectorAll('[data-item-id] [data-variant="default"]'));
    expect(filled).toHaveLength(1);
    expect(filled[0]).toHaveAccessibleName("Resume FLY-3");
    expect(within(cardOf("4")).getByRole("button", { name: "Recreate the worktree of FLY-4" })).toHaveAttribute("data-variant", "outline");
    expect(within(cardOf("e-6")).getByRole("button", { name: "Confirm exit test of FLY-E6 Roster" })).toHaveAttribute("data-variant", "outline");
  });

  it("names a request's kind once: no yellow header inside the card", async () => {
    await cards();
    expect(within(cardOf("1")).queryByText(/needs your OK every time/)).toBeNull();
    expect(within(cardOf("1")).getByText("No rule can cover it")).toBeInTheDocument();
  });

  it("folds a question to its first line until Answer opens its form in place", async () => {
    needsYouList.mockResolvedValue([
      item("question", "q", {
        sessionId: "ses-q",
        request: {
          id: "req-q",
          toolName: "AskUserQuestion",
          inputPayload: JSON.stringify({ questions: [{ question: "Count Dropped Stories?", header: "Dropped", options: [{ label: "Yes", description: "" }], multiSelect: false }] }),
          destructiveCategory: null,
          suggestedRule: null,
        },
      }),
    ]);
    await cards();
    const card = cardOf("q");
    expect(within(card).getByText("Count Dropped Stories?")).toBeInTheDocument();
    const answer = within(card).getByRole("button", { name: "Answer FLY-q's question" });
    expect(answer).toHaveAttribute("aria-expanded", "false");
    expect(within(card).queryByRole("group", { name: "The agent has a question" })).toBeNull();
    fireEvent.click(answer);
    expect(answer).toHaveAttribute("aria-expanded", "true");
    expect(within(card).getByRole("group", { name: "The agent has a question" })).toBeInTheDocument();
  });

  it("when an answer takes a card off the list, says so and moves the keyboard to the card in its place", async () => {
    const remaining = RANKED.filter((i) => i.id !== "2");
    await cards();
    const allow = within(cardOf("2")).getByRole("button", { name: "Allow once" });
    allow.focus();
    needsYouList.mockResolvedValue(remaining);
    fireEvent.click(allow);
    await waitFor(() => expect(document.querySelector('[data-item-id="2"]')).toBeNull());
    expect(await screen.findByRole("status")).toHaveTextContent(`FLY-2 off the list. ${remaining.length} items need you.`);
    await waitFor(() => expect(document.activeElement).toBe(within(cardOf("3")).getByRole("button", { name: "Open Story FLY-3 Story 3" })));
  });

  it("says so when nothing needs you", async () => {
    needsYouList.mockResolvedValue([]);
    renderList();
    expect(await screen.findByText("Nothing needs you")).toBeInTheDocument();
  });
});

describe("Needs you below 1280px", () => {
  it("opens as a Sheet from the top bar's button, which carries the count", async () => {
    renderList(<NeedsYouSheetButton projectId="p1" />);
    const button = await screen.findByRole("button", { name: `Open Needs you, ${RANKED.length} items` });
    expect(within(button).getByText(String(RANKED.length))).toBeInTheDocument();
    fireEvent.click(button);
    const sheet = await screen.findByRole("dialog");
    expect(within(sheet).getByRole("list", { name: "Needs you, most urgent first" })).toBeInTheDocument();
  });
});

const AMEND_CRITERION = item("judged_on", "p-1", {
  rank: 3,
  judgedOn: {
    proposalId: "p-1",
    change: "amend_criterion",
    criterionId: "c-1",
    field: null,
    before: "Parses a line",
    after: "Parses an empty line as no token",
    checkBefore: "cargo test parser",
    checkAfter: "cargo test parser::empty_line",
    payload: { criterion_id: "c-1", statement: "Parses an empty line as no token", check_command: "cargo test parser::empty_line" },
    rationale: "The criterion misses the empty line",
    evidence: "src/parser.rs:42 panics on an empty line",
    filedBy: "FLY-p-1",
  },
});

const AMEND_SPEC = item("judged_on", "p-2", {
  rank: 3,
  record: { kind: "epic", id: "e-2", key: "FLY-E2", title: "Execution", state: null },
  judgedOn: {
    proposalId: "p-2",
    change: "amend_epic_spec",
    criterionId: null,
    field: "scope",
    before: "Parse a line",
    after: "Parse every line, empty ones included",
    checkBefore: null,
    checkAfter: null,
    payload: { field: "scope", text: "Parse every line, empty ones included" },
    rationale: "Empty lines reach the parser",
    evidence: "fixtures/empty.txt",
    filedBy: "FLY-9",
  },
});

describe("Needs you: judged-on changes", () => {
  beforeEach(() => {
    needsYouList.mockResolvedValue([item("review", "5", { rank: 3 }), AMEND_CRITERION, AMEND_SPEC]);
  });

  it("draws each judged-on change as its own card, named by its kind, ranked with Review", async () => {
    const list = await cards();
    expect(list.map((li) => li.getAttribute("data-kind"))).toEqual(["review", "judged_on", "judged_on"]);
    expect(within(cardOf("p-1")).getByText("Amend criterion")).toBeInTheDocument();
    expect(within(cardOf("p-2")).getByText("Amend Epic spec")).toBeInTheDocument();
    expect(within(cardOf("p-2")).getByRole("button", { name: "Open Epic FLY-E2 Execution" })).toBeInTheDocument();
    expect(cardOf("p-1")).not.toHaveAttribute("data-attention");
  });

  it("shows the before and after of a criterion and its Check, with the agent's why and evidence", async () => {
    await cards();
    const card = cardOf("p-1");
    const diff = within(card).getByRole("group", { name: "Criterion, before and after" });
    expect(within(diff).getByText("Parses a line").closest("del")).not.toBeNull();
    expect(within(diff).getByText("Parses an empty line as no token").closest("ins")).not.toBeNull();
    const check = within(card).getByRole("group", { name: "Check, before and after" });
    expect(within(check).getByText("cargo test parser").closest("del")).not.toBeNull();
    expect(within(check).getByText("cargo test parser::empty_line").closest("ins")).not.toBeNull();
    expect(within(card).getByText("Accepting clears its acceptance; the new Check reads not run")).toBeInTheDocument();
    expect(within(card).getByText("The criterion misses the empty line")).toBeInTheDocument();
    expect(within(card).getByText("src/parser.rs:42 panics on an empty line")).toBeInTheDocument();
    expect(within(card).getByText("Filed by FLY-p-1's session")).toBeInTheDocument();
  });

  it("names the Epic spec field it rewrites and what accepting does", async () => {
    await cards();
    const card = cardOf("p-2");
    const diff = within(card).getByRole("group", { name: "Scope, before and after" });
    expect(within(diff).getByText("Parse a line").closest("del")).not.toBeNull();
    expect(within(diff).getByText("Parse every line, empty ones included").closest("ins")).not.toBeNull();
    expect(within(card).getByText("Accepting reaches every Story of the Epic from its next session")).toBeInTheDocument();
  });

  it("says the Check is kept and its last run goes stale when no new command is proposed", async () => {
    needsYouList.mockResolvedValue([
      { ...AMEND_CRITERION, judgedOn: { ...AMEND_CRITERION.judgedOn!, checkAfter: null } },
    ]);
    await cards();
    const card = cardOf("p-1");
    expect(within(card).queryByRole("group", { name: "Check, before and after" })).toBeNull();
    expect(within(card).getByText("Accepting clears its acceptance and marks its Check's last run stale")).toBeInTheDocument();
  });

  it("flags a duplicate as the triage drawer does: what it repeats and who filed that one (issue #169)", async () => {
    needsYouList.mockResolvedValue([
      AMEND_CRITERION,
      {
        ...AMEND_CRITERION,
        id: "p-3",
        judgedOn: { ...AMEND_CRITERION.judgedOn!, proposalId: "p-3", duplicate: { proposalId: "p-1", title: "Parses a line", storyKey: "FLY-4" } },
      },
    ]);
    await cards();
    expect(cardOf("p-1").querySelector("[data-duplicate-of]")).toBeNull();
    const flag = cardOf("p-3").querySelector("[data-duplicate-of]") as HTMLElement;
    expect(flag).toHaveAttribute("data-duplicate-of", "p-1");
    expect(flag).toHaveTextContent("Duplicate of “Parses a line”, filed by FLY-4. Accepting that one closes this one.");
  });

  it("accepts in place and refetches", async () => {
    await cards();
    fireEvent.click(within(cardOf("p-1")).getByRole("button", { name: "Accept the Amend criterion on FLY-p-1" }));
    await waitFor(() => expect(proposalAccept).toHaveBeenCalledWith("p-1"));
    await waitFor(() => expect(needsYouList).toHaveBeenCalledTimes(2));
  });

  it("Edit opens the proposed text and Check to edit; accepting the edit is one act", async () => {
    await cards();
    const card = cardOf("p-1");
    fireEvent.click(within(card).getByRole("button", { name: "Edit the Amend criterion on FLY-p-1" }));
    const statement = within(card).getByRole("textbox", { name: "Your criterion" });
    expect(statement).toHaveValue("Parses an empty line as no token");
    expect(statement).toHaveFocus();
    fireEvent.change(statement, { target: { value: "Parses an empty line as no token, and a blank one" } });
    fireEvent.change(within(card).getByRole("textbox", { name: "Its Check command" }), { target: { value: "cargo test blank" } });
    fireEvent.click(within(card).getByRole("button", { name: "Accept edit to the Amend criterion on FLY-p-1" }));
    await waitFor(() =>
      expect(proposalAmend).toHaveBeenCalledWith("p-1", {
        criterion_id: "c-1",
        statement: "Parses an empty line as no token, and a blank one",
        check_command: "cargo test blank",
      }),
    );
  });

  it("Edit on a spec change sends the field it keeps and the developer's text", async () => {
    await cards();
    const card = cardOf("p-2");
    fireEvent.click(within(card).getByRole("button", { name: "Edit the Amend Epic spec on FLY-E2" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Your Scope" }), { target: { value: "Parse every line" } });
    fireEvent.click(within(card).getByRole("button", { name: "Accept edit to the Amend Epic spec on FLY-E2" }));
    await waitFor(() => expect(proposalAmend).toHaveBeenCalledWith("p-2", { field: "scope", text: "Parse every line" }));
  });

  it("Cancel leaves Edit without deciding and returns the keyboard to Edit", async () => {
    await cards();
    const card = cardOf("p-2");
    const edit = within(card).getByRole("button", { name: "Edit the Amend Epic spec on FLY-E2" });
    fireEvent.click(edit);
    fireEvent.click(within(card).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(within(card).getByRole("button", { name: "Edit the Amend Epic spec on FLY-E2" })).toHaveFocus());
    expect(proposalAmend).not.toHaveBeenCalled();
  });

  it("Reject asks for an optional reason and rejects in place", async () => {
    await cards();
    const card = cardOf("p-2");
    fireEvent.click(within(card).getByRole("button", { name: "Reject the Amend Epic spec on FLY-E2" }));
    fireEvent.change(within(card).getByRole("textbox", { name: "Why not? (optional)" }), { target: { value: "Out of scope" } });
    fireEvent.click(within(card).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(proposalReject).toHaveBeenCalledWith("p-2", "Out of scope"));
  });

  it("says why when a decision is refused, and keeps the card", async () => {
    proposalAccept.mockRejectedValue("FLY-p-1 is merged; a closed Story's criteria stay as they are");
    await cards();
    fireEvent.click(within(cardOf("p-1")).getByRole("button", { name: "Accept the Amend criterion on FLY-p-1" }));
    expect(await within(cardOf("p-1")).findByRole("alert")).toHaveTextContent("a closed Story's criteria stay as they are");
  });
});
