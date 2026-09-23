//! `create_proposal` / `apply_proposal_created` / `accept_proposal` / `pending_proposals_for_run`
//! (D-80/D-81/D-83/D-92/D-96, plan 05-02): the staging write path. Follows
//! `domain::session_summary::create_summary`'s discipline to the letter — every SQL statement here
//! is a compile-time literal `&str` bound through `params![]`/`named_params!`, and every identity
//! field (`project_id`, `epic_id`, the acting actor) is resolved from the `agent_runs` row INSIDE
//! the write transaction, never accepted as a caller argument (T-05-02-01): a caller cannot
//! attribute a proposal to a run it does not drive.
//!
//! This module never issues `INSERT INTO tasks`/`epics`/`acceptance_criteria` — [`accept_proposal`]
//! materialises exclusively through the canonical writers those tables already have
//! (`domain::task::create_task` for this plan's one supported path), matching T-05-02-03's own
//! mitigation.

use anyhow::Context;
use rusqlite::{named_params, params, Connection, OptionalExtension, Row, Transaction};
use serde::{Deserialize, Serialize};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::rank_after;

/// D-81: the one verb vocabulary every proposal carries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalVerb {
    Create,
    Amend,
    Delete,
}

impl ProposalVerb {
    pub fn as_str(self) -> &'static str {
        match self {
            ProposalVerb::Create => "create",
            ProposalVerb::Amend => "amend",
            ProposalVerb::Delete => "delete",
        }
    }

    pub fn from_db_str(value: &str) -> anyhow::Result<Self> {
        match value {
            "create" => Ok(ProposalVerb::Create),
            "amend" => Ok(ProposalVerb::Amend),
            "delete" => Ok(ProposalVerb::Delete),
            other => Err(anyhow::anyhow!("unknown proposal verb {other:?}")),
        }
    }
}

/// The staging table's `target_type` vocabulary — matches the schema's own CHECK constraint in
/// migration `0011_authoring_staging.sql` exactly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalTargetType {
    Epic,
    Task,
    Criterion,
    Assumption,
}

impl ProposalTargetType {
    pub fn as_str(self) -> &'static str {
        match self {
            ProposalTargetType::Epic => "epic",
            ProposalTargetType::Task => "task",
            ProposalTargetType::Criterion => "criterion",
            ProposalTargetType::Assumption => "assumption",
        }
    }

    pub fn from_db_str(value: &str) -> anyhow::Result<Self> {
        match value {
            "epic" => Ok(ProposalTargetType::Epic),
            "task" => Ok(ProposalTargetType::Task),
            "criterion" => Ok(ProposalTargetType::Criterion),
            "assumption" => Ok(ProposalTargetType::Assumption),
            other => Err(anyhow::anyhow!("unknown proposal target_type {other:?}")),
        }
    }
}

/// One proposal's content, serialised into `authoring_proposals.payload` as JSON with a `kind`
/// discriminant. Every variant carries DISCRETE NAMED fields — never one prose blob folding a
/// drafted criterion or assumption into another row's field, the structural form of this phase's
/// own prohibition against that.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProposalPayload {
    Epic { title: String, description: Option<String> },
    Task { title: String, description: Option<String> },
    Criterion { statement: String, verification_hint: Option<String> },
    Assumption { assumption: String, answer: String },
}

impl ProposalPayload {
    pub fn target_type(&self) -> ProposalTargetType {
        match self {
            ProposalPayload::Epic { .. } => ProposalTargetType::Epic,
            ProposalPayload::Task { .. } => ProposalTargetType::Task,
            ProposalPayload::Criterion { .. } => ProposalTargetType::Criterion,
            ProposalPayload::Assumption { .. } => ProposalTargetType::Assumption,
        }
    }
}

/// One `authoring_proposals` row, as read back after [`create_proposal`]/[`accept_proposal`]/
/// [`pending_proposals_for_run`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Proposal {
    pub id: String,
    pub agent_run_id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub verb: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub parent_proposal_id: Option<String>,
    pub position: String,
    pub payload: ProposalPayload,
    pub status: String,
    pub rejection_reason: Option<String>,
    pub materialised_id: Option<String>,
    pub created_by: String,
    pub created_at: String,
    pub decided_by: Option<String>,
    pub decided_at: Option<String>,
}

const PROPOSAL_COLUMNS: &str = "id, agent_run_id, project_id, epic_id, verb, target_type, \
    target_id, parent_proposal_id, position, payload, status, rejection_reason, materialised_id, \
    created_by, created_at, decided_by, decided_at";

