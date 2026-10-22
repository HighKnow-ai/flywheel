//! Proposals (docs/mvp-spec.md §2, §3, §5): the only way an agent writes to the board. A Proposal
//! suggests creating, amending, reordering or retiring a board record, an ADR or a glossary term,
//! and has no effect until the developer accepts it.
//!
//! Filing is open to an agent ([`file_proposal`]); deciding is the developer's alone
//! ([`accept_proposal`], [`accept_proposal_amended`], [`reject_proposal`] read the actor's type
//! inside their own transaction and refuse anything but a human). Accepting applies the Proposal's
//! effect in the same transaction as the decision (`proposal_apply`); Amend is the developer's edit
//! and acceptance in one act, the edited payload applied and the original kept on the event. A
//! rejection keeps its reason, which the Epic's packets carry.
//!
//! A Proposal a shaping session files hangs off the Stage it was filed in and the Round it follows;
//! a Stage is closed only once none of its Proposals is undecided
//! ([`count_undecided_proposals_in_stage`]).

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::proposal_apply::{apply_in_tx, validate_payload, Accepted, Applied};
use crate::domain::session::ShapingSubject;
use crate::domain::stage::open_stage;
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// The soft cap: open Proposals one Story session may hold at once. The board tool refuses the
/// next one and tells the agent to merge or withdraw one. A shaping session is exempt: shaping is
/// made of Proposals, and the Stage cannot close while any is undecided.
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
    /// What the Proposal does. Once accepted with an amendment, the payload that was applied; the
    /// agent's original is on the `proposal.accepted` event.
    pub payload: serde_json::Value,
    pub rationale: Option<String>,
    pub state: String,
    pub rejection_reason: Option<String>,
    pub decided_by: Option<String>,
    pub created_at: String,
    /// The Stage a shaping session filed it in; `None` for a Story session's Proposal.
    pub stage_id: Option<String>,
    /// The Round of that Stage it follows; `None` before the Stage's first Round.
    pub round_id: Option<String>,
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
        stage_id: row.get(13)?,
        round_id: row.get(14)?,
    })
}

