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
//!
//! # A fourth external-content index: `authoring_proposals_fts` (plan 06-04, D-105/D-106/D-107)
//!
//! `authoring_proposals_fts` (migration `0016_authoring_proposals_fts.sql`) joins
//! `tasks_fts`/`epics_fts`/`issues_fts` as a fourth `content=`-external FTS5 table, synchronised
//! by the identical trigger pattern — the same drift warning above applies to it verbatim: if a
//! future write path ever bypasses `domain::authoring_proposal`'s own mutation functions, the
//! index drifts silently. [`duplicate_candidate_for`] is the one reader of this fourth index,
//! used by `domain::authoring_proposal::create_proposal_in_tx`/`amend_proposal` to flag a staged
//! proposal against a restated open task/epic/issue or an already-decided proposal, at staging
//! time, in the same transaction (D-107) — never recomputed on read.

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

/// The per-table `WHERE` each searched arm uses: matched by either the case-insensitive key
/// equality or the FTS5 phrase. One fully static statement per table (FNC-02's convention: no SQL
/// builds a table name in, so no statement is one caller-supplied string from injection).
const EPICS_MATCH_WHERE: &str =
    "(UPPER(key) = UPPER(:key_term) OR rowid IN (SELECT rowid FROM epics_fts WHERE epics_fts MATCH :fts_term))";
const TASKS_MATCH_WHERE: &str =
    "(UPPER(key) = UPPER(:key_term) OR rowid IN (SELECT rowid FROM tasks_fts WHERE tasks_fts MATCH :fts_term))";

fn epics_from_clause() -> String {
    format_sql(&[
        "SELECT id, 'epic' AS kind, key, title, status, rank, priority, NULL AS epic_id,",
        " assignee_id FROM epics WHERE project_id = :project_id AND ",
        EPICS_MATCH_WHERE,
    ])
}

