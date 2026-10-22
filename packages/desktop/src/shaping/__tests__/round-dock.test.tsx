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
