/**
 * The other end of a note to the agent (docs/adr/0044) as a flow, through the real UI: the agent reaches no
 * turn boundary, the developer stops the session, and the card says in words that the note was not
 * delivered. The agent stays alive and makes no tool call, so nothing takes the note. The doc is
 * `docs/flows/note-undelivered.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedFleetBoard, type Board } from "../seed";
import { SILENT_AGENT, SILENT_ENV } from "../agents/note-agent";

let board: Board & { stories: { id: string; key?: string; title?: string }[] };

const NOTE = "Also check the Windows path.";

flow(
  "a note the agent never took reads as not delivered once the session ends",
  {
    doc: "note-undelivered.md",
    agentScript: SILENT_AGENT,
    agentEnv: SILENT_ENV,
    seed: async (core) => {
      board = await seedFleetBoard(core);
    },
  },
  async ({ page, core, open, shot }) => {
    const story = board.stories[0];
    const sessions = () => core.call<{ id: string; status: string }[]>("sessions_for_story", { storyId: story.id });
    const notes = () => core.call<{ status: string }[]>("story_notes", { storyId: story.id });

    // S1: the developer starts the Story and opens it.
    await open();
    await page.getByRole("button", { name: `Start ${story.key}` }).click();
    await expect.poll(async () => (await sessions()).map((s) => s.status), { timeout: 30_000 }).toEqual(["running"]);
    await page
      .getByRole("list", { name: /Stories$/ })
      .getByRole("button", { name: `Open Story ${story.key} ${story.title}` })
      .click();

    // S2: the developer sends a note. The agent reaches no boundary, so the card says Sent and stays so.
    await page.getByRole("textbox", { name: `Note to the agent on ${story.key}` }).fill(NOTE);
    await page.getByRole("button", { name: `Send note to ${story.key}` }).click();
    const item = page
      .getByRole("list", { name: `Notes on ${story.key}` })
      .getByRole("listitem")
      .first();
    await expect(item).toContainText("Sent. Waits for the agent's next step.");
    await page.waitForTimeout(3_000);
    await expect(item).toHaveAttribute("data-note-status", "sent");
    await shot("note-sent");

    // S3: the developer stops the session. The note is not delivered, and the card says why in words.
    await page.getByRole("button", { name: `Stop ${story.key}` }).click();
    await page.getByRole("button", { name: "Stop the session" }).click();
    await expect.poll(async () => (await sessions())[0].status, { timeout: 30_000 }).not.toBe("running");
    await expect(item).toHaveAttribute("data-note-status", "undelivered", { timeout: 30_000 });
    await expect(item).toContainText("Not delivered. The session ended before the agent took it");
    await expect(item).toContainText("the next session does not receive it");
    await expect(item).toContainText(NOTE);
    expect((await notes()).map((n) => n.status)).toEqual(["undelivered"]);
    // The session is over, so the card offers no field to write in.
    await expect(page.getByRole("textbox", { name: `Note to the agent on ${story.key}` })).toHaveCount(0);
    await shot("note-undelivered");
  },
);
