//! `search_items` — FTS5 free-text search across tasks, epics and issues (BOARD-06), sharing
//! `query/mod.rs`'s row mappers, `ORDER_BY`/`CURSOR_WHERE` fragments and filter machinery so a
//! searched window can never drift from the plain board window's shape or order (D-03: one
//! definition of a result set).
//!
//! # Why the FTS index is kept current only by triggers — and what breaks it
//!
//! `tasks_fts`/`epics_fts`/`issues_fts` are `content=`-external FTS5 tables (migration
//! `0002_board_schema.sql`); SQLite does **not** keep an external-content FTS5 table synchronised
//! on its own. The three `AFTER INSERT/UPDATE/DELETE` triggers on each base table are the *only*
//! mechanism that does. Every write in this crate goes through the ordinary `domain::*` mutation
//! functions, which always `INSERT`/`UPDATE`/`DELETE` the base table directly (never a bulk
//! `.import`, never a raw `COPY`), so the triggers always fire. **If a future write path ever
//! bypasses those functions** — a bulk import, a backfill script, a direct `.import` — it must be
//! followed by `INSERT INTO tasks_fts(tasks_fts) VALUES ('rebuild')` (and the `epics_fts`/
//! `issues_fts` equivalents), or the index will drift silently: no error is raised, rows simply
//! cease to match a search that should find them (01-RESEARCH.md Pitfall 3).
//!
//! # The match expression: a literal phrase, never FTS5 query syntax (T-01-01)
//!
//! The user's term is wrapped as an FTS5 *quoted phrase* before it is bound as a parameter:
//! `"<term with every `"` doubled>"*`. Quoting disables every one of FTS5's own operators
//! (`AND`/`OR`/`NOT`, unquoted `*` prefix, `-` exclusion, `:` column filters, parentheses) inside
//! the quoted span, so a title containing a colon, an asterisk or a hyphen is matched as the
//! literal text it is, never re-interpreted as query syntax; the trailing `*` (appended by this
//! module, never present inside the quotes) applies FTS5's prefix-match modifier to only the
//! phrase's last token, which is what makes "a prefix of the title" match while typing continues
//! to feel responsive. Doubling embedded `"` characters is FTS5's own documented escape for a
//! literal quote inside a quoted string. This wrapping happens entirely in Rust `String` value
//! construction (`push`/`push_str`/`replace`, never the string-interpolation macro this crate's
//! tests grep-gate against) — the query text itself
//! is always one of the fixed literal strings below; only the *value* bound to `:fts_term`
//! changes per call (verified empirically against double-quote, asterisk, hyphen, colon,
//! accented-Latin, CJK and emoji terms before this module was written — see `tests/search_filter.rs`).
//!
//! # Matching the human-readable key (D-10)
//!
//! FTS5 only indexes `title`/`description`(`body`) — the `key` column (`FLY-142`) is matched
//! separately, as a plain case-insensitive equality (`UPPER(key) = UPPER(:key_term)`) OR'd
//! alongside the FTS match inside the same per-table `WHERE`, so a project stays greppable by its
//! own key scheme without a schema/migration change (D-10: "it exists to be greppable").

use anyhow::Context;
use rusqlite::{named_params, Connection};

use super::filter::{apply_filter, BoardFilter, FilterBinding, FILTER_WHERE};
use super::{
    format_sql, list_board, row_to_issue, row_to_item, BandCounts, BoardCursor, BoardItem,
    BoardWindow, IssueItem, CRITERIA_JOIN, CURSOR_WHERE, ITEM_SELECT_LIST, ORDER_BY,
};

/// Wrap `term` as a literal FTS5 phrase with a trailing prefix-match modifier on its last token.
/// Never invoked with an empty/whitespace-only term — callers short-circuit that case before
/// reaching here (an empty term means "no text constraint", not "match nothing").
fn to_fts5_prefix_phrase(term: &str) -> String {
    let mut wrapped = String::with_capacity(term.len() + 3);
    wrapped.push('"');
    wrapped.push_str(&term.replace('"', "\"\""));
    wrapped.push('"');
    wrapped.push('*');
    wrapped
}

/// True when a query-execution error is FTS5's own tokenizer/query-parser rejecting the bound
/// match expression, rather than a genuine I/O/schema/logic failure. Defence-in-depth: every
/// adversarial case this module's doc comment describes was verified empirically to execute
/// without error before this function was written (pure punctuation, a lone quote, emoji), but a
/// future SQLite/FTS5 version's tokenizer behavior is not this crate's to control — if one ever
/// does reject a wrapped phrase, this crate still returns a result set (empty) rather than
/// propagating a query-syntax error to the renderer (Task 1 behavior: "a term of pure punctuation
/// must return a result set rather than a parse error").
fn is_fts5_syntax_error(err: &anyhow::Error) -> bool {
    err.to_string().to_lowercase().contains("fts5")
}

