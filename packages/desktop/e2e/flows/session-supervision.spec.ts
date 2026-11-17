/**
 * The supervised half of the harness supervision gate (`scripts/uat/harness-supervision-gate.mjs`, D-105)
 * as a flow, through the real UI: a session the core started keeps living past the watchdog's stale window,
 * at its production length, because the core writes the heartbeat. Then the developer stops it from the
 * Story view, and it ends as completed.
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
  async ({ page, core, open, shot }) => {
    const story = board.stories[0];
    const sessions = () => core.call<Session[]>("sessions_for_story", { storyId: story.id });

    // S1: the developer starts the Story on the board and opens it. The run is `running`, and the Story view offers Stop.
    await open();
    const startedAt = Date.now();
    await page.getByRole("button", { name: `Start ${story.key}` }).click();
    await expect.poll(async () => (await sessions()).map((s) => s.status), { timeout: 30_000 }).toEqual(["running"]);
    // The board's button, not the rail's or the fleet's: once the run starts, the same Story is also
    // listed in the project rail, and a page-wide match found three buttons on the gate (run 44128598329).
    await page
      .getByRole("list", { name: /Stories$/ })
      .getByRole("button", { name: `Open Story ${story.key} ${story.title}` })
      .click();
    const stop = page.getByRole("button", { name: `Stop ${story.key}` });
    await expect(stop).toBeVisible();

    // Wait past the stale window. A session with no heartbeat is killed at 15 s, so a run that is still
    // `running` 5 s later was kept alive by the core's own heartbeat.
    await page.waitForTimeout(Math.max(0, STALE_MS + 5_000 - (Date.now() - startedAt)));
    expect(Date.now() - startedAt).toBeGreaterThan(STALE_MS + 4_000);
    expect((await sessions()).map((s) => s.status)).toEqual(["running"]);
    await expect(stop).toBeVisible();
    await shot("running-past-the-window");

    // S3: the end the developer asks for is a clean one, not a kill by the watchdog.
    const [session] = await sessions();
    await stop.click();
    await page.getByRole("button", { name: "Stop the session" }).click();
    await expect.poll(async () => (await sessions())[0].status, { timeout: 30_000 }).not.toBe("running");
    expect((await sessions())[0].status).not.toBe("failed");
    expect((await sessions())[0].id).toBe(session.id);
    await expect(page.getByRole("button", { name: `Resume ${story.key}` })).toBeVisible();
    expect(core.log()).not.toContain("heartbeat-stale");
  },
);
