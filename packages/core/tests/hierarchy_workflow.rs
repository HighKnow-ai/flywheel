//! Behavior under test (01-04-PLAN.md Task 3 — the fixed hierarchy and the fixed workflow):
//! - Deleting a task twice returns `Ok` both times and leaves exactly one deletion event.
//! - Creating two tasks with the same title yields two rows with two ids and two distinct keys.
//! - Two sequential `create_task` calls never produce the same key; the counter and the insert
//!   share one transaction.
//! - Setting a task's status to its current value leaves `updated_at` unchanged and adds no
//!   event.
//! - An `UPDATE tasks SET status = ''` and an `UPDATE tasks SET status = 'archived'` both return
//!   an error from the CHECK constraint.
//! - `WORKFLOW_STATES` has exactly five entries in the order backlog, todo, in_progress,
//!   in_review, done.
//! - Creating an issue and reading it back shows no status field.
//! - Deleting an epic leaves its child tasks present with `epic_id` NULL, and they still appear
//!   in the board query.

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::epic::{create_epic, delete_epic};
use core::domain::issue::create_issue;
use core::domain::project::{self, Project};
use core::domain::task::{create_task, delete_task, set_task_status};
use core::domain::WORKFLOW_STATES;
use core::query::list_board;
use rusqlite::{params, Connection};

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Open a fresh migrated database and register one project, returning the open connection, the
/// local human actor id, and the registered project — the fixture every test in this file starts
/// from (mirrors `outbox.rs`'s `seeded_project` fixture, plan 01-03 Task 3).
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
fn delete_is_idempotent() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Delete me", None)
        .expect("create_task should succeed");

    delete_task(&mut conn, &actor_id, &task.id).expect("first delete should succeed");
    delete_task(&mut conn, &actor_id, &task.id).expect("second delete should also return Ok");

    let deletion_events = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.deleted'",
        &[&task.id],
    );
    assert_eq!(
        deletion_events, 1,
        "deleting an already-deleted task must not append a second deletion event"
    );

    let remaining = count_rows(&conn, "SELECT COUNT(*) FROM tasks WHERE id = ?1", &[&task.id]);
    assert_eq!(remaining, 0, "the task row must be gone after delete");
}

#[test]
fn duplicate_titles_get_distinct_keys() {
    let (mut conn, actor_id, project) = seeded_project();

    let first = create_task(&mut conn, &project.id, &actor_id, "Same title", None)
        .expect("create_task should succeed");
    let second = create_task(&mut conn, &project.id, &actor_id, "Same title", None)
        .expect("create_task should succeed");

    assert_ne!(first.id, second.id, "two creates must yield two distinct ids");
    assert_ne!(
        first.key, second.key,
        "two creates with the same title must still get two distinct keys"
    );
}

#[test]
fn key_allocation_never_collides() {
    let (mut conn, actor_id, project) = seeded_project();

    let a = create_task(&mut conn, &project.id, &actor_id, "A", None).expect("create_task A");
    let b = create_task(&mut conn, &project.id, &actor_id, "B", None).expect("create_task B");

    assert_ne!(a.key, b.key, "sequential creates must never allocate the same key");
    assert_eq!(a.key, format!("{}-1", project.key_prefix));
    assert_eq!(b.key, format!("{}-2", project.key_prefix));
}

#[test]
fn redundant_status_transition_is_a_no_op() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Stay backlog", None)
        .expect("create_task should succeed");

    let updated_at_before: String = conn
        .query_row(
            "SELECT updated_at FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read updated_at");

    set_task_status(&mut conn, &actor_id, &task.id, "backlog")
        .expect("setting status to its current value should succeed");

    let updated_at_after: String = conn
        .query_row(
            "SELECT updated_at FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read updated_at");
    assert_eq!(
        updated_at_before, updated_at_after,
        "a redundant status transition must leave updated_at unchanged"
    );

    let status_events = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.status_changed'",
        &[&task.id],
    );
    assert_eq!(status_events, 0, "a redundant status transition must append no event");
}

#[test]
fn invalid_status_is_rejected_by_the_schema() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Bad status", None)
        .expect("create_task should succeed");

    let empty_result = set_task_status(&mut conn, &actor_id, &task.id, "");
    let empty_err = empty_result.expect_err("an empty status must be rejected");
    let empty_sqlite_err = empty_err
        .downcast_ref::<rusqlite::Error>()
        .expect("the error must originate from rusqlite/SQLite, not an application-layer guard");
    assert!(
        matches!(empty_sqlite_err, rusqlite::Error::SqliteFailure(_, _)),
        "expected a SQLite constraint failure for an empty status, got {empty_sqlite_err:?}"
    );

    let unknown_result = set_task_status(&mut conn, &actor_id, &task.id, "archived");
    let unknown_err = unknown_result.expect_err("an unknown status must be rejected");
    let unknown_sqlite_err = unknown_err
        .downcast_ref::<rusqlite::Error>()
        .expect("the error must originate from rusqlite/SQLite, not an application-layer guard");
    assert!(
        matches!(unknown_sqlite_err, rusqlite::Error::SqliteFailure(_, _)),
        "expected a SQLite constraint failure for an unknown status, got {unknown_sqlite_err:?}"
    );
}

#[test]
fn workflow_states_are_fixed_and_ordered() {
    assert_eq!(
        WORKFLOW_STATES,
        ["backlog", "todo", "in_progress", "in_review", "done"],
        "WORKFLOW_STATES must have exactly five entries in this fixed order"
    );
}

#[test]
fn issue_has_no_workflow_status() {
    let (mut conn, actor_id, project) = seeded_project();
    let issue = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Something worth noting",
        None,
        "idea",
        None,
        None,
    )
    .expect("create_issue should succeed");

    // The `issues` table has no `status` column at all — attempting to select one is a compile-
    // time-checked-at-runtime SQL error, which is the strongest possible proof that reading one
    // back shows no status field.
    let sql_result = conn.query_row(
        "SELECT status FROM issues WHERE id = ?1",
        params![issue.id],
        |row| row.get::<_, String>(0),
    );
    assert!(
        sql_result.is_err(),
        "issues must have no status column to read back at all"
    );
}

#[test]
fn deleting_an_epic_orphans_its_tasks() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Parent epic", None)
        .expect("create_epic should succeed");
    let task = create_task(
        &mut conn,
        &project.id,
        &actor_id,
        "Child task",
        Some(&epic.id),
    )
    .expect("create_task should succeed");

    delete_epic(&mut conn, &actor_id, &epic.id).expect("delete_epic should succeed");

    let remaining_task_epic_id: Option<String> = conn
        .query_row(
            "SELECT epic_id FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("the child task must still exist after its epic is deleted");
    assert_eq!(
        remaining_task_epic_id, None,
        "a deleted epic's child task must have epic_id set to NULL, not be deleted itself"
    );

    let window = list_board(&conn, &project.id, 200, None).expect("list_board should succeed");
    assert!(
        window.items.iter().any(|item| item.id == task.id),
        "the orphaned task must still appear in the board query"
    );
    assert!(
        !window.items.iter().any(|item| item.id == epic.id),
        "the deleted epic must no longer appear in the board query"
    );
}
