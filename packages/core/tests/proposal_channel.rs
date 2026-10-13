//! Plan 06-01 (PROP-01/PROP-02/PROP-07, D-97/D-98/D-99): the end-to-end proposal-channel
//! tracer — an ORDINARY task-execution run's `proposal_created` event stages one `pending`
//! `authoring_proposals` row carrying its rationale and a server-resolved turn pointer, and no
//! canonical row exists until a human accepts it. Mirrors `authoring_proposal.rs`'s own fixture
//! discipline, but seeds a task-EXECUTION `agent_runs` row directly via SQL (no worktree, no real
//! git repo) rather than `start_authoring_run` — this plan's own tracer never touches an
//! authoring session at all.

mod common;

use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{accept_proposal, apply_proposal_created, ProposalOutcome};
use core::domain::task::create_task;
use core::ids::new_id;
use core::session_log::{count_lines, session_log_path};
use rusqlite::{params, Connection};
use std::fs;

/// Serializes every test in this file that touches `FLYWHEEL_APP_DATA_DIR` (`session_log`'s own
/// resolution seam) — mirrors `authoring_proposal.rs`'s own `RUNTIME_DIR_ENV_LOCK` precedent,
/// applied here to the sibling env var `session_log_path` resolves through.
static APP_DATA_DIR_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_app_data_dir<T>(f: impl FnOnce() -> T) -> T {
    let _guard = APP_DATA_DIR_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch app-data dir");
    // SAFETY: the mutex above serializes every caller in this binary.
    unsafe { std::env::set_var("FLYWHEEL_APP_DATA_DIR", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_APP_DATA_DIR") };
    result
}

/// Seed a project, one task, and a RUNNING task-execution `agent_runs` row scoped to that task
/// with NO epic — the ordinary shape a `propose_item` call's staging event arrives against.
/// Inserted directly via SQL (mirrors `recovery_statuses.rs`'s own `insert_trigger`/
/// `insert_agent_run` helpers) rather than `start_agent_run`, which requires a real worktree/git
/// repo this test has no need for.
fn seeded_execution_run() -> (Connection, String, String, String, String) {
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
        params![
            run_id,
            task.id,
            project.id,
            trigger_id,
            agent_actor,
            format!("/tmp/log-{run_id}.jsonl"),
            now,
        ],
    )
    .expect("failed to insert fixture agent_run");

    (conn, human_actor_id, project.id, task.id, run_id)
}

fn count_tasks(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM tasks", [], |row| row.get(0)).unwrap()
}
fn count_epics(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM epics", [], |row| row.get(0)).unwrap()
}
fn count_issues(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM issues", [], |row| row.get(0)).unwrap()
}
fn count_criteria(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM acceptance_criteria", [], |row| row.get(0)).unwrap()
}

fn task_create_event(run_id: &str, title: &str, rationale: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "create",
        "targetType": "task",
        "payload": { "kind": "task", "title": title, "description": null },
        "rationale": rationale,
    })
}

#[test]
fn an_execution_run_proposal_stages_one_pending_row_and_no_canonical_row_then_accept_mints_exactly_one_task(
) {
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, project_id, _task_id, run_id) = seeded_execution_run();
        let tasks_before = count_tasks(&conn);
        let epics_before = count_epics(&conn);
        let issues_before = count_issues(&conn);
        let criteria_before = count_criteria(&conn);

        let event = task_create_event(&run_id, "Retry budget ignores the configured value", "Found while executing an unrelated task");
        let outcome = apply_proposal_created(&mut conn, &event).expect("apply_proposal_created should succeed");

        let ProposalOutcome::Created(proposal) = outcome else {
            panic!("expected ProposalOutcome::Created, got {outcome:?}");
        };
        assert_eq!(proposal.status, "pending");
        assert_eq!(proposal.project_id, project_id);
        assert_eq!(proposal.created_by, agent_actor_id(&conn).unwrap());
        assert_eq!(proposal.rationale.as_deref(), Some("Found while executing an unrelated task"));
        assert!(proposal.origin_log_offset.is_some(), "expected a resolved origin_log_offset");
        assert_eq!(proposal.duplicate_of, None);
        assert_eq!(proposal.duplicate_score, None);

        assert_eq!(count_tasks(&conn), tasks_before, "staging must create no canonical task row");
        assert_eq!(count_epics(&conn), epics_before, "staging must create no canonical epic row");
        assert_eq!(count_issues(&conn), issues_before, "staging must create no canonical issue row");
        assert_eq!(count_criteria(&conn), criteria_before, "staging must create no acceptance_criteria row");

        let accept_outcome =
            accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept_proposal should succeed");
        assert_eq!(count_tasks(&conn), tasks_before + 1, "accepting must mint exactly one new task");
        assert_eq!(accept_outcome.proposal.status, "accepted");
        assert!(accept_outcome.proposal.materialised_id.is_some());
    });
}

