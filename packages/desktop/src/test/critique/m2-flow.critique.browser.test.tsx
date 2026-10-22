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
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { queryClient } from "../../adapters/queryClient";
import type { EpicShapingDto } from "../../adapters/tauri";
import { resetUiState } from "../../state/uiStore";
import App from "../../App";
import { answer, installFixtureBackend, offerAdrsInShaping, setRoadmapRound, setShapingSessionLive } from "./m2-fixture";

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

/**
 * Issue #126: FLY-8 with its Challenge Stage settled: Round 2 answered, no spec change left pending (the
 * rejected one stays struck through), so nothing keeps the Stage open and Close Stage is enabled.
 */
function closableShaping({ closed = false } = {}) {
  mockIPC(
    (cmd, payload) => {
      const base = answer(cmd, payload as Record<string, unknown> | undefined);
      if (closed && cmd === "epic_shaping_session") return null;
      // Every Round is answered, so FLY-8 waits on no one: no lamp, no Needs-you count, no attention pill.
      if (cmd === "fleet_waiting_rounds") return [];
      if (cmd === "board_blocked_summary" && base) {
        const summary = base as { blockedStoryIds: string[]; waitingEpicIds: string[] };
        return { ...summary, waitingEpicIds: [], blockedCount: summary.blockedStoryIds.length };
      }
      if (cmd === "milestone_progress" && base) {
        const progress = base as { epics: { epicId: string; attention: string | null }[] };
        return { ...progress, epics: progress.epics.map((e) => (e.epicId === "e-59" ? { ...e, attention: null } : e)) };
      }
      if (cmd !== "epic_shaping_rounds" || !base) return base;
      const shaping = base as EpicShapingDto;
      // `closed`: Close Stage was clicked, and the Slice Stage is open with no Round yet.
      const stages = closed
        ? [
            { ...shaping.stages[0], state: "closed" },
            { id: "st-2", kind: "slice", state: "open", rank: 2 },
          ]
        : shaping.stages;
      return {
        ...shaping,
        stages,
        rounds: shaping.rounds.map((r) => ({
          ...r,
          state: "answered",
          waitingOnYou: false,
          answeredAt: r.answeredAt ?? r.postedAt,
          questions: r.questions.map((q) => ({
            ...q,
            answer: q.answer ?? q.recommendedAnswer,
            answeredWith: q.answeredWith ?? "recommended",
            answeredAt: q.answeredAt ?? r.postedAt,
          })),
        })),
        proposals: shaping.proposals.filter((p) => p.state !== "pending"),
        openStageStatus: closed
          ? { stageId: "st-2", openItems: [], warnings: ["The Exit test is not written yet"], next: "criteria", closable: true }
          : shaping.openStageStatus && { ...shaping.openStageStatus, openItems: [], closable: true },
      };
    },
    { shouldMockEvents: true },
  );
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
    setShapingSessionLive(true);
    offerAdrsInShaping(false);
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

  it("23 Epic shaping: the Round dock waiting on you beside the Epic card (issue #123)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await screen.findByRole("region", { name: /Round 2/ });
    await shot("23-epic-shaping-round-dock");
  });

  it("24 Epic shaping: answering a question differently (issue #123)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await click("Answer question 3 differently");
    await screen.findByRole("textbox", { name: "Your answer to question 3" });
    await shot("24-epic-shaping-answer-differently");
  });

  it("26 board: an Epic whose shaping session waits on a Round offers Answer (issue #123)", async () => {
    await boardReady();
    const answer = await screen.findByRole("button", { name: "Answer the Round on FLY-8" });
    answer.scrollIntoView({ block: "center" });
    await shot("26-board-epic-answer");
  });

  it("25 Epic shaping at the window's minimum width: the dock first (issue #123)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      await screen.findByRole("region", { name: /Round 2/ });
      await shot("25-epic-shaping-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("27 Epic shaping: spec changes as ghost fields, a rejected one struck through (issue #125)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    const ghost = await screen.findByRole("group", { name: "Proposed Scope" });
    ghost.scrollIntoView({ block: "start" });
    await shot("27-epic-shaping-ghost-fields");
  });

  it("28 Epic shaping: amending a proposed spec change (issue #125)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await click("Amend the proposed Exit test");
    const field = await screen.findByRole("textbox", { name: "Your Exit test" });
    field.closest("[role=group]")?.scrollIntoView({ block: "center" });
    await shot("28-epic-shaping-amend");
  });

  it("29 Epic shaping: rejecting a proposed spec change with a reason (issue #125)", async () => {
    await boardReady();
    await click("Answer the Round on FLY-8");
    await click("Reject the proposed Scope");
    const reason = await screen.findByRole("textbox", { name: "Why not? (optional)" });
    await userEvent.type(reason, "Accept all is out of this Epic");
    reason.closest("[role=group]")?.scrollIntoView({ block: "center" });
    await shot("29-epic-shaping-reject-reason");
  });

  it("30 Epic shaping at the window's minimum width: rejecting a ghost field (issue #125)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      await click("Reject the proposed Scope");
      const reason = await screen.findByRole("textbox", { name: "Why not? (optional)" });
      await userEvent.type(reason, "Accept all is out of this Epic");
      reason.closest("[role=group]")?.scrollIntoView({ block: "center" });
      await shot("30-epic-shaping-ghost-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("31 board: a killed shaping session leaves Shaping Round waiting and Continue shaping (issue #124)", async () => {
    setShapingSessionLive(false);
    await boardReady();
    const resume = await screen.findByRole("button", { name: "Continue shaping FLY-8 Epic shaping" });
    resume.scrollIntoView({ block: "center" });
    await shot("31-board-epic-continue-shaping");
  });

  it("32 Epic shaping: the open Round with no live session keeps its answers, Continue shaping on its band (issue #124)", async () => {
    setShapingSessionLive(false);
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByRole("region", { name: /Round 2/ });
    await shot("32-epic-shaping-continue");
  });

  it("33 Epic shaping: an ADR offered as a question, the draft beside its bar lines (issue #129)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const adr = await screen.findByRole("group", { name: "Question 5: Record the Stage close" });
    adr.scrollIntoView({ block: "center" });
    await shot("33-epic-shaping-adr-question");
  });

  it("34 Epic shaping: the Epic card's ADR and glossary chips (issue #129)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const chips = await screen.findByRole("list", { name: "ADRs and glossary" });
    chips.closest("section")?.scrollIntoView({ block: "start" });
    await shot("34-epic-shaping-adr-chips");
  });

  it("36 Epic shaping: an ADR answered Yes folds to a settled line (issue #129)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const folded = await screen.findByRole("group", { name: "Question 3: Record the shaping record" });
    folded.scrollIntoView({ block: "center" });
    await shot("36-epic-shaping-adr-answered");
  });

  it("37 Epic shaping: only the ADR is left, Accept all is off and says why (issue #129)", async () => {
    offerAdrsInShaping(true, true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    const adr = await screen.findByRole("group", { name: "Question 5: Record the Stage close" });
    await screen.findByText("Only the ADR is left: answer it Yes or No.");
    adr.scrollIntoView({ block: "end" });
    await shot("37-epic-shaping-adr-only-left");
  });

  it("35 Epic shaping at the window's minimum width: an ADR question (issue #129)", async () => {
    offerAdrsInShaping(true);
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      const adr = await screen.findByRole("group", { name: "Question 5: Record the Stage close" });
      adr.scrollIntoView({ block: "start" });
      await shot("35-epic-shaping-adr-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("38 Epic shaping: the Stage bar lists what keeps the Stage open (issue #126)", async () => {
    offerAdrsInShaping(true);
    await boardReady();
    await click("Answer the Round on FLY-8");
    await screen.findByRole("list", { name: "Still open" });
    await shot("38-epic-shaping-stage-bar-open");
  });

  it("39 Epic shaping: nothing open, Close Stage is the next action (issue #126)", async () => {
    offerAdrsInShaping(true);
    closableShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByText(/Nothing in Challenge the spec is open/);
    await shot("39-epic-shaping-stage-closable");
  });

  it("40 Epic shaping: confirming Close Stage (issue #126)", async () => {
    offerAdrsInShaping(true);
    closableShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click("Close Stage");
    await screen.findByRole("alertdialog");
    await shot("40-epic-shaping-close-stage-confirm");
  });

  it("42 Epic shaping: the Slice Stage just opened, the Challenge Rounds below it (issue #126)", async () => {
    offerAdrsInShaping(true);
    closableShaping({ closed: true });
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByRole("heading", { name: "No Round yet in Slice into Stories" });
    await shot("42-epic-shaping-slice-opened");
  });

  it("41 Epic shaping at the window's minimum width: the Stage bar with open items (issue #126)", async () => {
    offerAdrsInShaping(true);
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on FLY-8");
      await screen.findByRole("list", { name: "Still open" });
      await shot("41-epic-shaping-stage-bar-min-width");
  async function roadmapStrip() {
    const strip = await screen.findByRole("region", { name: "Roadmap" });
    strip.scrollIntoView({ block: "start" });
    return strip;
  }

  it("43 Roadmap strip: Revisit roadmap, and the last Round said the Roadmap still holds (issue #133)", async () => {
    setRoadmapRound("holds");
    await boardReady();
    await screen.findByText("Roadmap still holds");
    await roadmapStrip();
    await shot("43-roadmap-revisit-holds");
  });

  it("44 Roadmap strip: the roadmap Round is reading the Roadmap (issue #133)", async () => {
    setRoadmapRound("working");
    await boardReady();
    await screen.findByText("The agent is reading the Roadmap");
    await roadmapStrip();
    await shot("44-roadmap-round-reading");
  });

  it("45 Roadmap strip: Waiting on you, three ghost rows and a rejected change (issue #133)", async () => {
    setRoadmapRound("waiting");
    await boardReady();
    await screen.findByRole("group", { name: /^Proposed: New Milestone "Relay and mobile"/ });
    await roadmapStrip();
    await shot("45-roadmap-ghost-rows");
  });

  it("46 Roadmap strip: Amend a proposed Milestone in place (issue #133)", async () => {
    setRoadmapRound("waiting");
    await boardReady();
    await click(/^Amend: New Milestone "Relay and mobile"/);
    await screen.findByRole("textbox", { name: "Outcome" });
    await roadmapStrip();
    await shot("46-roadmap-ghost-amend");
  });

  it("47 Roadmap strip: an open roadmap Round with no live session, Continue and Dismiss (issue #133)", async () => {
    setRoadmapRound("idle");
    await boardReady();
    await screen.findByText("No live session: your decisions are kept");
    await click("Dismiss Roadmap Round 2, changing nothing");
    await screen.findByText(/Dismissing rejects the 3 undecided changes/);
    await roadmapStrip();
    await shot("47-roadmap-round-dismiss");
  });

  it("48 Waiting on you queue: a roadmap Round beside an Epic's Round (issue #133)", async () => {
    setRoadmapRound("waiting");
    await boardReady();
    await click(/^Open Waiting on you/);
    const item = await screen.findByRole("listitem", { name: "Roadmap Round 2 of the flywheel Roadmap" });
    item.scrollIntoView({ block: "center" });
    await shot("48-queue-roadmap-round");
  });

  it("49 Roadmap strip at the window's minimum width: ghost rows (issue #133)", async () => {
    setRoadmapRound("waiting");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await screen.findByRole("group", { name: /^Proposed: New Milestone "Relay and mobile"/ });
      await roadmapStrip();
      await shot("49-roadmap-ghost-rows-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("16 navigation: picking a project while the fleet is open", async () => {
    await boardReady();
    await click("Open fleet");
    await settle();
    await click("highknow-web");
    await shot("16-nav-project-click-keeps-fleet");
  });
});
