//! The roster's one read (docs/mvp-spec.md §7 "Roster", issue #159).
//!
//! Pins every figure a Story row draws, for a Milestone holding a Story Waiting on you, a Stopped
//! one, one In review with an open review, a Ready one and a Dropped one, across two Epics: the
//! attention and why it stopped, the live session the row's Answer or Open session opens, the
//! *doing* Task, "criteria x/y · tasks x/y" and the open review's diff size. The rows come back in
//! Roadmap order, the same on every read, and nothing from another Milestone leaks in.
//!
//! "criteria x/y" counts a criterion as met once the Developer accepted it, or once its Check's
//! current result passed and is not stale: it ran against the head the Story last handed off (its
//! latest review's `head_sha`), ADR 0012.

mod common;

use common::with_scratch_worktree_root;
use core::domain::acceptance_criterion::{accept_criterion, create_criterion};
use core::domain::check::{record_check_run, set_check, CheckResult, CheckRunRecord};
use core::domain::epic::create_epic;
use core::domain::milestone::create_milestone;
use core::domain::permission_request::create_pending_request;
use core::domain::session::{interrupt_session, start_session};
use core::domain::story::{create_story, set_story_state, StoryState};
use core::domain::story_drop::drop_story;
use core::domain::task::{add_task, set_task_state, TaskState};
use core::ids::new_id;
use core::domain::epic::{set_epic_state, EpicState};
use core::query::progress::{epic_progress, ShapingMarker};
use core::query::roster::{roster_rows, ReviewDiffSize, RosterRow};
use rusqlite::{params, Connection};

fn running(conn: &mut Connection, actor: &str, story_id: &str) {
    set_story_state(conn, actor, story_id, StoryState::Ready).unwrap();
    set_story_state(conn, actor, story_id, StoryState::Running).unwrap();
}

/// A review row as the hand-off writes it (`domain::review`), closed with `outcome` when given.
fn review(conn: &Connection, actor: &str, project: &str, story: &str, opened_at: &str, head: &str, size: (i64, i64, i64), outcome: Option<&str>) {
    conn.execute(
        "INSERT INTO reviews (id, project_id, story_id, opened_at, base_sha, head_sha, files, added, removed, open_tasks, \
            outcome, decided_by, decided_at) \
         VALUES (?1, ?2, ?3, ?4, 'base', ?5, ?6, ?7, ?8, 0, ?9, ?10, ?11)",
        params![
            new_id(),
            project,
            story,
            opened_at,
            head,
            size.0,
            size.1,
            size.2,
            outcome,
            outcome.map(|_| actor),
            outcome.map(|_| opened_at),
        ],
    )
    .unwrap();
}

/// A criterion with a Check whose one run of record says `result` at `commit`.
fn criterion_with_run(conn: &mut Connection, actor: &str, story: &str, statement: &str, result: CheckResult, commit: &str) {
    let criterion = create_criterion(conn, actor, story, statement).unwrap();
    let check = set_check(conn, actor, &criterion.id, "cargo test", None).unwrap();
    record_check_run(
        conn,
        &check.id,
        &CheckRunRecord {
            commit_sha: commit,
            result,
            exit_code: Some(0),
            output_tail: None,
            // After the Check's last edit, so it is the current result.
            started_at: "2999-01-01T00:00:00Z",
            ended_at: "2999-01-01T00:00:01Z",
        },
    )
    .unwrap();
}

fn row<'a>(rows: &'a [RosterRow], story_id: &str) -> &'a RosterRow {
    rows.iter().find(|r| r.story_id == story_id).expect("the Story has a row")
}

