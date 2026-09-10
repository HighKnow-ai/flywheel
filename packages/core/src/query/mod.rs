//! `list_board` — the bounded, indexed read window the renderer consumes (D-03).
//!
//! The core never returns the whole board: every call is `LIMIT`-bounded and cursor-resumable.
//! Every SQL statement in this crate is a literal string bound through named parameters
//! (`rusqlite::named_params!`) or `params![]` — never assembled with the string-interpolation
//! macro this crate's tests grep-gate against (T-01-01, T-01-23): the shape of every query is
//! fixed at compile time, and only
//! the *values* a caller supplies (a project id, a filter's JSON-encoded value set, a search
//! term) ever change what a query matches.
//!
//! `list_board` returns three groups: **epics and tasks together**, keyed into their shared
//! five-state status bands (BOARD-04), and **issues separately**, in their own workflow-less lane
//! (D-07) — issues carry no `status` column, so they can never appear in a band. Epics and tasks
//! are unioned in one query rather than queried independently so the one `ORDER BY` (status band,
//! then priority, then rank, then id) applies identically to both — an epic and its child tasks
//! interleave correctly within a shared band (01-UI-SPEC.md "Board list": "an epic 'In Progress'
//! sits in the same group as its child tasks that are also 'In Progress'").
//!
//! `search::search_items`/`search::search_issues` (plan 01-08, BOARD-06) share this module's row
//! mappers, sort-key functions and `BoardCursor` shape via `pub(crate)` visibility — the ordering
//! contract is defined exactly once, here, and searching/filtering never reorders it (BOARD-06's
//! "filtered results come back in the same priority-then-rank-then-id order as the unfiltered
//! board").

pub mod events;
pub mod filter;
pub mod permissions;
pub mod search;

use anyhow::Context;
use rusqlite::{named_params, params, Connection, Row};

pub use filter::BoardFilter;
use filter::{apply_filter, FilterBinding, FILTER_WHERE};

/// One row of the board window's status-banded region — enough to render a strip (01-UI-SPEC.md
/// "Row Anatomy"). `kind` distinguishes an epic row from a task row; a task with `epic_id = NULL`
/// is included exactly like any other task — this query never uses a bare inner join to `epics`
/// (01-RESEARCH.md Pitfall 4, D-13).
#[derive(Debug, Clone, PartialEq)]
pub struct BoardItem {
    pub id: String,
    pub kind: String,
    pub key: String,
    pub title: String,
    pub status: String,
    pub rank: String,
    pub priority: i64,
    pub epic_id: Option<String>,
    /// S/M/L stored as a nullable ordinal 1-3 (D-12) — rendered and filterable, aggregated
    /// nowhere in this crate (no `sum(`/`avg(`/`total(` over this column, T-01-* prohibition).
    pub estimate: Option<i64>,
    /// Nullable FK to `actors(id)` (BOARD-06) — `None` renders as "Unassigned".
    pub assignee_id: Option<String>,
    /// How many of this item's acceptance criteria are checked, out of its total (BOARD-02,
    /// D-08) — computed by a single grouped aggregate joined into this same query, never a
    /// per-row follow-up query (D-08's "visible wherever the item appears" would violate the
    /// 1,000-item performance contract otherwise). An item with zero criteria reports `0`/`0`.
    pub criteria_checked: i64,
    pub criteria_total: i64,
}

/// One row of the board window's issues lane (D-07) — proposals and notes, not units of work, so
/// they carry no `status` field and never appear in a status band.
#[derive(Debug, Clone, PartialEq)]
pub struct IssueItem {
    pub id: String,
    pub key: String,
    pub title: String,
    pub kind: String,
    pub epic_id: Option<String>,
    pub task_id: Option<String>,
}

/// Per-band item counts (01-UI-SPEC.md "Board list" — sticky headers show counts even when a
/// band is collapsed, so scale stays legible per BOARD-08). Counts include both epics and tasks,
/// and are computed under the same filter/search restriction as the window itself (plan 01-08) —
/// a filtered board's headers report the filtered scale, not the whole project's.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BandCounts {
    pub backlog: i64,
    pub todo: i64,
    pub in_progress: i64,
    pub in_review: i64,
    pub done: i64,
}

