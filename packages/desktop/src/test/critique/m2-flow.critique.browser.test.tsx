/// <reference types="vite/client" />
/**
 * Every screen of the Milestone 2 to 4 walk, for the design critique (issues #102, #192).
 *
 * Renders the real `<App />` in WebKit (the engine closest to the shipped WKWebView) over the seeded
 * fake backend in `m2-fixture.ts`, walks the flow by clicking the real controls, and at each screen calls
 * `capture()` (`capture.ts`): the screen at 900 × 600, 1280 × 800, 1440 × 900 and 1920 × 1200, each run through
 * the layout-defect check and, in the critique run, shot into the git-ignored `target/critique-2026-10-m4/`.
 * A screen whose name ends in `-min-width` is a state the walk reaches at the window's minimum width (a Sheet
 * that only opens there), so it is captured at 900 × 600 only. The stress data, the screens outside this walk and
 * the error and empty states are in `stress.critique.browser.test.tsx`.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm):
 *
 *   npm run test:critique          # both schemes, with screenshots
 *   npm run test:layout-defects    # light, the defect check only (CI)
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { page, userEvent } from "vitest/browser";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { queryClient } from "../../adapters/queryClient";
import type { EpicShapingDto } from "../../adapters/tauri";
import { resetUiState } from "../../state/uiStore";
import { useTriageDrawer } from "../../proposals/triageStore";
import App from "../../App";
import {
  answer,
  installFixtureBackend,
  offerAdrsInShaping,
  setMakeReadyInFixture,
  setReviewInFixture,
  setNeedsYouExtras,
  setJudgedOnInFixture,
  setRoadmapRound,
  setShapingSessionLive,
  setTriageInFixture,
  setTriageDuplicateInFixture,
  shapeMilestoneInFixture,
} from "./m2-fixture";
import { capture, CRITIQUE_RUN, settle, writeDefectReport } from "./capture";

async function shot(name: string) {
  await settle();
  await capture(name, name.endsWith("-min-width") ? { sizes: [{ width: 900, height: 600 }] } : {});
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

/**
 * Issue #127: FLY-8 in its Slice Stage. Two Stories are on the Epic, FLY-10 running after FLY-9; the agent has
 * proposed two more, the first after FLY-10 and the second after the first, and a move of FLY-12; one New Story
 * was rejected. The Challenge Rounds are answered.
 */
function slicingShaping() {
  closableShaping({ closed: true });
  const story = (id: string, key: string, title: string, rank: string, description: string, runsAfter: [string, string] | null = null) => ({
    id, projectId: "p-fly", epicId: "e-59", key, title, description, state: "shaping", rank,
    runsAfterStoryId: runsAfter?.[0] ?? null, runsAfterReason: runsAfter?.[1] ?? null,
  });
  const proposal = (id: string, verb: string, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id, projectId: "p-fly", sessionId: "ses-shape-8", epicId: "e-59", verb, targetType: "story", targetId: null, payload,
    rationale: null, state: "pending", createdAt: new Date().toISOString(), rejectionReason: null, stageId: "st-2", roundId: null,
    ...extra,
  });
  const newStory = (id: string, title: string, rank: string, description: string, after: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) =>
    proposal(id, "create", { title, description, rank, runs_after_story_id: null, runs_after_proposal_id: null, runs_after_reason: null, ...after }, extra);
  const stories = [
    story("s-9", "FLY-9", "Answer a shaping Round in the dock", "a0", "The dock beside the Epic card: numbered questions with a pre-filled recommended answer, Accept, Answer differently and Accept all recommended. Tested in round-dock.test.tsx."),
    story("s-10", "FLY-10", "Show Proposals in shaping as ghost cards", "a1", "A spec change the agent proposes shows under the field it would rewrite, decided there with Accept, Amend or Reject.", ["s-9", "the ghost card answers from the dock's Round"]),
    story("s-12", "FLY-12", "Resume a killed shaping session at the open Round", "a2", "A fresh session rebuilt from the board picks the open Round up with round_wait; no answer is lost."),
  ];
  const proposals = [
    newStory("pr-s1", "Slice an Epic into Stories as ghost columns", "a3", "propose_story and propose_story_order; accepting creates the Story in Shaping at its rank with its runs-after marker. Tested in proposal_apply.rs and story-columns.test.tsx.", { runs_after_story_id: "s-10", runs_after_reason: "reuses GhostCard.tsx's decisions" }),
    newStory("pr-s2", "Write the criteria and close the Epic to Ready", "a4", "The criteria Stage: one accepted criterion per Story with its Check, then closing the last Stage makes every Story Ready.", { runs_after_proposal_id: "pr-s1", runs_after_reason: "criteria stack under the Story columns" }),
    proposal("pr-m1", "reorder", { rank: "a35" }, { targetId: "s-12", rationale: "Resuming needs the slicing tools in the packet first" }),
    newStory("pr-s0", "Prototype the dock as a modal sheet", "a5", "", {}, { state: "rejected", rejectionReason: "The dock stays beside the Epic card" }),
  ];
  mockIPC(
    (cmd, payload) => {
      if (cmd === "epic_shaping_rounds") {
        const base = answer(cmd, payload as Record<string, unknown> | undefined) as EpicShapingDto | null;
        if (!base) return base;
        const stages = [
          { ...base.stages[0], state: "closed" },
          { id: "st-2", kind: "slice", state: "open", rank: 2 },
        ];
        const openItems = [
          { kind: "proposal", id: "pr-s1", label: "", round: null, number: null, title: "add the Story “Slice an Epic into Stories as ghost columns”" },
          { kind: "proposal", id: "pr-s2", label: "", round: null, number: null, title: "add the Story “Write the criteria and close the Epic to Ready”" },
          { kind: "proposal", id: "pr-m1", label: "", round: null, number: null, title: "move FLY-12 “Resume a killed shaping session at the open Round” in the order" },
        ];
        return {
          ...base,
          stages,
          rounds: base.rounds.map((r) => ({
            ...r,
            state: "answered",
            waitingOnYou: false,
            answeredAt: r.answeredAt ?? r.postedAt,
            questions: r.questions.map((q) => ({ ...q, answer: q.answer ?? q.recommendedAnswer, answeredWith: q.answeredWith ?? "recommended", answeredAt: q.answeredAt ?? r.postedAt })),
          })),
          proposals: [...base.proposals.filter((p) => p.state !== "pending"), ...proposals],
          stories,
          openStageStatus: { stageId: "st-2", openItems, warnings: ["The Exit test is not written yet"], next: "criteria", closable: false },
        };
      }
      // Everything else as in the closed-Challenge fixture: FLY-8 waits on no one.
      const base = answer(cmd, payload as Record<string, unknown> | undefined);
      if (cmd === "epic_shaping_session") return null;
      if (cmd === "fleet_waiting_rounds") return [];
      if (cmd === "board_blocked_summary" && base) {
        const summary = base as { blockedStoryIds: string[]; waitingEpicIds: string[] };
        return { ...summary, waitingEpicIds: [], blockedCount: summary.blockedStoryIds.length };
      }
      if (cmd === "milestone_progress" && base) {
        const progress = base as { epics: { epicId: string; attention: string | null }[] };
        return { ...progress, epics: progress.epics.map((e) => (e.epicId === "e-59" ? { ...e, attention: null } : e)) };
      }
      return base;
    },
    { shouldMockEvents: true },
  );
}

