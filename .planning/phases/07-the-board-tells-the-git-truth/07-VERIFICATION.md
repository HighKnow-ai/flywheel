---
phase: 07-the-board-tells-the-git-truth
verified: 2026-10-05T09:27:52Z
status: passed
score: 5/5 roadmap success criteria verified
covered_files: [".planning/REQUIREMENTS.md", ".planning/phases/07-the-board-tells-the-git-truth/07-01-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-01-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-02-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-02-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-03-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-03-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-04-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-04-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-05-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-05-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-06-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-06-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-07-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-07-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-08-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-08-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-09-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-09-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-10-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-10-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-11-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-11-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-12-PLAN.md", ".planning/phases/07-the-board-tells-the-git-truth/07-12-SUMMARY.md", ".planning/phases/07-the-board-tells-the-git-truth/07-CONTEXT.md", ".planning/phases/07-the-board-tells-the-git-truth/07-DISCUSSION-LOG.md", ".planning/phases/07-the-board-tells-the-git-truth/07-PATTERNS.md", ".planning/phases/07-the-board-tells-the-git-truth/07-RESEARCH.md", ".planning/phases/07-the-board-tells-the-git-truth/07-REVIEW.md", ".planning/phases/07-the-board-tells-the-git-truth/07-VALIDATION.md", "packages/core/src/db/migrations/0017_forge_setting.sql", "packages/core/src/domain/project.rs", "packages/core/src/domain/settings.rs", "packages/core/src/domain/task.rs", "packages/core/src/domain/worktree.rs", "packages/core/src/forge/github.rs", "packages/core/src/forge/gitlab.rs", "packages/core/src/forge/mod.rs", "packages/core/src/forge/request_body.rs", "packages/core/src/forge/transitions.rs", "packages/core/src/git.rs", "packages/core/src/git_facts.rs", "packages/core/src/git_hooks.rs", "packages/core/src/git_identity.rs", "packages/core/src/lib.rs", "packages/core/src/proc.rs", "packages/core/src/query/forge.rs", "packages/core/tests/bin/forge_probe.rs", "packages/core/tests/forge_live_chain.rs", "packages/core/tests/subprocess_timeout.rs", "packages/desktop/src-tauri/src/commands/forge.rs", "packages/desktop/src-tauri/src/commands/git_identity.rs", "packages/desktop/src-tauri/src/commands/git_truth.rs", "packages/desktop/src-tauri/src/commands/worktree_open.rs", "packages/desktop/src-tauri/src/scheduler.rs", "packages/desktop/src/board/BoardRow.tsx", "packages/desktop/src/board/CommandPalette.tsx", "packages/desktop/src/item-detail/ForgeSection.tsx", "packages/desktop/src/item-detail/GitFactsSection.tsx", "packages/desktop/src/item-detail/WorktreeSummary.tsx", "packages/desktop/src/settings/SettingsSurface.tsx"]
covered_digest: "v1:sha256:558dfd914667ead5fa5f6b138c9f7f6d9dbd6b23607bdec51b7f4771eeb7c776"
behavior_unverified: 0
overrides_applied: 0
gaps: []
deferred: []
re_verification:
  previous_status: gaps_found
  previous_score: "4/5 roadmap success criteria verified (1 blocker-class gap; 1 criterion behavior-unverified)"
  gaps_closed:
    - "Gap 1 — the app-wide DB mutex is no longer held across any gh/glab/git-fetch subprocess call: both run_forge_tick and run_fetch_tick now resolve under the lock, release it, run the network/CLI phase lock-free, and only re-acquire a short-lived lock to write (scheduler.rs forge_tick_targets / poll_forge_targets / apply_forge_results, and the symmetric fetch_tick_targets / fetch_origin_for_targets split)"
    - "A wall-clock timeout now bounds every git/gh/glab subprocess: proc::output_with_timeout, GIT_TIMEOUT_SECS=120, FORGE_CLI_TIMEOUT_SECS=30, wired through spawn_git/spawn_gh/spawn_glab"
    - "Criterion 3's live arm (open -> In Review -> Done, CI normalisation) is now exercised end to end through the real production dispatch path by an automated test (packages/core/tests/forge_live_chain.rs, 9 tests, real child-process gh/glab stubs, passes with all forge tokens unset) rather than left as a human-verification item"
  gaps_remaining: []
  regressions:
    - "The 07-11 lock-release restructuring introduced a new lost-update race (code review BL-01): a manual board move landing inside the now-exposed lock-release window could be silently overwritten by a stale forge observation. This was found by the gap-closure code review, reproduced red by a dedicated regression test, and fixed by quick task 261005-mn5 (expected_status compare-and-swap in apply_forge_observation, threaded through scheduler.rs's three-phase split). Independently re-run and confirmed green in this verification (scheduler::forge_tick_tests::a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation)."
