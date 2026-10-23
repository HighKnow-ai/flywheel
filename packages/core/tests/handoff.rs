//! The hand-off and its run of record (issue #53, docs/mvp-spec.md §4.4 and §2 "Story state").
//!
//! At hand-off Flywheel runs every Check of the Story from the worktree root, one at a time, in
//! plain shell, records each result against the commit it ran against with its output tail, and
//! moves the Story to In review whatever the results. A new commit on the branch marks a result
//! stale. The agent can run the Checks for feedback at any time, but those runs are not recorded,
//! and it can neither edit nor delete a Check: editing one is the developer's act, and resets its
//! result to not run.

mod common;

use std::path::Path;
use std::process::Command;
use std::time::{Duration, Instant};

use common::with_scratch_worktree_root;
use core::domain::acceptance_criterion::create_criterion;
use core::domain::check::{branch_head, current_result, remove_check, set_check, Check, CheckResult};
use core::domain::handoff::{hand_off, plan_feedback_run, run_checks, HandoffToolCall};
use core::domain::review::{open_review, reviews_for_story};
use core::domain::session::{agent_actor_id, close_session, start_session, Session, SessionStatus};
use core::domain::session_summary::list_summaries_for_story;
use core::domain::story::{get_story, set_story_state, Story, StoryState};
use core::domain::task::{add_task, set_task_state, TaskState};
use core::domain::worktree::ensure_worktree;
use rusqlite::Connection;
use serde_json::json;
use tempfile::TempDir;

struct Fixture {
    conn: Connection,
    human: String,
    _repo: TempDir,
    story: Story,
    session: Session,
    worktree: std::path::PathBuf,
    checks: Vec<Check>,
}

/// A Running Story with one criterion per `(command, timeout)`, each carrying that Check, a
/// worktree, a live session and a one-Task checklist that is done.
fn running_story(checks: &[(&str, Option<i64>)]) -> Fixture {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &human, "Hand-off fixture");
    let checks = checks
        .iter()
        .enumerate()
        .map(|(i, (command, timeout))| {
            let c = create_criterion(&mut conn, &human, &story.id, &format!("Criterion {i}")).unwrap();
            set_check(&mut conn, &human, &c.id, command, *timeout).unwrap()
        })
        .collect();
    set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    let worktree = ensure_worktree(&mut conn, &story.id, &human).unwrap();
    let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let task = add_task(&mut conn, &agent, &story.id, "Do the work").unwrap();
    set_task_state(&mut conn, &agent, &task.id, TaskState::Done, None).unwrap();
    Fixture { conn, human, _repo: repo, story, session, worktree: worktree.path.into(), checks }
}

fn state_of(conn: &Connection, story_id: &str) -> String {
    get_story(conn, story_id).unwrap().unwrap().state
}

fn recorded_runs(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM check_runs", [], |r| r.get(0)).unwrap()
}

fn git(worktree: &Path, args: &[&str]) -> String {
    let out = Command::new("git").arg("-C").arg(worktree).args(args).output().unwrap();
    assert!(out.status.success(), "git {args:?}: {}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

#[test]
fn a_hand_off_moves_the_story_to_in_review_even_when_a_check_fails() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[("true", None), ("echo broken >&2; exit 1", None)]);

        let outcome = hand_off(&mut f.conn, &f.session.id, "The parser is half done.", "Kept the old seam.").unwrap();

        assert_eq!(state_of(&f.conn, &f.story.id), "in_review", "the Story moves whatever the results");
        let results: Vec<CheckResult> = outcome.batch.outcomes.iter().map(|o| o.result).collect();
        assert_eq!(results, [CheckResult::Passed, CheckResult::Failed]);
        assert_eq!(current_result(&f.conn, &f.checks[1].id).unwrap().result, CheckResult::Failed);
        assert!(
            current_result(&f.conn, &f.checks[1].id).unwrap().output_tail.unwrap().contains("broken"),
            "the output tail carries what the Check printed, standard error included"
        );

        let summaries = list_summaries_for_story(&f.conn, &f.story.id).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].next_session_must_know, "The parser is half done.");
        assert_eq!(summaries[0].decisions, "Kept the old seam.");
        assert!(!summaries[0].is_stub);

        let err = hand_off(&mut f.conn, &f.session.id, "again", "").unwrap_err();
        assert!(err.to_string().contains("Running"), "a Story hands off once: {err}");
    });
}

