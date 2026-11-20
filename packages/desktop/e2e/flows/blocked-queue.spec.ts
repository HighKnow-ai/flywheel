/**
 * UAT 12's D-REV-50 (`scripts/uat/uat-12-fleet-live-reads.mjs`) as a flow, through the real UI: two agents in
 * two Stories ask for a permission at once, the Waiting on you queue lists both, and each answer takes
 * exactly one entry off it. The developer starts the Stories on the board and answers in the queue, with the
 * keyboard and with the mouse, and a third answer is "Always allow", which saves a standing rule for the project
 * (issue #1845). The agent calls the real permission tool of its MCP server, as the real
 * backend does, so the request goes through the real sidecar. The doc is `docs/flows/blocked-queue.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedFleetBoard, type Board } from "../seed";
import { BLOCKING_AGENT, BLOCKING_ENV } from "../agents/blocking-agent";

let board: Board & { stories: { id: string; key?: string }[] };

interface Entry {
  requestId: string;
  sessionId: string;
  storyId: string;
  storyKey: string;
  toolName: string;
  suggestedRule: string | null;
}

flow(
  "the blocked queue lists every agent that waits and shrinks by one for each answer",
  {
    doc: "blocked-queue.md",
    agentScript: BLOCKING_AGENT,
    agentEnv: BLOCKING_ENV,
    seed: async (core) => {
      board = await seedFleetBoard(core);
    },
  },
  async ({ page, core, open, shot }) => {
    const [alpha, bravo, charlie] = board.stories;
    const queue = () => core.call<Entry[]>("fleet_blocked_queue");
    // The queue as the developer sees it: one list item for each request, marked with its run.
    const list = page.getByRole("list", { name: "Requests waiting on you" });
    const rows = list.getByRole("listitem");
    const railQueue = page.getByRole("button", { name: /^Open Waiting on you/ });

    await open();
    expect(await queue()).toEqual([]);
    await railQueue.click();
    await expect(page.getByText("Nothing is waiting on you")).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();

    // S1-S2: the developer starts two Stories on the board. Both agents ask for a permission, so the queue
    // has two entries, one for each Story, and the rail counts them.
    await page.getByRole("button", { name: `Start ${alpha.key}` }).click();
    await page.getByRole("button", { name: `Start ${bravo.key}` }).click();
    await expect.poll(async () => (await queue()).length, { timeout: 60_000 }).toBe(2);
    await expect(page.getByRole("button", { name: "Open Waiting on you, 2 waiting" })).toBeVisible();
    await railQueue.click();
    await expect(rows).toHaveCount(2);
    const entries = await queue();
    expect(entries.map((e) => e.storyId).sort()).toEqual([alpha.id, bravo.id].sort());
    await expect(rows.first()).toHaveAttribute("data-run-id", entries[0].sessionId);
    await expect(rows.nth(1)).toHaveAttribute("data-run-id", entries[1].sessionId);
    await shot("two-requests-waiting");

    // S3: the first entry owns the keyboard, and the key A allows it. The queue has one entry, and it is the
    // other request, which owns the keyboard now.
    const [first, second] = entries;
    await expect(rows.first()).toHaveAttribute("data-keyboard-owner", "true");
    await page.keyboard.press("a");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-run-id", second.sessionId);
    await expect(rows.first()).toHaveAttribute("data-keyboard-owner", "true");
    expect((await queue()).map((e) => e.requestId)).toEqual([second.requestId]);

    // S4: the same request cannot be answered twice. The screen has no control for it, so this step is a
    // command. The core refuses it, and the queue on the screen and in the core do not change.
    await expect(
      core.call("session_answer_permission", { requestId: first.requestId, decision: "deny" }),
    ).rejects.toThrow();
    expect((await queue()).map((e) => e.requestId)).toEqual([second.requestId]);
    await expect(rows).toHaveCount(1);

    // S5: the developer denies the second request with the mouse. The queue is empty.
    await list.getByRole("button", { name: "Deny" }).click();
    await expect(page.getByText("Nothing is waiting on you")).toBeVisible();
    expect(await queue()).toEqual([]);
    await shot("queue-empty");

    // S6-S7: the developer starts the third Story, and its agent asks too. The developer answers with
    // "Always allow": the card's pattern is the request's suggested rule, and Flywheel saves it for the project.
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: `Start ${charlie.key}` }).click();
    await expect.poll(async () => (await queue()).length, { timeout: 60_000 }).toBe(1);
    const [third] = await queue();
    expect(await core.call<unknown[]>("permission_rules_list", { projectId: board.projectId })).toEqual([]);
    await railQueue.click();
    await expect(rows).toHaveCount(1);
    await list.getByRole("button", { name: "Always allow…", exact: true }).click();
    const pattern = page.getByRole("textbox", { name: "Pattern" });
    await expect(pattern).toHaveValue(third.suggestedRule ?? "");
    await shot("always-allow");
    await page.getByRole("button", { name: "Always allow this pattern in this project" }).click();
    await expect(page.getByText("Nothing is waiting on you")).toBeVisible();
    expect(await queue()).toEqual([]);
    // The rule is the project's now: the exact command the agent asked to run.
    const rules = await core.call<{ tool: string; pattern: string }[]>("permission_rules_list", {
      projectId: board.projectId,
    });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ tool: "Bash", pattern: "echo first" });
  },
);
