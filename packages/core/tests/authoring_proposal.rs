//! `accept_proposal` / `reject_proposal` / `amend_proposal` / `accept_subtree` (D-92/D-93/D-94/
//! D-95/D-96, plan 05-06): per-row decisions down to the individual criterion, for every verb and
//! every target type — one test per `<behavior>` bullet across all three of this plan's tasks,
//! plus the structural gate proving no tray-wide accept-all exists anywhere in this workspace.

mod common;

use std::path::{Path, PathBuf};

use core::domain::acceptance_criterion::{create_criterion, list_current_criteria};
use core::domain::agent_run::{
    close_agent_run, interrupt_agent_run, mark_abandoned, start_agent_run, AgentRunStatus,
};
use core::domain::authoring_proposal::{
    accept_proposal, accept_subtree, amend_proposal, apply_proposal_created, create_proposal,
    pending_proposals_for_run, reject_proposal, ProposalOutcome, ProposalPayload,
    ProposalProvenance, ProposalUndecidable, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::project::Project;
use core::domain::task::{create_task, delete_task};
use core::ids::new_id;
use core::query::authoring::list_pending_proposals;
use core::query::permissions::{blocked_count_for_project, blocked_task_ids_for_project};
use rusqlite::{params, Connection};

/// Stage one `pending` `authoring_proposals` row directly, bypassing `create_proposal`'s own
/// `PROPOSAL_LIMIT_PER_RUN` write-side rule (plan 06-05) — used ONLY by
/// `pending_proposals_lane_clamp_holds_for_a_ten_million_request` below, which pins
/// `list_pending_proposals`'s own READ-side clamp arithmetic (a property of that read's
/// pagination, not of proposal authoring), and therefore needs more rows under one run than the
/// write-side limit now permits through the public API.
fn seed_raw_pending_proposal(conn: &Connection, run_id: &str, project_id: &str, actor_id: &str, title: &str) {
    conn.execute(
        "INSERT INTO authoring_proposals (
            id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
            parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
            created_by, created_at, decided_by, decided_at, rationale, origin_log_offset,
            duplicate_of, duplicate_score
        ) VALUES (?1, ?2, ?3, NULL, 'create', 'task', NULL, NULL, ?4, ?5, 'pending', NULL, NULL, \
            ?6, ?7, NULL, NULL, NULL, NULL, NULL, NULL)",
        params![
            new_id(),
            run_id,
            project_id,
            new_id(),
            serde_json::json!({ "kind": "task", "title": title, "description": null }).to_string(),
            actor_id,
            chrono::Utc::now().to_rfc3339(),
        ],
    )
    .expect("failed to seed a raw pending proposal");
}

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — `advance_stage` writes
/// the D-88 authoring-stage runtime marker as part of its own transaction, mirroring
/// `authoring_tracer.rs`'s/`authoring_stage.rs`'s own identically-named lock.
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — mirrors
/// `criteria_pin.rs`'s identically-named lock. Only the locked-criterion test needs a real
/// `agent_runs` row against a real worktree; every other test in this file never sets this var.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by WORKTREE_ROOT_ENV_LOCK above.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Seed a project and an authoring run already advanced past `challenge` into `decompose` — the
/// ready state every test below starts from (the write tools this plan tests do not exist until
/// the stage advances, per D-88; that gate itself is plan 05-03's own concern, not retested here).
fn ready_run() -> (Connection, String, Project, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &human_actor_id).expect("advance_stage should succeed");
    (conn, human_actor_id, project, run.id)
}

fn count_tasks(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap()
}
fn count_epics(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM epics", [], |row| row.get(0)).unwrap()
}
fn count_criteria(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |row| row.get(0)).unwrap()
}
fn count_events(conn: &Connection, event_type: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE event_type = ?1",
        params![event_type],
        |row| row.get(0),
    )
    .unwrap()
}
fn proposal_status(conn: &Connection, proposal_id: &str) -> String {
    conn.query_row(
        "SELECT status FROM authoring_proposals WHERE id = ?1",
        params![proposal_id],
        |row| row.get(0),
    )
    .unwrap()
}

// ============================================================================================
// Task 1: accept, for every verb and every target type
// ============================================================================================

#[test]
fn accepting_a_create_task_proposal_writes_one_task_row_and_one_event() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Write docs".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let before = count_tasks(&conn);
        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
        assert_eq!(count_tasks(&conn), before + 1);
        assert_eq!(count_events(&conn, "task.created"), 1);
        let status: String = conn
            .query_row("SELECT status FROM tasks WHERE id = ?1", params![outcome.materialised_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(status, "todo");
    });
}

#[test]
fn accepting_a_create_epic_proposal_writes_one_epic_row() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "New epic".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
        assert_eq!(count_epics(&conn), 1);
        let key: String = conn
            .query_row("SELECT key FROM epics WHERE id = ?1", params![outcome.materialised_id], |r| r.get(0))
            .unwrap();
        assert!(!key.is_empty());
    });
}

