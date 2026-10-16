//! Who declared a task's file-set, derived from the event log and stored nowhere (D-19).
//!
//! The `task.file_set_declared` event (and `task.file_set_widened`, the same field's later
//! history) already carries `{field, before, after, label}` and the actor that wrote it. Joining
//! that actor to `actors.type` answers "did an agent draft this?" with no extra column, so the chip
//! on screen and the version history read the one source and cannot disagree (A-07's precedent: one
//! definition in code rather than a column for a derivable value).
//!
//! `agent_drafted` is decided HERE, once. The renderer receives a boolean it cannot compute, so a
//! human edit cannot inherit an agent's label (T-15-21). A declaration whose payload `after` is
//! null is plan 15-02's `undeclared` marker (D-21): it yields `undeclared: true` with no entries,
//! which is not the same answer as a declaration of an empty list.

use anyhow::Context;
use rusqlite::{params, Connection};

use crate::domain::file_set::{EVENT_FILE_SET_DECLARED, EVENT_FILE_SET_WIDENED};

/// The most older declarations one read returns, declared once. A task's set is rewritten a handful
/// of times in a plan's life; a task edited past this is told so by `history_truncated`.
pub const FILE_SET_HISTORY_LIMIT: usize = 20;

/// One change to a task's declared set, as the log recorded it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSetDeclaration {
    pub actor_id: String,
    /// `actors.type`: `human`, `agent` or `system`.
    pub actor_kind: String,
    pub actor_name: String,
    /// True exactly when the declaring actor is an agent. Derived, never stored.
    pub agent_drafted: bool,
    pub declared_at: String,
    pub event_type: String,
    pub before: Vec<String>,
    /// The entries as declared; empty for an undeclared marker and for a cleared set alike.
    pub entries: Vec<String>,
    /// The planner could not determine the set (payload `after` is null).
    pub undeclared: bool,
}

/// The latest declaration of a task's set plus the older ones, newest first.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileSetProvenance {
    pub latest: FileSetDeclaration,
    pub history: Vec<FileSetDeclaration>,
    /// More older declarations exist than `history` holds.
    pub history_truncated: bool,
}

const DECLARATIONS_SQL: &str = "SELECT a.id, a.type, a.display_name, e.occurred_at, e.event_type, e.payload \
    FROM events e JOIN actors a ON a.id = e.actor_id \
    WHERE e.task_id = ?1 AND e.event_type IN (?2, ?3) \
    ORDER BY e.id DESC LIMIT ?4";

fn strings(value: &serde_json::Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect())
        .unwrap_or_default()
}

/// `None` when the task has no declaration event at all: nobody declared it, so nobody is credited.
pub fn file_set_provenance(conn: &Connection, task_id: &str) -> anyhow::Result<Option<FileSetProvenance>> {
    let mut stmt = conn.prepare(DECLARATIONS_SQL).context("failed to prepare the file-set provenance read")?;
    // One for the latest, the limit for the history, one more to learn whether the history was cut.
    let bound = (FILE_SET_HISTORY_LIMIT + 2) as i64;
    let rows = stmt
        .query_map(params![task_id, EVENT_FILE_SET_DECLARED, EVENT_FILE_SET_WIDENED, bound], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .context("failed to read the file-set declarations")?;
    let mut declarations = Vec::new();
    for row in rows {
        let (actor_id, actor_kind, actor_name, declared_at, event_type, payload) =
            row.context("failed to read a file-set declaration row")?;
        let payload: serde_json::Value = serde_json::from_str(&payload).unwrap_or(serde_json::Value::Null);
        declarations.push(FileSetDeclaration {
            agent_drafted: actor_kind == "agent",
            actor_id,
            actor_kind,
            actor_name,
            declared_at,
            event_type,
            before: strings(&payload["before"]),
            entries: strings(&payload["after"]),
            undeclared: payload["after"].is_null(),
        });
    }
    let mut declarations = declarations.into_iter();
    let Some(latest) = declarations.next() else { return Ok(None) };
    let mut history: Vec<FileSetDeclaration> = declarations.collect();
    let history_truncated = history.len() > FILE_SET_HISTORY_LIMIT;
    history.truncate(FILE_SET_HISTORY_LIMIT);
    Ok(Some(FileSetProvenance { latest, history, history_truncated }))
}
