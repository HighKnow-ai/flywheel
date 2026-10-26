//! The review card's read (docs/mvp-spec.md §2 "In review → Merged", §8, issue #158): a branch that
//! would conflict with its base branch reads Rebase needed, naming the conflicting paths, and the card
//! offers a request for changes whose comment names them. Issue #157's tests (failing Checks first,
//! Check objections, the diff's files and Re-run Checks) are in `review_card/checks.rs`. Every test
//! runs against temporary repositories only.

mod common;
/// Issue #157: failing Checks first, Check objections, the diff's files and Re-run Checks.
#[path = "review_card/checks.rs"]
mod checks;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use flywheel_core::domain::handoff::hand_off;
use flywheel_core::domain::request_changes::request_changes;
use flywheel_core::domain::review::{rebase_comment, review_for_story};
use flywheel_core::domain::session::{agent_actor_id, close_session, start_session, SessionStatus};
use flywheel_core::domain::task::{add_task, set_task_state, TaskState};
use flywheel_core::domain::story::{set_story_state, Story, StoryState};
use flywheel_core::domain::worktree::ensure_worktree;
use rusqlite::Connection;
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@flywheel.test"])
        .args(args)
        .output()
        .expect("git should spawn");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
}

fn commit_file(dir: &Path, name: &str, body: &str) {
    std::fs::write(dir.join(name), body).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-q", "-m", &format!("Edit {name}")]);
}

struct Fixture {
    conn: Connection,
    human: String,
    repo: TempDir,
    story: Story,
    worktree: PathBuf,
}

/// An In review Story whose branch edits `README.md` and adds `notes.md`, handed off.
fn in_review() -> Fixture {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &human, "Rewrite the readme");
    set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
    let worktree = PathBuf::from(&wt.path);
    let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let task = add_task(&mut conn, &agent, &story.id, "Rewrite it").unwrap();
    set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();
    commit_file(&worktree, "README.md", "the branch's readme\n");
    commit_file(&worktree, "notes.md", "the branch's notes\n");
    hand_off(&mut conn, &session.id, "Done.", "").unwrap();
    close_session(&mut conn, &session.id, SessionStatus::Completed, None, None, None).unwrap();
    Fixture { conn, human, repo, story, worktree }
}

#[test]
fn a_branch_that_merges_cleanly_needs_no_rebase() {
    with_scratch_worktree_root(|_| {
        let f = in_review();
        commit_file(f.repo.path(), "other.md", "main moves elsewhere\n");
        let review = review_for_story(&f.conn, &f.story.id).unwrap();
        assert!(review.conflicts.is_empty(), "{:?}", review.conflicts);
        assert_eq!(review.base_branch.as_deref(), Some("main"));
    });
}

#[test]
fn a_conflicting_branch_reads_rebase_needed_with_its_paths() {
    with_scratch_worktree_root(|_| {
        let f = in_review();
        commit_file(f.repo.path(), "README.md", "main's readme\n");
        commit_file(f.repo.path(), "notes.md", "main's notes\n");

        let review = review_for_story(&f.conn, &f.story.id).unwrap();

        assert_eq!(review.conflicts, vec!["README.md".to_string(), "notes.md".to_string()]);
        let comment = review.rebase_comment().expect("a conflict has a pre-filled comment");
        assert!(comment.starts_with("Rebase needed:"), "{comment}");
        assert!(comment.contains("README.md") && comment.contains("notes.md") && comment.contains("main"), "{comment}");
        assert!(f.worktree.is_dir(), "the read writes nothing");
    });
}

#[test]
fn the_rebase_action_sends_the_story_back_with_the_paths_in_its_comment() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        commit_file(f.repo.path(), "README.md", "main's readme\n");
        let comment = review_for_story(&f.conn, &f.story.id).unwrap().rebase_comment().unwrap();

        let human = f.human.clone();
        request_changes(&mut f.conn, &human, &f.story.id, &comment).unwrap();

        let review = flywheel_core::domain::review::reviews_for_story(&f.conn, &f.story.id).unwrap().pop().unwrap();
        assert_eq!(review.outcome.as_deref(), Some("changes_requested"));
        assert!(review.comments.unwrap().contains("README.md"));
    });
}

#[test]
fn only_a_story_in_review_is_checked_for_conflicts() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review();
        commit_file(f.repo.path(), "README.md", "main's readme\n");
        let human = f.human.clone();
        request_changes(&mut f.conn, &human, &f.story.id, "Rebase.").unwrap();
        let review = review_for_story(&f.conn, &f.story.id).unwrap();
        assert!(review.conflicts.is_empty(), "a Running Story is not judged for a merge");
    });
}

/// Needs you labels the Review item of a conflicting branch Rebase needed, with its paths.
#[test]
fn needs_you_carries_the_conflicting_paths_on_the_review_item() {
    with_scratch_worktree_root(|_| {
        let f = in_review();
        let review_item = |f: &Fixture| {
            flywheel_core::query::needs_you::needs_you(&f.conn, &f.story.project_id)
                .unwrap()
                .into_iter()
                .find(|i| i.kind == flywheel_core::query::needs_you::NeedsYouKind::Review)
                .expect("a Review item")
        };
        assert!(review_item(&f).conflicts.is_empty(), "a clean branch is a plain Review");

        commit_file(f.repo.path(), "README.md", "main's readme\n");
        assert_eq!(review_item(&f).conflicts, vec!["README.md".to_string()]);
    });
}

#[test]
fn the_pre_filled_comment_names_the_base_branch_and_every_path() {
    let comment = rebase_comment("main", &["a.rs".to_string(), "b/c.rs".to_string()]);
    assert_eq!(
        comment,
        "Rebase needed: merging into main would conflict in a.rs, b/c.rs. Rebase this branch on main, resolve those \
         conflicts, and re-run the Checks before handing off."
    );
}
