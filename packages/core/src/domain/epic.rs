//! Epics (docs/mvp-spec.md §2): a capability inside exactly one Milestone, described by a short spec
//! (problem, scope, out of scope) and an exit test. The spec lives on the board, not in the repo.
//!
//! [`set_epic_state`] is the one writer of `epics.state`, and only the developer moves an Epic:
//! closing shaping, confirming the exit test, or declining it (which reopens shaping). Ready versus
//! In progress is derived ([`epic_state`]): an Epic whose shaping is closed is In progress once any
//! Story is past Ready. All Stories merging never closes an Epic on its own.
//!
//! An Epic is Dropped only by an accepted Roadmap Proposal (issue #133, `proposal_apply`), refused
//! while it holds an open Story. A Dropped Epic stays readable and counts as closed for its
//! Milestone, as a Dropped Story does for its Epic.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row, Transaction};

use crate::domain::actor::assert_human_actor_in_tx;
use crate::domain::{allocate_key, now, record_event, EventScope};
use crate::ids::new_id;
use crate::ranking::rank_after;

/// Where an Epic is in its life. `InProgress` is derived; the other three are stored.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpicState {
    Shaping,
    Ready,
    InProgress,
    Done,
    /// Retired by an accepted Roadmap Proposal (issue #133).
    Dropped,
}

impl EpicState {
    pub fn as_str(self) -> &'static str {
        match self {
            EpicState::Shaping => "shaping",
            EpicState::Ready => "ready",
            EpicState::InProgress => "in_progress",
            EpicState::Done => "done",
            EpicState::Dropped => "dropped",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "shaping" => EpicState::Shaping,
            "ready" => EpicState::Ready,
            "in_progress" => EpicState::InProgress,
            "done" => EpicState::Done,
            "dropped" => EpicState::Dropped,
            other => anyhow::bail!("{other:?} is not an Epic state"),
        })
    }
}

/// An `epics` row. `state` is the stored value (`shaping`, `ready`, `done`, `dropped`).
#[derive(Debug, Clone, PartialEq)]
pub struct Epic {
    pub id: String,
    pub project_id: String,
    pub milestone_id: String,
    pub key: String,
    pub title: String,
    pub spec: EpicSpec,
    pub state: String,
    pub rank: String,
}

/// The Epic's spec and exit test: the four prose fields the developer and the shaping agent write.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct EpicSpec {
    pub problem: Option<String>,
    pub scope: Option<String>,
    pub out_of_scope: Option<String>,
    pub exit_test: Option<String>,
}

/// `SELECT <every column> FROM epics <tail>`, as one compile-time literal.
macro_rules! select_epics {
    ($tail:literal) => {
        concat!(
            "SELECT id, project_id, milestone_id, key, title, problem, scope, out_of_scope, exit_test, state, rank FROM epics ",
            $tail
        )
    };
}

fn row_to_epic(row: &Row) -> rusqlite::Result<Epic> {
    Ok(Epic {
        id: row.get(0)?,
        project_id: row.get(1)?,
        milestone_id: row.get(2)?,
        key: row.get(3)?,
        title: row.get(4)?,
        spec: EpicSpec {
            problem: row.get(5)?,
            scope: row.get(6)?,
            out_of_scope: row.get(7)?,
            exit_test: row.get(8)?,
        },
        state: row.get(9)?,
        rank: row.get(10)?,
    })
}

/// Create an Epic at the end of `milestone_id`, in Shaping. Its project is the Milestone's.
/// Refused when the Milestone is Done (frozen) or Dropped.
pub fn create_epic(
    conn: &mut Connection,
    actor_id: &str,
    milestone_id: &str,
    title: &str,
) -> anyhow::Result<Epic> {
    let tx = conn.transaction()?;
    let epic = create_epic_in_tx(
        &tx,
        actor_id,
        milestone_id,
        title,
        &EpicSpec::default(),
        serde_json::json!({}),
    )?;
    tx.commit().context("failed to commit create_epic")?;
    Ok(epic)
}

