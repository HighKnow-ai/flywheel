//! `domain::session_summary::apply_summary_reported` (D-64/D-65, T-04-01, plan 04-06 Task 1) —
//! the inbound `summary_reported` event contract, including every rejection case.

mod common;

use core::context_packet::{assemble_context_packet, render_prompt, REPORT_SUMMARY_TOOL_NAME};
use core::domain::agent_run::{start_agent_run, AgentRun};
use core::domain::project::Project;
use core::domain::session_summary::{
    apply_summary_reported, create_summary, DecisionEntry, SummaryFields, SummaryReportOutcome,
};
use core::domain::task::{create_task, Task};
use core::domain::worktree::ensure_worktree;
use rusqlite::Connection;
use tempfile::TempDir;

// See `tests/context_packet.rs` for why this lock exists: `FLYWHEEL_WORKTREE_ROOT` is
// process-wide state, and `cargo test` runs every `#[test]` fn in this file concurrently on
// separate OS threads by default. This mutex scopes serialisation to this file's own binary.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above — only one test at a time ever has
    // this var set within this binary, and it is always cleared before the lock is released.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

fn seeded_task_and_run() -> (Connection, String, Project, TempDir, Task, AgentRun) {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Summary wire fixture", None)
        .expect("create_task should succeed");
    ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
    let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
        .expect("start_agent_run should succeed");
    (conn, actor_id, project, repo_dir, task, run)
}

fn summary_row_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM session_summaries", [], |row| row.get(0))
        .expect("count query should succeed")
}

#[test]
fn a_valid_event_writes_one_row_and_returns_recorded() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        let event = serde_json::json!({
            "type": "summary_reported",
            "runId": run.id,
            "changedFiles": ["src/lib.rs", "src/main.rs"],
            "changedProse": "Wired the reader-loop branch",
            "remains": "Nothing outstanding",
            "nextSessionMustKnow": "The socket carries a second message kind now",
            "decisions": [{"id": "D1", "statement": "Use the existing socket"}],
            "acknowledgedDecisions": ["D1"],
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        match outcome {
            SummaryReportOutcome::Recorded(id) => assert!(!id.is_empty(), "recorded id must be non-empty"),
            other => panic!("expected Recorded, got {other:?}"),
        }
        assert_eq!(summary_row_count(&conn), 1, "exactly one row must be written");
    });
}

#[test]
fn an_event_of_a_different_type_is_ignored_and_writes_nothing() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        let event = serde_json::json!({
            "type": "git_retry",
            "runId": run.id,
            "changedFiles": [],
            "decisions": [],
            "acknowledgedDecisions": [],
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        assert_eq!(outcome, SummaryReportOutcome::Ignored);
        assert_eq!(summary_row_count(&conn), 0, "a non-matching event type must write nothing");
    });
}

#[test]
fn an_event_with_no_run_id_is_ignored_and_writes_nothing() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, _run) = seeded_task_and_run();

        let event = serde_json::json!({
            "type": "summary_reported",
            "changedFiles": [],
            "decisions": [],
            "acknowledgedDecisions": [],
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        assert_eq!(outcome, SummaryReportOutcome::Ignored);
        assert_eq!(summary_row_count(&conn), 0, "a missing runId must write nothing");
    });
}

#[test]
fn a_non_ulid_run_id_is_ignored_and_writes_nothing() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, _run) = seeded_task_and_run();

        let event = serde_json::json!({
            "type": "summary_reported",
            "runId": "not-a-ulid",
            "changedFiles": [],
            "decisions": [],
            "acknowledgedDecisions": [],
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        assert_eq!(outcome, SummaryReportOutcome::Ignored);
        assert_eq!(summary_row_count(&conn), 0, "a non-ULID runId must write nothing");
    });
}

