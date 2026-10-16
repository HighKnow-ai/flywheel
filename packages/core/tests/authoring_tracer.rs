//! The tracer's own end-to-end proof (plan 05-02 Task 1): a proposed task becomes a real task,
//! with the canonical tables provably untouched until a human accepts. Plus the two
//! `<assumption_delta_decision>` invariant cases: the schema rejects a run claiming two subjects,
//! and a source-scanning gate proving no file outside `domain::agent_run`'s own module reads
//! `agent_runs.task_id` as a qualified SQL literal.

mod common;

use std::path::{Path, PathBuf};

use core::domain::actor::system_actor;
use core::domain::agent_run::{run_subject, RunSubject};
use core::domain::authoring_proposal::{
    accept_proposal, apply_proposal_created, create_proposal, pending_proposals_for_run,
    ProposalOutcome, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, current_stage, start_authoring_run, AuthoringStage};
use rusqlite::params;

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — `FLYWHEEL_RUNTIME_DIR`
/// is process-global mutable state, and `cargo test` runs `#[test]` functions concurrently by
/// default. Mirrors `runtime_protocol.rs`'s/`launch_reconciliation.rs`'s own identically-named
/// lock: as of plan 05-03, `advance_stage` writes the D-88 authoring-stage runtime marker as part
/// of its own transaction, so every test in this file that calls it needs an isolated scratch
/// runtime dir — without this, `cargo test` would write real files into the developer's actual
/// application-data directory.
static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_runtime_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = RUNTIME_DIR_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch runtime dir");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_RUNTIME_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_RUNTIME_DIR") };
    result
}

#[test]
fn a_proposed_task_becomes_a_real_task_end_to_end() {
    with_scratch_runtime_dir(|| a_proposed_task_becomes_a_real_task_end_to_end_body());
}

