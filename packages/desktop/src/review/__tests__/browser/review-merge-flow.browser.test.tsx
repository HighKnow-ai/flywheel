/**
 * Milestone 4's exit test clicked through the real `<App />` in WebKit (issue #169): from the roster, Needs you
 * and the triage drawer to the review card and Merge.
 *
 * The backend is `review-merge-backend.ts`, the m2 fixture with what the walk writes kept in memory under the
 * core's rules. The test plays the developer through clicks; every read and write goes through the app's own
 * adapter, React Query and `board:changed` subscription, and only the IPC transport is fake.
 * `scripts/uat/uat-19-board-and-review.mjs` walks the same flow through the real core, sidecar and MCP server.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import { queryClient } from "../../../adapters/queryClient";
import { resetUiState } from "../../../state/uiStore";
import { useTriageDrawer } from "../../../proposals/triageStore";
import App from "../../../App";
import { HELD_ADR, installReviewMergeBackend } from "./review-merge-backend";

const UNACCEPTED = [
  "Each of the three directions is rendered from code over the M3 backlog, light and dark",
  "The pick and its two changes are recorded in direction.md",
];

type Backend = ReturnType<typeof installReviewMergeBackend>;

function renderApp() {
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
}

async function needsYou() {
  return screen.findByRole("region", { name: /^Needs you/ });
}

/** Click a control, scrolled into view first: the roster and Needs you both scroll. */
async function press(button: HTMLElement) {
  button.scrollIntoView({ block: "center" });
  await userEvent.click(button);
}

