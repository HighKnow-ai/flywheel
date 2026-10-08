//! `BoardFilter` — the typed filter set BOARD-06 requires (status, epic including the no-epic
//! bucket, assignee including unassigned, priority, estimate) and its translation into a single
//! parameterised SQL fragment shared by `list_board` and `search_items` (D-03: one definition of
//! a result set, one filter implementation, never a second one in the renderer).
//!
//! # Why one shared fragment, bound by named parameters, never string-interpolated
//!
//! Every dimension is either "unfiltered" (bind SQL `NULL`) or "restricted to this set" (bind a
//! JSON array). The WHERE text itself therefore never changes shape based on how many values a
//! filter carries — `[SELECT value FROM json_each(:x)]` is a fixed SQL idiom that works for a
//! one-element, five-element or empty array identically, so the fragment below is a single
//! `concat!`-built compile-time string literal, never assembled per-call with runtime string
//! interpolation (T-01-23: no renderer-supplied value can ever change which column, which
//! operator or which clause this query runs — only which values it compares against).
//! `json_each(NULL)` is well-defined in SQLite: it yields zero rows rather than erroring, so the
//! `IS NULL OR` guard is defence-in-depth documentation, not load-bearing correctness (verified
//! empirically against the bundled SQLite version before this fragment was written).
//!
//! No-epic and unassigned are encoded as the empty string `""` inside the same JSON array as any
//! selected epic/assignee id, via `COALESCE(b.epic_id, '')`/`COALESCE(b.assignee_id, '')` — a
//! real ULID id is never empty, so this can never collide with an actual id, and it means the
//! "include the null bucket" case needs no separate flag or fragment (`BoardFilter` still exposes
//! it as its own explicit `EpicSelector::NoEpic`/`AssigneeSelector::Unassigned` variant, never a
//! bare `NULL` comparison the caller has to know to write themselves).

use serde::Serialize;

/// One selector in an epic filter's value set — `NoEpic` is `tasks.epic_id IS NULL` (D-13's
/// orphan-task bucket), never reached by a bare `NULL` comparison the caller has to spell out.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum EpicSelector {
    NoEpic,
    Epic(String),
}

/// One selector in an assignee filter's value set — `Unassigned` is `assignee_id IS NULL`
/// (BOARD-06's "including Unassigned").
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum AssigneeSelector {
    Unassigned,
    Assignee(String),
}

/// The typed filter set (BOARD-06). Every field is `None` by default ("this dimension is
/// unfiltered") — `BoardFilter::default()` is the unfiltered board, byte-for-byte the same
/// window `list_board` always returned before this plan (verified by
/// `empty_term_returns_the_unfiltered_window` in `tests/search_filter.rs`).
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BoardFilter {
    pub statuses: Option<Vec<String>>,
    pub epics: Option<Vec<EpicSelector>>,
    pub assignees: Option<Vec<AssigneeSelector>>,
    pub priorities: Option<Vec<i64>>,
    pub estimates: Option<Vec<i64>>,
    /// D-17: restrict to rows that have an active worktree (08.1-AMENDMENTS.md A-04: an epic row
    /// counts when any of its child tasks does). `false` is "this dimension is unfiltered" — there
    /// is deliberately no "only rows WITHOUT a worktree" reading, because nothing asks for one.
    pub has_worktree: bool,
}

/// The pre-serialised form of a `BoardFilter`, bound directly as named parameters
/// (`:status_json`, `:epic_json`, `:assignee_json`, `:priority_json`, `:estimate_json`) into
/// every query in this crate that includes `FILTER_WHERE`. `None` binds SQL `NULL` ("this
/// dimension is unfiltered"); `Some(json)` binds the dimension's value set as a JSON array.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FilterBinding {
    pub status_json: Option<String>,
    pub epic_json: Option<String>,
    pub assignee_json: Option<String>,
    pub priority_json: Option<String>,
    pub estimate_json: Option<String>,
    /// `Some(1)` restricts to rows with an active worktree; `None` binds SQL `NULL` (unfiltered).
    pub has_worktree: Option<i64>,
}

fn to_json<T: Serialize>(values: &[T]) -> String {
    serde_json::to_string(values).expect("a Vec<String>/Vec<i64> always serialises to JSON")
}

/// Translate a `BoardFilter` into its bound-parameter form. Never builds SQL text — only values.
pub fn apply_filter(filter: &BoardFilter) -> FilterBinding {
    FilterBinding {
        status_json: filter.statuses.as_ref().map(|v| to_json(v)),
        epic_json: filter.epics.as_ref().map(|selectors| {
            let keys: Vec<String> = selectors
                .iter()
                .map(|s| match s {
                    EpicSelector::NoEpic => String::new(),
                    EpicSelector::Epic(id) => id.clone(),
                })
                .collect();
            to_json(&keys)
        }),
        assignee_json: filter.assignees.as_ref().map(|selectors| {
            let keys: Vec<String> = selectors
                .iter()
                .map(|s| match s {
                    AssigneeSelector::Unassigned => String::new(),
                    AssigneeSelector::Assignee(id) => id.clone(),
                })
                .collect();
            to_json(&keys)
        }),
        priority_json: filter.priorities.as_ref().map(|v| to_json(v)),
        estimate_json: filter.estimates.as_ref().map(|v| to_json(v)),
        has_worktree: filter.has_worktree.then_some(1),
    }
}

/// The shared WHERE fragment every filtered query in `query/mod.rs` and `query/search.rs`
/// appends after its own `b.project_id = :project_id` clause. Composes with a leading `AND`.
/// Every fragment is satisfiable against a row already selected via the
/// `(project_id, status, rank)` / `(project_id, epic_id)` indexes — this fragment only narrows
/// the already-indexed row set further, it never widens the scan (T-01-23).
pub const FILTER_WHERE: &str = concat!(
    "(:status_json IS NULL OR b.status IN (SELECT value FROM json_each(:status_json)))",
    " AND (:epic_json IS NULL OR COALESCE(b.epic_id, '') IN (SELECT value FROM json_each(:epic_json)))",
    " AND (:assignee_json IS NULL OR COALESCE(b.assignee_id, '') IN (SELECT value FROM json_each(:assignee_json)))",
    " AND (:priority_json IS NULL OR b.priority IN (SELECT value FROM json_each(:priority_json)))",
    " AND (:estimate_json IS NULL OR COALESCE(b.estimate, 0) IN (SELECT value FROM json_each(:estimate_json)))",
);
