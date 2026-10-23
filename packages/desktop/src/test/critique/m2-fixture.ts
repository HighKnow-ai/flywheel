/**
 * A seeded fake backend for rendering the real app with realistic data (issue #102).
 *
 * The renderer reaches Tauri only through `adapters/tauri.ts`, which calls `invoke` and `listen` from
 * `@tauri-apps/api`. `installFixtureBackend()` answers those calls with Tauri's own `mockIPC`, so every
 * component, hook and adapter wrapper runs unchanged: only the IPC transport is fake. Nothing here
 * opens or writes a database.
 *
 * The content is Flywheel's own backlog (Milestone 3, Epic #97 and its Stories), so the screens show
 * the shape of work the app really holds: a Milestone, two Epics, a Story in every Story state, a live
 * session, a Gated action, a permission request, an agent's question and a Stopped Story.
 */
import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  AcceptanceCriterionDto,
  BlockedQueueEntryDto,
  CheckDto,
  EpicDto,
  EpicShapingDto,
  FleetRowDto,
  MilestoneDto,
  MilestoneProgressDto,
  MilestoneShapingDto,
  NeedsYouItemDto,
  TriageProposalDto,
  PendingPermissionRequestDto,
  RoadmapProposalDto,
  RoadmapRoundDto,
  RoadmapRoundViewDto,
  RunSummaryDto,
  SessionSummaryDto,
  StoryDto,
  StoryStateCountsDto,
  TaskDto,
  WaitingRoundDto,
  ReviewCheckDto,
  DecisionChangeDto,
  ReviewFileDto,
  StoryReviewDto,
} from "../../adapters/tauri";
import type { Project } from "../../board/useBoardQuery";

const NOW = Date.now();
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

export const PROJECTS: Project[] = [
  { id: "p-fly", keyPrefix: "FLY", name: "flywheel", repoPath: "/Users/dev/code/flywheel", defaultBranch: "main", status: "active" },
  { id: "p-hkw", keyPrefix: "HKW", name: "highknow-web", repoPath: "/Users/dev/code/highknow-web", defaultBranch: "main", status: "active" },
];

const MILESTONES: Record<string, MilestoneDto[]> = {
  "p-fly": [
    { id: "m-1", projectId: "p-fly", title: "Clean cut", exitTest: "CI is green on a single baseline migration whose tables and types use only glossary names.", state: "done", current: false, rank: "Z" },
    { id: "m-2", projectId: "p-fly", title: "Supervised execution", exitTest: "A Story written by hand runs from Start to In review with Cyril following it in Flywheel.", state: "done", current: false, rank: "a" },
    { id: "m-3", projectId: "p-fly", title: "Shaping", exitTest: "Cyril takes a one-line idea to an Epic with Ready Stories entirely in Flywheel's dock and board.", state: "in_progress", current: true, rank: "b" },
    { id: "m-4", projectId: "p-fly", title: "Board and review", exitTest: "A Story goes from Ready to Merged in Flywheel alone.", state: "shaping", current: false, rank: "c" },
    { id: "m-5", projectId: "p-fly", title: "One-week exit test", exitTest: null, state: "shaping", current: false, rank: "d" },
  ],
  "p-hkw": [
    { id: "m-h1", projectId: "p-hkw", title: "Waitlist live", exitTest: "A visitor can join the waitlist and gets a confirmation email.", state: "in_progress", current: true, rank: "a" },
  ],
};

const EPICS: Record<string, EpicDto[]> = {
  "m-3": [
    { id: "e-97", projectId: "p-fly", milestoneId: "m-3", key: "FLY-1", title: "Design system and a legible app", problem: null, scope: null, outOfScope: null, exitTest: null, state: "in_progress", rank: "a" },
    {
      id: "e-59", projectId: "p-fly", milestoneId: "m-3", key: "FLY-8", title: "Epic shaping",
      problem: "In v0.1 shaping in the app was worse than in a terminal, Stories came out orphaned from their Epic, and a refusal lost the whole challenge.",
      scope: "The board as the shaping surface, ghost-card Proposals, the Round dock with pre-filled recommended answers and Accept all recommended, and every answer written to the board as it is made.",
      outOfScope: "Milestone and Roadmap shaping. Execution Proposals.",
      exitTest: null,
      state: "shaping", rank: "b",
    },
  ],
  "m-h1": [
    { id: "e-h1", projectId: "p-hkw", milestoneId: "m-h1", key: "HKW-1", title: "Waitlist", problem: null, scope: null, outOfScope: null, exitTest: null, state: "in_progress", rank: "a" },
  ],
};

const story = (id: string, projectId: string, epicId: string, key: string, title: string, state: string, rank: string): StoryDto => ({
  id, projectId, epicId, key, title, description: null, state, runsAfterStoryId: null, rank,
});

export const STORIES: StoryDto[] = [
  story("s-2", "p-fly", "e-97", "FLY-2", "Refresh PRODUCT.md and critique the built app", "merged", "a"),
  story("s-3", "p-fly", "e-97", "FLY-3", "Pick Flywheel's new visual world from three rendered directions", "in_review", "b"),
  story("s-4", "p-fly", "e-97", "FLY-4", "Make clicking and navigation predictable", "running", "c"),
  story("s-5", "p-fly", "e-97", "FLY-5", "Build the new world's tokens, icons and shared components", "running", "d"),
  story("s-6", "p-fly", "e-97", "FLY-6", "Show project progress at a glance on the board", "running", "e"),
  story("s-7", "p-fly", "e-97", "FLY-7", "Restyle every screen of the M2 flow in the new world", "running", "f"),
  story("s-9", "p-fly", "e-59", "FLY-9", "Answer a shaping Round in the dock", "ready", "g"),
  story("s-10", "p-fly", "e-59", "FLY-10", "Show Proposals in shaping as ghost cards", "shaping", "h"),
  story("s-11", "p-fly", "e-59", "FLY-11", "Prototype the dock as a modal sheet", "dropped", "i"),
  story("s-h2", "p-hkw", "e-h1", "HKW-2", "Store waitlist sign-ups in Postgres", "running", "a"),
  story("s-h3", "p-hkw", "e-h1", "HKW-3", "Send the confirmation email", "ready", "b"),
];

const task = (id: string, storyId: string, title: string, state: string, rank: string, note: string | null = null, droppedReason: string | null = null): TaskDto => ({
  id, storyId, title, state, droppedReason, rank, note,
});

const TASKS: Record<string, TaskDto[]> = {
  "s-3": [
    task("t-3a", "s-3", "Render three directions as code comps of the board and the feed", "done", "a"),
    task("t-3b", "s-3", "Screenshot each in light and dark at 1440 × 900", "done", "b"),
    task("t-3c", "s-3", "Write the decision page", "done", "c"),
  ],
  "s-4": [
    task("t-4a", "s-4", "Clear the open session when the rail switches project", "done", "a",
      "uiStore.setCurrentProjectId now also clears activeSessionId. Test in state/__tests__/uiStore.test.ts."),
    task("t-4b", "s-4", "Make Waiting on you and All agents replace an open feed", "doing", "b",
      "activeSurface ranks session above fleet (state/keyboard.ts:548). Opening the fleet must clear the session, but ← Board from a session opened in the fleet still has to land on the fleet: keep a returnTo field instead of relying on the ranking."),
    task("t-4c", "s-4", "Open a Story's live session from its row on the board", "open", "c"),
    task("t-4d", "s-4", "Stop Start from pushing into the feed without asking", "open", "d"),
  ],
  "s-5": [
    task("t-5a", "s-5", "Write the colour, type and spacing tokens for light and dark", "done", "a", "tokens.css rewritten; contrast.test.ts asserts every text role at 4.5:1."),
    task("t-5b", "s-5", "Add the icon set and the state marks", "done", "b"),
    task("t-5c", "s-5", "Build Button, Badge, Row and Card on the tokens", "done", "c"),
    task("t-5d", "s-5", "Push the branch so CI runs the browser arm", "doing", "d"),
  ],
  "s-6": [
    task("t-6a", "s-6", "Read the Milestone and Epic reads the header needs", "done", "a"),
    task("t-6b", "s-6", "Agree how Dropped Stories count in the bar", "doing", "b", "Glossary says Dropped counts as closed for its Epic. Asked Cyril whether the bar should show them."),
    task("t-6c", "s-6", "Draw the stacked bar of Story states", "open", "c"),
    task("t-6d", "s-6", "Add the per-Epic fraction to the roster row", "open", "d"),
  ],
  "s-7": [
    task("t-7a", "s-7", "Restyle the sidebar", "done", "a"),
    task("t-7b", "s-7", "Restyle the board's Story rows", "doing", "b",
      "Half done: StoryRow uses the new Row; the Tasks and Sessions disclosures still use the old buttons. Next: TaskChecklist.tsx."),
    task("t-7c", "s-7", "Restyle the session feed and its cards", "open", "c"),
    task("t-7d", "s-7", "Restyle the Write a Story form", "dropped", "d", null, "Replaced by the shaping dock in Epic #59"),
  ],
  "s-9": [],
  "s-h2": [
    task("t-h2a", "s-h2", "Add the sign_ups table and its migration", "doing", "a"),
    task("t-h2b", "s-h2", "POST /api/waitlist writes a row", "open", "b"),
  ],
};

const run = (id: string, storyId: string, status: string, startedAgo: number, endedAgo: number | null, endingReason: RunSummaryDto["endingReason"]): RunSummaryDto => ({
  id, storyId, status, startedAt: ago(startedAgo), endedAt: endedAgo === null ? null : ago(endedAgo),
  costUsd: null, tokensIn: null, tokensOut: null, externalSessionId: null, acknowledgedAt: null, abandonedReason: null, endingReason,
});

const RUNS: Record<string, RunSummaryDto[]> = {
  "s-2": [run("ses-2a", "s-2", "completed", 86400, 82000, "handed_off")],
  "s-3": [run("ses-3a", "s-3", "completed", 7200, 3600, "handed_off")],
  "s-4": [run("ses-4b", "s-4", "running", 1260, null, null), run("ses-4a", "s-4", "interrupted", 9000, 8100, "app_quit")],
  "s-5": [run("ses-5a", "s-5", "blocked", 2400, null, null)],
  "s-6": [run("ses-6a", "s-6", "blocked", 900, null, null)],
  "s-7": [run("ses-7b", "s-7", "interrupted", 5400, 4200, "usage_limit"), run("ses-7a", "s-7", "completed", 20000, 15000, "ended_without_hand_off")],
  "s-h2": [run("ses-h2a", "s-h2", "blocked", 600, null, null)],
};

