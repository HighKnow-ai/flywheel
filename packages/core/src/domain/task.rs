//! The Task checklist (docs/mvp-spec.md §4.3): the steps a Story's agent writes as its plan at the
//! start of its first session and keeps up to date. A Task is not a board item of its own: it
//! always belongs to one Story, and shaping never produces one.
//!
//! States are open, doing, done and dropped (with a one-line reason). At most one Task of a Story
//! is doing — that is what the roster shows as "what its agent is doing now" — and the schema's
//! partial unique index holds the rule even against a writer that forgets it. Every change is
//! written immediately, so a dead session keeps its checklist.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};

use crate::domain::{now, record_event, EventScope};
use crate::ids::new_id;
use crate::ranking::rank_after;

/// Where a Task is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TaskState {
    Open,
    Doing,
    Done,
    Dropped,
}

impl TaskState {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskState::Open => "open",
            TaskState::Doing => "doing",
            TaskState::Done => "done",
            TaskState::Dropped => "dropped",
        }
    }

    pub fn parse(value: &str) -> anyhow::Result<Self> {
        Ok(match value {
            "open" => TaskState::Open,
            "doing" => TaskState::Doing,
            "done" => TaskState::Done,
            "dropped" => TaskState::Dropped,
            other => anyhow::bail!("{other:?} is not a Task state"),
        })
    }
}

/// A `tasks` row: one checklist step of a Story.
#[derive(Debug, Clone, PartialEq)]
pub struct Task {
    pub id: String,
    pub story_id: String,
    pub title: String,
    pub state: String,
    pub dropped_reason: Option<String>,
    pub rank: String,
}

fn row_to_task(row: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        story_id: row.get(1)?,
        title: row.get(2)?,
        state: row.get(3)?,
        dropped_reason: row.get(4)?,
        rank: row.get(5)?,
    })
}

/// Add a Task at the end of a Story's checklist, open.
pub fn add_task(conn: &mut Connection, actor_id: &str, story_id: &str, title: &str) -> anyhow::Result<Task> {
    let title = title.trim();
    anyhow::ensure!(!title.is_empty(), "a Task needs a title");
    let now = now();
    let id = new_id();
    let tx = conn.transaction()?;
    let (project_id, epic_id): (String, String) = tx
        .query_row("SELECT project_id, epic_id FROM stories WHERE id = ?1", params![story_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .with_context(|| format!("Story {story_id:?} not found; a Task always belongs to a Story"))?;
    let last_rank: Option<String> = tx
        .query_row("SELECT rank FROM tasks WHERE story_id = ?1 ORDER BY rank DESC LIMIT 1", params![story_id], |r| {
            r.get(0)
        })
        .optional()?;
    let rank = rank_after(last_rank.as_deref())?;
    tx.execute(
        "INSERT INTO tasks (id, story_id, title, state, rank, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'open', ?4, ?5, ?6, ?6)",
        params![id, story_id, title, rank, actor_id, now],
    )
    .context("failed to insert the Task")?;
    record_event(
        &tx,
        &project_id,
        "task",
        &id,
        EventScope { story_id: Some(story_id), epic_id: Some(&epic_id) },
        actor_id,
        "task.added",
        &serde_json::json!({ "title": title, "label": format!("Added Task \"{title}\"") }),
        &now,
    )?;
    tx.commit().context("failed to commit add_task")?;
    Ok(Task { id, story_id: story_id.to_string(), title: title.to_string(), state: "open".into(), dropped_reason: None, rank })
}

/// A Story's checklist, in order.
pub fn tasks_for_story(conn: &Connection, story_id: &str) -> anyhow::Result<Vec<Task>> {
    let mut stmt = conn.prepare(
        "SELECT id, story_id, title, state, dropped_reason, rank FROM tasks WHERE story_id = ?1 ORDER BY rank, id",
    )?;
    let rows = stmt.query_map(params![story_id], row_to_task)?.collect::<Result<Vec<_>, _>>();
    rows.context("failed to read the Story's Tasks")
}

/// Move a Task to `to`. Dropping needs a one-line reason, and only dropping takes one. Making a Task
/// doing is refused while another Task of the same Story is doing.
pub fn set_task_state(
    conn: &mut Connection,
    actor_id: &str,
    task_id: &str,
    to: TaskState,
    dropped_reason: Option<&str>,
) -> anyhow::Result<()> {
    let reason = dropped_reason.map(str::trim).filter(|r| !r.is_empty());
    match to {
        TaskState::Dropped => anyhow::ensure!(reason.is_some(), "a dropped Task needs a one-line reason"),
        _ => anyhow::ensure!(reason.is_none(), "only a dropped Task carries a reason"),
    }
    let now = now();
    let tx = conn.transaction()?;
    let (story_id, current, project_id, epic_id): (String, String, String, String) = tx
        .query_row(
            "SELECT t.story_id, t.state, s.project_id, s.epic_id FROM tasks t JOIN stories s ON s.id = t.story_id WHERE t.id = ?1",
            params![task_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .with_context(|| format!("Task {task_id:?} not found"))?;
    if to == TaskState::Doing {
        let other_doing: bool = tx.query_row(
            "SELECT EXISTS (SELECT 1 FROM tasks WHERE story_id = ?1 AND state = 'doing' AND id != ?2)",
            params![story_id, task_id],
            |r| r.get(0),
        )?;
        anyhow::ensure!(!other_doing, "another Task of this Story is already doing; at most one is");
    }
    tx.execute(
        "UPDATE tasks SET state = ?1, dropped_reason = ?2, updated_at = ?3 WHERE id = ?4",
        params![to.as_str(), reason, now, task_id],
    )
    .context("failed to write the Task state")?;
    record_event(
        &tx,
        &project_id,
        "task",
        task_id,
        EventScope { story_id: Some(&story_id), epic_id: Some(&epic_id) },
        actor_id,
        "task.state_changed",
        &serde_json::json!({
            "field": "state", "before": current, "after": to.as_str(), "reason": reason,
            "label": format!("Moved Task from {current} to {}", to.as_str()),
        }),
        &now,
    )?;
    tx.commit().context("failed to commit set_task_state")?;
    Ok(())
}
