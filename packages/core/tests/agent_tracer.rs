//! The end-to-end tracer check: a real worktree, a real branch, the `worktrees`/`sessions` rows
//! linked together, and the Story's state left exactly where the developer put it (starting a
//! session is not a state signal, DRFT-04 — and an agent never writes one) — one real path through
//! every layer the session start touches, not a per-layer unit test.

mod common;

use core::domain::agent_run::{agent_actor_id, start_agent_run};
use core::domain::worktree::ensure_worktree;
use core::git::worktree_list;
use core::session_log::session_log_path;

use common::with_scratch_worktree_root;

#[test]
fn start_work_creates_worktree_branch_and_linked_rows() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human_actor_id, project, repo_dir) = common::seeded_git_project();

        let story = common::new_story(&mut conn, &project.id, &human_actor_id, "Wire the tracer path");

        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &human_actor_id)
            .expect("start_agent_run should succeed");

        // The worktree directory exists on disk.
        let worktree = ensure_worktree(&mut conn, &story.id, &human_actor_id)
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

        // worktrees / sessions rows exist and are linked.
        let (session_worktree_id, session_story_id, session_status, session_permission_mode): (
            Option<String>,
            String,
            String,
            String,
        ) = conn
            .query_row(
                "SELECT worktree_id, story_id, status, permission_mode FROM sessions WHERE id = ?1",
                rusqlite::params![run.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .expect("the sessions row should exist");
        assert_eq!(session_worktree_id.as_deref(), Some(worktree.id.as_str()));
        assert_eq!(session_story_id, story.id);
        assert_eq!(session_status, "running");
        // sessions.permission_mode stores the accepted mode string for a started session — this
        // call passed "acceptEdits" above.
        assert_eq!(session_permission_mode, "acceptEdits");

        // The session is attributed to the agent actor, never to the human who pressed Start Work.
        let agent_id = agent_actor_id(&conn).expect("agent actor should be seeded");
        assert_eq!(run.actor_id, agent_id);

        // Starting a session writes no Story state: the Story is still where it was created.
        let story_state: String = conn
            .query_row("SELECT state FROM stories WHERE id = ?1", rusqlite::params![story.id], |row| row.get(0))
            .expect("story row should exist");
        assert_eq!(story_state, story.state, "starting a session never moves the Story");

        let state_change_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE story_id = ?1 AND event_type = 'story.state_changed'",
                rusqlite::params![story.id],
                |row| row.get(0),
            )
            .expect("count");
        assert_eq!(state_change_count, 0, "an agent never writes a Story state (DRFT-04)");

        // session_log_path(run_id) is what log_path stores.
        let expected_log_path = session_log_path(&run.id)
            .expect("session_log_path should resolve")
            .to_string_lossy()
            .into_owned();
        assert_eq!(run.log_path, expected_log_path);
    });
}
