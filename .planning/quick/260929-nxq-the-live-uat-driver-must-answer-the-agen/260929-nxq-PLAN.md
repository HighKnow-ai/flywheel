---
quick_id: 260929-nxq
description: "the live UAT driver must answer the agent and never advance over a withheld consent; SHAPE-02 asserts a materialised board row"
date: 2026-09-29
mode: quick
requirements: [SHAPE-01, SHAPE-02, SHAPE-05]
files_modified:
  - scripts/uat/uat-08-socratic-authoring.mjs
  - scripts/uat/README.md
---

# Quick Task 260929-nxq — The driver answers, and never advances over a withheld consent

## Why

Quick task 260929-lq1 fixed the harness's stale-snapshot decision targets and the live gate reached
its own pass/fail table for the first time in twelve rounds. Run `01M3P4VZCA1M0C37C8V7ZE72WG`
scored SHAPE-01 PASS, SHAPE-03/04 PASS, SHAPE-05 informational — and SHAPE-02 **FAIL**, reported as
`no subtree was accepted`.

**SHAPE-02's failure is an instrument defect, not a product one, and not a regression from
260929-lq1.** Its own database (`authoring_proposals`) held 8 pending assumptions, 10 pending
criteria, 1 rejected criterion and **1 pending epic** — and **zero task proposals**.
`criterion2Landed` is only ever assigned inside `if (taskTarget.proposal)`, so with no task
proposal SHAPE-02 could not pass, even though accepting that pending epic would have materialised a
genuine board row. The pre-lq1 code (`pending.proposals.find(p => p.targetType === "task")`) would
have skipped identically.

But the interesting defect is upstream of SHAPE-02, and it is the driver's.

### Mechanism, re-derived by reading the source and measuring against the transcript

Every line number below was re-derived at planning time against the post-lq1 file (8021 lines).

`extractOpenQuestions` (line 4693) is the only thing that decides whether the agent has asked
anything. It splits the turn on `/(?<=[?.!])\s+/` (line 4702) and keeps the fragments that
`endsWith("?")` (line 4706). `driveChallengeConversation` (line 4798) then treats
`questions.length === 0` as **settled** (line 4850) and returns; the live body advances the stage at
line 7633 and again at line 7741.

Measured against the actual turns in `05-LIVE-CHALLENGE-TRANSCRIPT.md`, that heuristic produced two
independent failures in one run:

| agent turn | what the agent asked | what `extractOpenQuestions` saw |
|---|---|---|
| turn 1 | five numbered questions, four of them wrapped in `**bold**` (`**2. Which channels?**`) | **1 question** — `**` sits between the `?` and the whitespace, so the split never fires and the fragment ends in `.`, not `?`. The one survivor matched no `ANSWER_BANK` pattern, so the entire developer reply was a single `ANSWER_BANK_FALLBACK` line |
| turn 2 | *"Tell me: attention router or activity log — and if it's the router, whether a filtered board view would do the job."* preceded by *"**I don't think this is settled enough to advance.**"* | **0 questions** — the turn contains no `?` character at all. `settled = true`, driver returns, live body advances twice |

So the harness reported *"the conversation settled after 2 agent turn(s), 1 question(s) answered"*
and opened D-90's gate, while the agent had said in plain words that it was not settled. The agent
then did exactly what it had been told — *"use your own judgement, state the assumption, keep
going"* — and staged an epic plus eight assumption rows covering the question nobody answered,
rather than tasks it had no basis to write. **The agent behaved well. The driver drove badly.**

This is the same family as G-05-2 ("the live arm stopped starving and started lying") and G-05-7
("the live arm no longer kills a healthy turn"): the scripted driver mis-driving the conversation.
As with 260929-lq1, the deliverable is the general property, not the instance.

### The two fixes are measured, not assumed

Planning ran both candidate heuristics against the real transcript text offline:

- **Splitting on `/(?<=[?.!])[*_`"'’”)\]]*\s+/`** (allowing closing emphasis between the terminator
  and the whitespace) takes turn 1 from **1 extracted question to 6** — every one of the agent's
  five numbered questions becomes visible, capped at `MAX_EXTRACTED_QUESTIONS` (5).
- **Treating an explicit request-for-input opener as a question** (`Tell me…`, `Let me know…`,
  `Say which…`, `Pick one…`) takes turn 2 from **0 to 1** — and that one is exactly the substantive
  question the driver never answered.
