//! `list_board` — the bounded, indexed read window the renderer consumes (D-03).
//!
//! The core never returns the whole board: every call is `LIMIT`-bounded and cursor-resumable.
//! Two literal query strings (with, and without, a cursor) are used rather than assembling one
//! dynamically with `format!` — every SQL statement in this crate is a literal bound through
//! `params![]` (T-01-01).

use anyhow::Context;
use rusqlite::{params, Connection, Row};

/// One row of the board window — enough to render a strip (01-UI-SPEC.md "Row Anatomy").
#[derive(Debug, Clone, PartialEq)]
pub struct BoardItem {
    pub id: String,
    pub key: String,
    pub title: String,
    pub status: String,
    pub rank: String,
    pub priority: i64,
    pub epic_id: Option<String>,
}

/// Per-band item counts (01-UI-SPEC.md "Board list" — sticky headers show counts even when a
/// band is collapsed, so scale stays legible per BOARD-08).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BandCounts {
    pub backlog: i64,
    pub todo: i64,
    pub in_progress: i64,
    pub in_review: i64,
    pub done: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct BoardWindow {
    pub items: Vec<BoardItem>,
    pub counts: BandCounts,
}

/// An opaque resume point for the next `list_board` call: the last row's ordering key from the
/// prior window, expressed as the same sort keys the query itself computes (never the raw status
/// string), so the comparison stays type-consistent inside SQLite's row-value comparison.
#[derive(Debug, Clone, PartialEq)]
pub struct BoardCursor {
    pub status_sort_key: i64,
    pub priority_sort_key: i64,
    pub rank: String,
    pub id: String,
}

/// Fixed band order (01-UI-SPEC.md "Board list" — never reorderable, never hideable as a set).
pub fn status_sort_key(status: &str) -> i64 {
    match status {
        "backlog" => 0,
        "todo" => 1,
        "in_progress" => 2,
        "in_review" => 3,
        "done" => 4,
        _ => 5,
    }
}

/// "No priority" (0) SORTS LAST, not first (01-UI-SPEC.md Open Decisions #6) — this is the one
/// place that rule is enforced; nothing here relies on the raw keymap value ordering correctly.
pub fn priority_sort_key(priority: i64) -> i64 {
    if priority == 0 {
        5
    } else {
        priority
    }
}

fn row_to_item(row: &Row) -> rusqlite::Result<BoardItem> {
    Ok(BoardItem {
        id: row.get(0)?,
        key: row.get(1)?,
        title: row.get(2)?,
        status: row.get(3)?,
        rank: row.get(4)?,
        priority: row.get(5)?,
        epic_id: row.get(6)?,
    })
}

/// Return a bounded, indexed window over `project_id`'s tasks — never the whole board (D-03).
///
/// Ordered by status band, then priority (with "No priority" sorting last), then manual rank,
/// then id, within the composite `(project_id, status, rank)` index. A task with `epic_id = NULL`
/// is included exactly like any other task — this query never uses a bare inner join to `epics`
/// (01-RESEARCH.md Pitfall 4).
pub fn list_board(
    conn: &Connection,
    project_id: &str,
    limit: i64,
    cursor: Option<&BoardCursor>,
) -> anyhow::Result<BoardWindow> {
    let items: Vec<BoardItem> = match cursor {
        None => {
            let mut stmt = conn.prepare(
                "SELECT id, key, title, status, rank, priority, epic_id
                 FROM tasks
                 WHERE project_id = ?1
                 ORDER BY
                     CASE status
                         WHEN 'backlog' THEN 0
                         WHEN 'todo' THEN 1
                         WHEN 'in_progress' THEN 2
                         WHEN 'in_review' THEN 3
                         WHEN 'done' THEN 4
                     END ASC,
                     (CASE WHEN priority = 0 THEN 5 ELSE priority END) ASC,
                     rank ASC,
                     id ASC
                 LIMIT ?2",
            )?;
            let rows = stmt
                .query_map(params![project_id, limit], row_to_item)?
                .collect::<Result<Vec<_>, _>>();
            rows
        }
        Some(c) => {
            let mut stmt = conn.prepare(
                "SELECT id, key, title, status, rank, priority, epic_id
                 FROM tasks
                 WHERE project_id = ?1
                   AND (
                     CASE status
                         WHEN 'backlog' THEN 0
                         WHEN 'todo' THEN 1
                         WHEN 'in_progress' THEN 2
                         WHEN 'in_review' THEN 3
                         WHEN 'done' THEN 4
                     END,
                     (CASE WHEN priority = 0 THEN 5 ELSE priority END),
                     rank,
                     id
                   ) > (?2, ?3, ?4, ?5)
                 ORDER BY
                     CASE status
                         WHEN 'backlog' THEN 0
                         WHEN 'todo' THEN 1
                         WHEN 'in_progress' THEN 2
                         WHEN 'in_review' THEN 3
                         WHEN 'done' THEN 4
                     END ASC,
                     (CASE WHEN priority = 0 THEN 5 ELSE priority END) ASC,
                     rank ASC,
                     id ASC
                 LIMIT ?6",
            )?;
            let rows = stmt
                .query_map(
                    params![
                        project_id,
                        c.status_sort_key,
                        c.priority_sort_key,
                        c.rank,
                        c.id,
                        limit
                    ],
                    row_to_item,
                )?
                .collect::<Result<Vec<_>, _>>();
            rows
        }
    }
    .context("failed to query the board window")?;

    let counts = board_band_counts(conn, project_id)?;

    Ok(BoardWindow { items, counts })
}

fn board_band_counts(conn: &Connection, project_id: &str) -> anyhow::Result<BandCounts> {
    let mut counts = BandCounts::default();
    let mut stmt =
        conn.prepare("SELECT status, COUNT(*) FROM tasks WHERE project_id = ?1 GROUP BY status")?;
    let rows = stmt.query_map(params![project_id], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (status, count) = row.context("failed to read band counts")?;
        match status.as_str() {
            "backlog" => counts.backlog = count,
            "todo" => counts.todo = count,
            "in_progress" => counts.in_progress = count,
            "in_review" => counts.in_review = count,
            "done" => counts.done = count,
            _ => {}
        }
    }
    Ok(counts)
}
