//! The roadmap Round (docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap", issue #133): the only
//! time an agent speaks up unprompted about the Roadmap. It is a Round with no Stage, owned by the
//! project's Roadmap, started by a trigger ([`RoadmapTrigger`]): the Revisit roadmap button, an Epic
//! confirmed Done or a Milestone confirmed Done (#134, `confirm_done`). A project has at most one
//! open roadmap Round: a Done trigger that comes while one is open is noted on it ([`noted_triggers`]).
//!
//! Its shaping session is project-level (`ShapingSubject::Roadmap`). It reads the roadmap packet
//! (`shaping_packet::build_roadmap_packet`) and answers in one of two ways:
//!
//! - [`propose_roadmap_change`] files a Roadmap Proposal on the open Round (answered at once: a
//!   Proposal never holds the agent), one per change; then `round_wait` ([`wait_roadmap_round`]) holds
//!   the session until the developer has decided every one. That hold is the Round's Waiting on you.
//!   The decision that leaves nothing undecided closes the Round ([`settle_in_tx`], inside the
//!   decision's own transaction) and hands back the held call, with every decision.
//! - [`roadmap_holds`] closes the Round with a "Roadmap still holds" event, refused once the Round
//!   holds a Proposal.
//!
//! The developer can [`dismiss_roadmap_round`] at any time: the Round closes with no change, and any
//! Proposal still undecided in it is rejected with the dismissal as its reason, so it is listed in the
//! next roadmap packet like any other rejection.
//!
//! A Round outlives its session: Revisit roadmap on a project with an open Round starts a fresh session
//! that takes the Round over, and its packet lists the Proposals filed so far.

use anyhow::{bail, Context};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{json, Value};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::proposal::{
    decide_in_tx, file_proposal_in_tx, get_proposal, proposals_in_round, Decision, NewProposal,
    Proposal, ProposalTarget, ProposalVerb,
};
use crate::domain::proposal_apply::RoadmapChange;
use crate::domain::round::RoundRelease;
use crate::domain::session::agent_actor_id;
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// What started a roadmap Round (docs/mvp-spec.md §3: its three triggers).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoadmapTrigger {
    /// The developer pressed Revisit roadmap.
    Revisit,
    /// The developer confirmed this Epic Done.
    EpicDone(String),
    /// The developer confirmed this Milestone Done.
    MilestoneDone(String),
}

impl RoadmapTrigger {
    /// The `rounds.trigger_type` value.
    pub fn as_str(&self) -> &'static str {
        match self {
            RoadmapTrigger::Revisit => "revisit",
            RoadmapTrigger::EpicDone(_) => "epic_done",
            RoadmapTrigger::MilestoneDone(_) => "milestone_done",
        }
    }

    /// The `rounds.trigger_id` value.
    pub fn record_id(&self) -> Option<&str> {
        match self {
            RoadmapTrigger::Revisit => None,
            RoadmapTrigger::EpicDone(id) | RoadmapTrigger::MilestoneDone(id) => Some(id),
        }
    }

    /// The trigger a `(trigger_type, trigger_id)` pair names.
    pub fn parse(kind: &str, id: Option<String>) -> anyhow::Result<Self> {
        Ok(match (kind, id) {
            ("revisit", None) => RoadmapTrigger::Revisit,
            ("epic_done", Some(id)) => RoadmapTrigger::EpicDone(id),
            ("milestone_done", Some(id)) => RoadmapTrigger::MilestoneDone(id),
            (kind, id) => bail!("{kind:?} with {id:?} is not a roadmap Round trigger"),
        })
    }

    /// The triggering event in one sentence, naming its record as the board reads it.
    pub fn describe(&self, conn: &Connection) -> anyhow::Result<String> {
        Ok(match self {
            RoadmapTrigger::Revisit => "The developer pressed Revisit roadmap.".to_string(),
            RoadmapTrigger::EpicDone(id) => {
                let (key, title, milestone): (String, String, String) = conn
                    .query_row(
                        "SELECT e.key, e.title, m.title FROM epics e JOIN milestones m ON m.id = e.milestone_id WHERE e.id = ?1",
                        params![id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                    )
                    .with_context(|| format!("Epic {id:?} not found"))?;
                format!("The developer confirmed Epic {key} \"{title}\" Done, in Milestone \"{milestone}\".")
            }
            RoadmapTrigger::MilestoneDone(id) => {
                let title: String = conn
                    .query_row(
                        "SELECT title FROM milestones WHERE id = ?1",
                        params![id],
                        |r| r.get(0),
                    )
                    .with_context(|| format!("Milestone {id:?} not found"))?;
                format!("The developer confirmed Milestone \"{title}\" Done.")
            }
        })
    }

    /// A short label for the board: "Revisit roadmap", "Epic FLY-3 done".
    pub fn label(&self, conn: &Connection) -> String {
        match self {
            RoadmapTrigger::Revisit => "Revisit roadmap".to_string(),
            RoadmapTrigger::EpicDone(id) => conn
                .query_row("SELECT key FROM epics WHERE id = ?1", params![id], |r| {
                    r.get::<_, String>(0)
                })
                .map(|key| format!("Epic {key} done"))
                .unwrap_or_else(|_| "Epic done".to_string()),
            RoadmapTrigger::MilestoneDone(id) => conn
                .query_row(
                    "SELECT title FROM milestones WHERE id = ?1",
                    params![id],
                    |r| r.get::<_, String>(0),
                )
                .map(|title| format!("Milestone \"{title}\" done"))
                .unwrap_or_else(|_| "Milestone done".to_string()),
        }
    }
}