- The withheld-consent classifier below was measured across **all eight transcript blocks** plus
  seven hand-built negatives and five hand-built positives: **1 true positive** (the verbatim
  sentence from run `01M3P4VZCA1M0C37C8V7ZE72WG`), **0 false positives**. Two earlier, looser
  pattern sets were discarded during planning because they tripped on *"I can't stage anything yet,
  and only you can advance it"* (the agent describing the stage machine, not withholding) and on the
  core's own criteria instruction *"Before we move on: call `propose_assumption`…"*. Requiring a
  **first-person statement of the agent's own readiness** is what separates the two.

## The rule this task installs

> The driver must answer the substantive question the agent actually asked rather than deflecting it
> back, and must never advance a stage while the agent has explicitly withheld its consent to
> advance. An agent that says "this is not settled" and is advanced over anyway has not produced a
> clean instrument run, however green the table reads.

Two boundaries, both load-bearing, both stated so the next author does not re-derive them:

1. **Only the agent can clear a withheld consent — never the driver's own reply.** If the exit
   condition were "the driver sent something", `ANSWER_BANK_FALLBACK` would satisfy it, which is the
   exact deflection that caused this run. The flag is computed from the agent's own turn text and is
   cleared only by a *later agent turn* that no longer withholds. A canned deflection that merely
   looks like an answer cannot satisfy it, by construction.
2. **Withholding is a first-person statement about the agent's own readiness**, not any sentence
   mentioning advancement. *"Only you can advance it"* and *"the stage has advanced on your side"*
   are descriptions of D-90's gate and must read clear — both are verbatim from this transcript.

## Decision — extend within the existing bound, then refuse the gate

Asked to judge between answering, extending, and failing. The answer is **all three, in that order,
with the bound unchanged**:

1. **Answering alone is insufficient and unverifiable.** The driver's answers come from a fixed
   bank; it cannot know whether its answer satisfied the question. Only the agent can say so.
2. **So the exit is conversational: keep going.** A withholding turn is never `settled`, so the
   loop continues and the agent gets another turn to stop withholding. `MAX_AGENT_TURNS` stays **4**
   — no bound is raised, no extra live tokens are budgeted beyond what the existing cap already
   allows. In the observed run the cap was never even reached: the driver quit at turn 2 of 4.
3. **`CLOSING_TURN` remains the legitimate escape.** D-90 says the developer holds the gate; a
   developer ending the conversation at the cap is not a defect.
4. **Refusal lands at the gate, not in the driver.** If the *last* agent turn — including the reply
   to `CLOSING_TURN` — still withholds, that is a genuine standoff: the developer has closed the
   conversation and the agent has said it is not ready. The **live body** refuses to advance and
   fails the run with a named reason, after writing the evidence sheet, exactly as the
   non-conversation branch above it already does. Throwing inside the driver instead would conflate
   this with `ConversationAbortedError` and lose the distinction.

**Rejected:** raising `MAX_AGENT_TURNS`. It spends more of a credential per run to paper over a
heuristic that was not reading the turn at all — and leaves the property unstated for the next
author.

**Rejected:** letting the run advance and merely recording the withholding in the evidence sheet.
The binding constraint is that such a run must never again be reported as a clean instrument run,
and a note in a sheet nobody gates on is exactly how the last twelve rounds shipped instances.

## Decision — SHAPE-02 reads the board, not the branch

SHAPE-02's own sentence is *"the outcome lands directly on the board."* It will be asserted by
reading the board:

- `board-counts` (the verb at `packages/core/tests/bin/uat_authoring_ops.rs:394`, counting `epics`,
  `tasks` and project-scoped `acceptance_criteria`) is read **before** and **after** the accept
  chain, and `criterion2Landed` becomes a measured **delta**, not a branch artefact.
- The accept target is chosen by an ordered preference, each branch carrying its own correct verb.
  This is forced by the core, not a style choice: `accept_subtree`
  (`authoring_proposal.rs:984-988`) hard-requires a **task** root, so an epic or criterion can only
  be accepted with `accept-proposal`. Because the two verbs return different shapes
  (`{acceptedCount}` vs `{materialisedId}`), a board-counts delta is the *only* uniform measurement
  across all three paths — which is the second, independent reason to read the board rather than the
  return value.
- **It gets harder to satisfy, never easier.** `acceptedCount > 0` counts decided proposals; a
  board-counts delta counts rows that actually exist on the board. A pass now requires a row that
  was not there before.

## Audit — every canned developer turn the driver can send

