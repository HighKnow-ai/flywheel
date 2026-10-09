//! Drift detection (D-72, D-73, D-75, CTX-06): four fact-based comparisons over board state and
//! git state, and nothing else. Three rules this file lives under.
//!
//! First, every detector fires on a fact — a set comparison over file paths, a ref, or decision
//! ids — and none of them interprets meaning, matches a keyword, or calls a model. The test this
//! decision has to pass: if a comparison needed a model to decide whether two things disagree, it
//! would have left this file.
//!
//! Second, nothing here is ever stored — following `query/events.rs`'s own derive-at-read-time
//! discipline (D-75), because a cached verdict goes stale the instant the range it was computed
//! against changes. [`detect_drift`] is called fresh on every packet assembly; its result lives
//! only as long as the call that produced it.
//!
//! Third, the whole module is pure: [`detect_drift`]'s output is a function of its
//! [`DriftInputs`] argument and nothing else — no database connection, no process spawn, no
//! network call, no clock read. Two calls on the same inputs return equal vectors.

use std::collections::HashSet;

use serde::Serialize;

use crate::context_packet::SummaryEntry;

/// The five kinds of fired warning (D-72, D-73) — four detectors, the fourth (decision read-back)
/// able to fire either of the last two kinds depending on which mismatch it finds first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum DriftKind {
    /// The latest summary claimed a changed file the real diff does not contain.
    ClaimedFilesMismatch,
    /// Work has landed — a moved head ref, uncommitted changes, or both — since the latest
    /// summary was written.
    StaleSinceLastSummary,
    /// The task's pinned criterion-id set no longer matches its current criterion-id set.
    CriteriaRevisionMoved,
    /// A decision on record was never echoed back by the latest summary.
    UnacknowledgedDecision,
    /// The latest summary echoed a decision id that names no recorded decision.
    FabricatedDecisionEcho,
}

/// One fired warning (D-72). `sentence` is the human-renderable line — D-19's obligation,
/// composed here once so the rendered briefing, any future DTO and the activity trail all read
/// the same words.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct DriftWarning {
    pub kind: DriftKind,
    pub sentence: String,
}

/// The facts [`detect_drift`] compares — borrowed slices only, so no caller has to clone board
/// state just to ask a question. `None` and an empty slice are never interchangeable here: a
/// `None` `real_changed_paths` means "no worktree to compare against" (the claimed-files detector
/// stays silent), and a `None` `pinned_criterion_ids` means "this run predates the pin column"
/// (the criteria-revision detector stays silent forever for that run, never treating it as an
/// empty pinned set).
#[derive(Debug, Clone, Copy)]
pub struct DriftInputs<'a> {
    /// Every summary recorded for the task, oldest-first — the same list `ContextPacket.summaries`
    /// carries. The claimed-files, staleness and read-back detectors all read only its LAST
    /// element (the latest summary); the read-back detector also folds every element's own
    /// `decisions` to build the full recorded-decision set.
    pub summaries: &'a [SummaryEntry],
    /// The real changed-path list for the task's worktree, read without rename detection so a
    /// legitimately moved file appears under both its old and its new path. `None` means there is
    /// no worktree to compare against.
    pub real_changed_paths: Option<&'a [String]>,
    /// The worktree's current resolved `HEAD`. `None` means there is no worktree to resolve it
    /// against.
    pub head_ref: Option<&'a str>,
    /// Whether the worktree currently carries uncommitted changes.
    pub working_tree_dirty: bool,
    /// The criterion-id set this run's briefing was pinned to (D-78). `None` means this run
    /// predates the pin column and must never fire the revision detector — never treated as an
    /// empty set.
    pub pinned_criterion_ids: Option<&'a [String]>,
    /// The task's current criterion-id set, in rank order.
    pub current_criterion_ids: &'a [String],
}

