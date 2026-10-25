/**
 * Behaviour under test (issue #123): the Round dock beside the Epic card. Each open question shows its
 * grounding, its recommended answer already filled in with the "because" line under it, and two actions:
 * Accept (the recommendation as it is) and Answer differently (the developer's own words, starting from the
 * recommendation). Accept all recommended answers every question still open. Every one writes through its
 * command, and an answered question folds to one line. While the session waits on the Round, the dock says
 * it is Waiting on you.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EpicShapingView } from "../EpicShapingView";
import { resetUiState, useUiStore } from "../../state/uiStore";
import type { EpicDto, EpicShapingDto, RoundDto, RoundQuestionDto } from "../../adapters/tauri";

const epicShapingRounds = vi.fn();
const epicShapingSession = vi.fn();
const roundAccept = vi.fn();
const roundAnswer = vi.fn();
const roundAcceptAll = vi.fn();
const epicUpdate = vi.fn();
const shapingContinue = vi.fn();

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    epicShapingRounds: (...args: unknown[]) => epicShapingRounds(...args),
    epicShapingSession: (...args: unknown[]) => epicShapingSession(...args),
    epicShape: () => Promise.resolve({ id: "run-s", epicId: "e1", status: "running", permissionMode: "dontAsk" }),
    roundAccept: (...args: unknown[]) => roundAccept(...args),
    roundAnswer: (...args: unknown[]) => roundAnswer(...args),
    roundAcceptAll: (...args: unknown[]) => roundAcceptAll(...args),
    epicUpdate: (...args: unknown[]) => epicUpdate(...args),
    shapingContinue: (...args: unknown[]) => shapingContinue(...args),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
  };
});

const EPIC: EpicDto = {
  id: "e1",
  projectId: "p1",
  milestoneId: "m1",
  key: "FLY-4",
  title: "Epic shaping",
  problem: "Shaping in the app is worse than in a terminal.",
  scope: null,
  outOfScope: null,
  exitTest: null,
  state: "shaping",
  rank: "a",
};

function question(n: number, answered?: { answer: string; with: "recommended" | "own" }): RoundQuestionDto {
  return {
    id: `q${n}`,
    number: n,
    title: `Decision ${n}`,
    question: `Should the Epic cover thing ${n}?`,
    grounding: `Read docs/mvp-spec.md §${n}`,
    recommendedAnswer: `Yes, cover thing ${n}`,
    because: `Thing ${n} is what the exit test needs`,
    answer: answered?.answer ?? null,
    answeredWith: answered?.with ?? null,
    answeredAt: answered ? "2026-10-22T10:00:00Z" : null,
  };
}

function round(questions: RoundQuestionDto[], held = true): RoundDto {
  return {
    id: "r1",
    stageId: "s1",
    stageKind: "challenge_spec",
    number: 1,
    note: "This Round settles who the Epic is for.",
    state: "open",
    waitingOnYou: held,
    postedAt: "2026-10-22T09:00:00Z",
    answeredAt: null,
    questions,
  };
}

function shaping(rounds: RoundDto[]): EpicShapingDto {
  return { epic: EPIC, stages: [{ id: "s1", kind: "challenge_spec", state: "open", rank: 1 }], rounds, proposals: [] };
}

function renderView() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EpicShapingView projectId="p1" projectName="Threadfin" epicId="e1" onBack={() => {}} />
    </QueryClientProvider>,
  );
}

async function card(n: number) {
  return (await screen.findByRole("group", { name: new RegExp(`^Question ${n}`) })) as HTMLElement;
}

beforeEach(() => {
  resetUiState();
  useUiStore.setState({ currentProjectId: "p1", currentEpicId: "e1" });
  epicShapingRounds.mockReset().mockResolvedValue(shaping([round([question(1), question(2), question(3)])]));
  epicShapingSession.mockReset().mockResolvedValue("run-s");
  roundAccept.mockReset().mockResolvedValue(undefined);
  roundAnswer.mockReset().mockResolvedValue(undefined);
  roundAcceptAll.mockReset().mockResolvedValue(undefined);
  epicUpdate.mockReset().mockResolvedValue(undefined);
  shapingContinue.mockReset().mockResolvedValue({ id: "run-2", epicId: "e1", status: "running", permissionMode: "dontAsk" });
});

describe("the Round dock (issue #123)", () => {
  it("shows the note and each question's grounding, pre-filled recommended answer and because line", async () => {
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect(within(dock).getByText("This Round settles who the Epic is for.")).toBeTruthy();
    expect(within(dock).getByText("Waiting on you")).toBeTruthy();

    const first = await card(1);
    expect(within(first).getByText("Should the Epic cover thing 1?")).toBeTruthy();
    expect(within(first).getByText("Read docs/mvp-spec.md §1")).toBeTruthy();
    expect(within(first).getByText("Yes, cover thing 1")).toBeTruthy();
    expect(within(first).getByText(/thing 1 is what the exit test needs/i)).toBeTruthy();
    expect(within(first).getByText("Recommended")).toBeTruthy();
  });

  it("Accept writes the recommended answer through round_accept", async () => {
    renderView();
    fireEvent.click(within(await card(2)).getByRole("button", { name: "Accept the recommended answer to question 2" }));
    await waitFor(() => expect(roundAccept).toHaveBeenCalledWith("q2"));
    expect(roundAnswer).not.toHaveBeenCalled();
  });

  it("Answer differently starts from the recommendation and sends the developer's own words through round_answer", async () => {
    renderView();
    const second = await card(2);
    fireEvent.click(within(second).getByRole("button", { name: "Answer question 2 differently" }));
    const field = within(second).getByRole("textbox", { name: "Your answer to question 2" }) as HTMLTextAreaElement;
    expect(field.value).toBe("Yes, cover thing 2");
    fireEvent.change(field, { target: { value: "No: thing 2 waits for the next Milestone" } });
    fireEvent.click(within(second).getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(roundAnswer).toHaveBeenCalledWith("q2", "No: thing 2 waits for the next Milestone"));
  });

  it("Answer differently keeps the recommendation in sight and sends on ⌘↩", async () => {
    renderView();
    const second = await card(2);
    fireEvent.click(within(second).getByRole("button", { name: "Answer question 2 differently" }));
    expect(within(second).getByText("Recommended:")).toBeTruthy();
    const field = within(second).getByRole("textbox", { name: "Your answer to question 2" });
    fireEvent.change(field, { target: { value: "Only partly" } });
    fireEvent.keyDown(field, { key: "Enter", metaKey: true });
    await waitFor(() => expect(roundAnswer).toHaveBeenCalledWith("q2", "Only partly"));
  });

  it("Answer differently refuses a blank answer and Cancel returns to the recommendation", async () => {
    renderView();
    const third = await card(3);
    fireEvent.click(within(third).getByRole("button", { name: "Answer question 3 differently" }));
    fireEvent.change(within(third).getByRole("textbox"), { target: { value: "   " } });
    expect((within(third).getByRole("button", { name: "Send answer" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(third).getByRole("button", { name: "Cancel" }));
    expect(within(third).queryByRole("textbox")).toBeNull();
    expect(within(third).getByRole("button", { name: "Accept the recommended answer to question 3" })).toBeTruthy();
  });

  it("Accept all recommended answers the open questions through round_accept_all", async () => {
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    fireEvent.click(within(dock).getByRole("button", { name: /Accept all recommended/ }));
    await waitFor(() => expect(roundAcceptAll).toHaveBeenCalledWith("r1"));
  });

  it("an answered question folds to one line with its answer, and offers no Accept", async () => {
    epicShapingRounds.mockResolvedValue(
      shaping([round([question(1, { answer: "Only the developer", with: "own" }), question(2), question(3)])]),
    );
    renderView();
    const first = await card(1);
    expect(first.getAttribute("data-answered")).toBe("true");
    expect(within(first).getByText("Decision 1")).toBeTruthy();
    expect(within(first).getByText("Only the developer")).toBeTruthy();
    expect(within(first).getByText("Your answer")).toBeTruthy();
    expect(within(first).queryByText("Should the Epic cover thing 1?")).toBeNull();
    expect(within(first).queryByRole("button", { name: /Accept the recommended answer/ })).toBeNull();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect(within(dock).getByText("1 of 3 answered")).toBeTruthy();
  });

  it("a folded answer can be changed while the Round is open", async () => {
    epicShapingRounds.mockResolvedValue(
      shaping([round([question(1, { answer: "Yes, cover thing 1", with: "recommended" }), question(2)])]),
    );
    renderView();
    const first = await card(1);
    fireEvent.click(within(first).getByRole("button", { name: "Change the answer to question 1" }));
    const field = within(first).getByRole("textbox", { name: "Your answer to question 1" }) as HTMLTextAreaElement;
    expect(field.value).toBe("Yes, cover thing 1");
  });

  it("an answered Round keeps every question folded and offers no action", async () => {
    epicShapingRounds.mockResolvedValue(
      shaping([
        {
          ...round([question(1, { answer: "Yes, cover thing 1", with: "recommended" })], false),
          state: "answered",
          answeredAt: "2026-10-22T10:00:00Z",
        },
      ]),
    );
    renderView();
    const first = await card(1);
    expect(first.getAttribute("data-answered")).toBe("true");
    expect(within(first).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: /Accept all recommended/ })).toBeNull();
  });

  it("before the first Round, the dock says the agent is reading the Epic", async () => {
    epicShapingRounds.mockResolvedValue(shaping([]));
    renderView();
    expect(await screen.findByText(/first Round lands here/)).toBeTruthy();
  });
});

describe("a Round whose session died (issue #124)", () => {
  beforeEach(() => {
    epicShapingSession.mockResolvedValue(null);
    epicShapingRounds.mockResolvedValue(
      shaping([round([question(1, { answer: "Only the developer", with: "own" }), question(2), question(3)], false)]),
    );
  });

  it("keeps the answers given, still takes answers, and says no session is live", async () => {
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect(within(dock).getByText("No live session: your answers are kept")).toBeTruthy();
    expect(within(dock).queryByText("Waiting on you")).toBeNull();
    expect(within(dock).getByText("1 of 3 answered")).toBeTruthy();
    expect(within(await card(1)).getByText("Only the developer")).toBeTruthy();
    // The Epic card names the same state as the board's (issue #124).
    expect(await screen.findByText("Shaping Round waiting")).toBeTruthy();

    fireEvent.click(within(await card(2)).getByRole("button", { name: "Accept the recommended answer to question 2" }));
    await waitFor(() => expect(roundAccept).toHaveBeenCalledWith("q2"));
  });

  it("offers Continue shaping on the band, once, which starts a session through shaping_continue", async () => {
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    const resume = await within(dock).findByRole("button", { name: "Continue shaping FLY-4 Epic shaping" });
    expect(screen.getAllByRole("button", { name: /Continue shaping/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^Shape FLY-4/ })).toBeNull();
    fireEvent.click(resume);
    await waitFor(() => expect(shapingContinue).toHaveBeenCalledWith("e1"));
  });

  it("while a fresh session reads the Rounds, the band says it picks this one up, with no Continue shaping", async () => {
    epicShapingSession.mockResolvedValue("run-2");
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect(await within(dock).findByText("The agent is reading your answers and picks this Round up")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue shaping/ })).toBeNull();
  });
});

describe("the Epic card beside the dock (issue #123)", () => {
  it("shows the spec fields and edits one through epic_update", async () => {
    renderView();
    expect(await screen.findByText("Shaping in the app is worse than in a terminal.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Scope" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Scope" }), { target: { value: "The Round dock" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Scope" }));
    await waitFor(() =>
      expect(epicUpdate).toHaveBeenCalledWith("e1", "Epic shaping", {
        problem: "Shaping in the app is worse than in a terminal.",
        scope: "The Round dock",
        outOfScope: null,
        exitTest: null,
      }),
    );
  });
});

function adrQuestion(n: number, answered?: { answer: "Yes" | "No"; with: "recommended" | "own" }): RoundQuestionDto {
  return {
    ...question(n),
    title: "Record the shaping store",
    question: 'Record "the board is the shaping store" as ADR 0005?',
    grounding: "Read docs/adr/0002 and Round 1",
    recommendedAnswer: "Yes",
    because: "It settles where every answer lives",
    answer: answered?.answer ?? null,
    answeredWith: answered?.with ?? null,
    answeredAt: answered ? "2026-10-22T10:00:00Z" : null,
    kind: "adr",
    adr: {
      path: "docs/adr/0005-board-is-the-shaping-store.md",
      text: "# The board is the shaping store\n\nEvery answer is written to the board as it is made.\n",
      hardToReverse: "Every later Story reads its context from the board",
      surprising: "A reader expects shaping notes in the repo",
      losingAlternative: "A .planning/ folder of markdown",
      relatesTo: null,
    },
    adrProposalId: answered?.answer === "Yes" ? "pr-adr" : null,
  };
}

describe("an ADR offered inside the Round (issue #129)", () => {
  it("shows the draft with its path and the four bar lines beside it", async () => {
    epicShapingRounds.mockResolvedValue(shaping([round([question(1), adrQuestion(2)])]));
    renderView();
    const adr = await card(2);
    expect(adr.getAttribute("data-kind")).toBe("adr");
    expect(within(adr).getByText("docs/adr/0005-board-is-the-shaping-store.md")).toBeTruthy();
    expect(within(adr).getByText(/Every answer is written to the board as it is made\./)).toBeTruthy();
    const bar = within(adr).getByRole("list", { name: "Bar lines" });
    expect(within(bar).getByText("Hard to reverse")).toBeTruthy();
    expect(within(bar).getByText("Every later Story reads its context from the board")).toBeTruthy();
    expect(within(bar).getByText("Surprising")).toBeTruthy();
    expect(within(bar).getByText("A reader expects shaping notes in the repo")).toBeTruthy();
    expect(within(bar).getByText("Losing alternative")).toBeTruthy();
    expect(within(bar).getByText("A .planning/ folder of markdown")).toBeTruthy();
    expect(within(bar).getByText("Relates to")).toBeTruthy();
    expect(within(bar).getByText("None")).toBeTruthy();
    expect(within(adr).queryByRole("button", { name: /differently/ })).toBeNull();
  });

  it("Yes and No write through round_answer", async () => {
    epicShapingRounds.mockResolvedValue(shaping([round([question(1), adrQuestion(2)])]));
    renderView();
    const adr = await card(2);
    fireEvent.click(within(adr).getByRole("button", { name: "Yes, record it" }));
    await waitFor(() => expect(roundAnswer).toHaveBeenCalledWith("q2", "Yes"));
    fireEvent.click(within(adr).getByRole("button", { name: "No, don't record it" }));
    await waitFor(() => expect(roundAnswer).toHaveBeenCalledWith("q2", "No"));
  });

  it("an answered ADR folds to one settled line, with no Change", async () => {
    epicShapingRounds.mockResolvedValue(shaping([round([question(1), adrQuestion(2, { answer: "Yes", with: "recommended" })])]));
    renderView();
    const adr = await card(2);
    expect(adr.getAttribute("data-answered")).toBe("true");
    expect(within(adr).getByText(/Accepted on the Epic/)).toBeTruthy();
    expect(within(adr).queryByRole("button")).toBeNull();
  });

  it("an ADR answered No folds to a line that says no ADR is written", async () => {
    epicShapingRounds.mockResolvedValue(shaping([round([question(1), adrQuestion(2, { answer: "No", with: "own" })])]));
    renderView();
    const adr = await card(2);
    expect(within(adr).getByText("No. Not recorded: no ADR is written")).toBeTruthy();
    expect(within(adr).getByText("Your answer")).toBeTruthy();
  });

  it("Accept all recommended leaves the ADR questions to their own Yes or No, and says so", async () => {
    epicShapingRounds.mockResolvedValue(shaping([round([question(1), adrQuestion(2)])]));
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect(within(dock).getByText(/ADR is answered on its own/)).toBeTruthy();
    fireEvent.click(within(dock).getByRole("button", { name: /Accept all recommended/ }));
    await waitFor(() => expect(roundAcceptAll).toHaveBeenCalledWith("r1"));
  });

  it("Accept all recommended is off when only an ADR question is left open", async () => {
    epicShapingRounds.mockResolvedValue(
      shaping([round([question(1, { answer: "Yes, cover thing 1", with: "recommended" }), adrQuestion(2)])]),
    );
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect((within(dock).getByRole("button", { name: /Accept all recommended/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dock).getByText("Only the ADR is left: answer it Yes or No.")).toBeTruthy();
  });
});

describe("the Epic card's ADR and glossary chips (issue #129)", () => {
  it("shows a chip per linked ADR, per accepted ADR and per accepted glossary term", async () => {
    const accepted = (id: string, targetType: string, payload: Record<string, unknown>) => ({
      id,
      projectId: "p1",
      sessionId: "run-s",
      epicId: "e1",
      verb: "create",
      targetType,
      targetId: null,
      payload,
      rationale: null,
      state: "accepted",
      createdAt: "2026-10-22T10:00:00Z",
      rejectionReason: null,
      stageId: "s1",
      roundId: "r1",
    });
    epicShapingRounds.mockResolvedValue({
      ...shaping([round([question(1)])]),
      adrLinks: ["docs/adr/0002-repo-holds-code-knowledge-board-holds-work.md"],
      acceptedKnowledge: [
        accepted("pr-a", "adr", { path: "docs/adr/0005-board-is-the-shaping-store.md", text: "# T\n" }),
        accepted("pr-g", "glossary_term", { term: "Round", definition: "A batch of questions" }),
      ],
    });
    renderView();
    const chips = await screen.findByRole("list", { name: "ADRs and glossary" });
    expect(within(chips).getByText("0002-repo-holds-code-knowledge-board-holds-work.md")).toBeTruthy();
    expect(within(chips).getByText("0005-board-is-the-shaping-store.md")).toBeTruthy();
    expect(within(chips).getByText("Round")).toBeTruthy();
    const pending = within(chips).getByText("0005-board-is-the-shaping-store.md").closest("li") as HTMLElement;
    expect(within(pending).getByText(/not in the repo yet/)).toBeTruthy();
  });

  it("shows no chip row when the Epic has no ADR and no glossary term", async () => {
    renderView();
    await screen.findByText("Shaping in the app is worse than in a terminal.");
    expect(screen.queryByRole("list", { name: "ADRs and glossary" })).toBeNull();
  });
});

describe("the dock's Round progress and its Accept all (issue #211)", () => {
  it("shows how much of the Round is answered as a progress bar beside the count", async () => {
    epicShapingRounds.mockResolvedValue(
      shaping([round([question(1, { answer: "Yes, cover thing 1", with: "recommended" }), question(2), question(3), question(4)])]),
    );
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    const bar = within(dock).getByRole("progressbar", { name: "1 of 4 answered" });
    expect(bar).toHaveAttribute("aria-valuenow", "25");
  });

  it("makes Accept all the attention fill while the Round is Waiting on you", async () => {
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect(within(dock).getByRole("button", { name: /Accept all recommended/ })).toHaveAttribute("data-variant", "attention");
  });

  it("keeps Accept all the brand fill on an open Round no session waits on", async () => {
    epicShapingSession.mockResolvedValue(null);
    epicShapingRounds.mockResolvedValue(shaping([round([question(1), question(2)], false)]));
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    expect(within(dock).getByRole("button", { name: /Accept all recommended/ })).toHaveAttribute("data-variant", "default");
  });

  it("shows Accept all as loading while it lands, with its label kept", async () => {
    let resolveAll: () => void = () => {};
    roundAcceptAll.mockImplementationOnce(() => new Promise<void>((resolve) => (resolveAll = resolve)));
    renderView();
    const dock = await screen.findByRole("region", { name: /Round 1/ });
    const button = within(dock).getByRole("button", { name: /Accept all recommended/ });
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-busy", "true"));
    expect(button).toHaveTextContent("Accept all recommended");
    resolveAll();
    await waitFor(() => expect(button).not.toHaveAttribute("aria-busy"));
  });
});
