---
phase: 09-planned-fan-out-that-does-not-collide
plan: 08
subsystem: dispatcher
tags: [planning-run, submit-plan, mcp, held-call, file-set, waves, scope-gate, sidecar, tauri, rusqlite]

requires:
  - phase: 09-planned-fan-out-that-does-not-collide
    provides: "09-03 create_draft_plan_in_tx, replace_plan_tasks_in_tx, normalise_waves, edges_for_plan, approve_plan, the one-live-plan-per-epic index; 09-01 parse_entry, declare_file_set_in_tx, the scope marker; 09-07 occupied_slots, the dispatcher command module, the lazy-cut-then-worktree sequence"
provides:
  - "submit_plan: a held MCP call whose authority is checked in Rust (resolve_planning_run) and whose validation vocabulary is parse_entry"
  - "store_submitted_plan: one transaction for the plan row, task rows, waves, declared entries, exclusions and event"
  - "dispatch_exec::begin_planning_run: refusals, lazy integration-branch cut, epic worktree, run row, armed-empty scope marker, rendered prompt"
  - "render_planning_prompt: deterministic briefing over the epic's task roster"
  - "dispatch_plan_generate: the human-only command that starts the pass"
affects: [09-09 UI (a Generate action, the draft review sheet, the skipped-with-reason rows), 11 ship-it drain (D-REV-35)]

plan_head_before: fb62a3b41c023d6f0053de1330fe1380829fe4ea

actuals:
  tokens: 29600
  tasks: 2
  commits: 4

tech-stack:
  added: []
  patterns:
    - "A held MCP call answered through the existing authoring_proposal_answer op: no new answering surface; a refusal resolves as an isError result so the agent corrects it in the same conversation"
    - "Authority is a database read of the run's shape (epic-scoped, no task, no stage, running), never the tool list"
    - "The plan row is created by the first valid submission, so an abandoned pass leaves nothing and the unique index is the only guard on a second plan"
    - "Run state recorded last inside the run's transaction (the G-05-8(b) ordering), via an injected closure so the failure is testable"

key-files:
  created:
    - packages/sidecar/test/submit-plan-wire.test.mjs
  modified:
    - packages/sidecar/src/mcp-permission-server.ts
    - packages/sidecar/src/adapter.ts
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/sidecar/src/index.ts
    - packages/sidecar/test/fake-claude.mjs
    - packages/core/src/domain/dispatch_plan.rs
    - packages/core/src/dispatch_exec.rs
    - packages/core/src/epic_context_packet.rs
    - packages/core/src/merge.rs
    - packages/core/tests/dispatch_plan.rs
    - packages/desktop/src-tauri/src/sidecar.rs
    - packages/desktop/src-tauri/src/commands/dispatch.rs
    - packages/desktop/src-tauri/src/commands/authoring.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - .planning/DEFERRED-REVIEW.md

key-decisions:
  - "The draft plan row is created by the first valid submission, not when the run starts. store_submitted_plan therefore takes the planning run id and returns the plan id (the plan sketched a plan_id parameter). This is what makes 'a second submission is refused by the one-live-plan-per-epic index' literally true, and it means a refused or abandoned pass leaves no row to clean up."
  - "A planning run is identified by shape: epic-scoped, task null, authoring_stage null. No run-kind column was added. The existing authoring lookups filter on a non-null stage, so it is invisible to them; a desktop test calls the real find_running_authoring_run to prove it."
  - "The run's recorded state is an ARMED scope marker over an EMPTY set. The scope hook denies a write when no entry covers it, so the file-writing tools are refused (Bash is not, same as every run). Writing the marker is the thing that can fail, and a failure aborts the start."
  - "The planning launch pre-approves submit_plan and nothing else, not report_summary or propose_item either. Anything else the agent reaches for blocks as a permission request instead of running."
  - "A task the agent excludes, or never mentions, is stored in the draft as skipped with a reason, in the last wave. A draft rewrite keeps a skipped task skipped (replace_plan_tasks_in_tx now carries the existing state forward)."

patterns-established:
  - "begin_planning_run / begin_planning_run_with: the injected record_state closure is how a run-start failure is forced in a test"

requirements-completed: [PLAN-01]