#[test]
fn accepting_a_create_criterion_proposal_whose_parent_is_already_accepted_writes_one_row_against_the_parents_materialised_id(
) {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "A task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let accepted_task = accept_proposal(&mut conn, &task_proposal.id, &human_actor_id).unwrap();

        let criterion_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Must work".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();
        let outcome = accept_proposal(&mut conn, &criterion_proposal.id, &human_actor_id).unwrap();

        assert_eq!(count_criteria(&conn), 1);
        let parent_id: String = conn
            .query_row(
                "SELECT parent_id FROM acceptance_criteria WHERE id = ?1",
                params![outcome.materialised_id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(parent_id, accepted_task.materialised_id);
    });
}

#[test]
fn accepting_a_create_criterion_proposal_whose_parent_is_still_pending_accepts_the_parent_first() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "A task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let criterion_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Must work".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();

        let outcome = accept_proposal(&mut conn, &criterion_proposal.id, &human_actor_id).unwrap();

        assert_eq!(count_tasks(&conn), 1, "the pending parent must be accepted exactly once");
        assert_eq!(count_criteria(&conn), 1);
        assert_eq!(proposal_status(&conn, &task_proposal.id), "accepted");

        let criterion_parent: String = conn
            .query_row(
                "SELECT parent_id FROM acceptance_criteria WHERE id = ?1",
                params![outcome.materialised_id],
                |r| r.get(0),
            )
            .unwrap();
        let task_materialised_id: String = conn
            .query_row(
                "SELECT materialised_id FROM authoring_proposals WHERE id = ?1",
                params![task_proposal.id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(criterion_parent, task_materialised_id);
    });
}

#[test]
fn accepting_a_create_assumption_proposal_records_accepted_history_and_writes_no_canonical_row() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Assumption {
                assumption: "Users want X".to_string(),
                answer: "Yes".to_string(),
            },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let before_tasks = count_tasks(&conn);
        let before_epics = count_epics(&conn);
        let before_criteria = count_criteria(&conn);
        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
        assert_eq!(count_tasks(&conn), before_tasks);
        assert_eq!(count_epics(&conn), before_epics);
        assert_eq!(count_criteria(&conn), before_criteria);
        assert!(!outcome.materialised_id.is_empty());
        assert_eq!(proposal_status(&conn, &proposal.id), "accepted");
    });
}

#[test]
fn accepting_an_amend_criterion_proposal_against_an_unlocked_criterion_updates_in_place() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let task = create_task(&mut conn, &project.id, &human_actor_id, "Task", None).unwrap();
        let criterion =
            create_criterion(&mut conn, &project.id, &human_actor_id, "task", &task.id, "Original", None)
                .unwrap();

        let amend_row = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Amend,
            ProposalPayload::Criterion { statement: "Revised text".to_string(), verification_hint: None },
            Some(&criterion.id),
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let outcome = accept_proposal(&mut conn, &amend_row.id, &human_actor_id).unwrap();

        assert_eq!(
            outcome.materialised_id, criterion.id,
            "unlocked amend must update the SAME row, not mint a new one"
        );
        let statement: String = conn
            .query_row("SELECT statement FROM acceptance_criteria WHERE id = ?1", params![criterion.id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(statement, "Revised text");
        assert_eq!(count_criteria(&conn), 1, "no revision row for an unlocked edit");
    });
}

#[test]
fn accepting_an_amend_criterion_proposal_against_a_locked_criterion_appends_a_revision_and_leaves_the_predecessor_byte_identical(
) {
    with_scratch_runtime_dir(|| {
        with_scratch_worktree_root(|| {
            let (mut conn, human_actor_id, project, _repo_dir) = common::seeded_git_project();
            let task = create_task(&mut conn, &project.id, &human_actor_id, "Task", None).unwrap();
            let criterion = create_criterion(
                &mut conn,
                &project.id,
                &human_actor_id,
                "task",
                &task.id,
                "Original",
                None,
            )
            .unwrap();
            // D-76: the lock is a fact — any agent_runs row for this task, ever.
            start_agent_run(&mut conn, &task.id, "acceptEdits", &human_actor_id).unwrap();

            let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
            advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();

            let amend_row = create_proposal(
                &mut conn,
                &run.id,
                ProposalVerb::Amend,
                ProposalPayload::Criterion {
                    statement: "Revised text".to_string(),
                    verification_hint: None,
                },
                Some(&criterion.id),
                None,
                ProposalProvenance::NONE,
            )
            .unwrap();

            let outcome = accept_proposal(&mut conn, &amend_row.id, &human_actor_id).unwrap();

            assert_ne!(
                outcome.materialised_id, criterion.id,
                "a locked amend must mint a successor row"
            );
            let (predecessor_statement, predecessor_superseded): (String, Option<String>) = conn
                .query_row(
                    "SELECT statement, superseded_at FROM acceptance_criteria WHERE id = ?1",
                    params![criterion.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .unwrap();
            assert_eq!(
                predecessor_statement, "Original",
                "the predecessor's own wording must never be rewritten"
            );
            assert!(predecessor_superseded.is_some(), "the predecessor must be marked superseded");

            let successor_statement: String = conn
                .query_row(
                    "SELECT statement FROM acceptance_criteria WHERE id = ?1",
                    params![outcome.materialised_id],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(successor_statement, "Revised text");
        });
    });
}

#[test]
fn accepting_a_delete_proposal_deletes_the_named_row_through_its_canonical_path() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let task = create_task(&mut conn, &project.id, &human_actor_id, "Doomed task", None).unwrap();

        let delete_row = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Delete,
            ProposalPayload::Task { title: String::new(), description: None },
            Some(&task.id),
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();

        let outcome = accept_proposal(&mut conn, &delete_row.id, &human_actor_id).unwrap();

        assert_eq!(outcome.materialised_id, task.id);
        assert_eq!(count_tasks(&conn), 0);
    });
}

