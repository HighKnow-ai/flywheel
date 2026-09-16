---
phase: 03-nothing-lost-nothing-left-running
plan: 15
subsystem: infra
tags: [rust, tauri, security, path-traversal, panic-safety, ulid, sidecar]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: session_log.rs (D-34's durable JSONL writer), sidecar.rs's readiness handshake (G-02-1)
provides:
  - session_log_path as the single fail-closed join site for every run id -> filesystem path resolution
  - a shared, delegated run-id shape predicate (is_ulid) used by both the IPC boundary and the sidecar-stdout boundary
  - a panic-free, unit-tested bounded stderr-tail appender for the startup readiness handshake
affects: [agent_run, session_log, sidecar, security]

# Actuals (#2632)
actuals:
  tokens: 4221
  tasks: 2
  commits: 3

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guard at the one join site, not at every caller — session_log_path is now the sole place a run id becomes a path, so every reader/writer inherits the guard by construction."
    - "One shared shape predicate (flywheel_core::ids::is_ulid), delegated to from every boundary-specific wrapper (sidecar.rs's is_plausible_run_id), rather than re-implemented per boundary."
    - "A cut that must never panic in a non-unwinding frame walks backward to the nearest str::is_char_boundary instead of truncating at a raw byte index."

key-files:
  created: []
  modified:
    - packages/core/src/session_log.rs
    - packages/core/tests/session_log_window.rs
    - packages/desktop/src-tauri/src/commands/agent_run.rs
    - packages/desktop/src-tauri/src/sidecar.rs

key-decisions:
  - "The guard for agent_run_id lives in session_log_path itself (the single join site), not in agent_run_log_window/agent_run_raw_window individually — a per-command guard would have missed the SessionLogWriter::open write path entirely."
  - "is_plausible_run_id was reduced to a one-line delegation to flywheel_core::ids::is_ulid, deliberately tightening the accepted shape (Crockford base32 excludes I/L/O/U) since every real run id is minted by new_id()."
  - "push_bounded_stderr_tail was extracted as a named function specifically so the panic-inducing case could be unit-tested without spawning a process or entering a tokio runtime."

requirements-completed: [PROC-03]

coverage:
  - id: D1
    description: "session_log_path refuses a non-ULID agent_run_id before sessions_dir() is ever resolved, closing the arbitrary-file-read/write primitive in agent_run_log_window/agent_run_raw_window (T-03-15-01/02)."
    requirement: PROC-03
    verification:
      - kind: unit
        ref: "packages/core/tests/session_log_window.rs#session_log_path_rejects_every_implausible_shape_and_accepts_a_real_ulid"
        status: pass
      - kind: unit
        ref: "packages/core/tests/session_log_window.rs#count_lines_and_read_window_return_err_for_every_rejected_id"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::agent_run_log_window_rejects_a_run_id_that_is_not_ulid_shaped"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/commands/agent_run.rs#tests::agent_run_raw_window_rejects_a_run_id_that_is_not_ulid_shaped"
        status: pass
    human_judgment: false
  - id: D2
    description: "is_plausible_run_id (sidecar.rs) delegates to the single shared flywheel_core::ids::is_ulid predicate instead of a divergent hand-rolled shape check (T-03-15-03)."
    requirement: PROC-03
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#persist_tests::a_run_id_that_is_not_a_plausible_ulid_is_rejected_before_any_path_is_built"
        status: pass
    human_judgment: false
  - id: D3
    description: "push_bounded_stderr_tail cuts the readiness handshake's stderr tail on a UTF-8 character boundary instead of panicking (T-03-15-04), so a multi-byte or invalid-UTF-8 stderr burst can never abort the app during startup."
    requirement: PROC-04
    verification:
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#stderr_tail_tests::stderr_tail_invalid_utf8_positioned_to_straddle_the_cap_never_panics"
        status: pass
      - kind: unit
        ref: "packages/desktop/src-tauri/src/sidecar.rs#stderr_tail_tests::stderr_tail_multi_byte_characters_overrunning_the_cap_stay_valid_utf8_with_no_partial_char"
        status: pass
      - kind: unit
        ref: "cargo test -p desktop stderr_tail"
        status: pass
    human_judgment: false

# Metrics
duration: 16min
completed: 2026-09-16
status: complete
---

# Phase 3 Plan 15: Close the unvalidated-path-join and non-unwinding-panic gap findings Summary

**`session_log_path` becomes the fail-closed join site guarded by a shared `is_ulid` predicate, and the startup readiness handshake's stderr tail now cuts on a UTF-8 character boundary instead of panicking.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-16T04:57:00Z
- **Completed:** 2026-09-16T05:13:00Z
- **Tasks:** 2 completed
- **Files modified:** 4

## Accomplishments
- `session_log_path` (packages/core/src/session_log.rs) refuses any `agent_run_id` that is not a 26-character Crockford-base32 ULID (`flywheel_core::ids::is_ulid`) BEFORE `sessions_dir()` is ever resolved — closing an arbitrary-file-read/write primitive reachable from `agent_run_log_window`/`agent_run_raw_window` via any Tauri `invoke`, and covering the `SessionLogWriter::open` write path too since all three funnel through the same function.
- `sidecar.rs`'s `is_plausible_run_id` is now a one-line delegation to `flywheel_core::ids::is_ulid` — the previous hand-rolled "26 ASCII alphanumeric characters" check is gone, so the sidecar-stdout boundary and the IPC boundary can never drift into disagreeing about what a valid run id is.
- The startup readiness handshake's stderr tail is accumulated by a new, unit-tested `push_bounded_stderr_tail` function that walks backward to the nearest `str::is_char_boundary` before truncating, replacing a raw-byte-index `String::truncate` that panicked whenever a multi-byte or invalid-UTF-8 stderr burst straddled the 4096-byte cap — fatal in this exact frame because it runs inside a non-unwinding `tauri::async_runtime::block_on` under a `panic = "abort"` release profile.
- `READINESS_STDERR_TAIL_CAP` is unchanged at 4096 bytes both before and after this plan — only where the cut lands changed, never how much is retained.

## Task Commits

Each task was committed atomically (Task 2 followed RED -> GREEN since it carries `tdd="true"`):

1. **Task 1: One predicate, one join site** - `74426e6` (fix)
2. **Task 2 RED: failing test proving the stderr-tail truncation panics on a non-boundary cut** - `21cf306` (test)
3. **Task 2 GREEN: cut the startup stderr tail on a UTF-8 character boundary** - `8a5e3ba` (feat)

_Task 2 produced no separate REFACTOR commit — the GREEN implementation needed no further cleanup._

## Files Created/Modified
- `packages/core/src/session_log.rs` - `session_log_path` gained the `is_ulid` guard as its first statement, with an extended doc comment naming it the module's fail-closed join site.
- `packages/core/tests/session_log_window.rs` - Two new tests: `session_log_path` rejects every implausible shape and accepts a real ULID; `count_lines`/`read_window` return `Err` (never the "missing file returns zero" path) for every rejected id.
- `packages/desktop/src-tauri/src/commands/agent_run.rs` - Two new tests proving `agent_run_log_window`/`agent_run_raw_window` reject a traversal-shaped `agent_run_id`, plus a comment above `agent_run_log_window` recording that the guard lives in `session_log_path` and must not be re-implemented here.
- `packages/desktop/src-tauri/src/sidecar.rs` - `is_plausible_run_id` reduced to a delegation to `flywheel_core::ids::is_ulid`; the existing `a_run_id_that_is_not_a_plausible_ulid_is_rejected_before_any_path_is_built` test made strict (asserts `session_log_path` returns `Err`, not merely "path doesn't exist yet") plus a new traversal-shaped candidate; `push_bounded_stderr_tail` extracted with a `stderr_tail_tests` module covering all five `<behavior>` cases from the plan.

## Decisions Made
- The guard belongs in `session_log_path`, the ONE function in the workspace that turns a run id into a path — not in either IPC command individually. This makes the property structural rather than a convention a future call site could forget.
- `is_plausible_run_id`'s delegation to `is_ulid` tightens the accepted shape (Crockford base32 excludes I, L, O, U). Verified safe: every run id in this codebase is minted by `flywheel_core::ids::new_id()`, confirmed by grepping every `session_log_path`/`SessionLogWriter::open`/`count_lines`/`read_window` call site in the workspace (see "Existing call sites" below).
- `push_bounded_stderr_tail` was extracted as a standalone, doc-commented function specifically so its panic-inducing edge case could be exercised with a plain unit test, with no process spawn and no tokio runtime required.

## Existing Call Site Audit (plan's own required check)

Grepped every `session_log_path`/`SessionLogWriter::open`/`session_log::count_lines`/`session_log::read_window`/`append_event_line` call site in the workspace before finishing Task 1. Every production call site passes a value freshly minted by `flywheel_core::ids::new_id()`:
- `packages/core/src/domain/agent_run.rs:113` — `session_log_path(&run_id)` where `run_id = new_id()` two lines above.
- `packages/desktop/src-tauri/src/sidecar.rs`'s `persist_event_line` — already guarded by `is_plausible_run_id` before ever reaching `SessionLogWriter::open`.
- All test-only call sites (`packages/core/tests/session_log_window.rs`, `packages/core/tests/agent_tracer.rs`, `packages/desktop/src-tauri/src/sidecar.rs`'s `persist_tests`) use `new_id()`/`fresh_run_id()` per test.

**No existing call site was found passing a non-ULID id into any session-log function.** No call-site fix was required beyond the new guard itself.

## `is_plausible_run_id`'s new body

```rust
pub(crate) fn is_plausible_run_id(run_id: &str) -> bool {
    flywheel_core::ids::is_ulid(run_id)
}
```

## `READINESS_STDERR_TAIL_CAP` before and after

Unchanged in both cases:
```rust
const READINESS_STDERR_TAIL_CAP: usize = 4096;
```

## Deviations from Plan

None - plan executed exactly as written. The plan's own Task 1 action text left the choice of "where exactly to add the behavior-proving tests" slightly open (the `<read_first>`/`<action>` named `session_log_window.rs` only as read-first context, not as an explicit edit target beyond what was already declared in `files_modified`); this executor added the `session_log_path`/`count_lines`/`read_window` behavior tests directly to `packages/core/tests/session_log_window.rs` since that file was already declared in the plan's own `files_modified` list and the plan's `<behavior>` block explicitly named those five cases as required proof.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Requirements

- **PROC-03** marked complete — no other plan in this phase declares it, so it was ready immediately.
- **PROC-04** remains open in REQUIREMENTS.md's traceability table — `03-10-PLAN.md` and `03-17-PLAN.md` also declare it, and `03-17` (a sibling gap-closure plan scheduled after this one in the same wave) has not yet produced its own SUMMARY.md. Per the shared-ID gate (#2388), PROC-04 will be marked complete automatically once the last plan declaring it finishes.

## Next Phase Readiness
- Both Critical blockers from `03-VERIFICATION.md`'s anti-patterns table (the unvalidated path join and the reachable non-unwinding panic) are closed and covered by unit tests.
- Sibling gap-closure plans 03-16, 03-17, 03-18 (frontend-only files, per this plan's own parallel-sibling note) are unaffected — this plan touched no file outside its declared `files_modified`.
- No blockers for phase verification re-run.

## Self-Check: PASSED

- `packages/core/src/session_log.rs` — FOUND, contains `is_ulid` guard.
- `packages/core/tests/session_log_window.rs` — FOUND, contains new tests.
- `packages/desktop/src-tauri/src/commands/agent_run.rs` — FOUND, contains new tests + comment.
- `packages/desktop/src-tauri/src/sidecar.rs` — FOUND, contains delegation + `push_bounded_stderr_tail` + `stderr_tail_tests`.
- Commit `74426e6` — FOUND in `git log --oneline --all`.
- Commit `21cf306` — FOUND in `git log --oneline --all`.
- Commit `8a5e3ba` — FOUND in `git log --oneline --all`.
- `cargo build --workspace` — exits 0.
- `cargo test --workspace` — exits 0, every `test result:` line reads `ok`.
- `cargo test -p desktop rejects_a_run_id_that_is_not_ulid_shaped` — reports `2 passed`.
- `cargo test -p desktop stderr_tail` — reports 5 passed.
- `grep -c 'is_ulid' packages/core/src/session_log.rs` — 1 (>= 1 required).
- `grep -c 'is_ulid' packages/desktop/src-tauri/src/sidecar.rs` — 1 (>= 1 required).
- `grep -c 'is_char_boundary' packages/desktop/src-tauri/src/sidecar.rs` — 2 (>= 1 required).
- `grep -c 'push_bounded_stderr_tail' packages/desktop/src-tauri/src/sidecar.rs` — 10 (>= 3 required).

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-16*
