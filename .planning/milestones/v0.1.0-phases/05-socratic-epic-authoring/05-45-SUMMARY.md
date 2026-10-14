---
phase: 05-socratic-epic-authoring
plan: 45
subsystem: authoring
tags: [rust, stage-machine, instruction-text, gap-closure]

# Dependency graph
requires:
  - phase: 05-socratic-epic-authoring (plan 05-44)
    provides: proposal_list, the fourth capped board_read tool that reads a staged proposal's id back
provides:
  - The criteria instruction — D-88's third stage now delivers an instruction naming
    propose_criterion, the one-call-per-criterion rule, and D-96's still-pending-parent rule —
    where before it delivered nothing at all.
  - The distillation instruction extended by one sentence naming proposal_list as the way to read a
    staged proposal's id back.
  - StageInstruction — the type advance_stage returns, renamed from DistillationInstruction now
    that it carries two distinct instructions rather than one.
  - The opening prompt's ## Your Task section now states the three-stage shape once, in both the
    premise-present and no-premise branches.
affects: [phase 05 plans 46-47, any future plan touching authoring_session.rs's stage instructions
  or epic_context_packet.rs's opening prompt]

# Actuals (#2632)
actuals:
  tokens: 6900
  tasks: 3
  commits: 4
plan_head_before: fbfa88e

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A stage-transition instruction is a fixed const &str beside its sibling, never
       interpolated or parameterised — advance_stage's match arm just picks which constant, so
       the wire content is never influenced by a caller (T-05-45-02)."
    - "Renaming a type that only one file declares and no other file imports by name (every other
       call site destructures the tuple) is a same-commit rename+behavior-change with no ripple —
       confirmed by grep before touching the source."

key-files:
  created: []
  modified:
    - packages/core/src/domain/authoring_session.rs
    - packages/core/tests/authoring_distillation.rs
    - packages/core/tests/authoring_stage.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/core/src/epic_context_packet.rs
    - packages/core/tests/epic_context_packet.rs
    - packages/core/tests/bin/uat_authoring_ops.rs
    - scripts/uat/uat-08-socratic-authoring.mjs

key-decisions:
  - "Deviation (Rule 1 — auto-fixed bug the plan's own measured_diagnosis did not name):
     packages/core/tests/authoring_stage.rs's advance_walks_challenge_to_decompose_to_criteria
     asserted 'advancing out of decompose must NOT return a distillation instruction' — the exact
     defect this plan closes, encoded a second time in a file the plan's Task 1 files_modified
     list did not include. Left unfixed it would have failed cargo test -p core --test
     authoring_stage, one of Task 1's own three named verify commands. Inverted the assertion to
     require Some(...), matching authoring_distillation.rs's own inversion; no other change to
     that file."
  - "RED verified manually, not via gsd_run check tdd-red-evidence: the tool parses `node --test`
     TAP output and cannot classify cargo test output — the same limitation Phase 03 and plan
     05-11 both recorded. Both target tests failed on their new assertions (nonzero exit, a real
     assertion mismatch tied to the named planned behavior, not a crash, fixture failure, or
     unrelated test) before the GREEN commit, and both pass after it."

requirements-completed: [SHAPE-01, SHAPE-02, SHAPE-03, SHAPE-04, SHAPE-05]