#[test]
fn accepting_an_already_accepted_proposal_is_a_no_op_returning_the_existing_materialised_id() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Once".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let first = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
        let before = count_tasks(&conn);
        let second = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
        assert_eq!(second.materialised_id, first.materialised_id);
        assert_eq!(count_tasks(&conn), before, "a second accept must never write a second row");
        assert_eq!(count_events(&conn, "proposal.accepted"), 1, "no second decision event either");
    });
}

#[test]
fn accepting_an_amend_whose_target_row_was_deleted_underneath_it_returns_proposal_undecidable() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let task = create_task(&mut conn, &project.id, &human_actor_id, "Will vanish", None).unwrap();
        let amend_row = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Amend,
            ProposalPayload::Task { title: "New title".to_string(), description: None },
            Some(&task.id),
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();

        delete_task(&mut conn, &human_actor_id, &task.id).unwrap();

        let err = accept_proposal(&mut conn, &amend_row.id, &human_actor_id).unwrap_err();
        let undecidable = err
            .downcast_ref::<ProposalUndecidable>()
            .expect("expected a typed ProposalUndecidable error");
        assert_eq!(undecidable.target_id, task.id);
        assert_eq!(undecidable.target_type, "task");
    });
}

#[test]
fn proposal_struct_carries_no_key_field() {
    let src = include_str!("../src/domain/authoring_proposal.rs");
    let after_struct = src
        .split("pub struct Proposal {")
        .nth(1)
        .expect("Proposal struct definition should exist in this module");
    let block = after_struct.split("}\n").next().unwrap();
    assert!(
        !block.contains("pub key"),
        "Proposal must carry no key field — D-96 allocates a key only at acceptance, so nothing \
         may render one for a staged proposal"
    );
}

// ============================================================================================
// Task 2: reject and amend — the two halves that make the loop bidirectional
// ============================================================================================

#[test]
fn rejecting_a_pending_proposal_sets_status_rejected_records_reason_and_actor_and_keeps_the_row() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Bad idea".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let rejected = reject_proposal(&mut conn, &proposal.id, &human_actor_id, Some("too vague")).unwrap();
        assert_eq!(rejected.status, "rejected");
        assert_eq!(rejected.rejection_reason.as_deref(), Some("too vague"));
        assert_eq!(rejected.decided_by.as_deref(), Some(human_actor_id.as_str()));
        let (status, reason): (String, Option<String>) = conn
            .query_row(
                "SELECT status, rejection_reason FROM authoring_proposals WHERE id = ?1",
                params![proposal.id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "rejected");
        assert_eq!(reason.as_deref(), Some("too vague"));
    });
}

#[test]
fn rejecting_an_already_decided_proposal_is_an_error_not_a_silent_overwrite() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "X".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
        let err = reject_proposal(&mut conn, &proposal.id, &human_actor_id, None).unwrap_err();
        assert!(err.to_string().contains("accepted"), "error should name the existing status: {err}");
        let decided_at: Option<String> = conn
            .query_row(
                "SELECT decided_at FROM authoring_proposals WHERE id = ?1",
                params![proposal.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(decided_at.is_some(), "the original decision must be unchanged");
    });
}

#[test]
fn rejecting_a_task_proposal_leaves_its_pending_child_criterion_proposal_pending() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Parent".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let criterion_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Child".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();
        reject_proposal(&mut conn, &task_proposal.id, &human_actor_id, None).unwrap();
        assert_eq!(proposal_status(&conn, &criterion_proposal.id), "pending");
    });
}

