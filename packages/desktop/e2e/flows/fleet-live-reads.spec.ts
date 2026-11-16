/**
 * UAT 12 (`scripts/uat/uat-12-fleet-live-reads.mjs`), the part that needs no closed Story, as a flow:
 * the fleet reads a live run's log tail (D-REV-48), a finished run leaves the fleet when the developer
 * acknowledges it (D-REV-49), and a reclaim refuses the worktrees that are still in use (the safe half of
 * D-REV-55). The core and the sidecar are the real ones; only the agent is scripted.
 * The doc is `docs/flows/fleet-live-reads.md`.
 */
import fs from "node:fs";
import { expect } from "@playwright/test";
import { flow } from "../fixtures";
import { seedFleetBoard, type Board } from "../seed";
import { COMMITS, FLEET_AGENT, FLEET_ENV } from "../agents/fleet-agent";

let board: Board & { stories: { id: string; key?: string }[] };

interface FleetRow {
  sessionId: string;
  storyId: string;
  runStatus: string;
  activity: { lines: string[] };
}
interface Fleet {
  rows: FleetRow[];
  totalRows: number;
}
interface Inventory {
  storyId: string;
  disposition: string;
  reason: string;
}
interface Session {
  id: string;
}

flow(
  "the fleet reads a live run's log tail, drops an acknowledged run and refuses to reclaim a worktree in use",
  {
    doc: "fleet-live-reads.md",
    agentScript: FLEET_AGENT,
    agentEnv: FLEET_ENV,
    seed: async (core) => {
      board = await seedFleetBoard(core);
    },
  },
  async ({ core }) => {
    const [alpha, bravo, charlie] = board.stories.map((s) => s.id);
    const fleet = () => core.call<Fleet>("fleet_list");
    const row = async (storyId: string) => (await fleet()).rows.find((r) => r.storyId === storyId);
    const sessionOf = async (storyId: string) => (await core.call<Session[]>("sessions_for_story", { storyId }))[0].id;
    /** The agent has made every commit: the log's tail is full and its last line is the last commit. */
    const fullTail = async (storyId: string) => {
      await expect
        .poll(async () => (await row(storyId))?.activity.lines.at(-1) ?? "", { timeout: 60_000 })
        .toContain(`n${COMMITS}.txt`);
    };

    // D-REV-48: a live run's row carries the end of its log, capped at 16 lines, newest last.
    await core.call("story_start", { storyId: alpha });
    await fullTail(alpha);
    const live = (await row(alpha))!;
    expect(live.runStatus).toBe("running");
    expect(live.activity.lines).toHaveLength(16);
    expect(live.activity.lines.at(-1)).toContain("fake_commit");

    // A run that dies, and a run that is stopped, both stay on the fleet until they are acknowledged.
    expect(core.killAgents()).toBeGreaterThan(0);
    await expect.poll(async () => (await row(alpha))?.runStatus, { timeout: 30_000 }).not.toBe("running");
    const died = (await row(alpha))!;
    expect(died.activity.lines).toEqual([]);

    await core.call("story_start", { storyId: bravo });
    await fullTail(bravo);
    await core.call("session_stop", { sessionId: await sessionOf(bravo) });
    await expect.poll(async () => (await row(bravo))?.runStatus, { timeout: 30_000 }).not.toBe("running");
    expect((await row(bravo))!.activity.lines).toEqual([]);

    await core.call("story_start", { storyId: charlie });
    await fullTail(charlie);
    expect((await fleet()).totalRows).toBe(3);

    // D-REV-49: Dismiss removes one finished row per call, and a live run cannot be dismissed.
    await core.call("session_acknowledge", { sessionId: await sessionOf(charlie) });
    expect((await row(charlie))?.runStatus).toBe("running");
    await core.call("session_acknowledge", { sessionId: await sessionOf(bravo) });
    expect(await row(bravo)).toBeUndefined();
    expect((await fleet()).totalRows).toBe(2);
    expect(await row(alpha)).toBeDefined();
    await core.call("session_acknowledge", { sessionId: await sessionOf(alpha) });
    expect(await row(alpha)).toBeUndefined();
    expect((await fleet()).totalRows).toBe(1);

    // D-REV-55, the refusals: no Story here is closed, so nothing is reclaimable. The live run's worktree
    // is in use, the others belong to open Stories, and a reclaim removes none of them.
    const inventory = await core.call<Inventory[]>("worktree_inventory");
    const reason = (id: string) => inventory.find((w) => w.storyId === id)?.reason;
    expect(inventory.find((w) => w.storyId === charlie)?.disposition).toBe("in_use");
    expect(reason(charlie)).toBe("sessionning");
    expect(reason(alpha)).toBe("story_open");
    const paths = await Promise.all(
      [alpha, bravo, charlie].map(
        async (id) => (await core.call<{ path: string }>("worktree_summary", { storyId: id })).path,
      ),
    );
    const outcomes = await core.call<{ storyId: string; removed: boolean }[]>("worktree_reclaim", {
      storyIds: [alpha, bravo, charlie],
    });
    expect(outcomes.map((o) => o.removed)).toEqual([false, false, false]);
    for (const path of paths) expect(fs.existsSync(path)).toBe(true);
    expect((await fleet()).totalRows).toBe(1);
  },
);
