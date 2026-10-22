//! Confirming an exit test (issue #134, docs/mvp-spec.md §3 "Shaping a Milestone and the Roadmap"):
//! the developer confirms an Epic or a Milestone Done, and that click is also the consent to a roadmap
//! Round (Epic #60, "Decided in slicing").
//!
//! - [`confirm_epic_done`]: every Story Merged or Dropped, the Epic moves to Done, and one short Round
//!   opens on its Milestone (is its exit test still reachable, is an Epic missing or one to drop).
//! - [`confirm_milestone_done`]: every Epic Done (a Dropped one aside), the Milestone moves to Done,
//!   and one Roadmap Round opens (is the next Milestone still right).
//!
//! Each runs in one transaction with the state change it confirms, so a refusal opens nothing. With a
//! roadmap Round already open no second one opens: the trigger is noted on the open Round
//! (`roadmap_round::note_trigger_in_tx`), whose next packet names it. Starting the Round's session is
//! the caller's (`commands::roadmap_round`), exactly as Revisit roadmap starts one; with no session the
//! Round waits on the strip for Continue.
//!
//! Declining an exit test is `set_epic_state(Shaping)` / `set_milestone_state(Shaping)`: shaping
//! reopens and no Round starts. These two are the only Done triggers: nothing in a Story's life starts
//! a roadmap Round (`tests/roadmap_round_triggers.rs` pins it).

use anyhow::Context;
use rusqlite::{params, Connection};
use serde_json::json;

use crate::domain::epic::{set_epic_state_in_tx, EpicState};
use crate::domain::milestone::{set_milestone_state_in_tx, MilestoneState};
use crate::domain::now;
use crate::domain::roadmap_round::{
    ensure_open_roadmap_round_in_tx, get_roadmap_round, note_trigger_in_tx, open_roadmap_round, RoadmapRound, RoadmapTrigger,
};

/// What a confirmation did with the roadmap Round it triggers.
#[derive(Debug, Clone, PartialEq)]
pub enum DoneTrigger {
    /// A Round opened on the trigger, with no session yet: the caller starts it.
    Opened(RoadmapRound),
    /// A Round was already open: the trigger is noted on it, and no session starts.
    Noted(RoadmapRound),
}

impl DoneTrigger {
    pub fn round(&self) -> &RoadmapRound {
        match self {
            DoneTrigger::Opened(round) | DoneTrigger::Noted(round) => round,
        }
    }
}

/// Confirm Epic `epic_id`'s exit test, as the developer: the Epic moves to Done (refused until every
/// Story is Merged or Dropped) and a short roadmap Round on its Milestone opens, or the trigger is
/// noted on the open one.
pub fn confirm_epic_done(conn: &mut Connection, actor_id: &str, epic_id: &str) -> anyhow::Result<DoneTrigger> {
    let tx = conn.transaction()?;
    let (project_id, key): (String, String) = tx
        .query_row("SELECT project_id, key FROM epics WHERE id = ?1", params![epic_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .with_context(|| format!("Epic {epic_id:?} not found"))?;
    set_epic_state_in_tx(&tx, actor_id, epic_id, EpicState::Done, json!({ "label": format!("Confirmed Epic {key}'s exit test: Done") }))?;
    let outcome = trigger_in_tx(&tx, &project_id, RoadmapTrigger::EpicDone(epic_id.to_string()), actor_id)?;
    tx.commit().context("failed to commit confirm_epic_done")?;
    Ok(outcome)
}

/// Confirm Milestone `milestone_id`'s exit test, as the developer: refused until every Epic in it is
/// Done (a Dropped one aside, and at least one Done). The Milestone moves to Done and a Roadmap Round
/// opens, or the trigger is noted on the open one.
pub fn confirm_milestone_done(conn: &mut Connection, actor_id: &str, milestone_id: &str) -> anyhow::Result<DoneTrigger> {
    let tx = conn.transaction()?;
    let (project_id, title): (String, String) = tx
        .query_row("SELECT project_id, title FROM milestones WHERE id = ?1", params![milestone_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .with_context(|| format!("Milestone {milestone_id:?} not found"))?;
    let (done, open): (i64, i64) = tx.query_row(
        "SELECT COUNT(*) FILTER (WHERE state = 'done'), COUNT(*) FILTER (WHERE state NOT IN ('done', 'dropped'))
         FROM epics WHERE milestone_id = ?1",
        params![milestone_id],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    anyhow::ensure!(
        done > 0 && open == 0,
        "the exit test is confirmed once every Epic is Done ({done} of {} Done)",
        done + open
    );
    set_milestone_state_in_tx(
        &tx,
        actor_id,
        milestone_id,
        MilestoneState::Done,
        json!({ "label": format!("Confirmed Milestone \"{title}\"'s exit test: Done") }),
    )?;
    let outcome = trigger_in_tx(&tx, &project_id, RoadmapTrigger::MilestoneDone(milestone_id.to_string()), actor_id)?;
    tx.commit().context("failed to commit confirm_milestone_done")?;
    Ok(outcome)
}

/// Open the roadmap Round `trigger` asks for, or note it on the project's open one.
fn trigger_in_tx(tx: &rusqlite::Transaction, project_id: &str, trigger: RoadmapTrigger, actor_id: &str) -> anyhow::Result<DoneTrigger> {
    if let Some(open) = open_roadmap_round(tx, project_id)? {
        note_trigger_in_tx(tx, &open, &trigger, actor_id, &now())?;
        return Ok(DoneTrigger::Noted(open));
    }
    let id = ensure_open_roadmap_round_in_tx(tx, project_id, trigger, None, actor_id)?;
    Ok(DoneTrigger::Opened(get_roadmap_round(tx, &id)?.context("the roadmap Round just opened")?))
}
