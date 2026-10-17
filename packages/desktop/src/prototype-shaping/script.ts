/**
 * PROTOTYPE — throwaway. Answers the wayfinder ticket "What does shaping an Epic into Stories with
 * an agent look and feel like?" (HighKnow-ai/flywheel#11). Never imported by the real app.
 *
 * The scripted agent for one shaping session. Content is the real Epic from the 2026-10-16
 * walkthrough (#7), so the density and jargon load are honest. Every variant renders THIS script;
 * only the screen differs.
 */

export type Stage = "spec" | "slice" | "criteria" | "done";

export const STAGES: { id: Exclude<Stage, "done">; label: string; doneWhen: string }[] = [
  { id: "spec", label: "Challenge the spec", doneWhen: "No open questions, and Problem / Scope / Out of scope are all accepted" },
  { id: "slice", label: "Slice into Stories", doneWhen: "Every Story is accepted or rejected, and the order is settled" },
  { id: "criteria", label: "Acceptance criteria", doneWhen: "Every accepted Story has at least one accepted criterion" },
];

/** A decision the agent asks of the developer. Facts are the agent's job; this is the developer's. */
export type Question = {
  id: string;
  stage: Exclude<Stage, "done">;
  round: number;
  prompt: string;
  /** What the agent read to ask it: keeps the challenge grounded, shown small. */
  grounding?: string;
  recommended: string;
  /** One-line reason for the recommendation. */
  because: string;
  /** Proposal ids this question's answer creates or changes. */
  feeds?: string[];
};

export type ProposalKind = "spec" | "story" | "criterion" | "adr" | "glossary";

/** A change the agent suggests to a board record, ADR or glossary term. No effect until accepted. */
export type Proposal = {
  id: string;
  stage: Exclude<Stage, "done">;
  kind: ProposalKind;
  /** spec: field name. story: story id. criterion: parent story id. */
  target: string;
  title: string;
  body: string;
  /** criterion only: optional executable Check. */
  check?: string;
  /** adr only: the three bar lines (ADR 0002 / #16). */
  bar?: { hardToReverse: string; surprising: string; alternativeThatLost: string };
};

export type Round = { stage: Exclude<Stage, "done">; n: number; agentSays: string };

export const EPIC = {
  key: "FLY-41",
  title: "The session feed shows everything the agent says and asks",
  milestone: "M1 · Cyril works a week in Flywheel without the terminal",
  seed: "The feed is unreadable: hook noise, raw JSON, the agent's turns collapsed to one line of unrendered markdown. Its questions don't mark the run as waiting.",
};

export const ROUNDS: Round[] = [
  {
    stage: "spec",
    n: 1,
    agentSays:
      "I read FeedRow.tsx, SessionSurface.tsx and the Claude Code adapter. The gaps fall in three groups: lost upstream, received but hidden, and shown but truncated. One of them is already fixed. Four decisions before I can write the spec.",
  },
  {
    stage: "spec",
    n: 2,
    agentSays:
      "Spec drafted from your answers (see the Epic). Three things still open: one is a dependency choice that I think deserves an ADR, and one is a word we keep using without defining it.",
  },
  {
    stage: "slice",
    n: 3,
    agentSays:
      "Four Stories, each a vertical slice you could merge alone. Two of them touch FeedRow.tsx, so they can't run in parallel. Two decisions about order and size.",
  },
  {
    stage: "criteria",
    n: 4,
    agentSays:
      "Criteria for each accepted Story. Where a criterion can be checked by a command I attached a Check; the rest are judged against the diff at review. Two decisions about where a Check is worth writing.",
  },
];

