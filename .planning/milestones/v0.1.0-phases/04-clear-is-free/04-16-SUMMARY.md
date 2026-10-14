---
phase: 04-clear-is-free
plan: 16
subsystem: agent-runtime
tags: [rust, rusqlite, drift-detection, tdd, gap-closure]

# Dependency graph
requires:
  - phase: 04-clear-is-free (plan 04-11)
    provides: "detect_criteria_revision and the criteria-revision pin mechanism (D-78) this plan wires correctly at the agent_run_start call site"
  - phase: 04-clear-is-free (plan 04-12)
    provides: "record_drift_warnings / the drift.detected event shape this plan's tests assert against"
  - phase: 04-clear-is-free (plan 04-15)
    provides: "stop_agent_run_recording_first's DB-only-half extraction precedent (start_agent_run_recording_first mirrors its shape and naming)"
provides:
  - "packet_extras_for(conn, packet, task_id, previous_run_id) — the pin comparison resolves the run that actually PRECEDED this one, never the run being started"
  - "start_agent_run_recording_first + StartRunOutcome — the DB-only half of agent_run_start, unit-testable against a bare &mut Connection"
  - "packages/core/tests/start_pin_ordering.rs — a structural gate proving the predecessor is resolved before the new run row is inserted"
affects: []

# Actuals (#2632)
actuals:
  tokens: 12238
  tasks: 2
  commits: 2

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "DB-only extraction precedent (04-15's stop_agent_run_recording_first) applied a second time: start_agent_run_recording_first carries every database-touching step, agent_run_start keeps only Tauri-/process-facing concerns (credential resolution, shim env merge, spawn request, board:changed emit)"
    - "source-structural ordering gate (session_closed_call_site.rs / agent_run_stop_ordering.rs / termination_atomicity_call_site.rs) applied a fourth time: start_pin_ordering.rs asserts a same-function statement ORDER over the real file on disk, with falsifiability companions proving the detector fires on a seeded violation"

key-files:
  created:
    - packages/core/tests/start_pin_ordering.rs
  modified:
    - packages/desktop/src-tauri/src/commands/agent_run.rs

key-decisions:
  - "packet_extras_for takes previous_run_id: Option<&str> as an explicit 4th parameter rather than an internal re-derivation — the caller (build_preview_dto for a preview, start_agent_run_recording_first for a real start) resolves the predecessor at the point in its own control flow where the answer is still correct, and the extras builder never queries agent_runs for 'the latest run' itself again."
  - "start_agent_run_recording_first's step ordering is documented as load-bearing in its own doc comment (step 1 — resolve previous_run_id — strictly before step 2 — start_agent_run's insert) and enforced by a structural gate (start_pin_ordering.rs), not just by convention."
  - "seeded_git_conn_with_task's fixture git calls route through flywheel_core::git::git_at rather than std::process::Command::new(\"git\") directly — a bare Command::new(\"git\") inside packages/desktop/src-tauri/src (even inside a #[cfg(test)] mod) trips packages/core/tests/supervisor_cwd.rs's PROC-02 gate, which scans that whole directory tree, test code included."

requirements-completed: [CTX-06]

coverage:
  - id: D1
    description: "packet_extras_for resolves the criteria-revision pin against the run that actually preceded this one (previous_run_id threaded by the caller, never re-derived internally)"
    requirement: "CTX-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#criteria_revision_moved_reaches_the_prompt_and_the_event_log_when_a_run_actually_starts"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#a_first_run_has_no_predecessor_so_the_revision_detector_stays_silent"
        status: pass
      - kind: integration
        ref: "packages/core/tests/start_pin_ordering.rs (7 tests, including 4 falsifiability companions)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The launch sheet preview and the run started from it carry identical drift sentences — a warning shown in the preview never silently disappears from the run's own prompt"
    requirement: "CTX-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#the_preview_and_the_started_run_carry_the_same_drift_warnings"
        status: pass
    human_judgment: false
  - id: D3
    description: "start_agent_run_recording_first (the DB-only half of agent_run_start, extracted for testability) — the preview's own no-write contract and the previously-shipped renderer-identity test still hold"
    requirement: "CTX-06"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#build_preview_dto_performs_no_insert_update_or_delete"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#the_previewed_prompt_and_the_started_runs_prompt_come_from_the_same_renderer"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-09-23
status: complete
---

# Phase 04 Plan 16: Criteria-Revision Pin Ordering Fix Summary

**`packet_extras_for` now takes an explicit `previous_run_id`, resolved by the caller before any new run row exists — closing gap #2 of `04-VERIFICATION.md`, where `agent_run_start`'s own re-derivation of "the task's latest run" resolved the brand-new, not-yet-pinned run instead of its predecessor and silently swallowed the `CriteriaRevisionMoved` warning.**

