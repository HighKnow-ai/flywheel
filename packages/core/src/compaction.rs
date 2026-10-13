//! Compaction (D-68, D-69, CTX-05): the pure Rust fold that keeps a task's session-summary
//! history bounded without ever asking a model to summarize a summary.
//!
//! Three contracts this file lives under. First, it is a pure fold: no database connection, no
//! process, no network call, no clock read — its output depends only on its argument, so two
//! calls on the same input are always equal. Second, and the phrase to hold on to: compaction is
//! **lossless for decisions and for file paths, total for narrative** — every `decisions` entry
//! and every `changed_files` path in a folded summary survives, while its prose (`changed_prose`,
//! `remains`, `next_session_must_know`) is dropped entirely, not shortened. Third, nothing in
//! here shortens a value or caps a size: there is no character count, no token count and no size
//! ceiling anywhere in the fold, because a size ceiling would move the boundary for reasons a
//! developer cannot see — exactly the alternative D-69 rejected. `PITFALLS.md`'s pitfall 3 names
//! the failure this module refuses to become: "resist the temptation to save tokens by
//! summarizing summaries." The only thing that decides what is kept whole and what is dropped
//! whole is a summary's position in the list, oldest-first, never its content.

use crate::context_packet::SummaryEntry;
use crate::domain::session_summary::DecisionEntry;
use serde::Serialize;

/// The verbatim window (D-69): a fixed count of 5, not configurable — the same instinct as
/// D-23's fixed worktree root and D-24's fixed branch names. This is declared exactly once, and
/// no function in this crate accepts a window size as a parameter. A fixed count is what makes
/// the compaction boundary arithmetic a developer can state out loud ("summaries 1-4 are folded,
/// 5-9 are verbatim") instead of a size ceiling they would have to reverse-engineer from
/// behaviour, and it is what gives CTX-07's five-cycle test exactly one assertion to make about
/// where folding begins.
pub const VERBATIM_WINDOW: usize = 5;

/// What survives the fold for one summary past the verbatim window (D-68). The narrative fields
/// — `changed_prose`, `remains`, `next_session_must_know` — are absent from this type entirely,
/// not present-and-empty: that is what makes "total for narrative" a property a reader can check
/// by reading the struct, rather than a promise a test alone would have to keep. `auto_generated`
/// travels with the row so a reader can still tell the core synthesized it, even folded.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompactedSummary {
    pub agent_run_id: String,
    pub created_at: String,
    pub auto_generated: bool,
    pub changed_files: Vec<String>,
    pub decisions: Vec<DecisionEntry>,
}

/// The fold's own accounting of where it split the list (CTX-05). Both ranges are **1-based
/// inclusive ordinals** over the oldest-first input list, so [`CompactionBoundary::boundary_sentence`]
/// reads as arithmetic rather than as an index calculation at the call site. `folded_range` and
/// `verbatim_range` are `None` exactly when their respective count is `0` — an empty range is
/// never represented as `Some((0, 0))` or any other placeholder pair.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompactionBoundary {
    pub total: usize,
    pub folded_count: usize,
    pub verbatim_count: usize,
    pub folded_range: Option<(usize, usize)>,
    pub verbatim_range: Option<(usize, usize)>,
}

/// Render an inclusive 1-based ordinal range as a string a person can read aloud — `"5-9"` for a
/// multi-entry range, or the bare ordinal (`"1"`) when the range names exactly one summary,
/// avoiding the visually odd `"1-1"` for the single-folded-summary case (exactly six summaries).
fn ordinal_range_str(range: (usize, usize)) -> String {
    let (start, end) = range;
    if start == end {
        start.to_string()
    } else {
        format!("{start}-{end}")
    }
}

impl CompactionBoundary {
    /// The boundary as a sentence a person can say out loud (CTX-05), or `None` when nothing
    /// folded — a task with four or five summaries has no boundary to name, because the window
    /// is inclusive and the threshold value itself is entirely verbatim. Uses an ASCII hyphen,
    /// never an en dash: this string is compared byte-for-byte by CTX-04's determinism
    /// assertions and is rendered directly into a prompt.
    pub fn boundary_sentence(&self) -> Option<String> {
        if self.folded_count == 0 {
            return None;
        }
        let folded = self
            .folded_range
            .expect("folded_count > 0 implies folded_range is Some");
        let verbatim = self
            .verbatim_range
            .expect("at least one summary total means verbatim is never empty");
        Some(format!(
            "Summaries {} are folded; {} are carried verbatim.",
            ordinal_range_str(folded),
            ordinal_range_str(verbatim)
        ))
    }
}