coverage:
  - id: D1
    description: "Entering D-88's criteria stage now delivers an instruction naming
      propose_criterion by its exact tool name, the one-call-per-criterion rule, and that a
      still-pending parent proposal does not need to be accepted first (D-96's implied-parent
      walk) — closing the exact gap the live run's epic:1/assumption:12 result exposed."
    requirement: "SHAPE-03"
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_distillation.rs#advancing_out_of_decompose_into_criteria_returns_a_criteria_instruction_naming_propose_criterion"
        status: pass
      - kind: integration
        ref: "packages/core/tests/authoring_stage.rs#advance_walks_challenge_to_decompose_to_criteria"
        status: pass
    human_judgment: false
  - id: D2
    description: "Entering decompose still returns D-89's distillation instruction, now also
      naming proposal_list as the way a staged proposal's id is read back — closing the other half
      of G-05-9 (plan 05-44 made the tool reachable; this plan tells the agent it exists)."
    requirement: "SHAPE-02"
    verification:
      - kind: integration
        ref: "packages/core/tests/authoring_distillation.rs#advancing_out_of_challenge_returns_a_distillation_instruction_naming_propose_assumption"
        status: pass
    human_judgment: false
  - id: D3
    description: "The type advance_stage returns is renamed StageInstruction, since it now carries
      two distinct instructions rather than one — no type alias left behind, no stale name in a
      doc comment."
    requirement: "SHAPE-01"
    verification:
      - kind: integration
        ref: "cargo test -p core --test authoring_stage (no_sidecar_source_names_the_human_only_advance_path, both_new_commands_appear_in_main_rs_generate_handler_list)"
        status: pass
      - kind: integration
        ref: "cargo build --workspace"
        status: pass
    human_judgment: false
  - id: D4
    description: "The criteria instruction reaches a live session through the SAME best-effort
      relay the distillation instruction already used — no new delivery path, no new failure
      surface, and the stage advances even when the relay fails (D-90)."
    requirement: "SHAPE-01"
    verification:
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
      - kind: e2e
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --replay-check --scenario proposes-work-after-advance"
        status: pass
    human_judgment: false
  - id: D5
    description: "The opening prompt states the three-stage shape once, in both the premise-present
      and no-premise branches, without weakening either branch's existing closing line."
    requirement: "SHAPE-04"
    verification:
      - kind: integration
        ref: "packages/core/tests/epic_context_packet.rs#a_stated_premise_carries_under_its_own_heading_and_the_closing_instruction_names_it"
        status: pass
      - kind: integration
        ref: "packages/core/tests/epic_context_packet.rs#no_premise_carries_no_premise_heading_and_the_closing_instruction_asks_instead_of_naming_a_framing"
        status: pass
    human_judgment: false
  - id: D6
    description: "The bridge binary emits exactly one instruction key (instructionText), named for
      what it now carries in both transitions, and both read sites in
      uat-08-socratic-authoring.mjs read it — no stale distillationText/distillationCursor/
      distillationReply identifier remains anywhere outside .planning/ prose."
    requirement: "SHAPE-05"
    verification:
      - kind: integration
        ref: "cargo build -p core --bin uat_authoring_ops"
        status: pass
      - kind: e2e
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --self-test"
        status: pass
      - kind: e2e
        ref: "scripts/uat/uat-08-socratic-authoring.mjs --replay-check (all 6 scenarios)"
        status: pass
    human_judgment: false

duration: ~55min
completed: 2026-09-26
status: complete
---

# Phase 05 Plan 45: The Criteria Stage Asks For Criteria Summary

**D-88's third stage now returns its own `StageInstruction` naming `propose_criterion`, closing the half of gap G-05-9 that plan 05-44 didn't touch: entering `criteria` used to deliver nothing, so no turn in the product had ever asked the agent to draft acceptance criteria.**

## Performance

- **Duration:** ~55 min
- **Started:** 2026-09-26T20:23:00+08:00 (approx.)
- **Completed:** 2026-09-26T20:41:02+08:00
- **Tasks:** 3
- **Files modified:** 8

## Accomplishments

- Renamed `DistillationInstruction` → `StageInstruction` in `authoring_session.rs` (the one file
  that declares it) — the type now carries two distinct instructions, not one, so it is named for
  what it is.
- Added `CRITERIA_INSTRUCTION_TEXT`: names `propose_criterion` by its exact tool name, states the
  one-call-per-criterion rule, says a criterion may target a task staged this session, a
  pre-existing task, or the epic proposal directly, names `parent_proposal_id` and `proposal_list`,
  and states plainly the parent does NOT need to be accepted first (D-96's implied-parent walk) —
  the exact reasoning the live run's agent used to justify never staging criteria.
- Extended `DISTILLATION_INSTRUCTION_TEXT` by one sentence naming `proposal_list` as the way a
  staged proposal's id is read back — closing the other half of G-05-9 (plan 05-44 made the tool
  reachable; this plan tells the agent it exists).
