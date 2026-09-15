//! AGNT-06/D-38's database half: a pending permission request genuinely blocks its run, an
//! answer resolves it exactly once, and an allow-always rule never crosses a project boundary.
//! See `packages/sidecar/test/permission.test.mjs` for the sidecar's own MCP-tool-call half.

mod common;

use core::domain::agent_run::start_agent_run;
use core::domain::permission_request::{answer_request, create_pending_request, AlreadyAnsweredError};
use core::domain::permission_rule::{matching_rule, revoke_rule, rules_for_project, upsert_rule};
use core::domain::project;
use core::domain::task::create_task;
use core::query::permissions::{
    blocked_count_for_project, blocked_task_ids_for_project, latest_run_id_for_task,
    pending_requests_for_run,
};
use rusqlite::Connection;

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — see
/// `stop_lifecycle.rs`'s identical helper and its own doc comment for why: `cargo test` runs a
/// binary's `#[test]` fns concurrently by default, and `FLYWHEEL_WORKTREE_ROOT` is process-global
/// mutable state. Each `tests/*.rs` file compiles to its own binary, so this cannot race with
/// `stop_lifecycle.rs`'s own, separate static.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads
    // or mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// Seed one project with one task and one `running` agent run (via the real `start_agent_run`,
/// exercising the real worktree-creation path exactly as `stop_lifecycle.rs` does) — everything
/// this file's tests need to raise a permission request against a real, referentially-valid
/// `agent_run_id`.
fn seeded_running_run() -> (Connection, String, String, String, String) {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Gated task", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        (conn, actor_id, project.id, task.id, run.id)
    })
}

fn event_count(conn: &Connection, event_type: &str, stream_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE event_type = ?1 AND stream_id = ?2",
        rusqlite::params![event_type, stream_id],
        |row| row.get(0),
    )
    .expect("failed to count events")
}

fn run_status(conn: &Connection, run_id: &str) -> String {
    conn.query_row(
        "SELECT status FROM agent_runs WHERE id = ?1",
        rusqlite::params![run_id],
        |row| row.get(0),
    )
    .expect("agent_runs row should exist")
}

