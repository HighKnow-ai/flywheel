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
import { afterEach, beforeEach, describe, it } from "vitest";
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
  await screen.findByText("Make clicking and navigation predictable");
  await settle();
}

async function click(label: string | RegExp) {
  await userEvent.click(await screen.findByRole("button", { name: label }));
}

function scrollBoard(to: "top" | "bottom") {
  const scroller = document.querySelector(".board-shell > div") as HTMLElement | null;
  if (scroller) scroller.scrollTop = to === "top" ? 0 : scroller.scrollHeight;
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
    scrollBoard("bottom");
    await shot("02-board-write-story");
  });

  it("03 Story Tasks with a note open", async () => {
    await boardReady();
    await click("Tasks of FLY-4");
    await click(/Show note of Make Waiting on you/);
    await shot("03-story-tasks");
  });

  it("04 Story sessions of a Stopped Story", async () => {
    await boardReady();
    await click("Sessions of FLY-7");
    await click("Tasks of FLY-7");
    await shot("04-story-stopped-sessions");
  });

  it("05 Resume a Stopped Story", async () => {
    await boardReady();
    await click("Resume FLY-7");
    await shot("05-story-resume");
  });

  it("06 Drop confirmation", async () => {
    await boardReady();
    await click("Drop FLY-9");
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
    await userEvent.click(await screen.findByText(/Bash · npm --prefix packages\/desktop test -- keyboard/));
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
    await click("Sessions of FLY-3");
    await click("Open feed of session ses-3a");
    await screen.findByText(/Rendering the three directions/);
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

  it("16 navigation: picking a project while the fleet is open", async () => {
    await boardReady();
    await click("Open fleet");
    await settle();
    await click("highknow-web");
    await shot("16-nav-project-click-keeps-fleet");
  });
});
