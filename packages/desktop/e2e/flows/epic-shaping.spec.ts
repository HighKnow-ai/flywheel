/**
 * UAT 16 (`scripts/uat/uat-16-epic-shaping.mjs`) through the real UI: a one-line Epic goes from
 * Shape to Ready Stories with criteria and Checks, through a shaping session killed mid-Round. The
 * renderer, the core and the sidecar are the real ones; only the agent is scripted.
 * The doc is `docs/flows/epic-shaping.md`.
 */
import { expect, type Page } from "@playwright/test";
import { flow } from "../fixtures";
import { seedShapingBoard } from "../seed";
import { EXIT_TEST, OWN_ANSWER, SHAPING_AGENT, STORIES } from "../agents/shaping-agent";

const EPIC = "FLY-1 Parse a file with a bad line";

/** Close the open Stage through its confirmation. */
async function closeStage(page: Page, confirm: string) {
  const close = page.getByRole("button", { name: "Close Stage" });
  await expect(close).toHaveAttribute("aria-disabled", "false");
  await close.click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByRole("button", { name: confirm }).click();
  await expect(dialog).toBeHidden();
}

flow(
  "a one-line Epic is shaped to Ready Stories through a session killed mid-Round",
  { doc: "epic-shaping.md", agentScript: SHAPING_AGENT, seed: async (core) => void (await seedShapingBoard(core)) },
  async ({ page, core, open, shot }) => {
    await open();

    // Shape starts the session; its Round turns the control into Answer, which opens the dock.
    await page.getByRole("button", { name: `Shape ${EPIC}` }).click();
    await page.getByRole("button", { name: "Answer the Round on FLY-1" }).click();
    const round = () => page.getByRole("heading", { name: /^Round 1\b/ }).locator("xpath=ancestor::section[1]");
    await expect(round().getByText("Waiting on you")).toBeVisible();

    // One answer in the developer's own words, then Accept all, which leaves the ADR open.
    await round().getByRole("button", { name: "Answer question 2 differently" }).click();
    await round().getByLabel("Your answer to question 2").fill(OWN_ANSWER);
    await round().getByRole("button", { name: "Send answer" }).click();
    await expect(round().getByText(OWN_ANSWER)).toBeVisible();
    await round().getByRole("button", { name: "Accept all recommended" }).click();
    await expect(round().getByText("2 of 3 answered")).toBeVisible();
    await expect(round().getByText("Only the ADR is left: answer it Yes or No.")).toBeVisible();
    await shot("round-held");

    // The session is killed mid-Round: the answers stay, and the band offers Continue shaping.
    expect(core.killAgents()).toBeGreaterThan(0);
    await expect(round().getByText("No live session: your answers are kept")).toBeVisible();
    await expect(round().getByText("2 of 3 answered")).toBeVisible();
    await round()
      .getByRole("button", { name: `Continue shaping ${EPIC}` })
      .click();
    await expect(round().getByText("Waiting on you")).toBeVisible();

    // The ADR's Yes completes the Round; the resumed session gets every answer and proposes the spec.
    await round().getByRole("button", { name: "Yes, record it" }).click();
    await expect(page.getByRole("list", { name: "ADRs and glossary" })).toContainText(
      "0001-live-verbs-come-from-the-tool-name.md",
    );
    await page.getByRole("button", { name: "Accept the proposed Problem" }).click();
    await page.getByRole("button", { name: "Accept the proposed Exit test" }).click();
    await expect(page.getByText(EXIT_TEST)).toBeVisible();
    await closeStage(page, "Close and start Slice into Stories");

    // Slice: two Stories, the second running after the first.
    await page.getByRole("button", { name: `Accept the proposed Story ${STORIES[0].title}` }).click();
    await page.getByRole("button", { name: `Accept the proposed Story ${STORIES[1].title}` }).click();
    await expect(page.getByRole("listitem", { name: `2. FLY-3 ${STORIES[1].title}` })).toBeVisible();
    await expect(page.getByRole("list", { name: "Runs-after constraints" })).toContainText(
      "FLY-3 runs after FLY-2: reads its verbs",
    );
    await closeStage(page, "Close and start Write the Acceptance criteria");

    // Criteria: one with a Check under each Story, accepted on its ghost card.
    await page.getByRole("button", { name: "Accept the proposed criterion Every board tool has a live verb" }).click();
    await page
      .getByRole("button", { name: "Accept the proposed criterion A running call's row reads its live verb" })
      .click();
    await expect(page.getByText("npm test -- feed-row")).toBeVisible();
    await closeStage(page, "Close and make the Epic Ready");

    // Ready: the Epic, both Stories with their Checks, every Stage closed, nothing left to shape.
    await expect(
      page.getByText("Write the Acceptance criteria is closed: the Epic and its 2 Stories are Ready."),
    ).toBeVisible();
    await expect(page.getByText("Every Stage is closed: shaping is done.")).toBeVisible();
    for (const [key, check] of [
      ["FLY-2", "npm test -- tool-verbs"],
      ["FLY-3", "npm test -- feed-row"],
    ] as const) {
      const column = page.getByRole("listitem", { name: new RegExp(`^\\d\\. ${key} `) });
      await expect(column.getByText("Ready")).toBeVisible();
      await expect(column.getByText(check)).toBeVisible();
    }
    await shot("epic-ready");
  },
);
