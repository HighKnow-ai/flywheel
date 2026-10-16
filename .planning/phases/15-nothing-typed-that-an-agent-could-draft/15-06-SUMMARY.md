---
phase: 15-nothing-typed-that-an-agent-could-draft
plan: 06
subsystem: authoring
tags: [rust, rusqlite, tauri, react, launch-sheet, acceptance-criteria, lint, tdd]

requires:
  - phase: 15-nothing-typed-that-an-agent-could-draft
    provides: "15-01: criterion_lint::lint_statement / CriterionRefusal, criterion drafts for hand-made tasks with no parent proposal, the 30-draft project cap"
  - phase: 04-context-reconstitution
    provides: "D-76/D-77 revision chain and BOARD-03 criteria freeze at Start Work"
provides:
  - "query::criterion_coverage::criterion_coverage / CriterionCoverage: one read for D-12 (current + pending drafts), with judgement_only_count derived from a NULL verification_hint"
  - "acceptance_criterion::waive_criteria + EVENT_CRITERIA_WAIVED: a deliberate no-criteria start as one human-attributed event, no tasks.status write"
  - "Launch sheet gate: Start Work (button and Enter) blocked for a task with no current criteria, AcceptanceCriteriaList composed inside the sheet, recorded Proceed without criteria"
  - "criterion_lint_advice: the same lint shown to a human as a non-blocking note beside the add and edit fields"
affects: [15-08, drafting-engine, launch-sheet, project-gauge, DRFT-11]

actuals:
  tokens: 12800
  tasks: 3
  commits: 6

tech-stack:
  added: []
  patterns:
    - "A Tauri DTO that #[serde(flatten)]s a core struct and adds one lookup (project id) rather than widening the core type"
    - "Fail-open gate: only a definite 'no current criteria' blocks; a failed coverage read blocks nothing"
    - "Advice as component state: a debounced pure-function read that never enters React Query"

key-files:
  created:
    - packages/core/src/query/criterion_coverage.rs
    - packages/core/tests/criterion_coverage.rs
    - packages/desktop/src/launch-sheet/__tests__/criteria-route.test.tsx
    - packages/desktop/src/item-detail/__tests__/lint-advice.test.tsx
  modified:
    - packages/core/src/query/mod.rs
    - packages/core/src/domain/acceptance_criterion.rs
    - packages/desktop/src-tauri/src/commands/criterion.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/tests/handler_roster.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/launch-sheet/LaunchSheet.tsx
    - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
    - packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx

key-decisions:
  - "A pending draft counts as coverage for 'do not draft again' (has_coverage) but not as a contract: the sheet stays blocked while current_count is 0, so an undecided draft never unlocks Start Work"
  - "The coverage gate fails open: a coverage read that errors blocks nothing (T-15-30); only coverage.currentCount === 0 routes through drafting"
  - "The Tauri coverage DTO flattens the core CriterionCoverage and adds projectId, because the composed criteria form needs the task's project and the context packet does not carry it"
  - "Proceed without criteria is a quiet text action (session-text-action), not a drawn action, which keeps the pinned drawn-action count in finish.test.tsx at 2 and matches the Deny precedent for a deliberate-but-routine escape"
  - "criterion_lint_advice returns the core's Display sentence with the ' Statement: ' echo cut off; lint_statement and its Display text in criterion_lint.rs are untouched"
  - "A pending-draft lookup scopes by the task's project first so the (project_id, status) index bounds the scan"

patterns-established:
  - "Guard the action at the function, not only the control: handleSubmit refuses while needsContract because Enter reaches it from the dialog keydown"
  - "Test mocks for a component that gains a board:changed subscription must also stub subscribeBoardChanged, or every render is an unhandled rejection"

requirements-completed: [DRFT-02, DRFT-10]