/// Return a bounded, indexed window over `project_id`'s epics and tasks matching `term`, plus its
/// matching issues lane — the same shape and the same order `list_board` returns (BOARD-06,
/// D-03). An empty or whitespace-only `term` delegates byte-identically to `list_board` (its
/// field being empty means "no text constraint," never "match nothing").
pub fn search_items(
    conn: &Connection,
    project_id: &str,
    term: &str,
    filter: &BoardFilter,
    limit: i64,
    cursor: Option<&BoardCursor>,
) -> anyhow::Result<BoardWindow> {
    let trimmed = term.trim();
    if trimmed.is_empty() {
        return list_board(conn, project_id, filter, limit, cursor);
    }

    let binding = apply_filter(filter);
    let fts_term = to_fts5_prefix_phrase(trimmed);

    let items = match cursor {
        None => search_items_first_page(conn, project_id, trimmed, &fts_term, &binding, limit),
        Some(c) => {
            search_items_next_page(conn, project_id, trimmed, &fts_term, &binding, limit, c)
        }
    };
    let items = match items {
        Ok(items) => items,
        Err(err) if is_fts5_syntax_error(&err) => Vec::new(),
        Err(err) => return Err(err),
    };

    let issues = match search_issues(conn, project_id, trimmed, &fts_term, limit) {
        Ok(issues) => issues,
        Err(err) if is_fts5_syntax_error(&err) => Vec::new(),
        Err(err) => return Err(err),
    };

    let counts = match search_band_counts(conn, project_id, trimmed, &fts_term, &binding) {
        Ok(counts) => counts,
        Err(err) if is_fts5_syntax_error(&err) => BandCounts::default(),
        Err(err) => return Err(err),
    };

    Ok(BoardWindow { items, issues, counts })
}

/// The per-table `WHERE` every searched epics/tasks arm shares: project-scoped, then matched by
/// either the case-insensitive key equality or the FTS5 phrase.
const MATCH_WHERE: &str =
    "(UPPER(key) = UPPER(:key_term) OR rowid IN (SELECT rowid FROM {table} WHERE {table} MATCH :fts_term))";

fn epics_from_clause() -> String {
    format_sql(&[
        "SELECT id, 'epic' AS kind, key, title, status, rank, priority, NULL AS epic_id,",
        " estimate, assignee_id FROM epics WHERE project_id = :project_id AND ",
        &MATCH_WHERE.replace("{table}", "epics_fts"),
    ])
}

fn tasks_from_clause() -> String {
    format_sql(&[
        "SELECT id, 'task' AS kind, key, title, status, rank, priority, epic_id,",
        " estimate, assignee_id FROM tasks WHERE project_id = :project_id AND ",
        &MATCH_WHERE.replace("{table}", "tasks_fts"),
    ])
}

fn search_items_first_page(
    conn: &Connection,
    project_id: &str,
    key_term: &str,
    fts_term: &str,
    binding: &FilterBinding,
    limit: i64,
) -> anyhow::Result<Vec<BoardItem>> {
    let sql = format_sql(&[
        "SELECT ",
        ITEM_SELECT_LIST,
        " FROM (",
        &epics_from_clause(),
        " UNION ALL ",
        &tasks_from_clause(),
        ") b ",
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
                ":key_term": key_term,
                ":fts_term": fts_term,
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
    rows.context("failed to search the board window")
}

fn search_items_next_page(
    conn: &Connection,
    project_id: &str,
    key_term: &str,
    fts_term: &str,
    binding: &FilterBinding,
    limit: i64,
    cursor: &BoardCursor,
) -> anyhow::Result<Vec<BoardItem>> {
    let sql = format_sql(&[
        "SELECT ",
        ITEM_SELECT_LIST,
        " FROM (",
        &epics_from_clause(),
        " UNION ALL ",
        &tasks_from_clause(),
        ") b ",
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
                ":key_term": key_term,
                ":fts_term": fts_term,
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
    rows.context("failed to search the next board window")
}

/// The matching issues lane (D-07: issues carry no status, so no `BoardFilter` dimension applies
/// to them — they are narrowed by the search term alone, the same key-or-FTS match every other
/// kind uses).
pub(crate) fn search_issues(
    conn: &Connection,
    project_id: &str,
    key_term: &str,
    fts_term: &str,
    limit: i64,
) -> anyhow::Result<Vec<IssueItem>> {
    let mut stmt = conn.prepare(
        "SELECT id, key, title, kind, epic_id, task_id
         FROM issues
         WHERE project_id = :project_id
           AND (UPPER(key) = UPPER(:key_term)
                OR rowid IN (SELECT rowid FROM issues_fts WHERE issues_fts MATCH :fts_term))
         ORDER BY rank ASC, id ASC
         LIMIT :limit",
    )?;
    let rows = stmt
        .query_map(
            named_params! {
                ":project_id": project_id,
                ":key_term": key_term,
                ":fts_term": fts_term,
                ":limit": limit,
            },
            row_to_issue,
        )?
        .collect::<Result<Vec<_>, _>>();
    rows.context("failed to search the issues lane")
}

/// Per-band counts of epics+tasks matching `term`/`filter` — the searched-window equivalent of
/// `board_band_counts`, so the band headers report the searched-and-filtered scale.
fn search_band_counts(
    conn: &Connection,
    project_id: &str,
    key_term: &str,
    fts_term: &str,
    binding: &FilterBinding,
) -> anyhow::Result<BandCounts> {
    let sql = format_sql(&[
        "SELECT b.status, COUNT(*) FROM (",
        &epics_from_clause(),
        " UNION ALL ",
        &tasks_from_clause(),
        ") b WHERE ",
        FILTER_WHERE,
        " GROUP BY b.status",
    ]);
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(
        named_params! {
            ":project_id": project_id,
            ":key_term": key_term,
            ":fts_term": fts_term,
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
        let (status, count) = row.context("failed to read searched band counts")?;
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
