//! Plan 05-09: the six answers this plan gives to the six open questions `05-CONTEXT.md` carried
//! into planning — a summary's subject generalised to cover a conversation, Stop/Discard/
//! `mark_abandoned` all leaving a record for an authoring run, and the three "readings" (cost, the
//! needs-you count, the spawn floor) written down with a test each.
//!
//! Follows `authoring_tracer.rs`'s own house style: `common::seeded_project()` for the fixture,
//! the `with_scratch_runtime_dir` guard for any call touching `authoring_session::advance_stage`
//! (the only function in this crate that writes a runtime marker file), and
//! `discard_lifecycle.rs`'s own `simulate_discard_stop_path_in_tx` shape for driving the
//! committing Stop/Discard termination unit without a real spawned sidecar.

mod common;

use core::domain::agent_run::{
    apply_session_closed, mark_abandoned, run_subject, RunSubject,
};
use core::domain::authoring_proposal::{
    accept_proposal, create_proposal, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::epic::create_epic;
use core::domain::permission_request::create_pending_request;
use core::domain::session_summary::{
    create_summary, latest_summary_for_run, DecisionEntry, SummaryFields,
};
use core::domain::task::create_task;
use core::epic_context_packet::assemble_epic_context_packet;
use core::query::permissions::{blocked_count_for_project, blocked_task_ids_for_project};
use core::query::recovery::{recovery_count_for_project, recovery_task_ids_for_project};
use rusqlite::{params, Connection};

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — mirrors
/// `authoring_tracer.rs`'s own identically-named lock, needed because `advance_stage` writes a
/// runtime marker file keyed by `FLYWHEEL_RUNTIME_DIR`, which is process-global mutable state.
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — mirrors
/// `discard_lifecycle.rs`'s/`recovery_summary.rs`'s own identically-named lock; needed only by the
/// one test in this file that starts a real TASK run (`start_agent_run` calls `ensure_worktree`,
/// which needs a real repository, unlike an authoring run's worktree-less start).
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Copies `discard_lifecycle.rs`'s own `simulate_discard_stop_path_in_tx` exactly — the committing
/// Stop/Discard termination unit (`interrupt_agent_run_in_tx` then the presence-checked fallback
/// summary insert, one transaction), without a real spawned sidecar. Returns the terminal status.
fn simulate_stop_in_tx(conn: &mut Connection, run_id: &str, actor_id: &str) -> anyhow::Result<String> {
    let tx = conn.transaction()?;
    core::domain::agent_run::interrupt_agent_run_in_tx(&tx, run_id, actor_id)?;
    let status: String =
        tx.query_row("SELECT status FROM agent_runs WHERE id = ?1", params![run_id], |row| row.get(0))?;
    if latest_summary_for_run(&tx, run_id)?.is_none() {
        core::domain::session_summary::synthesize_fallback_summary(&tx, run_id, &status)?;
    }
    tx.commit()?;
    Ok(status)
}

fn count_pending_proposals(conn: &Connection, run_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1 AND status = 'pending'",
        params![run_id],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

// --- Task 1: the summary's subject, generalised ---

#[test]
fn a_session_summaries_row_carrying_both_task_id_and_epic_id_is_rejected() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human_actor_id, "A task", None).unwrap();
    let epic = create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None).unwrap();
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &human_actor_id).unwrap();

    let result = conn.execute(
        "INSERT INTO session_summaries (
            id, agent_run_id, worktree_id, task_id, epic_id, project_id, changed_files,
            changed_prose, remains, next_session_must_know, decisions, acknowledged_decisions,
            diff_ref, auto_generated, created_by, created_at
        ) VALUES (?1, ?2, NULL, ?3, ?4, ?5, '[]', NULL, NULL, NULL, '[]', '[]', NULL, 0, ?6, ?7)",
        params![
            core::ids::new_id(),
            run.id,
            task.id,
            epic.id,
            project.id,
            human_actor_id,
            "2026-01-01T00:00:00Z",
        ],
    );
    assert!(
        result.is_err(),
        "a session_summaries row carrying BOTH task_id and epic_id must be rejected by the schema CHECK"
    );
}

#[test]
fn an_authoring_runs_create_summary_resolves_epic_id_and_leaves_task_id_null() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None).unwrap();
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &human_actor_id).unwrap();

    let fields = SummaryFields {
        changed_files: Vec::new(),
        changed_prose: Some("Shaped the epic".to_string()),
        remains: None,
        next_session_must_know: None,
        decisions: vec![DecisionEntry { id: "d1".to_string(), statement: "Use option A".to_string() }],
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: false,
    };
    let summary = create_summary(&mut conn, &run.id, fields, &run.actor_id).unwrap();

    assert_eq!(summary.task_id, None, "an authoring run's summary must carry a NULL task_id");
    assert_eq!(summary.epic_id.as_deref(), Some(epic.id.as_str()));
}

