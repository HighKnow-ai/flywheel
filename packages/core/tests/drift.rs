//! Four fact-based drift detectors (D-72, D-73, D-75, CTX-06) — one fire case and one non-fire
//! case per detector, plus the purity and ordering guarantees (Task 1). No database anywhere in
//! that section — `SummaryEntry` values are constructed directly, since `detect_drift` needs no
//! database at all. `04-PATTERNS.md` names this file as having no in-crate analog and borrows
//! `compaction.rs`'s pure-fold, fixture-free style as its structural template. Task 2 extends
//! this file with the packet-rendering behaviours (real board state, `common::seeded_project`),
//! and Task 3 extends it again with the clears-without-a-write proof, following
//! `session_summary_lifecycle.rs`'s `seeded_git_project`/`start_agent_run` fixture shape.

mod common;

use common::with_scratch_worktree_root;

use core::domain::session_summary::SummaryEntry;
use core::domain::agent_run::{
    close_agent_run, mark_abandoned, record_drift_warnings, start_agent_run, AgentRunStatus,
};
use core::domain::session_summary::{create_summary, DecisionEntry, SummaryFields};
use core::domain::task::create_task;
use core::domain::worktree::{ensure_worktree, reconcile_worktrees};
use core::drift::{decision_ids_on_record, detect_drift, DriftInputs, DriftKind, DriftWarning};
use core::query::recovery::{recovery_count_for_project, recovery_task_ids_for_project};

/// A minimal `SummaryEntry` a test can override selectively — `agent_run_id`/`created_at` carry
/// the ordinal so a failure names which entry it means.
fn summary(n: usize) -> SummaryEntry {
    SummaryEntry {
        agent_run_id: format!("run-{n}"),
        changed_files: Vec::new(),
        changed_prose: None,
        remains: None,
        next_session_must_know: None,
        decisions: Vec::new(),
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: false,
        created_at: format!("2026-01-{n:02}T00:00:00Z"),
    }
}

fn decision(id: &str) -> DecisionEntry {
    DecisionEntry { id: id.to_string(), statement: format!("statement for {id}") }
}

fn strings(items: &[&str]) -> Vec<String> {
    items.iter().map(|s| s.to_string()).collect()
}

// --- Detector 1: claimed files ---------------------------------------------------------------

#[test]
fn a_claimed_path_absent_from_the_real_list_fires_one_warning_naming_it() {
    let mut latest = summary(1);
    latest.changed_files = strings(&["a.txt", "b.txt", "c.txt"]);
    let summaries = vec![latest];
    let real = strings(&["a.txt", "b.txt"]);
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: Some(&real),
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    let warnings = detect_drift(&inputs);

    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].kind, DriftKind::ClaimedFilesMismatch);
    assert!(warnings[0].sentence.contains("c.txt"));
}

#[test]
fn every_claimed_path_present_in_the_real_list_fires_nothing() {
    let mut latest = summary(1);
    latest.changed_files = strings(&["a.txt", "b.txt"]);
    let summaries = vec![latest];
    // The real list holds MORE than claimed — under-reporting must not fire.
    let real = strings(&["a.txt", "b.txt", "c.txt"]);
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: Some(&real),
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    assert!(detect_drift(&inputs).is_empty());
}

#[test]
fn no_real_path_list_at_all_fires_nothing_for_claimed_files() {
    let mut latest = summary(1);
    latest.changed_files = strings(&["a.txt"]);
    let summaries = vec![latest];
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    assert!(detect_drift(&inputs).is_empty());
}

// --- Detector 2: staleness ---------------------------------------------------------------------

#[test]
fn a_diff_ref_behind_the_current_head_fires_one_warning() {
    let mut latest = summary(1);
    latest.diff_ref = Some("abc123".to_string());
    let summaries = vec![latest];
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: Some("def456"),
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    let warnings = detect_drift(&inputs);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].kind, DriftKind::StaleSinceLastSummary);
}

