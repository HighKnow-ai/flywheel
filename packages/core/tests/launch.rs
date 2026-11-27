//! The launch interface (`launch::launch`), attended mode:
//! - a Story that is not Ready is refused by Start, and nothing is created;
//! - Start spawns once and moves the Story to Running;
//! - Resume of a Stopped Story reaches the same spawn and leaves the state alone;
//! - Resume of a Story that is not Stopped is refused.

mod common;

use std::collections::HashMap;

use common::{new_story, seeded_git_project, with_scratch_worktree_root};
use flywheel_core::domain::session::{close_session, SessionStatus};
use flywheel_core::domain::story::{get_story, set_story_state, StoryState};
use flywheel_core::launch::{launch, Intent, LaunchPort, Launched, Mode, Refused};
use rusqlite::Connection;

#[derive(Default)]
struct RecordingPort {
    sent: Vec<(String, serde_json::Value)>,
}

impl LaunchPort for RecordingPort {
    fn find_claude(&mut self) -> Result<(), String> {
        Ok(())
    }

    fn resolve_env(
        &mut self,
        _conn: &Connection,
        _project_id: &str,
    ) -> anyhow::Result<HashMap<String, String>> {
        Ok(HashMap::new())
    }

    fn merge_shim(
        &mut self,
        _env: &mut HashMap<String, String>,
        _run_id: &str,
    ) -> anyhow::Result<()> {
        Ok(())
    }

    fn send(&mut self, repo_path: &str, request: &serde_json::Value) -> Result<(), String> {
        self.sent.push((repo_path.to_string(), request.clone()));
        Ok(())
    }
}

fn state_of(conn: &Connection, story_id: &str) -> String {
    get_story(conn, story_id).unwrap().unwrap().state
}

fn session_count(conn: &Connection, story_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM sessions WHERE story_id = ?1",
        rusqlite::params![story_id],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn start_refuses_a_story_that_is_not_ready_and_creates_nothing() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = seeded_git_project();
        let story = new_story(&mut conn, &project.id, &actor, "Not ready");
        let mut port = RecordingPort::default();

        let refused = launch(
            &mut conn,
            &mut port,
            &story.id,
            Intent::Start { instruction: "" },
            Mode::Attended,
        )
        .expect_err("a Story that is not Ready is refused");

        let Refused(reason) = refused;
        assert!(reason.starts_with("Start needs a Ready Story"), "{reason}");
        assert!(port.sent.is_empty());
        assert_eq!(session_count(&conn, &story.id), 0);
    });
}

#[test]
fn start_and_resume_reach_the_same_spawn() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = seeded_git_project();
        let story = new_story(&mut conn, &project.id, &actor, "Launch me");
        set_story_state(&mut conn, &actor, &story.id, StoryState::Ready).unwrap();
        let mut port = RecordingPort::default();

        assert!(launch(
            &mut conn,
            &mut port,
            &story.id,
            Intent::Resume { note: "" },
            Mode::Attended
        )
        .is_err());

        let Launched(first) = launch(
            &mut conn,
            &mut port,
            &story.id,
            Intent::Start { instruction: "" },
            Mode::Attended,
        )
        .expect("a Ready Story starts");
        assert_eq!(state_of(&conn, &story.id), "running");

        close_session(
            &mut conn,
            &first.run_id,
            SessionStatus::Failed,
            None,
            None,
            None,
        )
        .unwrap();
        let Launched(second) = launch(
            &mut conn,
            &mut port,
            &story.id,
            Intent::Resume { note: "carry on" },
            Mode::Attended,
        )
        .expect("a Stopped Story resumes");

        assert_eq!(state_of(&conn, &story.id), "running");
        assert_ne!(first.run_id, second.run_id);
        assert_eq!(port.sent.len(), 2);
        for (sent, outcome) in port.sent.iter().zip([&first, &second]) {
            assert_eq!(sent.1["op"], "spawn");
            assert_eq!(sent.1["runId"], outcome.run_id.as_str());
            assert_eq!(sent.1["permissionMode"], "acceptEdits");
        }
    });
}
