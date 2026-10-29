//! Request changes (docs/mvp-spec.md §2 "In review → Running", §4.3, §8, issue #158): the developer
//! sends an In review Story back to Running with review comments. The open review closes as
//! `changes_requested` with those comments, the Task checklist is kept, and the next session, in the
//! same worktree, starts from a Context packet that carries the comments and tells the agent to add
//! one Task per review point before anything else.
//!
//! Every test runs against temporary repositories only.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use flywheel_core::context_packet::build_context_packet;
use flywheel_core::domain::acceptance_criterion::create_criterion;
use flywheel_core::domain::check::set_check;
use flywheel_core::domain::handoff::hand_off;
use flywheel_core::domain::request_changes::request_changes;
use flywheel_core::domain::review::{open_review, reviews_for_story};
use flywheel_core::domain::session::{agent_actor_id, close_session, start_session, SessionStatus};
use flywheel_core::domain::story::{get_story, set_story_state, Story, StoryState};
use flywheel_core::domain::task::{add_task, set_task_state, tasks_for_story, TaskState};
use flywheel_core::domain::worktree::{ensure_worktree, worktree_for_story};
use rusqlite::{params, Connection};
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@flywheel.test"])
        .args(args)
        .output()
        .expect("git should spawn");
    assert!(
        out.status.success(),
        "git {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
}

struct Fixture {
    conn: Connection,
    human: String,
    _repo: TempDir,
    story: Story,
    worktree: PathBuf,
    session_id: String,
}

impl Fixture {
    fn state(&self) -> String {
        get_story(&self.conn, &self.story.id)
            .unwrap()
            .unwrap()
            .state
    }

    fn request(&mut self, comments: &str) -> anyhow::Result<()> {
        let human = self.human.clone();
        request_changes(&mut self.conn, &human, &self.story.id, comments)
    }
}

/// An In review Story with one criterion and its Check, two Tasks (one done, one still open), a
/// commit on its branch, handed off and its session ended.
fn in_review() -> Fixture {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &human, "Parse the config");
    let c = create_criterion(&mut conn, &human, &story.id, "The config parses.").unwrap();
    set_check(&mut conn, &human, &c.id, "true", None).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
    let worktree = PathBuf::from(&wt.path);
    let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let done = add_task(&mut conn, &agent, &story.id, "Write the parser").unwrap();
    set_task_state(&mut conn, &agent, &done.id, TaskState::Done, None).unwrap();
    add_task(&mut conn, &agent, &story.id, "Document the format").unwrap();
    std::fs::write(worktree.join("parser.txt"), "parsed\n").unwrap();
    git(&worktree, &["add", "parser.txt"]);
    git(&worktree, &["commit", "-q", "-m", "Parse the config"]);
    hand_off(&mut conn, &session.id, "The parser is done.", "").unwrap();
    close_session(
        &mut conn,
        &session.id,
        SessionStatus::Completed,
        None,
        None,
        None,
    )
    .unwrap();
    Fixture {
        conn,
        human,
        _repo: repo,
        story,
        worktree,
        session_id: session.id,
    }
}

#[test]
fn request_changes_moves_the_story_to_running_and_closes_the_review_with_the_comments() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        let review_id = open_review(&f.conn, &f.story.id)
            .unwrap()
            .expect("the hand-off opened a review")
            .id;

        f.request("  Name the line in each parse error.\nCover an empty file.  ")
            .unwrap();

        assert_eq!(f.state(), "running");
        assert!(
            open_review(&f.conn, &f.story.id).unwrap().is_none(),
            "no review is left open"
        );
        let reviews = reviews_for_story(&f.conn, &f.story.id).unwrap();
        let closed = reviews.iter().find(|r| r.id == review_id).unwrap();
        assert_eq!(closed.outcome.as_deref(), Some("changes_requested"));
        assert_eq!(
            closed.comments.as_deref(),
            Some("Name the line in each parse error.\nCover an empty file.")
        );
        assert_eq!(closed.decided_by.as_deref(), Some(f.human.as_str()));

        let label: String = f
            .conn
            .query_row(
                "SELECT json_extract(payload, '$.label') FROM events WHERE story_id = ?1 AND event_type = 'story.changes_requested'",
                params![f.story.id],
                |r| r.get(0),
            )
            .expect("a story.changes_requested event");
        assert!(label.contains(&f.story.key), "{label}");
    });
}

#[test]
fn the_task_checklist_is_kept() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        let before: Vec<(String, String)> = tasks_for_story(&f.conn, &f.story.id)
            .unwrap()
            .into_iter()
            .map(|t| (t.title, t.state))
            .collect();

        f.request("Cover an empty file.").unwrap();

        let after: Vec<(String, String)> = tasks_for_story(&f.conn, &f.story.id)
            .unwrap()
            .into_iter()
            .map(|t| (t.title, t.state))
            .collect();
        assert_eq!(
            after, before,
            "Request changes neither drops nor reopens a Task"
        );
    });
}

#[test]
fn the_next_session_runs_in_the_same_worktree_from_a_packet_that_carries_the_comments() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        let worktree_id = worktree_for_story(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .id;

        f.request("Name the line in each parse error.").unwrap();
        let human = f.human.clone();
        let next = start_session(&mut f.conn, &f.story.id, "acceptEdits", &human).unwrap();

        assert_ne!(next.id, f.session_id, "a fresh session");
        assert_eq!(next.worktree_id, Some(worktree_id), "in the same worktree");
        assert!(
            f.worktree.join("parser.txt").is_file(),
            "with the work so far"
        );
        let packet = build_context_packet(&f.conn, &f.story.id, "").unwrap();
        assert!(
            packet.contains("Name the line in each parse error."),
            "{packet}"
        );
    });
}

#[test]
fn request_changes_needs_comments_and_a_blank_one_writes_nothing() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        let err = format!(
            "{:#}",
            f.request("   \n ").expect_err("blank comments are refused")
        );
        assert!(err.contains("comment"), "{err}");
        assert_eq!(f.state(), "in_review");
        assert!(
            open_review(&f.conn, &f.story.id).unwrap().is_some(),
            "the review stays open"
        );
    });
}

#[test]
fn only_a_story_in_review_takes_a_request_for_changes() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        f.request("Cover an empty file.").unwrap();
        let err = format!(
            "{:#}",
            f.request("Again.")
                .expect_err("a Running Story is not In review")
        );
        assert!(err.contains("In review"), "{err}");
    });
}

#[test]
fn request_changes_is_refused_while_a_session_is_live() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        f.conn
            .execute(
                "UPDATE sessions SET status = 'running', ended_at = NULL WHERE id = ?1",
                params![f.session_id],
            )
            .unwrap();
        let err = format!(
            "{:#}",
            f.request("Cover an empty file.")
                .expect_err("a live session refuses")
        );
        assert!(err.contains("live session"), "{err}");
        assert_eq!(f.state(), "in_review");
    });
}

#[test]
fn an_agent_cannot_request_changes() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        let agent = agent_actor_id(&f.conn).unwrap();
        let story_id = f.story.id.clone();
        request_changes(&mut f.conn, &agent, &story_id, "Cover an empty file.")
            .expect_err("an agent is refused");
        assert_eq!(f.state(), "in_review");
        assert!(open_review(&f.conn, &f.story.id).unwrap().is_some());
    });
}
