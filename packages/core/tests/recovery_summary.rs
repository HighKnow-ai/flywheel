//! WORK-06/PROC-05 (03-11, D-46): the rollup over every task in a project with an outstanding
//! recovery item — a missing worktree, or an abandoned run nobody has acknowledged. Proves the
//! union de-duplicates a task carrying both conditions, never crosses a project boundary, and
//! `recovery_count_for_project` always agrees with the length of `recovery_task_ids_for_project`.

mod common;

use core::domain::agent_run::{acknowledge_run, mark_abandoned, start_agent_run};
use core::domain::project;
use core::domain::task::create_task;
use core::domain::worktree::{ensure_worktree, reconcile_worktrees};
use core::query::recovery::{recovery_count_for_project, recovery_task_ids_for_project};
use rusqlite::{params, Connection};

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — `FLYWHEEL_WORKTREE_ROOT`
/// is process-global mutable state and `cargo test` runs `#[test]` functions concurrently by
/// default (mirrors `reconcile_worktrees.rs`'s/`permission_gate.rs`'s own guard).
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads or
    // mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

#[test]
fn an_empty_project_returns_an_empty_set_and_a_zero_count() {
    with_scratch_worktree_root(|| {
        let (conn, _actor_id, project, _repo_dir) = common::seeded_git_project();

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert!(ids.is_empty(), "a project with no recovery items must return an empty set");
        assert_eq!(count, 0, "a project with no recovery items must count zero");
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn a_missing_worktree_task_is_in_the_set() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Missing worktree task", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(ids, vec![task.id.clone()]);
        assert_eq!(count, 1);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn an_unacknowledged_abandoned_run_task_is_in_the_set() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Abandoned run task", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        mark_abandoned(&mut conn, &run.id, &actor_id, Some("killed-by-user-at-launch"))
            .expect("mark_abandoned should succeed");

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(ids, vec![task.id.clone()]);
        assert_eq!(count, 1);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn an_acknowledged_abandoned_run_with_a_healthy_worktree_is_excluded() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Acknowledged task", None)
            .expect("create_task should succeed");
        // A healthy, present worktree — never marked missing.
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        mark_abandoned(&mut conn, &run.id, &actor_id, Some("killed-by-user-at-launch"))
            .expect("mark_abandoned should succeed");
        assert!(
            acknowledge_run(&conn, &run.id).expect("acknowledge_run should succeed"),
            "an abandoned run must be acknowledgeable"
        );

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert!(ids.is_empty(), "an acknowledged abandoned run with a healthy worktree must yield an empty set");
        assert_eq!(count, 0);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn a_task_with_both_conditions_appears_exactly_once_and_counts_once() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Both conditions task", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        mark_abandoned(&mut conn, &run.id, &actor_id, Some("killed-by-user-at-launch"))
            .expect("mark_abandoned should succeed");

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(
            ids,
            vec![task.id.clone()],
            "a task with BOTH a missing worktree and an unacknowledged abandoned run must appear exactly once"
        );
        assert_eq!(count, 1, "UNION ALL would double-count this task — UNION must not");
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}

#[test]
fn a_task_in_another_project_is_never_in_the_set() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project_a, _repo_dir) = common::seeded_git_project();
        let project_b =
            project::create_project(&mut conn, &actor_id, "Other Project", "/other-repo", "OTH", "main")
                .expect("create_project should succeed for the second project");

        let task_a = create_task(&mut conn, &project_a.id, &actor_id, "Project A task", None)
            .expect("create_task should succeed");
        let worktree_a = ensure_worktree(&mut conn, &task_a.id, &actor_id)
            .expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree_a.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        let ids_b = recovery_task_ids_for_project(&conn, &project_b.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count_b = recovery_count_for_project(&conn, &project_b.id)
            .expect("recovery_count_for_project should succeed");

        assert!(ids_b.is_empty(), "project A's recovery item must never appear under project B");
        assert_eq!(count_b, 0);
        assert_eq!(count_b as usize, ids_b.len(), "count and set length must always agree");

        // Sanity: project A itself DOES see it.
        let ids_a = recovery_task_ids_for_project(&conn, &project_a.id)
            .expect("recovery_task_ids_for_project should succeed");
        assert_eq!(ids_a, vec![task_a.id.clone()]);
    });
}

#[test]
fn count_and_ids_agree_across_a_mixed_multi_task_fixture() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();

        // Task 1: missing worktree only.
        let task1 = create_task(&mut conn, &project.id, &actor_id, "Task 1", None)
            .expect("create_task should succeed");
        let worktree1 =
            ensure_worktree(&mut conn, &task1.id, &actor_id).expect("ensure_worktree should succeed");
        std::fs::remove_dir_all(&worktree1.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        // Task 2: unacknowledged abandoned run only.
        let task2 = create_task(&mut conn, &project.id, &actor_id, "Task 2", None)
            .expect("create_task should succeed");
        let run2 = start_agent_run(&mut conn, &task2.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        mark_abandoned(&mut conn, &run2.id, &actor_id, None).expect("mark_abandoned should succeed");

        // Task 3: healthy — no recovery item at all.
        create_task(&mut conn, &project.id, &actor_id, "Task 3", None)
            .expect("create_task should succeed");

        let mut ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        ids.sort();
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        let mut expected = vec![task1.id.clone(), task2.id.clone()];
        expected.sort();
        assert_eq!(ids, expected);
        assert_eq!(count, 2);
        assert_eq!(count as usize, ids.len(), "count and set length must always agree");
    });
}
