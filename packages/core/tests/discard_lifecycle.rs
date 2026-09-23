//! D-66/D-67, CTX-08, plan 04-13: the database-visible half of Discard — the phase's flagship
//! action, "throw away the whole context in one action, land on a fresh session against the same
//! worktree." `agent_run_discard` itself (the bounded poll for a summary, then the fall-through to
//! `stop_agent_run_recording_first`) is a Tauri command living in
//! `packages/desktop/src-tauri/src/commands/agent_run.rs` — this crate cannot call it directly
//! (core has no dependency on desktop, and never should). What this file CAN reach, and does reach,
//! is the exact database sequence that command composes: `domain::agent_run::interrupt_agent_run`
//! (the interrupt-then-force transition both Stop and Discard share) followed by the
//! presence-checked fallback-summary write `stop_agent_run_recording_first` now performs (plan
//! 04-13 Task 1's own fix to that shared function) — written out explicitly here, exactly as the
//! desktop command performs it, rather than re-implemented differently.
//!
//! Behaviour B3 from the plan's own `<behavior>` block — "discard never waits longer than the
//! declared window plus the existing stop grace, measured from the call" — is a property of
//! `DISCARD_SUMMARY_WAIT_MS`, `DISCARD_POLL_INTERVAL_MS` and the polling loop itself, all of which
//! live in the desktop crate's Tauri command, not in anything this crate can import or drive. It is
//! asserted structurally at that layer (the constant's own doc comment states the arithmetic; the
//! `<verify>` grep gate over `agent_run.rs` proves the loop actually bounds itself by the constant)
//! and exercised end-to-end only by the plan's own `<human-check>` — not re-derived here.

mod common;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::{interrupt_agent_run, start_agent_run};
use core::domain::session_summary::{
    create_summary, latest_summary_for_run, synthesize_fallback_summary, DecisionEntry,
    SummaryFields,
};
use core::domain::task::create_task;

/// Serializes every call to [`with_scratch_worktree_root`] in THIS binary — verbatim in shape to
/// `stop_lifecycle.rs`'s own guard: `FLYWHEEL_WORKTREE_ROOT` is process-global mutable state, and
/// two tests racing here could let one test's worktree creation fall through to the real default
/// (`~/Flywheel/...`) between the other test's `set_var`/`remove_var` pair.
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: the mutex above serializes every caller in this binary, so no other thread reads or
    // mutates this var while it's set, and this helper always clears it before returning.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

/// One row's worth of the "nothing else on the board moved" promise (T-04-38) — a single snapshot
/// over the four tables the plan's own Task 3 names: `worktrees`, `session_summaries`,
/// `agent_runs` and `acceptance_criteria`. Counted globally (not scoped to one task) since every
/// test in this file seeds exactly one task/run, so a global count is equivalent to — and simpler
/// than — a task-scoped one.
#[derive(Debug, Clone, Copy, PartialEq)]
struct BoardCounts {
    worktrees: i64,
    session_summaries: i64,
    agent_runs: i64,
    acceptance_criteria: i64,
}

fn board_counts(conn: &rusqlite::Connection) -> BoardCounts {
    let count = |table: &str| -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
            .unwrap_or_else(|e| panic!("failed to count rows in {table}: {e}"))
    };
    BoardCounts {
        worktrees: count("worktrees"),
        session_summaries: count("session_summaries"),
        agent_runs: count("agent_runs"),
        acceptance_criteria: count("acceptance_criteria"),
    }
}

/// Count of terminal-event rows (`agent_run.closed` OR `agent_run.interrupted`) appended for
/// `run_id` — mirrors `session_close_lifecycle.rs`'s own helper of the identical name and shape.
fn terminal_event_count(conn: &rusqlite::Connection, run_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type IN ('agent_run.closed', 'agent_run.interrupted')",
        rusqlite::params![run_id],
        |row| row.get(0),
    )
    .expect("count query should succeed")
}