const SUMMARIES: Record<string, SessionSummaryDto[]> = {
  "s-3": [{ sessionId: "ses-3a", createdAt: ago(3600), isStub: false, nextSessionMustKnow: "Three directions rendered under docs/design/directions/. Cyril picks one on the decision page.", decisions: "Comps are code, not images, so the chosen one is the start of #105." }],
  "s-4": [{ sessionId: "ses-4a", createdAt: ago(8100), isStub: true, nextSessionMustKnow: "Ended: app quit. Doing: Clear the open session when the rail switches project. Last message: \"Writing the store test first.\"", decisions: "" }],
  "s-7": [
    { sessionId: "ses-7a", createdAt: ago(15000), isStub: true, nextSessionMustKnow: "Ended without hand-off. Doing: Restyle the sidebar.", decisions: "" },
    { sessionId: "ses-7b", createdAt: ago(4200), isStub: true, nextSessionMustKnow: "Ended: usage limit. Doing: Restyle the board's Story rows. Last message: \"StoryRow now renders through Row; moving on to the disclosure buttons.\"", decisions: "" },
  ],
};

let seq = 0;
const ev = (secondsAgo: number, fields: Record<string, unknown>) => ({ seq: seq++, at: ago(secondsAgo), raw: "{}", ...fields });
const call = (secondsAgo: number, id: string, toolName: string, input: unknown) => ev(secondsAgo, { type: "tool_call", toolName, input, toolUseId: id });
const result = (secondsAgo: number, id: string, output: unknown, isError = false) => ev(secondsAgo, { type: "tool_result", output, toolUseId: id, ...(isError ? { isError: true } : {}) });
const say = (secondsAgo: number, text: string) => ev(secondsAgo, { type: "assistant_text", text });
const BOARD = "mcp__flywheel-board__";
/** A Task tool's answer as the core words it (`tasks_as_tool_result`): the whole checklist, here its first `n` Tasks. */
const checklist = (storyId: string, n: number) =>
  JSON.stringify({ tasks: (TASKS[storyId] ?? []).slice(0, n).map((t) => ({ task_id: t.id, title: t.title, state: t.state })) });

const QUESTIONS = [
  {
    question: "The Milestone header shows a stacked bar of Story states. Should Dropped Stories count in the bar?",
    header: "Dropped",
    multiSelect: false,
    options: [
      { label: "Count them as closed", description: "Matches the glossary: a Dropped Story counts as closed for its Epic." },
      { label: "Leave them out", description: "The bar shows only work that will ship." },
    ],
  },
  {
    question: "Which counts go on the header line?",
    header: "Counts",
    multiSelect: true,
    options: [
      { label: "Epics done / Epics" },
      { label: "Stories merged / Stories" },
      { label: "Stories running now" },
    ],
  },
];

const LOGS: Record<string, Record<string, unknown>[]> = {
  "ses-4b": [
    ev(1260, { type: "init", sessionId: "c0ffee" }),
    say(1250, "I'll read the code this Story touches before writing the plan: the surface switch in `App.tsx`, `activeSurface` in `state/keyboard.ts`, and every caller of `setActiveSessionId`."),
    call(1245, "t1", "Read", { file_path: "packages/desktop/src/App.tsx" }),
    result(1244, "t1", "     1\timport React, { Suspense, useEffect } from \"react\";\n     2\timport { QueryClientProvider } from \"@tanstack/react-query\";\n   …"),
    call(1240, "t2", "Read", { file_path: "packages/desktop/src/state/keyboard.ts" }),
    result(1239, "t2", "   544\texport function activeSurface(state: SurfaceState): UiSurface {\n   …"),
    call(1236, "t3", "Grep", { pattern: "setActiveSessionId\\(", path: "packages/desktop/src" }),
    result(1235, "t3", "App.tsx:195\nApp.tsx:219\nApp.tsx:248\nprojects/ProjectRail.tsx:170\nfleet/FleetSurface.tsx:486"),
    say(1200, "Found it. `activeSurface` ranks the session **above** the fleet and the board, and nothing clears `activeSessionId` when you pick a project in the rail. So:\n\n- clicking a project while a feed is open keeps the feed;\n- the rail's *Waiting on you* row opens the fleet *underneath* the open feed.\n\nWriting the plan now."),
    call(1190, "t4", `${BOARD}task_add`, { titles: ["Clear the open session when the rail switches project"] }),
    result(1189, "t4", checklist("s-4", 1)),
    call(1188, "t5", `${BOARD}task_add`, { titles: ["Make Waiting on you and All agents replace an open feed", "Open a Story's live session from its row on the board"] }),
    result(1187, "t5", checklist("s-4", 3)),
    call(1180, "t7", "Edit", { file_path: "packages/desktop/src/state/uiStore.ts", old_string: "setCurrentProjectId: (id) => set({ currentProjectId: id }),", new_string: "setCurrentProjectId: (id) => set({ currentProjectId: id, activeSessionId: null }),", replace_all: false }),
    result(1179, "t7", "The file packages/desktop/src/state/uiStore.ts has been updated."),
    call(1100, "t8", "Bash", { command: "npm --prefix packages/desktop test -- uiStore", description: "Run the store tests" }),
    result(1060, "t8", " ✓ src/state/__tests__/uiStore.test.ts (14 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  14 passed (14)"),
    call(1050, "t9", `${BOARD}task_update`, { task_id: "t-4a", state: "done", note: "uiStore.setCurrentProjectId now also clears activeSessionId." }),
    result(1049, "t9", checklist("s-4", 3)),
    say(400, "Store tests pass. Next: *Waiting on you* and *All agents* must replace an open feed, but **← Board** from a session opened in the fleet still has to land back on the fleet."),
    call(390, "t10", "Edit", { file_path: "packages/desktop/src/state/keyboard.ts", old_string: "if (state.sessionOpen) return \"session\";", new_string: "if (state.sessionOpen && !state.fleetRequested) return \"session\";" }),
    result(389, "t10", "The file packages/desktop/src/state/keyboard.ts has been updated."),
    call(300, "t11", "Bash", { command: "npm --prefix packages/desktop test -- keyboard", description: "Run the keyboard tests" }),
    result(270, "t11", " FAIL  src/state/__tests__/keyboard.test.ts > activeSurface > keeps the session above the fleet\n AssertionError: expected 'fleet' to be 'session'", true),
    say(200, "One test pins the old ranking on purpose. It describes the behaviour this Story replaces, so I'm rewriting it to the new rule rather than working around it."),
    call(95, "t12", "Bash", { command: "npm --prefix packages/desktop test", description: "Run the desktop test suite" }),
    ev(5, { type: "tool_progress", toolUseId: "t12", toolName: "Bash", elapsedSeconds: 90 }),
  ],
  "ses-5a": [
    ev(2400, { type: "init", sessionId: "beef" }),
    say(2300, "Tokens, icons and the four shared components are in. `contrast.test.ts` passes in both schemes."),
    call(2200, "u1", "Bash", { command: "npm --prefix packages/desktop test", description: "Run the desktop tests" }),
    result(2150, "u1", " Test Files  96 passed (96)\n      Tests  1204 passed (1204)"),
    call(2100, "u2", `${BOARD}task_update`, { task_id: "t-5c", state: "done" }),
    result(2099, "u2", checklist("s-5", 4)),
    say(2050, "I'll push the branch so CI runs the WebKit browser arm, which I can't run headless here."),
    call(2040, "u3", "Bash", { command: "git push -u origin story/fly-5-tokens", description: "Push the Story branch" }),
  ],
  "ses-6a": [
    ev(900, { type: "init", sessionId: "cafe" }),
    say(880, "Reading the Milestone and Epic reads the header will need."),
    call(870, "q1", "Read", { file_path: "packages/core/src/domain/milestone.rs" }),
    result(869, "q1", "   1\t//! A Milestone on a project's Roadmap …"),
    call(860, "q2", "Grep", { pattern: "Dropped", path: "GLOSSARY.md" }),
    result(859, "q2", "**Dropped**:\nThe end state of a Story the developer has decided not to finish; its record stays readable and it counts as closed for its Epic."),
    say(850, "The glossary counts a Dropped Story as closed for its Epic, but the bar is about progress you can see at a glance. That's your call, so I'm asking before I draw it."),
    call(840, "q3", "AskUserQuestion", { questions: QUESTIONS }),
  ],
  "ses-3a": [
    ev(7200, { type: "init", sessionId: "d00d" }),
    say(7100, "Rendering the three directions as code comps."),
    call(5000, "r1", `${BOARD}checks_run`, {}),
    result(4900, "r1", JSON.stringify({ commit: "4f1c2ab", checks: [
      { command: "npm --prefix packages/desktop test", result: "passed", exit_code: 0, output_tail: "" },
      { command: "npm --prefix packages/desktop run build", result: "failed", exit_code: 1, output_tail: "error TS2322" },
    ] })),
    call(3700, "r2", `${BOARD}handoff`, { next_session_must_know: "Three directions rendered under docs/design/directions/.", decisions: "Comps are code, not images." }),
    result(3650, "r2", JSON.stringify({ commit: "9a07d3e", checks: [
      { command: "npm --prefix packages/desktop test", result: "passed", exit_code: 0, output_tail: "" },
      { command: "npm --prefix packages/desktop run build", result: "passed", exit_code: 0, output_tail: "" },
    ], recorded: true, story_state: "in_review", open_tasks: 0, next: "The Story is In review. End your turn now." })),
    ev(3600, { type: "result", inputTokens: 412000, outputTokens: 38100, totalCostUsd: 4.82 }),
    ev(3600, { type: "session_closed", reason: "completed" }),
  ],
  "ses-h2a": [
    ev(600, { type: "init", sessionId: "f00d" }),
    say(590, "Adding the `sign_ups` table. I'll run the migration against the local database to check it applies."),
    call(580, "h1", "Bash", { command: "pnpm db:migrate --env local", description: "Apply the migration locally" }),
  ],
};

const PENDING: Record<string, PendingPermissionRequestDto[]> = {
  "ses-5a": [{ id: "req-5", toolName: "Bash", inputPayload: JSON.stringify({ command: "git push -u origin story/fly-5-tokens" }), createdAt: ago(2040), destructiveCategory: "git-push", suggestedRule: null }],
  "ses-6a": [{ id: "req-6", toolName: "AskUserQuestion", inputPayload: JSON.stringify({ questions: QUESTIONS }), createdAt: ago(840), destructiveCategory: null, suggestedRule: null }],
  "ses-h2a": [{ id: "req-h2", toolName: "Bash", inputPayload: JSON.stringify({ command: "pnpm db:migrate --env local" }), createdAt: ago(580), destructiveCategory: null, suggestedRule: "Bash(pnpm db:migrate:*)" }],
};

const storyById = (id: string) => STORIES.find((s) => s.id === id);
const projectOf = (id: string) => PROJECTS.find((p) => p.id === id) as Project;