/// One roadmap Round.
#[derive(Debug, Clone, PartialEq)]
pub struct RoadmapRound {
    pub id: String,
    pub project_id: String,
    pub number: i64,
    /// The trigger, in one sentence.
    pub note: String,
    /// `open`, `closed` or `dismissed`.
    pub state: String,
    pub trigger: RoadmapTrigger,
    pub session_id: Option<String>,
    pub held_request_id: Option<String>,
    pub posted_at: String,
    pub closed_at: Option<String>,
    /// Derived, never stored: open, and a LIVE session is held on it (`crate::query::round_waiting_on_you`).
    pub waiting_on_you: bool,
    /// Derived: the session that owns it is live, held or still working.
    pub session_live: bool,
}

const ROADMAP_ROUND_SELECT: &str = concat!(
    "SELECT r.id, r.project_id, r.number, r.note, r.state, r.trigger_type, r.trigger_id, r.session_id, \
        r.held_request_id, r.posted_at, r.closed_at, ",
    crate::query::round_waiting_on_you!(),
    ", EXISTS (SELECT 1 FROM sessions ls WHERE ls.id = r.session_id AND ls.status IN ('running', 'blocked')) \
     FROM rounds r WHERE r.stage_id IS NULL"
);

fn roadmap_round_from_row(row: &rusqlite::Row) -> rusqlite::Result<RoadmapRound> {
    let kind: String = row.get(5)?;
    let trigger = RoadmapTrigger::parse(&kind, row.get(6)?).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(5, rusqlite::types::Type::Text, e.into())
    })?;
    Ok(RoadmapRound {
        id: row.get(0)?,
        project_id: row.get(1)?,
        number: row.get(2)?,
        note: row.get(3)?,
        state: row.get(4)?,
        trigger,
        session_id: row.get(7)?,
        held_request_id: row.get(8)?,
        posted_at: row.get(9)?,
        closed_at: row.get(10)?,
        waiting_on_you: row.get(11)?,
        session_live: row.get(12)?,
    })
}

/// One roadmap Round by id, or `None` (also for a Stage's Round).
pub fn get_roadmap_round(
    conn: &Connection,
    round_id: &str,
) -> anyhow::Result<Option<RoadmapRound>> {
    conn.query_row(
        &format!("{ROADMAP_ROUND_SELECT} AND r.id = ?1"),
        params![round_id],
        roadmap_round_from_row,
    )
    .optional()
    .context("failed to read the roadmap Round")
}