/// Performs the EXACT database sequence `stop_agent_run_recording_first` performs (plan 04-13 Task
/// 1's own addition to that shared function) — the ONE termination path Stop and Discard both
/// walk: `interrupt_agent_run`, then, only if no summary yet exists for the run, one
/// `synthesize_fallback_summary` call inside its own transaction. Written out explicitly here
/// (rather than imported) because the composing function lives in the desktop crate, not this one
/// — see this file's own module doc comment.
fn simulate_discard_stop_path(
    conn: &mut rusqlite::Connection,
    run_id: &str,
    actor_id: &str,
) -> anyhow::Result<String> {
    interrupt_agent_run(conn, run_id, actor_id)?;

    let status: String = conn.query_row(
        "SELECT status FROM agent_runs WHERE id = ?1",
        rusqlite::params![run_id],
        |row| row.get(0),
    )?;

    if latest_summary_for_run(conn, run_id)?.is_none() {
        let tx = conn.transaction()?;
        synthesize_fallback_summary(&tx, run_id, &status)?;
        tx.commit()?;
    }

    Ok(status)
}

#[test]
fn discarding_a_run_with_an_agent_recorded_summary_leaves_it_present_and_the_run_interrupted() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard: agent summary present", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // The agent recorded its own closing summary BEFORE the discard's wait elapsed.
        let fields = SummaryFields {
            changed_files: vec!["src/lib.rs".to_string()],
            changed_prose: Some("Refactored the parser.".to_string()),
            remains: Some("Add tests for the edge case.".to_string()),
            next_session_must_know: Some("Watch out for the trailing comma bug.".to_string()),
            decisions: vec![DecisionEntry { id: "d1".to_string(), statement: "Use recursive descent".to_string() }],
            acknowledged_decisions: vec![],
            diff_ref: None,
            auto_generated: false,
        };
        create_summary(&mut conn, &run.id, fields, &run.actor_id)
            .expect("the agent's own create_summary call should succeed");

        let status = simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");
        assert_eq!(status, "interrupted", "the run must reach a terminal state (B1)");

        let summaries = core::domain::session_summary::list_summaries_for_task(&conn, &task.id)
            .expect("list_summaries_for_task should succeed");
        assert_eq!(summaries.len(), 1, "the agent's summary must be the ONLY one — no second, synthesized row");
        assert!(!summaries[0].auto_generated, "an agent-authored summary must never be relabelled auto_generated (B1)");
        assert_eq!(summaries[0].changed_prose.as_deref(), Some("Refactored the parser."));
    });
}

#[test]
fn discarding_a_run_with_no_agent_summary_synthesizes_exactly_one_auto_generated_fallback() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard: no agent summary", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // No report_summary call ever landed — the wait elapsed with nothing recorded.
        let status = simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");
        assert_eq!(status, "interrupted", "the run must reach a terminal state (B2)");

        let summaries = core::domain::session_summary::list_summaries_for_task(&conn, &task.id)
            .expect("list_summaries_for_task should succeed");
        assert_eq!(summaries.len(), 1, "exactly one fallback summary must exist (B2)");
        assert!(summaries[0].auto_generated, "the fallback row must be flagged auto_generated (B2)");
        assert_eq!(summaries[0].agent_run_id, run.id);
    });
}

#[test]
fn discarding_an_already_terminal_run_writes_no_second_terminal_event() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard: already terminal", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // The run is ALREADY interrupted — e.g. a prior Stop, or a first discard — before this
        // second discard call ever runs.
        interrupt_agent_run(&mut conn, &run.id, &actor_id).expect("the first interrupt should succeed");
        assert_eq!(terminal_event_count(&conn, &run.id), 1);

        let status = simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("discarding an already-terminal run must not error (B6)");
        assert_eq!(status, "interrupted", "the status must remain interrupted, never overwritten");

        assert_eq!(
            terminal_event_count(&conn, &run.id),
            1,
            "a discard against an already-terminal run must append no second terminal event (B6)"
        );
    });
}