coverage:
  - id: D1
    description: "A planning run's valid submission lands as one draft plan with each task's file-set, a wave, a rationale and the run recorded; nothing is approved, no edge is computed, nothing spawns"
    requirement: PLAN-01
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs#a_valid_submission_from_a_running_planning_run_stores_one_draft_plan, #a_run_started_this_way_can_submit_and_the_draft_references_it"
        status: pass
    human_judgment: false
  - id: D2
    description: "Authority is the Rust-side check: an execution run, an authoring run, an unknown run and a planning run that is no longer running are refused although the tool is listed to all of them"
    requirement: PLAN-01
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs#an_execution_run_is_refused_by_the_authority_check_not_by_the_tool_list, #a_planning_run_that_is_no_longer_running_is_refused"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#submit_plan_tests (4 tests)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every mechanical error (zero tasks, empty list, foreign key, glob, duplicate, wave 0, started task, oversize) is refused with a named cause, stores nothing, and reaches the agent in the same call"
    requirement: PLAN-01
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs (nine refusal tests); packages/sidecar/test/submit-plan-wire.test.mjs#a refusal comes back to the agent as a correctable error result"
        status: pass
    human_judgment: false
  - id: D4
    description: "The held call is answered: a run whose submit_plan callback is not wired fails the wire test (mutation-checked)"
    requirement: PLAN-01
    verification:
      - kind: integration
        ref: "packages/sidecar/test/submit-plan-wire.test.mjs#a held submit_plan call reaches the Rust-side callback and is answered"
        status: pass
    human_judgment: false
  - id: D5
    description: "Equal sets are accepted and approval orders exactly one edge; waves 7,1,3 store as 3,1,2; same-wave ties store in ascending task id; an unnamed task is stored skipped with a reason; a forced mid-transaction failure leaves nothing"
    requirement: PLAN-01
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs (two_tasks_submitted_with_identical_file_lists_*, waves_with_gaps_*, same_wave_tasks_*, a_task_of_the_epic_absent_*, a_failure_part_way_through_storing_*)"
        status: pass
    human_judgment: false
  - id: D6
    description: "Starting the pass: refusals before any run, lazy integration-branch cut, work in the epic worktree, empty armed scope, no run on a state-write failure, slot held and never refused by the cap, worktree clean after"
    requirement: PLAN-01
    verification:
      - kind: integration
        ref: "packages/core/tests/dispatch_plan.rs (generating_a_plan_*, a_fresh_epic_*, the_run_works_in_*, the_run_is_armed_*, a_run_that_cannot_record_*, generating_while_a_live_plan_*, a_second_planning_run_*, the_planning_run_holds_a_slot_*, the_epic_worktree_has_no_uncommitted_entries_*)"
        status: pass
    human_judgment: false
  - id: D7
    description: "A real claude session started by the pass completes headlessly without stalling on a permission prompt"
    requirement: PLAN-01
    verification:
      - kind: manual
        ref: ".planning/DEFERRED-REVIEW.md#D-REV-35"
        status: deferred
    human_judgment: true
    rationale: "Needs a live claude login and the packaged sidecar. Queued as D-REV-35 (automatable PARTLY)."

duration: ~2h
completed: 2026-10-09
status: complete
---

# Phase 9 Plan 08: The Pre-Dispatch Planning Pass Summary

**`submit_plan` is a held call whose authority is a database read in Rust and whose errors come back to the agent in the same call; `dispatch_plan_generate` starts a short read-only run in the epic integration worktree that attaches a file-set and a wave to each task and stops at a draft.**

## Did the read-only planning run complete headlessly without stalling on a permission prompt?

**Not established. It was not run against a real `claude`.** Research called this supported but not conclusive, and nothing in this plan changes that. What was shown:

- The launch argv carries exactly one `--allowedTools` value, `submit_plan` (asserted on `buildClaudeArgv` and, through the real spawn, on the argv the fake backend received).
- The held call is answered end to end through the real socket by a fake backend, for both a success and a refusal.
- The run records an armed, empty scope, so the file-writing tools are refused by the scope hook.

What was not shown: that the installed CLI, in `default` permission mode, lets its own read tools run without a prompt; that the model stays inside the one pre-approved tool; that it follows the prompt's two entry forms without a correction round. If it blocks, the failure is loud and harmless (a pending permission request holding one slot, nothing written, no plan stored). Queued as **D-REV-35** with the cheap automatable half named (run the real binary once with the exact planning argv and assert no permission request arrives).

## Accomplishments