- `advance_stage`'s `Option` population is now a match on `next()`, returning the criteria
  instruction for `Criteria`, the distillation instruction for `Decompose`, and `None` only for the
  `Challenge` arm `next()` can never actually produce (documented as unreachable, not
  `unreachable!()`).
- `authoring_stage_advance` relays both instruction kinds through the SAME best-effort seam — no
  control-flow change, only the local binding rename (`distillation` → `instruction`) and an
  updated doc comment.
- The opening prompt's `## Your Task` section states the three-stage shape once, in both the
  premise-present and no-premise branches, without weakening either branch's existing closing line.
- The UAT bridge binary and harness script's instruction key renamed `distillationText` →
  `instructionText` end to end (both read sites), with `distillationCursor`/`distillationReply`
  renamed to `instructionCursor`/`instructionReply` in the live body.

## Task Commits

Each task was committed atomically:

1. **Task 1: Give D-88's criteria stage its own instruction, and name the type for what it carries** — `9181698` (test, RED) then `34f302d` (feat, GREEN)
2. **Task 2: Relay the criteria instruction through the existing best-effort seam, and state the stage machine once in the opening prompt** — `3e499e2` (feat)
3. **Task 3: Rename the bridge's instruction key to match what it now carries, and follow it to its two read sites** — `c240a96` (test)

**Plan metadata:** (this commit)

_Note: Task 1 is a TDD task and produced two commits (test → feat); no refactor commit was needed
— the implementation was already minimal and clean on first pass._

## Files Created/Modified
- `packages/core/src/domain/authoring_session.rs` — `StageInstruction` (renamed), `CRITERIA_INSTRUCTION_TEXT` (new), `DISTILLATION_INSTRUCTION_TEXT` (extended one sentence), `advance_stage`'s match on `next()`
- `packages/core/tests/authoring_distillation.rs` — inverted the decompose-exit test, extended the challenge-exit test
- `packages/core/tests/authoring_stage.rs` — fixed `advance_walks_challenge_to_decompose_to_criteria`'s stale assertion (deviation, see below)
- `packages/desktop/src-tauri/src/commands/authoring.rs` — `authoring_stage_advance`'s binding rename and doc comment
- `packages/core/src/epic_context_packet.rs` — one sentence appended to both `## Your Task` branches
- `packages/core/tests/epic_context_packet.rs` — one assertion per branch for the new sentence
- `packages/core/tests/bin/uat_authoring_ops.rs` — `distillationText` → `instructionText`
- `scripts/uat/uat-08-socratic-authoring.mjs` — both read sites and the live body's local names updated

## Decisions Made

See frontmatter `key-decisions` for the deviation and the RED-verification note.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `authoring_stage.rs`'s own test encoded the exact defect this plan closes, a second time, in a file the plan's Task 1 `files_modified` list did not name**
- **Found during:** Task 1, running the plan's own third verify command (`cargo test -p core --test authoring_stage`)
- **Issue:** `advance_walks_challenge_to_decompose_to_criteria` asserted `distillation.is_none()` after advancing `decompose -> criteria`, with the message "advancing out of decompose must NOT return a distillation instruction" — correct about the pre-plan product, wrong about the product this plan ships. The plan's `<measured_diagnosis>` and `<read_first>` list for Task 1 both named `authoring_stage.rs` only for its source-scanning gate (D-90's human-only-caller assertion), not for this second stale assertion.
- **Fix:** Inverted the assertion to require `Some(...)`, with a message naming plan 05-45/G-05-9, mirroring `authoring_distillation.rs`'s own inversion. No other change to the file — the source-scanning gate and every other test in it are untouched.
- **Files modified:** `packages/core/tests/authoring_stage.rs`
- **Verification:** `cargo test -p core --test authoring_stage` — 9/9 pass.
- **Committed in:** `34f302d` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 Rule 1 bug).
**Impact on plan:** Necessary for the plan's own Task 1 `<verify>` to pass at all — a literal reading of the plan's `files_modified` list would have left this test red. No scope creep: the fix is the same one-line inversion `authoring_distillation.rs` needed, applied to a second file carrying the identical stale assertion.

