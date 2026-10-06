---
phase: 08-review-and-merge-inside-flywheel
plan: 01
subsystem: review
tags: [rust, tauri, react, react-diff-view, refractor, git]
status: complete

requires:
  - phase: 07-the-board-tells-the-git-truth
    provides: "git.rs's single git construction site, git_facts's scope walk and DTO shape, branch.rs naming"
provides:
  - "git::git_output_at, review_files, review_patch, ReviewFile (raw-output wrapper and the two review reads)"
  - "flywheel_core::review: ReviewScope, ReviewTarget (Resolved / NoIntegrationBranch / NoBranch), resolve_review_target, files_for_target, patch_for_target, review_file_list, review_file_patch"
  - "review_files and review_file_patch Tauri commands (scope + id in, DTOs out, no ref/sha/repo path from the renderer)"
  - "ReviewSurface, FileDiff, highlight.ts, useReviewFiles/useReviewPatch: the fourth full surface with a lazily-expanded, syntax-highlighted unified diff"
affects: [08-02, 08-03, 08-04, 08-05, 08-06, 08-07, 08-08]

requirements-completed: [REVW-01, REVW-02]

actuals:
  tokens: 27000
  tasks: 3
  commits: 3
plan_head_before: 9779d05e2692cefa57408cd76dc3989a04c0ad66

coverage:
  - deliverable: "Task file list and per-file patch from a real git repository (statuses, renames, binary, spaced paths, NULL integration branch)"
    verification:
      - kind: test
        ref: "packages/core/tests/review_diff.rs"
        status: pass
    human_judgment: false
  - deliverable: "review_files / review_file_patch commands: scope + id only, async, DB lock dropped before git"
    verification:
      - kind: command
        ref: "cargo build --workspace; grep gates in 08-01-PLAN.md Task 2 verify"
        status: pass
    human_judgment: false
  - deliverable: "Review surface: lazy per-file expand, highlight adapter, binary/generated/no-branch states, chunking, keys"
    verification:
      - kind: test
        ref: "packages/desktop/src/review/__tests__/review-surface.test.tsx"
        status: pass
      - kind: test
        ref: "packages/desktop/src/review/__tests__/highlight.test.ts"
        status: pass
    human_judgment: false
  - deliverable: "Added/removed tints against token colours stay legible in light and dark themes"
    human_judgment: true
    rationale: "Visual judgement only (VALIDATION.md manual row 1); deferred to end-of-phase human verification."

tech-stack:
  added: ["react-diff-view@3.3.3", "refractor@5.0.0"]
  patterns:
    - "Resolve a scope under the DB lock, drop it, then run git lock-free (files_for_target / patch_for_target take no connection)"
    - "refractor 5 -> react-diff-view 3 via a one-line .children adapter; individual grammar imports only"
    - "Surface patch hooks stay mounted after first expand, so collapse/re-expand never re-requests"

key-files:
  created:
    - packages/core/src/review.rs
    - packages/core/tests/review_diff.rs
    - packages/desktop/src-tauri/src/commands/review.rs
    - packages/desktop/src/review/highlight.ts
    - packages/desktop/src/review/useReviewQuery.ts
    - packages/desktop/src/review/ReviewSurface.tsx
    - packages/desktop/src/review/FileDiff.tsx
    - packages/desktop/src/review/review.css
    - packages/desktop/src/review/__tests__/highlight.test.ts
    - packages/desktop/src/review/__tests__/review-surface.test.tsx
  modified:
    - packages/core/src/git.rs
    - packages/core/src/lib.rs
    - packages/core/tests/common/mod.rs
    - packages/desktop/src-tauri/src/commands/mod.rs
    - packages/desktop/src-tauri/src/main.rs
    - packages/desktop/src-tauri/capabilities/default.json
    - packages/desktop/package.json
    - packages/desktop/package-lock.json
    - packages/desktop/src/adapters/tauri.ts
    - packages/desktop/src/App.tsx
    - packages/desktop/src/board/BoardView.tsx
    - packages/desktop/src/item-detail/ItemDetailPanel.tsx
    - packages/desktop/src/state/keyboard.ts
    - packages/desktop/src/state/uiStore.ts

key-decisions:
  - "The review base is the LOCAL integration branch; diffs run against the project repo_path so review survives worktree removal"
  - "Both scopes (task, epic) resolve in one function from the first commit"
  - "A NULL integration branch is a typed outcome; the review module never cuts one"
  - "Hunks render 40 at a time and highlighting is skipped above 5,000 changed lines; both constants live in FileDiff.tsx and the view says so when partial"
  - "#[tauri::command(async)] on a plain sync fn taking State<AppState> compiles as-is (assumption A2 holds); no spawn_blocking needed for plan 08-07"

duration: 35min
completed: 2026-10-06
---

# Phase 8 Plan 01: Review Tracer Summary

**Real `git diff` in the Rust core, through two async Tauri commands, to a syntax-highlighted unified diff on a lazily-loaded fourth surface pushed into from the item detail panel, using react-diff-view 3 with refractor 5 via a one-line `.children` adapter.**

## Accomplishments

