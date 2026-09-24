//! Behavior under test (05-13-PLAN.md Task 3, gap G-05-2's third item): `query::authoring::
//! measure_authoring_run` — the Product Kill Criterion's in-app arm, derived from the board
//! through the same event rows `domain::authoring_proposal` already appends, never a
//! second/hand-rolled notion of "accepted" or "amended".
//!
//! Every fixture seeds through the real domain functions this crate's other authoring suites use
//! (`start_authoring_run`, `create_proposal`, `accept_proposal`, `amend_proposal`) — never a
//! hand-rolled `INSERT` — mirroring `authoring_acceptance.rs`'s own discipline. The one exception
//! is the elapsed-span test, which backdates `agent_runs.started_at` and one `events.occurred_at`
//! row via a direct `UPDATE` after the real write already happened, the same test-only technique
//! `epic_context_packet.rs`'s own `stage_and_decide` fixture uses to control `created_at`/
//! `decided_at` deterministically — the row itself is never hand-inserted, only its timestamp is
//! backdated so the elapsed-minutes assertion does not depend on wall-clock speed.

mod common;

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::authoring_proposal::{accept_proposal, amend_proposal, create_proposal, ProposalPayload, ProposalVerb};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::project;
use core::query::authoring::measure_authoring_run;
use rusqlite::{params, Connection};

#[test]
fn accepted_task_and_criterion_proposals_are_both_counted() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // Two tasks, accepted directly (no criteria yet, so no D-96 implied-parent interaction).
    let task_a = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-a");
    let task_b = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-b".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-b");
    accept_proposal(&mut conn, &task_a.id, &actor_id).expect("accept task-a");
    accept_proposal(&mut conn, &task_b.id, &actor_id).expect("accept task-b");

    // Two criteria under the (already-accepted) task-a — accepting them does not need to imply-
    // accept their parent, since it is already accepted.
    let criterion_a = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "criterion-a".to_string(), verification_hint: None },
        None,
        Some(&task_a.id),
    )
    .expect("propose criterion-a");
    let criterion_b = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "criterion-b".to_string(), verification_hint: None },
        None,
        Some(&task_a.id),
    )
    .expect("propose criterion-b");
    accept_proposal(&mut conn, &criterion_a.id, &actor_id).expect("accept criterion-a");
    accept_proposal(&mut conn, &criterion_b.id, &actor_id).expect("accept criterion-b");

    // A third, never-decided task proposal must not be counted.
    create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-c-never-decided".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-c");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run should succeed");
    assert_eq!(measurement.accepted_task_proposals, 2);
    assert_eq!(measurement.accepted_criterion_proposals, 2);
}

#[test]
fn an_amended_then_accepted_criterion_counts_toward_amended_before_accept_and_a_plain_accept_does_not() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    let task = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose the task");
    accept_proposal(&mut conn, &task.id, &actor_id).expect("accept the task");

    let amended_criterion = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "original wording".to_string(), verification_hint: None },
        None,
        Some(&task.id),
    )
    .expect("propose the criterion that will be amended");
    let plain_criterion = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "plain wording".to_string(), verification_hint: None },
        None,
        Some(&task.id),
    )
    .expect("propose the criterion that will be accepted as-is");

    amend_proposal(
        &mut conn,
        &amended_criterion.id,
        &actor_id,
        ProposalPayload::Criterion { statement: "the developer's own wording".to_string(), verification_hint: None },
    )
    .expect("amend the staged criterion");
    accept_proposal(&mut conn, &amended_criterion.id, &actor_id).expect("accept the amended criterion");
    accept_proposal(&mut conn, &plain_criterion.id, &actor_id).expect("accept the plain criterion");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run should succeed");
    assert_eq!(measurement.accepted_criterion_proposals, 2);
    assert_eq!(
        measurement.amended_before_accept, 1,
        "only the amended-then-accepted criterion counts toward amended_before_accept"
    );
}

