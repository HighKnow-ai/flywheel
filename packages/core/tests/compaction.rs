//! `compact_summaries` (04-05-PLAN.md Task 2, D-68, D-69, CTX-05): the threshold proven from
//! both sides, with no database anywhere in this file. `04-PATTERNS.md` names `git.rs`'s own
//! `#[cfg(test)] mod git_version_tests` as this file's structural template — plain `#[test]`
//! functions, no `mod common;`, no `Connection`. Fixtures are built by constructing
//! [`SummaryEntry`] values directly, since compaction touches no database at all — this is the
//! phase's fastest feedback loop precisely because it needs none.

use core::compaction::compact_summaries;
use core::context_packet::SummaryEntry;
use core::domain::session_summary::DecisionEntry;

/// Build a `SummaryEntry` for ordinal `n` — `agent_run_id`/`created_at` derived from the ordinal
/// so assertions can name which entry they mean, two changed-file paths, two decision entries
/// whose ids and statements carry the ordinal, and populated `changed_prose`/`remains`/
/// `next_session_must_know` so the narrative-is-gone test has real text to look for.
fn entry(n: usize) -> SummaryEntry {
    SummaryEntry {
        agent_run_id: format!("run-{n}"),
        changed_files: vec![format!("src/file-{n}-a.rs"), format!("src/file-{n}-b.rs")],
        changed_prose: Some(format!("changed prose for summary {n}")),
        remains: Some(format!("remains text for summary {n}")),
        next_session_must_know: Some(format!("next-session note for summary {n}")),
        decisions: vec![
            DecisionEntry {
                id: format!("dec-{n}-1"),
                statement: format!("decision {n}.1"),
            },
            DecisionEntry {
                id: format!("dec-{n}-2"),
                statement: format!("decision {n}.2"),
            },
        ],
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: false,
        created_at: format!("2026-01-{n:02}T00:00:00Z"),
    }
}

/// `n` entries, oldest-first, ordinals `1..=n` — the order `list_summaries_for_task` already
/// guarantees and `compact_summaries` assumes.
fn entries(n: usize) -> Vec<SummaryEntry> {
    (1..=n).map(entry).collect()
}

#[test]
fn zero_summaries_fold_to_an_empty_history_with_no_boundary() {
    let history = compact_summaries(&[]);
    assert!(history.folded.is_empty());
    assert!(history.verbatim.is_empty());
    assert_eq!(history.boundary.total, 0);
    assert_eq!(history.boundary.folded_count, 0);
    assert_eq!(history.boundary.verbatim_count, 0);
    assert_eq!(history.boundary.boundary_sentence(), None);
}

#[test]
fn one_summary_is_carried_verbatim_with_no_boundary() {
    let entries = entries(1);
    let history = compact_summaries(&entries);
    assert!(history.folded.is_empty());
    assert_eq!(history.verbatim.len(), 1);
    assert_eq!(history.boundary.boundary_sentence(), None);
}

#[test]
fn exactly_four_summaries_fold_nothing() {
    let entries = entries(4);
    let history = compact_summaries(&entries);
    assert!(history.folded.is_empty());
    assert_eq!(history.verbatim.len(), 4);
    assert_eq!(history.boundary.boundary_sentence(), None);
}

#[test]
fn exactly_five_summaries_fold_nothing_the_window_is_inclusive() {
    let entries = entries(5);
    let history = compact_summaries(&entries);
    assert!(history.folded.is_empty());
    assert_eq!(history.verbatim.len(), 5);
    assert_eq!(history.boundary.boundary_sentence(), None);
}

#[test]
fn exactly_six_summaries_fold_exactly_the_oldest_one() {
    let entries = entries(6);
    let history = compact_summaries(&entries);
    assert_eq!(history.folded.len(), 1);
    assert_eq!(history.verbatim.len(), 5);
    let sentence = history
        .boundary
        .boundary_sentence()
        .expect("six summaries should produce a boundary sentence");
    assert_eq!(sentence, "Summaries 1 are folded; 2-6 are carried verbatim.");
}

#[test]
fn nine_summaries_fold_four_and_carry_five_verbatim() {
    let entries = entries(9);
    let history = compact_summaries(&entries);
    assert_eq!(history.folded.len(), 4);
    assert_eq!(history.verbatim.len(), 5);
    assert_eq!(history.boundary.folded_range, Some((1, 4)));
    assert_eq!(history.boundary.verbatim_range, Some((5, 9)));
}

#[test]
fn the_boundary_sentence_for_nine_summaries_matches_the_exact_expected_string() {
    let entries = entries(9);
    let history = compact_summaries(&entries);
    let sentence = history
        .boundary
        .boundary_sentence()
        .expect("nine summaries should produce a boundary sentence");
    assert_eq!(sentence, "Summaries 1-4 are folded; 5-9 are carried verbatim.");
}

#[test]
fn a_folded_summary_keeps_every_decision_and_every_changed_file_in_order() {
    let entries = entries(6);
    let history = compact_summaries(&entries);
    assert_eq!(history.folded.len(), 1);
    // Asserted on identity, not on length — the folded summary's decisions/changed_files
    // vectors are equal to the source entry's, element for element.
    assert_eq!(history.folded[0].decisions, entries[0].decisions);
    assert_eq!(history.folded[0].changed_files, entries[0].changed_files);
}

#[test]
fn a_folded_summary_of_an_auto_generated_run_keeps_that_flag() {
    let mut entries = entries(6);
    entries[0].auto_generated = true;
    let history = compact_summaries(&entries);
    assert_eq!(history.folded.len(), 1);
    assert!(history.folded[0].auto_generated);
}

#[test]
fn narrative_is_dropped_structurally_not_just_unrendered() {
    let entries = entries(6);
    let history = compact_summaries(&entries);
    assert_eq!(history.folded.len(), 1);

    // Serialising the folded vector must not contain the folded entry's own prose text — this
    // proves the drop is structural (the type has no field to carry it), not merely a rendering
    // choice made somewhere downstream.
    let json = serde_json::to_string(&history.folded).expect("folded vector should serialise");
    assert!(!json.contains("changed prose for summary 1"));
    assert!(!json.contains("remains text for summary 1"));
    assert!(!json.contains("next-session note for summary 1"));
}

#[test]
fn two_compact_summaries_calls_on_the_same_input_are_equal() {
    let entries = entries(9);
    let first = compact_summaries(&entries);
    let second = compact_summaries(&entries);
    assert_eq!(first, second);
}

#[test]
fn folded_and_verbatim_vectors_are_each_oldest_first_and_concatenate_to_the_original_order() {
    let entries = entries(9);
    let history = compact_summaries(&entries);

    let folded_ids: Vec<&str> = history.folded.iter().map(|s| s.agent_run_id.as_str()).collect();
    assert_eq!(folded_ids, vec!["run-1", "run-2", "run-3", "run-4"]);

    let verbatim_ids: Vec<&str> =
        history.verbatim.iter().map(|s| s.agent_run_id.as_str()).collect();
    assert_eq!(verbatim_ids, vec!["run-5", "run-6", "run-7", "run-8", "run-9"]);

    let concatenated: Vec<&str> = folded_ids.into_iter().chain(verbatim_ids).collect();
    let original: Vec<&str> = entries.iter().map(|s| s.agent_run_id.as_str()).collect();
    assert_eq!(concatenated, original);
}
