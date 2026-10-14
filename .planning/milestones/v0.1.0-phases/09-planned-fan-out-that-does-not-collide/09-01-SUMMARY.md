---
phase: 09-planned-fan-out-that-does-not-collide
plan: 01
subsystem: agent-runtime
tags: [scope-hook, file-set, pretooluse, tauri, rusqlite, shim, fail-closed]

requires:
  - phase: 05-socratic-epic-authoring
    provides: "the stage-gate hook and runtime marker pattern (stage-gate-hook.ts, write_authoring_stage) this plan mirrors"
  - phase: 03-supervision-and-destructive-gate
    provides: "the shim argv-mode precedent (--classify-invocation, --gate-push) and the fail-closed hook discipline"
provides:
  - "file_set.rs: the single D-148 matcher (FILE_SET_FORMS, parse_entry, covers) shared by the run-time hook and every future plan-time check"
  - "migration 0019: task_file_set_entries, dispatch_plans, dispatch_plan_tasks, dispatch_edges, idx_events_type_task"
  - "the per-run scope marker (armed or unarmed, written by Rust) and the shim --scope-check mode"
  - "scope-hook.ts: the fail-closed third PreToolUse entry, wired for execution runs"
  - "task_file_set_get / task_file_set_set: human-only commands that make a declared set reachable from the app"
affects: [09-02 detective backstop, 09-03 overlap and wave edges, 09-07 dispatcher, 09-08 widen path, 09-09 UI]

plan_head_before: a90dd23a7b29a4a93cd4528675fb66920c3ca9da

actuals:
  tokens: 49445
  tasks: 2
  commits: 3

tech-stack:
  added: []
  patterns:
    - "Arming is a fact Rust writes: an explicit unarmed marker, never an absent file; an absent, unreadable or unrecognised marker denies"
    - "One compiled containment predicate: the Node hook shells to the shim, which calls flywheel_core::file_set::covers"
    - "A PreToolUse hook must wrap its whole body so a throw exits 2; a bare main() exits 1 and the tool call proceeds"
    - "Resolve the longest existing path prefix with the OS and apply the non-existent tail lexically, so symlinks and .. cannot escape the worktree"

key-files:
  created:
    - packages/core/src/file_set.rs
    - packages/core/src/domain/file_set.rs
    - packages/core/src/db/migrations/0019_fan_out.sql
    - packages/sidecar/src/scope-hook.ts
    - packages/desktop/src-tauri/src/commands/file_set.rs
    - packages/core/tests/file_set_overlap.rs
    - packages/core/tests/scope_marker_contract.rs
    - packages/sidecar/test/scope-hook.test.mjs
    - packages/sidecar/test/scope-hook-live.test.mjs
  modified:
    - packages/core/src/runtime_protocol.rs
    - packages/shim/src/main.rs
    - packages/sidecar/src/claude-code-adapter.ts
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/core/tests/fixtures/shim-main-string-literals.baseline.txt

key-decisions:
  - "Two entry forms only (file, dir with a trailing slash); a dir never covers its own path or a sibling that shares its name as a prefix"
  - "parse_entry rejects with a named cause and never repairs; surrounding whitespace is refused rather than trimmed"
  - "The scope hook has no timeout field on its settings entry, because a timed-out PreToolUse hook does not block the call"
  - "A failed scope-marker write closes the freshly inserted run as failed before the start aborts, so no running row is left holding a dispatcher slot"
  - "case_insensitive is read from core.ignorecase at arm time; unset reads false, the stricter direction"
  - "The task-state CHECK list in 0019 is created now with the twelve states plan 09-03 names, so the dispatcher plans do not need a table rebuild"

patterns-established:
  - "Two-sided contract test: the Rust writer and the shipped Node reader each run for real, neither fabricates the other's state"
  - "Live-binary tests measure by observable file effect, carry a positive control, and skip visibly naming what was missing"

requirements-completed: [PLAN-04]

