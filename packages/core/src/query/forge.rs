//! The restart-safe forge baseline (D-121, RESEARCH.md open question 1): the last observed
//! `(ForgeState, CiResult)` pair for a task, reconstructed from the append-only `events` log
//! rather than a mutable column.
//!
//! This read **is** the durable baseline `forge::transitions::apply_forge_observation` (phase 7
//! plan 07-07) composes against for its edge detection — there is deliberately no added column on
//! the `tasks` table remembering the last observed state, because a second source of truth about
//! forge state is the bug class this phase exists to kill (D-75/D-128), and because the
//! append-only log already survives an application restart for free.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::forge::{CiResult, ForgeState};

/// The last observed forge state for one task — the pair [`latest_forge_baseline`] reconstructs
/// from the `events` log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ForgeBaseline {
    pub state: ForgeState,
    pub ci: CiResult,
}

/// Every row this module reads carries the FULL current observation in `state`/`ci`, not just
/// the one field the event's own name describes changing — `forge.state_changed`'s payload
/// carries the unchanged `ci` alongside its `before`/`after` state pair, and `forge.ci_failed`'s
/// payload carries the unchanged `state` alongside its new `ci` — so the single most recent row,
/// whichever of the two event types wrote it, is always enough to reconstruct the whole pair.
const LATEST_FORGE_EVENT_SQL: &str = "SELECT payload FROM events \
     WHERE task_id = ?1 AND event_type IN ('forge.state_changed', 'forge.ci_failed') \
     ORDER BY id DESC LIMIT 1";

fn parse_state(value: Option<&str>) -> ForgeState {
    match value {
        Some("Open") => ForgeState::Open,
        Some("ChangesRequested") => ForgeState::ChangesRequested,
        Some("Merged") => ForgeState::Merged,
        Some("ClosedUnmerged") => ForgeState::ClosedUnmerged,
        // An absent, unrecognised or wrong-typed value degrades to the no-request default rather
        // than erroring the read — this covers "None" too, since that is the default anyway.
        _ => ForgeState::None,
    }
}

fn parse_ci(value: Option<&str>) -> CiResult {
    match value {
        Some("Pending") => CiResult::Pending,
        Some("Passed") => CiResult::Passed,
        Some("Failed") => CiResult::Failed,
        _ => CiResult::None,
    }
}

/// The durable baseline for D-121's edge detection: the most recent forge-kind event for
/// `task_id`, by `id` ordering (ULID, and therefore chronological by construction — the same
/// reason `query::events`'s trail reads order by `id`). A task with no such row returns the
/// default baseline (no request, no CI). A malformed payload degrades to that same default rather
/// than erroring the read.
pub fn latest_forge_baseline(conn: &Connection, task_id: &str) -> anyhow::Result<ForgeBaseline> {
    let payload_text: Option<String> = conn
        .query_row(LATEST_FORGE_EVENT_SQL, params![task_id], |row| row.get(0))
        .optional()
        .context("failed to read the latest forge event")?;

    let Some(payload_text) = payload_text else {
        return Ok(ForgeBaseline { state: ForgeState::None, ci: CiResult::None });
    };

    let payload: serde_json::Value =
        serde_json::from_str(&payload_text).unwrap_or(serde_json::Value::Null);

    let state = parse_state(payload.get("state").and_then(|v| v.as_str()));
    let ci = parse_ci(payload.get("ci").and_then(|v| v.as_str()));

    Ok(ForgeBaseline { state, ci })
}

const LATEST_UNMET_CRITERIA_EVENT_SQL: &str = "SELECT payload FROM events \
     WHERE task_id = ?1 AND event_type = 'task.done_with_unmet_criteria' \
     ORDER BY id DESC LIMIT 1";

/// The unmet-acceptance-criteria count a merge most recently raised for `task_id` (D-123), or `0`
/// when the task carries no `task.done_with_unmet_criteria` event at all. The item panel's own
/// per-task sibling to [`board_forge_flags`]'s bulk rollup below — `forge_request_for_task`
/// (`commands/forge.rs`) needs one task's unmet count beside its live request read, not the whole
/// project-scoped board rollup for one row. Reads the SAME event `board_forge_flags` folds in; a
/// malformed payload degrades to `0` rather than erroring the read.
pub fn latest_unmet_criteria_count(conn: &Connection, task_id: &str) -> anyhow::Result<u32> {
    let payload_text: Option<String> = conn
        .query_row(LATEST_UNMET_CRITERIA_EVENT_SQL, params![task_id], |row| row.get(0))
        .optional()
        .context("failed to read the latest unmet-criteria event")?;

    let Some(payload_text) = payload_text else {
        return Ok(0);
    };

    let payload: serde_json::Value =
        serde_json::from_str(&payload_text).unwrap_or(serde_json::Value::Null);

    Ok(payload
        .get("unmet_count")
        .and_then(|v| v.as_i64())
        .and_then(|n| u32::try_from(n).ok())
        .unwrap_or(0))
}