coincidental_reliance_items:
  - truth: "Opening a pull/merge request moves the task to In Review and merging it moves it to Done, with CI visible (roadmap criterion 3)"
    reason: fixture-only
    harden: "forge_live_chain.rs's gh/glab stubs are hand-written shell scripts that mimic each CLI's real JSON output shape; they prove the production subprocess-spawn/JSON-parse/event-write/status-write chain is wired correctly, but if the real gh/glab CLI's actual output format drifts from what the stub assumes, this suite would not catch it. Harden by periodically diffing the stub's JSON against a real `gh pr view --json ...` / `glab mr view --output json` capture, or by running this suite once against a real disposable repo as a one-off confidence check (listed as a backlog candidate below, not a gap)."
---

# Phase 7: The Board Tells The Git Truth — Verification Report

**Phase Goal:** Cyril can answer "where does this task actually stand in git and on the forge?" from the board, without opening a terminal.
**Verified:** 2026-10-05T09:27:52Z
**Status:** passed
**Re-verification:** Yes — after gap closure (3 plans: 07-10, 07-11, 07-12; 1 quick task: 261005-mn5)

## Goal Achievement

### Observable Truths (Roadmap Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Every board item shows its branch, commits, ahead/behind, uncommitted changes | ✓ VERIFIED | Unaffected by the gap-closure round (only `fetch_origin_for_project` moved out of `git_facts.rs`, confirmed by diff). `git_facts.rs::git_facts_for_task` reads branch/commits/ahead-behind/fetch-age/uncommitted fresh from git; `GitFactsSection.tsx` renders all of it. Re-confirmed in this verification by direct source read and a clean `cargo build --workspace`. |
| 2 | Paste a hash/branch → land on the item; `git log` alone reveals the task via a trailer | ✓ VERIFIED | `git_hooks.rs`'s commit-msg hook and `git_identity.rs::resolve_identifier` are untouched by the gap-closure commits (confirmed: neither file appears in the `80e56f5..60e12a4` diff). Re-run in this verification: `cargo test -p core --test commit_msg_hook commit_on_a_task_branch_carries_both_trailers_in_order_after_a_blank_line -- --exact` → ok; `cargo test -p core --test git_identity resolve_identifier_for_a_stamped_sha_returns_the_task_and_run_id -- --exact` → ok. |
| 3 | Opening a PR moves task to In Review; merging moves it to Done, with request/CI state visible | ✓ VERIFIED | Previously PRESENT_BEHAVIOR_UNVERIFIED — no test exercised the real subprocess-to-forge-to-poll-to-write chain. Plan 07-12 closed this with `packages/core/tests/forge_live_chain.rs`: a real child-process `gh`/`glab` (functional shell stubs on `PATH`, only the forge *server* substituted) drives the production `create_request_at` → `request_for_branch_at` → `apply_forge_observation` path end to end for both forges, proving open→In Review and merge→Done plus CI normalisation. Re-run independently in this verification: `env -u GH_TOKEN -u GITHUB_TOKEN -u GITLAB_TOKEN cargo test -p core --test forge_live_chain` → **9 passed, 0 failed**, confirming the orchestrator's reported count. This is a behavioral test exercising the exact state transition the criterion names, not presence/wiring alone — see `coincidental_reliance_items` in frontmatter for the one residual noted (stub-vs-real-CLI JSON drift), which is non-blocking and listed as a backlog candidate rather than a gap. |
| 4 | Hand-typed commits are detected and reflected, never silently overwritten | ✓ VERIFIED | `git_facts.rs::record_outside_commits` is unaffected by the gap-closure diff (only `fetch_origin_for_project` was removed from this file). Re-run in this verification: `cargo test -p core --test outside_commit_detection record_outside_commits_never_writes_tasks_or_appends_for_covered_commits -- --exact` → ok. Still issues no `UPDATE tasks`/`UPDATE epics` anywhere in its body (confirmed by direct source read). |
| 5 | Works against GitHub and GitLab, degrades to local-only; one-action open-in-editor/terminal | ✓ VERIFIED | **Gap 1 is closed.** Direct source read of `scheduler.rs` confirms both `run_forge_tick` (lines ~422-463, composing `forge_tick_targets`/`poll_forge_targets`/`apply_forge_results`) and `run_fetch_tick` (lines ~288-304, composing `fetch_tick_targets`/`fetch_origin_for_targets`) now drop `AppState.db`'s lock before running any `gh`/`glab`/`git fetch` subprocess, and only re-acquire a short-lived lock to write. Every subprocess the network phase can reach is now bounded by a wall-clock timeout (`proc::output_with_timeout`, confirmed wired into `spawn_git`/`spawn_gh`/`spawn_glab` by direct source read of `git.rs`, `forge/github.rs`, `forge/gitlab.rs`). The one remaining lock-held subprocess (`forge_and_repo_path`'s detection-fallback `git remote get-url origin`, a local config read, not a network call) is bounded by the same `GIT_TIMEOUT_SECS=120` and documented honestly as of commit `31683e7` (no longer claims "spawns nothing" unconditionally). Local-degradation logic (`forge/mod.rs`'s `Forge::Local` short-circuit, `worktree_open.rs`'s shell-free argv) is unaffected by the gap-closure round; re-run in this verification: `cargo test -p core --test forge_degrade no_origin_remote_spawns_no_forge_process_at_all -- --exact` → ok; `cargo test -p core --test open_worktree resolve_open_argv_never_splits_a_path_containing_a_space_and_a_semicolon -- --exact` → ok. The criterion's own "in practice" wording — which is exactly what failed last round — now holds: the system cannot freeze on a slow/hung forge or fetch call. |

