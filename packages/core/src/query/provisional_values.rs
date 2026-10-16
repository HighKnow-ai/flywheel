//! An item's provisional values: what an agent has suggested for its title, body and priority that
//! no human has decided yet (phase 15, D-02, DRFT-03).
//!
//! Derive-on-read over `authoring_proposals`, joined to the canonical row for comparison. Nothing is
//! stored and no column exists: the staging table already says "proposed by an agent, not yet
//! accepted" (`status = 'pending'`), which is exactly what a provisional value is. The read
//! performs no write and mints no canonical row; the human's Start Work confirms through the
//! canonical writers (`authoring_proposal::confirm_provisional_values_for_task`).
//!
//! Only the provisional tier appears here (`acceptance_tier`). A pending criterion draft is the
//! explicit tier and is decided by name, so it is never ghosted (D-05, D-07).
use anyhow::Context;
use rusqlite::{params, Connection};
use serde::Serialize;

use crate::domain::authoring_proposal::{
    acceptance_tier, AcceptanceTier, ProposalPayload, ProposalTargetType,
};

/// The ceiling on how many pending amendments one item's read returns, declared once. An item
/// carrying more than this has an agent that will not stop amending it; the surplus stays pending
/// in the tray rather than flooding the form.
pub const PROVISIONAL_VALUES_LIMIT: usize = 50;

/// One suggested value for one field of one item. A single proposal can carry several (a title and
/// a priority), each reported under its own `field`; they share `proposal_id`, because the unit the
/// staging table decides is the proposal.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionalValue {
    pub proposal_id: String,
    /// `title`, `description` or `priority`.
    pub field: String,
    /// The proposed value as text; a priority is its integer rendered as text.
    pub proposed: String,
    /// The canonical value today, for comparison. `None` when the field is empty.
    pub current: Option<String>,
    pub run_id: String,
    pub actor_name: String,
}

/// One pending provisional-tier amendment, before it is split into per-field values. Shared with
/// Start Work's confirm so the two can never disagree about which proposals are pending.
pub(crate) struct PendingAmendment {
    pub proposal_id: String,
    pub run_id: String,
    pub actor_name: String,
    pub payload: ProposalPayload,
}

const TASK_AMENDMENTS_SQL: &str = "SELECT p.id, p.agent_run_id, p.payload, COALESCE(a.display_name, p.created_by)
     FROM authoring_proposals p LEFT JOIN actors a ON a.id = p.created_by
     WHERE p.project_id = (SELECT project_id FROM tasks WHERE id = ?1)
       AND p.status = 'pending' AND p.verb = 'amend' AND p.target_type = 'task' AND p.target_id = ?1
     ORDER BY p.position, p.created_at, p.id LIMIT ?2";

const EPIC_AMENDMENTS_SQL: &str = "SELECT p.id, p.agent_run_id, p.payload, COALESCE(a.display_name, p.created_by)
     FROM authoring_proposals p LEFT JOIN actors a ON a.id = p.created_by
     WHERE p.project_id = (SELECT project_id FROM epics WHERE id = ?1)
       AND p.status = 'pending' AND p.verb = 'amend' AND p.target_type = 'epic' AND p.target_id = ?1
     ORDER BY p.position, p.created_at, p.id LIMIT ?2";

/// The item's pending provisional-tier `amend` proposals in staging `position` order, bounded by
/// [`PROVISIONAL_VALUES_LIMIT`]. An unknown or explicit-tier `parent_type` yields nothing.
pub(crate) fn pending_provisional_amendments(
    conn: &Connection,
    parent_type: &str,
    parent_id: &str,
) -> anyhow::Result<Vec<PendingAmendment>> {
    let Ok(target) = ProposalTargetType::from_db_str(parent_type) else { return Ok(Vec::new()) };
    if acceptance_tier(target) != AcceptanceTier::Provisional {
        return Ok(Vec::new());
    }
    let sql = match target {
        ProposalTargetType::Task => TASK_AMENDMENTS_SQL,
        ProposalTargetType::Epic => EPIC_AMENDMENTS_SQL,
        // Assumptions and issues are provisional-tier but have no amend path to a canonical row.
        ProposalTargetType::Assumption | ProposalTargetType::Issue | ProposalTargetType::Criterion => {
            return Ok(Vec::new())
        }
    };
    let mut stmt = conn.prepare(sql).context("failed to prepare the provisional amendments read")?;
    let rows = stmt
        .query_map(params![parent_id, PROVISIONAL_VALUES_LIMIT as i64], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .context("failed to read the item's pending amendments")?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the item's pending amendments")?;
    rows.into_iter()
        .map(|(proposal_id, run_id, payload, actor_name)| {
            let payload: ProposalPayload = serde_json::from_str(&payload)
                .with_context(|| format!("proposal {proposal_id:?} carries an unreadable payload"))?;
            Ok(PendingAmendment { proposal_id, run_id, actor_name, payload })
        })
        .collect()
}

/// The suggestions an agent has pending for `parent_type` (`task` or `epic`) `parent_id`, one entry
/// per field that differs from the canonical value, in staging `position` order so two amendments
/// to one field read in the order they were proposed (the later one is what Start Work will leave).
pub fn provisional_values_for(
    conn: &Connection,
    parent_type: &str,
    parent_id: &str,
) -> anyhow::Result<Vec<ProvisionalValue>> {
    let amendments = pending_provisional_amendments(conn, parent_type, parent_id)?;
    if amendments.is_empty() {
        return Ok(Vec::new());
    }
    let current_sql = match parent_type {
        "task" => "SELECT title, description, priority FROM tasks WHERE id = ?1",
        _ => "SELECT title, description, priority FROM epics WHERE id = ?1",
    };
    let (title, description, priority): (String, Option<String>, i64) = conn
        .query_row(current_sql, params![parent_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .with_context(|| format!("{parent_type} {parent_id:?} not found"))?;

    // Confirmation applies the amendments in this order, each over the last, so the ghost follows
    // the same walk: `effective_*` is what the field will hold once every earlier amendment is
    // applied, and a value is a suggestion only if it moves that. The ghost therefore always
    // matches what Start Work will leave. An amend payload always restates a title, and a later
    // proposal restating a stale one reverts an earlier suggestion; that shows here as its own
    // ghost rather than happening silently at confirm time.
    let (mut effective_title, mut effective_description, mut effective_priority) =
        (title.clone(), description.clone(), priority);
    let mut values = Vec::new();
    for a in amendments {
        let (p_title, p_description, p_priority) = match &a.payload {
            ProposalPayload::Task { title, description, priority }
            | ProposalPayload::Epic { title, description, priority } => (title, description, priority),
            _ => continue,
        };
        let mut push = |field: &str, proposed: String, current: Option<String>| {
            values.push(ProvisionalValue {
                proposal_id: a.proposal_id.clone(),
                field: field.to_string(),
                proposed,
                current,
                run_id: a.run_id.clone(),
                actor_name: a.actor_name.clone(),
            });
        };
        if *p_title != effective_title {
            push("title", p_title.clone(), Some(title.clone()));
            effective_title = p_title.clone();
        }
        if let Some(d) = p_description {
            if effective_description.as_deref() != Some(d.as_str()) {
                push("description", d.clone(), description.clone());
                effective_description = Some(d.clone());
            }
        }
        if let Some(p) = p_priority {
            if *p != effective_priority {
                push("priority", p.to_string(), Some(priority.to_string()));
                effective_priority = *p;
            }
        }
    }
    values.truncate(PROVISIONAL_VALUES_LIMIT);
    Ok(values)
}
