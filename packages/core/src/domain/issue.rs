//! Issue mutations (D-07): `create_issue`, `update_issue`, `delete_issue`.
//!
//! Issues are proposals and notes, not units of work — they carry no `status` column and no
//! acceptance criteria. Giving them a workflow status or a criteria contract would blur the
//! triage lane Phase 6's `proposed/triaged/accepted/rejected/merged_into_task` lifecycle depends
//! on. This module contains no `status` identifier and no reference to `WORKFLOW_STATES` — a
//! grep gate in `hierarchy_workflow.rs` asserts exactly that.

use anyhow::{anyhow, Context};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::event::{append_event, next_sequence};
use crate::domain::{assert_parent_in_project, ParentTable};
use crate::ids::new_id;
use crate::ranking::{rank_after, rank_before, rank_between, ReorderDirection};

/// An issue row, as read back immediately after a mutation commits.
#[derive(Debug, Clone, PartialEq)]
pub struct Issue {
    pub id: String,
    pub project_id: String,
    pub epic_id: Option<String>,
    pub task_id: Option<String>,
    pub key: String,
    pub title: String,
    pub body: Option<String>,
    pub kind: String,
}

/// Create an issue. Takes no status parameter and writes no status column (D-07). `kind` must be
/// one of `bug`/`idea`/`question`/`risk` — enforced by the schema CHECK constraint, not by an
/// application-layer match arm.
pub fn create_issue(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
    body: Option<&str>,
    kind: &str,
    epic_id: Option<&str>,
    task_id: Option<&str>,
) -> anyhow::Result<Issue> {
    let id = new_id();
    let now = Utc::now().to_rfc3339();

    let tx = conn.transaction()?;

    if let Some(epic_id) = epic_id {
        assert_parent_in_project(&tx, project_id, ParentTable::Epics, epic_id)?;
    }
    if let Some(task_id) = task_id {
        assert_parent_in_project(&tx, project_id, ParentTable::Tasks, task_id)?;
    }

    let last_rank: Option<String> = tx
        .query_row(
            "SELECT rank FROM issues WHERE project_id = ?1 ORDER BY rank DESC LIMIT 1",
            params![project_id],
            |row| row.get(0),
        )
        .optional()
        .context("failed to read the issues tail rank")?;
    let rank = rank_after(last_rank.as_deref())?;

    let key: String = tx
        .query_row(
            "UPDATE projects SET key_counter = key_counter + 1
             WHERE id = ?1
             RETURNING key_prefix || '-' || key_counter",
            params![project_id],
            |row| row.get(0),
        )
        .context("failed to allocate the next project key")?;

    tx.execute(
        "INSERT INTO issues (
            id, project_id, epic_id, task_id, key, title, body, kind, rank,
            created_by, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)",
        params![id, project_id, epic_id, task_id, key, title, body, kind, rank, actor_id, now],
    )
    .context("failed to insert issue")?;

    let sequence = next_sequence(&tx, project_id, "local")?;
    let payload = serde_json::json!({
        "field": "title",
        "before": null,
        "after": title,
        "title": title,
        "label": format!("Created issue \"{title}\""),
    });
    append_event(
        &tx,
        project_id,
        "local",
        sequence,
        "issue",
        &id,
        task_id,
        epic_id,
        actor_id,
        "issue.created",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit create_issue transaction")?;

    Ok(Issue {
        id,
        project_id: project_id.to_string(),
        epic_id: epic_id.map(|s| s.to_string()),
        task_id: task_id.map(|s| s.to_string()),
        key,
        title: title.to_string(),
        body: body.map(|s| s.to_string()),
        kind: kind.to_string(),
    })
}

/// Patch an issue's `title`/`body` — `None` leaves the field unchanged.
pub fn update_issue(
    conn: &mut Connection,
    actor_id: &str,
    issue_id: &str,
    title: Option<&str>,
    body: Option<&str>,
) -> anyhow::Result<Issue> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, task_id, key, current_title, current_body, kind): (
        String,
        Option<String>,
        Option<String>,
        String,
        String,
        Option<String>,
        String,
    ) = tx
        .query_row(
            "SELECT project_id, epic_id, task_id, key, title, body, kind FROM issues WHERE id = ?1",
            params![issue_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                    row.get(6)?,
                ))
            },
        )
        .with_context(|| format!("issue {issue_id:?} not found"))?;

    let new_title = title.unwrap_or(&current_title);
    let new_body = body.or(current_body.as_deref());

    tx.execute(
        "UPDATE issues SET title = ?1, body = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_title, new_body, now, issue_id],
    )
    .context("failed to update issue")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "title",
        "before": current_title,
        "after": new_title,
        "label": format!("Edited title to \"{new_title}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "issue",
        issue_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "issue.updated",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit update_issue transaction")?;

    Ok(Issue {
        id: issue_id.to_string(),
        project_id,
        epic_id,
        task_id,
        key,
        title: new_title.to_string(),
        body: new_body.map(|s| s.to_string()),
        kind,
    })
}