Enumerated so the audit is reviewable, including the turns judged fine. This is the complete set,
established by measurement rather than assertion: the live body reaches the backend at exactly four
places — the run-start prompt (line 7440), the driver's own `sendTurn` (line 7521), and the two
`op: "authoring_turn"` sends carrying the stage instructions (lines 7638 and 7751). Everything below
is reachable through one of those four and nothing else is.

| # | canned turn | line | verdict |
|---|---|---|---|
| 1 | `OPENING_PROMPT` | 4569 | **fine** — an ordinary feature request, deliberately not meta. It is a seed, not a reply, so it cannot deflect. Already pinned by the checks at 1462/1467 |
| 2 | `REPLY_PREAMBLE` — "Here's what I can tell you:" | 4602 | **fine** — a preamble, never itself an answer; the self-test strips it |
| 3 | `ANSWER_BANK[0]` dismiss / clear | 4623 | **fine** — a concrete product decision |
| 4 | `ANSWER_BANK[1]` restart / persist | 4629 | **fine** |
| 5 | `ANSWER_BANK[2]` unattended / trigger | 4635 | **fine** |
| 6 | `ANSWER_BANK[3]` audience | 4641 | **fine** |
| 7 | `ANSWER_BANK[4]` `/surface\|appear\|show up\|display\|where/` | 4647 | **DEFECT — it mis-answers.** Measured at planning time against turn 1's real text: the bare `where` alternative claims *"Where does the board app actually live?"* and answers it with *"It appears in an in-app notification tray only."* A wrong answer is worse than a fallback, because it reads as an answer. Tighten in Task 1 |
| 8 | `ANSWER_BANK[5]` batch / group | 4651 | **fine** |
| 9 | `ANSWER_BANK[6]` out-of-scope / v1 | 4655 | **fine** |
| 10 | `ANSWER_BANK_FALLBACK` | 4606 | **the deflection, conditionally.** As one line among answered questions it is a legitimate delegation, and the model handled it correctly — it stated its assumption explicitly. As the *entire* reply, which is what this run sent, it is a deflection. Keep the constant; narrow its reach with new entries; make a wholly-fallback reply say so in the scrollback |
| 11 | `CLOSING_TURN` | 4666 | **fine, but newly bounded.** It IS the developer closing his own gate (D-90), not a deflection. What was missing is that a reply to it that still withholds consent must not be advanced over |
| 12 | `OPTION_SELECTION_PREFIX` + a label the agent itself offered | 4675 | **fine** — choosing an option the agent put on the table is the entire semantics of answering it |
| 13 | `SECOND_TURN` — "Just in-app for now… Let's move on when you're ready." | 4573 | **out of the live driver's set, and flagged.** Only `--replay-check` sends it (line 6138); the live arm never does. "Let's move on when you're ready" is precisely the shape this rule names. Recorded so a future author does not promote it into the live arm |
| 14 | `advanced.instructionText` / `criteriaAdvanced.instructionText` | 7633 / 7741 | **not harness-canned** — D-89's distillation instruction and plan 05-45's `CRITERIA_INSTRUCTION_TEXT`, both from `packages/core`. Out of scope under this task's no-product-code constraint; named so the audit is complete rather than silently partial |

## Tasks

### Task 1 — The driver hears the question, answers it, and never advances over a withheld consent

**files:** `scripts/uat/uat-08-socratic-authoring.mjs`

**action:**

**(a) Widen the fragment split so markdown cannot hide a question.** At line 4702, replace the
split separator with one that also consumes closing emphasis, quotes and brackets sitting between
the sentence terminator and the whitespace. Declare it as a named module-level constant beside
`MAX_EXTRACTED_QUESTIONS` (line 4598) rather than inline, so the consent classifier in (c) can reuse
the identical sentence-splitting rule instead of inventing a second one. Keep `[?.!]` as the
terminator set exactly as today — numbered-list markers must keep being split off by the `.`
terminator, which is what makes the existing check at line 2194 assert `questions[0]` starts at
`"Who can dismiss"`. Belt-and-braces the `endsWith("?")` test at line 4706 by stripping the same
trailing character class before the comparison, so a fragment that ends the turn (with nothing after
it to split on) is read the same way as one mid-turn. Its doc comment records the measurement: turn 1
of run `01M3P4VZCA1M0C37C8V7ZE72WG` asked five numbered questions and this heuristic saw one, because
`**` sat between the `?` and the space.