#[test]
fn one_read_returns_every_rows_attention_doing_task_counts_and_diff_size() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor, project, _repo) = common::seeded_git_project();
        let m = create_milestone(&mut conn, &project.id, &actor, "Board and review", None).unwrap();
        let a = create_epic(&mut conn, &actor, &m.id, "Roster").unwrap();
        let b = create_epic(&mut conn, &actor, &m.id, "Review").unwrap();
        let story = |conn: &mut Connection, epic: &str, title: &str| create_story(conn, &actor, epic, title).unwrap().id;

        // Waiting on you: a live session holds a pending request; it is doing a Task.
        let waiting = story(&mut conn, &a.id, "Waiting");
        running(&mut conn, &actor, &waiting);
        let live = start_session(&mut conn, &waiting, "acceptEdits", &actor).unwrap();
        create_pending_request(&mut conn, &live.id, "Bash", Some(r#"{"command":"git push"}"#), &actor, Some("git-push"))
            .unwrap();
        let done = add_task(&mut conn, &actor, &waiting, "Read the schema").unwrap();
        set_task_state(&mut conn, &actor, &done.id, TaskState::Done, None).unwrap();
        let doing = add_task(&mut conn, &actor, &waiting, "Wire the command").unwrap();
        set_task_state(&mut conn, &actor, &doing.id, TaskState::Doing, None).unwrap();
        add_task(&mut conn, &actor, &waiting, "Draw the row").unwrap();
        let dropped_task = add_task(&mut conn, &actor, &waiting, "Cache per row").unwrap();
        set_task_state(&mut conn, &actor, &dropped_task.id, TaskState::Dropped, Some("one read instead")).unwrap();

        // Stopped: its latest session is dead and it never handed off.
        let stopped = story(&mut conn, &a.id, "Stopped");
        running(&mut conn, &actor, &stopped);
        let dead = start_session(&mut conn, &stopped, "acceptEdits", &actor).unwrap();
        let was_doing = add_task(&mut conn, &actor, &stopped, "Half done").unwrap();
        set_task_state(&mut conn, &actor, &was_doing.id, TaskState::Doing, None).unwrap();
        interrupt_session(&mut conn, &dead.id, &actor).unwrap();
        let stopped_reason: Option<String> = conn
            .query_row("SELECT ending_reason FROM sessions WHERE id = ?1", params![dead.id], |r| r.get(0))
            .unwrap();

        // In review: an earlier review sent back at head `aaa`, the open one at head `bbb`.
        let in_review = story(&mut conn, &a.id, "In review");
        conn.execute("UPDATE stories SET state = 'in_review' WHERE id = ?1", params![in_review]).unwrap();
        review(&conn, &actor, &project.id, &in_review, "2026-10-01T00:00:00Z", "aaa", (9, 900, 90), Some("changes_requested"));
        review(&conn, &actor, &project.id, &in_review, "2026-10-02T00:00:00Z", "bbb", (3, 40, 7), None);
        let accepted = create_criterion(&mut conn, &actor, &in_review, "Accepted by hand").unwrap();
        accept_criterion(&mut conn, &actor, &accepted.id).unwrap();
        criterion_with_run(&mut conn, &actor, &in_review, "Passed at the head", CheckResult::Passed, "bbb");
        criterion_with_run(&mut conn, &actor, &in_review, "Passed, then the branch moved", CheckResult::Passed, "aaa");
        criterion_with_run(&mut conn, &actor, &in_review, "Failed at the head", CheckResult::Failed, "bbb");
        create_criterion(&mut conn, &actor, &in_review, "Judged at review").unwrap();
        let finished = add_task(&mut conn, &actor, &in_review, "Everything").unwrap();
        set_task_state(&mut conn, &actor, &finished.id, TaskState::Done, None).unwrap();

        // Ready in the second Epic, and a Dropped one: no attention, nothing counted.
        let ready = story(&mut conn, &b.id, "Ready");
        set_story_state(&mut conn, &actor, &ready, StoryState::Ready).unwrap();
        let dropped = story(&mut conn, &b.id, "Dropped");
        drop_story(&mut conn, &actor, &dropped).unwrap();

        // Noise in another Milestone.
        let other = create_milestone(&mut conn, &project.id, &actor, "Later", None).unwrap();
        let elsewhere = create_epic(&mut conn, &actor, &other.id, "Elsewhere").unwrap();
        create_story(&mut conn, &actor, &elsewhere.id, "Not in this Milestone").unwrap();

        let rows = roster_rows(&conn, &m.id).unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.story_id.as_str()).collect();
        assert_eq!(
            ids,
            vec![waiting.as_str(), stopped.as_str(), in_review.as_str(), ready.as_str(), dropped.as_str()],
            "every Story of the Milestone, Epics in Roadmap order and Stories in rank order"
        );
        assert_eq!(rows, roster_rows(&conn, &m.id).unwrap(), "the same read twice gives the same rows");

        assert_eq!(
            row(&rows, &waiting),
            &RosterRow {
                story_id: waiting.clone(),
                attention: Some("waiting_on_you".into()),
                ending_reason: None,
                live_session_id: Some(live.id.clone()),
                doing_task_title: Some("Wire the command".into()),
                criteria_met: 0,
                criteria_total: 0,
                tasks_done: 1,
                tasks_total: 3,
                review: None,
                can_make_ready: false,
            },
            "a dropped Task is closed, not work: it leaves the Task total"
        );

        let stopped_row = row(&rows, &stopped);
        assert_eq!(stopped_row.attention.as_deref(), Some("stopped"));
        assert_eq!(stopped_row.ending_reason, stopped_reason);
        assert!(stopped_row.ending_reason.is_some());
        assert_eq!(stopped_row.live_session_id, None, "a Stopped Story has no live session");
        assert_eq!(stopped_row.doing_task_title.as_deref(), Some("Half done"), "what it was doing when it stopped");

        assert_eq!(
            row(&rows, &in_review),
            &RosterRow {
                story_id: in_review.clone(),
                attention: None,
                ending_reason: None,
                live_session_id: None,
                doing_task_title: None,
                criteria_met: 2,
                criteria_total: 5,
                tasks_done: 1,
                tasks_total: 1,
                review: Some(ReviewDiffSize { files: 3, added: 40, removed: 7 }),
                can_make_ready: false,
            },
            "accepted, or passed at the handed-off head; the open review's diff, not the closed one's"
        );

        for quiet in [&ready, &dropped] {
            let r = row(&rows, quiet);
            assert_eq!((r.attention.as_deref(), r.live_session_id.as_deref(), r.review), (None, None, None));
            assert_eq!((r.criteria_met, r.criteria_total, r.tasks_done, r.tasks_total), (0, 0, 0, 0));
        }
    });
}