#[test]
fn a_well_formed_ulid_naming_no_row_returns_unknown_run_and_writes_nothing() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, _run) = seeded_task_and_run();

        // Well-formed 26-char Crockford-base32 shape, but names no agent_runs row.
        let event = serde_json::json!({
            "type": "summary_reported",
            "runId": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
            "changedFiles": [],
            "decisions": [],
            "acknowledgedDecisions": [],
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        assert_eq!(outcome, SummaryReportOutcome::UnknownRun);
        assert_eq!(summary_row_count(&conn), 0, "an unknown run must write nothing");
    });
}

#[test]
fn an_event_carrying_a_foreign_task_id_still_attaches_the_summary_to_the_runs_own_task() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir, task, run) = seeded_task_and_run();
        let foreign_task = create_task(&mut conn, &project.id, &actor_id, "A different task", None)
            .expect("create_task should succeed");

        let event = serde_json::json!({
            "type": "summary_reported",
            "runId": run.id,
            "taskId": foreign_task.id,
            "projectId": "not-a-real-project-id",
            "worktreeId": "not-a-real-worktree-id",
            "changedFiles": [],
            "decisions": [],
            "acknowledgedDecisions": [],
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        let SummaryReportOutcome::Recorded(id) = outcome else {
            panic!("expected Recorded, got {outcome:?}");
        };

        let written_task_id: String = conn
            .query_row(
                "SELECT task_id FROM session_summaries WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .expect("summary row should exist");
        assert_eq!(
            written_task_id, task.id,
            "the summary must attach to the run's own task, never a task id read off the event"
        );
        assert_ne!(written_task_id, foreign_task.id);
    });
}

#[test]
fn missing_optional_fields_become_none_and_missing_arrays_become_empty_vecs() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        // No changedFiles, no decisions, no acknowledgedDecisions, no optional prose fields at all.
        let event = serde_json::json!({
            "type": "summary_reported",
            "runId": run.id,
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        let SummaryReportOutcome::Recorded(id) = outcome else {
            panic!("expected Recorded, got {outcome:?}");
        };

        let (changed_prose, remains, next_session_must_know): (
            Option<String>,
            Option<String>,
            Option<String>,
        ) = conn
            .query_row(
                "SELECT changed_prose, remains, next_session_must_know FROM session_summaries \
                 WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("summary row should exist");
        assert!(changed_prose.is_none());
        assert!(remains.is_none());
        assert!(next_session_must_know.is_none());

        let (changed_files_json, decisions_json): (String, String) = conn
            .query_row(
                "SELECT changed_files, decisions FROM session_summaries WHERE id = ?1",
                rusqlite::params![id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("summary row should exist");
        assert_eq!(changed_files_json, "[]");
        assert_eq!(decisions_json, "[]");
    });
}

#[test]
fn malformed_decisions_elements_are_dropped_and_well_formed_siblings_kept() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        let event = serde_json::json!({
            "type": "summary_reported",
            "runId": run.id,
            "changedFiles": [],
            "decisions": [
                {"id": "D1", "statement": "Well-formed entry"},
                "not an object",
                {"id": "D2"},
                {"statement": "missing an id"},
                {"id": "D3", "statement": "Also well-formed"},
            ],
            "acknowledgedDecisions": [],
        });

        let outcome =
            apply_summary_reported(&mut conn, &event).expect("apply_summary_reported should succeed");
        let SummaryReportOutcome::Recorded(id) = outcome else {
            panic!("expected Recorded, got {outcome:?}");
        };

        let decisions_json: String = conn
            .query_row(
                "SELECT decisions FROM session_summaries WHERE id = ?1",
                rusqlite::params![id],
                |row| row.get(0),
            )
            .expect("summary row should exist");
        let decisions: Vec<serde_json::Value> =
            serde_json::from_str(&decisions_json).expect("decisions column should be valid JSON");
        assert_eq!(decisions.len(), 2, "only the two well-formed entries must survive");
        assert_eq!(decisions[0]["id"], "D1");
        assert_eq!(decisions[1]["id"], "D3");
    });
}

