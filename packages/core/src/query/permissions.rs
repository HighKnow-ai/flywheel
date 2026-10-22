//! Bounded, literal-SQL reads over `sessions`/`permission_requests` for the board's Waiting on you
//! signal (docs/mvp-spec.md §2 "Attention"): `blocked_story_ids_for_project` and
//! `blocked_count_for_project`. Every statement below is a single literal `&str`, bound through
//! `params![]`, never assembled by `format!`/string interpolation.
//!
//! A Story is Waiting on you when one of its LIVE sessions (`running` or `blocked`) holds a pending
//! request. It is derived from the pending rows, never from `sessions.status = 'blocked'`, which
//! v0.1 read and which a single answer could reset while other requests still waited (issue #57).

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

const BLOCKED_STORY_IDS_SQL: &str = "SELECT DISTINCT ar.story_id FROM sessions ar \
    WHERE ar.project_id = ?1 AND ar.kind = 'story' AND ar.status IN ('running', 'blocked') \
    AND EXISTS (SELECT 1 FROM permission_requests pr WHERE pr.session_id = ar.id AND pr.status = 'pending' AND pr.expired_at IS NULL) \
    ORDER BY ar.story_id ASC";

const BLOCKED_COUNT_SQL: &str = "SELECT COUNT(DISTINCT ar.story_id) FROM sessions ar \
    WHERE ar.project_id = ?1 AND ar.kind = 'story' AND ar.status IN ('running', 'blocked') \
    AND EXISTS (SELECT 1 FROM permission_requests pr WHERE pr.session_id = ar.id AND pr.status = 'pending' AND pr.expired_at IS NULL)";

/// Every distinct Story id in `project_id` that is Waiting on you: a live session of it holds a
/// pending request. A project with no sessions at all returns an empty vector, never an error.
pub fn blocked_story_ids_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(BLOCKED_STORY_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list blocked Story ids for project")
}

/// The count of distinct Stories in `project_id` that are Waiting on you. Always equal to `blocked_story_ids_for_project(..).len()`.
pub fn blocked_count_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<i64> {
    let count: i64 = conn
        .query_row(BLOCKED_COUNT_SQL, params![project_id], |row| row.get(0))
        .context("failed to count blocked Stories for project")?;
    Ok(count)
}

/// One pending `permission_requests` row, projected for a caller that needs its CONTENT (tool
/// name, raw input payload, when it was raised). Feeds the permission-request card (AGNT-06).
#[derive(Debug, Clone, PartialEq)]
pub struct PendingPermissionRequest {
    pub id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub created_at: String,
    /// `None` for the routine variant, `Some(category)` for a Gated action — the exact kebab-case
    /// string `destructive::DestructiveCategory::as_str()` produces.
    pub destructive_category: Option<String>,
}

const PENDING_REQUESTS_FOR_RUN_SQL: &str =
    "SELECT id, tool_name, input_payload, created_at, destructive_category \
    FROM permission_requests WHERE session_id = ?1 AND status = 'pending' AND expired_at IS NULL \
    ORDER BY created_at ASC, id ASC";

/// Every pending `permission_requests` row for one session, oldest first. Ordinarily at most one
/// row, but two concurrent held calls can each raise their own pending row for the SAME session —
/// this reads ALL of them, never just the latest. Do not introduce a `LIMIT` here.
pub fn pending_requests_for_run(conn: &Connection, session_id: &str) -> anyhow::Result<Vec<PendingPermissionRequest>> {
    let mut stmt = conn.prepare(PENDING_REQUESTS_FOR_RUN_SQL)?;
    let rows = stmt
        .query_map(params![session_id], |row| {
            Ok(PendingPermissionRequest {
                id: row.get(0)?,
                tool_name: row.get(1)?,
                input_payload: row.get(2)?,
                created_at: row.get(3)?,
                destructive_category: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list pending permission requests for session")
}

const LATEST_RUN_ID_FOR_STORY_SQL: &str =
    "SELECT id FROM sessions WHERE story_id = ?1 ORDER BY started_at DESC, id DESC LIMIT 1";

/// The most recent session id for `story_id` (by `started_at`), or `None` if the Story has never
/// had a session.
pub fn latest_run_id_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Option<String>> {
    conn.query_row(LATEST_RUN_ID_FOR_STORY_SQL, params![story_id], |row| row.get(0))
        .optional()
        .context("failed to resolve the latest session for the Story")
}
