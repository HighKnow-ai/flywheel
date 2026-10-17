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

use common::with_scratch_worktree_root;

use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::{
    apply_session_closed, interrupt_agent_run, interrupt_agent_run_in_tx, start_agent_run,
};
use core::domain::session_summary::{
    create_summary, latest_summary_for_run, list_summaries_for_story, synthesize_fallback_summary,
};

/// One row's worth of the "nothing else on the board moved" promise (T-04-38) — a single snapshot
/// over the four tables the plan's own Task 3 names: `worktrees`, `session_summaries`,
/// `sessions` and `acceptance_criteria`. Counted globally (not scoped to one Story) since every
/// test in this file seeds exactly one Story/run, so a global count is equivalent to — and simpler
/// than — a Story-scoped one.
#[derive(Debug, Clone, Copy, PartialEq)]
struct BoardCounts {
    worktrees: i64,
    session_summaries: i64,
    sessions: i64,
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
        sessions: count("sessions"),
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

/// Performs the EXACT database sequence `stop_agent_run_recording_first` performs (plan 04-15 Task
/// 1's single-transaction fix to that shared function) — the ONE termination path Stop and Discard
/// both walk, composed on ONE transaction: `interrupt_agent_run_in_tx`, a status read off the SAME
/// `tx`, then, only if no summary yet exists for the run, one `synthesize_fallback_summary` call on
/// the SAME `tx`, before committing. Written out explicitly here (rather than imported) because the
/// composing function lives in the desktop crate, not this one — see this file's own module doc
/// comment. The single transaction is now the property this helper mirrors (D-64, CTX-01, gap #1
/// of 04-VERIFICATION.md): a crash between the two writes rolls back BOTH, never leaving a
/// terminal run with no summary. [`simulate_discard_stop_path_rolled_back`] below performs the
/// identical statement sequence and is used only to exercise that rollback.
fn simulate_discard_stop_path_in_tx(
    conn: &mut rusqlite::Connection,
    run_id: &str,
    actor_id: &str,
) -> anyhow::Result<String> {
    let tx = conn.transaction()?;

    interrupt_agent_run_in_tx(&tx, run_id, actor_id)?;

    let status: String = tx.query_row(
        "SELECT status FROM sessions WHERE id = ?1",
        rusqlite::params![run_id],
        |row| row.get(0),
    )?;

    if latest_summary_for_run(&tx, run_id)?.is_none() {
        synthesize_fallback_summary(&tx, run_id, &status)?;
    }

    tx.commit()?;
    Ok(status)
}

/// The crash-window sibling of [`simulate_discard_stop_path_in_tx`]: performs the IDENTICAL
/// statement sequence — same order, same statements — inside its own transaction, then drops that
/// transaction WITHOUT committing (simulating a crash mid-termination) and returns the status it
/// read. Used only by the rollback assertions below (`a_rolled_back_termination_unit_leaves_no_trace`);
/// every other test in this file uses the committing helper above instead.
fn simulate_discard_stop_path_rolled_back(
    conn: &mut rusqlite::Connection,
    run_id: &str,
    actor_id: &str,
) -> anyhow::Result<String> {
    let tx = conn.transaction()?;

    interrupt_agent_run_in_tx(&tx, run_id, actor_id)?;

    let status: String = tx.query_row(
        "SELECT status FROM sessions WHERE id = ?1",
        rusqlite::params![run_id],
        |row| row.get(0),
    )?;

    if latest_summary_for_run(&tx, run_id)?.is_none() {
        synthesize_fallback_summary(&tx, run_id, &status)?;
    }

    // Deliberately dropped, never committed — simulates a crash between the two writes above.
    drop(tx);
    Ok(status)
}

#[test]
fn discarding_a_run_with_an_agent_recorded_summary_leaves_it_present_and_the_run_interrupted() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard: agent summary present");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // The agent recorded its own closing summary BEFORE the discard's wait elapsed.
        create_summary(&mut conn, &run.id, "Watch out for the trailing comma bug.", "Use recursive descent")
            .expect("the agent's own create_summary call should succeed");