impl BandCounts {
    /// The sum across every band — zero exactly when the (possibly filtered/searched) window
    /// holds no epics or tasks at all. The renderer distinguishes "empty project" from "empty
    /// filter result" using its own filter/search UI state (whether any filter is active), not a
    /// field on this struct — the two cases produce an identical all-zero `BandCounts` by
    /// construction, so that distinction can only ever be made client-side (01-UI-SPEC.md "State
    /// Inventory").
    pub fn total(&self) -> i64 {
        self.backlog + self.todo + self.in_progress + self.in_review + self.done
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct BoardWindow {
    pub items: Vec<BoardItem>,
    pub issues: Vec<IssueItem>,
    pub counts: BandCounts,
}

/// An opaque resume point for the next `list_board`/`search_items` call: the last row's ordering
/// key from the prior window, expressed as the same sort keys the query itself computes (never
/// the raw status string), so the comparison stays type-consistent inside SQLite's row-value
/// comparison. Applies only to the epics+tasks region — the issues lane is unpaginated in Phase 1
/// (no UI-SPEC surface calls for issue-lane pagination yet).
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

pub(crate) fn row_to_item(row: &Row) -> rusqlite::Result<BoardItem> {
    Ok(BoardItem {
        id: row.get(0)?,
        kind: row.get(1)?,
        key: row.get(2)?,
        title: row.get(3)?,
        status: row.get(4)?,
        rank: row.get(5)?,
        priority: row.get(6)?,
        epic_id: row.get(7)?,
        estimate: row.get(8)?,
        assignee_id: row.get(9)?,
        criteria_checked: row.get(10)?,
        criteria_total: row.get(11)?,
    })
}

pub(crate) fn row_to_issue(row: &Row) -> rusqlite::Result<IssueItem> {
    Ok(IssueItem {
        id: row.get(0)?,
        key: row.get(1)?,
        title: row.get(2)?,
        kind: row.get(3)?,
        epic_id: row.get(4)?,
        task_id: row.get(5)?,
    })
}

/// The `SELECT`ed column list every epics/tasks window query (plain or searched) projects from
/// its `b` subquery — a single literal fragment shared by every variant in this module and in
/// `search.rs` so the two families of queries can never drift into projecting different shapes.
const ITEM_SELECT_LIST: &str = concat!(
    "b.id, b.kind, b.key, b.title, b.status, b.rank, b.priority, b.epic_id,",
    " b.estimate, b.assignee_id, COALESCE(c.checked, 0) AS criteria_checked,",
    " COALESCE(c.total, 0) AS criteria_total",
);

/// The criteria-count `LEFT JOIN` every window query attaches to its `b` subquery (D-08) — a
/// single grouped aggregate, never a per-row follow-up query.
const CRITERIA_JOIN: &str = concat!(
    "LEFT JOIN (",
    " SELECT parent_id, SUM(checked) AS checked, COUNT(*) AS total",
    " FROM acceptance_criteria GROUP BY parent_id",
    ") c ON c.parent_id = b.id",
);

/// The `ORDER BY` every window query (plain or searched, cursored or not) uses — status band,
/// then priority ("No priority" sorting last), then manual rank, then id (BOARD-05's total order,
/// unchanged by filtering or searching per this plan's own success criteria).
///
/// `pub(crate)` (G-01-2, 01-17-PLAN.md): `domain::epic::list_epics` composes this same constant
/// so BOARD-05's total order has exactly one definition in the crate. Widening the visibility is
/// the alternative to restating the ordering expression in a second module — the shape a plain
/// private `const` cannot reach outside `query/` and its descendants.
pub(crate) const ORDER_BY: &str = concat!(
    "ORDER BY",
    " CASE b.status WHEN 'backlog' THEN 0 WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2",
    "   WHEN 'in_review' THEN 3 WHEN 'done' THEN 4 END ASC,",
    " (CASE WHEN b.priority = 0 THEN 5 ELSE b.priority END) ASC,",
    " b.rank ASC,",
    " b.id ASC",
);

/// The cursor row-value comparison every cursored window query uses, keyed on the exact same
/// tuple `ORDER_BY` sorts by (never the raw status string) so a resumed page can never repeat or
/// skip a row.
const CURSOR_WHERE: &str = concat!(
    "(",
    " CASE b.status WHEN 'backlog' THEN 0 WHEN 'todo' THEN 1 WHEN 'in_progress' THEN 2",
    "   WHEN 'in_review' THEN 3 WHEN 'done' THEN 4 END,",
    " (CASE WHEN b.priority = 0 THEN 5 ELSE b.priority END),",
    " b.rank,",
    " b.id",
    ") > (:cursor_status, :cursor_priority, :cursor_rank, :cursor_id)",
);

/// Return a bounded, indexed window over `project_id`'s epics and tasks, plus its full issues
/// lane — never the whole board at once for the epics/tasks region (D-03).
///
/// `filter` narrows the window by status/epic/assignee/priority/estimate (BOARD-06, plan 01-08);
/// `BoardFilter::default()` is the unfiltered board, byte-identical to every call site before
/// this plan. Epics and tasks are ordered by status band, then priority (with "No priority"
/// sorting last), then manual rank, then id.
pub fn list_board(
    conn: &Connection,
    project_id: &str,
    filter: &BoardFilter,
    limit: i64,
    cursor: Option<&BoardCursor>,
) -> anyhow::Result<BoardWindow> {
    let binding = apply_filter(filter);
    let items = match cursor {
        None => list_board_first_page(conn, project_id, &binding, limit)?,
        Some(c) => list_board_next_page(conn, project_id, &binding, limit, c)?,
    };

    let issues = list_issues(conn, project_id, limit)?;
    let counts = board_band_counts(conn, project_id, &binding)?;

    Ok(BoardWindow { items, issues, counts })
}

fn list_board_first_page(
    conn: &Connection,
    project_id: &str,
    binding: &FilterBinding,
    limit: i64,
) -> anyhow::Result<Vec<BoardItem>> {
    let sql = format_sql(&[
        "SELECT ",
        ITEM_SELECT_LIST,
        " FROM (",
        " SELECT id, 'epic' AS kind, key, title, status, rank, priority, NULL AS epic_id,",
        "   estimate, assignee_id FROM epics WHERE project_id = :project_id",
        " UNION ALL",
        " SELECT id, 'task' AS kind, key, title, status, rank, priority, epic_id,",
        "   estimate, assignee_id FROM tasks WHERE project_id = :project_id",
        " ) b ",
        CRITERIA_JOIN,
        " WHERE ",
        FILTER_WHERE,
        " ",
        ORDER_BY,
        " LIMIT :limit",
    ]);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            named_params! {
                ":project_id": project_id,
                ":status_json": binding.status_json,
                ":epic_json": binding.epic_json,
                ":assignee_json": binding.assignee_json,
                ":priority_json": binding.priority_json,
                ":estimate_json": binding.estimate_json,
                ":limit": limit,
            },
            row_to_item,
        )?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query the board window")
}

fn list_board_next_page(
    conn: &Connection,
    project_id: &str,
    binding: &FilterBinding,
    limit: i64,
    cursor: &BoardCursor,
) -> anyhow::Result<Vec<BoardItem>> {
    let sql = format_sql(&[
        "SELECT ",
        ITEM_SELECT_LIST,
        " FROM (",
        " SELECT id, 'epic' AS kind, key, title, status, rank, priority, NULL AS epic_id,",
        "   estimate, assignee_id FROM epics WHERE project_id = :project_id",
        " UNION ALL",
        " SELECT id, 'task' AS kind, key, title, status, rank, priority, epic_id,",
        "   estimate, assignee_id FROM tasks WHERE project_id = :project_id",
        " ) b ",
        CRITERIA_JOIN,
        " WHERE ",
        FILTER_WHERE,
        " AND ",
        CURSOR_WHERE,
        " ",
        ORDER_BY,
        " LIMIT :limit",
    ]);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            named_params! {
                ":project_id": project_id,
                ":status_json": binding.status_json,
                ":epic_json": binding.epic_json,
                ":assignee_json": binding.assignee_json,
                ":priority_json": binding.priority_json,
                ":estimate_json": binding.estimate_json,
                ":cursor_status": cursor.status_sort_key,
                ":cursor_priority": cursor.priority_sort_key,
                ":cursor_rank": &cursor.rank,
                ":cursor_id": &cursor.id,
                ":limit": limit,
            },
            row_to_item,
        )?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query the next board window")
}

