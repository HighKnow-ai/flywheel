//! `domain::session_summary::create_summary` / `list_summaries_for_task` /
//! `latest_summary_for_run` (D-65, CTX-01..CTX-04) — the tracer's own end-to-end proof: a summary
//! written through `create_summary` is returned by the very next `assemble_context_packet` call
//! for the same task and appears in `render_prompt`'s output.

mod common;

use core::context_packet::{assemble_context_packet, render_prompt};
use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::{start_agent_run, AgentRun};
use core::domain::epic::create_epic;
use core::domain::project::Project;
use core::domain::session_summary::{
    create_summary, latest_summary_for_run, list_summaries_for_task, DecisionEntry, SummaryFields,
};
use core::domain::task::{create_task, Task};
use core::domain::worktree::ensure_worktree;
use rusqlite::Connection;
use tempfile::TempDir;

/// A minimal fixture shared by Task 2's structural tests: a project, one task, and one started
/// agent run — the shape [`create_summary`] needs (`agent_run_id`), without each test re-deriving
/// it.
fn seeded_task_and_run() -> (Connection, String, Project, TempDir, Task, AgentRun) {
    let (mut conn, actor_id, project, repo_dir) = common::seeded_git_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Task 2 fixture", None)
        .expect("create_task should succeed");
    ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
    let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
        .expect("start_agent_run should succeed");
    (conn, actor_id, project, repo_dir, task, run)
}

fn minimal_fields(changed_prose: &str, auto_generated: bool) -> SummaryFields {
    SummaryFields {
        changed_files: vec!["src/lib.rs".to_string()],
        changed_prose: Some(changed_prose.to_string()),
        remains: None,
        next_session_must_know: None,
        decisions: vec![],
        acknowledged_decisions: vec![],
        diff_ref: None,
        auto_generated,
    }
}

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

#[test]
fn a_summary_written_is_carried_by_the_next_context_packet() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let epic = create_epic(&mut conn, &project.id, &actor_id, "Ship the thing", None)
            .expect("create_epic should succeed");
        let task = create_task(&mut conn, &project.id, &actor_id, "Wire the summary", Some(&epic.id))
            .expect("create_task should succeed");
        create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "First criterion",
            None,
        )
        .expect("create_criterion 1 should succeed");
        create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Second criterion",
            None,
        )
        .expect("create_criterion 2 should succeed");

        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let fields = SummaryFields {
            changed_files: vec!["src/lib.rs".to_string(), "src/main.rs".to_string()],
            changed_prose: Some("Wired the summary read path.".to_string()),
            remains: Some("Wire the fallback synthesizer.".to_string()),
            next_session_must_know: Some("The packet field is called summaries.".to_string()),
            decisions: vec![DecisionEntry {
                id: "d1".to_string(),
                statement: "Use jose instead of jsonwebtoken.".to_string(),
            }],
            acknowledged_decisions: vec![],
            diff_ref: Some("HEAD~1".to_string()),
            auto_generated: false,
        };

        let written = create_summary(&mut conn, &run.id, fields, &actor_id)
            .expect("create_summary should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert_eq!(packet.summaries.len(), 1, "exactly one summary must be carried");
        let entry = &packet.summaries[0];
        assert_eq!(entry.agent_run_id, run.id);
        assert_eq!(entry.changed_files, written.changed_files);
        assert_eq!(entry.remains, written.remains);
        assert_eq!(entry.next_session_must_know, written.next_session_must_know);
        assert_eq!(entry.decisions, written.decisions);

        let prompt = render_prompt(&packet, "");
        assert!(prompt.contains("Prior Sessions"), "the prior-sessions heading must be present");
        assert!(prompt.contains("src/lib.rs"), "the changed path must appear in the rendered prompt");
        assert!(
            prompt.contains("Use jose instead of jsonwebtoken."),
            "the decision statement must appear in the rendered prompt"
        );
    });
}

#[test]
fn a_task_with_zero_summaries_yields_an_empty_list_and_no_prior_sessions_heading() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No summaries yet", None)
            .expect("create_task should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        assert!(packet.summaries.is_empty(), "summaries list must be empty");

        let prompt = render_prompt(&packet, "");
        assert!(
            !prompt.contains("Prior Sessions"),
            "no prior-sessions heading should be emitted for a task with zero summaries"
        );
    });
}