#[test]
fn two_byte_identical_proposal_created_events_stage_two_separate_rows_with_different_ids() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        let event = task_create_event(&run_id, "Duplicate finding", "Same rationale both times");

        let ProposalOutcome::Created(first) =
            apply_proposal_created(&mut conn, &event).expect("first call should succeed")
        else {
            panic!("expected Created");
        };
        let ProposalOutcome::Created(second) =
            apply_proposal_created(&mut conn, &event).expect("second call should succeed")
        else {
            panic!("expected Created");
        };

        assert_ne!(first.id, second.id, "two identical-content calls must stage two distinct rows");
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1", params![run_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 2);
    });
}

// Note: whitespace-only-but-not-empty title/rationale refusal is a `buildProposeItemPayload`
// (sidecar, `.trim()`-then-check) contract — proved by `propose-item-wire.test.mjs`, not here.
// This event-application layer (`apply_proposal_created` -> `validate_payload`) checks raw
// emptiness only, matching the identical pre-existing behavior every other proposal target type
// already has (`validate_payload`'s `Task`/`Epic`/`Criterion`/`Assumption` arms never trimmed
// either) — a truly empty title is Ignored here; a whitespace-only one is a client-side refusal.
#[test]
fn an_event_with_an_empty_title_is_ignored_and_stages_no_row() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        let event = task_create_event(&run_id, "", "some rationale");
        let outcome = apply_proposal_created(&mut conn, &event).expect("should not error, only ignore");
        assert_eq!(outcome, ProposalOutcome::Ignored, "an empty title must be ignored");

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1", params![run_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "no row should be staged for an ignored event");
    });
}

#[test]
fn an_event_with_an_empty_or_whitespace_only_rationale_stages_no_row() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        for bad_rationale in ["", "   "] {
            let event = task_create_event(&run_id, "A fine title", bad_rationale);
            let result = apply_proposal_created(&mut conn, &event);
            // A rationale failing validation surfaces as a hard error from create_proposal_in_tx
            // (T-06-02's own guard), not a silent Ignored — either way, no row is staged.
            let _ = result;
        }
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1", params![run_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 0, "no row should be staged for an empty/whitespace rationale");
    });
}

#[test]
fn a_run_whose_session_log_has_no_lines_yet_records_origin_log_offset_zero_and_accept_still_works() {
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();

        // Confirm the fixture's premise: no session log file exists for this fresh run id yet.
        assert_eq!(count_lines(&run_id).unwrap(), 0);

        let event = task_create_event(&run_id, "First finding of a quiet run", "Nothing logged yet");
        let ProposalOutcome::Created(proposal) =
            apply_proposal_created(&mut conn, &event).expect("apply_proposal_created should succeed")
        else {
            panic!("expected Created");
        };
        assert_eq!(proposal.origin_log_offset, Some(0), "a run with no log lines must record offset 0, not None");

        let accept_outcome = accept_proposal(&mut conn, &proposal.id, &human_actor_id).expect("accept should succeed");
        assert!(accept_outcome.proposal.materialised_id.is_some());

        // Cleanup: session_log_path resolves under the scratch FLYWHEEL_APP_DATA_DIR this closure
        // set, so nothing leaks into a real developer machine's app-data directory.
        let _ = fs::remove_file(session_log_path(&run_id).unwrap());
    });
}

#[test]
fn two_rows_created_in_the_same_instant_from_one_run_are_read_back_ordered_created_at_desc_id_desc() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        let event_a = task_create_event(&run_id, "Finding A", "rationale A");
        let event_b = task_create_event(&run_id, "Finding B", "rationale B");

        let ProposalOutcome::Created(first) = apply_proposal_created(&mut conn, &event_a).unwrap() else {
            panic!("expected Created");
        };
        let ProposalOutcome::Created(second) = apply_proposal_created(&mut conn, &event_b).unwrap() else {
            panic!("expected Created");
        };

        let ids: Vec<String> = conn
            .prepare(
                "SELECT id FROM authoring_proposals WHERE agent_run_id = ?1 \
                 ORDER BY created_at DESC, id DESC",
            )
            .unwrap()
            .query_map(params![run_id], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        // Both rows share the same `created_at` timestamp in practice (staged within the same
        // test, same second-resolution RFC3339 clock read) — with created_at tied, the ORDER BY's
        // secondary key (`id DESC`) is what makes the order deterministic, and greater ULID means
        // later-minted (monotonic within the same millisecond, per `ids::new_id`'s own contract).
        assert_eq!(ids.len(), 2);
        if first.created_at == second.created_at {
            let expected_first = if first.id > second.id { &first.id } else { &second.id };
            assert_eq!(&ids[0], expected_first);
        }
    });
}
