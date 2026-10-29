//! ADR links (docs/mvp-spec.md §6, ADR 0002). An ADR is kept with the managed project's code, under
//! `docs/adr/`, and the board only links to it by path, from exactly one Milestone, Epic or Story.
//! The schema's CHECK makes "linked from none" or "from two" unrepresentable; an ADR with no link
//! at all is simply an unlinked file in the repo.

use anyhow::Context;
use rusqlite::{params, Connection, Row, Transaction};

use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;

/// The one record an ADR link hangs from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AdrLinkTarget {
    Milestone(String),
    Epic(String),
    Story(String),
}

/// An `adr_links` row.
#[derive(Debug, Clone, PartialEq)]
pub struct AdrLink {
    pub id: String,
    pub project_id: String,
    pub path: String,
    pub target: AdrLinkTarget,
}

fn row_to_link(row: &Row) -> rusqlite::Result<AdrLink> {
    let (milestone, epic, story): (Option<String>, Option<String>, Option<String>) = (row.get(3)?, row.get(4)?, row.get(5)?);
    let target = match (milestone, epic, story) {
        (Some(id), _, _) => AdrLinkTarget::Milestone(id),
        (_, Some(id), _) => AdrLinkTarget::Epic(id),
        (_, _, Some(id)) => AdrLinkTarget::Story(id),
        (None, None, None) => unreachable!("adr_links' CHECK requires exactly one target"),
    };
    Ok(AdrLink { id: row.get(0)?, project_id: row.get(1)?, path: row.get(2)?, target })
}

/// Link the ADR at repo-relative `path` to one record of `project_id`. The record must belong to
/// the project.
pub fn link_adr(
    conn: &mut Connection,
    actor_id: &str,
    project_id: &str,
    path: &str,
    target: &AdrLinkTarget,
) -> anyhow::Result<AdrLink> {
    let tx = conn.transaction()?;
    let link = link_adr_in_tx(&tx, actor_id, project_id, path, target, &now())?;
    tx.commit()?;
    Ok(link)
}

/// [`link_adr`] inside the caller's transaction, at `now` (Merge links each new ADR in its own
/// board transaction, issue #161).
pub(crate) fn link_adr_in_tx(
    tx: &Transaction,
    actor_id: &str,
    project_id: &str,
    path: &str,
    target: &AdrLinkTarget,
    now: &str,
) -> anyhow::Result<AdrLink> {
    let path = path.trim();
    anyhow::ensure!(!path.is_empty() && !path.starts_with('/'), "an ADR link names a repo-relative path");
    let id = new_id();
    let (milestone_id, epic_id, story_id, owner_project): (Option<&str>, Option<&str>, Option<&str>, String) = match target {
        AdrLinkTarget::Milestone(m) => {
            (Some(m), None, None, tx.query_row("SELECT project_id FROM milestones WHERE id = ?1", params![m], |r| r.get(0))?)
        }
        AdrLinkTarget::Epic(e) => {
            (None, Some(e), None, tx.query_row("SELECT project_id FROM epics WHERE id = ?1", params![e], |r| r.get(0))?)
        }
        AdrLinkTarget::Story(s) => {
            (None, None, Some(s), tx.query_row("SELECT project_id FROM stories WHERE id = ?1", params![s], |r| r.get(0))?)
        }
    };
    anyhow::ensure!(owner_project == project_id, "an ADR links to a record of its own project");
    tx.execute(
        "INSERT INTO adr_links (id, project_id, path, milestone_id, epic_id, story_id, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![id, project_id, path, milestone_id, epic_id, story_id, actor_id, now],
    )
    .context("failed to link the ADR")?;
    record_event(
        tx,
        project_id,
        "adr_link",
        &id,
        EventScope { story_id, epic_id },
        actor_id,
        "adr.linked",
        &serde_json::json!({ "path": path, "label": format!("Linked {path}") }),
        now,
    )?;
    Ok(AdrLink { id, project_id: project_id.to_string(), path: path.to_string(), target: target.clone() })
}

/// Every ADR link of a project, by path.
pub fn adr_links_for_project(conn: &Connection, project_id: &str) -> anyhow::Result<Vec<AdrLink>> {
    let mut stmt = conn.prepare(
        "SELECT id, project_id, path, milestone_id, epic_id, story_id FROM adr_links WHERE project_id = ?1 ORDER BY path, id",
    )?;
    let rows = stmt.query_map(params![project_id], row_to_link)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the ADR links")
}

/// Whether any record of `project_id` links the ADR at `path`.
pub(crate) fn is_linked(conn: &Connection, project_id: &str, path: &str) -> anyhow::Result<bool> {
    conn.query_row(
        "SELECT EXISTS (SELECT 1 FROM adr_links WHERE project_id = ?1 AND path = ?2)",
        params![project_id, path],
        |r| r.get(0),
    )
    .context("failed to read the ADR's links")
}