// --- Task 3: the accumulated decisions list and render_prompt's two new sections ------------

#[test]
fn the_accumulated_decisions_list_deduplicates_a_shared_id_and_preserves_first_occurrence_order() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir, task, run) = seeded_task_and_run();

        create_summary(
            &mut conn,
            &run.id,
            SummaryFields {
                changed_files: vec![],
                changed_prose: Some("session one".to_string()),
                remains: None,
                next_session_must_know: None,
                decisions: vec![
                    DecisionEntry { id: "D1".to_string(), statement: "First statement of D1".to_string() },
                    DecisionEntry { id: "D2".to_string(), statement: "Only ever stated once".to_string() },
                ],
                acknowledged_decisions: vec![],
                diff_ref: None,
                auto_generated: false,
            },
            &actor_id,
        )
        .expect("create_summary 1 should succeed");

        create_summary(
            &mut conn,
            &run.id,
            SummaryFields {
                changed_files: vec![],
                changed_prose: Some("session two".to_string()),
                remains: None,
                next_session_must_know: None,
                // D1 restated with different wording — first occurrence must win.
                decisions: vec![DecisionEntry {
                    id: "D1".to_string(),
                    statement: "Restated D1, must not overwrite the first occurrence".to_string(),
                }],
                acknowledged_decisions: vec![],
                diff_ref: None,
                auto_generated: false,
            },
            &actor_id,
        )
        .expect("create_summary 2 should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.decisions.len(), 2, "D1 must be deduplicated to one entry");
        assert_eq!(packet.decisions[0].id, "D1");
        assert_eq!(
            packet.decisions[0].statement, "First statement of D1",
            "the FIRST occurrence's wording must win, never the later restatement"
        );
        assert_eq!(packet.decisions[1].id, "D2");
    });
}

#[test]
fn a_task_with_no_summaries_renders_no_decisions_heading_but_still_renders_the_closing_requirement() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No summaries yet", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.decisions.is_empty());

        let prompt = render_prompt(&packet, "");
        assert!(
            !prompt.contains("## Decisions On Record"),
            "an empty decisions list must render no heading at all (the closing requirement's own \
             prose legitimately names the section, so the heading marker is what must be absent)"
        );
        assert!(
            prompt.contains("## Closing Requirement"),
            "the closing requirement has no omit case — it must always render"
        );
    });
}

#[test]
fn the_rendered_closing_requirement_contains_the_fully_qualified_tool_string_character_for_character() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Closing requirement task", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let prompt = render_prompt(&packet, "");

        assert!(
            prompt.contains(REPORT_SUMMARY_TOOL_NAME),
            "the rendered prompt must name the exact tool string the sidecar registers"
        );
        assert_eq!(
            REPORT_SUMMARY_TOOL_NAME, "mcp__flywheel-permissions__report_summary",
            "the constant itself must match the sidecar's SUMMARY_TOOL_NAME composition"
        );
    });
}

#[test]
fn render_prompt_is_byte_identical_across_two_calls_with_both_new_sections_present() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir, task, run) = seeded_task_and_run();

        create_summary(
            &mut conn,
            &run.id,
            SummaryFields {
                changed_files: vec!["src/lib.rs".to_string()],
                changed_prose: Some("did the thing".to_string()),
                remains: None,
                next_session_must_know: None,
                decisions: vec![DecisionEntry { id: "D1".to_string(), statement: "Statement".to_string() }],
                acknowledged_decisions: vec![],
                diff_ref: None,
                auto_generated: false,
            },
            &actor_id,
        )
        .expect("create_summary should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(!packet.decisions.is_empty());

        let first = render_prompt(&packet, "steer it this way");
        let second = render_prompt(&packet, "steer it this way");
        assert_eq!(first, second);
        assert!(first.contains("Decisions On Record"));
        assert!(first.contains("Closing Requirement"));
    });
}
