//! Plan 05-05 Task 3 (D-89, D-93/D-94, D-87): `advance_stage`'s widened return — the distillation
//! instruction it carries exactly once, when a transition lands on the far side of `challenge` —
//! plus `render_decision_turn`'s own wording, and Task 2's cross-project read-isolation proof
//! (`query::authoring::get_epic_for_agent`), landed here per the plan's own "Task 2 (or a sibling)"
//! instruction rather than a separate file.

mod common;

use core::domain::authoring_session::{
    advance_stage, render_decision_turn, start_authoring_run, AuthoringStage, ProposalDecisionTurn,
};
use core::domain::trigger::create_user_action_trigger;
use core::query::authoring::get_epic_for_agent;
use rusqlite::params;

/// Serializes every call to [`with_scratch_runtime_dir`] in THIS binary — mirrors
/// `authoring_stage.rs`'s own identically-named lock: `advance_stage` writes D-88's runtime
/// marker as part of its own transaction, so every test needs an isolated scratch runtime dir.
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
fn advancing_out_of_challenge_returns_a_distillation_instruction_naming_propose_assumption() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
            .expect("start_authoring_run should succeed");

        let (stage, distillation) = advance_stage(&mut conn, &run.id, &human_actor_id)
            .expect("advance_stage should succeed");
        assert_eq!(stage, AuthoringStage::Decompose);

        let instruction = distillation.expect("advancing out of challenge must return a distillation instruction");
        assert!(
            instruction.text.contains("propose_assumption"),
            "the instruction must name propose_assumption by its exact tool name: {}",
            instruction.text
        );
        assert!(
            instruction.text.to_lowercase().contains("one tool call per assumption") || instruction.text.contains("never a single call carrying a list"),
            "the instruction must state the one-call-per-assumption rule: {}",
            instruction.text
        );
    });
}

#[test]
fn advancing_out_of_decompose_returns_no_distillation_instruction() {
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
            .expect("start_authoring_run should succeed");

        let (stage, _) = advance_stage(&mut conn, &run.id, &human_actor_id).unwrap(); // challenge -> decompose
        assert_eq!(stage, AuthoringStage::Decompose);

        let (stage, distillation) = advance_stage(&mut conn, &run.id, &human_actor_id).unwrap(); // decompose -> criteria
        assert_eq!(stage, AuthoringStage::Criteria);
        assert!(
            distillation.is_none(),
            "advancing out of decompose must not return a distillation instruction"
        );
    });
}

#[test]
fn the_stage_advances_even_though_this_domain_function_never_touches_any_sidecar_handle() {
    // D-90: distillation is a REQUEST, not a precondition. This domain-layer function has no
    // parameter naming a sidecar/adapter/transport at all — delivering the returned instruction
    // as a live `authoring_turn` is entirely the COMMAND layer's job (`commands::authoring::
    // authoring_stage_advance`, outside this crate's own boundary), so `advance_stage` itself
    // can never fail because a sidecar handle is absent: there is no such handle for it to be
    // absent FROM. This test proves that structurally, by calling the function with nothing
    // sidecar-shaped anywhere in scope and asserting the row genuinely moved.
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let run = start_authoring_run(&mut conn, &project.id, None, "default", &human_actor_id)
            .expect("start_authoring_run should succeed");

        let (stage, distillation) = advance_stage(&mut conn, &run.id, &human_actor_id)
            .expect("advance_stage must succeed with no sidecar/adapter/transport in scope");
        assert_eq!(stage, AuthoringStage::Decompose);
        assert!(distillation.is_some());

        let current: Option<String> = conn
            .query_row(
                "SELECT authoring_stage FROM agent_runs WHERE id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(current.as_deref(), Some("decompose"), "the row must have genuinely moved");
    });
}