#[test]
fn a_matching_ref_and_a_clean_tree_fires_nothing() {
    let mut latest = summary(1);
    latest.diff_ref = Some("abc123".to_string());
    let summaries = vec![latest];
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: Some("abc123"),
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    assert!(detect_drift(&inputs).is_empty());
}

#[test]
fn a_matching_ref_but_a_dirty_working_tree_fires_one_warning_naming_uncommitted_work() {
    let mut latest = summary(1);
    latest.diff_ref = Some("abc123".to_string());
    let summaries = vec![latest];
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: Some("abc123"),
        working_tree_dirty: true,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    let warnings = detect_drift(&inputs);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].kind, DriftKind::StaleSinceLastSummary);
    assert!(warnings[0].sentence.to_lowercase().contains("uncommitted"));
}

// --- Detector 3: criteria revision ---------------------------------------------------------

#[test]
fn a_moved_criterion_id_fires_one_warning_naming_it() {
    let summaries: Vec<SummaryEntry> = Vec::new();
    let pinned = strings(&["c1", "c2", "c3"]);
    let current = strings(&["c1", "c2", "c4"]);

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: Some(&pinned),
        current_criterion_ids: &current,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    let warnings = detect_drift(&inputs);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].kind, DriftKind::CriteriaRevisionMoved);
    assert!(warnings[0].sentence.contains("c3"));
    assert!(warnings[0].sentence.contains("c4"));
}

#[test]
fn a_matching_criteria_set_fires_nothing() {
    let summaries: Vec<SummaryEntry> = Vec::new();
    let pinned = strings(&["c1", "c2"]);
    // Same set, different order — this detector compares as sets, never as ordered lists.
    let current = strings(&["c2", "c1"]);

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: Some(&pinned),
        current_criterion_ids: &current,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    assert!(detect_drift(&inputs).is_empty());
}

#[test]
fn a_null_pin_never_fires_the_revision_detector_even_with_a_changed_current_set() {
    let summaries: Vec<SummaryEntry> = Vec::new();
    let current = strings(&["c1", "c2", "c3"]);

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    assert!(detect_drift(&inputs).is_empty());
}

// --- Detector 4: decision read-back ----------------------------------------------------------

#[test]
fn an_unechoed_recorded_decision_fires_one_warning_naming_it() {
    let mut early = summary(1);
    early.decisions = vec![decision("d1"), decision("d2")];
    let mut latest = summary(2);
    latest.decisions = vec![decision("d3"), decision("d4")];
    // d3 never echoed back.
    latest.acknowledged_decisions = strings(&["d1", "d2", "d4"]);
    let summaries = vec![early, latest];
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    let warnings = detect_drift(&inputs);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].kind, DriftKind::UnacknowledgedDecision);
    assert!(warnings[0].sentence.contains("d3"));
}

#[test]
fn an_echoed_id_matching_no_recorded_decision_fires_one_warning_naming_the_fabrication() {
    let mut latest = summary(1);
    latest.decisions = vec![decision("d1")];
    latest.acknowledged_decisions = strings(&["d1", "d-ghost"]);
    let summaries = vec![latest];
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    let warnings = detect_drift(&inputs);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].kind, DriftKind::FabricatedDecisionEcho);
    assert!(warnings[0].sentence.contains("d-ghost"));
}

#[test]
fn every_id_echoed_with_no_extras_fires_nothing() {
    let mut latest = summary(1);
    latest.decisions = vec![decision("d1"), decision("d2")];
    latest.acknowledged_decisions = strings(&["d1", "d2"]);
    let summaries = vec![latest];
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    assert!(detect_drift(&inputs).is_empty());
}

#[test]
fn no_summaries_at_all_fires_nothing_for_the_read_back_detector() {
    let summaries: Vec<SummaryEntry> = Vec::new();
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    assert!(detect_drift(&inputs).is_empty());
}

