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

/// D-82/BOARD-08 (plan 05-08, Task 1): the board-level triage lane's own read stays inside the
/// SAME 50ms budget at the SAME 1,000-item order of magnitude the board window already holds
/// itself to — and populating the lane must not regress `list_board`'s own budget either.
/// `authoring_proposals` carries no FTS sync trigger (unlike `tasks`), so a bulk `INSERT` here
/// does not reintroduce the sync pitfall `seed_project`'s own header comment names for tasks.
#[test]
fn pending_proposals_lane_at_1000_items_stays_under_budget() {
    let (mut conn, project_id) = fresh_seeded_1000();

    let human_actor_id = core::domain::actor::local_human_actor_id(&conn)
        .expect("the seeded human actor should exist");
    let run = core::domain::authoring_session::start_authoring_run(
        &mut conn,
        &project_id,
        None,
        "default",
        &human_actor_id,
    )
    .expect("start_authoring_run should succeed");

    let now = "2026-01-01T00:00:00.000Z";
    let tx = conn.transaction().expect("failed to open a fixture transaction");
    for i in 0..1000 {
        let id = core::ids::new_id();
        let position = format!("{i:08}");
        let payload =
            serde_json::json!({ "kind": "task", "title": format!("proposed task {i}") }).to_string();
        tx.execute(
            "INSERT INTO authoring_proposals (
                id, agent_run_id, project_id, epic_id, verb, target_type, target_id,
                parent_proposal_id, position, payload, status, rejection_reason, materialised_id,
                created_by, created_at, decided_by, decided_at
            ) VALUES (?1, ?2, ?3, NULL, 'create', 'task', NULL, NULL, ?4, ?5, 'pending', NULL, NULL, ?6, ?7, NULL, NULL)",
            rusqlite::params![id, run.id, project_id, position, payload, human_actor_id, now],
        )
        .expect("failed to insert a fixture proposal");
    }
    tx.commit().expect("failed to commit fixture proposals");

    let start = Instant::now();
    let window = core::query::authoring::list_pending_proposals(&conn, &project_id, 200, None)
        .expect("list_pending_proposals should succeed");
    let lane_ms = start.elapsed().as_millis();
    println!("pending-proposals lane at 1,000 proposals: {lane_ms}ms");
    assert_eq!(window.proposals.len(), 200);
    assert_eq!(window.counts.pending, 1000);
    assert!(
        lane_ms < BUDGET_MS,
        "list_pending_proposals took {lane_ms}ms, budget is {BUDGET_MS}ms"
    );

    // BOARD-08: the board's own 1,000-item budget must hold unaffected by a populated proposal
    // lane — this is the regression this task's own <verify> gate exists to catch.
    let start = Instant::now();
    let board_window = list_board(&conn, &project_id, &BoardFilter::default(), 200, None)
        .expect("list_board should succeed");
    let board_ms = start.elapsed().as_millis();
    println!("unfiltered list_board at 1,000 items with a populated proposal lane: {board_ms}ms");
    assert!(!board_window.items.is_empty());
    assert!(
        board_ms < BUDGET_MS,
        "list_board took {board_ms}ms with a populated proposal lane, budget is {BUDGET_MS}ms"
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