#[test]
fn create_pending_request_blocks_the_run_and_raises_a_labeled_event() {
    let (mut conn, actor_id, _project_id, _task_id, run_id) = seeded_running_run();

    assert_eq!(run_status(&conn, &run_id), "running", "the run must start out running");

    let request = create_pending_request(&mut conn, &run_id, "Bash", Some("{\"command\":\"rm -rf /\"}"), &actor_id, None)
        .expect("create_pending_request should succeed");

    // --- Behavior: the row is pending ---
    assert_eq!(request.status, "pending");
    assert_eq!(request.tool_name, "Bash");

    // --- Behavior: creating a pending request moves its run to blocked, in the same transaction
    // as the row's own insert (read back here — a real second read, not an in-memory return
    // value) ---
    assert_eq!(run_status(&conn, &run_id), "blocked", "creating a pending request must block the run");

    // --- Behavior: a permission_request.raised event carries a human-renderable label ---
    let (event_type, payload): (String, String) = conn
        .query_row(
            "SELECT event_type, payload FROM events WHERE stream_id = ?1",
            rusqlite::params![request.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("a permission_request.raised event should exist");
    assert_eq!(event_type, "permission_request.raised");
    let payload_json: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(
        payload_json["label"].as_str().unwrap(),
        "Bash asked to run",
        "the event payload must carry a human-renderable label"
    );
}

#[test]
fn answer_request_allowed_clears_the_block_and_appends_exactly_one_event() {
    let (mut conn, actor_id, _project_id, _task_id, run_id) = seeded_running_run();
    let request = create_pending_request(&mut conn, &run_id, "Bash", None, &actor_id, None)
        .expect("create_pending_request should succeed");

    let answered = answer_request(&mut conn, &request.id, "allowed", &actor_id)
        .expect("answer_request should succeed on a pending row");

    // --- Behavior: the decision, resolved_by and resolved_at are written ---
    assert_eq!(answered.status, "allowed");
    assert_eq!(answered.resolved_by.as_deref(), Some(actor_id.as_str()));
    assert!(answered.resolved_at.is_some());

    // --- Behavior: the run is cleared back to running, in the same transaction ---
    assert_eq!(run_status(&conn, &run_id), "running", "answering must clear the run's blocked status");

    // --- Behavior: exactly one permission_request.answered event exists ---
    assert_eq!(event_count(&conn, "permission_request.answered", &request.id), 1);
}

#[test]
fn answering_an_already_answered_request_is_refused_and_resolves_nothing_a_second_time() {
    let (mut conn, actor_id, _project_id, _task_id, run_id) = seeded_running_run();
    let request = create_pending_request(&mut conn, &run_id, "Bash", None, &actor_id, None)
        .expect("create_pending_request should succeed");

    answer_request(&mut conn, &request.id, "allowed", &actor_id)
        .expect("the first answer should succeed");

    let second_result = answer_request(&mut conn, &request.id, "denied", &actor_id);
    let second_err = second_result.expect_err("a second answer to an already-answered row must be refused");
    second_err
        .downcast_ref::<AlreadyAnsweredError>()
        .expect("the error must be the typed AlreadyAnsweredError, not a generic failure");

    // --- Behavior: exactly one permission_request.answered event exists after BOTH calls — the
    // once-only property is proven at the event log, not merely by the second call's return
    // value ---
    assert_eq!(
        event_count(&conn, "permission_request.answered", &request.id),
        1,
        "a second answer must append no second event"
    );

    // --- Behavior: the row's decision is still the FIRST answer, never overwritten ---
    let status: String = conn
        .query_row(
            "SELECT status FROM permission_requests WHERE id = ?1",
            rusqlite::params![request.id],
            |row| row.get(0),
        )
        .expect("permission_requests row should exist");
    assert_eq!(status, "allowed", "the second (denying) answer must never overwrite the first");
}

#[test]
fn matching_rule_never_crosses_a_project_boundary() {
    let (mut conn, actor_id, project_a_id, _task_id, _run_id) = seeded_running_run();
    let project_b = project::create_project(&mut conn, &actor_id, "Other Project", "/other-repo", "OTH", "main")
        .expect("create_project should succeed for the second project");

    upsert_rule(&mut conn, &project_a_id, "Bash", "allow", &actor_id)
        .expect("upsert_rule should succeed for project A");

    let rule_a = matching_rule(&conn, &project_a_id, "Bash")
        .expect("matching_rule should succeed")
        .expect("project A must have a matching rule for Bash");
    assert_eq!(rule_a.decision, "allow");

    let rule_b = matching_rule(&conn, &project_b.id, "Bash").expect("matching_rule should succeed");
    assert!(rule_b.is_none(), "a rule granted on project A must never match project B");

    let rule_wrong_tool =
        matching_rule(&conn, &project_a_id, "WebFetch").expect("matching_rule should succeed");
    assert!(rule_wrong_tool.is_none(), "a rule for Bash must never match a different tool");
}

#[test]
fn upsert_rule_called_twice_updates_rather_than_duplicating() {
    let (mut conn, actor_id, project_id, _task_id, _run_id) = seeded_running_run();

    upsert_rule(&mut conn, &project_id, "Bash", "allow", &actor_id)
        .expect("the first upsert_rule call should succeed");
    upsert_rule(&mut conn, &project_id, "Bash", "deny", &actor_id)
        .expect("the second upsert_rule call should succeed");

    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM permission_rules", [], |row| row.get(0))
        .expect("failed to count permission_rules rows");
    assert_eq!(count, 1, "a second upsert_rule for the same (project, tool) must update, not duplicate");

    let rule = matching_rule(&conn, &project_id, "Bash")
        .expect("matching_rule should succeed")
        .expect("the rule should still exist");
    assert_eq!(rule.decision, "deny", "the second call's decision must have overwritten the first's");
}

#[test]
fn revoke_rule_deletes_the_row_and_appends_a_revoked_event() {
    let (mut conn, actor_id, project_id, _task_id, _run_id) = seeded_running_run();
    let rule = upsert_rule(&mut conn, &project_id, "Bash", "allow", &actor_id)
        .expect("upsert_rule should succeed");

    revoke_rule(&mut conn, &rule.id, &actor_id).expect("revoke_rule should succeed");

    let remaining = rules_for_project(&conn, &project_id).expect("rules_for_project should succeed");
    assert!(remaining.is_empty(), "the rule must be gone after revoke_rule");

    assert_eq!(event_count(&conn, "permission_rule.revoked", &rule.id), 1);

    // --- Behavior: revoking an already-revoked (missing) rule id is an idempotent no-op ---
    revoke_rule(&mut conn, &rule.id, &actor_id)
        .expect("revoking a missing rule id must be a harmless no-op");
    assert_eq!(
        event_count(&conn, "permission_rule.revoked", &rule.id),
        1,
        "a no-op revoke must append no second event"
    );
}

#[test]
fn blocked_count_and_ids_reflect_only_tasks_whose_most_recent_run_is_blocked() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();

        // A project with no runs at all reports zero, not an error.
        assert_eq!(
            blocked_count_for_project(&conn, &project.id).expect("blocked_count_for_project should succeed"),
            0
        );
        assert!(blocked_task_ids_for_project(&conn, &project.id)
            .expect("blocked_task_ids_for_project should succeed")
            .is_empty());

        let blocked_task = create_task(&mut conn, &project.id, &actor_id, "Blocked task", None)
            .expect("create_task should succeed");
        let blocked_run = start_agent_run(&mut conn, &blocked_task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        create_pending_request(&mut conn, &blocked_run.id, "Bash", None, &actor_id, None)
            .expect("create_pending_request should succeed");

        let running_task = create_task(&mut conn, &project.id, &actor_id, "Still running task", None)
            .expect("create_task should succeed");
        start_agent_run(&mut conn, &running_task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let count = blocked_count_for_project(&conn, &project.id)
            .expect("blocked_count_for_project should succeed");
        assert_eq!(count, 1, "only the genuinely blocked task's run should count");

        let ids = blocked_task_ids_for_project(&conn, &project.id)
            .expect("blocked_task_ids_for_project should succeed");
        assert_eq!(ids, vec![blocked_task.id.clone()]);
    });
}

#[test]
fn pending_requests_for_run_returns_every_pending_row_in_creation_order() {
    let (mut conn, actor_id, _project_id, _task_id, run_id) = seeded_running_run();

    // A run with no pending requests returns an empty vec, not an error.
    assert!(pending_requests_for_run(&conn, &run_id)
        .expect("pending_requests_for_run should succeed")
        .is_empty());

    let first = create_pending_request(&mut conn, &run_id, "Bash", Some("{\"command\":\"ls\"}"), &actor_id, None)
        .expect("create_pending_request should succeed");
    // Two concurrent held calls (02-05-SUMMARY's own D4) can each raise their own pending row for
    // the SAME run — this query must surface BOTH, not just the latest.
    let second = create_pending_request(&mut conn, &run_id, "Edit", Some("{\"path\":\"a.txt\"}"), &actor_id, None)
        .expect("create_pending_request should succeed");

    let pending = pending_requests_for_run(&conn, &run_id).expect("pending_requests_for_run should succeed");
    assert_eq!(pending.len(), 2, "both concurrent pending requests must be returned");
    assert_eq!(pending[0].id, first.id, "oldest first (creation order)");
    assert_eq!(pending[1].id, second.id);
    assert_eq!(pending[0].tool_name, "Bash");
    assert_eq!(pending[1].tool_name, "Edit");

    // Answering one leaves only the other pending.
    answer_request(&mut conn, &first.id, "allowed", &actor_id).expect("answer_request should succeed");
    let remaining = pending_requests_for_run(&conn, &run_id).expect("pending_requests_for_run should succeed");
    assert_eq!(remaining.len(), 1);
    assert_eq!(remaining[0].id, second.id);
}

#[test]
fn latest_run_id_for_task_resolves_the_most_recently_started_run() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "A task", None)
            .expect("create_task should succeed");

        // A task with no runs yet resolves to None, not an error.
        assert_eq!(
            latest_run_id_for_task(&conn, &task.id).expect("latest_run_id_for_task should succeed"),
            None
        );

        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        assert_eq!(
            latest_run_id_for_task(&conn, &task.id).expect("latest_run_id_for_task should succeed"),
            Some(run.id)
        );
    });
}

