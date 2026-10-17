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
/// that inserts into `events`. `story_id`/`epic_id` are denormalised here at write time (even for
/// a criterion-stream event, whose parent is a Story) so a record's timeline is one
/// indexed query (D-19).
#[allow(clippy::too_many_arguments)]
pub fn append_event(
    tx: &Transaction,
    project_id: &str,
    origin: &str,
    sequence: i64,
    stream_type: &str,
    stream_id: &str,
    story_id: Option<&str>,
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
            story_id, epic_id, actor_id, event_type, payload, occurred_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
        params![
            event_id,
            project_id,
            origin,
            sequence,
            stream_type,
            stream_id,
            story_id,
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

/// Build the one-line human sentence the activity trail shows for one event (BOARD-09, D-19).
///
/// Every domain mutation function in this crate already writes a `"label"` string into its
/// `payload` at the moment the event is appended (e.g. `story.rs::set_story_state`'s
/// `"label": format!("Changed status from {current_status} to {new_status}")`) — that label is
/// itself built from the payload's own `"field"`/`"before"`/`"after"` values at write time, so
/// reading it back here is what D-19 means by "event payloads must be designed for human
/// rendering from day one": this function, not a second UI-side formatter, is the one place a
/// future relay or mobile client would call to render the same sentence a desktop user sees.
///
/// Defined for every event type this phase emits, and never panics or returns an empty string
/// even for a malformed/hand-inserted payload (a test fixture, or a future migration bug): falls
/// back to a generic sentence built directly from `field`/`before`/`after` when `label` is
/// absent, and to the bare, space-separated `event_type` when neither is present.
pub fn render_description(event_type: &str, payload: &serde_json::Value) -> String {
    if let Some(label) = payload.get("label").and_then(|v| v.as_str()) {
        if !label.is_empty() {
            return label.to_string();
        }
    }

    let field = payload.get("field").and_then(|v| v.as_str());
    let before = payload.get("before");
    let after = payload.get("after");

    match (field, before, after) {
        (Some(field), Some(before), Some(after))
            if !before.is_null() || !after.is_null() =>
        {
            format!(
                "Changed {field} from {} to {}",
                render_json_value(before),
                render_json_value(after)
            )
        }
        (Some(field), _, _) => format!("Changed {field}"),
        _ => event_type.replace(['.', '_'], " "),
    }
}

/// Render one `payload` field value (`before`/`after`) as plain text for
/// [`render_description`]'s fallback sentence — `null` reads as "none," a JSON string is printed
/// unquoted, and every other JSON scalar/shape falls back to its own `Display`/`to_string()`.
fn render_json_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::Null => "none".to_string(),
        serde_json::Value::String(s) => s.clone(),
        serde_json::Value::Bool(b) => b.to_string(),
        other => other.to_string(),
    }
}
