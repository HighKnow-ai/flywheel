/**
 * Request changes and Rebase needed in WebKit (issue #158), over the critique's seeded backend
 * (`m2-fixture.ts`): the real `<App />`, from the board's Open review to the command the review card sends.
 *
 * `review-card.test.tsx` pins the card's behaviour in jsdom. This file walks the flow with real clicks and
 * key presses in the engine closest to the shipped WKWebView: the composer takes the focus, Escape gives it
 * back to Request changes, and Request rebase sends the core's comment naming the conflicting files.
 *
 * It does not prove the Tauri IPC behind it (mocked here); `commands::story` tests the command's launch.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import App from "../../../App";
import { answer, setReviewInFixture } from "../../../test/critique/m2-fixture";

const requests: Record<string, unknown>[] = [];

async function openReview() {
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
  const open = await screen.findByRole("button", { name: "Open review of FLY-3" });
  open.scrollIntoView({ block: "center" });
  await userEvent.click(open);
  return screen.findByRole("region", { name: "Review" });
}

describe("Request changes in WebKit", () => {
  beforeEach(() => {
    requests.length = 0;
    resetUiState();
    queryClient.clear();
    mockIPC(
      (cmd, payload) => {
        if (cmd === "story_request_changes") {
          requests.push(payload as Record<string, unknown>);
          return { id: "ses-3b", storyId: "s-3", status: "running", permissionMode: "acceptEdits" };
        }
        return answer(cmd, payload as Record<string, unknown> | undefined);
      },
      { shouldMockEvents: true },
    );
  });
  afterEach(() => {
    cleanup();
    clearMocks();
    setReviewInFixture("judging");
  });

  it("writes the review points in the footer and sends the Story back to Running with them", async () => {
    setReviewInFixture("judging");
    const card = await openReview();
    const request = await within(card).findByRole("button", { name: "Request changes on FLY-3" });

    await userEvent.click(request);
    const comments = within(card).getByRole("textbox", { name: "What should change?" });
    await waitFor(() => expect(comments).toHaveFocus());
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(within(card).getByRole("button", { name: "Request changes on FLY-3" })).toHaveFocus());

    await userEvent.click(within(card).getByRole("button", { name: "Request changes on FLY-3" }));
    await userEvent.type(
      within(card).getByRole("textbox", { name: "What should change?" }),
      "Lift the subtle ink.{Enter}Record the lift.",
    );
    await userEvent.click(within(card).getByRole("button", { name: "Send FLY-3 back to Running" }));

    await waitFor(() =>
      expect(requests).toEqual([{ storyId: "s-3", comments: "Lift the subtle ink.\nRecord the lift." }]),
    );
  });

  it("reads Rebase needed with the conflicting files and sends them back in the pre-filled comment", async () => {
    setReviewInFixture("rebase");
    const card = await openReview();
    const rebase = await within(card).findByRole("region", { name: "Rebase needed" });
    expect(within(rebase).getByText("DESIGN.md")).toBeVisible();
    expect(within(card).getByRole("button", { name: "Merge FLY-3" })).toHaveAttribute("aria-disabled", "true");

    await userEvent.click(within(rebase).getByRole("button", { name: "Request a rebase of FLY-3" }));
    await userEvent.click(within(card).getByRole("button", { name: "Send FLY-3 back to Running" }));

    await waitFor(() => expect(requests).toHaveLength(1));
    const comment = String(requests[0].comments);
    expect(comment).toContain("DESIGN.md");
    expect(comment).toContain("packages/desktop/src/theme/tokens.css");
  });
});