// --- Purity and ordering ------------------------------------------------------------------

#[test]
fn two_calls_on_the_same_inputs_return_equal_vectors() {
    let mut latest = summary(1);
    latest.changed_files = strings(&["a.txt"]);
    latest.diff_ref = Some("abc".to_string());
    let summaries = vec![latest];
    let real = strings(&["z.txt"]);
    let pinned = strings(&["c1"]);
    let current = strings(&["c2"]);

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: Some(&real),
        head_ref: Some("def"),
        working_tree_dirty: true,
        pinned_criterion_ids: Some(&pinned),
        current_criterion_ids: &current,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };

    let first = detect_drift(&inputs);
    let second = detect_drift(&inputs);
    assert_eq!(first, second);
    assert!(
        !first.is_empty(),
        "this fixture should fire multiple detectors — an empty result would make this \
         assertion vacuous"
    );
}

#[test]
fn warnings_come_back_in_the_fixed_claimed_files_staleness_criteria_read_back_order() {
    let mut early = summary(1);
    early.decisions = vec![decision("d1")];
    let mut latest = summary(2);
    latest.changed_files = strings(&["a.txt"]);
    latest.diff_ref = Some("abc".to_string());
    latest.decisions = vec![decision("d2")];
    // Neither d1 nor d2 echoed — the read-back detector also fires.
    latest.acknowledged_decisions = Vec::new();
    let summaries = vec![early, latest];
    // a.txt not present in the real list — claimed files fires.
    let real = strings(&["z.txt"]);
    let pinned = strings(&["c1"]);
    // Criteria moved — fires.
    let current = strings(&["c2"]);

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: Some(&real),
        // Differs from diff_ref — staleness fires.
        head_ref: Some("def"),
        working_tree_dirty: false,
        pinned_criterion_ids: Some(&pinned),
        current_criterion_ids: &current,
        echoed_ids_on_record_beyond_scope: Some(&[]),
    };
    let warnings = detect_drift(&inputs);
    let kinds: Vec<DriftKind> = warnings.iter().map(|w| w.kind).collect();
    assert_eq!(
        kinds,
        vec![
            DriftKind::ClaimedFilesMismatch,
            DriftKind::StaleSinceLastSummary,
            DriftKind::CriteriaRevisionMoved,
            DriftKind::UnacknowledgedDecision,
        ]
    );
}

// ============================================================================================
// Task 2: the warning reaches the agent, at the top of the briefing
// ============================================================================================

// ============================================================================================
// Task 3: the warning clears the moment the underlying fact clears — no write, ever
// ============================================================================================

// ============================================================================================
// Plan 04-12 Task 1: a fired detector becomes a durable event — once per run, never on a preview
// ============================================================================================

fn sample_warnings(n: usize) -> Vec<DriftWarning> {
    (1..=n)
        .map(|i| DriftWarning {
            kind: if i % 2 == 1 {
                DriftKind::ClaimedFilesMismatch
            } else {
                DriftKind::StaleSinceLastSummary
            },
            sentence: format!("warning sentence {i}"),
        })
        .collect()
}

#[test]
fn record_drift_warnings_appends_one_drift_detected_event_per_warning() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Drift trail task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let warnings = sample_warnings(2);
        let appended = {
            let tx = conn.transaction().expect("failed to open transaction");
            let appended =
                record_drift_warnings(&tx, &run.id, &warnings, &actor_id, "2026-01-01T00:00:00Z")
                    .expect("record_drift_warnings should succeed");
            tx.commit().expect("failed to commit");
            appended
        };
        assert_eq!(appended, 2);

        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'drift.detected'",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(
            event_count, 2,
            "starting a run with two warnings must append exactly two drift events"
        );
    });
}

