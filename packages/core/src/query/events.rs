//! The two reads over the append-only `events` log (BOARD-09, DATA-05, D-19): the item-scoped
//! activity trail a human reads in the detail panel, and the per-`(project, origin)`
//! cursor-resumable stream a future relay reads. Both are literal SQL over the existing `events`
//! table — no second history table, no denormalised activity cache, no parallel log (this plan's
//! own load-bearing prohibition; a `<verify>` gate fails the build if a migration file is added
//! alongside this module). Every statement below is a single literal `&str`, bound through
//! `params![]` — never assembled by `format!`/string interpolation, matching this crate's own
//! `T-01-01`/`T-01-23` discipline.
//!
//! `DATA-05`'s two-tier cursor design (`01-RESEARCH.md` "Flag 1"): [`events_since_cursor`] is
//! *exact* and gap-free per `(project_id, origin)` — a consumer storing each batch's maximum
//! `sequence` as its next cursor can never skip or double-read a row, because an uncommitted
//! transaction never produces a row at all (D-17). Merging multiple origins into one
//! chronological timeline is *approximate*, by sorting the fetched rows on `events.id` (a ULID,
//! clock-ordered across any writer without cross-machine coordination) — sufficient for a
//! human-facing trail, not a strict causal ordering (see `01-10-PLAN.md`'s "Flagged assumption").

use anyhow::Context;
use rusqlite::{params, Connection, Row};

use crate::domain::event::render_description;

/// One row of an item's activity trail, or of a cursor-resumable stream batch — the same shape
/// serves both reads, since both are just different `WHERE` clauses over the identical `events`
/// columns (D-19: "the same data the UI already renders" is exactly what a replay-from-cursor
/// reconstructs from).
#[derive(Debug, Clone, PartialEq)]
pub struct EventRow {
    pub id: String,
    pub project_id: String,
    pub origin: String,
    pub sequence: i64,
    pub stream_type: String,
    pub stream_id: String,
    pub task_id: Option<String>,
    pub epic_id: Option<String>,
    pub actor_id: String,
    pub event_type: String,
    pub payload: serde_json::Value,
    pub occurred_at: String,
    /// The one-line human sentence [`render_description`] derived from `payload` at read time —
    /// never stored as its own column, always recomputed on read, so a future change to the
    /// rendering rule applies to every historical event without a backfill migration.
    pub description: String,
}

/// An opaque resume point for [`events_since_cursor`]: the maximum `sequence` a consumer has
/// already read for one `(project_id, origin)` pair (D-17) — never a bare `sequence` alone, since
/// two origins can otherwise collide on the same integer value. A fresh consumer starts at
/// `sequence: 0`, which reads the log from its beginning (SQLite `sequence` values start at 1).
#[derive(Debug, Clone, PartialEq)]
pub struct EventCursor {
    pub project_id: String,
    pub origin: String,
    pub sequence: i64,
}

fn row_to_event(row: &Row) -> rusqlite::Result<EventRow> {
    let event_type: String = row.get(9)?;
    let payload_text: String = row.get(10)?;
    // A payload that fails to parse (should never happen — every writer goes through
    // `append_event` with a `serde_json::Value` already) degrades to `Value::Null` rather than
    // erroring the whole trail read; `render_description` has a defined, non-empty output for
    // that case too.
    let payload: serde_json::Value =
        serde_json::from_str(&payload_text).unwrap_or(serde_json::Value::Null);
    let description = render_description(&event_type, &payload);

    Ok(EventRow {
        id: row.get(0)?,
        project_id: row.get(1)?,
        origin: row.get(2)?,
        sequence: row.get(3)?,
        stream_type: row.get(4)?,
        stream_id: row.get(5)?,
        task_id: row.get(6)?,
        epic_id: row.get(7)?,
        actor_id: row.get(8)?,
        event_type,
        payload,
        occurred_at: row.get(11)?,
        description,
    })
}

const TASK_TRAIL_SQL: &str = "SELECT id, project_id, origin, sequence, stream_type, stream_id, \
    task_id, epic_id, actor_id, event_type, payload, occurred_at \
    FROM events WHERE task_id = ?1 ORDER BY id ASC LIMIT ?2 OFFSET ?3";

const EPIC_TRAIL_SQL: &str = "SELECT id, project_id, origin, sequence, stream_type, stream_id, \
    task_id, epic_id, actor_id, event_type, payload, occurred_at \
    FROM events WHERE epic_id = ?1 ORDER BY id ASC LIMIT ?2 OFFSET ?3";

// `TASK_TRAIL_SQL`/`EPIC_TRAIL_SQL` spell the same column list literally, each its own complete
// string — no runtime SQL construction anywhere in this module, so the two can only drift from
// [`row_to_event`]'s expected column order if a future edit touches both by hand; `activity_trail.rs`'s
// tests exercise both branches directly, which would catch that drift immediately.

/// A task's or an epic's own chronological trail (BOARD-09) — its own events plus, because
/// `acceptance_criterion` events are denormalised onto their parent's `task_id`/`epic_id` column
/// at write time (D-19), its acceptance criteria's events too. One indexed query, no union, no
/// per-row follow-up. Ordered ascending by `id` — a ULID, chronological by construction, so no
/// separate timestamp sort is needed (01-RESEARCH.md Pattern 2). Bounded by `limit` with an
/// `offset` cursor (D-03) — never the whole trail at once.
///
/// `parent_kind` must be `"task"` or `"epic"`; anything else is a caller bug and returns an
/// error rather than silently matching zero rows.
pub fn activity_trail(
    conn: &Connection,
    parent_kind: &str,
    parent_id: &str,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<EventRow>> {
    let sql = match parent_kind {
        "task" => TASK_TRAIL_SQL,
        "epic" => EPIC_TRAIL_SQL,
        other => {
            anyhow::bail!("activity_trail: parent_kind must be \"task\" or \"epic\", got {other:?}")
        }
    };
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt
        .query_map(params![parent_id, limit, offset], row_to_event)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query the activity trail")
}

const EVENTS_SINCE_CURSOR_SQL: &str =
    "SELECT id, project_id, origin, sequence, stream_type, stream_id, \
     task_id, epic_id, actor_id, event_type, payload, occurred_at \
     FROM events WHERE project_id = ?1 AND origin = ?2 AND sequence > ?3 \
     ORDER BY sequence ASC LIMIT ?4";

/// The resumable per-`(project, origin)` stream (DATA-05) — a future relay's entire integration
/// surface: "read `events` where `(project_id, origin, sequence) > cursor`," no new table, no
/// CDC tooling, no schema change (D-22).
///
/// Filters on both `project_id` and `origin`, never on `sequence` alone (D-17, 01-RESEARCH.md
/// Pitfall 2) — a bare `sequence` comparison would let two origins collide on the same integer
/// value. A cursor past the last row returns an empty batch, not an error; a cursor of `0`
/// returns the log from its beginning. Gap-free and duplicate-free by construction: an
/// uncommitted transaction never produces a row, and a consumer that stores each batch's own
/// maximum `sequence` as its next cursor can never re-read a row it has already seen.
pub fn events_since_cursor(
    conn: &Connection,
    cursor: &EventCursor,
    limit: i64,
) -> anyhow::Result<Vec<EventRow>> {
    let mut stmt = conn.prepare(EVENTS_SINCE_CURSOR_SQL)?;
    let rows = stmt
        .query_map(
            params![cursor.project_id, cursor.origin, cursor.sequence, limit],
            row_to_event,
        )?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query events since cursor")
}
