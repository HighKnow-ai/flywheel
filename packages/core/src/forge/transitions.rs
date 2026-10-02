//! The edge detector (D-121, D-122, D-123, D-124, phase 7 plan 07-07): the board's status column
//! starts following the forge — forward only, on the edge, and then it hands the column back.
//!
//! Three properties a later reader must not break:
//!
//! First, this detector is **edge-triggered and hands the column back** (D-121) — it writes on an
//! observed CHANGE against a baseline read from the append-only `events` log, and never
//! re-asserts a level. That is what makes it structurally incapable of overwriting a manual move
//! in a loop: once a poll has moved a task to the in-review band, a human moving it back
//! afterwards stands until the forge state itself changes again, not merely re-observes.
//!
//! Second, it implements **only the two transitions LINK-07 names, and only forward** (D-122):
//! an opened (or reopened-with-changes-requested) request moves a task into the in-review band,
//! and a merge moves it to the done band. It never moves a task backward out of either band on
//! its own — "changes requested" and "closed without merging" are each only ever an `events` row.
//! Those two rejected backward moves are named here deliberately, so a later reader does not add
//! them as an "improvement": a changes-requested observation never demotes a task, and a
//! closed-unmerged observation never demotes a task either.
//!
//! Third, it **never touches a criterion row** (D-123) — git stays the truth, and an unmet
//! acceptance criterion on a task the forge just carried to Done is surfaced as an event, never
//! silently closed on the user's behalf.
//!
//! Once a task's baseline has observed a merge, it is terminal — forward-only means forward only:
//! no later observation (including an absent request, or a forge read that no longer finds the
//! request at all) ever reopens or moves a merged task again.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection};

use crate::domain::event::{append_event, next_sequence};
use crate::forge::{CiResult, ForgeRequest, ForgeState};
use crate::query::forge::latest_forge_baseline;

/// A pull or merge request's lifecycle state changed since the last observation (LINK-07).
pub const EVENT_FORGE_STATE_CHANGED: &str = "forge.state_changed";
/// CI newly failed since the last observation (D-124) — never a status writer.
pub const EVENT_FORGE_CI_FAILED: &str = "forge.ci_failed";
/// A merge carried a task to Done while it still had unmet acceptance criteria (D-123) — names
/// the count; touches no criterion row.
pub const EVENT_DONE_WITH_UNMET_CRITERIA: &str = "task.done_with_unmet_criteria";

/// What one call to [`apply_forge_observation`] did. `events_appended` counts only the events
/// this function itself writes directly (a state-change event, a done-with-unmet-criteria event,
/// and/or a CI-failure event — zero to three, not mutually exclusive on one call); the
/// `task.status_changed` event the transaction-scoped status writer appends on a real status
/// write is not counted here.
#[derive(Debug, Clone, PartialEq)]
pub struct TransitionOutcome {
    pub status_changed_to: Option<String>,
    pub events_appended: usize,
}

fn state_label(state: ForgeState) -> &'static str {
    match state {
        ForgeState::None => "None",
        ForgeState::Open => "Open",
        ForgeState::ChangesRequested => "ChangesRequested",
        ForgeState::Merged => "Merged",
        ForgeState::ClosedUnmerged => "ClosedUnmerged",
    }
}

fn ci_label(ci: CiResult) -> &'static str {
    match ci {
        CiResult::None => "None",
        CiResult::Pending => "Pending",
        CiResult::Passed => "Passed",
        CiResult::Failed => "Failed",
    }
}

/// The human-readable sentence `domain::event::render_description` renders verbatim (via its
/// `label`-first behaviour) for a `forge.state_changed` row, keyed on the request's own number
/// when one is present.
fn state_changed_label(after: ForgeState, number: Option<i64>) -> String {
    let subject = match number {
        Some(n) => format!("Pull/merge request #{n}"),
        None => "Pull/merge request".to_string(),
    };
    match after {
        ForgeState::Open => format!("{subject} opened"),
        ForgeState::ChangesRequested => format!("{subject} has changes requested"),
        ForgeState::Merged => format!("{subject} merged"),
        ForgeState::ClosedUnmerged => format!("{subject} closed without merging"),
        ForgeState::None => format!("{subject} is no longer open"),
    }
}

