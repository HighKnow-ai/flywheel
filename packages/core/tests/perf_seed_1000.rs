//! Behavior under test (01-08-PLAN.md Task 3 — BOARD-08 at scale, 01-UI-SPEC.md "Performance
//! Contract"):
//! - At 1,000 items, an unfiltered board window, a text search, and a combined status+assignee
//!   filter each return in under 50ms server-side.
//! - The board window's query plan names a composite `(project_id, ...)` index rather than
//!   falling back to a full table scan.
//!
//! The 50ms budget is `01-UI-SPEC.md` "Performance Contract"'s own number
//! ("Search-to-result (Rust core query itself): under 50ms server-side at 1,000+ items"). This
//! machine's actual timings are printed via `--nocapture` so a slower CI runner's numbers are
//! visible rather than swallowed by a bare pass/fail.

mod common;

use std::time::Instant;

use core::query::filter::{AssigneeSelector, BoardFilter};
use core::query::search::search_items;
use core::query::list_board;

use common::seed_project;

const BUDGET_MS: u128 = 50;

fn fresh_seeded_1000() -> (rusqlite::Connection, String) {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    std::mem::forget(dir);

    let mut conn =
        core::db::open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let project_id = seed_project(&mut conn, 1000).expect("seed_project should succeed");
    (conn, project_id)
}

#[test]
fn search_at_1000_items_is_under_50ms() {
    let (conn, project_id) = fresh_seeded_1000();

    let start = Instant::now();
    let window = list_board(&conn, &project_id, &BoardFilter::default(), 200, None)
        .expect("list_board should succeed");
    let unfiltered_ms = start.elapsed().as_millis();
    println!("unfiltered list_board at 1,000 items: {unfiltered_ms}ms");
    assert!(!window.items.is_empty());
    assert!(
        unfiltered_ms < BUDGET_MS,
        "unfiltered list_board took {unfiltered_ms}ms, budget is {BUDGET_MS}ms"
    );

    let start = Instant::now();
    let search_window = search_items(&conn, &project_id, "item 05", &BoardFilter::default(), 200, None)
        .expect("search_items should succeed");
    let search_ms = start.elapsed().as_millis();
    println!("text search at 1,000 items: {search_ms}ms");
    assert!(!search_window.items.is_empty(), "the seeded titles must be discriminable by search");
    assert!(search_ms < BUDGET_MS, "search_items took {search_ms}ms, budget is {BUDGET_MS}ms");

    let combined_filter = BoardFilter {
        statuses: Some(vec!["backlog".to_string(), "todo".to_string()]),
        assignees: Some(vec![AssigneeSelector::Unassigned]),
        ..BoardFilter::default()
    };
    let start = Instant::now();
    let filtered_window = list_board(&conn, &project_id, &combined_filter, 200, None)
        .expect("list_board with combined filter should succeed");
    let filter_ms = start.elapsed().as_millis();
    println!("combined status+assignee filter at 1,000 items: {filter_ms}ms");
    let _ = filtered_window;
    assert!(
        filter_ms < BUDGET_MS,
        "combined status+assignee filter took {filter_ms}ms, budget is {BUDGET_MS}ms"
    );
}

#[test]
fn board_window_uses_the_composite_index() {
    let (conn, project_id) = fresh_seeded_1000();

    let plan_rows: Vec<String> = conn
        .prepare(
            "EXPLAIN QUERY PLAN
             SELECT b.id FROM (
                 SELECT id, status, rank, priority FROM epics WHERE project_id = ?1
                 UNION ALL
                 SELECT id, status, rank, priority FROM tasks WHERE project_id = ?1
             ) b
             ORDER BY b.rank ASC
             LIMIT 200",
        )
        .expect("prepare EXPLAIN QUERY PLAN")
        .query_map([&project_id], |row| row.get::<_, String>(3))
        .expect("query_map EXPLAIN QUERY PLAN")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect EXPLAIN QUERY PLAN rows");

    let plan_text = plan_rows.join("\n");
    println!("board window query plan:\n{plan_text}");

    assert!(
        plan_text.contains("idx_epics_project"),
        "the epics arm must use a project-scoped composite index, plan was:\n{plan_text}"
    );
    assert!(
        plan_text.contains("idx_tasks_project"),
        "the tasks arm must use a project-scoped composite index, plan was:\n{plan_text}"
    );
    // SQLite's plan output uses "SEARCH <table> USING INDEX ..." for an indexed access path and
    // "SCAN <table>" (no "USING INDEX") for a full table scan — indexed access never emits the
    // bare "SCAN epics"/"SCAN tasks" text this asserts is absent.
    assert!(
        !plan_text.contains("SCAN epics"),
        "the epics arm must not be a full-table scan, plan was:\n{plan_text}"
    );
    assert!(
        !plan_text.contains("SCAN tasks"),
        "the tasks arm must not be a full-table scan, plan was:\n{plan_text}"
    );
}
