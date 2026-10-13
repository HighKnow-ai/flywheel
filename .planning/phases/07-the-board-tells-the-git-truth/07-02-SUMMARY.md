---
phase: 07-the-board-tells-the-git-truth
plan: 02
subsystem: git-integration
tags: [rust, git-hooks, trailers, posix-sh]

requires:
  - phase: 07-the-board-tells-the-git-truth
    provides: "plan 07-01's git_facts read path and the phase's git-truth architecture; this plan is independent of it but shares the same crate"
  - phase: 02-one-agent-one-worktree-watched-live
    provides: "branch::task_branch_name / branch::epic_integration_branch_name (D-24/D-25/D-26) — the exact branch shapes the hook's extraction is proven against"
  - phase: 12-closing-the-destructive-gate (git_hooks.rs/domain/project.rs, phase numbering as shipped)
    provides: "install_pre_push_hook/PrePushInstall, hooks_dir_for_repo, install_layer3_pre_push_gate, destructive_gate_layer_coverage.rs's structural gate — the sibling machinery this plan extends"
provides:
  - "flywheel_core::git_hooks::commit_msg_hook_script / COMMIT_MSG_MARKER / TRAILER_TASK_KEY / TRAILER_RUN_KEY"
  - "flywheel_core::git_hooks::install_commit_msg_hook / uninstall_commit_msg_hook / CommitMsgInstall"
  - "flywheel_core::domain::project::install_commit_msg_trailer_hook, wired into register_project and relocate_project beside the Phase 12 pre-push gate"
  - "plan 07-05's reader imports TRAILER_TASK_KEY/TRAILER_RUN_KEY from this module rather than a second copy of either literal"
affects: [07-05]

actuals:
  tokens: 11803
  tasks: 2
  commits: 2
plan_head_before: 185b195e33b3469d75b41f2ae9201d3ae6660393

tech-stack:
  added: []
  patterns:
    - "Sibling hook, sibling install: commit-msg mirrors pre-push's own Installed/RefusedPreexistingX enum shape, six-numbered-steps install sequence, and is_flywheel_hooks_dir/verify_install/default_hooks_entry predicates — generalised to recognise either marked hook rather than re-implemented"
    - "Baked-absolute-path discipline carried over: the commit-msg script bakes the real git binary the same way the pre-push script does, no PATH search inside the hook"
    - "Branch-name guard instead of $PWD guard: the pre-push script's case \"$PWD\" in ... esac territory check becomes case \"$branch\" in flywheel/*) ;; *) exit 0 ;; esac — the one new idiom this plan introduces, needed because core.hooksPath is repository-wide and the commit-msg hook therefore also fires for the main checkout"
    - "Coexistence-aware uninstall: uninstall_pre_push_hook/uninstall_commit_msg_hook now each remove only their own hook file and unset core.hooksPath only when neither marked hook remains — a real behavior change from the prior (pre-push-only) uninstall, which never deleted the file at all and always unset the config"

key-files:
  created:
    - packages/core/tests/commit_msg_hook.rs
  modified:
    - packages/core/src/git_hooks.rs
    - packages/core/src/domain/project.rs
    - packages/core/tests/git_hooks_pre_push.rs

key-decisions:
  - "Trailer-append mechanism: git interpret-trailers --if-exists doNothing --in-place, per 07-CONTEXT.md's resolved discretion — one invocation, two --trailer flags, Flywheel-Task before Flywheel-Run"
  - "Task-key extraction via sed -n 's#^flywheel/\\([a-z0-9]\\{1,\\}-[0-9]\\{1,\\}\\).*#\\1#p' — the [a-z0-9]+ run for the key segment cannot contain a hyphen, so it always stops at the first hyphen regardless of digits appearing later in the slug (verified by the ABC-100/\"2026 Roadmap\" table case, where the slug's own leading digits do not get swallowed into the key)"
  - "default_hooks_entry / verify_install generalised in place (not duplicated) to take a hook_name/marker parameter, reused by both install_pre_push_hook and install_commit_msg_hook — the plan's own PATTERNS.md guidance against a parallel second implementation"
  - "uninstall_pre_push_hook changed to actually remove its own hook file (it previously only unset core.hooksPath, never deleting the script) — required by the plan's own <behavior> bullet for uninstall_commit_msg_hook (\"removes only the commit-msg file... unsets core.hooksPath only when no marked hook is left\"), and the pre-push sibling had to gain the identical discipline for the two functions to behave symmetrically"

