//! Milestones and the Roadmap (docs/mvp-spec.md §2).
//!
//! A Milestone is an outcome with an exit test and no date. A project's Roadmap is its Milestones
//! in `rank` order; the Current Milestone is the first of them that is neither done nor dropped,
//! derived on every read and never stored. A new project starts with an empty Roadmap.
//!
//! [`set_milestone_state`] is the one writer of `milestones.state`, and only the developer moves a
//! Milestone: closing shaping, confirming the exit test, dropping it. Ready versus In progress is
//! derived from its Epics ([`milestone_state`]), exactly as an Epic's is derived from its Stories.
//! [`move_milestone`] is the one writer of an existing Milestone's `rank`, and it too is the
//! developer's alone: reordering the Roadmap is how the Current Milestone changes.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;
use crate::ranking::{rank_after, rank_before, rank_between};

/// Where a Milestone is in its life. `InProgress` is derived (shaping closed and some Epic past
/// Ready); the other four are stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MilestoneState {
    Shaping,
    Ready,
    InProgress,
    Done,
    Dropped,
}

impl MilestoneState {
    pub fn as_str(self) -> &'static str {
        match self {
            MilestoneState::Shaping => "shaping",
            MilestoneState::Ready => "ready",
            MilestoneState::InProgress => "in_progress",
            MilestoneState::Done => "done",
            MilestoneState::Dropped => "dropped",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "shaping" => MilestoneState::Shaping,
            "ready" => MilestoneState::Ready,
            "in_progress" => MilestoneState::InProgress,
            "done" => MilestoneState::Done,
            "dropped" => MilestoneState::Dropped,
            other => anyhow::bail!("{other:?} is not a Milestone state"),
        })
    }
}

/// A `milestones` row. `state` is the stored value (`shaping`, `ready`, `done`, `dropped`).
#[derive(Debug, Clone, PartialEq)]
pub struct Milestone {
    pub id: String,
    pub project_id: String,
    pub title: String,
    pub exit_test: Option<String>,
    pub state: String,
    pub rank: String,
}

/// `SELECT <every column> FROM milestones <tail>`, as one compile-time literal.
macro_rules! select_milestones {
    ($tail:literal) => {
        concat!("SELECT id, project_id, title, exit_test, state, rank FROM milestones ", $tail)
    };
}

fn row_to_milestone(row: &Row) -> rusqlite::Result<Milestone> {
    Ok(Milestone {
        id: row.get(0)?,
        project_id: row.get(1)?,
        title: row.get(2)?,
        exit_test: row.get(3)?,
        state: row.get(4)?,
        rank: row.get(5)?,
    })
}

/// Add a Milestone at the end of the project's Roadmap, in Shaping.
pub fn create_milestone(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    exit_test: Option<&str>,
) -> anyhow::Result<Milestone> {
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "a Milestone needs a title");
    let now = now();
    let id = new_id();
    let tx = conn.transaction()?;

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM milestones WHERE project_id = ?1 ORDER BY rank DESC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the Roadmap's tail rank")?;
    let rank = rank_after(last_rank.as_deref())?;

    tx.execute(
        "INSERT INTO milestones (id, project_id, title, exit_test, state, rank, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, 'shaping', ?5, ?6, ?7, ?7)",
        params![id, project_id, title, exit_test, rank, actor_id, now],
    )
    .context("failed to insert the Milestone")?;

    record_event(
        &tx,
        project_id,
        "milestone",
        &id,
        EventScope::default(),
        actor_id,
        "milestone.created",
        &serde_json::json!({ "title": title, "label": format!("Added Milestone \"{title}\"") }),
        &now,
    )?;
    tx.commit().context("failed to commit create_milestone")?;

    Ok(Milestone {
        id,
        project_id: project_id.to_string(),
        title: title.to_string(),
        exit_test: exit_test.map(str::to_string),
        state: "shaping".to_string(),
        rank,
    })
}

/// One Milestone by id.
pub fn get_milestone(conn: &Connection, milestone_id: &str) -> anyhow::Result<Option<Milestone>> {
    conn.query_row(
        select_milestones!("WHERE id = ?1"),
        params![milestone_id],
        row_to_milestone,
    )
    .optional()
    .context("failed to read the Milestone")
}

/// The project's Roadmap: every Milestone in rank order.
pub fn roadmap(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<Milestone>> {
    let mut stmt =
        conn.prepare(select_milestones!("WHERE project_id = ?1 ORDER BY rank, id"))?;
    let rows = stmt.query_map(params![project_id], row_to_milestone)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Roadmap")
}

/// The Current Milestone: the first in Roadmap order that is neither done nor dropped.
pub fn current_milestone(conn: &Connection, project_id: &str) -> anyhow::Result<Option<Milestone>> {
    conn.query_row(
        select_milestones!("WHERE project_id = ?1 AND state NOT IN ('done', 'dropped') ORDER BY rank, id LIMIT 1"),
        params![project_id],
        row_to_milestone,
    )
    .optional()
    .context("failed to read the Current Milestone")
}

/// A Milestone's state with In progress derived: a stored `ready` Milestone with any Epic past
/// Ready (in progress or done) reads as In progress.
pub fn milestone_state(conn: &Connection, milestone_id: &str) -> anyhow::Result<MilestoneState> {
    let stored: String = conn
        .query_row("SELECT state FROM milestones WHERE id = ?1", params![milestone_id], |r| r.get(0))
        .with_context(|| format!("Milestone {milestone_id:?} not found"))?;
    let state = MilestoneState::parse(&stored)?;
    if state != MilestoneState::Ready {
        return Ok(state);
    }
    let started: bool = conn
        .query_row(
            "SELECT EXISTS (
                SELECT 1 FROM epics e WHERE e.milestone_id = ?1 AND (
                    e.state = 'done' OR EXISTS (
                        SELECT 1 FROM stories s WHERE s.epic_id = e.id
                        AND s.state IN ('running', 'in_review', 'merged'))))",
            params![milestone_id],
            |r| r.get(0),
        )
        .context("failed to derive the Milestone's progress")?;
    Ok(if started { MilestoneState::InProgress } else { MilestoneState::Ready })
}

