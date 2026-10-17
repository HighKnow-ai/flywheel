//! The invariant test for this plan's assumption-delta decision (plan 02-01 Task 2): *a worktree
//! survives the death of every session that ever ran against it*. Starts a run, writes an
//! uncommitted file into the worktree, closes that run as `interrupted`, starts a second run on
//! the same Story, and asserts the worktree row and its on-disk contents are untouched, `git
//! worktree list` still reports exactly one worktree for the branch, and two distinct
//! `sessions` rows now reference the one `worktrees` row, against a real repository.

mod common;

use common::with_scratch_worktree_root;

use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::worktree::ensure_worktree;

#[test]
fn a_worktree_survives_two_runs() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Lifecycle story");

        let run_1 = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("first start_agent_run should succeed");
        let worktree_1 =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should return the existing row");

        // Write an uncommitted file into the worktree — the exact thing D-30 promises survives.
        let dirty_file = std::path::Path::new(&worktree_1.path).join("scratch.txt");
        std::fs::write(&dirty_file, b"uncommitted work\n").expect("failed to write the dirty file");

        close_agent_run(&mut conn, &run_1.id, AgentRunStatus::Interrupted, None, None, None)
            .expect("close_agent_run should succeed");

        let run_2 = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("second start_agent_run should succeed");
        let worktree_2 =
            ensure_worktree(&mut conn, &story.id, &actor_id).expect("ensure_worktree should return the existing row");

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
                "SELECT COUNT(*) FROM sessions WHERE worktree_id = ?1",
                rusqlite::params![worktree_1.id],
                |row| row.get(0),
            )
            .expect("failed to count sessions for this worktree");
        assert_eq!(run_count, 2, "two distinct sessions rows must now reference the one worktrees row");
        assert_ne!(run_1.id, run_2.id, "the two runs must be distinct rows");
    });
}