- **Sidecar.** `submit_plan` registered beside `propose_item`, held in the `pending` map and answered through the existing `answerProposalStaged`, so the Rust core needs no second answering op. A refusal resolves as an `isError` result rather than a protocol failure. `onPlanSubmitted` defaults to a no-op like `onProposal`, and is wired in `startSession`; the wire test fails without it (mutation-checked by removing the callback invocation: the two held-call tests time out and the other four still pass).
- **Authority.** `resolve_planning_run` is the check. The server lists the tool to every run; the control is that the run must be epic-scoped with no task and no stage and be `running`. A desktop test and a core test both drive an execution run, an authoring run and a finished run against it.
- **Validation.** One vocabulary: every entry goes through `parse_entry` and its named cause is the text the agent reads. Also refused by name: zero tasks, an empty list (naming the key), a key outside the epic, a duplicate key, wave below 1, a task that is not backlog/todo, an exclusion with no reason, an oversize list.
- **Storage.** `store_submitted_plan` writes the plan row, declared entries, task rows and one `dispatch_plan.drafted` event in one transaction. Waves are normalised, same-wave tasks are stored in rank-then-id order, and every backlog/todo task of the epic that the agent did not place is stored `skipped` with its reason (or an explicit "gave no reason" line). No edge is computed; approval is still a separate human act.
- **The pass.** `begin_planning_run` refuses first (live plan, planning run already running, nothing to plan), cuts the integration branch through `ensure_epic_integration_branch`, ensures the epic worktree, inserts the run and renders the prompt. `dispatch_plan_generate` resolves the credential before any run exists, launches through the ordinary gated spawn path with `planning: true`, and closes the run as failed if the shim env or the spawn fails rather than leaving it `running` and holding a slot.
- **The prompt.** `render_planning_prompt` is pure and byte-identical across renders. It names every task with key, title and criteria, the two entry forms with examples, that globs are rejected, manifests and lockfiles for any task adding a dependency, a wave per task, and a reason for every task left out. Tasks already past `todo` are listed as context only.

## Task Commits

1. **Task 1 RED:** `cd2b8d4` (test)
2. **Task 1 GREEN:** `f5919ba` (feat)
3. **Task 2 RED:** `38e7c23` (test)
4. **Task 2 GREEN:** `1f8dae9` (feat)

**Plan metadata:** the `docs(09-08)` commit following this file.

## TDD Gate Compliance

`git log --oneline --grep="^test(09-08)"`:

```
38e7c23 test(09-08): add failing tests for the pre-dispatch planning pass
cd2b8d4 test(09-08): add failing tests for submit_plan as a held call with Rust-side authority
```

Each task has its own RED commit, ahead of its GREEN. The RED commits carry type definitions and stub function bodies so the tests compile and fail on their assertions (Task 1: 14 of 43 core tests and 6 of 6 sidecar tests failed; Task 2: 13 core tests and both new desktop tests failed). Honest limits:

- **One test was not red.** `a_failure_part_way_through_storing_leaves_no_plan_no_plan_task_and_no_entry` passed against the stub, because a stub that stores nothing also leaves nothing. It earns its keep only against the real code, where the forced `RAISE(ABORT)` fires after the plan row and the declared entries are written. It was not mutation-checked by moving the writes out of the transaction.
- **Four desktop tests in `sidecar.rs#submit_plan_tests` were written with GREEN**, not before it. They cover glue over core functions that were red-tested first.
- The `check tdd-red-evidence` record was not produced; RED evidence is the failing-test counts above.

## Deviations from Plan

**1. [Design] The plan row is created at submission, not at run start.**
The plan's text says both that the draft plan references the run from the start and that a second submission is refused by the one-live-plan-per-epic index. Those cannot both hold: if the draft exists at start, a second submission is a replace, which no index refuses. The index reading was taken. `store_submitted_plan(conn, planning_run_id, epic_id, ...)` replaces the sketched `plan_id` parameter and returns the new plan id; the run's authority is its shape rather than "the planning run of a live plan". Consequence for 09-09: between Generate and the first valid submission there is a running planning run but no plan row; the UI should show the run, not an empty plan.

**2. [Process] The start sequence lives in `core::dispatch_exec`, so one grep gate is not literally met.**
The plan's gate counts `ensure_epic_integration_branch` in `commands/dispatch.rs`; it appears there 0 times because `begin_planning_run` calls it in core, as 09-07 did for the merge. The gate's stated intent (the precondition is satisfied, not merely checked) is covered by `a_fresh_epic_gets_its_integration_branch_through_the_lazy_cut_path`. The other source gates pass (`handle_inbound_submit_plan` = 2, `parse_entry` >= 1, `dispatch_plan_generate` in `main.rs` = 1).

**3. [Rule 2 - Missing critical] Refusals the plan did not list.**
Duplicate key, wave below 1, a non-backlog/todo task, an exclusion without a reason, input size bounds (500 tasks, 200 entries, 1024 characters), a second concurrent planning run, an epic with nothing to plan, and closing a run that was recorded but could not be launched. All are tested except the launch-failure close, which is covered only by reading.

**4. [Rule 1 - Bug prevented] A draft rewrite would have un-skipped excluded tasks.**
`replace_plan_tasks_in_tx` wrote every task back as `planned`, so the first wave edit in the review sheet would have quietly reinstated a task the pass excluded. It now carries each task's existing state forward.

**5. [Rule 1 - Bug, caught by the suite] A blanket `pkill` in my first test file killed other files' fake backends.**
Three unrelated sidecar tests failed in the full run (concurrent held calls, stubborn stop, unknown-run interrupt) because `node --test` runs files in parallel and my `after()` hook killed every `fake-claude.mjs`. It now kills only the sessions this file started. Full suite after: 275 of 275. (`permission.test.mjs` has the same blanket `pkill`; not touched.)