function fleetRow(sessionId: string, storyId: string, runStatus: string, fleetState: string, startedAgo: number, endedAgo: number | null, blockedAgo: number | null): FleetRowDto {
  const s = storyById(storyId) as StoryDto;
  const p = projectOf(s.projectId);
  const doing = (TASKS[storyId] ?? []).find((t) => t.state === "doing");
  return {
    sessionId, projectId: p.id, projectName: p.name, projectKeyPrefix: p.keyPrefix, projectStatus: "active",
    storyId, storyKey: s.key, storyTitle: s.title, storyState: s.state, runStatus, fleetState,
    startedAt: ago(startedAgo), endedAt: endedAgo === null ? null : ago(endedAgo),
    blockedSince: blockedAgo === null ? null : ago(blockedAgo),
    costUsd: endedAgo === null ? null : 3.1, tokensIn: null, tokensOut: null,
    doingTaskTitle: doing?.title ?? null,
    activity: { lines: [], truncated: false },
  };
}

const FLEET_ROWS: FleetRowDto[] = [
  fleetRow("ses-5a", "s-5", "blocked", "blocked", 2400, null, 2040),
  fleetRow("ses-6a", "s-6", "blocked", "blocked", 900, null, 840),
  fleetRow("ses-h2a", "s-h2", "blocked", "blocked", 600, null, 580),
  fleetRow("ses-3a", "s-3", "completed", "awaiting_review", 7200, 3600, null),
  fleetRow("ses-4b", "s-4", "running", "running", 1260, null, null),
  fleetRow("ses-7b", "s-7", "interrupted", "interrupted", 5400, 4200, null),
  fleetRow("ses-2a", "s-2", "completed", "completed", 86400, 82000, null),
];

function queueEntry(sessionId: string, storyId: string): BlockedQueueEntryDto {
  const req = PENDING[sessionId][0];
  const s = storyById(storyId) as StoryDto;
  const p = projectOf(s.projectId);
  return {
    requestId: req.id, toolName: req.toolName, inputPayload: req.inputPayload, createdAt: req.createdAt,
    destructiveCategory: req.destructiveCategory, suggestedRule: req.suggestedRule, sessionId,
    projectId: p.id, projectName: p.name, projectKeyPrefix: p.keyPrefix,
    storyId, storyKey: s.key, storyTitle: s.title, blockedSince: req.createdAt,
  };
}

const QUEUE: BlockedQueueEntryDto[] = [queueEntry("ses-5a", "s-5"), queueEntry("ses-6a", "s-6"), queueEntry("ses-h2a", "s-h2")];

const check = (id: string, command: string, result: string, stale = false): CheckDto => ({
  id, command, timeoutSecs: 600, result, commitSha: result === "not_run" ? null : "4219b28", stale, outputTail: null,
});
const criterion = (id: string, storyId: string, statement: string, c: CheckDto | null, rank: string): AcceptanceCriterionDto => ({
  id, storyId, statement, accepted: false, acceptedAt: null, rank, check: c,
});

const CRITERIA: Record<string, AcceptanceCriterionDto[]> = {
  "s-4": [
    criterion("c-4a", "s-4", "A Story row on the board, in the sidebar and in Needs you opens the Story view", check("k-4a", "npm test -- navigation", "passed", true), "a"),
    criterion("c-4b", "s-4", "Start and Resume leave the developer where they were", check("k-4b", "npm test -- story-board", "failed"), "b"),
    criterion("c-4c", "s-4", "Choosing a project in the sidebar replaces an open session or the fleet", check("k-4c", "npm test -- project-rail", "not_run"), "c"),
    criterion("c-4d", "s-4", "Back and ⌘[ return to the previous place", check("k-4d", "npm test -- uiStore", "passed"), "d"),
    criterion("c-4e", "s-4", "The breadcrumb names the project, the Story and the session", null, "e"),
  ],
  "s-7": [
    criterion("c-7a", "s-7", "Every screen of the M2 flow uses the new components and tokens", null, "a"),
    criterion("c-7b", "s-7", "impeccable detect reports no findings on the changed UI", check("k-7b", "npx impeccable detect src", "timed_out"), "b"),
  ],
};

const PACKET: Record<string, number> = { "s-3": 11800, "s-4": 9400, "s-5": 12100, "s-6": 8700, "s-7": 23400, "s-9": 6100, "s-10": 5200, "s-h2": 4100, "s-h3": 3900 };

const counts = (c: Partial<StoryStateCountsDto>): StoryStateCountsDto => {
  const full = { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, ...c };
  return { ...full, storiesTotal: full.shaping + full.ready + full.running + full.waitingOnYou + full.stopped + full.inReview + full.merged };
};

/** What the core's `milestone_progress` answers for the seeded Stories above (the core counts; this mirrors it). */
const PROGRESS: Record<string, MilestoneProgressDto> = {
  "p-fly": {
    milestoneId: "m-3", title: "Shaping", state: "in_progress", current: true, nextMilestoneTitle: "Board and review",
    exitTest: "Cyril takes a one-line idea to an Epic with Ready Stories, each with accepted criteria and Checks, entirely in Flywheel's dock and board.",
    counts: counts({ merged: 1, inReview: 1, running: 1, waitingOnYou: 2, stopped: 1, ready: 1, shaping: 1, dropped: 1 }),
    epicsDone: 0, epicsTotal: 2,
    epics: [
      { epicId: "e-97", key: "FLY-1", title: "Design system and a legible app", state: "in_progress", attention: null, counts: counts({ merged: 1, inReview: 1, running: 1, waitingOnYou: 2, stopped: 1 }), proposals: 0 },
      { epicId: "e-59", key: "FLY-8", title: "Epic shaping", state: "shaping", attention: "waiting_on_you", counts: counts({ ready: 1, shaping: 1, dropped: 1 }), proposals: 0 },
    ],
  },
  "p-hkw": {
    milestoneId: "m-h1", title: "Waitlist live", state: "in_progress", current: true, nextMilestoneTitle: null,
    exitTest: "A visitor can join the waitlist and gets a confirmation email.",
    counts: counts({ waitingOnYou: 1, ready: 1 }), epicsDone: 0, epicsTotal: 1,
    epics: [{ epicId: "e-h1", key: "HKW-1", title: "Waitlist", state: "in_progress", attention: null, counts: counts({ waitingOnYou: 1, ready: 1 }), proposals: 0 }],
  },
};

/** The header for a Milestone picked on the Roadmap strip: the seeded one when it is the Current one, else
 * that Milestone with the Epics and counts the seed gives it (none). */
function progressOf(projectId: string, milestoneId: string): MilestoneProgressDto | null {
  const current = PROGRESS[projectId] ?? null;
  if (milestoneId === "" || milestoneId === current?.milestoneId) return current;
  const roadmap = MILESTONES[projectId] ?? [];
  const at = roadmap.findIndex((m) => m.id === milestoneId);
  if (at < 0) return null;
  const m = roadmap[at];
  const next = roadmap.slice(at + 1).find((n) => n.state !== "done" && n.state !== "dropped");
  return {
    milestoneId: m.id, title: m.title, exitTest: m.exitTest, state: m.state, current: m.current,
    nextMilestoneTitle: next?.title ?? null, counts: counts({}), epicsDone: 0, epicsTotal: 0, epics: [],
  };
}

/**
 * Whether Epic #59's shaping session is still live (issue #124). With it live, Round 2 is Waiting on you: its
 * lamp is lit, it counts in Waiting on you and the Epic card offers Answer. Killed, the Round is still open
 * with its answer kept, the Epic reads Shaping Round waiting and offers Continue shaping.
 */
let shapingSessionLive = true;

/** Kill (or revive) Epic #59's shaping session before the first render. */
export function setShapingSessionLive(live: boolean): void {
  shapingSessionLive = live;
}

/**
 * The roadmap Round of flywheel's Roadmap (issue #133), off by default so every earlier screen keeps its shot:
 * `working` while the agent reads the Roadmap, `waiting` while it waits on three proposed changes (one already
 * rejected), `idle` once its session is gone, `holds` after a Round that said the Roadmap still holds.
 */
export type RoadmapRoundMode = "none" | "working" | "waiting" | "idle" | "holds";
let roadmapMode: RoadmapRoundMode = "none";
export function setRoadmapRound(mode: RoadmapRoundMode): void {
  roadmapMode = mode;
}

function roadmapRound(overrides: Partial<RoadmapRoundDto> = {}): RoadmapRoundDto {
  return {
    id: "rr-2", number: 2, state: "open", triggerType: "revisit", triggerLabel: "Revisit roadmap",
    waitingOnYou: roadmapMode === "waiting", sessionLive: roadmapMode !== "idle", sessionId: "ses-roadmap-2",
    postedAt: ago(1500), closedAt: null, proposalsFiled: roadmapMode === "working" ? 0 : 4, ...overrides,
  };
}

function roadmapProposal(id: string, verb: string, targetType: string, summary: string, rest: Partial<RoadmapProposalDto>): RoadmapProposalDto {
  return {
    id, projectId: "p-fly", sessionId: "ses-roadmap-2", epicId: null, verb, targetType, targetId: null, payload: {},
    rationale: null, state: "pending", createdAt: ago(1400), rejectionReason: null, stageId: null, roundId: "rr-2",
    summary, anchorMilestoneId: null, ...rest,
  };
}

const ROADMAP_PROPOSALS: RoadmapProposalDto[] = [
  roadmapProposal("rp-1", "create", "epic", "New Epic \"Roadmap Rounds\" in Milestone \"Shaping\"", {
    payload: { milestone_id: "m-3", title: "Roadmap Rounds", problem: "The Roadmap is only ever revisited by hand." },
    anchorMilestoneId: "m-3",
    rationale: "The Shaping exit test names the Roadmap, and no Epic in the Milestone covers it.",
  }),
  roadmapProposal("rp-2", "amend", "milestone", "Amend Milestone \"One-week exit test\": exit test \"Cyril runs one week of real work from Flywheel without a bare terminal.\"", {
    targetId: "m-5", anchorMilestoneId: "m-5",
    payload: { title: null, exit_test: "Cyril runs one week of real work from Flywheel without a bare terminal." },
    rationale: "It has no exit test, so nothing tells it apart from Board and review.",
  }),
  roadmapProposal("rp-3", "create", "milestone", "New Milestone \"Relay and mobile\" (exit test: A Round is answered from a phone.)", {
    payload: { title: "Relay and mobile", exit_test: "A Round is answered from a phone." },
    rationale: "Asked for twice in the Epic #59 Rounds.",
  }),
  roadmapProposal("rp-4", "retire", "milestone", "Retire Milestone \"Board and review\"", {
    targetId: "m-4", anchorMilestoneId: "m-4", state: "rejected",
    rejectionReason: "Review is the next thing after shaping",
  }),
];

function roadmapView(): RoadmapRoundViewDto {
  if (roadmapMode === "none") return { open: null, proposals: [], last: null };
  if (roadmapMode === "holds") {
    return { open: null, proposals: [], last: roadmapRound({ number: 1, state: "closed", closedAt: ago(7200), proposalsFiled: 0, sessionLive: false, waitingOnYou: false }) };
  }
  return { open: roadmapRound(), proposals: roadmapMode === "working" ? [] : ROADMAP_PROPOSALS, last: null };
}

