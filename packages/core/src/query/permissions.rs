//! Bounded, literal-SQL reads over `agent_runs`/`permission_requests` for D-37's board-visible
//! "blocked" signal: `blocked_task_ids_for_project` (the board's blocked task-row indicator) and
//! `blocked_count_for_project` (the project-rail count). Follows `query::events`'s own discipline
//! — every statement below is a single literal `&str`, bound through `params![]`, never assembled
//! by `format!`/string interpolation.
//!
//! "Blocked" here means: a task's MOST RECENT agent run (by `started_at`) is currently
//! `status = 'blocked'`. A task's older, already-terminal runs never count, even if one of them
//! happened to end blocked (impossible today since `interrupt_agent_run`/`close_agent_run` always
//! move a run to a terminal status, but the query is written to be correct under that definition
//! regardless).
//!
//! Plan 05-09: an authoring run is an ordinary run (D-46's "only money burning blocks" rule
//! applies identically), so a permission-blocked authoring run must join the SAME rail count a
//! permission-blocked task run does — it is burning money and waiting on a human exactly the same
//! way. It carries no `task_id`, so `blocked_task_ids_for_project` (the board's TASK-row
//! indicator) genuinely has nowhere to put it — there is no task row to mark. `blocked_count_for_project`
//! is different: it is the rail's aggregate "how many things are burning money and waiting on me"
//! signal, not a set of task ids, so it is widened to also count a blocked authoring run, keyed by
//! `COALESCE(epic_id, id)` rather than `task_id` — an authoring run reopening the same epic twice
//! is still "the same subject" for the most-recent-run rule; a fresh-epic run (`epic_id IS NULL`)
//! has no natural sibling to be "most recent" among, so it is keyed by its own id instead, which
//! trivially satisfies the MAX(started_at) self-comparison.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

const BLOCKED_TASK_IDS_SQL: &str = "SELECT ar.task_id FROM agent_runs ar \
    WHERE ar.project_id = ?1 AND ar.status = 'blocked' \
    AND ar.started_at = (SELECT MAX(started_at) FROM agent_runs WHERE task_id = ar.task_id) \
    ORDER BY ar.task_id ASC";

const BLOCKED_COUNT_SQL: &str = "SELECT COUNT(*) FROM ( \
    SELECT ar.task_id AS subject FROM agent_runs ar \
    WHERE ar.project_id = ?1 AND ar.status = 'blocked' AND ar.task_id IS NOT NULL \
    AND ar.started_at = (SELECT MAX(started_at) FROM agent_runs WHERE task_id = ar.task_id) \
    UNION \
    SELECT COALESCE(ar.epic_id, ar.id) AS subject FROM agent_runs ar \
    WHERE ar.project_id = ?1 AND ar.status = 'blocked' AND ar.task_id IS NULL \
    AND ar.started_at = ( \
        SELECT MAX(started_at) FROM agent_runs \
        WHERE task_id IS NULL AND COALESCE(epic_id, id) = COALESCE(ar.epic_id, ar.id) \
    ) \
    )";

/// Every distinct task id in `project_id` whose most recent agent run is `blocked` (D-37) — feeds
/// the board's blocked task-row indicator. A project with no runs at all returns an empty vector,
/// never an error.
pub fn blocked_task_ids_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(BLOCKED_TASK_IDS_SQL)?;
    let rows = stmt
        .query_map(params![project_id], |row| row.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list blocked task ids for project")
}

/// The count of distinct tasks in `project_id` whose most recent agent run is `blocked` (D-37),
/// PLUS (plan 05-09) any of the project's own authoring runs currently `blocked` — feeds the
/// project-rail count. Returns `0`, not an error, for a project with no runs at all.
pub fn blocked_count_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<i64> {
    let count: i64 = conn
        .query_row(BLOCKED_COUNT_SQL, params![project_id], |row| row.get(0))
        .context("failed to count blocked tasks for project")?;
    Ok(count)
}

/// One pending `permission_requests` row, projected for a caller that needs its CONTENT (tool
/// name, raw input payload, when it was raised) rather than just its existence — unlike
/// `blocked_task_ids_for_project` above, which only proves a task is blocked. Feeds the
/// permission-request card (AGNT-06, plan 02-06).
#[derive(Debug, Clone, PartialEq)]
pub struct PendingPermissionRequest {
    pub id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub created_at: String,
    /// `None` for the routine variant, `Some(category)` for a destructive one — the exact
    /// kebab-case string `destructive::DestructiveCategory::as_str()` produces (plan 03-07's
    /// classifier is the ONE place these strings are minted). Lets the destructive-action gate
    /// card (plan 03-12) select its variant without a second query.
    pub destructive_category: Option<String>,
}

const PENDING_REQUESTS_FOR_RUN_SQL: &str =
    "SELECT id, tool_name, input_payload, created_at, destructive_category \
    FROM permission_requests WHERE agent_run_id = ?1 AND status = 'pending' \
    ORDER BY created_at ASC, id ASC";

/// Every pending `permission_requests` row for `agent_run_id`, oldest first — the permission-
/// request card's own E3 zero-one-many resolution ("stacked in creation order, each independently
/// answerable," 02-06-PLAN.md Task 1). Ordinarily at most one row (the sidecar holds one tool call
/// open per run in the common case), but two concurrent held calls (02-05-SUMMARY's own D4) can
/// each raise their own pending row for the SAME run — this reads ALL of them, never just the
/// latest. `domain::permission_request::pending_for_run`'s `LIMIT 1` serves a different caller
/// (the sidecar-answer round trip, which only ever settles one row per answer) and is unaffected
/// by this addition.
///
/// Widened (plan 03-12) to also select `destructive_category` — this does NOT change the
/// windowing or ordering above: this read still returns ALL pending rows for a run, never just
/// the latest, per Phase 2's own fix for two concurrent tool calls each raising their own pending
/// row. Do not reintroduce a `LIMIT` here.
pub fn pending_requests_for_run(
    conn: &Connection,
    agent_run_id: &str,
) -> anyhow::Result<Vec<PendingPermissionRequest>> {
    let mut stmt = conn.prepare(PENDING_REQUESTS_FOR_RUN_SQL)?;
    let rows = stmt
        .query_map(params![agent_run_id], |row| {
            Ok(PendingPermissionRequest {
                id: row.get(0)?,
                tool_name: row.get(1)?,
                input_payload: row.get(2)?,
                created_at: row.get(3)?,
                destructive_category: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to list pending permission requests for run")
}

const LATEST_RUN_ID_FOR_TASK_SQL: &str =
    "SELECT id FROM agent_runs WHERE task_id = ?1 ORDER BY started_at DESC LIMIT 1";

/// The most recent agent run id for `task_id` (by `started_at`), or `None` if the task has never
/// had a run — the item detail panel's own resolution of "this task's active run" (AGNT-06, plan
/// 02-06 Task 2), so its compact permission-request card mount can read the exact same
/// `agent_run_id`-keyed query the feed mount uses (Discretion #6: "one query, one key, consumed by
/// both mount points"). Mirrors `blocked_task_ids_for_project`'s own "most recent run" definition.
pub fn latest_run_id_for_task(conn: &Connection, task_id: &str) -> anyhow::Result<Option<String>> {
    conn.query_row(LATEST_RUN_ID_FOR_TASK_SQL, params![task_id], |row| row.get(0))
        .optional()
        .context("failed to resolve the latest agent run for task")
}
