---
phase: 05-socratic-epic-authoring
plan: 42
subsystem: testing
tags: [uat, harness, ask-user-question, tdd, gap-closure, fixture, evidence-sheet]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-41)
    provides: the typed, ordered `ToolCallEvent.questions?: AskUserQuestionPrompt[]` adapter-seam field this plan reads from `turn.toolCalls`, and the frozen live capture `scripts/uat/fixtures/live-opus5-ask-user-question.json` this plan's scenario imports verbatim
provides:
  - "`questionsFromTurn`/`buildAgentExchange` — the ONE place every agent exchange is constructed from a captured turn, wired at all nine capture sites (`driveChallengeConversation`, the `--replay-check` scenario branches, the live arm's inline callback including the decompose-turn timeout path)"
  - "`extractOpenQuestions` takes the whole turn (typed AskUserQuestion prompts first, then prose fragments, capped together); `composeDeveloperReply` answers an options-carrying entry with `OPTION_SELECTION_PREFIX` + one offered label verbatim, never quoting the question text"
  - "`renderQuestionsAsked` renders the Questions section inside the agent turn that asked them — headers, question text, multiSelect marking, and option labels/descriptions in emitted order — absent/empty rendering byte-identically"
  - "the 15th `--replay-check` scenario (`ask-user-question`), driving the real sidecar/watchdog/normaliser against the frozen live capture end to end, proving all three properties together"
affects: []

# Actuals (#2632)
actuals:
  tokens: 11920
  tasks: 3
  commits: 4
plan_head_before: 70a6390998b1f6b5b4a97e00e0e1ee7f5adf13a8
commits: 4

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One exported builder (`buildAgentExchange`) constructs every agent-exchange object from a captured turn, called from all nine capture sites, instead of nine hand-synchronised literals — the exact discipline `scripts/uat/README.md` Item 8 states and the mechanism the NF-01 duplicate-turn defect violated."
    - "A model-authored field that is present-or-absent (never present-but-empty) propagates that same discipline end to end: `ToolCallEvent.questions` (plan 05-41) -> `buildAgentExchange`'s conditional spread -> `renderQuestionsAsked`'s empty-string return for undefined/[] -> byte-identical rendering for a turn that carried none."
    - "Answering an option the agent itself offered is structurally distinguished from quoting the agent's own question text back at it: every developer reply line stays an exact member of one of two fixed sets (the answer bank's values, or the offered option labels), asserted both in `--self-test` and in the shared `--replay-check` composition-invariant check."

key-files:
  created: []
  modified:
    - scripts/uat/lib/fake-authoring-claude.mjs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "`questionsFromTurn` reads `turn.toolCalls` only, with no regular expression and no reference to `raw`/stderr/a session log — the payload arrives typed from the adapter seam (plan 05-41), and reconstructing it from text would be the exact wrong-layer fix README Item 8's fourth rule forbids."
  - "`extractOpenQuestions`'s ordering guarantee is stated honestly as WITHIN-source only (tool-call questions first, then prose) — the harness does not claim a merged wire ordering it does not measure, since a tool call precedes the trailing prose of the turn that issued it but no stronger interleaving fact is available."
  - "The pre-existing `--replay-check` composition-invariant check (every developer line is an exact answer-bank member) is relaxed to also accept a line opening with `OPTION_SELECTION_PREFIX`, rather than threading per-turn offered-option context through that shared, cross-scenario loop — the narrower, more precise assertion already lives in `--self-test` and in the `ask-user-question` scenario's own branch."
  - "The Task 3 self-test's questions-carrying evidence fixture is built by spreading `SYNTHETIC_EVIDENCE`'s own existing agent exchange (never a fresh `speaker: \"agent\"` object literal), keeping the file's non-comment `speaker: \"agent\"` construction count at exactly the four Task 1 named as legitimate survivors (the renderer's `SYNTHETIC_EVIDENCE` fixture x2, the frozen pre-fix negative control x1, `buildAgentExchange` itself x1) rather than introducing a fifth."

