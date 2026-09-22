//! `domain::session_summary::create_summary` / `list_summaries_for_task` /
//! `latest_summary_for_run` (D-65, CTX-01..CTX-04) — the tracer's own end-to-end proof: a summary
//! written through `create_summary` is returned by the very next `assemble_context_packet` call
//! for the same task and appears in `render_prompt`'s output.

mod common;

use core::context_packet::{assemble_context_packet, render_prompt};
use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::{
    apply_session_closed, close_agent_run, start_agent_run, AgentRun, AgentRunStatus,
    SessionClosedOutcome,
};
use core::domain::epic::create_epic;
use core::domain::event::{append_event, next_sequence};
use core::domain::project::Project;
use core::domain::session_summary::{
    create_summary, latest_summary_for_run, list_summaries_for_task, synthesize_fallback_summary,
    DecisionEntry, SummaryFields,
};
use core::domain::task::{create_task, Task};
use core::domain::worktree::ensure_worktree;
use rusqlite::{params, Connection};
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

// ---------------------------------------------------------------------------------------------
// Task 1: `synthesize_fallback_summary` — a best-effort summary from facts the board already
// holds, exercised directly (its own transaction, never through `apply_session_closed`).
// ---------------------------------------------------------------------------------------------

#[test]
fn fallback_summary_counts_the_runs_own_events_and_names_the_close_reason() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir, task, run) = seeded_task_and_run();

        // Three tool_call-derived event rows attached directly to the run (stream_id = run.id),
        // plus one permission_request.raised row attached to the run's task within the run's
        // window (stream_id names the permission request, not the run) — the plan's own worked
        // example.
        let event_at = chrono::Utc::now().to_rfc3339();
        {
            let tx = conn.transaction().expect("failed to open tx for event seeding");
            for i in 0..3 {
                let seq = next_sequence(&tx, &project.id, "local").expect("next_sequence should succeed");
                append_event(
                    &tx,
                    &project.id,
                    "local",
                    seq,
                    "agent_run",
                    &run.id,
                    Some(&task.id),
                    None,
                    &actor_id,
                    "tool_call",
                    &serde_json::json!({ "n": i }),
                    &event_at,
                )
                .expect("append_event for a tool_call row should succeed");
            }
            let seq = next_sequence(&tx, &project.id, "local").expect("next_sequence should succeed");
            append_event(
                &tx,
                &project.id,
                "local",
                seq,
                "permission_request",
                "perm-1",
                Some(&task.id),
                None,
                &actor_id,
                "permission_request.raised",
                &serde_json::json!({}),
                &event_at,
            )
            .expect("append_event for the permission_request row should succeed");
            tx.commit().expect("failed to commit event-seeding tx");
        }

        // The expected count is measured independently, with the identical predicate
        // `synthesize_fallback_summary` itself uses — this proves the embedded number is exactly
        // the run's own event count, without hard-coding an assumption about background events
        // `start_agent_run`'s own fixture setup already wrote (its own `agent_run.started` event,
        // for one, also carries `stream_id = run.id`).
        let started_at: String = conn
            .query_row(
                "SELECT started_at FROM agent_runs WHERE id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .expect("agent_runs row should exist");
        let upper_bound = chrono::Utc::now().to_rfc3339();
        let expected_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE stream_id = ?1 OR (task_id = ?2 AND occurred_at >= ?3 AND occurred_at <= ?4)",
                params![run.id, task.id, started_at, upper_bound],
                |row| row.get(0),
            )
            .expect("expected-count query should succeed");
        assert!(
            expected_count >= 4,
            "the four seeded rows above must all be counted, got {expected_count}"
        );

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        let summary_id = synthesize_fallback_summary(&tx, &run.id, "interrupted")
            .expect("synthesize_fallback_summary should succeed");
        tx.commit().expect("failed to commit synthesize tx");

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");
        assert_eq!(summary.id, summary_id);
        assert!(summary.auto_generated, "the synthesized row must be flagged auto_generated");
        let prose = summary.changed_prose.expect("changed_prose must be present");
        assert!(prose.contains("interrupted"), "prose must name the close reason: {prose}");
        assert!(
            prose.contains(&expected_count.to_string()),
            "prose must name the run's own event count ({expected_count}): {prose}"
        );
        assert!(summary.decisions.is_empty(), "decisions must be empty");
    });
}

