//! Merge (docs/mvp-spec.md §2 "In review → Merged", §8, issue #155, ADR 0009): the developer merges an
//! In review Story from its review card. Flywheel writes a `--no-ff` merge commit on the base branch,
//! removes the worktree and the branch, moves the Story to Merged and closes its review.
//!
//! How the commit is written depends on the developer's own checkout of the base branch (ADR 0009):
//! checked out and clean, `git merge --no-ff` runs there; checked out and dirty, Merge refuses; not
//! checked out, the same two-parent commit is built with plumbing and the branch ref moved by
//! compare-and-swap. Merge never pushes.
//!
//! Merge refuses, and leaves everything as it was, while a criterion is unaccepted, a session is live,
//! the worktree is dirty, a merge would conflict, or (without the override) a Check is failed, timed
//! out, not run or stale. Every test runs against temporary repositories only.

mod common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use core::domain::acceptance_criterion::{accept_criterion, create_criterion, criteria_for_story};
use core::domain::check::{set_check, Check};
use core::domain::handoff::hand_off;
use core::domain::review::{open_review, reviews_for_story};
use core::domain::session::{agent_actor_id, close_session, start_session, SessionStatus};
use core::domain::story::{get_story, set_story_state, Story, StoryState};
use core::domain::story_merge::{merge_story, MergeMethod, MergeOptions};
use core::domain::task::{add_task, set_task_state, TaskState};
use core::domain::worktree::{ensure_worktree, worktree_for_story};
use rusqlite::{params, Connection};
use tempfile::TempDir;

fn git(dir: &Path, args: &[&str]) -> String {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["-c", "user.name=T", "-c", "user.email=t@flywheel.test"])
        .args(args)
        .output()
        .expect("git should spawn");
    assert!(out.status.success(), "git {args:?} failed: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn commit_file(dir: &Path, name: &str, body: &str, message: &str) -> String {
    std::fs::write(dir.join(name), body).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-q", "-m", message]);
    git(dir, &["rev-parse", "HEAD"])
}

struct Fixture {
    conn: Connection,
    human: String,
    repo: TempDir,
    story: Story,
    worktree: PathBuf,
    branch: String,
    checks: Vec<Check>,
    session_id: String,
}

impl Fixture {
    fn repo(&self) -> &Path {
        self.repo.path()
    }

    fn state(&self) -> String {
        get_story(&self.conn, &self.story.id).unwrap().unwrap().state
    }

    fn main_tip(&self) -> String {
        git(self.repo(), &["rev-parse", "refs/heads/main"])
    }

    fn accept_all(&mut self) {
        for c in criteria_for_story(&self.conn, &self.story.id).unwrap() {
            accept_criterion(&mut self.conn, &self.human, &c.id).unwrap();
        }
    }

    fn merge(&mut self, with_failing_checks: bool) -> anyhow::Result<core::domain::story_merge::MergeOutcome> {
        let human = self.human.clone();
        merge_story(&mut self.conn, &human, &self.story.id, MergeOptions { with_failing_checks })
    }

    /// Everything a refused Merge must leave as it was.
    fn snapshot(&self) -> (String, String, bool, bool, i64) {
        let branch_exists = !git(self.repo(), &["branch", "--list", &self.branch]).is_empty();
        let events: i64 = self.conn.query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0)).unwrap();
        (self.state(), self.main_tip(), self.worktree.is_dir(), branch_exists, events)
    }
}

