/// <reference types="vite/client" />
/**
 * Screenshots of every screen of the M2 flow, for the design critique (issue #102).
 *
 * Renders the real `<App />` in WebKit (the engine closest to the shipped WKWebView) over the seeded
 * fake backend in `m2-fixture.ts`, walks the M2 flow by clicking the real controls, and writes one PNG
 * per screen into the git-ignored `target/critique-2026-10/` at the repo root (the committed copies in
 * `docs/design/critique-2026-10/` are those PNGs converted with `cwebp -q 78`). It asserts nothing about
 * the design: it exists so the screens can be looked at, and re-shot after the redesign to compare.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm, so that arm
 * never overwrites the screenshots):
 *
 *   CRITIQUE_SCHEME=light npx vitest run --config vitest.critique.config.ts src/test/critique
 *   CRITIQUE_SCHEME=dark  npx vitest run --config vitest.critique.config.ts src/test/critique
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { clearMocks } from "@tauri-apps/api/mocks";
import { queryClient } from "../../adapters/queryClient";
import { resetUiState } from "../../state/uiStore";
import App from "../../App";
import { installFixtureBackend } from "./m2-fixture";

const SCHEME = import.meta.env.VITE_CRITIQUE_SCHEME as string | undefined;
const OUT = "../../../../../target/critique-2026-10";

async function settle(ms = 600) {
  await new Promise((resolve) => setTimeout(resolve, ms));
  await document.fonts.ready;
}

async function shot(name: string) {
  await settle();
  await page.screenshot({ path: `${OUT}/${name}-${SCHEME}.png` });
}

async function boardReady() {
  // The shipped page mounts into `#root`, which App.css sizes to the window; render into the same node.
  const root = document.getElementById("root") ?? document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
  await settle();
}

async function click(label: string | RegExp) {
  await userEvent.click(await screen.findByRole("button", { name: label }));
}

async function openStory(key: string, title: string | RegExp) {
  await userEvent.click(await screen.findByRole("button", { name: new RegExp(`^Open Story ${key} ${typeof title === "string" ? title : title.source}$`) }));
}

describe.runIf(Boolean(SCHEME))("M2 flow screens", () => {
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    installFixtureBackend();
  });
  afterEach(() => {
    cleanup();
    clearMocks();
  });

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
    await screen.findByText(/Ended: handed off/);
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
    await shot("12-feed-handed-off");
  });

  it("13 Waiting on you queue", async () => {
    await boardReady();
    await click(/Open Waiting on you/);
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

  it("19 Stop confirmation from the agent station (issue #118)", async () => {
    await boardReady();
    await openStory("FLY-4", "Make clicking and navigation predictable");
    await click("Stop FLY-4");
    await screen.findByRole("alertdialog");
    await shot("19-story-stop-confirm");
  });

  it("20 Roadmap strip: another Milestone picked switches the header and roster (issue #131)", async () => {
    await boardReady();
    await click(/^Board and review, Shaping/);
    await screen.findByRole("region", { name: "Board and review" });
    await shot("20-roadmap-other-milestone");
  });

  it("21 Roadmap strip: + Milestone takes a one-line outcome (issue #131)", async () => {
    await boardReady();
    await click("Add a Milestone");
    await userEvent.type(await screen.findByRole("textbox", { name: "New Milestone's outcome" }), "Relay: the board on a phone");
    await shot("21-roadmap-add-milestone");
  });

  it("22 Roadmap strip: dragging a Milestone shows where it lands (issue #131)", async () => {
    await boardReady();
    const row = (title: string) =>
      document.querySelector<HTMLElement>(`[data-milestone-title="${title}"]`) as HTMLElement;
    const transfer = new DataTransfer();
    row("One-week exit test").dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
    await settle(100);
    row("Board and review").dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    await screen.findByText("One-week exit test");
    await shot("22-roadmap-dragging");
    row("One-week exit test").dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: transfer }));
  });

  it("16 navigation: picking a project while the fleet is open", async () => {
    await boardReady();
    await click("Open fleet");
    await settle();
    await click("highknow-web");
    await shot("16-nav-project-click-keeps-fleet");
  });
});