fn a_proposed_task_becomes_a_real_task_end_to_end_body() {
    let (mut conn, human_actor_id, project) = common::seeded_project();

    // Start an authoring run against no existing epic (SHAPE-01's own case).
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
        .expect("start_authoring_run should succeed");
    assert_eq!(run.task_id, None, "an authoring run's task_id must be NULL");
    assert_eq!(run.epic_id, None, "a fresh-epic authoring run's epic_id must be NULL");
    assert_eq!(run.authoring_stage.as_deref(), Some("challenge"));
    assert_eq!(current_stage(&conn, &run.id).unwrap(), Some(AuthoringStage::Challenge));

    // The subject accessor agrees.
    assert_eq!(run_subject(&conn, &run.id).unwrap(), RunSubject::Unbound);

    // Nothing exists yet in the canonical tables.
    let tasks_before: i64 =
        conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap();
    assert_eq!(tasks_before, 0);

    // Advance to decompose (D-90: a human actor drives it).
    let (stage, _distillation) = advance_stage(&mut conn, &run.id, &human_actor_id).expect("advance_stage should succeed");
    assert_eq!(stage, AuthoringStage::Decompose);
    assert_eq!(current_stage(&conn, &run.id).unwrap(), Some(AuthoringStage::Decompose));

    // Drive one proposal in through apply_proposal_created — the exact JSON shape the sidecar
    // relays over the per-run socket (D-53's precedent: a `kind` discriminant, no runId/projectId/
    // epicId inside the payload itself, identity resolved from the run).
    let event = serde_json::json!({
        "type": "proposal_created",
        "runId": run.id,
        "verb": "create",
        "targetType": "task",
        "targetId": null,
        "parentProposalId": null,
        "payload": {
            "kind": "task",
            "title": "Write the onboarding doc",
            "description": "Explain the first-run flow",
        },
    });
    let outcome = apply_proposal_created(&mut conn, &event).expect("apply_proposal_created should succeed");
    let ProposalOutcome::Created(proposal) = outcome else {
        panic!("expected ProposalOutcome::Created, got {outcome:?}");
    };
    assert_eq!(proposal.status, "pending");
    assert_eq!(proposal.agent_run_id, run.id);
    assert_eq!(proposal.created_by, run.actor_id, "created_by must be the AGENT actor");

    // Exactly one pending proposal, still zero rows in tasks/epics/acceptance_criteria.
    let pending = pending_proposals_for_run(&conn, &run.id, 10).expect("should read pending proposals");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].id, proposal.id);

    let tasks_after_stage: i64 =
        conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap();
    assert_eq!(tasks_after_stage, 0, "staging a proposal must not touch tasks");
    let epics_after_stage: i64 =
        conn.query_row("SELECT COUNT(*) FROM epics", [], |row| row.get(0)).unwrap();
    assert_eq!(epics_after_stage, 0, "staging a proposal must not touch epics");
    let criteria_after_stage: i64 =
        conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |row| row.get(0)).unwrap();
    assert_eq!(criteria_after_stage, 0, "staging a proposal must not touch acceptance_criteria");

    // Accept it as the human actor.
    let accepted = accept_proposal(&mut conn, &proposal.id, &human_actor_id)
        .expect("accept_proposal should succeed");
    assert_ne!(
        accepted.proposal.created_by, human_actor_id,
        "created_by (the agent) and decided_by (the human) must differ"
    );
    assert_eq!(accepted.proposal.decided_by.as_deref(), Some(human_actor_id.as_str()));
    assert_eq!(accepted.proposal.status, "accepted");

    // Exactly one real task row, at todo, carrying a real project key.
    let (status, key): (String, String) = conn
        .query_row(
            "SELECT status, key FROM tasks WHERE id = ?1",
            params![accepted.materialised_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("the materialised task row should exist");
    assert_eq!(status, "todo");
    assert!(key.starts_with(&project.key_prefix), "key {key:?} should carry the project's prefix");

    let tasks_final: i64 =
        conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap();
    assert_eq!(tasks_final, 1);

    // Both the proposal's and the task's events are present with the right actors.
    let proposal_event_actor: String = conn
        .query_row(
            "SELECT actor_id FROM events WHERE event_type = 'proposal.accepted' AND stream_id = ?1",
            params![proposal.id],
            |row| row.get(0),
        )
        .expect("a proposal.accepted event should exist");
    assert_eq!(proposal_event_actor, human_actor_id);

    let task_event_actor: String = conn
        .query_row(
            "SELECT actor_id FROM events WHERE event_type = 'task.created' AND stream_id = ?1",
            params![accepted.materialised_id],
            |row| row.get(0),
        )
        .expect("a task.created event should exist");
    assert_eq!(task_event_actor, run.actor_id, "the task.created event is attributed to the agent actor create_task_in_tx received");
}

#[test]
fn pending_proposals_for_run_clamps_to_max_limit() {
    with_scratch_runtime_dir(|| pending_proposals_for_run_clamps_to_max_limit_body());
}

fn pending_proposals_for_run_clamps_to_max_limit_body() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();

    for i in 0..3 {
        create_proposal(
            &mut conn,
            &run.id,
            ProposalVerb::Create,
            ProposalPayload::Task { title: format!("task {i}"), description: None, priority: None },
            None,
            None,
            ProposalProvenance::NONE,
        )
        .unwrap();
    }

    let pending = pending_proposals_for_run(&conn, &run.id, 10_000_000).expect("should clamp, not fail");
    assert_eq!(pending.len(), 3, "clamping the limit must not drop real rows below MAX_LIMIT");
}

// Plan 05-06 replaced `accept_proposal`'s old typed "not yet implemented in this plan" error with
// the full verb/target-type matrix — `create`/`criterion` (this test's own original scenario) now
// materialises successfully (see `packages/core/tests/authoring_proposal.rs`, the plan's own test
// file, for that coverage). This test is repointed at a combination the matrix still genuinely
// refuses: a `create`/`criterion` proposal with NO `parent_proposal_id` at all — every drafted
// criterion must hang off a proposed task or epic (D-07), so a parentless one has nowhere to
// materialise and returns a typed error naming exactly that, never a silent no-op.
#[test]
fn accepting_a_parentless_criterion_proposal_returns_a_typed_error_not_a_silent_no_op() {
    with_scratch_runtime_dir(|| accepting_a_parentless_criterion_proposal_returns_a_typed_error_not_a_silent_no_op_body());
}

