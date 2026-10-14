---
phase: 13-nothing-new-escapes-the-fence
plan: 06
subsystem: core
tags: [rust, sqlite, proposals, priority, band-semantics, source-gate, drft-05, drft-06]

requires:
  - phase: 13-01
    provides: two-sided gate house style; the PM-vocabulary gate the new code does not trip
  - phase: 13-03
    provides: set_priority_in_tx and set_epic_priority_in_tx, so acceptance composes a priority into its own transaction
  - phase: 13-05
    provides: spine pin (tasks DDL untouched here, so spine_pin stays green) and the Gate 1 / containment machinery extended here
provides:
  - "create_task_in_tx creates at `todo`; `backlog` means only 'proposed by an agent, not yet accepted'"
  - "ProposalPayload::Task / Epic carry an opt-in priority (serde default, omitted when None)"
  - "validate: priority outside 0..=4 refused; a priority with no rationale refused (DRFT-06)"
  - "materialise_proposal applies an accepted priority via set_priority_in_tx, attributed to the accepting human"
  - "priority_is_opt_in.rs: five-file writer allow-list, planted-call firing half, agent-held-to-staging and human-not-blocked behaviour pair"
affects: [13-07, 13-09, authoring-sidecar, fnc-04]

actuals:
  tokens: 28300
  tasks: 3
  commits: 4

tech-stack:
  added: []
  patterns:
    - "a field added to a proposal payload is opt-in: #[serde(default, skip_serializing_if = Option::is_none)] keeps every staged row byte-identical"
    - "a suggestion carries its reasoning in the proposal's existing rationale column, never in the payload"
    - "the writer of an agent-suggested value is the accepting human, not the proposer"

key-files:
  created:
    - packages/core/tests/task_created_at_todo.rs
    - packages/core/tests/priority_is_opt_in.rs
  modified:
    - packages/core/src/domain/task.rs
    - packages/core/src/domain/authoring_proposal.rs
    - packages/core/tests/authoring_acceptance.rs
    - packages/core/tests/proposal_no_promotion.rs
    - packages/core/tests/epic_context_packet.rs

key-decisions:
  - "Acceptance of an agent's task proposal lands at `todo` too (it shares create_task_in_tx). Acceptance is the human act for that path; the proposal stays distinguishable by the task.created event actor (the proposing agent) and the proposal row's decided_by (the human)."
  - "The priority event is attributed to the accepting human, not the proposing agent. Materialise now takes human_actor_id for that."
  - "The rationale requirement is enforced where a proposal is staged (create_proposal_in_tx), on amend against the staged row's own rationale, and at the inbound-event boundary as Ignored, so a priority-bearing event with no reasoning never errors the handler."
  - "The two priority writers join CANONICAL_WRITER_CALLS, so the existing three-container containment bound covers them."

patterns-established:
  - "Tightening a gate when a new write enters an allow-listed container: extend the call list, state why in the const's doc comment"

requirements-completed: [DRFT-06, DRFT-05]

