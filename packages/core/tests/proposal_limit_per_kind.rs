//! Plan 13-11 (DRFT-09, F1): the per-run proposal cap was argued for EXECUTION runs (D-109) and
//! applied to authoring runs by accident, where a legitimate decomposition routinely exceeds it,
//! and its refusal told the agent to call `report_summary`, a tool an authoring session does not
//! have. Task 2 first REPRODUCED that defect against the unfixed code (an 11-proposal authoring
//! fixture), so F1 was confirmed by execution rather than by reading; Task 4 inverted the two
//! defect assertions in place (see `f1_an_authoring_run_is_not_throttled_at_ten_proposals`) and
//! added the per-kind boundary, refusal-text, event and notice tests.
//!
//! Self-contained per this repo's source-gate-file precedent: the fixtures below are copied from
//! `authoring_proposal.rs` (the authoring run), `proposal_limit.rs` (the execution run) and
//! `run_kind.rs` (the planning run).

mod common;

use core::domain::agent_run::{agent_actor_id, RunKind};
use core::domain::authoring_proposal::{
    apply_proposal_created, create_proposal, proposal_limit, proposal_limit_refusal,
    ProposalOutcome, ProposalPayload, ProposalProvenance, ProposalVerb,
};
use core::domain::authoring_session::{advance_stage, start_authoring_run};
use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::authoring::proposal_limit_notices;
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

/// One RUNNING planning `agent_runs` row (epic-scoped, no task, no stage) written directly. No tool
/// lets a planning run stage a proposal today, but the domain function takes any run id, so the cap
/// has to hold for the kind regardless.
fn seeded_planning_run() -> (Connection, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &human_actor_id, "Epic", None).expect("create_epic should succeed");
    let agent_actor = agent_actor_id(&conn).expect("seeded agent actor should exist");
    let trigger_id = new_id();
    conn.execute(
        "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, created_by, created_at)
         VALUES (?1, ?2, NULL, ?3, 'user_action', ?4, 'now')",
        params![trigger_id, project.id, epic.id, human_actor_id],
    )
    .expect("failed to insert fixture trigger");
    let run_id = new_id();
    conn.execute(
        "INSERT INTO agent_runs (id, task_id, epic_id, project_id, trigger_id, actor_id, status, permission_mode, log_path, started_at, authoring_stage)
         VALUES (?1, NULL, ?2, ?3, ?4, ?5, 'running', 'default', ?6, 'now', NULL)",
        params![run_id, epic.id, project.id, trigger_id, agent_actor, format!("/tmp/log-{run_id}.jsonl")],
    )
    .expect("failed to insert fixture planning run");
    (conn, run_id)
}

fn fixture_for(kind: RunKind) -> (Connection, String) {
    match kind {
        RunKind::Execution => seeded_execution_run(),
        RunKind::Planning => seeded_planning_run(),
        RunKind::Authoring => ready_authoring_run(),
    }
}

fn rationale_for(kind: RunKind) -> Option<&'static str> {
    (kind == RunKind::Execution).then_some("because")
}

fn stage_n(conn: &mut Connection, run_id: &str, kind: RunKind, how_many: usize) {
    for i in 0..how_many {
        stage(conn, run_id, i, rationale_for(kind)).unwrap_or_else(|e| panic!("proposal {i} should stage: {e:#}"));
    }
}

fn project_of(conn: &Connection, run_id: &str) -> String {
    conn.query_row("SELECT project_id FROM agent_runs WHERE id = ?1", params![run_id], |r| r.get(0)).unwrap()
}

const ALL_KINDS: [RunKind; 3] = [RunKind::Execution, RunKind::Planning, RunKind::Authoring];

// The values are compile-time constants selected by a `const fn` (owner decision, 2026-10-15) --
// asserting them in a const context proves that, not merely that they are right at runtime.
const _: () = assert!(proposal_limit(RunKind::Execution) == 10);
const _: () = assert!(proposal_limit(RunKind::Planning) == 30);
const _: () = assert!(proposal_limit(RunKind::Authoring) == 60);

// --- F1: the inverted pre-fix reproduction --------------------------------------------------------

