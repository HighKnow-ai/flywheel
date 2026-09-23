//! Four fact-based drift detectors (D-72, D-73, D-75, CTX-06) — one fire case and one non-fire
//! case per detector, plus the purity and ordering guarantees (Task 1). No database anywhere in
//! that section — `SummaryEntry` values are constructed directly, since `detect_drift` needs no
//! database at all. `04-PATTERNS.md` names this file as having no in-crate analog and borrows
//! `compaction.rs`'s pure-fold, fixture-free style as its structural template. Task 2 extends
//! this file with the packet-rendering behaviours (real board state, `common::seeded_project`),
//! and Task 3 extends it again with the clears-without-a-write proof, following
//! `session_summary_lifecycle.rs`'s `seeded_git_project`/`start_agent_run` fixture shape.

mod common;

use core::context_packet::{
    assemble_context_packet, assemble_context_packet_with_extras, render_prompt, PacketExtras,
    SummaryEntry,
};
use core::domain::agent_run::start_agent_run;
use core::domain::epic::create_epic;
use core::domain::session_summary::{create_summary, DecisionEntry, SummaryFields};
use core::domain::task::create_task;
use core::domain::worktree::ensure_worktree;
use core::drift::{detect_drift, DriftInputs, DriftKind, DriftWarning};

// `FLYWHEEL_WORKTREE_ROOT` is process-wide state (mirrors `context_packet.rs`'s own
// `WORKTREE_ROOT_ENV_LOCK` — each `tests/*.rs` file is its own binary, so this lock only needs to
// scope Task 3's two tests against each other, never against another file).
static WORKTREE_ROOT_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn with_scratch_worktree_root<T>(f: impl FnOnce() -> T) -> T {
    let _guard = WORKTREE_ROOT_ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let dir = tempfile::tempdir().expect("failed to create scratch worktree root");
    // SAFETY: serialised by `WORKTREE_ROOT_ENV_LOCK` above.
    unsafe { std::env::set_var("FLYWHEEL_WORKTREE_ROOT", dir.path()) };
    let result = f();
    unsafe { std::env::remove_var("FLYWHEEL_WORKTREE_ROOT") };
    result
}

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

#[test]
fn two_warnings_render_both_sentences_before_the_epic_heading() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "An epic", None)
        .expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Warned task", Some(&epic.id))
        .expect("create_task should succeed");

    let warnings = vec![
        DriftWarning {
            kind: DriftKind::ClaimedFilesMismatch,
            sentence: "first warning sentence".to_string(),
        },
        DriftWarning {
            kind: DriftKind::StaleSinceLastSummary,
            sentence: "second warning sentence".to_string(),
        },
    ];
    let packet = assemble_context_packet_with_extras(
        &conn,
        &task.id,
        PacketExtras { diff: None, drift: warnings },
    )
    .expect("assembly should succeed");

    let prompt = render_prompt(&packet, "");
    let warnings_pos = prompt.find("## Warnings").expect("warnings heading must be present");
    let epic_pos = prompt.find("## Epic Context").expect("epic heading must be present");
    assert!(warnings_pos < epic_pos, "warnings heading must appear before the epic heading");
    assert!(prompt.contains("first warning sentence"));
    assert!(prompt.contains("second warning sentence"));
}

#[test]
fn no_warnings_renders_no_warnings_heading_at_all() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Quiet task", None)
        .expect("create_task should succeed");

    let packet = assemble_context_packet_with_extras(
        &conn,
        &task.id,
        PacketExtras { diff: None, drift: Vec::new() },
    )
    .expect("assembly should succeed");

    let prompt = render_prompt(&packet, "");
    assert!(!prompt.contains("## Warnings"));
}

#[test]
fn two_renders_of_the_same_packet_are_byte_identical_with_warnings_present() {
    let (mut conn, actor_id, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Determinism task", None)
        .expect("create_task should succeed");

    let warnings = vec![DriftWarning {
        kind: DriftKind::CriteriaRevisionMoved,
        sentence: "criteria moved sentence".to_string(),
    }];
    let packet = assemble_context_packet_with_extras(
        &conn,
        &task.id,
        PacketExtras { diff: None, drift: warnings },
    )
    .expect("assembly should succeed");

    let first = render_prompt(&packet, "");
    let second = render_prompt(&packet, "");
    assert_eq!(first, second);
}

// ============================================================================================
// Task 3: the warning clears the moment the underlying fact clears — no write, ever
// ============================================================================================

fn claim_only_fields(claimed_path: &str) -> SummaryFields {
    SummaryFields {
        changed_files: vec![claimed_path.to_string()],
        changed_prose: None,
        remains: None,
        next_session_must_know: None,
        decisions: Vec::new(),
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: false,
    }
}

#[test]
fn a_claimed_path_the_real_diff_does_not_contain_produces_a_warning_in_the_assembled_packet() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Ghost claim", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        create_summary(&mut conn, &run.id, claim_only_fields("ghost.txt"), &actor_id)
            .expect("create_summary should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        // The real diff does not contain the claimed path.
        let real_paths: Vec<String> = vec!["real.txt".to_string()];
        let current_criteria: Vec<String> = Vec::new();
        let inputs = DriftInputs {
            summaries: &packet.summaries,
            real_changed_paths: Some(&real_paths),
            head_ref: None,
            working_tree_dirty: false,
            pinned_criterion_ids: None,
            current_criterion_ids: &current_criteria,
        };
        let drift = detect_drift(&inputs);
        assert_eq!(drift.len(), 1);
        assert_eq!(drift[0].kind, DriftKind::ClaimedFilesMismatch);

        let packet = assemble_context_packet_with_extras(
            &conn,
            &task.id,
            PacketExtras { diff: None, drift },
        )
        .expect("assembly with extras should succeed");
        let prompt = render_prompt(&packet, "");
        assert!(prompt.contains("## Warnings"));
        assert!(prompt.contains("ghost.txt"));
    });
}

#[test]
fn the_same_claim_produces_no_warning_once_the_path_really_exists_in_the_diff() {
    with_scratch_worktree_root(|| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Ghost claim clears", None)
            .expect("create_task should succeed");
        ensure_worktree(&mut conn, &task.id, &actor_id).expect("ensure_worktree should succeed");
        let run = start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");
        create_summary(&mut conn, &run.id, claim_only_fields("ghost.txt"), &actor_id)
            .expect("create_summary should succeed");

        let packet = assemble_context_packet(&conn, &task.id).expect("assembly should succeed");
        // No write happened to the summary row between the two assemblies — only the real-diff
        // fact fed into `detect_drift` changed, proving the warning clears by itself.
        let real_paths: Vec<String> = vec!["ghost.txt".to_string()];
        let current_criteria: Vec<String> = Vec::new();
        let inputs = DriftInputs {
            summaries: &packet.summaries,
            real_changed_paths: Some(&real_paths),
            head_ref: None,
            working_tree_dirty: false,
            pinned_criterion_ids: None,
            current_criterion_ids: &current_criteria,
        };
        let drift = detect_drift(&inputs);
        assert!(drift.is_empty(), "a claim that now matches the real diff must fire nothing");

        let packet = assemble_context_packet_with_extras(
            &conn,
            &task.id,
            PacketExtras { diff: None, drift },
        )
        .expect("assembly with extras should succeed");
        let prompt = render_prompt(&packet, "");
        assert!(!prompt.contains("## Warnings"));
    });
}