coverage:
  - id: D1
    description: "A write outside a task's declared file-set is refused at the tool call by the shipped hook against the Rust-written marker"
    requirement: PLAN-04
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_marker_contract.rs#an_armed_run_is_refused_outside_its_set_and_allowed_inside_it"
        status: pass
      - kind: integration
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#the_real_run_start_writes_an_armed_marker_and_the_shipped_hook_enforces_it"
        status: pass
      - kind: e2e
        ref: "packages/sidecar/test/scope-hook-live.test.mjs (installed claude 2.1.285, four permission modes)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A task with no declared file-set gets an unarmed marker and launches exactly as before this phase"
    requirement: PLAN-04
    verification:
      - kind: integration
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#the_real_run_start_for_a_task_with_no_declared_set_writes_an_unarmed_marker"
        status: pass
      - kind: integration
        ref: "packages/core/tests/scope_marker_contract.rs#a_task_with_no_declared_entries_is_unarmed_and_every_write_in_its_worktree_is_allowed"
        status: pass
    human_judgment: false
  - id: D3
    description: "The hook denies when any precondition is missing or wrong, and when its own body throws"
    requirement: PLAN-04
    verification:
      - kind: integration
        ref: "packages/core/tests/scope_marker_contract.rs#the_hook_denies_when_any_precondition_is_missing_or_wrong"
        status: pass
      - kind: unit
        ref: "packages/sidecar/test/scope-hook.test.mjs (throw, uncaughtException, unhandledRejection and stringify-failure cases)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The D-148 two-form vocabulary: parse_entry rejects rather than repairs, covers is exact at the directory boundary, the migration CHECK mirrors the Rust constant"
    requirement: PLAN-04
    verification:
      - kind: unit
        ref: "packages/core/tests/file_set_overlap.rs (29 tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A declared set can be set, read and cleared from the app by a human-only command with a named refusal for every invalid entry"
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/file_set.rs tests (10 tests)"
        status: pass
    human_judgment: false

duration: 52min
completed: 2026-10-09
status: complete
---

# Phase 9 Plan 01: Declared File-Set Enforced at the Tool Call Summary

**A task's declared file-set is enforced at the file-writing tools: migration 0019, a single `file_set` matcher, a Rust-written armed/unarmed scope marker, a shim `--scope-check` mode and a fail-closed `PreToolUse` hook, measured against the installed `claude` in all four permission modes.**

## Performance

- **Duration:** 52 min
- **Started:** 2026-10-09T09:21:46Z
- **Completed:** 2026-10-09T10:14:35Z
- **Tasks:** 2 (a tracer and a TDD task)
- **Files modified:** 22

## What the guarantee is, and what it is not

**Preventive for the file-writing tools only; detective for `Bash`.** The hook matches `Write|Edit|MultiEdit|NotebookEdit`. A write made through `Bash` (`echo >`, `sed -i`, an installer touching a lockfile) never reaches this hook. That gap is structural to the matcher and is transferred to plan 09-02's session-close backstop, which reads git rather than the marker, so it is independent of an agent rewriting its own marker (T-09-01-05, accepted). ROADMAP criterion 3's preventive half is demonstrable here for the file tools; it is not demonstrated for `Bash`, and nothing in this plan's artifacts should be read as saying it is.

## Observed outcome of the sub-agent propagation case

Measured live against `claude 2.1.285 (Claude Code)` on 2026-10-09 (`packages/sidecar/test/scope-hook-live.test.mjs`, `--model haiku`):

| Case | Declared file written | Undeclared write | Scope denial in the stream |
|------|----------------------|------------------|----------------------------|
| `acceptEdits` | yes (positive control) | attempted, file absent | 1 |
| `default` | no (headless, no approver) | attempted, file absent | 1 |
| `plan` | no (plan mode never edits) | attempted, file absent | 1 |
| `bypassPermissions` | yes (positive control) | attempted, file absent | 1 |
| sub-agent via the `Task` tool, `bypassPermissions` | n/a | delegated write attempted, file absent | 1 |

- **A9 holds:** `deny` plus exit 2 blocks the write under `default` and `plan` as well as the two modes research measured, because the hook fires before the permission check.
- **A3 holds for the `Task` case:** the sub-agent's `Write` was refused by the same hook and the undeclared file never appeared. The test pins that observation, so a CLI that stops propagating hooks to sub-agents fails loudly.
- **Not observed:** A6 (headless runs writing memory or plan files outside the worktree and inflating the denial count). These runs were two short turns each; no such write appeared, but that is absence in a small sample, not a measurement.