/// `SELECT <every column> FROM proposals <tail>`, as one compile-time literal.
macro_rules! select_proposals {
    ($tail:literal) => {
        concat!(
            "SELECT id, project_id, session_id, epic_id, verb, target_type, target_id, payload, rationale, state, \
             rejection_reason, decided_by, created_at, stage_id, round_id FROM proposals ",
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

/// Where a session files: `(stage_id, round_id)` for a shaping session (its subject's open Stage and
/// that Stage's latest Round), `None` for a Story session, which is capped instead.
fn shaping_place(tx: &Transaction, session_id: &str) -> anyhow::Result<Option<(Option<String>, Option<String>)>> {
    let row: Option<(String, Option<String>, Option<String>)> = tx
        .query_row("SELECT kind, epic_id, milestone_id FROM sessions WHERE id = ?1", params![session_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?))
        })
        .optional()?;
    let Some((kind, epic_id, milestone_id)) = row else { anyhow::bail!("session {session_id:?} not found") };
    if kind != "shaping" {
        return Ok(None);
    }
    let subject = match (epic_id, milestone_id) {
        (Some(id), _) => ShapingSubject::Epic(id),
        (None, Some(id)) => ShapingSubject::Milestone(id),
        (None, None) => return Ok(Some((None, None))),
    };
    let Some(stage) = open_stage(tx, &subject)? else { return Ok(Some((None, None))) };
    let round: Option<String> = tx
        .query_row("SELECT id FROM rounds WHERE stage_id = ?1 ORDER BY number DESC LIMIT 1", params![stage.id], |r| r.get(0))
        .optional()?;
    Ok(Some((Some(stage.id), round)))
}

/// File a Proposal, pending. A Story session already holding [`OPEN_PROPOSALS_PER_SESSION`] pending
/// Proposals is refused; a shaping session is not capped, and its Proposal records the Stage and
/// Round it was filed in. A payload malformed for its kind is refused.
pub fn file_proposal(conn: &mut Connection, actor_id: &str, new: &NewProposal) -> anyhow::Result<Proposal> {
    validate_payload(new.verb, new.target, &new.payload)?;
    let now = now();
    let id = new_id();
    let tx = conn.transaction()?;
    let (stage_id, round_id) = match new.session_id {
        None => (None, None),
        Some(session_id) => match shaping_place(&tx, session_id)? {
            Some(place) => place,
            None => {
                let open: i64 = tx.query_row(
                    "SELECT COUNT(*) FROM proposals WHERE session_id = ?1 AND state = 'pending'",
                    params![session_id],
                    |r| r.get(0),
                )?;
                anyhow::ensure!(
                    open < OPEN_PROPOSALS_PER_SESSION,
                    "this session already has {open} open Proposals; merge or withdraw one before filing another"
                );
                (None, None)
            }
        },
    };
    tx.execute(
        "INSERT INTO proposals (id, project_id, session_id, epic_id, verb, target_type, target_id, payload, rationale,
             state, created_by, created_at, stage_id, round_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'pending', ?10, ?11, ?12, ?13)",
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
            now,
            stage_id,
            round_id
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

/// Every Proposal on an Epic, whatever its state, oldest first: what the Epic's shaping view draws
/// as ghost fields (pending) and struck-through lines (rejected).
pub fn proposals_on_epic(conn: &Connection, epic_id: &str) -> anyhow::Result<Vec<Proposal>> {
    let mut stmt = conn.prepare(select_proposals!("WHERE epic_id = ?1 ORDER BY created_at, id"))?;
    let rows = stmt.query_map(params![epic_id], row_to_proposal)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Epic's Proposals")
}

/// How many Proposals filed in Stage `stage_id` are still undecided (pending). A Stage is closable
/// only at zero (docs/mvp-spec.md §3 "Closing a Stage"); the Stage close (#126) reads this.
pub fn count_undecided_proposals_in_stage(conn: &Connection, stage_id: &str) -> anyhow::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM proposals WHERE stage_id = ?1 AND state = 'pending'", params![stage_id], |r| r.get(0))
        .context("failed to count the Stage's undecided Proposals")
}

/// Accept a pending Proposal and apply it, in one transaction. Human-only.
pub fn accept_proposal(conn: &mut Connection, actor_id: &str, proposal_id: &str) -> anyhow::Result<Applied> {
    decide(conn, actor_id, proposal_id, Decision::Accept { amended: None })
}

/// Amend: accept a pending Proposal with the developer's edited `payload` and apply that instead, in
/// one transaction. The row keeps the payload applied; the `proposal.accepted` event keeps the
/// agent's original beside it. Human-only.
pub fn accept_proposal_amended(
    conn: &mut Connection,
    actor_id: &str,
    proposal_id: &str,
    payload: &serde_json::Value,
) -> anyhow::Result<Applied> {
    decide(conn, actor_id, proposal_id, Decision::Accept { amended: Some(payload) })
}

/// Reject a pending Proposal, keeping the developer's reason. Human-only.
pub fn reject_proposal(conn: &mut Connection, actor_id: &str, proposal_id: &str, reason: Option<&str>) -> anyhow::Result<()> {
    decide(conn, actor_id, proposal_id, Decision::Reject { reason: reason.map(str::trim).filter(|r| !r.is_empty()) })?;
    Ok(())
}

enum Decision<'a> {
    Accept { amended: Option<&'a serde_json::Value> },
    Reject { reason: Option<&'a str> },
}

fn decide(conn: &mut Connection, actor_id: &str, proposal_id: &str, decision: Decision) -> anyhow::Result<Applied> {
    let now = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let p = get_proposal(&tx, proposal_id)?.with_context(|| format!("Proposal {proposal_id:?} not found"))?;
    anyhow::ensure!(p.state == "pending", "Proposal {proposal_id:?} was already {}", p.state);
    let scope = EventScope { story_id: None, epic_id: p.epic_id.as_deref() };

    let applied = match decision {
        Decision::Reject { reason } => {
            tx.execute(
                "UPDATE proposals SET state = 'rejected', rejection_reason = ?1, decided_by = ?2, decided_at = ?3 WHERE id = ?4",
                params![reason, actor_id, now, proposal_id],
            )?;
            record_event(
                &tx,
                &p.project_id,
                "proposal",
                proposal_id,
                scope,
                actor_id,
                "proposal.rejected",
                &serde_json::json!({
                    "field": "state", "before": "pending", "after": "rejected", "reason": reason,
                    "label": "Rejected a Proposal",
                }),
                &now,
            )?;
            Applied::RecordedOnly
        }
        Decision::Accept { amended } => {
            let verb = ProposalVerb::parse(&p.verb)?;
            let target = ProposalTarget::parse(&p.target_type)?;
            let payload = amended.unwrap_or(&p.payload);
            if amended.is_some() {
                validate_payload(verb, target, payload)?;
                same_kind_of_change(&p.payload, payload)?;
            }
            tx.execute(
                "UPDATE proposals SET state = 'accepted', payload = ?1, decided_by = ?2, decided_at = ?3 WHERE id = ?4",
                params![payload.to_string(), actor_id, now, proposal_id],
            )?;
            let accepted = Accepted { id: proposal_id, verb, target, target_id: p.target_id.as_deref() };
            let applied = apply_in_tx(&tx, actor_id, &accepted, payload)?;
            record_event(
                &tx,
                &p.project_id,
                "proposal",
                proposal_id,
                scope,
                actor_id,
                "proposal.accepted",
                &serde_json::json!({
                    "field": "state", "before": "pending", "after": "accepted",
                    "amended": amended.is_some(),
                    "original": p.payload,
                    "applied": payload,
                    "label": if amended.is_some() { "Amended and accepted a Proposal" } else { "Accepted a Proposal" },
                }),
                &now,
            )?;
            applied
        }
    };
    tx.commit()?;
    Ok(applied)
}

/// An amendment edits what a Proposal says, never what it lands on: a spec change keeps its field.
fn same_kind_of_change(original: &serde_json::Value, amended: &serde_json::Value) -> anyhow::Result<()> {
    if let Some(field) = original.get("field").and_then(|f| f.as_str()) {
        let label = crate::domain::proposal_apply::SpecField::parse(field).map(|f| f.label()).unwrap_or(field);
        anyhow::ensure!(
            amended.get("field").and_then(|f| f.as_str()) == Some(field),
            "an amendment keeps the field the Proposal changes ({label})"
        );
    }
    Ok(())
}
