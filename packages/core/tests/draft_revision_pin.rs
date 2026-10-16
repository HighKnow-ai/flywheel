//! Phase 15 plan 01, task 3 (DRFT-07, D-26): a drafted criterion amend pins the revision it was
//! computed against, and accepting it after that criterion moved is refused with the four facts a
//! human needs to redraft — pinned revision, current revision, pinned statement, current statement.
//!
//! The pin rides in the proposal's existing `payload` JSON (`serde(default)`, no migration). It
//! fires on a moved revision ONLY: a routine refusal is an ignored one. Self-contained fixtures,
//! copied rather than shared (this repo's precedent).

mod common;

use core::domain::acceptance_criterion::{create_criterion, revise_criterion};
use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    accept_proposal, amend_proposal, create_proposal, reject_proposal, Proposal, ProposalPayload,
    ProposalProvenance, ProposalVerb,
};
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};

const ORIGINAL: &str = "Returns an error for an empty title";
const DRAFT: &str = "Returns a named error for a blank title";
const MOVED: &str = "Returns a 400 for an empty title";

/// One RUNNING execution run on a fresh task. The run's existence LOCKS that task's criteria
/// (D-76), so a revise appends a numbered revision instead of editing in place. Returns
/// `(run_id, task_id)`.
fn seeded_locked_task(conn: &mut Connection, project_id: &str, human_actor_id: &str) -> (String, String) {
    let task = create_task(conn, project_id, human_actor_id, "A task with a run", None).unwrap();
    let agent_actor = agent_actor_id(conn).unwrap();
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
        .unwrap();
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
    .unwrap();
    (run_id, task.id)
}

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    run_id: String,
    criterion_id: String,
}

fn fixture() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let (run_id, task_id) = seeded_locked_task(&mut conn, &project.id, &human);
    let criterion = create_criterion(&mut conn, &project.id, &human, "task", &task_id, ORIGINAL, None).unwrap();
    Fixture { conn, human, project_id: project.id, run_id, criterion_id: criterion.id }
}

fn amend_payload(statement: &str) -> ProposalPayload {
    ProposalPayload::Criterion {
        statement: statement.to_string(),
        verification_hint: None,
        pinned_revision: None,
    }
}

fn draft_amend(f: &mut Fixture, statement: &str) -> Proposal {
    create_proposal(
        &mut f.conn,
        &f.run_id,
        ProposalVerb::Amend,
        amend_payload(statement),
        Some(&f.criterion_id),
        None,
        ProposalProvenance::NONE,
    )
    .expect("an amend draft must stage")
}

fn pinned(proposal: &Proposal) -> Option<i64> {
    match &proposal.payload {
        ProposalPayload::Criterion { pinned_revision, .. } => *pinned_revision,
        other => panic!("not a criterion payload: {other:?}"),
    }
}

fn stored_pin(conn: &Connection, proposal_id: &str) -> Option<i64> {
    let json: String = conn
        .query_row("SELECT payload FROM authoring_proposals WHERE id = ?1", params![proposal_id], |r| r.get(0))
        .unwrap();
    serde_json::from_str::<serde_json::Value>(&json).unwrap()["pinned_revision"].as_i64()
}

fn status(conn: &Connection, proposal_id: &str) -> String {
    conn.query_row("SELECT status FROM authoring_proposals WHERE id = ?1", params![proposal_id], |r| r.get(0))
        .unwrap()
}

fn criteria_rows(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |r| r.get(0)).unwrap()
}

#[test]
fn accepting_against_a_moved_revision_is_refused_with_the_four_facts() {
    let mut f = fixture();
    let draft = draft_amend(&mut f, DRAFT);
    assert_eq!(pinned(&draft), Some(1), "the draft pins the revision it observed");

    revise_criterion(&mut f.conn, &f.human, &f.criterion_id, MOVED, None).unwrap();
    let rows_before = criteria_rows(&f.conn);

    let err = accept_proposal(&mut f.conn, &draft.id, &f.human).expect_err("a moved revision must be refused");

    let text = err.to_string();
    assert!(text.contains(ORIGINAL), "names the statement as pinned: {text}");
    assert!(text.contains(MOVED), "names the statement as it now stands: {text}");
    assert!(text.contains("revision 1") && text.contains("revision 2"), "names both revisions: {text}");
    assert_eq!(status(&f.conn, &draft.id), "pending", "the human can redraft or re-decide");
    assert_eq!(criteria_rows(&f.conn), rows_before, "a refusal writes nothing");
}

