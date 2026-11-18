/**
 * UAT 12 (`scripts/uat/uat-12-fleet-live-reads.mjs`), the part that needs no closed Story, as a flow, through
 * the real UI: the fleet reads a live run's log tail (D-REV-48), a finished run leaves the fleet when the
 * developer dismisses it (D-REV-49), and a reclaim refuses the worktrees that are still in use (the safe
 * half of D-REV-55). The developer starts the Stories on the board, stops one in its Story view, and reads
 * and dismisses the runs on All agents. Two steps have no control on the screen, and the test sends them as
 * commands: the acknowledge of a live run (S5, the screen offers no Dismiss on a live row) and the reclaim of
 * worktrees that are not reclaimable (S8, the screen offers no checkbox on them). The core and the sidecar
 * are the real ones; only the agent is scripted. The doc is `docs/flows/fleet-live-reads.md`.
 */
import fs from "node:fs";
import { expect, type Page } from "@playwright/test";
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

/** The row of one Story's run on All agents: the one whose Story button is `Open Story <key>`. */
const fleetRow = (page: Page, key: string) =>
  page.getByRole("row").filter({ has: page.getByRole("button", { name: `Open Story ${key}`, exact: true }) });

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
  async ({ page, core, open, shot }) => {
    const [alpha, bravo, charlie] = board.stories;
    const fleet = () => core.call<Fleet>("fleet_list");
    const row = async (storyId: string) => (await fleet()).rows.find((r) => r.storyId === storyId);
    const sessionOf = async (storyId: string) => (await core.call<Session[]>("sessions_for_story", { storyId }))[0].id;
    /** The agent has made every commit: the log's tail is full and its last line is the last commit. */
    const fullTail = async (storyId: string) => {
      await expect
        .poll(async () => (await row(storyId))?.activity.lines.at(-1) ?? "", { timeout: 60_000 })
        .toContain(`n${COMMITS}.txt`);
    };
    /**
     * The run is live and its agent has begun: the row has a log line. Only the first Story waits for every
     * commit, because only it proves the cap of the tail. A commit is a few git processes, so on a loaded
     * machine the twenty of each Story took the test past its own limit (120 s) when all three waited.
     */
    const working = async (storyId: string) => {
      await expect
        .poll(
          async () => {
            const found = await row(storyId);
            return found?.runStatus === "running" && found.activity.lines.length > 0;
          },
          { timeout: 60_000 },
        )
        .toBe(true);
    };
    // The developer starts a Story with its Start button on the board, then reads All agents.
    const startAndOpenFleet = async (story: { key?: string }) => {
      await page.getByRole("button", { name: `Start ${story.key}` }).click();
      await page.getByRole("button", { name: "Open fleet" }).click();
    };
    const backToBoard = () => page.getByRole("button", { name: "Back", exact: true }).click();
    const count = page.locator("[data-fleet-count]");
    const rows = page.locator("tr[data-run-id]");

    await open();

    // D-REV-48, S1: the developer starts the first Story. A live run's row carries the end of its log, capped
    // at 16 lines, newest last. The screen shows the newest line only, so the cap is read in the core.
    await startAndOpenFleet(alpha);
    await fullTail(alpha.id);
    const live = (await row(alpha.id))!;
    expect(live.runStatus).toBe("running");
    expect(live.activity.lines).toHaveLength(16);
    expect(live.activity.lines.at(-1)).toContain("fake_commit");
    await expect(count).toHaveText("1 agent");
    await expect(fleetRow(page, alpha.key!).locator("[data-field=state]")).toContainText("Running");
    await expect(fleetRow(page, alpha.key!).locator("[data-field=activity]")).toContainText(`n${COMMITS}.txt`);
    await shot("live-run-tail");

    // A run that dies, and a run that is stopped, both stay on the fleet until they are dismissed. The kill is
    // the test's own act, as a crash is: it is no control of the developer.
    expect(core.killAgents()).toBeGreaterThan(0);
    await expect.poll(async () => (await row(alpha.id))?.runStatus, { timeout: 30_000 }).not.toBe("running");
    const died = (await row(alpha.id))!;
    expect(died.activity.lines).toEqual([]);
    await expect(count).toHaveText("0 agents · 1 ended run");
    await expect(fleetRow(page, alpha.key!).locator("[data-field=state]")).toContainText("Stopped");
    await expect(fleetRow(page, alpha.key!).locator("[data-field=activity]")).toHaveCount(0);
    await expect(fleetRow(page, alpha.key!).getByRole("button", { name: `Dismiss ${alpha.key}` })).toBeVisible();

    // S2-S3: the developer starts the second Story, opens it from its fleet row and stops its run with Stop and
    // its confirmation. This row stays on the fleet too.
    await backToBoard();
    await startAndOpenFleet(bravo);
    await working(bravo.id);
    await expect(fleetRow(page, bravo.key!).locator("[data-field=activity]")).toContainText(/n\d+\.txt/);
    await fleetRow(page, bravo.key!)
      .getByRole("button", { name: `Open Story ${bravo.key}`, exact: true })
      .click();
    await page.getByRole("button", { name: `Stop ${bravo.key}` }).click();
    await page.getByRole("button", { name: "Stop the session" }).click();
    await expect.poll(async () => (await row(bravo.id))?.runStatus, { timeout: 30_000 }).not.toBe("running");
    expect((await row(bravo.id))!.activity.lines).toEqual([]);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(fleetRow(page, bravo.key!).locator("[data-field=state]")).toContainText("Stopped");
    await expect(fleetRow(page, bravo.key!).locator("[data-field=activity]")).toHaveCount(0);

    // S4: the developer starts the third Story. The fleet has three rows, one live and two ended.
    await backToBoard();
    await startAndOpenFleet(charlie);
    await working(charlie.id);
    expect((await fleet()).totalRows).toBe(3);
    await expect(rows).toHaveCount(3);
    await expect(count).toHaveText("1 agent · 2 ended runs");

    // D-REV-49, S5: acknowledging the live run does nothing in the core, and the row stays. The screen has no
    // control for this: a live row offers no Dismiss. So this step is a command, and the screen is read before
    // and after it.
    await expect(fleetRow(page, charlie.key!).getByRole("button", { name: /^Dismiss/ })).toHaveCount(0);
    await core.call("session_acknowledge", { sessionId: await sessionOf(charlie.id) });
    expect((await row(charlie.id))?.runStatus).toBe("running");
    await expect(fleetRow(page, charlie.key!).locator("[data-field=state]")).toContainText("Running");
    await expect(rows).toHaveCount(3);

    // S6-S7: Dismiss on a finished row removes that row, one for each call: the stopped run, then the killed run.
    await fleetRow(page, bravo.key!)
      .getByRole("button", { name: `Dismiss ${bravo.key}` })
      .click();
    await expect(fleetRow(page, bravo.key!)).toHaveCount(0);
    expect(await row(bravo.id)).toBeUndefined();
    expect((await fleet()).totalRows).toBe(2);
    expect(await row(alpha.id)).toBeDefined();
    await expect(fleetRow(page, alpha.key!)).toHaveCount(1);
    await fleetRow(page, alpha.key!)
      .getByRole("button", { name: `Dismiss ${alpha.key}` })
      .click();
    await expect(fleetRow(page, alpha.key!)).toHaveCount(0);
    expect(await row(alpha.id)).toBeUndefined();
    expect((await fleet()).totalRows).toBe(1);
    await expect(rows).toHaveCount(1);
    await expect(count).toHaveText("1 agent");
    await shot("two-runs-dismissed");

    // D-REV-55, the refusals: no Story here is closed, so nothing is reclaimable. The live run's worktree is in
    // use, the others belong to open Stories. The inventory on the screen says so, and it has no checkbox: a
    // worktree that is not reclaimable cannot be selected. So the reclaim (S8) is a command, and the screen is
    // read again after it.
    await backToBoard();
    await page.getByRole("button", { name: "Open worktree inventory" }).click();
    const inventoryRow = (story: { id: string }) => page.locator(`[data-worktree-row="${story.id}"]`);
    await expect(page.locator("[data-worktree-row]")).toHaveCount(3);
    await expect(inventoryRow(charlie)).toContainText("In use");
    await expect(inventoryRow(charlie)).toContainText("agent running");
    await expect(inventoryRow(alpha)).toContainText("Keep");
    await expect(inventoryRow(alpha)).toContainText("Story still open");
    await expect(inventoryRow(bravo)).toContainText("Story still open");
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await shot("worktrees-none-reclaimable");
    const inventory = await core.call<Inventory[]>("worktree_inventory");
    const reason = (id: string) => inventory.find((w) => w.storyId === id)?.reason;
    expect(inventory.find((w) => w.storyId === charlie.id)?.disposition).toBe("in_use");
    expect(reason(charlie.id)).toBe("sessionning");
    expect(reason(alpha.id)).toBe("story_open");
    const paths = await Promise.all(
      [alpha, bravo, charlie].map(
        async (story) => (await core.call<{ path: string }>("worktree_summary", { storyId: story.id })).path,
      ),
    );
    const outcomes = await core.call<{ storyId: string; removed: boolean }[]>("worktree_reclaim", {
      storyIds: [alpha.id, bravo.id, charlie.id],
    });
    expect(outcomes.map((o) => o.removed)).toEqual([false, false, false]);
    for (const path of paths) expect(fs.existsSync(path)).toBe(true);
    expect((await fleet()).totalRows).toBe(1);
    // The screen, read again from a fresh mount: all three worktrees are still listed, in the same words.
    await backToBoard();
    await page.getByRole("button", { name: "Open worktree inventory" }).click();
    await expect(page.locator("[data-worktree-row]")).toHaveCount(3);
    await expect(inventoryRow(charlie)).toContainText("agent running");
  },
);
