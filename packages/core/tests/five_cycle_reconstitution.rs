//! Phase 4's headline deliverable and the phase's own permission to ship (CTX-07, ROADMAP.md's
//! Phase 4 Notes research flag): one task driven through ten session cycles, each cycle exercised
//! through the SAME functions a real session calls — `start_agent_run`, `create_summary`,
//! `close_agent_run` — never a raw SQL insert, so a regression in the real write path fails here
//! too. No live model call and no network call anywhere in this file: `PITFALLS.md`'s "Looks Done
//! But Isn't" checklist names context reconstitution's most common failure mode as "tested only on
//! session 1 to 2," and WINDOWS.md rows 11 and 12 record two consecutive end-of-phase live-session
//! UAT runs failing on pre-existing flakiness unrelated to this phase's own diffs — an unrepeatable
//! harness would make the phase's headline evidence worse than no evidence at all. Driven
//! synthetically instead: a green run here is a statement about the code, not about the network or
//! the weather.
//!
//! Task 1 (this module's first four tests): the falsifying property itself — criteria fidelity
//! (byte-identical statements at cycle five and cycle ten), decision retention (every id recorded
//! across all ten cycles is still on the packet at the end), and the append-only guarantee at cycle
//! scale (exactly ten summary rows, with the first cycle's own row untouched by everything written
//! after it).
//!
//! Task 2 (the six tests that follow): the roadmap's "context-quality metrics," turned from a
//! phrase into six named assertions — bounded verbatim carry, no narrative leakage, decision
//! retention under folding as read from the RENDERED prompt (not merely the struct), per-cycle
//! determinism, zero drift false positives across ten honest cycles, and growth confined to the
//! folded region.

mod common;

use core::context_packet::assemble_context_packet;
use core::domain::acceptance_criterion::create_criterion;
use core::domain::agent_run::{close_agent_run, start_agent_run, AgentRunStatus};
use core::domain::session_summary::{
    create_summary, list_summaries_for_task, DecisionEntry, SessionSummary, SummaryFields,
};
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;

// Identical guard to `context_packet.rs`'s own — `FLYWHEEL_WORKTREE_ROOT` is process-wide state,
// and this file's own binary runs its `#[test]` fns concurrently by default.
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

/// The stable, cycle-derived decision id `run_one_cycle` writes and every later cycle's
/// `acknowledged_decisions` echoes back. `cycle` is 1-based throughout this file, matching the
/// compaction boundary's own `boundary_sentence` language ("Summaries 1-4 are folded").
fn decision_id_for_cycle(cycle: usize) -> String {
    format!("cycle-{cycle}-decision")
}

/// A marker substring unique to `cycle`, embedded in that cycle's `changed_prose` — Task 2's
/// leakage tests search for this string to prove a folded cycle's prose is genuinely gone from the
/// rendered prompt, not merely unrendered somewhere else.
fn prose_marker_for_cycle(cycle: usize) -> String {
    format!("prose-marker-cycle-{cycle}")
}

/// A marker substring unique to `cycle`'s decision statement — Task 2's retention-under-folding
/// test searches for these across the whole ten-cycle span.
fn decision_marker_for_cycle(cycle: usize) -> String {
    format!("decision-marker-cycle-{cycle}")
}

/// One cycle, driven through the real production write path — `start_agent_run`, `create_summary`,
/// `close_agent_run` — exactly as a real session does. Two changed files derived from `cycle`, one
/// decision entry with a stable cycle-derived id, and `acknowledged_decisions` echoing every
/// decision id recorded by this cycle and every one before it — precisely what a real closing
/// session that read the board's Decisions On Record section and acknowledged all of it would
/// send. Returns the recorded [`SessionSummary`] so callers can capture a cycle's own row for a
/// later byte-identical comparison.
fn run_one_cycle(
    conn: &mut rusqlite::Connection,
    task_id: &str,
    actor_id: &str,
    cycle: usize,
) -> SessionSummary {
    let run = start_agent_run(conn, task_id, "acceptEdits", actor_id)
        .unwrap_or_else(|e| panic!("start_agent_run should succeed for cycle {cycle}: {e}"));

    let decision_id = decision_id_for_cycle(cycle);
    let acknowledged_decisions: Vec<String> = (1..=cycle).map(decision_id_for_cycle).collect();

    let fields = SummaryFields {
        changed_files: vec![
            format!("src/cycle-{cycle}-a.rs"),
            format!("src/cycle-{cycle}-b.rs"),
        ],
        changed_prose: Some(format!(
            "{} — cycle {cycle}'s own narrative.",
            prose_marker_for_cycle(cycle)
        )),
        remains: None,
        next_session_must_know: None,
        decisions: vec![DecisionEntry {
            id: decision_id,
            statement: format!(
                "{} — decided something in cycle {cycle}.",
                decision_marker_for_cycle(cycle)
            ),
        }],
        acknowledged_decisions,
        diff_ref: None,
        auto_generated: false,
    };

    let summary = create_summary(conn, &run.id, fields, actor_id)
        .unwrap_or_else(|e| panic!("create_summary should succeed for cycle {cycle}: {e}"));

    close_agent_run(conn, &run.id, AgentRunStatus::Completed, None, None, None)
        .unwrap_or_else(|e| panic!("close_agent_run should succeed for cycle {cycle}: {e}"));

    summary
}

