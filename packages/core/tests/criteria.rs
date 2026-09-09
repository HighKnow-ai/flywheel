//! Behavior under test (01-06-PLAN.md Task 3 — the plan's own load-bearing prohibition: "a
//! criterion the user authored MUST NOT be silently dropped, reordered or rewritten as a side
//! effect of editing its parent item, changing the parent's status, or any bulk operation"):
//! - Two criteria created with the same `statement` text on one parent have two ids and two
//!   ranks, and both are returned by `list_criteria`.
//! - `list_criteria` on a parent with zero criteria returns an empty vector, and the board query
//!   reports `0`/`0` for that parent.
//! - `list_criteria`'s order is byte-identical (same id sequence) before and after toggling every
//!   criterion in the list.
//! - Reordering one criterion writes exactly one row: the other rows' `rank` and `updated_at` are
//!   unchanged.
//! - Editing the parent's title and then its status leaves every criterion row byte-identical —
//!   compared field by field, not merely counted.
//! - `create_criterion` against an issue returns a constraint error from the schema, not an
//!   application-layer guard.
//! - Deleting a parent deletes its criteria and appends one `criterion.deleted` event per
//!   deleted criterion.

use core::db::open_and_migrate;
use core::domain::acceptance_criterion::{
    create_criterion, delete_criterion, list_criteria, reorder_criterion, toggle_criterion,
};
use core::domain::actor::local_human_actor_id;
use core::domain::epic::create_epic;
use core::domain::issue::create_issue;
use core::domain::project::{self, Project};
use core::domain::task::{create_task, delete_task, set_task_status, update_task};
use core::query::{list_board, BoardFilter};
use rusqlite::Connection;

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Open a fresh migrated database and register one project (mirrors `hierarchy_workflow.rs`'s
/// and `outbox.rs`'s own `seeded_project` fixture).
fn seeded_project() -> (Connection, String, Project) {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    std::mem::forget(dir);

    let mut conn = open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let proj = project::create_project(&mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main")
        .expect("create_project should succeed");
    (conn, actor_id, proj)
}

fn count_rows(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
    conn.query_row(sql, params, |row| row.get(0))
        .expect("count query should succeed")
}

#[test]
fn duplicate_statements_stay_distinct() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Parent task", None)
        .expect("create_task should succeed");

    let first = create_criterion(
        &mut conn,
        &project.id,
        &actor_id,
        "task",
        &task.id,
        "Handles empty input",
        None,
    )
    .expect("create_criterion should succeed");
    let second = create_criterion(
        &mut conn,
        &project.id,
        &actor_id,
        "task",
        &task.id,
        "Handles empty input",
        None,
    )
    .expect("create_criterion should succeed");

    assert_ne!(first.id, second.id, "two creates must yield two distinct ids");
    assert_ne!(first.rank, second.rank, "two creates must yield two distinct ranks");

    let listed = list_criteria(&conn, "task", &task.id).expect("list_criteria should succeed");
    assert_eq!(listed.len(), 2, "both criteria must be returned by list_criteria");
    assert!(listed.iter().any(|c| c.id == first.id));
    assert!(listed.iter().any(|c| c.id == second.id));
}

#[test]
fn empty_parent_reports_zero_of_zero() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "No criteria yet", None)
        .expect("create_task should succeed");

    let listed = list_criteria(&conn, "task", &task.id).expect("list_criteria should succeed");
    assert!(listed.is_empty(), "a parent with zero criteria must return an empty vector");

    let window = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let row = window
        .items
        .iter()
        .find(|item| item.id == task.id)
        .expect("the task must appear in the board window");
    assert_eq!(row.criteria_checked, 0, "an item with zero criteria reports checked = 0");
    assert_eq!(row.criteria_total, 0, "an item with zero criteria reports total = 0");
}

