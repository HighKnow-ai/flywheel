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
  /** Issue #134: its Epics Done, and its Epics with a Dropped one left out. Every Epic is Done, and its
   * exit test can be confirmed, when `epicsDone === epicsTotal > 0`. Always sent by the core. */
  epicsDone?: number;
  epicsTotal?: number;
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

/**
 * Move a Milestone on the Roadmap: just before `beforeId`, or to the end when it is `null`. The Current
 * Milestone follows the new order; the core refuses a Done or Dropped Milestone, and anyone but the human.
 */
export async function milestoneMove(milestoneId: string, beforeId: string | null): Promise<void> {
  await invokeCommand<void>("milestone_move", { milestoneId, beforeId });
}

/** Move a Milestone (`shaping`, `ready` or `dropped`); `done` is `milestoneConfirmDone`'s. */
export async function milestoneSetState(milestoneId: string, to: string): Promise<void> {
  await invokeCommand<void>("milestone_set_state", { milestoneId, to });
}

/**
 * A Milestone's or an Epic's Stories by state — mirrors `commands/roadmap.rs`'s `StoryStateCountsDto`.
 * Attention splits Running: `running` counts only Running Stories neither Waiting on you nor Stopped, so
 * the counts add up. `storiesTotal` leaves out Dropped Stories, which are counted on their own.
 */
export interface StoryStateCountsDto {
  shaping: number;
  ready: number;
  running: number;
  waitingOnYou: number;
  stopped: number;
  inReview: number;
  merged: number;
  dropped: number;
  storiesTotal: number;
}

/** One Epic's progress row — mirrors `commands/roadmap.rs`'s `EpicProgressDto`. */
export interface EpicProgressDto {
  epicId: string;
  key: string;
  title: string;
  /** The state with In progress derived: `shaping`, `ready`, `in_progress` or `done`. */
  state: string;
  counts: StoryStateCountsDto;
  /**
   * Issue #124, shown in place of the state word: `waiting_on_you` while a live shaping session is held on an
   * open Round of the Epic, `round_waiting` while a Round is open with no live shaping session, else `null`.
   */
  attention: string | null;
}

/** The Milestone header's numbers — mirrors `commands/roadmap.rs`'s `MilestoneProgressDto`. */
export interface MilestoneProgressDto {
  milestoneId: string;
  title: string;
  exitTest: string | null;
  state: string;
  /** Whether this is the Current Milestone; the Roadmap strip can select any other one. */
  current: boolean;
  nextMilestoneTitle: string | null;
  counts: StoryStateCountsDto;
  epicsDone: number;
  epicsTotal: number;
  epics: EpicProgressDto[];
}

/**
 * One Milestone's progress at a glance: `milestoneId` when given (picked on the Roadmap strip), else the
 * Current Milestone's. `null` when there is no such Milestone. Counted by the core.
 */