coverage:
  - id: D1
    description: "A hand-made task is created at todo, its created event says todo, its rank comes from the todo band, and band counts agree"
    requirement: DRFT-06
    verification:
      - kind: unit
        ref: "packages/core/tests/task_created_at_todo.rs#a_hand_made_task_is_created_at_todo"
        status: pass
      - kind: unit
        ref: "packages/core/tests/task_created_at_todo.rs#rank_is_allocated_after_the_tail_of_the_todo_band"
        status: pass
      - kind: unit
        ref: "packages/core/tests/task_created_at_todo.rs#board_band_counts_report_a_hand_made_task_in_todo_not_backlog"
        status: pass
    human_judgment: false
  - id: D2
    description: "An accepted agent proposal is distinguishable from a hand-made task by event actor"
    requirement: DRFT-06
    verification:
      - kind: unit
        ref: "packages/core/tests/task_created_at_todo.rs#an_accepted_agent_proposal_is_distinguishable_by_event_actor"
        status: pass
    human_judgment: false
  - id: D3
    description: "A priority suggestion stages pending, applies on accept inside one transaction with exactly one event, and rejecting it changes nothing"
    requirement: DRFT-06
    verification:
      - kind: unit
        ref: "packages/core/tests/authoring_acceptance.rs#one_accept_applies_the_task_and_its_priority_with_exactly_one_priority_event"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_acceptance.rs#rejecting_a_priority_suggestion_leaves_the_priority_and_appends_no_event"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_acceptance.rs#an_epic_priority_suggestion_is_applied_on_accept"
        status: pass
    human_judgment: false
  - id: D4
    description: "Priority is opt-in: a payload without it deserialises and accepts as before, an out-of-range value and a rationale-less suggestion are refused before any write"
    requirement: DRFT-06
    verification:
      - kind: unit
        ref: "packages/core/tests/authoring_acceptance.rs#a_payload_with_no_priority_key_deserialises_with_none_and_serialises_without_one"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_acceptance.rs#a_priority_less_proposal_accepts_exactly_as_before"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_acceptance.rs#a_priority_outside_zero_to_four_is_refused_before_any_write"
        status: pass
      - kind: unit
        ref: "packages/core/tests/authoring_acceptance.rs#a_priority_proposal_with_no_reasoning_is_refused"
        status: pass
    human_judgment: false
  - id: D5
    description: "Priority has exactly five writer files; an agent is held to a pending proposal; a human accepting one is not blocked; the gate fires on a planted call"
    requirement: DRFT-06
    verification:
      - kind: unit
        ref: "packages/core/tests/priority_is_opt_in.rs#only_the_human_command_and_the_acceptance_path_write_priority"
        status: pass
      - kind: unit
        ref: "packages/core/tests/priority_is_opt_in.rs#the_priority_writer_gate_fires_on_a_planted_call"
        status: pass
      - kind: unit
        ref: "packages/core/tests/priority_is_opt_in.rs#an_agent_actor_cannot_write_priority_directly"
        status: pass
      - kind: unit
        ref: "packages/core/tests/priority_is_opt_in.rs#a_human_accepting_a_priority_suggestion_is_not_blocked"
        status: pass
    human_judgment: false
  - id: D6
    description: "An agent can actually reach the new priority field through the propose_item MCP tool"
    verification: []
    human_judgment: true
    rationale: "The tool schema in the sidecar was outside this plan's file list and does not carry priority; the core path is proven but the end-to-end agent route is not. Logged in deferred-items.md."

duration: 1h 30m
completed: 2026-10-14
status: complete
plan_head_before: 2748032d9698d813439a4b0dabb438c3f2b8a5f4
commits: 4
---

# Phase 13 Plan 06: Priority is opt-in and `backlog` means one thing Summary

**Hand-made tasks are created at `todo`, and an agent can only suggest a priority through a staged proposal that carries its rationale and that the accepting human applies inside the acceptance transaction, with the writer set fenced to five files by a two-sided gate.**

## Performance

- **Duration:** about 1h 30m (most of it first-exec Gatekeeper scans after each `core` change)
- **Started:** 2026-10-14T15:44:00Z
- **Completed:** 2026-10-14T17:10:00Z
- **Tasks:** 3
- **Files modified:** 22 (2 created, 20 edited)

## Accomplishments

- `create_task_in_tx` has one `CREATED_BAND` const feeding the tail-rank query, the INSERT, the `task.created` payload and the returned `Task`. Epic creation is unchanged: the plan scoped D-18 to tasks.
- `ProposalPayload::Task` and `::Epic` gain `priority: Option<i64>`. A priority-less payload round-trips byte for byte, which a test asserts, so no stored row changes shape.
- A priority is refused before any write when it is outside 0..=4 (`priority must be between 0 and 4, got N`) or when no rationale accompanies it (`a priority suggestion must carry its reasoning (DRFT-06)`).
- `priority`'s column, its `CHECK (priority BETWEEN 0 AND 4)` on both tables, `DEFAULT_PRIORITY` and the sort key are untouched. No migration, no change to any `CREATE TABLE`, so the 13-05 spine pin needed no edit and `spine_pin` still passes.
- `PriorityPicker.tsx` is unchanged and still mounted (`BoardView`, `CommandPalette`).

## Task Commits

1. **Task 1 RED: hand-made task at todo** - `f9fd945` (test). All five cases failed on the planned assertions (`backlog` vs `todo`, band counts 0 vs 1, rank `8180` vs `80`).
2. **Task 1 GREEN: created at todo** - `21c936c` (feat)
3. **Task 2: priority proposal with reasoning** - `c4c5b6b` (feat)
4. **Task 3: two-sided priority-writer gate** - `04c47c3` (test)

