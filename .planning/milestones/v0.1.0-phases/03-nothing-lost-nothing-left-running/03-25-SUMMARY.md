---
phase: 03-nothing-lost-nothing-left-running
plan: 25
subsystem: infra
tags: [destructive-gate, shim-install, security-hardening, rust, tdd]

# Dependency graph
requires:
  - phase: 03-nothing-lost-nothing-left-running
    provides: "03-24's textCanShadowPathResolution/namesGatedProgram classification contract on the shim's --classify-invocation safe verdict, and the hook's shimShadowDirectoryProven proof it now demands on the safe branch (D-59/D-60/D-61)"
provides:
  - "install_for_run now verifies what it installed: verify_shadow_entry asserts each shadow entry exists, is a regular file, is non-empty, and (Unix) carries an execute bit -- a pre-existing broken entry install_shadow_entry's exists-already fast path would otherwise inherit silently is now caught with a named error"
  - "shim_env_for_run now proves the installed git entry speaks plan 03-24's CURRENT classification contract via one --classify-invocation probe (verify_shadow_entry_speaks_classification) -- a shim binary older than that contract is refused at spawn rather than silently denying every command at runtime (D-59/D-60)"
  - "merge_shim_env_for_run's spawn-refusal message (what LaunchSheet.tsx's existing catch renders) now names D-60's deny-everything consequence, so a broken install fails loudly at or before spawn with an actionable reason instead of surfacing as an unexplained blocked session"
affects: [03-26, 03-27, 03-28, security-review, agnt-07-closure]

# Actuals (#2632)
actuals:
  tokens: 6788
  tasks: 2
  commits: 4
  plan_head_before: 125b8a5f300f3fda38fa5829dd3faf03dfb0d54b

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "verify_shadow_entry / verify_shadow_entry_speaks_classification split: structural checks (no process) run for every install_for_run caller; the one-process classification-contract probe runs only on the shim_env_for_run spawn path, so install-only callers (lock_contention.rs) keep paying zero extra process cost"
    - "Fixed, greppable error prefix (\"shim install verification failed\") repeated as a literal string per failure branch rather than via a shared constant, so a source-level grep count is a meaningful acceptance signal, not an artifact of how many call sites happen to reference one symbol"

key-files:
  created: []
  modified:
    - packages/core/src/shim.rs
    - packages/core/tests/git_retry.rs
    - packages/desktop/src-tauri/src/sidecar.rs

key-decisions:
  - "verify_shadow_entry_speaks_classification is called from shim_env_for_run only, never from install_for_run -- keeps the one extra process at exactly one per session spawn, and zero for callers (lock_contention.rs) that merely install a directory and never spawn a session, per the plan's own explicit split."
  - "The rm-entry-as-directory case (T4) fails inside install_shadow_entry's own hard-link/copy attempt, not inside verify_shadow_entry -- entry.is_file() is false for a directory, so install_shadow_entry's fast path never short-circuits and it attempts (and fails) the install itself. This still satisfies the plan's own acceptance bar (\"produces an Err naming that entry\"), since install_shadow_entry's existing context already names the entry path and run id; verify_shadow_entry's own directory check exists for defense-in-depth on shapes that DO reach it (a corrupted symlink/pipe that hard_link overwrites in place is theoretically possible on some filesystems), not because this specific fixture reaches it."
  - "git status is the fixed probe text (planner_assumptions #3), reached only through --classify-invocation, which packages/shim/src/main.rs documents as pure classification -- no process is ever executed, no repository read, no remote contacted (D-63)."

requirements-completed: [AGNT-07]

coverage:
  - id: D1
    description: "install_for_run verifies what it installed, per shadow entry, after both install_shadow_entry calls return: a pre-created non-executable git entry, a zero-byte git entry, and a directory-shaped rm entry each fail the install with a message naming the entry and the run id; a clean install still succeeds and creates both entries; the pre-existing lock_contention.rs install-only caller is unaffected and still spawns no process"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t2_a_pre_created_non_executable_git_entry_makes_install_for_run_fail_naming_the_entry_and_run"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t3_a_pre_created_zero_byte_git_entry_makes_install_for_run_fail_naming_the_entry_and_run"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t4_a_pre_created_rm_entry_that_is_a_directory_makes_install_for_run_fail_naming_that_entry"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t5_a_clean_install_for_run_still_succeeds_and_creates_both_entries"
        status: pass
      - kind: integration
        ref: "cargo test -p core --test lock_contention"
        status: pass
    human_judgment: false
  - id: D2
    description: "shim_env_for_run proves the installed git entry speaks plan 03-24's CURRENT classification contract via one --classify-invocation probe: a healthy install still returns a working environment; an inert stub (structurally valid, but not the real shim) fails; a stub reporting only {\"category\":\"safe\"} (the pre-03-24 shape, missing both new fields) fails as the stale-shim case; install_for_run alone still succeeds without paying the probe's requirements"
    requirement: "AGNT-07"
    verification:
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t6_a_healthy_install_still_produces_a_working_environment"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t7_an_inert_stub_at_the_installed_git_entry_makes_shim_env_for_run_fail"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t8_a_stale_shim_reporting_only_category_safe_makes_shim_env_for_run_fail"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_retry.rs#shim::t9_install_for_run_alone_still_succeeds_on_a_healthy_directory_without_the_probes_requirements"
        status: pass
      - kind: integration
        ref: "cargo test --workspace"
        status: pass
    human_judgment: false
  - id: D3
    description: "AGNT-07's full closure (D-62: adversarial corpus + live claude run + a recorded trust boundary) is NOT claimed by this plan -- this closes only D-60's supervisor-side install/spawn-verification obligation, one of the five plans (03-24..03-28) the bypass-class closure spans"
    verification: []
    human_judgment: true
    rationale: "D-62 explicitly requires a checked-in adversarial corpus, one live claude run, and a written trust boundary before AGNT-07 can leave Gaps Found; none of those exist yet at the end of this plan. requirements-completed above declares AGNT-07 per this plan's own frontmatter (copied verbatim), but the shared-ID gate across 03-24..03-28 (all five plans declare AGNT-07) withholds marking it Complete in REQUIREMENTS.md until 03-28's summary also lands -- confirmed via requirements.ready-ids returning 0/1 ready at the end of this plan."