/// Detector 1 (D-72 item 1): the latest summary's claimed `changed_files` against the real
/// changed-path list. A claimed path absent from the real list fires; a real path absent from the
/// claim does not — under-reporting is not the integrity failure this detector exists for, and
/// firing on it would make the detector noisy on every run that also touched a lockfile.
fn detect_claimed_files_mismatch(inputs: &DriftInputs) -> Option<DriftWarning> {
    let real_paths = inputs.real_changed_paths?;
    let latest = inputs.summaries.last()?;

    let real_set: HashSet<&str> = real_paths.iter().map(String::as_str).collect();
    let missing: Vec<&str> = latest
        .changed_files
        .iter()
        .map(String::as_str)
        .filter(|claimed| !real_set.contains(claimed))
        .collect();

    if missing.is_empty() {
        return None;
    }

    let noun = if missing.len() == 1 { "path" } else { "paths" };
    let sentence = format!(
        "The latest session summary claims {noun} the real diff does not contain: {}.",
        missing.join(", ")
    );
    Some(DriftWarning { kind: DriftKind::ClaimedFilesMismatch, sentence })
}

/// Detector 2 (D-72 item 2): the latest summary's `diff_ref` against the current head ref, plus
/// whether the working tree is dirty. Fires when the stored ref is `Some` and differs from
/// `head_ref`, or when the working tree is dirty — either means work landed since the summary was
/// written, which is exactly what makes that summary's claims incomplete rather than wrong.
fn detect_staleness(inputs: &DriftInputs) -> Option<DriftWarning> {
    let latest = inputs.summaries.last()?;

    let ref_moved = match (latest.diff_ref.as_deref(), inputs.head_ref) {
        (Some(diff_ref), Some(head_ref)) => diff_ref != head_ref,
        _ => false,
    };

    if !ref_moved && !inputs.working_tree_dirty {
        return None;
    }

    let recorded_ref = latest.diff_ref.as_deref().unwrap_or("an unrecorded ref");
    let sentence = match (ref_moved, inputs.working_tree_dirty) {
        (true, true) => format!(
            "The head ref has moved since the latest session summary was written against {recorded_ref}, \
             and the working tree carries uncommitted changes on top of that."
        ),
        (true, false) => format!(
            "The head ref has moved since the latest session summary was written against {recorded_ref}."
        ),
        (false, true) => {
            "Uncommitted work has landed in the working tree since the latest session summary was written."
                .to_string()
        }
        (false, false) => unreachable!(
            "guarded above: at least one of ref_moved/working_tree_dirty is true here"
        ),
    };
    Some(DriftWarning { kind: DriftKind::StaleSinceLastSummary, sentence })
}

/// Detector 3 (D-72 item 3, D-78): the run's pinned criterion-id set against the task's current
/// criterion-id set. Returns immediately when `pinned_criterion_ids` is `None` — a run predating
/// the pin column never fires this detector, full stop. Compares as sets (never as ordered lists),
/// naming exactly the ids that entered or left.
fn detect_criteria_revision(inputs: &DriftInputs) -> Option<DriftWarning> {
    let pinned = inputs.pinned_criterion_ids?;

    let pinned_set: HashSet<&str> = pinned.iter().map(String::as_str).collect();
    let current_set: HashSet<&str> =
        inputs.current_criterion_ids.iter().map(String::as_str).collect();

    if pinned_set == current_set {
        return None;
    }

    let mut entered: Vec<&str> = current_set.difference(&pinned_set).copied().collect();
    let mut left: Vec<&str> = pinned_set.difference(&current_set).copied().collect();
    // `HashSet::difference`'s iteration order is not stable across calls — sort before rendering
    // so two `detect_drift` calls on the same inputs stay byte-identical (this module's own
    // purity contract), not merely equal-as-sets.
    entered.sort_unstable();
    left.sort_unstable();

    let mut clauses = Vec::new();
    if !entered.is_empty() {
        clauses.push(format!("entered: {}", entered.join(", ")));
    }
    if !left.is_empty() {
        clauses.push(format!("left: {}", left.join(", ")));
    }

    let sentence = format!(
        "The acceptance criteria set has changed since this run's briefing was pinned ({}).",
        clauses.join("; ")
    );
    Some(DriftWarning { kind: DriftKind::CriteriaRevisionMoved, sentence })
}

