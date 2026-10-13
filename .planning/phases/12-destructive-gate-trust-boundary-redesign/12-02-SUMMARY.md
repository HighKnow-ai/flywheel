---
phase: 12-destructive-gate-trust-boundary-redesign
plan: 02
subsystem: security
tags: [destructive-gate, trust-boundary, git-hooks, rust, pre-push, core-hookspath]

requires:
  - phase: 12-destructive-gate-trust-boundary-redesign
    provides: "12-01's amended docs/destructive-gate-trust-boundary.md (Layer 3 spec, Named Residuals rows) and the destructive_gate_no_new_launcher_tokens.rs scope fence this plan must not trip"
provides:
  - "packages/core/src/git_hooks.rs: Layer 3 — git's own pre-push hook, installed once per registered project via core.hooksPath, fires inside the real already-resolved git process after every PATH search has already happened"
  - "register_project installs the pre-push hook after its transaction commits; a refusal or install failure is logged, never propagated as a registration failure"
  - "interception_layers_for: a total match over DestructiveCategory naming every interception layer covering each category, machine-checked against docs/destructive-gate-trust-boundary.md's own section headings"
affects: [12-03, 12-04, 12-05]

actuals:
  tokens: 14245
  tasks: 3
  commits: 4
plan_head_before: 56294a402af70c4083e46a827523f665260e463f

tech-stack:
  added: []
  patterns:
    - "A generated POSIX sh script with absolute baked paths (never a PATH search) as the git-native enforcement point, installed via core.hooksPath rather than per-worktree .git/hooks"
    - "Refuse-don't-displace install discipline: every pre-existing developer configuration (core.hooksPath, pre-push) is read first and the install declines rather than overwriting, with the decline itself a named, inspectable return value"

key-files:
  created:
    - packages/core/src/git_hooks.rs
    - packages/core/tests/git_hooks_pre_push.rs
    - packages/core/tests/destructive_gate_layer_coverage.rs
  modified:
    - packages/core/src/lib.rs
    - packages/core/src/domain/project.rs

key-decisions:
  - "Canonicalize the baked worktree root before writing it into the generated script (Task 1 deviation, carried forward unchanged): the territory check's $PWD string comparison silently mismatched any worktree path resolving through a symlink (macOS /var -> /private/var), which every tempfile::tempdir() scratch repo passes through."
  - "Give the chmod-step's two fs calls (inside install_pre_push_hook, between writing the hook file and setting its execute bit) the same 'pre-push gate install verification failed' prefix verify_install uses at the end of the function — both are the same failure class (a file that vanished after being written), and a caller should not have to distinguish which microsecond the race landed in."

patterns-established:
  - "Total match (no wildcard arm) as the compile-time enforcement for a coverage table: DestructiveCategory gaining a variant without a named layer fails to build, not just fails a test."

requirements-completed: [AGNT-07, BOARD-10]

coverage:
  - id: D1
    description: "A real git push origin --delete <branch> run from a Flywheel-managed worktree is refused before any ref reaches the remote, with the remote ref still present afterwards, with the shim directory absent from PATH"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#branch_deletion_push_is_refused_and_the_remote_ref_survives"
        status: pass
    human_judgment: false
  - id: D2
    description: "A real force-push (non-fast-forward update) run from a Flywheel-managed worktree is refused with the remote ref unchanged, with the shim directory absent from PATH"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#force_push_is_refused_and_the_remote_ref_is_unchanged"
        status: pass
    human_judgment: false
  - id: D3
    description: "An ordinary fast-forward git push, a git status and a git --version in the same hooked repository all exit 0 and raise no refusal"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#ordinary_fast_forward_push_succeeds_and_the_remote_ref_advances"
        status: pass
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#status_and_version_exit_zero_with_no_flywheel_refusal_text"
        status: pass
    human_judgment: false
  - id: D4
    description: "A push run from a path outside Flywheel's worktree root exits 0 — the developer's own terminal is never gated by this layer"
    requirement: AGNT-07
    verification:
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#branch_deletion_push_from_outside_the_worktree_root_is_not_gated"
        status: pass
    human_judgment: false
  - id: D5
    description: "A pre-existing non-Flywheel core.hooksPath or non-sample pre-push hook makes the install refuse (not displace), register_project still succeeds, and the refusal is a named returned value"
    requirement: BOARD-10
    verification:
      - kind: unit
        ref: "packages/core/tests/git_hooks_pre_push.rs#install_refuses_a_preexisting_non_flywheel_hooks_path_without_displacing_it"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_hooks_pre_push.rs#install_refuses_a_preexisting_non_sample_pre_push_without_displacing_it"
        status: pass
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#a_refusal_never_fails_registration"
        status: pass
      - kind: integration
        ref: "packages/core/tests/git_hooks_pre_push.rs#a_refusal_never_fails_registration_over_a_preexisting_pre_push"
        status: pass
    human_judgment: false
  - id: D6
    description: "uninstall_pre_push_hook returns the repository to its pre-install git configuration state, and never unsets a core.hooksPath it did not write"
    requirement: BOARD-10
    verification:
      - kind: unit
        ref: "packages/core/tests/git_hooks_pre_push.rs#uninstall_unsets_core_hooks_path_it_wrote_and_is_a_no_op_for_a_foreign_value"
        status: pass
    human_judgment: false
  - id: D7
    description: "Every DestructiveCategory variant maps to at least one named interception layer, in a total match a test asserts is total, with every layer name a real heading in docs/destructive-gate-trust-boundary.md"
    requirement: AGNT-07
    verification:
      - kind: unit
        ref: "packages/core/tests/destructive_gate_layer_coverage.rs#every_destructive_category_has_at_least_one_named_layer"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_gate_layer_coverage.rs#every_named_layer_is_a_real_section_heading_in_the_trust_boundary_doc"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_gate_layer_coverage.rs#the_table_is_not_degenerate_at_least_one_multi_layer_and_one_single_layer_category"
        status: pass
      - kind: unit
        ref: "packages/core/tests/destructive_gate_layer_coverage.rs#the_rendered_pre_push_script_names_exactly_the_categories_the_table_maps_to_it"
        status: pass
    human_judgment: false