        let status = simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");
        assert_eq!(status, "interrupted", "the run must reach a terminal state (B1)");

        let summaries = list_summaries_for_story(&conn, &story.id)
            .expect("list_summaries_for_story should succeed");
        assert_eq!(summaries.len(), 1, "the agent's summary must be the ONLY one — no second, synthesized row");
        assert!(!summaries[0].is_stub, "an agent-authored summary must never be relabelled a stub (B1)");
        assert_eq!(summaries[0].next_session_must_know, "Watch out for the trailing comma bug.");
        assert_eq!(summaries[0].decisions, "Use recursive descent");
    });
}

#[test]
fn discarding_a_run_with_no_agent_summary_synthesizes_exactly_one_stub_fallback() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard: no agent summary");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // No report_summary call ever landed — the wait elapsed with nothing recorded.
        let status = simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");
        assert_eq!(status, "interrupted", "the run must reach a terminal state (B2)");

        let summaries = list_summaries_for_story(&conn, &story.id)
            .expect("list_summaries_for_story should succeed");
        assert_eq!(summaries.len(), 1, "exactly one fallback summary must exist (B2)");
        assert!(summaries[0].is_stub, "the fallback row must be flagged a stub (B2)");
        assert_eq!(summaries[0].agent_run_id, run.id);
    });
}

#[test]
fn discarding_an_already_terminal_run_writes_no_second_terminal_event() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard: already terminal");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // The run is ALREADY interrupted — e.g. a prior Stop, or a first discard — before this
        // second discard call ever runs.
        interrupt_agent_run(&mut conn, &run.id, &actor_id).expect("the first interrupt should succeed");
        assert_eq!(terminal_event_count(&conn, &run.id), 1);

        let status = simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
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
fn the_story_worktree_row_count_and_directory_are_unchanged_by_a_discard() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard: worktree untouched");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
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
                "SELECT COUNT(*) FROM worktrees WHERE story_id = ?1",
                rusqlite::params![story.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert!(std::path::Path::new(&worktree_path).is_dir(), "the worktree must exist on disk before the discard");

        simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let worktree_row_count_after: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM worktrees WHERE story_id = ?1",
                rusqlite::params![story.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(
            worktree_row_count_before, worktree_row_count_after,
            "the Story's worktree row count must be unchanged by a discard (B4)"
        );
        assert!(
            std::path::Path::new(&worktree_path).is_dir(),
            "the worktree directory must still exist on disk after a discard (B4) — discard removes nothing"
        );
    });
}

#[test]
fn no_prior_session_summary_row_is_removed_by_a_discard() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard: prior summaries preserved");

        // A first run, already closed with its own agent-authored summary — the "prior session"
        // this discard must not touch.
        let first_run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let prior_summary = create_summary(&mut conn, &first_run.id, "First session's work.", "")
            .expect("create_summary for the first run should succeed");
        interrupt_agent_run(&mut conn, &first_run.id, &actor_id).expect("closing the first run should succeed");

        // A second, live run against the SAME Story — this is the one being discarded.
        let second_run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed for the second run");

        simulate_discard_stop_path_in_tx(&mut conn, &second_run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let summaries = list_summaries_for_story(&conn, &story.id)
            .expect("list_summaries_for_story should succeed");
        assert_eq!(summaries.len(), 2, "the prior summary plus the second run's own fallback — nothing removed (B5)");
        assert!(
            summaries.iter().any(|s| s.id == prior_summary.id),
            "the first run's own summary row must still exist, byte-identical, after discarding a LATER run (B5)"
        );
        let second_run_summary = summaries
            .iter()
            .find(|s| s.agent_run_id == second_run.id)
            .expect("the second run must have gotten its own fallback summary");
        assert!(second_run_summary.is_stub, "the second run's fallback must be flagged a stub");
    });
}

