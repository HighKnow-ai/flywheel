/**
 * A note to the agent (docs/adr/0044) as a flow, through the real UI: the developer starts a Story, opens
 * it, types a note and sends it. The note is handed to the agent after the tool call it is making, through
 * the hooks of its own settings file, and the board shows it as Delivered. The agent is `fake-claude.mjs` in
 * hook mode, which runs those hooks as the real backend does. The doc is `docs/flows/note-to-agent.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedFleetBoard, type Board } from "../seed";
import { NOTE_AGENT, NOTE_ENV } from "../agents/note-agent";

let board: Board & { stories: { id: string; key?: string; title?: string }[] };

const NOTE = "Use the 2024 fixture, not the 2023 one.";

interface Note {
  id: string;
  status: string;
  body: string;
}

flow(
  "a note sent to a running Story reaches the agent after its current step and shows as delivered",
  {
    doc: "note-to-agent.md",
    agentScript: NOTE_AGENT,
    agentEnv: NOTE_ENV,
    seed: async (core) => {
      board = await seedFleetBoard(core);
    },
  },
  async ({ page, core, open, shot }) => {
    const story = board.stories[0];
    const sessions = () => core.call<{ id: string; status: string }[]>("sessions_for_story", { storyId: story.id });
    const notes = () => core.call<Note[]>("story_notes", { storyId: story.id });

    // S1: the developer starts the Story and opens it.
    await open();
    await page.getByRole("button", { name: `Start ${story.key}` }).click();
    await expect.poll(async () => (await sessions()).map((s) => s.status), { timeout: 30_000 }).toEqual(["running"]);
    await page
      .getByRole("list", { name: /Stories$/ })
      .getByRole("button", { name: `Open Story ${story.key} ${story.title}` })
      .click();

    // S2: the developer types a note and sends it. It is a card of the running Story, with its own field.
    await page.getByRole("textbox", { name: `Note to the agent on ${story.key}` }).fill(NOTE);
    await page.getByRole("button", { name: `Send note to ${story.key}` }).click();
    const list = page.getByRole("list", { name: `Notes on ${story.key}` });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByRole("listitem").first()).toContainText(NOTE);

    // The agent finishes its tool call, the hook hands over the note, and the card says Delivered.
    await expect(list.getByRole("listitem").first()).toContainText("Delivered. The agent has it.", { timeout: 30_000 });
    await expect(list.getByRole("listitem").first()).toHaveAttribute("data-note-status", "delivered");
    expect((await notes()).map((n) => [n.body, n.status])).toEqual([[NOTE, "delivered"]]);
    await shot("note-delivered");

    // The agent has the words, in its own context: its log holds what the hook added after a tool call,
    // and the session is still running, so the note did not interrupt or end it.
    const [session] = await sessions();
    const seen = async () => {
      const window = await core.call<{ lines: { text: string }[] }>("session_raw_window", {
        sessionId: session.id,
        offset: 0,
        limit: 100,
      });
      return window.lines
        .map((l) => {
          try {
            return JSON.parse(JSON.parse(l.text).raw) as { type?: string; text?: string };
          } catch {
            return {};
          }
        })
        .filter((line) => line.type === "fake_hook_context")
        .map((line) => line.text ?? "");
    };
    await expect.poll(async () => (await seen()).length, { timeout: 30_000 }).toBe(1);
    expect((await seen())[0]).toContain(NOTE);
    expect((await sessions()).map((s) => s.status)).toEqual(["running"]);

    // The note is handed over once: a second boundary adds nothing.
    await page.waitForTimeout(4_000);
    expect(await seen()).toHaveLength(1);
  },
);
