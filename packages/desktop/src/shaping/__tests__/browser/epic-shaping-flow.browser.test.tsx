/**
 * Epic #59's exit test clicked through the real `<App />` in WebKit (issue #130): a one-line Epic goes from
 * Shape to Ready in the dock and on the board, through a shaping session killed mid-Round.
 *
 * The backend is `epic-shaping-backend.ts`, a fixture that keeps the Epic in memory and follows the core's rules;
 * the test plays the agent through its `agent` calls and the developer through clicks. Every read and write goes
 * through the app's own adapter, React Query and `board:changed` subscription; only the IPC transport is fake.
 * `scripts/uat/uat-16-epic-shaping.mjs` walks the same flow through the real core, sidecar and MCP server.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import App from "../../../App";
import { installEpicShapingBackend } from "./epic-shaping-backend";

const EPIC = "FLY-12 Feed rows show the agent's live verb";
const OWN_ANSWER = "Only the developer watching the fleet";
const ADR_PATH = "docs/adr/0009-live-verbs-come-from-the-tool-name.md";

type Backend = ReturnType<typeof installEpicShapingBackend>;

function renderApp() {
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
}

/** The current Round's card in the dock. */
async function currentRound(number: number) {
  return (await screen.findByRole("heading", { name: new RegExp(`^Round ${number}\\b`) })).closest(
    "section",
  ) as HTMLElement;
}

/** Close the open Stage through its confirmation. */
async function closeStage(confirm: string) {
  const close = await screen.findByRole("button", { name: "Close Stage" });
  await waitFor(() => expect(close.getAttribute("aria-disabled")).toBe("false"));
  await userEvent.click(close);
  const dialog = await screen.findByRole("alertdialog");
  await userEvent.click(within(dialog).getByRole("button", { name: confirm }));
  await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
}

