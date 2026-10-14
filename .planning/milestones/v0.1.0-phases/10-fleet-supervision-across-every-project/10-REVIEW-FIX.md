---
phase: 10-fleet-supervision-across-every-project
fixed_at: 2026-10-12T16:00:00Z
review_path: .planning/phases/10-fleet-supervision-across-every-project/10-REVIEW.md
iteration: 1
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
---

# Phase 10: Code Review Fix Report

**Fixed at:** 2026-10-12
**Source review:** `.planning/phases/10-fleet-supervision-across-every-project/10-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 11 (0 Critical, 11 Warning; Info findings IN-01..IN-07 are out of scope)
- Fixed: 11 (WR-01, WR-04 and WR-05 only in part; see "Open items")
- Skipped: 0

**Where verification ran:** the main checkout. `workflow.use_worktrees` is `false` in
`.planning/config.json`, so no worktree, temp branch or recovery sentinel was created; every
commit landed directly on `cymarechal-devoteam/gsd-new-project-ade`. The numbers below are
reproducible from the tree you are looking at.

**Verification:** per-fix targeted `cargo test` runs, plus a full `npx vitest run` in
`packages/desktop` (1431 passed, up from the 1428 baseline: 3 new tests, none removed or
weakened). `cargo test --workspace --no-fail-fast` result is at the end of this file.

## Fixed Issues

### WR-07: The notification banner copied a tool's command into the OS notification centre

**Files modified:** `packages/desktop/src-tauri/src/notify.rs`, `packages/desktop/src-tauri/src/commands/agent_run.rs`
**Commit:** 87e7e60
**Applied fix:** Removed the target text outright rather than redacting it. `Transition.tool` is now
`Option<String>` (the tool NAME only), `banner_body` takes the name alone, and `target_of`,
`TARGET_CAP` and the `input` parameter of `permission_transition` are deleted, so nothing from a
tool's input can reach the banner by construction. The banner still fires and still says which agent
is blocked (project, subject, "is blocked" plus the tool name), which is all FLEET-05 / ROADMAP
criterion 4 asks for. Tests: the two body tests that asserted a capped command appears were replaced
by tests asserting the body is the name alone and that a blocked banner never carries the input. The
old assertion that `target_of` ignores a `TOKEN` field no longer has a subject, because the function
is gone.
**Residual:** none known for this channel. The tool name itself is not treated as secret.

### WR-06: The 0020 backfill hid every historic "awaiting review" run

**Files modified:** `packages/core/src/db/migrations/0021_fleet_review_backlog.sql` (new), `packages/core/src/db/mod.rs`, `packages/core/tests/fleet_query.rs`, `packages/core/tests/fleet_perf.rs`
**Commit:** 4fffbea
**Applied fix:** Fixed for existing installs, not only fresh ones. Migration 0020 has already run on
the local database, so editing it would have changed nothing there. 0020 is left untouched and a new
migration, 0021, repairs rows it already wrote: it sets `acknowledged_at = NULL` on a run that is
`completed`, has a task that is not `done`, is the latest run of that task, and whose
`acknowledged_at` equals `COALESCE(ended_at, started_at)` exactly. That equality is how a backfilled
row is told from a person's dismissal, because `acknowledge_run` stamps the wall-clock time of the
dismissal. Older runs, `failed` / `interrupted` history, runs of `done` tasks and anything a person
dismissed stay hidden. On a fresh database it touches no rows.
**Consequence you should expect:** on first launch of this build, every task still in review that
has a completed run will reappear in the NEEDS YOU band as "awaiting review". That is the backlog the
fleet exists to show, but it is a real change to what you see, and the number could be large if the
board holds many old in-review tasks. The pre-migration backup is the way back.
**Test changes (disclosed):** `fleet_perf.rs` seeded its 500 "historic" runs AFTER the per-task runs,
which made the `completed` ones the latest run of in-review tasks. Under the corrected contract
those legitimately come back, so the fixture now seeds them first (oldest, as real history is). The
assertions are unchanged; the restored case is pinned by a new test,
`migration_0021_restores_the_review_backlog_0020_swallowed_and_nothing_else`. The 0020 test in
`fleet_query.rs` passes unchanged.
**Status:** fixed: requires human verification (it is a data-selection rule; the equality heuristic
for "backfilled, not dismissed" is the part to confirm).

### WR-01: The database mutex was held across `git remote get-url origin` in the forge tick

**Files modified:** `packages/core/src/forge/mod.rs`, `packages/desktop/src-tauri/src/scheduler.rs`
**Commit:** f3742fe
**Applied fix:** `forge_tick_targets` now reads only `stored_forge_and_repo_path` (made `pub`) under
the lock, which spawns nothing. `ForgePollTarget.forge` is `Option<Forge>`, and
`poll_forge_targets`, which already ran lock-free, runs `detect_forge_from_origin` for the `None`
case, memoised per repo path so a project still costs one spawn per tick. The lock-drop boundary is
the same one the phase already used: read under the lock, drop, then do the process work. The
`ponytail:` comment that recorded the deferral is removed. A new test pins that a NULL
`projects.forge` yields a target with `forge == None` (detection deferred). The scheduler tests (9)
pass.
**Partial:** only the forge tick was changed. The hot and cold tier ticks still hold the lock while
`git_facts_for_task` / `record_outside_commits` run git per task. That is the larger restructuring
the reviewer describes (collect inputs under the lock, compute facts after `drop(conn)`), it is
pre-existing and documented, and I did not take it in this pass. The phase's "no mutex across a
subprocess" property is therefore still not true repo-wide.

### WR-02: `output_with_timeout` could block past its deadline on the normal-exit path

**Files modified:** `packages/core/src/proc.rs`, `packages/core/tests/proc_timeout_boundary.rs`
**Commit:** 6021264
**Applied fix:** The stdout/stderr readers now append into shared buffers and signal completion on a
channel. After the direct child exits, the drain waits at most what is left of the deadline (never
less than a 500 ms floor) and returns what was read, with the child's real exit status. A reader
still blocked on a descendant-held pipe is left behind, as the kill arm already did. The stdin
writer thread is no longer joined. A new test starts `sleep 5 &` inside a shell that exits at once
and asserts the call returns with `hi` and status 0 in well under the sleep. The subprocess,
removal, forge and supervisor tests pass.
**Behaviour note:** a successful `git fetch` that leaves an ssh master holding a pipe now returns
success with the output read so far, not a timeout.

### WR-10: Two timing-based tests were flaky by construction

**Files modified:** `packages/core/tests/proc_timeout_boundary.rs`, `packages/core/tests/fleet_perf.rs`
**Commit:** 60ba962
**Applied fix:** The two near-deadline proc tests now sleep 50 ms against a 1 s deadline (they still
exercise the exit-before-deadline path, without a margin that scheduler jitter can eat). The
fleet perf test keeps both query-plan assertions (index used, no scan). The 50 ms UI-SPEC figure is
now a reported target and the asserted wall-clock ceiling is 500 ms; the measured number is printed
(7 ms on this machine).
**Note:** the near-deadline proc tests no longer sit near the deadline, so they pin "exit before the
ceiling reports the real status" rather than the few-instruction race, which their own header
already said no test can force.

### WR-11: `record_worktree_size` returning `false` was reported as a successful cache write

**Files modified:** `packages/desktop/src-tauri/src/commands/fleet.rs`
**Commit:** 2e26c14
**Applied fix:** Applied as the reviewer suggested. `Ok(false)` now returns `size_bytes: None` and
`error: Some("worktree no longer exists")`. No new test: the command takes Tauri `State`, and the
core function's `Ok(false)` behaviour is already pinned in `tests/worktree_size.rs`.

### WR-03: "Re-measure sizes" could never reach worktrees past the 200th

**Files modified:** `packages/core/src/query/fleet.rs`, `packages/desktop/src-tauri/src/commands/fleet.rs`, `packages/core/tests/worktree_size.rs`
**Commit:** e29d52b
**Applied fix:** Took the reviewer's "better" option rather than raising the cap. Measure-all orders
`size_measured_at ASC, id ASC` (SQLite sorts NULL first, so never-measured, then stalest), so each
press advances through the set. The measure cap stays 200 on purpose, to bound one call's walking
time, and the comment says so. An explicit id list over the cap is now refused as a whole with an
error instead of being cut off silently. New test:
`measure_all_over_the_cap_takes_the_never_measured_then_the_stalest`.
**Known limit:** a worktree whose walk is always bounded is never cached, so it stays NULL and stays
at the front of the order. A handful of those would crowd the head of each press. Not addressed.

### WR-04: Reclaim's eligibility check and the removal were separated by git calls with no live-run re-check

**Files modified:** `packages/core/src/domain/worktree.rs`, `packages/core/tests/worktree_reclaim.rs`
**Commits:** 207d450 (shared with WR-05), then ccb65d2 (scope correction)
**Applied fix:** A new `remove_worktree_for_task_refusing_live_run` re-queries for a `running` /
`blocked` run on the task or the worktree immediately before `git worktree remove` and refuses if
one exists. `reclaim_worktrees` calls it. Test:
`the_reclaim_removal_refuses_a_worktree_a_run_started_in_after_the_eligibility_read`.
**Scope correction (what went wrong first):** my first commit (207d450) put the check inside
`remove_worktree_for_task` itself. The full workspace run then failed two tests in
`task_delete_with_run_history.rs`, which remove a worktree whose run is still recorded as
`running` through the single-worktree remove. That check was a behaviour change to a different
feature, not part of the finding, so ccb65d2 moved it into the reclaim-only variant. The original
`remove_worktree_for_task` is back to its previous behaviour and those tests pass unmodified.
**Status:** fixed: requires human verification, and **partial by nature**. This shrinks the window
from seconds to the gap between that query and the `git` call; it does not close it. Full closure
needs a "reclaiming" marker that `agent_run_start` refuses against, or holding the shared mutex for
the check-and-mark step. Neither was done. The single-worktree remove has no such re-check.

### WR-05: Removal is not atomic across git and the database

**Files modified:** `packages/core/src/domain/worktree.rs`, `packages/core/tests/worktree_reclaim.rs`
**Commit:** 207d450 (the `Immediate` transaction, the on-disk wording and the post-removal error message; unaffected by ccb65d2)
**Applied fix, in part:**
1. A `git worktree remove` that errors or times out now re-stats the path and the error says either
   "the directory still exists and may be partially deleted" or "the directory is gone but git
   reported an error, so the worktree record was kept". The existing failed-removal test asserts the
   wording. This makes the stuck half-removed case visible; it does not make such a row reclaimable
   again, and no longer ceiling for removals was added (the 120 s git ceiling still applies).
2. The bookkeeping transaction moved into `record_worktree_removed` and takes the write lock up
   front (`TransactionBehavior::Immediate`), and a failure there surfaces as "the worktree directory
   was removed but its record was not updated".
**Not done:** the reviewer's second recommendation, to make the shared-connection read-then-write
paths (for example `set_task_status`) use `Immediate` too. The `SQLITE_BUSY_SNAPSHOT` hazard is on
THEIR side when the reclaim connection commits between their read and their write, so the reclaim
change alone does not remove it. That is a sweep across the domain layer and I did not make it.
**Status:** fixed: requires human verification (partial, as above).

### WR-08: The notify loop made blocking calls on a tokio worker

**Files modified:** `packages/desktop/src-tauri/src/notify.rs`
**Commit:** f435835
**Applied fix:** The async loop only checks `Coalescer::is_due` (a brief in-memory lock). The
database read, focus read and synchronous `.show()` moved into `show_due_banner`, run through
`tauri::async_runtime::spawn_blocking` only when a window is due. No unit test: the loop needs a
live `AppHandle`; the extracted decision functions (`tick`, `take_due`) keep their 17 existing
tests.

### WR-09: `agent_run_acknowledge_many` hid truncation and write errors, and the UI discarded the result

**Files modified:** `packages/desktop/src-tauri/src/commands/agent_run.rs`, `packages/desktop/src/adapters/tauri.ts`, `packages/desktop/src/fleet/FleetSurface.tsx`, `packages/desktop/src/fleet/__tests__/fleet-spend.test.tsx`
**Commit:** 5fb07e3
**Applied fix:** The command body is now `acknowledge_many`: an over-cap list is refused as a whole
before anything is written (mirroring `check_reclaim_batch`), and `AcknowledgeResultDto` gained
`error`, set when the write itself fails, so a failed dismiss is distinguishable from "already
acknowledged / unknown / live". The fleet shows a `role="status"` notice when a single Dismiss
rejects, when a batch rejects, or when any batch result carries an `error`. A benign
`acknowledged: false` with no error shows nothing. Tests: two Rust (over-cap refusal writes nothing;
unknown id vs real write error) and three vitest cases.

## Skipped Issues

None. No in-scope finding was skipped. Info findings IN-01..IN-07 were out of scope for this run.

## Open items worth your attention

- **WR-01** hot/cold tier ticks still hold the mutex across git (unchanged, pre-existing).
- **WR-04** window narrowed, not closed.
- **WR-05** shared-connection deferred transactions still exist; the half-removed-tree row can still
  not be reclaimed through this feature, only diagnosed.
- **WR-06** will change what you see on first launch (restored "awaiting review" rows).

## Full-suite verification

`cargo test --workspace --no-fail-fast` on HEAD (ccb65d2): 1555 tests passed, 0 failed, across 118
test binaries. `npx vitest run` in `packages/desktop`: 1431 passed. A first full run (before
ccb65d2) had stopped at the two `task_delete_with_run_history` failures described under WR-04; the
run above is the one after that was corrected, and was run with `--no-fail-fast` so nothing after a
failure could be skipped.

---

_Fixed: 2026-10-12_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
