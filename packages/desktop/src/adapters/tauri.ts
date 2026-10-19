/**
 * The single invoke/listen seam between the React tree and the Tauri command surface.
 *
 * This is the ONLY module in the renderer permitted to import from `@tauri-apps/api`
 * (`.claude/CLAUDE.md` names this a phase-1 requirement, not a stack preference — the
 * same React tree must later be able to point at a relay client by editing this one file).
 * Every component that needs to call into the Rust core, or subscribe to board-changed
 * push notifications, does so through `invokeCommand` / `subscribeBoardChanged` — never
 * by importing `invoke`/`listen` directly.
 *
 * Every DTO below mirrors a `#[serde(rename_all = "camelCase")]` struct in
 * `src-tauri/src/commands/*.rs` field-for-field, and every wrapper's argument names are the
 * camelCase form of the command's own snake_case parameters.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import type { Project } from "../board/useBoardQuery";

/**
 * Invoke a Tauri command and return its typed result.
 */
export async function invokeCommand<TResult>(
  command: string,
  args?: Record<string, unknown>,
): Promise<TResult> {
  return invoke<TResult>(command, args);
}

/**
 * The wire shape of `board:changed`, built on the Rust side by `commands::emit_board_changed`
 * (FNC-07). `projectId` is `null` for an event with no project scope — a broadcast. Declared here
 * because this module is the single seam. Treat it as untrusted at the boundary: a reader must
 * route a malformed payload as a broadcast, never drop it.
 */
export interface BoardChangedPayload {
  projectId: string | null;
  entity: string;
  id: string | null;
}

/**
 * Subscribe to the `board:changed` event the Rust core emits after every committed
 * mutation (D-04). The handler should invalidate/refetch the affected queries — the UI
 * must never trust its own optimistic write as the source of truth. The typed payload names
 * the project the change happened in, so a handler can leave other projects' views alone.
 */