duration: 27min
completed: 2026-10-01
status: complete
---

# Phase 12 Plan 2: Git-Native Pre-Push Gate (Layer 3) Summary

**A git `pre-push` hook, installed once per project via `core.hooksPath` and fed from git's own stdin ref-update protocol, refuses branch-deletion and force-push after every PATH search has already happened — closing the round-ten PATH-reorder bypass offline, proven against a real throwaway local bare remote.**

## Performance

- **Duration:** ~27 min (across a tracer feedback checkpoint)
- **Started:** 2026-10-01T08:30:27Z (Task 1 commit)
- **Completed:** 2026-10-01T08:57:28Z
- **Tasks:** 3
- **Files modified:** 5 (3 created, 2 modified)

## Accomplishments
- `packages/core/src/git_hooks.rs`: `hooks_dir_for_repo`, `pre_push_hook_script` (pure, POSIX `sh`, no bashisms), `PrePushInstall` (`Installed`/`RefusedPreexistingHooksPath`/`RefusedPreexistingPrePush`), `install_pre_push_hook`, `uninstall_pre_push_hook`, `interception_layers_for` (total match, no wildcard arm). Every git invocation routes through `crate::git::git_at` — the pre-existing single-`Command::new("git")` structural invariant still holds.
- `register_project` installs the hook after its transaction commits, alongside the existing marker-file write; a refusal or install failure is logged to stderr and never propagated as a registration failure.
- End-to-end proof against a real throwaway local bare remote (D-63): a branch-deletion push and a force-push are both refused with the remote ref unchanged, while an ordinary fast-forward push, `git status`, `git --version`, and a push from outside the worktree root all exit 0 — every assertion run with the shim directory absent from `PATH` and `FLYWHEEL_PERMISSION_SOCKET` removed from the child environment.
- Every way the install can decline (pre-existing `core.hooksPath`, pre-existing non-sample `pre-push`) is a named returned value, proven not to displace the developer's own configuration and not to fail `register_project`; `uninstall_pre_push_hook` is a real, tested reversal that never touches a configuration it did not write.
- `interception_layers_for`'s total coverage table is machine-checked: every `DestructiveCategory` has a named layer, every layer name is a real heading in `docs/destructive-gate-trust-boundary.md`, the table is not degenerate (both multi-layer and single-layer categories exist), and the rendered hook script's own text names exactly the categories the table claims for Layer 3.

## Task Commits

Each task was committed atomically:

1. **Task 1: End-to-end — a real branch-deletion push is refused by git's own hook, with no shim on PATH** — `b0fcae7` (feat) — committed by the originating agent before this continuation picked up at the tracer feedback checkpoint (human: "approved")
2. **Task 2: The install's failure modes — refusal over pre-existing configuration, and a working uninstall** — `70b073c` (test) — Task 1's commit had already shipped both refusal arms and three of the four required assertions; this commit adds the missing companion (`register_project` surviving the *pre-existing-`pre-push`* refusal arm specifically, not just the pre-existing-`core.hooksPath` arm)
3. **Task 3: The layer-coverage invariant — the generalized intent, encoded** — `5164fa6` (test) — `interception_layers_for` itself had already shipped in Task 1's commit (a natural single `match` written alongside the rest of the tracer); this commit adds the missing `destructive_gate_layer_coverage.rs` totality/honesty proof
4. **Fix (Task 1, surfaced by `cargo test --workspace`): flaky race-condition test** — `d2d78cb` (fix)

**Plan metadata:** (this commit)

## Files Created/Modified
- `packages/core/src/git_hooks.rs` - Layer 3: `pre_push_hook_script`, `install_pre_push_hook`, `uninstall_pre_push_hook`, `interception_layers_for`
- `packages/core/src/lib.rs` - `pub mod git_hooks;`
- `packages/core/src/domain/project.rs` - `register_project` calls `install_pre_push_hook` after its transaction commits
- `packages/core/tests/git_hooks_pre_push.rs` - end-to-end (real bare-remote pushes) and failure-mode tests, 15 `#[test]` fns
- `packages/core/tests/destructive_gate_layer_coverage.rs` - the totality/honesty invariant, 4 `#[test]` fns