#[test]
fn amending_a_pending_proposal_replaces_its_payload_leaves_it_pending_and_writes_nothing_canonical() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Original title".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let before_tasks = count_tasks(&conn);
        let outcome = amend_proposal(
            &mut conn,
            &proposal.id,
            &human_actor_id,
            ProposalPayload::Task { title: "Developer's own title".to_string(), description: None },
        )
        .unwrap();
        assert_eq!(outcome.proposal.status, "pending");
        assert_eq!(outcome.original_label, "Original title");
        assert_eq!(count_tasks(&conn), before_tasks, "an amend must write nothing to tasks");
        assert_eq!(count_epics(&conn), 0);
        assert_eq!(count_criteria(&conn), 0);
        let stored_payload: String = conn
            .query_row(
                "SELECT payload FROM authoring_proposals WHERE id = ?1",
                params![proposal.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(stored_payload.contains("Developer's own title"));
    });
}

#[test]
fn accepting_after_an_amend_materialises_the_developers_text_not_the_agents_original() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Agent's guess".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        amend_proposal(
            &mut conn,
            &proposal.id,
            &human_actor_id,
            ProposalPayload::Task { title: "Developer's correction".to_string(), description: None },
        )
        .unwrap();
        let outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM tasks WHERE id = ?1", params![outcome.materialised_id], |r| r.get(0))
            .unwrap();
        assert_eq!(title, "Developer's correction");
    });
}

#[test]
fn amend_event_payload_carries_both_the_original_and_the_replacement() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Original".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        amend_proposal(
            &mut conn,
            &proposal.id,
            &human_actor_id,
            ProposalPayload::Task { title: "Replacement".to_string(), description: None },
        )
        .unwrap();
        let payload_json: String = conn
            .query_row(
                "SELECT payload FROM events WHERE event_type = 'proposal.amended' AND stream_id = ?1",
                params![proposal.id],
                |r| r.get(0),
            )
            .unwrap();
        assert!(payload_json.contains("Original"), "event should carry the agent's original: {payload_json}");
        assert!(
            payload_json.contains("Replacement"),
            "event should carry the developer's replacement: {payload_json}"
        );
    });
}

#[test]
fn amend_proposal_refuses_to_change_a_proposals_target_type() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "A task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let err = amend_proposal(
            &mut conn,
            &proposal.id,
            &human_actor_id,
            ProposalPayload::Epic { title: "Now an epic?".to_string(), description: None },
        )
        .unwrap_err();
        assert!(err.to_string().contains("target type"), "{err}");
    });
}

// ============================================================================================
// WR-01 (plan 05-09 code review): create_proposal_in_tx now enforces the same length/emptiness
// bounds amend_proposal already did — parity between the agent-staged path and the human amend
// path, for both entry points (the direct call and the inbound sidecar event).
// ============================================================================================

#[test]
fn create_proposal_refuses_a_title_over_the_amend_length_bound_and_stages_no_row() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human_actor_id, _project, run_id) = ready_run();
        let before = pending_proposals_for_run(&conn, &run_id, 10).expect("should read pending proposals").len();
        let oversized_title = "x".repeat(501);
        let err = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: oversized_title, description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap_err();
        assert!(err.to_string().contains("title"), "{err}");
        let after = pending_proposals_for_run(&conn, &run_id, 10).expect("should read pending proposals").len();
        assert_eq!(before, after, "a validation failure must stage no row at all");
    });
}

#[test]
fn create_proposal_refuses_an_empty_statement() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human_actor_id, _project, run_id) = ready_run();
        let err = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: String::new(), verification_hint: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap_err();
        assert!(err.to_string().contains("statement"), "{err}");
    });
}

#[test]
fn apply_proposal_created_ignores_an_inbound_event_whose_payload_fails_validation_and_stages_no_row() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human_actor_id, _project, run_id) = ready_run();
        let before = pending_proposals_for_run(&conn, &run_id, 10).expect("should read pending proposals").len();
        let oversized_assumption = "x".repeat(1001);
        let event = serde_json::json!({
            "type": "proposal_created",
            "runId": run_id,
            "verb": "create",
            "targetType": "assumption",
            "targetId": null,
            "parentProposalId": null,
            "payload": {
                "kind": "assumption",
                "assumption": oversized_assumption,
                "answer": "",
            },
        });
        let outcome = apply_proposal_created(&mut conn, &event).expect("apply_proposal_created should succeed");
        assert_eq!(
            outcome, ProposalOutcome::Ignored,
            "an inbound event failing the same length bound amend_proposal enforces must be \
             Ignored, never a panic, never a stored row"
        );
        let after = pending_proposals_for_run(&conn, &run_id, 10).expect("should read pending proposals").len();
        assert_eq!(before, after);
    });
}

// ============================================================================================
// Task 3: one bulk path, and the gate that keeps it the only one
// ============================================================================================

#[test]
fn accept_subtree_refuses_a_root_that_is_not_a_task_proposal() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let epic_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Epic { title: "Not a task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let err = accept_subtree(&mut conn, &epic_proposal.id, &human_actor_id).unwrap_err();
        assert!(err.to_string().contains("task"), "{err}");
    });
}

