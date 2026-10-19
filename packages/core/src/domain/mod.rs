//! Domain mutation and read functions — the only code in this workspace that executes a
//! mutating SQL statement (ARCHITECTURE.md §3, D-03). The renderer and the sidecar reach the
//! database only through the Rust command surface in `packages/desktop`, which calls straight
//! through to these functions — never by opening the SQLite file itself.
//!
//! The record domain follows `GLOSSARY.md` exactly (ADR 0003): a project's Roadmap is its
//! [`milestone`]s in rank order; each [`epic`] sits in one Milestone; each [`story`] sits in one
//! Epic and carries its [`acceptance_criterion`]s (each with an optional [`check`]) and its
//! [`task`] checklist. Agents write to the board only through [`proposal`]s. ADRs live in the
//! managed repo and the board keeps an [`adr_link`] to them. A Story's agent sessions are
//! [`session`]s (the `sessions` table), each leaving a [`session_summary`].

use anyhow::Context;
use rusqlite::{params, Transaction};

use crate::domain::event::{append_event, next_sequence};

pub mod acceptance_criterion;
pub mod actor;
pub mod adr_link;
pub mod session;
pub mod check;
pub mod epic;
pub mod event;
pub mod milestone;
pub mod permission_request;
pub mod permission_rule;
pub mod project;
pub mod proposal;
pub mod session_summary;
pub mod settings;
pub mod story;
pub mod task;
pub mod worktree;

/// Where an event belongs, so a record's timeline is one indexed read: the Story and Epic it
/// concerns, denormalised onto the row at write time.
#[derive(Debug, Clone, Copy, Default)]
pub(crate) struct EventScope<'a> {
    pub story_id: Option<&'a str>,
    pub epic_id: Option<&'a str>,
}

/// Append one local event inside the caller's transaction: the sequence allocation and the row,
/// in the shape every record writer in this module uses.
#[allow(clippy::too_many_arguments)]
pub(crate) fn record_event(
    tx: &Transaction,
    project_id: &str,
    stream_type: &str,
    stream_id: &str,
    scope: EventScope,
    actor_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
    now: &str,
) -> anyhow::Result<String> {
    let sequence = next_sequence(tx, project_id, "local")?;
    append_event(
        tx,
        project_id,
        "local",
        sequence,
        stream_type,
        stream_id,
        scope.story_id,
        scope.epic_id,
        actor_id,
        event_type,
        payload,
        now,
    )
}

/// Allocate the project's next human-readable key (`FLY-12`) inside the caller's transaction, so
/// the key and the row that carries it commit together: no gaps, no races. Epics and Stories share
/// the one counter.
pub(crate) fn allocate_key(tx: &Transaction, project_id: &str) -> anyhow::Result<String> {
    tx.query_row(
        "UPDATE projects SET key_counter = key_counter + 1
         WHERE id = ?1
         RETURNING key_prefix || '-' || key_counter",
        params![project_id],
        |row| row.get(0),
    )
    .with_context(|| format!("failed to allocate the next key for project {project_id:?}"))
}

/// The current time as the RFC 3339 text every timestamp column holds.
pub(crate) fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}