#[test]
fn board_counts_are_unchanged_across_a_discard_when_the_agent_already_recorded_its_own_summary() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard counts: agent summary present");
        create_criterion(&mut conn, &actor_id, &story.id, "Ships without regressions")
            .expect("create_criterion should succeed");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        create_summary(&mut conn, &run.id, "Done.", "")
            .expect("create_summary should succeed");

        // The agent's summary is already on the board BEFORE the "before" snapshot — a discard
        // against this run should write NOTHING new to session_summaries (B1's "present" case).
        let before = board_counts(&conn);

        simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let after = board_counts(&conn);
        assert_eq!(before.worktrees, after.worktrees, "worktrees must be unchanged by a discard (T-04-38)");
        assert_eq!(before.sessions, after.sessions, "sessions row count must be unchanged by a discard (T-04-38)");
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
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard counts: no agent summary");
        create_criterion(&mut conn, &actor_id, &story.id, "Ships without regressions")
            .expect("create_criterion should succeed");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let before = board_counts(&conn);

        simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let after = board_counts(&conn);
        assert_eq!(before.worktrees, after.worktrees, "worktrees must be unchanged by a discard (T-04-38)");
        assert_eq!(before.sessions, after.sessions, "sessions row count must be unchanged by a discard (T-04-38)");
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
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard twice");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
            .expect("the first discard's stop path should succeed");
        let counts_after_first = board_counts(&conn);
        let terminal_events_after_first = terminal_event_count(&conn, &run.id);

        simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
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
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Discard: last-moment agent summary");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        // The agent's closing report_summary call landed just before the wait elapsed — modelled
        // here as "recorded, then the stop path runs", exactly like the present-summary test above
        // but asserting the NEGATIVE property explicitly: no second, stub row appears
        // alongside it.
        create_summary(&mut conn, &run.id, "Landed just in time.", "").expect("create_summary should succeed");

        simulate_discard_stop_path_in_tx(&mut conn, &run.id, &actor_id)
            .expect("the discard's stop path should succeed");

        let summaries = list_summaries_for_story(&conn, &story.id)
            .expect("list_summaries_for_story should succeed");
        assert_eq!(summaries.len(), 1, "the presence check must prevent a second, synthesized row");
        assert!(
            !summaries.iter().any(|s| s.is_stub),
            "no stub row may exist alongside an agent-authored one for the same run"
        );
    });
}

#[test]
fn an_unknown_run_id_is_a_harmless_no_op_for_the_discard_stop_path() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, _project, _repo_dir) = common::seeded_git_project();

        let unknown_run_id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
        // interrupt_agent_run is a harmless no-op for an unknown run (mirrors stop_lifecycle.rs's
        // own coverage); the status read that follows in stop_agent_run_recording_first's real
        // body would then fail — that failure mode belongs to the desktop-layer test, since this
        // crate has no equivalent of the DTO's own error propagation to assert against. What THIS
        // crate can and does assert: the interrupt call itself never panics and writes nothing.
        interrupt_agent_run(&mut conn, unknown_run_id, &actor_id)
            .expect("interrupting an unknown agent_run_id must be a harmless no-op");

        let sessions_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM sessions", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(sessions_count, 0, "an unknown run id must write no sessions row");
    });
}

/// D-64/CTX-01, gap #1 of 04-VERIFICATION.md: the crash-window assertion the pre-fix
/// two-transaction sequence could not satisfy. Running the termination unit inside a transaction
/// and rolling it back (never committing) must leave the run EXACTLY as it was — `running`, no
/// `ended_at`, zero terminal events for it, and the board's own aggregate
/// counts byte-identical to a snapshot taken before the call.
///
/// RED evidence, captured empirically before this fix landed: calling the pre-fix
/// `simulate_discard_stop_path` and then observing what "rollback" produced showed
/// `sessions.status` already committed as `"interrupted"` — never `"running"` — because
/// `interrupt_agent_run` opened and committed its OWN connection-level transaction before this
/// helper's caller ever had a transaction to roll back.
#[test]
fn a_rolled_back_termination_unit_leaves_no_trace() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Rollback: no trace");
        let run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let before = board_counts(&conn);

        let status = simulate_discard_stop_path_rolled_back(&mut conn, &run.id, &actor_id)
            .expect("the non-committing termination unit should succeed before its transaction is dropped");
        assert_eq!(status, "interrupted", "the in-tx write must still report the terminal status it wrote");

        let status_after_rollback: String = conn
            .query_row("SELECT status FROM sessions WHERE id = ?1", rusqlite::params![run.id], |row| {
                row.get(0)
            })
            .expect("sessions row should exist");
        assert_eq!(
            status_after_rollback, "running",
            "a crash mid-termination leaves the board exactly as it was: status running, never a terminal run without a narrative"
        );

        let ended_at: Option<String> = conn
            .query_row("SELECT ended_at FROM sessions WHERE id = ?1", rusqlite::params![run.id], |row| {
                row.get(0)
            })
            .expect("sessions row should exist");
        assert!(ended_at.is_none(), "a rolled-back termination unit must leave ended_at NULL");

        assert_eq!(
            terminal_event_count(&conn, &run.id),
            0,
            "a rolled-back termination unit must leave zero terminal events for the run"
        );

        let after = board_counts(&conn);
        assert_eq!(
            before, after,
            "a crash mid-termination must leave the board's own aggregate counts byte-identical to before the call"
        );
    });
}