#[test]
fn a_subtree_accept_whose_root_has_no_children_accepts_only_the_root() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Lonely task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let outcome = accept_subtree(&mut conn, &task_proposal.id, &human_actor_id).unwrap();
        assert_eq!(outcome.accepted_count, 1);
        assert_eq!(outcome.skipped_count, 0);
        assert_eq!(count_tasks(&conn), 1);
        assert_eq!(count_criteria(&conn), 0, "a proposed task with zero drafted criteria writes zero rows");
    });
}

#[test]
fn accepting_a_subtree_accepts_the_task_and_its_pending_criteria_in_staging_position_order() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Task with criteria".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "First".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();
        create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Second".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();

        let outcome = accept_subtree(&mut conn, &task_proposal.id, &human_actor_id).unwrap();

        assert_eq!(outcome.accepted_count, 3, "the task plus its two drafted criteria");
        assert_eq!(count_tasks(&conn), 1);
        assert_eq!(count_criteria(&conn), 2);

        let criteria = list_current_criteria(&conn, "task", &outcome.root_materialised_id).unwrap();
        assert_eq!(criteria.len(), 2);
        assert_eq!(criteria[0].statement, "First");
        assert_eq!(criteria[1].statement, "Second");
        assert!(criteria[0].rank < criteria[1].rank, "rank must preserve staging position order");
    });
}

#[test]
fn a_subtree_accept_over_an_already_decided_subtree_returns_zero_accepted_and_appends_no_event() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Already handled".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        accept_proposal(&mut conn, &task_proposal.id, &human_actor_id).unwrap();

        let events_before = count_events(&conn, "proposal.accepted");
        let outcome = accept_subtree(&mut conn, &task_proposal.id, &human_actor_id).unwrap();
        assert_eq!(outcome.accepted_count, 0);
        assert_eq!(outcome.skipped_count, 1);
        assert_eq!(
            count_events(&conn, "proposal.accepted"),
            events_before,
            "no new event for an already-decided subtree"
        );
    });
}

#[test]
fn a_subtree_accept_skips_children_that_are_already_decided_rather_than_erroring() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Partially decided".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let c1 = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion {
                statement: "Already accepted individually".to_string(),
                verification_hint: None,
            },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();
        create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Still pending".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();
        // Accepting c1 individually implicitly accepts the parent task too (D-96).
        accept_proposal(&mut conn, &c1.id, &human_actor_id).unwrap();

        let outcome = accept_subtree(&mut conn, &task_proposal.id, &human_actor_id).unwrap();
        assert_eq!(outcome.accepted_count, 1, "only the still-pending criterion is newly accepted");
        assert_eq!(outcome.skipped_count, 2, "the root and the already-accepted criterion are skipped");
        assert_eq!(count_criteria(&conn), 2);
    });
}

#[test]
fn two_drafted_criteria_with_identical_statements_stage_and_materialise_as_two_distinct_rows() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, _project, run_id) = ready_run();
        let task_proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let c1 = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Must be fast".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();
        let c2 = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Criterion { statement: "Must be fast".to_string(), verification_hint: None },
            None,
            Some(&task_proposal.id),
            ProposalProvenance::NONE,
        )
        .unwrap();
        assert_ne!(c1.id, c2.id, "two staged rows, distinct ids, even with byte-identical statements");

        let outcome = accept_subtree(&mut conn, &task_proposal.id, &human_actor_id).unwrap();
        assert_eq!(outcome.accepted_count, 3);
        let criteria = list_current_criteria(&conn, "task", &outcome.root_materialised_id).unwrap();
        assert_eq!(criteria.len(), 2, "byte-identical statements must not merge or collide");
        assert_ne!(criteria[0].id, criteria[1].id);
    });
}

#[test]
fn pending_proposals_listing_is_stable_across_two_consecutive_reads() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human_actor_id, _project, run_id) = ready_run();
        for i in 0..5 {
            create_proposal(
                &mut conn,
                &run_id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("task {i}"), description: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .unwrap();
        }
        let first = pending_proposals_for_run(&conn, &run_id, 10).unwrap();
        let second = pending_proposals_for_run(&conn, &run_id, 10).unwrap();
        let first_ids: Vec<&str> = first.iter().map(|p| p.id.as_str()).collect();
        let second_ids: Vec<&str> = second.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(first_ids, second_ids);
    });
}

// ============================================================================================
// The board-level triage lane's own read (D-82, plan 05-08 Task 1)
// ============================================================================================