requirements-completed: [SHAPE-01, SHAPE-03]

coverage:
  - id: D1
    description: "The clarifying questions an agent asks through AskUserQuestion appear in the evidence sheet a human judges SHAPE-01 from, inside the agent turn that asked them, with their offered options."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test: 'the Questions section for an agent exchange renders inside that exchange's own block ... carrying every question text and every one of the eleven option labels'"
        status: pass
      - kind: integration
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario ask-user-question"
        status: pass
    human_judgment: false
  - id: D2
    description: "The conversation driver treats AskUserQuestion's own questions as open questions and answers them, instead of reading a turn whose prose carries no question mark as settled."
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario ask-user-question: developerTurns.length >= 1, answeredQuestionCount >= 3, no developer reply quotes a question's own text"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every agent exchange written into the evidence sheet is built by one function (buildAgentExchange), so a turn captured on the deadline/timeout path and a turn captured on the happy path carry the same fields."
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test: 'buildAgentExchange on a turn with no AskUserQuestion returns an object carrying no questions key at all' (incl. the overrides-take-precedence assertion)"
        status: pass
      - kind: other
        ref: "grep -c 'buildAgentExchange' >= 7 (measured 16); grep of non-comment 'speaker: \"agent\"' <= 5 (measured 4, all four named legitimate survivors)"
        status: pass
    human_judgment: false
  - id: D4
    description: "A turn that carried no AskUserQuestion renders byte-identically to how it rendered before this plan."
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test: 'an agent exchange with no questions key renders byte-identically to one whose questions is an empty array, with no Questions section either way'"
        status: pass
    human_judgment: false
  - id: D5
    description: "A payload with zero questions, zero options, or a shape that does not parse produces no Questions section — never an empty one."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test: 'renderQuestionsAsked returns the empty string for undefined, a non-array, or an empty array'"
        status: pass
    human_judgment: false
  - id: D6
    description: "Questions render in the order the agent asked them, and each question's options render in the order it offered them."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test: 'each question renders its header, question text, and its option labels ... in emitted order, marking multiSelect true distinctly from false/absent'"
        status: pass
    human_judgment: false
  - id: D7
    description: "Two questions with identical text render as two entries, never merged into one."
    requirement: SHAPE-03
    verification:
      - kind: unit
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test: 'two questions with identical text render as two entries, never merged into one'"
        status: pass
    human_judgment: false
  - id: D8
    description: "The whole path — fake backend, real watchdog, real shipped normaliser, real sidecar, the real driver, the real sheet renderer — is exercised by a named offline scenario that costs no tokens."
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario ask-user-question (15th scenario, SCENARIOS registry length 15); scripts/uat/uat-08-socratic-authoring.mjs --replay-check (all fifteen scenarios pass, exit 0, zero FAIL lines)"
        status: pass
    human_judgment: false
  - id: D9
    description: "Whether a real backend, given the fixed AskUserQuestion-disallowed argv (plan 05-41) and this plan's harness-side fix, actually produces a live evidence sheet a human judges as pushing back on the stated premise — a live-run observation this round explicitly does not make."
    human_judgment: true
    rationale: "No live run happens in this round; every property proven above is proven against the frozen offline capture and the real sidecar/normaliser/watchdog, never against a fresh live model turn. That is the standing, honestly-flagged residual this whole phase's gap-closure rounds carry forward (see 05-41-SUMMARY.md's own D7), not something this plan resolves."

duration: ~50min
completed: 2026-09-26
status: complete
---

# Phase 5 Plan 42: The clarifying questions an agent asks through AskUserQuestion now reach the evidence sheet a human judges SHAPE-01 from

**One agent-exchange builder (`buildAgentExchange`/`questionsFromTurn`) carries the typed `AskUserQuestion` prompts from plan 05-41's adapter seam onto every captured turn; the conversation driver now answers an offered option instead of settling on a turn whose prose carries no question mark; and a 15th offline `--replay-check` scenario proves the whole path — fake backend, real watchdog, real normaliser, real sidecar, real driver, real sheet renderer — end to end for zero tokens.**

