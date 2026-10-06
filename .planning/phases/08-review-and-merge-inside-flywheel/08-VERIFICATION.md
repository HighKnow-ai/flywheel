---
phase: 08-review-and-merge-inside-flywheel
verified: 2026-10-06T16:45:00Z
status: human_needed
score: 6/6 must-haves verified
covered_files:
  - ".planning/REQUIREMENTS.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-01-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-01-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-02-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-02-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-03-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-03-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-04-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-04-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-05-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-05-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-06-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-06-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-07-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-07-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-08-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-08-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-09-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-09-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-10-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-10-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-11-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-11-SUMMARY.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-12-PLAN.md"
  - ".planning/phases/08-review-and-merge-inside-flywheel/08-12-SUMMARY.md"
  - "packages/core/src/context_packet.rs"
  - "packages/core/src/forge/mod.rs"
  - "packages/core/src/forge/request_body.rs"
  - "packages/core/src/git.rs"
  - "packages/core/src/merge.rs"
  - "packages/core/src/review.rs"
  - "packages/core/tests/criterion_anchors.rs"
  - "packages/desktop/src-tauri/capabilities/default.json"
  - "packages/desktop/src-tauri/src/commands/forge.rs"
  - "packages/desktop/src-tauri/src/commands/mod.rs"
  - "packages/desktop/src-tauri/src/commands/review.rs"
  - "packages/desktop/src-tauri/src/main.rs"
  - "packages/desktop/src/adapters/tauri.ts"
  - "packages/desktop/src/review/CriteriaRail.tsx"
  - "packages/desktop/src/review/ReviewSurface.tsx"
  - "packages/desktop/src/review/__tests__/criteria-rail.test.tsx"
  - "packages/desktop/src/review/__tests__/epic-request.test.tsx"
  - "packages/desktop/src/review/__tests__/keyboard-activation.test.tsx"
  - "packages/desktop/src/review/__tests__/merge-sheet.test.tsx"
  - "packages/desktop/src/review/__tests__/review-surface.test.tsx"
  - "packages/desktop/src/review/useReviewQuery.ts"
  - "packages/desktop/src/state/keyboard.ts"
covered_digest: "v1:sha256:d3aeb5798d9375616dc200fb99657811532432c87638d705c1b374ad205150b9"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Epic scope renders the epic's own criteria plus a roll-up of its tasks (D-132), closed by 08-09"
    - "Keyboard user can activate Merge confirm / Open request / other buttons (CR-03), closed by 08-10"
    - "Git spawned under the SQLite lock in the merge, review and epic-request commands (CR-01), closed by 08-11 as scoped"
    - "Raw git stderr and absolute paths returned over IPC from review and forge commands (CR-02), closed by 08-12"
  gaps_remaining: []
  regressions: []
gaps: []
deferred: []
human_verification:
  - test: "Read a multi-language task diff in light AND dark themes at review width"
    expected: "Added/removed tints do not fight token colour; text stays legible (VALIDATION manual row 1)"
    why_human: "Visual judgement; jsdom cannot assert colour or contrast"
  - test: "Review a real multi-file task: check each criterion against selected lines without losing scroll position, then toggle to whole-epic scope and read the new Tasks roll-up beneath the epic's own criteria"
    expected: "The rail stays usable over a long diff; scroll position survives each check; the roll-up counts match what the board shows (VALIDATION manual row 2)"
    why_human: "Ergonomic judgement about the pacing of a real review; the roll-up has only been rendered against mocked rows"
  - test: "Open the merge confirm sheet, then a conflicting merge, in the packaged/dev app"
    expected: "Wording reads clearly; the conflict names each file and offers 'start a session' and 'open worktree'; the board shows the integrated marker after a clean merge"
    why_human: "Visual and interaction judgement; the Tauri command path was never driven end to end (08-07 SUMMARY)"
  - test: "Open an epic request against a real authenticated GitHub/GitLab repo, twice in a row"
    expected: "First call pushes and opens one request; second surfaces the existing request read-only rather than creating a duplicate"
    why_human: "Plan truth is tagged backstop; only fake gh/glab was exercised (WINDOWS.md #27 is the same unrun live arm)"
  - test: "Open the epic request sheet, change state in another window (check a criterion or merge a task), then confirm"
    expected: "Per WR-08 of the review the published body can differ from the previewed one; decide whether a content-hash guard is required before this ships"
    why_human: "Judgment-tier prohibition (see Prohibitions); product-risk decision"
  - test: "Keyboard-only pass through review in the real WebView: j/k files, Enter to expand, c to check, Tab to Merge, Enter and Space on the confirm button, same for 'Open request'"
    expected: "Every step completes without the mouse (line selection itself is gutter-click only). The CR-03 guard is proven in jsdom only; real button-activation semantics are not"
    why_human: "Real WebView button-activation behaviour cannot be proven in jsdom"