/// Task 2 pinned the defect: an authoring run was refused its 11th proposal, with a refusal naming
/// `report_summary` and a reported limit of 10. Both facts are inverted here, in place.
#[test]
fn f1_an_authoring_run_is_not_throttled_at_ten_proposals() {
    with_scratch_dirs(|| {
        let (mut conn, run_id) = ready_authoring_run();
        stage_n(&mut conn, &run_id, RunKind::Authoring, 10);
        assert_eq!(row_count(&conn, &run_id), 10);

        // Inverted defect 1: the 11th used to be refused. It now stages.
        stage(&mut conn, &run_id, 10, None).expect("the 11th authoring proposal is no longer refused");
        let outcome = apply_proposal_created(&mut conn, &task_create_event(&run_id, "Task 12 via the door")).unwrap();
        assert!(matches!(outcome, ProposalOutcome::Created(_)), "the 12th also stages, got {outcome:?}");
        assert_eq!(row_count(&conn, &run_id), 12);

        // Inverted defect 2: the limit an authoring refusal reports is the authoring value, not 10.
        stage_n_from(&mut conn, &run_id, 12, 60);
        let refused = apply_proposal_created(&mut conn, &task_create_event(&run_id, "one past the cap")).unwrap();
        assert_eq!(refused, ProposalOutcome::LimitExhausted { limit: 60, count: 60 });
        assert_ne!(proposal_limit(RunKind::Authoring), proposal_limit(RunKind::Execution));
    });
}

/// The one real datum behind the authoring value: a 42-draft decomposition happened. It must stage
/// in full (criterion 6, T-13-53).
#[test]
fn a_42_draft_decomposition_stages_in_full() {
    with_scratch_dirs(|| {
        let (mut conn, run_id) = ready_authoring_run();
        stage_n(&mut conn, &run_id, RunKind::Authoring, 42);
        assert_eq!(row_count(&conn, &run_id), 42);
        assert!(refusal_event_payloads(&conn, &run_id).is_empty(), "nothing was refused");
    });
}

fn stage_n_from(conn: &mut Connection, run_id: &str, from: usize, to: usize) {
    for i in from..to {
        stage(conn, run_id, i, None).unwrap_or_else(|e| panic!("proposal {i} should stage: {e:#}"));
    }
}

// --- the boundary, per kind ---------------------------------------------------------------------

/// One step below the cap succeeds, exactly the cap succeeds, one past it is refused -- and the row
/// count never exceeds the cap (precision edge: an integer `>=` against an in-transaction COUNT).
fn assert_boundary(kind: RunKind, cap: usize) {
    with_scratch_dirs(|| {
        let (mut conn, run_id) = fixture_for(kind);
        assert_eq!(proposal_limit(kind), cap);

        stage_n(&mut conn, &run_id, kind, cap - 1);
        assert_eq!(row_count(&conn, &run_id), (cap - 1) as i64, "{kind:?}: one below the cap stages");

        stage(&mut conn, &run_id, cap - 1, rationale_for(kind))
            .unwrap_or_else(|e| panic!("{kind:?}: the proposal at exactly the cap must stage: {e:#}"));
        assert_eq!(row_count(&conn, &run_id), cap as i64);

        stage(&mut conn, &run_id, cap, rationale_for(kind)).expect_err("one past the cap is refused");
        assert_eq!(row_count(&conn, &run_id), cap as i64, "{kind:?}: a refusal inserts no row");
        let outcome = apply_proposal_created(&mut conn, &task_create_event(&run_id, "again")).unwrap();
        assert_eq!(outcome, ProposalOutcome::LimitExhausted { limit: cap, count: cap as i64 });
        assert_eq!(row_count(&conn, &run_id), cap as i64, "{kind:?}: the row count never exceeds the cap");
    });
}

/// D-109's own case, and the behaviour that must NOT change: an execution run holds ten.
#[test]
fn an_execution_run_is_capped_at_ten() {
    assert_boundary(RunKind::Execution, 10);
}

#[test]
fn a_planning_run_is_capped_at_thirty() {
    assert_boundary(RunKind::Planning, 30);
}

