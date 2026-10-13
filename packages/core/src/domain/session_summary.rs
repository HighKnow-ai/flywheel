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
//! row-write-plus-event shape exactly: resolve `task_id`/`epic_id`/`project_id`/`worktree_id`
//! from the `agent_runs` row INSIDE the transaction (T-04-01 — `create_summary` accepts no
//! caller-supplied `task_id`/`epic_id`/`project_id`, so a caller can never attribute a summary to
//! a run it does not drive), insert the row, update the pointer, append one event, one commit.
//!
//! Plan 05-09 generalises the subject exactly as D-84 already generalised `agent_runs`'s own:
//! `task_id` is nullable and a nullable `epic_id` joins it (migration
//! `0013_authoring_summaries.sql`), with the same never-both CHECK. A summary's subject is a task
//! **or** an epic, never both and — for a run whose subject is not yet real (a fresh-epic
//! authoring session, D-84's `RunSubject::Unbound`) — sometimes neither. Nothing here is
//! repurposed: the six content fields (`changed_files`, `changed_prose`, `remains`,
//! `next_session_must_know`, `decisions`, `diff_ref`) keep their existing meanings for a task run,
//! and for an authoring run the fields that do not apply are simply absent, per this crate's
//! `Option<T>`-for-absent discipline — never a repurposed value.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::{is_ulid, new_id};

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
///
/// Plan 05-09: for an authoring run (a shaping conversation, not a coding session), `changed_files`
/// is empty and `diff_ref` is `None` — a conversation has no diff — and `decisions` carries what
/// the conversation actually settled, which is the field `epic_context_packet.rs`'s
/// `prior_authoring_runs` reads back into a later session.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SummaryFields {
    /// Repo-relative file paths (D-65's machine-checkable half). Always empty for an authoring run
    /// — a conversation changes no file.
    pub changed_files: Vec<String>,
    /// D-65's prose half — what changed, in the agent's own words. For an authoring run, what the
    /// conversation shaped.
    pub changed_prose: Option<String>,
    pub remains: Option<String>,
    pub next_session_must_know: Option<String>,
    /// A discrete-entry list (D-65) — never one prose blob.
    pub decisions: Vec<DecisionEntry>,
    /// D-73's read-back input: the decision ids this session echoed back as acknowledged. `[]`
    /// when none.
    pub acknowledged_decisions: Vec<String>,
    /// The git ref the claims in this summary were made against (D-72's second detector reads
    /// this). Always `None` for an authoring run — there is no diff to reference.
    pub diff_ref: Option<String>,
    /// True only for a row synthesized by the fallback path (plan 04-02) — never presented as
    /// though the agent authored it (P2). This flag travels with the row into every read, DTO
    /// and rendered section.
    pub auto_generated: bool,
}

/// A `session_summaries` row, as read back after [`create_summary`], [`list_summaries_for_task`]
/// or [`latest_summary_for_run`].
///
/// Plan 05-09: `task_id` and `epic_id` are both `Option<String>` — a row's subject is a task, an
/// epic, or (for a run whose subject is not yet real) neither, mirroring
/// `domain::agent_run::AgentRun`'s own generalised shape. The schema's own
/// `CHECK (NOT (task_id IS NOT NULL AND epic_id IS NOT NULL))` makes "both" unrepresentable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SessionSummary {
    pub id: String,
    pub agent_run_id: String,
    pub worktree_id: Option<String>,
    pub task_id: Option<String>,
    pub epic_id: Option<String>,
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
    epic_id, project_id, changed_files, changed_prose, remains, next_session_must_know, \
    decisions, acknowledged_decisions, diff_ref, auto_generated, created_by, created_at \
    FROM session_summaries WHERE task_id = ?1 ORDER BY created_at ASC, id ASC";

const LATEST_SUMMARY_FOR_RUN_SQL: &str = "SELECT id, agent_run_id, worktree_id, task_id, \
    epic_id, project_id, changed_files, changed_prose, remains, next_session_must_know, \
    decisions, acknowledged_decisions, diff_ref, auto_generated, created_by, created_at \
    FROM session_summaries WHERE agent_run_id = ?1 ORDER BY created_at DESC, id DESC LIMIT 1";

fn row_to_summary(row: &Row) -> rusqlite::Result<SessionSummary> {
    let changed_files_json: String = row.get(6)?;
    let decisions_json: String = row.get(10)?;
    let acknowledged_json: String = row.get(11)?;
    let auto_generated_int: i64 = row.get(13)?;

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
        epic_id: row.get(4)?,
        project_id: row.get(5)?,
        changed_files,
        changed_prose: row.get(7)?,
        remains: row.get(8)?,
        next_session_must_know: row.get(9)?,
        decisions,
        acknowledged_decisions,
        diff_ref: row.get(12)?,
        auto_generated: auto_generated_int != 0,
        created_by: row.get(14)?,
        created_at: row.get(15)?,
    })
}

