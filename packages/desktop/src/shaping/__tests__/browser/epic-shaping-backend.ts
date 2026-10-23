/**
 * A fixture backend that shapes one Epic from a one-line idea to Ready (issue #130), for
 * `epic-shaping-flow.browser.test.tsx`.
 *
 * It answers every IPC command the real `<App />` sends through Tauri's own `mockIPC`, as
 * `test/critique/m2-fixture.ts` does: the m2 world answers everything about the rest of the board, and one more
 * Epic in its Current Milestone, FLY-12, is kept here in memory and written by the shaping commands the clicks
 * send (`epic_shape`, `shaping_continue`, `round_accept`, `round_answer`, `round_accept_all`, `proposal_accept`,
 * `stage_close`). The rules follow the core's: an Accept all leaves an ADR question open, an ADR's Yes files an
 * accepted ADR Proposal, a Round is Waiting on you only while a live session holds it, a Stage closes only with
 * nothing open, and closing Write the Acceptance criteria makes the Epic and its Stories Ready and starts no
 * session.
 *
 * The agent's half is `agent`: the test calls it where a shaping session would make a board call, and every
 * write emits `board:changed` as the core does, so the app refreshes through its one subscription. Nothing here
 * proves the Rust side; `scripts/uat/uat-16-epic-shaping.mjs` walks the same flow through the real core, sidecar
 * and MCP server.
 */
import { emit } from "@tauri-apps/api/event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type {
  AcceptanceCriterionDto,
  EpicDto,
  EpicProgressDto,
  EpicShapingDto,
  MilestoneProgressDto,
  OpenItemDto,
  ProposalDto,
  RoundDto,
  RoundQuestionDto,
  StageDto,
  StoryDto,
} from "../../../adapters/tauri";
import { answer as m2 } from "../../../test/critique/m2-fixture";

export const PROJECT_ID = "p-fly";
export const EPIC_ID = "e-12";
const MILESTONE_ID = "m-3";
const NEXT: Record<string, string | null> = { challenge_spec: "slice", slice: "criteria", criteria: null };
const SPEC_LABELS: Record<string, string> = { problem: "Problem", scope: "Scope", out_of_scope: "Out of scope", exit_test: "Exit test" };

export interface QuestionDraft {
  title: string;
  question: string;
  recommendedAnswer: string;
  because: string;
  adr?: { path: string; text: string };
}

type Args = Record<string, unknown> | undefined;
const arg = (args: Args, name: string) => (args?.[name] as string | undefined) ?? "";