## Performance

- **Duration:** 45 min
- **Tasks:** 2
- **Files modified:** 1 modified, 1 created

## Accomplishments

- `packet_extras_for(conn, packet, task_id, previous_run_id: Option<&str>)`: the criteria-revision pin comparison now resolves against the CALLER-supplied predecessor id, never an internal re-query. The pin lookup's own D-78 doc comment is rewritten to state the new contract and name gap #2 explicitly.
- `build_preview_dto` resolves its own predecessor via `latest_run_id_for_task` — correct for a preview, since no new run row exists yet, so the task's latest run genuinely IS the predecessor.
- `start_agent_run_recording_first` (new `pub(crate) fn`) + `StartRunOutcome` (new `pub(crate) struct`): the DB-only half of `agent_run_start`, extracted so the fix is unit-testable against a bare `&mut Connection` with no `State<AppState>`/`AppHandle` — mirrors `stop_agent_run_recording_first`'s precedent from plan 04-15. Its own doc comment states, step by step, why resolving `previous_run_id` (step 1) must stay strictly before `start_agent_run`'s insert (step 2).
- `agent_run_start` rewritten to delegate its entire DB-only half to the extracted function, keeping only credential resolution, the shim env merge, the spawn request, and the `board:changed` emit.
- Three new tests drive the fix end-to-end through a real git-backed fixture (`seeded_git_conn_with_task`, the desktop-crate mirror of `packages/core/tests/common/mod.rs`'s `seeded_git_project`, routed through `flywheel_core::git::git_at` rather than a bare `Command::new("git")` so it stays inside `supervisor_cwd.rs`'s PROC-02 gate): `criteria_revision_moved_reaches_the_prompt_and_the_event_log_when_a_run_actually_starts`, `a_first_run_has_no_predecessor_so_the_revision_detector_stays_silent`, and `the_preview_and_the_started_run_carry_the_same_drift_warnings`.
- `packages/core/tests/start_pin_ordering.rs` (new, 320 lines, 7 tests): a source-structural gate over the real `agent_run.rs` on disk, following `termination_atomicity_call_site.rs`'s idiom (whole-line-comment stripping, signature-anchored regions, falsifiability companions). Three properties plus four falsifiability tests: the predecessor resolution appears strictly before the mutating insert; the extras-builder call threads the resolved id rather than the old 3-argument shape; and `packet_extras_for`'s own body never re-derives `latest_run_id_for_task` itself.

## Task Commits

Each task was committed atomically:

1. **Task 1: The pin comparison resolves the run that actually preceded this one** — `05b7900` (feat)
2. **Task 2: Preview and start must agree — the parity assertion and the ordering gate** — `cf439d2` (test)

**Plan metadata:** committed separately after this summary.

## Files Created/Modified

- `packages/desktop/src-tauri/src/commands/agent_run.rs` — `packet_extras_for` signature widened; `build_preview_dto` resolves its own predecessor; `start_agent_run_recording_first`/`StartRunOutcome` extracted; `agent_run_start` rewritten to delegate; 3 new tests + 2 new test helpers (`with_scratch_worktree_root`, `seeded_git_conn_with_task`)
- `packages/core/tests/start_pin_ordering.rs` (new) — the structural ordering gate, 7 tests

## Decisions Made