**Plan metadata:** the docs commit following this file.

## TDD Gate Compliance

- Task 1: RED (`f9fd945`) precedes GREEN (`21c936c`), each proven by a run.
- Task 2: **compile-order exception, stated explicitly.** The tests assert behaviour of a new struct field, `ProposalPayload::Task.priority`, which cannot be written before the field exists, so a failing-but-compiling RED was not possible. Test and implementation are in one commit (`c4c5b6b`). Not faked.
- Task 3 is `type="auto"` without `tdd`; its firing half is the proof the gate can fail.

## Task 1: every `'backlog'` occurrence examined

Verdicts for each non-comment occurrence in `packages/core/src` and the desktop Rust:

| Site | Verdict |
|---|---|
| `domain/task.rs` tail-rank query, INSERT literal, event `after`, returned status (4 sites) | **changed** to `CREATED_BAND = "todo"` |
| `domain/epic.rs` 161, 166, 185, 194, 219 (create_epic_in_tx) | keep: epics are not hand-made-vs-proposed in this plan; D-18 names tasks |
| `domain/dispatch_plan.rs` 792, 803, 942, 1002, 1084, 1196, 1197 | keep: `IN ('backlog','todo')` is "plannable work", both bands |
| `epic_context_packet.rs` 592 | keep: same `backlog or todo` plannable predicate |
| `query/mod.rs` 86, 101, 128, 205, 217, 411 and `query/search.rs` 321 | keep: band names, sort order and counts, about the band not newness |
| `domain/mod.rs` 34 `WORKFLOW_STATES`, migrations 0002/0023 CHECK lists, `db/mod.rs` 42 | keep: the vocabulary |
| `desktop/src-tauri/.../commands/board.rs` 83, 93 | keep: DTO field for the band count |

Test assertions changed (value changed, none deleted): `authoring_proposal.rs` (2), `authoring_tracer.rs`, `dispatch_plan.rs`, `epic_context_packet.rs`, `epic_request_draft.rs` (2, rendered text), `forge_live_chain.rs` (2), `hierarchy_workflow.rs`, `status_transitions.rs`, `activity_trail.rs` (three tests whose `set_task_status(..,"todo")` became a no-op and now step to `in_progress`/`in_review`).

## Files Created/Modified

- `packages/core/src/domain/task.rs` - the band const and the new doc sentence
- `packages/core/src/domain/authoring_proposal.rs` - payload field, `priority()`, validation, apply-on-accept, three guards
- `packages/core/tests/task_created_at_todo.rs` - five D-18 tests
- `packages/core/tests/priority_is_opt_in.rs` - the gate and the behaviour pair
- `packages/core/tests/authoring_acceptance.rs` - eight priority tests (8 to 16)
- `packages/core/tests/proposal_no_promotion.rs` - `CANONICAL_WRITER_CALLS` 9 to 11
- about 12 other test files - `priority: None` added at 126 construction sites; status expectations updated

## Decisions Made

See key-decisions. One divergence from the plan's wording: `materialise_proposal` gained a `human_actor_id` parameter so the priority event names the accepting human.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] 126 `ProposalPayload` construction sites needed `priority: None`**
- **Found during:** Task 2
- **Issue:** adding a field to a struct variant breaks every literal construction. The plan's file list named three test files.
- **Fix:** a brace-matching script appended `priority: None` to every construction, one by hand where the title text contained the word "priority". `cargo check --workspace --tests` is clean.
- **Files modified:** 12 test files under `packages/core/tests`
- **Committed in:** `c4c5b6b`

**2. [Rule 3 - Blocking] A 13-05 regression broke `epic_context_packet`**
- **Found during:** Task 1 verification
- **Issue:** plan 13-05 split `MATCH_WHERE` into `EPICS_MATCH_WHERE` and `TASKS_MATCH_WHERE`, and `unbounded_reads_in_query_module_and_epic_context_packet_are_all_named_in_the_allowlist` still named the old constant, so it failed before my change landed.
- **Fix:** the allowlist names the two new constants. Not caused by this plan, fixed because "core tests pass" is this plan's own acceptance bar.
- **Files modified:** `packages/core/tests/epic_context_packet.rs`
- **Committed in:** `21c936c`

