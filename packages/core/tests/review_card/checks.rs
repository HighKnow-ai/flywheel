//! The review card's read and its Re-run Checks (docs/mvp-spec.md §8, issue #157).
//!
//! The read lists the Checks not passing at the branch's head first, failed and timed out before
//! stale and not run, each with its output tail; the Tasks not done; each of the handing-off agent's
//! Check objections beside the Check it is about; and the changed files of the review's diff, whose
//! patches are read one file at a time.
//!
//! Re-run Checks is the developer's: it runs every Check of an In review Story from its worktree, with
//! no session, and records each run against the branch's head, which clears a stale result. It is
//! refused while a session of the Story is live. Every test runs against temporary repositories only.

use super::common;

use std::path::{Path, PathBuf};
use std::process::Command;

use common::with_scratch_worktree_root;
use flywheel_core::domain::acceptance_criterion::create_criterion;
use flywheel_core::domain::check::{current_result, set_check, Check, CheckResult};
use flywheel_core::domain::handoff::{
    complete_handoff, complete_review_run, plan_handoff, plan_review_run, rerun_checks, run_checks,
    run_checks_reporting, CheckObjection, HandoffSummary,
};
use flywheel_core::domain::review::{open_review, review_file_patch, review_for_story};
use flywheel_core::domain::session::{
    agent_actor_id, close_session, start_session, Session, SessionStatus,
};
use flywheel_core::domain::story::{set_story_state, Story, StoryState};
use flywheel_core::domain::task::{add_task, set_task_state, TaskState};
use flywheel_core::domain::worktree::ensure_worktree;
use rusqlite::{params, Connection};
use serde_json::json;
use tempfile::TempDir;

struct Fixture {
    conn: Connection,
    human: String,
    _repo: TempDir,
    story: Story,
    session: Session,
    worktree: PathBuf,
    checks: Vec<Check>,
}

fn git(dir: &Path, args: &[&str]) -> String {
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
    String::from_utf8_lossy(&out.stdout).trim().to_string()
}

fn commit_file(dir: &Path, name: &str, body: &str) -> String {
    std::fs::write(dir.join(name), body).unwrap();
    git(dir, &["add", name]);
    git(dir, &["commit", "-q", "-m", name]);
    git(dir, &["rev-parse", "HEAD"])
}

fn recorded_runs(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM check_runs", [], |r| r.get(0))
        .unwrap()
}

/// A Running Story with one criterion per `(command, timeout)`, a worktree with one commit adding
/// `feature.txt`, a live session and a done Task. Not handed off yet.
fn running(checks: &[(&str, Option<i64>)]) -> Fixture {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let story = common::new_story(&mut conn, &project.id, &human, "Parse the config");
    let checks = checks
        .iter()
        .enumerate()
        .map(|(i, (command, timeout))| {
            let c = create_criterion(
                &mut conn,
                &human,
                &story.id,
                &format!("Criterion {}", i + 1),
            )
            .unwrap();
            set_check(&mut conn, &human, &c.id, command, *timeout).unwrap()
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
    commit_file(&worktree, "feature.txt", "parsed\n");
    Fixture {
        conn,
        human,
        _repo: repo,
        story,
        session,
        worktree,
        checks,
    }
}

impl Fixture {
    /// Hand off with `objections`, the way the hand-off tool does: plan, run, complete.
    fn hand_off(&mut self, objections: &[CheckObjection]) {
        let summary = HandoffSummary {
            next_session_must_know: "The parser is done.".into(),
            check_objections: objections.to_vec(),
            ..Default::default()
        };
        let plan = plan_handoff(&self.conn, &self.session.id, &summary.check_objections).unwrap();
        let batch = run_checks(&plan).unwrap();
        complete_handoff(&mut self.conn, &plan, &summary, batch).unwrap();
    }

    fn end_session(&mut self) {
        close_session(
            &mut self.conn,
            &self.session.id,
            SessionStatus::Completed,
            None,
            None,
            None,
        )
        .unwrap();
    }
}

#[test]
fn the_read_puts_failed_and_timed_out_checks_first_with_their_output_tail_and_counts_the_tasks_not_done(
) {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[
            ("true", None),
            ("true", None),
            ("echo 'assertion failed: parse(\"\")' >&2; exit 1", None),
            ("sleep 30", Some(1)),
        ]);
        let agent = agent_actor_id(&f.conn).unwrap();
        let open = add_task(&mut f.conn, &agent, &f.story.id, "Left open").unwrap();
        let doing = add_task(&mut f.conn, &agent, &f.story.id, "Left doing").unwrap();
        f.hand_off(&[]);
        f.end_session();
        // Editing a Check after the hand-off resets it to not run; a doing Task is not done either.
        set_check(
            &mut f.conn,
            &f.human,
            &f.checks[1].criterion_id,
            "true && true",
            None,
        )
        .unwrap();
        set_task_state(&mut f.conn, &f.human, &doing.id, TaskState::Doing, None).unwrap();
        set_task_state(&mut f.conn, &f.human, &open.id, TaskState::Done, None).unwrap();

        let review = review_for_story(&f.conn, &f.story.id).unwrap();

        let order: Vec<(&str, &str)> = review
            .failing_checks
            .iter()
            .map(|k| (k.check_id.as_str(), k.failing_words()))
            .collect();
        assert_eq!(
            order,
            [
                (f.checks[2].id.as_str(), "failed"),
                (f.checks[3].id.as_str(), "timed out"),
                (f.checks[1].id.as_str(), "not run"),
            ],
            "failed and timed out first, then what has no result at this commit"
        );
        let tail = review.failing_checks[0].output_tail.as_deref().unwrap();
        assert!(
            tail.contains("assertion failed"),
            "the failure's output tail comes with it: {tail}"
        );
        assert_eq!(
            review.open_tasks, 1,
            "a doing Task is not done; the read counts the Tasks as they are now"
        );
        assert_eq!(
            open_review(&f.conn, &f.story.id)
                .unwrap()
                .unwrap()
                .open_tasks,
            2,
            "the count at hand-off is kept"
        );
    });
}

