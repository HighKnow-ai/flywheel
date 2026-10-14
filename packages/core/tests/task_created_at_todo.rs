//! D-18 (phase 13 plan 06): a hand-made task is created at `todo`. Typing a task is the human act
//! and there is no second acceptance to wait for, so `backlog` comes to mean exactly "proposed by
//! an agent, not yet accepted".

mod common;

use core::domain::authoring_proposal::{
    accept_proposal, create_proposal, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::task::{create_task, set_task_status};
use core::query::events::activity_trail;
use core::query::{list_board, BoardFilter};
use rusqlite::params;

use common::seeded_project;

fn stored_status(conn: &rusqlite::Connection, task_id: &str) -> String {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", params![task_id], |r| r.get(0))
        .unwrap()
}

#[test]
fn a_hand_made_task_is_created_at_todo() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Typed by hand", None).unwrap();
    assert_eq!(task.status, "todo");
    assert_eq!(stored_status(&conn, &task.id), "todo");
}

#[test]
fn the_created_event_carries_the_band_the_task_is_actually_in() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Typed by hand", None).unwrap();
    let trail = activity_trail(&conn, "task", &task.id, 50, 0).unwrap();
    let created = trail.iter().find(|e| e.event_type == "task.created").expect("task.created");
    assert_eq!(created.payload["after"], "todo");
}

#[test]
fn rank_is_allocated_after_the_tail_of_the_todo_band() {
    let (mut conn, actor_id, project) = seeded_project();
    let first = create_task(&mut conn, &project.id, &actor_id, "First", None).unwrap();

    // The second task ranks after the first because both are in `todo`.
    let second = create_task(&mut conn, &project.id, &actor_id, "Second", None).unwrap();
    assert!(second.rank > first.rank, "second {:?} must rank after first {:?}", second.rank, first.rank);

    // Move both out of `todo`: a third task now sees an EMPTY todo band and takes the band's first
    // rank. Under the old backlog-tail query it would have ranked after `first`/`second`.
    set_task_status(&mut conn, &actor_id, &first.id, "backlog").unwrap();
    set_task_status(&mut conn, &actor_id, &second.id, "in_progress").unwrap();
    let third = create_task(&mut conn, &project.id, &actor_id, "Third", None).unwrap();
    assert_eq!(third.rank, first.rank, "an empty todo band allocates the band's first rank");
}

#[test]
fn board_band_counts_report_a_hand_made_task_in_todo_not_backlog() {
    let (mut conn, actor_id, project) = seeded_project();
    create_task(&mut conn, &project.id, &actor_id, "Typed by hand", None).unwrap();
    let window = list_board(&conn, &project.id, &BoardFilter::default(), 50, None).unwrap();
    assert_eq!(window.counts.todo, 1);
    assert_eq!(window.counts.backlog, 0);
}

/// `create_task_in_tx` is shared with proposal acceptance, so an accepted agent proposal's task
/// lands at `todo` too: acceptance IS the human act for that path. It stays distinguishable from a
/// hand-made task by its event actor — the agent that proposed it — while the proposal row records
/// the human who decided it.
#[test]
fn an_accepted_agent_proposal_is_distinguishable_by_event_actor() {
    let dir = tempfile::tempdir().unwrap();
    // SAFETY: this is the only test in this binary that reads the var, and it clears it below.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };

    let (mut conn, human_actor_id, project) = seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();
    let proposal = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "Proposed".to_string(), description: None, priority: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();
    let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };

    assert_eq!(stored_status(&conn, &outcome.materialised_id), "todo");
    let trail = activity_trail(&conn, "task", &outcome.materialised_id, 50, 0).unwrap();
    let created = trail.iter().find(|e| e.event_type == "task.created").expect("task.created");
    assert_ne!(created.actor_id, human_actor_id, "the created event names the proposing agent");
    assert_eq!(outcome.proposal.decided_by.as_deref(), Some(human_actor_id.as_str()));
}
