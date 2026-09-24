---
phase: 05-socratic-epic-authoring
plan: 21
subsystem: testing
tags: [socratic-authoring, uat-harness, conversation-driver, gap-closure, offline-replay, G-05-2]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring
    provides: "plan 05-20's turn-boundary primitive (SidecarClient.waitForTurn / accumulateTurn) — this plan builds the conversation driver on top of it"
provides:
  - "driveChallengeConversation (scripts/uat/uat-08-socratic-authoring.mjs) — reads what the agent actually asked, answers it from a fixed ANSWER_BANK (never the agent's own words), and advances the stage only after a completed turn, bounded at MAX_AGENT_TURNS with an explicit CLOSING_TURN escape"
  - "readNoWorkPlanned(events) — a three-valued reading (unproven | refused | violated) of SHAPE-01's second half, replacing a boolean that read the wrong sidecar field and could never fail"
  - "scripts/uat/lib/fake-authoring-claude.mjs SCENARIOS: settles-after-answers, never-settles, stages-work-during-challenge — three offline, zero-token fixtures proving the driver's own settling, cap-escape and violation-detection behaviour against the real sidecar"
  - "--replay-check --scenario <name> selector — runs one or every SCENARIOS entry, each with its own run/sidecar/teardown"
affects: [uat-08-socratic-authoring]

# Actuals (#2632)
actuals:
  tokens: 16175
  tasks: 3
  commits: 5

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Conversation driver over a turn-boundary primitive: driveChallengeConversation reads a whole agent turn (SidecarClient.waitForTurn), extracts open questions with a simple sentence-boundary heuristic, and composes a reply whose every line is an EXACT member of a fixed answer bank — the model's own words never re-enter the developer's side of the transcript, so the transcript cannot become self-confirming."
    - "Bounded escape, never a silent hang: a declared MAX_AGENT_TURNS cap triggers one fixed CLOSING_TURN and a reported non-settled outcome, rather than looping indefinitely or advancing mid-generation."
    - "Three-valued criterion reading over a raw event stream: readNoWorkPlanned(events) computes unproven/refused/violated from sidecar.events directly, so the field-name fix (TOOL_NAME_FIELD, pinned against the product's own ToolCallEvent declaration) lives in exactly one function instead of being re-derived at each call site."
    - "Falsifiability proven by construction, twice (Task 2, Task 3): a natural pre-implementation RED was not available in either case (the driver/detector already existed correctly by the time the proving scenario was written), so each was falsified by a small, named, reverted mutation — the exact assertion failed for the exact reason the task exists to prevent, then the mutation was reverted and confirmed byte-identical via git diff."

key-files:
  created: []
  modified:
    - scripts/uat/uat-08-socratic-authoring.mjs
    - scripts/uat/lib/fake-authoring-claude.mjs

key-decisions:
  - "MAX_AGENT_TURNS = 4 (a cap on agent turns, so a runaway conversation cannot burn credentials indefinitely) with a fixed CLOSING_TURN escape — matches the plan's own assumption_delta_decision: the open question is the primary noun, depth is a consequence of the dialogue, and the cap is an explicit, reported, never-silent bound."
  - "ANSWER_BANK entries are ordered pattern/answer pairs over concrete product decisions about OPENING_PROMPT's own notifications premise (audience, trigger, surface, clearing, restart-persistence, batching, first-slice scope) — every value fixed prose, never derived from the agent's text; only the ORDINAL a question appears at is derived."
  - "truncation-repro (plan 05-20's own scenario) is kept on its ORIGINAL manual two-turn code path inside --replay-check, not routed through driveChallengeConversation — its first turn carries no question, so driving it through the conversation driver would settle immediately after turn 1 and never trigger the multi-chunk turn 2 its whole point is to reproduce."
  - "readNoWorkPlanned lives in uat-08-socratic-authoring.mjs, not lib/ — it is this script's own SHAPE-01 criterion logic, mirroring the same locality decision the plan's own action text makes for driveChallengeConversation."
  - "The unproven detail line names the ACTUAL structural proof sites (packages/core/tests/authoring_stage.rs, packages/sidecar/test/authoring-stage-gate.test.mjs) rather than a generic 'not proven this run' — a reader is never left thinking an absence of evidence was a measurement."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04]

