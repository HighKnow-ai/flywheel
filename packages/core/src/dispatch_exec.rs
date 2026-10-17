//! The dispatcher's acting half (phase 09 plan 09-07): one pass of read, observe, decide, act, with
//! the database lock taken for each database step and RELEASED across every subprocess.
//!
//! Lives in core, beside `merge.rs`, so the whole loop is driven by tests against real repositories.
//! The one thing core cannot do is start an agent process; that is injected as `spawn`, and in the
//! desktop crate it is the same launch body a user's own launch uses. This module therefore
//! contains no spawn-timing policy at all: every spawn passes through that one gated path, which
//! enforces the per-repository spawn floor (`git_retry::SpawnFloor`). No sleep here.
//!
//! The lock discipline, per pass: lock for the gate housekeeping and the target read, release; git
//! reads with no connection in scope; lock for `decide`, release; then ONE database or git step per
//! action, each taking the lock for itself. Never a loop inside one acquisition.
//!
//! Attribution: an automatic merge is recorded with the system actor and `automatic: true`, never
//! with the local human. The merge event TYPE is the existing `task.integrated`, so Phase 8's
//! integrated marker keeps working, but nobody reviewed this merge and the audit trail says so.
//! Nothing here commits on an agent's behalf: an uncommitted finish stops the task instead.

use std::sync::Mutex;

use anyhow::{anyhow, Context};
use rusqlite::Connection;

use crate::dispatch::{decide, observation_targets, Action, AttentionCause};
use crate::domain::dispatch_plan::{
    advance_wave, mark_needs_attention, set_task_dispatch_state, AdvanceOutcome,
};
use crate::merge::{
    ensure_epic_worktree, finish_plan, plan_merge_inputs, record_merge_event_with, run_merge,
    try_lock_epic, MergeOutcome, MergeRefusal,
};

/// The instruction a DISPATCHED run is launched with (phase 09 plan 09-07): an agent that leaves work
/// uncommitted would give the automatic merge nothing to merge, and the next wave would start
/// without it. Passed as the launch's additional instruction, so a user's own launch carries none
/// of it. Moved here from the deleted context packet builder (issue #38).
pub const DISPATCHED_COMMIT_INSTRUCTION: &str = "Commit your work on this branch before you finish, as one or more commits. Do not push. Uncommitted work is not on the branch: it cannot be merged, and the next stage of the plan would start without it.";

/// How one merge attempt ended.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MergeResult {
    Merged { merge_commit: String },
    /// Already on the integration branch (a crash between the merge and its state write, or the
    /// user's own merge). Recorded as merged without a second event.
    AlreadyMerged,
    /// The dry run found conflicts; nothing landed, the task is `conflict`.
    Conflicted { files: Vec<String> },
    /// The merge could not run; the task is `needs_attention` with the named cause.
    Blocked(AttentionCause),
    /// Another merge into this epic is running; try again next pass.
    Deferred,
}

fn lock(db: &Mutex<Connection>) -> anyhow::Result<std::sync::MutexGuard<'_, Connection>> {
    db.lock().map_err(|_| anyhow!("the database lock was poisoned"))
}

fn block(db: &Mutex<Connection>, plan_id: &str, task_id: &str, cause: AttentionCause, actor: &str) -> anyhow::Result<MergeResult> {
    mark_needs_attention(&mut *lock(db)?, plan_id, task_id, &cause, actor)?;
    Ok(MergeResult::Blocked(cause))
}