/// An In review Story: one criterion per Check command, a worktree with one commit adding
/// `feature.txt`, handed off (so each Check has its run of record) and its session ended.
fn in_review(checks: &[&str]) -> Fixture {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &human, "Parse the config");
    let checks = checks
        .iter()
        .enumerate()
        .map(|(i, command)| {
            let c = create_criterion(&mut conn, &human, &story.id, &format!("Criterion {i}")).unwrap();
            set_check(&mut conn, &human, &c.id, command, None).unwrap()
        })
        .collect();
    set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    let wt = ensure_worktree(&mut conn, &story.id, &human).unwrap();
    let worktree = PathBuf::from(&wt.path);
    let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let task = add_task(&mut conn, &agent, &story.id, "Write the parser").unwrap();
    set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();
    commit_file(&worktree, "feature.txt", "parsed\n", "Parse the config");
    hand_off(&mut conn, &session.id, "The parser is done.", "").unwrap();
    close_session(&mut conn, &session.id, SessionStatus::Completed, None, None, None).unwrap();
    Fixture { conn, human, repo, story, worktree, branch: wt.branch, checks, session_id: session.id }
}

fn parents(repo: &Path, rev: &str) -> Vec<String> {
    git(repo, &["rev-list", "--parents", "-n", "1", rev]).split_whitespace().skip(1).map(str::to_string).collect()
}

fn event_payload(conn: &Connection, story_id: &str, event_type: &str) -> serde_json::Value {
    let text: String = conn
        .query_row(
            "SELECT payload FROM events WHERE story_id = ?1 AND event_type = ?2 ORDER BY rowid DESC LIMIT 1",
            params![story_id, event_type],
            |r| r.get(0),
        )
        .unwrap_or_else(|e| panic!("no {event_type} event: {e}"));
    serde_json::from_str(&text).unwrap()
}

#[test]
fn merge_writes_a_no_ff_commit_in_the_clean_checkout_removes_the_worktree_and_branch_and_closes_the_review() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["test -f feature.txt"]);
        f.accept_all();
        let old_tip = f.main_tip();
        let branch_head = git(&f.worktree, &["rev-parse", "HEAD"]);

        let outcome = f.merge(false).expect("a fully accepted, passing, clean Story merges");

        assert_eq!(outcome.method, MergeMethod::Checkout, "main is checked out and clean in the repository");
        let tip = f.main_tip();
        assert_eq!(outcome.merge_commit, tip);
        assert_eq!(parents(f.repo(), &tip), [old_tip, branch_head], "a two-parent --no-ff merge commit on main");
        assert!(f.repo().join("feature.txt").exists(), "the checkout was merged in place");
        assert_eq!(git(f.repo(), &["status", "--porcelain"]), "", "the developer's checkout is left clean");

        assert!(!f.worktree.exists(), "the worktree is removed");
        assert_eq!(git(f.repo(), &["branch", "--list", &f.branch]), "", "the branch is deleted");
        assert!(worktree_for_story(&f.conn, &f.story.id).unwrap().is_none(), "the worktree row is gone");
        assert_eq!(f.state(), "merged");

        assert!(open_review(&f.conn, &f.story.id).unwrap().is_none());
        let reviews = reviews_for_story(&f.conn, &f.story.id).unwrap();
        assert_eq!(reviews.len(), 1);
        assert_eq!(reviews[0].outcome.as_deref(), Some("merged"));
        assert_eq!(reviews[0].decided_by.as_deref(), Some(f.human.as_str()));
        assert_eq!(reviews[0].failing_checks_overridden, None, "nothing was overridden");

        let merged = event_payload(&f.conn, &f.story.id, "story.merged");
        assert_eq!(merged["merge_commit"], tip);
        assert_eq!(merged["base_branch"], "main");
        assert_eq!(merged["failing_checks_overridden"], serde_json::json!([]));
        assert!(f.merge(false).is_err(), "a Merged Story cannot merge again");
    });
}

