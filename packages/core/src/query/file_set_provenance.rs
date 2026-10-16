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

use rusqlite::Connection;

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

/// RED skeleton: the read is not written yet, so every task reads as undeclared-by-nobody.
pub fn file_set_provenance(_conn: &Connection, _task_id: &str) -> anyhow::Result<Option<FileSetProvenance>> {
    Ok(None)
}