#[test]
fn permission_requests_status_outside_the_accepted_set_is_rejected_by_the_schema() {
    let (conn, actor_id, project_id, task_id, run_id) = seeded_running_run();

    let result = conn.execute(
        "INSERT INTO permission_requests (
            id, agent_run_id, task_id, project_id, tool_name, input_payload, status,
            resolved_by, resolved_at, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, 'Bash', NULL, 'maybe', NULL, NULL, ?5, ?6)",
        rusqlite::params![
            core::ids::new_id(),
            run_id,
            task_id,
            project_id,
            actor_id,
            "2026-01-01T00:00:00Z",
        ],
    );
    let err = result.expect_err("an out-of-set status value must be rejected");
    assert!(
        matches!(err, rusqlite::Error::SqliteFailure(_, _)),
        "expected a SQLite constraint failure for status = 'maybe', got {err:?}"
    );
}

#[test]
fn migration_source_list_registers_the_permission_gate_tables_exactly_once() {
    let sources = core::db::migration_sources();
    let request_table_count = sources.iter().filter(|s| s.contains("CREATE TABLE permission_requests")).count();
    let rule_table_count = sources.iter().filter(|s| s.contains("CREATE TABLE permission_rules")).count();
    assert_eq!(request_table_count, 1, "permission_requests must be created by exactly one migration");
    assert_eq!(rule_table_count, 1, "permission_rules must be created by exactly one migration");
}
