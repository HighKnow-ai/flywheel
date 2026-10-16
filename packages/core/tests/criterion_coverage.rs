//! Phase 15 plan 06, task 1 — does this task have criteria coverage (D-12), is a criterion
//! judgement-only (D-24 / A-08), and is a deliberate no-criteria start recorded as an event
//! rather than a status (D-13).
//!
//! Every assertion reads the database. Self-contained fixture helpers, copied rather than shared
//! (this repo's test-file precedent).

mod common;

use core::domain::acceptance_criterion::{
    create_criterion, list_current_criteria, revise_criterion, waive_criteria, EVENT_CRITERIA_WAIVED,
};
use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    accept_proposal, create_proposal, reject_proposal, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::criterion_coverage::criterion_coverage;
use rusqlite::{params, Connection};

/// One RUNNING `agent_runs` row scoped to `task_id` — the shape a drafting call arrives against.
fn seeded_run(conn: &mut Connection, project_id: &str, human_actor_id: &str, task_id: &str) -> String {
    let agent_actor = agent_actor_id(conn).expect("seeded agent actor should exist");
    let now = "2026-01-01T00:00:00Z";
    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (
                id, project_id, target_task_id, target_epic_id, source, config, enabled,
                last_fired_at, created_by, created_at
            ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
            params![new_id(), project_id, task_id, human_actor_id, now],
            |row| row.get(0),
        )
        .expect("failed to insert fixture trigger");
    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'default', NULL, \
            NULL, NULL, ?6, ?7, NULL, NULL)",
        params![run_id, task_id, project_id, trigger_id, agent_actor, format!("/tmp/log-{run_id}.jsonl"), now],
    )
    .expect("failed to insert fixture agent_run");
    run_id
}

fn criterion_draft(statement: &str) -> ProposalPayload {
    ProposalPayload::Criterion { statement: statement.to_string(), verification_hint: None, pinned_revision: None }
}

fn draft_for(conn: &mut Connection, run_id: &str, task_id: &str, statement: &str) -> String {
    create_proposal(
        conn,
        run_id,
        ProposalVerb::Create,
        criterion_draft(statement),
        Some(task_id),
        None,
        ProposalProvenance::NONE,
    )
    .expect("a clean criterion must stage")
    .id
}

fn status_of(conn: &Connection, task_id: &str) -> String {
    conn.query_row("SELECT status FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0)).unwrap()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

const CLEAN: &str = "Rejects an empty title with a named error";

#[test]
fn two_current_criteria_and_no_drafts_is_coverage() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Has a contract", None).unwrap();
    create_criterion(&mut conn, &project.id, &human, "task", &task.id, "Returns 404 for an unknown id", Some("curl")).unwrap();
    create_criterion(&mut conn, &project.id, &human, "task", &task.id, "Returns 200 for a known id", Some("curl")).unwrap();

    let coverage = criterion_coverage(&conn, &task.id).unwrap();
    assert_eq!(coverage.current_count, 2);
    assert_eq!(coverage.pending_draft_count, 0);
    assert!(coverage.has_coverage);
}

#[test]
fn a_pending_draft_is_coverage_and_reading_it_creates_nothing() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Typed by hand", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, &task.id);
    draft_for(&mut conn, &run, &task.id, CLEAN);

    let before = count(&conn, "SELECT COUNT(*) FROM authoring_proposals");
    let first = criterion_coverage(&conn, &task.id).unwrap();
    let second = criterion_coverage(&conn, &task.id).unwrap();

    assert_eq!(first.current_count, 0);
    assert_eq!(first.pending_draft_count, 1);
    assert!(first.has_coverage, "D-12: a pending draft counts as coverage");
    assert_eq!(first, second, "coverage is idempotent");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM authoring_proposals"), before, "reading drafts nothing");
}

#[test]
fn zero_of_both_is_no_coverage() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Bare", None).unwrap();

    let coverage = criterion_coverage(&conn, &task.id).unwrap();
    assert_eq!((coverage.current_count, coverage.pending_draft_count), (0, 0));
    assert!(!coverage.has_coverage);
    assert_eq!(coverage.judgement_only_count, 0);
}

#[test]
fn a_rejected_draft_is_not_coverage() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Typed by hand", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, &task.id);
    let proposal_id = draft_for(&mut conn, &run, &task.id, CLEAN);
    reject_proposal(&mut conn, &proposal_id, &human, None).unwrap();

    let coverage = criterion_coverage(&conn, &task.id).unwrap();
    assert_eq!(coverage.pending_draft_count, 0);
    assert!(!coverage.has_coverage);
}