**Score:** 5/5 roadmap criteria verified.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/proc.rs` | Bounded subprocess wait | ✓ VERIFIED | `output_with_timeout`, `GIT_TIMEOUT_SECS=120`, `FORGE_CLI_TIMEOUT_SECS=30` present and wired; new in this round |
| `packages/core/src/git.rs`, `forge/github.rs`, `forge/gitlab.rs` | Every subprocess routed through the timeout guard | ✓ VERIFIED | `spawn_git`/`spawn_gh`/`spawn_glab` all call `proc::output_with_timeout` with the correct constant — confirmed by direct source read |
| `packages/desktop/src-tauri/src/scheduler.rs` | Resolve-under-lock / dispatch-lock-free / write-under-lock split for both the forge and fetch ticks | ✓ VERIFIED | `forge_tick_targets`/`poll_forge_targets`/`apply_forge_results` and `fetch_tick_targets`/`fetch_origin_for_targets` present, correctly phased (confirmed by direct source read of lines ~200-470); `forge_tick_tests` module (4 tests) added by the quick task, all passing |
| `packages/core/src/forge/transitions.rs` | Compare-and-swap status write, closing the BL-01 regression | ✓ VERIFIED | `apply_forge_observation` gains `expected_status: Option<&str>`; refusal path appends `forge.status_write_skipped` and still advances the baseline (D4) — confirmed by direct source read |
| `packages/core/tests/forge_live_chain.rs` | Live-chain proof for criterion 3 | ✓ VERIFIED | 9 tests, real child-process `gh`/`glab` stubs through the production dispatch path; re-run in this verification with all forge tokens unset — 9/9 pass |
| `packages/core/src/forge/mod.rs` | Honest resolution/dispatch invariant documentation | ✓ VERIFIED | Module header and `forge_and_repo_path`'s doc comment corrected (commit `31683e7`) to state the real invariant (no CLI/network call ever; one bounded local git spawn only on the detection-fallback arm) rather than the false "spawns nothing" claim the gap-closure review caught |

All artifacts verified in the prior round (`git_facts.rs`, `git_hooks.rs`, `git_identity.rs`, `forge/request_body.rs`, `domain/worktree.rs`, `GitFactsSection.tsx`, `ForgeSection.tsx`) are unaffected by this round's commits and were spot-re-confirmed by the named-test re-runs in the Observable Truths table above.

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `run_forge_tick` | `forge_tick_targets` → `poll_forge_targets` → `apply_forge_results` | three-phase composition, lock dropped between phase 1 and phase 3 | WIRED | Confirmed by direct source read; lock is not held across `poll_forge_targets` |
| `run_fetch_tick` | `fetch_tick_targets` → `fetch_origin_for_targets` | same split, no write phase (fetch writes nothing to the DB) | WIRED | Confirmed by direct source read |
| `scheduler.rs`'s `ForgePollTarget.status_at_poll` | `forge/transitions.rs::apply_forge_observation`'s `expected_status` | threaded unchanged through `ForgePollResult` across the lock-release window | WIRED | Confirmed by direct source read and by the passing regression test `a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation` |
| `forge_live_chain.rs` | `forge::create_request_at` / `request_for_branch_at` | direct calls against a PATH-stubbed `gh`/`glab` | WIRED | Compiler-enforced: these functions no longer accept a `Connection` at all, so the test could not compile against a regressed signature |
| `WorktreeSummary.tsx` | `worktree_open` Tauri command | `worktreeOpen(taskId, surface)` in `adapters/tauri.ts` | WIRED | Confirmed by direct source read, unaffected by this round |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| BL-01 regression (manual move during poll window survives a stale merge observation) | `cargo test -p desktop scheduler::forge_tick_tests::a_manual_move_during_the_poll_window_is_not_overwritten_by_a_merged_observation -- --exact` | 1 passed | ✓ PASS |
| Live forge chain, both forges, no live network/auth | `env -u GH_TOKEN -u GITHUB_TOKEN -u GITLAB_TOKEN cargo test -p core --test forge_live_chain` | 9 passed, 0 failed | ✓ PASS |
| Local forge spawns no process at all | `cargo test -p core --test forge_degrade no_origin_remote_spawns_no_forge_process_at_all -- --exact` | 1 passed | ✓ PASS |
| Worktree-open argv shell-injection guard | `cargo test -p core --test open_worktree resolve_open_argv_never_splits_a_path_containing_a_space_and_a_semicolon -- --exact` | 1 passed | ✓ PASS |
| Outside-commit detection never touches tasks/epics | `cargo test -p core --test outside_commit_detection record_outside_commits_never_writes_tasks_or_appends_for_covered_commits -- --exact` | 1 passed | ✓ PASS |
| Git-identifier resolves a stamped sha | `cargo test -p core --test git_identity resolve_identifier_for_a_stamped_sha_returns_the_task_and_run_id -- --exact` | 1 passed | ✓ PASS |
| Commit-msg hook stamps both trailers | `cargo test -p core --test commit_msg_hook commit_on_a_task_branch_carries_both_trailers_in_order_after_a_blank_line -- --exact` | 1 passed | ✓ PASS |
| Whole Rust workspace | `cargo test --workspace` | exit 0, all suites report 0 failed (spot-checked tail of run) | ✓ PASS |
| ForgeSection component suite | `npx vitest run src/item-detail/__tests__/forge-section.test.tsx` (packages/desktop) | 30/30 passed | ✓ PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` or phase-declared probes exist for this phase — skipped.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `packages/desktop/src-tauri/src/scheduler.rs`, `git.rs`, `forge/github.rs`, `forge/gitlab.rs` | — | App-wide DB mutex held across untimed network subprocess calls (prior round's Gap 1 / CR-01 / WR-02) | — | **RESOLVED** this round — confirmed by direct source read; no longer present |
| `packages/desktop/src-tauri/src/commands/git_identity.rs` | 62-69 | `format!`-interpolated SQL for a table name (code review WR-01, prior round) | ⚠️ Warning | Still present, still not independently fixed or filed as a todo this round. Not currently exploitable (hardcoded to `"epics"`/`"tasks"`), outside `packages/core`'s no-`format!`-SQL grep gate. Does not affect any of the 5 roadmap criteria — see Backlog Candidates. |
| `packages/desktop/src/item-detail/ForgeSection.tsx` | 89-93, 106-108 | Forge-sourced `url`/`ciUrl` rendered into `<a href>` with no scheme validation (code review IN-01, prior round) | ℹ️ Info | Still present, still not fixed or filed. Low severity per the original code review's own assessment. Does not affect any of the 5 roadmap criteria — see Backlog Candidates. |

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers found in any gap-closure-round file (`proc.rs`, `forge/mod.rs`, `forge/github.rs`, `forge/gitlab.rs`, `forge/transitions.rs`, `scheduler.rs`, `commands/forge.rs`, `forge_live_chain.rs`).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| LINK-02 | 07-01 | Branch, commits, ahead/behind | ✓ SATISFIED | Unaffected, re-confirmed |
| LINK-03 | 07-02 | Commit-msg task trailer | ✓ SATISFIED | Unaffected, re-confirmed; **REQUIREMENTS.md corrected** from "Gaps Found" to "Complete" in this verification — see bookkeeping note below |
| LINK-04 | 07-05 | Hash/branch → board item | ✓ SATISFIED | Unaffected, re-confirmed; **REQUIREMENTS.md corrected** from "Gaps Found" to "Complete" |
| LINK-05 | 07-03, 07-08, 07-09 | PR/MR state linked and reflected; open-request action | ✓ SATISFIED | Previously PARTIALLY SATISFIED pending the live arm; now closed by `forge_live_chain.rs` |
| LINK-06 | 07-03, 07-08 | CI result visible with link out | ✓ SATISFIED | Previously structural-only; now additionally exercised live by `forge_live_chain.rs`'s CI-normalisation tests |
| LINK-07 | 07-07 | Open→In Review, merge→Done transitions | ✓ SATISFIED | Previously PARTIALLY SATISFIED pending the live arm; now closed by `forge_live_chain.rs`'s full-chain tests |
| LINK-08 | 07-03, 07-08 | GitHub/GitLab/local degradation | ✓ SATISFIED | Previously BLOCKED on Gap 1 ("in practice" freeze risk); Gap 1 is now closed — degradation logic plus the no-freeze guarantee both hold |
| LINK-09 | 07-01 | Uncommitted changes visible | ✓ SATISFIED | Unaffected, re-confirmed |
| LINK-10 | 07-06 | Outside-commit detection, never overwritten | ✓ SATISFIED | Unaffected, re-confirmed; **REQUIREMENTS.md corrected** from "Gaps Found" to "Complete" |
| LINK-11 | 07-04 | One-action open in editor/terminal | ✓ SATISFIED | Unaffected, re-confirmed; **REQUIREMENTS.md corrected** from "Gaps Found" to "Complete" |

No orphaned requirements.

**Bookkeeping correction applied in this verification:** `.planning/REQUIREMENTS.md` showed LINK-03, LINK-04, LINK-10 and LINK-11 as "Gaps Found" (checkbox unchecked) going into this round, a leftover from commit `6243437`'s blanket revert of all ten Phase 7 rows to "Gaps Found" after the first verification found Gap 1 — a revert that over-corrected, since Gap 1 was confined to the forge/fetch network path and never implicated these four. Checked against the evidence (git diff of the gap-closure commit range confirms none of `git_hooks.rs`, `git_identity.rs`, `git_facts.rs::record_outside_commits`, or `domain/worktree.rs` were touched; their named tests were independently re-run above and pass) and against the first verification's own requirements-coverage table, which had already marked all four `✓ SATISFIED`. All four are genuinely satisfied and have been corrected to `[x]`/"Complete" in `.planning/REQUIREMENTS.md` as part of this verification.

## Backlog Candidates (not gaps)

Real findings that do not block any of the 5 roadmap success criteria. Per this project's closing rule, these are reported here rather than in `gaps:`.

1. **Already filed — HI-02, `output_with_timeout` leaks reader threads under a sustained outage.** `.planning/todos/pending/2026-10-05-timeout-guard-leaks-reader-threads-under-sustained-outage.md`. Confirmed still present by direct source read of `proc.rs:108-131` (deliberate design trade-off, not a regression).
2. **Already filed — MED-01, a child finishing exactly at the timeout boundary can be misreported as `TimedOut`.** `.planning/todos/pending/2026-10-05-timeout-boundary-race-misreports-a-child-that-just-finished.md`. Confirmed still present by direct source read of `proc.rs:91-106`.
3. **Already filed — LOW-01, some `forge_live_chain.rs` tests omit the `fake.invoked()` guard.** `.planning/todos/pending/2026-10-05-live-chain-tests-inconsistently-assert-the-fake-was-reached.md`. Confirmed still present.
4. **Not yet filed — HI-01's un-cached failure path.** `forge_tick_targets`'s per-project memoisation map (`scheduler.rs`'s `resolved: HashMap<...>`) only inserts on a successful resolution; a project whose `forge_and_repo_path` call errors is re-attempted (including its bounded local `git` spawn, under the lock) for every tracked worktree belonging to that project, every tick. Each attempt is individually bounded by `GIT_TIMEOUT_SECS=120`, so this cannot reproduce Gap 1's unbounded freeze, but a project with many worktrees and a reliably-failing resolution could still hold the lock for `worktree_count × up to 120s` in a single tick. Suggested severity: Medium. Recommend filing as a todo (cache `Result`, not only `Ok`, in the `resolved` map).
5. **Not yet filed — WR-01, `format!`-interpolated SQL for a table name in `git_identity.rs:62-69`.** Not currently exploitable (hardcoded to `"epics"`/`"tasks"`), but outside the `packages/core` crate's no-`format!`-SQL convention/grep gate. Suggested severity: Low/Warning.
6. **Not yet filed — IN-01, unsanitized forge `href`s in `ForgeSection.tsx:89-93,106-108`.** Forge-sourced `url`/`ciUrl` rendered directly into `<a href>` with no scheme validation. Low severity per the original code review's own assessment (forge API responses, not arbitrary user input). Suggested severity: Info.
7. **Optional extra confidence, not required for closure — a one-off live-chain run against a real, disposable, authenticated GitHub and GitLab repo.** `forge_live_chain.rs` proves the production dispatch/parse/write chain against functional stubs that mimic each CLI's documented JSON shape (see `coincidental_reliance_items` in frontmatter); it does not prove the real `gh`/`glab` CLI's actual current output matches that shape. This is a reasonable one-time manual or scripted check to run whenever `gh`/`glab` is upgraded, not a standing requirement — automated hermetic coverage is otherwise complete and this is intentionally not raised as a human-verification gate, consistent with this project's preference for automated proof over manual UAT.

### Process Finding (carried forward, informational only)

The previous verification's process finding about literal `grep -c` text-count acceptance criteria in several Phase 7 plans remains on record (`07-VERIFICATION.md`'s prior revision, preserved in git history) and is not re-litigated here — it did not compromise correctness and is not a gap.

### Gaps Summary

None. All 5 roadmap success criteria verify against the current codebase. Gap 1 (the app-wide mutex held across untimed network subprocess calls) and Gap 2 (criterion 3's unexercised live arm) from the prior verification round are both closed, and the regression the gap-closure round's own code review found in the fix for Gap 1 (BL-01, a lost-update race on a manual board move) has itself been fixed and independently re-confirmed green in this verification.

---

_Verified: 2026-10-05T09:27:52Z_
_Verifier: Claude (gsd-verifier)_