#[test]
fn record_drift_warnings_with_an_empty_slice_appends_nothing_and_returns_zero() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Quiet run task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let events_before: i64 = conn
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count query should succeed");

        let empty: Vec<DriftWarning> = Vec::new();
        let appended = {
            let tx = conn.transaction().expect("failed to open transaction");
            let appended =
                record_drift_warnings(&tx, &run.id, &empty, &actor_id, "2026-01-01T00:00:00Z")
                    .expect("record_drift_warnings should succeed");
            tx.commit().expect("failed to commit");
            appended
        };
        assert_eq!(appended, 0);

        let events_after: i64 = conn
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count query should succeed");
        assert_eq!(
            events_before, events_after,
            "a run with no warnings must append no drift event at all"
        );
    });
}

#[test]
fn record_drift_warnings_events_render_the_exact_sentence_the_agent_was_shown() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Wording task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let warning = DriftWarning {
            kind: DriftKind::StaleSinceLastSummary,
            sentence: "the exact sentence the agent read".to_string(),
        };
        {
            let tx = conn.transaction().expect("failed to open transaction");
            record_drift_warnings(
                &tx,
                &run.id,
                std::slice::from_ref(&warning),
                &actor_id,
                "2026-01-01T00:00:00Z",
            )
            .expect("record_drift_warnings should succeed");
            tx.commit().expect("failed to commit");
        }

        let (event_type, payload_text, task_id): (String, String, String) = conn
            .query_row(
                "SELECT event_type, payload, task_id FROM events \
                 WHERE stream_id = ?1 AND event_type = 'drift.detected'",
                rusqlite::params![run.id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("the drift event row should exist");
        let payload: serde_json::Value =
            serde_json::from_str(&payload_text).expect("payload should be valid JSON");
        assert_eq!(payload["sentence"], "the exact sentence the agent read");
        assert_eq!(task_id, task.id, "each drift event's task_id must be the run's own task");

        let rendered = core::domain::event::render_description(&event_type, &payload);
        assert_eq!(
            rendered, "the exact sentence the agent read",
            "the activity trail's rendered sentence must be the same sentence the agent was shown"
        );
    });
}

#[test]
fn record_drift_warnings_in_a_rolled_back_transaction_leaves_no_trace() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Rollback task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let warnings = sample_warnings(2);
        {
            let tx = conn.transaction().expect("failed to open transaction");
            let appended =
                record_drift_warnings(&tx, &run.id, &warnings, &actor_id, "2026-01-01T00:00:00Z")
                    .expect("record_drift_warnings should succeed");
            assert_eq!(appended, 2);
            // Deliberately dropped without commit — proves record_drift_warnings composes into
            // the CALLER's transaction rather than opening its own, matching set_run_blocked's
            // own reasoning: a caller that never commits leaves no trace.
        }

        let event_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'drift.detected'",
                rusqlite::params![run.id],
                |row| row.get(0),
            )
            .expect("count query should succeed");
        assert_eq!(event_count, 0, "a rolled-back transaction must leave no drift trail at all");
    });
}

// ============================================================================================
// Plan 04-12 Task 2: the board says so — drift as a third needs-you fact, not a fourth badge
// ============================================================================================

fn record_one_drift_warning(conn: &mut rusqlite::Connection, actor_id: &str, run_id: &str) {
    let warning = DriftWarning {
        kind: DriftKind::StaleSinceLastSummary,
        sentence: "drift".to_string(),
    };
    let tx = conn.transaction().expect("failed to open transaction");
    record_drift_warnings(&tx, run_id, std::slice::from_ref(&warning), actor_id, "2026-01-01T00:00:00Z")
        .expect("record_drift_warnings should succeed");
    tx.commit().expect("failed to commit");
}

#[test]
fn a_task_whose_latest_run_drifted_appears_in_the_recovery_set() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Drifted task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        record_one_drift_warning(&mut conn, &actor_id, &run.id);

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(ids, vec![task.id.clone()]);
        assert_eq!(count, 1);
        assert_eq!(count as usize, ids.len());
    });
}

