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
  BlockedQueueEntryDto,
  EpicDto,
  FleetRowDto,
  MilestoneDto,
  PendingPermissionRequestDto,
  RunSummaryDto,
  SessionSummaryDto,
  StoryDto,
  TaskDto,
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
    { id: "m-2", projectId: "p-fly", title: "Supervised execution", exitTest: "A Story written by hand runs from Start to In review with Cyril following it in Flywheel.", state: "done", current: false, rank: "a" },
    { id: "m-3", projectId: "p-fly", title: "Shaping", exitTest: "Cyril takes a one-line idea to an Epic with Ready Stories entirely in Flywheel's dock and board.", state: "in_progress", current: true, rank: "b" },
    { id: "m-4", projectId: "p-fly", title: "Board and review", exitTest: "A Story goes from Ready to Merged in Flywheel alone.", state: "shaping", current: false, rank: "c" },
  ],
  "p-hkw": [
    { id: "m-h1", projectId: "p-hkw", title: "Waitlist live", exitTest: "A visitor can join the waitlist and gets a confirmation email.", state: "in_progress", current: true, rank: "a" },
  ],
};

const EPICS: Record<string, EpicDto[]> = {
  "m-3": [
    { id: "e-97", projectId: "p-fly", milestoneId: "m-3", key: "FLY-1", title: "Design system and a legible app", problem: null, scope: null, outOfScope: null, exitTest: null, state: "in_progress", rank: "a" },
    { id: "e-59", projectId: "p-fly", milestoneId: "m-3", key: "FLY-8", title: "Epic shaping", problem: null, scope: null, outOfScope: null, exitTest: null, state: "shaping", rank: "b" },
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
    call(1190, "t4", `${BOARD}task_add`, { title: "Clear the open session when the rail switches project" }),
    result(1189, "t4", "Added Task t-4a"),
    call(1188, "t5", `${BOARD}task_add`, { title: "Make Waiting on you and All agents replace an open feed" }),
    result(1187, "t5", "Added Task t-4b"),
    call(1186, "t6", `${BOARD}task_add`, { title: "Open a Story's live session from its row on the board" }),
    result(1185, "t6", "Added Task t-4c"),
    call(1180, "t7", "Edit", { file_path: "packages/desktop/src/state/uiStore.ts", old_string: "setCurrentProjectId: (id) => set({ currentProjectId: id }),", new_string: "setCurrentProjectId: (id) => set({ currentProjectId: id, activeSessionId: null }),", replace_all: false }),
    result(1179, "t7", "The file packages/desktop/src/state/uiStore.ts has been updated."),
    call(1100, "t8", "Bash", { command: "npm --prefix packages/desktop test -- uiStore", description: "Run the store tests" }),
    result(1060, "t8", " ✓ src/state/__tests__/uiStore.test.ts (14 tests) 41ms\n\n Test Files  1 passed (1)\n      Tests  14 passed (14)"),
    call(1050, "t9", `${BOARD}task_update`, { task_id: "t-4a", state: "done", note: "uiStore.setCurrentProjectId now also clears activeSessionId." }),
    result(1049, "t9", "Updated Task t-4a"),
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
    result(2099, "u2", "Updated Task t-5c"),
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
    result(4900, "r1", "2 Checks passed, 0 failed"),
    call(3700, "r2", `${BOARD}handoff`, { next_session_must_know: "Three directions rendered under docs/design/directions/.", decisions: "Comps are code, not images." }),
    result(3650, "r2", "Handed off. Checks ran: 2 passed."),
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

const PACKET: Record<string, number> = { "s-3": 11800, "s-4": 9400, "s-5": 12100, "s-6": 8700, "s-7": 23400, "s-9": 6100, "s-10": 5200, "s-h2": 4100, "s-h3": 3900 };

type Args = Record<string, unknown> | undefined;
const arg = (args: Args, name: string) => (args?.[name] as string | undefined) ?? "";

function window_(entries: Record<string, unknown>[], offset: number, limit: number) {
  return { entries: entries.slice(offset, offset + limit), offset, limit, total: entries.length };
}

/** Answer one IPC command from the seeded data. Writes are accepted and change nothing. */
export function answer(cmd: string, args: Args): unknown {
  switch (cmd) {
    case "project_list": return PROJECTS;
    case "milestone_list": return MILESTONES[arg(args, "projectId")] ?? [];
    case "epic_list": return EPICS[arg(args, "milestoneId")] ?? [];
    case "story_list_for_project": return STORIES.filter((s) => s.projectId === arg(args, "projectId"));
    case "story_list": return STORIES.filter((s) => s.epicId === arg(args, "epicId"));
    case "story_get": return storyById(arg(args, "storyId")) ?? null;
    case "story_context_packet_size": {
      const tokens = PACKET[arg(args, "storyId")] ?? 4000;
      return { bytes: tokens * 4, approxTokens: tokens, overSoftLimit: tokens > 20000 };
    }
    case "story_stopped":
      return arg(args, "storyId") === "s-7" ? { sessionId: "ses-7b", endingReason: "usage_limit", endedAt: ago(4200) } : null;
    case "task_list": return TASKS[arg(args, "storyId")] ?? [];
    case "sessions_for_story": return RUNS[arg(args, "storyId")] ?? [];
    case "session_get": return Object.values(RUNS).flat().find((r) => r.id === arg(args, "sessionId")) ?? null;
    case "story_session_summaries": return SUMMARIES[arg(args, "storyId")] ?? [];
    case "story_latest_session": return RUNS[arg(args, "storyId")]?.[0]?.id ?? null;
    case "board_blocked_summary": {
      const ids = arg(args, "projectId") === "p-fly" ? ["s-5", "s-6"] : ["s-h2"];
      return { blockedStoryIds: ids, blockedCount: ids.length };
    }
    case "board_recovery_summary": return { recoveryStoryIds: [], recoveryCount: 0 };
    case "fleet_list": return { rows: FLEET_ROWS, totalRows: FLEET_ROWS.length, visibleCostUsd: 9.3 };
    case "fleet_blocked_queue": return QUEUE;
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
    case "criterion_list": return [];
    default: return null;
  }
}

/** Route every `invoke`/`listen` in the app to the seeded data. Call before the first render. */
export function installFixtureBackend(): void {
  mockIPC((cmd, payload) => answer(cmd, payload as Args), { shouldMockEvents: true });
}
