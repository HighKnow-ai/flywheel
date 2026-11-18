/**
 * Renaming a project from its menu (issue #1762) as a flow. The developer opens the project's menu in the
 * rail, picks Rename…, types a new name with stray spaces around it, and the new name shows in the rail, in
 * the breadcrumb and in the command palette, while the key prefix and the Story key stay as they were. The
 * name is in the database, so it is still there after the app dies and starts again. The doc is
 * `docs/flows/project-rename.md`.
 */
import { expect, type Page } from "@playwright/test";
import { flow } from "../fixtures";
import { seedReviewBoard, type Board } from "../seed";

let board: Board;

interface ProjectRow {
  id: string;
  name: string;
  keyPrefix: string;
}

/** The names the three surfaces show for the project: the rail row, the breadcrumb and the palette entry. */
async function expectNameShown(page: Page, name: string, gone: string) {
  const rail = page.getByRole("navigation", { name: "Projects" });
  await expect(rail.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(rail.getByRole("button", { name: gone, exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "You are here" })).toContainText(name);
  await page.getByRole("button", { name: /^Search/ }).click();
  const palette = page.getByRole("dialog");
  await expect(palette.getByRole("option", { name: new RegExp(`^${name}`) })).toBeVisible();
  await expect(palette.getByRole("option", { name: new RegExp(`^${gone}`) })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(palette).toHaveCount(0);
}

flow(
  "a project renamed from its menu shows the new name everywhere, keeps its keys and survives a restart",
  {
    doc: "project-rename.md",
    agentScript: [],
    seed: async (core) => {
      board = await seedReviewBoard(core);
    },
  },
  async ({ page, core, open, shot, crashAndRestart }) => {
    await open();
    await expectNameShown(page, "Threadfin", "Flywheel");

    await page.getByRole("button", { name: "Project actions for Threadfin" }).focus();
    await page.keyboard.press("Enter");
    await page.getByRole("menuitem", { name: "Rename…" }).click();
    const dialog = page.getByRole("dialog", { name: "Rename Threadfin" });
    const field = dialog.getByRole("textbox", { name: "Project name" });
    await expect(field).toHaveValue("Threadfin");

    // An empty name cannot be sent, and the key prefix is named as staying.
    const rename = dialog.getByRole("button", { name: "Rename" });
    await field.fill("   ");
    await expect(rename).toBeDisabled();
    await expect(dialog).toContainText("FLY");
    await field.fill("  Flywheel  ");
    await shot("rename-dialog");
    await rename.click();
    await expect(dialog).toHaveCount(0);

    await expectNameShown(page, "Flywheel", "Threadfin");
    await shot("renamed");
    // The Story key is permanent: the Story still reads FLY-1.
    expect(board.storyKey).toMatch(/^FLY-/);
    await expect(page.getByText(board.storyKey!).first()).toBeVisible();

    const [renamed] = await core.call<ProjectRow[]>("project_list");
    expect(renamed).toMatchObject({ id: board.projectId, name: "Flywheel", keyPrefix: "FLY" });

    // The app dies and starts again: the name was written to the database, as an event on the project.
    const second = await crashAndRestart();
    const [after] = await second.call<ProjectRow[]>("project_list");
    expect(after).toMatchObject({ id: board.projectId, name: "Flywheel", keyPrefix: "FLY" });
    await open();
    await expectNameShown(page, "Flywheel", "Threadfin");
  },
);