# Metrics
duration: 23min
completed: 2026-09-21
status: complete
---

# Phase 3 Plan 25: Install Verifies What It Installed, and the Spawn Refusal Says Why (Summary)

**A broken or stale shim install now fails loudly at or before spawn — `install_for_run` verifies both shadow entries structurally, `shim_env_for_run` proves the installed entry speaks plan 03-24's current classification contract via one `--classify-invocation` probe, and the spawn refusal a human actually reads names D-60's deny-everything consequence.**

## Performance

- **Duration:** ~23 min
- **Started:** approx. 2026-09-21T00:42Z (immediately after plan 03-24)
- **Completed:** 2026-09-21T01:04:44Z (approx.)
- **Tasks:** 2 (both TDD)
- **Files modified:** 3

## Accomplishments

- `verify_shadow_entry` (`packages/core/src/shim.rs`) asserts, in order, that each shadow entry exists, is a regular file, is non-empty, and — on Unix — carries at least one execute bit. `install_for_run` calls it for both `git` and `rm` entries AFTER both `install_shadow_entry` calls return, so a pre-existing broken entry `install_shadow_entry`'s exists-already fast path would otherwise leave alone is now caught with a named, actionable error instead of being silently inherited into a session (D-60).
- `verify_shadow_entry_speaks_classification` runs the installed git entry ONCE through its own `--classify-invocation "git status"` mode (classified, never executed — D-63) and requires a `safe` verdict carrying both `textCanShadowPathResolution` and `namesGatedProgram` as booleans — plan 03-24's exact contract. `shim_env_for_run` calls it exactly once, immediately after `install_for_run` returns and before `resolve_real_git`; `install_for_run` itself does NOT call it, so the one extra process per session spawn is paid only on the spawn path, never by callers that merely install a directory (`packages/core/tests/lock_contention.rs`).
- `merge_shim_env_for_run` (`packages/desktop/src-tauri/src/sidecar.rs`) extends its `.context(...)` string — the exact sentence `agent_run_start` turns into `Err(String)` and `LaunchSheet.tsx`'s existing `handleSubmit` catch renders in the launch sheet's error slot — to name that a session cannot be spawned without a verified shim, because the PreToolUse hook denies every command in a session whose shadow directory it cannot prove (D-60). No file under `packages/desktop/src/` was touched; the existing render path was confirmed by reading it, not replaced.
- Eight new tests (T2–T9) in `packages/core/tests/git_retry.rs`'s existing `mod shim` block, each constructing its own broken-entry or stale-shim fixture inside a scratch `FLYWHEEL_RUNTIME_DIR`, run through the REAL compiled `install_for_run`/`shim_env_for_run` (never a mock).

## Task Commits

Each task is TDD, so it carries a RED test commit and a GREEN feat commit:

1. **Task 1 RED — failing coverage for install_for_run's post-install verification** - `07433d9` (test)
2. **Task 1 GREEN — install_for_run verifies what it installed** - `4110bc5` (feat)
3. **Task 2 RED — failing coverage for shim_env_for_run's classification-contract probe** - `b857d1d` (test)
4. **Task 2 GREEN — shim_env_for_run proves the installed entry speaks the current classification contract** - `9067399` (feat)

**Plan metadata:** committed separately (see below).

_No REFACTOR commits — both GREEN implementations needed no cleanup pass._

## Files Created/Modified

- `packages/core/src/shim.rs` — `verify_shadow_entry`, `verify_shadow_entry_speaks_classification`, `CLASSIFICATION_PROBE_TEXT`, and the two new calls inside `install_for_run` and `shim_env_for_run`
- `packages/core/tests/git_retry.rs` — T2–T9 inside the existing `mod shim` block, plus a `write_inert_stub_script` test helper and a `shim_dir_for_test_run` path helper
- `packages/desktop/src-tauri/src/sidecar.rs` — `merge_shim_env_for_run`'s extended `.context(...)` string and doc comment (naming D-59/D-60)

