/**
 * PROTOTYPE — throwaway. The shaping session's state, shared by every variant so they differ in
 * screen only. In memory; nothing persists across a reload. "Written to board" is simulated, and
 * is exactly what survives the simulated session death.
 */
import React, { createContext, useCallback, useContext, useMemo, useReducer, useRef } from "react";
import { PROPOSALS, QUESTIONS, ROUNDS, STAGES, type Proposal, type Question, type Stage } from "./script";

export type Answer = { kind: "recommended" | "own"; text: string };
export type Decision = "accepted" | "amended" | "rejected";
export type ProposalState = { decision?: Decision; body: string; title: string; check?: string };
export type LogEntry = { at: string; text: string };

type State = {
  stage: Stage;
  answers: Record<string, Answer>;
  proposals: Record<string, ProposalState>;
  /** Rounds the agent has posted, in order. */
  posted: number[];
  agentBusy: boolean;
  session: number;
  sessionDead: boolean;
  resumedNote?: string;
  log: LogEntry[];
};

type Action =
  | { t: "answer"; id: string; answer: Answer }
  | { t: "decide"; id: string; decision: Decision; body?: string; title?: string }
  | { t: "post"; round: number }
  | { t: "busy"; v: boolean }
  | { t: "close-stage" }
  | { t: "kill" }
  | { t: "resume" };

const now = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function initial(): State {
  return {
    stage: "spec",
    answers: {},
    proposals: Object.fromEntries(PROPOSALS.map((p) => [p.id, { body: p.body, title: p.title, check: p.check }])),
    posted: [1],
    agentBusy: false,
    session: 1,
    sessionDead: false,
    log: [{ at: now(), text: "Shaping session 1 started on FLY-41" }],
  };
}

function reducer(s: State, a: Action): State {
  switch (a.t) {
    case "answer": {
      const q = QUESTIONS.find((x) => x.id === a.id)!;
      let proposals = s.proposals;
      // q10 accepted → c4b gains a Check; that's the one answer that edits a proposal directly.
      if (a.id === "q10" && a.answer.kind === "recommended")
        proposals = { ...proposals, c4b: { ...proposals.c4b, check: "npm run test:browser -- answer-resumes (stub adapter)" } };
      return {
        ...s,
        proposals,
        answers: { ...s.answers, [a.id]: a.answer },
        log: [...s.log, { at: now(), text: `Q${q.id.slice(1)} answered${a.answer.kind === "own" ? " (your own answer)" : ""}: written to board` }],
      };
    }
    case "decide": {
      const prev = s.proposals[a.id];
      const p = PROPOSALS.find((x) => x.id === a.id)!;
      return {
        ...s,
        proposals: { ...s.proposals, [a.id]: { ...prev, decision: a.decision, body: a.body ?? prev.body, title: a.title ?? prev.title } },
        log: [...s.log, { at: now(), text: `${kindWord(p)} “${a.title ?? prev.title}” ${a.decision}` }],
      };
    }
    case "post":
      return s.posted.includes(a.round) ? s : { ...s, posted: [...s.posted, a.round], agentBusy: false };
    case "busy":
      return { ...s, agentBusy: a.v };
    case "close-stage": {
      const order: Stage[] = ["spec", "slice", "criteria", "done"];
      const next = order[order.indexOf(s.stage) + 1];
      const label = STAGES.find((x) => x.id === s.stage)?.label;
      return { ...s, stage: next, log: [...s.log, { at: now(), text: `Stage closed: ${label}` }] };
    }
    case "kill":
      return {
        ...s,
        sessionDead: true,
        agentBusy: false,
        log: [...s.log, { at: now(), text: `Session ${s.session} ended: model refusal [reasoning_extraction]` }],
      };
    case "resume": {
      const decided = Object.keys(s.answers).length + Object.values(s.proposals).filter((p) => p.decision).length;
      return {
        ...s,
        sessionDead: false,
        session: s.session + 1,
        resumedNote: `Session ${s.session + 1} rebuilt from the board: ${decided} decisions, the Epic spec, and every open Proposal. Nothing was lost.`,
        log: [...s.log, { at: now(), text: `Shaping session ${s.session + 1} started, rebuilt from the board` }],
      };
    }
  }
}

export function kindWord(p: Proposal) {
  return { spec: "Spec section", story: "Story", criterion: "Criterion", adr: "ADR", glossary: "Glossary term" }[p.kind];
}

