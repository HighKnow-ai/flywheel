---
phase: 08-review-and-merge-inside-flywheel
plan: 12
subsystem: review
tags: [rust, tauri, ipc, error-categories, gap-closure, cr-02]
status: complete
gap_closure: true

requires:
  - phase: 08-review-and-merge-inside-flywheel
    provides: "08-11's connection-free halves and rewritten command bodies, 08-09's review_epic_task_rollup; the 08-VERIFICATION CR-02 finding this closes"
provides:
  - "commands::ipc_error(context, e): logs the full cause chain with eprintln!, returns failed:<context>"
  - "Every core-error mapping in commands/review.rs (26) and commands/forge.rs (32) routed through it"
affects: []

requirements-completed: [REVW-04, REVW-05]

duration: "~10 min"
completed: 2026-10-06

actuals:
  tokens: 6200
  tasks: 1
  commits: 1
plan_head_before: 0302ab191dda092bead291f735d4ecfcf90551a6

coverage:
  - deliverable: "No git stderr or absolute path crosses IPC from the review and forge commands: every core error becomes failed:<step> and the raw chain goes to stderr"
    verification:
      - kind: command
        ref: "grep -c 'e\\.to_string()' commands/review.rs = 0, commands/forge.rs = 0 (28 and 32 before)"
        status: pass
      - kind: command
        ref: "ipc_error defined once in commands/mod.rs; its region contains eprintln!; every call's first argument is a fixed string literal with no interpolation"
        status: pass
    human_judgment: false
  - deliverable: "Every renderer-parsed error string is unchanged"
    verification:
      - kind: command
        ref: "nine prefixes still present, 2 occurrences each; forge_error_code untouched (1 definition)"
        status: pass
      - kind: test
        ref: "npm run test -- src/review review-doors session-surface: 168 passed (107 in src/review alone); tsc --noEmit clean; no .ts/.tsx file modified"
        status: pass
    human_judgment: false
  - deliverable: "Rust suites unchanged"
    verification:
      - kind: test
        ref: "cargo test --workspace -- --skip credential --skip api_key: 97 suites ok, 0 failed"
        status: pass
    human_judgment: false
  - deliverable: "A failure in the running app reads as a generic sentence in the sheet and leaves a diagnosable line in the host log"
    human_judgment: true
    rationale: "No Rust test drives a failing git call through a command handler and inspects stderr; the log-and-category behaviour is proved by construction (the helper body) and by region grep, not by an end-to-end run."

key-files:
  created: []
  modified:
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/commands/review.rs
    - packages/desktop/src-tauri/src/commands/forge.rs

key-decisions:
  - "ipc_error takes impl Display so one helper serves anyhow::Error (alternate flag prints the whole cause chain) and the PoisonError from db.lock()."
  - "Context strings are command:step literals (review_files:git, criterion_check_with_anchor:lockWrite), so the log names the failing call and the category carries no data."
  - "forge_error_code is left as is: it already logs and categorises, and the four categories it returns are renderer-parsed."

---

# Phase 8 Plan 12: IPC Error Categories for Review and Forge Commands Summary

**One shared `ipc_error` helper in `commands/mod.rs` replaces every raw `e.to_string()` in the review and forge command modules: the full error chain is written to the host process log and only `failed:<command>:<step>` reaches the webview, so git's stderr and the user's home path no longer cross IPC. CR-02 is closed and every string the sheets branch on is byte-identical.**

## Accomplishments

