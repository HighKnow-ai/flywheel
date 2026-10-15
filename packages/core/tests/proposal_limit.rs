//! Plan 06-05 (PROP-05, D-109/D-110/D-111): Task 1 — the fixed, non-configurable
//! `PROPOSAL_LIMIT_PER_EXECUTION_RUN` boundary, the precision property that a refusal never increments the
//! count it is compared against, and the event-per-refusal assertion. Task 2 extends this file
//! with the notice a human reads, re-derived from those events on every read (D-112). Mirrors
//! `proposal_channel.rs`'s own fixture discipline (a task-EXECUTION `agent_runs` row seeded
//! directly via SQL, no worktree needed) — self-contained per this repo's established
//! source-gate-file precedent, rather than importing from a sibling test file.

mod common;

use core::domain::agent_run::agent_actor_id;
use core::domain::authoring_proposal::{
    apply_proposal_created, reject_proposal, ProposalOutcome, PROPOSAL_LIMIT_PER_EXECUTION_RUN,
};
use core::domain::task::create_task;
use core::ids::new_id;
use core::query::authoring::proposal_limit_notices;
use rusqlite::{params, Connection};

/// Serializes every test in this file that touches `FLYWHEEL_APP_DATA_DIR` (`session_log`'s own
/// resolution seam) — mirrors `proposal_channel.rs`'s own `APP_DATA_DIR_ENV_LOCK` precedent.
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

/// Insert one RUNNING task-execution `agent_runs` row scoped to a fresh task under
/// `project_id` — the ordinary shape a `propose_item` call's staging event arrives against.
/// Returns `(task_id, run_id)`. Mirrors `proposal_channel.rs`'s `seeded_execution_run` internals,
/// factored so a SECOND run can be seeded under the SAME project (the "two runs, one project"
/// cases below need this).
fn insert_execution_run(conn: &mut Connection, project_id: &str, human_actor_id: &str, title: &str) -> (String, String) {
    let task =
        create_task(conn, project_id, human_actor_id, title, None).expect("create_task should succeed");
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
        params![
            run_id,
            task.id,
            project_id,
            trigger_id,
            agent_actor,
            format!("/tmp/log-{run_id}.jsonl"),
            now,
        ],
    )
    .expect("failed to insert fixture agent_run");

    (task.id, run_id)
}

/// Seed a fresh project, one task, and one RUNNING task-execution run — the single-run fixture
/// most tests below need.
fn seeded_execution_run() -> (Connection, String, String, String, String) {
    let (mut conn, human_actor_id, project) = common::seeded_project();
    let (task_id, run_id) =
        insert_execution_run(&mut conn, &project.id, &human_actor_id, "Investigate the flaky test");
    (conn, human_actor_id, project.id, task_id, run_id)
}

/// Seed a second RUNNING task-execution run under an ALREADY-open connection's own project —
/// the "two different runs, same project" cases need this.
fn seed_second_run_same_project(conn: &mut Connection, project_id: &str, human_actor_id: &str) -> (String, String) {
    insert_execution_run(conn, project_id, human_actor_id, "A second investigation")
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

fn amend_task_event(run_id: &str, target_id: &str, title: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "amend",
        "targetType": "task",
        "targetId": target_id,
        "payload": { "kind": "task", "title": title, "description": null },
        "rationale": "amend rationale",
    })
}

fn delete_task_event(run_id: &str, target_id: &str) -> serde_json::Value {
    serde_json::json!({
        "type": "proposal_created",
        "runId": run_id,
        "verb": "delete",
        "targetType": "task",
        "targetId": target_id,
        "payload": { "kind": "task", "title": "", "description": null },
        "rationale": "delete rationale",
    })
}

fn count_run_proposals(conn: &Connection, run_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM authoring_proposals WHERE agent_run_id = ?1",
        params![run_id],
        |row| row.get(0),
    )
    .unwrap()
}

