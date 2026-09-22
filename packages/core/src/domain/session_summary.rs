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

/// Insert one `session_summaries` row inside the CALLER's transaction, point
/// `agent_runs.exit_summary_id` at it, and append one `summary.recorded` event — the SINGLE
/// shared insert site every producer writes through. [`create_summary`] (agent-authored, opens
/// its own transaction) and [`synthesize_fallback_summary`] (the fallback, runs inside the
/// caller's transaction — plan 04-02) both call this and nothing else ever issues `INSERT INTO
/// session_summaries` (a `<verify>` gate greps the whole crate for exactly one occurrence).
///
/// The event payload is human-renderable per D-19 and deliberately narrow: the summary id, the
/// `auto_generated` flag and the changed-file count — never the prose fields, so the activity
/// trail cannot leak session content into a surface that does not expect it (T-04-04).
fn insert_summary_row(
    tx: &Transaction,
    agent_run_id: &str,
    fields: &SummaryFields,
    actor_id: &str,
    now: &str,
) -> anyhow::Result<SessionSummary> {
    let id = new_id();

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

    let sequence = next_sequence(tx, &project_id, "local")?;
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
        tx,
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
        now,
    )?;

    Ok(SessionSummary {
        id,
        agent_run_id: agent_run_id.to_string(),
        worktree_id,
        task_id,
        project_id,
        changed_files: fields.changed_files.clone(),
        changed_prose: fields.changed_prose.clone(),
        remains: fields.remains.clone(),
        next_session_must_know: fields.next_session_must_know.clone(),
        decisions: fields.decisions.clone(),
        acknowledged_decisions: fields.acknowledged_decisions.clone(),
        diff_ref: fields.diff_ref.clone(),
        auto_generated: fields.auto_generated,
        created_by: actor_id.to_string(),
        created_at: now.to_string(),
    })
}

/// Record one summary for `agent_run_id` (D-65). Opens its own transaction, then shares
/// [`insert_summary_row`] with [`synthesize_fallback_summary`] — the single insert site both
/// producers write through.
pub fn create_summary(
    conn: &mut Connection,
    agent_run_id: &str,
    fields: SummaryFields,
    actor_id: &str,
) -> anyhow::Result<SessionSummary> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx: Transaction = conn.transaction()?;

    let summary = insert_summary_row(&tx, agent_run_id, &fields, actor_id, &now)?;

    tx.commit().context("failed to commit create_summary transaction")?;

    Ok(summary)
}

/// The literal `&str` SQL [`synthesize_fallback_summary`] reads to derive its `changed_prose`
/// fact — every event whose `stream_id` names this run directly (its own bookkeeping and
/// tool-call-derived rows), plus every event attached to the run's own task whose `occurred_at`
/// falls inside the run's `[started_at, ended_at]` window (a permission request raised during
/// this run, for example, carries the permission request's own `stream_id`, not the run's).
const FALLBACK_EVENT_COUNT_SQL: &str = "SELECT COUNT(*) FROM events \
    WHERE stream_id = ?1 OR (task_id = ?2 AND occurred_at >= ?3 AND occurred_at <= ?4)";

/// Write a best-effort summary for a run that reached a terminal state with no summary of its own
/// (D-64, plan 04-02) — called by `domain::agent_run::apply_session_closed` INSIDE the same
/// transaction that writes the run's terminal status, never in a transaction it opens itself.
/// That is what makes "a run can never be terminal while its fallback summary is missing" a
/// property of the database rather than of call ordering.
///
/// Resolves `actor_id` from the `agent_runs` row itself — the row is attributed to the run's own
/// agent actor, never the local human actor, so DATA-03's actor model stays honest even though the
/// core, not the agent, is the one writing this row.
///
/// What this may claim, resolving CONTEXT.md's open discretion item explicitly: `changed_files` is
/// always an empty `Vec` (plan 04-07 fills it from a real `git diff --name-only`); `changed_prose`
/// and `remains` are `Some(...)`, built only from facts already in the database (the close reason,
/// the run's own timestamps, and a literal event count — never a model call, never free prose);
/// `next_session_must_know` is **always `None`** — the one field only the agent can fill, and a
/// synthesized value here would be an invented claim (P2); `decisions`/`acknowledged_decisions`
/// are always empty — a decision the agent did not state is not a decision; `diff_ref` is always
/// `None` (plan 04-07 fills it); `auto_generated` is always `true`.
///
/// Has no dedupe of its own — calling this twice for one run writes two rows. The caller's own
/// presence check (`latest_summary_for_run` returning `None`) is the only guard, matching
/// [`insert_summary_row`]'s "one insert site, no second guard duplicated here" shape.
pub fn synthesize_fallback_summary(
    tx: &Transaction,
    agent_run_id: &str,
    close_reason: &str,
) -> anyhow::Result<String> {
    let now = chrono::Utc::now().to_rfc3339();

    let (actor_id, task_id, started_at, ended_at): (String, String, String, Option<String>) = tx
        .query_row(
            "SELECT actor_id, task_id, started_at, ended_at FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;
    let ended_at = ended_at.unwrap_or_else(|| now.clone());

    let event_count: i64 = tx
        .query_row(
            FALLBACK_EVENT_COUNT_SQL,
            params![agent_run_id, task_id, started_at, ended_at],
            |row| row.get(0),
        )
        .context("failed to count events for the fallback summary")?;

    let changed_prose = Some(format!(
        "This session closed as {close_reason} with no agent summary recorded; {event_count} \
         event{plural} logged for this run between {started_at} and {ended_at}.",
        plural = if event_count == 1 { "" } else { "s" },
    ));
    let remains = Some(
        "The session ended without recording its own summary; the working tree is the authority \
         on what is finished."
            .to_string(),
    );

    let fields = SummaryFields {
        changed_files: Vec::new(),
        changed_prose,
        remains,
        next_session_must_know: None,
        decisions: Vec::new(),
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: true,
    };

    let summary = insert_summary_row(tx, agent_run_id, &fields, &actor_id, &now)?;
    Ok(summary.id)
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