## Performance

- **Duration:** ~50 min
- **Started:** 2026-09-26
- **Completed:** 2026-09-26
- **Tasks:** 3
- **Files modified:** 2

## Accomplishments

- `scripts/uat/uat-08-socratic-authoring.mjs`: new exported `questionsFromTurn`/`buildAgentExchange` — the ONE place an agent exchange is constructed from a captured turn — wired at all nine capture sites that used to build one by hand (`driveChallengeConversation`'s three sites, `runReplayCheckScenario`'s `truncation-repro`/`slow-tool-mid-turn`/`proposes-work-after-advance` branches, and the live arm's two inline-callback sites including the decompose-turn timeout path). Exactly four non-comment `speaker: "agent"` object literals remain, each named and preserved on purpose (the renderer's `SYNTHETIC_EVIDENCE` self-test fixture x2, the frozen pre-fix negative control x1, `buildAgentExchange` itself x1).
- `extractOpenQuestions` now takes the whole captured turn: every typed `AskUserQuestion` prompt comes first (via `questionsFromTurn`), then the pre-existing prose-fragment extraction, capped together at `MAX_EXTRACTED_QUESTIONS`. `composeDeveloperReply` answers an options-carrying entry with the new `OPTION_SELECTION_PREFIX` ("Picking: ") plus one offered label verbatim — the first label matching an `ANSWER_BANK` pattern, else the first offered label — while a no-options entry is answered exactly as before.
- `renderQuestionsAsked` (new pure helper) renders a Questions section — header, question text, a multiSelect marker, and option labels/descriptions — inside the agent turn that asked them, immediately after that turn's fenced text and before the next exchange's heading; returns the empty string for `undefined`/a non-array/`[]`, keeping an absent-vs-empty exchange byte-identical.
- `scripts/uat/lib/fake-authoring-claude.mjs`: new `ask-user-question` `SCENARIOS` entry (the registry's 15th), importing plan 05-41's frozen live capture (`live-opus5-ask-user-question.json`) verbatim for its `tool_use` block and replaying the fixture's own `cliAnsweredToolResult` text as the `tool_result` — never an idealised answer.
- A matching `--replay-check --scenario ask-user-question` branch in `runReplayCheckScenario` asserts the questions survive the wire onto the raw `tool_call` event and the built exchange, that `questionsFromTurn` returns the fixture's own headers (`Triggers`, `Channels`, `Timing`) in order, that the driver sends a developer reply selecting an offered option per question (never quoting the question text), that `answeredQuestionCount >= 3`, and that the run's unknown-event count is zero.

## Task Commits

Each task was committed atomically:

1. **Task 1: Tracer — one exported agent-exchange builder carrying the typed questions, wired at every capture site, proven end to end by a new zero-token replay scenario** - `8a2c63e` (feat)
2. **Task 2: Make the driver answer an offered option, so the Socratic exchange develops instead of settling on a turn whose prose happened to carry no question mark** - `d28aebb` (feat)
3. **Task 3: Render the questions into the evidence sheet, inside the turn that asked them, with every degenerate payload omitting the section rather than emptying it** - `54b1c8d` (feat)

**Follow-up (same session, closing a self-test gap left open after Task 1):** `3645dd2` (test) — pins `buildAgentExchange`'s key-presence/overrides behavior and `questionsFromTurn`'s empty-return cases directly, rather than only through the replay-check scenarios that already exercised them indirectly.

**Plan metadata:** this SUMMARY + STATE.md/ROADMAP.md, committed immediately after this file.

## Files Created/Modified

- `scripts/uat/lib/fake-authoring-claude.mjs` — new `ask-user-question` scenario, importing the frozen fixture at `scripts/uat/fixtures/live-opus5-ask-user-question.json` verbatim.
- `scripts/uat/uat-08-socratic-authoring.mjs` — `questionsFromTurn`, `buildAgentExchange`, `OPTION_SELECTION_PREFIX`, `renderQuestionsAsked`; `extractOpenQuestions`/`composeDeveloperReply` signature and behavior changes; nine capture sites routed through the builder; a new `--replay-check` scenario branch; ~15 new/extended `--self-test` checks.

## Decisions Made

See `key-decisions` in the frontmatter above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Relaxed the shared `--replay-check` composition-invariant check to accept option-selection lines**
- **Found during:** Task 2, running `--replay-check --scenario ask-user-question` after implementing `composeDeveloperReply`'s option-selection path
- **Issue:** The pre-existing, scenario-agnostic composition-invariant loop in `runReplayCheckScenario` (asserted for every scenario) required every non-closing developer line to be an exact `ANSWER_BANK` value. A `"Picking: <label>"` line is a legitimate, new answer shape this plan introduces, so the check would fail every scenario that ever produces one — starting with `ask-user-question` itself, and any future scenario that reaches this same shared branch.
- **Fix:** Extended the assertion to `bankValues.has(stripped) || stripped.startsWith(OPTION_SELECTION_PREFIX)`.
- **Files modified:** `scripts/uat/uat-08-socratic-authoring.mjs`
- **Verification:** `--replay-check` (all fifteen scenarios) passes; the narrower, per-label assertion (that the selected text is an exact member of the offered options and contains no substring of the question) lives in `--self-test` and in the `ask-user-question` branch's own developer-turn checks.
- **Committed in:** `d28aebb` (part of Task 2's own commit)

**2. [Rule 2 - Missing Critical] Added direct self-test coverage for two of Task 1's own acceptance criteria**
- **Found during:** Post-Task-3 review, re-reading Task 1's `<acceptance_criteria>` against what `--self-test` actually asserted
- **Issue:** "`buildAgentExchange` on a turn with no `AskUserQuestion` returns an object for which `Object.hasOwn(exchange, "questions")` is `false`" and `questionsFromTurn`'s three degenerate-input cases were proven only INDIRECTLY, through the `--replay-check` scenarios that happen to exercise them — no direct, fast, offline `--self-test` check pinned them.
- **Fix:** Added two dedicated `--self-test` checks exercising `buildAgentExchange`/`questionsFromTurn` as pure functions (including the `overrides` precedence behavior).
- **Files modified:** `scripts/uat/uat-08-socratic-authoring.mjs`
- **Verification:** `--self-test` passes with both new checks.
- **Committed in:** `3645dd2` (separate commit, after Task 3's own commit — see Issues Encountered for why it is not folded into Task 1's commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 missing critical).
**Impact on plan:** Both fixes were necessary to keep the plan's own `<verification>` block ("`--replay-check` passes all fifteen scenarios") true, and to close a gap between Task 1's stated acceptance criteria and what was actually pinned by an executable check. No scope creep — neither fix touches production code paths the plan did not already define.

## Issues Encountered

- **Plan-level `<verification>` inconsistency, flagged rather than silently resolved:** the plan's own closing `<verification>` block states "Exactly one non-comment `speaker: "agent"` construction exists in the script." This is inconsistent with Task 1's own detailed `<action>`/`<acceptance_criteria>` text, which explicitly names FOUR legitimate survivors that "must survive... unconverted" (the renderer's `SYNTHETIC_EVIDENCE` self-test fixture x2, the frozen pre-fix negative control x1) plus `buildAgentExchange` itself (x1), and whose own executable `<verify>` command for this property is `-le 5`, not `-eq 1`. Converting the two preserved fixtures to satisfy "exactly one" would directly violate Task 1's own explicit instruction that they "must survive untouched" — converting the frozen negative control in particular "would make it agree with the mechanism it exists to contradict." Treated Task 1's own detailed, machine-checked reasoning as authoritative over the terser summary line; the measured count (4) matches Task 1's own accounting exactly and satisfies its own `-le 5` gate. Flagging this explicitly rather than silently picking one reading.
- **A self-test coverage gap surfaced only after Task 3 landed** (see Deviation 2 above) — resolved with a follow-up commit in the same session rather than reopening Task 1's own commit, since GSD's per-task commit protocol only permits new commits, never amending a prior task's commit.
- No auth gates encountered; no package installs; no credentials spent (this plan's own `<verify>` commands are `--self-test` and `--replay-check[...]`, neither of which spawns `claude` or touches a real backend — confirmed by inspection, matching the plan's own prohibition).
- A pre-existing, unrelated uncommitted modification to `.planning/phases/05-socratic-epic-authoring/05-LIVE-CHALLENGE-TRANSCRIPT.md` was present in the working tree at the start of this session (visible in `git status` throughout). It is not one of this plan's `files_modified`, was not touched, and is not included in any commit made by this plan.

## User Setup Required

None — no external service configuration required.

## Threat Flags

None. All six threats in this plan's own `<threat_model>` are addressed by the plan as written and verified above: T-05-42-01 (the synthetic marker and replaced verdict section are untouched and re-verified with a questions-carrying exchange in `--self-test`), T-05-42-02 (`renderQuestionsAsked` reads only `question`/`header`/`multiSelect`/option `label`/`description` — no env, path, credential or envelope field is reachable from it), T-05-42-03 (the seam's own `MAX_ASK_USER_QUESTIONS`/`MAX_ASK_USER_QUESTION_OPTIONS` bounds are unchanged; `MAX_EXTRACTED_QUESTIONS` still caps what the driver answers), T-05-42-04 (`questionsFromTurn`'s body contains no regular expression and no `raw`/stderr/session-log reference — confirmed by inspection), T-05-42-05 (the forbidden-coaching regular expression is extended to `OPTION_SELECTION_PREFIX`, and every developer reply line is asserted to be an exact member of one of two fixed sets), T-05-42-SC (no package-manager install task in this plan; no `package.json` diff anywhere in the commits).

## Next Phase Readiness

- Gap `G-05-8(a)` is closed on its harness-facing half: the questions and options a real `AskUserQuestion` call carries now reach the evidence sheet a human reads, inside the turn that asked them, and the driver develops the exchange past that turn instead of reading it as settled — proven offline, end to end, against the frozen live capture, at zero token cost.
- **Residual, stated honestly (carried forward, matching 05-41-SUMMARY.md's own D7):** no live run happens in this round. Whether a real backend, given plan 05-41's `--disallowedTools AskUserQuestion` argv and this plan's harness-side fix, produces a live evidence sheet a human actually judges as pushing back on the stated premise, is a live-run observation neither this plan nor its predecessor makes.
- WR-01 (`05-REVIEW.md`) remains OPEN, as instructed: this plan's own extraction of `buildAgentExchange` is the narrowest structural change needed for the property this round adds (typed questions reaching the sheet), not the full extraction WR-01 asks for. The live arm's own 337-line inline `try/catch/finally` callback is still not invoked by any automated command after this plan.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- FOUND: scripts/uat/lib/fake-authoring-claude.mjs
- FOUND: scripts/uat/uat-08-socratic-authoring.mjs
- FOUND: .planning/phases/05-socratic-epic-authoring/05-42-SUMMARY.md
- FOUND commit: 8a2c63e
- FOUND commit: d28aebb
- FOUND commit: 54b1c8d
- FOUND commit: 3645dd2
- `node scripts/uat/uat-08-socratic-authoring.mjs --self-test`: 0 FAIL lines (re-verified at close-out, foreground run)
- `node scripts/uat/uat-08-socratic-authoring.mjs --replay-check`: exit 0, 15/15 scenarios PASS, 0 FAIL lines (re-verified at close-out, foreground run)
- `plan_head_before` (`70a6390`) → `HEAD`: 4 commits (matches `commits: 4` above)