coverage:
  - id: D1
    description: "One read answers whether a task has criteria coverage under D-12 (current criteria or a pending draft), idempotent and drafting nothing, for a hand-made and an agent-proposed task alike"
    requirement: DRFT-10
    verification:
      - kind: integration
        ref: "packages/core/tests/criterion_coverage.rs#a_hand_made_task_and_an_agent_proposed_task_resolve_through_the_same_function"
        status: pass
      - kind: integration
        ref: "packages/core/tests/criterion_coverage.rs#a_pending_draft_is_coverage_and_reading_it_creates_nothing"
        status: pass
      - kind: integration
        ref: "packages/core/tests/criterion_coverage.rs#a_rejected_draft_is_not_coverage"
        status: pass
    human_judgment: false
  - id: D2
    description: "Judgement-only is derived from a NULL verification_hint with no new column (migrations stay 24)"
    requirement: DRFT-02
    verification:
      - kind: integration
        ref: "packages/core/tests/criterion_coverage.rs#judgement_only_is_the_null_verification_hint_and_nothing_else"
        status: pass
      - kind: other
        ref: "ls packages/core/src/db/migrations | wc -l == 24; grep -rn judgement_only packages/core/src/db/migrations returns nothing"
        status: pass
    human_judgment: false
  - id: D3
    description: "A deliberate no-criteria start is one human-attributed task.criteria_waived event and never a tasks.status write; an agent actor is refused"
    requirement: DRFT-02
    verification:
      - kind: integration
        ref: "packages/core/tests/criterion_coverage.rs#waiving_appends_one_event_and_leaves_status_byte_identical"
        status: pass
      - kind: integration
        ref: "packages/core/tests/criterion_coverage.rs#an_agent_actor_cannot_waive"
        status: pass
    human_judgment: false
  - id: D4
    description: "The launch sheet blocks Start Work (button and Enter) for a task with no current criteria, composes AcceptanceCriteriaList rather than a second editor, issues no mutation on open and cancel, and records the waiver exactly once"
    requirement: DRFT-02
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/launch-sheet/__tests__/criteria-route.test.tsx"
        status: pass
    human_judgment: false
  - id: D5
    description: "A human-typed criterion is advised by the same lint and never refused: the note is role=note, steals no focus, clears on cancel and save, and the add and edit save paths are untouched"
    requirement: DRFT-02
    verification:
      - kind: automated_ui
        ref: "packages/desktop/src/item-detail/__tests__/lint-advice.test.tsx"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/criterion.rs#lint_advice_tests"
        status: pass
    human_judgment: false
  - id: D6
    description: "Whether the blocked sheet reads as a moment the developer was already in (D-10's 'five decisions at the moment you were already opening the task') and whether a pending draft has an obvious place to be decided"
    verification: []
    human_judgment: true
    rationale: "Tone and flow of the drafting route, and where a pending draft is decided, are not asserted by any test; the sheet issues no drafting request itself (see Known Limitations)."

duration: 24min
completed: 2026-10-16
status: complete
plan_head_before: c265f22e7d60611d73025b3c3108f75c96c67f93
---

# Phase 15 Plan 06: Launch-sheet criteria route, derived coverage and non-blocking lint advice Summary

**One Rust read defines "no criteria" (current criteria or a pending draft) and derives judgement-only from a NULL hint, the launch sheet blocks Start Work on a contract-less task while composing the one criteria form and a recorded Proceed-without-criteria, and the agent-draft lint now advises human typing without ever refusing it.**

## Performance

- **Duration:** 24 min
- **Started:** 2026-10-16T05:38:54Z
- **Completed:** 2026-10-16T06:03Z
- **Tasks:** 3 (all TDD)
- **Files modified:** 13 (4 created)

## Accomplishments

- `criterion_coverage` returns `current_count`, `pending_draft_count`, `has_coverage` (D-12 exactly) and `judgement_only_count` (`verification_hint IS NULL`) in two statements. Pending drafts are found by `target_id` (hand-made task, F3) or by a parent proposal that materialised the task (fresh path); one function, no branch on origin.
- `waive_criteria` appends one `task.criteria_waived` event in the house `{field, before, after, label}` shape, human-only, and writes nothing else. `tasks.status` is asserted byte-identical across the call.
- The launch sheet reads coverage (fail-open, re-read on `board:changed`). With `currentCount === 0` it disables Start Work and also refuses in `handleSubmit` so Enter cannot bypass it, names the reason in a `role="note"` sentence, composes `AcceptanceCriteriaList` (autoOpenWhenEmpty), and offers a one-click `Proceed without criteria` guarded by a ref so two synchronous activations are one call.
- `criterion_lint_advice` is a pure command (no `State`, no database). `AcceptanceCriteriaList` shows its answer as a muted `role="note"` beside the add and inline-edit fields, debounced 250 ms, held in component state.

