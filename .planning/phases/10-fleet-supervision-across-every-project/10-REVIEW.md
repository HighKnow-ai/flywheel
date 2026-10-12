---
phase: 10-fleet-supervision-across-every-project
reviewed: 2026-10-12T06:59:57Z
depth: standard
files_reviewed: 65
files_reviewed_list:
  - Cargo.lock
  - packages/core/src/db/migrations/0020_fleet.sql
  - packages/core/src/db/mod.rs
  - packages/core/src/domain/agent_run.rs
  - packages/core/src/domain/settings.rs
  - packages/core/src/domain/worktree.rs
  - packages/core/src/proc.rs
  - packages/core/src/query/fleet.rs
  - packages/core/src/query/mod.rs
  - packages/core/src/session_log.rs
  - packages/core/tests/fleet_perf.rs
  - packages/core/tests/fleet_query.rs
  - packages/core/tests/proc_timeout_boundary.rs
  - packages/core/tests/recovery_summary.rs
  - packages/core/tests/session_log_tail.rs
  - packages/core/tests/settings_notifications.rs
  - packages/core/tests/worktree_inventory.rs
  - packages/core/tests/worktree_reclaim.rs
  - packages/core/tests/worktree_size.rs
  - packages/desktop/src-tauri/Cargo.toml
  - packages/desktop/src-tauri/capabilities/default.json
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/fleet.rs
  - packages/desktop/src-tauri/src/commands/mod.rs
  - packages/desktop/src-tauri/src/commands/settings.rs
  - packages/desktop/src-tauri/src/main.rs
  - packages/desktop/src-tauri/src/menu.rs
  - packages/desktop/src-tauri/src/notify.rs
  - packages/desktop/src-tauri/src/scheduler.rs
  - packages/desktop/src-tauri/src/state.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/board/BoardView.tsx
  - packages/desktop/src/board/__tests__/board-pending-focus.test.tsx
  - packages/desktop/src/fleet/BlockedQueue.tsx
  - packages/desktop/src/fleet/FleetSurface.tsx
  - packages/desktop/src/fleet/WorktreeInventory.tsx
  - packages/desktop/src/fleet/__tests__/blocked-queue.test.tsx
  - packages/desktop/src/fleet/__tests__/fleet-activity.test.tsx
  - packages/desktop/src/fleet/__tests__/fleet-spend.test.tsx
  - packages/desktop/src/fleet/__tests__/fleet-surface.test.tsx
  - packages/desktop/src/fleet/__tests__/jump.test.tsx
  - packages/desktop/src/fleet/__tests__/watched-run.test.tsx
  - packages/desktop/src/fleet/__tests__/worktree-inventory.test.tsx
  - packages/desktop/src/fleet/__tests__/worktree-reclaim.test.tsx
  - packages/desktop/src/fleet/useFleet.ts
  - packages/desktop/src/fleet/useWatchedRun.ts
  - packages/desktop/src/item-detail/RunsSection.tsx
  - packages/desktop/src/legend/__tests__/legend.test.tsx
  - packages/desktop/src/legend/marks.ts
  - packages/desktop/src/legend/runStatus.ts
  - packages/desktop/src/projects/ProjectRail.tsx
  - packages/desktop/src/projects/__tests__/project-rail.test.tsx
  - packages/desktop/src/session/FeedRow.tsx
  - packages/desktop/src/session/PermissionRequestCard.tsx
  - packages/desktop/src/session/SessionSurface.tsx
  - packages/desktop/src/settings/NotificationsControl.tsx
  - packages/desktop/src/settings/SettingsSurface.tsx
  - packages/desktop/src/settings/__tests__/notifications.test.tsx
  - packages/desktop/src/state/__tests__/keyboard-agent.test.ts
  - packages/desktop/src/state/__tests__/keyboard-fleet.test.ts
  - packages/desktop/src/state/keyboard.ts
  - packages/desktop/src/state/uiStore.ts
  - packages/sidecar/src/claude-code-adapter.ts
  - packages/sidecar/test/adapter.test.mjs
findings:
  critical: 0
  warning: 11
  info: 7
  total: 18
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2026-10-12T06:59:57Z
**Depth:** standard
**Files Reviewed:** 65
**Status:** issues_found

## Summary

