//! Drop (docs/mvp-spec.md §2, issue #54): the developer ends a Story on purpose from any state
//! but Merged. Its worktree and branch are removed, uncommitted work included, through the system
//! `git` CLI; the record, criteria, Tasks, sessions and summaries stay readable; Dropped counts as
//! closed for its Epic. A Story with a live session refuses: stop the session first.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use core::domain::acceptance_criterion::{create_criterion, criteria_for_story};
use core::domain::epic::{set_epic_state, EpicState};
use core::domain::session::{interrupt_session, start_session};
use core::domain::session_summary::list_summaries_for_story;
use core::domain::story::{get_story, set_story_state, StoryState};
use core::domain::story_drop::drop_story;
use core::domain::task::{add_task, tasks_for_story};
use core::query::sessions::runs_for_story;
use rusqlite::params;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(dir).args(args).output().expect("git should spawn");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn dropping_a_stopped_story_removes_its_worktree_and_branch_and_keeps_its_record() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor, "Drop me");
        create_criterion(&mut conn, &actor, &story.id, "It parses").unwrap();
        set_story_state(&mut conn, &actor, &story.id, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &actor, &story.id, StoryState::Running).unwrap();
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor).unwrap();
        add_task(&mut conn, &run.actor_id, &story.id, "Wire the parser").unwrap();
        let (path, branch): (String, String) = conn
            .query_row("SELECT path, branch FROM worktrees WHERE story_id = ?1", params![story.id], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        let path = PathBuf::from(path);
        std::fs::write(path.join("half-done.txt"), "uncommitted\n").unwrap();
        core::domain::session_summary::create_summary(&mut conn, &run.id, "parser half done", "").unwrap();
        interrupt_session(&mut conn, &run.id, &actor).unwrap();

        drop_story(&mut conn, &actor, &story.id).expect("a Stopped Story drops");

        assert!(!path.exists(), "the worktree directory is gone, uncommitted work included");
        assert_eq!(git(repo.path(), &["branch", "--list", &branch]), "", "the branch is gone");
        assert!(!git(repo.path(), &["worktree", "list"]).contains(&branch));
        let worktrees: i64 =
            conn.query_row("SELECT COUNT(*) FROM worktrees WHERE story_id = ?1", params![story.id], |r| r.get(0)).unwrap();
        assert_eq!(worktrees, 0);

        let dropped = get_story(&conn, &story.id).unwrap().expect("the record stays");
        assert_eq!(dropped.state, "dropped");
        assert_eq!(dropped.title, "Drop me");
        assert_eq!(criteria_for_story(&conn, &story.id).unwrap().len(), 1);
        assert_eq!(tasks_for_story(&conn, &story.id).unwrap().len(), 1);
        assert_eq!(runs_for_story(&conn, &story.id, 10, 0).unwrap().len(), 1);
        assert_eq!(list_summaries_for_story(&conn, &story.id).unwrap().len(), 1);

        assert!(drop_story(&mut conn, &actor, &story.id).is_err(), "a Dropped Story cannot drop again");
    });
}

#[test]
fn a_dropped_story_counts_as_closed_for_its_epic() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor, "Never started");
        assert!(set_epic_state(&mut conn, &actor, &story.epic_id, EpicState::Done).is_err(), "an open Story blocks Done");

        drop_story(&mut conn, &actor, &story.id).expect("a Shaping Story with no worktree drops");

        set_epic_state(&mut conn, &actor, &story.epic_id, EpicState::Done).expect("every Story is closed");
    });
}

#[test]
fn drop_refuses_while_a_session_is_live() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor, "Busy");
        set_story_state(&mut conn, &actor, &story.id, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &actor, &story.id, StoryState::Running).unwrap();
        let run = start_session(&mut conn, &story.id, "acceptEdits", &actor).unwrap();
        let path: String =
            conn.query_row("SELECT path FROM worktrees WHERE story_id = ?1", params![story.id], |r| r.get(0)).unwrap();

        let err = drop_story(&mut conn, &actor, &story.id).expect_err("a live session refuses Drop");
        assert!(err.to_string().contains("Stop the session first"), "{err:#}");
        assert!(Path::new(&path).is_dir(), "nothing was removed");
        assert_eq!(get_story(&conn, &story.id).unwrap().unwrap().state, "running");

        interrupt_session(&mut conn, &run.id, &actor).unwrap();
        drop_story(&mut conn, &actor, &story.id).expect("once stopped, it drops");
    });
}

#[test]
fn only_the_developer_drops_a_story() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor, "Agent may not");
        let agent = core::domain::session::agent_actor_id(&conn).unwrap();
        assert!(drop_story(&mut conn, &agent, &story.id).is_err(), "Drop is the developer's act");
        assert_eq!(get_story(&conn, &story.id).unwrap().unwrap().state, "shaping");
    });
}