export function installEpicShapingBackend() {
  let ids = 0;
  const id = (prefix: string) => `${prefix}-${++ids}`;
  const now = () => new Date().toISOString();

  const epic: EpicDto = {
    id: EPIC_ID, projectId: PROJECT_ID, milestoneId: MILESTONE_ID, key: "FLY-12", title: "Feed rows show the agent's live verb",
    problem: null, scope: null, outOfScope: null, exitTest: null, state: "shaping", rank: "c",
  };
  const stages: StageDto[] = [];
  const rounds: (RoundDto & { sessionId: string | null })[] = [];
  const proposals: ProposalDto[] = [];
  const stories: StoryDto[] = [];
  const criteria: Record<string, AcceptanceCriterionDto[]> = {};
  let liveSession: string | null = null;
  let storyNumber = 12;
  /** What the held `round_post` / `round_wait` was answered with, once a Round completed with its session live. */
  const released: { sessionId: string; answers: string[] }[] = [];

  const openStage = () => stages.find((s) => s.state === "open") ?? null;
  const changed = (entity: string) => emit("board:changed", { projectId: PROJECT_ID, entity, id: EPIC_ID });

  function startSession(): string {
    liveSession = id("ses");
    return liveSession;
  }

  function openItems(stage: StageDto): OpenItemDto[] {
    const questions = rounds
      .filter((r) => r.stageId === stage.id)
      .flatMap((r) =>
        r.questions
          .filter((q) => q.answer === null)
          .map((q) => ({
            kind: "question", id: q.id, label: `Question ${q.number} of Round ${r.number} is unanswered: ${q.title}`,
            round: r.number, number: q.number, title: q.title,
          })),
      );
    const pending = proposals
      .filter((p) => p.state === "pending" && p.stageId === stage.id)
      .map((p) => {
        const payload = p.payload as Record<string, string>;
        const title =
          p.targetType === "epic"
            ? `change the ${SPEC_LABELS[payload.field]}`
            : p.targetType === "story"
              ? `add the Story "${payload.title}"`
              : `add the criterion "${payload.statement}"`;
        return { kind: "proposal", id: p.id, label: `A Proposal to ${title} is undecided`, round: null, number: null, title };
      });
    const bare =
      stage.kind === "criteria"
        ? stories
            .filter((s) => s.state === "shaping" && (criteria[s.id] ?? []).length === 0)
            .map((s) => ({
              kind: "story_without_criterion", id: s.id, label: `${s.key} “${s.title}” has no Acceptance criterion`,
              round: null, number: null, title: s.title, storyKey: s.key,
            }))
        : [];
    return [...questions, ...pending, ...bare];
  }

  function shaping(): EpicShapingDto {
    const open = openStage();
    const items = open ? openItems(open) : [];
    const warnings = (["problem", "scope", "exitTest"] as const)
      .filter((f) => !epic[f])
      .map((f) => `The ${f === "exitTest" ? "Exit test" : f === "problem" ? "Problem" : "Scope"} is not written yet`);
    return {
      epic: { ...epic },
      stages: stages.map((s) => ({ ...s })),
      rounds: rounds.map(({ sessionId, ...r }) => ({
        ...r,
        waitingOnYou: r.state === "open" && sessionId !== null && sessionId === liveSession,
        questions: r.questions.map((q) => ({ ...q })),
      })),
      proposals: proposals.filter((p) => p.state !== "accepted"),
      acceptedKnowledge: proposals.filter((p) => p.state === "accepted" && p.targetType === "adr"),
      adrLinks: [],
      stories: stories.map((s) => ({ ...s })),
      openStageStatus: open
        ? {
            stageId: open.id, openItems: items, warnings, next: NEXT[open.kind], makesReady: open.kind === "criteria",
            closable: items.length === 0,
          }
        : null,
    };
  }

  function file(targetType: string, verb: string, payload: Record<string, unknown>, rationale: string): ProposalDto {
    const stage = openStage();
    const p: ProposalDto = {
      id: id("pr"), projectId: PROJECT_ID, sessionId: liveSession, epicId: EPIC_ID, verb, targetType,
      targetId: targetType === "epic" ? EPIC_ID : null, payload, rationale, state: "pending", createdAt: now(),
      rejectionReason: null, stageId: stage?.id ?? null, roundId: rounds[rounds.length - 1]?.id ?? null,
    };
    proposals.push(p);
    return p;
  }

  /** Write one answer; an ADR's Yes files its accepted Proposal; the Round completes once nothing is open. */
  function write(q: RoundQuestionDto, round: RoundDto & { sessionId: string | null }, text: string, recommended: boolean) {
    if (round.state !== "open") throw new Error(`Round ${round.number} is answered; its answers are settled`);
    if (q.kind === "adr") {
      const yes = text.trim().toLowerCase().startsWith("yes");
      q.answer = yes ? "Yes" : "No";
      q.answeredWith = q.answer.toLowerCase() === q.recommendedAnswer.trim().toLowerCase() ? "recommended" : "own";
      if (yes && q.adr) {
        const p = file("adr", "create", { path: q.adr.path, text: q.adr.text }, `Offered as question ${q.number} of Round ${round.number}`);
        p.state = "accepted";
        q.adrProposalId = p.id;
      }
    } else {
      q.answer = text;
      q.answeredWith = recommended ? "recommended" : "own";
    }
    q.answeredAt = now();
    if (round.questions.every((x) => x.answer !== null)) {
      round.state = "answered";
      round.answeredAt = now();
      if (round.sessionId !== null && round.sessionId === liveSession) {
        released.push({ sessionId: round.sessionId, answers: round.questions.map((x) => x.answer as string) });
      }
    }
  }

  function question(questionId: string) {
    for (const round of rounds) {
      const q = round.questions.find((x) => x.id === questionId);
      if (q) return { round, q };
    }
    throw new Error(`question ${questionId} not found`);
  }

  function accept(proposalId: string) {
    const p = proposals.find((x) => x.id === proposalId);
    if (!p || p.state !== "pending") throw new Error(`Proposal ${proposalId} is not pending`);
    const payload = p.payload as Record<string, string | null>;
    if (p.targetType === "epic") {
      const field = ({ problem: "problem", scope: "scope", out_of_scope: "outOfScope", exit_test: "exitTest" } as const)[
        payload.field as "problem"
      ];
      epic[field] = payload.text;
    } else if (p.targetType === "story") {
      const after = payload.runs_after_story_id ?? (payload.runs_after_proposal_id ? stories.find((s) => s.id === `story-of-${payload.runs_after_proposal_id}`)?.id : null);
      if (payload.runs_after_proposal_id && !after) throw new Error("accept the Story it runs after first");
      stories.push({
        id: `story-of-${p.id}`, projectId: PROJECT_ID, epicId: EPIC_ID, key: `FLY-${++storyNumber}`, title: payload.title as string,
        description: payload.description, state: "shaping", runsAfterStoryId: after ?? null, runsAfterReason: payload.runs_after_reason,
        rank: payload.rank as string,
      });
    } else if (p.targetType === "criterion") {
      const storyId = payload.story_id as string;
      const list = (criteria[storyId] ??= []);
      const cid = id("ac");
      list.push({
        id: cid, storyId, statement: payload.statement as string, accepted: false, acceptedAt: null, rank: String(list.length),
        check: payload.check_command
          ? { id: id("chk"), command: payload.check_command, timeoutSecs: 600, result: "not_run", commitSha: null, stale: false, outputTail: null }
          : null,
      });
    }
    p.state = "accepted";
  }

  function closeStage(stageId: string) {
    const stage = stages.find((s) => s.id === stageId && s.state === "open");
    if (!stage) throw new Error("the Stage is not open");
    const items = openItems(stage);
    if (items.length > 0) throw new Error(items.map((i) => i.label).join("; "));
    stage.state = "closed";
    const ended = liveSession;
    liveSession = null;
    const nextKind = NEXT[stage.kind];
    if (!nextKind) {
      const madeReady = stories.filter((s) => s.state === "shaping").map((s) => s.id);
      for (const s of stories) if (s.state === "shaping") s.state = "ready";
      epic.state = "ready";
      return { closedStageId: stage.id, opened: null, madeReady, session: null, launchError: null, sidecarWarning: null, ended };
    }
    const opened: StageDto = { id: id("st"), kind: nextKind, state: "open", rank: stage.rank + 1 };
    stages.push(opened);
    const session = startSession();
    return {
      closedStageId: stage.id, opened, madeReady: [], launchError: null, sidecarWarning: null, ended,
      session: { id: session, epicId: EPIC_ID, status: "running", permissionMode: "default" },
    };
  }

  function respond(cmd: string, args: Args): unknown {
    switch (cmd) {
      case "epic_list": {
        const base = m2(cmd, args) as EpicDto[];
        return arg(args, "milestoneId") === MILESTONE_ID ? [...base, { ...epic }] : base;
      }
      case "milestone_progress": {
        const base = m2(cmd, args) as MilestoneProgressDto | null;
        if (!base || base.milestoneId !== MILESTONE_ID) return base;
        const open = rounds.find((r) => r.state === "open");
        const row: EpicProgressDto = {
          epicId: EPIC_ID, key: epic.key, title: epic.title, state: epic.state, proposals: 0,
          counts: { shaping: 0, ready: 0, running: 0, waitingOnYou: 0, stopped: 0, inReview: 0, merged: 0, dropped: 0, storiesTotal: stories.length },
          attention: open ? (open.sessionId !== null && open.sessionId === liveSession ? "waiting_on_you" : "round_waiting") : null,
        };
        for (const s of stories) {
          if (s.state === "shaping") row.counts.shaping += 1;
          if (s.state === "ready") row.counts.ready += 1;
        }
        return { ...base, epics: [...base.epics, row], epicsTotal: base.epicsTotal + 1 };
      }
      case "story_list_for_project": return [...(m2(cmd, args) as StoryDto[]), ...stories.map((s) => ({ ...s }))];
      case "story_list": return arg(args, "epicId") === EPIC_ID ? stories.map((s) => ({ ...s })) : m2(cmd, args);
      case "story_get": return stories.find((s) => s.id === arg(args, "storyId")) ?? m2(cmd, args);
      case "criterion_list": {
        const own = criteria[arg(args, "storyId")];
        return own ? own.map((c) => ({ ...c })) : stories.some((s) => s.id === arg(args, "storyId")) ? [] : m2(cmd, args);
      }
      case "epic_shaping_session": return arg(args, "epicId") === EPIC_ID ? liveSession : m2(cmd, args);
      case "epic_shaping_rounds": return arg(args, "epicId") === EPIC_ID ? shaping() : m2(cmd, args);
      case "epic_shape": {
        if (arg(args, "epicId") !== EPIC_ID) return m2(cmd, args);
        if (epic.state !== "shaping" || liveSession) throw new Error("the Epic cannot be shaped now");
        if (stages.length === 0) stages.push({ id: id("st"), kind: "challenge_spec", state: "open", rank: 1 });
        void changed("session");
        return { id: startSession(), epicId: EPIC_ID, status: "running", permissionMode: "default" };
      }
      case "shaping_continue": {
        if (rounds.length === 0) throw new Error("this Epic has no Round to continue from; Shape it to start its first Round");
        if (liveSession) throw new Error("a shaping session is already live on this Epic");
        void changed("session");
        return { id: startSession(), epicId: EPIC_ID, status: "running", permissionMode: "default" };
      }
      case "round_accept":
      case "round_answer": {
        const { round, q } = question(arg(args, "questionId"));
        if (q.answer !== null) throw new Error("already answered");
        write(q, round, cmd === "round_accept" ? q.recommendedAnswer : arg(args, "answer"), cmd === "round_accept");
        void changed("round");
        return null;
      }
      case "round_accept_all": {
        const round = rounds.find((r) => r.id === arg(args, "roundId"));
        if (!round) throw new Error("no such Round");
        const open = round.questions.filter((q) => q.answer === null && q.kind !== "adr");
        if (open.length === 0) throw new Error(`only ADR questions are left open in Round ${round.number}: answer each one Yes or No`);
        for (const q of open) write(q, round, q.recommendedAnswer, true);
        void changed("round");
        return null;
      }
      case "proposal_accept": {
        accept(arg(args, "proposalId"));
        void changed("proposal");
        return null;
      }
      case "stage_close": {
        const { ended: _ended, ...dto } = closeStage(arg(args, "stageId"));
        void changed("stage");
        return dto;
      }
      default:
        return m2(cmd, args);
    }
  }

  mockIPC((cmd, payload) => respond(cmd, payload as Args), { shouldMockEvents: true });

  /** The shaping agent's board calls, each a write the core would make for the live session. */
  const agent = {
    /** `round_post`: a Round in the open Stage, held on the live session. */
    async postRound(note: string, questions: QuestionDraft[]) {
      const stage = openStage();
      if (!stage || !liveSession) throw new Error("no live shaping session in an open Stage");
      const number = rounds.filter((r) => r.stageId === stage.id).length + 1;
      rounds.push({
        id: id("r"), stageId: stage.id, stageKind: stage.kind, number, note, state: "open", waitingOnYou: false,
        postedAt: now(), answeredAt: null, sessionId: liveSession,
        questions: questions.map((q, i) => ({
          id: id("q"), number: i + 1, title: q.title, question: q.question, grounding: "Read the Epic's one line",
          recommendedAnswer: q.recommendedAnswer, because: q.because, answer: null, answeredWith: null, answeredAt: null,
          kind: q.adr ? "adr" : "question",
          adr: q.adr ? { ...q.adr, hardToReverse: "Every tool's row reads its verb from it", surprising: "A reader expects the model to name its own action", losingAlternative: "Asking the model for a verb on each call", relatesTo: null } : null,
          adrProposalId: null,
        })),
      });
      await changed("round");
    },
    /** `round_wait` from a fresh session: it takes the open Round over. */
    async roundWait() {
      const open = rounds.find((r) => r.state === "open");
      if (!open || !liveSession) throw new Error("no open Round to wait on");
      open.sessionId = liveSession;
      await changed("round");
    },
    async proposeSpecChange(field: string, text: string) {
      file("epic", "amend", { field, text }, "Round 1 settled it");
      await changed("proposal");
    },
    /** `propose_story`, running after an earlier proposed Story when `runsAfter` names its proposal. */
    async proposeStory(title: string, description: string, runsAfter?: { proposalId: string; reason: string }) {
      const rank = String.fromCharCode(97 + proposals.filter((p) => p.targetType === "story").length);
      const p = file("story", "create", {
        title, description, rank, runs_after_story_id: null, runs_after_proposal_id: runsAfter?.proposalId ?? null,
        runs_after_reason: runsAfter?.reason ?? null,
      }, "Slices the Epic");
      await changed("proposal");
      return p.id;
    },
    async proposeCriterion(storyKey: string, statement: string, check: string) {
      const story = stories.find((s) => s.key === storyKey);
      if (!story) throw new Error(`no Story ${storyKey}`);
      file("criterion", "create", { story_id: story.id, statement, check_command: check }, "Proves the slice");
      await changed("proposal");
    },
  };

  return {
    agent,
    released,
    /** The live session dies (killed, crashed): the Round it posted stays open with its answers. */
    async killSession() {
      liveSession = null;
      await changed("session");
    },
    get liveSession() {
      return liveSession;
    },
    get epic() {
      return { ...epic };
    },
    criteriaOf(storyKey: string) {
      const story = stories.find((s) => s.key === storyKey);
      return story ? (criteria[story.id] ?? []) : [];
    },
  };
}