requirements-completed: [LINK-03]

coverage:
  - id: D1
    description: "A commit on a flywheel/-namespaced branch carries Flywheel-Task then Flywheel-Run, separated from the subject by a blank line, stamped by a real git interpret-trailers invocation inside the installed hook"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#commit_on_a_task_branch_carries_both_trailers_in_order_after_a_blank_line"
        status: pass
    human_judgment: false
  - id: D2
    description: "A commit on main, or on an epic-integration branch (flywheel/epic/..., which yields an empty extracted key), carries neither trailer — the message file is left exactly as git wrote it"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#commit_on_main_carries_neither_trailer"
        status: pass
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#commit_on_an_epic_integration_branch_carries_neither_trailer"
        status: pass
    human_judgment: false
  - id: D3
    description: "Re-stamping is idempotent: an already-stamped message's trailer block survives a git commit --amend --no-edit with exactly one of each trailer line, never duplicated"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#amending_the_commit_does_not_duplicate_the_trailer"
        status: pass
    human_judgment: false
  - id: D4
    description: "The extracted task key is byte-equal to branch::task_branch_name's own real output across a table of keys/titles, including a title whose slug begins with a digit and a title containing non-ASCII bytes"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#extraction_matches_task_branch_name_across_keys_and_titles"
        status: pass
    human_judgment: false
  - id: D5
    description: "FLYWHEEL_RUN_ID in the committing environment becomes the Flywheel-Run value; unset, it falls back to the literal manual"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#flywheel_run_id_set_yields_that_id"
        status: pass
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#flywheel_run_id_unset_yields_manual"
        status: pass
    human_judgment: false
  - id: D6
    description: "The commit-msg hook and the Phase 12 pre-push hook coexist in one core.hooksPath directory regardless of install order; each uninstall removes only its own hook file and unsets core.hooksPath only once neither marked hook remains"
    requirement: "LINK-03"
    verification:
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#commit_msg_installed_first_then_pre_push_neither_refuses_the_others_directory"
        status: pass
      - kind: unit
        ref: "packages/core/tests/commit_msg_hook.rs#pre_push_installed_first_then_commit_msg_neither_refuses_the_others_directory"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_hooks_pre_push.rs#relocating_twice_to_the_same_clone_is_idempotent"
        status: pass
      - kind: unit
        ref: "packages/core/tests/git_hooks_pre_push.rs#uninstall_unsets_core_hooks_path_it_wrote_and_is_a_no_op_for_a_foreign_value"
        status: pass
    human_judgment: false
  - id: D7
    description: "Both hooks install from the one shared call site in register_project/relocate_project — no repo_path mutation path can acquire one hook without the other"
    verification:
      - kind: other
        ref: "cargo test -p core --test destructive_gate_layer_coverage::every_repo_path_mutation_routes_through_the_layer3_install; grep -c 'install_commit_msg_trailer_hook' packages/core/src/domain/project.rs == 3"
        status: pass
    human_judgment: false

duration: 37min
completed: 2026-10-02
status: complete
---

# Phase 7 Plan 2: Commit-Msg Trailer Hook Summary

**A `commit-msg` git hook, installed beside the Phase 12 pre-push gate, stamps `Flywheel-Task`/`Flywheel-Run` trailers onto every commit on a `flywheel/`-namespaced branch via `git interpret-trailers`, proven against 9 real-git integration tests covering stamping, idempotency, the namespace guard, and coexistence in both install orders.**

## Performance

