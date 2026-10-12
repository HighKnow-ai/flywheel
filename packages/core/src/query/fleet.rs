//! The cross-project fleet read (FLEET-01, FLEET-04, D-163..D-171): every agent run across every
//! registered project in one bounded, banded, ordered statement. `fleet_rows` is the generalisation
//! of `query::permissions` / `query::recovery`'s per-project reads, and keeps their discipline —
//! the statement below is a single literal `&str`, bound through `params![]`, never assembled by
//! the string-interpolation macro this crate's tests grep-gate against.
//!
//! * **Derived, never stored (D-168).** `fleet_state` is a `CASE` alias in the select list: a
//!   `completed` run whose task is not yet `done` reads `awaiting_review`; every other case is the
//!   run status unchanged. No column holds it, so it cannot disagree with `agent_runs.status` or
//!   `tasks.status`.
//! * **Banding and ordering happen here, in SQL (D-03).** The renderer only groups. Band order is
//!   fixed (blocked, awaiting review, abandoned, running, then the terminal states), longest
//!   waiting first inside a band, with `agent_runs.id` as the final key so two reads of an
//!   unchanged database return byte-identical order.
//! * **Which rows appear (D-165).** A live run (`running`/`blocked`) always appears. A terminal run
//!   appears only while `acknowledged_at IS NULL`, and — RESEARCH Finding 1b — a task with several
//!   unacknowledged terminal runs contributes only its most recent one, by the same
//!   `started_at DESC, id DESC` subselect `query::recovery` uses. `abandoned` is the one exception:
//!   it appears whenever unacknowledged, matching `recovery.rs`'s any-unacknowledged rule so the
//!   rail count and the band can never disagree.
//! * **Runs with no task are first-class (Finding 10).** `agent_runs.task_id` is nullable (an
//!   authoring or planning run), so `tasks` and `epics` are `LEFT JOIN`ed.

use std::path::Path;

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::worktree::{porcelain_entries, reclaim_eligibility, ReclaimDisposition};
use crate::merge::{integrated_merge_commit, merge_commit_is_reachable};

/// The hard ceiling on one fleet window. The Tauri command applies its own cap before it calls in
/// here; this clamp is the backstop for any other caller.
pub const FLEET_ROWS_MAX_LIMIT: usize = 200;

/// What a fleet row is *about*. `agent_runs` allows `task_id` and `epic_id` to both be NULL and
/// forbids both being set (migration 0010), so the subject has three shapes the renderer must be
/// able to draw (Finding 10).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FleetSubjectKind {
    /// A run on a task: the row carries the task key and title.
    Task,
    /// A planning run carrying an epic and no authoring stage.
    Epic,
    /// An authoring run (it carries a stage), or a run with no subject key at all.
    Authoring,
}

impl FleetSubjectKind {
    /// The wire word the renderer matches on.
    pub fn as_str(self) -> &'static str {
        match self {
            FleetSubjectKind::Task => "task",
            FleetSubjectKind::Epic => "epic",
            FleetSubjectKind::Authoring => "authoring",
        }
    }
}