export async function milestoneProgress(
  projectId: string,
  milestoneId: string | null = null,
): Promise<MilestoneProgressDto | null> {
  return invokeCommand<MilestoneProgressDto | null>("milestone_progress", { projectId, milestoneId });
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

/** Move an Epic (`shaping` or `ready`); `done` is `epicConfirmDone`'s, which starts the roadmap Round. */
export async function epicSetState(epicId: string, to: string): Promise<void> {
  await invokeCommand<void>("epic_set_state", { epicId, to });
}

/** A shaping session as Shape returns it — mirrors `commands/shaping.rs`'s `ShapingSessionDto`. */
export interface ShapingSessionDto {
  id: string;
  epicId: string;
  status: string;
  permissionMode: string;
}

/** Shape an Epic in Shaping (issue #122): start a read-only shaping session on it. */
export async function epicShape(epicId: string): Promise<ShapingSessionDto> {
  return invokeCommand<ShapingSessionDto>("epic_shape", { epicId });
}

/**
 * Continue shaping (issue #124): a fresh shaping session on an Epic whose Rounds outlived the session that
 * posted them. Its packet carries every Round with its answers, and it picks the open Round up with
 * `round_wait`. Refused for an Epic with no Round yet (Shape starts that one).
 */
export async function shapingContinue(epicId: string): Promise<ShapingSessionDto> {
  return invokeCommand<ShapingSessionDto>("shaping_continue", { epicId });
}

/** Revisit roadmap (issue #133): the session a roadmap Round runs in. */
export interface RoadmapSessionDto {
  id: string;
  projectId: string;
  status: string;
  permissionMode: string;
}

/** A roadmap Round (issue #133) — mirrors `commands/roadmap_round.rs`'s `RoadmapRoundDto`. */
export interface RoadmapRoundDto {
  id: string;
  number: number;
  /** `open`, `closed` or `dismissed`. */
  state: string;
  /** `revisit`, `epic_done` or `milestone_done`. */
  triggerType: string;
  /** "Revisit roadmap", "Epic FLY-3 done". */
  triggerLabel: string;
  /** Open with a live session held on it until every Proposal is decided. */
  waitingOnYou: boolean;
  /** The session that owns it is live. */
  sessionLive: boolean;
  sessionId: string | null;
  postedAt: string;
  closedAt: string | null;
  /** A closed Round that filed none said the Roadmap still holds. */
  proposalsFiled: number;
  /** Issue #134: Done triggers that came while it was open ("Epic FLY-4 done"); its next session reads
   * them. Always sent by the core. */
  notedTriggers?: string[];
}

/** What confirming an exit test did (issue #134) — mirrors `commands/roadmap_round.rs`'s `ConfirmDoneDto`. */
export interface ConfirmDoneDto {
  /** `opened`: a roadmap Round opened on it. `noted`: one was open, and the trigger is noted on it. */
  outcome: "opened" | "noted";
  roundNumber: number;
  sessionId: string | null;
  /** Why the Round's session could not start; the record is Done all the same and the Round waits. */
  sessionError: string | null;
}

/** Confirm an Epic's exit test (issue #134): it moves to Done and a short roadmap Round starts. */
export async function epicConfirmDone(epicId: string): Promise<ConfirmDoneDto> {
  return invokeCommand<ConfirmDoneDto>("epic_confirm_done", { epicId });
}

/** Confirm a Milestone's exit test (issue #134): it moves to Done and a Roadmap Round starts. */
export async function milestoneConfirmDone(milestoneId: string): Promise<ConfirmDoneDto> {
  return invokeCommand<ConfirmDoneDto>("milestone_confirm_done", { milestoneId });
}

/** A Roadmap Proposal of the open Round, with the change in one line. */
export interface RoadmapProposalDto extends ProposalDto {
  summary: string;
  /** The Milestone its ghost row sits under; `null` for a new Milestone, which sits at the end. */
  anchorMilestoneId: string | null;
}

/** What the Roadmap strip reads about roadmap Rounds. */
export interface RoadmapRoundViewDto {
  open: RoadmapRoundDto | null;
  proposals: RoadmapProposalDto[];
  /** The latest Round once none is open. */
  last: RoadmapRoundDto | null;
}

/** Revisit roadmap: start the roadmap Round's session (or the one that takes an open Round over). */
export async function roadmapRevisit(projectId: string): Promise<RoadmapSessionDto> {
  return invokeCommand<RoadmapSessionDto>("roadmap_revisit", { projectId });
}

/** The open roadmap Round with its Proposals, or the latest one once none is open. */
export async function roadmapRoundRead(projectId: string): Promise<RoadmapRoundViewDto> {
  return invokeCommand<RoadmapRoundViewDto>("roadmap_round_read", { projectId });
}

/** Dismiss the open roadmap Round: it closes with no change. Human-only. */
export async function roadmapRoundDismiss(roundId: string): Promise<void> {
  await invokeCommand<void>("roadmap_round_dismiss", { roundId });
}

/** The Epic's live shaping session id, or `null` when none is live. */
export async function epicShapingSession(epicId: string): Promise<string | null> {
  return invokeCommand<string | null>("epic_shaping_session", { epicId });
}

/** A Stage of shaping (issue #123) — mirrors `commands/shaping.rs`'s `StageDto`. */
export interface StageDto {
  id: string;
  /** `challenge_spec`, `slice`, `criteria` or `exit_test`. */
  kind: string;
  /** `open` or `closed`. */
  state: string;
  rank: number;
}

/** One numbered question of a Round, with its answer once given — mirrors `RoundQuestionDto`. */
export interface RoundQuestionDto {
  id: string;
  number: number;
  title: string;
  question: string;
  grounding: string;
  recommendedAnswer: string;
  because: string;
  answer: string | null;
  /** `recommended` or `own`, once answered. */
  answeredWith: string | null;
  answeredAt: string | null;
  /**
   * `question`, or `adr` for an ADR offered inside the Round (issue #129): answered Yes or No, its Yes settles
   * an accepted ADR Proposal on the Epic, and its answer is final once given. Optional for older fixtures.
   */
  kind?: "question" | "adr";
  /** An ADR question's draft and its bar lines. */
  adr?: AdrDraftDto | null;
  /** The accepted ADR Proposal an ADR question's Yes filed. */
  adrProposalId?: string | null;
}

/** An ADR draft and the four bar lines shown beside it, never written into the file — mirrors `AdrDraftDto`. */
export interface AdrDraftDto {
  /** `docs/adr/NNNN-slug.md`. */
  path: string;
  /** The ADR's whole text, as the Story will write it. */
  text: string;
  hardToReverse: string;
  surprising: string;
  losingAlternative: string;
  /** `null` reads as "none". */
  relatesTo: string | null;
}

/** A Round of questions an agent posted into a Stage — mirrors `commands/shaping.rs`'s `RoundDto`. */
export interface RoundDto {
  id: string;
  stageId: string;
  stageKind: string;
  number: number;
  note: string;
  /** `open` or `answered`. */
  state: string;
  /**
   * Issue #124: open with a LIVE shaping session held on it, so Waiting on you. An open Round whose session
   * died is not, though the dock still takes its answers.
   */
  waitingOnYou: boolean;
  postedAt: string;
  answeredAt: string | null;
  questions: RoundQuestionDto[];
}

/** An Epic with its Stages and Rounds, oldest first. */
export interface EpicShapingDto {
  epic: EpicDto;
  stages: StageDto[];
  rounds: RoundDto[];
  /** The Epic's undecided and rejected Proposals, oldest first (issue #125): ghost fields and struck-through
   * lines. An accepted one is already in the field it rewrote. */
  proposals: ProposalDto[];
  /** The ADRs linked to the Epic, by repo-relative path (issue #129). Optional for older fixtures. */
  adrLinks?: string[];
  /** The Epic's accepted ADR and glossary Proposals (issue #129): chips until a Story writes them. */
  acceptedKnowledge?: ProposalDto[];
  /** What is still open in the open Stage (issue #126), or `null` before shaping has opened one. */
  openStageStatus?: StageStatusDto | null;
  /** The Epic's Stories in execution order (issue #127): its Story columns. Optional for older fixtures. */
  stories?: StoryDto[];
}

/** One thing that keeps a Stage open — mirrors `commands/shaping.rs`'s `OpenItemDto`. */
export interface OpenItemDto {
  /** `question` or `proposal`. */
  kind: string;
  /** The question's or the Proposal's id. */
  id: string;
  /** The item in words: "Question 2 of Round 1 is unanswered: Audience". */
  label: string;
  /** A question's Round and number; `null` for a Proposal. */
  round: number | null;
  number: number | null;
  /** A question's title, or what a Proposal would do ("change the Problem"). */
  title: string;
}

/** What is still open in a Stage — mirrors `commands/shaping.rs`'s `StageStatusDto`. */
export interface StageStatusDto {
  stageId: string;
  /** Unanswered questions, then undecided Proposals. The Stage closes only once this is empty. */
  openItems: OpenItemDto[];
  /** Empty spec fields: listed, never blocking. */
  warnings: string[];
  /** The Stage closing this one opens, or `null` for the last Stage. */
  next: string | null;
  closable: boolean;
}

/** What Close Stage did — mirrors `commands/shaping.rs`'s `StageCloseDto`. */
export interface StageCloseDto {
  closedStageId: string;
  /** The Stage the close opened; `null` when the closed Stage was its record's last and made it Ready (a
   * Milestone's Exit test, issue #132). */
  opened: StageDto | null;
  /** The next Stage's shaping session, or `null` when it could not start (`launchError` says why). */
  session: ShapingSessionDto | null;
  launchError: string | null;
  /** Set when the closed Stage's session was recorded as ended but its process could not be confirmed stopped. */
  sidecarWarning: string | null;
}

/**
 * Close Stage (issue #126): close the Epic's open Stage once nothing in it is open, open the next one and start
 * its shaping session from a fresh packet. Human-only; refused while anything is open, the refusal naming each
 * item.
 */
export async function stageClose(stageId: string): Promise<StageCloseDto> {
  return invokeCommand<StageCloseDto>("stage_close", { stageId });
}

/** A Milestone's shaping session as Shape returns it (issue #132) — mirrors `MilestoneShapingSessionDto`. */
export interface MilestoneShapingSessionDto {
  id: string;
  milestoneId: string;
  status: string;
  permissionMode: string;
}

/** Shape a Milestone in Shaping (issue #132): start a read-only shaping session on its exit test. */
export async function milestoneShape(milestoneId: string): Promise<MilestoneShapingSessionDto> {
  return invokeCommand<MilestoneShapingSessionDto>("milestone_shape", { milestoneId });
}

/** Continue shaping a Milestone whose Rounds outlived the session that posted them (issue #132). */
export async function milestoneShapingContinue(milestoneId: string): Promise<MilestoneShapingSessionDto> {
  return invokeCommand<MilestoneShapingSessionDto>("milestone_shaping_continue", { milestoneId });
}

/** The Milestone's live shaping session id, or `null` when none is live (issue #132). */
export async function milestoneShapingSession(milestoneId: string): Promise<string | null> {
  return invokeCommand<string | null>("milestone_shaping_session", { milestoneId });
}

/** A Milestone with its one Stage, its Rounds and its exit-test Proposals — mirrors `MilestoneShapingDto`. */
export interface MilestoneShapingDto {
  milestone: MilestoneDto;
  stages: StageDto[];
  rounds: RoundDto[];
  /** The undecided and rejected exit-test Proposals, oldest first: a ghost over the exit test and
   * struck-through lines. An accepted one is already in the exit test. */
  proposals: ProposalDto[];
  /** What is still open in the open Stage, or `null` before shaping opened it and once it is closed. */
  openStageStatus: StageStatusDto | null;
}

/** The Milestone's Stage, Rounds and Proposals (issue #132): what its dock shows. Read-only. */
export async function milestoneShapingRounds(milestoneId: string): Promise<MilestoneShapingDto> {
  return invokeCommand<MilestoneShapingDto>("milestone_shaping_rounds", { milestoneId });
}

/** The Epic's Stages and Rounds (issue #123): what the Round dock shows. Read-only. */
export async function epicShapingRounds(epicId: string): Promise<EpicShapingDto> {
  return invokeCommand<EpicShapingDto>("epic_shaping_rounds", { epicId });
}

/** Accept a question's recommended answer as it is. Human-only; the last answer releases the agent. */
export async function roundAccept(questionId: string): Promise<void> {
  await invokeCommand<void>("round_accept", { questionId });
}

/** Answer a question in your own words. Human-only. */
export async function roundAnswer(questionId: string, answer: string): Promise<void> {
  await invokeCommand<void>("round_answer", { questionId, answer });
}

/** Accept the recommended answer of every question still open in a Round. Questions only. */
export async function roundAcceptAll(roundId: string): Promise<void> {
  await invokeCommand<void>("round_accept_all", { roundId });
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
  /** The one-line constraint behind the runs-after marker (issue #127). Optional for older fixtures. */
  runsAfterReason?: string | null;
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

/** The size of the Context packet a Story's next session starts from (docs/mvp-spec.md §4.2). */
export interface PacketSizeDto {
  bytes: number;
  /** A rough estimate: one token per four characters. */
  approxTokens: number;
  /** Above the soft warning threshold of about 20K tokens. There is no hard budget. */
  overSoftLimit: boolean;
}

/** The Context packet's size for a Story. Read-only. */
export async function storyContextPacketSize(storyId: string): Promise<PacketSizeDto> {
  return invokeCommand<PacketSizeDto>("story_context_packet_size", { storyId });
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
  /** Whether the branch has moved since the current result ran. */
  stale: boolean;
  /** The tail of what the current run printed; `null` when not run. */
  outputTail: string | null;
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

/** One Task on a Story's checklist — mirrors `commands/task.rs`'s `TaskDto`. */
export interface TaskDto {
  id: string;
  storyId: string;
  title: string;
  /** `open`, `doing`, `done` or `dropped`. */
  state: string;
  droppedReason: string | null;
  rank: string;
  /** What the agent (or the developer) wrote down while working the Task; `null` when there is none. */
  note: string | null;
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

/** Give a Task a new title. */
export async function taskRename(taskId: string, title: string): Promise<void> {
  await invokeCommand<void>("task_rename", { taskId, title });
}

/** Replace a Task's note; a blank note clears it. */
export async function taskSetNote(taskId: string, note: string): Promise<void> {
  await invokeCommand<void>("task_set_note", { taskId, note });
}

/** Move a Task just before `beforeTaskId` in its Story's checklist, or to the end when that is null. */
export async function taskMove(taskId: string, beforeTaskId: string | null): Promise<void> {
  await invokeCommand<void>("task_move", { taskId, beforeTaskId });
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
  /** The developer's reason, once rejected. */
  rejectionReason: string | null;
  /** The shaping Stage and Round it was filed in (issue #125); null for a Story session's. */
  stageId: string | null;
  roundId: string | null;
}

/** A project's pending Proposals, oldest first. Read-only. */
export async function proposalListPending(projectId: string): Promise<ProposalDto[]> {
  return invokeCommand<ProposalDto[]>("proposal_list_pending", { projectId });
}

/** Accept a pending Proposal, applying it in the same transaction. Human-only. */
export async function proposalAccept(proposalId: string): Promise<void> {
  await invokeCommand<void>("proposal_accept", { proposalId });
}

/** Amend (issue #125): accept a pending Proposal with the developer's edited payload, applied in the same
 * transaction. Human-only; the event keeps the agent's original. */
export async function proposalAmend(proposalId: string, payload: unknown): Promise<void> {
  await invokeCommand<void>("proposal_amend", { proposalId, payload });
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
 * over `session_start`. It takes no permission mode: the session kind decides it (ADR 0001), and
 * the returned `permissionMode` says which one it was.
 */
export async function startSession(storyId: string, instruction?: string): Promise<SessionDto> {
  return invokeCommand<SessionDto>("session_start", { storyId, instruction });
}

/**
 * The developer's Start: a Ready Story gets its worktree, branch and session, then moves to
 * Running. The core refuses a Story that is not Ready.
 */
export async function storyStart(storyId: string, instruction?: string): Promise<SessionDto> {
  return invokeCommand<SessionDto>("story_start", { storyId, instruction: instruction ?? null });
}

/**
 * How a session ended (`sessions.ending_reason`, docs/mvp-spec.md §4.5): a best-effort label.
 * `stopped_by_developer` is a stop the developer made, which stays out of Needs you.
 */
export type EndingReason =
  | "refusal"
  | "usage_limit"
  | "api_error"
  | "crash"
  | "app_quit"
  | "stopped_by_developer"
  | "ended_without_hand_off"
  | "handed_off"
  | "unknown";

/** A Stopped Story's dead session — mirrors `commands/session.rs`'s `StoppedDto`. */
export interface StoppedDto {
  sessionId: string;
  endingReason: EndingReason | null;
  endedAt: string | null;
}

/** The Story's Stopped attention, or `null` when it is not Stopped. Read-only. */
export async function storyStopped(storyId: string): Promise<StoppedDto | null> {
  return invokeCommand<StoppedDto | null>("story_stopped", { storyId });
}

/**
 * Resume a Stopped Story: a fresh session in its worktree from the Context packet, with the
 * optional one-line note. Never `claude --resume`. The core refuses a Story that is not Stopped.
 */
/**
 * The developer's Drop: the Story moves to Dropped and its worktree and branch are removed,
 * uncommitted work included. The record stays readable. The core refuses while a session is live
 * and for a Merged Story.
 */
export async function storyDrop(storyId: string): Promise<void> {
  return invokeCommand<void>("story_drop", { storyId });
}

export async function storyResume(storyId: string, note?: string): Promise<SessionDto> {
  return invokeCommand<SessionDto>("story_resume", { storyId, note: note ?? null });
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
  /** `null` for a shaping session (issue #122), which has no Story. */
  storyId: string | null;
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
  /** How the session ended, or `null` while it is live. */
  endingReason: EndingReason | null;
}

/** `storyId`'s agent runs, newest first, bounded. Read-only. Thin wrapper over `sessions_for_story`. */
export async function sessionsForStory(
  storyId: string,
  limit?: number,
  offset?: number,
): Promise<RunSummaryDto[]> {
  return invokeCommand<RunSummaryDto[]>("sessions_for_story", { storyId, limit, offset });
}

/** One session's stored row (status, start and end, ending reason), or `null` for an unknown id.
 * Read-only. Thin wrapper over `session_get`. */
export async function sessionGet(sessionId: string): Promise<RunSummaryDto | null> {
  return invokeCommand<RunSummaryDto | null>("session_get", { sessionId });
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
 * `"allow_always"` — validated server-side before any database call. `rule` is the "Always allow"
 * rule in Claude Code's syntax (`Bash(npm test:*)`); without it the backend remembers the exact
 * command. The backend refuses a rule that could match a Gated action and leaves the request pending.
 */
export async function answerPermissionRequest(
  requestId: string,
  decision: "allow" | "deny" | "allow_always",
  rule?: string,
): Promise<void> {
  const args = rule === undefined ? { requestId, decision } : { requestId, decision, rule };
  await invokeCommand<void>("session_answer_permission", args);
}

/**
 * Answer an agent's open question (issue #100). `answers` maps each question's text to the option
 * labels the developer picked and/or the text they typed. The backend checks every question is
 * answered (one value for a single-choice question), stores the answers and relays them to the
 * agent. A question is never allowed or denied: `answerPermissionRequest` refuses one.
 */
export async function answerQuestion(requestId: string, answers: Record<string, string[]>): Promise<void> {
  await invokeCommand<void>("session_answer_question", { requestId, answers });
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
  /** `null` for a routine request, or a `DestructiveCategory` kebab-case name for a Gated action. */
  destructiveCategory: string | null;
  /** The rule the card's Always allow field is pre-filled with (`Bash(npm test)`); `null` for a
   * Gated action, which no rule may cover. */
  suggestedRule: string | null;
}

/** Every pending permission request for `sessionId`, oldest first. Read-only. */
export async function pendingPermissionRequests(sessionId: string): Promise<PendingPermissionRequestDto[]> {
  return invokeCommand<PendingPermissionRequestDto[]>("session_pending_permissions", { sessionId });
}

/** D-37's blocked signal for one project: every blocked Story id plus the count, read together. */
export interface BlockedSummaryDto {
  blockedStoryIds: string[];
  /** Issue #124: the Epics a live shaping session waits on, held on an open Round. */
  waitingEpicIds: string[];
  /** Issue #132: the Milestones a live shaping session waits on, held on an open Round. Optional for older
   * fixtures. */
  waitingMilestoneIds?: string[];
  /** Issue #133: a live roadmap session is held on the project's open roadmap Round. */
  roadmapWaiting?: boolean;
  /** The project's count of what is Waiting on you: these Stories, Epics and Milestones, and the Roadmap. */
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
  /** `null` for a shaping session; `storyKey` and `storyTitle` are then its Epic's. */
  storyId: string | null;
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

/** The PATH Flywheel adopted from the login shell at startup, and whether `claude` is on it. */
export interface LaunchEnvironmentDto {
  path: string;
  /** Set when the login shell's PATH could not be read and the inherited one was kept. */
  pathWarning: string | null;
  /** Set when `claude` is not on that PATH, naming the PATH searched. */
  claudeError: string | null;
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
  /** The title of the Story's *doing* Task (what its agent is doing now); `null` when none is doing. */
  doingTaskTitle: string | null;
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
  /** The rule the card pre-fills; `null` for a Gated action. */
  suggestedRule: string | null;
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

/** A shaping Round a live session is held on (issue #124) — mirrors `commands/fleet.rs`'s `WaitingRoundDto`. */
export interface WaitingRoundDto {
  roundId: string;
  roundNumber: number;
  /** Issue #133: `epic` for an Epic's Round, `roadmap` for a roadmap Round; issue #132: `milestone` for a
   * Milestone's. */
  subject: "epic" | "milestone" | "roadmap";
  /** The Stage's kind; `null` for a roadmap Round, which has no Stage. */
  stageKind: string | null;
  sessionId: string;
  projectId: string;
  projectName: string;
  projectKeyPrefix: string;
  /** The Epic an Epic's Round shapes; `null` for a Milestone's or a roadmap Round. */
  epicId: string | null;
  epicKey: string | null;
  epicTitle: string | null;
  /** The Milestone a Milestone's Round shapes (issue #132); `null` (or absent in older fixtures) otherwise. */
  milestoneId?: string | null;
  milestoneTitle?: string | null;
  /** When the Round was posted: it has waited on the developer since. */
  waitingSince: string;
  /** An Epic's Round: questions answered of those asked. A roadmap Round: Proposals decided of those filed. */
  answered: number;
  questions: number;
}

/** Every shaping Round waiting on you, across every project, longest waiting first. */
export async function fleetWaitingRounds(): Promise<WaitingRoundDto[]> {
  return invokeCommand<WaitingRoundDto[]>("fleet_waiting_rounds");
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