/// Seed one project/task/three-criteria fixture, shared by every test in this file.
fn seed_task_with_three_criteria(
    conn: &mut rusqlite::Connection,
    project_id: &str,
    actor_id: &str,
    task_name: &str,
) -> core::domain::task::Task {
    let task = create_task(conn, project_id, actor_id, task_name, None)
        .expect("create_task should succeed");
    create_criterion(
        conn,
        project_id,
        actor_id,
        "task",
        &task.id,
        "First criterion, present before any cycle runs",
        Some("run the test"),
    )
    .expect("create_criterion 1 should succeed");
    create_criterion(
        conn,
        project_id,
        actor_id,
        "task",
        &task.id,
        "Second criterion, present before any cycle runs",
        None,
    )
    .expect("create_criterion 2 should succeed");
    create_criterion(
        conn,
        project_id,
        actor_id,
        "task",
        &task.id,
        "Third criterion, present before any cycle runs",
        Some("check it manually"),
    )
    .expect("create_criterion 3 should succeed");
    ensure_worktree(conn, &task.id, actor_id).expect("ensure_worktree should succeed");
    task
}

#[test]
fn criteria_statements_are_byte_identical_at_cycle_five_and_cycle_ten() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Criteria fidelity across ten cycles",
        );

        let captured = assemble_context_packet(&conn, &task.id)
            .expect("assembly before any cycle should succeed")
            .criteria;
        assert_eq!(captured.len(), 3, "the fixture must seed exactly three criteria");

        for cycle in 1..=5 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }
        let at_five = assemble_context_packet(&conn, &task.id)
            .expect("assembly at cycle five should succeed")
            .criteria;
        assert_eq!(
            at_five, captured,
            "the criteria vector must be byte-identical, element for element and in the same \
             order, after five cycles — a criterion's statement or hint must never drift merely \
             because sessions came and went"
        );

        for cycle in 6..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }
        let at_ten = assemble_context_packet(&conn, &task.id)
            .expect("assembly at cycle ten should succeed")
            .criteria;
        assert_eq!(
            at_ten, captured,
            "the criteria vector must still be byte-identical after ten cycles — this is the \
             property that must survive more than the first fold, not merely the first one"
        );
    });
}

#[test]
fn every_decision_recorded_across_ten_cycles_is_present_in_the_packet_at_cycle_ten() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Decision retention across ten cycles",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        let recorded_ids: std::collections::HashSet<String> =
            (1..=10).map(decision_id_for_cycle).collect();
        let packet_ids: std::collections::HashSet<String> =
            packet.decisions.iter().map(|d| d.id.clone()).collect();

        assert_eq!(
            packet.decisions.len(),
            10,
            "every one of the ten cycles wrote exactly one decision — none may be missing or \
             duplicated in the accumulated list"
        );
        assert_eq!(
            packet_ids, recorded_ids,
            "the packet's decisions must contain every id written across all ten cycles, and no \
             id that was never written"
        );
    });
}

#[test]
fn the_summary_row_count_for_the_task_is_exactly_ten_at_the_end() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "Append-only row count across ten cycles",
        );

        for cycle in 1..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let summaries =
            list_summaries_for_task(&conn, &task.id).expect("list_summaries_for_task should succeed");
        assert_eq!(
            summaries.len(),
            10,
            "ten cycles must leave exactly ten summary rows — nothing overwritten in place"
        );
    });
}

#[test]
fn the_first_cycles_summary_content_is_byte_identical_at_the_end() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = seed_task_with_three_criteria(
            &mut conn,
            &project.id,
            &actor_id,
            "First row untouched across ten cycles",
        );

        let first_written = run_one_cycle(&mut conn, &task.id, &actor_id, 1);
        for cycle in 2..=10 {
            run_one_cycle(&mut conn, &task.id, &actor_id, cycle);
        }

        let summaries =
            list_summaries_for_task(&conn, &task.id).expect("list_summaries_for_task should succeed");
        let first_read_back = summaries
            .first()
            .expect("at least one summary row must exist");

        assert_eq!(first_read_back.changed_files, first_written.changed_files);
        assert_eq!(first_read_back.changed_prose, first_written.changed_prose);
        assert_eq!(first_read_back.remains, first_written.remains);
        assert_eq!(
            first_read_back.next_session_must_know, first_written.next_session_must_know,
            "the first cycle's own row must be byte-identical to what it was written with, even \
             after nine more cycles have since been recorded"
        );
    });
}