fn tasks_from_clause() -> String {
    format_sql(&[
        "SELECT id, 'task' AS kind, key, title, status, rank, priority, epic_id,",
        " assignee_id FROM tasks WHERE project_id = :project_id AND ",
        TASKS_MATCH_WHERE,
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
                ":has_worktree": binding.has_worktree,
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
                ":has_worktree": binding.has_worktree,
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
            ":has_worktree": binding.has_worktree,
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

/// One scored candidate [`duplicate_candidate_for`] found — `kind` is one of `task`, `epic`,
/// `issue` or `proposal`; `key` is the project's human-readable key (`FLY-142`) for a canonical
/// item, `None` for a proposal (a proposal has no key until it is accepted); `score` is the raw
/// `bm25` value, always non-positive, more negative meaning a better match.
#[derive(Debug, Clone, PartialEq)]
pub struct DuplicateCandidate {
    pub kind: String,
    pub id: String,
    pub key: Option<String>,
    pub title: String,
    pub score: f64,
}

/// D-105: applied identically to every corpus's `bm25` call — the title-ish column (`payload`/
/// `title` depending on the arm) weighted 10x the body-ish column (`description`/`body`/
/// `rationale`), so two rows sharing a body but differing in title score further apart than two
/// rows sharing a title but differing in body.
pub const DUPLICATE_BM25_WEIGHTS: (f64, f64) = (10.0, 1.0);

/// [`duplicate_candidate_for`] returns at most this many candidates (D-107: one flag per staged
/// proposal, never a list) — a bounded, indexed statement whose read shape never grows with the
/// size of the project.
pub const DUPLICATE_CANDIDATE_LIMIT: i64 = 1;

/// The one place the duplicate-flag comparison lives (plan 06-04 Task 1). `bm25` returns a
/// NEGATIVE number whose magnitude grows with relevance, so a *better* match is a *more negative*
/// score — the comparison below is therefore strict less-than: a candidate whose score exactly
/// equals this threshold is NOT flagged (RESEARCH.md Pitfall 7).
///
/// **Measured (plan 06-04 Task 2, 2026-09-30)** against
/// `tests/proposal_duplicates.rs`'s `NEAR_DUPLICATE_PAIRS`/`UNRELATED_PAIRS` fixture (8 labelled
/// pairs each, covering all four corpora, seeded alongside 20 filler rows per table so `bm25`'s
/// IDF term has a real corpus to compute against): the 8 near-duplicate pairs scored in
/// `[-49.38, -26.23]` (worst/least-negative: the "task" corpus's `retry budget` case — `tasks_fts`
/// carries no `description` column at all, since `domain::task::create_task` never accepts one,
/// so a task's near-duplicate score rides on its title alone, weaker than the title+body corpora);
/// the 8 unrelated pairs scored in `[-16.87, -6.77]` (best/most-negative: the "epic" corpus's
/// `drag-and-drop reorder` case). The two ranges do not overlap — every value in the pinned
/// constant below sits strictly between them, with roughly 5 points of margin on each side.
pub const DUPLICATE_BM25_THRESHOLD: f64 = -21.0;

/// The lookup [`duplicate_candidate_for`] issues: one compile-time literal statement, four
/// `UNION ALL` arms (task, epic, issue, proposal), each scoped to `:project_id`, matched against
/// `:fts_term`, and weighted by the same two bound parameters (`:w0`/`:w1`, always
/// [`DUPLICATE_BM25_WEIGHTS`]) — one uniform `bm25` call per arm. The task and epic arms exclude
/// the terminal `done` status (D-106: "open tasks, epics and issues"); the issue arm has no
/// status to filter on; the proposal arm covers every status — pending and all four decided
/// values — and excludes `:exclude_proposal_id` when bound non-NULL, so a proposal being
/// re-scored by `amend_proposal` never flags itself. A proposal's `title` is extracted from its
/// own JSON `payload` with SQLite's `json_extract`, falling back through the three possible label
/// fields [`crate::domain::authoring_proposal::ProposalPayload::label`] itself reads. Closed with
/// one global `ORDER BY score ASC, id ASC LIMIT :limit` over the union of all four arms — the
/// deterministic tie-break this module's own header/doc comments promise: two candidates tying on
/// score are resolved by id, never by an unspecified UNION ALL ordering.
const DUPLICATE_LOOKUP_SQL: &str = "\
    SELECT 'task' AS kind, t.id AS id, t.key AS key, t.title AS title, \
        bm25(tasks_fts, :w0, :w1) AS score \
    FROM tasks_fts JOIN tasks t ON t.rowid = tasks_fts.rowid \
    WHERE t.project_id = :project_id AND t.status != 'done' AND tasks_fts MATCH :fts_term \
    UNION ALL \
    SELECT 'epic', e.id, e.key, e.title, bm25(epics_fts, :w0, :w1) \
    FROM epics_fts JOIN epics e ON e.rowid = epics_fts.rowid \
    WHERE e.project_id = :project_id AND e.status != 'done' AND epics_fts MATCH :fts_term \
    UNION ALL \
    SELECT 'issue', i.id, i.key, i.title, bm25(issues_fts, :w0, :w1) \
    FROM issues_fts JOIN issues i ON i.rowid = issues_fts.rowid \
    WHERE i.project_id = :project_id AND issues_fts MATCH :fts_term \
    UNION ALL \
    SELECT 'proposal', ap.id, NULL, \
        COALESCE( \
            json_extract(ap.payload, '$.title'), \
            json_extract(ap.payload, '$.statement'), \
            json_extract(ap.payload, '$.assumption'), \
            '(untitled proposal)' \
        ), \
        bm25(authoring_proposals_fts, :w0, :w1) \
    FROM authoring_proposals_fts JOIN authoring_proposals ap ON ap.rowid = authoring_proposals_fts.rowid \
    WHERE ap.project_id = :project_id \
        AND (:exclude_proposal_id IS NULL OR ap.id != :exclude_proposal_id) \
        AND authoring_proposals_fts MATCH :fts_term \
    ORDER BY score ASC, id ASC \
    LIMIT :limit";

/// Build the `:fts_term` [`duplicate_score_lookup`] binds — a bag-of-words disjunction, NOT one
/// literal phrase covering the whole text (plan 06-04 Task 2 finding, documented in
/// `06-04-SUMMARY.md` as a Rule 1 auto-fix): [`to_fts5_prefix_phrase`] wraps its ENTIRE argument
/// as ONE FTS5 phrase query, which requires the wrapped text to appear as an exact, contiguous
/// token run inside the matched row — verified empirically (a real `sqlite3` session) that a
/// genuinely reworded restatement of a multi-sentence title+body NEVER satisfies that, so calling
/// it once over the whole combined text can only ever match a near-verbatim copy, never "the same
/// finding, different wording" (Task 2's own `<behavior>` requirement). This function instead
/// calls [`to_fts5_prefix_phrase`] once PER WORD — reusing the SAME escaping routine Task 1 named
/// (`06-04-PLAN.md`: "never a second quote-doubling routine"), just once per token instead of once
/// over the whole blob — and `OR`s the results together, the standard bag-of-words shape a `bm25`
/// relevance ranking is built to score: a row sharing many of the same (especially rare, high-IDF)
/// words scores far more negative than a row sharing only a few common ones, which is exactly the
/// separation `DUPLICATE_BM25_THRESHOLD` is pinned against.
fn duplicate_match_term(text: &str) -> String {
    text.split_whitespace()
        .map(to_fts5_prefix_phrase)
        .collect::<Vec<_>>()
        .join(" OR ")
}

/// The one place [`DUPLICATE_BM25_THRESHOLD`]'s comparison lives, as its own named, exported
/// predicate (rather than inlined in [`duplicate_candidate_for`]) so `tests/proposal_duplicates.rs`
/// can assert the strict-less-than direction directly against the real comparison the production
/// code runs — "asserted directly against the comparison rather than inferred" (Task 2's own
/// `<behavior>` requirement) — without needing to engineer a database row whose measured score
/// lands exactly on the boundary.
pub fn is_flagged_as_duplicate(score: f64) -> bool {
    score < DUPLICATE_BM25_THRESHOLD
}

/// The raw lookup [`duplicate_candidate_for`] applies [`DUPLICATE_BM25_THRESHOLD`] to — runs
/// [`DUPLICATE_LOOKUP_SQL`] and returns the single best-scoring candidate across all four
/// corpora, with **no threshold applied**: any row FTS5 matches at all comes back, however weak.
/// `None` means nothing matched, for one of three reasons, all degraded identically rather than
/// erroring: `title`+`body` was empty/whitespace-only (nothing to search for), the corpus was
/// empty (nothing to match against), or the model-authored text was an FTS5 query-syntax
/// rejection (degrading to "no candidate found" exactly as [`search_items`] already does via
/// [`is_fts5_syntax_error`]).
///
/// Exported (not `pub(crate)`) so `tests/proposal_duplicates.rs` can measure the REAL,
/// unthresholded score distribution [`DUPLICATE_BM25_THRESHOLD`] is pinned against, through this
/// exact statement, rather than a second, driftable copy of it. [`duplicate_candidate_for`] is a
/// thin wrapper over this function applying the one threshold comparison — the "one boundary"
/// plan `06-04-PLAN.md`'s own action text requires.
pub fn duplicate_score_lookup(
    conn: &Connection,
    project_id: &str,
    exclude_proposal_id: Option<&str>,
    title: &str,
    body: Option<&str>,
) -> anyhow::Result<Option<DuplicateCandidate>> {
    let combined = match body {
        Some(body) if !body.trim().is_empty() => format!("{title} {body}"),
        _ => title.to_string(),
    };
    let trimmed = combined.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let fts_term = duplicate_match_term(trimmed);
    let (w0, w1) = DUPLICATE_BM25_WEIGHTS;

    let result = conn.query_row(
        DUPLICATE_LOOKUP_SQL,
        named_params! {
            ":project_id": project_id,
            ":fts_term": fts_term,
            ":exclude_proposal_id": exclude_proposal_id,
            ":w0": w0,
            ":w1": w1,
            ":limit": DUPLICATE_CANDIDATE_LIMIT,
        },
        |row| {
            Ok(DuplicateCandidate {
                kind: row.get(0)?,
                id: row.get(1)?,
                key: row.get(2)?,
                title: row.get(3)?,
                score: row.get(4)?,
            })
        },
    );

    match result {
        Ok(candidate) => Ok(Some(candidate)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => {
            let err = anyhow::Error::from(err).context("failed to look up a duplicate candidate");
            if is_fts5_syntax_error(&err) {
                Ok(None)
            } else {
                Err(err)
            }
        }
    }
}

/// Score `title`/`body` against every open task, epic and issue plus every proposal (pending and
/// decided alike) in `project_id`, returning the single best-scoring candidate strictly below
/// [`DUPLICATE_BM25_THRESHOLD`], or `None` when nothing scores that well — see
/// [`duplicate_score_lookup`] for the full degradation contract this wraps.
///
/// `exclude_proposal_id` is `None` when scoring a brand-new proposal at staging time (the row
/// does not exist yet, so nothing to exclude) and `Some(proposal_id)` when `amend_proposal`
/// re-scores an already-staged proposal against its own amended content, so it never matches
/// itself.
pub fn duplicate_candidate_for(
    conn: &Connection,
    project_id: &str,
    exclude_proposal_id: Option<&str>,
    title: &str,
    body: Option<&str>,
) -> anyhow::Result<Option<DuplicateCandidate>> {
    let candidate = duplicate_score_lookup(conn, project_id, exclude_proposal_id, title, body)?;
    Ok(candidate.filter(|c| is_flagged_as_duplicate(c.score)))
}