## Accomplishments

- One compiled containment predicate (`file_set::covers`) reached by the hook through the shim; the shim contains exactly one call to it and no second derivation.
- Arming is a fact: `arm_run_scope` is the tenth step of `start_agent_run_recording_first`, writing `armed` or an explicit `unarmed` marker, and a write failure aborts the start.
- A hook that cannot be fooled by its own crash: five failure paths (throw in `main`, `uncaughtException`, `unhandledRejection`, a stringify failure, a bad payload) all print a deny body and exit 2.
- Symlink and `..` escapes read as outside the worktree: the longest existing prefix is canonicalised by the OS, the non-existent tail is applied lexically, and a dangling symlink denies.
- `task_file_set_set` rejects rather than repairs, caps at 200, takes no actor and no path, and stores nothing when any entry is refused.

## Task Commits

1. **Task 1: end-to-end "this write is outside my lane"** - `cecd323` (feat, tracer)
2. **Task 2 RED: failing tests for the file-set commands** - `48a6a55` (test)
3. **Task 2 GREEN: commands, registration, live measurement** - `edb56e5` (feat)

**Plan metadata:** the `docs(09-01)` commit following this file.

## Files Created/Modified

- `packages/core/src/file_set.rs` - `FILE_SET_FORMS`, `FileSetEntry`, `EntryRefusal`, `parse_entry`, `covers`, `entry_form`, `entry_path`
- `packages/core/src/domain/file_set.rs` - `declare_file_set(_in_tx)`, `list_entries_for_task`, `arm_scope_marker`, `EVENT_FILE_SET_DECLARED`
- `packages/core/src/db/migrations/0019_fan_out.sql` - the four tables and `idx_events_type_task`
- `packages/core/src/runtime_protocol.rs` - `ScopeMarker`, `ScopeMode`, `write_scope_marker`, `read_scope_marker(_at)`, scope cleanup in `clear_run_runtime_files`
- `packages/shim/src/main.rs` - `--scope-check`, `run_scope_check`, `resolve_scope_target`
- `packages/sidecar/src/scope-hook.ts` - the fail-closed hook
- `packages/sidecar/src/claude-code-adapter.ts` - `SCOPE_GATE_MATCHER`, `scopeHookScriptPath`, `includeScopeGate`
- `packages/desktop/src-tauri/src/commands/file_set.rs` - the two commands; `agent_run.rs` - `arm_run_scope`
- Tests: `file_set_overlap.rs`, `scope_marker_contract.rs`, `scope-hook.test.mjs`, `scope-hook-live.test.mjs`, extended `execution-hook-settings.test.mjs`

## Decisions Made

See `key-decisions` above. One worth restating: the hook has no `timeout` field, because a timed-out `PreToolUse` hook does not block the call; its work is bounded by being one synchronous shim spawn with no socket, poll or sleep.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `scope_marker_contract.rs` cannot call `start_agent_run_recording_first`**
- **Found during:** Task 1
- **Issue:** the plan has `cargo test -p core --test scope_marker_contract` drive the real `start_agent_run_recording_first`, but that function is `pub(crate)` in the desktop crate, which depends on core, so a core integration test cannot call it.
- **Fix:** the arming body lives in core (`domain::file_set::arm_scope_marker`) so the core contract test drives the same function the run-start path calls; `arm_run_scope` in `agent_run.rs` is a thin wrapper. The core file also holds a source-structural gate (the call sits after the worktree read, before the return, and its error is propagated; exactly one call site). The desktop crate's own test module drives the REAL `start_agent_run_recording_first` and then runs the shipped hook against the marker it wrote (four tests). Neither half fabricates the other.
- **Files modified:** `packages/core/src/domain/file_set.rs`, `packages/core/tests/scope_marker_contract.rs`, `packages/desktop/src-tauri/src/commands/agent_run.rs`
- **Committed in:** `cecd323`

