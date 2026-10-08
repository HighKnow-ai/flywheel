//! Behavior under test (01-08-PLAN.md Task 3 — search and filter correctness, BOARD-06):
//! - A term equal to a full title matches it, and a prefix of the title also matches it.
//! - Terms containing FTS5-special punctuation (a double quote, an asterisk, a hyphen, a colon)
//!   and non-ASCII content (accented Latin, CJK, emoji) all return without error, matching real
//!   rows where the tokenizer recognizes the content as words.
//! - An empty/whitespace-only search term returns the same window `list_board` returns.
//! - A filter set matching nothing returns zero rows with a zero total.
//! - Filtering never reorders — the filtered result preserves the unfiltered priority-then-rank-
//!   then-id order for the rows it shares with it.
//! - `list_board` behaves identically at 999, 1,000 and 1,001 items — no row-count threshold
//!   switches strategy.
//! - Paging by cursor through 1,000 seeded rows visits every id exactly once.
//! - Editing a task's title changes what a search for that title matches (the FTS sync triggers
//!   fire on an ordinary `UPDATE`, not only on `INSERT`).
//! - The has-a-worktree dimension (08.1-08, D-17): off is the unfiltered board; on keeps a task
//!   only while it has an ACTIVE worktree; an epic row follows amendment A-04 (it matches when any
//!   child task does); it composes with the other dimensions; and every one of the six
//!   named-parameter sites (list x3, search x3) binds it.

mod common;

use core::domain::epic::create_epic;
use core::domain::task::{create_task, update_task};
use core::ids::new_id;
use core::query::filter::{AssigneeSelector, BoardFilter, EpicSelector};
use core::query::search::search_items;
use core::query::{list_board, priority_sort_key, status_sort_key, BoardCursor, BoardWindow};
use rusqlite::{params, Connection};
use std::collections::HashSet;

use common::{seed_project, seeded_project};

#[test]
fn exact_and_prefix_terms_both_match() {
    let (mut conn, actor_id, proj) = seeded_project();
    let task = create_task(&mut conn, &proj.id, &actor_id, "Fix crash on quit", None)
        .expect("create_task should succeed");

    let full = search_items(&conn, &proj.id, "Fix crash on quit", &BoardFilter::default(), 200, None)
        .expect("full-title search should succeed");
    assert_eq!(full.items.iter().filter(|i| i.id == task.id).count(), 1);

    let prefix = search_items(&conn, &proj.id, "Fix crash", &BoardFilter::default(), 200, None)
        .expect("prefix search should succeed");
    let matches: Vec<_> = prefix.items.iter().filter(|i| i.id == task.id).collect();
    assert_eq!(matches.len(), 1, "a prefix of the title must match the row exactly once");
}

#[test]
fn punctuation_and_unicode_terms_do_not_error() {
    let (mut conn, actor_id, proj) = seeded_project();

    let cases: &[(&str, &str)] = &[
        ("He said \"hello\" today", "\"hello\""),
        ("Rated five stars: 5*", "5*"),
        ("multi-word compound term", "multi-word"),
        ("fix bug: crash on exit", "bug:"),
        ("Café résumé review", "Café"),
        ("日本語 のテスト用アイテム", "日本語"),
        ("great work 🎉 done well", "🎉"),
    ];

    for &(title, term) in cases {
        let task = create_task(&mut conn, &proj.id, &actor_id, title, None)
            .expect("create_task should succeed");
        let result = search_items(&conn, &proj.id, term, &BoardFilter::default(), 200, None);
        assert!(result.is_ok(), "search for {term:?} must not error");
        let window = result.unwrap();
        // The emoji case is expected to tokenize away entirely under the default FTS5
        // tokenizer (verified empirically) — every other case's term is recognized as a real
        // token by the tokenizer and must match the row it came from.
        if term != "🎉" {
            assert!(
                window.items.iter().any(|i| i.id == task.id),
                "search for {term:?} should match the row titled {title:?}"
            );
        }
    }
}

#[test]
fn empty_term_returns_the_unfiltered_window() {
    let (mut conn, actor_id, proj) = seeded_project();
    create_task(&mut conn, &proj.id, &actor_id, "Alpha task", None).unwrap();
    create_task(&mut conn, &proj.id, &actor_id, "Beta task", None).unwrap();

    let unfiltered =
        list_board(&conn, &proj.id, &BoardFilter::default(), 200, None).expect("list_board");
    let empty_term = search_items(&conn, &proj.id, "", &BoardFilter::default(), 200, None)
        .expect("empty-term search");
    let whitespace_term = search_items(&conn, &proj.id, "   ", &BoardFilter::default(), 200, None)
        .expect("whitespace-term search");

    let unfiltered_ids: Vec<&str> = unfiltered.items.iter().map(|i| i.id.as_str()).collect();
    let empty_ids: Vec<&str> = empty_term.items.iter().map(|i| i.id.as_str()).collect();
    let whitespace_ids: Vec<&str> = whitespace_term.items.iter().map(|i| i.id.as_str()).collect();

    assert_eq!(unfiltered_ids, empty_ids, "an empty term must return the same window as list_board");
    assert_eq!(
        unfiltered_ids, whitespace_ids,
        "a whitespace-only term must return the same window as list_board"
    );
}