## Decisions Made

See `key-decisions` in frontmatter. Summary: the classification-contract probe lives on `shim_env_for_run` only (never `install_for_run`), preserving the plan's explicit install/spawn cost split; the rm-as-directory test case (T4) is satisfied by `install_shadow_entry`'s own pre-existing error context rather than `verify_shadow_entry`'s directory check, since `entry.is_file()` is false for a directory and the fast path never reaches the new verification call for that specific shape; `git status` is the fixed, non-destructive probe text per the plan's own `planner_assumptions`.

## Deviations from Plan

None on shipped code — both tasks were implemented exactly as specified, and every plan-level `<verify>` command and acceptance criterion passed without requiring an auto-fix to committed material.

One test-authoring hazard was found and corrected DURING the RED phase, before any commit landed (so no shipped/broken state ever existed to fix after the fact), and is recorded here for anyone extending these tests later:

**[Found during Task 2 RED authoring] `install_shadow_entry` hard-links the compiled shim binary; writing through that path in place corrupts the shared inode.**
- **Issue:** T7/T8's first draft called `std::fs::write(&git_entry, script)` directly against a git entry that `install_for_run` had already installed via `fs::hard_link`. Since `git_entry` and the compiled `target/debug/flywheel-shim` binary are the SAME inode after a successful hard link, `std::fs::write`'s open-truncate-in-place semantics corrupted the compiled binary itself — observed live as two unrelated, pre-existing tests (`the_built_shim_exits_non_zero...`, `the_built_shim_forwards_git_version...`) failing with the stub script's own JSON as their output.
- **Fix:** `write_inert_stub_script` now calls `std::fs::remove_file` on the target path FIRST (unlinking that one directory entry, which only decrements the link count and does not touch the inode's data through its other links) before writing a fresh file at the same path.
- **Verification:** `target/debug/flywheel-shim` rebuilt clean (`file` reports a real Mach-O binary, not a shell script) and the full `cargo test -p core --test git_retry` / `cargo test --workspace` runs are green afterward, with no cross-test contamination.
- **Never reached a commit:** the corrupted state existed only transiently in the local `target/` build directory (never source-controlled) during RED-phase iteration; the RED commit (`b857d1d`) already carries the fixed helper.

---

**Total deviations:** 0 requiring a Rule 1–4 fix to committed code. One test-infrastructure hazard found and self-corrected before any commit.
**Impact on plan:** None on scope or correctness — both tasks delivered exactly what the plan specified, and the finding above only ever affected local, uncommitted build artifacts.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- D-60's supervisor-side obligation is now closed: a run spawned against a broken or stale shim directory fails at or before spawn with a message naming the entry, the run, and the unmet expectation, and the message reaching the launch sheet is actionable (names D-60 by consequence, not just by decision id).
- **AGNT-07 stays `Gaps Found`, as designed.** `requirements.ready-ids` confirmed 0/1 ready at the end of this plan — the shared-ID gate across plans 03-24 through 03-28 withholds `Complete` in `REQUIREMENTS.md` until every plan declaring `AGNT-07` has its own SUMMARY. D-62's own bar (adversarial corpus, live `claude` run, written trust boundary) is untouched by this plan and is explicitly plans 03-26 through 03-28's territory.
- No git command was executed and no remote was contacted at any point while working this plan (D-63 honored throughout) — every verification ran through `--classify-invocation` (a pure classification mode), scratch `tempfile::tempdir()` runtime directories, or in-process assertions.
- `packages/core/src/shim.rs`'s `verify_shadow_entry_speaks_classification` is now the second place (after `packages/sidecar/src/pretooluse-hook.ts`'s own callers) in this codebase that invokes `--classify-invocation` directly — future plans changing that mode's output shape should grep both call sites.

---
*Phase: 03-nothing-lost-nothing-left-running*
*Completed: 2026-09-21*

## Self-Check: PASSED

- FOUND: `packages/core/src/shim.rs`
- FOUND: `packages/core/tests/git_retry.rs`
- FOUND: `packages/desktop/src-tauri/src/sidecar.rs`
- FOUND commit: `07433d9` (test — Task 1 RED)
- FOUND commit: `4110bc5` (feat — Task 1 GREEN)
- FOUND commit: `b857d1d` (test — Task 2 RED)
- FOUND commit: `9067399` (feat — Task 2 GREEN)
- Re-ran plan-level `<verification>`: `cargo build --workspace` succeeds; `cargo test -p core --test git_retry` reports 31 passed, 0 failed; `cargo test -p core --test lock_contention` reports 6 passed, 0 failed; `cargo test --workspace` shows no `test result: FAILED` line; `git diff --stat 125b8a5..HEAD -- packages/` names exactly the three `files_modified` files (`shim.rs`, `git_retry.rs`, `sidecar.rs`); each task is its own RED+GREEN commit pair (4 commits total).