fn count_limit_exhausted_events(conn: &Connection, run_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'proposal.limit_exhausted'",
        params![run_id],
        |row| row.get(0),
    )
    .unwrap()
}

// -------------------------------------------------------------------------------------------
// Task 1: the boundary, the precision property, the event-per-refusal assertion.
// -------------------------------------------------------------------------------------------

#[test]
fn proposal_limit_per_run_is_exactly_ten() {
    assert_eq!(PROPOSAL_LIMIT_PER_EXECUTION_RUN, 10);
}

#[test]
fn staging_the_tenth_proposal_succeeds_and_the_run_holds_exactly_ten_rows() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            let event = task_create_event(&run_id, &format!("Finding {i}"), "rationale");
            let outcome = apply_proposal_created(&mut conn, &event).unwrap();
            assert!(
                matches!(outcome, ProposalOutcome::Created(_)),
                "expected Created for proposal {i}, got {outcome:?}"
            );
        }
        assert_eq!(count_run_proposals(&conn, &run_id), PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64);
    });
}

#[test]
fn staging_an_eleventh_proposal_is_refused_and_creates_no_row() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            let event = task_create_event(&run_id, &format!("Finding {i}"), "rationale");
            apply_proposal_created(&mut conn, &event).unwrap();
        }

        let eleventh = task_create_event(&run_id, "The 11th finding", "rationale");
        let outcome = apply_proposal_created(&mut conn, &eleventh).unwrap();
        assert_eq!(
            outcome,
            ProposalOutcome::LimitExhausted {
                limit: PROPOSAL_LIMIT_PER_EXECUTION_RUN,
                count: PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64
            },
            "the 11th attempt must observe a count of exactly {PROPOSAL_LIMIT_PER_EXECUTION_RUN}"
        );
        assert_eq!(
            count_run_proposals(&conn, &run_id),
            PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64,
            "the 11th attempt must create no row"
        );
    });
}

#[test]
fn ten_consecutive_refusals_leave_the_run_at_exactly_ten_rows_and_ten_events() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            let event = task_create_event(&run_id, &format!("Finding {i}"), "rationale");
            apply_proposal_created(&mut conn, &event).unwrap();
        }

        for i in 0..10 {
            let event = task_create_event(&run_id, &format!("Over-limit finding {i}"), "rationale");
            let outcome = apply_proposal_created(&mut conn, &event).unwrap();
            assert!(
                matches!(outcome, ProposalOutcome::LimitExhausted { .. }),
                "attempt {i} should be refused, got {outcome:?}"
            );
        }

        assert_eq!(
            count_run_proposals(&conn, &run_id),
            PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64,
            "ten refusals must never move the row count past the limit"
        );
        assert_eq!(
            count_limit_exhausted_events(&conn, &run_id),
            10,
            "expected exactly 10 limit_exhausted events for 10 refusals — a refusal never increments \
             the row count it is compared against, but it must still leave its own trail"
        );
    });
}