#[test]
fn pending_proposals_lane_includes_a_proposal_for_an_epic_that_does_not_exist_yet() {
    with_scratch_runtime_dir(|| {
        // `ready_run()` starts an authoring run with NO epic (a fresh-epic session, D-84) — its
        // own proposals therefore carry `epic_id = NULL`. The lane read must not inner-join to
        // `epics`, or this is exactly the row that would silently disappear (D-13's rule, in a
        // new place — this IS SHAPE-01's primary case, not an edge case).
        let (mut conn, _human_actor_id, project, run_id) = ready_run();
        let proposal = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Draft a task for a not-yet-real epic".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        assert!(proposal.epic_id.is_none());

        let window = list_pending_proposals(&conn, &project.id, 10, None).unwrap();
        let ids: Vec<&str> = window.proposals.iter().map(|p| p.id.as_str()).collect();
        assert!(
            ids.contains(&proposal.id.as_str()),
            "a proposal whose epic does not exist yet must still appear in the lane"
        );
    });
}

#[test]
fn pending_proposals_lane_is_scoped_to_one_project() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project_a) = common::seeded_project();
        let project_b = core::domain::project::create_project(
            &mut conn,
            &human_actor_id,
            "Second Project",
            "/repo-b",
            "SEC",
            "main",
        )
        .unwrap();

        let run_a = start_authoring_run(&mut conn, &project_a.id, None, "default", &human_actor_id).unwrap();
        advance_stage(&mut conn, &run_a.id, &human_actor_id).unwrap();
        let run_b = start_authoring_run(&mut conn, &project_b.id, None, "default", &human_actor_id).unwrap();
        advance_stage(&mut conn, &run_b.id, &human_actor_id).unwrap();

        let proposal_a = create_proposal(
            &mut conn,
            &run_a.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Project A's own task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let proposal_b = create_proposal(
            &mut conn,
            &run_b.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Project B's own task".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();

        let window_a = list_pending_proposals(&conn, &project_a.id, 10, None).unwrap();
        let ids_a: Vec<&str> = window_a.proposals.iter().map(|p| p.id.as_str()).collect();
        assert!(ids_a.contains(&proposal_a.id.as_str()));
        assert!(
            !ids_a.contains(&proposal_b.id.as_str()),
            "project A's lane must never return project B's proposals"
        );

        let window_b = list_pending_proposals(&conn, &project_b.id, 10, None).unwrap();
        let ids_b: Vec<&str> = window_b.proposals.iter().map(|p| p.id.as_str()).collect();
        assert!(ids_b.contains(&proposal_b.id.as_str()));
        assert!(!ids_b.contains(&proposal_a.id.as_str()));
    });
}

#[test]
fn pending_proposals_lane_ordering_is_stable_across_two_reads() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human_actor_id, project, run_id) = ready_run();
        for i in 0..5 {
            create_proposal(
                &mut conn,
                &run_id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("lane task {i}"), description: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .unwrap();
        }
        let first = list_pending_proposals(&conn, &project.id, 10, None).unwrap();
        let second = list_pending_proposals(&conn, &project.id, 10, None).unwrap();
        let first_ids: Vec<&str> = first.proposals.iter().map(|p| p.id.as_str()).collect();
        let second_ids: Vec<&str> = second.proposals.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(first_ids, second_ids);
    });
}

#[test]
fn pending_proposals_lane_excludes_decided_proposals_while_pending_ones_from_the_same_run_remain() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let to_accept = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Will be accepted".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let to_reject = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Will be rejected".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let stays_pending = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Stays pending".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();

        accept_proposal(&mut conn, &to_accept.id, &human_actor_id).unwrap();
        reject_proposal(&mut conn, &to_reject.id, &human_actor_id, None).unwrap();

        let window = list_pending_proposals(&conn, &project.id, 10, None).unwrap();
        let ids: Vec<&str> = window.proposals.iter().map(|p| p.id.as_str()).collect();
        assert!(!ids.contains(&to_accept.id.as_str()));
        assert!(!ids.contains(&to_reject.id.as_str()));
        assert!(ids.contains(&stays_pending.id.as_str()));
    });
}

#[test]
fn pending_proposals_lane_per_status_counts_match_the_rows() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id) = ready_run();
        let mut pending_ids = Vec::new();
        for i in 0..3 {
            let p = create_proposal(
                &mut conn,
                &run_id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("count task {i}"), description: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .unwrap();
            pending_ids.push(p.id);
        }
        let to_accept = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "counted accepted".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        let to_reject = create_proposal(
            &mut conn,
            &run_id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "counted rejected".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        accept_proposal(&mut conn, &to_accept.id, &human_actor_id).unwrap();
        reject_proposal(&mut conn, &to_reject.id, &human_actor_id, None).unwrap();

        let window = list_pending_proposals(&conn, &project.id, 10, None).unwrap();
        assert_eq!(window.counts.pending, 3);
        assert_eq!(window.counts.accepted, 1);
        assert_eq!(window.counts.rejected, 1);
        assert_eq!(window.proposals.len(), 3);
    });
}