**2. [Rule 3 - Blocking] The shim string-literal baseline gate failed**
- **Found during:** Task 1 (full core suite)
- **Issue:** `destructive_gate_no_new_launcher_tokens` pins every string literal in `packages/shim/src/main.rs`; the new argv mode adds twelve.
- **Fix:** baseline regenerated from the extractor's own diff (pure additions: the flag, four error messages and the `entries`, `relative`, `outsideWorktree`, `unarmed` keys among them). None is a launcher or wrapper recognition token and the classifier is untouched. One literal was avoided by dropping a separator rewrite (the shim is unix-only). Justified in the commit message as the gate requires.
- **Files modified:** `packages/core/tests/fixtures/shim-main-string-literals.baseline.txt`
- **Committed in:** `cecd323`

**3. [Rule 1 - Bug] An existing test asserted the old execution-run settings shape**
- **Found during:** Task 1 (sidecar suite)
- **Issue:** `authoring-stage-gate.test.mjs` asserted an execution run writes exactly one `PreToolUse` entry; it now writes two by design.
- **Fix:** the test now asserts the Bash entry byte-identical to before, the scope entry, and still no authoring stage-gate entry.
- **Committed in:** `cecd323`

**4. [Rule 2 - Missing critical] A failed arm left a `running` run behind**
- **Found during:** Task 1
- **Issue:** step 10 runs after the run row is committed, so aborting the start on a marker-write failure would have left a `running` row with no session, holding a dispatcher slot (plan 09-07 counts running runs) and making the task look worked-on.
- **Fix:** the run is closed `failed` before the error propagates; a desktop test asserts no running or blocked run remains.
- **Committed in:** `cecd323`

**5. [Rule 3 - Blocking] Existing run-start tests would have written markers into the real app-data directory**
- **Found during:** Task 1
- **Issue:** `with_scratch_worktree_root` did not isolate `FLYWHEEL_RUNTIME_DIR`.
- **Fix:** the helper now sets a scratch runtime directory too.
- **Committed in:** `cecd323`

---

**Total deviations:** 5 auto-fixed (1 bug, 1 missing critical, 3 blocking). **Impact on plan:** all necessary for correctness or to keep existing gates green; no scope creep.

### Process notes

- The executor's agent-branch allow-list on the pre-commit assertion was not applied: the orchestrator directed a sequential run on the named branch `cymarechal-devoteam/gsd-new-project-ade`. The protected-branch check passed.
- The live test spends real money (about $0.04 per turn); it ran twice in full (once inside `npm test`, once explicitly to capture the per-mode lines). Later suite runs used `FLYWHEEL_REAL_CLAUDE_BIN=/nonexistent/claude`, which skips every live case visibly.

## Authentication Gates

None.

## Issues Encountered

- `cargo test -p core` hangs on `tests/credentials.rs` (macOS keychain prompts, 60+ seconds per test). Pre-existing and unrelated; that binary and the two `forge_live_*` binaries were excluded from the full-suite run. Everything else in `packages/core` passed after the baseline fix (87 of 88 binaries on the first pass, the 88th after it).
- Not run as part of this plan: `credentials`, `forge_live_chain`, `forge_live_github`.

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: argv-path-read | packages/shim/src/main.rs | `--scope-check` reads a marker file at a caller-supplied path and prints its entry list. It grants no capability the caller lacks (the shim runs with the caller's own file permissions and only parses JSON), but it is a new way for any process that can exec the shim to read a marker. |

## Next Phase Readiness

- Plan 09-02 owns the `Bash` residual (the detective backstop) and the `scope_denied` notice and event plumbing; the hook currently refuses and returns, it does not yet raise a board event.
- Plan 09-03 adds `overlaps`/`collisions` beside `covers` in `file_set.rs` and the dispatcher's pure half; the task-state CHECK list it expects is already in migration 0019.
- The widen path (D-152) re-calls `arm_scope_marker` over the same run id; the contract test already proves a rewritten marker takes effect on the next call with no restart.

## Self-Check: PASSED

All nine created files and the three task commits (`cecd323`, `48a6a55`, `edb56e5`) were verified present. The RED commit (`test(09-01)`) precedes the GREEN commit (`feat(09-01)`) for Task 2. Every `<automated>` verify command in both tasks was re-run and passes; the live arm passed on its first full run. Stub scan found none.

---
*Phase: 09-planned-fan-out-that-does-not-collide*
*Completed: 2026-10-09*
