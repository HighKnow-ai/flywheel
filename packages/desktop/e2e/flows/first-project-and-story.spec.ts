/**
 * The first minutes of a new developer (issue #1846) as a flow: the app has no project, a project is registered, and
 * the developer writes a Milestone, an Epic and a Story with its criteria and a Check by hand, then adds a second
 * Epic from the Milestone's header. Every other flow starts from a seeded board, so this is the one flow in which
 * `project_register` and `story_write_by_hand` run through the real core from an empty database. The doc is
 * `docs/flows/first-project-and-story.md`.
 *
 * The native folder picker is out of scope (issue #1786): the harness has no native dialog, and the adapter's picker
 * answers `null` there. So the registration is the command the picker's confirm step sends, with the scratch
 * repository's path, and the renderer reads the project list again.
 */
import { expect } from "@playwright/test";
import { flow } from "../fixtures";

interface Row {
  id: string;
  key?: string;
  title?: string;
  state?: string;
}

interface Criterion {
  statement: string;
  accepted: boolean;
  check: { command: string; result: string } | null;
}

flow(
  "a developer with no project registers one, then writes a Milestone, an Epic and a Story by hand",
  {
    doc: "first-project-and-story.md",
    agentScript: [],
    seed: async () => {},
  },
  async ({ page, core, open, shot }) => {
    // The app starts with an empty database: first run, with nothing to pick from.
    await open();
    await expect(page.getByRole("heading", { name: "No projects yet" })).toBeVisible();
    expect(await core.call<Row[]>("project_list")).toEqual([]);
    await shot("first-run");

    // S1: the project is registered, and the renderer reads the list again. The board is the project's, empty.
    const project = await core.call<Row>("project_register", {
      name: "Threadfin",
      repoPath: core.project,
      keyPrefix: "FLY",
    });
    await open();
    await expect(page.getByRole("heading", { name: "No projects yet" })).toHaveCount(0);
    const rail = page.getByRole("navigation", { name: "Projects" });
    await expect(rail.getByRole("button", { name: "Threadfin", exact: true })).toBeVisible();

    // S2-S4: one submit of Write a Story writes the Milestone, the Epic and then the Story, in that order.
    await page.getByRole("button", { name: "Write a Story", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Write a Story" });
    await dialog.getByRole("combobox", { name: /^Milestone/ }).click();
    await page.getByRole("option", { name: "New Milestone…" }).click();
    await dialog.getByLabel("Milestone title").fill("Parse a file");
    await dialog.getByLabel("Exit test").fill("A file with a bad line parses");
    await dialog.getByLabel("Epic title").fill("Parser");
    await dialog.getByLabel("Story title").fill("Read a line");
    await dialog.getByLabel("Criterion 1", { exact: true }).fill("A line is read");
    await dialog.getByLabel("Check command 1").fill("test -f src/parser.rs");
    await dialog.getByRole("button", { name: "Add criterion" }).click();
    await dialog.getByLabel("Criterion 2", { exact: true }).fill("A bad line is named");
    await shot("write-a-story");
    await dialog.getByRole("button", { name: "Write Story" }).click();
    await expect(page.getByText("Wrote FLY-2")).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);

    // The board shows the Story, Ready, with its Epic.
    await expect(
      page.getByRole("list", { name: /Stories$/ }).getByRole("button", { name: "Open Story FLY-2 Read a line" }),
    ).toBeVisible();
    await shot("story-on-the-board");

    // S5: the developer adds a second Epic from the Milestone's header, with the Milestone already chosen.
    await page.getByRole("button", { name: "Add an Epic to Parse a file" }).click();
    const epicDialog = page.getByRole("dialog", { name: "Add an Epic" });
    await epicDialog.getByLabel("Epic title").fill("Reporter");
    await epicDialog.getByRole("button", { name: "Add Epic" }).click();
    await expect(page.getByText("Added FLY-3 Reporter")).toBeVisible();
    await expect(epicDialog).toHaveCount(0);

    // What the core holds, read from it and not from the screen: the keys come in order, the Story is Ready, its
    // two criteria are there, and only the first has a Check, which has not run.
    const [milestone] = await core.call<Row[]>("milestone_list", { projectId: project.id });
    expect(milestone).toMatchObject({ title: "Parse a file", current: true });
    const epics = await core.call<Row[]>("epic_list", { milestoneId: milestone.id });
    expect(epics.map((e) => [e.key, e.title])).toEqual([
      ["FLY-1", "Parser"],
      ["FLY-3", "Reporter"],
    ]);
    const [story] = await core.call<Row[]>("story_list_for_project", { projectId: project.id });
    expect(story).toMatchObject({ key: "FLY-2", title: "Read a line", state: "ready", epicId: epics[0].id });
    const criteria = await core.call<Criterion[]>("criterion_list", { storyId: story.id });
    expect(criteria.map((c) => [c.statement, c.accepted, c.check?.command ?? null, c.check?.result ?? null])).toEqual([
      ["A line is read", false, "test -f src/parser.rs", "not_run"],
      ["A bad line is named", false, null, null],
    ]);
  },
);