/// The issues lane (D-07): ungrouped by status (issues carry none), ordered by rank. Bounded by
/// the same window limit as the epics/tasks region (D-03) — Phase 1 ships no cursor for this
/// lane specifically, since no UI-SPEC surface calls for issue-lane pagination yet.
pub(crate) fn list_issues(
    conn: &Connection,
    project_id: &str,
    limit: i64,
) -> anyhow::Result<Vec<IssueItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, key, title, kind, epic_id, task_id
         FROM issues
         WHERE project_id = ?1
         ORDER BY rank ASC, id ASC
         LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![project_id, limit], row_to_issue)?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to query the issues lane")
}

/// Concatenate SQL fragment literals into one owned `String` at call time. This is `String`
/// concatenation of compile-time literal pieces (never a caller-supplied value, never the
/// string-interpolation macro this crate's tests grep-gate against — that gate checks
/// specifically for that macro's invocation, which this function never performs; every *value*
/// still reaches SQLite exclusively through
/// `named_params!`/`params![]` bound parameters, never through this concatenation.
fn format_sql(parts: &[&str]) -> String {
    let mut sql = String::new();
    for part in parts {
        sql.push_str(part);
    }
    sql
}

/// Per-band counts of epics+tasks matching `binding` (plan 01-08: filter-aware, so band headers
/// report the filtered scale, not the whole project's — 01-UI-SPEC.md "Board list").
pub(crate) fn board_band_counts(
    conn: &Connection,
    project_id: &str,
    binding: &FilterBinding,
) -> anyhow::Result<BandCounts> {
    let sql = format_sql(&[
        "SELECT b.status, COUNT(*) FROM (",
        " SELECT id, key, title, status, rank, priority, NULL AS epic_id, estimate, assignee_id",
        "   FROM epics WHERE project_id = :project_id",
        " UNION ALL",
        " SELECT id, key, title, status, rank, priority, epic_id, estimate, assignee_id",
        "   FROM tasks WHERE project_id = :project_id",
        " ) b",
        " WHERE ",
        FILTER_WHERE,
        " GROUP BY b.status",
    ]);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        named_params! {
            ":project_id": project_id,
            ":status_json": binding.status_json,
            ":epic_json": binding.epic_json,
            ":assignee_json": binding.assignee_json,
            ":priority_json": binding.priority_json,
            ":estimate_json": binding.estimate_json,
        },
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
    )?;

    let mut counts = BandCounts::default();
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