#[test]
fn pending_proposals_lane_clamp_holds_for_a_ten_million_request() {
    with_scratch_runtime_dir(|| {
        let (conn, human_actor_id, project, run_id) = ready_run();
        for i in 0..(core::query::authoring::MAX_LIMIT + 5) {
            seed_raw_pending_proposal(&conn, &run_id, &project.id, &human_actor_id, &format!("clamp task {i}"));
        }
        let window = list_pending_proposals(&conn, &project.id, 10_000_000, None).unwrap();
        assert_eq!(
            window.proposals.len() as i64,
            core::query::authoring::MAX_LIMIT,
            "a 10,000,000 request must never reach SQLite as-is — it is clamped to MAX_LIMIT"
        );
    });
}

// ============================================================================================
// Task 3(b): the property this whole plan exists for — a session that ends while proposals are
// still pending leaves them pending, visible and decidable, for all four terminal run statuses.
// ============================================================================================

/// Starts a fresh project + authoring run advanced to `decompose`, stages one `create`/`task`
/// proposal under it, and returns everything the four status-transition tests below need.
fn ready_run_with_one_pending_proposal(
) -> (Connection, String, Project, String, core::domain::authoring_proposal::Proposal) {
    let (mut conn, human_actor_id, project, run_id) = ready_run();
    let proposal = create_proposal(
        &mut conn,
        &run_id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "Survives the session ending".to_string(), description: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();
    (conn, human_actor_id, project, run_id, proposal)
}

/// Asserts the three-part property Task 3(b) exists to prove, after a run has reached ANY
/// terminal status: the proposal is still `pending`, still returned by the project-scoped lane
/// read, and still acceptable — producing the canonical row exactly as it would have mid-session.
fn assert_proposal_survives_terminal_run(
    conn: &mut Connection,
    human_actor_id: &str,
    project: &Project,
    proposal: &core::domain::authoring_proposal::Proposal,
) {
    assert_eq!(proposal_status(conn, &proposal.id), "pending");

    let window = list_pending_proposals(conn, &project.id, 10, None).unwrap();
    let ids: Vec<&str> = window.proposals.iter().map(|p| p.id.as_str()).collect();
    assert!(
        ids.contains(&proposal.id.as_str()),
        "a proposal from a terminal run must still appear in the project-scoped lane read"
    );

    let before = count_tasks(conn);
    let outcome = accept_proposal(conn, &proposal.id, human_actor_id).unwrap();
    assert_eq!(count_tasks(conn), before + 1);
    let status: String = conn
        .query_row("SELECT status FROM tasks WHERE id = ?1", params![outcome.materialised_id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(
        status, "todo",
        "accepting a proposal after its session ended must produce the canonical row exactly as \
         it would have during the session"
    );
}

#[test]
fn a_pending_proposal_survives_its_run_reaching_completed() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id, proposal) = ready_run_with_one_pending_proposal();
        close_agent_run(&mut conn, &run_id, AgentRunStatus::Completed, None, None, None).unwrap();
        assert_proposal_survives_terminal_run(&mut conn, &human_actor_id, &project, &proposal);
    });
}

#[test]
fn a_pending_proposal_survives_its_run_reaching_failed() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id, proposal) = ready_run_with_one_pending_proposal();
        close_agent_run(&mut conn, &run_id, AgentRunStatus::Failed, None, None, None).unwrap();
        assert_proposal_survives_terminal_run(&mut conn, &human_actor_id, &project, &proposal);
    });
}

#[test]
fn a_pending_proposal_survives_its_run_reaching_interrupted() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id, proposal) = ready_run_with_one_pending_proposal();
        interrupt_agent_run(&mut conn, &run_id, &human_actor_id).unwrap();
        assert_proposal_survives_terminal_run(&mut conn, &human_actor_id, &project, &proposal);
    });
}

#[test]
fn a_pending_proposal_survives_its_run_reaching_abandoned() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project, run_id, proposal) = ready_run_with_one_pending_proposal();
        let wrote = mark_abandoned(&mut conn, &run_id, &human_actor_id, None).unwrap();
        assert!(wrote, "mark_abandoned should have performed a real transition from running");
        assert_proposal_survives_terminal_run(&mut conn, &human_actor_id, &project, &proposal);
    });
}

// --- T-05-08's own money-burning distinction (D-46): a pending proposal never joins the blocked
// rollup, in either shape that rollup is read (the board's task-row indicator and the rail count) ---

#[test]
fn pending_proposals_never_join_the_blocked_task_ids_or_the_blocked_count() {
    with_scratch_runtime_dir(|| {
        let (mut conn, _human_actor_id, project, run_id) = ready_run();
        for i in 0..3 {
            create_proposal(
                &mut conn,
                &run_id,
                ProposalVerb::Create,
                ProposalPayload::Task { title: format!("unrelated to blocked {i}"), description: None },
                None,
                None,
                ProposalProvenance::NONE,
            )
            .unwrap();
        }

        let blocked_ids = blocked_task_ids_for_project(&conn, &project.id).unwrap();
        assert!(blocked_ids.is_empty(), "a pending proposal must never appear as a blocked task id");

        let blocked_count = blocked_count_for_project(&conn, &project.id).unwrap();
        assert_eq!(blocked_count, 0, "a pending proposal must never be counted as blocked (D-46)");
    });
}