#[test]
fn fallback_summary_with_zero_matching_events_still_yields_one_honest_row() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        // Clear every event so the synthesizer's own count query reads zero — proving the
        // fallback never fails, and never invents a claim, when the board holds no interaction
        // history at all for this run. (Test-only: production code never issues a DELETE against
        // `events`.)
        conn.execute("DELETE FROM events", []).expect("clearing events should succeed");

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        synthesize_fallback_summary(&tx, &run.id, "failed")
            .expect("synthesize_fallback_summary should succeed with zero events");
        tx.commit().expect("failed to commit synthesize tx");

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");

        assert!(summary.changed_files.is_empty(), "changed_files must be an empty list");
        let prose = summary.changed_prose.expect("changed_prose must be present");
        assert!(!prose.is_empty(), "changed_prose must be non-empty");
        assert!(
            prose.contains("no agent summary recorded"),
            "prose must state that no agent summary was recorded: {prose}"
        );
        assert!(summary.remains.is_some(), "remains must be present");
        assert_eq!(
            summary.next_session_must_know, None,
            "next_session_must_know must always be None for a synthesized row"
        );
        assert!(summary.decisions.is_empty(), "decisions must be an empty list");
        assert!(summary.acknowledged_decisions.is_empty(), "acknowledged_decisions must be empty");
        assert!(summary.diff_ref.is_none(), "diff_ref must be None in this plan");
        assert!(summary.auto_generated);

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(count, 1, "zero events must still produce exactly one summary row");
    });
}

#[test]
fn fallback_summary_is_attributed_to_the_agent_actor_not_a_human() {
    with_scratch_worktree_root(|| {
        let (mut conn, human_actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        synthesize_fallback_summary(&tx, &run.id, "completed")
            .expect("synthesize_fallback_summary should succeed");
        tx.commit().expect("failed to commit synthesize tx");

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");

        assert!(summary.auto_generated, "the synthesized row must be flagged auto_generated");
        assert_eq!(
            summary.created_by, run.actor_id,
            "a synthesized row must be attributed to the run's own agent actor"
        );
        assert_ne!(
            summary.created_by, human_actor_id,
            "a synthesized row must never be attributed to the local human actor"
        );
    });
}

#[test]
fn calling_the_synthesizer_twice_for_the_same_run_writes_two_rows() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        {
            let tx = conn.transaction().expect("failed to open tx for the first synthesize call");
            synthesize_fallback_summary(&tx, &run.id, "completed")
                .expect("first synthesize_fallback_summary call should succeed");
            tx.commit().expect("failed to commit the first synthesize tx");
        }
        {
            let tx = conn.transaction().expect("failed to open tx for the second synthesize call");
            synthesize_fallback_summary(&tx, &run.id, "completed")
                .expect("second synthesize_fallback_summary call should succeed");
            tx.commit().expect("failed to commit the second synthesize tx");
        }

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(
            count, 2,
            "the synthesizer has no dedupe of its own — the caller's presence check is the guard"
        );
    });
}

#[test]
fn create_summary_and_synthesize_fallback_summary_share_one_insert_site_and_stay_distinguishable() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir, task, run) = seeded_task_and_run();

        let agent_written =
            create_summary(&mut conn, &run.id, minimal_fields("agent's own words", false), &actor_id)
                .expect("create_summary should still succeed after the insert_summary_row refactor");

        let tx = conn.transaction().expect("failed to open tx for synthesize");
        let fallback_id = synthesize_fallback_summary(&tx, &run.id, "failed")
            .expect("synthesize_fallback_summary should succeed");
        tx.commit().expect("failed to commit synthesize tx");

        let all = list_summaries_for_task(&conn, &task.id)
            .expect("list_summaries_for_task should succeed");
        assert_eq!(all.len(), 2, "both the agent-authored and the fallback row must exist");
        let agent_row = all.iter().find(|s| s.id == agent_written.id).expect("agent row must exist");
        let fallback_row = all.iter().find(|s| s.id == fallback_id).expect("fallback row must exist");
        assert!(!agent_row.auto_generated, "the agent-authored row must read back unset");
        assert!(fallback_row.auto_generated, "the fallback row must read back set");
    });
}

// ---------------------------------------------------------------------------------------------
// Task 2: `apply_session_closed`'s fallback-summary hook — every terminal run gets checked.
// ---------------------------------------------------------------------------------------------