Production files got a full read. That covers `query/fleet.rs`, `session_log.rs`, `proc.rs`, `domain/worktree.rs`, `notify.rs`, `scheduler.rs`, `commands/fleet.rs`, the `agent_run.rs` changes, `capabilities/default.json`, the sidecar adapter diff, and the fleet, inventory, queue, rail and store code on the renderer side. Test files got a reliability pass (timing, determinism) and no more.

What held up under adversarial reading:

- **SQL.** `FLEET_SQL`, `BLOCKED_QUEUE_SQL`, the inventory SQL and the measure/ack statements are all literal `&str`s bound through `params![]`. The `concat!`/macro composition builds only from literals. No injection surface.
- **Lock scope in the new commands.** `fleet_list`, `worktree_inventory`, `worktree_measure` and `worktree_reclaim` release the mutex explicitly before any file read, walk or git call. `worktree_measure` re-takes it only for the cache write. `worktree_reclaim` uses its own connection with the pragmas applied.
- **Size walk.** It uses `symlink_metadata` on every entry, never descends into a symlink, bounds entries and depth, and refuses `..` and paths outside the worktree root. The paths come from `worktrees` rows, not from IPC.
- **Capability grant.** `default.json` grants nothing from the notification plugin, and a test pins that. The batch commands take ids only. `worktree_reclaim` refuses an oversized list as a whole.
- **Log tail.** `read_tail` is bounded to 256 KiB and 16 lines, and its fragment handling is correct. `session_log_path` is ULID-gated before any path join.

No finding reaches BLOCKER. The phase's "no mutex across a subprocess" property is **not** true repo-wide (WR-01). The reclaim's "final guard" has races it does not claim to close (WR-04, WR-05). Several things do not do what their comments or contracts say (WR-02, WR-03, WR-09, WR-11). One migration decision silently hides real work (WR-06). Two new timing tests are flaky by construction (WR-10).

## Warnings

### WR-01: The database mutex is still held across `git` subprocesses in the scheduler ticks

**Classification:** WARNING
**File:** `packages/desktop/src-tauri/src/scheduler.rs:130-188, 191-239, 350-414, 478-495`
**Issue:** The phase's stated property is that nothing holds `AppState.db` across a subprocess. These paths still do, and the `ponytail:` comment at 347-349 acknowledges one of them.

- `run_forge_tick` takes the lock at 482 and calls `forge_tick_targets(&conn)`, which calls `forge::forge_and_repo_path`. When `projects.forge` is NULL, that function runs `git remote get-url origin` via `detect_forge_from_origin`. NULL is the default, because the override is opt-in. So by default every forge tick spawns one git process per project while holding the app-wide mutex. The memoisation added in 10-02 bounds this to one per project per tick, not one per tick overall. Each spawn is allowed up to `GIT_TIMEOUT_SECS` (120 s). A project on a dead network mount or a wedged filesystem therefore freezes every Tauri command for up to 2 minutes per project, every tick.
- `run_hot_tick` and `run_cold_tick` hold the lock for the whole loop. Per task, `read_and_record_change` → `git_facts_for_task` runs `rev_parse_verify`, `git log`, `ahead_behind` and `last_fetch_at`, and `record_outside_commits` runs more git. This is pre-existing and documented, but it contradicts the invariant this phase was asked to verify. The new `fleet_list` and `fleet_blocked_queue` commands, and the rail's blocked-count query, block on exactly this mutex.

The private half already exists: `forge::stored_forge_and_repo_path` (`core/src/forge/mod.rs:179`) does the board-only read and spawns nothing.

**Fix:** In `forge_tick_targets_with`, resolve only the stored half under the lock. Carry `Option<Forge>` plus `repo_path` in `ForgePollTarget`. Run `detect_forge_from_origin(&repo_path)` in `poll_forge_targets`, which already runs lock-free. For the hot and cold tiers, collect `(task_id, worktree facts inputs)` under the lock and compute the git facts after `drop(conn)`, as `board_change_flags` does.

### WR-02: `output_with_timeout` can block past its deadline on the normal-exit path; its comment says it cannot

**Classification:** WARNING
**File:** `packages/core/src/proc.rs:99-111`
**Issue:** On a normal exit the function joins the stdout and stderr reader threads (109-110) with no bound. The comment at 101-102 says the join waits "never past this function's own deadline watch". That is false whenever the direct child exits but a descendant keeps a pipe's write end open. Typical cases are `git fetch` over ssh with `ControlPersist`, a credential helper, or a daemonised `gc --auto` or fsmonitor. `read_to_end` then never sees EOF. The `None` (timeout) arm correctly abandons the threads, but the `Some(status)` arm does not. `run_fetch_tick` runs `git fetch origin` through this function on a scheduler worker, so a single persistent ssh master hangs that tick forever, and the cron job never completes again. The 10-xx change to this file only reordered the clock read and left this untouched.

