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
//!
//! A third read, [`events_since_last_look`] (issue #167), is the board's "Since you last looked"
//! timeline: the same stream filtered to the human-meaningful event types after a per-project cursor
//! kept in `settings`, which `domain::settings::board_visit` moves when the board is opened.

use anyhow::Context;
use rusqlite::{params, Connection, OptionalExtension, Row};

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
    pub story_id: Option<String>,
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
        story_id: row.get(6)?,
        epic_id: row.get(7)?,
        actor_id: row.get(8)?,
        event_type,
        payload,
        occurred_at: row.get(11)?,
        description,
    })
}

const STORY_TRAIL_SQL: &str = "SELECT id, project_id, origin, sequence, stream_type, stream_id, \
    story_id, epic_id, actor_id, event_type, payload, occurred_at \
    FROM events WHERE story_id = ?1 ORDER BY id ASC LIMIT ?2 OFFSET ?3";

const EPIC_TRAIL_SQL: &str = "SELECT id, project_id, origin, sequence, stream_type, stream_id, \
    story_id, epic_id, actor_id, event_type, payload, occurred_at \
    FROM events WHERE epic_id = ?1 ORDER BY id ASC LIMIT ?2 OFFSET ?3";

// `STORY_TRAIL_SQL`/`EPIC_TRAIL_SQL` spell the same column list literally, each its own complete
// string — no runtime SQL construction anywhere in this module, so the two can only drift from
// [`row_to_event`]'s expected column order if a future edit touches both by hand; `activity_trail.rs`'s
// tests exercise both branches directly, which would catch that drift immediately.