#[test]
fn order_is_stable_across_toggles() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Ordered criteria", None)
        .expect("create_task should succeed");

    let a = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "A", None)
        .expect("create_criterion A");
    let b = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "B", None)
        .expect("create_criterion B");
    let c = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "C", None)
        .expect("create_criterion C");

    let before: Vec<String> = list_criteria(&conn, "task", &task.id)
        .expect("list_criteria should succeed")
        .into_iter()
        .map(|criterion| criterion.id)
        .collect();
    assert_eq!(before, vec![a.id.clone(), b.id.clone(), c.id.clone()]);

    // Toggle every criterion in the list.
    toggle_criterion(&mut conn, &actor_id, &a.id).expect("toggle A");
    toggle_criterion(&mut conn, &actor_id, &b.id).expect("toggle B");
    toggle_criterion(&mut conn, &actor_id, &c.id).expect("toggle C");

    let after: Vec<String> = list_criteria(&conn, "task", &task.id)
        .expect("list_criteria should succeed")
        .into_iter()
        .map(|criterion| criterion.id)
        .collect();
    assert_eq!(
        before, after,
        "the id sequence must be identical before and after toggling every criterion, not merely the same set"
    );
}

#[test]
fn reorder_writes_exactly_one_row() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Reorder me", None)
        .expect("create_task should succeed");

    let a = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "A", None)
        .expect("create_criterion A");
    let b = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "B", None)
        .expect("create_criterion B");
    let c = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "C", None)
        .expect("create_criterion C");

    let b_updated_at_before: String = conn
        .query_row(
            "SELECT updated_at FROM acceptance_criteria WHERE id = ?1",
            [&b.id],
            |row| row.get(0),
        )
        .expect("should read B's updated_at");
    let c_updated_at_before: String = conn
        .query_row(
            "SELECT updated_at FROM acceptance_criteria WHERE id = ?1",
            [&c.id],
            |row| row.get(0),
        )
        .expect("should read C's updated_at");

    // Move C between A and B.
    let reordered = reorder_criterion(&mut conn, &actor_id, &c.id, Some(&a.rank), Some(&b.rank))
        .expect("reorder_criterion should succeed");
    assert!(reordered.rank > a.rank, "C's new rank must sort after A");
    assert!(reordered.rank < b.rank, "C's new rank must sort before B");

    let b_updated_at_after: String = conn
        .query_row(
            "SELECT updated_at FROM acceptance_criteria WHERE id = ?1",
            [&b.id],
            |row| row.get(0),
        )
        .expect("should read B's updated_at");
    let b_rank_after: String = conn
        .query_row(
            "SELECT rank FROM acceptance_criteria WHERE id = ?1",
            [&b.id],
            |row| row.get(0),
        )
        .expect("should read B's rank");
    let c_updated_at_after: String = conn
        .query_row(
            "SELECT updated_at FROM acceptance_criteria WHERE id = ?1",
            [&c.id],
            |row| row.get(0),
        )
        .expect("should read C's updated_at");

    assert_eq!(b.rank, b_rank_after, "B's own rank must be untouched by C's reorder");
    assert_eq!(
        b_updated_at_before, b_updated_at_after,
        "B's updated_at must be untouched by C's reorder"
    );
    assert_ne!(
        c_updated_at_before, c_updated_at_after,
        "C's own updated_at must change as part of its own reorder"
    );
}