#[test]
fn a_passed_check_counts_until_a_hand_off_moves_the_head_past_it() {
    let (mut conn, actor, project) = common::seeded_project();
    let s = common::new_story(&mut conn, &project.id, &actor, "Checks");
    let milestone: String = conn
        .query_row("SELECT e.milestone_id FROM epics e WHERE e.id = ?1", params![s.epic_id], |r| r.get(0))
        .unwrap();
    criterion_with_run(&mut conn, &actor, &s.id, "Passed", CheckResult::Passed, "aaa");

    // No hand-off yet: no head is known, so the result is not stale.
    assert_eq!(roster_rows(&conn, &milestone).unwrap()[0].criteria_met, 1);

    // Handed off at `bbb`: the run at `aaa` is stale.
    review(&conn, &actor, &project.id, &s.id, "2026-10-02T00:00:00Z", "bbb", (1, 1, 0), None);
    let r = &roster_rows(&conn, &milestone).unwrap()[0];
    assert_eq!((r.criteria_met, r.criteria_total), (0, 1));
}

#[test]
fn the_roster_query_walks_indexes_only() {
    let (conn, _actor, _project) = common::seeded_project();
    let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {}", core::query::roster::ROSTER_ROWS_SQL)).unwrap();
    let plan: Vec<String> =
        stmt.query_map(params!["a-milestone"], |row| row.get::<_, String>(3)).unwrap().collect::<Result<_, _>>().unwrap();
    for step in &plan {
        let full_scan = step.starts_with("SCAN ") && !step.contains("USING");
        assert!(!full_scan, "a full table scan in the roster query: {step}\nplan: {plan:#?}");
    }
}

#[test]
fn an_unknown_milestone_has_no_rows() {
    let (conn, _actor, _project) = common::seeded_project();
    assert!(roster_rows(&conn, "no-such-milestone").unwrap().is_empty());
}