---

# Phase 8: Review And Merge Inside Flywheel Verification Report

**Phase Goal:** Cyril reviews an agent's work against the acceptance criteria that were agreed before it started, and lands it, without dropping back to a terminal.
**Verified:** 2026-10-06
**Status:** human_needed
**Re-verification:** Yes, after gap closure (plans 08-09 .. 08-12, commits ab960cc..8c6bb2f). Previous status `gaps_found`, 4/5.
**Mode:** mvp. The ROADMAP goal is not in "As a ..., I want to ..., so that ..." form, as on every other phase of this roadmap. Verification proceeded goal-backward against the goal's clauses instead of refusing.

## Headline ruling

**The phase goal is achieved, for pointer and keyboard users alike. Every roadmap success criterion, every plan-added must-have and all five requirement IDs are met in the code. No gap remains.** The status is `human_needed`, not `passed`, only because six checks (visual, live forge, a real-WebView keyboard pass, one product decision) cannot be settled by code inspection or jsdom. None of them is a known defect.

Both gaps from round one are closed in the code, not just in the summaries:

- **D-132 roll-up (was FAILED):** now exists end to end (see Truth P1).
- **CR-03 keyboard activation (was PARTIAL):** the guard exists, is placed correctly, and is tested against the two real sheets (see Truth P8).

CR-01 and CR-02, which the prior round carried as warnings, are closed for every command the phase owns. Two adjacent spawn-under-lock sites survive (WR-01, WR-02 of 08-REVIEW.md). I ruled on them below: **warnings to carry forward, not unmet goal clauses.**

## User Flow Coverage (MVP mode)

| Goal clause | Expected | Evidence | Status |
|---|---|---|---|
| "reviews an agent's work" | Diff on screen, syntax-highlighted, task and epic scope | `ReviewSurface` lazily mounted; three entry doors call `setReviewSurface`; `review_files`/`review_file_patch` are real git reads served through the lock-split halves | VERIFIED |
| "against the acceptance criteria that were agreed before it started" | Criteria beside the diff, checkable against lines, evidence kept; epic scope shows the epic's tasks | `CriteriaRail` mounted at `ReviewSurface.tsx:433` for both scopes; `criterion_check_with_anchor` wired; `epic_task_rollup` read-only SQL feeds a rail section, epic scope only | VERIFIED |
| "and lands it" | In-app merge to the integration branch; epic request to the forge | `review_merge_precheck`/`review_merge_task`, `forge_epic_request_draft`/`forge_open_epic_request`; both confirm buttons keyboard-activatable | VERIFIED (live forge unexercised, see Human Verification) |
| "without dropping back to a terminal" | No shell-out needed for diff, merge, conflict, PR | Sole `Command::new("git")` is `packages/core/src/git.rs:44`; conflict has two in-app exits | VERIFIED |

## Goal Achievement

### Observable Truths: ROADMAP Success Criteria (the contract)

| # | Truth | Status | Evidence |
|---|---|---|---|
| SC1 | User reads a task's full diff with syntax highlighting in-app, and the accumulated diff of its epic's integration branch | VERIFIED | Unchanged from round one except that the command bodies now take the lock only for a board read (`review.rs:132,154,213`) and run `finish_review_target`/`files_for_target`/`patch_for_target` after it. `desktop` `src/review` suites pass (765/765 overall, supplied) |
| SC2 | User checks off each of the task's criteria against the diff while reviewing | VERIFIED | `criterion_check_with_anchor` still registered once in `main.rs`; the rail's `useCheckAgainstSelection` is its only caller; `criterion_anchors` suite passes (26 tests incl. the 6 new roll-up tests, run by me) |
| SC3 | User merges a task branch into its epic integration branch in-app; conflicts surfaced, never silent or half-merged | VERIFIED | Read `review_merge_task` (`review.rs:431-500`): board read under the lock, block closes, `finish_plan` and `run_merge` run with no lock held (epic guard only), lock retaken for the event, dropped before `emit`. Conflict returns `Conflicted { files }`; `MergeConfirmSheet`'s confirm button now receives Enter/Space (test below) |
| SC4 | User opens a PR/MR for a finished epic's integration branch in one action | VERIFIED (fake forge only) | Read `forge_open_epic_request` (`forge.rs:358-408`): board reads under the lock, block closes, blocker check, draft and push/create all run after release; epic id is the only input; partial outcome is its own state. Live forge arm is Human Verification item 4 |

