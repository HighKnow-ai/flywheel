//! Phase 15 plan 01, task 1 — the tracer: ONE path, end to end. A criterion is drafted for a task
//! typed by hand (never proposed), a lint-failing statement is refused before it persists, and a
//! clean one is accepted onto that existing task with no parent proposal anywhere in the chain.
//!
//! Every assertion reads the database, not a return value: D-23 is rated costly precisely because
//! "a failing draft is never persisted" must be a fact a query can establish for every caller.
//! Self-contained fixture helpers, copied rather than shared (this repo's test-file precedent).

mod common;

use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    accept_proposal, apply_proposal_created, create_proposal, ProposalOutcome, ProposalPayload,
    ProposalProvenance, ProposalVerb,
};
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};

/// One RUNNING task-execution `agent_runs` row scoped to a fresh task — the shape a drafting
/// call arrives against. Returns the run id.
fn seeded_run(conn: &mut Connection, project_id: &str, human_actor_id: &str) -> String {
    let task = create_task(conn, project_id, human_actor_id, "The task the run drives", None)
        .expect("create_task should succeed");
    let agent_actor = agent_actor_id(conn).expect("seeded agent actor should exist");
    let now = "2026-01-01T00:00:00Z";
    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (
                id, project_id, target_task_id, target_epic_id, source, config, enabled,
                last_fired_at, created_by, created_at
            ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
            params![new_id(), project_id, task.id, human_actor_id, now],
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
        params![run_id, task.id, project_id, trigger_id, agent_actor, format!("/tmp/log-{run_id}.jsonl"), now],
    )
    .expect("failed to insert fixture agent_run");
    run_id
}

fn criterion(statement: &str) -> ProposalPayload {
    ProposalPayload::Criterion { statement: statement.to_string(), verification_hint: None, pinned_revision: None }
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |row| row.get(0)).unwrap()
}

const COMPOUND: &str = "Rejects an empty title and logs the refusal";
const CLEAN: &str = "Rejects an empty title with a named error";

#[test]
fn a_lint_failing_draft_for_a_hand_made_task_leaves_no_row_and_no_event() {
    let (mut conn, human, project) = common::seeded_project();
    let run_id = seeded_run(&mut conn, &project.id, &human);
    let hand_made = create_task(&mut conn, &project.id, &human, "Typed by hand months ago", None).unwrap();

    let err = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        criterion(COMPOUND),
        Some(&hand_made.id),
        None,
        ProposalProvenance::NONE,
    )
    .expect_err("a compound criterion must be refused");

    assert!(err.to_string().contains(COMPOUND), "the refusal carries the statement verbatim: {err}");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM authoring_proposals"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events WHERE event_type = 'proposal.created'"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events WHERE event_type = 'proposal.limit_exhausted'"), 0);
    // Rejected, never repaired: the refused text exists in no altered form anywhere.
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM acceptance_criteria WHERE statement LIKE '%empty title%'"),
        0
    );
    assert_eq!(
        count(&conn, "SELECT COUNT(*) FROM authoring_proposals WHERE payload LIKE '%empty title%'"),
        0
    );
}

#[test]
fn a_clean_draft_for_a_hand_made_task_accepts_onto_it_with_no_parent_proposal() {
    let (mut conn, human, project) = common::seeded_project();
    let run_id = seeded_run(&mut conn, &project.id, &human);
    let hand_made = create_task(&mut conn, &project.id, &human, "Typed by hand months ago", None).unwrap();

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        criterion(CLEAN),
        Some(&hand_made.id),
        None,
        ProposalProvenance::NONE,
    )
    .expect("a clean criterion must stage");
    assert_eq!(proposal.parent_proposal_id, None);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM authoring_proposals"), 1);

    let accepted = accept_proposal(&mut conn, &proposal.id, &human).expect("accept should materialise");

    let (parent_type, parent_id): (String, String) = conn
        .query_row(
            "SELECT parent_type, parent_id FROM acceptance_criteria WHERE id = ?1",
            params![accepted.materialised_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .unwrap();
    assert_eq!((parent_type.as_str(), parent_id.as_str()), ("task", hand_made.id.as_str()));
}

#[test]
fn a_criterion_with_neither_a_parent_proposal_nor_a_resolvable_target_still_errors_at_accept() {
    let (mut conn, human, project) = common::seeded_project();
    let run_id = seeded_run(&mut conn, &project.id, &human);

    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        criterion(CLEAN),
        Some("01JNOSUCHTASK000000000000"),
        None,
        ProposalProvenance::NONE,
    )
    .expect("staging does not resolve the target");

    let err = accept_proposal(&mut conn, &proposal.id, &human).expect_err("an unresolvable target must error");
    assert!(err.to_string().contains("carries no parent_proposal_id"), "{err}");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM acceptance_criteria"), 0);
    let status: String = conn
        .query_row("SELECT status FROM authoring_proposals WHERE id = ?1", params![proposal.id], |r| r.get(0))
        .unwrap();
    assert_eq!(status, "pending");
}

#[test]
fn the_inbound_event_door_refuses_the_same_draft_through_the_same_statement_site() {
    let (mut conn, human, project) = common::seeded_project();
    let run_id = seeded_run(&mut conn, &project.id, &human);
    let hand_made = create_task(&mut conn, &project.id, &human, "Typed by hand months ago", None).unwrap();
    let event = serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "create",
        "targetType": "criterion",
        "targetId": hand_made.id,
        "payload": { "kind": "criterion", "statement": "The importer handles malformed rows", "verification_hint": null },
    });

    let outcome = apply_proposal_created(&mut conn, &event).unwrap();

    let ProposalOutcome::LintRefused { reason } = outcome else {
        panic!("expected LintRefused, got {outcome:?}");
    };
    assert!(reason.contains("The importer handles malformed rows"));
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM authoring_proposals"), 0);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events WHERE event_type LIKE 'proposal.%'"), 0);
}
