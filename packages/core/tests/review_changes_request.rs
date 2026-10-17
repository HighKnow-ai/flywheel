//! A-08(a) / plan 08.1-21 Task 1: the review surface's decline path, in the core.
//!
//! A reviewer sends a task back with its unchecked criteria as the reason. Pinned here: the status
//! edge goes through the one shared writer (D-03), the decline is recorded in ONE
//! `task.changes_requested` event in the SAME transaction, refusals write nothing, only current
//! criterion revisions count, the pending marker clears on re-submission, and the reason reaches
//! the agent through `ContextPacket.review_feedback` / `## Review Feedback` — never through the
//! drift channel. The fixture statements are THRE-58's three seeded criteria, verbatim; the tasks
//! are built `in_progress`, which is the state of every real worktree task on the live board.

mod common;

use core::domain::acceptance_criterion::{
    create_criterion, toggle_criterion, AcceptanceCriterion,
};
use core::domain::event::{append_event, next_sequence};
use core::domain::task::{
    changes_request_state, create_task, pending_changes_request, request_changes, set_task_status,
    ChangesRequestOutcome, ChangesRequestRefusal, ChangesRequestState, EVENT_CHANGES_REQUESTED,
};
use core::merge::EVENT_TASK_INTEGRATED;
use core::query::events::activity_trail;
use rusqlite::{params, Connection};

use common::seeded_project;

const THRE_58: [&str; 3] = [
    "Tab and Shift+Tab cycle within the dialog; the diff registers the trap handler on open and removes it on close.",
    "Closing the dialog returns focus to the element that held it before it opened.",
    "Initial focus lands on the first focusable control inside the dialog.",
];

struct Fixture {
    conn: Connection,
    actor: String,
    task_id: String,
    criteria: Vec<AcceptanceCriterion>,
}

/// A task in `status` carrying the first `n` of THRE-58's statements, all unchecked.
fn fixture(status: &str, n: usize) -> Fixture {
    let (mut conn, actor, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "Wire up the focus trap #41", None)
        .expect("create_task");
    let mut criteria = Vec::new();
    for statement in THRE_58.iter().take(n) {
        criteria.push(
            create_criterion(&mut conn, &project.id, &actor, "task", &task.id, statement, None)
                .expect("create_criterion"),
        );
    }
    set_task_status(&mut conn, &actor, &task.id, status).expect("set status");
    Fixture { conn, actor, task_id: task.id, criteria }
}

fn events_of(conn: &Connection, task_id: &str, event_type: &str) -> Vec<core::query::events::EventRow> {
    activity_trail(conn, "task", task_id, 500, 0)
        .expect("trail")
        .into_iter()
        .filter(|e| e.event_type == event_type)
        .collect()
}

fn total_events(conn: &Connection, task_id: &str) -> usize {
    activity_trail(conn, "task", task_id, 500, 0).expect("trail").len()
}

fn status_of(conn: &Connection, task_id: &str) -> String {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", [task_id], |r| r.get(0)).unwrap()
}

