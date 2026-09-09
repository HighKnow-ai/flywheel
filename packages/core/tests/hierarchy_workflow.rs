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
//!
//! Behavior under test (01-12-PLAN.md Task 1/3 — G-01-EPIC-ASSIGN, the reparenting paths):
//! - `task::set_epic` sets a task's epic within the same project, appending exactly one
//!   `task.epic_changed` event.
//! - A second `set_epic` call naming the same epic is a no-op: no event is appended.
//! - `task::set_epic(None)` clears a task's epic (orphans it) and appends one event whose
//!   `after` is null.
//! - `task::set_epic` naming an epic in another project is rejected and leaves `epic_id`
//!   unchanged.
//! - `issue::set_parent` holds exactly one parent at a time — setting a task parent clears any
//!   epic parent in the same statement, and vice versa.
//! - `issue::set_parent` naming a parent in another project is rejected and changes nothing.
//! - `create_task` and `create_issue` reject a supplied parent id belonging to another project.

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::epic::{create_epic, delete_epic, update_epic};
use core::domain::issue::{create_issue, set_parent, update_issue, IssueParent};
use core::domain::project::{self, Project};
use core::domain::task::{create_task, delete_task, set_epic, set_task_status, update_task};
use core::domain::WORKFLOW_STATES;
use core::query::{list_board, BoardFilter};
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

/// Register a second project against the same connection as an already-seeded one — the
/// cross-project fixture the reparenting-rejection tests need (01-12-PLAN.md Task 3).
fn second_project(conn: &mut Connection, actor_id: &str) -> Project {
    project::create_project(conn, actor_id, "Other Project", "/other-repo", "OTH", "main")
        .expect("create_project should succeed for the second project")
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

    let window = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    assert!(
        window.items.iter().any(|item| item.id == task.id),
        "the orphaned task must still appear in the board query"
    );
    assert!(
        !window.items.iter().any(|item| item.id == epic.id),
        "the deleted epic must no longer appear in the board query"
    );
}

#[test]
fn deleting_an_epic_or_task_orphans_linked_issues_instead_of_failing() {
    let (mut conn, actor_id, project) = seeded_project();

    // Epic side: an issue linked to an epic must survive the epic's deletion with epic_id NULL,
    // and the delete itself must succeed rather than raising a raw FK constraint error.
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Parent epic", None)
        .expect("create_epic should succeed");
    let epic_issue = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Issue linked to an epic",
        None,
        "idea",
        Some(&epic.id),
        None,
    )
    .expect("create_issue should succeed");

    delete_epic(&mut conn, &actor_id, &epic.id)
        .expect("delete_epic must succeed even when an issue references it (CR-01)");

    let remaining_issue_epic_id: Option<String> = conn
        .query_row(
            "SELECT epic_id FROM issues WHERE id = ?1",
            params![epic_issue.id],
            |row| row.get(0),
        )
        .expect("the linked issue must still exist after its epic is deleted");
    assert_eq!(
        remaining_issue_epic_id, None,
        "a deleted epic's linked issue must have epic_id set to NULL, not be deleted itself"
    );

    // Task side: same contract, via task_id.
    let task = create_task(&mut conn, &project.id, &actor_id, "Parent task", None)
        .expect("create_task should succeed");
    let task_issue = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Issue linked to a task",
        None,
        "idea",
        None,
        Some(&task.id),
    )
    .expect("create_issue should succeed");

    delete_task(&mut conn, &actor_id, &task.id)
        .expect("delete_task must succeed even when an issue references it (CR-01)");

    let remaining_issue_task_id: Option<String> = conn
        .query_row(
            "SELECT task_id FROM issues WHERE id = ?1",
            params![task_issue.id],
            |row| row.get(0),
        )
        .expect("the linked issue must still exist after its task is deleted");
    assert_eq!(
        remaining_issue_task_id, None,
        "a deleted task's linked issue must have task_id set to NULL, not be deleted itself"
    );
}

#[test]
fn update_epic_task_and_issue_read_back_the_real_key_not_a_blank_one() {
    let (mut conn, actor_id, project) = seeded_project();

    let epic = create_epic(&mut conn, &project.id, &actor_id, "Epic", None)
        .expect("create_epic should succeed");
    let updated_epic = update_epic(&mut conn, &actor_id, &epic.id, Some("Renamed epic"), None)
        .expect("update_epic should succeed");
    assert_eq!(
        updated_epic.key, epic.key,
        "update_epic must read back the real key, not String::new() (WR-02)"
    );
    assert!(!updated_epic.key.is_empty());

    let task = create_task(&mut conn, &project.id, &actor_id, "Task", None)
        .expect("create_task should succeed");
    let updated_task = update_task(&mut conn, &actor_id, &task.id, Some("Renamed task"), None)
        .expect("update_task should succeed");
    assert_eq!(
        updated_task.key, task.key,
        "update_task must read back the real key, not String::new() (WR-02)"
    );
    assert!(!updated_task.key.is_empty());

    let issue = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Issue",
        None,
        "idea",
        None,
        None,
    )
    .expect("create_issue should succeed");
    let updated_issue = update_issue(&mut conn, &actor_id, &issue.id, Some("Renamed issue"), None)
        .expect("update_issue should succeed");
    assert_eq!(
        updated_issue.key, issue.key,
        "update_issue must read back the real key, not String::new() (WR-02)"
    );
    assert!(!updated_issue.key.is_empty());
}