#[test]
fn a_new_commit_puts_every_check_after_the_failed_ones_as_stale() {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[("true", None), ("exit 1", None)]);
        f.hand_off(&[]);
        f.end_session();
        commit_file(&f.worktree, "late.txt", "late\n");

        let review = review_for_story(&f.conn, &f.story.id).unwrap();

        let words: Vec<&str> = review
            .failing_checks
            .iter()
            .map(|k| k.failing_words())
            .collect();
        assert_eq!(
            words,
            ["stale", "stale"],
            "both results belong to the older commit"
        );
        assert_eq!(
            review.failing_checks[0].check_id, f.checks[0].id,
            "stale Checks keep the criteria's order"
        );
    });
}

#[test]
fn the_hand_offs_check_objections_are_stored_and_read_beside_their_checks() {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[("true", None), ("grep -q v1 log.txt", None)]);
        f.hand_off(&[CheckObjection {
            criterion: 2,
            why: "The log moved to v2; this Check greps the old format.".into(),
        }]);
        f.end_session();

        let stored = open_review(&f.conn, &f.story.id)
            .unwrap()
            .unwrap()
            .check_objections;
        assert_eq!(
            stored,
            json!([{
                "criterion_id": f.checks[1].criterion_id,
                "check_id": f.checks[1].id,
                "command": "grep -q v1 log.txt",
                "why": "The log moved to v2; this Check greps the old format.",
            }])
        );

        let review = review_for_story(&f.conn, &f.story.id).unwrap();
        assert!(review.criteria[0]
            .check
            .as_ref()
            .unwrap()
            .objections
            .is_empty());
        let objected = review.criteria[1].check.as_ref().unwrap();
        assert_eq!(objected.objections.len(), 1);
        assert_eq!(
            objected.objections[0].why,
            "The log moved to v2; this Check greps the old format."
        );
        assert_eq!(
            objected.objections[0].command, "grep -q v1 log.txt",
            "the command the agent objected to"
        );
        assert_eq!(
            review.failing_checks[0].objections, objected.objections,
            "the failing Check carries it too"
        );
    });
}

#[test]
fn the_read_lists_the_changed_files_and_reads_each_files_patch() {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[("true", None)]);
        commit_file(
            &f.worktree,
            "README.md",
            "fixture repo\nand a second line\n",
        );
        f.hand_off(&[]);
        f.end_session();

        let review = review_for_story(&f.conn, &f.story.id).unwrap();

        let files: Vec<(&str, &str, Option<u32>, Option<u32>)> = review
            .files
            .iter()
            .map(|x| (x.path.as_str(), x.status.as_str(), x.added, x.removed))
            .collect();
        assert_eq!(
            files,
            [
                ("README.md", "M", Some(1), Some(0)),
                ("feature.txt", "A", Some(1), Some(0))
            ]
        );
        let patch = review_file_patch(&f.conn, &f.story.id, "feature.txt", None).unwrap();
        assert!(patch.contains("+parsed"), "{patch}");
        assert!(!patch.contains("README"), "one file's patch only: {patch}");
    });
}