#[test]
fn a_task_whose_latest_run_is_clean_does_not_appear_even_though_an_earlier_run_drifted() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Recovered task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");

        let first_run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        record_one_drift_warning(&mut conn, &actor_id, &first_run.id);
        close_agent_run(&mut conn, &first_run.id, AgentRunStatus::Completed, None, None, None)
            .expect("close_agent_run should succeed");

        // A second, later run for the SAME task — no drift recorded against it.
        let _second_run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        assert!(
            !ids.contains(&task.id),
            "a task whose MOST RECENT run is clean must not appear even though an earlier run drifted"
        );
    });
}

#[test]
fn a_task_with_both_a_missing_worktree_and_a_drift_signal_appears_exactly_once() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Both signals task", None)
            .expect("create_task should succeed");
        let worktree =
            ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        record_one_drift_warning(&mut conn, &actor_id, &run.id);

        std::fs::remove_dir_all(&worktree.path).expect("failed to delete the worktree directory");
        reconcile_worktrees(&mut conn, &actor_id).expect("reconcile_worktrees should succeed");

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert_eq!(
            ids,
            vec![task.id.clone()],
            "a task with a missing worktree AND a drift signal must appear exactly once"
        );
        assert_eq!(count, 1, "UNION ALL would double-count this task — UNION must not");
        assert_eq!(count as usize, ids.len());
    });
}

#[test]
fn a_project_with_only_clean_runs_reports_zero_recovery_items() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Clean task", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        close_agent_run(&mut conn, &run.id, AgentRunStatus::Completed, None, None, None)
            .expect("close_agent_run should succeed");

        let ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        assert!(ids.is_empty(), "a project with no drift and no other outstanding item must be empty");
        assert_eq!(count, 0);
    });
}

#[test]
fn count_and_ids_agree_when_drift_is_mixed_with_the_other_recovery_facts() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();

        // Task 1: drift only.
        let task1 = create_task(&mut conn, &project.id, &actor_id, "Drift only", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task1.id, &actor_id).expect("ensure_worktree should succeed");
        let run1 = start_agent_run(&mut conn, &task1.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        record_one_drift_warning(&mut conn, &actor_id, &run1.id);

        // Task 2: an unacknowledged abandoned run (the pre-existing arm) — never touched by drift.
        let task2 = create_task(&mut conn, &project.id, &actor_id, "Abandoned only", None)
            .expect("create_task should succeed");
        let run2 = start_agent_run(&mut conn, &task2.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        mark_abandoned(&mut conn, &run2.id, &actor_id, None).expect("mark_abandoned should succeed");

        // Task 3: healthy — no recovery item at all.
        create_task(&mut conn, &project.id, &actor_id, "Healthy", None)
            .expect("create_task should succeed");

        let mut ids = recovery_task_ids_for_project(&conn, &project.id)
            .expect("recovery_task_ids_for_project should succeed");
        ids.sort();
        let count = recovery_count_for_project(&conn, &project.id)
            .expect("recovery_count_for_project should succeed");

        let mut expected = vec![task1.id.clone(), task2.id.clone()];
        expected.sort();
        assert_eq!(ids, expected);
        assert_eq!(count, 2);
        assert_eq!(count as usize, ids.len());
    });
}

// --- D-05 (plan 13-02): the bound on the packet must not manufacture a false accusation ----------