/// Insert one `session_summaries` row inside the CALLER's transaction, point
/// `agent_runs.exit_summary_id` at it, and append one `summary.recorded` event — the SINGLE
/// shared insert site every producer writes through. [`create_summary`] (agent-authored, opens
/// its own transaction) and [`synthesize_fallback_summary`] (the fallback, runs inside the
/// caller's transaction — plan 04-02) both call this and nothing else ever issues `INSERT INTO
/// session_summaries` (a `<verify>` gate greps the whole crate for exactly one occurrence).
///
/// `task_id`/`epic_id` are resolved from the `agent_runs` row (plan 05-09: `RunSubject`'s own two
/// nullable columns, never both) rather than accepted as a parameter — the same T-04-01 discipline
/// this function has always held, now covering a run whose subject is an epic or, for a fresh-epic
/// authoring run, neither.
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

    let (task_id, epic_id, project_id, worktree_id): (
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT task_id, epic_id, project_id, worktree_id FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
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
            id, agent_run_id, worktree_id, task_id, epic_id, project_id, changed_files,
            changed_prose, remains, next_session_must_know, decisions, acknowledged_decisions,
            diff_ref, auto_generated, created_by, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            id,
            agent_run_id,
            worktree_id,
            task_id,
            epic_id,
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
        task_id.as_deref(),
        epic_id.as_deref(),
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
        epic_id,
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

/// The literal `&str` SQL a TASK run's own fallback synthesis reads to derive its `changed_prose`
/// fact — every event whose `stream_id` names this run directly (its own bookkeeping and
/// tool-call-derived rows), plus every event attached to the run's own task whose `occurred_at`
/// falls inside the run's `[started_at, ended_at]` window (a permission request raised during
/// this run, for example, carries the permission request's own `stream_id`, not the run's).
const FALLBACK_EVENT_COUNT_SQL: &str = "SELECT COUNT(*) FROM events \
    WHERE stream_id = ?1 OR (task_id = ?2 AND occurred_at >= ?3 AND occurred_at <= ?4)";

/// Every staged proposal for an authoring run's own fallback, grouped by target type — plan
/// 05-09's own board-derived fact: what the run actually produced, never invented.
const AUTHORING_PROPOSAL_COUNTS_BY_TARGET_TYPE_SQL: &str = "SELECT target_type, COUNT(*) \
    FROM authoring_proposals WHERE agent_run_id = ?1 GROUP BY target_type ORDER BY target_type ASC";

/// How many of THIS run's own staged proposals are no longer `pending` (accepted or rejected) —
/// the fallback's "already decided" fact.
const AUTHORING_PROPOSAL_DECIDED_COUNT_SQL: &str = "SELECT COUNT(*) FROM authoring_proposals \
    WHERE agent_run_id = ?1 AND status != 'pending'";

const EPIC_LABEL_SQL: &str = "SELECT key, title FROM epics WHERE id = ?1";

/// A TASK run's own fallback fields (plan 04-02's original synthesis, unchanged): `changed_prose`
/// and `remains` are `Some(...)`, built only from facts already in the database (the close reason,
/// the run's own timestamps, and a literal event count — never a model call, never free prose);
/// `next_session_must_know` is always `None` — the one field only the agent can fill.
fn synthesize_task_fallback_fields(
    tx: &Transaction,
    agent_run_id: &str,
    task_id: &str,
    started_at: &str,
    ended_at: &str,
    close_reason: &str,
) -> anyhow::Result<SummaryFields> {
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

    Ok(SummaryFields {
        changed_files: Vec::new(),
        changed_prose,
        remains,
        next_session_must_know: None,
        decisions: Vec::new(),
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: true,
    })
}

/// An AUTHORING run's own fallback fields (plan 05-09, D-64 extended to a conversation). An
/// authoring run has no diff, so this is synthesised from what the run actually produced: the
/// stage it reached, how many proposals it staged by target type, how many were already decided,
/// and the epic (or "a new epic") it was shaping — exactly what a developer reopening this epic in
/// three weeks wants to know, and derived from board state, not from prose, so it cannot degrade.
///
/// `changed_files`/`diff_ref` are always empty/`None` — a conversation has no diff, permanently,
/// unlike the task fallback's own "filled in by a later plan" fields. `next_session_must_know`
/// stays `None` for the same reason the task fallback leaves it `None`: only the agent can fill
/// it, and a synthesized value here would be an invented claim (P2).
fn synthesize_authoring_fallback_fields(
    tx: &Transaction,
    agent_run_id: &str,
    epic_id: Option<&str>,
    authoring_stage: Option<&str>,
    close_reason: &str,
) -> anyhow::Result<SummaryFields> {
    let mut counts_stmt = tx.prepare(AUTHORING_PROPOSAL_COUNTS_BY_TARGET_TYPE_SQL)?;
    let counts: Vec<(String, i64)> = counts_stmt
        .query_map(params![agent_run_id], |row| Ok((row.get(0)?, row.get(1)?)))?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to count staged proposals by target type for the fallback summary")?;

    let total: i64 = counts.iter().map(|(_, n)| n).sum();
    let decided: i64 = tx
        .query_row(AUTHORING_PROPOSAL_DECIDED_COUNT_SQL, params![agent_run_id], |row| row.get(0))
        .context("failed to count decided proposals for the fallback summary")?;

    let epic_label = match epic_id {
        Some(epic_id) => {
            let (key, title): (String, String) = tx
                .query_row(EPIC_LABEL_SQL, params![epic_id], |row| {
                    Ok((row.get(0)?, row.get(1)?))
                })
                .with_context(|| format!("epic {epic_id:?} not found"))?;
            format!("epic {key} ({title})")
        }
        None => "a new epic".to_string(),
    };

    let stage_label = authoring_stage.unwrap_or("an unrecorded stage");

    let breakdown = if counts.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> =
            counts.iter().map(|(target_type, n)| format!("{n} {target_type}")).collect();
        format!(" ({})", parts.join(", "))
    };

    let changed_prose = Some(format!(
        "This session closed as {close_reason} with no agent summary recorded. It reached the \
         {stage_label} stage while shaping {epic_label}. It staged {total} proposal{plural}{breakdown}, \
         of which {decided} {decided_plural} already decided.",
        plural = if total == 1 { "" } else { "s" },
        decided_plural = if decided == 1 { "was" } else { "were" },
    ));
    let remains = Some(
        "The session ended without recording its own closing summary; the staged proposals on \
         the board are the authority on what this session actually produced."
            .to_string(),
    );

    Ok(SummaryFields {
        changed_files: Vec::new(),
        changed_prose,
        remains,
        next_session_must_know: None,
        decisions: Vec::new(),
        acknowledged_decisions: Vec::new(),
        diff_ref: None,
        auto_generated: true,
    })
}