#[test]
fn an_accepted_draft_counts_once_as_a_current_criterion_not_as_a_pending_one() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Typed by hand", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, &task.id);
    let proposal_id = draft_for(&mut conn, &run, &task.id, CLEAN);
    accept_proposal(&mut conn, &proposal_id, &human).unwrap();

    let coverage = criterion_coverage(&conn, &task.id).unwrap();
    assert_eq!((coverage.current_count, coverage.pending_draft_count), (1, 0));
}

#[test]
fn a_superseded_revision_does_not_inflate_the_current_count() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Started once", None).unwrap();
    let original = create_criterion(&mut conn, &project.id, &human, "task", &task.id, "Returns 404 for an unknown id", Some("curl")).unwrap();
    // An agent_runs row for the task locks its criteria, so the next edit appends a revision.
    seeded_run(&mut conn, &project.id, &human, &task.id);
    revise_criterion(&mut conn, &human, &original.id, "Returns 410 for a deleted id", Some("curl")).unwrap();

    assert_eq!(count(&conn, "SELECT COUNT(*) FROM acceptance_criteria"), 2, "history is kept");
    let coverage = criterion_coverage(&conn, &task.id).unwrap();
    assert_eq!(coverage.current_count, 1);
    assert_eq!(coverage.current_count as usize, list_current_criteria(&conn, "task", &task.id).unwrap().len());
}

#[test]
fn judgement_only_is_the_null_verification_hint_and_nothing_else() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Mixed", None).unwrap();
    create_criterion(&mut conn, &project.id, &human, "task", &task.id, "Returns 404 for an unknown id", Some("curl")).unwrap();
    create_criterion(&mut conn, &project.id, &human, "task", &task.id, "Returns 200 for a known id", Some("curl")).unwrap();
    create_criterion(&mut conn, &project.id, &human, "task", &task.id, "The empty state reads as calm", None).unwrap();

    let coverage = criterion_coverage(&conn, &task.id).unwrap();
    assert_eq!(coverage.current_count, 3);
    assert_eq!(coverage.judgement_only_count, 1);
}

#[test]
fn waiving_appends_one_event_and_leaves_status_byte_identical() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Proceed anyway", None).unwrap();
    let status_before = status_of(&conn, &task.id);
    let events_before = count(&conn, "SELECT COUNT(*) FROM events");

    waive_criteria(&mut conn, &human, &task.id).unwrap();

    assert_eq!(status_of(&conn, &task.id), status_before);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events"), events_before + 1);
    assert_eq!(EVENT_CRITERIA_WAIVED, "task.criteria_waived");
    let (actor, task_col, payload): (String, String, String) = conn
        .query_row(
            "SELECT actor_id, task_id, payload FROM events WHERE event_type = ?1",
            params![EVENT_CRITERIA_WAIVED],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(actor, human);
    assert_eq!(task_col, task.id);
    let payload: serde_json::Value = serde_json::from_str(&payload).unwrap();
    for key in ["field", "before", "after", "label"] {
        assert!(payload.get(key).is_some(), "house payload shape carries {key}: {payload}");
    }
}

#[test]
fn an_agent_actor_cannot_waive() {
    let (mut conn, human, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human, "Proceed anyway", None).unwrap();
    let agent = agent_actor_id(&conn).unwrap();

    assert!(waive_criteria(&mut conn, &agent, &task.id).is_err());
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events WHERE event_type = 'task.criteria_waived'"), 0);
}

#[test]
fn a_hand_made_task_and_an_agent_proposed_task_resolve_through_the_same_function() {
    let (mut conn, human, project) = common::seeded_project();
    let hand_made = create_task(&mut conn, &project.id, &human, "Typed by hand months ago", None).unwrap();
    let anchor_task = create_task(&mut conn, &project.id, &human, "Run anchor", None).unwrap();
    let run = seeded_run(&mut conn, &project.id, &human, &anchor_task.id);

    // The fresh path: a task proposal is accepted, and a criterion draft hangs off it.
    let task_proposal = create_proposal(
        &mut conn,
        &run,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "Proposed by the agent".to_string(), description: None, priority: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();
    let accepted = accept_proposal(&mut conn, &task_proposal.id, &human).unwrap();
    let proposed_task_id = accepted.materialised_id;
    create_proposal(
        &mut conn,
        &run,
        ProposalVerb::Create,
        criterion_draft(CLEAN),
        None,
        Some(&task_proposal.id),
        ProposalProvenance::NONE,
    )
    .unwrap();
    // The hand-made path: the draft names the existing task directly.
    draft_for(&mut conn, &run, &hand_made.id, CLEAN);

    let fresh = criterion_coverage(&conn, &proposed_task_id).unwrap();
    let old = criterion_coverage(&conn, &hand_made.id).unwrap();
    assert_eq!(fresh, old, "no branch on origin: both are one pending draft and nothing else");
    assert_eq!(old.pending_draft_count, 1);
    assert!(old.has_coverage);
}