fn accepting_a_parentless_criterion_proposal_returns_a_typed_error_not_a_silent_no_op_body() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id).unwrap();
    advance_stage(&mut conn, &run.id, &human_actor_id).unwrap();

    let proposal = create_proposal(
        &mut conn,
        &run.id,
        ProposalVerb::Create,
        ProposalPayload::Criterion { statement: "Returns an error for an empty title".to_string(), verification_hint: None },
        None,
        None,
        ProposalProvenance::NONE,
    )
    .unwrap();

    let err = accept_proposal(&mut conn, &proposal.id, &human_actor_id)
        .expect_err("a parentless criterion proposal has nowhere to materialise");
    assert!(err.to_string().contains("parent_proposal_id"), "{err}");
}

// --- Assumption-delta invariant (a): the CHECK rejects a row carrying both ids. ---

#[test]
fn agent_runs_check_rejects_a_row_carrying_both_task_id_and_epic_id() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let system = system_actor(&conn).unwrap();

    let real_task =
        core::domain::task::create_task(&mut conn, &project.id, &human_actor_id, "Real task", None)
            .unwrap();

    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, config, enabled, last_fired_at, created_by, created_at) \
             VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
            params![core::ids::new_id(), project.id, real_task.id, human_actor_id, "2026-01-01T00:00:00Z"],
            |row| row.get(0),
        )
        .unwrap();

    let epic = core::domain::epic::create_epic(&mut conn, &project.id, &human_actor_id, "An epic", None)
        .unwrap();

    let result = conn.execute(
        "INSERT INTO agent_runs (
            id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id, status,
            external_session_id, permission_mode, cost_usd, tokens_in, tokens_out, log_path,
            started_at, ended_at, authoring_stage
        ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'claude_code', ?6, 'running', NULL, 'default', NULL, NULL, NULL, '/tmp/x.jsonl', ?7, NULL, NULL)",
        params![
            core::ids::new_id(),
            real_task.id,
            epic.id,
            project.id,
            trigger_id,
            system.id,
            "2026-01-01T00:00:00Z",
        ],
    );
    assert!(
        result.is_err(),
        "inserting an agent_runs row with BOTH task_id and epic_id set must be rejected by the schema CHECK"
    );
}

// --- Assumption-delta invariant (b): no call site outside run_subject's own module reads
// `agent_runs.task_id` as a qualified SQL literal. ---

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

fn rust_sources_under(dir: &Path) -> Vec<(PathBuf, String)> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        let entries = std::fs::read_dir(dir).unwrap_or_else(|e| panic!("failed to read {dir:?}: {e}"));
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| e == "rs") {
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

const QUALIFIED_LITERAL: &str = "agent_runs.task_id";

#[test]
fn no_call_site_outside_agent_run_module_reads_agent_runs_task_id_as_a_qualified_literal() {
    let root = workspace_root();
    let core_src = root.join("packages/core/src");
    let desktop_src = root.join("packages/desktop/src-tauri/src");
    // `domain::agent_run`'s own module (this decision's `run_subject`) is the one place this
    // qualified form may legitimately appear (in prose or in a future qualified read).
    let exempt = core_src.join("domain/agent_run.rs");

    let mut offenders = Vec::new();
    for (path, body) in rust_sources_under(&core_src).into_iter().chain(rust_sources_under(&desktop_src)) {
        if path == exempt {
            continue;
        }
        for (n, line) in body.lines().enumerate() {
            if !is_whole_line_comment(line) && line.contains(QUALIFIED_LITERAL) {
                offenders.push(format!("{}:{}: {}", path.display(), n + 1, line.trim()));
            }
        }
    }
    assert!(
        offenders.is_empty(),
        "a call site outside domain::agent_run reads the qualified literal {QUALIFIED_LITERAL:?} — \
         route through domain::agent_run::run_subject instead. Offending lines:\n  {}",
        offenders.join("\n  ")
    );
}

#[test]
fn the_gate_detects_the_shape_it_exists_to_catch() {
    let shipped = "        \"SELECT agent_runs.task_id FROM agent_runs WHERE id = ?1\",";
    let fine = "        \"SELECT task_id FROM agent_runs WHERE id = ?1\",";
    assert!(shipped.contains(QUALIFIED_LITERAL));
    assert!(!fine.contains(QUALIFIED_LITERAL));
}
