//! The end-to-end tracer check (plan 02-01 Task 1): a real worktree, a real branch, the
//! `triggers`/`worktrees`/`agent_runs` rows linked together, and the task moved to `in_progress`
//! attributed to the seeded agent actor — one real path through every layer this phase's schema
//! and domain functions touch, not a per-layer unit test.

mod common;

use core::domain::agent_run::{agent_actor_id, start_agent_run};
use core::domain::worktree::ensure_worktree;
use core::git::worktree_list;
use core::session_log::session_log_path;

#[test]
fn start_work_creates_worktree_branch_and_linked_rows() {
    let (mut conn, human_actor_id, project, repo_dir) = common::seeded_git_project();

    // Point the create-or-reuse resolver at a scratch worktree root for the duration of this
    // test — never the real `~/Flywheel/` (this is the deliberate `FLYWHEEL_WORKTREE_ROOT` test
    // seam, not a user setting).
    let worktree_root_dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: this test runs single-threaded within its own process (the standard caveat for
    // mutating process-wide env vars in tests) and always clears the var at the end.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", worktree_root_dir.path()) };

    let task = core::domain::task::create_task(
        &mut conn,
        &project.id,
        &human_actor_id,
        "Wire the tracer path",
        None,
    )
    .expect("create_task should succeed");

    let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &human_actor_id)
        .expect("start_agent_run should succeed");

    // The worktree directory exists on disk.
    let worktree = ensure_worktree(&mut conn, &task.id, &human_actor_id)
        .expect("ensure_worktree should return the already-created row, not create a second one");
    assert!(
        std::path::Path::new(&worktree.path).is_dir(),
        "the worktree directory should exist on disk at {:?}",
        worktree.path
    );

    // `git worktree list` in the real repository names it.
    let listing = worktree_list(repo_dir.path()).expect("worktree_list should succeed");
    assert!(
        listing.contains(&worktree.branch),
        "expected `git worktree list` output to name branch {:?}, got:\n{listing}",
        worktree.branch
    );

    // triggers / worktrees / agent_runs rows exist and are linked.
    let (trigger_target_task, trigger_source): (String, String) = conn
        .query_row(
            "SELECT target_task_id, source FROM triggers WHERE id = ?1",
            rusqlite::params![run.trigger_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the trigger row should exist");
    assert_eq!(trigger_target_task, task.id);
    assert_eq!(trigger_source, "user_action");

    let (agent_run_worktree_id, agent_run_task_id, agent_run_trigger_id, agent_run_status): (
        Option<String>,
        String,
        String,
        String,
    ) = conn
        .query_row(
            "SELECT worktree_id, task_id, trigger_id, status FROM agent_runs WHERE id = ?1",
            rusqlite::params![run.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .expect("the agent_runs row should exist");
    assert_eq!(agent_run_worktree_id.as_deref(), Some(worktree.id.as_str()));
    assert_eq!(agent_run_task_id, task.id);
    assert_eq!(agent_run_trigger_id, run.trigger_id);
    assert_eq!(agent_run_status, "running");

    // The task moved to in_progress, attributed to the agent actor.
    let agent_id = agent_actor_id(&conn).expect("agent actor should be seeded");
    let (task_status,): (String,) = conn
        .query_row(
            "SELECT status FROM tasks WHERE id = ?1",
            rusqlite::params![task.id],
            |row| Ok((row.get(0)?,)),
        )
        .expect("task row should exist");
    assert_eq!(task_status, "in_progress");

    let (status_change_actor,): (String,) = conn
        .query_row(
            "SELECT actor_id FROM events WHERE task_id = ?1 AND event_type = 'task.status_changed' \
             ORDER BY id DESC LIMIT 1",
            rusqlite::params![task.id],
            |row| Ok((row.get(0)?,)),
        )
        .expect("a task.status_changed event should exist");
    assert_eq!(
        status_change_actor, agent_id,
        "the status-change event must be attributed to the agent actor, not the human"
    );

    // session_log_path(run_id) is what log_path stores.
    let expected_log_path = session_log_path(&run.id)
        .expect("session_log_path should resolve")
        .to_string_lossy()
        .into_owned();
    assert_eq!(run.log_path, expected_log_path);

    // SAFETY: see the set_var call above.
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
}