fn row_to_proposal(row: &Row) -> rusqlite::Result<Proposal> {
    let payload_json: String = row.get(9)?;
    let payload: ProposalPayload = serde_json::from_str(&payload_json).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(e))
    })?;

    Ok(Proposal {
        id: row.get(0)?,
        agent_run_id: row.get(1)?,
        project_id: row.get(2)?,
        epic_id: row.get(3)?,
        verb: row.get(4)?,
        target_type: row.get(5)?,
        target_id: row.get(6)?,
        parent_proposal_id: row.get(7)?,
        position: row.get(8)?,
        payload,
        status: row.get(10)?,
        rejection_reason: row.get(11)?,
        materialised_id: row.get(12)?,
        created_by: row.get(13)?,
        created_at: row.get(14)?,
        decided_by: row.get(15)?,
        decided_at: row.get(16)?,
    })
}

/// Stage one proposal for `agent_run_id` (D-80/D-81/D-92). **`project_id`, `epic_id` and the
/// acting actor are resolved from the `agent_runs` row INSIDE this transaction** — this function's
/// own signature carries no `project_id`/`epic_id` parameter, so a caller cannot attribute a
/// proposal to a run it does not drive (T-05-02-01).
///
/// `position` is allocated with [`rank_after`] against the tail sibling sharing the same
/// `parent_proposal_id` (D-92's per-row granularity). Inserts the row with `status = 'pending'`,
/// appends one `proposal.created` event with a human-renderable payload (D-19), commits once.
pub fn create_proposal(
    conn: &mut Connection,
    agent_run_id: &str,
    verb: ProposalVerb,
    payload: ProposalPayload,
    target_id: Option<&str>,
    parent_proposal_id: Option<&str>,
) -> anyhow::Result<Proposal> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let proposal = create_proposal_in_tx(
        &tx,
        agent_run_id,
        verb,
        payload,
        target_id,
        parent_proposal_id,
        &now,
    )?;
    tx.commit().context("failed to commit create_proposal transaction")?;
    Ok(proposal)
}

