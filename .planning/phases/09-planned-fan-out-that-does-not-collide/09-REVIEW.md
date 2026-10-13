---
phase: 09-planned-fan-out-that-does-not-collide
reviewed: 2026-10-10T00:00:00Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - packages/core/src/dispatch.rs
  - packages/core/src/domain/dispatch_plan.rs
  - packages/core/src/domain/file_set.rs
  - packages/core/tests/dispatch_auto_merge.rs
  - packages/core/tests/dispatch_plan.rs
  - packages/core/tests/scope_widen.rs
  - packages/desktop/src-tauri/src/commands/agent_run.rs
  - packages/desktop/src-tauri/src/commands/dispatch.rs
  - packages/desktop/src-tauri/src/commands/file_set.rs
  - packages/desktop/src/App.tsx
  - packages/desktop/src/adapters/tauri.ts
  - packages/desktop/src/dispatch/WavePlanSheet.tsx
  - packages/desktop/src/dispatch/__tests__/wave-plan-sheet.test.tsx
  - packages/desktop/src/launch-sheet/LaunchSheet.tsx
  - packages/desktop/src/launch-sheet/__tests__/launch-sheet.test.tsx
findings:
  critical: 0
  warning: 5
  info: 5
  total: 10
status: issues_found
---

# Phase 9: Code Review Report (gap-closure plans 09-10 to 09-13)

**Reviewed:** 2026-10-10
**Depth:** standard
**Files Reviewed:** 15
**Status:** issues_found

## Summary

Scope was the diff `540f296..af4cf1a` over the 15 files, read against the five stated invariants.

Invariants that hold:
- `launch_conflict` is the single comparison. `readiness` and `prepare_launch` both call it, and no second copy of the overlap or containment loop exists.
- All correctness-bearing reads in the new code go through `list_entries_for_task` and `in_flight_sets`. None read the marker file.
- The widen's entry, `file_set_widened` event, edge and `task.sequenced` event are written in one `IMMEDIATE` transaction. The injected-trigger test proves the rollback. The "already explained" skip covers both edge orientations, so the `UNIQUE` index cannot abort a scope grant.
- `dispatch.rs` stays pure: no sleep, spawn or process construction was added.
- A launch refused by `launch_conflict` creates no `agent_runs` row, because the check runs before `start_agent_run_recording_first`. The database lock is held across check and insert, so the re-check is atomic with the insert.
- CR-01 and CR-02 from the prior review have not regressed.

The defects below are lifecycle and consistency holes around those invariants. None is a security issue.

## Warnings