/// One row of the fleet. `fleet_state` is one of `running`, `blocked`, `awaiting_review`,
/// `completed`, `failed`, `interrupted`, `abandoned`.
#[derive(Debug, Clone, PartialEq)]
pub struct FleetRow {
    pub agent_run_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub project_status: String,
    pub subject_kind: FleetSubjectKind,
    pub task_id: Option<String>,
    pub task_key: Option<String>,
    pub task_title: Option<String>,
    pub task_status: Option<String>,
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub authoring_stage: Option<String>,
    pub run_status: String,
    pub fleet_state: String,
    pub started_at: String,
    pub ended_at: Option<String>,
    /// When the oldest still-pending permission request of this run was raised; `None` for a run
    /// that is not waiting on one.
    pub blocked_since: Option<String>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FleetList {
    pub rows: Vec<FleetRow>,
    /// The length of `rows` — never a second count, so the header and the list cannot disagree.
    pub total_rows: usize,
    /// The sum of the non-NULL `cost_usd` of the rows returned, computed here so the renderer never
    /// aggregates; `None` when no returned row carries a cost, so the footer shows no total rather
    /// than a zero. `cost_usd` is the client-side estimate `apply_session_closed` stores from a
    /// bundled price table, not billing data (Finding 11).
    pub visible_cost_usd: Option<f64>,
}

/// The fleet statement. The `ORDER BY` sits in an outer select so it can name the `fleet_state`
/// and `blocked_since` aliases instead of restating the `CASE` and the correlated subselect.
pub const FLEET_SQL: &str = "SELECT * FROM ( \
    SELECT ar.id AS agent_run_id, ar.project_id AS project_id, p.name AS project_name, \
        p.key_prefix AS project_key_prefix, p.status AS project_status, \
        ar.task_id AS task_id, t.key AS task_key, t.title AS task_title, t.status AS task_status, \
        ar.epic_id AS epic_id, e.key AS epic_key, ar.authoring_stage AS authoring_stage, \
        ar.status AS run_status, \
        CASE \
            WHEN ar.status = 'completed' AND t.id IS NOT NULL AND t.status <> 'done' \
                THEN 'awaiting_review' \
            ELSE ar.status \
        END AS fleet_state, \
        ar.started_at AS started_at, ar.ended_at AS ended_at, \
        (SELECT MIN(pr.created_at) FROM permission_requests pr \
            WHERE pr.agent_run_id = ar.id AND pr.status = 'pending') AS blocked_since, \
        ar.cost_usd AS cost_usd, ar.tokens_in AS tokens_in, ar.tokens_out AS tokens_out \
    FROM agent_runs ar \
    JOIN projects p ON p.id = ar.project_id \
    LEFT JOIN tasks t ON t.id = ar.task_id \
    LEFT JOIN epics e ON e.id = ar.epic_id \
    WHERE ar.status IN ('running', 'blocked') \
        OR (ar.status IN ('completed', 'failed', 'interrupted', 'abandoned') \
            AND ar.acknowledged_at IS NULL \
            AND (ar.status = 'abandoned' OR ar.task_id IS NULL OR ar.id = ( \
                SELECT ar2.id FROM agent_runs ar2 WHERE ar2.task_id = ar.task_id \
                ORDER BY ar2.started_at DESC, ar2.id DESC LIMIT 1))) \
    ) \
    ORDER BY \
        CASE fleet_state \
            WHEN 'blocked' THEN 1 \
            WHEN 'awaiting_review' THEN 2 \
            WHEN 'abandoned' THEN 3 \
            WHEN 'running' THEN 4 \
            ELSE 5 \
        END ASC, \
        COALESCE(blocked_since, ended_at, started_at) ASC, \
        agent_run_id ASC \
    LIMIT ?1";

fn subject_kind(
    task_id: &Option<String>,
    epic_id: &Option<String>,
    authoring_stage: &Option<String>,
) -> FleetSubjectKind {
    if task_id.is_some() {
        FleetSubjectKind::Task
    } else if authoring_stage.is_none() && epic_id.is_some() {
        FleetSubjectKind::Epic
    } else {
        FleetSubjectKind::Authoring
    }
}

/// Every agent run across every registered project that belongs on the fleet, banded and ordered,
/// at most `limit` (clamped to [`FLEET_ROWS_MAX_LIMIT`]) rows. An empty database returns zero rows,
/// never an error.
pub fn fleet_rows(conn: &Connection, limit: usize) -> anyhow::Result<FleetList> {
    let limit = limit.min(FLEET_ROWS_MAX_LIMIT) as i64;
    let mut stmt = conn.prepare(FLEET_SQL)?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let task_id: Option<String> = row.get(5)?;
            let epic_id: Option<String> = row.get(9)?;
            let authoring_stage: Option<String> = row.get(11)?;
            Ok(FleetRow {
                agent_run_id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                project_key_prefix: row.get(3)?,
                project_status: row.get(4)?,
                subject_kind: subject_kind(&task_id, &epic_id, &authoring_stage),
                task_id,
                task_key: row.get(6)?,
                task_title: row.get(7)?,
                task_status: row.get(8)?,
                epic_id,
                epic_key: row.get(10)?,
                authoring_stage,
                run_status: row.get(12)?,
                fleet_state: row.get(13)?,
                started_at: row.get(14)?,
                ended_at: row.get(15)?,
                blocked_since: row.get(16)?,
                cost_usd: row.get(17)?,
                tokens_in: row.get(18)?,
                tokens_out: row.get(19)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the fleet")?;
    let total_rows = rows.len();
    let visible_cost_usd = rows.iter().filter_map(|r| r.cost_usd).fold(None, |sum, c| Some(sum.unwrap_or(0.0) + c));
    Ok(FleetList { rows, total_rows, visible_cost_usd })
}

/// The hard ceiling on one blocked-queue window (T-10-05-04).
pub const BLOCKED_QUEUE_MAX_LIMIT: usize = 200;

/// One agent sitting at a pending permission request (FLEET-02, D-172): the request the card needs
/// plus the run, project and subject the queue row names. One entry per run — its earliest-created
/// pending request — because the card answers one request at a time and two entries for one agent
/// would read as two blocked agents.
#[derive(Debug, Clone, PartialEq)]
pub struct BlockedQueueEntry {
    pub request_id: String,
    pub tool_name: String,
    pub input_payload: Option<String>,
    pub created_at: String,
    pub destructive_category: Option<String>,
    pub agent_run_id: String,
    pub project_id: String,
    pub project_name: String,
    pub project_key_prefix: String,
    pub subject_kind: FleetSubjectKind,
    pub task_id: Option<String>,
    pub task_key: Option<String>,
    pub task_title: Option<String>,
    pub epic_id: Option<String>,
    pub epic_key: Option<String>,
    pub authoring_stage: Option<String>,
    pub blocked_since: String,
}

/// `permissions::PENDING_REQUESTS_FOR_RUN_SQL`'s predicate and `created_at ASC, id ASC` tie-break,
/// generalised across projects (no `project_id` predicate, D-14) and inverted to one request per run
/// by a correlated subselect. Only `blocked` runs: abandoned and awaiting-review work stays on the
/// fleet (D-172), so a cold backlog can never bury a live block.
pub const BLOCKED_QUEUE_SQL: &str = "SELECT pr.id, pr.tool_name, pr.input_payload, pr.created_at, \
        pr.destructive_category, ar.id, ar.project_id, p.name, p.key_prefix, \
        ar.task_id, t.key, t.title, ar.epic_id, e.key, ar.authoring_stage \
    FROM permission_requests pr \
    JOIN agent_runs ar ON ar.id = pr.agent_run_id \
    JOIN projects p ON p.id = ar.project_id \
    LEFT JOIN tasks t ON t.id = ar.task_id \
    LEFT JOIN epics e ON e.id = ar.epic_id \
    WHERE ar.status = 'blocked' AND pr.status = 'pending' \
        AND pr.id = ( \
            SELECT pr2.id FROM permission_requests pr2 \
            WHERE pr2.agent_run_id = ar.id AND pr2.status = 'pending' \
            ORDER BY pr2.created_at ASC, pr2.id ASC LIMIT 1) \
    ORDER BY pr.created_at ASC, pr.id ASC \
    LIMIT ?1";

/// Every agent across every registered project currently blocked at a pending permission request,
/// longest-waiting first, at most `limit` (clamped to [`BLOCKED_QUEUE_MAX_LIMIT`]). An empty
/// database returns zero entries, never an error.
pub fn blocked_queue(conn: &Connection, limit: usize) -> anyhow::Result<Vec<BlockedQueueEntry>> {
    let limit = limit.min(BLOCKED_QUEUE_MAX_LIMIT) as i64;
    let mut stmt = conn.prepare(BLOCKED_QUEUE_SQL)?;
    let rows = stmt
        .query_map(params![limit], |row| {
            let task_id: Option<String> = row.get(9)?;
            let epic_id: Option<String> = row.get(12)?;
            let authoring_stage: Option<String> = row.get(14)?;
            let created_at: String = row.get(3)?;
            Ok(BlockedQueueEntry {
                request_id: row.get(0)?,
                tool_name: row.get(1)?,
                input_payload: row.get(2)?,
                blocked_since: created_at.clone(),
                created_at,
                destructive_category: row.get(4)?,
                agent_run_id: row.get(5)?,
                project_id: row.get(6)?,
                project_name: row.get(7)?,
                project_key_prefix: row.get(8)?,
                subject_kind: subject_kind(&task_id, &epic_id, &authoring_stage),
                task_id,
                task_key: row.get(10)?,
                task_title: row.get(11)?,
                epic_id,
                epic_key: row.get(13)?,
                authoring_stage,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the blocked queue")?;
    Ok(rows)
}

// ---------------------------------------------------------------------------------------------
// The worktree inventory (WORK-07, D-177, D-178): task worktrees across every project, each with
// its cached disk size and a stated disposition. Two phases on `change_flags`' template: a board
// half under the database lock, a git and filesystem half without it.
//
// Task worktrees only. `worktrees.task_id` is UNIQUE and NOT NULL, so epic integration worktrees
// (real directories under the same root, used by merges and planning runs) have no row and cannot
// be listed or sized here (RESEARCH Finding 8).
// ---------------------------------------------------------------------------------------------

/// The hard ceiling on one inventory window. The Tauri command applies its own cap first.
pub const WORKTREE_INVENTORY_MAX_LIMIT: usize = 500;

/// What the git half needs per worktree, resolved from the board so no path, ref or sha crosses IPC.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeInventoryInput {
    pub task_id: String,
    pub task_key: String,
    pub task_title: String,
    pub task_status: String,
    pub project_id: String,
    pub project_name: String,
    pub project_status: String,
    pub repo_path: String,
    pub path: String,
    pub branch: String,
    /// The epic's integration branch; `None` for a task with no epic (task-Done is then the only
    /// reclaimable reason) or an epic whose branch was never cut.
    pub integration_branch: Option<String>,
    /// The merge commit recorded by the task's integrated event, read here under the lock so the
    /// git half only runs the ancestry check (the split of `merge::is_integrated`).
    pub merge_commit: Option<String>,
    pub size_bytes: Option<i64>,
    pub size_measured_at: Option<String>,
    /// `blocked` or `running` when a run is live against the task; `blocked` wins over `running`.
    pub live_run_status: Option<String>,
}

/// One inventory row: the facts the renderer shows plus the derived disposition.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeInventoryRow {
    pub task_id: String,
    pub task_key: String,
    pub task_title: String,
    pub task_status: String,
    pub project_id: String,
    pub project_name: String,
    pub project_status: String,
    pub path: String,
    pub branch: String,
    pub size_bytes: Option<i64>,
    pub size_measured_at: Option<String>,
    pub disposition: ReclaimDisposition,
}

/// The SELECT and joins shared by the inventory and by the single-row re-read the reclaim batch
/// makes (plan 10-09), so the live-run clause that makes a stale selection harmless has exactly one
/// definition. A macro rather than a `const` because `concat!` only accepts literals.
macro_rules! worktree_inventory_select {
    () => {
        "SELECT t.id, t.key, t.title, t.status, p.id, p.name, p.status, \
        p.repo_path, w.path, w.branch, e.integration_branch, w.size_bytes, w.size_measured_at, \
        (SELECT ar.status FROM agent_runs ar WHERE ar.task_id = t.id AND ar.status IN ('running', 'blocked') \
            ORDER BY ar.status ASC LIMIT 1) \
    FROM worktrees w \
    JOIN tasks t ON t.id = w.task_id \
    JOIN projects p ON p.id = w.project_id \
    LEFT JOIN epics e ON e.id = t.epic_id"
    };
}

/// The inventory statement. Size descending (never-measured last: SQLite sorts NULL lowest), task
/// key ascending as the tie-break, then the worktree id so two reads are byte-identical.
pub const WORKTREE_INVENTORY_SQL: &str =
    concat!(worktree_inventory_select!(), " ORDER BY w.size_bytes DESC, t.key ASC, w.id ASC LIMIT ?1");

const WORKTREE_INVENTORY_ONE_SQL: &str = concat!(worktree_inventory_select!(), " WHERE t.id = ?1");

fn inventory_input_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<WorktreeInventoryInput> {
    Ok(WorktreeInventoryInput {
        task_id: row.get(0)?,
        task_key: row.get(1)?,
        task_title: row.get(2)?,
        task_status: row.get(3)?,
        project_id: row.get(4)?,
        project_name: row.get(5)?,
        project_status: row.get(6)?,
        repo_path: row.get(7)?,
        path: row.get(8)?,
        branch: row.get(9)?,
        integration_branch: row.get(10)?,
        merge_commit: None,
        size_bytes: row.get(11)?,
        size_measured_at: row.get(12)?,
        live_run_status: row.get(13)?,
    })
}

/// The board half for ONE task, read fresh: `None` when the task has no worktree row. Plan 10-09's
/// reclaim calls this per row, at the moment it acts, so a selection made against an earlier read
/// is judged against what is true now.
pub fn worktree_inventory_input_for_task(
    conn: &Connection,
    task_id: &str,
) -> anyhow::Result<Option<WorktreeInventoryInput>> {
    let input = conn
        .query_row(WORKTREE_INVENTORY_ONE_SQL, params![task_id], inventory_input_from_row)
        .optional()
        .context("failed to read one worktree for reclaim")?;
    match input {
        Some(mut input) => {
            input.merge_commit = integrated_merge_commit(conn, &input.task_id)?;
            Ok(Some(input))
        }
        None => Ok(None),
    }
}

/// The board half: every task worktree across every project, at most `limit` (clamped to
/// [`WORKTREE_INVENTORY_MAX_LIMIT`]). Takes only a `&Connection` and spawns no process, so it is
/// safe under the database lock; hand the result to [`finish_worktree_inventory`] once the lock is
/// released. One database holds every project, so there is no project argument.
pub fn worktree_inventory_inputs(conn: &Connection, limit: usize) -> anyhow::Result<Vec<WorktreeInventoryInput>> {
    let limit = limit.min(WORKTREE_INVENTORY_MAX_LIMIT) as i64;
    let mut stmt = conn.prepare(WORKTREE_INVENTORY_SQL)?;
    let mut inputs = stmt
        .query_map(params![limit], inventory_input_from_row)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the worktree inventory")?;
    // ponytail: one small indexed read per row (at most the window); fold into the statement with
    // json_extract if the window ever grows past a few hundred.
    for input in &mut inputs {
        input.merge_commit = integrated_merge_commit(conn, &input.task_id)?;
    }
    Ok(inputs)
}

/// The git and filesystem half: takes no connection. Order is preserved (the SQL order is the
/// list's order). Spawns are minimised: an unreachable project, a missing directory and a live run
/// short-circuit before any git call, the ancestry check runs only for a task that is not already
/// Done, and the porcelain read -- through [`porcelain_entries`], the one porcelain site -- runs
/// only for a row that has already passed the board-state test and has no live run. A porcelain
/// read that fails is treated as dirty: a tree git cannot describe is never offered for reclaim.
pub fn finish_worktree_inventory(inputs: Vec<WorktreeInventoryInput>) -> Vec<WorktreeInventoryRow> {
    inputs
        .into_iter()
        .map(|input| {
            let reachable = input.project_status != "unreachable";
            let present = reachable && Path::new(&input.path).try_exists().unwrap_or(false);
            let evaluable = reachable && present && input.live_run_status.is_none();
            let integrated = evaluable
                && input.task_status != "done"
                && match (&input.merge_commit, &input.integration_branch) {
                    (Some(commit), Some(branch)) => {
                        merge_commit_is_reachable(Path::new(&input.repo_path), commit, branch).unwrap_or(false)
                    }
                    _ => false,
                };
            let passed_board_test = input.task_status == "done" || integrated;
            let dirty = evaluable
                && passed_board_test
                && porcelain_entries(Path::new(&input.path)).map(|e| !e.is_empty()).unwrap_or(true);
            let disposition = reclaim_eligibility(
                &input.task_status,
                integrated,
                input.live_run_status.as_deref(),
                dirty,
                &input.project_status,
                present || !reachable,
            );
            WorktreeInventoryRow {
                task_id: input.task_id,
                task_key: input.task_key,
                task_title: input.task_title,
                task_status: input.task_status,
                project_id: input.project_id,
                project_name: input.project_name,
                project_status: input.project_status,
                path: input.path,
                branch: input.branch,
                size_bytes: input.size_bytes,
                size_measured_at: input.size_measured_at,
                disposition,
            }
        })
        .collect()
}

/// A worktree a measure call should walk: the id and the path the core read from the row.
#[derive(Debug, Clone, PartialEq)]
pub struct WorktreeMeasureTarget {
    pub task_id: String,
    pub path: String,
}

/// The paths to measure for `task_ids`, or for every worktree when `None`, at most `limit`. An id
/// with no worktree row is simply absent. The renderer only ever names ids; every path comes from
/// the `worktrees` rows here.
pub fn worktree_measure_targets(
    conn: &Connection,
    task_ids: Option<&[String]>,
    limit: usize,
) -> anyhow::Result<Vec<WorktreeMeasureTarget>> {
    let mut targets = Vec::new();
    match task_ids {
        Some(ids) => {
            for id in ids.iter().take(limit) {
                if let Some(wt) = crate::domain::worktree::worktree_for_task(conn, id)? {
                    targets.push(WorktreeMeasureTarget { task_id: wt.task_id, path: wt.path });
                }
            }
        }
        None => {
            let mut stmt = conn.prepare("SELECT task_id, path FROM worktrees ORDER BY id ASC LIMIT ?1")?;
            targets = stmt
                .query_map(params![limit as i64], |row| {
                    Ok(WorktreeMeasureTarget { task_id: row.get(0)?, path: row.get(1)? })
                })?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the worktrees to measure")?;
        }
    }
    Ok(targets)
}

/// Cache one measured size: writes `size_bytes` and `size_measured_at` for the one worktree of
/// `task_id` and nothing else. Returns whether a row was updated.
pub fn record_worktree_size(
    conn: &Connection,
    task_id: &str,
    size_bytes: i64,
    measured_at: &str,
) -> anyhow::Result<bool> {
    let changed = conn
        .execute(
            "UPDATE worktrees SET size_bytes = ?1, size_measured_at = ?2 WHERE task_id = ?3",
            params![size_bytes, measured_at, task_id],
        )
        .context("failed to record the worktree size")?;
    Ok(changed == 1)
}
