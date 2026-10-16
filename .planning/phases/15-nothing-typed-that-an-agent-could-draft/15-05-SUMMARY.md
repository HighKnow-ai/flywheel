---
phase: 15-nothing-typed-that-an-agent-could-draft
plan: 05
subsystem: ui
tags: [rust, rusqlite, react, tauri, react-query, git-ls-files, file-set, provenance]

requires:
  - phase: 15-nothing-typed-that-an-agent-could-draft
    provides: "15-02: the undeclared file-set answer, recorded as a task.file_set_declared event with a null after, stamped with the planner's actor"
  - phase: 09-parallel-fan-out
    provides: "declare_file_set_in_tx, approve_plan, the WavePlanSheet textarea and dispatchPlanEdit"
provides:
  - "query::file_set_provenance::file_set_provenance: who declared a task's file-set and whether an agent did, derived from events joined to actors, newest first, bounded"
  - "task_file_set_provenance and repo_tracked_paths Tauri commands plus taskFileSetProvenance and repoTrackedPaths adapter wrappers"
  - "A chip editor in WavePlanSheet with a one-per-row 'drafted by the planner' mark, an undeclared sentence, and git ls-files suggestions"
  - "The hand-typed textarea kept and never prefilled; chips and textarea share one edit(taskId, { entries }) write"
  - "An approve-region sentence naming approval as the file-sets' accept"
affects: [15-04, 15-06, wave-plan-sheet, drafting-engine]

actuals:
  tokens: 13500
  tasks: 3
  commits: 5
plan_head_before: adf12f4f09d77b1b5d68f7586ecadf0532df386e

tech-stack:
  added: []
  patterns:
    - "A derivable fact is a join on read, never a column (A-07): the planner mark is actors.type of the declaring event"
    - "One value, two editors, one write: the invariant is asserted by comparing the two editors' edit payloads"
    - "Native <datalist> for autocomplete instead of a combobox dependency"

key-files:
  created:
    - packages/core/src/query/file_set_provenance.rs
    - packages/core/tests/file_set_provenance.rs
    - packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx
  modified:
    - packages/core/src/query/mod.rs
    - packages/desktop/src-tauri/src/commands/file_set.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/dispatch/WavePlanSheet.tsx
    - packages/desktop/src/dispatch/dispatch.css
    - packages/desktop/src/dispatch/queries.ts
    - packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx

key-decisions:
  - "The Rust field is agent_drafted (wire name draftedByAgent), not drafted_by_agent: the plan's own acceptance grep for drafted_by returns nothing, and that grep would match the longer name"
  - "file_set_provenance returns Option: a task nobody declared has no provenance, so test 4's 'no fabricated human attribution' is a None, not a flag"
  - "Suggestions come from the project's repo_path (plan_repo_path), not the epic worktree, so a file created only on the epic branch is typed in full rather than suggested"
  - "A chip edit does not clear text typed in the textarea; only the textarea's own Save does"
  - "The tracked-path list is bounded at MAX_TRACKED_PATHS (5000) in the Tauri layer with a notShown count; the datalist shows at most 50 matches"

patterns-established:
  - "Provenance read: events JOIN actors on actor_id, ORDER BY id DESC, LIMIT declared once, one extra row to learn whether history was cut"
  - "Server state (provenance, tracked paths) is React Query; the add control's typed text is component state"

requirements-completed: [DRFT-01]