### WR-01: A failure after the run row exists strands a `running` row with no process, and the new `HasLiveRun` guard turns that into a permanent block

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:807-811` (and `launch_run_for_task`, 893-905)

**Issue:**
- `prepare_launch` inserts the run row via `start_agent_run_recording_first`. Right after, 09-13 added `record_launch_overlap(...)?`, a separate transaction. If it fails (lock contention, a constraint, the `epic_id` lookup), the `?` returns `Err` with the row still `running` and the worktree and marker already created.
- `start_agent_run_recording_first` itself says in its step-10 comment that a `running` row with no session behind it "would hold a dispatcher slot forever". It closes the row as `failed` for exactly that reason when arming fails. The new failure point does not.
- The two existing post-insert failure points in `launch_run_for_task` have the same property: `merge_shim_env_for_run(...)?` and `send_gated_spawn(...)?` (for example, the sidecar is down).
- What is new is the `HasLiveRun` refusal in `launch_conflict`. A stranded row used to leave the task retryable, at the cost of a second row. Now every retry from the Launch sheet is refused with "This task already has a running or blocked run". The dispatcher's `t.live` check refuses it too. The cap slot stays held. Only the startup `reconcile_agent_runs` clears it.

**Fix:** Close the run as `Failed` on every error path after `prepare_launch` succeeds. Closing the row is the same remedy `fail_planning_start` uses for planning runs. For example:

```rust
let fail = |conn: &mut Connection, run_id: &str, msg: String| {
    let _ = flywheel_core::domain::agent_run::close_agent_run(
        conn, run_id, flywheel_core::domain::agent_run::AgentRunStatus::Failed, None, None, None);
    msg
};
// in prepare_launch:
if let Some(sentence) = &cross_task {
    if let Err(e) = record_launch_overlap(conn, &project_id, task_id, &outcome.run_id, &human_actor_id, sentence) {
        return Err(fail(conn, &outcome.run_id, e));
    }
}
// in launch_run_for_task: do the same for merge_shim_env_for_run and, after re-locking, for send_gated_spawn.
```

Alternatively, write the overlap event in the same transaction as the run insert.

### WR-02: The launch body folds case unconditionally while the dispatcher folds by the repo's real case sensitivity, so the "one rule" returns two verdicts

**File:** `packages/desktop/src-tauri/src/commands/agent_run.rs:781-792` (versus `packages/core/src/dispatch.rs:595`)

**Issue:** `prepare_launch` passes `fold_case = true` regardless of the filesystem. `readiness` passes the observed flag. On a case-sensitive repository (Linux, the Tauri target in `CLAUDE.md`), two same-wave tasks declaring `Src/a.rs` and `src/a.rs` are treated as disjoint by planning and by `decide`, which then emits `Spawn` for both. The launch body refuses the second. `run_pass` marks it `needs_attention` / `launch_failed` ("Needs you" on the sheet). Each later tick sees `decide` pass the task again (the same `fold = false`) and the launch body refuse it again, until the first task ends. `mark_needs_attention` is idempotent, so there is no event spam. But the user sees a spurious attention state for a pair the dispatcher deliberately judged safe.

The ponytail comment records this ceiling. The cost is bigger than "refused though allowed once": it is a repeating decide-then-refuse loop, and the verdict now depends on which caller asked. That is the drift the phase exists to prevent.

**Fix:** Resolve the flag before taking the lock and pass it in.
- Read `repo_path` with a short lock.
- Call `repo_is_case_insensitive` outside it. It is currently `pub(crate)` in core, so make it `pub`.
- Re-lock and call `prepare_launch(..., fold_case, ...)`.

Failing that, add a test that fixes the divergence in place, so the loop cannot be introduced silently.

### WR-03: A live widen records no sequencing edge for a queued task that is waiting on a pre-spawn attention state, including one that the new `Refuse` path creates

**File:** `packages/core/src/domain/file_set.rs:564-575`

**Issue:** `record_widen_sequencing` treats a task as queued only if `pt.state IN ('planned','waiting','held_by_limit')`. But `is_startable` in `dispatch.rs` (line 545) also starts `needs_attention` tasks whose cause is `PreSpawn`, and a launch refused by `Refuse` produces exactly that state (`LaunchFailed`).

Scenario: A is running, B is in the same wave and was refused or held at pre-spawn, so it is `needs_attention`. The user widens A into B's files. The widen is accepted with no edge and no `task.sequenced` event.
- Execution still waits while A is live, because readiness reads the rows.
- Once A's run ends, A is `finished` but not yet `merged`. An edge would make B wait for the merge ("Finished is not enough", D-158).
- With no edge, B becomes ready the moment A's run stops, and starts on a base that does not contain A's work. This is the merge-conflict case the edge exists to prevent.
- `why` also answers `DisjointSets` or `RunsAlone` for a pair that was in fact sequenced.

**Fix:** Select queued tasks by "startable, with no live run", not by a hard-coded state list. Add `'needs_attention'` (restricted to pre-spawn attention) to the `IN` list, or reuse `is_startable`'s predicate so the two definitions cannot drift.

### WR-04: The `why` sentence for an undeclared pair says it "never shares a wave", which contradicts the data it is answering about

**File:** `packages/desktop/src-tauri/src/commands/dispatch.rs:410-417` (and the `RunsAlone` doc in `packages/core/src/dispatch.rs:82-85`)

**Issue:** `SequencingReason::RunsAlone` is only produced in the `(Some(_), Some(_))` same-wave arm of `why`. The pair is in the same wave by construction, as the wave sheet shows. The sentence "...so it runs alone and never shares a wave" is false for that pair. The true statement is that the two never run at the same time. This is user-facing text whose purpose is to explain the sequencing, so it should not contradict the sheet next to it.

**Fix:** Reword both variants, for example "FLY-2 has no declared file-set, so it runs alone: it never runs at the same time as another task." Update the matching assertions and the enum doc comment.

### WR-05: The overlap warning is only shown for the Launch sheet. The other manual launch site drops it and hides refusal reasons

**File:** `packages/desktop/src/review/MergeConfirmSheet.tsx:213-224` (a caller of the changed `startAgentRun` contract; not in the listed files)

**Issue:** `handleResolveSession` calls `adapter.startAgentRun(...)`, which reaches the same `agent_run_start` with `WarnAndProceed`.
- It ignores `run.overlapWarning`, so the "no longer silent" promise of 09-13 does not hold for that launch. It leaves only the `task.launch_overlap` event, which nothing in the desktop source renders.
- Its `.catch` replaces every error with the fixed string "Could not start a session on this task.". The new `HasLiveRun` refusal reason, and any `Launch refused: ...` text, is swallowed here.

**Fix:** Show `run.overlapWarning` where the session opens, or route it through the same app-level notice. In the `catch`, surface the message when it is a refusal, for example `setSideError(err instanceof Error ? err.message : String(err))`.

## Info

### IN-01: The Launch sheet's own copy of the overlap warning is effectively never visible

**File:** `packages/desktop/src/launch-sheet/LaunchSheet.tsx:689-690, 777-790`; `packages/desktop/src/App.tsx:349-359`

**Issue:** `onStarted` closes the sheet in the only real host (`App.tsx`), so the `<p role="note">` inside the sheet is mounted for zero visible frames. The tests that exercise it use a host that never closes. The real user-facing copy is the `App.tsx` toast, so two renderers of one sentence exist and only one is reachable.

**Fix:** Drop the in-sheet state and rendering, or keep the sheet open on a warning. Test the toast in `App`.

### IN-02: The toast is a transient, non-announced, non-dismissible note

**File:** `packages/desktop/src/App.tsx:155-163, 367-387`

**Issue:** The note disappears after a hard-coded `15000` ms, has no dismiss control, and uses `role="note"`, which is not a live region, so assistive tech is not told it appeared. It is the only place the user sees the warning. Setting the same sentence twice also does not restart the timer, because the state value does not change. The `1400` z-index and `15000` timeout are inline magic numbers.

**Fix:** Use `role="status"` and add a dismiss button. Name the timeout as a constant. Consider keying the effect on a counter.

### IN-03: The "No files declared, so this task runs alone" signal encodes the D-150 rule in the renderer and shows on settled tasks

**File:** `packages/desktop/src/dispatch/WavePlanSheet.tsx:155-157`

**Issue:** The file header says the sheet holds no sequencing logic, but this line derives "runs alone" from `entries.length === 0` itself. It also renders for `merged`, `finished` and `failed` tasks, where "runs alone" is stale.

**Fix:** Ask Rust for a per-task flag, or restrict the condition to tasks that have not started (`planned`, `waiting`, `held_by_limit`, `needs_attention`).

### IN-04: The live-run predicate is hand-copied

**File:** `packages/core/src/dispatch.rs` (`launch_conflict`); `packages/core/src/domain/file_set.rs` (`declare_refusal`, `record_widen_sequencing`)

**Issue:** `status IN ('running', 'blocked')` now appears in 18 places, three of them added by this plan range. The risk is the same drift the single-rule invariant guards against, because adding a live status means finding every copy.

**Fix:** Add one `LIVE_RUN_STATUSES` constant or SQL fragment in core and use it in the new queries.

### IN-05: Test-code nits

**File:**
- `packages/desktop/src-tauri/src/commands/file_set.rs:404-407` (misattached doc comment)
- `packages/desktop/src-tauri/src/commands/agent_run.rs:3639-3642` (unused-field workaround)

**Issue:**
- In `file_set.rs`, the `give_live_run` test helper was inserted between the doc comment of `the_command_handlers_accept_no_actor_and_no_path_argument` and its `#[test]`. The "human-only command" doc now attaches to `give_live_run`, and the real test lost its description.
- In `agent_run.rs`, `a_manual_launch_at_or_above_the_cap_still_proceeds` ends with `let _ = &f.other;` only to silence an unused-field warning. Delete the field, or assert on it (for example, that the other task's run is still live).

**Fix:** Move the doc comment back above its `#[test]`. Remove the unused field.

---

_Reviewed: 2026-10-10_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