/** Round 2 of Epic #59 while its session is held on it: the lamp and the queue entry (issue #124). With
 * the roadmap Round waiting, its lamp and queue entry too (issue #133), and with the Milestone "Board and
 * review" shaped and waiting, its Round 1 (issue #132). */
function waitingRounds(): WaitingRoundDto[] {
  const rounds: WaitingRoundDto[] = [];
  if (roadmapMode === "waiting") {
    rounds.push({
      roundId: "rr-2", roundNumber: 2, subject: "roadmap", stageKind: null, sessionId: "ses-roadmap-2",
      projectId: "p-fly", projectName: "flywheel", projectKeyPrefix: "FLY", epicId: null, epicKey: null, epicTitle: null,
      waitingSince: ago(1500), answered: 1, questions: 4,
    });
  }
  if (shapingSessionLive) {
    rounds.push({
      roundId: "r-2", roundNumber: 2, subject: "epic", stageKind: "challenge_spec", sessionId: "ses-shape-8",
      projectId: "p-fly", projectName: "flywheel", projectKeyPrefix: "FLY",
      epicId: "e-59", epicKey: "FLY-8", epicTitle: "Epic shaping",
      waitingSince: ago(1800), answered: 1, questions: 4,
    });
  }
  if (milestoneShaping === "waiting") {
    rounds.push({
      roundId: "r-m4", roundNumber: 1, subject: "milestone", stageKind: "exit_test", sessionId: "ses-shape-m4",
      projectId: "p-fly", projectName: "flywheel", projectKeyPrefix: "FLY",
      epicId: null, epicKey: null, epicTitle: null, milestoneId: "m-4", milestoneTitle: "Board and review",
      waitingSince: ago(600), answered: 1, questions: 3,
    });
  }
  return rounds;
}

/**
 * Issue #132: how far the Milestone "Board and review" (m-4) is shaped. `off` (the default, so the earlier
 * screens keep their shots): no session, no Stage. `waiting`: its shaping session is held on Round 1 of Exit
 * test, one question answered, with a proposed exit test pending and an earlier one rejected. `closable`: the
 * Round answered, the proposed exit test accepted, so nothing keeps Exit test open.
 */
let milestoneShaping: "off" | "waiting" | "closable" = "off";
export function shapeMilestoneInFixture(mode: "off" | "waiting" | "closable"): void {
  milestoneShaping = mode;
}

function milestoneShapingOf(milestoneId: string): MilestoneShapingDto | null {
  const milestone = Object.values(MILESTONES).flat().find((m) => m.id === milestoneId);
  if (!milestone) return null;
  if (milestoneId !== "m-4" || milestoneShaping === "off") {
    return { milestone, stages: [], rounds: [], proposals: [], openStageStatus: null };
  }
  const waiting = milestoneShaping === "waiting";
  const proposedText =
    "Cyril reviews a Story In review against its criteria and Checks and merges it, from Ready to Merged, without leaving Flywheel.";
  const q = (id: string, number: number, title: string, question: string, grounding: string, recommendedAnswer: string, because: string, answered: boolean) => ({
    id, number, title, question, grounding, recommendedAnswer, because,
    answer: answered ? recommendedAnswer : null, answeredWith: answered ? "recommended" : null, answeredAt: answered ? ago(420) : null,
  });
  const questions = [
    q("mq-1", 1, "Observed in the app", "Is the exit test observed in Flywheel alone, with no terminal and no GitHub tab open?",
      "Read docs/mvp-spec.md §5 (Review) and the Milestone's current exit test", "Yes",
      "\"In Flywheel alone\" is what makes it observable; a merge done on GitHub would pass it too", true),
    q("mq-2", 2, "Review, not only merge", "Should the exit test name the review against criteria and Checks, not just the merge?",
      "Read GLOSSARY.md, Acceptance criterion and Check", "Yes, name the review",
      "A merge alone is already possible in Supervised execution; the review is what this Milestone adds", !waiting),
    q("mq-3", 3, "Told apart from One-week", "Does the One-week exit test stay the only one that measures a whole week of work?",
      "Read the One-week exit test Milestone, after this one on the Roadmap", "Yes",
      "This Milestone proves one Story end to end; the week proves the loop", !waiting),
  ];
  const proposal = (id: string, text: string, rationale: string, minutes: number, rejectionReason: string | null) => ({
    id, projectId: "p-fly", sessionId: "ses-shape-m4", epicId: null, verb: "amend", targetType: "milestone", targetId: "m-4",
    payload: { title: null, exit_test: text }, rationale, state: rejectionReason ? "rejected" : "pending", createdAt: ago(minutes * 60),
    rejectionReason, decidedBy: null, stageId: "st-m4", roundId: "r-m4",
  });
  return {
    milestone: waiting ? milestone : { ...milestone, exitTest: proposedText },
    stages: [{ id: "st-m4", kind: "exit_test", state: "open", rank: 1 }],
    rounds: [{
      id: "r-m4", stageId: "st-m4", stageKind: "exit_test", number: 1,
      note: "This Round settles what \"Ready to Merged in Flywheel alone\" observes, and how it differs from the One-week exit test after it.",
      state: waiting ? "open" : "answered", waitingOnYou: waiting, postedAt: ago(600), answeredAt: waiting ? null : ago(300),
      questions,
    }],
    proposals: (waiting
      ? [
          proposal("pr-m4-1", "A Story is merged in Flywheel.", "The first Round's notes read \"merge\" as the whole Milestone.", 9, "Too thin: a merge alone already works"),
          proposal("pr-m4-2", proposedText, "Question 1 settled \"in Flywheel alone\"; the review is what this Milestone adds.", 4, null),
        ]
      : [proposal("pr-m4-1", "A Story is merged in Flywheel.", "The first Round's notes read \"merge\" as the whole Milestone.", 9, "Too thin: a merge alone already works")]) as MilestoneShapingDto["proposals"],
    openStageStatus: waiting
      ? {
          stageId: "st-m4",
          openItems: [
            { kind: "question", id: "mq-2", label: "Question 2 of Round 1 is unanswered: Review, not only merge", round: 1, number: 2, title: "Review, not only merge" },
            { kind: "question", id: "mq-3", label: "Question 3 of Round 1 is unanswered: Told apart from One-week", round: 1, number: 3, title: "Told apart from One-week" },
            { kind: "proposal", id: "pr-m4-2", label: "A Proposal to change the exit test is undecided", round: null, number: null, title: "change the exit test" },
          ],
          warnings: [],
          next: null,
          closable: false,
        }
      : { stageId: "st-m4", openItems: [], warnings: [], next: null, closable: true },
  };
}


/** Issue #129: whether Epic #59's Rounds offer ADRs (one accepted in Round 1, one open in Round 2) and its
 * card wears ADR and glossary chips. Off by default so the earlier shaping screens keep their shots. */
let withAdrs = false;
/** With ADRs on: Round 2's ordinary questions are all answered, so only its ADR is left open. */
let adrsOnlyLeft = false;
export function offerAdrsInShaping(on: boolean, onlyAdrsLeft = false): void {
  withAdrs = on;
  adrsOnlyLeft = on && onlyAdrsLeft;
}

const ADR_STORE = {
  path: "docs/adr/0005-the-board-is-the-shaping-record.md",
  text: "# The board is the shaping record\n\nEvery answer to a shaping Round, and every Proposal decided in shaping, is written to the board as it is made. A shaping session keeps no transcript of its own: a later session is rebuilt from the Epic, its Stages and its Rounds.\n\n## Consequences\n\n- A killed shaping session loses nothing: Continue shaping starts a fresh session at the open Round.\n- The agent never asks in its reply what it could post as a Round.\n- A Round outlives the session that posted it.\n",
  hardToReverse: "Every shaping session and every Story packet is rebuilt from these rows; moving them out later rewrites both builders.",
  surprising: "A reader expects an agent's questions to live in its chat transcript, as in every other agent tool.",
  losingAlternative: "Keeping the session transcript as the record and summarising it into the Epic at the end.",
  relatesTo: "ADR-0002 (the board holds work)",
};

/** Epic #59 in its Challenge Stage (issue #123): Round 1 answered, Round 2 waiting on the developer with
 * one of its four questions answered. */