/// Merge one finished task's branch into its epic's integration branch, automatically.
///
/// The five existing halves in order: `plan_merge_inputs` under the lock, release, `finish_plan`
/// (the touch-nothing count), the per-epic guard, `run_merge` (which dry-runs first and works in a
/// worktree belonging to the EPIC, never the task's own, so a running agent cannot collide with
/// it), then `record_merge_event_with` under the lock. `ensure_epic_integration_branch` runs first:
/// it is idempotent, and it is the sanctioned lazy cut, so an epic with no integration branch is
/// satisfied rather than refused (the merge module itself never cuts one).
pub fn merge_task(
    db: &Mutex<Connection>,
    plan_id: &str,
    task_id: &str,
    system_actor_id: &str,
) -> anyhow::Result<MergeResult> {
    let epic_id: Option<String> = lock(db)?
        .query_row("SELECT epic_id FROM tasks WHERE id = ?1", [task_id], |r| r.get(0))
        .with_context(|| format!("task {task_id:?} not found"))?;
    let epic_id = epic_id.ok_or_else(|| anyhow!("task {task_id:?} has no epic, so it cannot be merged in-app"))?;

    let Some(_guard) = try_lock_epic(&epic_id) else { return Ok(MergeResult::Deferred) };

    let inputs = {
        let mut conn = lock(db)?;
        crate::domain::epic::ensure_epic_integration_branch(&mut conn, &epic_id, system_actor_id)?;
        match plan_merge_inputs(&conn, task_id) {
            Ok(inputs) => inputs,
            Err(e) => {
                drop(conn);
                return block(db, plan_id, task_id, AttentionCause::MergeBlocked { reason: format!("{e:#}") }, system_actor_id);
            }
        }
    };
    let plan = match finish_plan(inputs) {
        Ok(plan) => plan,
        Err(e) => match e.downcast_ref::<MergeRefusal>() {
            Some(MergeRefusal::NothingToMerge { target_branch, .. }) => {
                let target_branch = target_branch.clone();
                let landed = crate::merge::integrated_merge_commit(&*lock(db)?, task_id)?.is_some();
                if landed {
                    set_task_dispatch_state(&*lock(db)?, plan_id, task_id, "merged")?;
                    return Ok(MergeResult::AlreadyMerged);
                }
                return block(db, plan_id, task_id, AttentionCause::NoCommits { target_branch }, system_actor_id);
            }
            _ => return block(db, plan_id, task_id, AttentionCause::MergeBlocked { reason: format!("{e:#}") }, system_actor_id),
        },
    };

    // Name a dirty integration worktree BEFORE the merge: it would otherwise strand every later
    // merge as a bare refusal. A merge left in progress by a crash is not "dirty"; `run_merge`
    // aborts it itself.
    let wt = &plan.epic_worktree;
    let precheck = ensure_epic_worktree(&plan.repo_path, wt, &plan.target_branch).and_then(|()| {
        if crate::git::rev_parse_verify(wt, "MERGE_HEAD")? {
            return Ok(Vec::new());
        }
        crate::domain::worktree::porcelain_entries(wt)
    });
    match precheck {
        Ok(dirty) if !dirty.is_empty() => {
            let reason = format!(
                "the integration worktree {} has {} uncommitted entries (first: {}); clean it so merges can land",
                wt.display(),
                dirty.len(),
                dirty[0].path
            );
            return block(db, plan_id, task_id, AttentionCause::MergeBlocked { reason }, system_actor_id);
        }
        Ok(_) => {}
        Err(e) => {
            return block(db, plan_id, task_id, AttentionCause::MergeBlocked { reason: format!("{e:#}") }, system_actor_id);
        }
    }

    // Only now is a merge really under way; every refusal above leaves the state as it was, so a
    // persisting cause stays one record rather than flickering through `merging` each pass. The same
    // holds for a retry of a merge that already failed (D-REV-39 WR-04): a task that is
    // `needs_attention` stays there while the merge is re-attempted, so a failure with the same cause
    // meets `mark_needs_attention`'s dedupe instead of an unrelated `merging` state, and the success
    // and conflict arms below still write their own state.
    {
        let conn = lock(db)?;
        let state: String = conn.query_row(
            "SELECT state FROM dispatch_plan_tasks WHERE plan_id = ?1 AND task_id = ?2",
            [plan_id, task_id],
            |r| r.get(0),
        )?;
        if state != "needs_attention" {
            set_task_dispatch_state(&conn, plan_id, task_id, "merging")?;
        }
    }
    let outcome = match run_merge(&plan) {
        Ok(outcome) => outcome,
        Err(e) => return block(db, plan_id, task_id, AttentionCause::MergeBlocked { reason: format!("{e:#}") }, system_actor_id),
    };

    let extra = serde_json::json!({
        "automatic": true,
        "dispatch_plan_id": plan_id,
        "label": match &outcome {
            MergeOutcome::Merged { .. } => format!("Merged into {} automatically (fan-out, not reviewed)", plan.target_branch),
            _ => format!("Automatic merge into {} found conflicts and stopped", plan.target_branch),
        },
    });
    let mut conn = lock(db)?;
    record_merge_event_with(&mut conn, &plan, &outcome, system_actor_id, Some(&extra))?;
    Ok(match outcome {
        MergeOutcome::Merged { merge_commit } => {
            set_task_dispatch_state(&conn, plan_id, task_id, "merged")?;
            MergeResult::Merged { merge_commit }
        }
        MergeOutcome::AlreadyIntegrated => {
            set_task_dispatch_state(&conn, plan_id, task_id, "merged")?;
            MergeResult::AlreadyMerged
        }
        MergeOutcome::Conflicted { files } => {
            set_task_dispatch_state(&conn, plan_id, task_id, "conflict")?;
            MergeResult::Conflicted { files }
        }
    })
}