/// One task with `count` summaries written through the real path. Summary 2 records decision
/// `D-X`; no other summary records one, so the in-scope recorded set is empty once summary 2 falls
/// out of the window. The latest summary acknowledges `latest_echoes`.
fn task_with_windowed_summaries(
    conn: &mut rusqlite::Connection,
    project_id: &str,
    actor_id: &str,
    count: usize,
    latest_echoes: &[&str],
) -> String {
    let task = create_task(conn, project_id, actor_id, "Windowed history", None)
        .expect("create_task should succeed");
    ensure_worktree(conn, &task.id, actor_id).expect("ensure_worktree should succeed");
    for n in 1..=count {
        let run = start_agent_run(conn, &task.id, "acceptEdits", actor_id)
            .expect("start_agent_run should succeed");
        let fields = SummaryFields {
            changed_files: Vec::new(),
            changed_prose: Some(format!("summary {n}")),
            remains: None,
            next_session_must_know: None,
            decisions: if n == 2 { vec![decision("D-X")] } else { Vec::new() },
            acknowledged_decisions: if n == count { strings(latest_echoes) } else { Vec::new() },
            diff_ref: None,
            auto_generated: false,
        };
        create_summary(conn, &run.id, fields, actor_id).expect("create_summary should succeed");
        close_agent_run(conn, &run.id, AgentRunStatus::Completed, None, None, None)
            .expect("close_agent_run should succeed");
    }
    task.id
}

#[test]
fn decision_ids_on_record_returns_only_the_ids_it_finds_in_first_seen_order() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = task_with_windowed_summaries(&mut conn, &project.id, &actor_id, 3, &[]);

        let candidates = strings(&["D-NOPE", "D-X", "D-X", "D-ALSO-NOPE"]);
        let found = decision_ids_on_record(&conn, &task, &candidates, &[])
            .expect("decision_ids_on_record should succeed");
        assert_eq!(found, strings(&["D-X"]));

        // Scoped to the task: another task's decision is not on this one's record.
        let other = create_task(&mut conn, &project.id, &actor_id, "Another task", None)
            .expect("create_task should succeed");
        let none = decision_ids_on_record(&conn, &other.id, &strings(&["D-X"]), &[])
            .expect("decision_ids_on_record should succeed");
        assert!(none.is_empty());
    });
}

#[test]
fn detect_drift_stays_pure_with_a_beyond_scope_list() {
    let mut latest = summary(1);
    latest.acknowledged_decisions = strings(&["D-OLD"]);
    let summaries = vec![latest];
    let beyond = strings(&["D-OLD"]);
    let current_criteria: Vec<String> = Vec::new();

    let inputs = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: Some(&beyond),
    };
    let first = detect_drift(&inputs);
    assert!(first.is_empty());
    assert_eq!(first, detect_drift(&inputs));
}

// --- plan 13-12: the lookup is ONE bounded statement, and a failed read never accuses -------------

use core::drift::MAX_ECHOED_DECISION_CANDIDATES;

/// One task whose single summary records every id in `ids` as a decision.
fn task_recording(conn: &mut rusqlite::Connection, project_id: &str, actor_id: &str, ids: &[String]) -> String {
    let task = create_task(conn, project_id, actor_id, "Records many", None).expect("create_task should succeed");
    ensure_worktree(conn, &task.id, actor_id).expect("ensure_worktree should succeed");
    let run = start_agent_run(conn, &task.id, "acceptEdits", actor_id).expect("start_agent_run should succeed");
    let fields = SummaryFields {
        changed_files: Vec::new(),
        changed_prose: None,
        remains: None,
        next_session_must_know: None,
        decisions: ids.iter().map(|id| decision(id)).collect(),
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: false,
    };
    create_summary(conn, &run.id, fields, actor_id).expect("create_summary should succeed");
    task.id
}

fn ids(prefix: &str, n: usize) -> Vec<String> {
    (0..n).map(|i| format!("{prefix}-{i:03}")).collect()
}

#[test]
fn an_empty_candidate_list_returns_empty_without_touching_the_database() {
    // A connection with no tables at all: any prepared statement would fail, so `Ok` proves none ran.
    let bare = rusqlite::Connection::open_in_memory().expect("in-memory db");
    let found = decision_ids_on_record(&bare, "any-task", &[], &[]).expect("empty input issues no statement");
    assert!(found.is_empty());
    // Candidates fully covered by the in-scope list reduce to empty too.
    let covered = decision_ids_on_record(&bare, "any-task", &strings(&["D-A"]), &strings(&["D-A"]))
        .expect("fully in-scope input issues no statement");
    assert!(covered.is_empty());
}