export const QUESTIONS: Question[] = [
  // ---- spec, round 1
  {
    id: "q1",
    stage: "spec",
    round: 1,
    prompt: "Is “narration dropped upstream” still part of this Epic?",
    grounding: "adapter.ts:1104 normaliseStreamEvents already emits every text block",
    recommended: "No. It's already fixed. Move it to Out of scope with a pointer to the fix.",
    because: "Shipping a Story for fixed code wastes a worktree and misleads review.",
    feeds: ["p-out"],
  },
  {
    id: "q2",
    stage: "spec",
    round: 1,
    prompt: "Should the model's thinking blocks appear in the feed?",
    grounding: "FeedRow.tsx has no row type for `thinking`",
    recommended: "No. Show a one-line “thinking…” marker while it runs, and nothing after.",
    because: "It's noise for a supervisor, and surfacing reasoning risks refusals (walkthrough entry 14).",
    feeds: ["p-scope", "p-out"],
  },
  {
    id: "q3",
    stage: "spec",
    round: 1,
    prompt: "What counts as noise, and where does it go?",
    grounding: "hook_started ×6, rate_limit_event and thinking_tokens render as raw JSON today",
    recommended: "Hook, rate-limit and token-count events go to the raw log only, never the feed.",
    because: "The raw log already exists; the feed's job is the agent's words and actions.",
    feeds: ["p-scope"],
  },
  {
    id: "q4",
    stage: "spec",
    round: 1,
    prompt: "Who reads the feed, and what are they deciding?",
    recommended: "You, watching a live run and deciding whether to step in. Optimise for scanning, not auditing.",
    because: "It fixes the density: one line per action, prose in full.",
    feeds: ["p-problem"],
  },
  // ---- spec, round 2
  {
    id: "q5",
    stage: "spec",
    round: 2,
    prompt: "Should you be able to answer the agent's questions from the feed?",
    grounding: "SessionSurface.tsx:1237: no reply box in task runs",
    recommended: "Yes. A question renders as a card with its options, and the run shows “waiting on you” until you answer.",
    because: "This is blocker 2 from the walkthrough: agents wait silently.",
    feeds: ["p-scope"],
  },
  {
    id: "q6",
    stage: "spec",
    round: 2,
    prompt: "Render the agent's markdown with a dependency, or by hand?",
    recommended: "Add react-markdown, with raw HTML disabled.",
    because: "Hand-rolled markdown is a long tail of bugs. This is hard to reverse once rows depend on it, so it's worth an ADR.",
    feeds: ["p-adr"],
  },
  {
    id: "q7",
    stage: "spec",
    round: 2,
    prompt: "“Feed” and “raw log” are used loosely. Define them?",
    recommended: "Yes. Add “Session feed” to the glossary; “raw log” stays an implementation word.",
    because: "Stories and criteria will use the word, so it needs one meaning.",
    feeds: ["p-gloss"],
  },
  // ---- slice, round 3
  {
    id: "q8",
    stage: "slice",
    round: 3,
    prompt: "“Noise leaves the feed” and “Tool calls are one readable line” both rewrite FeedRow.tsx. Run them in sequence or merge them?",
    grounding: "Both touch FeedRow.tsx:380–560",
    recommended: "Sequence them, noise first. It's small and makes the second diff readable.",
    because: "Merged, it's one Story too big for one fresh context.",
  },
  {
    id: "q9",
    stage: "slice",
    round: 3,
    prompt: "“Questions are answerable cards” is the biggest. Split render from answer?",
    recommended: "Keep it whole. A card you can't answer isn't user-visible value.",
    because: "A vertical slice must be useful on its own.",
  },
  // ---- criteria, round 4
  {
    id: "q10",
    stage: "criteria",
    round: 4,
    prompt: "“Answering resumes the run” has no Check. Write an end-to-end Check against the stub agent?",
    recommended: "Yes, against the stub adapter, with no live model in CI.",
    because: "This is the criterion most likely to regress silently.",
    feeds: ["c4b"],
  },
  {
    id: "q11",
    stage: "criteria",
    round: 4,
    prompt: "“No agent turn is collapsed” is visual. A Check, or judge it at review?",
    recommended: "Judge it at review. A DOM assertion here would test the implementation, not the behaviour.",
    because: "Not every criterion needs a Check; a bad Check is worse than none.",
    feeds: ["c3b"],
  },
];

