//! Proposals (docs/mvp-spec.md §2, §5): the only way an agent writes to the board. A Proposal
//! suggests creating, amending, reordering or retiring a board record, an ADR or a glossary term,
//! and has no effect until the developer accepts it.
//!
//! Filing is open to an agent ([`file_proposal`]); deciding is the developer's alone
//! ([`accept_proposal`], [`reject_proposal`] read the actor's type inside their own transaction and
//! refuse anything but a human). A rejection keeps its reason, which the Epic's packet carries.
//! What each accepted kind does to the board is applied by the surface that triages it; this
//! module records the decision.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// The soft cap: open Proposals one Story session may hold at once. The board tool refuses the
/// next one and tells the agent to merge or withdraw one.
pub const OPEN_PROPOSALS_PER_SESSION: i64 = 3;

/// What a Proposal does to its target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalVerb {
    Create,
    Amend,
    Reorder,
    Retire,
}

impl ProposalVerb {
    pub fn as_str(self) -> &'static str {
        match self {
            ProposalVerb::Create => "create",
            ProposalVerb::Amend => "amend",
            ProposalVerb::Reorder => "reorder",
            ProposalVerb::Retire => "retire",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "create" => ProposalVerb::Create,
            "amend" => ProposalVerb::Amend,
            "reorder" => ProposalVerb::Reorder,
            "retire" => ProposalVerb::Retire,
            other => anyhow::bail!("{other:?} is not a Proposal verb"),
        })
    }
}

/// What kind of record a Proposal lands on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalTarget {
    Milestone,
    Epic,
    Story,
    Criterion,
    Adr,
    GlossaryTerm,
}

impl ProposalTarget {
    pub fn as_str(self) -> &'static str {
        match self {
            ProposalTarget::Milestone => "milestone",
            ProposalTarget::Epic => "epic",
            ProposalTarget::Story => "story",
            ProposalTarget::Criterion => "criterion",
            ProposalTarget::Adr => "adr",
            ProposalTarget::GlossaryTerm => "glossary_term",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "milestone" => ProposalTarget::Milestone,
            "epic" => ProposalTarget::Epic,
            "story" => ProposalTarget::Story,
            "criterion" => ProposalTarget::Criterion,
            "adr" => ProposalTarget::Adr,
            "glossary_term" => ProposalTarget::GlossaryTerm,
            other => anyhow::bail!("{other:?} is not a Proposal target"),
        })
    }
}

/// A `proposals` row.
#[derive(Debug, Clone, PartialEq)]
pub struct Proposal {
    pub id: String,
    pub project_id: String,
    pub session_id: Option<String>,
    pub epic_id: Option<String>,
    pub verb: String,
    pub target_type: String,
    pub target_id: Option<String>,
    pub payload: serde_json::Value,
    pub rationale: Option<String>,
    pub state: String,
    pub rejection_reason: Option<String>,
    pub decided_by: Option<String>,
    pub created_at: String,
}

fn row_to_proposal(row: &Row) -> rusqlite::Result<Proposal> {
    let payload: String = row.get(7)?;
    Ok(Proposal {
        id: row.get(0)?,
        project_id: row.get(1)?,
        session_id: row.get(2)?,
        epic_id: row.get(3)?,
        verb: row.get(4)?,
        target_type: row.get(5)?,
        target_id: row.get(6)?,
        payload: serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null),
        rationale: row.get(8)?,
        state: row.get(9)?,
        rejection_reason: row.get(10)?,
        decided_by: row.get(11)?,
        created_at: row.get(12)?,
    })
}

/// `SELECT <every column> FROM proposals <tail>`, as one compile-time literal.
macro_rules! select_proposals {
    ($tail:literal) => {
        concat!(
            "SELECT id, project_id, session_id, epic_id, verb, target_type, target_id, payload, rationale, state, \
             rejection_reason, decided_by, created_at FROM proposals ",
            $tail
        )
    };
}

/// A Proposal as an agent (or the developer) files it.
#[derive(Debug, Clone, PartialEq)]
pub struct NewProposal<'a> {
    pub project_id: &'a str,
    pub session_id: Option<&'a str>,
    pub epic_id: Option<&'a str>,
    pub verb: ProposalVerb,
    pub target: ProposalTarget,
    pub target_id: Option<&'a str>,
    pub payload: serde_json::Value,
    pub rationale: Option<&'a str>,
}