## Task Commits

1. **Task 1: coverage read and waiver** - `421f8872` (test, RED: 8 of 10 failing on assertions) then `c20194ac` (feat, GREEN)
2. **Task 2: launch-sheet criteria route** - `aaa8f20b` (test, RED: 8 of 8 failing) then `c5143820` (feat, GREEN)
3. **Task 3: lint advice on human text** - `4b8b9797` (test, RED: 7 of 7 failing) then `4c6c7938` (feat, GREEN)

**Plan metadata:** committed with this SUMMARY (docs).

## TDD Gate Compliance

Every task has a `test(15-06)` commit before its `feat(15-06)` commit, and each RED run failed on assertions for the planned behaviour, not on compilation or discovery. Task 1's RED commit carries compile-only stubs (`criterion_coverage` returning zeros, `waive_criteria` a no-op) as 15-01 did. Task 3's Rust unit tests (`lint_advice_tests`) live in `criterion.rs` and landed with the GREEN commit, since a unit test in the file under change cannot be committed ahead of it; the RED evidence for that task is the vitest file. I did not run `gsd check tdd-red-evidence` (it reads node TAP and none of the three RED runs is TAP). No REFACTOR commit was needed.

## Files Created/Modified

- `packages/core/src/query/criterion_coverage.rs` - the coverage read
- `packages/core/src/domain/acceptance_criterion.rs` - `EVENT_CRITERIA_WAIVED`, `waive_criteria`
- `packages/core/src/query/mod.rs` - registers `criterion_coverage` alongside the existing modules
- `packages/desktop/src-tauri/src/commands/criterion.rs` - `task_criterion_coverage`, `task_criteria_waive`, `criterion_lint_advice`
- `packages/desktop/src-tauri/src/main.rs`, `packages/desktop/src/adapters/tauri.ts` - additive registration and wrappers beside 15-05's
- `packages/desktop/src/launch-sheet/LaunchSheet.tsx` - the gate, composed form, waiver control
- `packages/desktop/src/item-detail/AcceptanceCriteriaList.tsx` - `useLintAdvice` and `LintAdvice`
- `packages/core/tests/criterion_coverage.rs`, `criteria-route.test.tsx`, `lint-advice.test.tsx` - the three new targets

## Decisions Made

See `key-decisions`. The two worth restating: a pending draft stops a second draft but does not unlock Start Work, and the gate fails open so a broken coverage read can never make a task unstartable.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] The roster pin was already stale**
- **Found during:** Task 3 (running `cargo test -p desktop`)
- **Issue:** `handler_roster.rs` pins `ROSTER_COUNT` at 145. After my three commands the gate collected 150, so two commands from 15-05 (`task_file_set_provenance`, `repo_tracked_paths`) had already left it stale and failing.
- **Fix:** Moved the pin to 150 in the same diff as the roster change, as the file's own comment requires.
- **Files modified:** `packages/desktop/src-tauri/tests/handler_roster.rs`
- **Verification:** `cargo test -p desktop --test handler_roster` 5 passed
- **Committed in:** `4c6c7938`

**2. [Rule 3 - Blocking] The new `board:changed` subscription broke the existing launch-sheet test**
- **Found during:** Task 2
- **Issue:** `useBoardChangedInvalidation` calls the real `listen` in jsdom, producing 33 unhandled rejections in `launch-sheet.test.tsx`.
- **Fix:** That test's module mock now also stubs `subscribeBoardChanged` and returns a task with criteria from `taskCriterionCoverage`, keeping the gate out of those tests' way.
- **Files modified:** `packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx`
- **Committed in:** `c5143820`