/// A Story's or an Epic's own chronological trail (BOARD-09) — its own events plus, because
/// `acceptance_criterion` events are denormalised onto their parent's `story_id`/`epic_id` column
/// at write time (D-19), its acceptance criteria's events too. One indexed query, no union, no
/// per-row follow-up. Ordered ascending by `id` — a ULID, chronological by construction, so no
/// separate timestamp sort is needed (01-RESEARCH.md Pattern 2). Bounded by `limit` with an
/// `offset` cursor (D-03) — never the whole trail at once.
///
/// `parent_kind` must be `"story"` or `"epic"`; anything else is a caller bug and returns an
/// error rather than silently matching zero rows.
pub fn activity_trail(
    conn: &Connection,
    parent_kind: &str,
    parent_id: &str,
    limit: i64,
    offset: i64,
) -> anyhow::Result<Vec<EventRow>> {
    let sql = match parent_kind {
        "story" => STORY_TRAIL_SQL,
        "epic" => EPIC_TRAIL_SQL,
        other => {
            anyhow::bail!("activity_trail: parent_kind must be \"story\" or \"epic\", got {other:?}")
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
     story_id, epic_id, actor_id, event_type, payload, occurred_at \
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

/// The `settings` key holding a project's "Since you last looked" cursor (issue #167): the newest
/// `local` sequence the Developer had seen when they last opened that project's board.
pub fn last_looked_key(project_id: &str) -> String {
    format!("last_looked:{project_id}")
}

/// The event types the "Since you last looked" timeline lists (spec §7, issue #167): state moves (a
/// merge and a confirmed Done are state moves too), hand-offs, Proposals filed or decided, and Rounds
/// opened or closed, shaping and roadmap alike. Task churn, edits, sessions and criteria are left out.
pub const MEANINGFUL_EVENT_TYPES: &[&str] = &[
    "story.state_changed",
    "story.handed_off",
    "epic.state_changed",
    "milestone.state_changed",
    "proposal.filed",
    "proposal.accepted",
    "proposal.rejected",
    "round.posted",
    "round.answered",
    "round.opened",
    "round.closed",
    "round.dismissed",
];

/// One event of the "Since you last looked" timeline, with the record it is about: a Story's or
/// Epic's key and title, or a Milestone's title (no key). Both are `None` for a project-level event
/// such as a roadmap Round, whose own sentence names it.
#[derive(Debug, Clone, PartialEq)]
pub struct LookedEvent {
    pub event: EventRow,
    pub subject_key: Option<String>,
    pub subject_title: Option<String>,
}

/// What changed since the last look: the newest `limit` meaningful events, oldest first, and how
/// many there are in all.
#[derive(Debug, Clone, PartialEq)]
pub struct SinceLastLooked {
    pub total: i64,
    pub events: Vec<LookedEvent>,
}

// `?2` is the cursor; `?3` the event types as a JSON array, so the list stays one literal statement.
const SINCE_LAST_LOOK_COUNT_SQL: &str = "SELECT COUNT(*) FROM events \
    WHERE project_id = ?1 AND origin = 'local' AND sequence > ?2 \
    AND event_type IN (SELECT value FROM json_each(?3))";

const SINCE_LAST_LOOK_SQL: &str = "SELECT * FROM (\
    SELECT e.id, e.project_id, e.origin, e.sequence, e.stream_type, e.stream_id, \
    e.story_id, e.epic_id, e.actor_id, e.event_type, e.payload, e.occurred_at, \
    CASE \
      WHEN e.story_id IS NOT NULL THEN (SELECT s.key FROM stories s WHERE s.id = e.story_id) \
      WHEN e.epic_id IS NOT NULL THEN (SELECT ep.key FROM epics ep WHERE ep.id = e.epic_id) \
    END AS subject_key, \
    CASE \
      WHEN e.story_id IS NOT NULL THEN (SELECT s.title FROM stories s WHERE s.id = e.story_id) \
      WHEN e.epic_id IS NOT NULL THEN (SELECT ep.title FROM epics ep WHERE ep.id = e.epic_id) \
      WHEN e.stream_type = 'milestone' THEN (SELECT m.title FROM milestones m WHERE m.id = e.stream_id) \
      WHEN e.stream_type = 'round' THEN (SELECT m.title FROM rounds r JOIN stages st ON st.id = r.stage_id \
        JOIN milestones m ON m.id = st.milestone_id WHERE r.id = e.stream_id) \
    END AS subject_title \
    FROM events e \
    WHERE e.project_id = ?1 AND e.origin = 'local' AND e.sequence > ?2 \
    AND e.event_type IN (SELECT value FROM json_each(?3)) \
    ORDER BY e.sequence DESC LIMIT ?4\
    ) ORDER BY sequence ASC";

/// A project's cursor, or `None` before its board was ever opened. An unreadable value reads as
/// `None` too: the next visit then sets a fresh baseline rather than failing the board.
pub fn last_looked_sequence(conn: &Connection, project_id: &str) -> anyhow::Result<Option<i64>> {
    let value: Option<String> = conn
        .query_row("SELECT value FROM settings WHERE key = ?1", params![last_looked_key(project_id)], |r| r.get(0))
        .optional()
        .context("failed to read the last-looked cursor")?;
    Ok(value.and_then(|v| v.parse().ok()))
}

/// The meaningful events since the project's last look (issue #167), read only: the cursor stays
/// where it is (`domain::settings::board_visit` moves it). A project never looked at has no last
/// look, so nothing is listed.
pub fn events_since_last_look(conn: &Connection, project_id: &str, limit: i64) -> anyhow::Result<SinceLastLooked> {
    let Some(after) = last_looked_sequence(conn, project_id)? else {
        return Ok(SinceLastLooked { total: 0, events: Vec::new() });
    };
    events_after(conn, project_id, after, limit)
}

/// The meaningful events after `after`, as [`events_since_last_look`] lists them.
pub(crate) fn events_after(conn: &Connection, project_id: &str, after: i64, limit: i64) -> anyhow::Result<SinceLastLooked> {
    let types = serde_json::to_string(MEANINGFUL_EVENT_TYPES)?;
    let total: i64 = conn
        .query_row(SINCE_LAST_LOOK_COUNT_SQL, params![project_id, after, types], |r| r.get(0))
        .context("failed to count events since the last look")?;
    let mut stmt = conn.prepare(SINCE_LAST_LOOK_SQL)?;
    let events = stmt
        .query_map(params![project_id, after, types, limit], |row| {
            Ok(LookedEvent { event: row_to_event(row)?, subject_key: row.get(12)?, subject_title: row.get(13)? })
        })?
        .collect::<Result<Vec<_>, _>>()
        .context("failed to query events since the last look")?;
    Ok(SinceLastLooked { total, events })
}

/// The newest `local` sequence in the project's stream, or 0 for an empty stream.
pub(crate) fn newest_sequence(conn: &Connection, project_id: &str) -> anyhow::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(sequence), 0) FROM events WHERE project_id = ?1 AND origin = 'local'",
        params![project_id],
        |r| r.get(0),
    )
    .context("failed to read the newest event sequence")
}