**(b) Recognise a question asked in the imperative.** Add a named `REQUEST_FOR_INPUT_PATTERN`
constant — an anchored opener set (`tell me`, `let me know`, `say which`, `say so`,
`which (one )?(do|would|should)`, `pick one`, `decide`, `choose`, `confirm whether`), applied after
stripping leading markdown/ordinal noise from the fragment. `extractOpenQuestions` returns these
after the prose `?` questions and before the cap, **de-duplicated** against fragments already
returned (a fragment can be both). Its doc comment states the property: an imperative request for a
decision is a question, and the turn that broke this instrument contained no `?` character at all.

**(c) Classify a withheld consent, from the agent's own text only.** Add
`WITHHELD_CONSENT_PATTERNS` and `classifyWithheldConsent(text)` beside the answer bank, returning
`{ sentence, patternSource }` for the first matching fragment or `null`. Every pattern requires a
**first-person statement about the agent's own readiness** — `I don't think this is settled…`,
`I'm not ready to advance…`, `I'd rather not move on…`, `not settled enough to advance`,
`this/that/it is not settled` — never a bare mention of advancing. The doc comment names both
boundaries and the exact negatives that forced them, verbatim from this transcript: *"I can't stage
anything yet, and only you can advance it"* and *"the stage has advanced on your side"* must read
clear. Add `readAdvanceConsent(turnText)`, a three-valued reading — `"withheld"`, `"clear"`,
`"unreadable"` (a missing or empty turn text, e.g. a timed-out capture) — because an absence of
evidence is not consent, and this register's eighth rule exists precisely because a zero that cannot
distinguish "would not" from "could not" gets read as "would not" every time.

**(d) A withholding turn is never settled.** In `extractOpenQuestions`, a turn whose text trips
`classifyWithheldConsent` contributes at minimum one open question whose `text` is the matched
withholding sentence — so `questions.length` is never 0 for such a turn, and
`driveChallengeConversation`'s `settled` branch at line 4850 needs no special case. The question text
feeds the answer bank's patterns; it is never echoed, so the ordinal-only rule the reply composer
already obeys is untouched.

**(e) The driver reports what it saw.** `driveChallengeConversation` gains two returned fields,
documented in its return-shape doc comment alongside `nonConversation`:
- `consentReading` — `readAdvanceConsent` applied to the **last** captured agent turn, including the
  reply to `CLOSING_TURN`. Last, not any: an agent that withheld at turn 2 and stopped withholding at
  turn 4 got what it needed, and that run is clean.
- `fallbackAnswerCount` — how many composed answer lines across the whole conversation were exactly
  `ANSWER_BANK_FALLBACK`, counted from the composed reply string (so `composeDeveloperReply` keeps
  its signature and all of its existing callers byte-identical).

Also carry `consentWithheldSentence` (the matched sentence, or `null`) so the gate's own error names
what the agent actually said rather than asserting a category.

**(f) Both gates refuse.** In the live body:
- Immediately after the evidence-sheet write at lines 7623-7627 and before the advancing step at
  7629: narrate `conversation.consentReading`; when it is `"withheld"`, write the evidence sheet and
  throw an error quoting `consentWithheldSentence`, naming that the conversation reached its bound
  (`closingTurnSent`) with the agent still withholding, and pointing at `evidencePath`. Add nothing
  that looks like an `advance-stage` argv — the structural check at line 2418 asserts exactly two
  such call sites and both must stay.
- Immediately before the second advancing step at line 7738: take
  `readAdvanceConsent(instructionReply?.text)`, narrate the three-valued result, and refuse on
  `"withheld"` with the same shape. Installing the rule on one of the two gates and not the other is
  exactly the fix-the-instance failure this ledger exists to name. `"unreadable"` (the timeout path,
  which line 7683 deliberately treats as non-fatal) narrates its own abstention and proceeds — it
  must not silently read as consent.

**(g) Narrow the fallback's reach, and make it say its own name.** Tighten `ANSWER_BANK[4]`'s
`where` alternative so it can only claim a question about where a *notification* surfaces, never one
about where code lives. Add answer-bank entries — each a concrete product decision in the existing
voice, each a fixed string — covering the question shapes the widened extractor now surfaces and the
fork this agent actually raised: repository location / greenfield; which channels; what fires a
notification; real-time versus polling; how much user control; and activity-log versus
attention-router (answer it as the activity log, and say a filtered board view is not a substitute).
Then, in the live body after the driver returns, `step()` the ratio — how many questions were
answered and how many of those answers were the fallback — so a wholly-deflecting reply is a fact in
the scrollback rather than a silence.

Three constraints on these entries, all checked by assertions that already exist and must keep
passing unedited:
- No entry may contain `challenge`, `push back`, `clarify`, `clarifying` or `socratic` (line 2182).
- No entry may match the fallback-probe string `"This one matches nothing in the bank at all, so
  what happens?"`, or the reachability assertion at line 2278 breaks.