describe("Milestone 4's exit test in WebKit: roster, Needs you, the triage drawer, review and Merge", () => {
  let backend: Backend;

  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    useTriageDrawer.getState().closeTriage();
    backend = installReviewMergeBackend();
  });
  afterEach(() => {
    cleanup();
    clearMocks();
    backend.reset();
  });

  it("decides what waits in Needs you and the drawer, then accepts, keeps the ADR and merges FLY-3", async () => {
    renderApp();

    // The roster: FLY-3 is In review, and its row offers Open review.
    await screen.findAllByText("Make clicking and navigation predictable");
    expect(await screen.findByRole("button", { name: "Open review of FLY-3" })).toBeInTheDocument();

    // Needs you: the Review, the two judged-on changes and the Proposals row.
    let column = await needsYou();
    expect(within(column).getByRole("button", { name: /^Open review of FLY-3 / })).toBeInTheDocument();
    expect(within(column).getByRole("button", { name: "Triage 4 Proposals" })).toBeInTheDocument();

    // A judged-on change is decided where it is drawn: Accept the Amend criterion, Reject the Amend Epic spec.
    await press(within(column).getByRole("button", { name: "Accept the Amend criterion on FLY-5" }));
    await waitFor(() => expect(backend.decided.get("pj-1")).toBe("accepted"));
    await waitFor(() =>
      expect(within(column).queryByRole("button", { name: "Accept the Amend criterion on FLY-5" })).toBeNull(),
    );
    // The accepted card stays in place, inert, while it collapses out (board/leaving.tsx). Typing into the next
    // card while it is still there raced its removal: the browser locator, a path by list position, went stale
    // when the list shortened, and the walk timed out under reduced motion (#212). Wait for it to be gone.
    await waitFor(() => expect(column.querySelector("[data-leaving]")).toBeNull());
    await press(within(column).getByRole("button", { name: "Reject the Amend Epic spec on FLY-1" }));
    await userEvent.type(
      within(column).getByRole("textbox", { name: "Why not? (optional)" }),
      "The review card keeps its own look for now",
    );
    await press(within(column).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(backend.decided.get("pj-2")).toBe("rejected"));
    await waitFor(() => expect(within(column).queryByRole("group", { name: "Scope, before and after" })).toBeNull());

    // The triage drawer: accept one New Story, reject another with a reason; the row then counts two.
    await press(within(column).getByRole("button", { name: "Triage 4 Proposals" }));
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await userEvent.click(await within(drawer).findByRole("button", { name: /^Accept New Story “Keyboard shortcuts/ }));
    await waitFor(() =>
      expect(within(drawer).queryByRole("button", { name: /^Accept New Story “Keyboard shortcuts/ })).toBeNull(),
    );
    // The same race as in Needs you above: the accepted card collapses out before the next one is typed into.
    await waitFor(() => expect(drawer.querySelector("[data-leaving]")).toBeNull());
    await userEvent.click(
      within(drawer).getByRole("button", { name: /^Reject New Story “Measure the board's first paint/ }),
    );
    await userEvent.type(
      within(drawer).getByRole("textbox", { name: "Why not? (optional)" }),
      "Timed with the relay milestone",
    );
    await userEvent.click(within(drawer).getByRole("button", { name: "Reject" }));
    await waitFor(() =>
      expect(
        within(drawer).queryByRole("button", { name: /^Reject New Story “Measure the board's first paint/ }),
      ).toBeNull(),
    );
    expect(Object.fromEntries(backend.decided)).toEqual({
      "pj-1": "accepted",
      "pj-2": "rejected",
      "tp-1": "accepted",
      "tp-3": "rejected",
    });
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Triage Proposals/ })).toBeNull());
    column = await needsYou();
    await within(column).findByRole("button", { name: "Triage 2 Proposals" });

    // Open review from Needs you: Merge is held by the two criteria to accept and the ADR marked Not an ADR.
    await press(within(column).getByRole("button", { name: /^Open review of FLY-3 / }));
    const card = await screen.findByRole("region", { name: "Review" });
    const merge = await within(card).findByRole("button", { name: "Merge FLY-3" });
    expect(merge).toHaveAttribute("aria-disabled", "true");

    for (const statement of UNACCEPTED) {
      const box = within(card).getByRole("checkbox", { name: statement });
      await press(box);
      await waitFor(() => expect(within(card).getByRole("checkbox", { name: statement })).toBeChecked());
    }
    expect(within(card).getByRole("button", { name: "Merge FLY-3" })).toHaveAttribute("aria-disabled", "true");

    const decision = within(card).getByRole("radiogroup", {
      name: "Decision on The picked direction lives in direction.md",
    });
    expect(within(decision).getByRole("radio", { name: "Not an ADR" })).toBeChecked();
    await press(within(decision).getByRole("radio", { name: "Keep" }));
    await waitFor(() =>
      expect(within(card).getByRole("button", { name: "Merge FLY-3" })).not.toHaveAttribute("aria-disabled"),
    );

    // Merge stays in reach (issue #207): 26 files start folded under a file index, and with every diff open the
    // footer still holds Merge inside the window while the Developer reads from the top of the card.
    const files = within(card).getByRole("region", { name: "26 changed files" });
    expect(within(files).getAllByRole("link")).toHaveLength(26);
    expect(within(files).queryAllByRole("button", { expanded: true })).toHaveLength(0);
    await press(within(files).getByRole("button", { name: "Expand all" }));
    await waitFor(() => expect(within(files).getAllByRole("group", { name: /^Diff of / }).length).toBeGreaterThan(20));
    within(card).getByRole("heading", { name: "Review" }).scrollIntoView({ block: "start" });
    const inReach = within(card).getByRole("button", { name: "Merge FLY-3" }).getBoundingClientRect();
    expect(card.getBoundingClientRect().bottom).toBeGreaterThan(window.innerHeight * 3);
    expect(inReach.top).toBeGreaterThanOrEqual(0);
    expect(inReach.bottom).toBeLessThanOrEqual(window.innerHeight);

    // Merge: FLY-3 is Merged, a toast says it landed, its review card is gone, and so is its Review item in Needs you.
    await userEvent.click(within(card).getByRole("button", { name: "Merge FLY-3" }));
    await waitFor(() => expect(backend.merged).not.toBeNull());
    expect(await screen.findByText("FLY-3 merged into main")).toBeInTheDocument();
    expect(screen.getByText("Worktree cleaned.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("region", { name: "Review" })).toBeNull());
    const writes = backend.writes.map((w) => w.cmd);
    expect(writes).toEqual([
      "proposal_accept",
      "proposal_reject",
      "proposal_accept",
      "proposal_reject",
      "criterion_accept",
      "criterion_accept",
      "story_adr_decide",
      "story_merge",
    ]);
    expect(backend.writes.find((w) => w.cmd === "story_adr_decide")?.args).toMatchObject({
      storyId: "s-3",
      path: HELD_ADR,
      decision: "keep",
    });
    expect(backend.writes[backend.writes.length - 1]?.args).toEqual({ storyId: "s-3", withFailingChecks: false });
    await userEvent.click(screen.getByRole("button", { name: "Open board" }));
    column = await needsYou();
    await within(column).findByRole("button", { name: "Triage 2 Proposals" });
    expect(within(column).queryByRole("button", { name: /^Open review of FLY-3 / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open review of FLY-3" })).toBeNull();
  });
});
