---
phase: 07-the-board-tells-the-git-truth
verified: 2026-10-04T19:50:00Z
status: gaps_found
score: 4/5 roadmap success criteria verified (1 blocker-class gap; 1 criterion behavior-unverified)
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/07-the-board-tells-the-git-truth/07-01-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-01-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-02-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-02-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-03-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-03-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-04-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-04-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-05-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-05-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-06-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-06-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-07-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-07-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-08-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-08-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-09-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-09-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-REVIEW.md", "packages/core/src/db/migrations/0017_forge_setting.sql", "packages/core/src/domain/project.rs", "packages/core/src/domain/settings.rs", "packages/core/src/domain/task.rs", "packages/core/src/domain/worktree.rs", "packages/core/src/forge/github.rs", "packages/core/src/forge/gitlab.rs", "packages/core/src/forge/mod.rs", "packages/core/src/forge/request_body.rs", "packages/core/src/forge/transitions.rs", "packages/core/src/git.rs", "packages/core/src/git_facts.rs", "packages/core/src/git_hooks.rs", "packages/core/src/git_identity.rs", "packages/core/src/query/forge.rs", "packages/desktop/src-tauri/src/commands/forge.rs", "packages/desktop/src-tauri/src/commands/git_identity.rs", "packages/desktop/src-tauri/src/commands/git_truth.rs", "packages/desktop/src-tauri/src/commands/worktree_open.rs", "packages/desktop/src-tauri/src/scheduler.rs", "packages/desktop/src/board/BoardRow.tsx", "packages/desktop/src/board/CommandPalette.tsx", "packages/desktop/src/item-detail/ForgeSection.tsx", "packages/desktop/src/item-detail/GitFactsSection.tsx", "packages/desktop/src/item-detail/WorktreeSummary.tsx", "packages/desktop/src/settings/SettingsSurface.tsx"]
covered_digest: "v1:sha256:8160a60addc63a976e2bfdd139ec8be18637c37ad0d9d3698e23c703801ee6ba"
behavior_unverified: 1
overrides_applied: 0
gaps:
  - truth: "The forge-poll/fetch scheduler ticks must not freeze the whole command surface while talking to GitHub/GitLab (success criterion 5's 'works against a GitHub project and a GitLab project', in practice)"
    status: failed
    reason: "run_forge_tick (scheduler.rs:244-311) and run_fetch_tick (scheduler.rs:200-229) hold AppState.db's single app-wide Mutex<Connection> across untimed gh/glab/git-fetch subprocess calls, confirmed still present by direct code read. Every other Tauri command also locks this same mutex, so a hung network call freezes board reads, task mutations and every other user action app-wide, for however long the network call hangs — with no timeout anywhere in the call chain (git.rs's fetch_origin, forge/github.rs's spawn_gh, forge/gitlab.rs's spawn_glab). This is Code Review CR-01 (blocker-class) plus WR-02, both confirmed still unresolved in the current tree, not fixed during this execution run."
    artifacts:
      - path: "packages/desktop/src-tauri/src/scheduler.rs"
        issue: "run_forge_tick locks state.db at line ~248 and does not drop it until line ~303, after looping forge::request_for_branch (an untimed subprocess call) over every tracked worktree; run_fetch_tick does the same for fetch_origin_for_project"
      - path: "packages/core/src/git.rs"
        issue: "fetch_origin/ahead_behind spawn git with no wall-clock timeout"
      - path: "packages/core/src/forge/github.rs"
        issue: "spawn_gh has no wall-clock timeout"
      - path: "packages/core/src/forge/gitlab.rs"
        issue: "spawn_glab has no wall-clock timeout"
    missing:
      - "Read the worktree/project list under the lock, drop it, run every forge/fetch subprocess call lock-free, then re-acquire a short-lived lock only for the local DB write (code review's own suggested fix, scheduler.rs:244-311/200-229)"
      - "A wall-clock timeout (watchdog thread or tokio::process::Command + tokio::time::timeout) around every gh/glab/git-fetch child process"
