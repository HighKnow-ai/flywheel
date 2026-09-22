//! `session_summaries` (D-65, CTX-01..CTX-04): `create_summary` / `list_summaries_for_task` /
//! `latest_summary_for_run` — the tracer's own write-then-read-back path.
//!
//! Two contracts this file lives under. First, every SQL statement here is a literal `&str`
//! bound through `params![]` — never assembled by `format!`/string interpolation, matching
//! `query/events.rs`'s own discipline. Second, and just as load-bearing: a recorded summary row
//! is never rewritten. No function in this module mutates or removes a previously recorded row —
//! there is no setter, no `update_summary`, and no delete path. The only statement this module
//! issues against `session_summaries` other than a read is the row insert itself; the
//! `agent_runs.exit_summary_id` pointer update inside [`create_summary`] is a write to a
//! *different* table, and is what carries "most recent" without ever touching history. CTX-02's
//! append-only rule lives here, at the write path, structurally — not as a UI guard, and not as a
//! promise a later change could quietly break.
//!
//! Follows `domain::permission_request::create_pending_request`'s one-transaction
//! row-write-plus-event shape exactly: resolve `task_id`/`project_id`/`worktree_id` from the
//! `agent_runs` row INSIDE the transaction (T-04-01 — `create_summary` accepts no caller-supplied
//! `task_id` or `project_id`, so a caller can never attribute a summary to a run it does not
//! drive), insert the row, update the pointer, append one event, one commit.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;

/// One decision entry inside a summary's `decisions` list (D-65) — a discrete, stable-id-bearing
/// entry, never a single prose blob. `id` is the stable identifier D-73's acknowledgement flow
/// echoes back via `SummaryFields::acknowledged_decisions`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionEntry {
    pub id: String,
    pub statement: String,
}

/// The caller-supplied content of a summary (D-65) — the shape every producer (the agent's own
/// `report_summary` tool, the fallback synthesizer, tests) passes to [`create_summary`], so every
/// producer writes through the identical shape regardless of where the content originated.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SummaryFields {
    /// Repo-relative file paths (D-65's machine-checkable half).
    pub changed_files: Vec<String>,
    /// D-65's prose half — what changed, in the agent's own words.
    pub changed_prose: Option<String>,
    pub remains: Option<String>,
    pub next_session_must_know: Option<String>,
    /// A discrete-entry list (D-65) — never one prose blob.
    pub decisions: Vec<DecisionEntry>,
    /// D-73's read-back input: the decision ids this session echoed back as acknowledged. `[]`
    /// when none.
    pub acknowledged_decisions: Vec<String>,
    /// The git ref the claims in this summary were made against (D-72's second detector reads
    /// this).
    pub diff_ref: Option<String>,
    /// True only for a row synthesized by the fallback path (plan 04-02) — never presented as
    /// though the agent authored it (P2). This flag travels with the row into every read, DTO
    /// and rendered section.
    pub auto_generated: bool,
}

/// A `session_summaries` row, as read back after [`create_summary`], [`list_summaries_for_task`]
/// or [`latest_summary_for_run`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: String,
    pub agent_run_id: String,
    pub worktree_id: Option<String>,
    pub task_id: String,
    pub project_id: String,
    pub changed_files: Vec<String>,
    pub changed_prose: Option<String>,
    pub remains: Option<String>,
    pub next_session_must_know: Option<String>,
    pub decisions: Vec<DecisionEntry>,
    pub acknowledged_decisions: Vec<String>,
    pub diff_ref: Option<String>,
    pub auto_generated: bool,
    pub created_by: String,
    pub created_at: String,
}

const LIST_SUMMARIES_FOR_TASK_SQL: &str = "SELECT id, agent_run_id, worktree_id, task_id, \
    project_id, changed_files, changed_prose, remains, next_session_must_know, decisions, \
    acknowledged_decisions, diff_ref, auto_generated, created_by, created_at \
    FROM session_summaries WHERE task_id = ?1 ORDER BY created_at ASC, id ASC";

const LATEST_SUMMARY_FOR_RUN_SQL: &str = "SELECT id, agent_run_id, worktree_id, task_id, \
    project_id, changed_files, changed_prose, remains, next_session_must_know, decisions, \
    acknowledged_decisions, diff_ref, auto_generated, created_by, created_at \
    FROM session_summaries WHERE agent_run_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1";

fn row_to_summary(row: &Row) -> rusqlite::Result<SessionSummary> {
    let changed_files_json: String = row.get(5)?;
    let decisions_json: String = row.get(9)?;
    let acknowledged_json: String = row.get(10)?;
    let auto_generated_int: i64 = row.get(12)?;

    let changed_files: Vec<String> = serde_json::from_str(&changed_files_json)
        .unwrap_or_else(|_| Vec::new());
    let decisions: Vec<DecisionEntry> =
        serde_json::from_str(&decisions_json).unwrap_or_else(|_| Vec::new());
    let acknowledged_decisions: Vec<String> =
        serde_json::from_str(&acknowledged_json).unwrap_or_else(|_| Vec::new());

    Ok(SessionSummary {
        id: row.get(0)?,
        agent_run_id: row.get(1)?,
        worktree_id: row.get(2)?,
        task_id: row.get(3)?,
        project_id: row.get(4)?,
        changed_files,
        changed_prose: row.get(6)?,
        remains: row.get(7)?,
        next_session_must_know: row.get(8)?,
        decisions,
        acknowledged_decisions,
        diff_ref: row.get(11)?,
        auto_generated: auto_generated_int != 0,
        created_by: row.get(13)?,
        created_at: row.get(14)?,
    })
}