/**
 * Issue #128: FLY-8 in its last Stage, Write the Acceptance criteria, with Challenge and Slice closed. FLY-9 has two
 * criteria (one with a Check, one judged at review); FLY-10 and FLY-12 have none yet, each with a pending criterion
 * Proposal under it, FLY-13 has neither, and a rejected one sits under the columns. `closable` gives every Story its
 * criteria and leaves nothing pending, so closing the Stage makes the Epic and its Stories Ready.
 */
function criteriaShaping({ closable = false } = {}) {
  closableShaping({ closed: true });
  const story = (id: string, key: string, title: string, rank: string, description: string, runsAfter: [string, string] | null = null) => ({
    id, projectId: "p-fly", epicId: "e-59", key, title, description, state: "shaping", rank,
    runsAfterStoryId: runsAfter?.[0] ?? null, runsAfterReason: runsAfter?.[1] ?? null,
  });
  const stories = [
    story("s-9", "FLY-9", "Answer a shaping Round in the dock", "a0", "The dock beside the Epic card: numbered questions with a pre-filled recommended answer, Accept, Answer differently and Accept all recommended."),
    story("s-10", "FLY-10", "Show Proposals in shaping as ghost cards", "a1", "A spec change the agent proposes shows under the field it would rewrite, decided there.", ["s-9", "the ghost card answers from the dock's Round"]),
    story("s-12", "FLY-12", "Resume a killed shaping session at the open Round", "a2", "A fresh session rebuilt from the board picks the open Round up with round_wait."),
    story("s-13", "FLY-13", "Close the Epic to Ready", "a3", "Closing the criteria Stage makes every Story in Shaping and the Epic Ready."),
  ];
  // Once the close lands (screen 68), every Stage is closed and the Epic and its Stories are Ready.
  let closedNow = false;
  const check = (id: string, command: string) => ({ id, command, timeoutSecs: 600, result: "not_run", commitSha: null, stale: false, outputTail: null });
  const criterion = (id: string, storyId: string, statement: string, command: string | null, rank: string) => ({
    id, storyId, statement, accepted: false, acceptedAt: null, rank, check: command ? check(`k-${id}`, command) : null,
  });
  const criteria: Record<string, ReturnType<typeof criterion>[]> = {
    "s-9": [
      criterion("c-9a", "s-9", "Accept all recommended answers every open question at once", "npm test -- round-dock", "a"),
      criterion("c-9b", "s-9", "A recommended answer reads as already filled in, never as a placeholder", null, "b"),
    ],
    "s-10": closable ? [criterion("c-10a", "s-10", "A pending spec change shows under the field it would rewrite", "npm test -- ghost-card", "a")] : [],
    "s-12": closable ? [criterion("c-12a", "s-12", "A killed session's successor picks the open Round up with no answer lost", "cargo test -p core --test shaping_resume", "a")] : [],
    "s-13": closable ? [criterion("c-13a", "s-13", "Closing the criteria Stage makes the Epic and its Stories Ready at once", "cargo test -p core --test stage_close", "a")] : [],
  };
  const proposal = (id: string, storyId: string, statement: string, command: string | null, extra: Record<string, unknown> = {}) => ({
    id, projectId: "p-fly", sessionId: "ses-shape-8", epicId: "e-59", verb: "create", targetType: "criterion", targetId: null,
    payload: { story_id: storyId, statement, ...(command ? { check_command: command } : {}) },
    rationale: null, state: "pending", createdAt: new Date().toISOString(), rejectionReason: null, stageId: "st-3", roundId: null,
    ...extra,
  });
  const proposals = closable
    ? []
    : [
        proposal("pc-10", "s-10", "A pending spec change shows under the field it would rewrite, decided there", "npm test -- ghost-card"),
        proposal("pc-12", "s-12", "A killed session's successor picks the open Round up with no answer lost", null),
        proposal("pc-x", "s-9", "The dock feels calm", null, { state: "rejected", rejectionReason: "Not observable: name what calm looks like" }),
      ];
  const openItems = closable
    ? []
    : [
        { kind: "proposal", id: "pc-10", label: "", round: null, number: null, title: "add the criterion “A pending spec change shows under the field it would rewrite, decided there” to FLY-10" },
        { kind: "proposal", id: "pc-12", label: "", round: null, number: null, title: "add the criterion “A killed session's successor picks the open Round up with no answer lost” to FLY-12" },
        // FLY-10 and FLY-12 are named through their Proposals; FLY-13 has neither a criterion nor a Proposal.
        { kind: "story_without_criterion", id: "s-13", label: "", round: null, number: null, title: "Close the Epic to Ready", storyKey: "FLY-13" },
      ];
  mockIPC(
    (cmd, payload) => {
      if (cmd === "stage_close") {
        closedNow = true;
        return { closedStageId: "st-3", opened: null, madeReady: stories.map((s) => s.id), session: null, launchError: null, sidecarWarning: null };
      }
      if (cmd === "epic_shaping_rounds") {
        const base = answer(cmd, payload as Record<string, unknown> | undefined) as EpicShapingDto | null;
        if (!base) return base;
        return {
          ...base,
          ...(closedNow ? { epic: { ...base.epic, state: "ready" } } : {}),
          stages: [
            { ...base.stages[0], state: "closed" },
            { id: "st-2", kind: "slice", state: "closed", rank: 2 },
            { id: "st-3", kind: "criteria", state: closedNow ? "closed" : "open", rank: 3 },
          ],
          rounds: base.rounds.map((r) => ({
            ...r,
            state: "answered",
            waitingOnYou: false,
            answeredAt: r.answeredAt ?? r.postedAt,
            questions: r.questions.map((q) => ({ ...q, answer: q.answer ?? q.recommendedAnswer, answeredWith: q.answeredWith ?? "recommended", answeredAt: q.answeredAt ?? r.postedAt })),
          })),
          proposals: [...base.proposals.filter((p) => p.state !== "pending"), ...proposals],
          stories: closedNow ? stories.map((s) => ({ ...s, state: "ready" })) : stories,
          openStageStatus: closedNow
            ? null
            : { stageId: "st-3", openItems, warnings: ["The Exit test is not written yet"], next: null, makesReady: true, closable },
        };
      }
      if (cmd === "criterion_list") return criteria[(payload as { storyId: string }).storyId] ?? [];
      const base = answer(cmd, payload as Record<string, unknown> | undefined);
      if (cmd === "epic_shaping_session") return null;
      if (cmd === "fleet_waiting_rounds") return [];
      if (cmd === "board_blocked_summary" && base) {
        const summary = base as { blockedStoryIds: string[]; waitingEpicIds: string[] };
        return { ...summary, waitingEpicIds: [], blockedCount: summary.blockedStoryIds.length };
      }
      if (cmd === "milestone_progress" && base) {
        const progress = base as { epics: { epicId: string; attention: string | null }[] };
        return { ...progress, epics: progress.epics.map((e) => (e.epicId === "e-59" ? { ...e, attention: null } : e)) };
      }
      return base;
    },
    { shouldMockEvents: true },
  );
}