**Fix:** Bound the post-exit drain. Run the readers as threads that send on an `mpsc` channel and use `recv_timeout(remaining)`, where `remaining = timeout.saturating_sub(start.elapsed())` with a small floor. On drain timeout, return what was collected so far (or `TimedOut`), and drop the handles as the kill arm does.

### WR-03: "Re-measure sizes" can never reach worktrees past the 200th; silent truncation

**Classification:** WARNING
**File:** `packages/desktop/src-tauri/src/commands/fleet.rs:296, 320-331`; `packages/core/src/query/fleet.rs:480-505`
**Issue:** The inventory lists up to `WORKTREE_INVENTORY_CAP` = 500 rows. The UI's Re-measure button calls `worktreeMeasure()` with no ids, which becomes `task_ids = None`. That path reads `SELECT task_id, path FROM worktrees ORDER BY id ASC LIMIT 200`, where `WORKTREE_MEASURE_CAP` = 200. Rows 201-500 have no way to get a size, and never will. The reclaim bar then reports them as "not measured". With an explicit id list, `ids.iter().take(limit)` drops the tail silently: no error, and no outcome row for the dropped ids. The caller cannot tell "skipped" from "had no worktree row".

**Fix:** Make the two caps agree (`WORKTREE_MEASURE_CAP = WORKTREE_INVENTORY_CAP`), or, better, order the `None` case by `size_measured_at ASC NULLS FIRST` so repeated presses make progress through the whole set. For the `Some` case, refuse an over-cap list as a whole, as `check_reclaim_batch` does, or return an explicit skipped outcome.

### WR-04: Reclaim's eligibility check and the removal are separated by git calls with no live-run re-check

**Classification:** WARNING
**File:** `packages/core/src/domain/worktree.rs:916-943` (calls `remove_worktree_for_task`, 240-317)
**Issue:** The live-run clause is evaluated when `worktree_inventory_input_for_task` reads the board (916). After that come `merge_commit_is_reachable` (two git spawns), a `git status --porcelain` and then `remove_worktree_for_task`, which runs another porcelain and then `git worktree remove`. Together these take tens of milliseconds to seconds per row, and nothing is locked. In that window the user can press Start Work on a Done task, or a restart flow can launch into the existing worktree row. `ensure_worktree` hands back the existing row, and the agent starts in that directory. The "final guard" is only the dirty check, and a freshly started agent has written nothing yet, so the tree is clean. The directory is then deleted under a live session. The doc comment (900-902) and the inventory say a stale selection "is refused"; that holds only up to the first read, not at the moment of removal.

**Fix:** Re-run the live-run query immediately before `git::worktree_remove`, inside `remove_worktree_for_task` or via a small `fn live_run_exists(conn, task_id)` called just before it. That does not close the window completely, but it shrinks it from seconds to microseconds. For full closure, take the shared mutex only for the check-and-mark step. Or record a "reclaiming" marker that `agent_run_start` refuses against.

### WR-05: Removal is not atomic across git and the database, and the new second writer connection makes the bad case reachable

**Classification:** WARNING
**File:** `packages/core/src/domain/worktree.rs:271-315`; `packages/desktop/src-tauri/src/commands/fleet.rs:426-435`
**Issue:** There are two independent hazards.

1. `remove_worktree_for_task` runs `git worktree remove` (271) and only then opens the DB transaction (275). `git` goes through `output_with_timeout` with a 120 s ceiling. For a large tree (`node_modules`, `target/`), a timeout kills `git` partway through deleting. The directory is now half-removed. `git status` then reports deleted tracked files, so the row is classified `uncommitted_changes` → Keep and can never be reclaimed again by this feature. The `worktrees` row stays `active`. Reclaim runs up to 50 of these in a batch, so a slow disk makes this likely rather than theoretical.
2. If `git worktree remove` succeeds but the DB transaction then fails (e.g. a `SQLITE_BUSY` after the 5 s busy timeout), the directory is gone and the row remains. Before this phase the app had one writer connection. `worktree_reclaim` now opens a second, concurrent writer (`Connection::open` at 429) while the shared connection keeps serving commands and sidecar events. Other write paths here (for example `set_task_status`) begin a deferred transaction with a read and then upgrade to a write. If the reclaim connection commits in between, the upgrade fails with `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout` does not retry.

