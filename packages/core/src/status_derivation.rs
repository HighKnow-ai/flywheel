//! The status deriver (DRFT-04, phase 13 plan 07; D-08, D-09, D-10, D-11, D-12): `tasks.status`
//! is a materialised column with exactly one writer, and this is it.
//!
//! Three properties a later reader must not break:
//!
//! First, **the floor is one comparison.** The deriver computes a candidate band from git and
//! forge facts and writes `max(candidate, current)` over [`BAND_ORDER`]. `done` is terminal as a
//! consequence of that comparison, not through a separate rule, and a forge read that goes absent
//! can never move a card backwards (D-10, D-122's reasoning kept as one comparison rather than an
//! absent branch).
//!
//! Second, **the floor binds the deriver only** (D-11). `task::request_changes` is the one human
//! act that may lower `in_review` to `in_progress`, and it does so through the shared status
//! writer, never through here. The deriver then respects the value the human set.
//!
//! Third, **the deriver is level-based for worktree and merge, and edge-based for `in_review`**
//! (the owner's decision on the plan's D-11 / Task 2 contradiction, 2026-10-15). A worktree
//! existing and a merge having happened are facts that stay true, so re-reading them every tick is
//! safe — the floor makes them idempotent. "A request is open" is also a fact that stays true, and
//! re-reading *that* every tick would raise a declined card again on the very next tick. So the
//! `in_review` promotion fires only on the tick where the forge state itself changed (see
//! [`is_review_edge`]), exactly as the edge detector it replaced did: a human move stands until
//! the forge state changes again. Do not "tidy" this into uniform level-based.
//!
//! Callers: `forge::transitions::apply_forge_observation` (the forge edge), the desktop scheduler's
//! cold tick (tasks the forge read does not cover), and `domain::worktree` create and remove (the
//! `todo -> in_progress` edge). None of them writes a status of its own.

use anyhow::Context;
use rusqlite::{params, Connection, Transaction};

use crate::domain::task::set_task_status_in_tx;
use crate::forge::ForgeState;
use crate::git_facts::git_facts_for_task;
use crate::query::forge::latest_forge_baseline;

/// The band order, declared once. A status the schema CHECK permits but this list does not know is
/// a bug to surface, not a card to move — see [`band_rank`].
pub const BAND_ORDER: [&str; 5] = ["backlog", "todo", "in_progress", "in_review", "done"];

/// Index of `status` in [`BAND_ORDER`]. An unknown status is `None`, never rank 0.
pub fn band_rank(status: &str) -> Option<usize> {
    BAND_ORDER.iter().position(|band| *band == status)
}

/// Did the forge state change in the one way that opens a review? Only `None -> Open` or
/// `None -> ChangesRequested`: the edge the detector this replaced promoted on. Every other change
/// (a merge, a close, `Open -> ChangesRequested`) either has its own signal or deliberately has
/// none.
pub fn is_review_edge(before: ForgeState, after: ForgeState) -> bool {
    before == ForgeState::None && matches!(after, ForgeState::Open | ForgeState::ChangesRequested)
}

/// The candidate band for the given facts. Pure: no connection, no clock, so two calls on the same
/// inputs are equal. `current` is returned unchanged when no fact has an opinion.
///
/// - `Merged` gives `done`: a merge is a level — once true it stays true.
/// - `review_edge` gives `in_review`: an edge, deliberately not a level (see the module header).
///   `ClosedUnmerged` produces nothing here, so it is the floor that keeps a closed request at
///   `in_review` (D-10).
/// - `worktree_present` gives `in_progress`: the worktree is the durable task-owned resource that
///   outlives agent sessions, so a card does not fall back to `todo` when a context is discarded
///   (D-09).
pub fn derive_candidate<'a>(
    worktree_present: bool,
    forge_state: ForgeState,
    review_edge: bool,
    current: &'a str,
) -> &'a str {
    if forge_state == ForgeState::Merged {
        "done"
    } else if review_edge {
        "in_review"
    } else if worktree_present {
        "in_progress"
    } else {
        current
    }
}

/// What one derivation did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Derivation {
    /// The floor, or the absence of any opinion, left the card where it was.
    Unchanged,
    /// The card moved to this band, through the shared status writer.
    Wrote(String),
    /// The card would have moved to `intended`, but `expected_status` no longer matched: the task
    /// is at `actual`. Nothing was written (the compare-and-swap, quick task 261005-mn5).
    Refused { intended: String, actual: String },
}

/// Derive and, where the floor allows, write the status of `task_id` inside the caller's
/// transaction.
///
/// `expected_status` is the compare-and-swap precondition carried over from the edge detector:
/// `None` is honest only for a caller that held its connection continuously (no lock-release
/// window); `Some(s)` refuses the write unless the task is still at `s`.
///
/// `review_edge` is true only on the call where the forge state changed into an open request —
/// see [`is_review_edge`]. The caller that observed the change is the only one who knows.
pub fn derive_status_in_tx(
    tx: &Transaction,
    task_id: &str,
    actor_id: &str,
    expected_status: Option<&str>,
    review_edge: bool,
) -> anyhow::Result<Derivation> {
    let current: String = tx
        .query_row("SELECT status FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0))
        .with_context(|| format!("task {task_id:?} not found"))?;
    let Some(current_rank) = band_rank(&current) else {
        return Ok(Derivation::Unchanged);
    };

    let forge_state = latest_forge_baseline(tx, task_id)?.state;

    // The worktree can only ever contribute `in_progress`, so it is read only for a card still
    // below that band — a steady-state tick on a started card spends no git calls here. An error
    // reading git is "not shown to exist" for this derivation: the deriver never writes on
    // ambiguous evidence, and the next tick tries again.
    let in_progress_rank = band_rank("in_progress").unwrap_or(2);
    let worktree_present =
        current_rank < in_progress_rank && matches!(git_facts_for_task(tx, task_id), Ok(Some(_)));

    let candidate = derive_candidate(worktree_present, forge_state, review_edge, &current);
    let Some(candidate_rank) = band_rank(candidate) else {
        return Ok(Derivation::Unchanged);
    };
    let winner = BAND_ORDER[candidate_rank.max(current_rank)];
    if winner == current {
        return Ok(Derivation::Unchanged);
    }

    if expected_status.is_some_and(|expected| expected != current) {
        return Ok(Derivation::Refused { intended: winner.to_string(), actual: current });
    }

    set_task_status_in_tx(tx, actor_id, task_id, winner)?;
    Ok(Derivation::Wrote(winner.to_string()))
}

/// [`derive_status_in_tx`] in a transaction of its own, for a caller with no other writes to
/// compose (the scheduler's cold tick). No forge edge is claimed: the forge's own edge is
/// `apply_forge_observation`'s to report.
pub fn derive_status(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    expected_status: Option<&str>,
) -> anyhow::Result<Derivation> {
    let tx = conn.transaction()?;
    let outcome = derive_status_in_tx(&tx, task_id, actor_id, expected_status, false)?;
    tx.commit().context("failed to commit derive_status transaction")?;
    Ok(outcome)
}