#[test]
fn re_run_checks_records_a_run_per_check_against_the_current_head_without_a_session() {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[("test -f late.txt", None), ("echo fine", None)]);
        f.hand_off(&[]);
        f.end_session();
        let head = commit_file(&f.worktree, "late.txt", "late\n");
        let runs_before = recorded_runs(&f.conn);
        let sessions_before: i64 = f
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();

        let outcome = rerun_checks(&mut f.conn, &f.human, &f.story.id).unwrap();

        assert_eq!(outcome.batch.commit_sha, head);
        assert_eq!(
            recorded_runs(&f.conn),
            runs_before + 2,
            "one run of record per Check"
        );
        let sessions: i64 = f
            .conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |r| r.get(0))
            .unwrap();
        assert_eq!(sessions, sessions_before, "no session is started");
        for check in &f.checks {
            let current = current_result(&f.conn, &check.id).unwrap();
            assert_eq!(current.result, CheckResult::Passed);
            assert_eq!(current.commit_sha.as_deref(), Some(head.as_str()));
        }
        let review = review_for_story(&f.conn, &f.story.id).unwrap();
        assert!(
            review.failing_checks.is_empty(),
            "nothing is stale any more"
        );
        assert!(review.criteria.iter().all(|c| c.pre_ticked));
        assert_eq!(review.story_state, "in_review", "a re-run moves nothing");
        let rerun: i64 = f
            .conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE story_id = ?1 AND event_type = 'story.checks_rerun' AND actor_id = ?2",
                params![f.story.id, f.human],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rerun, 1, "the re-run is on the record as the developer's");
    });
}

#[test]
fn a_re_run_reports_how_many_checks_have_ended_as_it_goes() {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[("true", None), ("false", None), ("echo fine", None)]);
        f.hand_off(&[]);
        f.end_session();
        let plan = plan_review_run(&f.conn, &f.story.id).unwrap();
        let mut heard = Vec::new();

        let batch = run_checks_reporting(&plan, |done, total| heard.push((done, total))).unwrap();

        assert_eq!(
            heard,
            vec![(0, 3), (1, 3), (2, 3), (3, 3)],
            "once before the first Check, then after each"
        );
        assert_eq!(
            batch.outcomes.len(),
            3,
            "a failing Check never stops the rest"
        );
    });
}

#[test]
fn re_run_checks_is_refused_while_a_session_is_live_and_outside_review() {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[("true", None)]);
        let err = plan_review_run(&f.conn, &f.story.id).unwrap_err();
        assert!(err.to_string().contains("In review"), "{err}");

        f.hand_off(&[]);
        // The hand-off's session is still live until it ends.
        let err = plan_review_run(&f.conn, &f.story.id).unwrap_err();
        assert!(err.to_string().contains("session"), "{err}");
        let runs = recorded_runs(&f.conn);

        // A session that goes live while the Checks run: nothing is recorded.
        f.end_session();
        let plan = plan_review_run(&f.conn, &f.story.id).unwrap();
        let batch = run_checks(&plan).unwrap();
        f.conn
            .execute(
                "UPDATE sessions SET status = 'running' WHERE id = ?1",
                params![f.session.id],
            )
            .unwrap();
        let err = complete_review_run(&mut f.conn, &f.human, &plan, batch).unwrap_err();
        assert!(err.to_string().contains("session"), "{err}");
        assert_eq!(recorded_runs(&f.conn), runs);
    });
}

#[test]
fn re_run_checks_is_the_developers_alone() {
    with_scratch_worktree_root(|_| {
        let mut f = running(&[("true", None)]);
        f.hand_off(&[]);
        f.end_session();
        let agent = agent_actor_id(&f.conn).unwrap();
        let runs = recorded_runs(&f.conn);
        assert!(rerun_checks(&mut f.conn, &agent, &f.story.id).is_err());
        assert_eq!(recorded_runs(&f.conn), runs);
    });
}