#[test]
fn two_summaries_for_one_run_append_rather_than_replace() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        let first = create_summary(&mut conn, &run.id, minimal_fields("first pass", false), &actor_id)
            .expect("first create_summary should succeed");
        let second =
            create_summary(&mut conn, &run.id, minimal_fields("second pass", false), &actor_id)
                .expect("second create_summary should succeed");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(count, 2, "two create_summary calls must leave two rows, not one");

        let reread_first = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary should exist");
        assert_eq!(
            reread_first.id, second.id,
            "latest_summary_for_run must name the second (most recent) summary"
        );

        // The first row's own content fields must still be byte-identical to what was written —
        // proving the second insert never rewrote it.
        let all = list_summaries_for_task(&conn, &_task.id)
            .expect("list_summaries_for_task should succeed");
        let stored_first = all.iter().find(|s| s.id == first.id).expect("first row must still exist");
        assert_eq!(stored_first.changed_prose, first.changed_prose);
        assert_eq!(stored_first.changed_files, first.changed_files);

        let exit_summary_id: Option<String> = conn
            .query_row(
                "SELECT exit_summary_id FROM agent_runs WHERE id = ?1",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("agent_runs row should exist");
        assert_eq!(
            exit_summary_id.as_deref(),
            Some(second.id.as_str()),
            "exit_summary_id must name the second summary after the second write"
        );
    });
}

#[test]
fn ordering_is_stable_under_a_tied_created_at_timestamp() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir, task, run) = seeded_task_and_run();

        let s1 = create_summary(&mut conn, &run.id, minimal_fields("one", false), &actor_id)
            .expect("create_summary 1 should succeed");
        let s2 = create_summary(&mut conn, &run.id, minimal_fields("two", false), &actor_id)
            .expect("create_summary 2 should succeed");
        let s3 = create_summary(&mut conn, &run.id, minimal_fields("three", false), &actor_id)
            .expect("create_summary 3 should succeed");

        // Force s1 and s2 to share a created_at value directly in the test's own SQL — production
        // code never issues an UPDATE against session_summaries; this is the test harness
        // deliberately manufacturing the tie the plan's own acceptance criteria require.
        let tied_at = "2026-01-01T00:00:00.000Z";
        conn.execute(
            "UPDATE session_summaries SET created_at = ?1 WHERE id IN (?2, ?3)",
            rusqlite::params![tied_at, s1.id, s2.id],
        )
        .expect("test-only tie-forcing update should succeed");

        let (lesser_id, greater_id) = if s1.id < s2.id { (&s1.id, &s2.id) } else { (&s2.id, &s1.id) };

        let first_call = list_summaries_for_task(&conn, &task.id)
            .expect("list_summaries_for_task should succeed");
        assert_eq!(first_call.len(), 3);
        assert_eq!(&first_call[0].id, lesser_id, "the lesser ULID must sort first within the tie");
        assert_eq!(&first_call[1].id, greater_id, "the greater ULID must sort second within the tie");
        assert_eq!(first_call[2].id, s3.id, "the untied third row must still sort last");

        let second_call = list_summaries_for_task(&conn, &task.id)
            .expect("second list_summaries_for_task call should succeed");
        assert_eq!(
            first_call.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
            second_call.iter().map(|s| s.id.clone()).collect::<Vec<_>>(),
            "calling list_summaries_for_task twice must return the same id sequence"
        );
    });
}

#[test]
fn the_auto_generated_flag_survives_the_round_trip_in_both_directions() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir, task, run) = seeded_task_and_run();

        let agent_written =
            create_summary(&mut conn, &run.id, minimal_fields("agent's own words", false), &actor_id)
                .expect("agent-authored create_summary should succeed");
        let auto_written =
            create_summary(&mut conn, &run.id, minimal_fields("fallback text", true), &actor_id)
                .expect("auto-generated create_summary should succeed");

        assert!(!agent_written.auto_generated, "the agent-authored row must read back unset");
        assert!(auto_written.auto_generated, "the auto-generated row must read back set");

        let reread = list_summaries_for_task(&conn, &task.id)
            .expect("list_summaries_for_task should succeed");
        let reread_agent = reread.iter().find(|s| s.id == agent_written.id).unwrap();
        let reread_auto = reread.iter().find(|s| s.id == auto_written.id).unwrap();
        assert!(!reread_agent.auto_generated);
        assert!(reread_auto.auto_generated);

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let prompt = render_prompt(&packet, "");
        assert!(
            prompt.contains("(auto-generated — no agent summary was recorded for this run)"),
            "the auto-generated block must carry the marker"
        );

        // The agent-authored session's own heading line must NOT carry the auto-generated
        // marker — find its "### Session N" line and assert the marker is absent from it.
        let agent_ordinal = reread.iter().position(|s| s.id == agent_written.id).unwrap() + 1;
        let agent_heading = format!("### Session {agent_ordinal}\n");
        assert!(
            prompt.contains(&agent_heading),
            "the agent-authored session's heading must render with no suffix"
        );
    });
}
