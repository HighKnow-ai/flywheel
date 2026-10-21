/**
 * Issue #104 (left open by PR #101): a half-typed answer in the feed's question form survives its row
 * scrolling out of view and back. The feed is virtualised, so a row that leaves the window unmounts;
 * the draft lives in UI state under the request id, not in the row. The same draft follows the request
 * to the Waiting on you card, and sending clears it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionSurface } from "../SessionSurface";
import { PermissionRequestCard } from "../PermissionRequestCard";
import { resetUiState, useUiStore } from "../../state/uiStore";

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
];
const PAYLOAD = JSON.stringify({ questions: QUESTIONS });
const REQUEST = {
  id: "req-1",
  toolName: "AskUserQuestion",
  inputPayload: PAYLOAD,
  createdAt: "2026-01-01T00:00:00.000Z",
  destructiveCategory: null,
  suggestedRule: null,
};

/** The question first, then enough agent turns that scrolling to the end takes it out of the window. */
const EVENTS: Record<string, unknown>[] = [
  { runId: "run-1", seq: 0, at: "2026-01-01T00:00:00.000Z", raw: "q", type: "tool_call", toolName: "AskUserQuestion", toolUseId: "t1", input: { questions: QUESTIONS } },
  ...Array.from({ length: 400 }, (_, i) => ({
    runId: "run-1",
    seq: i + 1,
    at: "2026-01-01T00:00:00.000Z",
    raw: `line-${i}`,
    type: "assistant_text",
    text: `Turn ${i}`,
  })),
];

const answerQuestionMock = vi.fn(() => Promise.resolve());

vi.mock("../../adapters/tauri", async () => {
  const actual = await vi.importActual<typeof import("../../adapters/tauri")>("../../adapters/tauri");
  return {
    ...actual,
    sessionLogWindow: (_sessionId: string, offset: number, limit: number) =>
      Promise.resolve({ entries: EVENTS, offset, limit, total: EVENTS.length }),
    subscribeAgentEvent: () => Promise.resolve(() => {}),
    subscribeBoardChanged: () => Promise.resolve(() => {}),
    pendingPermissionRequests: () => Promise.resolve([REQUEST]),
    answerQuestion: () => answerQuestionMock(),
    storyGet: () => Promise.resolve(null),
  };
});

const OTHER_FIELD = "Your own answer to: Which colour should the button be?";

function scrollFeedTo(top: number) {
  const scroller = screen.getByTestId("session-feed-scroll");
  act(() => {
    scroller.scrollTop = top;
    scroller.dispatchEvent(new Event("scroll"));
  });
}

beforeEach(() => {
  resetUiState();
  answerQuestionMock.mockClear();
});

afterEach(() => {
  resetUiState();
});

describe("a half-typed question answer (issue #104)", () => {
  it("survives its row scrolling out of view and back", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SessionSurface sessionId="run-1" onBack={() => {}} />
      </QueryClientProvider>,
    );

    const field = await screen.findByLabelText(OTHER_FIELD);
    fireEvent.change(field, { target: { value: "Teal, like the logo" } });

    scrollFeedTo(30_000);
    await waitFor(() => expect(screen.queryByLabelText(OTHER_FIELD)).toBeNull());

    scrollFeedTo(0);
    const back = await screen.findByLabelText(OTHER_FIELD);
    expect(back).toHaveValue("Teal, like the logo");
    expect(screen.getByRole("radio", { name: "Other" })).toBeChecked();
  });

  it("is the same draft in the Waiting on you card, and sending clears it", async () => {
    useUiStore.getState().setQuestionDraft("req-1", [{ labels: [], other: true, otherText: "Teal" }]);
    const onAnswerQuestion = vi.fn(() => Promise.resolve());
    render(
      <PermissionRequestCard
        variant="feed"
        keyboardEnabled={false}
        requests={[REQUEST]}
        onAnswer={() => Promise.resolve()}
        onAnswerQuestion={onAnswerQuestion}
      />,
    );
    expect(screen.getByLabelText(OTHER_FIELD)).toHaveValue("Teal");

    fireEvent.click(screen.getByRole("button", { name: "Send answer" }));
    await waitFor(() =>
      expect(onAnswerQuestion).toHaveBeenCalledWith("req-1", { "Which colour should the button be?": ["Teal"] }),
    );
    await waitFor(() => expect(useUiStore.getState().questionDrafts["req-1"]).toBeUndefined());
  });
});