- Every answer stays a fixed string; the only thing derived from the agent's text remains the
  ordinal (lines 2256-2280, 6462-6475).

**(h) Self-test checks**, in `selfTest()`'s existing `check(...)` voice, added beside the
extraction/driver checks at 2194-2400:
- `extractOpenQuestions` finds all five of a bolded, numbered turn's questions — the fixture is the
  real shape from the transcript (`**1. Where does the board app actually live?** This repo is
  empty.`), which today yields one.
- `extractOpenQuestions` finds the imperative ask in a turn containing **no `?` at all** — the
  fixture is the verbatim *"Tell me: attention router or activity log…"* sentence.
- `classifyWithheldConsent` matches the verbatim withholding sentence from run
  `01M3P4VZCA1M0C37C8V7ZE72WG` and returns `null` for each of the transcript's own near-miss
  negatives, named individually so a future loosening of the patterns fails here rather than in a
  live run.
- `readAdvanceConsent` returns `"unreadable"` for `undefined`, `null` and `""`, and never `"clear"`.
- **The deflection-proof check, the one the rule turns on:** driven through the REAL
  `driveChallengeConversation` against the scripted stub the checks at 2310-2392 already establish,
  with every scripted turn withholding consent — assert the driver never reports `settled`, sends a
  developer turn every round rather than quitting, reaches its cap and sends `CLOSING_TURN` exactly
  once, and still returns `consentReading === "withheld"`. No reply the driver can compose clears the
  flag.
- The mirror: a scripted conversation that withholds on its first turn and not on its last returns
  `consentReading === "clear"` — the rule must not fail a run where the agent got its answer.
- `fallbackAnswerCount` counts a wholly-fallback reply as such.

**verify:**

```bash
node --check scripts/uat/uat-08-socratic-authoring.mjs
node scripts/uat/uat-08-socratic-authoring.mjs --self-test
```

Both must pass with **no existing assertion edited**. The self-test arm spawns no child process and
no backend, real or fake, and spends no credential.

**done:** A bolded, numbered question turn yields every one of its questions; a turn that asks in the
imperative with no `?` is answered rather than read as settled; a turn that says in first person that
it is not ready to advance is never `settled` and, if it is still saying so when the conversation
reaches its bound, the run fails at the gate with the agent's own sentence quoted — at both gates,
not one; and no reply the driver itself can compose can clear that flag.

### Task 2 — SHAPE-02 asserts a materialised board row, and SHAPE-05's narration is derived

**files:** `scripts/uat/uat-08-socratic-authoring.mjs`

**action:**

**(a) Measure the board, before and after.** In the live body's decision block (lines 7871-7940),
read `board-counts` once **before** the accept chain and once **after** it, and derive
`criterion2Landed` from the delta: the sum of `epics + tasks + criteria` must be strictly greater
after than before, and greater than zero. Never from which branch happened to run. A run that
accepted nothing, or accepted something that materialised no row, fails — this is strictly harder
than `acceptedCount > 0`, which counted decided proposals rather than board rows.

**(b) Three accept paths, in preference order, each with its own literal argv call site.** Replace
the single `if (taskTarget.proposal)` block with an ordered chain, recording which path ran in an
`acceptPath` string:
1. a pending **task** → `accept-subtree` (D-95's ONE bulk path — today's behaviour, unchanged
   whenever a task proposal exists);
2. else a pending **criterion** → `accept-proposal`, whose D-96 implied-parent walk accepts the
   still-pending parent first in the same transaction, landing two board rows from one accept and
   being the only ordering that lands a *criterion* on the board in a live run;
3. else a pending **epic** → `accept-proposal`, the last resort: an epic with nothing drafted under
   it is still a real board row, and it is exactly what run `01M3P4VZCA1M0C37C8V7ZE72WG` had sitting
   pending.

Each branch picks its own target with its own `pickPendingProposal` call immediately before its own
decision, and each decision is written as a **literal** argv array (`["accept-proposal", id]`), never
a variable verb. This is not stylistic: 260929-lq1's structural gate at line 2504 scans for
argv-shaped literals, and a computed verb would slip past it — regressing the rule this closure is
supposed to be reinforcing. Verified against that check's algorithm during planning: each new
decision's nearest preceding `pickPendingProposal(` is its own pick, with no mutating argv op in
between.