/// An open Stage of `epic` at `rank`, as shaping opens it.
fn stage(conn: &Connection, project: &str, epic: &str, kind: &str, rank: i64) -> String {
    let id = new_id();
    conn.execute(
        "INSERT INTO stages (id, project_id, epic_id, kind, state, rank, opened_at) \
         VALUES (?1, ?2, ?3, ?4, 'open', ?5, '2026-10-01T00:00:00Z')",
        params![id, project, epic, kind, rank],
    )
    .unwrap();
    id
}

/// A Round of `stage` with `questions` questions, the first `answered` of them answered; open until
/// every one is.
fn round(conn: &Connection, actor: &str, project: &str, stage: &str, number: i64, questions: i64, answered: i64) {
    let id = new_id();
    let done = answered == questions;
    conn.execute(
        "INSERT INTO rounds (id, project_id, stage_id, number, note, state, posted_at, answered_at) \
         VALUES (?1, ?2, ?3, ?4, 'note', ?5, '2026-10-01T00:00:00Z', ?6)",
        params![id, project, stage, number, if done { "answered" } else { "open" }, done.then_some("2026-10-01T00:00:00Z")],
    )
    .unwrap();
    for n in 1..=questions {
        let answer = (n <= answered).then_some("yes");
        conn.execute(
            "INSERT INTO round_questions (id, round_id, number, title, question, grounding, recommended_answer, because, \
                answer, answered_with, answered_by, answered_at) \
             VALUES (?1, ?2, ?3, 't', 'q', 'g', 'yes', 'b', ?4, ?5, ?6, ?7)",
            params![
                new_id(),
                id,
                n,
                answer,
                answer.map(|_| "recommended"),
                answer.map(|_| actor),
                answer.map(|_| "2026-10-01T00:00:00Z")
            ],
        )
        .unwrap();
    }
}

#[test]
fn an_epic_in_shaping_carries_its_shaping_marker() {
    let (mut conn, actor, project) = common::seeded_project();
    let m = create_milestone(&mut conn, &project.id, &actor, "Shaping", None).unwrap();
    let never = create_epic(&mut conn, &actor, &m.id, "Never shaped").unwrap();
    let no_round = create_epic(&mut conn, &actor, &m.id, "Stage open, no Round").unwrap();
    let open = create_epic(&mut conn, &actor, &m.id, "Round open").unwrap();
    let answered = create_epic(&mut conn, &actor, &m.id, "Round answered").unwrap();
    let ready = create_epic(&mut conn, &actor, &m.id, "Ready").unwrap();
    set_epic_state(&mut conn, &actor, &ready.id, EpicState::Ready).unwrap();

    stage(&conn, &project.id, &no_round.id, "challenge_spec", 1);
    let slice = stage(&conn, &project.id, &open.id, "slice", 2);
    round(&conn, &actor, &project.id, &slice, 1, 2, 2);
    round(&conn, &actor, &project.id, &slice, 2, 5, 2);
    let criteria = stage(&conn, &project.id, &answered.id, "criteria", 3);
    round(&conn, &actor, &project.id, &criteria, 1, 3, 3);

    let epics = epic_progress(&conn, &m.id).unwrap();
    let marker = |id: &str| epics.iter().find(|e| e.epic_id == id).unwrap().shaping.clone();
    let none = ShapingMarker { stage_kind: None, stage_rank: None, round_number: None, round_open: false, answered: 0, questions: 0 };
    assert_eq!(marker(&never.id), Some(none.clone()), "an Epic in Shaping with no Stage open yet is not shaped yet");
    assert_eq!(
        marker(&no_round.id),
        Some(ShapingMarker { stage_kind: Some("challenge_spec".into()), stage_rank: Some(1), ..none.clone() })
    );
    assert_eq!(
        marker(&open.id),
        Some(ShapingMarker {
            stage_kind: Some("slice".into()),
            stage_rank: Some(2),
            round_number: Some(2),
            round_open: true,
            answered: 2,
            questions: 5
        }),
        "the open Stage's latest Round, with its answers counted"
    );
    assert_eq!(
        marker(&answered.id),
        Some(ShapingMarker {
            stage_kind: Some("criteria".into()),
            stage_rank: Some(3),
            round_number: Some(1),
            round_open: false,
            answered: 3,
            questions: 3
        })
    );
    assert_eq!(marker(&ready.id), None, "an Epic out of Shaping has no marker");
}