**Fix:** For (1), do not treat a timeout as "nothing happened". After an error from `worktree_remove`, re-stat the path and report "partially removed" so the row is not silently stuck. A longer, per-call ceiling for removals would also help. For (2), have the reclaim connection use `transaction_with_behavior(TransactionBehavior::Immediate)` (as `file_set.rs:460` already does), and make the shared-connection paths that read before they write use the same behaviour. Surface "directory removed, record not updated" as its own outcome.

### WR-06: The 0020 backfill silently removes every historic "awaiting review" run from the fleet on first launch

**Classification:** WARNING
**File:** `packages/core/src/db/migrations/0020_fleet.sql:25-28`
**Issue:** The `UPDATE` acknowledges every `completed`, `failed` and `interrupted` run in history, regardless of what its task looks like now. A `completed` run whose task is still `in_review` is exactly what the fleet's derived `awaiting_review` state (D-168) exists to surface. After upgrade, all of them are acknowledged and vanish from the NEEDS YOU band, while the user's actual review backlog is still open on the board. The migration comment frames this purely as flood prevention (Pitfall 1) and never mentions that it also discards the signal the feature was built to show. The statement is also not reversible: it can't distinguish a user's dismissal from a backfill. The pre-migration backup is the only way back.

**Fix:** Limit the backfill to runs that would not be shown for a legitimate reason. For example, add `AND (task_id IS NULL OR task_id IN (SELECT id FROM tasks WHERE status = 'done') OR id <> (SELECT ar2.id FROM agent_runs ar2 WHERE ar2.task_id = agent_runs.task_id ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1))`. That leaves "latest completed run of a not-done task" unacknowledged, which is a small set and the right one. If hiding is intended, state it in the migration comment and in the phase's honest-reporting artifacts.

### WR-07: The notification banner copies the first 60 characters of a tool's command into the OS notification centre

**Classification:** WARNING
**File:** `packages/desktop/src-tauri/src/notify.rs:108-126, 251`
**Issue:** `target_of` picks `command` (or `file_path`/`path`/`url`/`pattern`) from the tool input. `banner_body` caps it at `TARGET_CAP` = 60 characters and hands it to `app.notification().builder().body(..).show()`. The comment says this keeps the "full input" off the notification centre, but a capped command is still a command. `export GH_TOKEN=ghp_…`, `curl -H "Authorization: Bearer …"` and `psql postgres://user:pass@…` all put their secret inside the first 60 characters. The banner is shown on the lock screen by default, retained by macOS notification history, and the feature is on by default (`DEFAULT_NOTIFICATIONS_ENABLED = true`). The "credentials must never leave the desk" constraint is about network egress, so this is not a violation of it, but it is a new local disclosure channel.

**Fix:** Show the tool name only by default (`"Bash"`, `"Edit"`). If a target is wanted, restrict it to path-like fields and show `basename` only, or make target text a separate, default-off setting. At minimum, redact `://user:pass@`, `Bearer …`, `token=`/`key=`/`secret=` patterns before capping.

### WR-08: The notify loop makes blocking calls on a tokio worker

**Classification:** WARNING
**File:** `packages/desktop/src-tauri/src/notify.rs:196-217, 234-256`
**Issue:** `spawn_notify_task` runs on the async runtime. Every 500 ms it calls `tick`, which, when a window is due, takes `db.lock()` (a blocking `std::sync::Mutex`) on the worker thread. Given WR-01, that mutex can be held for up to 120 s by a scheduler tick, so the worker is parked for that long. It also calls the synchronous `.show()` inline. The module's own header (BURST_BOUND comment, "Pitfall 5") says a macOS banner can park a thread, yet nothing moves it off the async worker. The scheduler's own dispatch job uses `spawn_blocking` for exactly this reason (scheduler.rs:616).

**Fix:** Run the due-check and the `show()` inside `tauri::async_runtime::spawn_blocking`. Alternatively, read the notification switch into an `AtomicBool` that the settings command updates, so `tick` needs no DB lock at all.

### WR-09: `agent_run_acknowledge_many` hides truncation and write errors, and the UI throws away the result