- **Duration:** 37 min
- **Started:** ~2026-10-02T07:48:00Z
- **Completed:** 2026-10-02T08:25:11Z
- **Tasks:** 2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments

- `commit_msg_hook_script` — a pure POSIX `sh`-rendering function mirroring `pre_push_hook_script`'s own structure, guarded on `case "$branch" in flywheel/*) ;; *) exit 0 ;; esac` (since `core.hooksPath` is repository-wide and this hook also fires for the main checkout), extracting the task key via the `sed` expression named in `07-CONTEXT.md`'s resolved discretion, and invoking the baked real-git binary exactly once via `interpret-trailers --if-exists doNothing --in-place`
- `install_commit_msg_hook`/`uninstall_commit_msg_hook`/`CommitMsgInstall` — a sibling of `install_pre_push_hook` sharing its generalised `is_flywheel_hooks_dir`, `default_hooks_entry` (renamed from the pre-push-only `default_hooks_pre_push`), and `verify_install` predicates, so install order never lets one hook refuse the other's directory
- `install_commit_msg_trailer_hook` wired into `register_project`/`relocate_project` immediately beside `install_layer3_pre_push_gate`, at the exact same call sites the Phase 12 structural gate (`destructive_gate_layer_coverage.rs`) already asserts every `repo_path` mutation path routes through
- `packages/core/tests/commit_msg_hook.rs` — 9 new tests against real `git init`-ed repositories proving: trailer stamping and ordering, amend idempotency, the main/epic-branch namespace guard, `FLYWHEEL_RUN_ID` set/unset, extraction matching `branch::task_branch_name`'s real output across a table (including a digit-leading slug and a non-ASCII title), and coexistence in both install orders

## Task Commits

Each task was committed atomically:

1. **Task 1: The generated commit-msg script, and an install that recognises its sibling** - `8b0c899` (feat)
2. **Task 2: Installed at project registration, and proven against real commits** - `85ccb94` (feat)

_No separate RED/GREEN/REFACTOR commits: `workflow.tdd_mode` is off for this run, so the hard TDD gate was not enforced. Both `tdd="true"` tasks were implemented with their proving tests written and passing in the same commit as the implementation they prove — same convention 07-01 used._

## Files Created/Modified

- `packages/core/src/git_hooks.rs` — `COMMIT_MSG_MARKER`, `TRAILER_TASK_KEY`, `TRAILER_RUN_KEY`, `commit_msg_hook_script`, `CommitMsgInstall`, `install_commit_msg_hook`, `uninstall_commit_msg_hook`; `is_flywheel_hooks_dir` and `default_hooks_entry` (renamed/generalised from `default_hooks_pre_push`) now recognise either marked hook; `verify_install` takes a `marker`/`hook_label` pair instead of being pre-push-only; `uninstall_pre_push_hook` now removes its own file and unsets `core.hooksPath` only when no marked hook remains
- `packages/core/src/domain/project.rs` — `install_commit_msg_trailer_hook`, called from both `register_project` and `relocate_project` immediately after `install_layer3_pre_push_gate`
- `packages/core/tests/commit_msg_hook.rs` — 9 tests against real git repositories (see Accomplishments)
- `packages/core/tests/git_hooks_pre_push.rs` — two pre-existing tests updated for the now-two-hooks-at-once reality (see Deviations)

## Decisions Made