fn create_proposal_in_tx(
    tx: &Transaction,
    agent_run_id: &str,
    verb: ProposalVerb,
    payload: ProposalPayload,
    target_id: Option<&str>,
    parent_proposal_id: Option<&str>,
    now: &str,
) -> anyhow::Result<Proposal> {
    let (project_id, epic_id, actor_id): (String, Option<String>, String) = tx
        .query_row(
            "SELECT project_id, epic_id, actor_id FROM agent_runs WHERE id = ?1",
            params![agent_run_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("agent_run {agent_run_id:?} not found"))?;

    let tail_position: Option<String> = tx
        .query_row(
            "SELECT position FROM authoring_proposals \
             WHERE agent_run_id = ?1 AND parent_proposal_id IS ?2 \
             ORDER BY position DESC LIMIT 1",
            params![agent_run_id, parent_proposal_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the tail sibling's position")?;
    let position = rank_after(tail_position.as_deref())?;

    let id = new_id();
    let target_type = payload.target_type();
    let payload_json = serde_json::to_string(&payload).context("failed to serialise proposal payload")?;

    tx.execute(
        "INSERT INTO authoring_proposals (
            id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
            parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
            created_by, created_at, decided_by, decided_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'pending', NULL, NULL, ?11, ?12, NULL, NULL)",
        params![
            id,
            agent_run_id,
            project_id,
            epic_id,
            verb.as_str(),
            target_type.as_str(),
            target_id,
            parent_proposal_id,
            position,
            payload_json,
            actor_id,
            now,
        ],
    )
    .context("failed to insert authoring_proposals row")?;

    let sequence = next_sequence(tx, &project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "authoring_proposal",
        "before": null,
        "after": id,
        "verb": verb.as_str(),
        "targetType": target_type.as_str(),
        "label": format!("Proposed a new {}", target_type.as_str()),
    });
    append_event(
        tx,
        &project_id,
        "local",
        sequence,
        "authoring_proposal",
        &id,
        None,
        epic_id.as_deref(),
        &actor_id,
        "proposal.created",
        &event_payload,
        now,
    )?;

    Ok(Proposal {
        id,
        agent_run_id: agent_run_id.to_string(),
        project_id,
        epic_id,
        verb: verb.as_str().to_string(),
        target_type: target_type.as_str().to_string(),
        target_id: target_id.map(str::to_string),
        parent_proposal_id: parent_proposal_id.map(str::to_string),
        position,
        payload,
        status: "pending".to_string(),
        rejection_reason: None,
        materialised_id: None,
        created_by: actor_id,
        created_at: now.to_string(),
        decided_by: None,
        decided_at: None,
    })
}

/// What [`apply_proposal_created`] did with one inbound `proposal_created` event.
#[derive(Debug, Clone, PartialEq)]
pub enum ProposalOutcome {
    /// The event's `type` was not `proposal_created`, or it carried no `runId`, or the `runId` was
    /// not a well-formed ULID, or its content could not be parsed into a [`ProposalPayload`].
    /// Nothing was read from or written to the database.
    Ignored,
    /// The `runId` was a well-formed ULID, but it names no `agent_runs` row.
    UnknownRun,
    /// The run named by `runId` has already reached a terminal status.
    TerminalRun,
    /// One row was staged, attributed to the run's own project/epic/actor.
    Created(Proposal),
}

/// Apply one inbound `proposal_created` event (the sidecar's own wire shape, mirroring
/// `domain::session_summary::apply_summary_reported`'s guard sequence exactly): wrong event type
/// is ignored, a missing `runId` is ignored, and a non-ULID `runId` is rejected with
/// [`ProposalOutcome::Ignored`] BEFORE any database statement is issued — a run id read off a
/// sidecar stdout line is exactly as trusted as any other value crossing that process boundary,
/// never more. `verb`/`targetType`/`payload` are read from the event; identity (`project_id`,
/// `epic_id`, the acting actor) is resolved ONLY from the `agent_runs` row the run id names,
/// exactly like [`create_proposal_in_tx`].
pub fn apply_proposal_created(
    conn: &mut Connection,
    event: &serde_json::Value,
) -> anyhow::Result<ProposalOutcome> {
    if event.get("type").and_then(|v| v.as_str()) != Some("proposal_created") {
        return Ok(ProposalOutcome::Ignored);
    }

    let Some(run_id) = event.get("runId").and_then(|v| v.as_str()) else {
        return Ok(ProposalOutcome::Ignored);
    };
    if !crate::ids::is_ulid(run_id) {
        return Ok(ProposalOutcome::Ignored);
    }

    let Some(verb_str) = event.get("verb").and_then(|v| v.as_str()) else {
        return Ok(ProposalOutcome::Ignored);
    };
    let Ok(verb) = ProposalVerb::from_db_str(verb_str) else {
        return Ok(ProposalOutcome::Ignored);
    };

    let Some(payload_value) = event.get("payload") else {
        return Ok(ProposalOutcome::Ignored);
    };
    let Ok(payload) = serde_json::from_value::<ProposalPayload>(payload_value.clone()) else {
        return Ok(ProposalOutcome::Ignored);
    };

    let target_id = event.get("targetId").and_then(|v| v.as_str());
    let parent_proposal_id = event.get("parentProposalId").and_then(|v| v.as_str());

    let status: Option<String> = conn
        .query_row(
            "SELECT status FROM agent_runs WHERE id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read agent_runs row before applying proposal_created")?;

    let Some(status) = status else {
        return Ok(ProposalOutcome::UnknownRun);
    };

    if matches!(status.as_str(), "completed" | "failed" | "interrupted" | "abandoned") {
        return Ok(ProposalOutcome::TerminalRun);
    }

    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;
    let proposal =
        create_proposal_in_tx(&tx, run_id, verb, payload, target_id, parent_proposal_id, &now)?;
    tx.commit()
        .context("failed to commit apply_proposal_created transaction")?;

    Ok(ProposalOutcome::Created(proposal))
}

/// What [`accept_proposal`] did.
#[derive(Debug, Clone, PartialEq)]
pub struct AcceptOutcome {
    pub proposal: Proposal,
    pub materialised_id: String,
}

/// Accept a pending proposal (D-92, D-96) — for this plan, the `create`/`task` path only. In ONE
/// transaction: reads the pending row, materialises it through the canonical
/// `domain::task::create_task` writer (never a statement of its own — T-05-02-03's mitigation, and
/// the reason `domain::task::create_task`, not a duplicate `INSERT INTO tasks`, is the single
/// place a task's key and rank are allocated: D-96's key-allocation-in-acceptance-order fact falls
/// out of this by construction), sets `status = 'accepted'`, `materialised_id`, `decided_by` and
/// `decided_at`, and appends one `proposal.accepted` event. The row is never deleted (D-83). The
/// **human** actor supplied here is recorded as `decided_by`; `created_by` stays the proposing
/// agent actor untouched — the audit trail's whole point.
///
/// Any other verb/target_type combination returns a typed "not yet implemented in this plan"
/// error — plan 05-05 replaces it — never a silent no-op.
pub fn accept_proposal(
    conn: &mut Connection,
    proposal_id: &str,
    human_actor_id: &str,
) -> anyhow::Result<AcceptOutcome> {
    let now = chrono::Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let proposal: Proposal = tx
        .query_row(
            &format!("SELECT {PROPOSAL_COLUMNS} FROM authoring_proposals WHERE id = ?1"),
            params![proposal_id],
            row_to_proposal,
        )
        .with_context(|| format!("authoring_proposal {proposal_id:?} not found"))?;

    anyhow::ensure!(
        proposal.status == "pending",
        "authoring_proposal {proposal_id:?} is not pending (status = {:?})",
        proposal.status
    );

    let materialised_id = match (proposal.verb.as_str(), &proposal.payload) {
        ("create", ProposalPayload::Task { title, .. }) => {
            let epic_id = proposal.epic_id.as_deref();
            let task = crate::domain::task::create_task_in_tx(
                &tx,
                &proposal.project_id,
                &proposal.created_by,
                title,
                epic_id,
                &now,
            )?;
            task.id
        }
        (verb, payload) => anyhow::bail!(
            "accepting a {verb:?} proposal for {:?} is not yet implemented in this plan",
            payload.target_type().as_str()
        ),
    };

    tx.execute(
        "UPDATE authoring_proposals SET status = 'accepted', materialised_id = ?1, \
         decided_by = ?2, decided_at = ?3 WHERE id = ?4",
        params![materialised_id, human_actor_id, now, proposal_id],
    )
    .context("failed to mark authoring_proposal accepted")?;

    let sequence = next_sequence(&tx, &proposal.project_id, "local")?;
    let event_payload = serde_json::json!({
        "field": "authoring_proposal",
        "before": "pending",
        "after": "accepted",
        "materialisedId": materialised_id,
        "label": "Accepted a proposal",
    });
    append_event(
        &tx,
        &proposal.project_id,
        "local",
        sequence,
        "authoring_proposal",
        proposal_id,
        None,
        proposal.epic_id.as_deref(),
        human_actor_id,
        "proposal.accepted",
        &event_payload,
        &now,
    )?;

    tx.commit().context("failed to commit accept_proposal transaction")?;

    let mut accepted_proposal = proposal;
    accepted_proposal.status = "accepted".to_string();
    accepted_proposal.materialised_id = Some(materialised_id.clone());
    accepted_proposal.decided_by = Some(human_actor_id.to_string());
    accepted_proposal.decided_at = Some(now);

    Ok(AcceptOutcome { proposal: accepted_proposal, materialised_id })
}

/// The default and maximum row counts [`pending_proposals_for_run`] will ever return — the
/// `DEFAULT_LIMIT`/`MAX_LIMIT`/clamp idiom `commands/board.rs` establishes, applied here at the
/// domain layer from the first line rather than retrofitted (T-05-02-04).
const DEFAULT_LIMIT: i64 = 200;
const MAX_LIMIT: i64 = 500;

/// Every pending proposal staged for `agent_run_id`, newest first — bounded per
/// `DEFAULT_LIMIT`/`MAX_LIMIT` regardless of what the caller requests: a `limit` of `0` or less
/// falls back to [`DEFAULT_LIMIT`], and any value is clamped to [`MAX_LIMIT`] before the query
/// runs (a caller-supplied 10,000,000 clamps to `MAX_LIMIT`, never reaches the database as-is).
pub fn pending_proposals_for_run(
    conn: &Connection,
    agent_run_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<Proposal>> {
    let resolved_limit = if limit <= 0 { DEFAULT_LIMIT } else { limit }.min(MAX_LIMIT);

    let sql = format!(
        "SELECT {PROPOSAL_COLUMNS} FROM authoring_proposals \
         WHERE agent_run_id = :run_id AND status = 'pending' \
         ORDER BY created_at DESC, id DESC LIMIT :limit"
    );
    let mut stmt = conn.prepare(&sql)?;
    let proposals = stmt
        .query_map(
            named_params! { ":run_id": agent_run_id, ":limit": resolved_limit },
            row_to_proposal,
        )?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read pending proposals for run")?;
    Ok(proposals)
}