**Classification:** WARNING
**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:2071-2090`; `packages/desktop/src/fleet/FleetSurface.tsx:371, 417-419`
**Issue:** Three problems add up to Dismiss being able to fail without anyone noticing.

- `.take(ACKNOWLEDGE_MANY_CAP)` drops everything past 200 with no error and no result row. The sibling reclaim command refuses an over-cap list instead; this one behaves differently.
- `acknowledge_run(...).unwrap_or(false)` turns a real DB error (locked, I/O) into `acknowledged: false`. That is the same value as "already acknowledged" or "run is live", so the caller cannot tell them apart.
- The renderer discards the returned per-id results, and `.catch(() => {})` swallows both this and the single-run Dismiss failure (371, 418). A failed dismiss leaves the row on screen with no message at all.

**Fix:** Refuse an oversize list (mirror `check_reclaim_batch`) or return a `skipped` outcome per dropped id. Distinguish `error` from `not_acknowledged` in `AcknowledgeResultDto`. In the UI, show a `role="status"` notice when any result is `false` because of an error, or when the call rejects.

### WR-10: Two new timing-based tests are flaky by construction

**Classification:** WARNING
**File:** `packages/core/tests/proc_timeout_boundary.rs:20-45`; `packages/core/tests/fleet_perf.rs:20, 142-145`
**Issue:**

- `a_child_exiting_*_just_before_its_deadline_*` runs `sh -c "sleep 0.2; ..."` against a 250 ms deadline, ten times. The margin is 50 ms, and it has to cover fork+exec of `sh`, fork+exec of `sleep`, a 50 ms poll granularity and scheduler jitter. On a loaded CI runner or a laptop under a parallel `cargo test`, the child legitimately outlives the deadline. The function then correctly reports `TimedOut` and the test fails for a reason unrelated to the code under test. The ordering the test is meant to pin is a few instructions wide and cannot be hit this way; the file's own header concedes that.
- `the_fleet_read_at_5000_runs_is_under_budget_and_uses_the_index` asserts a 50 ms wall-clock budget on a debug build over a cold connection. The query-plan assertions in the same test already prove the property (no scan, index used). The wall-clock one will fail on slow or contended machines.

**Fix:** For the proc test, scale the sleep and deadline apart (for instance `sleep 0.05` against a 1 s deadline), which still exercises the exit-before-deadline path. For the perf test, keep the plan assertions, and either gate the timing on an env var or widen the budget to a generous multiple and print the number.

### WR-11: `record_worktree_size` returning `false` is reported as a successful cache write

**Classification:** WARNING
**File:** `packages/desktop/src-tauri/src/commands/fleet.rs:351-357`; `packages/core/src/query/fleet.rs:509-522`
**Issue:** `record_worktree_size` returns `Ok(false)` when no row was updated, for example because the worktree was reclaimed or forgotten while the walk ran. The command matches `Ok(_)` and returns `size_bytes: Some(bytes), error: None`. The renderer is told a size was cached for a worktree that no longer exists. The doc comment on the function promises "Returns whether a row was updated", but the one caller ignores it.

**Fix:**
```rust
match record_worktree_size(&conn, &task_id, bytes, &measured_at) {
    Ok(true)  => WorktreeMeasureDto { task_id, size_bytes: Some(bytes), bounded: false, error: None },
    Ok(false) => WorktreeMeasureDto { task_id, size_bytes: None, bounded: false, error: Some("worktree no longer exists".into()) },
    Err(e)    => WorktreeMeasureDto { task_id, size_bytes: None, bounded: false, error: Some(e.to_string()) },
}
```

## Info

(Classification for each item below: WARNING, low severity. They are listed separately because none is a defect in intended behaviour.)

### IN-01: Split assistant events repeat the full `raw` line on every event

**File:** `packages/sidecar/src/claude-code-adapter.ts:1120-1137, 1150-1170`
**Issue:** `normaliseStreamEvents` builds each per-block event with `normaliseStreamEvent(..., raw, ...)`, so a line with N text/tool_use blocks yields N events that each carry the whole original line in `raw`. The Rust reader appends every event to the JSONL log, so a large multi-block line is stored and shipped N times. It also eats into `read_tail`'s 256 KiB window, which makes the fleet's "nothing readable" case likelier. Behaviour is otherwise correct, and parallel `tool_use` blocks are now no longer silently dropped.
**Fix:** Keep `raw` on the first event only (`index === 0 ? raw : ""`), or reference the sibling by `seq`.

### IN-02: The size walk's root check is lexical; an intermediate symlink is followed

**File:** `packages/core/src/domain/worktree.rs:822-837`
**Issue:** `path.starts_with(&root)` compares components without resolving them. `symlink_metadata(path)` only protects the final component. If `<root>/<PREFIX>` is a symlink, `<root>/<PREFIX>/<KEY>` passes the check and `read_dir` walks outside the root. The path comes from the DB rather than IPC, so this needs local write access to `~/Flywheel`, and the effect is a disk-size read, not a write. `worktree_remove` in `git.rs` has the same lexical check.
**Fix:** `std::fs::canonicalize` the parent directory and the root, and compare those. Return an error if canonicalisation fails.

### IN-03: Subscription setup in `useFleet` and the watched-run effect have unhandled rejections

**File:** `packages/desktop/src/fleet/useFleet.ts:98-112`; `packages/desktop/src/fleet/useWatchedRun.ts:22`
**Issue:** `subscribeBoardChanged(...).then(...)` and `subscribeAgentEvent(...).then(...)` have no `.catch`. If `listen` rejects, the result is an unhandled rejection and a fleet that never refreshes, with no indication. `Promise.resolve(fleetWatchRun(watched))` only helps for a returned promise; a synchronous throw from the wrapper would escape the effect.
**Fix:** Add `.catch(() => {})` on the subscriptions, and wrap the call as `void fleetWatchRun(watched).catch(() => {})` (the wrapper is `async`, so it never throws synchronously).

### IN-04: A coalesced "is blocked" banner can announce a block that was already answered

**File:** `packages/desktop/src-tauri/src/notify.rs:161-181, 196-217`
**Issue:** `take_due` filters only by suppression. A request answered inside the 3 s window (from the queue, the session, or by an auto-rule) still produces a "… is blocked" banner when the window closes. This is minor but erodes trust in the one notification that is supposed to mean "come now".
**Fix:** In `tick`'s `keep` closure for `Blocked`, check that the run still has a pending request (one indexed query under the lock `tick` already takes).

### IN-05: The rail's "Needs decision" count is per-project but opens the cross-project fleet

**File:** `packages/desktop/src/projects/ProjectRail.tsx` (the `recoveryCount` button, ~line 290-310)
**Issue:** `recoveryCount` comes from `useRecoverySummary(currentProjectId)`, so it counts the current project only, but the button opens the fleet list, which spans every project. The "Blocked" figure was made fleet-wide in this phase while the neighbouring figure was not. The header comment states this, but a user sees "Needs decision 2" and then a NEEDS YOU band with a different number.
**Fix:** Either derive the count from the fleet read (needs-you band size), or label it "this project".

### IN-06: Queue head can change between a glance and an `a` keypress

**File:** `packages/desktop/src/fleet/BlockedQueue.tsx:67-118`
**Issue:** Exactly one card owns `a`/`d`/`Shift+A`, the first in queue order. The list refetches on every `board:changed` and `agent:event` burst. If the head request disappears between render and keypress (run stopped, answered elsewhere, auto-rule), the key lands on what is now the head, which is a different agent's request. `answer` is dispatched against the rendered request id, so it does not mis-target silently, but the user's intent was formed against the previous head. Destructive requests keep the Deny-leading variant, which limits the blast radius.
**Fix:** Pin the owner by request id once focused, and move ownership only on an explicit keypress or when the pinned request resolves, so ownership never moves under a key already in flight. Or briefly disable the owner's keys for ~250 ms after the head changes.

### IN-07: Duplicated caps and a 25 KB prose roster in the capability file

**File:** `packages/desktop/src/fleet/WorktreeInventory.tsx:102` and `packages/desktop/src-tauri/src/commands/fleet.rs:368` (50); `packages/desktop/src-tauri/capabilities/default.json:4`
**Issue:** `RECLAIM_BATCH_CAP = 50` exists in Rust and TypeScript with no link between them. `default.json`'s `description` is now a ~25 KB single-line prose roster. It is the only place that lists every command, and nothing checks it against `generate_handler!`, so it will drift. The one machine-checked thing, the no-notification-permission test, parses `permissions` only.
**Fix:** Have `settings_get` or a small `fleet_limits` read expose the cap, or at least add a test that greps both constants. Move the roster into a checked-in doc, and keep the description to a sentence plus a pointer.

---

_Reviewed: 2026-10-12T06:59:57Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