/// The board-level CI-failure/unmet-criteria signal for one task (D-124, D-123, phase 07 plan
/// 07-08) — [`board_forge_flags`]'s own per-row result. `ci_failed` is true when the task's latest
/// CI-bearing observation (whichever of `forge.ci_failed`/`forge.state_changed` is most recent)
/// recorded a failure; `unmet_criteria` is the count named by the task's own
/// `task.done_with_unmet_criteria` event, `0` when it has none.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ForgeFlag {
    pub task_id: String,
    pub ci_failed: bool,
    pub unmet_criteria: u32,
}

/// Bounded by the DISTINCT task-id subquery's own `LIMIT ?2` — never the whole event log (D-124's
/// board-paint-path requirement, T-07-08-04). For each of up to `limit` distinct tasks carrying one
/// of the three forge-kind events in `project_id`, two correlated reads pull the single most
/// recent row of each kind: the latest CI-bearing payload (`forge.ci_failed` OR
/// `forge.state_changed` — both carry the SAME `ci` field at write time, see
/// `transitions.rs`'s module header on "full snapshot payload"), and the latest
/// `task.done_with_unmet_criteria` payload, if any. "Latest between the two CI-bearing types wins"
/// is exactly what makes a later `forge.state_changed` recording a non-failing CI clear an earlier
/// `forge.ci_failed` flag, with no separate reconciliation step.
const BOARD_FORGE_FLAGS_SQL: &str = "SELECT \
    t.task_id, \
    (SELECT payload FROM events e2 WHERE e2.task_id = t.task_id \
     AND e2.event_type IN ('forge.ci_failed', 'forge.state_changed') \
     ORDER BY e2.id DESC LIMIT 1) AS ci_payload, \
    (SELECT payload FROM events e3 WHERE e3.task_id = t.task_id \
     AND e3.event_type = 'task.done_with_unmet_criteria' \
     ORDER BY e3.id DESC LIMIT 1) AS unmet_payload \
    FROM ( \
        SELECT DISTINCT task_id FROM events \
        WHERE project_id = ?1 AND task_id IS NOT NULL \
        AND event_type IN ('forge.ci_failed', 'forge.state_changed', 'task.done_with_unmet_criteria') \
        ORDER BY task_id ASC LIMIT ?2 \
    ) t \
    ORDER BY t.task_id ASC";

/// Every distinct task in `project_id` carrying an outstanding forge flag (D-124's CI-failure pill,
/// D-123's unmet-criteria marker's board-level rollup), at most `limit` tasks considered. A project
/// with no forge events at all returns an empty vector, never an error. A malformed payload (either
/// kind) degrades that one field to its default (`ci_failed: false` / `unmet_criteria: 0`) rather
/// than erroring the whole read — the same `Value::get(...).and_then(...)` discipline
/// `latest_forge_baseline` above already uses. A task whose only forge-kind events carry neither a
/// failure nor an unmet count (e.g. an Open request with passing CI) is filtered out here, in
/// application code over the already-bounded result set — never by widening the SQL's own `LIMIT`,
/// which governs how many distinct tasks are considered, not how many are reported.
pub fn board_forge_flags(
    conn: &Connection,
    project_id: &str,
    limit: usize,
) -> anyhow::Result<Vec<ForgeFlag>> {
    let mut stmt = conn.prepare(BOARD_FORGE_FLAGS_SQL)?;
    let limit = i64::try_from(limit).unwrap_or(i64::MAX);
    let rows = stmt
        .query_map(params![project_id, limit], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, Option<String>>(2)?,
            ))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read board forge flags")?;

    let mut flags = Vec::new();
    for (task_id, ci_payload, unmet_payload) in rows {
        let ci_failed = ci_payload
            .as_deref()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
            .and_then(|v| v.get("ci").and_then(|c| c.as_str()).map(|s| s == "Failed"))
            .unwrap_or(false);

        let unmet_criteria: u32 = unmet_payload
            .as_deref()
            .and_then(|text| serde_json::from_str::<serde_json::Value>(text).ok())
            .and_then(|v| v.get("unmet_count").and_then(|c| c.as_i64()))
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(0);

        if ci_failed || unmet_criteria > 0 {
            flags.push(ForgeFlag { task_id, ci_failed, unmet_criteria });
        }
    }

    Ok(flags)
}