The reject and amend picks that follow (lines 7894-7936) are unchanged. No `excludeIds` entry is
needed for an accepted criterion — `list-pending` filters decided rows server-side, which is the
helper's whole contract.

**(c) SHAPE-02 reports what was measured.** Add an optional `criterion2Detail = null` to
`buildCriteriaResults`'s destructure (line 367), following the exact precedent `proposalListVerdict`
set at line 380 — defaulting to `null` so the existing ternary at line 412 still produces its current
strings and **all fourteen offline callers stay byte-identical in their gating outcome and their
printed line**. The live arm passes a derived detail naming the accept path and both count triples,
so a failing SHAPE-02 line says which rows existed rather than asserting that no subtree was
accepted.

**(d) Derive the SHAPE-05 narration instead of asserting a failure mode.** The block at lines
7947-7961 explains an absent epic with the fixed string *"the model proposed a task without an
epic"* — and printed exactly that for a run that was the precise inverse: one epic proposal, zero
task proposals. Replace it with a reading of what the run actually observed:
- drop the `if (rejectedTaskId)` guard — whether SHAPE-05's reopen leg could be exercised has nothing
  to do with whether a reject happened, and gating the explanation on it is why a wrong sentence got
  printed at all;
- delete `rejectedTaskId` (declared at line 7695, assigned at line 7900). Its only consumer was that
  guard, and it held a **criterion** id under a task-shaped name — a small instance of the same
  defect class: a name asserting a shape the value does not have. `rejectedCriterionId` already
  carries the id and is already used by the amend exclusion;
- narrate from `countsAfter.epics` and from a target-type tally of the `pending` snapshot at line
  7838. When an epic exists, say so and say that SHAPE-05 needs a *second session* against it, which
  a single-session run structurally cannot produce. When none does, print the accept path taken and
  the tally — for this run, `epic=1 assumption=8 criterion=10 task=0`, the exact inverse of the
  sentence that was printed. Both branches keep naming `authoring_acceptance.rs::criterion_4_*` as
  where the reopen leg is genuinely proven, and keep reporting the run honestly as unproven rather
  than fabricating a pass.

**(e) The offline regression — real bridge, real core, zero tokens.** Append a slice to the
`--board-read-check` arm, after the decision-ordering regression's closing `step()` at line 5968 and
before the arm's closing brace at 5973. That arm already spawns the real `uat_authoring_ops` binary
against a real scratch board and already ends with every criterion proposal decided
(`exhaustedCriterionPick.pendingOfType === 0`), so it is the right place and costs nothing.

Reusing the arm's still-open run and project, and its existing `apply-proposal-created` event shape:
- read `board-counts` as the baseline;
- stage one **epic** proposal and one **criterion** child naming that epic's proposal id as
  `parentProposalId`;
- pick the criterion through `pickPendingProposal`, and **assert the picked id equals the id the
  staging call returned** — grounding the pick rather than trusting list ordering;
- `accept-proposal` it, then read `board-counts` again and assert `epics` and `criteria` each grew by
  exactly **one**: one accept, two materialised rows, the D-96 implied-parent walk observed through
  the board rather than inferred from a return value. This is the fallback path SHAPE-02's new
  preference order depends on and which no offline arm currently measures this way;
- assert the same delta arithmetic SHAPE-02 now uses reports a landing for this accept, and reports
  **no** landing for a zero delta — the "never passes on zero" half, exercised rather than asserted;
- narrate each leg with `step()` in the arm's existing voice, the slice announcing itself with the
  literal `board-row materialisation regression` so the verify step below can prove it ran.

**verify:**

```bash
node --check scripts/uat/uat-08-socratic-authoring.mjs
node scripts/uat/uat-08-socratic-authoring.mjs --self-test
cargo build -p core --bin uat_authoring_ops
node scripts/uat/uat-08-socratic-authoring.mjs --board-read-check 2>&1 | tee /tmp/260929-nxq-brc.log
grep -q "board-row materialisation regression" /tmp/260929-nxq-brc.log
grep -q "decision-ordering regression complete" /tmp/260929-nxq-brc.log
```

The `cargo build` is required, not optional: with the binary absent the arm calls `skip()`, and a
skip reads green. The first `grep` proves the new slice actually executed; the second proves
260929-lq1's slice still does. Neither command spawns a backend, real or fake, and neither spends a
credential.