/// [`create_epic`] inside the caller's transaction, with its spec: what an accepted New Epic Proposal
/// writes (issue #133). `detail` is merged into the `epic.created` payload (the Proposal it applies).
pub(crate) fn create_epic_in_tx(
    tx: &Transaction,
    actor_id: &str,
    milestone_id: &str,
    title: &str,
    spec: &EpicSpec,
    mut detail: serde_json::Value,
) -> anyhow::Result<Epic> {
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "an Epic needs a title");
    let now = now();
    let id = new_id();

    let (project_id, milestone_state): (String, String) = tx
        .query_row(
            "SELECT project_id, state FROM milestones WHERE id = ?1",
            params![milestone_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .with_context(|| format!("Milestone {milestone_id:?} not found"))?;
    anyhow::ensure!(
        milestone_state != "done" && milestone_state != "dropped",
        "Milestone {milestone_id:?} is {milestone_state}; a new Epic goes into an open Milestone"
    );

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM epics WHERE milestone_id = ?1 ORDER BY rank DESC LIMIT 1",
            params![milestone_id],
            |r| r.get(0),
        )
        .optional()?;
    let rank = rank_after(last_rank.as_deref())?;
    let key = allocate_key(tx, &project_id)?;

    tx.execute(
        "INSERT INTO epics (id, project_id, milestone_id, key, title, problem, scope, out_of_scope, exit_test, state, rank,
             created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'shaping', ?10, ?11, ?12, ?12)",
        params![
            id,
            project_id,
            milestone_id,
            key,
            title,
            spec.problem,
            spec.scope,
            spec.out_of_scope,
            spec.exit_test,
            rank,
            actor_id,
            now
        ],
    )
    .context("failed to insert the Epic")?;
    detail["title"] = serde_json::json!(title);
    if detail.get("label").is_none() {
        detail["label"] = serde_json::json!(format!("Created Epic {key} \"{title}\""));
    }
    record_event(
        tx,
        &project_id,
        "epic",
        &id,
        EventScope {
            story_id: None,
            epic_id: Some(&id),
        },
        actor_id,
        "epic.created",
        &detail,
        &now,
    )?;

    Ok(Epic {
        id,
        project_id,
        milestone_id: milestone_id.to_string(),
        key,
        title: title.to_string(),
        spec: spec.clone(),
        state: "shaping".to_string(),
        rank,
    })
}

/// One Epic by id.
pub fn get_epic(conn: &Connection, epic_id: &str) -> anyhow::Result<Option<Epic>> {
    conn.query_row(
        select_epics!("WHERE id = ?1"),
        params![epic_id],
        row_to_epic,
    )
    .optional()
    .context("failed to read the Epic")
}

/// Every Epic of a Milestone, in rank order.
pub fn epics_in_milestone(conn: &Connection, milestone_id: &str) -> anyhow::Result<Vec<Epic>> {
    let mut stmt = conn.prepare(select_epics!("WHERE milestone_id = ?1 ORDER BY rank, id"))?;
    let rows = stmt
        .query_map(params![milestone_id], row_to_epic)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Milestone's Epics")
}

/// Rewrite the Epic's title, spec and exit test. A changed spec reaches every Story packet from the
/// next session. The developer's direct edit; an agent changes a spec only through a Proposal, which
/// `proposal_apply` writes through [`update_epic_in_tx`] once the developer accepts it.
pub fn update_epic(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    title: &str,
    spec: &EpicSpec,
) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    update_epic_in_tx(
        &tx,
        actor_id,
        epic_id,
        title,
        spec,
        serde_json::json!({ "label": "Edited the Epic spec" }),
    )?;
    tx.commit().context("failed to commit update_epic")?;
    Ok(())
}

/// [`update_epic`] inside the caller's transaction. `detail` is the `epic.updated` payload: its
/// `label` and whatever else the caller records (the Proposal it applies, say); the title is added.
pub(crate) fn update_epic_in_tx(
    tx: &Transaction,
    actor_id: &str,
    epic_id: &str,
    title: &str,
    spec: &EpicSpec,
    mut detail: serde_json::Value,
) -> anyhow::Result<()> {
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "an Epic needs a title");
    let now = now();
    let project_id = project_of_epic(tx, epic_id)?;
    tx.execute(
        "UPDATE epics SET title = ?1, problem = ?2, scope = ?3, out_of_scope = ?4, exit_test = ?5, updated_at = ?6
         WHERE id = ?7",
        params![title, spec.problem, spec.scope, spec.out_of_scope, spec.exit_test, now, epic_id],
    )
    .context("failed to update the Epic")?;
    detail["title"] = serde_json::json!(title);
    record_event(
        tx,
        &project_id,
        "epic",
        epic_id,
        EventScope {
            story_id: None,
            epic_id: Some(epic_id),
        },
        actor_id,
        "epic.updated",
        &detail,
        &now,
    )?;
    Ok(())
}