/// Delete an issue. Idempotent: deleting an id that no longer exists returns `Ok` and appends no
/// second event.
pub fn delete_issue(conn: &mut Connection, actor_id: &str, issue_id: &str) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let existing: Option<(String, Option<String>, Option<String>, String)> = tx
        .query_row(
            "SELECT project_id, epic_id, task_id, title FROM issues WHERE id = ?1",
            params![issue_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .context("failed to read issue before delete")?;

    let Some((project_id, epic_id, task_id, title)) = existing else {
        tx.commit().context("failed to commit no-op delete_issue transaction")?;
        return Ok(());
    };

    tx.execute("DELETE FROM issues WHERE id = ?1", params![issue_id])
        .context("failed to delete issue")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "existence",
        "before": "present",
        "after": "deleted",
        "title": title,
        "label": format!("Deleted issue \"{title}\""),
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "issue",
        issue_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "issue.deleted",
        &payload,
        &now,
    )?;

    tx.commit().context("failed to commit delete_issue transaction")?;
    Ok(())
}

/// Move an issue up or down by one position within the project's issues lane (D-07, D-11,
/// BOARD-05). Issues carry `rank` but no `status` or `priority` column (D-07: they are
/// proposals/notes, not units of work — this module contains no priority/estimate/assignee
/// setter, matching `create_issue`'s own contract), so the neighbour lookup is scoped by
/// `project_id` alone rather than `(project_id, status, priority)` the way
/// `task.rs::reorder_task`/`epic.rs::reorder_epic` are. One transaction: read the issue's own
/// `(project_id, rank)`, look up its one or two nearest neighbours in the move direction with a
/// single indexed query, compute the new rank, write exactly one `UPDATE`, append one
/// `issue.reordered` event, and commit. A group of zero or one item is a no-op.
pub fn reorder_issue(
    conn: &mut Connection,
    actor_id: &str,
    issue_id: &str,
    direction: ReorderDirection,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, epic_id, task_id, rank): (String, Option<String>, Option<String>, String) =
        tx.query_row(
            "SELECT project_id, epic_id, task_id, rank FROM issues WHERE id = ?1",
            params![issue_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .with_context(|| format!("issue {issue_id:?} not found"))?;

    let new_rank = match direction {
        ReorderDirection::Up => {
            let mut stmt = tx.prepare(
                "SELECT rank FROM issues
                 WHERE project_id = ?1 AND (rank, id) < (?2, ?3)
                 ORDER BY rank DESC, id DESC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, rank, issue_id], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the preceding neighbours")?;
            match neighbours.as_slice() {
                [] => None,
                [prev] => Some(rank_before(Some(prev.as_str()))?),
                [prev, prev_prev, ..] => Some(rank_between(prev_prev, prev)?),
            }
        }
        ReorderDirection::Down => {
            let mut stmt = tx.prepare(
                "SELECT rank FROM issues
                 WHERE project_id = ?1 AND (rank, id) > (?2, ?3)
                 ORDER BY rank ASC, id ASC
                 LIMIT 2",
            )?;
            let neighbours: Vec<String> = stmt
                .query_map(params![project_id, rank, issue_id], |row| row.get(0))?
                .collect::<Result<Vec<_>, _>>()
                .context("failed to read the following neighbours")?;
            match neighbours.as_slice() {
                [] => None,
                [next] => Some(rank_after(Some(next.as_str()))?),
                [next, next_next, ..] => Some(rank_between(next, next_next)?),
            }
        }
    };

    let Some(new_rank) = new_rank else {
        tx.commit()
            .context("failed to commit no-op reorder_issue transaction")?;
        return Ok(());
    };

    tx.execute(
        "UPDATE issues SET rank = ?1, updated_at = ?2 WHERE id = ?3",
        params![new_rank, now, issue_id],
    )
    .context("failed to reorder issue")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "rank",
        "before": rank,
        "after": new_rank,
        "label": "Reordered",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "issue",
        issue_id,
        task_id.as_deref(),
        epic_id.as_deref(),
        actor_id,
        "issue.reordered",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit reorder_issue transaction")?;
    Ok(())
}

/// The single-parent-at-a-time target for [`set_parent`] — an issue holds at most one parent,
/// `epic_id` or `task_id`, never both at once (T-01-GC-05, G-01-EPIC-ASSIGN).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IssueParent {
    None,
    Epic(String),
    Task(String),
}

