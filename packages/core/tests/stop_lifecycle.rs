//! PROC-06/D-35's database and worktree half: a stopped run closes `interrupted`, the task stays
//! `in_progress`, and the worktree keeps every uncommitted byte — the "nothing committed on your
//! behalf" guarantee expressed as an unchanged commit count, not as a comment. See
//! `packages/sidecar/test/stop.test.mjs` for the sidecar's own process-group half of D-35.

mod common;

use std::path::Path;
use std::process::Command;

use core::domain::agent_run::{interrupt_agent_run, start_agent_run};
use core::domain::task::create_task;

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: tests in this crate run single-threaded per binary and this helper always clears
    // the var before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Run `git -C <repo_path> <args>` and return trimmed stdout — a minimal local helper mirroring
/// `core::git::git_at`'s own explicit-path discipline, kept separate here so this test never
/// depends on the production wrapper it is proving `domain::agent_run` never calls.
fn git_output(repo_path: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .arg("-C")
        .arg(repo_path)
        .args(args)
        .output()
        .unwrap_or_else(|e| panic!("failed to spawn git {args:?}: {e}"));
    assert!(
        output.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).trim().to_string()
}

#[test]
fn interrupt_agent_run_closes_interrupted_leaves_task_in_progress_and_keeps_the_worktree_dirty() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Stop-path task", None)
            .expect("create_task should succeed");

        let commit_count_before = git_output(repo_dir.path(), &["rev-list", "--count", "HEAD"]);

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let worktree_path: String = conn
            .query_row(
                "SELECT path FROM worktrees WHERE id = ?1",
                rusqlite::params![run.worktree_id],
                |row| row.get(0),
            )
            .expect("worktree row should exist");
        let dirty_file = Path::new(&worktree_path).join("scratch.txt");
        std::fs::write(&dirty_file, b"uncommitted work\n").expect("failed to write the dirty file");

        interrupt_agent_run(&mut conn, &run.id, &actor_id).expect("interrupt_agent_run should succeed");

        // --- Behavior: run moves to interrupted, ended_at is set ---
        let status: String = conn
            .query_row(
                "SELECT status FROM agent_runs WHERE id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("agent_runs row should exist");
        assert_eq!(status, "interrupted", "the run must close as interrupted, never as failed");

        let ended_at: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM agent_runs WHERE id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("agent_runs row should exist");
        assert!(ended_at.is_some(), "ended_at must be set after an interrupt");

        // --- Behavior: the task's workflow status is unchanged (still in_progress) ---
        let task_status: String = conn
            .query_row(
                "SELECT status FROM tasks WHERE id = ?1",
                rusqlite::params![task.id],
                |row| row.get(0),
            )
            .expect("task row should exist");
        assert_eq!(task_status, "in_progress", "a stop must never move the task out of In Progress");

        // --- Behavior: the worktree still exists and the uncommitted file is byte-identical ---
        assert!(Path::new(&worktree_path).exists(), "the worktree path must still exist after a stop");
        let dirty_contents = std::fs::read(&dirty_file).expect("the uncommitted file should still exist");
        assert_eq!(
            dirty_contents, b"uncommitted work\n",
            "the uncommitted file must be byte-identical after the stop"
        );

        // --- Behavior: git status --porcelain reports the change; commit count is unchanged ---
        let porcelain = git_output(Path::new(&worktree_path), &["status", "--porcelain"]);
        assert!(
            porcelain.contains("scratch.txt"),
            "git status --porcelain must report the uncommitted file, got:\n{porcelain}"
        );

        let commit_count_after = git_output(repo_dir.path(), &["rev-list", "--count", "HEAD"]);
        assert_eq!(
            commit_count_before, commit_count_after,
            "the branch's commit count must be unchanged across a stopped run — nothing is ever \
             committed on the user's behalf"
        );

        // --- Behavior: exactly one agent_run.interrupted event exists ---
        let interrupted_event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'agent_run.interrupted' AND stream_id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("failed to count agent_run.interrupted events");
        assert_eq!(interrupted_event_count, 1);

        // --- Behavior: a run already in a terminal state is idempotent — no second event ---
        interrupt_agent_run(&mut conn, &run.id, &actor_id)
            .expect("a second interrupt_agent_run call on an already-terminal run must not error");

        let interrupted_event_count_after_second_call: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'agent_run.interrupted' AND stream_id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("failed to count agent_run.interrupted events");
        assert_eq!(
            interrupted_event_count_after_second_call, 1,
            "a second interrupt on an already-terminal run must not append a second agent_run.interrupted event"
        );

        let status_after_second_call: String = conn
            .query_row(
                "SELECT status FROM agent_runs WHERE id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("agent_runs row should exist");
        assert_eq!(status_after_second_call, "interrupted", "the status must remain interrupted, not overwritten");
    });
}

#[test]
fn interrupt_agent_run_on_an_unknown_run_id_is_a_no_op() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir) = common::seeded_git_project();

        // No agent_runs row exists for this id at all — must not error and must not panic.
        interrupt_agent_run(&mut conn, "01ARZ3NDEKTSV4RRFFQ69G5FAV", &actor_id)
            .expect("interrupting an unknown agent_run_id must be a harmless no-op");
    });
}