export const PROPOSALS: Proposal[] = [
  // ---- spec
  {
    id: "p-problem",
    stage: "spec",
    kind: "spec",
    target: "Problem",
    title: "Problem",
    body: "While a run is live, Cyril can't tell what the agent is doing or whether it is waiting on him. The feed shows event noise and raw JSON, and collapses the agent's own words to one unrendered line, so supervising from Flywheel is worse than a terminal.",
  },
  {
    id: "p-scope",
    stage: "spec",
    kind: "spec",
    target: "Scope",
    title: "Scope",
    body: "The feed shows the agent's prose in full, rendered; each tool call as one line paired with its result; a “thinking…” marker; and the agent's questions as answerable cards that mark the run as waiting. Hook, rate-limit and token events go to the raw log only.",
  },
  {
    id: "p-out",
    stage: "spec",
    kind: "spec",
    target: "Out of scope",
    title: "Out of scope",
    body: "Thinking-block content. Narration dropped upstream (already fixed in adapter.ts:1104). Searching or filtering the feed.",
  },
  {
    id: "p-adr",
    stage: "spec",
    kind: "adr",
    target: "docs/adr/0004",
    title: "ADR: render agent markdown with react-markdown",
    body: "The feed renders agent prose with react-markdown, raw HTML disabled, instead of a hand-written renderer.",
    bar: {
      hardToReverse: "Every feed row type will depend on its AST and plugins.",
      surprising: "The UI has avoided rendering dependencies so far.",
      alternativeThatLost: "A minimal hand-written renderer covering headings, lists and code.",
    },
  },
  {
    id: "p-gloss",
    stage: "spec",
    kind: "glossary",
    target: "GLOSSARY.md",
    title: "Glossary: Session feed",
    body: "**Session feed**: the readable view of what an agent said, did and asked during a session. _Avoid_: log, transcript.",
  },
  // ---- slice
  { id: "s1", stage: "slice", kind: "story", target: "s1", title: "Noise leaves the feed", body: "Hook, rate-limit and token events no longer appear in the feed; they stay in the raw log." },
  { id: "s2", stage: "slice", kind: "story", target: "s2", title: "Tool calls are one readable line", body: "Each tool call shows as one line (tool and target), paired with its result, and expands on click." },
  { id: "s3", stage: "slice", kind: "story", target: "s3", title: "Agent prose renders in full", body: "The agent's turns render as formatted markdown and are never collapsed by default." },
  { id: "s4", stage: "slice", kind: "story", target: "s4", title: "Questions are answerable cards", body: "An AskUserQuestion turn renders its options as buttons, marks the run “waiting on you”, and answering resumes the run." },
  // ---- criteria
  { id: "c1a", stage: "criteria", kind: "criterion", target: "s1", title: "Replaying the walkthrough fixture renders zero hook, rate-limit or token rows", body: "", check: "npm test -- feed-noise.fixture" },
  { id: "c1b", stage: "criteria", kind: "criterion", target: "s1", title: "The raw log still shows every event the feed drops", body: "", check: "npm test -- raw-log.fixture" },
  { id: "c2a", stage: "criteria", kind: "criterion", target: "s2", title: "All 11 tool results in the fixture are paired with their call", body: "", check: "npm test -- feed-pairing" },
  { id: "c2b", stage: "criteria", kind: "criterion", target: "s2", title: "A collapsed tool call is a single line naming the tool and its target", body: "" },
  { id: "c3a", stage: "criteria", kind: "criterion", target: "s3", title: "Headings, lists and code blocks in agent text render formatted", body: "", check: "npm test -- feed-markdown" },
  { id: "c3b", stage: "criteria", kind: "criterion", target: "s3", title: "No agent turn is collapsed by default", body: "" },
  { id: "c4a", stage: "criteria", kind: "criterion", target: "s4", title: "An open question shows the run as “waiting on you” in the sidebar", body: "", check: "npm run test:browser -- waiting-on-you" },
  { id: "c4b", stage: "criteria", kind: "criterion", target: "s4", title: "Answering from the card resumes the run with that answer", body: "" },
];
