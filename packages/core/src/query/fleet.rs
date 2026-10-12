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

use anyhow::Context;
use rusqlite::{params, Connection};

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