#[test]
fn no_match_returns_zero_with_a_zero_total() {
    let (mut conn, actor_id, proj) = seeded_project();
    create_task(&mut conn, &proj.id, &actor_id, "Only task here", None).unwrap();

    let epic_filter = BoardFilter {
        epics: Some(vec![EpicSelector::Epic("no-such-epic-id".to_string())]),
        ..BoardFilter::default()
    };
    let window =
        list_board(&conn, &proj.id, &epic_filter, 200, None).expect("list_board with epic filter");
    assert!(window.items.is_empty());
    assert_eq!(window.counts.total(), 0);

    // The assignee dimension carries the same "no match" contract — a made-up assignee id
    // narrows to zero rows exactly like a made-up epic id does, never silently ignored.
    let assignee_filter = BoardFilter {
        assignees: Some(vec![AssigneeSelector::Assignee("no-such-actor-id".to_string())]),
        ..BoardFilter::default()
    };
    let window = list_board(&conn, &proj.id, &assignee_filter, 200, None)
        .expect("list_board with assignee filter");
    assert!(window.items.is_empty());
    assert_eq!(window.counts.total(), 0);
}

#[test]
fn filtering_preserves_order() {
    let (mut conn, _actor_id, _proj) = seeded_project();
    // `seed_project` registers its own project on this same connection (distinct from
    // `seeded_project`'s already-created one) — its varied priority/status spread is what makes
    // this test meaningful.
    let project_id = seed_project(&mut conn, 60).expect("seed_project should succeed");

    let unfiltered = list_board(&conn, &project_id, &BoardFilter::default(), 500, None)
        .expect("list_board unfiltered");
    let filter = BoardFilter {
        statuses: Some(vec!["backlog".to_string()]),
        ..BoardFilter::default()
    };
    let filtered =
        list_board(&conn, &project_id, &filter, 500, None).expect("list_board filtered");

    let expected: Vec<&str> = unfiltered
        .items
        .iter()
        .filter(|i| i.status == "backlog")
        .map(|i| i.id.as_str())
        .collect();
    let actual: Vec<&str> = filtered.items.iter().map(|i| i.id.as_str()).collect();

    assert_eq!(actual, expected, "a status filter must preserve the unfiltered relative order");
}

#[test]
fn window_path_is_identical_at_999_1000_and_1001() {
    for n in [999usize, 1000, 1001] {
        let (conn_holder_dir, db_path, backups_dir) = common_scratch();
        let mut conn = core::db::open_and_migrate(&db_path, &backups_dir)
            .expect("open_and_migrate should succeed");
        let project_id = seed_project(&mut conn, n).expect("seed_project should succeed");

        let window = list_board(&conn, &project_id, &BoardFilter::default(), 2000, None)
            .expect("list_board should succeed");
        assert_eq!(
            window.items.len(),
            n,
            "list_board must return every seeded row when the limit exceeds the total"
        );
        std::mem::forget(conn_holder_dir);
    }
}

#[test]
fn cursor_paging_covers_every_row_once() {
    let (conn_holder_dir, db_path, backups_dir) = common_scratch();
    let mut conn =
        core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let project_id = seed_project(&mut conn, 1000).expect("seed_project should succeed");

    let mut seen: HashSet<String> = HashSet::new();
    let mut cursor: Option<BoardCursor> = None;
    let page_size = 137;
    loop {
        let window = list_board(&conn, &project_id, &BoardFilter::default(), page_size, cursor.as_ref())
            .expect("list_board page should succeed");
        if window.items.is_empty() {
            break;
        }
        for item in &window.items {
            assert!(seen.insert(item.id.clone()), "row {} visited twice", item.id);
        }
        let last = window.items.last().unwrap();
        cursor = Some(BoardCursor {
            status_sort_key: status_sort_key(&last.status),
            priority_sort_key: priority_sort_key(last.priority),
            rank: last.rank.clone(),
            id: last.id.clone(),
        });
        if window.items.len() < page_size as usize {
            break;
        }
    }

    assert_eq!(seen.len(), 1000, "cursor paging must visit exactly the 1,000 seeded rows");
    std::mem::forget(conn_holder_dir);
}

