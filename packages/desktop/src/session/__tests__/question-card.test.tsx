/**
 * Issue #100: an agent's `AskUserQuestion` call is held as a question, not a permission request.
 * Every place it can be answered (the session feed's question card, the card below the feed, the
 * Needs-you queue) shows the question form: options, "Other" with free text, and Send answer. It
 * never shows Allow, Deny or an "Always allow" pattern, and it sends what was picked per question.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { BlockedQueueEntryDto } from "../../adapters/tauri";
import { BlockedQueue } from "../../fleet/BlockedQueue";
import { FeedRow } from "../FeedRow";
import { buildFeedRows } from "../feedRows";
import { PermissionRequestCard } from "../PermissionRequestCard";
import { openQuestionRows } from "../SessionSurface";

const answerPermissionMock = vi.fn();
const answerQuestionMock = vi.fn();

vi.mock("../../adapters/tauri", () => ({
  answerPermissionRequest: (...args: unknown[]) => answerPermissionMock(...args),
  answerQuestion: (...args: unknown[]) => answerQuestionMock(...args),
}));

const QUESTIONS = [
  {
    question: "Which colour should the button be?",
    header: "Colour",
    multiSelect: false,
    options: [
      { label: "Red", description: "Warm" },
      { label: "Blue", description: "Calm" },
    ],
  },
  {
    question: "Which platforms should we ship to?",
    header: "Platforms",
    multiSelect: true,
    options: [
      { label: "macOS", description: "" },
      { label: "Linux", description: "" },
      { label: "Windows", description: "" },
    ],
  },
];
const PAYLOAD = JSON.stringify({ questions: QUESTIONS });

function questionRequest(id = "q-1") {
  return { id, toolName: "AskUserQuestion", inputPayload: PAYLOAD, destructiveCategory: null, suggestedRule: null };
}

function expectNoPermissionControls(container: HTMLElement) {
  const scope = within(container);
  expect(scope.queryByRole("button", { name: /allow/i })).toBeNull();
  expect(scope.queryByRole("button", { name: /deny/i })).toBeNull();
  expect(scope.queryByText(/always allow/i)).toBeNull();
  expect(scope.queryByLabelText(/pattern/i)).toBeNull();
}

beforeEach(() => {
  answerPermissionMock.mockReset();
  answerQuestionMock.mockReset();
  answerQuestionMock.mockResolvedValue(undefined);
});

afterEach(() => cleanup());

describe("the question card", () => {
  it("never shows Allow, Deny or a pattern, and sends one label, joined picks and free text per question", async () => {
    const onAnswerQuestion = vi.fn().mockResolvedValue(undefined);
    const onAnswer = vi.fn();
    const { container } = render(
      <PermissionRequestCard
        variant="feed"
        requests={[questionRequest()]}
        onAnswer={onAnswer}
        onAnswerQuestion={onAnswerQuestion}
      />,
    );
    expectNoPermissionControls(container);
    expect(screen.getByText("Which colour should the button be?")).toBeTruthy();

    const send = screen.getByRole("button", { name: "Send answer" }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);

    fireEvent.click(screen.getByLabelText(/Blue/));
    fireEvent.click(screen.getByLabelText(/macOS/));
    fireEvent.change(screen.getByLabelText("Your own answer to: Which platforms should we ship to?"), {
      target: { value: "FreeBSD" },
    });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);

    await waitFor(() => expect(onAnswerQuestion).toHaveBeenCalledTimes(1));
    expect(onAnswerQuestion).toHaveBeenCalledWith("q-1", {
      "Which colour should the button be?": ["Blue"],
      "Which platforms should we ship to?": ["macOS", "FreeBSD"],
    });
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it("typing an answer to a single-choice question replaces the picked option", async () => {
    const onAnswerQuestion = vi.fn().mockResolvedValue(undefined);
    render(
      <PermissionRequestCard
        variant="feed"
        requests={[questionRequest()]}
        onAnswer={vi.fn()}
        onAnswerQuestion={onAnswerQuestion}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Red/));
    fireEvent.change(screen.getByLabelText("Your own answer to: Which colour should the button be?"), {
      target: { value: "Teal" },
    });
    fireEvent.click(screen.getByLabelText(/Linux/));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() => expect(onAnswerQuestion).toHaveBeenCalledTimes(1));
    expect(onAnswerQuestion.mock.calls[0][1]).toEqual({
      "Which colour should the button be?": ["Teal"],
      "Which platforms should we ship to?": ["Linux"],
    });
  });

  it("the a and d keys answer no question", () => {
    const onAnswer = vi.fn();
    const onAnswerQuestion = vi.fn();
    render(
      <PermissionRequestCard
        variant="feed"
        requests={[questionRequest()]}
        onAnswer={onAnswer}
        onAnswerQuestion={onAnswerQuestion}
      />,
    );
    fireEvent.keyDown(window, { key: "a" });
    fireEvent.keyDown(window, { key: "d" });
    expect(onAnswer).not.toHaveBeenCalled();
    expect(onAnswerQuestion).not.toHaveBeenCalled();
  });

  it("is answerable in the feed's own question card while its request is open", async () => {
    const rows = buildFeedRows([
      { type: "tool_call", toolName: "AskUserQuestion", toolUseId: "t1", input: { questions: QUESTIONS } },
    ]);
    const open = openQuestionRows(rows, [questionRequest("q-9")]);
    expect([...open.values()]).toEqual(["q-9"]);

    const onAnswerQuestion = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <FeedRow row={rows[0]} expanded={false} onToggleExpand={() => {}} onAnswerQuestion={onAnswerQuestion} />,
    );
    expectNoPermissionControls(container);
    expect(screen.getByText("The session waits until you answer")).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Red/));
    fireEvent.click(screen.getByLabelText(/Windows/));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(onAnswerQuestion).toHaveBeenCalledWith({
        "Which colour should the button be?": ["Red"],
        "Which platforms should we ship to?": ["Windows"],
      }),
    );
  });

  it("an answered question in the feed is not matched to an open request", () => {
    const rows = buildFeedRows([
      { type: "tool_call", toolName: "AskUserQuestion", toolUseId: "t1", input: { questions: QUESTIONS } },
      { type: "tool_result", toolUseId: "t1", output: "answered" },
    ]);
    expect(openQuestionRows(rows, [questionRequest()]).size).toBe(0);
  });
});

describe("the question in Needs you", () => {
  function entry(overrides: Partial<BlockedQueueEntryDto> = {}): BlockedQueueEntryDto {
    return {
      requestId: "q-1",
      toolName: "AskUserQuestion",
      inputPayload: PAYLOAD,
      createdAt: "2026-10-12T11:50:00Z",
      destructiveCategory: null,
      suggestedRule: null,
      sessionId: "run-1",
      projectId: "proj-1",
      projectName: "Project 1",
      projectKeyPrefix: "P1",
      storyId: "story-1",
      storyKey: "P1-1",
      storyTitle: "Story 1",
      blockedSince: "2026-10-12T11:50:00Z",
      ...overrides,
    };
  }

  it("is waiting on you and answered there with answers, never Allow or Deny", async () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <BlockedQueue entries={[entry()]} now={Date.parse("2026-10-12T12:00:00Z")} />
      </QueryClientProvider>,
    );
    expect(screen.getByText("Waiting on you")).toBeTruthy();
    expect(screen.queryByText(/Keys A and D/)).toBeNull();
    expectNoPermissionControls(container);

    fireEvent.click(screen.getByLabelText(/Blue/));
    fireEvent.click(screen.getByLabelText(/Linux/));
    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(answerQuestionMock).toHaveBeenCalledWith("q-1", {
        "Which colour should the button be?": ["Blue"],
        "Which platforms should we ship to?": ["Linux"],
      }),
    );
    expect(answerPermissionMock).not.toHaveBeenCalled();
  });
});