deferred: []
behavior_unverified_items:
  - truth: "Opening a pull or merge request against a real, authenticated GitHub or GitLab repository actually succeeds end-to-end and is then detected and reflected on the board (success criterion 3's live arm; LINK-05/LINK-06/LINK-07/LINK-08 in combination)"
    test: "Register a project against a disposable GitHub repo (and separately a disposable GitLab repo) with an authenticated gh/glab CLI on PATH, run the packaged app, press the item's 'open request' action, confirm the preview, send it, then watch the item panel: the forge section should show the real request/CI state within one 120s forge-poll tick, the task should move to In Review on open and to Done on merge within that same cadence, and the board-level CI-failure/unmet-criteria flags should appear when applicable."
    why_human: "No disposable, already-authenticated gh/glab-backed repository was available in this environment and the plan's own correctness_note forbids creating a real PR/MR during automated verification (07-09-SUMMARY.md D4, WINDOWS.md #27). Every component on this path is covered by hermetic unit tests against synthetic fixtures (forge_normalize.rs, status_transitions.rs's 21 tests, forge_request_body.rs) and those tests pass, but no test exercises the real subprocess-to-real-forge-to-real-poll-to-real-status-write chain as a whole, so this is present-and-wired, not behaviorally proven end to end."
---

# Phase 7: The Board Tells The Git Truth — Verification Report