// --- The no-accept-all gate (D-95, SHAPE-04) ---

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("packages/core should have a parent")
        .parent()
        .expect("packages should have a parent")
        .to_path_buf()
}

fn is_whole_line_comment(line: &str) -> bool {
    line.trim_start().starts_with("//")
}

fn sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let Ok(entries) = std::fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path
                .extension()
                .is_some_and(|e| e == "rs" || e == "ts" || e == "tsx")
            {
                out.push(path);
            }
        }
    }
    let mut paths = Vec::new();
    walk(dir, &mut paths);
    paths
        .into_iter()
        .map(|p| {
            let body = std::fs::read_to_string(&p).unwrap_or_else(|e| panic!("failed to read {p:?}: {e}"));
            (p, body)
        })
        .collect()
}

const FORBIDDEN_IDENTIFIERS: [&str; 4] = ["accept_all", "acceptAll", "accept_remaining", "acceptRemaining"];

/// SHAPE-04 forbids wholesale acceptance being the ONLY option, not bulk acceptance existing at
/// all — D-95 allows exactly one bulk path (`accept_subtree`, a proposed task together with its
/// drafted criteria). This gate is a SEQUENCING decision, not a permanent ban: a tray-wide
/// accept-all-remaining action is a Deferred Idea (`05-CONTEXT.md`), purely additive later and
/// deliberately not shipped first so the per-subtree habit forms before a shortcut exists to skip
/// it. The failure this protects against is not a bug — it is a future convenience that would pass
/// every OTHER test while quietly ending the behaviour SHAPE-03's criterion-editing requirement
/// exists to create. Scans `.rs`, `.ts` and `.tsx` sources under the three trees an agent-reachable or
/// developer-reachable accept path could live in; this file's own `tests/` directory (where the
/// forbidden strings above are legitimately named, as data) is never in that scan scope.
#[test]
fn no_accept_all_identifier_exists_outside_this_gates_own_file() {
    let root = workspace_root();
    let scan_dirs = [
        root.join("packages/core/src"),
        root.join("packages/desktop/src-tauri/src"),
        root.join("packages/desktop/src"),
    ];

    let mut offenders = Vec::new();
    for dir in scan_dirs {
        for (path, body) in sources_under(&dir) {
            for (n, line) in body.lines().enumerate() {
                if is_whole_line_comment(line) {
                    continue;
                }
                for forbidden in FORBIDDEN_IDENTIFIERS {
                    if line.contains(forbidden) {
                        offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
                    }
                }
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "an accept-everything identifier exists outside this gate's own file — SHAPE-04 forbids \
         wholesale acceptance being the only option; D-95 allows exactly one bulk path \
         (accept_subtree, task-plus-drafted-criteria). Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn the_no_accept_all_gate_detects_the_shape_it_exists_to_catch() {
    let shipped = "        pub fn accept_all(&self) -> Result<()> {";
    let fine = "        pub fn accept_subtree(&self) -> Result<()> {";
    assert!(FORBIDDEN_IDENTIFIERS.iter().any(|f| shipped.contains(f)));
    assert!(!FORBIDDEN_IDENTIFIERS.iter().any(|f| fine.contains(f)));
}

/// The accept-all gate above names `packages/desktop/src` as a scan target, but that tree is
/// entirely TypeScript/TSX — and two of `FORBIDDEN_IDENTIFIERS` (`acceptAll`, `acceptRemaining`)
/// are camelCase precisely because a frontend accept-all is the shape they exist to catch. A
/// walker that collects only `.rs` therefore turns the frontend half of that gate into a
/// permanent no-op that still reads as protection (found by Phase 5 verification). This test is
/// the gate on the gate: it fails if the walker ever stops reaching the frontend tree, so the
/// coverage hole cannot silently reopen the way it originally opened.
#[test]
fn the_no_accept_all_gate_actually_reaches_the_frontend_tree() {
    let frontend = workspace_root().join("packages/desktop/src");
    let collected = sources_under(&frontend);

    assert!(
        !collected.is_empty(),
        "the accept-all gate scans {} but collected no sources there — the frontend half of the \
         gate is a no-op",
        frontend.display()
    );
    assert!(
        collected
            .iter()
            .any(|(p, _)| p.extension().is_some_and(|e| e == "tsx")),
        "the accept-all gate collected {} sources under {} but not one .tsx file — the walker is \
         not reaching the frontend components an accept-all control would live in",
        collected.len(),
        frontend.display()
    );
}
