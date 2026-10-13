---
phase: 04-clear-is-free
reviewed: 2026-09-23T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/core/src/domain/agent_run.rs
  - packages/core/tests/discard_lifecycle.rs
  - packages/core/tests/start_pin_ordering.rs
  - packages/core/tests/termination_atomicity_call_site.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
---

# Phase 04: Code Review Report (Incremental — 04-15/04-16 gap closure)

**Reviewed:** 2026-09-23T00:00:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

This is an incremental pass over only what changed since the prior `04-REVIEW.md` (commit
`4ca3e82`): plan 04-15 (CTX-01, Stop/Discard termination atomicity) and plan 04-16 (CTX-06,
criteria-revision pin ordering). Both fixes were traced against their stated invariants and
verified empirically, not just read for plausibility:

- **CTX-01 (termination atomicity):** `interrupt_agent_run_in_tx` was extracted as a
  `&Transaction` sibling of `interrupt_agent_run`, exactly mirroring `close_agent_run_in_tx`'s
  existing shape. The new `stop_agent_run_in_tx` (desktop crate) composes it with the
  presence-checked fallback-summary insert on one `&Transaction`, and
  `stop_agent_run_recording_first` now opens exactly one `conn.transaction()` around both writes.
  Ran the full `discard_lifecycle.rs`, `termination_atomicity_call_site.rs`, and the desktop
  crate's own rollback unit test — all pass, and manual tracing confirms a crash/rollback between
  the two writes now leaves the run untouched (`running`, no `ended_at`, zero terminal events, zero
  summary rows) rather than the old two-transaction shape's partial-commit gap.
- **CTX-06 (pin ordering):** `start_agent_run_recording_first` now resolves `previous_run_id` via
  `latest_run_id_for_task` strictly before calling `start_agent_run`'s insert, and threads that
  value into `packet_extras_for` (which no longer re-derives "the task's latest run" itself). Ran
  `start_pin_ordering.rs` plus the three new desktop-crate behavioral tests
  (`criteria_revision_moved_reaches_the_prompt_and_the_event_log_when_a_run_actually_starts`,
  `a_first_run_has_no_predecessor_so_the_revision_detector_stays_silent`,
  `the_preview_and_the_started_run_carry_the_same_drift_warnings`) — all pass, confirming the
  self-comparison bug (comparing a run's pin against itself) is closed and a task's first run stays
  silent.

`cargo test` for all five touched/added test files and the desktop crate's `commands::agent_run`
module passes (52 tests total across the three `core` test binaries plus the desktop unit tests).
`cargo clippy` surfaces exactly one new warning introduced by this diff, reported below; no other
new clippy or compiler warnings appear in the changed regions.

One quality issue found; no correctness or security defects found in the changed code.

## Warnings

### WR-01: `StartRunOutcome` carries three fields that are constructed but never read

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:483-490`
**Issue:** The extraction of `start_agent_run_recording_first` introduced
`pub(crate) struct StartRunOutcome { run_id, actor_id, worktree_id, worktree_path, prompt,
drift_event_count }`. Only `run_id`, `worktree_path`, and `prompt` are ever read back at the call
site (`agent_run_start`, lines 645-693) or in any test. `actor_id`, `worktree_id`, and
`drift_event_count` are populated on every call (lines 591-598) and then never consumed anywhere
in the crate. `cargo check` confirms this with a live compiler warning:

```
warning: fields `actor_id`, `worktree_id`, and `drift_event_count` are never read
   --> packages/desktop/src-tauri/src/commands/agent_run.rs:485:9
```

This is not a correctness bug (the values are still correctly computed and — for `actor_id` and
`worktree_id` — used internally within `start_agent_run_recording_first` itself before being
duplicated onto the outcome struct), but it is dead weight that will keep emitting a warning on
every build, and it signals to a future reader that these fields are load-bearing for a caller
when none currently exists. If a `-D warnings` CI gate is ever added, this specific warning would
break the build.

**Fix:** Either wire these fields to their evident intended callers (e.g. emit `drift_event_count`
in a log line or a future telemetry event, and use `outcome.actor_id`/`outcome.worktree_id` instead
of re-deriving them from `run` inside the function if they're needed later), or drop the unused
fields from the struct until an actual caller needs them:

```rust
pub(crate) struct StartRunOutcome {
    pub run_id: String,
    pub worktree_path: String,
    pub prompt: String,
}
```

## Info

### IN-01: Structural gate tests assume single-line call sites

**File:** `packages/core/tests/start_pin_ordering.rs:64-79` (`predecessor_and_insert_indices`,
`packet_extras_call_threads_previous_run_id`)
**Issue:** `packet_extras_call_threads_previous_run_id` checks whether the same source line that
contains `packet_extras_for(` also contains the substring `previous_run_id`. If a future rustfmt
pass or refactor wraps that call across multiple lines (rustfmt does this once a line exceeds its
configured width), the gate would report a false negative — the call could still correctly thread
`previous_run_id` as an argument two lines down, but the test would read it as absent and fail (or,
worse in the inverse direction, a would-be violation on a wrapped call could be missed if the
wrapped continuation line happens to contain unrelated text matching the substring). This mirrors
the same single-line assumption already present in this repo's other structural gates
(`session_closed_call_site.rs`, `agent_run_stop_ordering.rs`), so it is consistent with established
house style rather than a novel weakness — noted for awareness, not as something this diff should
have done differently.
**Fix:** No action required now; if this gate ever produces a false failure after an unrelated
formatting change, consider matching on the argument list joined across the whole function region
rather than a single line, the same way `function_region` already scans multi-line bodies for other
properties in this file.

---

_Reviewed: 2026-09-23T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