#[test]
fn an_authoring_run_is_capped_at_sixty() {
    assert_boundary(RunKind::Authoring, 60);
}

#[test]
fn the_caps_are_ordered_by_kind_and_the_execution_value_is_d_109s() {
    assert_eq!(proposal_limit(RunKind::Execution), core::domain::authoring_proposal::PROPOSAL_LIMIT_PER_EXECUTION_RUN);
    assert_eq!(core::domain::authoring_proposal::PROPOSAL_LIMIT_PER_EXECUTION_RUN, 10);
    assert!(proposal_limit(RunKind::Execution) < proposal_limit(RunKind::Planning));
    assert!(proposal_limit(RunKind::Planning) < proposal_limit(RunKind::Authoring));
}

// --- the refusal text, per kind -----------------------------------------------------------------

fn refusal_text_at_cap(kind: RunKind) -> (String, String) {
    with_scratch_dirs(|| {
        let (mut conn, run_id) = fixture_for(kind);
        stage_n(&mut conn, &run_id, kind, proposal_limit(kind));
        let refusal = stage(&mut conn, &run_id, proposal_limit(kind), rationale_for(kind)).expect_err("refused");
        (run_id, format!("{refusal:#}"))
    })
}

#[test]
fn an_execution_refusal_is_byte_identical_to_today_and_keeps_report_summary() {
    let (run_id, text) = refusal_text_at_cap(RunKind::Execution);
    assert_eq!(
        text,
        format!(
            "run {run_id:?} has already staged 10 of 10 allowed proposals — this one was NOT staged; \
             call report_summary and put it in the remains field instead"
        )
    );
}

#[test]
fn an_authoring_refusal_does_not_name_the_execution_only_tool() {
    let (run_id, text) = refusal_text_at_cap(RunKind::Authoring);
    assert!(!text.contains("report_summary"), "an authoring session has no such tool: {text}");
    assert!(text.contains("NOT staged"), "it must say the proposal was not staged: {text}");
    assert!(text.contains("60 of 60"), "it must say how many are staged against the limit: {text}");
    assert!(text.contains(&format!("{run_id:?}")));
    assert!(text.ends_with(proposal_limit_refusal(RunKind::Authoring)), "the clause has one source: {text}");
}

/// Owner decision 2026-10-15: planning gets its cap value but NO bespoke sentence -- a planning
/// sentence would be unreachable through any shipped tool (the sidecar pre-approves only
/// `submit_plan` for planning runs), so it refuses generically: it says what happened and names no
/// capability the session might lack.
#[test]
fn a_planning_refusal_is_generic_and_names_no_tool() {
    let (_, text) = refusal_text_at_cap(RunKind::Planning);
    for tool in ["report_summary", "propose_", "submit_plan", "amend_", "delete_"] {
        assert!(!text.contains(tool), "a generic refusal names no tool ({tool}): {text}");
    }
    assert!(text.contains("NOT staged"), "{text}");
    assert!(text.contains("30 of 30"), "{text}");
    assert!(text.ends_with(proposal_limit_refusal(RunKind::Planning)), "{text}");
    assert_ne!(proposal_limit_refusal(RunKind::Planning), proposal_limit_refusal(RunKind::Execution));
}

#[test]
fn only_the_execution_clause_names_report_summary() {
    assert!(proposal_limit_refusal(RunKind::Execution).contains("report_summary"));
    assert!(!proposal_limit_refusal(RunKind::Authoring).contains("report_summary"));
    assert!(!proposal_limit_refusal(RunKind::Planning).contains("report_summary"));
}

// --- the refusal is still out loud --------------------------------------------------------------

