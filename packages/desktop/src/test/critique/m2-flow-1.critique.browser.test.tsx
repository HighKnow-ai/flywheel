/// <reference types="vite/client" />
/**
 * Part 1 of 6 of the Milestone 2 to 4 walk (issues #102, #192): 17 screens, each rendered, clicked to and
 * checked for layout defects at four window sizes. The steps the parts share, and why the walk is 6 files, are
 * in `m2-walk.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm).
 */
import { afterAll, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { page } from "vitest/browser";
import { CRITIQUE_RUN, settle, writeDefectReport } from "./capture";
import { boardReady, click, openStory, registerHooks, shot } from "./m2-walk";

describe.runIf(CRITIQUE_RUN)("M2 to M4 flow screens (part 1 of 6)", () => {
  afterAll(() => writeDefectReport("m2-flow-1"));
  registerHooks();

  it("01 project board", async () => {
    await boardReady();
    await shot("01-board");
  });

  it("02 write a Story form", async () => {
    await boardReady();
    await click("Write a Story");
    await screen.findByRole("dialog");
    await shot("02-board-write-story");
  });

  it("03 Story Tasks with a note open", async () => {
    await boardReady();
    await openStory("FLY-4", "Make clicking and navigation predictable");
    await click(/Show note of Make Waiting on you/);
    await shot("03-story-tasks");
  });

  it("04 Story sessions of a Stopped Story", async () => {
    await boardReady();
    await openStory("FLY-7", "Restyle every screen of the M2 flow in the new world");
    await screen.findByRole("list", { name: "Sessions of FLY-7" });
    await shot("04-story-stopped-sessions");
  });

  it("05 Resume a Stopped Story", async () => {
    await boardReady();
    await click("Resume FLY-7");
    await screen.findByRole("dialog");
    await shot("05-story-resume");
  });

  it("06 Drop confirmation", async () => {
    await boardReady();
    await openStory("FLY-9", "Answer a shaping Round in the dock");
    await click("Drop FLY-9");
    await screen.findByRole("alertdialog");
    await shot("06-story-drop-confirm");
  });

  it("07 session feed, running", async () => {
    await boardReady();
    await click(/Open FLY-4 Make clicking/);
    await screen.findByText(/Store tests pass/);
    await shot("07-feed-running");
  });

  it("08 session feed, a call expanded", async () => {
    await boardReady();
    await click(/Open FLY-4 Make clicking/);
    await click(/Ran · npm --prefix packages\/desktop test -- keyboard/);
    await shot("08-feed-call-expanded");
  });

  it("09 session feed, Gated action", async () => {
    await boardReady();
    await click(/Open FLY-5 Build/);
    await waitFor(() => screen.getByText(/This would push/));
    await shot("09-feed-gated-action");
  });

  it("10 session feed, agent's question", async () => {
    await boardReady();
    await click(/Open FLY-6 Show project progress/);
    await screen.findAllByText(/Should Dropped Stories count/);
    await shot("10-feed-question");
  });

  it("11 session feed, permission request", async () => {
    await boardReady();
    await click(/Open HKW-2 Store waitlist/);
    await screen.findAllByText(/pnpm db:migrate --env local/);
    await shot("11-feed-permission-request");
  });

  it("12 session feed, handed off (In review)", async () => {
    await boardReady();
    await openStory("FLY-3", "Pick Flywheel's new visual world from three rendered directions");
    await click("Open feed of session ses-3a");
    await screen.findByText(/Rendering the three directions/);
    // Issue #110: a finished session says how it ended and offers no Stop.
    expect((await screen.findByTestId("session-ending")).textContent).toMatch(/· handed off$/);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    await shot("12-feed-handed-off");
  });

  it("13 Waiting on you queue", async () => {
    await boardReady();
    await click(/^Open Waiting on you/);
    await settle(900);
    await shot("13-waiting-on-you-queue");
  });

  it("14 fleet, all agents", async () => {
    await boardReady();
    await click("Open fleet");
    await settle(900);
    await shot("14-fleet");
  });

  it("15 navigation: picking a project while a feed is open", async () => {
    await boardReady();
    await click(/Open FLY-4 Make clicking/);
    await screen.findByText(/Store tests pass/);
    await click("highknow-web");
    await shot("15-nav-project-click-keeps-feed");
  });

  it("17 project board at the window's minimum width (Milestone header, issue #106)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await screen.findByRole("list", { name: "Stories by state" });
      await shot("17-board-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("18 Story waiting on you: the agent station with Answer, Stop and its live tail (issue #118)", async () => {
    await boardReady();
    await openStory("FLY-6", "Show project progress at a glance on the board");
    await screen.findByRole("list", { name: "Last tool calls" });
    await shot("18-story-station-waiting");
  });
});