export function shapingOf(epicId: string): EpicShapingDto | null {
  const epic = Object.values(EPICS).flat().find((e) => e.id === epicId);
  if (!epic) return null;
  if (epicId !== "e-59") return { epic, stages: [], rounds: [], proposals: [] };
  const adrQ = (id: string, number: number, recommendedAnswer: string, answer: string | null) => ({
    id, number, title: "Record the shaping record", question: "Record \"the board is the shaping record\" as ADR 0005?",
    grounding: "Read docs/adr/0002 and the answers to Round 1", recommendedAnswer, because: "It is the decision every later shaping session is rebuilt from",
    answer, answeredWith: answer ? "recommended" : null, answeredAt: answer ? ago(2400) : null,
    kind: "adr" as const, adr: ADR_STORE, adrProposalId: answer === "Yes" ? "pr-adr-5" : null,
  });
  const adrNext = {
    ...adrQ("q-7", 5, "Yes", null),
    title: "Record the Stage close",
    question: "Record \"only the developer closes a Stage\" as ADR 0006?",
    grounding: "Read GLOSSARY.md, Stage, and question 3 of this Round",
    because: "Nothing in shaping advances on its own, and an agent-closed Stage would be hard to take back",
    adr: {
      path: "docs/adr/0006-only-the-developer-closes-a-stage.md",
      text: "# Only the developer closes a Stage\n\nA Stage is closable once nothing in it is open: no unanswered question and no undecided Proposal. Even then the developer closes it. The close button lists whatever is still open, and nothing advances on its own.\n\n## Consequences\n\n- Closing a Stage starts the next Stage's session.\n- An agent that finds its frontier empty says so and waits.\n",
      hardToReverse: "Closing a Stage starts the next Stage's session; an agent able to close one could run the whole shaping unattended.",
      surprising: "The agent knows first when the frontier is empty, yet it may not act on it.",
      losingAlternative: "Closing the Stage on its own once its frontier is empty and every Proposal is decided.",
      relatesTo: null,
    },
  };
  const accepted = (id: string, targetType: string, payload: Record<string, unknown>) => ({
    id, projectId: "p-fly", sessionId: "ses-shape-8", epicId: "e-59", verb: "create", targetType, targetId: null, payload,
    rationale: "Offered as question 3 of Round 1 and accepted there", state: "accepted", createdAt: ago(2400),
    rejectionReason: null, stageId: "st-1", roundId: "r-1",
  });
  const q = (
    id: string,
    number: number,
    title: string,
    question: string,
    grounding: string,
    recommendedAnswer: string,
    because: string,
    answer: string | null = null,
    answeredWith: string | null = null,
  ) => ({ id, number, title, question, grounding, recommendedAnswer, because, answer, answeredWith, answeredAt: answer ? ago(2400) : null });
  // Issue #125: two spec changes waiting on the Epic card, and one the developer turned down.
  const proposal = (id: string, field: string, text: string, rationale: string, minutes: number, rejectionReason: string | null = null) => ({
    id, projectId: "p-fly", sessionId: "ses-shape-8", epicId: "e-59", verb: "amend", targetType: "epic", targetId: "e-59",
    payload: { field, text }, rationale, state: rejectionReason ? "rejected" : "pending", createdAt: ago(minutes * 60),
    rejectionReason, stageId: "st-1", roundId: "r-1",
  });
  return withOpenStageStatus({
    epic,
    adrLinks: withAdrs ? ["docs/adr/0002-repo-holds-code-knowledge-board-holds-work.md"] : [],
    acceptedKnowledge: withAdrs
      ? [
          accepted("pr-adr-5", "adr", { path: ADR_STORE.path, text: ADR_STORE.text }),
          accepted("pr-term-round", "glossary_term", { term: "Round", definition: "A batch of numbered questions an agent asks during a Stage" }),
        ]
      : [],
    stages: [{ id: "st-1", kind: "challenge_spec", state: "open", rank: 1 }],
    openStageStatus: null,
    proposals: [
      proposal("pr-1", "scope", "The board as the shaping surface: the Epic card with its fields, ghost-card Proposals decided where they land, and the Round dock with pre-filled recommended answers and Accept all recommended. Every answer is written to the board as it is made.", "Round 1 settled the board as the surface and that answers are written as they are given; the Scope should say both.", 40),
      proposal("pr-2", "exit_test", "A one-line idea becomes an Epic with Ready Stories, each with accepted criteria and Checks, entirely in Flywheel; a killed shaping session resumes at the open Round.", "Question 2 of Round 1 made durability part of the Epic's promise.", 35),
      proposal("pr-3", "out_of_scope", "Milestone and Roadmap shaping, execution Proposals, and any chat transcript of the session.", "Round 1 ruled out a transcript as the record.", 50, "A transcript is already ruled out by the Problem"),
    ],
    rounds: [
      {
        id: "r-1", stageId: "st-1", stageKind: "challenge_spec", number: 1, state: "answered", waitingOnYou: false,
        note: "This Round settles who shapes and where: the surface the developer answers on, and what a refusal may cost.",
        postedAt: ago(3600), answeredAt: ago(3000),
        questions: [
          q("q-1", 1, "Shaping surface", "Is the board the shaping surface, with the agent's questions in a dock beside the Epic card?", "Read docs/mvp-spec.md §3, Screen", "Yes: the Epic card on the board, the Rounds in a dock beside it", "The spec rules out a chat transcript as the record", "Yes: the Epic card on the board, the Rounds in a dock beside it", "recommended"),
          q("q-2", 2, "What a refusal costs", "When a shaping session dies mid-Round, may it lose the answers already given?", "Read the Epic's Problem, and Story #124", "No: every answer is written to the board as it is made", "A refusal lost the whole challenge in v0.1", "No. Every answer is on the board the moment it is given, and the next session starts from them", "own"),
          ...(withAdrs ? [adrQ("q-2b", 3, "Yes", "Yes")] : []),
        ],
      },
      {
        id: "r-2", stageId: "st-1", stageKind: "challenge_spec", number: 2, state: "open", waitingOnYou: shapingSessionLive,
        note: "With the surface settled, this Round tightens the scope: how answers are given, what Accept all may touch, and how the Stage ends.",
        postedAt: ago(1800), answeredAt: null,
        questions: [
          q("q-3", 1, "Pre-filled answers", "Should each question arrive with the agent's recommended answer already filled in, so accepting it is one click?", "Read docs/mvp-spec.md §3, The dock", "Yes, pre-filled, with a one-line reason under it", "Most answers in a Round are the recommendation", "Yes, pre-filled, with a one-line reason under it", "recommended"),
          q("q-4", 2, "What Accept all covers", "May Accept all recommended also accept the Round's pending Proposals?", "Read Epic #59, Decided in slicing", "No: questions only; each Proposal is decided on its own ghost card", "A Proposal changes the board and deserves its own look"),
          q("q-5", 3, "Closing the Stage", "Does the Challenge Stage close on its own once its frontier is empty?", "Read GLOSSARY.md, Stage", "No: the developer closes every Stage, and the button lists what is still open", "Nothing in shaping advances on its own"),
          q("q-6", 4, "Exit test", "Is \"a one-line idea becomes an Epic with Ready Stories, entirely in Flywheel\" the Epic's exit test?", "Read Epic #59, Exit test", "Yes, plus: a killed shaping session resumes at the open Round", "Durability is half of what v0.1 got wrong"),
          ...(withAdrs ? [adrNext] : []),
        ].map((question) =>
          // "only ADRs left": every ordinary question of Round 2 answered with its recommendation.
          adrsOnlyLeft && question.answer === null && !("kind" in question)
            ? { ...question, answer: question.recommendedAnswer, answeredWith: "recommended", answeredAt: ago(600) }
            : question,
        ),
      },
    ],
  });
}

/**
 * Issue #126: what keeps the open Stage open, worked out as the core works it from the same data, so the
 * Stage bar always agrees with the dock: the open Round's unanswered questions (an ADR question included),
 * then the pending spec changes.
 */
function withOpenStageStatus(shaping: EpicShapingDto): EpicShapingDto {
  const open = shaping.stages.find((s) => s.state === "open");
  if (!open) return shaping;
  const questions = shaping.rounds
    .filter((r) => r.stageId === open.id)
    .flatMap((r) =>
      r.questions
        .filter((q) => q.answer === null)
        .map((q) => ({
          kind: "question", id: q.id, label: `Question ${q.number} of Round ${r.number} is unanswered: ${q.title}`,
          round: r.number, number: q.number, title: q.title,
        })),
    );
  const proposals = shaping.proposals
    .filter((p) => p.state === "pending" && p.stageId === open.id)
    .map((p) => {
      const field = String((p.payload as Record<string, unknown>).field ?? "");
      const labels: Record<string, string> = { problem: "Problem", scope: "Scope", out_of_scope: "Out of scope", exit_test: "Exit test" };
      const label = labels[field] ?? field;
      return { kind: "proposal", id: p.id, label: `A Proposal to change the ${label} is undecided`, round: null, number: null, title: `change the ${label}` };
    });
  const openItems = [...questions, ...proposals];
  return {
    ...shaping,
    openStageStatus: { stageId: open.id, openItems, warnings: ["The Exit test is not written yet"], next: "slice", closable: openItems.length === 0 },
  };
}

type Args = Record<string, unknown> | undefined;
const arg = (args: Args, name: string) => (args?.[name] as string | undefined) ?? "";

/**
 * Issue #156: two more Needs-you items for the Needs-you screens, off by default so every earlier screen keeps
 * its shot: an Epic whose Stories are all Merged asks to confirm its exit test, and a Story whose worktree went
 * missing asks to recreate it.
 */
let needsYouExtras = false;
export function setNeedsYouExtras(on: boolean): void {
  needsYouExtras = on;
}

/**
 * Issue #162: Proposals running Stories filed, awaiting triage, off by default so every earlier screen keeps its
 * shot. Three land on Epic FLY-1, one New Epic on the Roadmap.
 */
let triageOn = false;
export function setTriageInFixture(on: boolean): void {
  triageOn = on;
}

function triageProposal(
  id: string, minutesAgo: number, verb: string, targetType: string, epicId: string | null, payload: Record<string, unknown>,
  rationale: string, evidence: string, filer: string, extra: Partial<TriageProposalDto> = {},
): TriageProposalDto {
  const story = storyById(filer) as StoryDto;
  const epic = epicId ? Object.values(EPICS).flat().find((e) => e.id === epicId) ?? null : null;
  return {
    proposal: {
      id, projectId: "p-fly", sessionId: `ses-${filer}`, epicId, verb, targetType, targetId: null, payload, rationale,
      state: "pending", createdAt: ago(minutesAgo * 60), rejectionReason: null, stageId: null, roundId: null, evidence,
    },
    storyId: story.id, storyKey: story.key, storyTitle: story.title,
    epicKey: epic?.key ?? null, epicTitle: epic?.title ?? null, milestoneTitle: null,
    targetKey: null, targetTitle: null, reorder: null, ...extra,
  };
}

/** Issue #165: one more New Story on FLY-1 that repeats tp-1, flagged as its duplicate. Off by default. */
let duplicateOn = false;
export function setTriageDuplicateInFixture(on: boolean): void {
  duplicateOn = on;
}

function triageList(): TriageProposalDto[] {
  if (!triageOn) return [];
  const duplicate = duplicateOn
    ? [
        triageProposal("tp-5", 12, "create", "story", "e-97",
          { title: "Keyboard shortcuts for the roster's row actions", description: "Row actions from the keyboard." },
          "Resuming a Stopped Story took four clicks and no key.",
          "src/board/StoryBoard.tsx:640 Resume is a click target only", "s-6",
          { duplicate: { proposalId: "tp-1", title: "Keyboard shortcuts for the roster's row actions", storyKey: (storyById("s-4") as StoryDto).key } }),
      ]
    : [];
  return [
    ...triageListBase(),
    ...duplicate,
  ].sort((a, b) => Number(a.proposal.epicId === null) - Number(b.proposal.epicId === null));
}

function triageListBase(): TriageProposalDto[] {
  return [
    triageProposal("tp-1", 95, "create", "story", "e-97",
      { title: "Keyboard shortcuts for the roster's row actions", description: "Start, Resume and Open session reachable from the keyboard on a focused row, with the keys shown in their tooltips.",
        criteria: [
          { statement: "S, R and O on a focused row start, resume and open its session", check: "npm --prefix packages/desktop test -- story-board" },
          { statement: "Each row action's tooltip names its key" },
        ] },
      "Every row action needs the mouse today; the click model asks for the keyboard as an accelerator.",
      "src/board/StoryBoard.tsx:612 rows take no key; DESIGN.md \"The click model\"", "s-4"),
    triageProposal("tp-2", 70, "reorder", "story", "e-97", { rank: "cm" },
      "Restyling every screen depends on the shared components FLY-5 is building now.",
      "FLY-7's first session imported Badge variants that do not exist yet", "s-5",
      { targetKey: "FLY-7", targetTitle: "Restyle every screen of the M2 flow in the new world", reorder: { nowAfter: "FLY-6", proposedAfter: "FLY-5" } }),
    triageProposal("tp-3", 40, "create", "story", "e-97",
      { title: "Measure the board's first paint on a 40-Story project", description: null,
        criteria: [{ statement: "The board paints a 40-Story project in under 200 ms", check: "npm --prefix packages/desktop test -- story-board-virtual" }] },
      "The virtualised roster has never been timed against a large project.",
      "no test under src/board/__tests__ seeds more than 12 Stories", "s-6"),
    triageProposal("tp-4", 25, "create", "epic", null,
      { milestone_id: "m-4", title: "Keyboard-first supervision", problem: "Answering, resuming and triaging all need the mouse; a developer supervising many agents lives on the keyboard." },
      "Three Stories in this Milestone found the same gap; it is bigger than one Story.",
      "FLY-4, FLY-5 and FLY-6 each filed a keyboard follow-up", "s-5", { milestoneTitle: "Board and review" }),
  ];
}