async function storyColumnsInView() {
  const heading = await screen.findByRole("heading", { name: "Stories" });
  heading.scrollIntoView({ block: "start" });
}

// The first match: since Needs you (#156) a Story's controls show both in its card and on its roster row,
// and either is the same control.
async function click(label: string | RegExp) {
  await userEvent.click((await screen.findAllByRole("button", { name: label }))[0]);
}

async function openStory(key: string, title: string | RegExp) {
  await userEvent.click((await screen.findAllByRole("button", { name: new RegExp(`^Open Story ${key} ${typeof title === "string" ? title : title.source}$`) }))[0]);
}

describe.runIf(CRITIQUE_RUN)("M2 to M4 flow screens", () => {
  afterAll(() => writeDefectReport("m2-flow"));
  beforeEach(() => {
    resetUiState();
    queryClient.clear();
    setShapingSessionLive(true);
    offerAdrsInShaping(false);
    setReviewInFixture("judging");
    setMakeReadyInFixture(false);
    // The triage drawer's store outlives a test; a drawer left open by one would cover the next screen.
    useTriageDrawer.getState().closeTriage();
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
    expect(await screen.findByTestId("session-ending")).toHaveTextContent(/· handed off$/);
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
    // The Epic card's own control: Needs you beside the roster (#156) offers Continue shaping too.
    const resume = (await screen.findAllByRole("button", { name: "Continue shaping FLY-8 Epic shaping" })).find((b) =>
      b.closest("section[aria-labelledby^='epic-']"),
    );
    resume?.scrollIntoView({ block: "center" });
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
    } finally {
      await page.viewport(1440, 900);
    }
  });

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
    await click("Dismiss Roadmap Round 2, rejecting 3 undecided changes");
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

  it("53 board: a Milestone in Shaping offers Shape on its strip row and in its header (issue #132)", async () => {
    await boardReady();
    await userEvent.click(await screen.findByRole("button", { name: /^Board and review, Shaping/ }));
    await screen.findByRole("heading", { name: "Board and review" });
    await shot("53-board-milestone-shape");
  });

  it("54 Milestone shaping: Round 1 of Exit test waiting on you beside the exit test and its ghost (issue #132)", async () => {
    shapeMilestoneInFixture("waiting");
    await boardReady();
    await click("Answer the Round on Board and review");
    await screen.findByRole("group", { name: "Proposed Exit test" });
    await shot("54-milestone-shaping-waiting");
  });

  it("55 Milestone shaping: nothing open, closing Exit test makes the Milestone Ready (issue #132)", async () => {
    shapeMilestoneInFixture("closable");
    await boardReady();
    await userEvent.click(await screen.findByRole("button", { name: /^Board and review, Shaping/ }));
    await click("Open the exit test of Board and review and its Rounds");
    await screen.findByText(/makes the Milestone Ready/);
    await shot("55-milestone-shaping-closable");
  });

  it("56 Milestone shaping: confirming Close Stage on Exit test (issue #132)", async () => {
    shapeMilestoneInFixture("closable");
    await boardReady();
    await userEvent.click(await screen.findByRole("button", { name: /^Board and review, Shaping/ }));
    await click("Open the exit test of Board and review and its Rounds");
    await click("Close Stage");
    await screen.findByRole("alertdialog");
    await shot("56-milestone-shaping-close-confirm");
  });

  it("57 Milestone shaping at the window's minimum width (issue #132)", async () => {
    shapeMilestoneInFixture("waiting");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Answer the Round on Board and review");
      await screen.findByRole("group", { name: "Proposed Exit test" });
      await shot("57-milestone-shaping-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("69 Milestone shaping: the exit test edited by hand, its pending ghost still under it (issue #149)", async () => {
    shapeMilestoneInFixture("waiting");
    await boardReady();
    await click("Answer the Round on Board and review");
    await screen.findByRole("group", { name: "Proposed Exit test" });
    await click("Edit Exit test");
    await screen.findByRole("textbox", { name: "Exit test" });
    await shot("69-milestone-shaping-edit-exit-test");
  });

  it("70 project board: Since you last looked, unfolded above the roster (issue #167)", async () => {
    await boardReady();
    await click(/7 events since you last looked/);
    await screen.findByRole("list", { name: "Since you last looked" });
    await shot("70-since-you-last-looked");
  });

  it("71 review card: the failing Check first with its output, a pre-ticked criterion still to accept (issue #155)", async () => {
    await boardReady();
    await click("Open review of FLY-3");
    await screen.findByRole("region", { name: "1 Check not passing" });
    await shot("71-review-card-judging");
  });

  it("72 review card: Merge with failing Check confirms, naming the Check (issue #155)", async () => {
    setReviewInFixture("override");
    await boardReady();
    await click("Open review of FLY-3");
    await click("Merge FLY-3 with failing Check");
    await screen.findByRole("alertdialog");
    await shot("72-review-card-merge-with-failing-check");
  });

  it("73 review card: every criterion accepted, every Check passed, Merge filled (issue #155)", async () => {
    setReviewInFixture("ready");
    await boardReady();
    await click("Open review of FLY-3");
    await screen.findByRole("button", { name: "Merge FLY-3" });
    await shot("73-review-card-ready");
  });

  it("85 review card: the Decisions section, each new ADR with its bar lines, related ADRs and Keep (issue #161)", async () => {
    setReviewInFixture("decisions");
    await boardReady();
    await click("Open review of FLY-3");
    const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
    section.scrollIntoView({ block: "start" });
    await shot("85-review-card-decisions");
  });

  it("86 review card: the Decisions section at the window's minimum width (issue #161)", async () => {
    setReviewInFixture("decisions");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open review of FLY-3");
      const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
      section.scrollIntoView({ block: "start" });
      await shot("86-review-card-decisions-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("88 review card: the warnings and each changed file's diff (issue #157)", async () => {
    setReviewInFixture("judging", { taskOpen: true });
    await boardReady();
    await click("Open review of FLY-3");
    const files = await screen.findByRole("region", { name: "3 changed files" });
    await screen.findByRole("group", { name: "Diff of packages/desktop/src/theme/tokens.ts" });
    (await screen.findByRole("region", { name: "Warnings" })).scrollIntoView({ block: "start" });
    expect(files).toBeTruthy();
    await shot("88-review-card-files");
  });

  it("89 review card: Re-run Checks says what the run recorded (issue #157)", async () => {
    await boardReady();
    await click("Open review of FLY-3");
    await click("Re-run Checks");
    await screen.findByText("Ran 2 Checks at 9f3c2ab: 1 passed, 1 failed.");
    await shot("89-review-card-rerun-checks");
  });

  it("74 board: an In review Story's row offers Open review (issue #155)", async () => {
    await boardReady();
    (await screen.findByRole("button", { name: "Open review of FLY-3" })).scrollIntoView({ block: "center" });
    await shot("74-board-open-review");
  });

  it("75 Needs you: the ranked column beside the roster, and each project's figure in the sidebar (issue #156)", async () => {
    setNeedsYouExtras(true);
    await boardReady();
    await screen.findByRole("list", { name: "Needs you, most urgent first" });
    await shot("75-needs-you-column");
  });

  it("76 Needs you, scrolled: Stopped, a missing worktree, Review, Confirm exit test and Rounds no session works (issue #156)", async () => {
    setNeedsYouExtras(true);
    setShapingSessionLive(false);
    setRoadmapRound("idle");
    await boardReady();
    const column = await screen.findByRole("region", { name: /^Needs you/ });
    await screen.findByText("Round 2 · No live session: your answers are kept");
    // The board scrolls the column to its top, where it sticks; then the column scrolls its own list.
    column.scrollIntoView({ block: "start" });
    column.scrollTop = column.scrollHeight;
    await shot("76-needs-you-column-decisions");
  });

  it("77 Needs you at the window's minimum width: the top bar's button opens it as a Sheet (issue #156)", async () => {
    setNeedsYouExtras(true);
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click(/^Open Needs you/);
      await screen.findByRole("dialog");
      await shot("77-needs-you-sheet-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("78 Needs you: confirming an Epic's exit test from its card (issue #156)", async () => {
    setNeedsYouExtras(true);
    await boardReady();
    await click("Confirm exit test of FLY-12 Milestone and Roadmap shaping");
    await screen.findByRole("alertdialog");
    await shot("78-needs-you-confirm-exit-test");
  });

  it("92 review card: Rebase needed names the conflicting files first, Merge held (issue #158)", async () => {
    setReviewInFixture("rebase");
    await boardReady();
    await click("Open review of FLY-3");
    await screen.findByRole("region", { name: "Rebase needed" });
    await shot("92-review-card-rebase-needed");
  });

  it("93 review card: Request changes writes the review points in the footer (issue #158)", async () => {
    setReviewInFixture("judging");
    await boardReady();
    await click("Open review of FLY-3");
    await click("Request changes on FLY-3");
    await userEvent.type(
      await screen.findByRole("textbox", { name: "What should change?" }),
      "Lift subtle-foreground on the dark card until it clears 4.5:1.{Enter}Record the lift in direction.md.",
    );
    (await screen.findByRole("button", { name: "Send FLY-3 back to Running" })).scrollIntoView({ block: "end" });
    await shot("93-review-card-request-changes");
  });

  it("96 Needs you: the Proposals row, 4 from 3 Stories, and FLY-1's 3 Proposals on the roster (issue #162)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    const row = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-kind="proposals"]');
      if (!el) throw new Error("no Proposals row yet");
      return el;
    });
    await screen.findByRole("button", { name: /^Triage 3 Proposals on/ });
    const column = await screen.findByRole("region", { name: /^Needs you/ });
    column.scrollIntoView({ block: "start" });
    row.scrollIntoView({ block: "nearest" });
    await shot("96-needs-you-proposals-row");
  });

  it("97 Triage drawer: grouped by Epic, then the Roadmap, each card with its change, why, evidence and filer (issue #162)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 4 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await within(drawer).findByText("Keyboard-first supervision");
    await shot("97-triage-drawer");
  });

  it("98 Triage drawer: Amend opens a New Story's title and description, the why kept in sight (issue #162)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 4 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    await userEvent.click(await within(drawer).findByRole("button", { name: /^Amend New Story “Keyboard shortcuts/ }));
    await within(drawer).findByRole("textbox", { name: "Title" });
    await shot("98-triage-drawer-amend");
  });

  it("100 Needs you: judged-on changes ranked with Review, each with its before and after (issue #163)", async () => {
    setJudgedOnInFixture(true);
    await boardReady();
    const card = await screen.findByRole("group", { name: "Criterion, before and after" });
    card.closest("li")?.scrollIntoView({ block: "center" });
    await shot("100-needs-you-judged-on");
  });

  it("101 Needs you: editing a judged-on change in place (issue #163)", async () => {
    setJudgedOnInFixture(true);
    await boardReady();
    await click("Edit the Amend criterion on FLY-5");
    const field = await screen.findByRole("textbox", { name: "Your criterion" });
    field.closest("li")?.scrollIntoView({ block: "center" });
    await shot("101-needs-you-judged-on-edit");
  });

  it("108 Triage drawer: a duplicate New Story names what it repeats and who filed it (issue #165)", async () => {
    setTriageInFixture(true);
    setTriageDuplicateInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 5 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    const flag = await waitFor(() => {
      const el = drawer.querySelector<HTMLElement>("[data-duplicate-of]");
      if (!el) throw new Error("no duplicate flag yet");
      return el;
    });
    flag.closest("li")?.scrollIntoView({ block: "center" });
    await shot("108-triage-drawer-duplicate");
    setTriageDuplicateInFixture(false);
  });

  it("104 review card: the Decisions section's flags, and Not an ADR and Wrong decision beside Keep (issue #164)", async () => {
    setReviewInFixture("adr_flags");
    await boardReady();
    await click("Open review of FLY-3");
    const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
    await screen.findByText("Wording or supersede?");
    section.scrollIntoView({ block: "start" });
    await shot("104-review-card-adr-flags");
  });

  it("105 review card: a marked ADR holds Merge, and the composer lists the ADR review points it sends (issue #164)", async () => {
    setReviewInFixture("adr_flags");
    await boardReady();
    await click("Open review of FLY-3");
    await click("Request changes on FLY-3");
    await screen.findByRole("list", { name: "Also sent: 4 ADR review points" });
    (await screen.findByRole("button", { name: "Send FLY-3 back to Running" })).scrollIntoView({ block: "end" });
    await shot("105-review-card-adr-review-points");
  });

  it("106 review card: the flags and the three choices at the window's minimum width (issue #164)", async () => {
    setReviewInFixture("adr_flags");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open review of FLY-3");
      const section = await screen.findByRole("region", { name: "Decisions, 5 changes" });
      await screen.findByText("Wording or supersede?");
      section.scrollIntoView({ block: "start" });
      await shot("106-review-card-adr-flags-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("112 Triage drawer: a New Story's card lists the criteria it carries, each with its Check (issue #166)", async () => {
    setTriageInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await click("Triage 4 Proposals");
    const drawer = await screen.findByRole("dialog", { name: /Triage Proposals/ });
    const list = (await within(drawer).findAllByRole("list", { name: "Proposed Acceptance criteria" }))[0];
    list.scrollIntoView({ block: "center" });
    await shot("112-triage-drawer-new-story-criteria");
  });

  it("113 board: an accepted New Story's row offers Make Ready (issue #166)", async () => {
    setMakeReadyInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await rosterRowInView("FLY-12");
    await screen.findAllByRole("button", { name: "Make FLY-12 Ready" });
    await shot("113-board-make-ready-row");
  });

  it("114 Story view: Make Ready on a Shaping Story with its criteria (issue #166)", async () => {
    setMakeReadyInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await openStory("FLY-12", "Keyboard shortcuts for the roster's row actions");
    await screen.findByRole("heading", { name: /Keyboard shortcuts for the roster's row actions/ });
    await screen.findAllByRole("button", { name: "Make FLY-12 Ready" });
    await shot("114-story-view-make-ready");
  });

  it("115 Story view: Make Ready waits while the Story has no criterion (issue #166)", async () => {
    setMakeReadyInFixture(true);
    useTriageDrawer.getState().closeTriage();
    await boardReady();
    await openStory("FLY-13", "Measure the board's first paint on a 40-Story project");
    await screen.findByText(/Make Ready waits/);
    await shot("115-story-view-make-ready-waits");
  });

  it("50 Epic shaping: slicing, the Stories as columns with ghost columns and their constraints (issue #127)", async () => {
    slicingShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await storyColumnsInView();
    await shot("50-epic-shaping-story-columns");
  });

  it("51 Epic shaping: amending a proposed Story in its ghost column (issue #127)", async () => {
    slicingShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click("Amend the proposed Story Slice an Epic into Stories as ghost columns");
    await screen.findByRole("textbox", { name: "Title" });
    await storyColumnsInView();
    await shot("51-epic-shaping-amend-story");
  });

  it("52 Epic shaping at the window's minimum width: the Story columns scroll sideways (issue #127)", async () => {
    slicingShaping();
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open FLY-8 Epic shaping and its Rounds");
      await storyColumnsInView();
      await shot("52-epic-shaping-story-columns-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  /**
   * Issue #134: the exit test is the developer's to confirm. `epic`: every Story of FLY-1 is Merged, so its
   * card offers Confirm exit test. `milestone`: FLY-1 and FLY-8 are both Done, so the Milestone's row and
   * header offer it. `noted`: a roadmap Round opened on FLY-1's Done has no live session, and FLY-8's Done
   * came while it was open, so it is noted on the band.
   */
  function exitTestScene(scene: "epic" | "milestone" | "noted") {
    const allDone = scene !== "epic";
    const FLY1_EXIT = "Every screen of the M2 flow is drawn in the Andon world, and Cyril tells what needs him at a glance.";
    mockIPC(
      (cmd, payload) => {
        const args = payload as Record<string, unknown> | undefined;
        const base = answer(cmd, args);
        switch (cmd) {
          case "story_list_for_project":
            return (base as { epicId: string; state: string }[]).map((s) =>
              s.epicId === "e-97" || (allDone && s.epicId === "e-59") ? { ...s, state: s.state === "dropped" ? "dropped" : "merged" } : s,
            );
          case "epic_list":
            return (base as { id: string; state: string }[] | null)?.map((e) =>
              e.id === "e-97" ? { ...e, exitTest: FLY1_EXIT, state: allDone ? "done" : "in_progress" } : e.id === "e-59" && allDone ? { ...e, state: "done" } : e,
            );
          case "milestone_list":
            return (base as { id: string }[]).map((m) => (m.id === "m-3" ? { ...m, epicsDone: allDone ? 2 : 0, epicsTotal: 2 } : m));
          case "milestone_progress": {
            if (!base) return base;
            const p = base as { milestoneId: string; epics: { epicId: string; counts: Record<string, number> }[]; counts: Record<string, number> };
            if (p.milestoneId !== "m-3") return base;
            const merged = allDone ? 7 : 6;
            const zero = { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0 };
            return {
              ...p,
              epicsDone: allDone ? 2 : 0,
              counts: allDone ? { ...zero, merged, dropped: 1, storiesTotal: merged } : { ...p.counts, ...zero, ready: 1, shaping: 1, merged, storiesTotal: merged + 2 },
              epics: p.epics.map((e) =>
                e.epicId === "e-97"
                  ? { ...e, state: allDone ? "done" : "in_progress", counts: { ...zero, merged: 6, dropped: 0, storiesTotal: 6 } }
                  : allDone
                    ? { ...e, state: "done", attention: null, counts: { ...zero, merged: 1, dropped: 1, storiesTotal: 1 } }
                    : e,
              ),
            };
          }
          // Nothing runs and nothing waits: the scene is about closing work.
          case "fleet_list": return { rows: [], totalRows: 0, visibleCostUsd: 0 };
          case "fleet_blocked_queue": return [];
          case "fleet_waiting_rounds": return [];
          case "board_blocked_summary": return { blockedStoryIds: [], waitingEpicIds: [], roadmapWaiting: false, blockedCount: 0 };
          case "epic_shaping_session": return null;
          case "roadmap_round_read":
            if (scene !== "noted" || args?.projectId !== "p-fly") return base;
            return {
              open: {
                id: "rr-3", number: 3, state: "open", triggerType: "epic_done", triggerLabel: "Epic FLY-1 done",
                waitingOnYou: false, sessionLive: false, sessionId: null, postedAt: new Date(Date.now() - 1_200_000).toISOString(),
                closedAt: null, proposalsFiled: 0, notedTriggers: ["Epic FLY-8 done"],
              },
              proposals: [],
              last: null,
            };
          default:
            return base;
        }
      },
      { shouldMockEvents: true },
    );
  }

  it("58 Epic card: every Story Merged, Confirm exit test (issue #134)", async () => {
    exitTestScene("epic");
    await boardReady();
    const confirm = await screen.findByRole("button", { name: "Confirm exit test of FLY-1 Design system and a legible app" });
    confirm.closest("section")?.scrollIntoView({ block: "center" });
    await shot("58-epic-confirm-exit-test");
  });

  it("59 Confirming an Epic's exit test: the dialog names the short roadmap Round it starts, and Not met (issue #134)", async () => {
    exitTestScene("epic");
    await boardReady();
    await click("Confirm exit test of FLY-1 Design system and a legible app");
    await screen.findByRole("alertdialog");
    await shot("59-epic-confirm-exit-test-dialog");
  });

  it("60 Milestone header: every Epic Done, Confirm exit test (issue #134)", async () => {
    exitTestScene("milestone");
    await boardReady();
    await screen.findByRole("button", { name: "Confirm exit test of Shaping" });
    await roadmapStrip();
    await shot("60-milestone-confirm-exit-test");
  });

  it("61 Roadmap strip: a Done confirmed while a Round was open is noted on its band (issue #134)", async () => {
    exitTestScene("noted");
    await boardReady();
    await screen.findByText("Also noted: Epic FLY-8 done.");
    await roadmapStrip();
    await shot("61-roadmap-round-noted-trigger");
  });

  it("62 Another Milestone picked at the window's minimum width: Confirm exit test in Shaping's strip row (issue #134)", async () => {
    exitTestScene("milestone");
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click(/^Board and review,/);
      await screen.findByRole("button", { name: "Confirm exit test of Shaping" });
      await roadmapStrip();
      await shot("62-milestone-row-confirm-exit-test-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("63 Epic shaping: the criteria Stage, criteria under each Story column and ghost criteria (issue #128)", async () => {
    criteriaShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByText("Accept all recommended answers every open question at once");
    await storyColumnsInView();
    await shot("63-epic-shaping-criteria");
  });

  it("64 Epic shaping: the Stage bar lists each Story with no criterion (issue #128)", async () => {
    criteriaShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByRole("list", { name: "Still open" });
    await shot("64-epic-shaping-criteria-stage-open");
  });

  it("65 Epic shaping: amending a proposed criterion under its Story (issue #128)", async () => {
    criteriaShaping();
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click(/^Amend the proposed criterion A pending spec change/);
    await screen.findByRole("textbox", { name: "Criterion" });
    await storyColumnsInView();
    await shot("65-epic-shaping-amend-criterion");
  });

  it("66 Epic shaping: confirming the last Stage's close, which makes the Epic and its Stories Ready (issue #128)", async () => {
    criteriaShaping({ closable: true });
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await screen.findByText(/It is the Epic's last Stage/);
    await click("Close Stage");
    await screen.findByRole("alertdialog");
    await shot("66-epic-shaping-criteria-close-confirm");
  });

  it("68 Epic shaping: the last Stage closed, the Epic and its Stories Ready (issue #128)", async () => {
    criteriaShaping({ closable: true });
    await boardReady();
    await click("Open FLY-8 Epic shaping and its Rounds");
    await click("Close Stage");
    await click("Close and make the Epic Ready");
    await screen.findByText("Every Stage is closed: shaping is done.");
    await screen.findByText(/the Epic and its 4 Stories are Ready/);
    await shot("68-epic-shaping-criteria-closed");
  });

  it("67 Epic shaping at the window's minimum width: criteria under the Story columns (issue #128)", async () => {
    criteriaShaping();
    await page.viewport(900, 900);
    try {
      await boardReady();
      await click("Open FLY-8 Epic shaping and its Rounds");
      await screen.findByText("Accept all recommended answers every open question at once");
      await storyColumnsInView();
      await shot("67-epic-shaping-criteria-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  it("116 board: + Story on an Epic card opens Write a Story with that Epic chosen (issue #168)", async () => {
    await boardReady();
    await userEvent.click((await screen.findAllByRole("button", { name: /^Add a Story to / }))[0]);
    await screen.findByRole("dialog", { name: "Write a Story" });
    await shot("116-board-add-story-on-epic-card");
  });

  it("117 board: + Epic in the Milestone header opens Add an Epic on that Milestone (issue #168)", async () => {
    await boardReady();
    await click(/^Add an Epic to /);
    await screen.findByRole("dialog", { name: "Add an Epic" });
    await shot("117-board-add-epic-in-milestone-header");
  });

  it("118 Story view: Move to Epic lists the other open Epics under their Milestones (issue #168)", async () => {
    await boardReady();
    await openStory("FLY-4", "Make clicking and navigation predictable");
    await click("Move FLY-4 to another Epic");
    await screen.findByRole("menu");
    await shot("118-story-move-to-epic");
  });

  it("119 Story view at the window's minimum width: Move to Epic beside Drop (issue #168)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await openStory("FLY-4", "Make clicking and navigation predictable");
      await click("Move FLY-4 to another Epic");
      await screen.findByRole("menu");
      await shot("119-story-move-to-epic-min-width");
    } finally {
      await page.viewport(1440, 900);
    }
  });

  /** Centre a Story's roster row (Needs you beside the roster names some of the same Stories). */
  async function rosterRowInView(key: string) {
    const opens = await screen.findAllByRole("button", { name: new RegExp(`^Open Story ${key} `) });
    const row = opens.map((b) => b.closest("li[data-story-id]")).find((li) => li !== null);
    if (!row) throw new Error(`no roster row for ${key}`);
    row.scrollIntoView({ block: "center" });
  }

  it("83 board: roster rows from one core read, the rows that need you tinted with a word (issue #159)", async () => {
    await boardReady();
    await rosterRowInView("FLY-5");
    await shot("83-board-roster-rows");
  });

  it("84 board: an Epic in Shaping carries its shaping marker (issue #159)", async () => {
    await boardReady();
    await rosterRowInView("FLY-10");
    await shot("84-board-epic-shaping-marker");
  });

  it("87 board at the window's minimum width: the roster rows (issue #159)", async () => {
    await page.viewport(900, 900);
    try {
      await boardReady();
      await rosterRowInView("FLY-5");
      await shot("87-board-roster-rows-min-width");
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