#[test]
fn accepting_against_an_unmoved_revision_materialises_through_the_revision_chain() {
    let mut f = fixture();
    let draft = draft_amend(&mut f, DRAFT);

    let accepted = accept_proposal(&mut f.conn, &draft.id, &f.human).expect("an unmoved pin accepts");

    let (revision, revision_of): (i64, Option<String>) = f
        .conn
        .query_row(
            "SELECT revision, revision_of FROM acceptance_criteria WHERE id = ?1",
            params![accepted.materialised_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(revision, 2);
    assert_eq!(revision_of.as_deref(), Some(f.criterion_id.as_str()), "chains to the original");
}

#[test]
fn an_unrelated_board_change_never_triggers_the_refusal() {
    let mut f = fixture();
    let draft = draft_amend(&mut f, DRAFT);

    let other = create_task(&mut f.conn, &f.project_id, &f.human, "An unrelated task", None).unwrap();
    let unrelated =
        create_criterion(&mut f.conn, &f.project_id, &f.human, "task", &other.id, "Returns 3 unrelated rows", None)
            .unwrap();
    revise_criterion(&mut f.conn, &f.human, &unrelated.id, "Returns 4 unrelated rows", None).unwrap();

    accept_proposal(&mut f.conn, &draft.id, &f.human).expect("only a moved parent revision refuses");
}

#[test]
fn a_payload_stored_before_the_field_existed_deserialises_and_accepts() {
    let legacy = r#"{"kind":"criterion","statement":"Returns an error for a blank title","verification_hint":null}"#;
    let parsed: ProposalPayload = serde_json::from_str(legacy).expect("serde(default) carries the old shape");
    assert!(matches!(parsed, ProposalPayload::Criterion { pinned_revision: None, .. }));

    let mut f = fixture();
    let draft = draft_amend(&mut f, DRAFT);
    f.conn
        .execute("UPDATE authoring_proposals SET payload = ?1 WHERE id = ?2", params![legacy, draft.id])
        .unwrap();
    assert_eq!(stored_pin(&f.conn, &draft.id), None);

    accept_proposal(&mut f.conn, &draft.id, &f.human).expect("an unpinned stored row accepts as it always did");
}

#[test]
fn a_create_draft_carries_no_pin_even_if_the_caller_supplies_one() {
    let mut f = fixture();
    let created = create_proposal(
        &mut f.conn,
        &f.run_id,
        ProposalVerb::Create,
        ProposalPayload::Criterion {
            statement: "Returns 2 new rows".to_string(),
            verification_hint: None,
            pinned_revision: Some(9),
        },
        Some(&f.criterion_id),
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();

    assert_eq!(pinned(&created), None, "the pin is resolved server-side, never taken from the caller");
    assert_eq!(stored_pin(&f.conn, &created.id), None);
}

#[test]
fn a_human_amend_of_a_pending_draft_keeps_its_pin() {
    let mut f = fixture();
    let draft = draft_amend(&mut f, DRAFT);
    amend_proposal(&mut f.conn, &draft.id, &f.human, amend_payload("Returns a named error for a whitespace title"))
        .unwrap();

    assert_eq!(stored_pin(&f.conn, &draft.id), Some(1), "editing the wording does not erase what it was computed against");
}

#[test]
fn two_drafts_pinning_the_same_revision_are_decided_independently() {
    let mut f = fixture();
    let first = draft_amend(&mut f, DRAFT);
    let second = draft_amend(&mut f, "Returns a named error for an untitled task");
    assert_eq!((pinned(&first), pinned(&second)), (Some(1), Some(1)));

    // Rejecting one changes neither the other's pin nor its verdict.
    reject_proposal(&mut f.conn, &first.id, &f.human, Some("no")).unwrap();
    assert_eq!(stored_pin(&f.conn, &second.id), Some(1));
    accept_proposal(&mut f.conn, &second.id, &f.human).expect("the sibling's rejection does not stale the pin");
}

#[test]
fn accepting_one_draft_moves_the_revision_so_its_sibling_is_refused_with_its_pin_intact() {
    let mut f = fixture();
    let first = draft_amend(&mut f, DRAFT);
    let second = draft_amend(&mut f, "Returns a named error for an untitled task");

    accept_proposal(&mut f.conn, &first.id, &f.human).unwrap();

    assert_eq!(stored_pin(&f.conn, &second.id), Some(1), "deciding one does not rewrite the other's pin");
    let err = accept_proposal(&mut f.conn, &second.id, &f.human).expect_err("the revision moved under it");
    assert!(err.to_string().contains("revision 2"), "{err}");
    assert_eq!(status(&f.conn, &second.id), "pending");
}