#[test]
fn the_count_includes_every_row_regardless_of_status_or_verb() {
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();

        let mut staged_ids = Vec::new();
        for i in 0..8 {
            let event = task_create_event(&run_id, &format!("Finding {i}"), "rationale");
            let ProposalOutcome::Created(p) = apply_proposal_created(&mut conn, &event).unwrap() else {
                panic!("expected Created");
            };
            staged_ids.push(p.id);
        }

        let placeholder_target = "01PLACEHOLDERTARGETIDAAAAA";
        let ProposalOutcome::Created(_) =
            apply_proposal_created(&mut conn, &amend_task_event(&run_id, placeholder_target, "amended title"))
                .unwrap()
        else {
            panic!("expected Created for the amend-verb proposal");
        };
        let ProposalOutcome::Created(_) =
            apply_proposal_created(&mut conn, &delete_task_event(&run_id, placeholder_target)).unwrap()
        else {
            panic!("expected Created for the delete-verb proposal");
        };

        assert_eq!(count_run_proposals(&conn, &run_id), PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64);

        // Rejecting two of the earlier rows must NOT free the run's budget — the count that
        // matters is "ever staged," never "still pending."
        reject_proposal(&mut conn, &staged_ids[0], &human_actor_id, None).unwrap();
        reject_proposal(&mut conn, &staged_ids[1], &human_actor_id, None).unwrap();

        let eleventh = task_create_event(&run_id, "The 11th finding", "rationale");
        let outcome = apply_proposal_created(&mut conn, &eleventh).unwrap();
        assert_eq!(
            outcome,
            ProposalOutcome::LimitExhausted {
                limit: PROPOSAL_LIMIT_PER_EXECUTION_RUN,
                count: PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64
            },
            "rejecting rows must not lower the observed count"
        );
        assert_eq!(
            count_run_proposals(&conn, &run_id),
            PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64,
            "rejecting two rows must not free the run's budget"
        );
    });
}

#[test]
fn two_different_runs_in_the_same_project_each_get_their_own_budget_of_ten() {
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, project_id, _task_id, run_a) = seeded_execution_run();
        let (_task_b, run_b) = seed_second_run_same_project(&mut conn, &project_id, &human_actor_id);

        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            let event = task_create_event(&run_a, &format!("Run A finding {i}"), "rationale");
            apply_proposal_created(&mut conn, &event).unwrap();
        }
        let refused_a =
            apply_proposal_created(&mut conn, &task_create_event(&run_a, "Run A 11th", "rationale")).unwrap();
        assert!(
            matches!(refused_a, ProposalOutcome::LimitExhausted { .. }),
            "run A must be over budget, got {refused_a:?}"
        );

        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            let event = task_create_event(&run_b, &format!("Run B finding {i}"), "rationale");
            let outcome = apply_proposal_created(&mut conn, &event).unwrap();
            assert!(
                matches!(outcome, ProposalOutcome::Created(_)),
                "run B's own budget must be untouched by run A's, got {outcome:?}"
            );
        }
    });
}

#[test]
fn a_refusal_still_commits_its_limit_exhausted_event() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, _project_id, _task_id, run_id) = seeded_execution_run();
        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            apply_proposal_created(&mut conn, &task_create_event(&run_id, &format!("Finding {i}"), "rationale"))
                .unwrap();
        }
        apply_proposal_created(&mut conn, &task_create_event(&run_id, "Refused finding", "rationale")).unwrap();

        let (event_type, payload_json): (String, String) = conn
            .query_row(
                "SELECT event_type, payload FROM events WHERE stream_id = ?1 \
                 AND event_type = 'proposal.limit_exhausted'",
                params![run_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("expected a committed proposal.limit_exhausted event");
        assert_eq!(event_type, "proposal.limit_exhausted");

        let payload: serde_json::Value = serde_json::from_str(&payload_json).unwrap();
        assert_eq!(payload["limit"], serde_json::json!(PROPOSAL_LIMIT_PER_EXECUTION_RUN));
        assert_eq!(payload["count"], serde_json::json!(PROPOSAL_LIMIT_PER_EXECUTION_RUN));
        assert_eq!(payload["targetType"], serde_json::json!("task"));
        assert_eq!(payload["title"], serde_json::json!("Refused finding"));
    });
}

// -------------------------------------------------------------------------------------------
// Task 2: the notice a human sees, re-derived from the events.
// -------------------------------------------------------------------------------------------