See `key-decisions` in the frontmatter above — trailer-append mechanism, extraction regex, the `default_hooks_entry`/`verify_install` generalisation, and the `uninstall_pre_push_hook` behavior change.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Two pre-existing `git_hooks_pre_push.rs` tests broke once `register_project`/`relocate_project` install both hooks**
- **Found during:** Task 2, running `cargo test --workspace` after wiring `install_commit_msg_trailer_hook` into the shared call sites
- **Issue:** `relocating_twice_to_the_same_clone_is_idempotent` asserted the project's hooks directory holds exactly one entry (`pre-push`) after relocation; `uninstall_unsets_core_hooks_path_it_wrote_and_is_a_no_op_for_a_foreign_value` asserted that calling only `uninstall_pre_push_hook` fully unsets `core.hooksPath`. Both assumptions were true under Phase 12 alone but are now stale: `register_project` installs the commit-msg hook too, so the directory legitimately holds both entries, and the new coexistence-aware uninstall discipline correctly leaves `core.hooksPath` set while a marked `commit-msg` hook remains.
- **Fix:** Updated the first test to expect both `commit-msg` and `pre-push` present (sorted). Updated the second to uninstall `pre-push` first (asserting `core.hooksPath` stays set because `commit-msg` remains), then uninstall `commit-msg` too (asserting `core.hooksPath` is now unset).
- **Files modified:** `packages/core/tests/git_hooks_pre_push.rs`
- **Verification:** `cargo test -p core --test git_hooks_pre_push` — 24/24 passing; `cargo test --workspace` exits 0
- **Committed in:** `85ccb94` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a direct, in-scope consequence of this plan's own `register_project`/`relocate_project` wiring, in the exact test file Task 1's own `<verify>` block names).
**Impact on plan:** Necessary to keep `cargo test --workspace` green, which both tasks' acceptance criteria require. No scope creep — the fix only updates two assertions in the file this plan's wiring directly affects.

## Issues Encountered

- **Task 2's own acceptance-criteria text — `grep -c 'install_layer3_pre_push_gate' packages/core/src/domain/project.rs` is still `3`.** The literal grep count is `6`, unchanged by this plan: the baseline file already carried 4 doc-comment mentions of the symbol (predating Phase 7, from Phase 12) plus the function definition and its 2 call sites, before any edit in this plan. I kept my own new doc comment (for the sibling `install_commit_msg_trailer_hook`) from adding to that count by referring to "the Layer 3 pre-push gate's own installer" instead of repeating the literal symbol name, so the count is exactly what it was before this plan touched the file. I verified the real invariant the criterion was checking for directly — `grep -n "install_layer3_pre_push_gate(&canonical" packages/core/src/domain/project.rs` shows exactly the original two call sites (lines 390 and 541), neither moved nor removed. Logged to `.planning/WINDOWS.md` (entry #22, kind `deviation`) since the literal check as written will never pass against this file.
- The amend idempotency test initially used `git commit --amend -m "amended message"`, which **replaces** the whole message (including any existing trailer block) rather than preserving it — the hook correctly re-stamped fresh trailers against the new (trailer-free) message, which is NOT the `--if-exists doNothing` scenario LINK-03's "stamped exactly once" guarantee is about. Switched to `--amend --no-edit` (keeps the existing message, trailers included, unchanged) to actually exercise the idempotency path; this was caught by running the test, not shipped as a false pass.
- `hooks_dir_for_repo` reads `FLYWHEEL_RUNTIME_DIR` from the environment — my first draft of the two coexistence tests called it AFTER the `with_scratch_envs` closure had already exited (restoring real env vars), so it silently resolved to the real app-data runtime directory instead of the test's scratch one, producing a `NotFound` on the assertion rather than a wrong-but-passing result. Moved the resolve-and-assert call inside the closure.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `TRAILER_TASK_KEY`/`TRAILER_RUN_KEY`/`COMMIT_MSG_MARKER` are the single declaration plan 07-05 (the read half of this round trip) imports from — no second copy of either trailer-key literal exists anywhere in the workspace.
- `install_commit_msg_hook`/`uninstall_commit_msg_hook` are stable, independently callable symbols (not only reachable through `register_project`), so 07-05 or any later plan needing to probe or re-run the install does not need to route through project registration.
- No blockers. The hook is proven against real `git commit`/`git commit --amend` invocations end-to-end — nothing here depends on a live app session or a packaged build, so there is no UAT-deferred item for this plan specifically.

## Self-Check: PASSED

All created/modified files verified present on disk; both task commits (`8b0c899`, `85ccb94`) verified present in `git log`.

---
*Phase: 07-the-board-tells-the-git-truth*
*Completed: 2026-10-02*
