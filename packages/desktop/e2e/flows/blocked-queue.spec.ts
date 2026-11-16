/**
 * UAT 12's D-REV-50 (`scripts/uat/uat-12-fleet-live-reads.mjs`) as a flow: two agents in two Stories ask
 * for a permission at once, the blocked queue lists both, and each answer takes exactly one entry off
 * it. The agent calls the real permission tool of its MCP server, as the real backend does, so the
 * request goes through the real sidecar. The doc is `docs/flows/blocked-queue.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedFleetBoard, type Board } from "../seed";
import { BLOCKING_AGENT, BLOCKING_ENV } from "../agents/blocking-agent";

let board: Board & { stories: { id: string; key?: string }[] };

interface Entry {
  requestId: string;
  storyId: string;
  toolName: string;
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
  async ({ core }) => {
    const [alpha, bravo] = board.stories.map((s) => s.id);
    const queue = () => core.call<Entry[]>("fleet_blocked_queue");

    expect(await queue()).toEqual([]);
    await core.call("story_start", { storyId: alpha });
    await core.call("story_start", { storyId: bravo });
    await expect.poll(async () => (await queue()).length, { timeout: 60_000 }).toBe(2);
    const entries = await queue();
    expect(entries.map((e) => e.storyId).sort()).toEqual([alpha, bravo].sort());

    // One answer takes one entry off the queue, and the other agent still waits.
    const [first, second] = entries;
    await core.call("session_answer_permission", { requestId: first.requestId, decision: "allow" });
    expect((await queue()).map((e) => e.requestId)).toEqual([second.requestId]);

    // The same request cannot be answered twice, and a refused answer moves nothing.
    await expect(
      core.call("session_answer_permission", { requestId: first.requestId, decision: "deny" }),
    ).rejects.toThrow();
    expect((await queue()).map((e) => e.requestId)).toEqual([second.requestId]);

    await core.call("session_answer_permission", { requestId: second.requestId, decision: "deny" });
    expect(await queue()).toEqual([]);
  },
);