#[test]
fn a_fresh_epic_authoring_runs_summary_carries_both_ids_null_and_does_not_error() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    assert_eq!(run_subject(&conn, &run.id).unwrap(), RunSubject::Unbound);

    let fields = SummaryFields {
        changed_files: Vec::new(),
        changed_prose: Some("Shaped a new epic from scratch".to_string()),
        remains: None,
        next_session_must_know: None,
        decisions: Vec::new(),
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: false,
    };
    let summary = create_summary(&mut conn, &run.id, fields, &run.actor_id)
        .expect("a fresh-epic authoring run's summary must not error");
    assert_eq!(summary.task_id, None);
    assert_eq!(summary.epic_id, None);
}

#[test]
fn the_fallback_synthesiser_names_the_stage_reached_and_the_staged_proposal_counts_by_target_type() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let epic = create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None).unwrap();
        let run =
            start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &human_actor_id).unwrap();
        advance_stage(&mut conn, &run.id, &human_actor_id).unwrap(); // -> decompose

        let task_proposal = create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Write docs".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: "Ship it".to_string(), description: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
        // One decided (accepted) proposal.
        accept_proposal(&mut conn, &task_proposal.id, &human_actor_id).unwrap();

        let status = simulate_stop_in_tx(&mut conn, &run.id, &human_actor_id).unwrap();
        assert_eq!(status, "interrupted");

        let summary = latest_summary_for_run(&conn, &run.id)
            .unwrap()
            .expect("a fallback summary must have been synthesised");
        assert!(summary.auto_generated);
        let prose = summary.changed_prose.expect("the fallback must carry changed_prose");
        assert!(prose.contains("decompose"), "expected the stage reached in {prose:?}");
        assert!(prose.contains("2 task"), "expected the target-type count in {prose:?}");
        assert!(prose.contains("1 "), "expected the decided count in {prose:?}");
    });
}

#[test]
fn epic_context_packets_prior_authoring_runs_reads_the_summary_back() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let epic = create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None).unwrap();
        let run =
            start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &human_actor_id).unwrap();
        advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();
        simulate_stop_in_tx(&mut conn, &run.id, &human_actor_id).unwrap();

        let packet = assemble_epic_context_packet(&conn, &project.id, Some(&epic.id)).unwrap();
        assert_eq!(packet.prior_authoring_runs.len(), 1);
        let entry = &packet.prior_authoring_runs[0];
        assert_eq!(entry.id, run.id);
        assert!(
            entry.summary_changed_prose.is_some(),
            "the prior run's own closing summary must be readable from the packet"
        );

        let rendered = core::epic_context_packet::render_epic_prompt(&packet, None);
        assert!(rendered.contains("Summary:"), "the rendered prompt should surface the summary");
    });
}

// --- Task 2: Stop, Discard, and mark_abandoned ---

#[test]
fn stopping_an_authoring_run_reaches_a_terminal_status_in_one_transaction_and_leaves_proposals_pending() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    let proposal = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "Draft".to_string(), description: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();

    let status = simulate_stop_in_tx(&mut conn, &run.id, &human_actor_id).unwrap();
    assert_eq!(status, "interrupted");

    let proposal_status: String = conn
        .query_row(
            "SELECT status FROM authoring_proposals WHERE id = ?1",
            params![proposal.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(proposal_status, "pending", "Stopping an authoring run must leave staged proposals untouched");

    let summary = latest_summary_for_run(&conn, &run.id).unwrap();
    assert!(summary.is_some(), "a stopped authoring run must have a summary");
}

#[test]
fn mark_abandoned_on_an_authoring_run_writes_a_fallback_summary_inside_its_own_transaction() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None).unwrap();
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &human_actor_id).unwrap();
    create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "must work".to_string(), verification_hint: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();

    let wrote = mark_abandoned(&mut conn, &run.id, &human_actor_id, Some("app died"))
        .expect("mark_abandoned should succeed");
    assert!(wrote);

    let status: String =
        conn.query_row("SELECT status FROM agent_runs WHERE id = ?1", params![run.id], |row| row.get(0)).unwrap();
    assert_eq!(status, "abandoned");

    let summary = latest_summary_for_run(&conn, &run.id)
        .unwrap()
        .expect("mark_abandoned must leave a fallback summary for an authoring run — this is the STATE.md gap 05-09 closes");
    assert!(summary.auto_generated);
    assert_eq!(summary.epic_id.as_deref(), Some(epic.id.as_str()));

    let proposal_status: String = conn
        .query_row("SELECT status FROM authoring_proposals WHERE agent_run_id = ?1", params![run.id], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(proposal_status, "pending");
}

#[test]
fn mark_abandoned_on_a_task_run_also_writes_a_fallback_summary_inside_its_own_transaction() {
    with_scratch_worktree_root(|| {
        let (mut conn, human_actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &human_actor_id, "A task", None).unwrap();
        let run = core::domain::agent_run::start_agent_run(&mut conn, &task.id, "acceptEdits", &human_actor_id)
            .unwrap();

        let wrote = mark_abandoned(&mut conn, &run.id, &human_actor_id, None).unwrap();
        assert!(wrote);

        let summary = latest_summary_for_run(&conn, &run.id)
            .unwrap()
            .expect("mark_abandoned must leave a fallback summary for a task run too — the rule is now uniform");
        assert!(summary.auto_generated);
        assert_eq!(summary.task_id.as_deref(), Some(task.id.as_str()));
    });
}