**6. [Process] Small, deliberate edits outside the listed files.**
`commands/authoring.rs`: `find_running_authoring_run` is now `pub(crate)` so a test can prove the planning run is invisible to the real lookup. `merge.rs`: `epic_worktree_path` extracted so the merge and the planning run cannot disagree about where the integration worktree is. `.planning/DEFERRED-REVIEW.md`: D-REV-35. `index.ts`: the `spawn` op passes `planning` through. `dispatch_plan.rs` tests: the new worktree/runtime tests reuse the file's existing `WORKTREE_ROOT_ENV_LOCK`, because a second lock let them race the existing occupancy test.

**7. [Naming] `SUBMIT_PLAN_TOOL_NAME` is the fully-qualified name** (`mcp__flywheel-permissions__submit_plan`), as the plan listed it; the raw name is `SUBMIT_PLAN_RAW_TOOL_NAME`. The file's other tools use the reverse convention for the one pair.

**Total deviations:** 7 (1 design, 1 gate, 2 Rule 1, 1 Rule 2, 2 process). **Impact:** none on the plan's goal; deviation 1 changes one UI-facing fact for 09-09.

## What the guarantee is, and what it is not

- **Fresh is not correct.** The pass reads the repository now, so the declared sets are not stale. It does not make them right: a model can miss a file, and a wrong set silently voids the parallelism guarantee for that task. That is why the draft gets one human look before anything spawns, and why nothing here approves it.
- **Read-only is the file tools, not the machine.** The empty armed scope denies Write/Edit/MultiEdit/NotebookEdit. A `Bash` write is neither pre-approved nor scope-gated: in `default` mode it raises a permission request and does not run unless the user allows it. The cleanliness of the integration worktree after the run is asserted in a test that exercises the shape (nothing wrote), not an adversarial run; the production guard is 09-07's named dirty-integration-worktree cause at the first merge.
- **A task with no declared set** still has nothing to compare against and is excluded by nothing but the merge-conflict path; submitting requires a non-empty list precisely so the pass never produces one.
- **The pass is one-shot per live plan.** After a plan is approved, running, or aborted-but-not-final, generating is refused; there is no re-plan.

## Authentication Gates

None.

## Issues Encountered

- `cargo test --workspace` was not run in full (the core suite exceeds the time budget here and `credentials` / `forge_live_*` hang on keychain prompts or the network, as recorded in 09-01 to 09-07). Run instead and passing: `dispatch_plan` (55), `dispatch_auto_merge` (26), `dispatch_cap` (8), `dispatch_limit_gate` (32), `epic_context_packet` (16), `epic_roster` (12), `authoring_lifecycle` (12), `review_merge` (37), `scope_widen` (11), `runtime_protocol` (20), the desktop crate (90 incl. 6 new), `cargo build --workspace` (the one pre-existing `StartRunOutcome` dead-code warning), and `npm --prefix packages/sidecar test` (275 of 275).
- `npx tsc --noEmit` for the desktop frontend was not run: no renderer file changed.
- `packages/desktop/src-tauri/gen/schemas/capabilities.json` is tracked but git-ignored and was not regenerated.

## Known Stubs

None. There is no renderer surface for Generate or for the draft review sheet yet; that is plan 09-09's, stated here as a dependency, not a placeholder.

## Threat Flags

None beyond the plan's register. T-09-08-01 (authority in Rust, tested against execution, authoring, unknown and finished runs), -02 (`parse_entry` for every entry, named cause returned in the same call), -03 (one transaction, forced-failure test), -04 (unnamed tasks stored skipped with a reason), -05 (empty armed scope, only `submit_plan` pre-approved; cleanliness asserted, see above), -06 (callback wired, mutation-checked wire test), -07 (the pass reads the integration tip at dispatch time; the authoring proposal payload shape is untouched), -08 (every key resolved against the run's own epic).

## Next Phase Readiness

- 09-09 needs a Generate action calling `dispatch_plan_generate`, a way to show "planning in progress" from the run (no plan row yet), and a review sheet that renders `skipped` rows with their reasons from `DispatchTaskDto.rationale`.
- The retry/skip gap 09-07 recorded (no command for `failed`, `stopped`, `conflict`, `held_by_limit` tasks) is still open.

## Self-Check: PASSED

Created file present: `packages/sidecar/test/submit-plan-wire.test.mjs`. Commits `cd2b8d4`, `f5919ba`, `38e7c23`, `1f8dae9` are in `git log`, each RED before its GREEN. `git rev-list --count fb62a3b..HEAD` = 4 at the time of writing. Every `<automated>` verify command was run except `cargo test --workspace` in full (see Issues Encountered); the four source gates were run and three pass literally, one by intent (deviation 2).
