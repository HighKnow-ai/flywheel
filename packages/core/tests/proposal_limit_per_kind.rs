//! Plan 13-11 (DRFT-09, F1): the per-run proposal cap was argued for EXECUTION runs (D-109) and
//! applies to authoring runs by accident, where a legitimate decomposition routinely exceeds it,
//! and its refusal tells the agent to call `report_summary`, a tool an authoring session does not
//! have. This file first REPRODUCES that defect against the unfixed code (an 11-proposal authoring
//! fixture), so F1 is confirmed by execution rather than by reading.
//!
//! Self-contained per this repo's source-gate-file precedent: the fixtures below are copied from
//! `authoring_proposal.rs` (the authoring run) and `proposal_limit.rs` (the execution run).

mod common;

use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    apply_proposal_created, create_proposal, ProposalOutcome, ProposalPayload, ProposalProvenance,
    ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};

static RUNTIME_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
static APP_DATA_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_dirs<T>(f: impl FnOnce() -> T) -> T {
    let _runtime = RUNTIME_DIR_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let _app = APP_DATA_DIR_ENV_LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let runtime = tempfile::tempdir().expect("failed to create scratch runtime dir");
    let app = tempfile::tempdir().expect("failed to create scratch app-data dir");
    // SAFETY: both mutexes above serialize every caller in this binary.
    unsafe {
        std::env::set_var("FLYWHEEL_RUNTIME_DIR", runtime.path());
        std::env::set_var("FLYWHEEL_APP_DATA_DIR", app.path());
    }
    let result = f();
    unsafe {
        std::env::remove_var("FLYWHEEL_RUNTIME_DIR");
        std::env::remove_var("FLYWHEEL_APP_DATA_DIR");
    }
    result
}

/// An authoring run already advanced past `challenge` into `decompose`.
fn ready_authoring_run() -> (Connection, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
        .expect("start_authoring_run should succeed");
    advance_stage(&mut conn, &run.id, &human_actor_id).expect("advance_stage should succeed");
    (conn, run.id)
}

/// One RUNNING task-execution `agent_runs` row written directly (no worktree needed).
fn seeded_execution_run() -> (Connection, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &human_actor_id, "Investigate the flaky test", None)
        .expect("create_task should succeed");
    let agent_actor = agent_actor_id(&conn).expect("seeded agent actor should exist");
    let now = "2026-01-01T00:00:00Z";
    let trigger_id: String = conn
        .query_row(
            "INSERT INTO triggers (
                id, project_id, target_task_id, target_epic_id, source, config, enabled,
                last_fired_at, created_by, created_at
            ) VALUES (?1, ?2, ?3, NULL, 'user_action', NULL, 1, NULL, ?4, ?5) RETURNING id",
            params![new_id(), project.id, task.id, human_actor_id, now],
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
        params![run_id, task.id, project.id, trigger_id, agent_actor, format!("/tmp/log-{run_id}.jsonl"), now],
    )
    .expect("failed to insert fixture agent_run");
    (conn, run_id)
}

fn stage(conn: &mut Connection, run_id: &str, i: usize, rationale: Option<&str>) -> anyhow::Result<()> {
    create_proposal(
        conn,
        run_id,
        ProposalVerb::Create,
        ProposalPayload::Task { title: format!("Task {i}"), description: None, priority: None },
        None,
        None,
        ProposalProvenance { rationale: rationale.map(str::to_string), origin_log_offset: None },
    )
    .map(|_| ())
}

fn task_create_event(run_id: &str, title: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "create",
        "targetType": "task",
        "payload": { "kind": "task", "title": title, "description": null },
        "rationale": "because",
    })
}

fn row_count(conn: &Connection, run_id: &str) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1", params![run_id], |r| r.get(0))
        .unwrap()
}

fn refusal_event_payloads(conn: &Connection, run_id: &str) -> Vec<serde_json::Value> {
    let mut stmt = conn
        .prepare("SELECT payload FROM events WHERE stream_id = ?1 AND event_type = 'proposal.limit_exhausted' ORDER BY rowid")
        .unwrap();
    stmt.query_map(params![run_id], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|p| serde_json::from_str(&p.unwrap()).unwrap())
        .collect()
}

// --- F1: pre-fix reproduction ------------------------------------------------------------------

/// PRE-FIX REPRODUCTION. An authoring run is throttled at the execution-run cap of ten, and the
/// refusal tells it to call a tool it does not have. The two defect assertions below are marked so
/// plan 13-11 Task 4 inverts them in place rather than deleting them.
#[test]
fn f1_an_authoring_run_is_throttled_at_ten_proposals() {
    with_scratch_dirs(|| {
        let (mut conn, run_id) = ready_authoring_run();
        for i in 0..10 {
            stage(&mut conn, &run_id, i, None).unwrap_or_else(|e| panic!("proposal {i} should stage: {e:#}"));
        }
        assert_eq!(row_count(&conn, &run_id), 10);

        // The refusal text a direct caller of `create_proposal` is handed.
        let refusal = stage(&mut conn, &run_id, 10, None).expect_err("the 11th authoring proposal is refused");
        let refusal_text = format!("{refusal:#}");
        println!("OBSERVED create_proposal refusal text: {refusal_text}");

        // The outcome the IPC door sees for the same attempt.
        let outcome = apply_proposal_created(&mut conn, &task_create_event(&run_id, "Task 11 via the door")).unwrap();
        println!("OBSERVED apply_proposal_created outcome: {outcome:?}");
        let ProposalOutcome::LimitExhausted { limit, count } = outcome else {
            panic!("the 11th attempt must be LimitExhausted, got {outcome:?}");
        };
        assert_eq!(count, 10);
        assert_eq!(row_count(&conn, &run_id), 10, "a refusal inserts no row");

        let events = refusal_event_payloads(&conn, &run_id);
        println!("OBSERVED refusal event payloads: {events:?}");
        assert_eq!(events.len(), 2, "one event per refusal, never a silent drop");

        // PRE-FIX REPRODUCTION, defect 1 (F1): the refusal names a tool an authoring session lacks.
        assert!(
            refusal_text.contains("report_summary"),
            "PRE-FIX REPRODUCTION (defect 1): an authoring run is told to call report_summary"
        );
        // PRE-FIX REPRODUCTION, defect 2 (F1): the limit is ten whatever the run's kind.
        assert_eq!(limit, 10, "PRE-FIX REPRODUCTION (defect 2): an authoring run is capped at the execution value");
    });
}

/// D-109's own case, and the behaviour that must NOT change: an execution run holds ten and is
/// refused the eleventh.
#[test]
fn an_execution_run_is_capped_at_ten() {
    with_scratch_dirs(|| {
        let (mut conn, run_id) = seeded_execution_run();
        for i in 0..10 {
            stage(&mut conn, &run_id, i, Some("because"))
                .unwrap_or_else(|e| panic!("proposal {i} should stage: {e:#}"));
        }
        assert_eq!(row_count(&conn, &run_id), 10);
        let refusal = stage(&mut conn, &run_id, 10, Some("because")).expect_err("the 11th execution proposal is refused");
        let refusal_text = format!("{refusal:#}");
        println!("OBSERVED execution refusal text: {refusal_text}");
        assert!(refusal_text.contains("report_summary"), "an execution session genuinely has that tool");
        assert_eq!(row_count(&conn, &run_id), 10, "a refusal inserts no row");
    });
}