#[test]
fn set_epic_parents_a_task_and_a_second_call_with_the_same_epic_is_a_no_op() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Epic", None)
        .expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Task", None)
        .expect("create_task should succeed");

    set_epic(&mut conn, &actor_id, &task.id, Some(&epic.id)).expect("set_epic should succeed");

    let epic_id: Option<String> = conn
        .query_row(
            "SELECT epic_id FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read epic_id");
    assert_eq!(epic_id.as_deref(), Some(epic.id.as_str()));

    let events_after_first = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE event_type = 'task.epic_changed'",
        &[],
    );
    assert_eq!(events_after_first, 1, "set_epic must append exactly one event");

    let updated_at_before: String = conn
        .query_row(
            "SELECT updated_at FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read updated_at");

    // Redundant call: same epic again must be a no-op.
    set_epic(&mut conn, &actor_id, &task.id, Some(&epic.id))
        .expect("redundant set_epic should still succeed");

    let updated_at_after: String = conn
        .query_row(
            "SELECT updated_at FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read updated_at");
    assert_eq!(
        updated_at_before, updated_at_after,
        "a redundant set_epic call must leave updated_at unchanged"
    );

    let events_after_second = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE event_type = 'task.epic_changed'",
        &[],
    );
    assert_eq!(
        events_after_second, 1,
        "a redundant set_epic call must append no additional event"
    );
}

#[test]
fn set_epic_none_orphans_the_task() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Epic", None)
        .expect("create_epic should succeed");
    let task = create_task(
        &mut conn,
        &project.id,
        &actor_id,
        "Task",
        Some(&epic.id),
    )
    .expect("create_task should succeed");

    set_epic(&mut conn, &actor_id, &task.id, None).expect("set_epic(None) should succeed");

    let epic_id: Option<String> = conn
        .query_row(
            "SELECT epic_id FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read epic_id");
    assert_eq!(epic_id, None, "set_epic(None) must clear the task's epic_id");

    let payload: String = conn
        .query_row(
            "SELECT payload FROM events WHERE event_type = 'task.epic_changed' ORDER BY sequence DESC LIMIT 1",
            [],
            |row| row.get(0),
        )
        .expect("should read the latest task.epic_changed event payload");
    let payload: serde_json::Value =
        serde_json::from_str(&payload).expect("payload should be valid JSON");
    assert!(
        payload["after"].is_null(),
        "clearing a task's epic must record a null 'after' in the event payload"
    );
}

#[test]
fn set_epic_rejects_an_epic_in_another_project() {
    let (mut conn, actor_id, project) = seeded_project();
    let other_project = second_project(&mut conn, &actor_id);
    let other_epic = create_epic(&mut conn, &other_project.id, &actor_id, "Other epic", None)
        .expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Task", None)
        .expect("create_task should succeed");

    let result = set_epic(&mut conn, &actor_id, &task.id, Some(&other_epic.id));
    assert!(
        result.is_err(),
        "set_epic must reject an epic belonging to a different project"
    );

    let epic_id: Option<String> = conn
        .query_row(
            "SELECT epic_id FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read epic_id");
    assert_eq!(
        epic_id, None,
        "a rejected cross-project set_epic must leave epic_id unchanged"
    );
}

#[test]
fn set_epic_rejects_a_non_existent_epic() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Task", None)
        .expect("create_task should succeed");

    let result = set_epic(&mut conn, &actor_id, &task.id, Some("01ARZ3NDEKTSV4RRFFQ69G5FAV"));
    assert!(
        result.is_err(),
        "set_epic must reject an epic id naming no row"
    );
}