#[test]
fn the_tasks_worktree_row_count_and_directory_are_unchanged_by_a_discard() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard: worktree untouched", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let worktree_path: String = conn
            .query_row(
                "SELECT path FROM worktrees WHERE id = ?1",
                rusqlite::params![run.worktree_id],
                |row| row.get(0),
            )
            .expect("worktree row should exist");
        let worktree_row_count_before: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1",
                rusqlite::params![task.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert!(std::path::Path::new(&worktree_path).is_dir(), "the worktree must exist on disk before the discard");

        simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let worktree_row_count_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM worktrees WHERE task_id = ?1",
                rusqlite::params![task.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(
            worktree_row_count_before, worktree_row_count_after,
            "the task's worktree row count must be unchanged by a discard (B4)"
        );
        assert!(
            std::path::Path::new(&worktree_path).is_dir(),
            "the worktree directory must still exist on disk after a discard (B4) — discard removes nothing"
        );
    });
}

#[test]
fn no_prior_session_summary_row_is_removed_by_a_discard() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard: prior summaries preserved", None)
            .expect("create_task should succeed");

        // A first run, already closed with its own agent-authored summary — the "prior session"
        // this discard must not touch.
        let first_run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let prior_fields = SummaryFields {
            changed_files: vec!["src/first.rs".to_string()],
            changed_prose: Some("First session's work.".to_string()),
            remains: None,
            next_session_must_know: None,
            decisions: vec![],
            acknowledged_decisions: vec![],
            diff_ref: None,
            auto_generated: false,
        };
        let prior_summary = create_summary(&mut conn, &first_run.id, prior_fields, &first_run.actor_id)
            .expect("create_summary for the first run should succeed");
        interrupt_agent_run(&mut conn, &first_run.id, &actor_id).expect("closing the first run should succeed");

        // A second, live run against the SAME task — this is the one being discarded.
        let second_run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed for the second run");

        simulate_discard_stop_path(&mut conn, &second_run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let summaries = core::domain::session_summary::list_summaries_for_task(&conn, &task.id)
            .expect("list_summaries_for_task should succeed");
        assert_eq!(summaries.len(), 2, "the prior summary plus the second run's own fallback — nothing removed (B5)");
        assert!(
            summaries.iter().any(|s| s.id == prior_summary.id),
            "the first run's own summary row must still exist, byte-identical, after discarding a LATER run (B5)"
        );
        let second_run_summary = summaries
            .iter()
            .find(|s| s.agent_run_id == second_run.id)
            .expect("the second run must have gotten its own fallback summary");
        assert!(second_run_summary.auto_generated, "the second run's fallback must be flagged auto_generated");
    });
}

#[test]
fn board_counts_are_unchanged_across_a_discard_when_the_agent_already_recorded_its_own_summary() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard counts: agent summary present", None)
            .expect("create_task should succeed");
        create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Ships without regressions", None)
            .expect("create_criterion should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let fields = SummaryFields {
            changed_files: vec![],
            changed_prose: Some("Done.".to_string()),
            remains: None,
            next_session_must_know: None,
            decisions: vec![],
            acknowledged_decisions: vec![],
            diff_ref: None,
            auto_generated: false,
        };
        create_summary(&mut conn, &run.id, fields, &run.actor_id)
            .expect("create_summary should succeed");

        // The agent's summary is already on the board BEFORE the "before" snapshot — a discard
        // against this run should write NOTHING new to session_summaries (B1's "present" case).
        let before = board_counts(&conn);

        simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let after = board_counts(&conn);
        assert_eq!(before.worktrees, after.worktrees, "worktrees must be unchanged by a discard (T-04-38)");
        assert_eq!(before.agent_runs, after.agent_runs, "agent_runs row count must be unchanged by a discard (T-04-38)");
        assert_eq!(
            before.acceptance_criteria, after.acceptance_criteria,
            "acceptance_criteria must be unchanged by a discard (T-04-38)"
        );
        assert_eq!(
            before.session_summaries, after.session_summaries,
            "session_summaries must be unchanged when the agent already recorded its own summary before the wait elapsed"
        );
    });
}