#[test]
fn no_terminal_status_exists_without_a_summary_across_every_authoring_terminal_path() {
    let assert_terminal_has_summary = |conn: &Connection, run_id: &str, label: &str| {
        let status: String = conn
            .query_row("SELECT status FROM agent_runs WHERE id = ?1", params![run_id], |row| row.get(0))
            .unwrap();
        assert!(
            matches!(status.as_str(), "completed" | "failed" | "interrupted" | "abandoned"),
            "{label}: expected a terminal status, got {status:?}"
        );
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                params![run_id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(count >= 1, "{label}: a terminal authoring run must hold at least one summary");
    };

    let (mut conn, human_actor_id, project) = common::seeded_project();

    // Path 1: Stop/Discard's committing termination unit.
    let stop_run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    simulate_stop_in_tx(&mut conn, &stop_run.id, &human_actor_id).unwrap();
    assert_terminal_has_summary(&conn, &stop_run.id, "Stop/Discard");

    // Path 2: mark_abandoned.
    let abandoned_run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    mark_abandoned(&mut conn, &abandoned_run.id, &human_actor_id, None).unwrap();
    assert_terminal_has_summary(&conn, &abandoned_run.id, "mark_abandoned");

    // Path 3: natural close via apply_session_closed.
    let closed_run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    let event = serde_json::json!({
        "type": "session_closed",
        "runId": closed_run.id,
        "reason": "completed",
        "result": { "totalCostUsd": 0.02, "inputTokens": 10, "outputTokens": 20 },
    });
    apply_session_closed(&mut conn, &event).unwrap();
    assert_terminal_has_summary(&conn, &closed_run.id, "natural close");
}

// --- Task 3: cost, the needs-you count, and the spawn floor ---

#[test]
fn a_completed_authoring_run_carries_non_null_cost_and_token_columns() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();

    let event = serde_json::json!({
        "type": "session_closed",
        "runId": run.id,
        "reason": "completed",
        "result": { "totalCostUsd": 1.23, "inputTokens": 100, "outputTokens": 200 },
    });
    apply_session_closed(&mut conn, &event).unwrap();

    let (cost, tokens_in, tokens_out): (Option<f64>, Option<i64>, Option<i64>) = conn
        .query_row(
            "SELECT cost_usd, tokens_in, tokens_out FROM agent_runs WHERE id = ?1",
            params![run.id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap();
    assert_eq!(cost, Some(1.23));
    assert_eq!(tokens_in, Some(100));
    assert_eq!(tokens_out, Some(200));
}

#[test]
fn board_blocked_and_recovery_summaries_are_unaffected_by_a_pending_proposal() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None).unwrap();
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &human_actor_id).unwrap();

    let blocked_ids_before = blocked_task_ids_for_project(&conn, &project.id).unwrap();
    let blocked_count_before = blocked_count_for_project(&conn, &project.id).unwrap();
    let recovery_ids_before = recovery_task_ids_for_project(&conn, &project.id).unwrap();
    let recovery_count_before = recovery_count_for_project(&conn, &project.id).unwrap();

    create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: "A pending proposal".to_string(), description: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();
    assert_eq!(count_pending_proposals(&conn, &run.id), 1);

    let blocked_ids_after = blocked_task_ids_for_project(&conn, &project.id).unwrap();
    let blocked_count_after = blocked_count_for_project(&conn, &project.id).unwrap();
    let recovery_ids_after = recovery_task_ids_for_project(&conn, &project.id).unwrap();
    let recovery_count_after = recovery_count_for_project(&conn, &project.id).unwrap();

    assert_eq!(blocked_ids_before, blocked_ids_after);
    assert_eq!(blocked_count_before, blocked_count_after);
    assert_eq!(recovery_ids_before, recovery_ids_after);
    assert_eq!(recovery_count_before, recovery_count_after);
    assert_eq!(
        blocked_count_after, 0,
        "a pending proposal must never burn a spot in the money-burning rail count"
    );
}

#[test]
fn a_permission_blocked_authoring_run_does_appear_in_the_blocked_count() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None).unwrap();
    let run = start_authoring_run(&mut conn, &project.id, Some(&epic.id), "default", &human_actor_id).unwrap();

    let before = blocked_count_for_project(&conn, &project.id).unwrap();
    assert_eq!(before, 0);

    create_pending_request(&mut conn, &run.id, "Bash", Some("{\"command\":\"ls\"}"), &run.actor_id, None)
        .expect("an authoring run must be able to raise a genuine permission request");

    let status: String =
        conn.query_row("SELECT status FROM agent_runs WHERE id = ?1", params![run.id], |row| row.get(0)).unwrap();
    assert_eq!(status, "blocked");

    let after = blocked_count_for_project(&conn, &project.id).unwrap();
    assert_eq!(after, 1, "a permission-blocked authoring run must join the rail's blocked count, exactly like a task run");
}
