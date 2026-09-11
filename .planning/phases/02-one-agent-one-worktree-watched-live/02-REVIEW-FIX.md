---
phase: 02-one-agent-one-worktree-watched-live
fixed_at: 2026-09-11T05:39:19Z
review_path: .planning/phases/02-one-agent-one-worktree-watched-live/02-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-09-11T05:39:19Z
**Source review:** .planning/phases/02-one-agent-one-worktree-watched-live/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (CR-01 Critical, WR-01 Warning)
- Fixed: 2
- Skipped: 0
- Out of scope (left open, per fix_scope_detail): IN-01 — not attempted, documented below

**Verification note:** All edits were made and committed directly on the main working tree
(branch `cymarechal-devoteam/gsd-new-project-ade`), per this run's explicit instruction to skip
worktree isolation. The four required gates below were run from that same tree, so the numbers
are reproducible from the tree the reader is looking at right now.

## Fixed Issues

### CR-01: `agent_run_stop` held the application's single DB mutex for up to 30 seconds while waiting on an unresponsive sidecar

**Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`, `packages/core/tests/agent_run_stop_ordering.rs` (new)
**Commit:** `e0f532c`
**Applied fix:** Moved the sidecar interrupt call ahead of `state.db.lock()` in `agent_run_stop`.
The interrupt's `Result<(), String>` is now resolved into a local (`interrupt_result`) before the
lock is ever acquired, then handed into `stop_agent_run_recording_first` via a `move || interrupt_result`
closure — preserving that function's exact signature, its "capture the result in a local, never
propagate with `?`" contract, and both of its existing regression tests
(`stop_records_interrupted_even_when_the_sidecar_never_acks`,
`stop_twice_with_a_dead_sidecar_appends_exactly_one_interrupted_event`), which still pass
unmodified. D-35's "interrupt, then force" ordering is preserved — only the lock acquisition moved
later. Updated the doc comment on `agent_run_stop` to describe the new ordering and name why the
interrupt must precede the lock (so a future refactor does not silently re-invert it), and added a
new source-scanning regression gate, `packages/core/tests/agent_run_stop_ordering.rs`, modeled on
the existing `app_exit_ordering.rs` idiom: it reads the real `agent_run.rs` source from disk,
strips whole-line comments, and asserts the first non-comment `interrupt_run` call appears before
the first non-comment `.lock()` call inside `agent_run_stop`'s body — with a second test proving
the gate is falsifiable against a deliberately reordered fixture.

### WR-01: `delete_task`'s blocked-deletion message could read as self-contradictory when only `triggers`/`worktrees`/`permission_requests` rows exist with zero `agent_runs`

**Files modified:** `packages/core/src/domain/task.rs`
**Commit:** `f1743a1`
**Applied fix:** The blocking-deletion message in `delete_task` now names whichever count is
actually nonzero, in the same trigger/worktree/agent_run/permission_request priority order the
gate above checks — `it has {N} recorded agent run(s)` when `agent_run_count > 0`, `a worktree
has been created for it` when only `worktree_count > 0`, `a trigger has been recorded for it` when
only `trigger_count > 0`, and `a permission request has been recorded for it` as the final
fallback. D-40's block-never-cascade semantics are unchanged — this is a wording-only fix. Kept
`task_delete_with_run_history.rs`'s existing assertions intact and passing: the full-history test's
`message.contains(&agent_run_count_before.to_string())` check still holds (the `agent_run_count > 0`
branch is unchanged in shape), and `no_task_delete_error_ever_contains_a_raw_sqlite_constraint_message`
still passes since no SQLite constraint text is ever surfaced.

## Out of Scope

### IN-01: `stop_agent_run_recording_first` surfaces a generic `rusqlite` "no rows" error for an invented `agent_run_id`

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:274-301`
**Status:** Left open — Info-tier, explicitly out of scope per this run's `fix_scope_detail`
(only CR-01 and WR-01 were in scope; IN-01 was called out to leave open). No changes made for this
finding.

## Verification

All four required gates were run after both fixes were applied and committed, in the main working
tree (no worktree isolation, per this run's instructions):

- `cargo build --workspace` — exit 0, no warnings related to the changes.
- `cargo test --workspace` — 0 failures across every test binary (unit tests, `agent_run_stop_ordering.rs`,
  `task_delete_with_run_history.rs`, and every pre-existing suite).
- `npm --prefix packages/desktop test` — 28 test files / 297 tests passing (matches the pre-fix baseline exactly).
- `npm --prefix packages/sidecar test` — 28 pass / 0 fail (matches the pre-fix baseline exactly).

No regressions observed. Both fixes required only the two files each names above; no other source
was touched.

---

_Fixed: 2026-09-11T05:39:19Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