#[test]
fn an_in_review_task_moves_to_in_progress_and_records_one_event_in_one_transaction() {
    let mut f = fixture("in_review", 3);
    let status_events_before = events_of(&f.conn, &f.task_id, "task.status_changed").len();

    let outcome = request_changes(&mut f.conn, &f.actor, &f.task_id).expect("request_changes");

    assert_eq!(outcome, ChangesRequestOutcome::Requested { count: 3 });
    assert_eq!(status_of(&f.conn, &f.task_id), "in_progress");

    let status_events = events_of(&f.conn, &f.task_id, "task.status_changed");
    assert_eq!(status_events.len(), status_events_before + 1, "exactly one new status event");
    let moved = status_events.last().unwrap();
    assert_eq!(moved.payload["before"], "in_review");
    assert_eq!(moved.payload["after"], "in_progress");

    let requested = events_of(&f.conn, &f.task_id, EVENT_CHANGES_REQUESTED);
    assert_eq!(requested.len(), 1, "exactly one task.changes_requested event");
    let event = &requested[0];
    assert_eq!(event.payload["unchecked_count"], 3);
    assert_eq!(event.payload["from_status"], "in_review");
    let ids: Vec<&str> =
        event.payload["criterion_ids"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect();
    let expected: Vec<&str> = f.criteria.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(ids, expected, "criterion ids in rank order");
    assert_eq!(event.description, "Requested changes: 3 acceptance criteria unchecked");
    assert_eq!(event.payload["label"], "Requested changes: 3 acceptance criteria unchecked");

    // One transaction, one actor: the status event and the decline are consecutive.
    assert_eq!(event.sequence, moved.sequence + 1, "consecutive sequences");
    assert_eq!(event.actor_id, moved.actor_id);
    assert_eq!(event.actor_id, f.actor);

    // Board text is never copied into the log.
    let raw = event.payload.to_string();
    for statement in THRE_58 {
        assert!(!raw.contains(statement), "statement text leaked into the event payload");
    }
}

#[test]
fn an_in_progress_task_gets_no_status_event_and_exactly_one_decline_event() {
    let mut f = fixture("in_progress", 1);
    let status_events_before = events_of(&f.conn, &f.task_id, "task.status_changed").len();

    let outcome = request_changes(&mut f.conn, &f.actor, &f.task_id).expect("request_changes");

    assert_eq!(outcome, ChangesRequestOutcome::Requested { count: 1 });
    assert_eq!(status_of(&f.conn, &f.task_id), "in_progress");
    assert_eq!(
        events_of(&f.conn, &f.task_id, "task.status_changed").len(),
        status_events_before,
        "the redundant transition appends no status event"
    );
    let requested = events_of(&f.conn, &f.task_id, EVENT_CHANGES_REQUESTED);
    assert_eq!(requested.len(), 1);
    assert_eq!(requested[0].payload["from_status"], "in_progress");
    assert_eq!(requested[0].description, "Requested changes: 1 acceptance criterion unchecked");
}

#[test]
fn a_refused_decline_writes_nothing_and_names_its_category() {
    for (status, want) in [
        ("todo", ChangesRequestRefusal::NotInFlight),
        ("backlog", ChangesRequestRefusal::NotInFlight),
        ("done", ChangesRequestRefusal::NotInFlight),
    ] {
        let mut f = fixture(status, 3);
        let before = total_events(&f.conn, &f.task_id);
        let outcome = request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap();
        assert_eq!(outcome, ChangesRequestOutcome::Refused(want), "{status}");
        assert_eq!(total_events(&f.conn, &f.task_id), before, "{status}: no event");
        assert_eq!(status_of(&f.conn, &f.task_id), status, "{status}: status unchanged");
    }

    // Integrated: a recorded integrated event, read from the board (no git).
    let mut f = fixture("in_progress", 3);
    let project_id: String =
        f.conn.query_row("SELECT project_id FROM tasks WHERE id = ?1", [&f.task_id], |r| r.get(0)).unwrap();
    {
        let tx = f.conn.transaction().unwrap();
        let seq = next_sequence(&tx, &project_id, "local").unwrap();
        append_event(
            &tx,
            &project_id,
            "local",
            seq,
            "task",
            &f.task_id,
            Some(&f.task_id),
            None,
            &f.actor,
            EVENT_TASK_INTEGRATED,
            &serde_json::json!({ "merge_commit": "abc1234" }),
            "2026-10-08T00:00:00Z",
        )
        .unwrap();
        tx.commit().unwrap();
    }
    let before = total_events(&f.conn, &f.task_id);
    assert_eq!(
        request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap(),
        ChangesRequestOutcome::Refused(ChangesRequestRefusal::Integrated)
    );
    assert_eq!(total_events(&f.conn, &f.task_id), before);

    // No criteria at all.
    let mut f = fixture("in_progress", 0);
    let before = total_events(&f.conn, &f.task_id);
    assert_eq!(
        request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap(),
        ChangesRequestOutcome::Refused(ChangesRequestRefusal::NoCriteria)
    );
    assert_eq!(total_events(&f.conn, &f.task_id), before);

    // Every criterion checked.
    let mut f = fixture("in_progress", 2);
    for c in f.criteria.clone() {
        toggle_criterion(&mut f.conn, &f.actor, &c.id).unwrap();
    }
    let before = total_events(&f.conn, &f.task_id);
    assert_eq!(
        request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap(),
        ChangesRequestOutcome::Refused(ChangesRequestRefusal::NothingUnchecked)
    );
    assert_eq!(total_events(&f.conn, &f.task_id), before);
    assert_eq!(status_of(&f.conn, &f.task_id), "in_progress");
}

#[test]
fn refusal_categories_use_the_camel_case_wire_strings() {
    assert_eq!(ChangesRequestRefusal::NotInFlight.category(), "notInFlight");
    assert_eq!(ChangesRequestRefusal::Integrated.category(), "integrated");
    assert_eq!(ChangesRequestRefusal::NoCriteria.category(), "noCriteria");
    assert_eq!(ChangesRequestRefusal::NothingUnchecked.category(), "nothingUnchecked");
}

#[test]
fn the_state_machine_ready_sent_back_resubmitted_and_resolved() {
    let mut f = fixture("in_review", 3);
    assert!(matches!(changes_request_state(&f.conn, &f.task_id).unwrap(), ChangesRequestState::Ready(l) if l.len() == 3));

    request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap();
    assert!(matches!(changes_request_state(&f.conn, &f.task_id).unwrap(), ChangesRequestState::SentBack(l) if l.len() == 3));

    // Re-submission: moving it back to in_review through the shared writer clears the marker.
    set_task_status(&mut f.conn, &f.actor, &f.task_id, "in_review").unwrap();
    assert!(matches!(changes_request_state(&f.conn, &f.task_id).unwrap(), ChangesRequestState::Ready(_)));
    assert!(pending_changes_request(&f.conn, &f.task_id).unwrap().is_none());

    request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap();
    assert!(matches!(changes_request_state(&f.conn, &f.task_id).unwrap(), ChangesRequestState::SentBack(_)));

    for c in f.criteria.clone() {
        toggle_criterion(&mut f.conn, &f.actor, &c.id).unwrap();
    }
    assert_eq!(
        changes_request_state(&f.conn, &f.task_id).unwrap(),
        ChangesRequestState::Refused(ChangesRequestRefusal::NothingUnchecked)
    );
}

#[test]
fn a_second_request_while_sent_back_appends_nothing() {
    let mut f = fixture("in_progress", 3);
    request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap();
    let before = total_events(&f.conn, &f.task_id);

    let again = request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap();

    assert_eq!(again, ChangesRequestOutcome::AlreadySentBack);
    assert_eq!(total_events(&f.conn, &f.task_id), before, "a double click cannot double-record");
    assert_eq!(events_of(&f.conn, &f.task_id, EVENT_CHANGES_REQUESTED).len(), 1);
}

#[test]
fn the_decline_event_is_not_a_drift_event() {
    let mut f = fixture("in_progress", 3);
    request_changes(&mut f.conn, &f.actor, &f.task_id).unwrap();
    let drift: i64 = f
        .conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE event_type = 'drift.detected' AND task_id = ?1",
            params![f.task_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(drift, 0);
}
