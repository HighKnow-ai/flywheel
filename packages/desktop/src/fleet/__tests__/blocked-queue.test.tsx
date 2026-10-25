/**
 * Behavior under test (10-05-PLAN.md Task 2, FLEET-02, D-172, D-173):
 * ONE keystroke answers ONE request. The queue mounts one `PermissionRequestCard` per blocked agent and
 * the card registers a window-level listener per row, so without `keyboardEnabled` one `a` press would
 * answer every agent across every project. These tests are the mechanical form of that prohibition.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlockedQueueEntryDto, WaitingRoundDto } from "../../adapters/tauri";
import { resetUiState, useUiStore } from "../../state/uiStore";
import { PermissionRequestCard } from "../../session/PermissionRequestCard";
import { BlockedQueue } from "../BlockedQueue";

const answerMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  answerPermissionRequest: (requestId: string, decision: string) => answerMock(requestId, decision),
}));

const NOW = Date.parse("2026-10-12T12:00:00Z");

function entry(n: number, overrides: Partial<BlockedQueueEntryDto> = {}): BlockedQueueEntryDto {
  return {
    requestId: `req-${n}`,
    toolName: "Bash",
    inputPayload: `{"command":"echo ${n}"}`,
    createdAt: "2026-10-12T11:50:00Z",
    destructiveCategory: null,
    suggestedRule: `Bash(echo ${n})`,
    sessionId: `run-${n}`,
    projectId: `proj-${n}`,
    projectName: `Project ${n}`,
    projectKeyPrefix: `P${n}`,
    storyId: `task-${n}`,
    storyKey: `P${n}-1`,
    storyTitle: `Task ${n}`,
    blockedSince: "2026-10-12T11:50:00Z",
    ...overrides,
  };
}

function renderQueue(entries: BlockedQueueEntryDto[]) {
  const queryClient = new QueryClient();
  const ui = (list: BlockedQueueEntryDto[]) => (
    <QueryClientProvider client={queryClient}>
      <BlockedQueue entries={list} now={NOW} />
    </QueryClientProvider>
  );
  const view = render(ui(entries));
  return { rerender: (list: BlockedQueueEntryDto[]) => view.rerender(ui(list)) };
}

function press(init: KeyboardEventInit) {
  fireEvent.keyDown(window, init);
}

beforeEach(() => {
  answerMock.mockReset();
  answerMock.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("BlockedQueue keyboard ownership", () => {
  it("one `a` keypress over three queued cards answers exactly one request, the first", () => {
    renderQueue([entry(1), entry(2), entry(3)]);
    press({ key: "a" });
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(answerMock).toHaveBeenCalledWith("req-1", "allow");
  });

  it("one `d` keypress answers exactly one request, the first", () => {
    renderQueue([entry(1), entry(2), entry(3)]);
    press({ key: "d" });
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(answerMock).toHaveBeenCalledWith("req-1", "deny");
  });

  it("one shift-`a` keypress answers exactly one request, the first", () => {
    renderQueue([entry(1), entry(2), entry(3)]);
    press({ key: "a", shiftKey: true });
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(answerMock).toHaveBeenCalledWith("req-1", "allow_always");
  });

  it("the owner moves to the new first entry once the first leaves the queue", () => {
    const { rerender } = renderQueue([entry(1), entry(2), entry(3)]);
    rerender([entry(2), entry(3)]);
    press({ key: "a" });
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(answerMock).toHaveBeenCalledWith("req-2", "allow");
  });

  it("marks exactly one card as the keyboard owner, in words", () => {
    renderQueue([entry(1), entry(2), entry(3)]);
    const owners = document.querySelectorAll('[data-keyboard-owner="true"]');
    expect(owners).toHaveLength(1);
    expect(owners[0]).toHaveAttribute("data-run-id", "run-1");
    expect(screen.getAllByText("Keys A and D answer this one")).toHaveLength(1);
  });

  it("the two existing mounts are unchanged: a card given no prop still lets its first row own the keyboard", () => {
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    render(
      <PermissionRequestCard
        variant="feed"
        requests={[
          { id: "first", toolName: "Bash", inputPayload: null, destructiveCategory: null },
          { id: "second", toolName: "Bash", inputPayload: null, destructiveCategory: null },
        ]}
        onAnswer={onAnswer}
      />,
    );
    press({ key: "a" });
    expect(onAnswer).toHaveBeenCalledTimes(1);
    expect(onAnswer).toHaveBeenCalledWith("first", "allow");
  });
});

describe("BlockedQueue contents", () => {
  it("Escape dismisses nothing", () => {
    renderQueue([entry(1), entry(2)]);
    press({ key: "Escape" });
    expect(answerMock).not.toHaveBeenCalled();
    expect(screen.getAllByRole("group", { name: "Bash wants to:" })).toHaveLength(2);
  });

  it("a destructive entry renders Deny before Allow", () => {
    renderQueue([entry(1, { destructiveCategory: "force-push", inputPayload: '{"command":"git push --force origin main"}' })]);
    const card = screen.getByRole("group", { name: "Bash wants to:" });
    // By accessible name: the buttons also draw their answer keys (Story #206), which are not part of the name.
    const buttons = within(card).getAllByRole("button");
    const deny = within(card).getByRole("button", { name: "Deny" });
    const allow = within(card).getByRole("button", { name: "Allow once" });
    expect(buttons.indexOf(deny)).toBeLessThan(buttons.indexOf(allow));
  });

  it("names the project, subject and wait time of each waiting request", () => {
    renderQueue([entry(1), entry(2)]);
    const rows = screen.getAllByRole("listitem");
    expect(within(rows[0]).getByText("Project 1")).toBeInTheDocument();
    expect(rows[0].querySelector('[data-field="subject"]')).toHaveTextContent("P1-1 Task 1");
    expect(rows[0].querySelector('[data-field="age"]')).toHaveTextContent("10m");
  });

  it("an answer goes through the one existing answer wrapper and nothing else", () => {
    renderQueue([entry(1), entry(2)]);
    const second = screen.getAllByRole("group", { name: "Bash wants to:" })[1];
    fireEvent.click(within(second).getByRole("button", { name: "Allow once" }));
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(answerMock).toHaveBeenCalledWith("req-2", "allow");
  });

  it("words each entry Waiting on you, never Blocked", () => {
    renderQueue([entry(1)]);
    expect(screen.getByText("Waiting on you")).toBeInTheDocument();
    expect(screen.queryByText("Blocked")).toBeNull();
  });

  it("shows one card per waiting request, two for a session holding two (#57)", () => {
    renderQueue([entry(1), entry(2, { sessionId: "run-1", projectName: "Project 1" })]);
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getAllByRole("group", { name: "Bash wants to:" })).toHaveLength(2);
  });

  it("renders the empty-state copy and no card with no entries", () => {
    renderQueue([]);
    expect(screen.getByText("Nothing is waiting on you")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: /wants to/ })).not.toBeInTheDocument();
  });

  it("a very large payload renders inside a bounded, scrolling block", () => {
    renderQueue([entry(1, { inputPayload: "x".repeat(50_000) })]);
    const pre = document.querySelector("pre") as HTMLElement;
    expect(pre.style.maxHeight).toBe("240px");
    expect(pre.style.overflowY).toBe("auto");
  });
});

describe("a shaping Round waiting on you (issue #124)", () => {
  const ROUND: WaitingRoundDto = {
    roundId: "round-2",
    roundNumber: 2,
    subject: "epic",
    stageKind: "challenge_spec",
    sessionId: "run-shape",
    projectId: "proj-1",
    projectName: "Project 1",
    projectKeyPrefix: "P1",
    epicId: "e-59",
    epicKey: "P1-8",
    epicTitle: "Epic shaping",
    waitingSince: "2026-10-12T11:40:00Z",
    answered: 1,
    questions: 4,
  };

  function renderWithRound(entries: BlockedQueueEntryDto[]) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BlockedQueue entries={entries} rounds={[ROUND]} now={NOW} />
      </QueryClientProvider>,
    );
  }

  it("lists the Round with its Epic, how far it is answered and its wait, and Answer opens the Epic", () => {
    resetUiState();
    renderWithRound([entry(1)]);
    const item = screen.getByRole("listitem", { name: "Round 2 of P1-8 Epic shaping" });
    expect(within(item).getByText("1 of 4 answered")).toBeTruthy();
    expect(within(item).getByText("20m")).toBeTruthy();
    fireEvent.click(within(item).getByRole("button", { name: "Answer Round 2 of P1-8" }));
    expect(useUiStore.getState().currentEpicId).toBe("e-59");
    expect(useUiStore.getState().activeSessionId).toBeNull();
  });

  it("lists a roadmap Round with the project's Roadmap and its decisions, and Decide opens the board (issue #133)", () => {
    resetUiState();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BlockedQueue
          entries={[]}
          rounds={[{ ...ROUND, subject: "roadmap", stageKind: null, epicId: null, epicKey: null, epicTitle: null, roundNumber: 1, answered: 0, questions: 2 }]}
          now={NOW}
        />
      </QueryClientProvider>,
    );
    const item = screen.getByRole("listitem", { name: "Roadmap Round 1 of the Project 1 Roadmap" });
    expect(within(item).getByText("0 of 2 decided")).toBeTruthy();
    expect(within(item).getByText("Roadmap change")).toBeTruthy();
    fireEvent.click(within(item).getByRole("button", { name: "Decide Roadmap Round 1 of the Project 1 Roadmap" }));
    expect(useUiStore.getState().currentProjectId).toBe("proj-1");
    expect(useUiStore.getState().currentEpicId).toBeNull();
  });

  it("is not an empty queue when only a Round waits, and takes no keystroke", () => {
    renderWithRound([]);
    expect(screen.queryByText("Nothing is waiting on you")).toBeNull();
    press({ key: "a" });
    expect(answerMock).not.toHaveBeenCalled();
  });
});