#[test]
fn each_refusal_appends_exactly_one_event_with_the_target_the_title_and_the_kinds_limit() {
    with_scratch_dirs(|| {
        for kind in ALL_KINDS {
            let (mut conn, run_id) = fixture_for(kind);
            let cap = proposal_limit(kind);
            stage_n(&mut conn, &run_id, kind, cap);

            stage(&mut conn, &run_id, cap, rationale_for(kind)).expect_err("refused");
            let events = refusal_event_payloads(&conn, &run_id);
            assert_eq!(events.len(), 1, "{kind:?}: exactly one event per refusal");
            assert_eq!(events[0]["limit"], serde_json::json!(cap), "{kind:?}");
            assert_eq!(events[0]["count"], serde_json::json!(cap), "{kind:?}");
            assert_eq!(events[0]["targetType"], "task", "{kind:?}");
            assert_eq!(events[0]["title"], format!("Task {cap}"), "{kind:?}");

            apply_proposal_created(&mut conn, &task_create_event(&run_id, "again")).unwrap();
            assert_eq!(refusal_event_payloads(&conn, &run_id).len(), 2, "{kind:?}: the second refusal is not folded");
        }
    });
}

#[test]
fn the_event_label_carries_the_per_kind_sentence() {
    with_scratch_dirs(|| {
        for kind in ALL_KINDS {
            let (mut conn, run_id) = fixture_for(kind);
            stage_n(&mut conn, &run_id, kind, proposal_limit(kind));
            stage(&mut conn, &run_id, proposal_limit(kind), rationale_for(kind)).expect_err("refused");
            let label = refusal_event_payloads(&conn, &run_id)[0]["label"].as_str().unwrap().to_string();
            assert!(label.contains(proposal_limit_refusal(kind)), "{kind:?}: {label}");
            assert_eq!(
                label.contains("report_summary"),
                kind == RunKind::Execution,
                "{kind:?}: only an execution run is told about report_summary: {label}"
            );
        }
    });
}

#[test]
fn the_notice_reports_the_runs_own_kind_specific_limit() {
    with_scratch_dirs(|| {
        for kind in [RunKind::Execution, RunKind::Authoring] {
            let (mut conn, run_id) = fixture_for(kind);
            stage_n(&mut conn, &run_id, kind, proposal_limit(kind));
            apply_proposal_created(&mut conn, &task_create_event(&run_id, "over")).unwrap();
            let notices = proposal_limit_notices(&conn, &project_of(&conn, &run_id), 0).unwrap();
            assert_eq!(notices.len(), 1, "{kind:?}");
            assert_eq!(notices[0].limit, proposal_limit(kind) as i64, "{kind:?}");
        }
    });
}

// --- the edges the classifier adds --------------------------------------------------------------

/// A run that belongs to nothing is a bug to surface (F6), not a run to give the execution cap.
#[test]
fn an_unscoped_run_is_refused_loudly_rather_than_defaulted_to_a_cap() {
    with_scratch_dirs(|| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let agent_actor = agent_actor_id(&conn).unwrap();
        let trigger_id = new_id();
        conn.execute(
            "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, created_by, created_at)
             VALUES (?1, ?2, NULL, NULL, 'user_action', ?3, 'now')",
            params![trigger_id, project.id, human_actor_id],
        )
        .unwrap();
        let run_id = new_id();
        conn.execute(
            "INSERT INTO agent_runs (id, task_id, epic_id, project_id, trigger_id, actor_id, status, permission_mode, log_path, started_at, authoring_stage)
             VALUES (?1, NULL, NULL, ?2, ?3, ?4, 'running', 'default', ?5, 'now', NULL)",
            params![run_id, project.id, trigger_id, agent_actor, format!("/tmp/log-{run_id}.jsonl")],
        )
        .unwrap();

        let err = stage(&mut conn, &run_id, 0, None).expect_err("an unscoped run stages nothing");
        assert!(format!("{err:#}").contains("unscoped"), "{err:#}");
        assert_eq!(row_count(&conn, &run_id), 0);
        assert!(refusal_event_payloads(&conn, &run_id).is_empty(), "this is an error, not a cap refusal");
    });
}

/// The authoring clause must point at something an authoring session can really do, and nothing it
/// cannot: it has no `report_summary`, but it does speak to the developer.
#[test]
fn the_authoring_clause_points_at_the_developer_reply() {
    let clause = proposal_limit_refusal(RunKind::Authoring);
    assert!(clause.contains("reply"), "{clause}");
    assert!(!clause.contains("report_summary") && !clause.contains("remains"), "{clause}");
}