/**
 * Issue #166: two New Stories from execution, accepted and in Shaping in FLY-1, whose shaping is closed. FLY-12
 * carries its criteria, so it is offered Make Ready; FLY-13 has none yet, so Make Ready waits. Off by default so
 * every earlier screen keeps its shot.
 */
const MADE_FROM_EXECUTION: StoryDto[] = [
  story("s-12", "p-fly", "e-97", "FLY-12", "Keyboard shortcuts for the roster's row actions", "shaping", "g"),
  story("s-13", "p-fly", "e-97", "FLY-13", "Measure the board's first paint on a 40-Story project", "shaping", "h"),
];
export function setMakeReadyInFixture(on: boolean): void {
  for (const s of MADE_FROM_EXECUTION) {
    const at = STORIES.findIndex((x) => x.id === s.id);
    if (at >= 0) STORIES.splice(at, 1);
  }
  delete CRITERIA["s-12"];
  if (!on) return;
  STORIES.splice(STORIES.findIndex((x) => x.id === "s-9"), 0, ...MADE_FROM_EXECUTION.map((s) => ({ ...s })));
  CRITIQUE_DESCRIPTIONS.forEach(([id, text]) => {
    const s = STORIES.find((x) => x.id === id);
    if (s) s.description = text;
  });
  CRITERIA["s-12"] = [
    criterion("c-12a", "s-12", "S, R and O on a focused row start, resume and open its session", check("k-12a", "npm --prefix packages/desktop test -- story-board", "not_run"), "a"),
    criterion("c-12b", "s-12", "Each row action's tooltip names its key", null, "b"),
  ];
}
const CRITIQUE_DESCRIPTIONS: [string, string][] = [
  ["s-12", "Start, Resume and Open session reachable from the keyboard on a focused row, with the keys shown in their tooltips."],
];

/** An Epic row's "n Proposals" (issue #162), from the same list the drawer reads. */
function triageMarker(epicId: string): number {
  return triageList().filter((t) => t.proposal.epicId === epicId).length;
}

/**
 * Issue #163: two judged-on changes for the judged-on screens, off by default: FLY-5's agent amends one of its
 * criteria with a new Check command, and FLY-4's agent rewrites Epic FLY-1's Scope.
 */
let judgedOn = false;
export function setJudgedOnInFixture(on: boolean): void {
  judgedOn = on;
}

const NEEDS_YOU_RANK: Record<string, number> = {
  gated_action: 1, permission_request: 1, question: 1, stopped: 2, review: 3, judged_on: 3, confirm_exit_test: 4, proposals: 5,
  shaping_round: 6,
};

function needsYouItem(kind: NeedsYouItemDto["kind"], id: string, since: string, record: NeedsYouItemDto["record"], extra: Partial<NeedsYouItemDto> = {}): NeedsYouItemDto {
  return {
    kind, rank: NEEDS_YOU_RANK[kind], id, since, record, sessionId: null, request: null, endingReason: null,
    missingWorktree: false, doingTaskTitle: null, exitTest: null, milestoneTitle: null, round: null, conflicts: [], proposals: null, judgedOn: null, ...extra,
  };
}

const storyRecord = (storyId: string): NeedsYouItemDto["record"] => {
  const s = storyById(storyId) as StoryDto;
  return { kind: "story", id: s.id, key: s.key, title: s.title, state: null };
};

/** What the core's `needs_you_list` answers for the seeded board (the core ranks; this mirrors it). */
function needsYouOf(projectId: string): NeedsYouItemDto[] {
  const items: NeedsYouItemDto[] = [];
  for (const entry of QUEUE.filter((q) => q.projectId === projectId)) {
    const kind = entry.toolName === "AskUserQuestion" ? "question" : entry.destructiveCategory ? "gated_action" : "permission_request";
    items.push(needsYouItem(kind, entry.requestId, entry.createdAt, storyRecord(entry.storyId), {
      sessionId: entry.sessionId,
      request: { id: entry.requestId, toolName: entry.toolName, inputPayload: entry.inputPayload, destructiveCategory: entry.destructiveCategory, suggestedRule: entry.suggestedRule },
    }));
  }
  if (projectId === "p-fly") {
    items.push(needsYouItem("stopped", "s-7", ago(4200), storyRecord("s-7"), {
      sessionId: "ses-7b", endingReason: "usage_limit", doingTaskTitle: "Restyle the board's Story rows",
    }));
    items.push(needsYouItem("review", "s-3", ago(3600), storyRecord("s-3"), { conflicts: reviewConflicts() }));
    if (judgedOn) {
      items.push(needsYouItem("judged_on", "pj-1", ago(2400), storyRecord("s-5"), {
        judgedOn: {
          proposalId: "pj-1", change: "amend_criterion", criterionId: "c-5a", field: null,
          before: "Every colour token has one meaning, and its contrast is asserted by a test",
          after: "Every colour token has one meaning, and its contrast is asserted in light and in dark by a test",
          checkBefore: "npm --prefix packages/desktop test -- tokens",
          checkAfter: "npm --prefix packages/desktop test -- tokens contrast",
          payload: { criterion_id: "c-5a", statement: "Every colour token has one meaning, and its contrast is asserted in light and in dark by a test", check_command: "npm --prefix packages/desktop test -- tokens contrast" },
          rationale: "The dark theme lifts the brand hue, so a light-only assertion misses its contrast.",
          evidence: "src/styles/tokens.css:41 --primary differs under .dark",
          filedBy: "FLY-5",
        },
      }));
      items.push(needsYouItem("judged_on", "pj-2", ago(2000), { kind: "epic", id: "e-97", key: "FLY-1", title: "Design system and a legible app", state: null }, {
        judgedOn: {
          proposalId: "pj-2", change: "amend_epic_spec", criterionId: null, field: "scope",
          before: "The board, the roster and the session feed, restyled in the new world.",
          after: "The board, the roster, the session feed and the review card, restyled in the new world.",
          checkBefore: null, checkAfter: null,
          payload: { field: "scope", text: "The board, the roster, the session feed and the review card, restyled in the new world." },
          rationale: "The review card shipped after the scope was written and still wears the old look.",
          evidence: "src/review/ReviewCard.tsx uses the old chip classes",
          filedBy: "FLY-4",
        },
      }));
    }
    if (needsYouExtras) {
      items.push(needsYouItem("stopped", "s-6", ago(5000), storyRecord("s-6"), { missingWorktree: true }));
      items.push(needsYouItem("confirm_exit_test", "e-60", ago(9000),
        { kind: "epic", id: "e-60", key: "FLY-12", title: "Milestone and Roadmap shaping", state: null },
        { exitTest: "Cyril shapes a Milestone's exit test and has a roadmap Round propose a change, all in Flywheel.", milestoneTitle: "Shaping" }));
    }
    const triage = triageList();
    if (triage.length > 0) {
      const stories = new Set(triage.map((t) => t.storyId)).size;
      const epics = new Set(triage.map((t) => t.proposal.epicId).filter(Boolean)).size;
      const oldest = triage.map((t) => t.proposal.createdAt).sort()[0];
      items.push(needsYouItem("proposals", "p-fly", oldest, { kind: "project", id: "p-fly", key: null, title: "", state: null }, {
        proposals: { count: triage.length, stories, epics, roadmap: triage.some((t) => t.proposal.epicId === null) },
      }));
    }
    for (const round of waitingRounds().filter((r) => r.projectId === projectId)) {
      const record: NeedsYouItemDto["record"] = round.subject === "roadmap"
        ? { kind: "roadmap", id: null, key: null, title: "", state: null }
        : round.subject === "milestone"
          ? { kind: "milestone", id: round.milestoneId ?? null, key: null, title: round.milestoneTitle ?? "", state: null }
          : { kind: "epic", id: round.epicId, key: round.epicKey, title: round.epicTitle ?? "", state: null };
      items.push(needsYouItem("shaping_round", round.roundId, round.waitingSince, record, {
        round: { roundId: round.roundId, roundNumber: round.roundNumber, subject: round.subject as "epic", waitingOnYou: true, answered: round.answered, questions: round.questions },
      }));
    }
    // A Round no live session works waits too: Epic shaping's, once its session is gone; the roadmap's, idle.
    if (!shapingSessionLive) {
      items.push(needsYouItem("shaping_round", "r-2", ago(1800), { kind: "epic", id: "e-59", key: "FLY-8", title: "Epic shaping", state: null }, {
        round: { roundId: "r-2", roundNumber: 2, subject: "epic", waitingOnYou: false, answered: 1, questions: 4 },
      }));
    }
    if (roadmapMode === "idle") {
      items.push(needsYouItem("shaping_round", "rr-2", ago(1500), { kind: "roadmap", id: null, key: null, title: "", state: null }, {
        round: { roundId: "rr-2", roundNumber: 2, subject: "roadmap", waitingOnYou: false, answered: 1, questions: 4 },
      }));
    }
  }
  return items.sort((a, b) => a.rank - b.rank || a.since.localeCompare(b.since) || a.id.localeCompare(b.id));
}

function window_(entries: Record<string, unknown>[], offset: number, limit: number) {
  return { entries: entries.slice(offset, offset + limit), offset, limit, total: entries.length };
}

/**
 * FLY-3's review card (issue #155). `judging`: one Check failed and its output tail, a pre-ticked criterion
 * not accepted yet, one accepted. `override`: every criterion accepted, the Check still failing. `ready`:
 * every criterion accepted and every Check passed. `decisions` (issue #161): `ready`, with the branch's ADR
 * and glossary changes: a new ADR with its hand-off bar lines and a related live ADR, one accepted in shaping,
 * one without bar lines, an edited ADR and the glossary. `rebase` (issue #158): `ready`, but the branch
 * conflicts with main in two files, so it reads Rebase needed. `adr_flags` (issue #164): `ready`, with the
 * edited ADR flagged "wording or supersede?", one new ADR flagged to renumber and missing its superseded ADR's
 * Status line, one marked Wrong decision and one marked Not an ADR, so Merge is held and the composer lists the
 * ADR review points.
 */
type ReviewMode = "judging" | "override" | "ready" | "decisions" | "rebase" | "adr_flags";
let reviewMode: ReviewMode = "judging";
/** Issue #157: FLY-3 handed off with its last Task still open, so the review card warns "1 Task not done". */
let reviewTaskOpen = false;
export function setReviewInFixture(mode: ReviewMode, { taskOpen = false } = {}): void {
  reviewMode = mode;
  reviewTaskOpen = taskOpen;
}

