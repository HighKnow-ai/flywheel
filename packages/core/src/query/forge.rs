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