#[test]
fn board_counts_gain_exactly_one_session_summary_when_no_agent_summary_was_recorded() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard counts: no agent summary", None)
            .expect("create_task should succeed");
        create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Ships without regressions", None)
            .expect("create_criterion should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let before = board_counts(&conn);

        simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let after = board_counts(&conn);
        assert_eq!(before.worktrees, after.worktrees, "worktrees must be unchanged by a discard (T-04-38)");
        assert_eq!(before.agent_runs, after.agent_runs, "agent_runs row count must be unchanged by a discard (T-04-38)");
        assert_eq!(
            before.acceptance_criteria, after.acceptance_criteria,
            "acceptance_criteria must be unchanged by a discard (T-04-38)"
        );
        assert_eq!(
            after.session_summaries,
            before.session_summaries + 1,
            "session_summaries must gain EXACTLY one row — the fallback synthesizer's own — when no agent summary landed"
        );
    });
}

#[test]
fn discarding_twice_appends_no_second_summary_and_no_second_interrupted_event() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard twice", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("the first discard's stop path should succeed");
        let counts_after_first = board_counts(&conn);
        let terminal_events_after_first = terminal_event_count(&conn, &run.id);

        simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("a second discard against the same, now-terminal run must be a harmless no-op");
        let counts_after_second = board_counts(&conn);
        let terminal_events_after_second = terminal_event_count(&conn, &run.id);

        assert_eq!(
            counts_after_first, counts_after_second,
            "a second discard against an already-terminal run must write nothing further to any of the four tables"
        );
        assert_eq!(
            terminal_events_after_first, terminal_events_after_second,
            "a second discard must append no second terminal event"
        );
        assert_eq!(terminal_events_after_second, 1);
    });
}

#[test]
fn the_fallback_never_overwrites_an_agent_authored_summary_recorded_moments_before_the_interrupt() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Discard: last-moment agent summary", None)
            .expect("create_task should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // The agent's closing report_summary call landed just before the wait elapsed — modelled
        // here as "recorded, then the stop path runs", exactly like the present-summary test above
        // but asserting the NEGATIVE property explicitly: no second, auto_generated row appears
        // alongside it.
        let fields = SummaryFields {
            changed_files: vec![],
            changed_prose: Some("Landed just in time.".to_string()),
            remains: None,
            next_session_must_know: None,
            decisions: vec![],
            acknowledged_decisions: vec![],
            diff_ref: None,
            auto_generated: false,
        };
        create_summary(&mut conn, &run.id, fields, &run.actor_id).expect("create_summary should succeed");

        simulate_discard_stop_path(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let summaries = core::domain::session_summary::list_summaries_for_task(&conn, &task.id)
            .expect("list_summaries_for_task should succeed");
        assert_eq!(summaries.len(), 1, "the presence check must prevent a second, synthesized row");
        assert!(
            !summaries.iter().any(|s| s.auto_generated),
            "no auto_generated row may exist alongside an agent-authored one for the same run"
        );
    });
}

#[test]
fn an_unknown_run_id_is_a_harmless_no_op_for_the_discard_stop_path() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, _project, _repo_dir) = common::seeded_git_project();

        let unknown_run_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
        // interrupt_agent_run is a harmless no-op for an unknown run (mirrors stop_lifecycle.rs's
        // own coverage); the status read that follows in stop_agent_run_recording_first's real
        // body would then fail — that failure mode belongs to the desktop-layer test, since this
        // crate has no equivalent of the DTO's own error propagation to assert against. What THIS
        // crate can and does assert: the interrupt call itself never panics and writes nothing.
        interrupt_agent_run(&mut conn, unknown_run_id, &actor_id)
            .expect("interrupting an unknown agent_run_id must be a harmless no-op");

        let agent_runs_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM agent_runs", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(agent_runs_count, 0, "an unknown run id must write no agent_runs row");
    });
}