#[test]
fn without_a_checkout_of_the_base_branch_merge_builds_the_same_commit_with_plumbing() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true"]);
        f.accept_all();
        git(f.repo(), &["switch", "-q", "-c", "elsewhere"]);
        let old_tip = f.main_tip();
        let branch_head = git(&f.worktree, &["rev-parse", "HEAD"]);

        let outcome = f.merge(false).expect("merges without a checkout of main");

        assert_eq!(outcome.method, MergeMethod::Plumbing);
        let tip = f.main_tip();
        assert_eq!(outcome.merge_commit, tip);
        assert_eq!(parents(f.repo(), &tip), [old_tip, branch_head]);
        assert_eq!(git(f.repo(), &["show", "-s", "--format=%s", &tip]), format!("Merge {}: Parse the config", f.story.key));
        assert_eq!(git(f.repo(), &["ls-tree", "--name-only", &tip]), "README.md\nfeature.txt");
        assert_eq!(git(f.repo(), &["symbolic-ref", "--short", "HEAD"]), "elsewhere", "the developer's checkout is untouched");
        assert!(!f.repo().join("feature.txt").exists(), "nothing was written into the developer's working tree");
        assert!(!f.worktree.exists());
        assert_eq!(git(f.repo(), &["branch", "--list", &f.branch]), "", "the merged branch is deleted");
        assert_eq!(f.state(), "merged");
    });
}

#[test]
fn a_dirty_checkout_of_the_base_branch_refuses_and_says_so() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true"]);
        f.accept_all();
        std::fs::write(f.repo().join("README.md"), "edited by hand\n").unwrap();
        let before = f.snapshot();

        let err = format!("{:#}", f.merge(false).expect_err("a dirty checkout of main refuses"));

        assert!(err.contains("main") && err.contains("uncommitted"), "{err}");
        assert_eq!(f.snapshot(), before, "a refused Merge changes nothing");
        assert_eq!(std::fs::read_to_string(f.repo().join("README.md")).unwrap(), "edited by hand\n");
    });
}

#[test]
fn a_conflict_refuses_naming_the_paths_and_leaves_everything_as_it_was() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true"]);
        f.accept_all();
        commit_file(&f.worktree, "README.md", "the branch's readme\n", "Branch edits the readme");
        // The branch moved, so the Check result is stale: override it to reach the conflict.
        commit_file(f.repo(), "README.md", "main's readme\n", "Main edits the readme");
        let before = f.snapshot();

        let err = format!("{:#}", f.merge(true).expect_err("a conflicting merge refuses"));

        assert!(err.contains("README.md") && err.contains("conflict"), "{err}");
        assert_eq!(f.snapshot(), before, "a refused Merge changes nothing");
        assert!(open_review(&f.conn, &f.story.id).unwrap().is_some(), "the review stays open");
        assert_eq!(git(f.repo(), &["status", "--porcelain"]), "", "no merge is left in progress");
    });
}

#[test]
fn merge_is_refused_while_a_criterion_is_unaccepted() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true", "true"]);
        let first = criteria_for_story(&f.conn, &f.story.id).unwrap()[0].id.clone();
        accept_criterion(&mut f.conn, &f.human.clone(), &first).unwrap();
        let before = f.snapshot();

        let err = format!("{:#}", f.merge(true).expect_err("an unaccepted criterion refuses, override or not"));

        assert!(err.contains("Criterion 1") && err.contains("accept"), "{err}");
        assert_eq!(f.snapshot(), before);
    });
}

#[test]
fn merge_is_refused_while_a_session_is_live() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true"]);
        f.accept_all();
        // A session the core still records as running on this Story.
        f.conn
            .execute("UPDATE sessions SET status = 'running', ended_at = NULL WHERE id = ?1", params![f.session_id])
            .unwrap();
        let before = f.snapshot();

        let err = format!("{:#}", f.merge(false).expect_err("a live session refuses"));

        assert!(err.contains("live session"), "{err}");
        assert_eq!(f.snapshot(), before);
    });
}

#[test]
fn merge_is_refused_while_the_worktree_is_dirty() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true"]);
        f.accept_all();
        std::fs::write(f.worktree.join("scratch.txt"), "not committed\n").unwrap();
        let before = f.snapshot();

        let err = format!("{:#}", f.merge(true).expect_err("a dirty worktree refuses"));

        assert!(err.contains("uncommitted") && err.contains("scratch.txt"), "{err}");
        assert_eq!(f.snapshot(), before);
    });
}