function useDerived(s: State) {
  return useMemo(() => {
    const visibleQuestions = QUESTIONS.filter((q) => s.posted.includes(q.round));
    const openQuestions = visibleQuestions.filter((q) => !s.answers[q.id]);
    // A proposal shows once every question feeding it is answered and its stage has opened.
    const stageOpen = (st: Stage) => ["spec", "slice", "criteria", "done"].indexOf(s.stage) >= ["spec", "slice", "criteria", "done"].indexOf(st);
    const feeders = (p: Proposal) => QUESTIONS.filter((q) => q.feeds?.includes(p.id));
    const acceptedStories = new Set(
      PROPOSALS.filter((p) => p.kind === "story" && isYes(s.proposals[p.id].decision)).map((p) => p.id),
    );
    const visibleProposals = PROPOSALS.filter((p) => {
      if (!stageOpen(p.stage)) return false;
      if (p.kind === "criterion" && !acceptedStories.has(p.target)) return false;
      const f = feeders(p);
      if (p.stage === "criteria" || p.stage === "slice") return true;
      return f.length > 0 && f.every((q) => s.answers[q.id]);
    });
    const pendingProposals = visibleProposals.filter((p) => !s.proposals[p.id].decision);
    const current = s.stage === "done" ? undefined : s.stage;
    const stageQuestions = current ? QUESTIONS.filter((q) => q.stage === current) : [];
    const stageRoundsPosted = current ? ROUNDS.filter((r) => r.stage === current).every((r) => s.posted.includes(r.n)) : true;
    const blockers: string[] = [];
    if (current) {
      const oq = stageQuestions.filter((q) => !s.answers[q.id]).length;
      if (!stageRoundsPosted || oq) blockers.push(`${oq || "more"} open question${oq === 1 ? "" : "s"}`);
      const pp = pendingProposals.filter((p) => p.stage === current).length;
      if (pp) blockers.push(`${pp} Proposal${pp === 1 ? "" : "s"} to decide`);
      if (current === "criteria") {
        const bare = [...acceptedStories].filter(
          (sid) => !PROPOSALS.some((p) => p.kind === "criterion" && p.target === sid && isYes(s.proposals[p.id].decision)),
        );
        if (bare.length) blockers.push(`${bare.length} Stor${bare.length === 1 ? "y" : "ies"} without a criterion`);
      }
    }
    return {
      visibleQuestions,
      openQuestions,
      visibleProposals,
      pendingProposals,
      acceptedStories,
      canCloseStage: !!current && blockers.length === 0 && !s.agentBusy,
      blockers,
      waitingOnYou: !s.agentBusy && !s.sessionDead && (openQuestions.length > 0 || pendingProposals.length > 0 || blockers.length === 0),
    };
  }, [s]);
}

export const isYes = (d?: Decision) => d === "accepted" || d === "amended";

type Ctx = State &
  ReturnType<typeof useDerived> & {
    answer: (q: Question, a: Answer) => void;
    decide: (id: string, decision: Decision, edit?: { body?: string; title?: string }) => void;
    closeStage: () => void;
    kill: () => void;
    resume: () => void;
  };

const ShapingContext = createContext<Ctx | null>(null);

export function ShapingProvider({ children }: { children: React.ReactNode }) {
  const [s, dispatch] = useReducer(reducer, undefined, initial);
  const derived = useDerived(s);
  const ref = useRef(s);
  ref.current = s;

  // The scripted agent: when the last question of a posted round is answered, it "thinks", then
  // posts the next round of the same stage. A new stage's first round posts on stage close.
  const agentTurn = useCallback((round: number) => {
    dispatch({ t: "busy", v: true });
    setTimeout(() => {
      if (ref.current.sessionDead) return;
      dispatch({ t: "post", round });
    }, 1200);
  }, []);

  const answer = useCallback(
    (q: Question, a: Answer) => {
      dispatch({ t: "answer", id: q.id, answer: a });
      const answered = { ...ref.current.answers, [q.id]: a };
      const roundDone = QUESTIONS.filter((x) => x.round === q.round).every((x) => answered[x.id]);
      const next = ROUNDS.find((r) => r.n === q.round + 1);
      if (roundDone && next && next.stage === q.stage) agentTurn(next.n);
    },
    [agentTurn],
  );

  const closeStage = useCallback(() => {
    const st = ref.current.stage;
    dispatch({ t: "close-stage" });
    const firstOfNext = ROUNDS.find((r) => STAGES.findIndex((x) => x.id === r.stage) === STAGES.findIndex((x) => x.id === st) + 1);
    if (firstOfNext) agentTurn(firstOfNext.n);
  }, [agentTurn]);

  const value: Ctx = {
    ...s,
    ...derived,
    answer,
    decide: (id, decision, edit) => dispatch({ t: "decide", id, decision, ...edit }),
    closeStage,
    kill: () => dispatch({ t: "kill" }),
    resume: () => {
      dispatch({ t: "resume" });
      // A turn the dead session never posted is posted by the new one, rebuilt from the board.
      const cur = ref.current;
      const due = ROUNDS.find(
        (r) =>
          r.stage === cur.stage &&
          !cur.posted.includes(r.n) &&
          QUESTIONS.filter((q) => q.round === r.n - 1 && q.stage === r.stage).every((q) => cur.answers[q.id]),
      );
      if (due) agentTurn(due.n);
    },
  };
  return <ShapingContext.Provider value={value}>{children}</ShapingContext.Provider>;
}

export function useShaping() {
  const c = useContext(ShapingContext);
  if (!c) throw new Error("useShaping outside ShapingProvider");
  return c;
}
