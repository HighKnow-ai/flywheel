/**
 * The supervised half of the harness supervision gate (`scripts/uat/harness-supervision-gate.mjs`, D-105)
 * as a flow: a session the core started keeps living past the watchdog's stale window, at its production
 * length, because the core writes the heartbeat. Then the developer stops it and it ends as completed.
 *
 * The other half of the gate is not a flow. It proves that the Node harness's `sessionEnv` opts into the
 * heartbeat by default, that an opt-out is still reaped and that an unfittable wait is refused. Here the
 * core, not a script, owns the heartbeat, so that half stays an offline UAT. The doc is
 * `docs/flows/session-supervision.md`.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedFleetBoard, type Board } from "../seed";
import { SUPERVISED_AGENT, SUPERVISED_ENV } from "../agents/supervised-agent";

let board: Board & { stories: { id: string; key?: string }[] };

/** `watchdog.ts` `DEFAULT_HEARTBEAT_STALE_MS`: the staleness a session without a heartbeat dies at. */
const STALE_MS = 15_000;

interface Session {
  id: string;
  status: string;
  endingReason: string | null;
}

flow(
  "a session outlives the watchdog's stale window because the core sustains its heartbeat",
  {
    doc: "session-supervision.md",
    agentScript: SUPERVISED_AGENT,
    agentEnv: SUPERVISED_ENV,
    seed: async (core) => {
      board = await seedFleetBoard(core);
    },
  },
  async ({ core }) => {
    const storyId = board.stories[0].id;
    const sessions = () => core.call<Session[]>("sessions_for_story", { storyId });

    const startedAt = Date.now();
    await core.call("story_start", { storyId });
    expect((await sessions()).map((s) => s.status)).toEqual(["running"]);

    // Wait past the stale window. A session with no heartbeat is killed at 15 s, so a run that is still
    // `running` 5 s later was kept alive by the core's own heartbeat.
    await new Promise((resolve) => setTimeout(resolve, STALE_MS + 5_000 - (Date.now() - startedAt)));
    expect(Date.now() - startedAt).toBeGreaterThan(STALE_MS + 4_000);
    expect((await sessions()).map((s) => s.status)).toEqual(["running"]);

    // The end the developer asks for is a clean one, not a kill by the watchdog.
    const [session] = await sessions();
    await core.call("session_stop", { sessionId: session.id });
    await expect.poll(async () => (await sessions())[0].status, { timeout: 30_000 }).not.toBe("running");
    expect((await sessions())[0].status).not.toBe("failed");
    expect(core.log()).not.toContain("heartbeat-stale");
  },
);