function tasksOf(storyId: string): TaskDto[] {
  const tasks = TASKS[storyId] ?? [];
  return reviewTaskOpen && storyId === "s-3" ? tasks.map((t) => (t.id === "t-3c" ? { ...t, state: "open" } : t)) : tasks;
}

const KEEP_DECISION = { kind: "keep" as const, whatIsWrong: null, shouldBe: null };

const REVIEW_DECISIONS: DecisionChangeDto[] = [
  {
    kind: "adr", path: "docs/adr/0004-tailwind-and-shadcn-ui-for-the-desktop-ui.md", oldPath: null, status: "M",
    added: 3, removed: 1, newAdr: null, flags: [],
  },
  {
    kind: "adr", path: "docs/adr/0010-the-andon-is-the-visual-world.md", oldPath: null, status: "A", added: 41, removed: 0,
    newAdr: {
      title: "The Andon is the visual world: one loud colour means a person is needed",
      barLines: {
        hardToReverse: "Every screen, token and contrast test is built on its four tones",
        surprising: "A developer tool with no green, where a passed Check reads from its icon and word",
        losingAlternative: "The Ledger direction: a quiet document world with no signal hue",
        relatesTo: "ADR-0004",
      },
      barLinesFrom: "handoff",
      related: [{ path: "docs/adr/0004-tailwind-and-shadcn-ui-for-the-desktop-ui.md", title: "Tailwind and shadcn/ui for the desktop UI" }],
      proposalId: null,
      decision: KEEP_DECISION,
    },
    flags: [],
  },
  {
    kind: "adr", path: "docs/adr/0011-barlow-for-reading.md", oldPath: null, status: "A", added: 18, removed: 0,
    newAdr: {
      title: "Barlow for reading, JetBrains Mono for keys and commands",
      barLines: {
        hardToReverse: "Every type step and the self-hosted font files depend on it",
        surprising: "A DIN-descended face rather than the platform sans",
        losingAlternative: "SF Pro through system-ui",
        relatesTo: null,
      },
      barLinesFrom: "shaping",
      related: [],
      proposalId: "p-adr-11",
      decision: KEEP_DECISION,
    },
    flags: [],
  },
  {
    kind: "adr", path: "docs/adr/0012-direction-file.md", oldPath: null, status: "A", added: 9, removed: 0,
    newAdr: {
      title: "The picked direction lives in direction.md", barLines: null, barLinesFrom: null, related: [], proposalId: null,
      decision: KEEP_DECISION,
    },
    flags: [],
  },
  { kind: "glossary", path: "GLOSSARY.md", oldPath: null, status: "M", added: 6, removed: 0, newAdr: null, flags: [] },
];

/** `adr_flags` (issue #164): the same changes, flagged and decided. */
const FLAGGED_DECISIONS: DecisionChangeDto[] = [
  {
    ...REVIEW_DECISIONS[0],
    flags: [{ kind: "wording_or_supersede", number: null, takenBy: null, baseBranch: null, superseded: null }],
  },
  {
    ...REVIEW_DECISIONS[1],
    flags: [
      { kind: "renumber", number: 10, takenBy: "docs/adr/0010-a-review-is-a-board-record.md", baseBranch: "main", superseded: null },
      { kind: "supersession_line_missing", number: 4, takenBy: null, baseBranch: null, superseded: "docs/adr/0004-tailwind-and-shadcn-ui-for-the-desktop-ui.md" },
    ],
  },
  {
    ...REVIEW_DECISIONS[2],
    newAdr: REVIEW_DECISIONS[2].newAdr && {
      ...REVIEW_DECISIONS[2].newAdr,
      decision: {
        kind: "wrong_decision",
        whatIsWrong: "Barlow's figures are not tabular, so counts jitter as they change",
        shouldBe: "Barlow for prose, with tabular figures from JetBrains Mono wherever a count changes",
      },
    },
  },
  {
    ...REVIEW_DECISIONS[3],
    newAdr: REVIEW_DECISIONS[3].newAdr && { ...REVIEW_DECISIONS[3].newAdr, decision: { kind: "not_an_adr", whatIsWrong: null, shouldBe: null } },
  },
  REVIEW_DECISIONS[4],
];

/** The ADR review points the core writes for `adr_flags`, in its order: by ADR path. */
const FLAGGED_POINTS = [
  "Renumber `docs/adr/0010-the-andon-is-the-visual-world.md`: ADR-0010 is already taken on main by `docs/adr/0010-a-review-is-a-board-record.md`.",
  "Add a `Status: superseded by ADR-0010` line to `docs/adr/0004-tailwind-and-shadcn-ui-for-the-desktop-ui.md`, which `docs/adr/0010-the-andon-is-the-visual-world.md` supersedes.",
  "Wrong decision in `docs/adr/0011-barlow-for-reading.md`: Barlow's figures are not tabular, so counts jitter as they change. It should be: Barlow for prose, with tabular figures from JetBrains Mono wherever a count changes. Change the code and the ADR.",
  "Delete `docs/adr/0012-direction-file.md`; keep the decision out of docs/adr.",
];

/** `rebase`: the two files FLY-3's branch conflicts with main in. */
function reviewConflicts(): string[] {
  return reviewMode === "rebase" ? ["DESIGN.md", "packages/desktop/src/theme/tokens.css"] : [];
}

function reviewCheck(id: string, criterionId: string, command: string, result: string, outputTail: string | null = null): ReviewCheckDto {
  return { checkId: id, criterionId, command, result, stale: false, commitSha: "9f3c2ab", outputTail, objections: [] };
}

/** FLY-3's changed files (issue #157): the first two with real patches, the rest folded under the count. */
const REVIEW_FILES: ReviewFileDto[] = [
  { path: "docs/design/direction.md", oldPath: null, status: "M", added: 6, removed: 2, binary: false },
  { path: "packages/desktop/src/theme/tokens.ts", oldPath: null, status: "M", added: 3, removed: 1, binary: false },
  { path: "docs/design/directions/andon.png", oldPath: null, status: "A", added: null, removed: null, binary: true },
];

const REVIEW_PATCHES: Record<string, string> = {
  "docs/design/direction.md": [
    "diff --git a/docs/design/direction.md b/docs/design/direction.md",
    "index 3b1c0de..9f3c2ab 100644",
    "--- a/docs/design/direction.md",
    "+++ b/docs/design/direction.md",
    "@@ -12,8 +12,12 @@ Three directions were rendered over the M3 backlog, light and dark.",
    " ## The pick",
    " ",
    "-Undecided: the three directions are rendered and waiting on Cyril.",
    "-The critique screens are in docs/design/critique-2026-10/.",
    "+**The Andon.** A neutral grey floor carries white cards; a graphite strip is the line's",
    "+hardware; one loud colour, safety yellow, means a person is needed.",
    "+",
    "+Two changes to the rendered direction:",
    "+1. the brand blue is spent on an agent at work and on your next action, not only on progress;",
    "+2. subtle text is lifted on dark until it clears 4.5:1 on the card.",
    " ",
    " ## Tokens",
    " ",
    "",
  ].join("\n"),
  "packages/desktop/src/theme/tokens.ts": [
    "diff --git a/packages/desktop/src/theme/tokens.ts b/packages/desktop/src/theme/tokens.ts",
    "index 41d07e2..9f3c2ab 100644",
    "--- a/packages/desktop/src/theme/tokens.ts",
    "+++ b/packages/desktop/src/theme/tokens.ts",
    "@@ -58,7 +58,9 @@ export const DARK: Palette = {",
    "   accentForeground: \"#eceef1\",",
    "   border: \"#2c2f36\",",
    "-  subtleForeground: \"#6f7580\",",
    "+  // Lifted from #6f7580 (3.6:1 on the card) to clear 4.5:1.",
    "+  subtleForeground: \"#80868f\",",
    "+  input: \"#6e7480\",",
    "   ring: \"#8ea8ff\",",
    "",
  ].join("\n"),
};

/** A realistic Check tail: long, with its failure summary at the end. */
const CONTRAST_TAIL = [
  "> desktop@0.1.0 test",
  "> vitest run contrast",
  "",
  " RUN  v5.0.0 packages/desktop",
  "",
  ...Array.from({ length: 48 }, (_, i) => ` ✓ src/theme/__tests__/contrast.test.ts > light > role ${i + 1} meets its floor`),
  " × src/theme/__tests__/contrast.test.ts > dark > subtle-foreground on card",
  "   → expected 4.31 to be greater than or equal to 4.5",
  "",
  " Test Files  1 failed (1)",
  "      Tests  1 failed | 48 passed (49)",
].join("\n");

function reviewOf(storyId: string): StoryReviewDto {
  const ready = reviewMode === "ready" || reviewMode === "decisions" || reviewMode === "rebase" || reviewMode === "adr_flags";
  const conflicts = reviewConflicts();
  const accepted = reviewMode !== "judging";
  const renders = reviewCheck("k-3a", "c-3a", "test -f docs/design/directions/andon.html", "passed");
  const contrast = ready
    ? reviewCheck("k-3b", "c-3b", "npm test -- contrast", "passed")
    : {
        ...reviewCheck("k-3b", "c-3b", "npm test -- contrast", "failed", CONTRAST_TAIL),
        objections: [
          {
            why: "subtle-foreground is never drawn on the dark card, only on the floor, where it measures 4.6:1; the Check tests a pair the app does not use.",
            command: "npm test -- contrast",
          },
        ],
      };
  return {
    storyId,
    storyKey: "FLY-3",
    storyState: "in_review",
    headSha: "9f3c2ab",
    review: {
      id: "r-3", openedAt: ago(3000), baseSha: "41d07e2", headSha: "9f3c2ab",
      files: 3, added: 9, removed: 3, openTasks: reviewTaskOpen ? 1 : 0, checkObjections: [], adrNotes: [],
    },
    criteria: [
      { id: "c-3a", statement: "Each of the three directions is rendered from code over the M3 backlog, light and dark", accepted, acceptedAt: accepted ? ago(60) : null, preTicked: true, check: renders },
      { id: "c-3b", statement: "Every text role measures at least 4.5:1 in both schemes", accepted: true, acceptedAt: ago(120), preTicked: ready, check: contrast },
      { id: "c-3c", statement: "The pick and its two changes are recorded in direction.md", accepted, acceptedAt: accepted ? ago(30) : null, preTicked: false, check: null },
    ],
    openTasks: reviewTaskOpen ? 1 : 0,
    failingChecks: ready ? [] : [contrast],
    liveSession: false,
    uncommitted: [],
    decisions: reviewMode === "decisions" ? REVIEW_DECISIONS : reviewMode === "adr_flags" ? FLAGGED_DECISIONS : [],
    conflicts,
    rebaseComment: conflicts.length
      ? `Rebase needed: merging into main would conflict in ${conflicts.join(", ")}. Rebase this branch on main, resolve those conflicts, and re-run the Checks before handing off.`
      : null,
    files: REVIEW_FILES,
    adrReviewPoints: reviewMode === "adr_flags" ? FLAGGED_POINTS : [],
  };
}

