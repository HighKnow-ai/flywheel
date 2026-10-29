//! Bounded, literal-SQL reads over `sessions`/`permission_requests` for the board's Waiting on you
//! signal (docs/mvp-spec.md §2 "Attention"): `blocked_story_ids_for_project`,
//! `waiting_epic_ids_for_project` and `blocked_count_for_project`. Every statement below is a single
//! literal `&str` (spliced with `concat!` at most), bound through `params![]`, never assembled by
//! `format!`/string interpolation.
//!
//! A Story is Waiting on you when one of its LIVE sessions (`running` or `blocked`) holds a pending
//! request. It is derived from the pending rows, never from `sessions.status = 'blocked'`, which
//! v0.1 read and which a single answer could reset while other requests still waited (issue #57).
//! An Epic is Waiting on you when a live shaping session is held on one of its open Rounds
//! (issue #124, `crate::query::round_waiting_on_you`); a held Round never writes the session's status.
//! A project's Roadmap is Waiting on you the same way, while a live roadmap session is held on its
//! open roadmap Round (issue #133); it counts once. A Milestone is Waiting on you like an Epic, on a
//! Round of its Exit test (issue #132).

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

const BLOCKED_STORY_IDS_SQL: &str = "SELECT DISTINCT ar.story_id FROM sessions ar \
    WHERE ar.project_id = ?1 AND ar.kind = 'story' AND ar.status IN ('running', 'blocked') \
    AND EXISTS (SELECT 1 FROM permission_requests pr WHERE pr.session_id = ar.id AND pr.status = 'pending' AND pr.expired_at IS NULL) \
    ORDER BY ar.story_id ASC";

const WAITING_EPIC_IDS_SQL: &str = concat!(
    "SELECT DISTINCT st.epic_id FROM rounds r JOIN stages st ON st.id = r.stage_id \
    WHERE st.project_id = ?1 AND st.epic_id IS NOT NULL AND ",
    crate::query::round_waiting_on_you!(),
    " ORDER BY st.epic_id ASC"
);

const BLOCKED_COUNT_SQL: &str = concat!(
    "SELECT (SELECT COUNT(DISTINCT ar.story_id) FROM sessions ar \
    WHERE ar.project_id = ?1 AND ar.kind = 'story' AND ar.status IN ('running', 'blocked') \
    AND EXISTS (SELECT 1 FROM permission_requests pr WHERE pr.session_id = ar.id AND pr.status = 'pending' AND pr.expired_at IS NULL)) \
    + (SELECT COUNT(DISTINCT st.epic_id) FROM rounds r JOIN stages st ON st.id = r.stage_id \
    WHERE st.project_id = ?1 AND st.epic_id IS NOT NULL AND ",
    crate::query::round_waiting_on_you!(),
    ") + (SELECT COUNT(DISTINCT st.milestone_id) FROM rounds r JOIN stages st ON st.id = r.stage_id \
    WHERE st.project_id = ?1 AND st.milestone_id IS NOT NULL AND ",
    crate::query::round_waiting_on_you!(),
    ") + (SELECT COUNT(*) FROM rounds r WHERE r.project_id = ?1 AND r.stage_id IS NULL AND ",
    crate::query::round_waiting_on_you!(),
    ")"
);

const WAITING_MILESTONE_IDS_SQL: &str = concat!(
    "SELECT DISTINCT st.milestone_id FROM rounds r JOIN stages st ON st.id = r.stage_id \
    WHERE st.project_id = ?1 AND st.milestone_id IS NOT NULL AND ",
    crate::query::round_waiting_on_you!(),
    " ORDER BY st.milestone_id ASC"
);

const ROADMAP_WAITING_SQL: &str = concat!(
    "SELECT EXISTS (SELECT 1 FROM rounds r WHERE r.project_id = ?1 AND r.stage_id IS NULL AND ",
    crate::query::round_waiting_on_you!(),
    ")"
);

/// Every distinct Story id in `project_id` that is Waiting on you: a live session of it holds a
/// pending request. A project with no sessions at all returns an empty vector, never an error.
pub fn blocked_story_ids_for_project(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(BLOCKED_STORY_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list blocked Story ids for project")
}

/// Every distinct Epic id in `project_id` that is Waiting on you (issue #124): a live shaping session
/// is held on one of its open Rounds. Empty when nothing is, never an error.
pub fn waiting_epic_ids_for_project(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(WAITING_EPIC_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list the Epics waiting on you for project")
}

/// Every distinct Milestone id in `project_id` that is Waiting on you (issue #132): a live shaping
/// session is held on an open Round of its Exit test. Empty when nothing is, never an error.
pub fn waiting_milestone_ids_for_project(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(WAITING_MILESTONE_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list the Milestones waiting on you for project")
}

/// Whether the project's Roadmap is Waiting on you (issue #133): a live roadmap session is held on its
/// open roadmap Round, until the developer decides each of the Round's Proposals.
pub fn roadmap_waiting_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<bool> {
    conn.query_row(ROADMAP_WAITING_SQL, params![project_id], |row| row.get(0))
        .context("failed to read whether the Roadmap is waiting on you")
}

/// The project's Needs-you count of what is Waiting on you: the distinct Stories, the distinct Epics
/// (issue #124), the distinct Milestones (issue #132) and the Roadmap (issue #133). Always equal to
/// `blocked_story_ids_for_project(..).len()` plus `waiting_epic_ids_for_project(..).len()` plus
/// `waiting_milestone_ids_for_project(..).len()`, plus one while `roadmap_waiting_for_project`.
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
pub fn pending_requests_for_run(
    conn: &Connection,
    session_id: &str,
) -> anyhow::Result<Vec<PendingPermissionRequest>> {
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
pub fn latest_run_id_for_story(
    conn: &Connection,
    story_id: &str,
) -> anyhow::Result<Option<String>> {
    conn.query_row(LATEST_RUN_ID_FOR_STORY_SQL, params![story_id], |row| {
        row.get(0)
    })
    .optional()
    .context("failed to resolve the latest session for the Story")
}