**done:** SHAPE-02 passes only when `board-counts` shows a row that was not there before; an accepted
epic, or an accepted criterion that pulls its pending epic parent in with it, both count as the
outcome landing on the board; a zero delta never passes; the SHAPE-05 narration states what the run
observed rather than a fixed failure mode; and 260929-lq1's structural decision-ordering gate still
sees every accept call site.

### Task 3 — Record the rule, the finding and the audit in the ledger the next author reads

**files:** `scripts/uat/README.md`

**action:**

Item 8's findings-and-rules ledger runs to an Eleventh finding (line 728) and a ninth rule (line 749).
Append to that sequence — same voice, same shape — after the "What this task did NOT resolve"
paragraph closing the Eleventh finding (line 767) and before `### Items 2 and 4 — the visual ones`
(line 769). Do not start a parallel document; the value of this entry is that it sits where the
previous eleven findings sit.

Write a **Twelfth finding** recording, plainly:

- That the instrument's notion of "the agent asked something" was a literal `?` at the end of a
  sentence-split fragment, and that this failed twice in one run for two independent reasons —
  markdown emphasis sitting between the `?` and the whitespace hid four of five numbered questions,
  and a turn that asked in the imperative contained no `?` at all, so the driver read it as settled.
- That the run therefore advanced D-90's gate **twice** over an agent that had said in plain words
  *"I don't think this is settled enough to advance"*, and reported it as
  *"the conversation settled after 2 agent turn(s), 1 question(s) answered."*
- **That the agent behaved well and the instrument did not.** Told to use its own judgement and keep
  going, it staged an epic plus eight assumption rows covering the question nobody answered, rather
  than tasks it had no basis to write. Record this explicitly, because the number it produced —
  zero task proposals — reads from the outside exactly like a model failure, which is this
  register's own eighth rule operating on a new instance.
- The cost, exactly, as the ledger's other findings do: the run completed and produced the
  SHAPE-01/02/03/04 table for the first time in twelve rounds, at the price of a credential, and
  SHAPE-02's failure in it was an instrument artefact rather than a product fact.
- The two quieter defects the same audit found: `criterion2Landed` could only ever be assigned inside
  the task branch, so a pending epic whose acceptance would have materialised a real board row could
  not pass SHAPE-02; and the SHAPE-05 narration explained an absent epic with the fixed string *"the
  model proposed a task without an epic"* for a run that was the precise inverse.
- That this is the same family as G-05-2 and G-05-7 — the scripted driver mis-driving the
  conversation — which is why it is stated as a property rather than closed as three line fixes.

Then state **a tenth rule**, in the blockquote form rules 3 through 9 use:

> Answer the question the agent actually asked, and never open a gate the agent has said it is not
> ready for. An instrument that decides the conversation is over on the agent's behalf will report a
> clean run and a useless one, and the number it prints will be read as a fact about the model.

Ground it in specifics a reader can act on: that a question is not defined by a `?` — markdown
emphasis and the imperative mood both hide one, and both were measured against this run's own
transcript; that `classifyWithheldConsent` requires a first-person statement of the agent's own
readiness, with *"only you can advance it"* and *"the stage has advanced on your side"* named as the
verbatim negatives that forced that boundary; that the reading is taken from the **last** agent turn,
so an agent that got its answer is never punished for having once objected; that only a later agent
turn can clear it, never the driver's own reply, which is what stops a canned deflection from
satisfying the detector; that the refusal lives at both gates, because installing it at one is the
fix-the-instance failure this register exists to name; and that a fallback answer is a legitimate
delegation as one line among answers and a deflection as an entire reply, which is why the ratio is
now narrated.