/// The developer moves a Milestone: `Ready` closes its shaping, `Done` confirms its exit test,
/// `Dropped` retires it, `Shaping` reopens shaping. The only writer of `milestones.state`.
///
/// Refused: any actor but a human; a Done Milestone (it is frozen, so later changes go into a new
/// Milestone); dropping a Milestone that still holds an open (not done) Epic; and the derived
/// `InProgress`, which nobody sets.
pub fn set_milestone_state(
    conn: &mut Connection,
    actor_id: &str,
    milestone_id: &str,
    to: MilestoneState,
) -> anyhow::Result<()> {
    let now = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;

    let (project_id, current): (String, String) = tx
        .query_row(
            "SELECT project_id, state FROM milestones WHERE id = ?1",
            params![milestone_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .with_context(|| format!("Milestone {milestone_id:?} not found"))?;

    anyhow::ensure!(to != MilestoneState::InProgress, "In progress is derived from the Milestone's Epics");
    anyhow::ensure!(current != "done", "a Done Milestone is frozen; put later changes in a new Milestone");
    anyhow::ensure!(current != "dropped", "a Dropped Milestone stays dropped");
    if to == MilestoneState::Dropped {
        let open_epics: i64 = tx.query_row(
            "SELECT COUNT(*) FROM epics WHERE milestone_id = ?1 AND state != 'done'",
            params![milestone_id],
            |r| r.get(0),
        )?;
        anyhow::ensure!(open_epics == 0, "a Milestone holding {open_epics} open Epic(s) cannot be dropped");
    }

    tx.execute(
        "UPDATE milestones SET state = ?1, updated_at = ?2 WHERE id = ?3",
        params![to.as_str(), now, milestone_id],
    )
    .context("failed to write the Milestone state")?;
    record_event(
        &tx,
        &project_id,
        "milestone",
        milestone_id,
        EventScope::default(),
        actor_id,
        "milestone.state_changed",
        &serde_json::json!({
            "field": "state", "before": current, "after": to.as_str(),
            "label": format!("Moved Milestone from {current} to {}", to.as_str()),
        }),
        &now,
    )?;
    tx.commit().context("failed to commit set_milestone_state")?;
    Ok(())
}

/// The developer moves a Milestone on the Roadmap: just before `before_id`, or to the end when that is
/// `None`. One rank is rewritten; the Current Milestone, derived on every read, follows the new order.
///
/// Refused: any actor but a human (an agent changes the Roadmap through a Proposal); a Done or Dropped
/// Milestone, which keeps the place it closed in; and an anchor that is the Milestone itself or is not
/// on the same Roadmap. An open Milestone may be placed before a Done or Dropped one.
pub fn move_milestone(
    conn: &mut Connection,
    actor_id: &str,
    milestone_id: &str,
    before_id: Option<&str>,
) -> anyhow::Result<()> {
    anyhow::ensure!(before_id != Some(milestone_id), "a Milestone cannot move before itself");
    let now = now();
    let tx = conn.transaction()?;
    assert_human_actor_in_tx(&tx, actor_id)?;

    let (project_id, title, state, before_rank): (String, String, String, String) = tx
        .query_row(
            "SELECT project_id, title, state, rank FROM milestones WHERE id = ?1",
            params![milestone_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()
        .context("failed to read the Milestone")?
        .ok_or_else(|| anyhow::anyhow!("Milestone {milestone_id:?} not found"))?;
    anyhow::ensure!(state != "done", "a Done Milestone is frozen and keeps its place on the Roadmap");
    anyhow::ensure!(state != "dropped", "a Dropped Milestone keeps its place on the Roadmap");

    // The Roadmap's other Milestones, in order: the moved one is placed among them.
    let others: Vec<(String, String)> = {
        let mut stmt =
            tx.prepare("SELECT id, rank FROM milestones WHERE project_id = ?1 AND id != ?2 ORDER BY rank, id")?;
        let rows = stmt.query_map(params![project_id, milestone_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
        rows.collect::<Result<_, _>>()?
    };
    let rank = match before_id {
        None => rank_after(others.last().map(|(_, r)| r.as_str()))?,
        Some(anchor) => {
            let at = others
                .iter()
                .position(|(id, _)| id == anchor)
                .ok_or_else(|| anyhow::anyhow!("Milestone {anchor:?} is not on this Roadmap"))?;
            match at.checked_sub(1) {
                None => rank_before(Some(&others[at].1))?,
                Some(prev) => rank_between(&others[prev].1, &others[at].1)?,
            }
        }
    };

    tx.execute("UPDATE milestones SET rank = ?1, updated_at = ?2 WHERE id = ?3", params![rank, now, milestone_id])
        .context("failed to write the Milestone rank")?;
    record_event(
        &tx,
        &project_id,
        "milestone",
        milestone_id,
        EventScope::default(),
        actor_id,
        "milestone.moved",
        &serde_json::json!({
            "field": "rank", "before": before_rank, "after": rank,
            "label": format!("Moved Milestone \"{title}\" on the Roadmap"),
        }),
        &now,
    )?;
    tx.commit().context("failed to commit move_milestone")?;
    Ok(())
}