impl IssueParent {
    /// Parse the Tauri command layer's `(parent_kind, parent_id)` argument pair, mirroring
    /// `ranking::ReorderDirection::parse`'s established shape for turning a renderer-supplied
    /// string pair into a domain value. `kind: None` maps to `IssueParent::None` regardless of
    /// `id`; `"epic"`/`"task"` require a non-`None` `id`; any other kind, or a kind supplied
    /// without an id, is rejected.
    pub fn parse(kind: Option<&str>, id: Option<&str>) -> anyhow::Result<Self> {
        match (kind, id) {
            (None, _) => Ok(Self::None),
            (Some("epic"), Some(id)) => Ok(Self::Epic(id.to_string())),
            (Some("task"), Some(id)) => Ok(Self::Task(id.to_string())),
            (Some(other), Some(_)) => Err(anyhow!(
                "unknown issue parent kind {other:?} — expected \"epic\" or \"task\""
            )),
            (Some(kind), None) => Err(anyhow!(
                "issue parent kind {kind:?} requires a parent_id"
            )),
        }
    }
}

/// Reparent an issue to an epic, to a task, or detach it entirely (G-01-EPIC-ASSIGN). Writes
/// `issues.epic_id` and `issues.task_id` together in one `UPDATE` derived from a single
/// `IssueParent` variant, so an issue holding both at once is unrepresentable, not merely
/// unwritten (T-01-GC-05). A parent id in another project is rejected by
/// [`assert_parent_in_project`]; a redundant call naming the parent the issue already has is a
/// no-op — `Ok` is returned, `updated_at` is left untouched, and no event is appended.
///
/// Appends exactly one `issue.parent_changed` event per accepted change, whose denormalised
/// `task_id`/`epic_id` columns are the NEW parent.
pub fn set_parent(
    conn: &mut Connection,
    actor_id: &str,
    issue_id: &str,
    parent: IssueParent,
) -> anyhow::Result<()> {
    let now = Utc::now().to_rfc3339();
    let tx = conn.transaction()?;

    let (project_id, current_epic_id, current_task_id): (String, Option<String>, Option<String>) =
        tx.query_row(
            "SELECT project_id, epic_id, task_id FROM issues WHERE id = ?1",
            params![issue_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .with_context(|| format!("issue {issue_id:?} not found"))?;

    let (new_epic_id, new_task_id): (Option<String>, Option<String>) = match &parent {
        IssueParent::None => (None, None),
        IssueParent::Epic(id) => (Some(id.clone()), None),
        IssueParent::Task(id) => (None, Some(id.clone())),
    };

    if current_epic_id == new_epic_id && current_task_id == new_task_id {
        tx.commit()
            .context("failed to commit no-op set_parent transaction")?;
        return Ok(());
    }

    match &parent {
        IssueParent::Epic(id) => assert_parent_in_project(&tx, &project_id, ParentTable::Epics, id)?,
        IssueParent::Task(id) => assert_parent_in_project(&tx, &project_id, ParentTable::Tasks, id)?,
        IssueParent::None => {}
    }

    tx.execute(
        "UPDATE issues SET epic_id = ?1, task_id = ?2, updated_at = ?3 WHERE id = ?4",
        params![new_epic_id, new_task_id, now, issue_id],
    )
    .context("failed to set issue parent")?;

    let sequence = next_sequence(&tx, &project_id, "local")?;
    let payload = serde_json::json!({
        "field": "parent",
        "before": { "epicId": current_epic_id, "taskId": current_task_id },
        "after": { "epicId": new_epic_id, "taskId": new_task_id },
        "label": "Changed parent",
    });
    append_event(
        &tx,
        &project_id,
        "local",
        sequence,
        "issue",
        issue_id,
        new_task_id.as_deref(),
        new_epic_id.as_deref(),
        actor_id,
        "issue.parent_changed",
        &payload,
        &now,
    )?;

    tx.commit()
        .context("failed to commit set_parent transaction")?;
    Ok(())
}
