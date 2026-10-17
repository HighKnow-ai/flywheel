//! The invariant test for this plan's assumption-delta decision (plan 02-01 Task 2): *a worktree
//! survives the death of every session that ever ran against it*. Starts a run, writes an
//! uncommitted file into the worktree, closes that run as `interrupted`, starts a second run on
//! the same task, and asserts the worktree row and its on-disk contents are untouched, `git
//! worktree list` still reports exactly one worktree for the branch, and two distinct
//! `agent_runs` rows now reference the one `worktrees` row. Covers both WORK-02 shapes (no-epic
//! and epic-owned) against a real repository.

mod common;

use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;

/// `cargo test` runs this binary's two tests concurrently, and `FLYWHEEL_WORKTREE_ROOT` is
/// process-global: unserialized, one test's root vanished under the other mid-write (NotFound).
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: `ENV_LOCK` serializes every test in this binary, and this helper always clears the
    // var before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

fn assert_worktree_survives_two_runs(epic_id: Option<&str>) {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Lifecycle task", epic_id)
            .expect("create_task should succeed");

        let run_1 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("first start_agent_run should succeed");
        let worktree_1 =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should return the existing row");

        // Write an uncommitted file into the worktree — the exact thing D-30 promises survives.
        let dirty_file = std::path::Path::new(&worktree_1.path).join("scratch.txt");
        std::fs::write(&dirty_file, b"uncommitted work\n").expect("failed to write the dirty file");

        close_agent_run(&mut conn, &run_1.id, AgentRunStatus::Interrupted, None, None, None)
            .expect("close_agent_run should succeed");

        let run_2 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("second start_agent_run should succeed");
        let worktree_2 =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should return the existing row");

        assert_eq!(worktree_1.id, worktree_2.id, "the worktrees.id must be unchanged across runs");
        assert_eq!(worktree_1.path, worktree_2.path, "the worktree path must be unchanged");

        let dirty_contents = std::fs::read(&dirty_file).expect("the uncommitted file should still exist");
        assert_eq!(
            dirty_contents, b"uncommitted work\n",
            "the uncommitted file's contents must be byte-identical after a second run started"
        );

        let listing = core::git::worktree_list(repo_dir.path()).expect("worktree_list should succeed");
        let matching_lines: Vec<&str> = listing.lines().filter(|l| l.contains(&worktree_1.branch)).collect();
        assert_eq!(
            matching_lines.len(),
            1,
            "git worktree list must report exactly one worktree for the branch, got:\n{listing}"
        );

        let run_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_runs WHERE worktree_id = ?1",
                rusqlite::params![worktree_1.id],
                |row| row.get(0),
            )
            .expect("failed to count agent_runs for this worktree");
        assert_eq!(run_count, 2, "two distinct agent_runs rows must now reference the one worktrees row");
        assert_ne!(run_1.id, run_2.id, "the two runs must be distinct rows");
    });
}

#[test]
fn a_worktree_survives_two_runs_with_no_epic() {
    assert_worktree_survives_two_runs(None);
}

#[test]
fn a_worktree_survives_two_runs_with_an_epic() {
    // Exercises WORK-02's epic-owned shape (as opposed to the no-epic test above) against a real
    // repository: its own fresh project/epic/task, all created inside the scratch worktree root.
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Lifecycle epic", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Lifecycle task", Some(&epic.id))
            .expect("create_task should succeed");

        let run_1 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("first start_agent_run should succeed");
        let worktree_1 = ensure_worktree(&mut conn, &task.id, &actor_id)
            .expect("ensure_worktree should return the existing row");

        let dirty_file = std::path::Path::new(&worktree_1.path).join("scratch.txt");
        std::fs::write(&dirty_file, b"uncommitted work\n").expect("failed to write the dirty file");

        close_agent_run(&mut conn, &run_1.id, AgentRunStatus::Interrupted, None, None, None)
            .expect("close_agent_run should succeed");

        let run_2 = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("second start_agent_run should succeed");
        let worktree_2 = ensure_worktree(&mut conn, &task.id, &actor_id)
            .expect("ensure_worktree should return the existing row");

        assert_eq!(worktree_1.id, worktree_2.id);
        let dirty_contents = std::fs::read(&dirty_file).expect("the uncommitted file should still exist");
        assert_eq!(dirty_contents, b"uncommitted work\n");

        let listing = core::git::worktree_list(repo_dir.path()).expect("worktree_list should succeed");
        assert_eq!(listing.lines().filter(|l| l.contains(&worktree_1.branch)).count(), 1);

        let run_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM agent_runs WHERE worktree_id = ?1",
                rusqlite::params![worktree_1.id],
                |row| row.get(0),
            )
            .expect("failed to count agent_runs for this worktree");
        assert_eq!(run_count, 2);
        assert_ne!(run_1.id, run_2.id);

        // The epic shape too: worktrees.base_branch equals the epic's integration_branch.
        let (integration_branch,): (Option<String>,) = conn
            .query_row(
                "SELECT integration_branch FROM epics WHERE id = ?1",
                rusqlite::params![epic.id],
                |row| Ok((row.get(0)?,)),
            )
            .expect("epic row should exist");
        assert_eq!(worktree_1.base_branch, integration_branch.expect("integration_branch should be set"));
    });
}