/// Detector 4 (D-73): the accumulated decision-id set across every summary against the latest
/// summary's `acknowledged_decisions`. An on-record id never echoed fires
/// [`DriftKind::UnacknowledgedDecision`]; an echoed id matching no record fires
/// [`DriftKind::FabricatedDecisionEcho`]. Checked in that order — an unechoed real decision is
/// checked before a fabricated one, so a summary that both drops a real id and invents a fake one
/// still returns exactly one warning, matching this module's "at most one warning per detector"
/// contract. Both halves are pure id matching, never text comparison.
fn detect_decision_read_back(inputs: &DriftInputs) -> Option<DriftWarning> {
    let latest = inputs.summaries.last()?;

    // The full recorded-decision id set, first-seen order, across every summary — complete
    // regardless of how many summaries have since folded under compaction, because compaction is
    // lossless for decisions (this crate's own compaction contract).
    let mut recorded_ids: Vec<&str> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for summary in inputs.summaries {
        for decision in &summary.decisions {
            if seen.insert(decision.id.as_str()) {
                recorded_ids.push(decision.id.as_str());
            }
        }
    }

    let echoed: HashSet<&str> =
        latest.acknowledged_decisions.iter().map(String::as_str).collect();
    let unechoed: Vec<&str> =
        recorded_ids.iter().copied().filter(|id| !echoed.contains(id)).collect();
    if !unechoed.is_empty() {
        let noun = if unechoed.len() == 1 { "decision" } else { "decisions" };
        let sentence = format!(
            "The latest session did not acknowledge recorded {noun}: {}.",
            unechoed.join(", ")
        );
        return Some(DriftWarning { kind: DriftKind::UnacknowledgedDecision, sentence });
    }

    let recorded_set: HashSet<&str> = recorded_ids.into_iter().collect();
    let fabricated: Vec<&str> = latest
        .acknowledged_decisions
        .iter()
        .map(String::as_str)
        .filter(|id| !recorded_set.contains(id))
        .collect();
    if !fabricated.is_empty() {
        let noun = if fabricated.len() == 1 { "id" } else { "ids" };
        let sentence = format!(
            "The latest session acknowledged decision {noun} not on record: {}.",
            fabricated.join(", ")
        );
        return Some(DriftWarning { kind: DriftKind::FabricatedDecisionEcho, sentence });
    }

    None
}

/// Run all four detectors, in this fixed order — claimed files, staleness, criteria revision,
/// read-back — so two assemblies against the same board state and the same git state render
/// byte-identical lines. Pushes at most one warning per detector per call. No database
/// connection, no process, no network call, no clock: the whole function's output depends only on
/// `inputs`.
pub fn detect_drift(inputs: &DriftInputs) -> Vec<DriftWarning> {
    let mut warnings = Vec::new();

    if let Some(warning) = detect_claimed_files_mismatch(inputs) {
        warnings.push(warning);
    }
    if let Some(warning) = detect_staleness(inputs) {
        warnings.push(warning);
    }
    if let Some(warning) = detect_criteria_revision(inputs) {
        warnings.push(warning);
    }
    if let Some(warning) = detect_decision_read_back(inputs) {
        warnings.push(warning);
    }

    warnings
}

/// RED stub.
#[derive(Debug, Clone, PartialEq)]
pub struct ScopeBackstopInputs {
    pub task_id: String,
    pub worktree_path: std::path::PathBuf,
    pub base_branch: String,
    pub entries: Vec<crate::file_set::FileSetEntry>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ScopeBackstopFinding {
    pub path: String,
}

pub fn scope_backstop_inputs(_conn: &rusqlite::Connection, _task_id: &str) -> anyhow::Result<Option<ScopeBackstopInputs>> {
    Ok(None)
}

pub fn scope_backstop_git(_inputs: &ScopeBackstopInputs) -> anyhow::Result<Vec<ScopeBackstopFinding>> {
    Ok(Vec::new())
}

pub fn scope_backstop_findings(_conn: &rusqlite::Connection, _task_id: &str) -> anyhow::Result<Vec<ScopeBackstopFinding>> {
    Ok(Vec::new())
}