- `packet_extras_for` takes `previous_run_id: Option<&str>` as an explicit 4th parameter rather than an internal re-derivation — the caller resolves the predecessor at the point in its own control flow where the answer is still correct (before `agent_run_start`'s insert, or trivially for a preview that inserts nothing), and the extras builder never queries `agent_runs` for "the latest run" itself again.
- `start_agent_run_recording_first`'s ordering (resolve predecessor, THEN insert the new run) is documented as load-bearing in its own doc comment and additionally enforced by `start_pin_ordering.rs`'s structural gate, not left to convention alone.
- `seeded_git_conn_with_task`'s fixture git calls route through `flywheel_core::git::git_at` rather than `std::process::Command::new("git")` directly. A bare `Command::new("git")` inside `packages/desktop/src-tauri/src` — even inside a `#[cfg(test)] mod` — trips `packages/core/tests/supervisor_cwd.rs`'s PROC-02 gate (`every_git_command_construction_lives_in_git_rs`), which walks the whole `src` tree without excluding test modules. Found live: the first version of this helper used a bare `Command::new("git")`, which failed that gate on the first `cargo test -p core` run; switching to `git_at` fixed it without changing the helper's behavior.

## Deviations from Plan

None — plan executed exactly as written, including its RED-BEFORE-GREEN gate (Task 1) and its falsifiability observation (Task 2).

### RED Evidence (Task 1)

`start_agent_run_recording_first` and its two tests were landed FIRST against the extracted seam still wired with the pre-fix 3-argument `packet_extras_for(conn, &packet, task_id)` call (re-deriving the latest run internally, exactly as `agent_run_start` did before this plan). Running `criteria_revision_moved_reaches_the_prompt_and_the_event_log_when_a_run_actually_starts` against that pre-fix seam:

```
RED EVIDENCE (Task 1, temporary probe): has_warnings_heading=false drift_event_count=0
```

Run 2's own prompt carried no `## Warnings` heading, and the `drift.detected` count for `CriteriaRevisionMoved` was `0` — despite a real criteria revision having landed between run 1 and run 2. This is gap #2 reproduced directly: `packet_extras_for`, called after `start_agent_run`'s insert, resolved the brand-new run 2 itself as "the latest run," read its (still-NULL) `criteria_revision_pin`, and `detect_criteria_revision`'s early-return guard silently returned `None`.

`a_first_run_has_no_predecessor_so_the_revision_detector_stays_silent` was already GREEN against the same pre-fix seam — a genuine guard rather than a restatement of the bug, exactly as the task's own acceptance criteria required: a task's first-ever run has no prior run to re-derive incorrectly either way, so the pre-fix and post-fix code produce the same (correct) `None`.

The temporary probe (an `eprintln!` capturing both observed values) was written, run, its output captured above, then removed before the real fix (threading `previous_run_id` through `packet_extras_for`'s signature) landed. The committed test file never carried the probe.

### Falsifiability Observation (Task 2)

Per the task's own acceptance criteria, `start_agent_run_recording_first`'s predecessor resolution was temporarily moved back BELOW `start_agent_run`'s insert (a scratch backup taken first, restored afterward) and `cargo test -p core --test start_pin_ordering` re-run:

```
test the_predecessor_is_resolved_strictly_before_the_new_run_is_inserted ... FAILED
test result: FAILED. 6 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
```

The gate correctly went red on the reordered shape, and only that one property tripped — the other six (including the three falsifiability companions for the OTHER two properties) stayed green, confirming the gate's three properties are independently discriminating rather than accidentally coupled. The source file was restored byte-identical to the committed version before continuing (`git diff --stat` after restore showed the same 80-insertion diff as before the probe, with zero unexpected changes).

## Issues Encountered

None.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Gap #2 of `04-VERIFICATION.md` (CTX-06, roadmap Success Criterion 4) is closed: a run started after a criteria revision now carries the `CriteriaRevisionMoved` sentence in its own prompt and a matching `drift.detected` event, through the real `agent_run_start` path — not just the preview.
- The three other drift detectors (`ClaimedFilesMismatch`, `StaleSinceLastSummary`, the decision read-back pair) and `detect_criteria_revision` itself were not touched, per this plan's own scope discipline — the fix is entirely at the `agent_run_start`/`packet_extras_for` call site.
- `packages/desktop/src-tauri/src/commands/agent_run.rs` now composes plan 04-15's `stop_agent_run_in_tx`/`stop_agent_run_recording_first` (Stop/Discard termination) and this plan's `start_agent_run_recording_first` (Start Work) side by side, both following the same DB-only-extraction precedent — a consistent shape for any future terminal- or start-path fix in this file.
- Every pre-existing assertion in this file and in the named plan-level test binaries still passes (`cargo test -p desktop`: 33 passed, 0 failed; `cargo test -p core`: 0 failed; `npm --prefix packages/desktop run test`: 463 passed).

## Self-Check: PASSED

- `packages/core/tests/start_pin_ordering.rs` — FOUND
- Commit `05b7900` — FOUND in `git log --oneline --all`
- Commit `cf439d2` — FOUND in `git log --oneline --all`
- `cargo build --workspace` — succeeds, no `error[`/`error:` lines
- `cargo test -p desktop` — 33 passed, 0 failed
- `cargo test -p core` — 0 failed across every binary
- `cargo test -p core --test drift/criteria/criteria_pin/five_cycle_reconstitution/start_pin_ordering` — each 0 failed
- `npm --prefix packages/desktop run test` — 463 passed
- `grep -cF 'previous_run_id: Option<&str>' packages/desktop/src-tauri/src/commands/agent_run.rs` — 1
- `sed 's://.*::' packages/desktop/src-tauri/src/commands/agent_run.rs | grep -cF 'permissions::latest_run_id_for_task('` — 3 (`build_preview_dto`, `start_agent_run_recording_first`, and the pre-existing line 04-11 already shipped)
- `git diff --diff-filter=D --name-only` for both task commits — empty (no deletions)
- `git status --short` after both commits lists exactly the two `files_modified` paths as tracked/staged changes, plus the pre-existing untouched paths this plan was told to leave alone

---
*Phase: 04-clear-is-free*
*Completed: 2026-09-23*