/// The project's open roadmap Round, or `None`.
pub fn open_roadmap_round(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Option<RoadmapRound>> {
    conn.query_row(
        &format!("{ROADMAP_ROUND_SELECT} AND r.project_id = ?1 AND r.state = 'open'"),
        params![project_id],
        roadmap_round_from_row,
    )
    .optional()
    .context("failed to read the open roadmap Round")
}

/// The project's latest roadmap Round, whatever its state, or `None`.
pub fn latest_roadmap_round(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Option<RoadmapRound>> {
    conn.query_row(
        &format!("{ROADMAP_ROUND_SELECT} AND r.project_id = ?1 ORDER BY r.number DESC LIMIT 1"),
        params![project_id],
        roadmap_round_from_row,
    )
    .optional()
    .context("failed to read the latest roadmap Round")
}

/// Open a roadmap Round on `project_id` for `trigger`, with no session yet, as `actor_id`: what
/// confirming an Epic or a Milestone Done does (#134) before it starts the Round's session. Refused
/// while the project has an open roadmap Round.
pub fn open_roadmap_round_for(
    conn: &mut Connection,
    project_id: &str,
    trigger: RoadmapTrigger,
    actor_id: &str,
) -> anyhow::Result<RoadmapRound> {
    let tx = conn.transaction()?;
    anyhow::ensure!(
        open_roadmap_round(&tx, project_id)?.is_none(),
        "this project already has an open roadmap Round; decide or dismiss it first"
    );
    let id = ensure_open_roadmap_round_in_tx(&tx, project_id, trigger, None, actor_id)?;
    let round = get_roadmap_round(&tx, &id)?.context("the roadmap Round just opened")?;
    tx.commit()?;
    Ok(round)
}

/// The project's open roadmap Round inside the caller's transaction, opening one for `trigger` when
/// none is open (`round.opened`, attributed to `actor_id`, the developer who started it). With a
/// `session_id`, that session takes the Round over: an earlier session's held call, which nobody can
/// answer any more, is cleared, and `round.resumed` is appended. Returns the Round's id.
pub(crate) fn ensure_open_roadmap_round_in_tx(
    tx: &Transaction,
    project_id: &str,
    trigger: RoadmapTrigger,
    session_id: Option<&str>,
    actor_id: &str,
) -> anyhow::Result<String> {
    let at = now();
    if let Some(open) = open_roadmap_round(tx, project_id)? {
        if let Some(session_id) = session_id {
            tx.execute(
                "UPDATE rounds SET session_id = ?1, held_request_id = NULL WHERE id = ?2 AND state = 'open'",
                params![session_id, open.id],
            )
            .context("failed to take the roadmap Round over")?;
            record_event(
                tx,
                project_id,
                "round",
                &open.id,
                EventScope::default(),
                actor_id,
                "round.resumed",
                &json!({
                    "field": "session",
                    "before": open.session_id,
                    "after": session_id,
                    "label": format!("Resumed roadmap Round {}", open.number),
                }),
                &at,
            )?;
        }
        return Ok(open.id);
    }
    let note = trigger.describe(tx)?;
    let number: i64 = tx.query_row(
        "SELECT COALESCE(MAX(number), 0) + 1 FROM rounds WHERE project_id = ?1 AND stage_id IS NULL",
        params![project_id],
        |r| r.get(0),
    )?;
    let id = new_id();
    tx.execute(
        "INSERT INTO rounds (id, project_id, stage_id, session_id, number, note, state, posted_at, trigger_type, trigger_id)
         VALUES (?1, ?2, NULL, ?3, ?4, ?5, 'open', ?6, ?7, ?8)",
        params![id, project_id, session_id, number, note, at, trigger.as_str(), trigger.record_id()],
    )
    .context("failed to open the roadmap Round")?;
    record_event(
        tx,
        project_id,
        "round",
        &id,
        EventScope::default(),
        actor_id,
        "round.opened",
        &json!({
            "field": "state",
            "before": null,
            "after": "open",
            "trigger": trigger.as_str(),
            "label": format!("Opened roadmap Round {number}: {}", trigger.label(tx)),
        }),
        &at,
    )?;
    Ok(id)
}

/// A Done trigger that came while `round` was already open (issue #134): no second Round opens. The
/// trigger is noted on the open one as `round.trigger_noted`, inside the confirmation's transaction, so
/// that Round's next packet names it ([`noted_triggers`]) and the strip's band says so.
pub(crate) fn note_trigger_in_tx(
    tx: &Transaction,
    round: &RoadmapRound,
    trigger: &RoadmapTrigger,
    actor_id: &str,
    at: &str,
) -> anyhow::Result<()> {
    anyhow::ensure!(
        round.state == "open",
        "roadmap Round {} is {}; a trigger is noted only on an open Round",
        round.number,
        round.state
    );
    record_event(
        tx,
        &round.project_id,
        "round",
        &round.id,
        EventScope::default(),
        actor_id,
        "round.trigger_noted",
        &json!({
            "trigger": trigger.as_str(),
            "trigger_id": trigger.record_id(),
            "label": format!("Noted {} on roadmap Round {}", trigger.label(tx), round.number),
        }),
        at,
    )?;
    Ok(())
}

/// The triggers noted on roadmap Round `round_id` after it opened (issue #134), oldest first.
pub fn noted_triggers(conn: &Connection, round_id: &str) -> anyhow::Result<Vec<RoadmapTrigger>> {
    let mut stmt = conn.prepare(
        "SELECT json_extract(payload, '$.trigger'), json_extract(payload, '$.trigger_id') FROM events
         WHERE stream_type = 'round' AND stream_id = ?1 AND event_type = 'round.trigger_noted'
         ORDER BY sequence",
    )?;
    let rows = stmt
        .query_map(params![round_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to read the triggers noted on the roadmap Round")?;
    rows.into_iter()
        .map(|(kind, id)| RoadmapTrigger::parse(&kind, id))
        .collect()
}

/// The live roadmap session `session_id`'s open Round, inside the caller's transaction. Refused for an
/// unknown, ended, Story or Epic/Milestone session, and when the project has no open roadmap Round.
fn live_roadmap_round(
    tx: &Transaction,
    session_id: &str,
    tool: &str,
) -> anyhow::Result<RoadmapRound> {
    /// `(kind, status, project_id, epic_id, milestone_id)` of the session.
    type SessionRow = (String, String, String, Option<String>, Option<String>);
    let row: Option<SessionRow> = tx
        .query_row(
            "SELECT kind, status, project_id, epic_id, milestone_id FROM sessions WHERE id = ?1",
            params![session_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .optional()?;
    let Some((kind, status, project_id, epic_id, milestone_id)) = row else {
        bail!("session {session_id:?} not found")
    };
    anyhow::ensure!(
        kind == "shaping",
        "{tool} belongs to a roadmap session; session {session_id:?} is a Story session"
    );
    anyhow::ensure!(
        epic_id.is_none() && milestone_id.is_none(),
        "{tool} belongs to a roadmap Round; this session shapes an Epic or a Milestone"
    );
    anyhow::ensure!(
        status == "running" || status == "blocked",
        "this session has ended ({status}); it can no longer use {tool}"
    );
    let round = open_roadmap_round(tx, &project_id)?
        .context("the roadmap Round is closed: the developer dismissed it or it was settled. End the session")?;
    anyhow::ensure!(
        round.session_id.as_deref() == Some(session_id),
        "roadmap Round {} belongs to another session; only one session revisits the Roadmap at a time",
        round.number
    );
    Ok(round)
}

/// The Milestone after the Current one: where a new Epic lands unless the agent names another
/// (docs/mvp-spec.md §5 "New Epic: created in Shaping, after the Current Milestone").
pub fn milestone_after_current(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Option<String>> {
    conn.query_row(
        "SELECT id FROM milestones WHERE project_id = ?1 AND state NOT IN ('done', 'dropped') ORDER BY rank, id LIMIT 1 OFFSET 1",
        params![project_id],
        |r| r.get(0),
    )
    .optional()
    .context("failed to read the Milestone after the Current one")
}

/// Check a change against the board before it is filed: every record it names is on this Roadmap and
/// still open to the change.
fn check_targets(
    conn: &Connection,
    project_id: &str,
    change: &RoadmapChange,
) -> anyhow::Result<()> {
    let open_milestone = |id: &str, act: &str| -> anyhow::Result<()> {
        let row: Option<(String, String, String)> = conn
            .query_row(
                "SELECT project_id, state, title FROM milestones WHERE id = ?1",
                params![id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let Some((project, state, title)) = row else {
            bail!("Milestone {id:?} is not on this Roadmap: use an id from the packet")
        };
        anyhow::ensure!(
            project == project_id,
            "Milestone {id:?} is not on this Roadmap: use an id from the packet"
        );
        anyhow::ensure!(
            state != "done" && state != "dropped",
            "Milestone \"{title}\" is {state}, so it cannot {act}: a Done Milestone is frozen (put later changes in a new Milestone), a Dropped one stays dropped"
        );
        Ok(())
    };
    match change {
        RoadmapChange::CreateMilestone { .. } => Ok(()),
        RoadmapChange::AmendMilestone { milestone_id, .. } => {
            open_milestone(milestone_id, "be amended")
        }
        RoadmapChange::ReorderMilestone {
            milestone_id,
            before_milestone_id,
        } => {
            open_milestone(milestone_id, "move")?;
            if let Some(before) = before_milestone_id {
                anyhow::ensure!(
                    before != milestone_id,
                    "a Milestone cannot move before itself"
                );
                let on_roadmap: bool = conn.query_row(
                    "SELECT EXISTS (SELECT 1 FROM milestones WHERE id = ?1 AND project_id = ?2)",
                    params![before, project_id],
                    |r| r.get(0),
                )?;
                anyhow::ensure!(
                    on_roadmap,
                    "Milestone {before:?} is not on this Roadmap: use an id from the packet"
                );
            }
            Ok(())
        }
        RoadmapChange::RetireMilestone { milestone_id } => {
            open_milestone(milestone_id, "be retired")
        }
        RoadmapChange::AddEpic { milestone_id, .. } => {
            open_milestone(milestone_id, "take a new Epic")
        }
        RoadmapChange::DropEpic { epic_id } => {
            let row: Option<(String, String, String)> = conn
                .query_row(
                    "SELECT project_id, state, key FROM epics WHERE id = ?1",
                    params![epic_id],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .optional()?;
            let Some((project, state, key)) = row else {
                bail!("Epic {epic_id:?} is not on this Roadmap: use an id from the packet")
            };
            anyhow::ensure!(
                project == project_id,
                "Epic {epic_id:?} is not on this Roadmap: use an id from the packet"
            );
            anyhow::ensure!(
                state != "done" && state != "dropped",
                "Epic {key} is {state}; only an open Epic is dropped"
            );
            Ok(())
        }
    }
}

/// File one Roadmap change on the live roadmap session `session_id`'s open Round, as the agent, with
/// its one-line reason (issue #133). A new Epic with no Milestone named goes after the Current
/// Milestone; with no such Milestone the change is refused and names the alternatives. Answered at
/// once: the developer decides it on the Roadmap strip.
pub fn propose_roadmap_change(
    conn: &mut Connection,
    session_id: &str,
    change: &RoadmapChange,
    why: &str,
) -> anyhow::Result<Proposal> {
    let agent = agent_actor_id(conn)?;
    let at = now();
    let tx = conn.transaction()?;
    let round = live_roadmap_round(&tx, session_id, "propose_roadmap_change")?;
    let mut change = change.clone();
    if let RoadmapChange::AddEpic { milestone_id, .. } = &mut change {
        if milestone_id.is_empty() {
            *milestone_id = milestone_after_current(&tx, &round.project_id)?.context(
                "there is no open Milestone after the Current one for the new Epic: name its `milestone_id`, or \
                 propose that Milestone first with create_milestone",
            )?;
        }
    }
    let change = &change;
    check_targets(&tx, &round.project_id, change)?;
    let (verb, target, target_id, payload) = change.to_proposal();
    let id = file_proposal_in_tx(
        &tx,
        &agent,
        &NewProposal {
            project_id: &round.project_id,
            session_id: Some(session_id),
            epic_id: None,
            verb,
            target,
            target_id,
            payload,
            rationale: Some(why),
        },
        &at,
    )?;
    tx.commit()?;
    get_proposal(conn, &id)?.context("the filed Roadmap Proposal")
}

/// "Roadmap still holds" (issue #133): close the live roadmap session `session_id`'s open Round with
/// no change, as the agent, appending `round.closed` labelled "Roadmap still holds" with the agent's
/// reason. Refused once the Round holds a Proposal: then the Round closes once each is decided.
pub fn roadmap_holds(
    conn: &mut Connection,
    session_id: &str,
    why: &str,
) -> anyhow::Result<RoadmapRound> {
    let agent = agent_actor_id(conn)?;
    let at = now();
    let tx = conn.transaction()?;
    let round = live_roadmap_round(&tx, session_id, "roadmap_holds")?;
    let filed: i64 = tx.query_row(
        "SELECT COUNT(*) FROM proposals WHERE round_id = ?1",
        params![round.id],
        |r| r.get(0),
    )?;
    anyhow::ensure!(
        filed == 0,
        "you proposed {filed} change{} in this Round, so the Roadmap does not hold as it is: call round_wait for the developer's decisions",
        if filed == 1 { "" } else { "s" }
    );
    close_in_tx(
        &tx,
        &round,
        &agent,
        &at,
        "closed",
        json!({ "outcome": "holds", "why": why, "label": "Roadmap still holds" }),
    )?;
    let closed = get_roadmap_round(&tx, &round.id)?.context("the roadmap Round just closed")?;
    tx.commit()?;
    Ok(closed)
}

/// What a roadmap `round_wait` left behind.
#[derive(Debug, Clone, PartialEq)]
pub enum RoadmapWait {
    /// Held until the developer has decided every Proposal of the Round. Boxed: a `RoadmapRound` is
    /// 240 bytes against `Value`'s 32, and every `Answered` would otherwise carry that size.
    Held(Box<RoadmapRound>),
    /// Every Proposal was already decided: the Round is closed and the call answered with this.
    Answered(Value),
}

/// `round_wait` in a roadmap session (issue #133): hold the call until every Proposal the Round holds
/// is decided. When none is undecided any more, the Round closes now and the call is answered at once
/// with every decision. Refused while the Round holds no Proposal: propose or say it holds.
pub fn wait_roadmap_round(
    conn: &mut Connection,
    session_id: &str,
    request_id: &str,
) -> anyhow::Result<RoadmapWait> {
    let agent = agent_actor_id(conn)?;
    let at = now();
    let tx = conn.transaction()?;
    let round = live_roadmap_round(&tx, session_id, "round_wait")?;
    let (filed, pending): (i64, i64) = tx.query_row(
        "SELECT COUNT(*), COUNT(*) FILTER (WHERE state = 'pending') FROM proposals WHERE round_id = ?1",
        params![round.id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    anyhow::ensure!(
        filed > 0,
        "this roadmap Round holds no Proposal yet, so there is nothing to wait on: propose each change with \
         propose_roadmap_change, or say the Roadmap still holds with roadmap_holds"
    );
    if pending == 0 {
        close_in_tx(
            &tx,
            &round,
            &agent,
            &at,
            "closed",
            json!({ "outcome": "decided" }),
        )?;
        let result = decisions_result(&tx, &round)?;
        tx.commit()?;
        return Ok(RoadmapWait::Answered(result));
    }
    tx.execute(
        "UPDATE rounds SET held_request_id = ?1 WHERE id = ?2 AND state = 'open'",
        params![request_id, round.id],
    )
    .context("failed to hold the roadmap Round")?;
    let held = get_roadmap_round(&tx, &round.id)?.context("the roadmap Round just held")?;
    tx.commit()?;
    Ok(RoadmapWait::Held(Box::new(held)))
}

/// After a decision on a Proposal of Round `round_id`, inside the deciding transaction: close a roadmap
/// Round left with nothing undecided, when its session waits on it (and hand back that held call) or
/// has died. While its live session is still working the Round stays open: the agent may file more,
/// and its `round_wait` closes it. A Stage's Round is never touched.
pub(crate) fn settle_in_tx(
    tx: &Transaction,
    round_id: &str,
    actor_id: &str,
    at: &str,
) -> anyhow::Result<Option<RoundRelease>> {
    let Some(round) = get_roadmap_round(tx, round_id)? else {
        return Ok(None);
    };
    if round.state != "open" {
        return Ok(None);
    }
    let pending: i64 = tx.query_row(
        "SELECT COUNT(*) FROM proposals WHERE round_id = ?1 AND state = 'pending'",
        params![round.id],
        |r| r.get(0),
    )?;
    if pending > 0 || (round.session_live && !round.waiting_on_you) {
        return Ok(None);
    }
    let release = match (
        &round.session_id,
        &round.held_request_id,
        round.waiting_on_you,
    ) {
        (Some(session_id), Some(request_id), true) => Some(RoundRelease {
            session_id: session_id.clone(),
            request_id: request_id.clone(),
            result: decisions_result(tx, &round)?,
        }),
        _ => None,
    };
    close_in_tx(
        tx,
        &round,
        actor_id,
        at,
        "closed",
        json!({ "outcome": "decided" }),
    )?;
    Ok(release)
}

/// What a dismissal left behind.
#[derive(Debug, Clone, PartialEq)]
pub struct DismissOutcome {
    pub project_id: String,
    pub release: Option<RoundRelease>,
}

/// The reason a dismissed Round's undecided Proposals are rejected with.
pub const DISMISSED_REASON: &str = "Dismissed with the roadmap Round";

/// Dismiss an open roadmap Round, as the developer (docs/mvp-spec.md §3 "Dismissing a Round closes it
/// with no change, until the next trigger"). One transaction: refuse any actor but a human, reject every
/// Proposal still undecided in it with [`DISMISSED_REASON`], mark it `dismissed` and append
/// `round.dismissed`. The held call, if its session is live, is handed back to be told to end.
pub fn dismiss_roadmap_round(
    conn: &mut Connection,
    actor_id: &str,
    round_id: &str,
) -> anyhow::Result<DismissOutcome> {
    let at = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;
    let round = get_roadmap_round(&tx, round_id)?
        .with_context(|| format!("roadmap Round {round_id:?} not found"))?;
    anyhow::ensure!(
        round.state == "open",
        "roadmap Round {} is already {}",
        round.number,
        round.state
    );
    let pending: Vec<String> = {
        let mut stmt = tx.prepare("SELECT id FROM proposals WHERE round_id = ?1 AND state = 'pending' ORDER BY created_at, id")?;
        let ids = stmt
            .query_map(params![round.id], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        ids
    };
    for id in &pending {
        decide_in_tx(
            &tx,
            actor_id,
            id,
            Decision::Reject {
                reason: Some(DISMISSED_REASON),
            },
            &at,
        )?;
    }
    let release = match (
        &round.session_id,
        &round.held_request_id,
        round.waiting_on_you,
    ) {
        (Some(session_id), Some(request_id), true) => Some(RoundRelease {
            session_id: session_id.clone(),
            request_id: request_id.clone(),
            result: json!({
                "round": round.number,
                "outcome": "dismissed",
                "next": "The developer dismissed this roadmap Round: nothing on the Roadmap changes, and any \
                         Proposal still undecided was rejected with it. Do not propose again. End your session now.",
            }),
        }),
        _ => None,
    };
    close_in_tx(
        &tx,
        &round,
        actor_id,
        &at,
        "dismissed",
        json!({ "outcome": "dismissed", "rejected": pending.len(), "label": format!("Dismissed roadmap Round {}: no change", round.number) }),
    )?;
    tx.commit()?;
    Ok(DismissOutcome {
        project_id: round.project_id,
        release,
    })
}

/// Close an open roadmap Round as `to` (`closed` or `dismissed`), clearing its held call, and append
/// `round.closed` or `round.dismissed` with `detail` (its `label` defaults to a count of decisions).
fn close_in_tx(
    tx: &Transaction,
    round: &RoadmapRound,
    actor_id: &str,
    at: &str,
    to: &str,
    mut detail: Value,
) -> anyhow::Result<()> {
    let changed = tx
        .execute(
            "UPDATE rounds SET state = ?1, closed_at = ?2, closed_by = ?3, held_request_id = NULL WHERE id = ?4 AND state = 'open'",
            params![to, at, actor_id, round.id],
        )
        .context("failed to close the roadmap Round")?;
    anyhow::ensure!(
        changed == 1,
        "roadmap Round {} is no longer open",
        round.number
    );
    if detail.get("label").is_none() {
        let (accepted, rejected): (i64, i64) = tx.query_row(
            "SELECT COUNT(*) FILTER (WHERE state = 'accepted'), COUNT(*) FILTER (WHERE state = 'rejected') FROM proposals WHERE round_id = ?1",
            params![round.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        detail["label"] = json!(format!(
            "Closed roadmap Round {}: {accepted} accepted, {rejected} rejected",
            round.number
        ));
    }
    detail["field"] = json!("state");
    detail["before"] = json!("open");
    detail["after"] = json!(to);
    let event = if to == "dismissed" {
        "round.dismissed"
    } else {
        "round.closed"
    };
    record_event(
        tx,
        &round.project_id,
        "round",
        &round.id,
        EventScope::default(),
        actor_id,
        event,
        &detail,
        at,
    )?;
    Ok(())
}

/// What a closed roadmap Round answers its `round_wait` with: every Proposal it filed, decided.
fn decisions_result(conn: &Connection, round: &RoadmapRound) -> anyhow::Result<Value> {
    let decisions: Vec<Value> = proposals_in_round(conn, &round.id)?
        .into_iter()
        .map(|p| {
            let change = describe_proposal(conn, &p);
            json!({ "proposal_id": p.id, "change": change, "state": p.state, "reason": p.rejection_reason })
        })
        .collect();
    Ok(json!({
        "round": round.number,
        "outcome": "closed",
        "decisions": decisions,
        "next": "Every Proposal of this roadmap Round is decided and the Round is closed. Do not propose a \
                 rejected change again without new evidence. End your session now with one line on what changed.",
    }))
}

/// A Roadmap Proposal in one line, as the board names its records; any other Proposal by its kind.
pub fn describe_proposal(conn: &Connection, p: &Proposal) -> String {
    let parsed = ProposalVerb::parse(&p.verb)
        .and_then(|verb| Ok((verb, ProposalTarget::parse(&p.target_type)?)))
        .and_then(|(verb, target)| {
            RoadmapChange::from_proposal(verb, target, p.target_id.as_deref(), &p.payload)
        });
    match parsed {
        Ok(change) => change.describe(conn),
        Err(_) => format!("{} a {}", p.verb, p.target_type.replace('_', " ")),
    }
}

/// The Roadmap Proposals the developer rejected on this project, oldest first, each as one line with
/// its reason: what the roadmap packet lists so the agent does not propose them again.
pub fn rejected_roadmap_proposals(
    conn: &Connection,
    project_id: &str,
) -> anyhow::Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT id FROM proposals WHERE project_id = ?1 AND state = 'rejected'
           AND (target_type = 'milestone' OR (target_type = 'epic' AND verb IN ('create', 'retire')))
         ORDER BY created_at, id",
    )?;
    let ids = stmt
        .query_map(params![project_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut out = Vec::with_capacity(ids.len());
    for id in ids {
        let p = get_proposal(conn, &id)?.context("a rejected Roadmap Proposal")?;
        let reason = p
            .rejection_reason
            .clone()
            .unwrap_or_else(|| "no reason given".to_string());
        out.push(format!(
            "{}; rejected: {reason}",
            describe_proposal(conn, &p)
        ));
    }
    Ok(out)
}