#[test]
fn set_issue_parent_holds_exactly_one_parent_at_a_time() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic = create_epic(&mut conn, &project.id, &actor_id, "Epic", None)
        .expect("create_epic should succeed");
    let task = create_task(&mut conn, &project.id, &actor_id, "Task", None)
        .expect("create_task should succeed");
    let issue = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Issue",
        None,
        "idea",
        None,
        None,
    )
    .expect("create_issue should succeed");

    set_parent(&mut conn, &actor_id, &issue.id, IssueParent::Epic(epic.id.clone()))
        .expect("set_parent(Epic) should succeed");

    let (epic_id, task_id): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT epic_id, task_id FROM issues WHERE id = ?1",
            params![issue.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("should read epic_id/task_id");
    assert_eq!(epic_id.as_deref(), Some(epic.id.as_str()));
    assert_eq!(task_id, None);

    set_parent(&mut conn, &actor_id, &issue.id, IssueParent::Task(task.id.clone()))
        .expect("set_parent(Task) should succeed");

    let (epic_id, task_id): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT epic_id, task_id FROM issues WHERE id = ?1",
            params![issue.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("should read epic_id/task_id");
    assert_eq!(
        epic_id, None,
        "setting a task parent must clear any epic parent in the same statement"
    );
    assert_eq!(task_id.as_deref(), Some(task.id.as_str()));

    set_parent(&mut conn, &actor_id, &issue.id, IssueParent::None)
        .expect("set_parent(None) should succeed");

    let (epic_id, task_id): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT epic_id, task_id FROM issues WHERE id = ?1",
            params![issue.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("should read epic_id/task_id");
    assert_eq!(epic_id, None);
    assert_eq!(task_id, None);

    let parent_events = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'issue.parent_changed'",
        &[&issue.id],
    );
    assert_eq!(
        parent_events, 3,
        "three accepted parent changes must append exactly three events"
    );

    // A redundant call (already detached) must append no fourth event.
    set_parent(&mut conn, &actor_id, &issue.id, IssueParent::None)
        .expect("redundant set_parent(None) should still succeed");
    let parent_events_after_redundant = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'issue.parent_changed'",
        &[&issue.id],
    );
    assert_eq!(
        parent_events_after_redundant, 3,
        "a redundant set_parent call must append no additional event"
    );
}

#[test]
fn set_issue_parent_rejects_a_parent_in_another_project() {
    let (mut conn, actor_id, project) = seeded_project();
    let other_project = second_project(&mut conn, &actor_id);
    let other_epic = create_epic(&mut conn, &other_project.id, &actor_id, "Other epic", None)
        .expect("create_epic should succeed");
    let other_task = create_task(&mut conn, &other_project.id, &actor_id, "Other task", None)
        .expect("create_task should succeed");
    let issue = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Issue",
        None,
        "idea",
        None,
        None,
    )
    .expect("create_issue should succeed");

    let epic_result = set_parent(
        &mut conn,
        &actor_id,
        &issue.id,
        IssueParent::Epic(other_epic.id.clone()),
    );
    assert!(
        epic_result.is_err(),
        "set_parent must reject an epic belonging to a different project"
    );

    let task_result = set_parent(
        &mut conn,
        &actor_id,
        &issue.id,
        IssueParent::Task(other_task.id.clone()),
    );
    assert!(
        task_result.is_err(),
        "set_parent must reject a task belonging to a different project"
    );

    let (epic_id, task_id): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT epic_id, task_id FROM issues WHERE id = ?1",
            params![issue.id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .expect("should read epic_id/task_id");
    assert_eq!(epic_id, None, "a rejected cross-project reparent must change nothing");
    assert_eq!(task_id, None, "a rejected cross-project reparent must change nothing");
}

#[test]
fn create_task_and_create_issue_reject_a_parent_in_another_project() {
    let (mut conn, actor_id, project) = seeded_project();
    let other_project = second_project(&mut conn, &actor_id);
    let other_epic = create_epic(&mut conn, &other_project.id, &actor_id, "Other epic", None)
        .expect("create_epic should succeed");
    let other_task = create_task(&mut conn, &other_project.id, &actor_id, "Other task", None)
        .expect("create_task should succeed");

    let task_result = create_task(
        &mut conn,
        &project.id,
        &actor_id,
        "Task with foreign epic",
        Some(&other_epic.id),
    );
    assert!(
        task_result.is_err(),
        "create_task must reject a supplied epic_id belonging to a different project"
    );

    let issue_epic_result = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Issue with foreign epic",
        None,
        "idea",
        Some(&other_epic.id),
        None,
    );
    assert!(
        issue_epic_result.is_err(),
        "create_issue must reject a supplied epic_id belonging to a different project"
    );

    let issue_task_result = create_issue(
        &mut conn,
        &project.id,
        &actor_id,
        "Issue with foreign task",
        None,
        "idea",
        None,
        Some(&other_task.id),
    );
    assert!(
        issue_task_result.is_err(),
        "create_issue must reject a supplied task_id belonging to a different project"
    );
}