#[test]
fn parent_edit_leaves_criteria_untouched() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Original title", None)
        .expect("create_task should succeed");

    let criterion = create_criterion(
        &mut conn,
        &project.id,
        &actor_id,
        "task",
        &task.id,
        "Must not move",
        Some("cargo test -p core"),
    )
    .expect("create_criterion should succeed");

    let before = list_criteria(&conn, "task", &task.id)
        .expect("list_criteria should succeed")
        .into_iter()
        .find(|c| c.id == criterion.id)
        .expect("the criterion must be present before the parent edit");

    // Edit the parent's title, then its status — neither is a criterion mutation.
    update_task(&mut conn, &actor_id, &task.id, Some("Renamed title"), None)
        .expect("update_task should succeed");
    set_task_status(&mut conn, &actor_id, &task.id, "in_progress").expect("set_task_status should succeed");

    let after = list_criteria(&conn, "task", &task.id)
        .expect("list_criteria should succeed")
        .into_iter()
        .find(|c| c.id == criterion.id)
        .expect("the criterion must still be present after the parent edit");

    // Full field-by-field comparison — a silent rewrite would preserve the row count but change
    // a field, which asserting only `before.len() == after.len()` would miss entirely.
    assert_eq!(before, after, "editing the parent must leave every criterion field byte-identical");
}

#[test]
fn issue_cannot_carry_criteria() {
    let (mut conn, actor_id, project) = seeded_project();
    let issue = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Not a unit of work",
        None,
        "idea",
        None,
        None,
    )
    .expect("create_issue should succeed");

    let result = create_criterion(
        &mut conn,
        &project.id,
        &actor_id,
        "issue",
        &issue.id,
        "This should never be created",
        None,
    );
    let err = result.expect_err("creating a criterion against an issue must fail");
    let sqlite_err = err
        .downcast_ref::<rusqlite::Error>()
        .expect("the error must originate from the schema's CHECK constraint, not an application-layer guard");
    assert!(
        matches!(sqlite_err, rusqlite::Error::SqliteFailure(_, _)),
        "expected a SQLite constraint failure for parent_type = 'issue', got {sqlite_err:?}"
    );

    let remaining = count_rows(
        &conn,
        "SELECT COUNT(*) FROM acceptance_criteria WHERE parent_id = ?1",
        &[&issue.id],
    );
    assert_eq!(remaining, 0, "no criterion row must exist for the issue");
}

#[test]
fn deleting_a_parent_logs_each_removed_criterion() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Delete me with criteria", None)
        .expect("create_task should succeed");

    let a = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "A", None)
        .expect("create_criterion A");
    let b = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "B", None)
        .expect("create_criterion B");

    delete_task(&mut conn, &actor_id, &task.id).expect("delete_task should succeed");

    let remaining = count_rows(
        &conn,
        "SELECT COUNT(*) FROM acceptance_criteria WHERE parent_id = ?1",
        &[&task.id],
    );
    assert_eq!(remaining, 0, "deleting the parent must delete its criteria");

    for criterion_id in [&a.id, &b.id] {
        let deletion_events = count_rows(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'criterion.deleted'",
            &[criterion_id],
        );
        assert_eq!(
            deletion_events, 1,
            "deleting the parent must append exactly one criterion.deleted event per removed criterion"
        );
    }

    // The parent-level deletion also has its own recovery path: deleting an already-gone
    // criterion (e.g. a stale UI reference) must stay idempotent even after the parent is gone.
    delete_criterion(&mut conn, &actor_id, &a.id).expect("delete_criterion on an already-gone id must still return Ok");
}

#[test]
fn create_criterion_on_an_epic_is_also_supported() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Epic with a contract", None)
        .expect("create_epic should succeed");

    let criterion = create_criterion(
        &mut conn,
        &project.id,
        &actor_id,
        "epic",
        &epic.id,
        "The epic's own success criterion",
        None,
    )
    .expect("create_criterion against an epic should succeed (D-07)");

    let window = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let row = window
        .items
        .iter()
        .find(|item| item.id == epic.id)
        .expect("the epic must appear in the board window");
    assert_eq!(row.criteria_total, 1);
    assert_eq!(row.criteria_checked, 0);

    toggle_criterion(&mut conn, &actor_id, &criterion.id).expect("toggle should succeed");
    let window = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let row = window.items.iter().find(|item| item.id == epic.id).unwrap();
    assert_eq!(row.criteria_checked, 1, "the board query must reflect the toggle");
}