/// Write a best-effort summary for a run that reached a terminal state with no summary of its own
/// (D-64, plan 04-02) — called by `domain::agent_run::apply_session_closed`,
/// `commands::agent_run::stop_agent_run_in_tx` and `domain::agent_run::mark_abandoned` INSIDE the
/// same transaction that writes the run's terminal status, never in a transaction it opens itself.
/// That is what makes "a run can never be terminal while its fallback summary is missing" a
/// property of the database rather than of call ordering, for every terminal path — natural
/// close, Stop/Discard, and (plan 05-09) an abandoned reconciliation, alike.
///
/// Resolves `actor_id` from the `agent_runs` row itself — the row is attributed to the run's own
/// agent actor, never the local human actor, so DATA-03's actor model stays honest even though the
/// core, not the agent, is the one writing this row.
///
/// Plan 05-09: dispatches on the run's own subject, read fresh from `agent_runs` inside this same
/// transaction — a task run's fallback is [`synthesize_task_fallback_fields`] (plan 04-02's
/// original event-derived synthesis, unchanged), an authoring run's (task-less) fallback is
/// [`synthesize_authoring_fallback_fields`] (board-derived: stage reached and staged-proposal
/// counts). Both dispatch to the SAME [`insert_summary_row`] — there is still exactly one insert
/// site in this module regardless of which branch ran.
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

    let (actor_id, task_id, epic_id, authoring_stage, started_at, ended_at): (
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
    ) = tx
        .query_row(
            "SELECT actor_id, task_id, epic_id, authoring_stage, started_at, ended_at \
             FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;
    let ended_at = ended_at.unwrap_or_else(|| now.clone());

    let fields = match task_id {
        Some(task_id) => synthesize_task_fallback_fields(
            tx,
            agent_run_id,
            &task_id,
            &started_at,
            &ended_at,
            close_reason,
        )?,
        None => synthesize_authoring_fallback_fields(
            tx,
            agent_run_id,
            epic_id.as_deref(),
            authoring_stage.as_deref(),
            close_reason,
        )?,
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
/// synthesizer's presence check (plan 04-02): "did this run already produce one before I
/// synthesize one."
pub fn latest_summary_for_run(
    conn: &Connection,
    agent_run_id: &str,
) -> anyhow::Result<Option<SessionSummary>> {
    conn.query_row(LATEST_SUMMARY_FOR_RUN_SQL, params![agent_run_id], row_to_summary)
        .optional()
        .context("failed to look up the latest summary for this run")
}

/// What [`apply_summary_reported`] did with one inbound `summary_reported` event (plan 04-06).
/// The `String` carried by `Recorded` is the new summary's id.
#[derive(Debug, Clone, PartialEq)]
pub enum SummaryReportOutcome {
    /// The event's `type` was not `summary_reported`, or it carried no `runId`, or the `runId`
    /// was not a well-formed ULID. Nothing was read from or written to the database.
    Ignored,
    /// The `runId` was a well-formed ULID, but it names no `agent_runs` row.
    UnknownRun,
    /// One row was written, attributed to the run's own task/project/actor.
    Recorded(String),
}

/// Apply one inbound `summary_reported` event (D-64/D-65, plan 04-03's wire shape) — the
/// database-only half of the sidecar's `report_summary` write surface, testable without a
/// spawned sidecar. Copies [`crate::domain::agent_run::apply_session_closed`]'s own guard
/// sequence, in the same order and for the same stated reasons: wrong event type is ignored,
/// a missing `runId` is ignored, and a non-ULID `runId` is rejected with [`SummaryReportOutcome::Ignored`]
/// BEFORE any database statement is issued — a run id read off a sidecar stdout line is exactly
/// as trusted as any other value crossing that process boundary, never more (T-04-01).
///
/// `taskId`, `projectId` and `worktreeId` — if present on the event at all — are never read.
/// Identity comes ONLY from the `agent_runs` row the (already-validated) `runId` resolves to,
/// exactly like [`insert_summary_row`]'s own resolution (plan 05-09: that resolution now also
/// covers `epicId`). This is what makes the spoofing property checkable by grep, not only by
/// test: this function's body contains no lookup of those keys.
///
/// Deserialises the six wire content fields from their camelCase names (`changedFiles`,
/// `changedProse`, `remains`, `nextSessionMustKnow`, `decisions`, `acknowledgedDecisions`).
/// Absent optional strings become `None`; absent arrays become empty vectors — never an error,
/// never a fabricated value (plan 05-09 widened the sidecar's own tool schema so `changedFiles` is
/// no longer required, precisely so an authoring run's closing call can omit it). A `decisions`
/// element that is not an object carrying string `id` and `statement` fields is dropped; its
/// well-formed siblings are kept, so one malformed entry never fails the whole write.
///
/// `auto_generated` is always `false` and `diff_ref` is always `None` — the agent-authored path
/// never claims the fallback flag, and the diff reference is filled at packet-assembly time by a
/// later plan, not here. The actor is resolved from the run's own `agent_runs.actor_id`, and the
/// write is delegated to [`create_summary`] so there is still exactly one insert site in this
/// module.
pub fn apply_summary_reported(
    conn: &mut Connection,
    event: &serde_json::Value,
) -> anyhow::Result<SummaryReportOutcome> {
    if event.get("type").and_then(|v| v.as_str()) != Some("summary_reported") {
        return Ok(SummaryReportOutcome::Ignored);
    }

    let Some(run_id) = event.get("runId").and_then(|v| v.as_str()) else {
        return Ok(SummaryReportOutcome::Ignored);
    };

    if !is_ulid(run_id) {
        return Ok(SummaryReportOutcome::Ignored);
    }

    let actor_id: Option<String> = conn
        .query_row(
            "SELECT actor_id FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read agent_runs row before applying summary_reported")?;

    let Some(actor_id) = actor_id else {
        return Ok(SummaryReportOutcome::UnknownRun);
    };

    let changed_files: Vec<String> = event
        .get("changedFiles")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let changed_prose =
        event.get("changedProse").and_then(|v| v.as_str()).map(str::to_string);
    let remains = event.get("remains").and_then(|v| v.as_str()).map(str::to_string);
    let next_session_must_know =
        event.get("nextSessionMustKnow").and_then(|v| v.as_str()).map(str::to_string);

    let decisions: Vec<DecisionEntry> = event
        .get("decisions")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|entry| {
                    let obj = entry.as_object()?;
                    let id = obj.get("id")?.as_str()?.to_string();
                    let statement = obj.get("statement")?.as_str()?.to_string();
                    Some(DecisionEntry { id, statement })
                })
                .collect()
        })
        .unwrap_or_default();

    let acknowledged_decisions: Vec<String> = event
        .get("acknowledgedDecisions")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default();

    let fields = SummaryFields {
        changed_files,
        changed_prose,
        remains,
        next_session_must_know,
        decisions,
        acknowledged_decisions,
        diff_ref: None,
        auto_generated: false,
    };

    let summary = create_summary(conn, run_id, fields, &actor_id)?;

    Ok(SummaryReportOutcome::Recorded(summary.id))
}