fn project_of_epic(tx: &Transaction, epic_id: &str) -> anyhow::Result<String> {
    tx.query_row(
        "SELECT project_id FROM epics WHERE id = ?1",
        params![epic_id],
        |r| r.get(0),
    )
    .with_context(|| format!("Epic {epic_id:?} not found"))
}

/// The Epic's state with In progress derived: a stored `ready` Epic with any Story past Ready reads
/// as In progress.
pub fn epic_state(conn: &Connection, epic_id: &str) -> anyhow::Result<EpicState> {
    let stored: String = conn
        .query_row(
            "SELECT state FROM epics WHERE id = ?1",
            params![epic_id],
            |r| r.get(0),
        )
        .with_context(|| format!("Epic {epic_id:?} not found"))?;
    let state = EpicState::parse(&stored)?;
    if state != EpicState::Ready {
        return Ok(state);
    }
    let started: bool = conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM stories WHERE epic_id = ?1 AND state IN ('running', 'in_review', 'merged'))",
        params![epic_id],
        |r| r.get(0),
    )?;
    Ok(if started {
        EpicState::InProgress
    } else {
        EpicState::Ready
    })
}

/// The developer moves an Epic. `Ready` closes shaping; `Done` confirms the exit test, allowed only
/// once every Story is Merged or Dropped (and at least one exists); `Shaping` reopens shaping (what
/// declining the exit test does); `Dropped` retires it, refused while it holds an open Story (issue
/// #133: only an accepted Roadmap Proposal drops an Epic). The one writer of `epics.state`.
pub fn set_epic_state(
    conn: &mut Connection,
    actor_id: &str,
    epic_id: &str,
    to: EpicState,
) -> anyhow::Result<()> {
    let tx = conn.transaction()?;
    set_epic_state_in_tx(&tx, actor_id, epic_id, to, serde_json::json!({}))?;
    tx.commit().context("failed to commit set_epic_state")?;
    Ok(())
}

/// [`set_epic_state`] inside the caller's transaction. Human-only. `detail` is merged into the
/// `epic.state_changed` payload (the Proposal it applies, say).
pub(crate) fn set_epic_state_in_tx(
    tx: &Transaction,
    actor_id: &str,
    epic_id: &str,
    to: EpicState,
    mut detail: serde_json::Value,
) -> anyhow::Result<()> {
    let now = now();
    assert_human_actor_in_tx(tx, actor_id)?;
    let (project_id, current, key): (String, String, String) = tx
        .query_row(
            "SELECT project_id, state, key FROM epics WHERE id = ?1",
            params![epic_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .with_context(|| format!("Epic {epic_id:?} not found"))?;

    anyhow::ensure!(
        to != EpicState::InProgress,
        "In progress is derived from the Epic's Stories"
    );
    anyhow::ensure!(current != "done", "a Done Epic stays done");
    anyhow::ensure!(current != "dropped", "a Dropped Epic stays dropped");
    if to == EpicState::Done {
        let (total, closed): (i64, i64) = tx.query_row(
            "SELECT COUNT(*), COUNT(*) FILTER (WHERE state IN ('merged', 'dropped')) FROM stories WHERE epic_id = ?1",
            params![epic_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        anyhow::ensure!(
            total > 0 && total == closed,
            "the exit test is confirmed once every Story is Merged or Dropped ({closed} of {total})"
        );
    }
    if to == EpicState::Dropped {
        let open: i64 = tx.query_row(
            "SELECT COUNT(*) FROM stories WHERE epic_id = ?1 AND state NOT IN ('merged', 'dropped')",
            params![epic_id],
            |r| r.get(0),
        )?;
        anyhow::ensure!(
            open == 0,
            "Epic {key} holds {open} open Stor{}; drop or merge {} before dropping the Epic",
            if open == 1 { "y" } else { "ies" },
            if open == 1 { "it" } else { "them" }
        );
    }

    tx.execute(
        "UPDATE epics SET state = ?1, updated_at = ?2 WHERE id = ?3",
        params![to.as_str(), now, epic_id],
    )
    .context("failed to write the Epic state")?;
    detail["field"] = serde_json::json!("state");
    detail["before"] = serde_json::json!(current);
    detail["after"] = serde_json::json!(to.as_str());
    if detail.get("label").is_none() {
        detail["label"] =
            serde_json::json!(format!("Moved Epic from {current} to {}", to.as_str()));
    }
    record_event(
        tx,
        &project_id,
        "epic",
        epic_id,
        EventScope {
            story_id: None,
            epic_id: Some(epic_id),
        },
        actor_id,
        "epic.state_changed",
        &detail,
        &now,
    )?;
    Ok(())
}