/// File a Proposal, pending. A session already holding [`OPEN_PROPOSALS_PER_SESSION`] pending
/// Proposals is refused.
pub fn file_proposal(conn: &mut Connection, actor_id: &str, new: &NewProposal) -> anyhow::Result<Proposal> {
    let now = now();
    let id = new_id();
    let tx = conn.transaction()?;
    if let Some(session_id) = new.session_id {
        let open: i64 = tx.query_row(
            "SELECT COUNT(*) FROM proposals WHERE session_id = ?1 AND state = 'pending'",
            params![session_id],
            |r| r.get(0),
        )?;
        anyhow::ensure!(
            open < OPEN_PROPOSALS_PER_SESSION,
            "this session already has {open} open Proposals; merge or withdraw one before filing another"
        );
    }
    tx.execute(
        "INSERT INTO proposals (id, project_id, session_id, epic_id, verb, target_type, target_id, payload, rationale,
             state, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10, ?11)",
        params![
            id,
            new.project_id,
            new.session_id,
            new.epic_id,
            new.verb.as_str(),
            new.target.as_str(),
            new.target_id,
            new.payload.to_string(),
            new.rationale,
            actor_id,
            now
        ],
    )
    .context("failed to file the Proposal")?;
    record_event(
        &tx,
        new.project_id,
        "proposal",
        &id,
        EventScope { story_id: None, epic_id: new.epic_id },
        actor_id,
        "proposal.filed",
        &serde_json::json!({
            "verb": new.verb.as_str(), "target_type": new.target.as_str(),
            "label": format!("Proposed to {} a {}", new.verb.as_str(), new.target.as_str()),
        }),
        &now,
    )?;
    tx.commit()?;
    get_proposal(conn, &id)?.context("the filed Proposal could not be read back")
}

/// One Proposal by id.
pub fn get_proposal(conn: &Connection, proposal_id: &str) -> anyhow::Result<Option<Proposal>> {
    conn.query_row(select_proposals!("WHERE id = ?1"), params![proposal_id], row_to_proposal)
        .optional()
        .context("failed to read the Proposal")
}

/// A project's pending Proposals, oldest first.
pub fn pending_proposals(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<Proposal>> {
    let mut stmt = conn.prepare(select_proposals!("WHERE project_id = ?1 AND state = 'pending' ORDER BY created_at, id"))?;
    let rows = stmt.query_map(params![project_id], row_to_proposal)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the pending Proposals")
}

/// Accept a pending Proposal. Human-only.
pub fn accept_proposal(conn: &mut Connection, actor_id: &str, proposal_id: &str) -> anyhow::Result<()> {
    decide(conn, actor_id, proposal_id, "accepted", None)
}

/// Reject a pending Proposal, keeping the developer's reason. Human-only.
pub fn reject_proposal(conn: &mut Connection, actor_id: &str, proposal_id: &str, reason: Option<&str>) -> anyhow::Result<()> {
    decide(conn, actor_id, proposal_id, "rejected", reason.map(str::trim).filter(|r| !r.is_empty()))
}

fn decide(conn: &mut Connection, actor_id: &str, proposal_id: &str, to: &str, reason: Option<&str>) -> anyhow::Result<()> {
    let now = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let (project_id, epic_id, state): (String, Option<String>, String) = tx
        .query_row("SELECT project_id, epic_id, state FROM proposals WHERE id = ?1", params![proposal_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .with_context(|| format!("Proposal {proposal_id:?} not found"))?;
    anyhow::ensure!(state == "pending", "Proposal {proposal_id:?} was already {state}");
    tx.execute(
        "UPDATE proposals SET state = ?1, rejection_reason = ?2, decided_by = ?3, decided_at = ?4 WHERE id = ?5",
        params![to, reason, actor_id, now, proposal_id],
    )?;
    record_event(
        &tx,
        &project_id,
        "proposal",
        proposal_id,
        EventScope { story_id: None, epic_id: epic_id.as_deref() },
        actor_id,
        if to == "accepted" { "proposal.accepted" } else { "proposal.rejected" },
        &serde_json::json!({
            "field": "state", "before": "pending", "after": to, "reason": reason,
            "label": if to == "accepted" { "Accepted a Proposal" } else { "Rejected a Proposal" },
        }),
        &now,
    )?;
    tx.commit()?;
    Ok(())
}