#[test]
fn apply_session_closed_interrupted_writes_a_fallback_summary_and_points_exit_summary_id_at_it() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        let event = serde_json::json!({
            "type": "session_closed",
            "runId": run.id,
            "reason": "interrupted",
        });
        let outcome =
            apply_session_closed(&mut conn, &event).expect("apply_session_closed should succeed");
        assert_eq!(outcome, SessionClosedOutcome::Closed(AgentRunStatus::Interrupted));

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(
            count, 1,
            "a run with no agent-recorded summary must leave exactly one synthesized row"
        );

        let summary = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("a summary row must exist");
        assert!(summary.auto_generated, "the fallback row must be flagged auto_generated");

        let exit_summary_id: Option<String> = conn
            .query_row(
                "SELECT exit_summary_id FROM agent_runs WHERE id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .expect("agent_runs row should exist");
        assert_eq!(
            exit_summary_id,
            Some(summary.id.clone()),
            "exit_summary_id must name the fallback row"
        );
    });
}

#[test]
fn apply_session_closed_behaves_identically_for_completed_and_failed() {
    // Each reason gets its OWN scratch worktree root — `with_scratch_worktree_root` sets a
    // process-wide env var, and both iterations otherwise mint a project with the identical key
    // prefix/first-task-key ("FLY-1"), which would collide on the same physical worktree
    // directory on disk if the root were shared across iterations.
    for reason in ["completed", "failed"] {
        with_scratch_worktree_root(|| {
            let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();
            let event = serde_json::json!({
                "type": "session_closed",
                "runId": run.id,
                "reason": reason,
            });
            let outcome = apply_session_closed(&mut conn, &event)
                .expect("apply_session_closed should succeed");
            assert!(matches!(outcome, SessionClosedOutcome::Closed(_)));

            let summary = latest_summary_for_run(&conn, &run.id)
                .expect("latest_summary_for_run should succeed")
                .expect("a summary row must exist");
            assert!(
                summary.auto_generated,
                "reason {reason} must still synthesize a fallback summary"
            );
            let prose = summary.changed_prose.expect("changed_prose must be present");
            assert!(prose.contains(reason), "prose must name the close reason {reason}: {prose}");
        });
    }
}

#[test]
fn apply_session_closed_never_synthesizes_a_second_summary_when_one_already_exists() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        let recorded = create_summary(
            &mut conn,
            &run.id,
            minimal_fields("agent's own closing words", false),
            &actor_id,
        )
        .expect("create_summary should succeed");

        let event = serde_json::json!({
            "type": "session_closed",
            "runId": run.id,
            "reason": "completed",
        });
        apply_session_closed(&mut conn, &event).expect("apply_session_closed should succeed");

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(count, 1, "an agent-recorded summary must never gain a synthesized sibling");

        let still = latest_summary_for_run(&conn, &run.id)
            .expect("latest_summary_for_run should succeed")
            .expect("the recorded summary must still exist");
        assert_eq!(still.id, recorded.id);
        assert!(
            !still.auto_generated,
            "the pre-existing agent-authored row must never flip auto_generated"
        );
    });
}

#[test]
fn apply_session_closed_with_a_non_ulid_run_id_writes_no_summary() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir) = common::seeded_git_project();

        let event = serde_json::json!({
            "type": "session_closed",
            "runId": "not-a-ulid",
            "reason": "completed",
        });
        let outcome =
            apply_session_closed(&mut conn, &event).expect("a malformed run id must not error");
        assert_eq!(outcome, SessionClosedOutcome::Ignored);

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_summaries", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(count, 0, "an ignored event must write no summary row at all");
    });
}

#[test]
fn close_agent_run_still_works_directly_after_the_in_tx_refactor() {
    with_scratch_worktree_root(|| {
        let (mut conn, _actor_id, _project, _repo_dir, _task, run) = seeded_task_and_run();

        close_agent_run(&mut conn, &run.id, AgentRunStatus::Completed, Some(0.01), Some(10), Some(2))
            .expect("close_agent_run should still succeed after the refactor");

        let (status, cost_usd): (String, Option<f64>) = conn
            .query_row(
                "SELECT status, cost_usd FROM agent_runs WHERE id = ?1",
                params![run.id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .expect("agent_runs row should exist");
        assert_eq!(status, "completed");
        assert_eq!(cost_usd, Some(0.01));

        // `close_agent_run` alone (its lower-level statement body, called directly rather than
        // through `apply_session_closed`) must not synthesize a fallback summary — that behavior
        // belongs only to `apply_session_closed`'s own call site (production's one caller).
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM session_summaries WHERE agent_run_id = ?1",
                params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(count, 0, "close_agent_run alone must not synthesize a summary");
    });
}