describe("shaping an Epic from Shape to Ready in WebKit", () => {
  let backend: Backend;

  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    backend = installEpicShapingBackend();
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

  it("takes a one-line Epic through a killed session to Ready Stories with criteria and Checks", async () => {
    renderApp();

    // Shape on the board starts the session; its Round turns the control into Answer, which opens the dock.
    await userEvent.click(await screen.findByRole("button", { name: `Shape ${EPIC}` }));
    await waitFor(() => expect(backend.liveSession).not.toBeNull());
    await backend.agent.postRound("This Round settles who reads the live verb and where it comes from.", [
      {
        title: "Where the verb shows",
        question: "Should the live verb replace the row's summary while the call runs?",
        recommendedAnswer: "Yes, only while the call runs",
        because: "The finished row keeps saying what the tool did",
      },
      {
        title: "Who reads it",
        question: "Is the reader every viewer of the feed?",
        recommendedAnswer: "Yes, every viewer",
        because: "The feed has one audience",
      },
      {
        title: "Record where verbs come from",
        question: 'Record "live verbs come from the tool name" as ADR 0009?',
        recommendedAnswer: "Yes",
        because: "Every later tool's row follows it",
        adr: {
          path: ADR_PATH,
          text: "# Live verbs come from the tool name\n\nA row's live verb is derived from the tool, never from prose.\n",
        },
      },
    ]);
    await userEvent.click(await screen.findByRole("button", { name: "Answer the Round on FLY-12" }));
    let round = await currentRound(1);
    expect(within(round).getByText("Waiting on you")).toBeTruthy();

    // One answer in the developer's own words, then Accept all, which leaves the ADR open.
    await userEvent.click(within(round).getByRole("button", { name: "Answer question 2 differently" }));
    await userEvent.fill(within(round).getByLabelText("Your answer to question 2"), OWN_ANSWER);
    await userEvent.click(within(round).getByRole("button", { name: "Send answer" }));
    await within(round).findByText(OWN_ANSWER);
    await userEvent.click(within(round).getByRole("button", { name: "Accept all recommended" }));
    await within(round).findByText("2 of 3 answered");
    expect(within(round).getByText("Only the ADR is left: answer it Yes or No.")).toBeTruthy();
    expect(backend.released).toEqual([]);

    // The session is killed mid-Round: the answers stay, and the band offers Continue shaping.
    await backend.killSession();
    round = await currentRound(1);
    await within(round).findByText("No live session: your answers are kept");
    expect(within(round).getByText("2 of 3 answered")).toBeTruthy();
    expect(within(round).getByText(OWN_ANSWER)).toBeTruthy();
    await userEvent.click(within(round).getByRole("button", { name: `Continue shaping ${EPIC}` }));
    await waitFor(() => expect(backend.liveSession).not.toBeNull());
    await backend.agent.roundWait();
    round = await currentRound(1);
    await within(round).findByText("Waiting on you");

    // The ADR's Yes completes the Round: the resumed session gets every answer, and the Epic wears the ADR.
    await userEvent.click(within(round).getByRole("button", { name: "Yes, record it" }));
    await waitFor(() =>
      expect(backend.released).toEqual([
        { sessionId: backend.liveSession, answers: ["Yes, only while the call runs", OWN_ANSWER, "Yes"] },
      ]),
    );
    const chips = await screen.findByRole("list", { name: "ADRs and glossary" });
    expect(within(chips).getByText("0009-live-verbs-come-from-the-tool-name.md")).toBeTruthy();
    expect(within(chips).getByText("· not in the repo yet")).toBeTruthy();

    // The agent proposes the spec; the developer accepts each ghost and closes Challenge the spec.
    await backend.agent.proposeSpecChange(
      "problem",
      "A feed row says what a tool did, never what the agent is doing now.",
    );
    await backend.agent.proposeSpecChange("exit_test", "A running tool call reads as its live verb in the feed.");
    await userEvent.click(await screen.findByRole("button", { name: "Accept the proposed Problem" }));
    await userEvent.click(await screen.findByRole("button", { name: "Accept the proposed Exit test" }));
    await screen.findByText("A running tool call reads as its live verb in the feed.");
    await closeStage("Close and start Slice into Stories");
    await waitFor(() => expect(backend.liveSession).not.toBeNull());

    // Slice: two Stories, the second running after the first; accepted where they land.
    const first = await backend.agent.proposeStory(
      "Live verbs for board tools",
      "Each board tool reads as a live verb.",
    );
    await backend.agent.proposeStory(
      "The feed row shows the live verb",
      "The row swaps to the verb while the call runs.",
      {
        proposalId: first,
        reason: "reads its verbs",
      },
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Accept the proposed Story Live verbs for board tools" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Accept the proposed Story The feed row shows the live verb" }),
    );
    await screen.findByRole("listitem", { name: "2. FLY-14 The feed row shows the live verb" });
    expect(screen.getByRole("list", { name: "Runs-after constraints" }).textContent).toContain(
      "FLY-14 runs after FLY-13: reads its verbs",
    );
    await closeStage("Close and start Write the Acceptance criteria");
    await waitFor(() => expect(backend.liveSession).not.toBeNull());

    // Criteria: one with a Check under each Story, accepted on its ghost card.
    await backend.agent.proposeCriterion("FLY-13", "Every board tool has a live verb", "npm test -- tool-verbs");
    await backend.agent.proposeCriterion("FLY-14", "A running call's row reads its live verb", "npm test -- feed-row");
    await userEvent.click(
      await screen.findByRole("button", { name: "Accept the proposed criterion Every board tool has a live verb" }),
    );
    await userEvent.click(
      await screen.findByRole("button", {
        name: "Accept the proposed criterion A running call's row reads its live verb",
      }),
    );
    await screen.findByText("npm test -- feed-row");
    await closeStage("Close and make the Epic Ready");

    // Ready: the Epic, both Stories with their Checks, every Stage closed, nothing left to shape.
    await screen.findByText("Write the Acceptance criteria is closed: the Epic and its 2 Stories are Ready.");
    expect(screen.getByText("Every Stage is closed: shaping is done.")).toBeTruthy();
    expect(backend.epic.state).toBe("ready");
    expect(backend.liveSession).toBeNull();
    for (const [key, check] of [
      ["FLY-13", "npm test -- tool-verbs"],
      ["FLY-14", "npm test -- feed-row"],
    ]) {
      const column = screen.getByRole("listitem", { name: new RegExp(`^\\d\\. ${key} `) });
      expect(within(column).getByText("Ready")).toBeTruthy();
      expect(within(column).getByText(check)).toBeTruthy();
      expect(backend.criteriaOf(key).map((c) => [c.check?.command, c.check?.timeoutSecs])).toEqual([[check, 600]]);
    }
    expect(screen.queryByRole("button", { name: "Close Stage" })).toBeNull();
    expect(screen.queryByRole("button", { name: `Continue shaping ${EPIC}` })).toBeNull();
    expect(screen.queryByRole("button", { name: `Shape ${EPIC}` })).toBeNull();
  });
});