/// The generalized contract over the two terminal variants named by 04-VERIFICATION.md's gap #1:
/// a run that holds a terminal status also holds at least one `session_summaries` row — there is
/// no committed state where one is true and the other is not. Variant one drives a run to terminal
/// through `apply_session_closed` (the natural-close path, `session_closed` event, reason
/// `completed`), exactly as `session_close_lifecycle.rs` already constructs one. Variant two drives
/// a second run to terminal through the committing Stop/Discard helper.
///
/// `mark_abandoned` is a THIRD path to a terminal `sessions` status (the launch reconciler's
/// verb for runs whose app died) and was, at the time this test was written, deliberately EXCLUDED
/// — `04-VERIFICATION.md` did not name it as a gap, and it wrote no summary of its own. Plan 05-09
/// closed that gap (the `STATE.md` warning it left open): `mark_abandoned` now writes a fallback
/// summary inside its own transaction too — see `launch_reconciliation.rs`'s own coverage of that
/// path. Left excluded from
/// THIS test rather than folded in, since this test's own mandate is the two gaps
/// `04-VERIFICATION.md` named, not every terminal path in the crate.
#[test]
fn a_terminal_transition_never_commits_without_a_summary() {
    with_scratch_worktree_root(|_| {
        let assert_terminal_has_summary = |conn: &rusqlite::Connection, run_id: &str, label: &str| {
            let status: String = conn
                .query_row("SELECT status FROM sessions WHERE id = ?1", rusqlite::params![run_id], |row| {
                    row.get(0)
                })
                .expect("sessions row should exist");
            assert!(
                matches!(status.as_str(), "completed" | "failed" | "interrupted" | "abandoned"),
                "{label}: expected a terminal status, got {status:?}"
            );

            let summary_count: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM session_summaries WHERE session_id = ?1",
                    rusqlite::params![run_id],
                    |row| row.get(0),
                )
                .expect("count query should succeed");
            assert!(
                summary_count >= 1,
                "{label}: a terminal run must hold at least one session_summaries row — there is no \
                 committed state where the run is terminal and no summary exists for it"
            );
        };

        // Variant one: natural close via apply_session_closed.
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Terminal-implies-summary: natural close");
        let natural_close_run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        let event = serde_json::json!({
            "type": "session_closed",
            "runId": natural_close_run.id,
            "reason": "completed",
            "result": { "totalCostUsd": 0.01, "inputTokens": 1, "outputTokens": 1 },
        });
        apply_session_closed(&mut conn, &event).expect("apply_session_closed should succeed");
        assert_terminal_has_summary(&conn, &natural_close_run.id, "variant one (natural close)");

        // Variant two: interrupt via the committing Stop/Discard termination unit.
        let interrupt_run = start_agent_run(&mut conn, &story.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed for the second run");
        simulate_discard_stop_path_in_tx(&mut conn, &interrupt_run.id, &actor_id)
            .expect("the committing termination unit should succeed");
        assert_terminal_has_summary(&conn, &interrupt_run.id, "variant two (Stop/Discard interrupt)");
    });
}