export async function subscribeBoardChanged(
  handler: (payload: BoardChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<BoardChangedPayload>("board:changed", (event) => handler(event.payload));
}

/**
 * Open the native folder picker for project registration (the "Register Project…" flow). Returns
 * the chosen absolute path, or `null` if the user cancelled.
 *
 * This module is also the only place `@tauri-apps/plugin-dialog` is imported, extending the same
 * single-seam rule `invokeCommand`/`subscribeBoardChanged` follow above.
 */
export async function openFolderDialog(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return result ?? null;
}

/**
 * Subscribe to `menu:action`, the event `src-tauri/src/menu.rs`'s `on_menu_event` handler emits
 * when the user clicks a native menu item. The payload is the exact `state/keyboard.ts` `ActionId`
 * string the corresponding keystroke would resolve to — menu items invoke the same registered
 * action ids as the keyboard/palette, never a broader capability (threat T-01-02).
 */
export async function subscribeMenuAction(handler: (actionId: string) => void): Promise<UnlistenFn> {
  return listen<string>("menu:action", (event) => handler(event.payload));
}

// ---------------------------------------------------------------------------------------------
// Board records: Milestone -> Epic -> Story, with a Story's Acceptance criteria, Checks and Task
// checklist, and the developer's side of Proposals (GLOSSARY.md "Board records"). Every mutation
// below is stamped with the local human actor in the Rust command; no wrapper carries an actor.
// ---------------------------------------------------------------------------------------------

/** A Milestone on a project's Roadmap — mirrors `commands/roadmap.rs`'s `MilestoneDto`. */
export interface MilestoneDto {
  id: string;
  projectId: string;
  title: string;
  exitTest: string | null;
  /** The state with In progress derived: `shaping`, `ready`, `in_progress`, `done` or `dropped`. */
  state: string;
  /** Whether this is the Current Milestone (the first in Roadmap order not done or dropped). */
  current: boolean;
  rank: string;
}

/** Add a Milestone at the end of the project's Roadmap, in Shaping. */
export async function milestoneCreate(
  projectId: string,
  title: string,
  exitTest?: string | null,
): Promise<MilestoneDto> {
  return invokeCommand<MilestoneDto>("milestone_create", { projectId, title, exitTest: exitTest ?? null });
}

/** The project's Roadmap: every Milestone in rank order. Read-only. */
export async function milestoneList(projectId: string): Promise<MilestoneDto[]> {
  return invokeCommand<MilestoneDto[]>("milestone_list", { projectId });
}

/** Move a Milestone (`shaping`, `ready`, `done` or `dropped`); the domain refuses the rest. */
export async function milestoneSetState(milestoneId: string, to: string): Promise<void> {
  await invokeCommand<void>("milestone_set_state", { milestoneId, to });
}

/** An Epic in one Milestone — mirrors `commands/epic.rs`'s `EpicDto`. */
export interface EpicDto {
  id: string;
  projectId: string;
  milestoneId: string;
  key: string;
  title: string;
  problem: string | null;
  scope: string | null;
  outOfScope: string | null;
  exitTest: string | null;
  /** The state with In progress derived: `shaping`, `ready`, `in_progress` or `done`. */
  state: string;
  rank: string;
}

/** The Epic's spec and exit test, as `epicUpdate` rewrites them. */
export interface EpicSpecInput {
  problem?: string | null;
  scope?: string | null;
  outOfScope?: string | null;
  exitTest?: string | null;
}

/** Create an Epic at the end of `milestoneId`, in Shaping. */
export async function epicCreate(milestoneId: string, title: string): Promise<EpicDto> {
  return invokeCommand<EpicDto>("epic_create", { milestoneId, title });
}

/** Every Epic of a Milestone, in rank order. Read-only. */
export async function epicList(milestoneId: string): Promise<EpicDto[]> {
  return invokeCommand<EpicDto[]>("epic_list", { milestoneId });
}

/** Rewrite an Epic's title, spec and exit test. */
export async function epicUpdate(epicId: string, title: string, spec: EpicSpecInput = {}): Promise<void> {
  await invokeCommand<void>("epic_update", {
    epicId,
    title,
    problem: spec.problem ?? null,
    scope: spec.scope ?? null,
    outOfScope: spec.outOfScope ?? null,
    exitTest: spec.exitTest ?? null,
  });
}

/** Move an Epic (`shaping`, `ready` or `done`); the domain refuses the rest. */
export async function epicSetState(epicId: string, to: string): Promise<void> {
  await invokeCommand<void>("epic_set_state", { epicId, to });
}

/** A Story in one Epic — mirrors `commands/story.rs`'s `StoryDto`. */
export interface StoryDto {
  id: string;
  projectId: string;
  epicId: string;
  key: string;
  title: string;
  description: string | null;
  /** `shaping`, `ready`, `running`, `in_review`, `merged` or `dropped`. */
  state: string;
  runsAfterStoryId: string | null;
  rank: string;
}

/** Create a Story at the end of `epicId`'s execution order, in Shaping. */
export async function storyCreate(epicId: string, title: string): Promise<StoryDto> {
  return invokeCommand<StoryDto>("story_create", { epicId, title });
}

/** One criterion of a hand-written Story; a blank or missing `checkCommand` is judged at review. */
export interface CriterionInput {
  statement: string;
  checkCommand?: string | null;
}

/**
 * Write a Story by hand inside `epicId` with its criteria and optional Checks, straight into Ready
 * (Milestone 2's stand-in for shaping). One transaction: a refusal writes nothing.
 */
export async function storyWriteByHand(
  epicId: string,
  title: string,
  description: string | null,
  criteria: CriterionInput[],
): Promise<StoryDto> {
  return invokeCommand<StoryDto>("story_write_by_hand", {
    epicId,
    title,
    description,
    criteria: criteria.map((c) => ({ statement: c.statement, checkCommand: c.checkCommand ?? null })),
  });
}

/** Every Story of a project, in Roadmap order. Read-only. */
export async function storyListForProject(projectId: string): Promise<StoryDto[]> {
  return invokeCommand<StoryDto[]>("story_list_for_project", { projectId });
}

/** Every Story of an Epic, in execution order. Read-only. */
export async function storyList(epicId: string): Promise<StoryDto[]> {
  return invokeCommand<StoryDto[]>("story_list", { epicId });
}

/** One Story, or `null` when it does not exist. Read-only. */
export async function storyGet(storyId: string): Promise<StoryDto | null> {
  return invokeCommand<StoryDto | null>("story_get", { storyId });
}

/** Rewrite a Story's title and description. */
export async function storyUpdate(storyId: string, title: string, description?: string | null): Promise<void> {
  await invokeCommand<void>("story_update", { storyId, title, description: description ?? null });
}

/** Move a Story along the spec's transition table; the domain refuses any other move. */
export async function storySetState(storyId: string, to: string): Promise<void> {
  await invokeCommand<void>("story_set_state", { storyId, to });
}

/** A criterion's Check — mirrors `commands/criterion.rs`'s `CheckDto`. */
export interface CheckDto {
  id: string;
  command: string;
  timeoutSecs: number;
  /** `not_run`, `passed`, `failed` or `timed_out`. */
  result: string;
  /** The commit the current result ran against; `null` when not run. */
  commitSha: string | null;
}

/** An Acceptance criterion of one Story — mirrors `commands/criterion.rs`'s `AcceptanceCriterionDto`. */
export interface AcceptanceCriterionDto {
  id: string;
  storyId: string;
  statement: string;
  accepted: boolean;
  acceptedAt: string | null;
  rank: string;
  /** `null` means the criterion is judged at review. */
  check: CheckDto | null;
}

/** Add a criterion at the end of `storyId`'s list. */
export async function criterionCreate(storyId: string, statement: string): Promise<AcceptanceCriterionDto> {
  return invokeCommand<AcceptanceCriterionDto>("criterion_create", { storyId, statement });
}

/** A Story's criteria, in order, each with its Check and current result. Read-only. */
export async function criterionList(storyId: string): Promise<AcceptanceCriterionDto[]> {
  return invokeCommand<AcceptanceCriterionDto[]>("criterion_list", { storyId });
}

/** Rewrite a criterion's statement (clears an acceptance already recorded). */
export async function criterionAmend(criterionId: string, statement: string): Promise<void> {
  await invokeCommand<void>("criterion_amend", { criterionId, statement });
}

/** Accept a criterion at review. Human-only. */
export async function criterionAccept(criterionId: string): Promise<void> {
  await invokeCommand<void>("criterion_accept", { criterionId });
}

/** Withdraw a criterion's acceptance. Human-only. */
export async function criterionUnaccept(criterionId: string): Promise<void> {
  await invokeCommand<void>("criterion_unaccept", { criterionId });
}

/** Delete a criterion and its Check. */
export async function criterionDelete(criterionId: string): Promise<void> {
  await invokeCommand<void>("criterion_delete", { criterionId });
}

/** Attach or replace the Check on a criterion; replacing it resets its result. Human-only. */
export async function checkSet(criterionId: string, command: string, timeoutSecs?: number | null): Promise<void> {
  await invokeCommand<void>("check_set", { criterionId, command, timeoutSecs: timeoutSecs ?? null });
}

/** Remove the Check from a criterion, which is then judged at review. Human-only. */
export async function checkRemove(criterionId: string): Promise<void> {
  await invokeCommand<void>("check_remove", { criterionId });
}

/** One Task on a Story's checklist — mirrors `commands/Story.rs`'s `TaskDto`. */
export interface TaskDto {
  id: string;
  storyId: string;
  title: string;
  /** `open`, `doing`, `done` or `dropped`. */
  state: string;
  droppedReason: string | null;
  rank: string;
}

/** Add a Task at the end of a Story's checklist. */
export async function taskAdd(storyId: string, title: string): Promise<TaskDto> {
  return invokeCommand<TaskDto>("task_add", { storyId, title });
}

/** A Story's checklist, in order. Read-only. */
export async function taskList(storyId: string): Promise<TaskDto[]> {
  return invokeCommand<TaskDto[]>("task_list", { storyId });
}

/** Move a Task to `open`, `doing`, `done` or `dropped` (a drop needs its one-line reason). */
export async function taskSetState(taskId: string, to: string, droppedReason?: string | null): Promise<void> {
  await invokeCommand<void>("task_set_state", { taskId, to, droppedReason: droppedReason ?? null });
}

/** A Proposal an agent filed — mirrors `commands/proposal.rs`'s `ProposalDto`. */
export interface ProposalDto {
  id: string;
  projectId: string;
  sessionId: string | null;
  epicId: string | null;
  /** `create`, `amend`, `reorder` or `retire`. */
  verb: string;
  /** `milestone`, `epic`, `story`, `criterion`, `adr` or `glossary_term`. */
  targetType: string;
  targetId: string | null;
  payload: unknown;
  rationale: string | null;
  state: string;
  createdAt: string;
}

/** A project's pending Proposals, oldest first. Read-only. */
export async function proposalListPending(projectId: string): Promise<ProposalDto[]> {
  return invokeCommand<ProposalDto[]>("proposal_list_pending", { projectId });
}

/** Accept a pending Proposal. Human-only. */
export async function proposalAccept(proposalId: string): Promise<void> {
  await invokeCommand<void>("proposal_accept", { proposalId });
}

/** Reject a pending Proposal, keeping the reason for the Epic's packet. Human-only. */
export async function proposalReject(proposalId: string, reason?: string | null): Promise<void> {
  await invokeCommand<void>("proposal_reject", { proposalId, reason: reason ?? null });
}

/** One event of an activity trail — mirrors `commands/events.rs`'s `EventDto`. `description` is the
 * core's one-line sentence; the raw payload never crosses the IPC boundary. */
export interface EventDto {
  id: string;
  projectId: string;
  origin: string;
  sequence: number;
  actorId: string;
  eventType: string;
  description: string;
  occurredAt: string;
}

/** A Story's or an Epic's chronological activity trail, windowed. Read-only. */
export async function eventsActivityTrail(
  parentKind: "story" | "epic",
  parentId: string,
  limit?: number,
  offset?: number,
): Promise<EventDto[]> {
  return invokeCommand<EventDto[]>("events_activity_trail", { parentKind, parentId, limit, offset });
}

// ---------------------------------------------------------------------------------------------
// Agent sessions on a Story.
// ---------------------------------------------------------------------------------------------

/** A started agent run — mirrors `commands/session.rs`'s `SessionDto`. */
export interface SessionDto {
  id: string;
  storyId: string;
  status: string;
  permissionMode: string;
}

/**
 * Start a fresh agent run on `storyId` (D-30: always fresh, never `--resume`). Thin typed wrapper
 * over `session_start`.
 */
export async function startSession(
  storyId: string,
  permissionMode: string,
  instruction?: string,
): Promise<SessionDto> {
  return invokeCommand<SessionDto>("session_start", { storyId, permissionMode, instruction });
}

/**
 * The developer's Start: a Ready Story gets its worktree, branch and session, then moves to
 * Running. The core refuses a Story that is not Ready.
 */
export async function storyStart(storyId: string, instruction?: string): Promise<SessionDto> {
  return invokeCommand<SessionDto>("story_start", { storyId, instruction: instruction ?? null });
}

/**
 * One prior-session summary, oldest-first — mirrors `commands/session.rs`'s `SessionSummaryDto`.
 * `isStub` marks the fallback summary written when the agent did not report one.
 */
export interface SessionSummaryDto {
  sessionId: string;
  createdAt: string;
  isStub: boolean;
  nextSessionMustKnow: string;
  decisions: string;
}

/**
 * A bounded page of an agent run's durable session log (D-33, D-34) — server-capped at 100 rows
 * regardless of what is requested. `total` is the log's true complete-line count at read time, so
 * `useSessionFeed` (`board/useBoardQuery.ts`) can page backwards from the tail.
 */
export interface LogWindowDto {
  entries: Record<string, unknown>[];
  offset: number;
  limit: number;
  total: number;
}

export async function sessionLogWindow(
  sessionId: string,
  offset: number,
  limit: number,
): Promise<LogWindowDto> {
  return invokeCommand<LogWindowDto>("session_log_window", {
    sessionId,
    offset,
    limit,
  });
}

/**
 * The raw view's own bounded read (D-32's escape hatch) — each entry is a line's VERBATIM text plus
 * its 0-based line number, never a parsed value.
 */
export interface RawLogLineDto {
  line: number;
  text: string;
}

export interface RawLogWindowDto {
  lines: RawLogLineDto[];
  offset: number;
  limit: number;
  total: number;
}

export async function sessionRawWindow(
  sessionId: string,
  offset: number,
  limit: number,
): Promise<RawLogWindowDto> {
  return invokeCommand<RawLogWindowDto>("session_raw_window", {
    sessionId,
    offset,
    limit,
  });
}

/** One of a Story's agent runs — mirrors `commands/session.rs`'s `RunSummaryDto`. */
export interface RunSummaryDto {
  id: string;
  storyId: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** D-30's session identity — `null` until the sidecar's `init` event reports it. */
  externalSessionId: string | null;
  /** `null` until the run is acknowledged. */
  acknowledgedAt: string | null;
  /** The abandoned-run explanation's own timestamp, or `null`. */
  abandonedReason: string | null;
}

/** `storyId`'s agent runs, newest first, bounded. Read-only. Thin wrapper over `sessions_for_story`. */
export async function sessionsForStory(
  storyId: string,
  limit?: number,
  offset?: number,
): Promise<RunSummaryDto[]> {
  return invokeCommand<RunSummaryDto[]>("sessions_for_story", { storyId, limit, offset });
}

/** Every session summary recorded for `storyId`. Read-only. Thin wrapper over `story_session_summaries`. */
export async function sessionSummariesForStory(storyId: string): Promise<SessionSummaryDto[]> {
  return invokeCommand<SessionSummaryDto[]>("story_session_summaries", { storyId });
}

/** The most recent agent run id for `storyId`, or `null`. Thin wrapper over `story_latest_session`. */
export async function latestSessionIdForStory(storyId: string): Promise<string | null> {
  return invokeCommand<string | null>("story_latest_session", { storyId });
}

/**
 * A Story's worktree summary line — `null` for a Story with no worktree yet. `status` lets the
 * renderer branch on `"missing"` without a second call.
 */
export interface WorktreeSummaryDto {
  branch: string;
  path: string;
  status: string;
}

export async function worktreeSummary(storyId: string): Promise<WorktreeSummaryDto | null> {
  return invokeCommand<WorktreeSummaryDto | null>("worktree_summary", { storyId });
}

/** D-45's "Recreate Worktree" decision. Refuses on any non-`missing` row. */
export async function worktreeRecreate(storyId: string): Promise<void> {
  await invokeCommand<void>("worktree_recreate", { storyId });
}

/** D-45's "Remove Record" decision: drops the `worktrees` row only. Refuses on any non-`missing` row. */
export async function worktreeForgetRecord(storyId: string): Promise<void> {
  await invokeCommand<void>("worktree_forget_record", { storyId });
}

/** One `git status --porcelain` entry — mirrors `commands/session.rs`'s `PorcelainEntryDto`. */
export interface PorcelainEntryDto {
  code: string;
  path: string;
}

/** The worktree-removal check's fresh read — `null` when the Story has no `worktrees` row. */
export interface WorktreeRemovalCheckDto {
  storyKey: string;
  path: string;
  branch: string;
  entries: PorcelainEntryDto[];
  dirtyCount: number;
}

/** A fresh, never-cached `git status --porcelain` read for `storyId`'s worktree. Read-only. */
export async function worktreeRemovalCheck(storyId: string): Promise<WorktreeRemovalCheckDto | null> {
  return invokeCommand<WorktreeRemovalCheckDto | null>("worktree_remove_check", { storyId });
}

/** Remove `storyId`'s worktree. The backend refuses on any uncommitted change; no force flag (D-43). */
export async function worktreeRemove(storyId: string): Promise<void> {
  await invokeCommand<void>("worktree_remove", { storyId });
}

/** One row of a Story's commit window — mirrors `commands/git_truth.rs`'s `CommitRowDto`. */
export interface CommitRowDto {
  sha: string;
  shortSha: string;
  subject: string;
  committedAt: string;
  /** LINK-10/D-129: agent-run coverage, never commit-trailer presence. */
  madeOutsideFlywheel: boolean;
}

/**
 * A Story's full git truth — mirrors `commands/git_truth.rs`'s `GitFactsDto`. `ahead`/`behind` are
 * both `null` together when the comparison target does not resolve locally (D-116).
 */
export interface GitFactsDto {
  branch: string;
  worktreePath: string;
  targetRef: string;
  ahead: number | null;
  behind: number | null;
  lastFetchAt: string | null;
  commits: CommitRowDto[];
  commitsTruncated: number;
  uncommitted: PorcelainEntryDto[];
}

/** `storyId`'s full git truth, or `null` when it has no worktree yet. Read-only. */
export async function gitFacts(storyId: string): Promise<GitFactsDto | null> {
  return invokeCommand<GitFactsDto | null>("git_facts", { storyId });
}

/** Declares which Story is in focus for the hot git-truth tier (`null` = none). */
export async function gitTruthFocusStory(storyId: string | null): Promise<void> {
  await invokeCommand<void>("git_truth_focus_story", { storyId });
}

/**
 * Reports which agent run's session surface is the visible one, or `null` when none is (D-174), so
 * the core can withhold the one banner for the session the user is already looking at.
 */
export async function fleetWatchRun(sessionId: string | null): Promise<void> {
  await invokeCommand<void>("fleet_watch_run", { sessionId });
}

/** Which of the two "open this worktree" actions a call targets (D-130, LINK-11). */
export type WorktreeOpenSurface = "editor" | "terminal";

/**
 * Open `storyId`'s worktree in the user's own editor or terminal (D-130). The backend resolves the
 * full argv and spawns it directly with no shell — this call carries only the Story id and surface.
 */
export async function worktreeOpen(storyId: string, surface: WorktreeOpenSurface): Promise<void> {
  await invokeCommand<void>("worktree_open", { storyId, surface });
}

/** `surface`'s stored open-command template, or its own default when unset (D-130). Read-only. */
export async function openCommandTemplate(surface: WorktreeOpenSurface): Promise<string> {
  return invokeCommand<string>("open_command_template", { surface });
}

/** Set `surface`'s stored open-command template (D-130). Rejects an empty template. */
export async function setOpenCommandTemplate(
  surface: WorktreeOpenSurface,
  template: string,
): Promise<void> {
  await invokeCommand<void>("set_open_command_template", { surface, template });
}

/** A resolved git identifier's Story — mirrors `commands/git_identity.rs`'s `GitIdentityResolutionDto`.
 * `itemKind` is `"story"`. */
export interface GitIdentityResolutionDto {
  projectId: string;
  itemKind: string;
  itemId: string;
  itemKey: string;
  itemTitle: string;
  matchedSha: string | null;
  runId: string | null;
}

/** Every shape `git_identifier_resolve` can return, internally tagged on `outcome`. */
export type GitIdentityOutcomeDto =
  | { outcome: "resolved"; resolution: GitIdentityResolutionDto }
  | { outcome: "notFound" }
  | { outcome: "ambiguousPrefix"; matches: number }
  | { outcome: "ambiguousAcrossRepositories"; repositories: number };

/** Resolve a pasted commit hash or `flywheel/` branch name to its Story (D-127/D-128). Read-only. */
export async function gitIdentifierResolve(raw: string): Promise<GitIdentityOutcomeDto> {
  return invokeCommand<GitIdentityOutcomeDto>("git_identifier_resolve", { raw });
}

/**
 * Subscribe to `agent:event`, the Rust core's live push of one normalised agent event at a time
 * (D-32) — the session surface invalidates its windowed read on this, never trusting a streamed
 * event as already-persisted.
 */
export async function subscribeAgentEvent(
  handler: (event: Record<string, unknown>) => void,
): Promise<UnlistenFn> {
  return listen<Record<string, unknown>>("agent:event", (event) => handler(event.payload));
}

/** What `session_stop` returns — the mirror of the Rust command's `SessionStopDto`. */
export interface SessionStopResult {
  status: string;
  sidecarWarning: string | null;
}

/**
 * Stop a running agent run (D-35: interrupt, then force). The resolution carries the status
 * Flywheel RECORDED; `sidecarWarning` is set when the sidecar could not confirm.
 */
export async function stopSession(sessionId: string): Promise<SessionStopResult> {
  return invokeCommand<SessionStopResult>("session_stop", { sessionId });
}

/**
 * Discard a live agent run in one action (D-66/D-67): give the agent's closing summary a bounded
 * window to land, then end the session through the same path `stopSession` uses.
 */
export async function discardSession(sessionId: string): Promise<SessionStopResult> {
  return invokeCommand<SessionStopResult>("session_discard", { sessionId });
}

/**
 * Acknowledge a finished run. Changes nothing about its status — it records only that the user has
 * dealt with it, which is what clears its fleet row. A no-op on a live or already-acknowledged run.
 */
export async function acknowledgeSession(sessionId: string): Promise<void> {
  await invokeCommand<void>("session_acknowledge", { sessionId });
}

/** One id's outcome of a batch acknowledge. */
export interface AcknowledgeResultDto {
  sessionId: string;
  acknowledged: boolean;
  error?: string | null;
}

/** The fleet's "Dismiss finished" action: ids only. An over-long list is refused as a whole. */
export async function sessionAcknowledgeMany(sessionIds: string[]): Promise<AcknowledgeResultDto[]> {
  return invokeCommand<AcknowledgeResultDto[]>("session_acknowledge_many", { sessionIds });
}

/**
 * Answer a pending permission request (AGNT-06, D-38). `decision` is exactly `"allow"`, `"deny"` or
 * `"allow_always"` — validated server-side before any database call.
 */
export async function answerPermissionRequest(
  requestId: string,
  decision: "allow" | "deny" | "allow_always",
): Promise<void> {
  await invokeCommand<void>("session_answer_permission", { requestId, decision });
}

/**
 * One project-scoped permission rule — mirrors `commands/session.rs`'s `PermissionRuleDto`. A rule
 * only ever allows: `tool` is the tool it covers and `pattern` narrows it.
 */
export interface PermissionRuleDto {
  id: string;
  projectId: string;
  tool: string;
  pattern: string;
  createdAt: string;
}

/** List `projectId`'s permission rules. Read-only. */
export async function listPermissionRules(projectId: string): Promise<PermissionRuleDto[]> {
  return invokeCommand<PermissionRuleDto[]>("permission_rules_list", { projectId });
}

/** Revoke a permission rule. */
export async function revokePermissionRule(ruleId: string): Promise<void> {
  await invokeCommand<void>("permission_rule_revoke", { ruleId });
}

/** One pending permission request — mirrors `commands/session.rs`'s `PendingPermissionRequestDto`. */
export interface PendingPermissionRequestDto {
  id: string;
  toolName: string;
  inputPayload: string | null;
  createdAt: string;
  /** `null` for a routine request, or a `DestructiveCategory` kebab-case name for a destructive one. */
  destructiveCategory: string | null;
}

/** Every pending permission request for `sessionId`, oldest first. Read-only. */
export async function pendingPermissionRequests(sessionId: string): Promise<PendingPermissionRequestDto[]> {
  return invokeCommand<PendingPermissionRequestDto[]>("session_pending_permissions", { sessionId });
}

/** D-37's blocked signal for one project: every blocked Story id plus the count, read together. */
export interface BlockedSummaryDto {
  blockedStoryIds: string[];
  blockedCount: number;
}

export async function blockedSummary(projectId: string): Promise<BlockedSummaryDto> {
  return invokeCommand<BlockedSummaryDto>("board_blocked_summary", { projectId });
}

/** D-46's "recovery needed" signal for one project: every Story id with an outstanding recovery item
 * (a missing worktree, or an unacknowledged abandoned run) plus the count, read together. */
export interface RecoverySummaryDto {
  recoveryStoryIds: string[];
  recoveryCount: number;
}

export async function boardRecoverySummary(projectId: string): Promise<RecoverySummaryDto> {
  return invokeCommand<RecoverySummaryDto>("board_recovery_summary", { projectId });
}

/** One genuinely-alive orphaned run the launch reconciler found (PROC-05, D-46) — mirrors
 * `commands/session.rs`'s `PendingOrphanDto`. */
export interface PendingOrphanDto {
  runId: string;
  storyId: string;
  storyKey: string;
  storyTitle: string;
  projectId: string;
  externalSessionId: string | null;
  pid: number;
  startedAt: string;
}

/** The launch-time live-orphan list. Read-only. */
export async function pendingOrphans(): Promise<PendingOrphanDto[]> {
  return invokeCommand<PendingOrphanDto[]>("sessions_pending_orphans");
}

/** What `orphan_kill` returns. `killed: false` means the process survived the signal. */
export interface OrphanKillDto {
  killed: boolean;
  pid: number;
  detail: string | null;
}

/** Kill one live orphan by `sessionId` — the only verb the orphan-recovery modal offers. */
export async function orphanKill(sessionId: string): Promise<OrphanKillDto> {
  return invokeCommand<OrphanKillDto>("orphan_kill", { sessionId });
}

// ---------------------------------------------------------------------------------------------
// Settings.
// ---------------------------------------------------------------------------------------------

/** One registered project's credential-mode override (D-39); `null` means "use the global default". */
export interface ProjectCredentialOverrideDto {
  projectId: string;
  projectName: string;
  credentialMode: string | null;
}

/** The full Settings read (D-39) — never carries the API key value itself. */
export interface SettingsDto {
  globalCredentialMode: string;
  projectOverrides: ProjectCredentialOverrideDto[];
  apiKeyConfigured: boolean;
  apiKeyConfiguredAt: string | null;
  /** The one global OS-notification switch (D-176). */
  notificationsEnabled: boolean;
}

/** Set the one global switch for OS notifications. Human-only. Returns the stored value. */
export async function settingsSetNotificationsEnabled(value: boolean): Promise<boolean> {
  return invokeCommand<boolean>("settings_set_notifications_enabled", { value });
}

/** Read the full Settings state. Read-only. */
export async function getSettings(): Promise<SettingsDto> {
  return invokeCommand<SettingsDto>("settings_get");
}

/**
 * Set the credential mode at either scope (D-39), or clear a project's override back to "use the
 * global default" (`mode: null`, project scope only).
 */
export async function setCredentialMode(
  scope: "global" | "project",
  mode: "local" | "api_key" | null,
  projectId?: string,
): Promise<void> {
  await invokeCommand<void>("settings_set_credential_mode", { scope, projectId, mode });
}

/** Store the API key in the macOS Keychain — the value never round-trips back out. */
export async function storeApiKey(value: string): Promise<void> {
  await invokeCommand<void>("settings_store_api_key", { value });
}

/** Clear the stored API key. Idempotent. */
export async function clearApiKey(): Promise<void> {
  await invokeCommand<void>("settings_clear_api_key");
}

/** Whether the local `claude` backend binary is resolvable, and its reported version. */
export interface BackendCapabilityDto {
  available: boolean;
  version: string | null;
  apiKeyPathUsable: boolean;
}

export async function backendCapabilityProbe(): Promise<BackendCapabilityDto> {
  return invokeCommand<BackendCapabilityDto>("backend_capability_probe");
}

// ---------------------------------------------------------------------------------------------
// The fleet and the worktree inventory.
// ---------------------------------------------------------------------------------------------

/**
 * One row of the fleet (FLEET-01) — mirrors `commands/fleet.rs`'s `FleetRowDto`. `fleetState` is the
 * derived state the row draws (`awaiting_review` is a `completed` run whose Story is not yet merged
 * or dropped); the run status is `runStatus`.
 */
export interface FleetRowDto {
  sessionId: string;
  projectId: string;
  projectName: string;
  projectKeyPrefix: string;
  projectStatus: string;
  storyId: string;
  storyKey: string;
  storyTitle: string;
  storyState: string;
  runStatus: string;
  fleetState: string;
  startedAt: string;
  endedAt: string | null;
  /** When the run's oldest pending permission request was raised; `null` when it is not waiting. */
  blockedSince: string | null;
  costUsd: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  /** The end of the run's session log, raw; empty for a run that is not live. */
  activity: FleetActivityDto;
}

/** Raw tail lines of a live run's session log, oldest first. */
export interface FleetActivityDto {
  lines: string[];
  truncated: boolean;
}

export interface FleetListDto {
  rows: FleetRowDto[];
  /** The length of `rows` — one source, so the header count and the list cannot disagree. */
  totalRows: number;
  /** Sum of the visible rows' recorded costs; `null` when no row has one. An estimate. */
  visibleCostUsd: number | null;
}

/** Every agent run across every registered project, banded and ordered by the Rust core. */
export async function fleetList(): Promise<FleetListDto> {
  return invokeCommand<FleetListDto>("fleet_list");
}

/** One agent blocked at a pending permission request (FLEET-02) — mirrors `BlockedQueueEntryDto`. */
export interface BlockedQueueEntryDto {
  requestId: string;
  toolName: string;
  inputPayload: string | null;
  createdAt: string;
  destructiveCategory: string | null;
  sessionId: string;
  projectId: string;
  projectName: string;
  projectKeyPrefix: string;
  storyId: string;
  storyKey: string;
  storyTitle: string;
  blockedSince: string;
}

/** Every blocked agent across every registered project, longest waiting first (D-172). */
export async function fleetBlockedQueue(): Promise<BlockedQueueEntryDto[]> {
  return invokeCommand<BlockedQueueEntryDto[]>("fleet_blocked_queue");
}

/** The closed reason words the core's `ReclaimReason` can return. */
export type InventoryReason =
  | "merged"
  | "dropped"
  | "sessionning"
  | "blocked"
  | "uncommitted_changes"
  | "project_unreachable"
  | "directory_missing"
  | "story_open";

/**
 * One Story worktree (WORK-07) — mirrors `commands/fleet.rs`'s `WorktreeInventoryRowDto`.
 * `sizeBytes: null` means never measured, which is not zero.
 */
export interface WorktreeInventoryRowDto {
  storyId: string;
  storyKey: string;
  storyTitle: string;
  storyState: string;
  projectId: string;
  projectName: string;
  projectStatus: string;
  branch: string;
  sizeBytes: number | null;
  sizeMeasuredAt: string | null;
  disposition: "reclaimable" | "in_use" | "keep";
  reason: InventoryReason;
}

/** Every Story worktree across every registered project, largest first. Read-only. */
export async function worktreeInventory(): Promise<WorktreeInventoryRowDto[]> {
  return invokeCommand<WorktreeInventoryRowDto[]>("worktree_inventory");
}

/** One worktree's measurement outcome. `sizeBytes: null` with `bounded` set means the walk could not
 * finish and nothing was cached. */
export interface WorktreeMeasureDto {
  storyId: string;
  sizeBytes: number | null;
  bounded: boolean;
  error: string | null;
}

/** Measure and cache the disk size of the named Stories' worktrees, or of all of them. Ids only. */
export async function worktreeMeasure(storyIds?: string[]): Promise<WorktreeMeasureDto[]> {
  return invokeCommand<WorktreeMeasureDto[]>("worktree_measure", { storyIds: storyIds ?? null });
}

/** One selected worktree's reclaim outcome. `removed` is the only success claim. */
export interface ReclaimOutcomeDto {
  storyId: string;
  removed: boolean;
  reason: InventoryReason | null;
  error: string | null;
}

/** Reclaim the named Stories' worktrees. Ids only; the core re-derives eligibility. At most 50. */
export async function worktreeReclaim(storyIds: string[]): Promise<ReclaimOutcomeDto[]> {
  return invokeCommand<ReclaimOutcomeDto[]>("worktree_reclaim", { storyIds });
}

// ---------------------------------------------------------------------------------------------
// Projects.
// ---------------------------------------------------------------------------------------------

/** Remove a project from every list (D-200). A reversible soft-hide, never a delete. */
export async function projectHide(projectId: string): Promise<void> {
  return invokeCommand<void>("project_hide", { projectId });
}

/** Undo `projectHide`; resolves to the project list as it now stands. */
export async function projectRestore(projectId: string): Promise<Project[]> {
  return invokeCommand<Project[]>("project_restore", { projectId });
}
