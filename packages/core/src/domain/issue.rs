//! Issue mutations (D-07): `create_issue`, `update_issue`, `delete_issue`.
//!
//! Issues are proposals and notes, not units of work — they carry no `status` column and no
//! acceptance criteria. Giving them a workflow status or a criteria contract would blur the
//! triage lane Phase 6's `proposed/triaged/accepted/rejected/merged_into_task` lifecycle depends
//! on. This module contains no `status` identifier and no reference to `WORKFLOW_STATES` — a
//! grep gate in `hierarchy_workflow.rs` asserts exactly that.

use anyhow::Context;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::domain::event::{append_event, next_sequence};
use crate::ids::new_id;
use crate::ranking::rank_after;

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

    let (project_id, epic_id, task_id, current_title, current_body, kind): (
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        String,
    ) = tx
        .query_row(
            "SELECT project_id, epic_id, task_id, title, body, kind FROM issues WHERE id = ?1",
            params![issue_id],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
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
        key: String::new(),
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