- **Helper (mod.rs).** `pub(crate) fn ipc_error(context: &str, e: impl Display) -> String` writes `eprintln!("{context}: {e:#}")` and returns `failed:{context}`. Its doc comment states the T-07-08-01 / T-08-08-06 rule, names `forge_error_code` as the precedent, and requires `context` to be a fixed literal. The module header gained one sentence saying every handler in these modules maps a core error through it.
- **review.rs.** All 26 `e.to_string()` error mappings now call `ipc_error`, including the two that 08-11 left in `review_merge_precheck` and `review_merge_task` for a non-refusal error from either merge half (the arms that would have forwarded git's stderr verbatim), the four sites 08-09 added in `review_epic_task_rollup`, and the second `lock` in `criterion_check_with_anchor` (named `lockWrite` to tell it from the first).
- **forge.rs.** All 32 mappings converted, including the 08-11 epic-request sites (`inputs`, `draftInputs`, `blocker`, `draft`).
- **Untouched on purpose.** `refused:`, `mergeInFlight:`, `mergeFailed`, `eventNotRecorded`, `blocked:`, the four forge CLI categories, `forge_error_code`, and the three input-validation sentences (unknown scope, criterion does not belong, partial anchor, plus the no-branch-to-anchor sentence and the forge-vocabulary sentence). No command gained a parameter and no TypeScript file changed.

## Real site count (the plan said 52 = 22 + 30)

The plan's count predates 08-11 and 08-09. Re-derived from the files at start of this plan:

| File | Plan said | Literal `e\.to_string()` lines | Real error sites (`\be\.to_string()`) |
| ---- | --------- | ------------------------------ | ------------------------------------- |
| `commands/review.rs` | 22 | 28 | 26 |
| `commands/forge.rs` | 30 | 32 | 32 |
| Total | 52 | 60 | 58 |

After: 0 and 0. Preserved-prefix counts (each appears twice, once in the doc comment or log and once in code, in both before and after): `refused:` 2, `mergeInFlight:` 2, `mergeFailed` 2, `eventNotRecorded` 2 in review.rs; `blocked:` 2, `cliNotInstalled:` 2, `cliNotAuthenticated:` 2, `cliFailed:` 2, `malformedJson:` 2 in forge.rs.

## Task Commits

| Task | Commit | Description |
| ---- | ------ | ----------- |
| 1 | d7b288f | `ipc_error` helper and 58 call-site substitutions across the two command modules |

## Deviations from Plan

**1. [Rule 3 - Blocker] The plan's zero-count gate matched two non-error lines**
- **Found during:** Task 1, counting sites
- **Issue:** `grep -c 'e\.to_string()'` is substring-based, so `state.to_string()` in `review.rs` (lines 80 and 190, the `ReviewTargetDto` and `StalenessDto` constructors) matched. The gate could never reach 0 without touching them, and they are not error mappings.
- **Fix:** rewrote both as `String::from(state)` (behaviour identical) so the plan's literal gate holds as written, rather than substituting a different gate. Everything else is a true error mapping.
- **Files modified:** `packages/desktop/src-tauri/src/commands/review.rs`
- **Commit:** d7b288f

**2. [Plan shape] Site count and context list**
- The plan listed context names "and the equivalents for whatever step names plan 08-11 left behind". Step names used: `lock`, `resolve`, `finish`, `git`, `read`, `revParse`, `lockWrite`, `actor`, `write`, `plan`, `dryRun`, `relock`, `worktree`, `forge`, `unmet`, `assemble`, `project`, `inputs`, `draftInputs`, `blocker`, `draft`, `list`.

**Total deviations:** 2 (1 gate-driven, two-line change; 1 naming). **Impact:** none on observable behaviour.

## Verification

- `cargo build --workspace`: no error line (the one dead-code warning in `agent_run.rs` is pre-existing).
- `cargo test --workspace -- --skip credential --skip api_key`: 97 suites ok, 0 failed (the `credentials` binary blocks on the macOS keychain unattended, pre-existing per 08-03 and 08-11).
- `npm --prefix packages/desktop run test -- src/review`: 107 passed in 6 files. With `review-doors` and `session-surface`: 168 passed in 8 files, above the 157 baseline. The plan's "at least 157" gate is only met by the three-set; the `src/review` directory alone holds 107, as 08-11 already recorded.
- `npx tsc --noEmit -p packages/desktop`: clean. `git status --porcelain` over `packages/desktop/src/**/*.ts(x)`: empty.
- `ipc_error` defined once; its region contains `eprintln!`; every `ipc_error(` call matches `ipc_error("<command>:<step>", e)` with no `{` or interpolation.
- `UPDATE (tasks|epics)` across `commands/*.rs`: 0.

## Issues Encountered

None.

## Known Stubs

None.

## Threat Flags

None. T-08-12-01 (path and stderr leak) is mitigated by the zero-count gate in both files; T-08-12-02 (leak via category text) by fixed-literal contexts; T-08-12-03 (undiagnosable failure) by the helper's `eprintln!`; T-08-12-04 (renderer vocabulary) by the nine preserved prefixes and no TypeScript change.

## Follow-up

- WR-08 (`CriteriaRail.tsx` has no `onError` on the check mutation) stays an accepted warning, as the plan directed.
- Other command modules (`task`, `epic`, `settings`, ...) still use raw `to_string()` mappings; they were outside this plan's two files and nothing here makes them worse.
- No test drives a failing git call through a handler and reads stderr. The behaviour is proved by the helper body, not by an end-to-end run.

## Self-Check: PASSED

The three modified source files exist and are tracked; commit d7b288f is in `git log`; `git rev-list --count 0302ab1..HEAD` was 1 at SUMMARY write.
