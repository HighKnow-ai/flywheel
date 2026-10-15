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
//! Fourth, **the epic level rides the same floor** (D-13, extending D-08 one level up).
//! `epics.status` has one writer too, [`derive_epic_status_in_tx`]: the candidate comes from the
//! epic's tasks ([`derive_epic_candidate`]) and is written as `max(candidate, current)` through
//! the same [`band_rank`] comparison, so `done` is terminal there for the same reason. An epic
//! with no tasks is left where it is - zero tasks is not "all tasks done". It is derived after its
//! task inside [`derive_status_in_tx`], so it has no trigger point of its own: no scheduler, no
//! cron entry, no interval. A manual epic status control stays rejected (14-CONTEXT Deferred
//! Ideas); a human who lowers an epic is respected by the floor, as at the task level (A-03).
//!
//! Callers: `forge::transitions::apply_forge_observation` (the forge edge), the desktop scheduler's
//! cold tick (tasks the forge read does not cover), and `domain::worktree` create and remove (the
//! `todo -> in_progress` edge). None of them writes a status of its own.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, Transaction};

use crate::domain::epic::set_epic_status_in_tx;
use crate::domain::event::{append_event, next_sequence};
use crate::domain::task::set_task_status_in_tx;
use crate::forge::transitions::EVENT_DONE_WITH_UNMET_CRITERIA;
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
    let outcome = derive_task_status_in_tx(tx, task_id, actor_id, expected_status, review_edge)?;
    // The epic is derived after its task in the same transaction, so the two levels cannot
    // disagree within a tick. A refused write changed nothing, so there is nothing to follow.
    if !matches!(outcome, Derivation::Refused { .. }) {
        let epic_id: Option<String> =
            tx.query_row("SELECT epic_id FROM tasks WHERE id = ?1", params![task_id], |row| row.get(0))?;
        if let Some(epic_id) = epic_id {
            derive_epic_status_in_tx(tx, &epic_id, actor_id)?;
        }
    }
    Ok(outcome)
}

fn derive_task_status_in_tx(
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
    if winner == "done" {
        record_unmet_criteria(tx, task_id, actor_id)?;
    }
    Ok(Derivation::Wrote(winner.to_string()))
}

/// D-123: a card reaching `done` with acceptance criteria still unchecked is surfaced as one
/// `task.done_with_unmet_criteria` event, never closed quietly and never by touching a criterion
/// row. It is appended here, at the one seam every route to `done` passes through (the forge
/// tick, the cold tick, worktree create and remove), so no route can drop it (WR-06). This is the
/// only producer of the event - `tests/status_derivation.rs` pins that by reading the source.
fn record_unmet_criteria(tx: &Transaction, task_id: &str, actor_id: &str) -> anyhow::Result<()> {
    let unmet_count: i64 = tx
        .query_row(
            "SELECT COUNT(*) FROM acceptance_criteria \
             WHERE parent_type = 'task' AND parent_id = ?1 \
             AND checked = 0 AND superseded_at IS NULL",
            params![task_id],
            |row| row.get(0),
        )
        .context("failed to count unmet acceptance criteria")?;
    if unmet_count == 0 {
        return Ok(());
    }

    let (project_id, epic_id): (String, Option<String>) = tx
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;
    let payload = serde_json::json!({
        "unmet_count": unmet_count,
        "label": format!("Merged with {unmet_count} unresolved acceptance criteria"),
    });
    let sequence = next_sequence(tx, &project_id, "local")?;
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "task",
        task_id,
        Some(task_id),
        epic_id.as_deref(),
        actor_id,
        EVENT_DONE_WITH_UNMET_CRITERIA,
        &payload,
        &Utc::now().to_rfc3339(),
    )?;
    Ok(())
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

/// The epic candidate for a task status distribution (D-13). Pure: no connection, no clock.
///
/// `in_progress` if any task is; `in_review` when every task is `in_review` or `done` and at
/// least one is `in_review`; `done` when every task is `done`; `todo` when any task is `todo`;
/// `backlog` otherwise. **`None` when the epic has no tasks**: zero tasks is not "all tasks done",
/// and an empty epic promoted to `done` would be the board lying. The caller leaves such an epic
/// where it is.
pub fn derive_epic_candidate(by_status: &[(String, u32)]) -> Option<&'static str> {
    let count = |status: &str| -> u32 {
        by_status.iter().filter(|(s, _)| s == status).map(|(_, n)| *n).sum()
    };
    let total: u32 = by_status.iter().map(|(_, n)| *n).sum();
    if total == 0 {
        None
    } else if count("in_progress") > 0 {
        Some("in_progress")
    } else if count("done") == total {
        Some("done")
    } else if count("in_review") + count("done") == total {
        Some("in_review")
    } else if count("todo") > 0 {
        Some("todo")
    } else {
        Some("backlog")
    }
}

/// Derive and, where the floor allows, write the status of `epic_id` inside the caller's
/// transaction (D-13). The same floor as the task level: `max(candidate, current)` over
/// [`BAND_ORDER`] via [`band_rank`], so `done` is terminal and a status a human set stands until
/// the tasks' own candidate is higher. Nothing is written, and no event appended, when the
/// resolved band equals the current one or the epic has no tasks.
pub fn derive_epic_status_in_tx(
    tx: &Transaction,
    epic_id: &str,
    actor_id: &str,
) -> anyhow::Result<Derivation> {
    let current: String = tx
        .query_row("SELECT status FROM epics WHERE id = ?1", params![epic_id], |row| row.get(0))
        .with_context(|| format!("epic {epic_id:?} not found"))?;
    let Some(current_rank) = band_rank(&current) else {
        return Ok(Derivation::Unchanged);
    };

    let by_status = tx
        .prepare("SELECT status, COUNT(*) FROM tasks WHERE epic_id = ?1 GROUP BY status")?
        .query_map(params![epic_id], |row| Ok((row.get::<_, String>(0)?, row.get::<_, u32>(1)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to count the epic's tasks by status")?;
    let Some(candidate) = derive_epic_candidate(&by_status) else {
        return Ok(Derivation::Unchanged);
    };
    let winner = BAND_ORDER[band_rank(candidate).unwrap_or(0).max(current_rank)];
    if winner == current {
        return Ok(Derivation::Unchanged);
    }

    set_epic_status_in_tx(tx, actor_id, epic_id, winner)?;
    Ok(Derivation::Wrote(winner.to_string()))
}