#[test]
fn duplicate_candidates_appear_at_most_once_in_first_seen_order() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = task_recording(&mut conn, &project.id, &actor_id, &strings(&["D-A", "D-B"]));
        let found = decision_ids_on_record(&conn, &task, &strings(&["D-B", "D-A", "D-B", "D-A"]), &[])
            .expect("lookup should succeed");
        assert_eq!(found, strings(&["D-B", "D-A"]));
    });
}

#[test]
fn ids_the_window_already_holds_are_not_looked_up() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = task_recording(&mut conn, &project.id, &actor_id, &strings(&["D-A", "D-B"]));
        let found = decision_ids_on_record(&conn, &task, &strings(&["D-A", "D-B"]), &strings(&["D-A"]))
            .expect("lookup should succeed");
        assert_eq!(found, strings(&["D-B"]));
    });
}

#[test]
fn the_candidate_cap_boundary_returns_exactly_the_cap_and_never_panics() {
    with_scratch_worktree_root(|_| {
        let cap = MAX_ECHOED_DECISION_CANDIDATES;
        let recorded = ids("D", cap + 10);
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = task_recording(&mut conn, &project.id, &actor_id, &recorded);

        // exactly the cap: every one returned
        let exact = decision_ids_on_record(&conn, &task, &recorded[..cap], &[]).expect("lookup");
        assert_eq!(exact, recorded[..cap].to_vec());
        // one fewer: at most that many
        let fewer = decision_ids_on_record(&conn, &task, &recorded[..cap - 1], &[]).expect("lookup");
        assert_eq!(fewer, recorded[..cap - 1].to_vec());
        // one more: truncated to the cap, the extra id is never considered
        let more = decision_ids_on_record(&conn, &task, &recorded[..cap + 1], &[]).expect("lookup");
        assert_eq!(more.len(), cap);
        assert_eq!(more, recorded[..cap].to_vec());
        // far more than the cap: still bounded
        let flood = decision_ids_on_record(&conn, &task, &recorded, &[]).expect("lookup");
        assert_eq!(flood.len(), cap);
    });
}

#[test]
fn a_malformed_decisions_blob_is_an_error_not_an_empty_list() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = task_recording(&mut conn, &project.id, &actor_id, &strings(&["D-A"]));
        conn.execute("UPDATE session_summaries SET decisions = 'not json' WHERE task_id = ?1", [&task])
            .expect("corrupt the blob");
        let result = decision_ids_on_record(&conn, &task, &strings(&["D-A"]), &[]);
        assert!(result.is_err(), "a failed read must surface as Err, got {result:?}");
    });
}

#[test]
fn a_none_lookup_result_omits_the_fabricated_echo_warning() {
    let mut latest = summary(1);
    latest.acknowledged_decisions = strings(&["D-OLD"]);
    let summaries = vec![latest];
    let current_criteria: Vec<String> = Vec::new();
    let base = DriftInputs {
        summaries: &summaries,
        real_changed_paths: None,
        head_ref: None,
        working_tree_dirty: false,
        pinned_criterion_ids: None,
        current_criterion_ids: &current_criteria,
        echoed_ids_on_record_beyond_scope: None,
    };
    assert!(detect_drift(&base).is_empty(), "None means the lookup did not run, not nothing on record");

    // The two-sided half: the same echo with a lookup that RAN and found nothing is fabricated.
    let ran = DriftInputs { echoed_ids_on_record_beyond_scope: Some(&[]), ..base };
    let warnings = detect_drift(&ran);
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].kind, DriftKind::FabricatedDecisionEcho);
}
