---
created: 2026-09-30T00:12:10.327Z
title: Handoff sheet drops questions the agent asked
area: tooling
severity: major
files:
  - scripts/uat/uat-08-socratic-authoring.mjs (extractOpenQuestions, renderHandoffQuestionsSheet)
  - .planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md:turns 2, 4, 10
  - .planning/phases/05-socratic-epic-authoring/challenge-turn-1-questions.md
  - .planning/phases/05-socratic-epic-authoring/challenge-turn-2-questions.md
---

## Problem

The live UAT harness's developer-answer handoff (installed by quick task `260929-p61`) writes the
agent's questions to `challenge-turn-N-questions.md`, renumbered `1..n` by `extractOpenQuestions`.
The renumbering is not traceable to the agent's own numbering, and a question the agent asked can go
missing from the sheet without anything failing.

Observed in live run `01M3QQQM4GAYB2Y9RQMJDRWAX0` (2026-09-30, the run that produced phase 05's first
clean live pass). The agent's turn-2 prose numbered **six** questions; the extractor pulled **five**.
The developer's answers mapped semantically but not positionally, and the agent's own #5
(self-generated events — "you never get notified about your own actions") and #6 ("what's the existing
stack?") were never answered at all.

The agent noticed, twice, unprompted:

- Turn 4: "**Self-actions** (you left this open)"
- Turn 10: "Self-actions notify nobody. **I raised this twice and it didn't get answered.** It's the
  one that produces most-obviously-broken behaviour if guessed wrong."

It carried both as assumption rows labelled `NOT YET CONFIRMED BY DEVELOPER`, which is the correct
fallback — so the defect degrades gracefully rather than corrupting the run, and the run passed. That
mitigation is why this is `major` rather than `blocker`. But the gate exists precisely to collect the
developer's judgement, and this silently loses some of it.

**Same family, cosmetic:** `challenge-turn-2-questions.md` rendered question 3 as
`**what am I attaching this to?` — a stray leading `**` from a mid-bold fragment, showing the
extractor splitting inside emphasis rather than around it. Legible, so not worth its own todo.

**Why this is worth a general fix rather than a fourth patch.** This is the fourth instance of the
`extractOpenQuestions` family. Quick task `260929-nxq` already fixed it once: it split on
`/(?<=[?.!])\s+/`, so a `**bolded question?**` never split, and it saw 1 of 5. That round fixed the
splitting and left the *numbering and completeness* property unstated — which is why the next instance
arrived one run later. Phase 05's own twelve-round history is the same shape: instance fixed, property
unstated, instance returns.

## Solution

State and enforce the property, not the instance:

- The sheet's numbering must be **traceable to the agent's own numbering** wherever the turn states
  one — carry the agent's ordinal rather than re-indexing from 1.
- A question the agent asked must **never be silently absent** from the sheet. Make the sheet assert
  that the count it extracted matches the count the turn appears to ask, and **fail loudly** rather
  than quietly renumbering a short list.
- Strip surrounding emphasis from an extracted fragment so a question never carries a stray `**`.

Pin it with an offline fixture built from this run's actual turn-2 text (six questions, four bolded),
so the regression cannot return at the next call site.

**Scope note:** this is a follow-up defect in the instrument. It is deliberately NOT a phase-05 gap —
phase 05's live gate passes and both human verdict lines are signed off. Do not fold it into phase-05
verification.