/// What one pass did, for the caller's board-changed notice and for tests.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PassReport {
    pub actions: Vec<Action>,
    pub spawned: usize,
    pub merged: usize,
    pub advanced: usize,
    pub failures: Vec<String>,
}

/// One dispatcher pass. `system_actor_id` is resolved by the caller (the command layer, server-side)
/// and is the only actor any automatic write is attributed to. `spawn(plan_id, task_id)` starts one run through the launch path and is
/// called with NO lock held. A failure of one action is recorded and the pass continues: one bad
/// task never stops the others.
pub fn run_pass<S>(
    db: &Mutex<Connection>,
    now_epoch_secs: i64,
    system_actor_id: &str,
    mut spawn: S,
) -> anyhow::Result<PassReport>
where
    S: FnMut(&str, &str) -> Result<(), String>,
{
    let actor_id = system_actor_id;
    let targets = {
        let mut conn = lock(db)?;
        // Time-driven gate housekeeping: each writes only on a real change.
        crate::limit_gate::resume_if_due(&mut conn, now_epoch_secs)?;
        crate::limit_gate::clear_expired_warning(&mut conn, now_epoch_secs)?;
        observation_targets(&conn)?
    };
    let observations = crate::git_facts::observe(&targets);
    let actions = decide(&*lock(db)?, now_epoch_secs, &observations)?;

    let mut report = PassReport { actions: actions.clone(), ..Default::default() };
    for action in &actions {
        let result: anyhow::Result<()> = (|| {
            match action {
                Action::Spawn { plan_id, task_id } => match spawn(plan_id, task_id) {
                    Ok(()) => {
                        set_task_dispatch_state(&*lock(db)?, plan_id, task_id, "running")?;
                        report.spawned += 1;
                    }
                    Err(error) => {
                        mark_needs_attention(&mut *lock(db)?, plan_id, task_id, &AttentionCause::LaunchFailed { error }, actor_id)?;
                    }
                },
                Action::Merge { plan_id, task_id } => {
                    if matches!(merge_task(db, plan_id, task_id, actor_id)?, MergeResult::Merged { .. } | MergeResult::AlreadyMerged) {
                        report.merged += 1;
                    }
                }
                Action::AdvanceWave { plan_id } => {
                    let _: AdvanceOutcome = advance_wave(&mut *lock(db)?, plan_id, actor_id)?;
                    report.advanced += 1;
                }
                Action::MarkNeedsAttention { plan_id, task_id, cause } => {
                    mark_needs_attention(&mut *lock(db)?, plan_id, task_id, cause, actor_id)?;
                }
                Action::MarkRunEnded { plan_id, task_id, state } => {
                    set_task_dispatch_state(&*lock(db)?, plan_id, task_id, state)?;
                }
            }
            Ok(())
        })();
        if let Err(e) = result {
            report.failures.push(format!("{action:?}: {e:#}"));
        }
    }
    Ok(report)
}