### Observable Truths: Plan-Added Must-Haves

| # | Truth | Status | Evidence |
|---|---|---|---|
| P1 | Epic scope renders the epic's own criteria plus a roll-up of its tasks (08-08, D-132) | VERIFIED (was FAILED) | Full chain exists and is wired. Core: `review::epic_task_rollup` (`review.rs:418`), one SQL statement, current-revision criteria only (`superseded_at IS NULL`), checked and with-evidence counts by correlated subquery, `ORDER BY t.rank, t.id`. Command: `review_epic_task_rollup(state, epic_id)` (`commands/review.rs:267`), epic id only, lock held for one read, no git. Registered once in `main.rs:225`, in the capabilities roster, and as `adapters/tauri.ts:1429`. Hook: `useEpicTaskRollup` (`useReviewQuery.ts:209`), enabled only when `scope === "epic"`, invalidated on `board:changed`. Rail: `CriteriaRail.tsx:72` renders a `region` named "Task criteria roll-up" only for epic scope with at least one row; `CriteriaRail` is mounted with the live `scope` and `itemId` at `ReviewSurface.tsx:433`. I ran the six `rollup_*` core tests (counts, no-criteria task, superseded revisions, empty or unknown epic, tie order, cross-epic isolation): 6/6 pass. `criteria-rail.test.tsx` covers render in epic scope, no section and no read in task scope, no section on empty |
| P2 | Git never runs under the SQLite lock in the merge, review and epic-request commands (08-03, 08-07, 08-11) | VERIFIED for the phase's own commands; two sibling sites are WARNINGS | See "Rulings" below |
| P3 | No half-merged state, no verified-less outcome (08-03 prohibition) | VERIFIED | `merge_abort_if_in_progress` proves clean via porcelain; conflict and recovery tests (round one, 37/37) unchanged by 08-09..08-12 (`merge.rs` diff in the gap rounds is the lock split only) |
| P4 | Merge/review/epic request never write a status column | VERIFIED | `grep` for `UPDATE (tasks\|epics)` across `merge.rs`, `review.rs`, `request_body.rs` and both command files: none |
| P5 | Push never rewrites or deletes remote history | VERIFIED | No `--force`, `force-with-lease` or `--delete` in `git.rs`; the one `Command::new("git")` is at `git.rs:44` |
| P6 | Renderer cannot supply title, body, branch, target or sha | VERIFIED | Command signatures take ids, scope strings and ranges only; the new roll-up command takes an epic id and nothing else |
| P7 | Published epic request text equals previewed text | PARTIAL, carried as a judgment-tier flag | Same assemble function both sides, but confirm re-reads live state (review WR-08). Not a ROADMAP clause. Human Verification item 5 |
| P8 | A keyboard user can activate the Merge confirm, "Open request" and the other buttons on the review surface (CR-03; was PARTIAL) | VERIFIED | `useRegionBindings` (`keyboard.ts:762-770`): `resolveBinding`, then `if ((event.key === "Enter" \|\| event.key === " ") && isActivationTarget(event.target)) return;` strictly before `preventDefault`. `isActivationTarget` is `target.closest("button, a, [role='button']") !== null` (`keyboard.ts:311`), a real DOM-ancestor test, not a tag-name check. `resolveBinding` is deliberately untouched, so BoardView's element handler is unaffected. Escape now honours `defaultPrevented` (WR-06). I ran `keyboard-activation.test.tsx` and `criteria-rail.test.tsx`: 2 files, 38 tests pass. The suite pins: Enter and Space on the body still resolve `expand-file` and are cancelled; a plain button's keydown is left uncancelled and activates; the Merge sheet's Merge button runs the merge with the task id alone; the Epic sheet's Open request button opens the request with the epic id alone; Escape is ignored when already handled |