#[test]
fn a_failed_or_timed_out_check_needs_the_override_which_is_recorded_on_the_review_and_the_event() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true", "exit 1", "exit 7"]);
        // Record the last Check's run as a timeout, which a real ten-minute timeout would take too long to reach.
        f.conn
            .execute(
                "UPDATE check_runs SET result = 'timed_out', exit_code = NULL WHERE check_id = ?1",
                params![f.checks[2].id],
            )
            .unwrap();
        f.accept_all();
        let before = f.snapshot();

        let err = format!("{:#}", f.merge(false).expect_err("a failing Check needs the override"));
        assert!(err.contains("exit 1") && err.contains("exit 7") && err.contains("Merge with failing Check"), "{err}");
        assert!(!err.contains("`true`"), "a passed Check is not named: {err}");
        assert_eq!(f.snapshot(), before);

        f.merge(true).expect("the override merges");

        assert_eq!(f.state(), "merged");
        let review = reviews_for_story(&f.conn, &f.story.id).unwrap().pop().unwrap();
        let overridden = review.failing_checks_overridden.expect("the override is recorded on the review");
        let commands: Vec<&str> = overridden.as_array().unwrap().iter().map(|c| c["command"].as_str().unwrap()).collect();
        assert_eq!(commands, ["exit 1", "exit 7"]);
        assert_eq!(overridden[0]["result"], "failed");
        assert_eq!(overridden[1]["result"], "timed_out");
        let merged = event_payload(&f.conn, &f.story.id, "story.merged");
        assert_eq!(merged["failing_checks_overridden"], overridden, "and on the story.merged event");
    });
}

#[test]
fn a_stale_or_not_run_check_counts_as_failing() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true", "test -f feature.txt"]);
        f.accept_all();

        // Not run: editing a Check resets its result.
        let criterion = f.checks[1].criterion_id.clone();
        set_check(&mut f.conn, &f.human.clone(), &criterion, "test -s feature.txt", None).unwrap();
        let err = format!("{:#}", f.merge(false).expect_err("a not-run Check needs the override"));
        assert!(err.contains("test -s feature.txt") && err.contains("not run"), "{err}");

        // Stale: the branch moved since the Checks ran.
        commit_file(&f.worktree, "more.txt", "more\n", "More");
        let err = format!("{:#}", f.merge(false).expect_err("a stale Check needs the override"));
        assert!(err.contains("`true`") && err.contains("stale"), "{err}");

        f.merge(true).expect("the override merges");
        let review = reviews_for_story(&f.conn, &f.story.id).unwrap().pop().unwrap();
        let overridden = review.failing_checks_overridden.unwrap();
        assert_eq!(overridden.as_array().unwrap().len(), 2, "{overridden}");
        assert_eq!(overridden[0]["stale"], true);
        assert_eq!(overridden[1]["result"], "not_run");
        assert!(git(f.repo(), &["ls-tree", "--name-only", "refs/heads/main"]).contains("more.txt"), "the merge took the branch's head");
    });
}

#[test]
fn only_the_developer_merges_and_a_refused_agent_touches_nothing() {
    with_scratch_worktree_root(|_| {
        let mut f = in_review(&["true"]);
        f.accept_all();
        let agent = agent_actor_id(&f.conn).unwrap();
        let before = f.snapshot();

        let err = merge_story(&mut f.conn, &agent, &f.story.id, MergeOptions { with_failing_checks: true }).unwrap_err();

        assert!(format!("{err:#}").contains("agent"), "{err:#}");
        assert_eq!(f.snapshot(), before);
    });
}

#[test]
fn a_story_that_is_not_in_review_does_not_merge() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &human, "Still shaping");
        let err = merge_story(&mut conn, &human, &story.id, MergeOptions { with_failing_checks: true }).unwrap_err();
        assert!(format!("{err:#}").contains("In review"), "{err:#}");
        assert_eq!(get_story(&conn, &story.id).unwrap().unwrap().state, "shaping");
    });
}
