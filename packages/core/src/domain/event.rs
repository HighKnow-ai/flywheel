//! The single append point for every mutation event (DATA-01, D-04, D-17, D-19).
//!
//! Both [`next_sequence`] and [`append_event`] take a `&rusqlite::Transaction`, never a
//! `&Connection` — `01-RESEARCH.md`'s "Anti-Patterns to Avoid" names nesting `conn.transaction()`
//! inside another transaction's scope as the failure mode to avoid; taking a `&Transaction` by
//! reference makes it unrepresentable, because every domain mutation opens exactly one outer
//! transaction and calls these functions inside it, never from a nested one.

use anyhow::Context;
use rusqlite::{params, Transaction};

use crate::ids::new_id;

/// Allocate the next `sequence` value for `(project_id, origin)` inside the caller's transaction.
///
/// `sequence` is keyed per `(project_id, origin)` — never a single per-project counter (D-17,
/// 01-RESEARCH.md Pitfall 2) — because a single counter breaks the instant a second origin (a
/// teammate's machine, a relay-originated replay) exists.
pub fn next_sequence(tx: &Transaction, project_id: &str, origin: &str) -> anyhow::Result<i64> {
    let sequence: i64 = tx
        .query_row(
            "INSERT INTO event_sequence_counters (project_id, origin, next_seq)
             VALUES (?1, ?2, 2)
             ON CONFLICT(project_id, origin) DO UPDATE SET next_seq = next_seq + 1
             RETURNING next_seq - 1",
            params![project_id, origin],
            |row| row.get(0),
        )
        .context("failed to allocate the next event sequence")?;
    Ok(sequence)
}

/// Append one row to the append-only `events` log inside the caller's transaction (DATA-01).
///
/// No code path updates or deletes an `events` row after its transaction commits — this is the
/// single write point every domain mutation calls, and it is the only function in this crate
/// that inserts into `events`. `task_id`/`epic_id` are denormalised here at write time (even for
/// a criterion-stream event, whose parent is a task or epic) so the activity trail is one
/// indexed query (D-19).
#[allow(clippy::too_many_arguments)]
pub fn append_event(
    tx: &Transaction,
    project_id: &str,
    origin: &str,
    sequence: i64,
    stream_type: &str,
    stream_id: &str,
    task_id: Option<&str>,
    epic_id: Option<&str>,
    actor_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
    occurred_at: &str,
) -> anyhow::Result<String> {
    let event_id = new_id();
    tx.execute(
        "INSERT INTO events (
            id, project_id, origin, sequence, stream_type, stream_id,
            task_id, epic_id, actor_id, event_type, payload, occurred_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            event_id,
            project_id,
            origin,
            sequence,
            stream_type,
            stream_id,
            task_id,
            epic_id,
            actor_id,
            event_type,
            payload.to_string(),
            occurred_at,
        ],
    )
    .context("failed to append event")?;
    Ok(event_id)
}
