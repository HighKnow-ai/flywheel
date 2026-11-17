/// <reference types="vite/client" />
/**
 * The Milestone 2 to 4 walk's shared steps, for the design critique (issues #102, #192): the helpers and the
 * hooks that every part of the walk (`m2-flow-1` to `m2-flow-6`, `*.critique.browser.test.tsx`) runs on.
 *
 * Every part renders the real `<App />` in WebKit (the engine closest to the shipped WKWebView) over the seeded
 * fake backend in `m2-fixture.ts`, walks its screens by clicking the real controls, and at each screen calls
 * `capture()` (`capture.ts`): the screen at 900 × 600, 1280 × 800, 1440 × 900 and 1920 × 1200, each run through
 * the layout-defect check and, in the critique run, shot into the git-ignored `target/critique-2026-10-m4/`.
 * A screen whose name ends in `-min-width` is a state the walk reaches at the window's minimum width (a Sheet
 * that only opens there), so it is captured at 900 × 600 only. The stress data, the screens outside this walk and
 * the error and empty states are in `stress-1` to `stress-2` (`stress-steps.tsx`).
 *
 * WHY THE WALK IS 6 FILES AND NOT ONE (#1732). A screen waits on real timers, not on the CPU: `settle()` sleeps
 * 600 ms, then 250 ms at each of four sizes, and the one file of 104 screens ran 4.1 minutes on a fast machine
 * with the CPU 95% idle, and 9 minutes at background priority. Vitest runs the files of a browser arm side by
 * side, each in its own page with its own viewport, so the same screens in 6 files take about a 6th as long.
 * A part shares nothing with another: its own page, its own fixture state (`installFixtureBackend()` resets every
 * flag before each screen) and its own defect report, `layout-defects-m2-flow-<part>-<scheme>.json`. A new screen
 * goes in the part with the fewest screens.
 *
 * Runs only under `vitest.critique.config.ts` (it is skipped in the ordinary browser arm):
 *
 *   npm run test:critique          # both schemes, with screenshots
 *   npm run test:layout-defects    # light, the defect check only (CI)
 */
import { afterEach, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "vitest/browser";
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
  setShapingSessionLive,
} from "./m2-fixture";
import { at } from "../present";
import { capture, settle } from "./capture";

export async function shot(name: string) {
  await settle();
  await capture(name, name.endsWith("-min-width") ? { sizes: [{ width: 900, height: 600 }] } : {});
}

export async function boardReady() {
  // The shipped page mounts into `#root`, which globals.css sizes to the window; render into the same node.
  const root =
    document.getElementById("root") ??
    document.body.appendChild(Object.assign(document.createElement("div"), { id: "root" }));
  render(<App />, { container: root });
  await screen.findAllByText("Make clicking and navigation predictable");
  await settle();
}

/**
 * Issue #126: FLY-8 with its Challenge Stage settled: Round 2 answered, no spec change left pending (the
 * rejected one stays struck through), so nothing keeps the Stage open and Close Stage is enabled.
 */