#[test]
fn a_hand_off_opens_a_review_with_the_diff_stats_and_the_tasks_not_done() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[("true", None)]);
        let base = git(&f.worktree, &["rev-parse", "main"]);
        std::fs::write(f.worktree.join("parser.rs"), "fn parse() {}\nfn more() {}\n").unwrap();
        std::fs::write(f.worktree.join("README.md"), "rewritten\n").unwrap();
        git(&f.worktree, &["add", "parser.rs", "README.md"]);
        git(&f.worktree, &["-c", "user.name=T", "-c", "user.email=t@flywheel.test", "commit", "-m", "parser"]);
        let head = git(&f.worktree, &["rev-parse", "HEAD"]);
        let agent = agent_actor_id(&f.conn).unwrap();
        add_task(&mut f.conn, &agent, &f.story.id, "Left for later").unwrap();
        add_task(&mut f.conn, &agent, &f.story.id, "Also left").unwrap();

        let outcome = hand_off(&mut f.conn, &f.session.id, "Done.", "").unwrap();

        let review = open_review(&f.conn, &f.story.id).unwrap().expect("the hand-off opens a review");
        assert_eq!(review.id, outcome.review_id);
        assert_eq!(review.session_id.as_deref(), Some(f.session.id.as_str()));
        assert_eq!((review.base_sha.as_str(), review.head_sha.as_str()), (base.as_str(), head.as_str()));
        assert_eq!((review.files, review.added, review.removed), (2, 3, 1), "parser.rs +2, README.md +1 -1");
        assert_eq!(review.open_tasks, 2, "the Tasks not done warn at review");
        assert_eq!(review.outcome, None);
        assert_eq!(review.check_objections, json!([]));

        // Requesting changes closes it; the next hand-off opens a new one.
        set_story_state(&mut f.conn, &f.human, &f.story.id, StoryState::Running).unwrap();
        assert!(open_review(&f.conn, &f.story.id).unwrap().is_none());
        let reviews = reviews_for_story(&f.conn, &f.story.id).unwrap();
        assert_eq!(reviews[0].outcome.as_deref(), Some("changes_requested"));
        assert_eq!(reviews[0].decided_by.as_deref(), Some(f.human.as_str()));
    });
}

#[test]
fn every_check_runs_from_the_worktree_root_even_after_a_failure_and_a_timeout_is_labelled_timed_out() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[
            ("exit 3", None),
            ("sleep 30", Some(1)),
            ("echo ran > ran-from-root.txt", None),
        ]);

        let started = Instant::now();
        let outcome = hand_off(&mut f.conn, &f.session.id, "Done.", "").unwrap();
        assert!(started.elapsed() < Duration::from_secs(15), "the timed-out Check was killed at its timeout");

        let results: Vec<(CheckResult, Option<i64>)> =
            outcome.batch.outcomes.iter().map(|o| (o.result, o.exit_code)).collect();
        assert_eq!(
            results,
            [(CheckResult::Failed, Some(3)), (CheckResult::TimedOut, None), (CheckResult::Passed, Some(0))],
            "a failure and a timeout do not stop the rest, and a timeout is not a failure"
        );
        assert!(f.worktree.join("ran-from-root.txt").exists(), "a Check runs from the worktree root");
        assert_eq!(current_result(&f.conn, &f.checks[1].id).unwrap().result, CheckResult::TimedOut);
        assert_eq!(state_of(&f.conn, &f.story.id), "in_review");
    });
}

#[test]
fn a_check_that_leaves_a_background_process_does_not_hold_the_run() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[("sleep 30 & echo started", None)]);
        let started = Instant::now();
        let outcome = hand_off(&mut f.conn, &f.session.id, "Done.", "").unwrap();
        assert!(started.elapsed() < Duration::from_secs(10), "the run ends when the Check's shell does");
        assert_eq!(outcome.batch.outcomes[0].result, CheckResult::Passed);
        assert!(outcome.batch.outcomes[0].output_tail.contains("started"));
    });
}

#[test]
fn each_recorded_result_carries_its_commit_and_a_new_commit_marks_it_stale() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[("true", None)]);
        let head = git(&f.worktree, &["rev-parse", "HEAD"]);

        let outcome = hand_off(&mut f.conn, &f.session.id, "Done.", "").unwrap();
        assert_eq!(outcome.batch.commit_sha, head);
        let current = current_result(&f.conn, &f.checks[0].id).unwrap();
        assert_eq!(current.commit_sha.as_deref(), Some(head.as_str()), "the result belongs to the commit it ran against");
        assert_eq!(branch_head(&f.conn, &f.story.id).unwrap().as_deref(), Some(head.as_str()));
        assert!(!current.is_stale(Some(&head)));

        std::fs::write(f.worktree.join("more.txt"), "more\n").unwrap();
        git(&f.worktree, &["add", "more.txt"]);
        git(&f.worktree, &["-c", "user.name=T", "-c", "user.email=t@flywheel.test", "commit", "-m", "more"]);

        let moved = branch_head(&f.conn, &f.story.id).unwrap();
        assert_ne!(moved.as_deref(), Some(head.as_str()));
        let current = current_result(&f.conn, &f.checks[0].id).unwrap();
        assert_eq!(current.result, CheckResult::Passed, "the result is kept");
        assert!(current.is_stale(moved.as_deref()), "a new commit on the branch marks it stale");
    });
}

