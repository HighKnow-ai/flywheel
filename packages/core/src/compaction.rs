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
//!
//! The list this fold is handed is itself bounded (FNC-05, D-01): `context_packet::SUMMARIES_SQL`
//! reads only the newest [`SUMMARY_WINDOW`] rows. The bound is on the fold's INPUT, so nothing in
//! here changed — it stays lossless for decisions and file paths over whatever list it is given.
//! The consequence is accepted and stated out loud (D-06): a decision older than [`SUMMARY_WINDOW`]
//! can go unacknowledged without firing `DriftKind::UnacknowledgedDecision`, because the drift
//! detector reads the same bounded list. The durable home for an old decision is the board, and
//! CTX-06's registry.

use crate::domain::session_summary::SummaryEntry;
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

/// The summary window (FNC-05, D-02): how many of a task's newest session summaries enter the
/// context packet at all. Declared exactly once, beside [`VERBATIM_WINDOW`] and in the same D-69
/// house style — a fixed count, never a parameter and never config. It reads as one sentence: the
/// last 5 sessions whole, 20 more folded, the rest on the board. The folded count is
/// `SUMMARY_WINDOW - VERBATIM_WINDOW`, derived by subtraction and never declared a second time.
/// `context_packet::SUMMARIES_SQL` binds this value as its LIMIT; no byte, character or token
/// ceiling exists anywhere.
pub const SUMMARY_WINDOW: usize = 25;

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
///
/// `total` is how many summaries the fold was handed. `board_total` (FNC-05) is how many the task
/// has on the board: equal to `total` straight out of [`compact_summaries`], and raised by
/// [`CompactionBoundary::with_board_total`] once the caller knows the window left some out.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CompactionBoundary {
    pub total: usize,
    pub board_total: usize,
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
    /// The same boundary, told how many summaries the task really has on the board (FNC-05, D-03).
    /// Pure: a value in, a value out. It is read by a separate `COUNT`, never inferred from the
    /// window, so nothing here rounds or clamps a size.
    pub fn with_board_total(mut self, board_total: usize) -> Self {
        self.board_total = board_total;
        self
    }

    /// The boundary as a sentence a person can say out loud (CTX-05), or `None` when nothing
    /// folded and nothing was left out — a task with four or five summaries has no boundary to
    /// name, because the window is inclusive and the threshold value itself is entirely verbatim.
    /// When `board_total > total` (D-03) it adds a second clause stating how many summaries were
    /// read out of the board total, how many earlier sessions were left out, and one named way to
    /// reach them. One ordinal base per clause (WR-10): the fold clause is window-relative, to match
    /// the rendered `### Session N` headings the reader is looking at; the window clause states
    /// counts only, never an ordinal range against the board total (renumbering the headings to
    /// board ordinals was the alternative, and would make the headings disagree with
    /// `CompactionInfo`'s own window-relative fields). It never enumerates excluded decision ids: that list grows with task age and would
    /// reintroduce the unbounded term one level down. A function of board state only (D-04). Uses
    /// an ASCII hyphen, never an en dash: this string is compared byte-for-byte by CTX-04's
    /// determinism assertions and is rendered directly into a prompt.
    pub fn boundary_sentence(&self) -> Option<String> {
        let fold = if self.folded_count == 0 {
            None
        } else {
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
        };

        let left_out = self.board_total.saturating_sub(self.total);
        let window = if left_out == 0 {
            None
        } else {
            let noun = if left_out == 1 { "session is" } else { "sessions are" };
            Some(format!(
                "{} of {} summaries read; {left_out} earlier {noun} on the task, readable from the \
                 task's own session history.",
                self.total, self.board_total
            ))
        };

        match (fold, window) {
            (None, None) => None,
            (Some(sentence), None) | (None, Some(sentence)) => Some(sentence),
            (Some(fold), Some(window)) => Some(format!("{fold} {window}")),
        }
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
        board_total: total,
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