coverage:
  - id: D1
    description: "A file-set's provenance (agent versus human, undeclared versus empty) is derived from the declaring event's actor with no stored column"
    requirement: DRFT-01
    verification:
      - kind: integration
        ref: "packages/core/tests/file_set_provenance.rs (6 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Declared paths render as chips marked 'drafted by the planner' once per row, and a human-declared set is unmarked"
    requirement: DRFT-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx#draws one chip per stored entry in stored order and marks the row once when the planner declared it"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx#does not mark chips a human declared"
        status: pass
    human_judgment: true
    rationale: "Whether the mark reads as clearly the planner's on the real sheet is a visual judgment no assertion makes."
  - id: D3
    description: "The hand-typed textarea is retained, empty even with stored entries, and issues the same edit payload as the chips"
    requirement: DRFT-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx#renders the textarea empty even when the task has stored entries, asserted on the DOM value"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx#issues the same edit payload from the textarea as from adding the same two chips"
        status: pass
    human_judgment: false
  - id: D4
    description: "An undeclared set reads as words, not an empty row"
    requirement: DRFT-01
    verification:
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx#says in words that the planner could not determine an undeclared set"
        status: pass
    human_judgment: false
  - id: D5
    description: "git ls-files autocomplete, bounded with a stated not-shown count, using no libgit2"
    requirement: DRFT-01
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/file_set.rs#a_tracked_path_list_over_the_bound_is_cut_and_says_how_many_were_left_out"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx#fills the suggestion list from the tracked paths that match what was typed"
        status: pass
    human_judgment: false
  - id: D6
    description: "Plan approval is the file-sets' accept: it is named on screen, and proven to stage and re-attribute nothing"
    requirement: DRFT-01
    verification:
      - kind: integration
        ref: "packages/core/tests/file_set_provenance.rs#approving_a_plan_freezes_the_edges_but_stages_nothing_and_keeps_the_planners_attribution"
        status: pass
      - kind: unit
        ref: "packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx#names both effects in one sentence beside the approve control and offers no per-task accept"
        status: pass
    human_judgment: false

duration: 40min
completed: 2026-10-16
status: complete
---

# Phase 15 Plan 05: File-set chips and derived provenance Summary

**The wave plan sheet shows a task's declared files as chips with a single "drafted by the planner" mark derived in Rust from the declaring event's actor (no column), keeps the original textarea empty beside them, and names plan approval as the file-sets' accept.**

## Performance

- **Duration:** about 40 min
- **Completed:** 2026-10-16
- **Tasks:** 3
- **Files modified:** 11 (3 created)

## Accomplishments

- `file_set_provenance` joins `task.file_set_declared` and `task.file_set_widened` events to `actors.type`. It derives `agent_drafted` and `undeclared` on read, returns the older declarations as a history bounded by `FILE_SET_HISTORY_LIMIT` (20) with a truncation flag, and returns `None` for a task nobody declared. The migration count stays 24 and no stored column exists.
- Two read-only Tauri commands, `task_file_set_provenance` (task id only) and `repo_tracked_paths` (plan id only; `git ls-files` through `git::tracked_files`, bounded at 5000 with `notShown`), registered additively in `main.rs` alongside the existing file-set commands.
- `WavePlanSheet` gains a `FileSetChips` component: chips in stored order, remove controls, an add control with native `<datalist>` suggestions, the planner mark once per row, and an undeclared sentence. The textarea and Save files stay, start empty, and are labelled as the by-hand route that replaces the set.
- Chip add, chip remove and the textarea all go through `edit(taskId, { entries })`; the core's refusal text is shown verbatim and the renderer holds no entry-form logic.
- The footer carries one sentence: approval accepts the declared file-sets and freezes the colliding paths. No per-task accept control was added.

## Task Commits

1. **Task 1 RED: provenance tests** - `0a893a4c` (test)
2. **Task 1 GREEN: provenance read** - `a430dae7` (feat)
3. **Task 2 RED: chip editor and approve-sentence tests** - `7b12ab3a` (test)
4. **Task 2 GREEN, plus Task 3's on-screen sentence: commands, adapter, chips, CSS** - `93ae1782` (feat)
5. **Task 3: approval stages nothing** - `0b198649` (test)

## Files Created/Modified

- `packages/core/src/query/file_set_provenance.rs` - the derived provenance read
- `packages/core/tests/file_set_provenance.rs` - six provenance tests plus the approval-stages-nothing test
- `packages/desktop/src-tauri/src/commands/file_set.rs` - the two commands, their DTOs and tests
- `packages/desktop/src/dispatch/WavePlanSheet.tsx` - `FileSetChips`, unprefilled textarea, approve sentence
- `packages/desktop/src/dispatch/__tests__/file-set-chips.test.tsx` - eleven component tests
- `packages/desktop/src/adapters/tauri.ts`, `queries.ts`, `dispatch.css`, `main.rs`, `query/mod.rs` - additive wiring