#[test]
fn title_edit_updates_what_search_matches() {
    let (mut conn, actor_id, proj) = seeded_project();
    let task = create_task(&mut conn, &proj.id, &actor_id, "Original searchable title", None)
        .expect("create_task should succeed");

    let before = search_items(&conn, &proj.id, "Original searchable", &BoardFilter::default(), 200, None)
        .expect("search before edit");
    assert!(before.items.iter().any(|i| i.id == task.id));

    update_task(&mut conn, &actor_id, &task.id, Some("Renamed distinctive title"), None)
        .expect("update_task should succeed");

    let after_old_term =
        search_items(&conn, &proj.id, "Original searchable", &BoardFilter::default(), 200, None)
            .expect("search after edit, old term");
    assert!(
        !after_old_term.items.iter().any(|i| i.id == task.id),
        "the old title must no longer match after the FTS sync trigger fires"
    );

    let after_new_term =
        search_items(&conn, &proj.id, "Renamed distinctive", &BoardFilter::default(), 200, None)
            .expect("search after edit, new term");
    assert!(
        after_new_term.items.iter().any(|i| i.id == task.id),
        "the new title must match after the FTS sync trigger fires"
    );
}

/// A helper mirroring `common::scratch_dir` but also returning the would-be db/backups paths,
/// for tests that need a fresh database per iteration (unlike `seeded_project`, which is a single
/// shared fixture).
fn common_scratch() -> (tempfile::TempDir, std::path::PathBuf, std::path::PathBuf) {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    (dir, db_path, backups_dir)
}

// ---------------------------------------------------------------------------------------------
// has_worktree (08.1-08, D-17). Epic semantics: 08.1-AMENDMENTS.md A-04 — an epic row matches
// when ANY of its child tasks has an active worktree (the owner's `any-child` reading).
// ---------------------------------------------------------------------------------------------

struct WtBoard {
    conn: Connection,
    project_id: String,
    epic_live: String,
    epic_stale: String,
    epic_empty: String,
    live_task: String,
    idle_task: String,
    stale_task: String,
    orphan_live: String,
    orphan_idle: String,
    stale_wt_id: String,
}

impl WtBoard {
    fn worktree(conn: &Connection, project_id: &str, actor: &str, task: &str, status: &str) -> String {
        let id = new_id();
        conn.execute(
            "INSERT INTO worktrees (id, task_id, project_id, path, branch, base_branch, status, created_by, created_at)
             VALUES (?1, ?2, ?3, '/nonexistent/worktree', ?4, 'main', ?5, ?6, '2026-01-01T00:00:00.000Z')",
            params![id, task, project_id, format!("flywheel/{task}"), status, actor],
        )
        .expect("insert worktree row");
        id
    }

    /// Every title carries "probe" so one search term reaches all eight rows.
    fn new() -> Self {
        let (mut conn, actor, proj) = seeded_project();
        let p = proj.id.clone();
        let epic_live = create_epic(&mut conn, &p, &actor, "probe epic live", None).unwrap().id;
        let epic_stale = create_epic(&mut conn, &p, &actor, "probe epic stale", None).unwrap().id;
        let epic_empty = create_epic(&mut conn, &p, &actor, "probe epic empty", None).unwrap().id;
        let mk = |conn: &mut Connection, title: &str, epic: Option<&str>| {
            create_task(conn, &p, &actor, title, epic).unwrap().id
        };
        let live_task = mk(&mut conn, "probe task live", Some(&epic_live));
        let idle_task = mk(&mut conn, "probe task idle", Some(&epic_live));
        let stale_task = mk(&mut conn, "probe task stale", Some(&epic_stale));
        let orphan_live = mk(&mut conn, "probe orphan live", None);
        let orphan_idle = mk(&mut conn, "probe orphan idle", None);
        Self::worktree(&conn, &p, &actor, &live_task, "active");
        let stale_wt_id = Self::worktree(&conn, &p, &actor, &stale_task, "stale");
        Self::worktree(&conn, &p, &actor, &orphan_live, "active");
        WtBoard {
            conn, project_id: p, epic_live, epic_stale, epic_empty, live_task, idle_task,
            stale_task, orphan_live, orphan_idle, stale_wt_id,
        }
    }

    fn live_filter() -> BoardFilter {
        BoardFilter { has_worktree: true, ..BoardFilter::default() }
    }
}

fn ids(window: &BoardWindow) -> HashSet<String> {
    window.items.iter().map(|i| i.id.clone()).collect()
}

fn cursor_after(window: &BoardWindow) -> BoardCursor {
    let last = window.items.last().expect("a page to resume from");
    BoardCursor {
        status_sort_key: status_sort_key(&last.status),
        priority_sort_key: priority_sort_key(last.priority),
        rank: last.rank.clone(),
        id: last.id.clone(),
    }
}