## Decisions Made
- Carried forward Task 1's deviation unchanged: canonicalize the baked worktree root before writing it into the generated script, so the territory check's `$PWD` comparison survives macOS's `/var` -> `/private/var` symlink resolution.
- Gave the chmod step's two `fs` calls inside `install_pre_push_hook` the same `"pre-push gate install verification failed"` prefix the final `verify_install` call uses — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Flaky race-condition test under full-workspace parallel load**
- **Found during:** Task 3's own plan-level `<verification>` step — `cargo test --workspace` (run via the documented Keychain-skipping gate script)
- **Issue:** `install_fails_loudly_when_the_hook_file_is_removed_before_verification` (shipped in Task 1's commit) watches for the hook file to appear and deletes it "the instant it appears," assuming the subsequent `core.hooksPath` git-config write (step 5) would comfortably outlast the race. Under full-workspace parallel test load, the watcher could instead win the race against `install_pre_push_hook`'s own chmod step (reading the file back immediately after writing it, one step earlier than the final `verify_install` call), producing a differently-worded error (`"failed to read metadata for ..."`) that didn't carry the `"pre-push gate install verification failed"` prefix the test asserted.
- **Fix:** Gave the chmod step's two `fs::metadata`/`fs::set_permissions` calls the same `"pre-push gate install verification failed"` prefix `verify_install` uses — both failures are the same class (the file we just wrote is no longer trustworthy, T-12-07's DoS-of-the-control threat), so the error contract is now consistent regardless of which microsecond the race lands in.
- **Files modified:** `packages/core/src/git_hooks.rs`
- **Verification:** Repeated the single race test 5 times in isolation (all passed) plus a full `cargo test --workspace` pass (80 `test result: ok` blocks, 0 failures, exit 0)
- **Committed in:** `d2d78cb`

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** The fix hardens an existing error-reporting contract under contention; no behavior change to the install's success path or its refusal semantics. No scope creep — `packages/core/src/destructive.rs` and `packages/shim/src/main.rs` remain byte-identical to their pre-plan state (confirmed via `git diff --stat`).

## Issues Encountered

**Continuation context:** This execution resumed from a tracer feedback checkpoint (`gate="blocking-human"`) after Task 1's commit `b0fcae7`. The human approved Task 1's proven slice with no changes requested. On inspecting the codebase at resume, Task 1's commit was found to have already shipped Task 2's full test coverage (all four required assertions bar one) and Task 3's production code (`interception_layers_for`, written as a natural single `match` alongside the rest of the tracer) — ahead of the plan's own task boundaries, since the tracer task is explicitly production-quality, not a prototype. This execution's own work was therefore: (1) add the one missing Task 2 assertion (`register_project` surviving the pre-existing-`pre-push` refusal arm, as distinct from the pre-existing-`core.hooksPath` arm the existing test covered), (2) write Task 3's missing test file (`destructive_gate_layer_coverage.rs`) proving the already-shipped coverage table honest, and (3) fix the race-condition flake `cargo test --workspace` surfaced. No other issues.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Layer 3 is live: every newly registered project gets a `core.hooksPath`-installed `pre-push` gate, proven offline against a real bare remote, with the developer's own terminal and own hook configuration never displaced.
- `interception_layers_for`'s total match means plan 12-04 (the `--gate-push` human-in-the-loop branch) and any later plan touching `DestructiveCategory` will hit a compile error, not a silent gap, if a new category needs a layer named for it.
- `packages/shim/src/main.rs` and `packages/core/src/destructive.rs` are untouched — `destructive_gate_no_new_launcher_tokens.rs`'s baseline pin from 12-01 remains green.
- `cargo build --workspace` succeeds; `cargo test --workspace` (via the documented Keychain-test-skipping gate) passes clean, 0 failures.
- Plan 12-04 can wire the human-in-the-loop branch through the `FLYWHEEL_SHIM_BIN` path the generated script already bakes in but does not yet use.

---
*Phase: 12-destructive-gate-trust-boundary-redesign*
*Completed: 2026-10-01*

## Self-Check: PASSED

All created files confirmed present on disk: `packages/core/src/git_hooks.rs`,
`packages/core/tests/git_hooks_pre_push.rs`, `packages/core/tests/destructive_gate_layer_coverage.rs`.
All four commits confirmed in `git log`: `b0fcae7`, `70b073c`, `5164fa6`, `d2d78cb`.
`cargo test -p core --test git_hooks_pre_push` (15 tests), `cargo test -p core --test
destructive_gate_layer_coverage` (4 tests), `cargo test -p core --test supervisor_cwd` (5 tests),
`cargo test -p core --test destructive_gate_no_new_launcher_tokens` (2 tests), `cargo build
--workspace`, and the full `cargo test --workspace` (Keychain tests skipped per documented
environment note) all pass with 0 failures.