- **Core read path.** `git_output_at` (raw `Output`, no exit policy, still through the one `spawn_git` site), `review_files` (`-z --name-status -M` zipped with `-z --numstat -M` over `base...head`) and `review_patch` (`--literal-pathspecs` first, both rename paths in the pathspec). `diff_stat_and_names` is untouched; the drift suite still passes.
- **Scope resolution.** `review.rs` maps a task id or epic id to repo path plus local base/head refs. A task without an epic uses the project default branch; a NULL integration branch returns `NoIntegrationBranch` and leaves the column NULL; a task without a worktree row returns `NoBranch`. No call to the branch-cutting helper exists in the module.
- **Commands.** `review_files` and `review_file_patch` accept a scope string and ids/paths only. Both resolve under the DB lock, release it, then run git. Registered in `generate_handler!` and the capability roster.
- **Surface.** `ReviewSurface` lists files with status, counts, a generated tag and a binary marker; every file starts collapsed; expanding fetches that one patch once. `FileDiff` renders unified only, highlights through Prism, chunks long files and says so. Escape and "← Board" pop back; `j`/`k`/`Enter`/`Space` work through a new `review-surface` region and layer.
- **Door.** A Review button on the item detail panel for tasks and epics sets the new `reviewSurface` store field; `App.tsx` mounts the surface lazily (separate chunk, ~48 kB gzip).

## Task Commits

1. Task 1 (tracer): `96b7ddd` core review read path. 16 tests in `review_diff.rs`.
2. Task 2: `81c38f1` the two read commands.
3. Task 3: `2330dfe` the review surface, adapter, store/keyboard wiring and Review button. 13 new frontend tests.

Tracer gate: `<verify>` was automated-only and mode is `end-of-phase`, so the tracer's verification was re-run end to end (cargo `review_diff`, `supervisor_cwd`, `drift`, then the full chain through to the frontend tests) and passed before expansion.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Door wired in `BoardView.tsx`**
- **Found during:** Task 3
- **Issue:** `ItemDetailPanel` is rendered by `BoardView.tsx`, which is not in the plan's `files_modified`; without a handler there it the Review button would be inert.
- **Fix:** passed `onReview` beside `onStartWork`, setting the store field.
- **Files modified:** `packages/desktop/src/board/BoardView.tsx`
- **Commit:** 2330dfe

**2. [Rule 2 - Missing functionality] Store target carries a `label`**
- **Issue:** the plan's `{ scope, itemId }` shape gives the surface header no key or title to show, and the surface has no other lookup for it.
- **Fix:** `ReviewSurfaceTarget` is `{ scope, itemId, label }`, with `label` set to `"<key> <title>"` at the door. The `reviewSurface` occurrence count in `uiStore.ts` is still the required 4.
- **Commit:** 2330dfe

**3. [Rule 3 - Structural] Commands call `files_for_target` / `patch_for_target`, not `review_file_list`**
- **Issue:** `review_file_list` takes a connection and would run git while the DB lock is held, contradicting the plan's own "resolve, drop, then git" rule and the `repo_path` grep gate on the command layer.
- **Fix:** added two connection-free core helpers; `review_file_list`/`review_file_patch` are now thin wrappers over them and the command layer never names a repo path.
- **Files modified:** `packages/core/src/review.rs`, `packages/desktop/src-tauri/src/commands/review.rs`
- **Commit:** 81c38f1

**4. [Rule 3 - Layout] Two panes rendered, criteria rail omitted rather than empty**
- The plan reserves a left criteria pane that renders nothing. It is a code comment at the insertion point instead of an empty element; plan 08-06 adds the pane. File list is the left pane and expanded diffs stack in the right pane.

**5. Test harness note.** `review_diff.rs` does not use the `WORKTREE_ROOT_ENV_LOCK` wrapper: nothing in the review path reads `FLYWHEEL_WORKTREE_ROOT`, so serialising would only slow the suite.

**Total deviations:** 3 auto-fixed (1 missing-functionality, 2 blocking/structural), 2 minor.
**Impact:** none on scope; all plan acceptance greps and tests pass.

## Verification

- `cargo test -p core --test review_diff`: 16 passed. `supervisor_cwd`: 5 passed. `drift`: 30 passed.
- `cargo build --workspace`: clean (one pre-existing dead-code warning in `StartRunOutcome`).
- `cargo test --workspace -- --skip credential --skip api_key`: 94 suites ok, exit 0.
- `npm --prefix packages/desktop run build`: ok. `npm --prefix packages/desktop run test`: 46 files, 651 tests passed.
- All grep gates from the plan (no `refractor/all`, no `refetchInterval`, no Tauri API import in `src/review`, `reviewSurface` x4 in `uiStore.ts`, `REVIEW_SURFACE_ACTION_IDS` x2 and `topLayer` unchanged in `keyboard.ts`, `onReview` x3, pinned versions) pass.

## Issues Encountered

- `cargo test --workspace` hangs in `tests/credentials.rs` on this machine (the macOS keychain tests block for over 60 seconds). It is unrelated to this plan's files, so it was skipped for the workspace run; it needs a human at the keychain prompt or a CI environment.
- `npm install` reported one high-severity advisory in the dependency tree; not investigated, not caused by a new package's install script (neither new package has one).
- The visual `human-check` (tints against token colours in both themes) was not performed; it is deferred to end-of-phase verification.

## Known Stubs

None. `ReviewSurface`'s `onOpenSession` prop is declared and supplied by `App.tsx` but not yet consumed; this is intentional so plan 08-07's resolve-session offer needs no change to `App.tsx`.

## Next Phase Readiness

Ready for 08-02 onward. `git_output_at` is in place for the merge work in 08-03, and the shared fixture `common::review_branches` already builds the clean and conflicting task-branch pairs 08-03 needs.

## Self-Check: PASSED

- Created files exist: `review.rs`, `review_diff.rs`, `commands/review.rs`, and everything under `src/review/` found on disk.
- Commits `96b7ddd`, `81c38f1`, `2330dfe` present in `git log`.