#[test]
fn a_returned_instruction_is_absent_for_a_run_that_is_not_an_authoring_run() {
    // A task-execution run (task_id present, authoring_stage NULL) is not something advance_stage
    // accepts at all — transition_stage's own ensure!() rejects it BEFORE any instruction could
    // ever be computed, so "the instruction is absent" holds by construction: the whole call is
    // Err, never an Ok carrying None.
    with_scratch_runtime_dir(|| {
        let (mut conn, human_actor_id, project) = common::seeded_project();
        let task = core::domain::task::create_task(
            &mut conn,
            &project.id,
            &human_actor_id,
            "An ordinary task",
            None,
        )
        .expect("create_task should succeed");

        let now = chrono::Utc::now().to_rfc3339();
        let run_id = core::ids::new_id();
        let tx = conn.transaction().unwrap();
        let trigger_id =
            create_user_action_trigger(&tx, &project.id, &task.id, &human_actor_id, &now).unwrap();
        tx.execute(
            "INSERT INTO agent_runs (
                id, worktree_id, task_id, epic_id, project_id, trigger_id, adapter, actor_id,
                status, external_session_id, permission_mode, cost_usd, tokens_in, tokens_out,
                log_path, started_at, ended_at, authoring_stage
            ) VALUES (?1, NULL, ?2, NULL, ?3, ?4, 'claude_code', ?5, 'running', NULL, 'acceptEdits',
                NULL, NULL, NULL, ?6, ?7, NULL, NULL)",
            params![run_id, task.id, project.id, trigger_id, human_actor_id, "sessions/fake.jsonl", now],
        )
        .unwrap();
        tx.commit().unwrap();

        let err = advance_stage(&mut conn, &run_id, &human_actor_id)
            .expect_err("advance_stage must reject a task-execution run");
        assert!(
            err.to_string().contains("not an authoring session"),
            "unexpected error: {err}"
        );
    });
}

#[test]
fn render_decision_turn_states_a_rejection_is_not_a_verdict_and_carries_the_reason() {
    let text = render_decision_turn(&ProposalDecisionTurn::Rejected {
        target_type: "task".to_string(),
        label: "Write the migration guide".to_string(),
        reason: Some("too broad".to_string()),
    });
    assert!(text.contains("Write the migration guide"));
    assert!(text.contains("too broad"));
    assert!(text.to_lowercase().contains("not a verdict") || text.contains("isn't a verdict"));
}

#[test]
fn render_decision_turn_states_an_amendment_is_the_developers_own_text() {
    let text = render_decision_turn(&ProposalDecisionTurn::Amended {
        target_type: "criterion".to_string(),
        original_label: "It works".to_string(),
        new_text: "Logging in with valid credentials redirects to /dashboard".to_string(),
    });
    assert!(text.contains("It works"));
    assert!(text.contains("Logging in with valid credentials redirects to /dashboard"));
    assert!(text.contains("my own text"));
}

#[test]
fn a_read_answered_for_a_run_in_project_a_with_an_epic_id_from_project_b_returns_not_found() {
    // Plan 05-05 Task 2 (T-05-05-03): the cross-project isolation the epic_get read tool depends
    // on — proved directly against the query function `handle_inbound_board_read_request` calls,
    // since the sidecar round trip itself lives in the desktop crate, outside this crate's reach.
    let (conn_a, human_actor_a, project_a) = common::seeded_project();
    let epic_b = {
        let (mut conn_b, human_actor_b, project_b) = common::seeded_project();
        core::domain::epic::create_epic(&mut conn_b, &project_b.id, &human_actor_b, "Epic in project B", None)
            .expect("create_epic should succeed")
    };
    let _ = human_actor_a;

    let result = get_epic_for_agent(&conn_a, &project_a.id, &epic_b.id)
        .expect("get_epic_for_agent should not error for a genuinely absent-scoped epic");
    assert!(
        result.is_none(),
        "an epic_id from another project must read not-found, never the row"
    );
}

#[test]
fn get_epic_for_agent_finds_an_epic_genuinely_scoped_to_the_caller_s_own_project() {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let epic = core::domain::epic::create_epic(&mut conn, &project.id, &human_actor_id, "In-scope epic", None)
        .expect("create_epic should succeed");

    let result = get_epic_for_agent(&conn, &project.id, &epic.id)
        .expect("get_epic_for_agent should succeed");
    let found = result.expect("the epic genuinely belongs to this project and must be found");
    assert_eq!(found.id, epic.id);
    assert_eq!(found.title, "In-scope epic");
}