/// Apply one forge observation for `task_id` against the restart-safe baseline (D-121). Opens
/// exactly one transaction: reads the baseline, decides, writes any status change through the
/// transaction-scoped status writer, appends its own events, and commits.
///
/// `observed` is `None` when the forge reports no request for this task's branch at all — treated
/// identically to a request whose state is "no request" for comparison purposes, EXCEPT that a
/// baseline already at the merged state is terminal (see module header): nothing, including an
/// absent request, ever moves a merged task again.
pub fn apply_forge_observation(
    conn: &mut Connection,
    task_id: &str,
    observed: Option<&ForgeRequest>,
    actor_id: &str,
) -> anyhow::Result<TransitionOutcome> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let baseline = latest_forge_baseline(&tx, task_id)?;

    let (project_id, epic_id): (String, Option<String>) = tx
        .query_row(
            "SELECT project_id, epic_id FROM tasks WHERE id = ?1",
            params![task_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .with_context(|| format!("task {task_id:?} not found"))?;

    let (observed_state, observed_ci, number, url, ci_url) = match observed {
        Some(request) => (
            request.state,
            request.ci,
            Some(request.number),
            Some(request.url.clone()),
            request.ci_url.clone(),
        ),
        None => (ForgeState::None, CiResult::None, None, None, None),
    };

    let mut status_changed_to: Option<String> = None;
    let mut events_appended = 0usize;

    // D-121/the module header's terminal rule: once the baseline has observed a merge, nothing
    // (including a request that has since gone absent from the read) ever moves this task again.
    if baseline.state != ForgeState::Merged && observed_state != baseline.state {
        let label = state_changed_label(observed_state, number);
        let payload = serde_json::json!({
            "before": state_label(baseline.state),
            "after": state_label(observed_state),
            "state": state_label(observed_state),
            "ci": ci_label(observed_ci),
            "number": number,
            "url": url,
            "label": label,
        });
        let sequence = next_sequence(&tx, &project_id, "local")?;
        append_event(
            &tx,
            &project_id,
            "local",
            sequence,
            "task",
            task_id,
            Some(task_id),
            epic_id.as_deref(),
            actor_id,
            EVENT_FORGE_STATE_CHANGED,
            &payload,
            &now,
        )?;
        events_appended += 1;

        if baseline.state == ForgeState::None
            && matches!(observed_state, ForgeState::Open | ForgeState::ChangesRequested)
        {
            crate::domain::task::set_task_status_in_tx(&tx, actor_id, task_id, "in_review")?;
            status_changed_to = Some("in_review".to_string());
        } else if observed_state == ForgeState::Merged {
            crate::domain::task::set_task_status_in_tx(&tx, actor_id, task_id, "done")?;
            status_changed_to = Some("done".to_string());

            let unmet_count: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM acceptance_criteria \
                     WHERE parent_type = 'task' AND parent_id = ?1 \
                     AND checked = 0 AND superseded_at IS NULL",
                    params![task_id],
                    |row| row.get(0),
                )
                .context("failed to count unmet acceptance criteria")?;

            if unmet_count > 0 {
                let unmet_payload = serde_json::json!({
                    "unmet_count": unmet_count,
                    "label": format!(
                        "Merged with {unmet_count} unresolved acceptance criteria"
                    ),
                });
                let unmet_sequence = next_sequence(&tx, &project_id, "local")?;
                append_event(
                    &tx,
                    &project_id,
                    "local",
                    unmet_sequence,
                    "task",
                    task_id,
                    Some(task_id),
                    epic_id.as_deref(),
                    actor_id,
                    EVENT_DONE_WITH_UNMET_CRITERIA,
                    &unmet_payload,
                    &now,
                )?;
                events_appended += 1;
            }
        }
    }

    if observed_ci == CiResult::Failed && baseline.ci != CiResult::Failed {
        let ci_payload = serde_json::json!({
            "state": state_label(observed_state),
            "ci": ci_label(observed_ci),
            "ci_url": ci_url,
            "label": "CI failed",
        });
        let ci_sequence = next_sequence(&tx, &project_id, "local")?;
        append_event(
            &tx,
            &project_id,
            "local",
            ci_sequence,
            "task",
            task_id,
            Some(task_id),
            epic_id.as_deref(),
            actor_id,
            EVENT_FORGE_CI_FAILED,
            &ci_payload,
            &now,
        )?;
        events_appended += 1;
    }

    tx.commit().context("failed to commit apply_forge_observation transaction")?;

    Ok(TransitionOutcome { status_changed_to, events_appended })
}