#[test]
fn an_agent_run_is_not_recorded_and_the_agent_can_neither_edit_nor_delete_a_check() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[("true", None), ("false", None)]);

        let plan = plan_feedback_run(&f.conn, &f.session.id).unwrap();
        let batch = run_checks(&plan).unwrap();
        let results: Vec<CheckResult> = batch.outcomes.iter().map(|o| o.result).collect();
        assert_eq!(results, [CheckResult::Passed, CheckResult::Failed], "the agent gets the feedback");
        assert_eq!(recorded_runs(&f.conn), 0, "a feedback run is never recorded");
        assert_eq!(current_result(&f.conn, &f.checks[0].id).unwrap().result, CheckResult::NotRun);
        assert_eq!(state_of(&f.conn, &f.story.id), "running", "a feedback run moves nothing");

        // The tool takes no command: it runs the Checks the developer wrote, never one of its own.
        for args in [json!({ "command": "rm -rf ." }), json!({ "timeout_secs": 1 })] {
            assert!(HandoffToolCall::parse("checks_run", &args).is_err(), "{args}");
        }

        let agent = agent_actor_id(&f.conn).unwrap();
        let criterion = f.checks[0].criterion_id.clone();
        assert!(set_check(&mut f.conn, &agent, &criterion, "echo always green", None).is_err());
        assert!(remove_check(&mut f.conn, &agent, &criterion).is_err());
        let kept = core::domain::check::check_for_criterion(&f.conn, &criterion).unwrap().unwrap();
        assert_eq!(kept.command, "true", "the agent's edit and delete changed nothing");
    });
}

#[test]
fn editing_a_check_resets_its_result_to_not_run() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[("true", None)]);
        hand_off(&mut f.conn, &f.session.id, "Done.", "").unwrap();
        assert_eq!(current_result(&f.conn, &f.checks[0].id).unwrap().result, CheckResult::Passed);

        let criterion = f.checks[0].criterion_id.clone();
        set_check(&mut f.conn, &f.human, &criterion, "true && true", None).unwrap();
        let current = current_result(&f.conn, &f.checks[0].id).unwrap();
        assert_eq!(current.result, CheckResult::NotRun, "editing a Check resets its result");
        assert_eq!(current.commit_sha, None);
    });
}

#[test]
fn the_hand_off_needs_a_current_checklist_a_summary_and_a_live_session() {
    with_scratch_worktree_root(|_| {
        let mut f = running_story(&[("true", None)]);
        let agent = agent_actor_id(&f.conn).unwrap();

        for args in [
            json!({ "decisions": "" }),
            json!({ "next_session_must_know": "   ", "decisions": "" }),
            json!({ "next_session_must_know": "x" }),
        ] {
            assert!(HandoffToolCall::parse("handoff", &args).is_err(), "{args}");
        }
        assert_eq!(
            HandoffToolCall::parse("handoff", &json!({ "next_session_must_know": " Know this. ", "decisions": "" })).unwrap(),
            HandoffToolCall::Handoff { next_session_must_know: "Know this.".into(), decisions: String::new() }
        );

        // A Task still doing: the checklist is not current.
        let doing = add_task(&mut f.conn, &agent, &f.story.id, "Half done").unwrap();
        set_task_state(&mut f.conn, &agent, &doing.id, TaskState::Doing, None).unwrap();
        let err = hand_off(&mut f.conn, &f.session.id, "Done.", "").unwrap_err();
        assert!(err.to_string().contains("doing"), "{err}");
        assert_eq!(state_of(&f.conn, &f.story.id), "running");
        assert_eq!(recorded_runs(&f.conn), 0, "a refused hand-off runs nothing");

        // An open Task is allowed: it only warns at review.
        set_task_state(&mut f.conn, &agent, &doing.id, TaskState::Open, None).unwrap();

        close_session(&mut f.conn, &f.session.id, SessionStatus::Failed, None, None, None).unwrap();
        let err = hand_off(&mut f.conn, &f.session.id, "Done.", "").unwrap_err();
        assert!(err.to_string().contains("ended"), "{err}");
    });
}

#[test]
fn a_hand_off_without_a_checklist_is_refused() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &human, "No plan");
        set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
        ensure_worktree(&mut conn, &story.id, &human).unwrap();
        let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
        let err = hand_off(&mut conn, &session.id, "Done.", "").unwrap_err();
        assert!(err.to_string().contains("task_add"), "{err}");
    });
}