## Issues Encountered
None beyond the deviation above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Both instruction texts (quoted below verbatim, per this plan's own `<output>` instruction) are
  now shipped, so plan 05-46 can assert against them directly without re-deriving them.
- Full verification suite green: `cargo test -p core --test authoring_distillation` (8/8),
  `cargo test -p core --test authoring_stage` (9/9), `cargo test -p core --test
  authoring_stage_marker_contract` (3/3), `cargo test -p core --test epic_context_packet` (16/16),
  `cargo build -p core --bin uat_authoring_ops`, `node scripts/uat/uat-08-socratic-authoring.mjs
  --self-test` (all PASS), `--replay-check` (all 6 scenarios PASS), `cargo test --workspace` (exit
  code 0, full suite green including the 41-test desktop crate and the 24-test classify_invocation
  binary shown in the captured tail).
- Plans 05-46 and 05-47 (which depend on this plan) can proceed.
- No live re-run of the challenge transcript happened in this plan, as the plan's own prohibitions
  required — SHAPE-03's live verdict line in `05-LIVE-CHALLENGE-TRANSCRIPT.md` remains for a future
  live-verification round.

### The two instruction texts, verbatim

**`DISTILLATION_INSTRUCTION_TEXT`** (entering `decompose`):

> Before we move on: call `propose_assumption` once for EACH assumption you challenged in this
> stage, each call carrying that one assumption and the answer I gave you — one tool call per
> assumption, never a single call carrying a list, and never folding more than one assumption's
> text into a single call. These rows are a DRAFT of your own reasoning: I will accept, amend or
> reject each one myself, and only the ones I accept will be primed into a later session on this
> epic. Any proposal you stage in this session can have its id read back with `proposal_list` —
> that id is what `parent_proposal_id` takes. Go ahead now.

**`CRITERIA_INSTRUCTION_TEXT`** (entering `criteria`):

> Now for the acceptance criteria: call `propose_criterion` once for EACH criterion — one tool
> call per criterion, never a single call carrying a list, and never folding more than one
> criterion's text into a single call. Draft criteria for every task you staged this session, for
> any task that already existed on this epic, and directly on the epic proposal itself where a
> criterion belongs there instead — don't wait for a task to exist first if none does. Name the
> parent with `parent_proposal_id`; call `proposal_list` to see the id of anything you have staged
> and not yet decided on. The parent does NOT need to be accepted first: accepting a criterion
> accepts its still-pending parent in the same transaction, so go ahead and name a pending parent
> directly. These rows are a DRAFT of your own reasoning: I will accept, amend or reject each one
> myself, and only the ones I accept will be primed into a later session on this epic. Go ahead
> now.

---
*Phase: 05-socratic-epic-authoring*
*Completed: 2026-09-26*

## Self-Check: PASSED

- `packages/core/src/domain/authoring_session.rs` — FOUND on disk
- `.planning/phases/05-socratic-epic-authoring/05-45-SUMMARY.md` — FOUND on disk
- Commit `9181698` (Task 1 RED) — FOUND in `git log --oneline --all`
- Commit `34f302d` (Task 1 GREEN) — FOUND in `git log --oneline --all`
- Commit `3e499e2` (Task 2) — FOUND in `git log --oneline --all`
- Commit `c240a96` (Task 3) — FOUND in `git log --oneline --all`
- All `<acceptance_criteria>`/`<done>` gates re-verified immediately before writing this summary:
  `cargo test -p core --test authoring_distillation` PASS (8/8); `cargo test -p core --test
  authoring_stage` PASS (9/9); `cargo test -p core --test authoring_stage_marker_contract` PASS
  (3/3); `cargo test -p core --test epic_context_packet` PASS (16/16); `cargo build -p core --bin
  uat_authoring_ops` PASS; `cargo test --workspace` PASS (exit code 0).