#[test]
fn a_run_with_no_accepted_proposals_reports_zeroes_and_no_elapsed_span_never_an_error() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // A proposal exists but is never decided — still zero accepted.
    create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "never decided".to_string(), description: None },
        None,
        None,
    )
    .expect("propose a task that is never decided");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run must succeed, never error");
    assert_eq!(measurement.accepted_task_proposals, 0);
    assert_eq!(measurement.accepted_criterion_proposals, 0);
    assert_eq!(measurement.amended_before_accept, 0);
    assert_eq!(measurement.last_accepted_at, None, "no acceptance means no last-accepted timestamp");
    assert_eq!(measurement.elapsed_minutes, None, "no acceptance means no elapsed span");
}

#[test]
fn the_elapsed_span_runs_from_the_runs_own_start_to_its_last_acceptance() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");

    // Backdate the run's own start — a test-only timestamp control, mirroring
    // `epic_context_packet.rs`'s own `stage_and_decide` fixture (never a hand-rolled INSERT, only
    // an UPDATE on a row a real domain function already wrote).
    conn.execute(
        "UPDATE agent_runs SET started_at = ?1 WHERE id = ?2",
        params!["2026-01-01T00:00:00Z", run.id],
    )
    .expect("backdating started_at should succeed");

    let task_a = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-a");
    accept_proposal(&mut conn, &task_a.id, &actor_id).expect("accept task-a (the earlier acceptance)");
    conn.execute(
        "UPDATE events SET occurred_at = ?1 WHERE stream_type = 'authoring_proposal' AND stream_id = ?2 \
         AND event_type = 'proposal.accepted'",
        params!["2026-01-01T00:05:00Z", task_a.id],
    )
    .expect("backdating task-a's acceptance event should succeed");

    let task_b = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-b".to_string(), description: None },
        None,
        None,
    )
    .expect("propose task-b");
    accept_proposal(&mut conn, &task_b.id, &actor_id).expect("accept task-b (the LATER acceptance)");
    conn.execute(
        "UPDATE events SET occurred_at = ?1 WHERE stream_type = 'authoring_proposal' AND stream_id = ?2 \
         AND event_type = 'proposal.accepted'",
        params!["2026-01-01T00:12:00Z", task_b.id],
    )
    .expect("backdating task-b's acceptance event should succeed");

    let measurement =
        measure_authoring_run(&conn, &run.id, 200).expect("measure_authoring_run should succeed");
    assert_eq!(
        measurement.last_accepted_at.as_deref(),
        Some("2026-01-01T00:12:00Z"),
        "the LATER acceptance must win, not the first one written"
    );
    assert_eq!(
        measurement.elapsed_minutes,
        Some(12.0),
        "elapsed minutes runs from the run's own (backdated) start to its last acceptance"
    );
}

#[test]
fn the_measurement_writes_nothing_the_same_call_twice_leaves_the_database_byte_identical() {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    let mut conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let proj = project::create_project(&mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main")
        .expect("create_project should succeed");

    let run = start_authoring_run(&mut conn, &proj.id, None, "default", &actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &actor_id).expect("advance_stage should succeed");
    let task = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "task-a".to_string(), description: None },
        None,
        None,
    )
    .expect("propose the task");
    accept_proposal(&mut conn, &task.id, &actor_id).expect("accept the task");

    // Force every pending page to disk before taking the "before" snapshot, so the two calls
    // below are the only thing that could possibly still dirty a page.
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []).ok();
    drop(conn);

    let before = std::fs::read(&db_path).expect("reading the database file should succeed");
    let conn = Connection::open(&db_path).expect("reopening the database should succeed");

    let _first = measure_authoring_run(&conn, &run.id, 200).expect("first measurement should succeed");
    let _second = measure_authoring_run(&conn, &run.id, 200).expect("second measurement should succeed");
    conn.execute("PRAGMA wal_checkpoint(TRUNCATE)", []).ok();
    drop(conn);

    let after = std::fs::read(&db_path).expect("re-reading the database file should succeed");
    assert_eq!(before, after, "two measurement calls must leave the database file byte-identical");
}