#[test]
fn a_run_with_three_refusals_yields_exactly_one_notice_with_refused_count_three() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, project_id, _task_id, run_id) = seeded_execution_run();
        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            apply_proposal_created(&mut conn, &task_create_event(&run_id, &format!("Finding {i}"), "rationale"))
                .unwrap();
        }
        for i in 0..3 {
            apply_proposal_created(&mut conn, &task_create_event(&run_id, &format!("Refused {i}"), "rationale"))
                .unwrap();
        }

        let notices = proposal_limit_notices(&conn, &project_id, 0).unwrap();
        assert_eq!(notices.len(), 1, "expected exactly one notice for one throttled run");
        let notice = &notices[0];
        assert_eq!(notice.agent_run_id, run_id);
        assert_eq!(notice.refused_count, 3);
        assert_eq!(notice.limit, PROPOSAL_LIMIT_PER_EXECUTION_RUN as i64);
        assert!(
            notice.first_refused_at <= notice.last_refused_at,
            "first_refused_at must not sort after last_refused_at"
        );
    });
}

#[test]
fn two_runs_in_one_project_yield_two_notices() {
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, project_id, _task_id, run_a) = seeded_execution_run();
        let (_task_b, run_b) = seed_second_run_same_project(&mut conn, &project_id, &human_actor_id);

        for run_id in [&run_a, &run_b] {
            for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
                apply_proposal_created(&mut conn, &task_create_event(run_id, &format!("Finding {i}"), "rationale"))
                    .unwrap();
            }
            apply_proposal_created(&mut conn, &task_create_event(run_id, "Refused", "rationale")).unwrap();
        }

        let notices = proposal_limit_notices(&conn, &project_id, 0).unwrap();
        assert_eq!(notices.len(), 2, "expected one notice per throttled run");
    });
}

#[test]
fn a_project_with_no_refusals_yields_an_empty_vector() {
    with_scratch_app_data_dir(|| {
        let (conn, _human_actor_id, project_id, _task_id, _run_id) = seeded_execution_run();
        let notices = proposal_limit_notices(&conn, &project_id, 0).unwrap();
        assert!(notices.is_empty(), "a project with no refusals must yield no notices");
    });
}

#[test]
fn the_notice_read_is_clamped_to_max_limit() {
    with_scratch_app_data_dir(|| {
        let (mut conn, human_actor_id, project_id, _task_id, run_a) = seeded_execution_run();
        let mut run_ids = vec![run_a];
        for _ in 0..3 {
            let (_task_id, run_id) = seed_second_run_same_project(&mut conn, &project_id, &human_actor_id);
            run_ids.push(run_id);
        }
        for run_id in &run_ids {
            for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
                apply_proposal_created(&mut conn, &task_create_event(run_id, &format!("Finding {i}"), "rationale"))
                    .unwrap();
            }
            apply_proposal_created(&mut conn, &task_create_event(run_id, "Refused", "rationale")).unwrap();
        }

        let notices = proposal_limit_notices(&conn, &project_id, 2).unwrap();
        assert_eq!(notices.len(), 2, "a limit of 2 must return at most 2 rows");

        let notices_over_ceiling = proposal_limit_notices(&conn, &project_id, 10_000_000).unwrap();
        assert!(
            notices_over_ceiling.len() <= 500,
            "a caller-supplied limit far past MAX_LIMIT must still clamp, got {}",
            notices_over_ceiling.len()
        );
    });
}

#[test]
fn a_second_call_to_proposal_limit_notices_returns_the_same_values() {
    with_scratch_app_data_dir(|| {
        let (mut conn, _human_actor_id, project_id, _task_id, run_id) = seeded_execution_run();
        for i in 0..PROPOSAL_LIMIT_PER_EXECUTION_RUN {
            apply_proposal_created(&mut conn, &task_create_event(&run_id, &format!("Finding {i}"), "rationale"))
                .unwrap();
        }
        apply_proposal_created(&mut conn, &task_create_event(&run_id, "Refused", "rationale")).unwrap();

        let first = proposal_limit_notices(&conn, &project_id, 0).unwrap();
        let second = proposal_limit_notices(&conn, &project_id, 0).unwrap();
        assert_eq!(first, second, "reading the notice twice must be idempotent");
    });
}