## Decisions Made

See `key-decisions`. The one that affects a later reader: suggestions are built from the project's `repo_path`, not the epic worktree, so a file that exists only on the epic branch is not offered.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's own checks contradict on the name `drafted_by_agent`**
- **Found during:** Task 1
- **Issue:** The plan names a derived field `drafted_by_agent` while its acceptance criteria and verify require `grep -rn 'drafted_by' packages/core/src packages/desktop/src-tauri/src` to return nothing. The longer name matches that grep.
- **Fix:** The Rust field is `agent_drafted`; the wire name stays `draftedByAgent` through an explicit serde rename, which is what the renderer and the tests use. The intent (no stored column) is also asserted by a test that scans `src` for the column name.
- **Files modified:** `packages/core/src/query/file_set_provenance.rs`, `packages/desktop/src-tauri/src/commands/file_set.rs`
- **Commit:** `a430dae7`, `93ae1782`

**2. [Rule 1 - Bug] Two existing tests asserted the prefilled textarea**
- **Found during:** Task 2
- **Issue:** `wave-plan-sheet.test.tsx` expected `Files for FLY-2` to hold the stored entries, which D-20 reverses.
- **Fix:** Both assertions now check the chips for the stored set and the textarea for an empty value. The test file also mocks the two new reads.
- **Commit:** `93ae1782`

**3. [Rule 2 - Missing critical] `file_set_provenance` returns `Option`**
- The plan's signature returned the struct directly, but Test 4 requires "no provenance rather than a fabricated attribution". An `Option` is how a task nobody declared is told apart from one a human did.

### Process notes

- **Task 3 was not driven test-first on its own.** Its on-screen sentence and its frontend tests were written RED in Task 2's commit (`7b12ab3a`) and made green in `93ae1782`. Its remaining deliverable, the Rust test that approval stages nothing, pins behaviour `approve_plan` already had, so it passed on first run. It is a characterisation test, not a RED/GREEN pair.
- **The Tauri-side tests added to `commands/file_set.rs` (bound, wire shape, handler-signature) were written alongside the implementation**, not seen to fail first.
- RED evidence was not persisted through `gsd_run check tdd-red-evidence`; the failing runs were observed on their own assertions (4 of 6 provenance tests, 10 of 11 component tests) and committed as `test(15-05)` before any implementation.

**Total deviations:** 3 auto-fixed (2 bug, 1 missing-critical), plus the process notes above.
**Impact on plan:** No scope change; the renaming keeps the plan's own verification gate meaningful.

## Issues Encountered

None blocking. `cargo check --workspace` reports one dead-code warning in `commands/agent_run.rs` (`StartRunOutcome`), which predates this plan and was left alone.

## Known Stubs

None. The suggestion list is empty until `repo_tracked_paths` resolves; that is the stated behaviour (test 8), not a placeholder.

## Threat Flags

None. The two new commands each take a single id, resolve the repository server-side, and read only; `git ls-files` lists tracked files and `git2` is in no manifest.

## Next Phase Readiness

- 15-04's live measurement can now score the two surface clauses it marked `not-measured`: the planner mark (derived) and the unprefilled textarea.
- 15-06 edits `query/mod.rs`, `main.rs` and `adapters/tauri.ts`; this plan only added one line, two lines and one block respectively, so those files merge additively.

## Self-Check: PASSED

Created files exist (`file_set_provenance.rs`, both test files). All five commits are present (`0a893a4c`, `a430dae7`, `7b12ab3a`, `93ae1782`, `0b198649`). `cargo test -p core --test file_set_provenance --test dispatch_plan --test file_set_overlap --test epic_context_packet` pass, the `desktop` file-set unit tests pass, the full vitest suite passes (101 files, 1715 tests), `tsc --noEmit` is clean, `cargo check --workspace` has no errors, the migration count is 24, `drafted_by` appears in neither source tree, and `monaco`, `xyflow` and `git2` are absent from every manifest.