**Phase Goal:** Cyril can answer "where does this task actually stand in git and on the forge?" from the board, without opening a terminal.
**Verified:** 2026-10-04T19:50:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every board item shows its branch, commits, ahead/behind, uncommitted changes | ✓ VERIFIED | `git_facts.rs::git_facts_for_task` reads branch/commits/ahead-behind/fetch-age/uncommitted fresh from git (9 tests, `cargo test -p core --test git_facts` all pass); `GitFactsSection.tsx` renders all of it, ahead/behind always paired with fetch age in one expression (`aheadBehindLine`), withheld sentence (not fabricated `0/0`) when the target doesn't resolve locally — read directly in source, lines ~113-150 |
| 2 | Paste a hash/branch → land on the item; `git log` alone reveals the task via a trailer | ✓ VERIFIED | `git_hooks.rs`'s commit-msg hook stamps `Flywheel-Task:`/`Flywheel-Run:` trailers on `flywheel/`-namespaced branches only (9 tests pass, spot-run: `commit_on_a_task_branch_carries_both_trailers_in_order_after_a_blank_line` — ok); `git_identity.rs::resolve_identifier` reads them back, wired into `CommandPalette.tsx` (12 tests pass, spot-run: `resolve_identifier_for_a_stamped_sha_returns_the_task_and_run_id` — ok) |
| 3 | Opening a PR moves task to In Review; merging moves it to Done, with request/CI state visible | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | The edge-detector logic (`forge/transitions.rs::apply_forge_observation`) is correct and independently traced by the code review against `query/forge.rs`'s baseline reconstruction; `status_transitions.rs`'s 21 hermetic tests cover every branch (spot-run: `merged_against_an_open_baseline_moves_to_done_and_appends_one_event` — ok). But the live `gh pr create`/`glab mr create` → real forge → real poll → real status-write chain was never exercised end to end (no disposable authenticated forge repo was available, and the plan forbids creating a real PR during verification — 07-09-SUMMARY.md D4, WINDOWS.md #27). Code is present and wired; the runtime behavior the criterion actually asserts is unexercised. Not counted as verified, per this verification's explicit instruction not to pass this criterion on unit tests over fixtures alone. |
| 4 | Hand-typed commits are detected and reflected, never silently overwritten | ✓ VERIFIED | `git_facts.rs::record_outside_commits` appends exactly one `events` row per newly-seen outside commit and issues no `UPDATE tasks`/`UPDATE epics` anywhere in its body (confirmed by direct source read, lines 304-367) — there is no second write path for a status change or acknowledgement to attach to; 11 tests pass (spot-run: `record_outside_commits_never_writes_tasks_or_appends_for_covered_commits` — ok); `GitFactsSection.tsx`'s `OutsideFlywheelMarker` has no dismiss/acknowledge affordance |
| 5 | Works against GitHub and GitLab, degrades to local-only; one-action open-in-editor/terminal | ✗ FAILED (degradation logic verified; "in practice" claim fails on Gap 1) | `forge/mod.rs::request_for_branch`/`create_request` short-circuit to `Ok(None)`/a typed error for `Forge::Local` with **no process spawned** (confirmed by source read, lines ~169-183; proven by sabotage in `forge_degrade.rs`'s 6 tests, spot-run: `no_origin_remote_spawns_no_forge_process_at_all` — ok); `worktree_open.rs`/`domain::worktree::resolve_open_argv` execute a shell-free argv (9 tests pass, spot-run: `resolve_open_argv_never_splits_a_path_containing_a_space_and_a_semicolon` — ok). The normalisation/dispatch/degradation logic is correct. But the criterion's own words are "works against a GitHub project and a GitLab project ... in practice" — and in practice, every tracked worktree's forge call happens inside the same held DB-mutex critical section documented in Gap 1, so a single slow/hung GitHub or GitLab call freezes the whole app's command surface for an unbounded duration. The forge/local halves are correct in isolation; the criterion as stated (a usable, non-freezing integration) is not met until Gap 1 closes. |

**Score:** 3/5 roadmap criteria fully verified (1, 2, 4); criterion 3 present-and-wired but behaviorally unexercised end to end (excluded from the score, not counted as a failure); criterion 5 fails on its own "in practice" wording because of the confirmed, unresolved Gap 1 defect below.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/git_facts.rs` | Sync git-truth read path + outside-commit detection | ✓ VERIFIED | `git_facts_for_task`, `record_outside_commits`, `AGENT_RUN_COVERAGE_SQL`, interval constants all present; 20 tests across `git_facts.rs`/`outside_commit_detection.rs` pass |
| `packages/core/src/git_hooks.rs` | Commit-msg trailer hook | ✓ VERIFIED | `install_commit_msg_hook`, `TRAILER_TASK_KEY`/`TRAILER_RUN_KEY` present; 9 tests pass |
| `packages/core/src/git_identity.rs` | Round-trip resolver | ✓ VERIFIED | `classify`, `resolve_identifier` present; 12 tests pass |
| `packages/core/src/forge/mod.rs`, `github.rs`, `gitlab.rs` | Normalized forge model + two CLI adapters | ✓ VERIFIED | `Forge`, `ForgeState`, `CiResult`, `request_for_branch`, `create_request` all present; dispatch confirmed by source read |
| `packages/core/src/forge/transitions.rs` | Edge-triggered status transition | ✓ VERIFIED | `apply_forge_observation`, forward-only terminal guard present; 21 tests pass |
| `packages/core/src/forge/request_body.rs` | Deterministic PR/MR draft assembly | ✓ VERIFIED | `assemble_request_draft` present; 11 tests pass |
| `packages/core/src/domain/worktree.rs` | Worktree-open template/argv | ✓ VERIFIED | `resolve_open_argv`, `OpenSurface` present; shell-free argv confirmed by source read |
| `packages/desktop/src-tauri/src/scheduler.rs` | Four scheduler jobs (hot/cold/fetch/forge) | ⚠️ WIRED, defect confirmed | Four `Job::new_repeated_async` registrations present and wired to `AppHandle`/`AppState`; but `run_forge_tick`/`run_fetch_tick` hold `AppState.db`'s mutex across untimed network subprocess calls — see Gap 1 |
| `packages/desktop/src/item-detail/GitFactsSection.tsx` | Branch/commits/ahead-behind/uncommitted/outside-marker | ✓ VERIFIED | All fields rendered per source read; 16 tests pass |
| `packages/desktop/src/item-detail/ForgeSection.tsx` | Request state/CI/unmet-criteria, absent when no forge | ✓ VERIFIED | Null-render for `noForgeConfigured`/`noWorktree` confirmed by code review trace; 30 tests pass |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `scheduler.rs` (hot/cold) | `git_facts.rs` | `git_facts_for_task`/`tracked_worktrees` direct calls | WIRED | Confirmed by source read |
| `scheduler.rs` (forge tick) | `forge/mod.rs::request_for_branch` + `forge/transitions.rs::apply_forge_observation` | direct calls inside the tick loop | WIRED (but lock held across the call — see Gap 1) | Confirmed by source read, lines 244-311 |
| `git_identity.rs` | `git_hooks.rs`'s `TRAILER_TASK_KEY`/`TRAILER_RUN_KEY` | shared constants | WIRED | Confirmed by source read |
| `CommandPalette.tsx` | `git_identifier_resolve` Tauri command | `useGitIdentifier` hook | WIRED | 12 tests pass end to end through the adapter |
| `WorktreeSummary.tsx` | `worktree_open` Tauri command | `worktreeOpen(taskId, surface)` | WIRED | 9 core tests + command present in capability roster |
| `ForgeSection.tsx` | `forge_request_for_task`/`forge_open_request` | `useForgeRequest`, preview-then-confirm action | WIRED | 30 tests pass |
| `forge/transitions.rs` | `domain::task.rs::set_task_status_in_tx` | direct call inside one transaction | WIRED | Confirmed by source read; only one `UPDATE tasks SET status` site in the crate per code review |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Outside-commit detection never touches tasks/epics | `cargo test -p core --test outside_commit_detection record_outside_commits_never_writes_tasks_or_appends_for_covered_commits -- --exact` | 1 passed | ✓ PASS |
| Forge edge-detector: merge moves task to Done | `cargo test -p core --test status_transitions merged_against_an_open_baseline_moves_to_done_and_appends_one_event -- --exact` | 1 passed | ✓ PASS |
| Worktree-open argv never splits a path with a space+semicolon (shell-injection guard) | `cargo test -p core --test open_worktree resolve_open_argv_never_splits_a_path_containing_a_space_and_a_semicolon -- --exact` | 1 passed | ✓ PASS |
| Git-identifier resolves a stamped sha to its task/run | `cargo test -p core --test git_identity resolve_identifier_for_a_stamped_sha_returns_the_task_and_run_id -- --exact` | 1 passed | ✓ PASS |
| Local forge spawns no process at all | `cargo test -p core --test forge_degrade no_origin_remote_spawns_no_forge_process_at_all -- --exact` | 1 passed | ✓ PASS |
| Commit-msg hook stamps both trailers in order | `cargo test -p core --test commit_msg_hook commit_on_a_task_branch_carries_both_trailers_in_order_after_a_blank_line -- --exact` | 1 passed | ✓ PASS |
| Whole-workspace Rust build | `cargo build --workspace` | exit 0 | ✓ PASS |
| Whole desktop test suite | `npx vitest run` (packages/desktop) | 638/638 passed, 44 files | ✓ PASS |
| ForgeSection component suite alone | `npx vitest run src/item-detail/__tests__/forge-section.test.tsx` | 30/30 passed | ✓ PASS |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/desktop/src-tauri/src/scheduler.rs` | ~244-308, ~200-229 | App-wide DB mutex held across untimed network subprocess calls | 🛑 Blocker (unresolved Code Review CR-01) | Confirmed still present by direct source read; see Gap 1 — this is the anti-pattern that drives this phase's `gaps_found` status |
| `packages/core/src/git.rs`, `forge/github.rs`, `forge/gitlab.rs` | `fetch_origin`, `spawn_gh`, `spawn_glab` | No execution timeout on any subprocess | ⚠️ Warning (unresolved Code Review WR-02) | Confirmed still present by direct source read; the direct mechanism behind Gap 1's unbounded freeze |
| `packages/desktop/src-tauri/src/commands/git_identity.rs` | 62-69 | `format!`-interpolated SQL for a table name, against the crate's own no-`format!`-SQL convention | ⚠️ Warning (unresolved Code Review WR-01) | Not currently exploitable (hardcoded to `"epics"`/`"tasks"`), but outside the `packages/core` grep gates; confirmed still present by direct source read |
| `packages/desktop/src/item-detail/ForgeSection.tsx` | 89-93, 106-108 | Forge-sourced `url`/`ciUrl` rendered into `<a href>` with no scheme validation | ℹ️ Info (unresolved Code Review IN-01) | Low severity per code review's own assessment; not re-verified independently beyond trusting the review's line citation |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any of the 24 phase-7 implementation files grepped (Rust + TypeScript, core + desktop + commands + components).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LINK-02 | 07-01 | Branch, commits, ahead/behind | ✓ SATISFIED | `git_facts.rs`, 9 tests |
| LINK-03 | 07-02 | Commit-msg task trailer | ✓ SATISFIED | `git_hooks.rs`, 9 tests |
| LINK-04 | 07-05 | Hash/branch → board item | ✓ SATISFIED | `git_identity.rs`, 12 tests |
| LINK-05 | 07-03, 07-08, 07-09 | PR/MR state linked and reflected; open-request action | ⚠️ PARTIALLY SATISFIED | Normalisation, draft assembly, preview-then-open action all hermetically tested and present; live open-against-a-real-forge arm unexercised — see behavior_unverified_items |
| LINK-06 | 07-03, 07-08 | CI result visible with link out | ✓ SATISFIED (structurally) | `forge/mod.rs`'s CI normalisation + `ForgeSection.tsx`'s render; live CI-link resolution to the actual run deferred to human check per 07-08-SUMMARY.md's own stated limit |
| LINK-07 | 07-07 | Open→In Review, merge→Done transitions | ⚠️ PARTIALLY SATISFIED | Edge-detector logic correct and exhaustively unit-tested (21 tests); live forge-poll-driven transition against a real PR/MR never exercised |
| LINK-08 | 07-03, 07-08 | GitHub/GitLab/local degradation | ✗ BLOCKED (in practice) | `forge_degrade.rs`'s sabotage tests (6 tests) prove the forge-dispatch logic correctly avoids spawning for `Forge::Local`; but "works against GitHub and GitLab" in practice is blocked by the unresolved Gap 1 freeze risk |
| LINK-09 | 07-01 | Uncommitted changes visible | ✓ SATISFIED | `GitFactsSection.tsx`'s `uncommitted` render, reusing `porcelainStatusWord` |
| LINK-10 | 07-06 | Outside-commit detection, never overwritten | ✓ SATISFIED | `record_outside_commits`, 11 tests, no `UPDATE tasks`/`UPDATE epics` anywhere in its body |
| LINK-11 | 07-04 | One-action open in editor/terminal | ✓ SATISFIED | `resolve_open_argv`, shell-free, 9 tests |

No orphaned requirements — all 10 phase-mapped IDs (LINK-02 through LINK-11) appear in at least one plan's `requirements` field, matching REQUIREMENTS.md's Phase 7 row.

### Process Finding (requested — known_open_item #8)

Across 7 of the phase's 9 plans, `<verify>` acceptance criteria were written as literal `grep -c '<substring>'` text-count assertions against source files, rather than as assertions about the invariant the plan actually cared about. Three were simply stale (WINDOWS.md #22-24: the plan's own baseline-count assumption was wrong before any edit landed). In two cases this *did* shape production code, documented transparently by the executors themselves rather than hidden: 07-05 aliased an import (`useGitIdentifier as useIdentityLookup`) specifically so a `grep -c 'useGitIdentifier' == 1` count would hold despite the hook being both imported and called (two source lines, one substring occurrence intended); 07-06 and 07-07 used a fully-qualified call path (`flywheel_core::git_facts::record_outside_commits(...)`) at exactly N call sites with no `use` import, specifically so a `grep -c` count would equal the real "wired into exactly N sites" invariant rather than being inflated by an import line. Neither case weakened correctness — both are defensible code shapes on their own merits — but the underlying planning defect is real: a plan author wrote a text-matching proxy for a structural/behavioral claim, and in two cases the code's own shape became partially dictated by the proxy rather than the other way around. **Recommendation:** phase-planning acceptance criteria should assert the invariant directly (e.g., "exactly two call sites of `record_outside_commits`, confirmed by a structural check that counts call expressions, not lines containing the substring") or fall back to a described manual check, rather than a literal `grep -c` text-count that a correct refactor can accidentally satisfy or fail for reasons unrelated to the invariant.

### Human Verification Required (after Gap 1 is closed)

#### 1. The live PR/MR → In Review → Done round trip (success criterion 3)

**Test:** Register a project against a disposable, already-authenticated GitHub repo (and separately a GitLab repo), open a request from the item action, confirm the preview, send it, and watch the forge section and task status update within one 120s forge-poll tick. Merge the request and watch Done land on the next poll, including the unmet-criteria marker if acceptance criteria are left unchecked.
**Expected:** Request opens with the previewed title/body unchanged; task moves to In Review once, Done once, both stamped with the system actor; CI result and a working link-out render; nothing is overwritten if the user has already moved the card by hand.
**Why human:** This is the single largest untested surface in the phase (confirmed by direct inspection: `status_transitions.rs`'s 21 tests are all against synthetic `ForgeRequest` fixtures, never a real CLI call). No disposable authenticated forge repo was available in this environment, and the plan's own correctness_note forbids creating a real PR during automated verification. This item stays relevant once Gap 1 below is closed — the behavior it tests is independent of the mutex defect, but exercising it today would risk hitting the freeze Gap 1 describes.

### Gaps Summary

**Gap 1 (blocker, drives this phase's `gaps_found` status):** The scheduler's forge-poll and fetch ticks still hold the app-wide database mutex across untimed network subprocess calls (gh/glab/git fetch), exactly as Code Review CR-01 described — this was not fixed during the execution run, and direct inspection of the current `scheduler.rs`, `git.rs`, `forge/github.rs` and `forge/gitlab.rs` confirms it remains present. Because every other Tauri command locks the same `AppState.db` mutex, a single slow or hung `gh`/`glab`/`git fetch` call can freeze every unrelated action in the app (moving a card, opening a different item) for an unbounded duration — there is no timeout anywhere in the call chain to bound it. This directly fails success criterion 5's own "in practice" wording and is why LINK-08 is marked BLOCKED above rather than satisfied, even though the forge-dispatch/degradation logic itself is correct and well-tested in isolation. The code review supplied a concrete fix (resolve the worktree/project list under the lock, drop it, run the network calls lock-free, re-acquire only for the local write) plus a secondary mitigation (a wall-clock timeout on every subprocess) — this is a closeable gap for the next plan-phase round, not an open-ended research question.

Separately, success criterion 3 (open→In Review, merge→Done) is reported as behavior-unverified rather than failed: every component on that path (normalisation, draft assembly, the edge detector, the preview-then-open UI action) is present, wired, and covered by passing hermetic unit tests — but the live gh/glab-to-real-forge-to-real-poll chain was never exercised, because no disposable authenticated forge repository was available and the plan's own correctness_note forbade creating a real PR during verification. This is flagged for human verification once Gap 1 closes, not marked verified on the strength of fixture-based unit tests alone, per this verification's explicit instruction.

Two warning-level findings from the code review (WR-01's `format!`-interpolated SQL in `git_identity.rs`, WR-02's missing subprocess timeouts — the latter also the direct mechanism behind Gap 1) remain unresolved in the current tree; neither is currently exploitable but both represent real latent risk and should be folded into the same closure plan as Gap 1 (WR-02 especially, since it's the same fix). An info-level finding (IN-01, unsanitized forge `href`s) also remains unresolved but is assessed as low severity by the code review itself and is not blocking.

The planning-defect class (literal grep-count acceptance criteria shaping code in two cases) is recorded above as a process finding per the orchestrator's explicit request — it did not compromise correctness in either instance, so it is not listed as a gap.

---

_Verified: 2026-10-04T19:50:00Z_
_Verifier: Claude (gsd-verifier)_