export function closableShaping({ closed = false } = {}) {
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
          ? {
              stageId: "st-2",
              openItems: [],
              warnings: ["The Exit test is not written yet"],
              next: "criteria",
              closable: true,
            }
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
export function slicingShaping() {
  closableShaping({ closed: true });
  const story = (
    id: string,
    key: string,
    title: string,
    rank: string,
    description: string,
    runsAfter: [string, string] | null = null,
  ) => ({
    id,
    projectId: "p-fly",
    epicId: "e-59",
    key,
    title,
    description,
    state: "shaping",
    rank,
    runsAfterStoryId: runsAfter?.[0] ?? null,
    runsAfterReason: runsAfter?.[1] ?? null,
  });
  const proposal = (
    id: string,
    verb: string,
    payload: Record<string, unknown>,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    projectId: "p-fly",
    sessionId: "ses-shape-8",
    epicId: "e-59",
    verb,
    targetType: "story",
    targetId: null,
    payload,
    rationale: null,
    state: "pending",
    createdAt: new Date().toISOString(),
    rejectionReason: null,
    stageId: "st-2",
    roundId: null,
    ...extra,
  });
  const newStory = (
    id: string,
    title: string,
    rank: string,
    description: string,
    after: Record<string, unknown> = {},
    extra: Record<string, unknown> = {},
  ) =>
    proposal(
      id,
      "create",
      {
        title,
        description,
        rank,
        runs_after_story_id: null,
        runs_after_proposal_id: null,
        runs_after_reason: null,
        ...after,
      },
      extra,
    );
  const stories = [
    story(
      "s-9",
      "FLY-9",
      "Answer a shaping Round in the dock",
      "a0",
      "The dock beside the Epic card: numbered questions with a pre-filled recommended answer, Accept, Answer differently and Accept all recommended. Tested in round-dock.test.tsx.",
    ),
    story(
      "s-10",
      "FLY-10",
      "Show Proposals in shaping as ghost cards",
      "a1",
      "A spec change the agent proposes shows under the field it would rewrite, decided there with Accept, Amend or Reject.",
      ["s-9", "the ghost card answers from the dock's Round"],
    ),
    story(
      "s-12",
      "FLY-12",
      "Resume a killed shaping session at the open Round",
      "a2",
      "A fresh session rebuilt from the board picks the open Round up with round_wait; no answer is lost.",
    ),
  ];
  const proposals = [
    newStory(
      "pr-s1",
      "Slice an Epic into Stories as ghost columns",
      "a3",
      "propose_story and propose_story_order; accepting creates the Story in Shaping at its rank with its runs-after marker. Tested in proposal_apply.rs and story-columns.test.tsx.",
      { runs_after_story_id: "s-10", runs_after_reason: "reuses GhostCard.tsx's decisions" },
    ),
    newStory(
      "pr-s2",
      "Write the criteria and close the Epic to Ready",
      "a4",
      "The criteria Stage: one accepted criterion per Story with its Check, then closing the last Stage makes every Story Ready.",
      { runs_after_proposal_id: "pr-s1", runs_after_reason: "criteria stack under the Story columns" },
    ),
    proposal(
      "pr-m1",
      "reorder",
      { rank: "a35" },
      { targetId: "s-12", rationale: "Resuming needs the slicing tools in the packet first" },
    ),
    newStory(
      "pr-s0",
      "Prototype the dock as a modal sheet",
      "a5",
      "",
      {},
      { state: "rejected", rejectionReason: "The dock stays beside the Epic card" },
    ),
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
          {
            kind: "proposal",
            id: "pr-s1",
            label: "",
            round: null,
            number: null,
            title: "add the Story “Slice an Epic into Stories as ghost columns”",
          },
          {
            kind: "proposal",
            id: "pr-s2",
            label: "",
            round: null,
            number: null,
            title: "add the Story “Write the criteria and close the Epic to Ready”",
          },
          {
            kind: "proposal",
            id: "pr-m1",
            label: "",
            round: null,
            number: null,
            title: "move FLY-12 “Resume a killed shaping session at the open Round” in the order",
          },
        ];
        return {
          ...base,
          stages,
          rounds: base.rounds.map((r) => ({
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
          proposals: [...base.proposals.filter((p) => p.state !== "pending"), ...proposals],
          stories,
          openStageStatus: {
            stageId: "st-2",
            openItems,
            warnings: ["The Exit test is not written yet"],
            next: "criteria",
            closable: false,
          },
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
export function criteriaShaping({ closable = false } = {}) {
  closableShaping({ closed: true });
  const story = (
    id: string,
    key: string,
    title: string,
    rank: string,
    description: string,
    runsAfter: [string, string] | null = null,
  ) => ({
    id,
    projectId: "p-fly",
    epicId: "e-59",
    key,
    title,
    description,
    state: "shaping",
    rank,
    runsAfterStoryId: runsAfter?.[0] ?? null,
    runsAfterReason: runsAfter?.[1] ?? null,
  });
  const stories = [
    story(
      "s-9",
      "FLY-9",
      "Answer a shaping Round in the dock",
      "a0",
      "The dock beside the Epic card: numbered questions with a pre-filled recommended answer, Accept, Answer differently and Accept all recommended.",
    ),
    story(
      "s-10",
      "FLY-10",
      "Show Proposals in shaping as ghost cards",
      "a1",
      "A spec change the agent proposes shows under the field it would rewrite, decided there.",
      ["s-9", "the ghost card answers from the dock's Round"],
    ),
    story(
      "s-12",
      "FLY-12",
      "Resume a killed shaping session at the open Round",
      "a2",
      "A fresh session rebuilt from the board picks the open Round up with round_wait.",
    ),
    story(
      "s-13",
      "FLY-13",
      "Close the Epic to Ready",
      "a3",
      "Closing the criteria Stage makes every Story in Shaping and the Epic Ready.",
    ),
  ];
  // Once the close lands (screen 68), every Stage is closed and the Epic and its Stories are Ready.
  let closedNow = false;
  const check = (id: string, command: string) => ({
    id,
    command,
    timeoutSecs: 600,
    result: "not_run",
    commitSha: null,
    stale: false,
    outputTail: null,
  });
  const criterion = (id: string, storyId: string, statement: string, command: string | null, rank: string) => ({
    id,
    storyId,
    statement,
    accepted: false,
    acceptedAt: null,
    rank,
    check: command ? check(`k-${id}`, command) : null,
  });
  const criteria: Record<string, ReturnType<typeof criterion>[]> = {
    "s-9": [
      criterion(
        "c-9a",
        "s-9",
        "Accept all recommended answers every open question at once",
        "npm test -- round-dock",
        "a",
      ),
      criterion("c-9b", "s-9", "A recommended answer reads as already filled in, never as a placeholder", null, "b"),
    ],
    "s-10": closable
      ? [
          criterion(
            "c-10a",
            "s-10",
            "A pending spec change shows under the field it would rewrite",
            "npm test -- ghost-card",
            "a",
          ),
        ]
      : [],
    "s-12": closable
      ? [
          criterion(
            "c-12a",
            "s-12",
            "A killed session's successor picks the open Round up with no answer lost",
            "cargo test -p core --test shaping_resume",
            "a",
          ),
        ]
      : [],
    "s-13": closable
      ? [
          criterion(
            "c-13a",
            "s-13",
            "Closing the criteria Stage makes the Epic and its Stories Ready at once",
            "cargo test -p core --test stage_close",
            "a",
          ),
        ]
      : [],
  };
  const proposal = (
    id: string,
    storyId: string,
    statement: string,
    command: string | null,
    extra: Record<string, unknown> = {},
  ) => ({
    id,
    projectId: "p-fly",
    sessionId: "ses-shape-8",
    epicId: "e-59",
    verb: "create",
    targetType: "criterion",
    targetId: null,
    payload: { story_id: storyId, statement, ...(command ? { check_command: command } : {}) },
    rationale: null,
    state: "pending",
    createdAt: new Date().toISOString(),
    rejectionReason: null,
    stageId: "st-3",
    roundId: null,
    ...extra,
  });
  const proposals = closable
    ? []
    : [
        proposal(
          "pc-10",
          "s-10",
          "A pending spec change shows under the field it would rewrite, decided there",
          "npm test -- ghost-card",
        ),
        proposal("pc-12", "s-12", "A killed session's successor picks the open Round up with no answer lost", null),
        proposal("pc-x", "s-9", "The dock feels calm", null, {
          state: "rejected",
          rejectionReason: "Not observable: name what calm looks like",
        }),
      ];
  const openItems = closable
    ? []
    : [
        {
          kind: "proposal",
          id: "pc-10",
          label: "",
          round: null,
          number: null,
          title:
            "add the criterion “A pending spec change shows under the field it would rewrite, decided there” to FLY-10",
        },
        {
          kind: "proposal",
          id: "pc-12",
          label: "",
          round: null,
          number: null,
          title:
            "add the criterion “A killed session's successor picks the open Round up with no answer lost” to FLY-12",
        },
        // FLY-10 and FLY-12 are named through their Proposals; FLY-13 has neither a criterion nor a Proposal.
        {
          kind: "story_without_criterion",
          id: "s-13",
          label: "",
          round: null,
          number: null,
          title: "Close the Epic to Ready",
          storyKey: "FLY-13",
        },
      ];
  mockIPC(
    (cmd, payload) => {
      if (cmd === "stage_close") {
        closedNow = true;
        return {
          closedStageId: "st-3",
          opened: null,
          madeReady: stories.map((s) => s.id),
          session: null,
          launchError: null,
          sidecarWarning: null,
        };
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
            questions: r.questions.map((q) => ({
              ...q,
              answer: q.answer ?? q.recommendedAnswer,
              answeredWith: q.answeredWith ?? "recommended",
              answeredAt: q.answeredAt ?? r.postedAt,
            })),
          })),
          proposals: [...base.proposals.filter((p) => p.state !== "pending"), ...proposals],
          stories: closedNow ? stories.map((s) => ({ ...s, state: "ready" })) : stories,
          openStageStatus: closedNow
            ? null
            : {
                stageId: "st-3",
                openItems,
                warnings: ["The Exit test is not written yet"],
                next: null,
                makesReady: true,
                closable,
              },
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

export async function storyColumnsInView() {
  const heading = await screen.findByRole("heading", { name: "Stories" });
  heading.scrollIntoView({ block: "start" });
}

// The first match: since Needs you (#156) a Story's controls show both in its card and on its roster row,
// and either is the same control.
export async function click(label: string | RegExp) {
  await userEvent.click(at(await screen.findAllByRole("button", { name: label }), 0));
}

export async function openStory(key: string, title: string | RegExp) {
  await userEvent.click(
    at(
      await screen.findAllByRole("button", {
        name: new RegExp(`^Open Story ${key} ${typeof title === "string" ? title : title.source}$`),
      }),
      0,
    ),
  );
}

export async function roadmapStrip() {
  const strip = await screen.findByRole("region", { name: "Roadmap" });
  strip.scrollIntoView({ block: "start" });
  return strip;
}

/**
 * Issue #134: the exit test is the developer's to confirm. `epic`: every Story of FLY-1 is Merged, so its
 * card offers Confirm exit test. `milestone`: FLY-1 and FLY-8 are both Done, so the Milestone's row and
 * header offer it. `noted`: a roadmap Round opened on FLY-1's Done has no live session, and FLY-8's Done
 * came while it was open, so it is noted on the band.
 */
export function exitTestScene(scene: "epic" | "milestone" | "noted") {
  const allDone = scene !== "epic";
  const FLY1_EXIT =
    "Every screen of the M2 flow is drawn in the Andon world, and Cyril tells what needs him at a glance.";
  mockIPC(
    (cmd, payload) => {
      const args = payload as Record<string, unknown> | undefined;
      const base = answer(cmd, args);
      switch (cmd) {
        case "story_list_for_project":
          return (base as { epicId: string; state: string }[]).map((s) =>
            s.epicId === "e-97" || (allDone && s.epicId === "e-59")
              ? { ...s, state: s.state === "dropped" ? "dropped" : "merged" }
              : s,
          );
        case "epic_list":
          return (base as { id: string; state: string }[] | null)?.map((e) =>
            e.id === "e-97"
              ? { ...e, exitTest: FLY1_EXIT, state: allDone ? "done" : "in_progress" }
              : e.id === "e-59" && allDone
                ? { ...e, state: "done" }
                : e,
          );
        case "milestone_list":
          return (base as { id: string }[]).map((m) =>
            m.id === "m-3" ? { ...m, epicsDone: allDone ? 2 : 0, epicsTotal: 2 } : m,
          );
        case "milestone_progress": {
          if (!base) return base;
          const p = base as {
            milestoneId: string;
            epics: { epicId: string; counts: Record<string, number> }[];
            counts: Record<string, number>;
          };
          if (p.milestoneId !== "m-3") return base;
          const merged = allDone ? 7 : 6;
          const zero = { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0 };
          return {
            ...p,
            epicsDone: allDone ? 2 : 0,
            counts: allDone
              ? { ...zero, merged, dropped: 1, storiesTotal: merged }
              : { ...p.counts, ...zero, ready: 1, shaping: 1, merged, storiesTotal: merged + 2 },
            epics: p.epics.map((e) =>
              e.epicId === "e-97"
                ? {
                    ...e,
                    state: allDone ? "done" : "in_progress",
                    counts: { ...zero, merged: 6, dropped: 0, storiesTotal: 6 },
                  }
                : allDone
                  ? {
                      ...e,
                      state: "done",
                      attention: null,
                      counts: { ...zero, merged: 1, dropped: 1, storiesTotal: 1 },
                    }
                  : e,
            ),
          };
        }
        // Nothing runs and nothing waits: the scene is about closing work.
        case "fleet_list":
          return { rows: [], totalRows: 0, visibleCostUsd: 0 };
        case "fleet_blocked_queue":
          return [];
        case "fleet_waiting_rounds":
          return [];
        case "board_blocked_summary":
          return { blockedStoryIds: [], waitingEpicIds: [], roadmapWaiting: false, blockedCount: 0 };
        case "epic_shaping_session":
          return null;
        case "roadmap_round_read":
          if (scene !== "noted" || args?.projectId !== "p-fly") return base;
          return {
            open: {
              id: "rr-3",
              number: 3,
              state: "open",
              triggerType: "epic_done",
              triggerLabel: "Epic FLY-1 done",
              waitingOnYou: false,
              sessionLive: false,
              sessionId: null,
              postedAt: new Date(Date.now() - 1_200_000).toISOString(),
              closedAt: null,
              proposalsFiled: 0,
              notedTriggers: ["Epic FLY-8 done"],
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

/** Centre a Story's roster row (Needs you beside the roster names some of the same Stories). */
export async function rosterRowInView(key: string) {
  const opens = await screen.findAllByRole("button", { name: new RegExp(`^Open Story ${key} `) });
  const row = opens.map((b) => b.closest("li[data-story-id]")).find((li) => li !== null);
  if (!row) throw new Error(`no roster row for ${key}`);
  row.scrollIntoView({ block: "center" });
}

/**
 * The hooks every part runs: state is reset before each screen and the DOM and the IPC mock are torn down
 * after it. Call it once, inside the part's `describe`.
 */
export function registerHooks() {
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
}