**Score:** 6/6 must-haves verified (4 roadmap SCs, plus plan truths P1 and P8 that failed in round one). 0 behavior-unverified: every behavior-dependent truth has a passing named test (merge abort, serialization, anchor clearing, staleness, roll-up scoping, button activation).

### Rulings on the questions put to the verifier

**1. Do WR-01 and WR-02 leave a goal clause unmet? No. Both are WARNINGS carried forward.**

- **WR-01, `forge_request_for_epic` (`commands/forge.rs:413-435`). CONFIRMED in code.** It takes `state.db.lock()` at 417 and calls `forge_and_repo_path(&conn, ..)` at 428 with the guard live until `drop(conn)` at 430. `forge_and_repo_path` (`forge/mod.rs:168-175`) is `stored_forge_and_repo_path` plus `detect_forge_from_origin`, so a project whose `forge` column is NULL spawns `git remote get-url origin` under the mutex. This is the same defect class CR-01 fixed for its siblings, and the board-only half (`stored_forge_and_repo_path`, line 179) already exists, so the fix is two lines. It does not unmeet a goal clause: it is a read-only, bounded, once-per-sheet-open spawn, hit only when no forge is stored, and it concerns responsiveness, not the correctness or completeness of "review and land without a terminal". The header text in `forge/mod.rs` that claims the epic-request path does not rely on this tolerance is now false for this one command. **The same pattern in `forge_request_for_task` (`forge.rs:125`) and `forge_open_request` (`forge.rs:233`) is Phase 7 code, accepted as tolerated then, and unchanged here.**
- **WR-02, `context_packet.rs:263`. CONFIRMED in code, and it is weaker than WR-01 as a defect but has one real hard-fail.** `assemble_context_packet` calls `resolve_review_target(conn, Task, task_id)` whenever a task has any anchored criterion (`context_packet.rs:262-271`), and `build_preview_dto` calls the assembler with the connection from `state.db.lock()` (`agent_run.rs:449`). Two separate points: (a) the spawn under the lock. `agent_run_preview` already runs git under the lock by Phase 4 design (`packet_extras_for`, "the ONE place a git call happens"), so Phase 8 added a few quick local reads to an existing pattern, not a new class of exposure. (b) The `?`/`.context(...)` on that call means a target-resolution failure (for example a vanished repo path, or a git error in the ancestry check) aborts packet assembly, so Start Work and the launch preview would fail for a task that has an anchored criterion, over what is only a staleness decoration. That is a real but narrow resilience defect on the agent-launch path, reachable only after the repo itself has gone missing. It does not block reviewing or landing work. **Fix is one line (`.ok()` and leave `anchor_staleness` as `None`), recommended as a small follow-up before the milestone closes.**

**2. WR-03 (no regression fence). WARNING, and the right one to fix first.** I confirmed `ipc_error` (`commands/mod.rs:34`) has no test, no source-scan test pins the absence of `e.to_string()` in the two command modules, and no test pins the nine renderer-parsed prefixes. My own scan finds zero `e.to_string()` / `format!("{e` in `commands/review.rs` and `commands/forge.rs` today, so CR-02 is closed now; nothing stops it reopening. This is the cheapest thing to add (one unit test plus one source scan, patterned on `supervisor_cwd.rs`/`forge_degrade.rs`). Not a goal blocker.

**3. Executor self-reports.** I did not rely on any SUMMARY. The three stale-fact reports (test floor, a missed lock hole, 52 vs 58 sites) all trace to plan-text drift, and the end state I checked in the code is the one that matters: no `e.to_string()` remains in either command module; `review_merge_precheck`, `review_merge_task`, `forge_open_epic_request` read as the split halves they claim; `forge_epic_request_draft` and the three review reads take the lock in a block-local scope. The one place a self-report overreaches is 08-11's "lock discipline closed": true for the eight bodies it listed, not for `forge_request_for_epic`, which it did not list.