/// The fold's full result (D-68): the oldest entries folded into [`CompactedSummary`], the most
/// recent [`VERBATIM_WINDOW`] carried through unchanged as [`SummaryEntry`], and the boundary
/// that names the split between them.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompactedHistory {
    pub folded: Vec<CompactedSummary>,
    pub verbatim: Vec<SummaryEntry>,
    pub boundary: CompactionBoundary,
}

/// Fold `summaries` past the verbatim window (D-68, CTX-05) — a pure function over the packet's
/// own [`SummaryEntry`] values, so no conversion layer sits between the assembler and the fold.
/// `summaries` is assumed oldest-first, the order [`crate::domain::session_summary::list_summaries_for_task`]
/// already guarantees. Splits at `summaries.len().saturating_sub(VERBATIM_WINDOW)`: everything
/// before that index folds (narrative dropped, decisions and file paths kept, in order);
/// everything from it on is carried verbatim by clone. There is no branch on content anywhere in
/// this function — only on position. Two calls on the same slice return equal [`CompactedHistory`]
/// values, since nothing here reads anything outside its argument.
pub fn compact_summaries(summaries: &[SummaryEntry]) -> CompactedHistory {
    let total = summaries.len();
    let split = total.saturating_sub(VERBATIM_WINDOW);

    let folded: Vec<CompactedSummary> = summaries[..split]
        .iter()
        .map(|entry| CompactedSummary {
            agent_run_id: entry.agent_run_id.clone(),
            created_at: entry.created_at.clone(),
            auto_generated: entry.auto_generated,
            changed_files: entry.changed_files.clone(),
            decisions: entry.decisions.clone(),
        })
        .collect();

    let verbatim: Vec<SummaryEntry> = summaries[split..].to_vec();

    let folded_count = folded.len();
    let verbatim_count = verbatim.len();

    let folded_range = if folded_count == 0 {
        None
    } else {
        Some((1, folded_count))
    };
    let verbatim_range = if verbatim_count == 0 {
        None
    } else {
        Some((split + 1, total))
    };

    let boundary = CompactionBoundary {
        total,
        folded_count,
        verbatim_count,
        folded_range,
        verbatim_range,
    };

    CompactedHistory { folded, verbatim, boundary }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a bare-minimum [`SummaryEntry`] for ordinal `n`, following `git.rs`'s own
    /// pure-function test style — no database, no fixture module. The exhaustive precision and
    /// boundary cases live in `tests/compaction.rs`; these two are smoke tests only.
    fn summary_entry(n: usize) -> SummaryEntry {
        SummaryEntry {
            agent_run_id: format!("run-{n}"),
            changed_files: vec![format!("file-{n}.rs")],
            changed_prose: Some(format!("prose-{n}")),
            remains: Some(format!("remains-{n}")),
            next_session_must_know: Some(format!("next-{n}")),
            decisions: vec![DecisionEntry {
                id: format!("dec-{n}"),
                statement: format!("statement-{n}"),
            }],
            acknowledged_decisions: Vec::new(),
            diff_ref: None,
            auto_generated: false,
            created_at: format!("2026-01-{n:02}T00:00:00Z"),
        }
    }

    #[test]
    fn zero_summaries_fold_to_an_empty_history_with_no_boundary() {
        let history = compact_summaries(&[]);
        assert!(history.folded.is_empty());
        assert!(history.verbatim.is_empty());
        assert_eq!(history.boundary.total, 0);
        assert_eq!(history.boundary.boundary_sentence(), None);
    }

    #[test]
    fn exactly_six_summaries_fold_exactly_the_oldest_one() {
        let entries: Vec<SummaryEntry> = (1..=6).map(summary_entry).collect();
        let history = compact_summaries(&entries);

        assert_eq!(history.folded.len(), 1);
        assert_eq!(history.verbatim.len(), 5);
        assert_eq!(history.folded[0].agent_run_id, "run-1");
        assert!(!history.folded[0].decisions.is_empty());

        let sentence = history
            .boundary
            .boundary_sentence()
            .expect("six summaries should produce a boundary sentence");
        assert_eq!(sentence, "Summaries 1 are folded; 2-6 are carried verbatim.");
    }
}