coverage:
  - id: D1
    description: "The conversation driver answers what the agent actually asked (never a canned follow-up), from a fixed answer bank whose values never coach the model to challenge/push back/clarify/be Socratic, and sends no developer turn before the preceding agent turn has terminated."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (9 driver-related checks: answer-bank/closing-turn/no-coaching, extractOpenQuestions, composeDeveloperReply, driver ordering + settling + cap-escape, distillation-timeout, single advance-stage call site)"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario settles-after-answers"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario never-settles"
        status: pass
    human_judgment: false
  - id: D2
    description: "When the conversation does not settle within its own bounded depth, the harness says so explicitly (the closing turn, sent exactly once) rather than advancing into silence or looping forever; the escape is proven by construction (a temporarily mutated cap check failed the never-settles assertion for the exact named reason, then was reverted)."
    requirement: SHAPE-01
    verification:
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario never-settles (asserts settled=false, closingTurnSent=true, agentTurns == MAX_AGENT_TURNS + 1)"
        status: pass
    human_judgment: false
  - id: D3
    description: "SHAPE-01's 'no work planned' half reads the field the sidecar actually declares (TOOL_NAME_FIELD, pinned against ToolCallEvent in adapter.ts), returns a three-valued reading, and can genuinely FAIL — proven by an offline scenario in which the agent stages work during the challenge stage with no refusal."
    requirement: SHAPE-01
    verification:
      - kind: unit
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --self-test (4 checks: field-declaration pin, readNoWorkPlanned's own truth table, all-three-readings-to-SHAPE-01 mapping, unproven detail line naming its proof sites)"
        status: pass
      - kind: integration
        ref: "node scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario stages-work-during-challenge"
        status: pass
    human_judgment: false
  - id: D4
    description: "Every claim in this plan is verified offline, at zero tokens — no acceptance criterion requires a live run, a credential or a network call; the shipped product (packages/) was read for the field pin but never edited."
    verification:
      - kind: other
        ref: "git diff --quiet -- packages/"
        status: pass
      - kind: other
        ref: "npm --prefix packages/sidecar test"
        status: pass
    human_judgment: false
---

# Phase 5 Plan 21: Conversation driver + falsifiable no-work-planned reading close G-05-2's remaining two defects Summary

**The Socratic-authoring UAT harness now drives a bounded, responsive conversation (answers what the agent actually asked, from a fixed answer bank, advancing the stage only after a completed turn) and reads SHAPE-01's "no work planned" half from the field the sidecar actually declares, as a three-valued reading that can genuinely fail — both proven offline, at zero tokens, against the real sidecar.**

## Performance

- **Duration:** ~2h
- **Started:** 2026-09-24 (session continuation from plan 05-20)
- **Completed:** 2026-09-24
- **Tasks:** 3 of 3 completed
- **Files modified:** 2

## Accomplishments

- `driveChallengeConversation` (`scripts/uat/uat-08-socratic-authoring.mjs`) — captures a whole
  agent turn via `SidecarClient.waitForTurn`, extracts its interrogative fragments
  (`extractOpenQuestions`, capped, sentence-boundary heuristic), composes a reply from a fixed
  `ANSWER_BANK` (`composeDeveloperReply` — every line an exact bank member, only the ordinal
  derived from the agent's text), and loops bounded at `MAX_AGENT_TURNS = 4`, escaping via one
  fixed `CLOSING_TURN` when the cap is reached rather than looping forever or advancing
  mid-generation.
- The live body now calls the driver once (seeded before `authoring_spawn`'s own cursor) and
  `advance-stage` exactly once, after the driver returns — never mid-conversation. A timeout
  capturing the distillation stage's reply is recorded as a partial exchange (via
  `accumulateTurn`, plan 05-20's own pure scan) rather than aborting the run.
- `scripts/uat/lib/fake-authoring-claude.mjs` gained three new `SCENARIOS` entries —
  `settles-after-answers` (three questions, each matched by the answer bank, then a
  question-free reply), `never-settles` (every turn ends with a further question, forcing the
  cap), and `stages-work-during-challenge` (a `tool_use` block naming the real fully-qualified
  propose-task tool with no refusal following it) — all multi-block, continuing to exercise the
  turn-boundary capture plan 05-20 proved.
- `--replay-check` gained a `--scenario <name>` selector, defaulting to running every scenario
  in sequence, each with its own run/sidecar/teardown. `truncation-repro` keeps its own original
  manual two-turn reproduction unchanged (routing it through the driver would settle immediately
  after its question-free turn 1 and never trigger the multi-chunk turn 2 it exists to prove);
  every other scenario is driven through the REAL `driveChallengeConversation` and asserted
  against a per-exchange ordering invariant and a composition invariant, then advances the stage
  through the bridge and asserts the recorded cursor is at or after the final agent turn's own
  end index.
- `readNoWorkPlanned(events)` replaces the old always-false-therefore-vacuously-true boolean with
  a three-valued reading (`unproven | refused | violated`), reading the field `ToolCallEvent`
  actually declares (`TOOL_NAME_FIELD = "toolName"`, pinned by a self-test check against
  `packages/sidecar/src/adapter.ts` on disk). `buildCriteriaResults` takes the reading;
  SHAPE-01 passes only when challenged AND the reading is not `"violated"`, and its detail line
  names the structural proof sites (`authoring_stage.rs`, `authoring-stage-gate.test.mjs`)
  whenever the reading is `"unproven"`.
- `--self-test` grew from 29 (plan 05-20) to 42 passing checks; `--replay-check` now runs four
  scenarios end to end in ~1.1 seconds total (well under the 90s budget), with zero leftover
  `fake-authoring-claude.mjs` processes and the committed live transcript's checksum unchanged.

## Task Commits

Each task was committed atomically (Tasks 2 and 3 carry `tdd="true"`, each split into a
`test(05-21)` fixture commit followed by a `feat(05-21)` behaviour commit):

1. **Task 1: The harness answers what was asked, and advances only when the turn is over** —
   `2c2f932` (feat)
2. **Task 2: Both conversational shapes proven offline** — `1d63e6b` (test, fixtures) +
   `ff751ea` (feat, driver-based `--replay-check`)
3. **Task 3: SHAPE-01's second half reads the real field, can fail, and never claims evidence it
   lacks** — `da65157` (test, fixture) + `91dac47` (feat, three-valued reading)

**Plan metadata:** (this commit)

## Files Created/Modified

- `scripts/uat/uat-08-socratic-authoring.mjs` — `MAX_AGENT_TURNS`, `ANSWER_BANK`,
  `ANSWER_BANK_FALLBACK`, `CLOSING_TURN`, `extractOpenQuestions`, `composeDeveloperReply`,
  `driveChallengeConversation`, `TOOL_NAME_FIELD`, `readNoWorkPlanned`, the rewired live body, the
  scenario-looped `--replay-check` (`runReplayCheckScenario`, `--scenario` selector), and 13 new
  `--self-test` checks.
- `scripts/uat/lib/fake-authoring-claude.mjs` — three new `SCENARIOS` entries
  (`settles-after-answers`, `never-settles`, `stages-work-during-challenge`).

## Decisions Made

See `key-decisions` in frontmatter.

## Deviations from Plan

None — plan executed exactly as written. Tasks 2 and 3's TDD RED phases were proven by
construction rather than by a natural pre-implementation failure, since in both cases the
behaviour under test already existed correctly from an earlier task in this same plan (Task 1's
driver, for Task 2's scenarios; Task 3's own field-read fix, for Task 3's checks) — the same
documented pattern plan 05-20 established. This is recorded in the TDD Gate Compliance section
below, not as a deviation from the plan's own instructions (the plan's own action text explicitly
anticipates this: "Follow RED→GREEN... watch its assertion fail for a named reason").

## TDD Gate Compliance

**Task 2** (`tdd="true"`) — RED proven by construction: `driveChallengeConversation`'s cap check
(`agentTurns >= maxAgentTurns`) was temporarily mutated to `agentTurns >= maxAgentTurns + 1`;
`--replay-check --scenario never-settles` failed for the exact named reason ("expected the
declared cap plus the one final turn that follows the closing turn", `6 !== 5`); the mutation was
reverted and confirmed byte-identical via `git diff --stat` (222 insertions / 73 deletions,
unchanged before and after), then all scenarios passed again (GREEN).
- RED gate commit: `1d63e6b test(05-21): add settles-after-answers and never-settles conversational fixtures`
- GREEN gate commit: `ff751ea feat(05-21): --replay-check proves both conversational shapes through the real driver`

**Task 3** (`tdd="true"`) — RED proven by construction: `TOOL_NAME_FIELD` was temporarily reverted
to the historical wrong value (`"name"`, the exact regression this task closes). Both the
field-declaration pin self-test check and `readNoWorkPlanned`'s own truth-table check failed for
the exact named reason (`'unproven'` where `'violated'` was expected); `--replay-check --scenario
stages-work-during-challenge` failed at the integration level too. The mutation was reverted and
confirmed byte-identical via `git diff`, then all checks and scenarios passed again (GREEN).
- RED gate commit: `da65157 test(05-21): add stages-work-during-challenge fixture`
- GREEN gate commit: `91dac47 feat(05-21): SHAPE-01's no-work-planned half reads the real field and can fail`

`workflow.tdd_mode` is `false` for this dispatch (per the orchestrator's `TDD_MODE = false`
context flag), so the runtime RED-commit halt gate in `execute-mvp-tdd.md` did not apply. Both
falsifications are recorded here per `tdd.md`'s Fail-Fast Rule discipline, in the same spirit
plan 05-20 established: the RED commit is present and the GREEN commit follows it in the correct
canonical order for both tasks (unlike 05-20's own documented order-inversion), with the
falsification evidence (mutate → fail for the named reason → revert → all green) substituting for
a natural pre-implementation RED that was structurally unavailable.

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **G-05-2's second `missing[]` item is shipped and proven offline.** The conversation now answers
  what the agent actually asks before the stage advances; the fixed two-turn depth is gone,
  replaced by a bounded, responsive driver with an explicit, reported escape.
- **G-05-2's third `missing[]` item is shipped and then some.** The field read is corrected AND
  pinned to the product's own declaration, and the criterion it feeds can now genuinely fail —
  proven by an offline scenario (`stages-work-during-challenge`), not merely asserted in a
  comment.
- **The distillation instruction now reaches a conversation that contains answers** — the concrete
  precondition the 120-second proposal timeout (`.planning/debug/uat-08-live-transcript-unjudgeable.md`)
  was missing. This is not itself re-verified against a live run in this plan (no acceptance
  criterion in this plan requires spending a credential); it is the structural fix the diagnosis
  named as the mechanism to close.
- **The out-of-scope product-side defect stayed out of scope**, confirmed by
  `git diff --quiet -- packages/` returning clean throughout — the text-drop-on-text+tool_use
  latent defect (`.planning/todos/pending/2026-09-24-adapter-drops-assistant-text-when-a-stream-line-carries-text.md`)
  is untouched.
- **SHAPE-01's live dialogue-quality judgement remains outstanding**, as it was after plan 05-20:
  this plan makes the INSTRUMENT trustworthy (a deeper, honest conversation and a falsifiable
  criterion) and does not itself spend a live-run credential or render a human verdict.
  `.planning/WINDOWS.md`'s live-run human-check entries are unaffected and still open, pending a
  deliberate human-authorized live run against the now-doubly-fixed harness (plan 05-20's
  turn-boundary capture, and this plan's conversation depth and falsifiable criterion).
- The next candidate step (not part of this plan) is authorizing a real live run of
  `uat-08-socratic-authoring.mjs` (no flags) against the now-fixed instrument, so a human can
  finally render the SHAPE-01/SHAPE-03 verdicts this whole gap-closure effort exists to make
  possible.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-24*

## Self-Check: PASSED

- Both key-files verified present on disk with `[ -f ]`: `scripts/uat/uat-08-socratic-authoring.mjs`,
  `scripts/uat/lib/fake-authoring-claude.mjs`.
- All 5 task commits (`2c2f932`, `1d63e6b`, `ff751ea`, `da65157`, `91dac47`) verified present via
  `git log --oneline --all`.
- Every task's own `<acceptance_criteria>` re-run and passing at final HEAD:
  Task 1 — `--self-test` 38/38 passing at the time; `--replay-check`/`--board-read-check` green;
  `driveChallengeConversation` referenced ≥2 times; zero leakage into `lib/`; `packages/` clean.
  Task 2 — `--replay-check` (all scenarios) green in ~1.1s, no leftover process, transcript
  checksum unchanged; falsifiability proven by construction (see TDD Gate Compliance).
  Task 3 — `--self-test` 42/42 passing; `toolName` present in the harness; `--replay-check
  --scenario stages-work-during-challenge` green with SHAPE-01 not passing for that scenario;
  `npm --prefix packages/sidecar test` 143/143 unchanged; `packages/` clean; falsifiability proven
  by construction.
- Plan-level `<verification>` re-confirmed at final HEAD: `--replay-check` green across all four
  scenarios (`truncation-repro`, `settles-after-answers`, `never-settles`,
  `stages-work-during-challenge`), `--self-test` green with 42 passing checks,
  `--board-read-check` green, `npm --prefix packages/sidecar test` green (143/143), transcript
  checksum stable, `git diff --quiet -- packages/` clean.