/// Record one summary for `agent_run_id` (D-65). One transaction: resolve `task_id`,
/// `project_id` and `worktree_id` from the `agent_runs` row (never accepted as a parameter —
/// T-04-01), mint the id, serialise the three list fields to JSON, insert the row, point
/// `agent_runs.exit_summary_id` at this new row (so the pointer always names the most recent
/// summary), append a `summary.recorded` event, one commit.
///
/// The event payload is human-renderable per D-19 and deliberately narrow: the summary id, the
/// `auto_generated` flag and the changed-file count — never the prose fields, so the activity
/// trail cannot leak session content into a surface that does not expect it (T-04-04).
pub fn create_summary(
    conn: &mut Connection,
    agent_run_id: &str,
    fields: SummaryFields,
    actor_id: &str,
) -> anyhow::Result<SessionSummary> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = new_id();

    let tx: Transaction = conn.transaction()?;

    let (task_id, project_id, worktree_id): (String, String, Option<String>) = tx
        .query_row(
            "SELECT task_id, project_id, worktree_id FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;

    let changed_files_json = serde_json::to_string(&fields.changed_files)
        .context("failed to serialise changed_files")?;
    let decisions_json =
        serde_json::to_string(&fields.decisions).context("failed to serialise decisions")?;
    let acknowledged_json = serde_json::to_string(&fields.acknowledged_decisions)
        .context("failed to serialise acknowledged_decisions")?;

    tx.execute(
        "INSERT INTO session_summaries (
            id, agent_run_id, worktree_id, task_id, project_id, changed_files, changed_prose,
            remains, next_session_must_know, decisions, acknowledged_decisions, diff_ref,
            auto_generated, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            id,
            agent_run_id,
            worktree_id,
            task_id,
            project_id,
            changed_files_json,
            fields.changed_prose,
            fields.remains,
            fields.next_session_must_know,
            decisions_json,
            acknowledged_json,
            fields.diff_ref,
            fields.auto_generated as i64,
            actor_id,
            now,
        ],
    )
    .context("failed to insert session_summaries row")?;

    tx.execute(
        "UPDATE agent_runs SET exit_summary_id = ?1 WHERE id = ?2",
        params![id, agent_run_id],
    )
    .context("failed to update agent_runs.exit_summary_id")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "session_summary",
        "before": null,
        "after": id,
        "auto_generated": fields.auto_generated,
        "changed_file_count": fields.changed_files.len(),
        "label": if fields.auto_generated {
            "Recorded an auto-generated session summary".to_string()
        } else {
            "Recorded a session summary".to_string()
        },
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "session_summary",
        &id,
        Some(&task_id),
        None,
        actor_id,
        "summary.recorded",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit create_summary transaction")?;

    Ok(SessionSummary {
        id,
        agent_run_id: agent_run_id.to_string(),
        worktree_id,
        task_id,
        project_id,
        changed_files: fields.changed_files,
        changed_prose: fields.changed_prose,
        remains: fields.remains,
        next_session_must_know: fields.next_session_must_know,
        decisions: fields.decisions,
        acknowledged_decisions: fields.acknowledged_decisions,
        diff_ref: fields.diff_ref,
        auto_generated: fields.auto_generated,
        created_by: actor_id.to_string(),
        created_at: now,
    })
}

/// Every summary recorded for `task_id`, ordered `created_at ASC, id ASC` — the packet's own read
/// order. The ULID tie-break is load-bearing (CTX-04): two summaries written in the same
/// millisecond still order deterministically, and calling this twice against an unchanged
/// database returns the same sequence.
pub fn list_summaries_for_task(
    conn: &Connection,
    task_id: &str,
) -> anyhow::Result<Vec<SessionSummary>> {
    let mut stmt = conn.prepare(LIST_SUMMARIES_FOR_TASK_SQL)?;
    let summaries = stmt
        .query_map(params![task_id], row_to_summary)?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read summaries for task")?;
    Ok(summaries)
}

/// The most recent summary recorded for `agent_run_id`, if one exists — the fallback
/// synthesizer's presence check (plan 04-02): "did this run already produce a summary before I
/// synthesize one."
pub fn latest_summary_for_run(
    conn: &Connection,
    agent_run_id: &str,
) -> anyhow::Result<Option<SessionSummary>> {
    conn.query_row(LATEST_SUMMARY_FOR_RUN_SQL, params![agent_run_id], row_to_summary)
        .optional()
        .context("failed to look up the latest summary for this run")
}