/** An Epic in Shaping's marker (issue #159): its open Stage and that Stage's latest Round, from its shaping. */
function shapingMarkerOf(epicId: string) {
  const shaping = shapingOf(epicId);
  const stage = shaping?.stages.find((s) => s.state === "open");
  if (!stage) return { stageKind: null, stageRank: null, roundNumber: null, roundOpen: false, answered: 0, questions: 0 };
  const round = shaping?.rounds.filter((r) => r.stageId === stage.id).sort((a, b) => b.number - a.number)[0];
  return {
    stageKind: stage.kind,
    stageRank: stage.rank,
    roundNumber: round?.number ?? null,
    roundOpen: round?.state === "open",
    answered: round?.questions.filter((q) => q.answer !== null).length ?? 0,
    questions: round?.questions.length ?? 0,
  };
}

/** Make Ready's offer (issue #166), as the core works it out: a Shaping Story of an Epic whose shaping is
 * closed is offered it, held back while it has no criterion. */
function makeReadyOffer(storyId: string): { offered: boolean; refusal: string | null } {
  const s = STORIES.find((x) => x.id === storyId);
  const epic = s ? Object.values(EPICS).flat().find((e) => e.id === s.epicId) : undefined;
  const offered = s?.state === "shaping" && (epic?.state === "ready" || epic?.state === "in_progress");
  if (!s || !offered) return { offered: false, refusal: null };
  const refusal = (CRITERIA[s.id] ?? []).length === 0 ? `${s.key} has no Acceptance criterion yet; a Story needs one before it is Ready` : null;
  return { offered: true, refusal };
}

/** The roster's one read (issue #159): every Story row of a Milestone, worked out from the same seeded
 * sessions, Tasks, criteria and review the Story view reads, so the board and the Story never disagree. */
function rosterRowsOf(milestoneId: string) {
  const epicIds = new Set((EPICS[milestoneId] ?? []).map((e) => e.id));
  const waiting = new Set(["s-5", "s-6", "s-h2"]);
  return STORIES.filter((s) => epicIds.has(s.epicId)).map((s) => {
    const stopped = answer("story_stopped", { storyId: s.id }) as { endingReason: string } | null;
    const tasks = TASKS[s.id] ?? [];
    const criteria = CRITERIA[s.id] ?? [];
    const live = s.state === "running" ? (RUNS[s.id] ?? []).find((r) => r.endedAt === null) : undefined;
    const review = s.state === "in_review" ? reviewOf(s.id).review : null;
    return {
      storyId: s.id,
      attention: stopped ? "stopped" : live && waiting.has(s.id) ? "waiting_on_you" : null,
      endingReason: stopped?.endingReason ?? null,
      liveSessionId: live?.id ?? null,
      doingTaskTitle: tasks.find((t) => t.state === "doing")?.title ?? null,
      criteriaMet: criteria.filter((c) => c.accepted || (c.check?.result === "passed" && !c.check.stale)).length,
      criteriaTotal: criteria.length,
      tasksDone: tasks.filter((t) => t.state === "done").length,
      tasksTotal: tasks.filter((t) => t.state !== "dropped").length,
      review: review ? { files: review.files, added: review.added, removed: review.removed } : null,
      canMakeReady: makeReadyOffer(s.id).offered && makeReadyOffer(s.id).refusal === null,
    };
  });
}

/** Answer one IPC command from the seeded data. Writes are accepted and change nothing. */
export function answer(cmd: string, args: Args): unknown {
  switch (cmd) {
    case "roster_rows": return rosterRowsOf(arg(args, "milestoneId"));
    case "project_list": return PROJECTS;
    case "milestone_list": return MILESTONES[arg(args, "projectId")] ?? [];
    case "epic_list": return EPICS[arg(args, "milestoneId")] ?? [];
    case "milestone_progress": {
      const progress = progressOf(arg(args, "projectId"), arg(args, "milestoneId"));
      if (!progress) return null;
      // The Epic's attention follows its shaping session (issue #124).
      const attention = shapingSessionLive ? "waiting_on_you" : "round_waiting";
      // An Epic's "n Proposals" counts the drawer's own list (issue #162).
      return {
        ...progress,
        epics: progress.epics.map((e) => {
          const marked = { ...e, shaping: e.state === "shaping" ? shapingMarkerOf(e.epicId) : null, proposals: triageMarker(e.epicId) };
          return e.epicId === "e-59" ? { ...marked, attention } : marked;
        }),
      };
    }
    case "story_list_for_project": return STORIES.filter((s) => s.projectId === arg(args, "projectId"));
    case "story_list": return STORIES.filter((s) => s.epicId === arg(args, "epicId"));
    case "story_get": return storyById(arg(args, "storyId")) ?? null;
    case "story_context_packet_size": {
      const tokens = PACKET[arg(args, "storyId")] ?? 4000;
      return { bytes: tokens * 4, approxTokens: tokens, overSoftLimit: tokens > 20000 };
    }
    case "story_stopped":
      return arg(args, "storyId") === "s-7" ? { sessionId: "ses-7b", endingReason: "usage_limit", endedAt: ago(4200) } : null;
    case "task_list": return tasksOf(arg(args, "storyId"));
    case "sessions_for_story": return RUNS[arg(args, "storyId")] ?? [];
    case "session_get": return Object.values(RUNS).flat().find((r) => r.id === arg(args, "sessionId")) ?? null;
    case "story_session_summaries": return SUMMARIES[arg(args, "storyId")] ?? [];
    case "story_latest_session": return RUNS[arg(args, "storyId")]?.[0]?.id ?? null;
    case "board_blocked_summary": {
      const fly = arg(args, "projectId") === "p-fly";
      const ids = fly ? ["s-5", "s-6"] : ["s-h2"];
      const epics = fly && shapingSessionLive ? ["e-59"] : [];
      const roadmapWaiting = fly && roadmapMode === "waiting";
      const milestones = fly && milestoneShaping === "waiting" ? ["m-4"] : [];
      return {
        blockedStoryIds: ids,
        waitingEpicIds: epics,
        waitingMilestoneIds: milestones,
        roadmapWaiting,
        blockedCount: ids.length + epics.length + milestones.length + (roadmapWaiting ? 1 : 0),
      };
    }
    case "board_recovery_summary": return { recoveryStoryIds: [], recoveryCount: 0 };
    case "needs_you_list": return needsYouOf(arg(args, "projectId"));
    case "fleet_list": return { rows: FLEET_ROWS, totalRows: FLEET_ROWS.length, visibleCostUsd: 9.3 };
    case "fleet_blocked_queue": return QUEUE;
    case "fleet_waiting_rounds": return waitingRounds();
    case "session_log_window": {
      const entries = LOGS[arg(args, "sessionId")] ?? [];
      return window_(entries, Number(args?.offset ?? 0), Number(args?.limit ?? 50));
    }
    case "session_raw_window": return { lines: [], offset: 0, limit: 50, total: 0 };
    case "session_pending_permissions": return PENDING[arg(args, "sessionId")] ?? [];
    case "sessions_pending_orphans": return [];
    case "launch_environment": return { path: "/usr/bin:/bin", pathWarning: null, claudeError: null };
    case "worktree_inventory": return [];
    case "git_facts": return null;
    case "proposal_list_pending": return [];
    case "story_make_ready_offer": return makeReadyOffer(arg(args, "storyId"));
    case "proposal_list_for_triage": return arg(args, "projectId") === "p-fly" ? triageList() : [];
    case "criterion_list": return CRITERIA[arg(args, "storyId")] ?? [];
    case "story_review": return reviewOf(arg(args, "storyId"));
    case "review_file_patch": return { patch: REVIEW_PATCHES[arg(args, "path")] ?? "", tooLarge: false };
    case "story_checks_rerun": return { commitSha: "9f3c2ab", passed: 1, failed: 1, timedOut: 0 };
    case "epic_shaping_session": return arg(args, "epicId") === "e-59" && shapingSessionLive ? "ses-shape-8" : null;
    case "epic_shaping_rounds": return shapingOf(arg(args, "epicId"));
    case "roadmap_round_read": return arg(args, "projectId") === "p-fly" ? roadmapView() : { open: null, proposals: [], last: null };
    case "milestone_shaping_session":
      return arg(args, "milestoneId") === "m-4" && milestoneShaping !== "off" ? "ses-shape-m4" : null;
    case "milestone_shaping_rounds": return milestoneShapingOf(arg(args, "milestoneId"));
    case "board_visit": return arg(args, "projectId") === "p-fly" ? SINCE_LAST_LOOKED : { total: 0, events: [] };
    default: return null;
  }
}

/** What changed on flywheel since the last visit to its board (issue #167), oldest first. */
const looked = (n: number, secondsAgo: number, eventType: string, description: string, subjectKey: string | null, subjectTitle: string | null) => ({
  id: `ev-${n}`, projectId: "p-fly", origin: "local", sequence: 100 + n, actorId: "a-dev", eventType, description,
  occurredAt: ago(secondsAgo), subjectKey, subjectTitle,
});
const SINCE_LAST_LOOKED = {
  total: 7,
  events: [
    looked(1, 4 * 3600 + 720, "story.state_changed", "Moved Story from in_review to merged", "FLY-2", "Refresh PRODUCT.md and critique the built app"),
    looked(2, 3 * 3600 + 1500, "story.handed_off", "Handed off for review: 4 Checks passed, 0 failed, 0 timed out", "FLY-3", "Pick Flywheel's new visual world from three rendered directions"),
    looked(3, 2 * 3600 + 240, "proposal.filed", "Proposed to create a story", "FLY-1", "Design system and a legible app"),
    looked(4, 2 * 3600 + 60, "proposal.accepted", "Accepted a Proposal", "FLY-1", "Design system and a legible app"),
    looked(5, 3600 + 900, "round.posted", "Posted Round 2: 4 questions", "FLY-8", "Epic shaping"),
    looked(6, 2700, "story.state_changed", "Moved Story from ready to running", "FLY-7", "Restyle every screen of the M2 flow in the new world"),
    looked(7, 600, "round.opened", "Opened roadmap Round 1: Epic FLY-1 done", null, null),
  ],
};

/** Route every `invoke`/`listen` in the app to the seeded data. Call before the first render. */
export function installFixtureBackend(): void {
  withAdrs = false;
  needsYouExtras = false;
  triageOn = false;
  judgedOn = false;
  roadmapMode = "none";
  milestoneShaping = "off";
  adrsOnlyLeft = false;
  mockIPC((cmd, payload) => answer(cmd, payload as Args), { shouldMockEvents: true });
}