**3. [Rule 1 - Plan/UI mismatch] The criteria composer has no Save control and no Cmd+Enter**
- **Found during:** Task 3
- **Issue:** The plan's Task 3 tests speak of a disabled-or-not Save control and Cmd+Enter. `AcceptanceCriteriaList` saves with Enter on the statement (moves to the hint) then Enter on the hint; there is no button.
- **Fix:** The tests assert the real save sequence still creates the criterion with advice on screen, and that the field is never disabled or read-only. The keyboard map (`n`, `e`, `j`, `k`, Enter) is unchanged.
- **Committed in:** `4b8b9797`, `4c6c7938`

**4. [Rule 3 - Blocking] Proceed without criteria is a text action, not a drawn one**
- **Found during:** Task 2
- **Issue:** `session/__tests__/finish.test.tsx` pins the launch sheet at exactly two `control-edge session-action` controls. A third drawn button failed it.
- **Fix:** Used `session-text-action`, the quiet form the permission card already uses for its routine Deny. The pin is unchanged.
- **Committed in:** `c5143820`

**5. [Plan deviation] No `criterionLintAdvice` adapter wrapper**
- **Issue:** The plan lists a thin typed wrapper for `criterion_lint_advice`. `AcceptanceCriteriaList` imports only `invokeCommand` from the adapter, and several existing tests mock that module with `invokeCommand` alone, so importing a second named export would break them.
- **Fix:** The component calls `invokeCommand("criterion_lint_advice", ...)`, as it does for every other command, so the wrapper would have been dead code. The two other wrappers exist.

---

**Total deviations:** 5 (3 blocking fixes, 1 plan/UI mismatch, 1 omitted wrapper)
**Impact on plan:** No scope creep. Items 1, 2 and 4 are existing gates the change had to satisfy.

## Issues Encountered

- `criterion_lint_advice` returns the core's own `Display` sentence, which ends in an agent-oriented clause ("and draft it again"). That wording is the core's, as the plan asked, but it reads slightly oddly to a person typing. Left alone to keep `criterion_lint.rs` untouched.

## Known Limitations

- **The sheet issues no drafting request.** The plan's Task 2 asks that drafted criteria land in the composed form and that the sheet not re-draft on re-render. No command that requests a criterion draft exists in this phase, so the sheet gates, composes the form and counts pending drafts but never starts a drafting run. A pending draft keeps the sheet blocked ("waiting for your decision") but the sheet has no control to decide it; the tray that does is outside this plan. Logged in `.planning/WINDOWS.md` as a deviation. D-10's flow (drafts arriving as the developer opens the task) needs whatever plan introduces the trigger.
- The pending-draft count includes only `create` drafts; an `amend` draft cannot exist for a task with no current criteria, so it cannot be the missing coverage.
- Waiving is per start: reopening the sheet on a still-criteria-less task asks again and appends another `task.criteria_waived` event. That is deliberate for measurability and not a state on the task.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- 15-08 can build on `LaunchSheet.tsx`: the gate is `coverageQuery` / `needsContract`, the form region and the reason row are each one block, and `handleSubmit` is already guarded.
- DRFT-11's number can count `task.criteria_waived` events directly.
- Verification: `cargo test -p core --test criterion_coverage` (10), the five regression targets (`criteria` 22, `criteria_pin` 5, `status_derivation` 42, `task_created_at_todo` 5, `proposal_no_promotion` 15), `cargo test -p desktop` (156 unit, roster 5, payload 3), `cargo check --workspace` clean, `npx tsc --noEmit` clean, full vitest 103 files / 1730 passed.

## Self-Check: PASSED

Created files exist on disk (`criterion_coverage.rs`, the two core and desktop test files, `lint-advice.test.tsx`); all six task commits exist (`421f8872`, `c20194ac`, `aaa8f20b`, `c5143820`, `4b8b9797`, `4c6c7938`). Migration count is 24, `judgement_only` appears in no migration, no `UPDATE tasks SET status` was added, `drafted_by` still returns nothing, and no colour literal was added to either edited component. No stubs found in files touched.

---
*Phase: 15-nothing-typed-that-an-agent-could-draft*
*Completed: 2026-10-16*