Add the **canned-turn audit** as a short table in the ledger's own style — all fourteen rows from
this plan's audit section, verdicts included, so the turns judged fine are on the record beside the
one that was not. Name the one defect it found (`ANSWER_BANK[4]`'s bare `where` alternative claiming
a question about repository location) and the one latent risk (`SECOND_TURN`'s "let's move on when
you're ready", harmless only because the live arm never sends it).

Close with what this task did **not** resolve, in the ledger's existing habit: no live run happened
and no credential was spent, so whether a real backend given a driver that actually answers its
questions then stages tasks is a live-run observation this task does not make; `05-REVIEW.md`'s
WR-01, IN-01 and IN-02 all remain open; and the credential seam
(`composeIsolatedClaudeConfigDir`) still has no committed test against a real `~/.claude`, unchanged
since round 8.

**verify:**

```bash
grep -q "A tenth rule" scripts/uat/README.md
grep -q "Twelfth finding" scripts/uat/README.md
node scripts/uat/uat-08-socratic-authoring.mjs --self-test
```

**done:** The rule, the finding and the full canned-turn audit are recorded in Item 8's own ledger,
in sequence with the eleven findings and nine rules before them, naming the enforcement mechanism,
the boundaries, the turns judged fine and the unresolved remainder — so the next author meets the
property before the call site.

## Threat model

The one trust boundary this task touches: **untrusted model prose crossing into the harness's own
control flow.** `extractOpenQuestions`, `classifyWithheldConsent` and `readAdvanceConsent` all read
text the backend produced and use it to decide whether a stage gate opens.

| Threat ID | Category | Component | Severity | Disposition | Mitigation |
|---|---|---|---|---|---|
| T-nxq-01 | Tampering | `classifyWithheldConsent` — model prose steering the gate | medium | mitigate | The detector can only ever make the harness **more** conservative (refuse to advance); it can never cause an advance. The failure direction is safe by construction. Patterns require a first-person readiness statement, and both directions are pinned by self-test fixtures taken verbatim from a real transcript |
| T-nxq-02 | Denial of Service | `extractOpenQuestions` — a pathological turn producing unbounded extraction | low | mitigate | `MAX_EXTRACTED_QUESTIONS` (5) already caps the returned list and is unchanged; the imperative-ask pass runs inside the same cap |
| T-nxq-03 | Denial of Service | ReDoS in the new split, ask and consent regexes | low | mitigate | Every new quantifier is a bounded single-character class (`[^.!?]{0,60}`, `[*_\`"'’”)\]]*`) with no nested repetition, so matching is linear; the consent patterns run against individual sentence fragments, never a whole turn |
| T-nxq-04 | Spoofing | A model emitting text designed to look like an answered question | low | accept | The driver's reply is a fixed bank string and the flag is cleared only by a later **agent** turn, so the model can at most refuse to be satisfied — which fails the run loudly rather than passing it quietly |

No package-manager installs, no network calls and no new dependencies: the package-legitimacy gate
does not apply to this task.

## Constraints

- **The live arm must not be run.** Verification is `--self-test` and `--board-read-check` only,
  after `cargo build -p core --bin uat_authoring_ops` — an absent binary makes that arm `skip()`, and
  a skip reads green. Neither arm spawns a backend, real or fake. Whether to re-run the live gate is
  the developer's separate, deliberate decision and is out of scope. **No task's `done` condition
  depends on a live run.**
- **No product code changes.** `packages/core`, `packages/sidecar` and `packages/desktop` are not
  touched. The audit found no product-side defect: `accept_subtree`'s task-root requirement, the
  pending guards on reject and amend, and both stage instruction texts are all correct, and Task 2
  reads `board-counts` around them rather than changing them.
- **No existing assertion is edited.** Both offline arms must pass with their current checks intact;
  this task only adds. In particular the checks at lines 2182 (forbidden coaching), 2194/2216
  (extraction), 2256-2280 (bank membership and fallback reachability), 2418 (exactly two
  `advance-stage` call sites), 2468 (exactly two `waitForTurn` call sites) and 2504 (260929-lq1's
  decision-ordering gate) all keep passing unedited.
- **260929-lq1's work is not regressed.** `pickPendingProposal` stays the only sanctioned way a live
  decision target is chosen; its structural gate keeps seeing every accept call site, which is why
  Task 2 writes literal argv arrays rather than a computed verb; `draftedCriteriaCount` keeps reading
  the pre-cascade snapshot; the `--board-read-check` idempotent-accept exemption is untouched; and
  `criterion3Decided` stays true only when a reject **and** an amend both ran.
- **SHAPE-02 gets harder, never easier.** A board-counts delta requires a row that did not exist
  before. It must never pass on zero.
- `buildCriteriaResults` keeps its signature compatible and all fourteen existing callers
  byte-identical in both gating outcome and printed line; `composeDeveloperReply` is not modified at
  all.
- `MAX_AGENT_TURNS` stays 4. No bound is raised.

## Follow-ups (not this task)

- Re-running the live gate to produce a SHAPE table from a run whose driver actually answered the
  agent — a credential-spending developer decision, deliberately left to the developer.
- `05-REVIEW.md`'s WR-01 (the live arm's own try/catch/finally is still executed by no automated
  command), IN-01 and IN-02 — all three still open.
- The credential seam (`composeIsolatedClaudeConfigDir`) still has no committed test against a real
  `~/.claude`; unchanged by this task and unchanged since round 8.