**4. Known flake.** `core::worktree_lifecycle::a_worktree_survives_two_runs_with_an_epic` failed once and passed on three full runs plus isolated and single-threaded runs; `worktree_lifecycle.rs` is untouched across the phase range. Recorded as a pre-existing tmpdir race between parallel test binaries (it is the same file WINDOWS.md #2 already names for an unsynchronised `FLYWHEEL_WORKTREE_ROOT`), not a Phase 8 regression. Not a blocker.

**5. Coverage caveat.** The `credential` and `api_key` tests were skipped because they block on the macOS keychain unattended. That is a coverage gap in the supplied wave gate, not a pass. Neither area is touched by Phase 8, so it does not bear on this verdict.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/core/src/review.rs` | Scope resolution, staleness, criteria state, roll-up | VERIFIED | `epic_task_rollup` present, 6 tests pass; `review_target_inputs`/`finish_review_target` split present |
| `packages/core/src/merge.rs` | plan/run/record with a board-only half | VERIFIED | `plan_merge_inputs`/`finish_plan` used by both merge commands |
| `packages/core/src/forge/mod.rs`, `request_body.rs` | Epic draft and request, board-only and git halves | VERIFIED (one header claim now false, WR-01) | `epic_request_inputs`, `epic_request_blocker`, `epic_draft_inputs`, `finish_epic_request_draft` used by both epic commands |
| `packages/desktop/src-tauri/src/commands/{review,forge}.rs` | Ten review/forge commands, categorised errors | VERIFIED | Every `map_err` goes through `ipc_error` with a literal context or is a fixed sentence |
| `packages/desktop/src-tauri/src/commands/mod.rs` | `ipc_error` | VERIFIED (untested, WR-03) | Logs the cause chain, returns `failed:<context>` only |
| `packages/desktop/src/review/CriteriaRail.tsx` | Rail plus epic roll-up section | VERIFIED | Wired at `ReviewSurface.tsx:433` |
| `packages/desktop/src/state/keyboard.ts` | Activation guard, Escape `defaultPrevented` | VERIFIED | `keyboard.ts:311, 765` |
| Registration of `review_epic_task_rollup` | `main.rs`, capabilities roster, adapter | VERIFIED | `main.rs:225`; roster text names it; `tauri.ts:1429` |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| `ReviewSurface` | `CriteriaRail` | props `scope`, `itemId` (`ReviewSurface.tsx:433`) | WIRED |
| `CriteriaRail` | `review_epic_task_rollup` | `useEpicTaskRollup` -> `reviewEpicTaskRollup` -> `invokeCommand` | WIRED |
| `useEpicTaskRollup` | live updates | `subscribeBoardChanged` -> invalidate query | WIRED |
| `review_epic_task_rollup` | `review::epic_task_rollup` | one locked read, DTO map | WIRED |
| `MergeConfirmSheet` / `EpicRequestSheet` confirm buttons | their commands | native button activation now reaches `onClick` (tests) | WIRED |
| `review_merge_*` / `forge_*_epic_*` | core halves | lock block, then `finish_*`, then git | WIRED |
| `forge_request_for_epic` | forge detection | `forge_and_repo_path` under the lock | WIRED, with WR-01 |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
|---|---|---|---|---|
| Epic-scope task roll-up | `rollup` rows | SQL over `tasks` and `acceptance_criteria` and `criterion_anchors` | Yes, six core tests against a real SQLite | FLOWING (was DISCONNECTED) |
| `ReviewSurface` file list, `FileDiff` patch | `files`, patch | `git diff` through the split halves | Yes | FLOWING |
| `CriteriaRail` criteria and staleness | state | SQLite plus `rev-list` per read | Yes | FLOWING |
| `MergeConfirmSheet` preview | counts, conflicts | `finish_plan` plus `merge_tree_check` | Yes | FLOWING |
| `EpicRequestSheet` draft | title, body | `finish_epic_request_draft` over board and git | Yes | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Epic roll-up counts, scoping, ordering | `cargo test -p core --test criterion_anchors rollup` | 6 passed, 0 failed | PASS |
| Button activation survives review-surface bindings; rail roll-up renders only in epic scope | `npx vitest run src/review/__tests__/keyboard-activation.test.tsx src/review/__tests__/criteria-rail.test.tsx` | 2 files, 38 tests passed | PASS |
| No error text leaks via the two command modules | `grep -n 'e\.to_string()\|format!("{e'` on `commands/review.rs`, `commands/forge.rs` | no matches | PASS |
| Only one construction site for the git process | `grep 'Command::new("git")'` over core and src-tauri | `git.rs:44` only | PASS |
| Debt markers in phase-modified files | `grep -E '\b(TBD\|FIXME\|XXX)\b'` over every `.rs/.ts/.tsx/.sql` changed since 2bf4eb7 | none | PASS |
| Whole workspace | not re-run (supplied: `cargo build` clean; `cargo test --workspace --skip credential --skip api_key` 0 failed over three runs; vitest 51 files 765/765; `tsc` clean) | n/a | taken as input, one challenge-free |

### Probe Execution

No probes are declared by any plan and none are required. SKIPPED.

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|---|---|---|---|---|
| REVW-01 | 08-01, 08-04 | Review a task's full diff in-app with syntax highlighting | SATISFIED | SC1 |
| REVW-02 | 08-01, 08-04, 08-08, 08-09 | Review the accumulated diff of an epic's integration branch | SATISFIED | SC1; epic scope now also carries the task roll-up |
| REVW-03 | 08-02, 08-06 | Check off criteria against the diff | SATISFIED | SC2 |
| REVW-04 | 08-03, 08-07, 08-10, 08-11, 08-12 | Merge a task branch into its epic integration branch, conflicts surfaced | SATISFIED | SC3, P8 |
| REVW-05 | 08-05, 08-08, 08-10, 08-11, 08-12 | Open a PR/MR for an epic integration branch in one action | SATISFIED | SC4, P8 |

All five IDs appear in plan frontmatter (12 plans) and in `.planning/REQUIREMENTS.md` (lines 129-133 `[x]`, lines 306-310 "Complete"). REQUIREMENTS.md maps no other ID to Phase 8 (line 213 lists exactly these five). No orphaned requirements.

### Broken-Windows Ledger (`.planning/WINDOWS.md`)

- **Row 28 (the D-132 roll-up): CLOSED, verified.** Row status is `fixed`, `resolved_at 2026-10-06T07:12:00.016Z`. Frontmatter reads `open_count: 18`, `fixed_count: 10`, `total_count: 28`. I recounted the rows rather than trusting the header: 18 `open`, 10 `fixed`, 0 waived, 28 total. The header is internally consistent, and `git diff 6a90ad4..HEAD` on the file shows exactly the row 28 flip and the two counters. The fix is also true in the code (Truth P1), so this is a real closure, not a bookkeeping one.
- **Rows still open: 18, none from Phase 8.** Open ids: 1, 2, 4, 5 (phases 01-02), 11, 12 (03), 13-18 (05), 22-27 (07).
- **Does anything block `/gsd-ship`? Not at present, but it will the moment enforcement is switched on.** `workflow.windows_enforce` is a boolean with `default: false` in the capability registry and is not set in `.planning/config.json`, so the ship gate is currently not armed. If it is enabled, `open_count: 18 > 0` blocks `/gsd-ship` until each row is fixed or waived. Of those, the genuinely shippable-relevant ones are the unrun live checks: **#27** (live `gh pr create`/`glab mr create`, the same arm as my Human Verification item 4), **#13/#14/#16/#17** (Phase 5 product kill criterion and challenge quality), and **#11/#12** (live-session UAT flakiness). Rows #4, #5, #15, #18, #22-#26 are deviation notes that can be waived with a reason.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `packages/desktop/src-tauri/src/commands/forge.rs` | 428 | `forge_and_repo_path` (may spawn `git remote get-url origin`) under `state.db.lock()` | WARNING | Board freeze risk on a slow repo with no stored forge (review WR-01); header claims in `forge/mod.rs` and `commands/review.rs` are now untrue |
| `packages/core/src/context_packet.rs` | 262-271 | `resolve_review_target(..)?` under the lock via `agent_run_preview`; failure aborts packet assembly | WARNING | Narrow launch-path resilience hole when a task has anchored criteria and its repo path is unreadable (review WR-02) |
| `packages/desktop/src-tauri/src/commands/mod.rs` and both command modules | n/a | No test for `ipc_error`, the nine prefixes, or the split halves | WARNING | CR-01 and CR-02 have no regression fence (review WR-03) |
| `packages/desktop/src/review/CriteriaRail.tsx` | 27-39 | No `onError` on the check mutation | WARNING | A failed evidence write is silent (review WR-04) |
| `packages/desktop/src-tauri/src/commands/forge.rs` | 358-407 | No per-epic guard on `forge_open_epic_request` | WARNING | Two concurrent opens can push twice; the loser reports a false `PushedButNotOpened` (review WR-05) |
| `packages/core/src/forge/mod.rs` | ~423 | Every push failure labelled "rejected" | WARNING | Review WR-06 |
| `packages/desktop/src-tauri/src/commands/review.rs` | ~321 | Anchor sha is the head at click time, not at read time | WARNING | Staleness can read "Untouched" for code the reader did not see (review WR-07) |
| `packages/desktop/src-tauri/src/commands/forge.rs` | 369-390 | Confirm re-reads live board state | WARNING | Published body can differ from previewed (review WR-08); flagged for human decision |
| `packages/desktop/src-tauri/src/commands/review.rs` | 470-482 | Merge landed but event write failed has no repair path | WARNING | Review WR-09; task never shows integrated |
| `packages/desktop/src/review/MergeConfirmSheet.tsx` | 70-79 | Conflict brief bounded by file count, not characters; raw paths in prompt | WARNING | Review WR-10 |
| `packages/core/src/forge/request_body.rs` | 314-325 | Anchor paths written unescaped into a public request body | WARNING | Review WR-11 |
| (phase files) | n/a | `TBD`/`FIXME`/`XXX` | none found | Debt-marker gate clear |

None of these alters a ROADMAP success criterion. Five Info items (IN-01..IN-05) in 08-REVIEW.md are carried as notes.

### Prohibitions (judgment-tier, all NON-AUTHORITATIVE, human review recommended)

| Plan | Prohibition | Verdict | Flag |
|---|---|---|---|
| 08-01 | Diff must not silently truncate or omit | Per-file chunking exposes a visible "show more" control; no silent drop found | unverified-prohibition: confirm in the visual pass |
| 08-02 | Stale evidence never presented as current; staleness never unchecks | Staleness derived at read, no write path from it. WR-07 weakens the first half (anchor binds to head at click time) | unverified-prohibition: WR-07 |
| 08-03 | No half-merged state; no unverified outcome | Held (tests plus porcelain proof) | judged OK |
| 08-03 | Never move status | Held (grep) | judged OK |
| 08-05 | No force push | Held (grep) | judged OK |
| 08-06 | Evidence never attributed to an unselected range | Check is the only write path; selection is local | judged OK |
| 08-07 | No unverified outcome reported | Held for merged and conflict; WR-09 leaves "merged in git, event not recorded" with no repair | unverified-prohibition: WR-09 |
| 08-08 | Never publish text the reader did not see | Partially violated under concurrent change (WR-08) | unverified-prohibition: human decision requested |
| 08-09 | Roll-up never writes, never spawns git, takes an epic id only | Held: one `SELECT`, no `Command`, no write; command signature takes `epic_id` only | judged OK |

No test-tier prohibitions declared.

### Human Verification Required

See the `human_verification` block (six items). Compared with round one: item 2 now also covers reading the new roll-up against a real epic (it has only been rendered from mocked rows), and item 6 changes from "re-run after the CR-03 fix" to "prove the CR-03 fix in the real WebView", because the fix is proven in jsdom only.

### Gaps Summary

None. Both round-one gaps (D-132 roll-up, CR-03 keyboard activation) are closed and independently confirmed in code and by tests I ran; CR-01 and CR-02 are closed for every command the phase owns. The remaining items are warnings: WR-01 (one command still resolves a forge under the lock), WR-02 (the context packet resolves a review target under the lock and hard-fails on error), and WR-03 (nothing fences CR-01/CR-02 against regression) are the three worth a small follow-up plan, in that order of cheapness: WR-03 first (one unit test and one source scan), then WR-01 (use `stored_forge_and_repo_path`, detect after `drop(conn)`), then WR-02 (`.ok()` and leave staleness `None`). None blocks the goal. The phase can close once the six human checks are run, with the live-forge check (#27) the only one that retires a WINDOWS.md row.

---

_Verified: 2026-10-06T16:45:00Z_
_Verifier: Claude (gsd-verifier)_