#[test]
fn has_worktree_unset_is_the_unfiltered_board() {
    let b = WtBoard::new();
    let unset = list_board(&b.conn, &b.project_id, &BoardFilter::default(), 200, None).unwrap();
    // 3 epics + 5 tasks, none dropped by an unset dimension.
    assert_eq!(unset.items.len(), 8);
    assert_eq!(unset.counts.total(), 8);
    assert!(ids(&unset).contains(&b.idle_task) && ids(&unset).contains(&b.epic_empty));
}

#[test]
fn has_worktree_keeps_a_task_only_when_it_has_an_active_worktree() {
    let b = WtBoard::new();
    let got = ids(&list_board(&b.conn, &b.project_id, &WtBoard::live_filter(), 200, None).unwrap());
    assert!(got.contains(&b.live_task), "a task with an active worktree is included");
    assert!(got.contains(&b.orphan_live), "an orphan task with an active worktree is included");
    assert!(!got.contains(&b.idle_task), "a task with no worktree is excluded");
    assert!(!got.contains(&b.orphan_idle), "an orphan task with no worktree is excluded");
}

#[test]
fn has_worktree_ignores_a_worktree_that_is_not_active() {
    let b = WtBoard::new();
    for status in ["stale", "merged", "abandoned", "missing"] {
        b.conn
            .execute("UPDATE worktrees SET status = ?1 WHERE id = ?2", params![status, b.stale_wt_id])
            .unwrap();
        let window = list_board(&b.conn, &b.project_id, &WtBoard::live_filter(), 200, None).unwrap();
        assert!(!ids(&window).contains(&b.stale_task), "a {status} worktree must not count");
        assert!(!ids(&window).contains(&b.epic_stale), "nor must it make its epic match ({status})");
    }
}

#[test]
fn has_worktree_epic_row_follows_amendment_a04_any_child() {
    let b = WtBoard::new();
    let window = list_board(&b.conn, &b.project_id, &WtBoard::live_filter(), 200, None).unwrap();
    let got = ids(&window);
    assert!(got.contains(&b.epic_live), "A-04: an epic matches when any child task has an active worktree");
    assert!(!got.contains(&b.epic_stale), "A-04: a child whose worktree is not active does not count");
    assert!(!got.contains(&b.epic_empty), "A-04: an epic with no children has nothing to match");
    // 2 matching tasks under epics/orphans + the one matching epic.
    assert_eq!(got.len(), 3);
    assert_eq!(window.counts.total(), 3, "band counts follow the same rule as the rows");
}

#[test]
fn has_worktree_composes_with_the_other_dimensions() {
    let b = WtBoard::new();
    let by_epic = BoardFilter {
        epics: Some(vec![EpicSelector::Epic(b.epic_live.clone())]),
        ..WtBoard::live_filter()
    };
    let got = ids(&list_board(&b.conn, &b.project_id, &by_epic, 200, None).unwrap());
    assert_eq!(got, HashSet::from([b.live_task.clone()]), "epic AND has_worktree both apply");

    let by_status = BoardFilter { statuses: Some(vec!["done".to_string()]), ..WtBoard::live_filter() };
    let window = list_board(&b.conn, &b.project_id, &by_status, 200, None).unwrap();
    assert!(window.items.is_empty() && window.counts.total() == 0, "status AND has_worktree both apply");
}

#[test]
fn has_worktree_is_bound_at_all_six_named_parameter_sites() {
    let b = WtBoard::new();
    let f = WtBoard::live_filter();
    let want: HashSet<String> =
        HashSet::from([b.epic_live.clone(), b.live_task.clone(), b.orphan_live.clone()]);

    // list x3: first page, cursored next page, band counts.
    let first = list_board(&b.conn, &b.project_id, &f, 1, None).unwrap();
    assert_eq!(first.items.len(), 1);
    let second = list_board(&b.conn, &b.project_id, &f, 200, Some(&cursor_after(&first))).unwrap();
    let mut seen = ids(&first);
    seen.extend(ids(&second));
    assert_eq!(seen, want, "list: first page + cursored page cover exactly the matches");
    assert_eq!(first.counts.total(), 3, "list: band counts bind the dimension");

    // search x3: first page, cursored next page, band counts.
    let s_first = search_items(&b.conn, &b.project_id, "probe", &f, 1, None).unwrap();
    assert_eq!(s_first.items.len(), 1);
    let s_second =
        search_items(&b.conn, &b.project_id, "probe", &f, 200, Some(&cursor_after(&s_first))).unwrap();
    let mut s_seen = ids(&s_first);
    s_seen.extend(ids(&s_second));
    assert_eq!(s_seen, want, "search: first page + cursored page cover exactly the matches");
    assert_eq!(s_first.counts.total(), 3, "search: band counts bind the dimension");
}
