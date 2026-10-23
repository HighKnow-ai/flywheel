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
/// next one and tells the agent to withdraw one with `proposal_withdraw` (issue #160: there is no
/// merge verb; to merge two, withdraw both and file the combined one). A shaping session is exempt:
/// shaping is made of Proposals, and the Stage cannot close while any is undecided.
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
    /// What the agent saw that made it file, beside its why (`rationale`): a Story session's
    /// Proposal carries one (issue #160); a shaping session's has none.
    pub evidence: Option<String>,
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
        evidence: row.get(15)?,
    })
}

/// `SELECT <every column> FROM proposals <tail>`, as one compile-time literal.
macro_rules! select_proposals {
    ($tail:literal) => {
        concat!(
            "SELECT id, project_id, session_id, epic_id, verb, target_type, target_id, payload, rationale, state, \
             rejection_reason, decided_by, created_at, stage_id, round_id, evidence FROM proposals ",
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
/// that Stage's latest Round, or, for the Roadmap, no Stage and the project's open roadmap Round,
/// issue #133), `None` for a Story session, which is capped instead.
fn shaping_place(tx: &Transaction, session_id: &str) -> anyhow::Result<Option<(Option<String>, Option<String>)>> {
    let row: Option<(String, String, Option<String>, Option<String>)> = tx
        .query_row("SELECT kind, project_id, epic_id, milestone_id FROM sessions WHERE id = ?1", params![session_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })
        .optional()?;
    let Some((kind, project_id, epic_id, milestone_id)) = row else { anyhow::bail!("session {session_id:?} not found") };
    if kind != "shaping" {
        return Ok(None);
    }
    let subject = match ShapingSubject::of_row(&project_id, epic_id, milestone_id) {
        ShapingSubject::Roadmap(project_id) => {
            let round = crate::domain::roadmap_round::open_roadmap_round(tx, &project_id)?.map(|r| r.id);
            return Ok(Some((None, round)));
        }
        subject => subject,
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
    file_proposal_with_evidence(conn, actor_id, new, None)
}

/// [`file_proposal`] with the agent's evidence line kept beside its why (issue #160), in the same
/// transaction as the filing.
pub fn file_proposal_with_evidence(
    conn: &mut Connection,
    actor_id: &str,
    new: &NewProposal,
    evidence: Option<&str>,
) -> anyhow::Result<Proposal> {
    let tx = conn.transaction()?;
    let id = file_proposal_in_tx(&tx, actor_id, new, &now())?;
    if evidence.is_some() {
        tx.execute("UPDATE proposals SET evidence = ?1 WHERE id = ?2", params![evidence, id])
            .context("failed to keep the Proposal's evidence")?;
    }
    tx.commit()?;
    get_proposal(conn, &id)?.context("the filed Proposal could not be read back")
}

/// How many Proposals session `session_id` holds open (pending): what the soft cap counts.
pub fn open_proposals_in_session(conn: &Connection, session_id: &str) -> anyhow::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM proposals WHERE session_id = ?1 AND state = 'pending'", params![session_id], |r| r.get(0))
        .context("failed to count the session's open Proposals")
}

/// Withdraw a pending Proposal (issue #160): the filing session takes it back, which frees a slot
/// under the soft cap. Only the session that filed it may, and only while it is pending: a decided
/// Proposal stays decided. A withdrawal decides nothing, so it names no decider; its event names the
/// actor who withdrew it.
pub fn withdraw_proposal(conn: &mut Connection, actor_id: &str, session_id: &str, proposal_id: &str) -> anyhow::Result<Proposal> {
    let at = now();
    let tx = conn.transaction()?;
    let p = get_proposal(&tx, proposal_id)?.with_context(|| format!("Proposal {proposal_id:?} not found"))?;
    anyhow::ensure!(
        p.session_id.as_deref() == Some(session_id),
        "Proposal {proposal_id:?} was filed by another session; a session withdraws only its own Proposals"
    );
    anyhow::ensure!(p.state == "pending", "Proposal {proposal_id:?} was already {}; only a pending Proposal is withdrawn", p.state);
    tx.execute("UPDATE proposals SET state = 'withdrawn', withdrawn_at = ?1 WHERE id = ?2", params![at, proposal_id])
        .context("failed to withdraw the Proposal")?;
    record_event(
        &tx,
        &p.project_id,
        "proposal",
        proposal_id,
        EventScope { story_id: None, epic_id: p.epic_id.as_deref() },
        actor_id,
        "proposal.withdrawn",
        &serde_json::json!({ "field": "state", "before": "pending", "after": "withdrawn", "label": "Withdrew a Proposal" }),
        &at,
    )?;
    tx.commit()?;
    get_proposal(conn, proposal_id)?.context("the withdrawn Proposal could not be read back")
}

/// Every Proposal the sessions of Story `story_id` filed, whatever its state, oldest first (issue
/// #160).
pub fn proposals_filed_by_story(conn: &Connection, story_id: &str) -> anyhow::Result<Vec<Proposal>> {
    let mut stmt = conn.prepare(select_proposals!(
        "WHERE session_id IN (SELECT id FROM sessions WHERE story_id = ?1) ORDER BY created_at, id"
    ))?;
    let rows = stmt.query_map(params![story_id], row_to_proposal)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Proposals the Story filed")
}

/// Where a Reorder moves its Story: the key of the Story it sits after now, and the key of the one it
/// would sit after. `None` is the top of the Epic's order.
#[derive(Debug, Clone, PartialEq)]
pub struct ReorderPlaces {
    pub now_after: Option<String>,
    pub proposed_after: Option<String>,
}

/// One card of the triage drawer (docs/mvp-spec.md §5, issue #162): a Proposal awaiting triage, with
/// the Story whose session filed it and the record it lands on.
#[derive(Debug, Clone, PartialEq)]
pub struct TriageProposal {
    pub proposal: Proposal,
    /// The Story whose session filed it.
    pub story_id: String,
    pub story_key: String,
    pub story_title: String,
    /// The Epic it lands on; `None` for a New Epic, which lands on the Roadmap.
    pub epic_key: Option<String>,
    pub epic_title: Option<String>,
    /// A New Epic's Milestone: the one after the Current Milestone when it was filed.
    pub milestone_title: Option<String>,
    /// The Story a Reorder or a Retire names.
    pub target_key: Option<String>,
    pub target_title: Option<String>,
    /// A Reorder's places in the Epic's order.
    pub reorder: Option<ReorderPlaces>,
}

/// Every Proposal awaiting triage in `project_id` (`crate::query::awaits_triage`: pending, filed by a
/// Story session, not a judged-on change), in the drawer's order: grouped by the Epic each lands on, in
/// Roadmap order (its Milestone's rank, then its own), then the New Epics, which land on the Roadmap;
/// oldest first within a group. The filing Story comes through `sessions`.
pub fn proposals_for_triage(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<TriageProposal>> {
    const SQL: &str = concat!(
        "SELECT p.id, p.project_id, p.session_id, p.epic_id, p.verb, p.target_type, p.target_id, p.payload, p.rationale, \
            p.state, p.rejection_reason, p.decided_by, p.created_at, p.stage_id, p.round_id, p.evidence, \
            fs.id, fs.key, fs.title, e.key, e.title, nm.title, ts.key, ts.title \
         FROM proposals p \
         JOIN sessions ss ON ss.id = p.session_id \
         JOIN stories fs ON fs.id = ss.story_id \
         LEFT JOIN epics e ON e.id = p.epic_id \
         LEFT JOIN milestones em ON em.id = e.milestone_id \
         LEFT JOIN stories ts ON ts.id = p.target_id AND p.target_type = 'story' \
         LEFT JOIN milestones nm ON p.epic_id IS NULL AND p.verb = 'create' AND p.target_type = 'epic' \
             AND nm.id = json_extract(p.payload, '$.milestone_id') \
         WHERE p.project_id = ?1 AND ",
        crate::query::awaits_triage!(),
        " ORDER BY p.epic_id IS NULL, em.rank, em.id, e.rank, e.id, p.created_at, p.id"
    );
    let mut stmt = conn.prepare(SQL)?;
    let mut rows = stmt
        .query_map(params![project_id], |row| {
            Ok(TriageProposal {
                proposal: row_to_proposal(row)?,
                story_id: row.get(16)?,
                story_key: row.get(17)?,
                story_title: row.get(18)?,
                epic_key: row.get(19)?,
                epic_title: row.get(20)?,
                milestone_title: row.get(21)?,
                target_key: row.get(22)?,
                target_title: row.get(23)?,
                reorder: None,
            })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the Proposals awaiting triage")?;
    for t in rows.iter_mut().filter(|t| t.proposal.verb == "reorder" && t.proposal.target_type == "story") {
        let (Some(story_id), Some(rank)) = (t.proposal.target_id.as_deref(), t.proposal.payload.get("rank").and_then(|r| r.as_str()))
        else {
            continue;
        };
        t.reorder = Some(reorder_places(conn, story_id, rank)?);
    }
    Ok(rows)
}

/// A Reorder's places: which Story its Story sits after now, and which it would sit after at `rank`.
/// Dropped Stories are left out of the order.
fn reorder_places(conn: &Connection, story_id: &str, rank: &str) -> anyhow::Result<ReorderPlaces> {
    const AFTER: &str = "SELECT o.key FROM stories o JOIN stories t ON t.id = ?1 \
        WHERE o.epic_id = t.epic_id AND o.id != t.id AND o.state != 'dropped' \
            AND (o.rank < ?2 OR (o.rank = ?2 AND o.id < t.id)) \
        ORDER BY o.rank DESC, o.id DESC LIMIT 1";
    let current: String = conn.query_row("SELECT rank FROM stories WHERE id = ?1", params![story_id], |r| r.get(0))?;
    let after = |at: &str| conn.query_row(AFTER, params![story_id, at], |r| r.get::<_, String>(0)).optional();
    Ok(ReorderPlaces { now_after: after(&current)?, proposed_after: after(rank)? })
}

/// [`file_proposal`]'s body inside the caller's transaction, returning the new Proposal's id. A
/// Round's ADR question files through it and decides in the same transaction (issue #129).
pub(crate) fn file_proposal_in_tx(tx: &Transaction, actor_id: &str, new: &NewProposal, now: &str) -> anyhow::Result<String> {
    validate_payload(new.verb, new.target, &new.payload)?;
    let id = new_id();
    let (stage_id, round_id) = match new.session_id {
        None => (None, None),
        Some(session_id) => match shaping_place(tx, session_id)? {
            Some(place) => place,
            None => {
                let open = open_proposals_in_session(tx, session_id)?;
                anyhow::ensure!(
                    open < OPEN_PROPOSALS_PER_SESSION,
                    "this session already has {open} open Proposals, the most it may hold; withdraw one with \
                     proposal_withdraw before filing another (to merge two, withdraw both and file the combined one)"
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
        tx,
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
        now,
    )?;
    Ok(id)
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

/// Every Proposal that amends a Milestone, whatever its state, oldest first (issue #132): what the
/// Milestone's shaping view draws as a ghost over its exit test (pending) and struck-through lines
/// (rejected).
pub fn proposals_on_milestone(conn: &Connection, milestone_id: &str) -> anyhow::Result<Vec<Proposal>> {
    let mut stmt =
        conn.prepare(select_proposals!("WHERE target_type = 'milestone' AND target_id = ?1 ORDER BY created_at, id"))?;
    let rows = stmt.query_map(params![milestone_id], row_to_proposal)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Milestone's Proposals")
}

/// How many Proposals filed in Stage `stage_id` are still undecided (pending). A Stage is closable
/// only at zero (docs/mvp-spec.md §3 "Closing a Stage"); the Stage close (#126) reads this.
pub fn count_undecided_proposals_in_stage(conn: &Connection, stage_id: &str) -> anyhow::Result<i64> {
    conn.query_row("SELECT COUNT(*) FROM proposals WHERE stage_id = ?1 AND state = 'pending'", params![stage_id], |r| r.get(0))
        .context("failed to count the Stage's undecided Proposals")
}

/// Every Proposal filed in Round `round_id`, oldest first, whatever its state: a roadmap Round's ghost
/// rows (pending) and struck-through lines (rejected), issue #133.
pub fn proposals_in_round(conn: &Connection, round_id: &str) -> anyhow::Result<Vec<Proposal>> {
    let mut stmt = conn.prepare(select_proposals!("WHERE round_id = ?1 ORDER BY created_at, id"))?;
    let rows = stmt.query_map(params![round_id], row_to_proposal)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Round's Proposals")
}

/// What deciding a Proposal did: its effect, and the held `round_wait` call to answer when the
/// decision closed a roadmap Round its live session waits on (issue #133).
#[derive(Debug, Clone, PartialEq)]
pub struct Decided {
    pub applied: Applied,
    pub release: Option<crate::domain::round::RoundRelease>,
}

/// Accept a pending Proposal and apply it, in one transaction. Human-only.
pub fn accept_proposal(conn: &mut Connection, actor_id: &str, proposal_id: &str) -> anyhow::Result<Applied> {
    Ok(decide(conn, actor_id, proposal_id, Decision::Accept { amended: None })?.applied)
}

/// [`accept_proposal`], handing back the held call its decision released, for the caller to answer
/// once the transaction has committed.
pub fn accept_proposal_released(
    conn: &mut Connection,
    actor_id: &str,
    proposal_id: &str,
    amended: Option<&serde_json::Value>,
) -> anyhow::Result<Decided> {
    decide(conn, actor_id, proposal_id, Decision::Accept { amended })
}

/// [`reject_proposal`], handing back the held call its decision released.
pub fn reject_proposal_released(
    conn: &mut Connection,
    actor_id: &str,
    proposal_id: &str,
    reason: Option<&str>,
) -> anyhow::Result<Decided> {
    decide(conn, actor_id, proposal_id, Decision::Reject { reason: reason.map(str::trim).filter(|r| !r.is_empty()) })
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
    Ok(decide(conn, actor_id, proposal_id, Decision::Accept { amended: Some(payload) })?.applied)
}

/// Reject a pending Proposal, keeping the developer's reason. Human-only.
pub fn reject_proposal(conn: &mut Connection, actor_id: &str, proposal_id: &str, reason: Option<&str>) -> anyhow::Result<()> {
    decide(conn, actor_id, proposal_id, Decision::Reject { reason: reason.map(str::trim).filter(|r| !r.is_empty()) })?;
    Ok(())
}

pub(crate) enum Decision<'a> {
    Accept { amended: Option<&'a serde_json::Value> },
    Reject { reason: Option<&'a str> },
}

/// Decide in one transaction. A decision on a roadmap Round's Proposal may close the Round (issue
/// #133: its last undecided Proposal, decided while its session waits on it or after that session
/// died), in the same transaction.
fn decide(conn: &mut Connection, actor_id: &str, proposal_id: &str, decision: Decision) -> anyhow::Result<Decided> {
    let at = now();
    let tx = conn.transaction()?;
    let applied = decide_in_tx(&tx, actor_id, proposal_id, decision, &at)?;
    let round_id: Option<String> =
        tx.query_row("SELECT round_id FROM proposals WHERE id = ?1", params![proposal_id], |r| r.get(0))?;
    let release = match round_id {
        Some(round_id) => crate::domain::roadmap_round::settle_in_tx(&tx, &round_id, actor_id, &at)?,
        None => None,
    };
    tx.commit()?;
    Ok(Decided { applied, release })
}

/// Accept a pending Proposal as it is inside the caller's transaction: [`accept_proposal`]'s body.
/// A Round's ADR question files its Proposal and accepts it here, in the answer's transaction, so
/// the answer, the filing and the decision commit together or not at all (issue #129). Human-only.
pub(crate) fn accept_proposal_in_tx(tx: &Transaction, actor_id: &str, proposal_id: &str, now: &str) -> anyhow::Result<Applied> {
    decide_in_tx(tx, actor_id, proposal_id, Decision::Accept { amended: None }, now)
}

pub(crate) fn decide_in_tx(tx: &Transaction, actor_id: &str, proposal_id: &str, decision: Decision, now: &str) -> anyhow::Result<Applied> {
    assert_human_actor_in_tx(tx, actor_id)?;
    let p = get_proposal(tx, proposal_id)?.with_context(|| format!("Proposal {proposal_id:?} not found"))?;
    anyhow::ensure!(p.state == "pending", "Proposal {proposal_id:?} was already {}", p.state);
    let scope = EventScope { story_id: None, epic_id: p.epic_id.as_deref() };

    let applied = match decision {
        Decision::Reject { reason } => {
            tx.execute(
                "UPDATE proposals SET state = 'rejected', rejection_reason = ?1, decided_by = ?2, decided_at = ?3 WHERE id = ?4",
                params![reason, actor_id, now, proposal_id],
            )?;
            record_event(
                tx,
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
                now,
            )?;
            Applied::RecordedOnly
        }
        Decision::Accept { amended } => {
            let verb = ProposalVerb::parse(&p.verb)?;
            let target = ProposalTarget::parse(&p.target_type)?;
            let payload = amended.unwrap_or(&p.payload);
            if amended.is_some() {
                validate_payload(verb, target, payload)?;
                same_kind_of_change(verb, target, &p.payload, payload)?;
            }
            tx.execute(
                "UPDATE proposals SET state = 'accepted', payload = ?1, decided_by = ?2, decided_at = ?3 WHERE id = ?4",
                params![payload.to_string(), actor_id, now, proposal_id],
            )?;
            let accepted = Accepted {
                id: proposal_id,
                project_id: &p.project_id,
                verb,
                target,
                target_id: p.target_id.as_deref(),
                epic_id: p.epic_id.as_deref(),
            };
            let applied = apply_in_tx(tx, actor_id, &accepted, payload)?;
            record_event(
                tx,
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
                now,
            )?;
            applied
        }
    };
    Ok(applied)
}

/// An amendment edits what a Proposal says, never what it lands on: a spec change keeps its field, a
/// new Epic its Milestone and a move its anchor (issue #133), and a New Story its place in the order
/// and what it runs after (issue #127), its title, description and reason being the developer's to edit,
/// and a New criterion its Story (issue #128).
fn same_kind_of_change(
    verb: ProposalVerb,
    target: ProposalTarget,
    original: &serde_json::Value,
    amended: &serde_json::Value,
) -> anyhow::Result<()> {
    if crate::domain::proposal_apply::is_new_story(verb, target) {
        use crate::domain::proposal_apply::NewStory;
        let (before, after) = (NewStory::from_payload(original)?, NewStory::from_payload(amended)?);
        anyhow::ensure!(before.rank == after.rank, "an amendment keeps the New Story's place in the order");
        anyhow::ensure!(
            before.runs_after.as_ref().map(|(a, _)| a) == after.runs_after.as_ref().map(|(a, _)| a),
            "an amendment keeps what the New Story runs after; edit only its reason"
        );
        return Ok(());
    }
    if crate::domain::proposal_apply::is_new_criterion(verb, target) {
        // Issue #128: the developer edits the statement and the Check, never the Story it is on.
        use crate::domain::proposal_apply::NewCriterion;
        let (before, after) = (NewCriterion::from_payload(original)?, NewCriterion::from_payload(amended)?);
        anyhow::ensure!(before.story_id == after.story_id, "an amendment keeps the Story the criterion is anchored to");
        return Ok(());
    }
    if crate::domain::proposal_apply::is_amend_criterion(verb, target) {
        // Issue #160: the developer edits the new statement and Check, never which criterion they land on.
        use crate::domain::proposal_apply::AmendCriterion;
        let (before, after) = (AmendCriterion::from_payload(original)?, AmendCriterion::from_payload(amended)?);
        anyhow::ensure!(before.criterion_id == after.criterion_id, "an amendment keeps the criterion the Proposal rewrites");
        return Ok(());
    }
    for key in ["milestone_id", "before_milestone_id"] {
        if let Some(kept) = original.get(key) {
            anyhow::ensure!(
                amended.get(key).unwrap_or(&serde_json::Value::Null) == kept,
                "an amendment keeps where the Proposal lands (`{key}`)"
            );
        }
    }
    if let Some(field) = original.get("field").and_then(|f| f.as_str()) {
        let label = crate::domain::proposal_apply::SpecField::parse(field).map(|f| f.label()).unwrap_or(field);
        anyhow::ensure!(
            amended.get("field").and_then(|f| f.as_str()) == Some(field),
            "an amendment keeps the field the Proposal changes ({label})"
        );
    }
    Ok(())
}