**3. [Rule 1 - Bug] Plan's literal `grep -c backlog` over `task.rs` lines 60-140 cannot be 0**
- **Issue:** the same task requires a doc sentence stating that `backlog` now means "proposed by an agent". After the edit exactly one match remains in that range: the doc comment. No code literal survives.
- **Committed in:** `21c936c`

**4. [Rule 1 - Bug] Plan's "exactly one `UPDATE tasks SET status` in `task.rs`, none elsewhere" is wrong on the base commit**
- **Issue:** `agent_run.rs:233` already holds a second one (sets `in_progress` on run start). Logged in `deferred-items.md`, untouched.

**5. [Rule 2 - Missing critical] The rationale rule needed three entry points, not one**
- **Issue:** the plan names `validate_payload`, but a payload has no rationale (it lives on the proposal). The check had to sit beside the staging write, on amend (against the staged row), and on the inbound-event path, where a violation is `Ignored` rather than an error.
- **Committed in:** `c4c5b6b`

**6. [Rule 1 - Plan wording] "An agent-actor attempt to write priority directly is refused" has no refusal to assert**
- **Issue:** core has no actor-type authority gate on `set_priority`; the refusal the plan means is structural. The behaviour test therefore asserts the agent's only route leaves a pending proposal with `decided_by` empty, `tasks.priority` unchanged and zero priority events; the source gate asserts no agent-reachable file names a writer.

**Total deviations:** 6 (2 blocking, 2 bug, 1 missing critical, 1 plan wording). **Impact:** none on scope.

## Issues Encountered

- A first background run passed all test targets as one unsplit zsh string, so cargo treated it as a name filter and started scanning every test binary. Killed and re-run with a bash array. No code consequence.
- `cargo test -p core` as a single command is not runnable on this machine (Gatekeeper). See Verification for what ran.

## Known Stubs

None. No placeholder, empty-value or TODO text introduced.

## Threat Flags

None. No new endpoint, auth path or trust-boundary schema surface. T-13-25 to T-13-28 are mitigated by the tests named under `coverage`; T-13-29 accepted, no dependency added.

## Verification

- `cargo test -p core --test task_created_at_todo`: 5 passed (RED run: 5 failed first)
- `--test authoring_acceptance`: 16 passed (8 before, 8 added); `--test priority_is_opt_in`: 4 passed
- `--test proposal_no_promotion --test pm_vocabulary_gate --test estimate_absent --test spine_pin`: 10, 4, 2, 4 passed
- Task 1 batch of 17 targets (authoring_proposal 42, criteria 22, dispatch_auto_merge 64, dispatch_plan 61, forge_live_chain 19, status_transitions 22, and others): all pass after the fixes above
- A second batch of 27 targets chosen for touching `create_task`, status, band order or proposals: 380 tests, 0 failed
- 13 further authoring/proposal targets: all pass
- `cargo check --workspace --tests`: clean
- `npx vitest run src/board/__tests__`: 32 files, 383 tests pass; `npx tsc --noEmit`: only the 2 pre-existing `brand-rule.test.ts` errors
- `grep -c "priority BETWEEN 0 AND 4" 0023_drop_estimate.sql`: not re-run; no migration or DDL file changed in this plan
- **Not executed:** the roughly 60 remaining core test binaries. They compile; the plan's literal "`cargo test -p core` passes in full" is compiled-clean with about 60 of 121 executed, not proven by a single full run.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 13-07's deriver can rely on `backlog` meaning only "proposed, not accepted"; hand-made and accepted tasks start at `todo`.
- To let an agent actually suggest a priority, `proposeItemToolDefinition` and `buildProposeItemPayload` in the sidecar need a `priority` property (deferred-items.md).

---
*Phase: 13-nothing-new-escapes-the-fence*
*Completed: 2026-10-14*

## Self-Check: PASSED

- FOUND: packages/core/tests/task_created_at_todo.rs, packages/core/tests/priority_is_opt_in.rs
- FOUND commits: f9fd945, 21c936c, c4c5b6b, 04c47c3 (`git rev-list --count 2748032..HEAD` = 4 before this file)
- NOT RUN: about 60 of 121 core test binaries (compiled only); disclosed under Verification.
