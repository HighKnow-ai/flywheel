//! Behavior under test (D-78, plan 04-10 Task 3): the run remembers what it was told.
//! - Starting a run on a task with three current criteria writes a pin naming exactly those three
//!   criterion row ids, in rank order.
//! - Revising one of them while the run is live leaves that run's pin byte-identical — even a
//!   later call to `pin_criteria_revisions` for the same run with different ids is a no-op.
//! - Starting a second run after the revision writes a pin naming the successor's id in place of
//!   the predecessor's, with the other two unchanged.
//! - A task with zero criteria writes an empty pin rather than a null one, so "this run was given
//!   no criteria" and "this run predates pinning" stay distinguishable.
//! - Reading the pin for a run that predates this column (never pinned) returns `None`, and no
//!   caller treats that as an empty set.

mod common;

use core::domain::acceptance_criterion::{create_criterion, list_current_criteria, revise_criterion};
use core::domain::agent_run::{criteria_revision_pin_for_run, pin_criteria_revisions, start_agent_run};
use core::domain::task::create_task;

/// Serialises every call to [`with_scratch_worktree_root`] in THIS binary — mirrors
/// `tests/criteria.rs`'s identical helper; each `tests/*.rs` file compiles to its own binary, so
/// this cannot race with any other test file.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by WORKTREE_ROOT_ENV_LOCK above — only one test at a time ever has this
    // var set within this binary, and it is always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// The current criteria ids for `task_id`, in rank order — the same order the packet's own
/// criteria carry, matching `agent_run_start`'s own resolution.
fn current_ids(conn: &rusqlite::Connection, task_id: &str) -> Vec<String> {
    list_current_criteria(conn, "task", task_id)
        .expect("list_current_criteria should succeed")
        .into_iter()
        .map(|c| c.id)
        .collect()
}

#[test]
fn starting_a_run_pins_exactly_the_current_criteria_in_rank_order() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Three criteria", None)
            .expect("create_task should succeed");
        create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "First", None)
            .expect("create_criterion should succeed");
        create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Second", None)
            .expect("create_criterion should succeed");
        create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Third", None)
            .expect("create_criterion should succeed");

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let ids = current_ids(&conn, &task.id);
        assert_eq!(ids.len(), 3, "the fixture must seed exactly three criteria");

        pin_criteria_revisions(&mut conn, &run.id, &ids).expect("pin_criteria_revisions should succeed");

        let pinned = criteria_revision_pin_for_run(&conn, &run.id)
            .expect("criteria_revision_pin_for_run should succeed");
        assert_eq!(pinned, Some(ids), "the pin must name exactly the three current criteria, in rank order");
    });
}

#[test]
fn revising_a_criterion_mid_run_leaves_the_live_runs_pin_byte_identical() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Revise mid-run", None)
            .expect("create_task should succeed");
        let criterion = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Original", None)
            .expect("create_criterion should succeed");

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let original_ids = current_ids(&conn, &task.id);
        pin_criteria_revisions(&mut conn, &run.id, &original_ids)
            .expect("pin_criteria_revisions should succeed");

        // The criterion is now locked (an agent_runs row exists) — revising it mints a successor.
        let revised = revise_criterion(&mut conn, &actor_id, &criterion.id, "Sharper wording", None)
            .expect("revise_criterion should succeed");
        assert_ne!(revised.id, criterion.id, "the revise must have minted a successor row");

        // Even a second, mistaken call to pin the SAME run with the NEW ids must be a no-op — the
        // pin was already written once, and a second write would be the retroactive rewrite D-40
        // protects against.
        let new_ids = current_ids(&conn, &task.id);
        assert_ne!(new_ids, original_ids, "the current criteria set must have changed after the revision");
        pin_criteria_revisions(&mut conn, &run.id, &new_ids).expect("pin_criteria_revisions should succeed");

        let pinned = criteria_revision_pin_for_run(&conn, &run.id)
            .expect("criteria_revision_pin_for_run should succeed");
        assert_eq!(
            pinned,
            Some(original_ids),
            "a revision landing mid-run, and any later re-pin attempt, must never alter the live run's own pin"
        );
    });
}

#[test]
fn starting_a_second_run_after_the_revision_pins_the_successor_with_the_others_unchanged() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Second run after revision", None)
            .expect("create_task should succeed");
        let c1 = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Stays the same", None)
            .expect("create_criterion should succeed");
        let c2 = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Gets revised", None)
            .expect("create_criterion should succeed");
        let c3 = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Also stays", None)
            .expect("create_criterion should succeed");

        let run1 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let run1_ids = current_ids(&conn, &task.id);
        pin_criteria_revisions(&mut conn, &run1.id, &run1_ids)
            .expect("pin_criteria_revisions should succeed");

        let revised = revise_criterion(&mut conn, &actor_id, &c2.id, "Sharper wording", None)
            .expect("revise_criterion should succeed");

        let run2 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let run2_ids = current_ids(&conn, &task.id);
        pin_criteria_revisions(&mut conn, &run2.id, &run2_ids)
            .expect("pin_criteria_revisions should succeed");

        let run2_pinned = criteria_revision_pin_for_run(&conn, &run2.id)
            .expect("criteria_revision_pin_for_run should succeed")
            .expect("run2's pin must be Some");

        assert!(run2_pinned.contains(&c1.id), "the unrevised first criterion must still be pinned");
        assert!(run2_pinned.contains(&c3.id), "the unrevised third criterion must still be pinned");
        assert!(
            run2_pinned.contains(&revised.id),
            "the second run's pin must name the successor's id"
        );
        assert!(
            !run2_pinned.contains(&c2.id),
            "the second run's pin must NOT name the predecessor's (now-superseded) id"
        );
        assert_eq!(run2_pinned.len(), 3);

        // run1's own pin, from before the revision, must still read exactly as it did.
        let run1_pinned = criteria_revision_pin_for_run(&conn, &run1.id)
            .expect("criteria_revision_pin_for_run should succeed");
        assert_eq!(run1_pinned, Some(run1_ids));
    });
}

#[test]
fn a_task_with_zero_criteria_writes_an_empty_pin_not_a_null_one() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Zero criteria", None)
            .expect("create_task should succeed");

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let ids = current_ids(&conn, &task.id);
        assert!(ids.is_empty(), "the fixture must seed zero criteria");

        pin_criteria_revisions(&mut conn, &run.id, &ids).expect("pin_criteria_revisions should succeed");

        let pinned = criteria_revision_pin_for_run(&conn, &run.id)
            .expect("criteria_revision_pin_for_run should succeed");
        assert_eq!(
            pinned,
            Some(Vec::new()),
            "an empty criteria set must pin an empty array (Some(vec![])), never a null column"
        );
    });
}

#[test]
fn reading_the_pin_for_a_run_that_was_never_pinned_returns_none_not_an_empty_set() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Never pinned", None)
            .expect("create_task should succeed");
        create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Untouched", None)
            .expect("create_criterion should succeed");

        // A run is started, but `pin_criteria_revisions` is deliberately never called for it —
        // simulating a run that predates this column (the column is NULL either way).
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let pinned = criteria_revision_pin_for_run(&conn, &run.id)
            .expect("criteria_revision_pin_for_run should succeed");
        assert_eq!(
            pinned, None,
            "a run whose pin was never written must read back None, never Some(vec![]) — the two \
             must stay distinguishable"
        );
    });
}
