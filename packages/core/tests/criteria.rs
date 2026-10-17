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

mod common;

use common::with_scratch_worktree_root;

use core::db::open_and_migrate;
use core::domain::acceptance_criterion::{
    create_criterion, criteria_locked_for_task, delete_criterion, list_criteria,
    list_current_criteria, list_revisions_for_root, reorder_criterion, revise_criterion,
    toggle_criterion,
};
use core::domain::actor::local_human_actor_id;
use core::domain::agent_run::start_agent_run;
use core::domain::epic::create_epic;
use core::domain::issue::{create_issue, IssueParent};
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
        IssueParent::None,
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

// --- D-76/D-77 (plan 04-04): the lock, the revision chain, and the read-path filters. ---

#[test]
fn criteria_locked_for_task_is_false_before_any_agent_run_and_true_after() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Lock probe", None)
            .expect("create_task should succeed");

        assert!(
            !criteria_locked_for_task(&conn, &task.id).expect("criteria_locked_for_task should succeed"),
            "a task with no agent_runs row must be unlocked"
        );

        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        assert!(
            criteria_locked_for_task(&conn, &task.id).expect("criteria_locked_for_task should succeed"),
            "a task with an agent_runs row must be locked, and stay locked"
        );
    });
}

#[test]
fn revising_an_unlocked_criterion_edits_in_place() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "No run yet", None)
            .expect("create_task should succeed");
        let criterion = create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Original wording",
            None,
        )
        .expect("create_criterion should succeed");

        let before_count = count_rows(
            &conn,
            "SELECT COUNT(*) FROM acceptance_criteria WHERE parent_id = ?1",
            &[&task.id],
        );

        let revised = revise_criterion(&mut conn, &actor_id, &criterion.id, "Sharper wording", None)
            .expect("revise_criterion should succeed");

        assert_eq!(revised.id, criterion.id, "an unlocked revise edits the same row, mints no new id");
        assert_eq!(revised.statement, "Sharper wording");
        assert_eq!(revised.revision, 1, "revision must stay 1 for an unlocked edit");
        assert!(revised.superseded_at.is_none(), "superseded_at must stay NULL for an unlocked edit");

        let after_count = count_rows(
            &conn,
            "SELECT COUNT(*) FROM acceptance_criteria WHERE parent_id = ?1",
            &[&task.id],
        );
        assert_eq!(before_count, after_count, "an unlocked revise must not add a row");
    });
}

#[test]
fn revising_a_locked_criterion_appends_a_successor_and_leaves_the_original_byte_identical() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Has a run", None)
            .expect("create_task should succeed");
        let criterion = create_criterion(
            &mut conn,
            &project.id,
            &actor_id,
            "task",
            &task.id,
            "Original wording",
            None,
        )
        .expect("create_criterion should succeed");
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id)
            .expect("start_agent_run should succeed");

        let revised = revise_criterion(&mut conn, &actor_id, &criterion.id, "Sharper wording", None)
            .expect("revise_criterion should succeed");

        assert_ne!(revised.id, criterion.id, "a locked revise mints a new row, never overwrites the original");
        assert_eq!(revised.statement, "Sharper wording");
        assert_eq!(revised.revision, 2, "the successor's revision must be one past the predecessor's");
        assert_eq!(
            revised.revision_of.as_deref(),
            Some(criterion.id.as_str()),
            "the successor's revision_of must point at the original (chain root)"
        );
        assert!(revised.superseded_at.is_none(), "the newly minted successor is the current row");

        let original_statement: String = conn
            .query_row(
                "SELECT statement FROM acceptance_criteria WHERE id = ?1",
                [&criterion.id],
                |row| row.get(0),
            )
            .expect("the original row must still exist");
        assert_eq!(
            original_statement, "Original wording",
            "the original row's statement must be byte-identical after a locked revise"
        );

        let original_superseded_at: Option<String> = conn
            .query_row(
                "SELECT superseded_at FROM acceptance_criteria WHERE id = ?1",
                [&criterion.id],
                |row| row.get(0),
            )
            .expect("the original row must still exist");
        assert!(
            original_superseded_at.is_some(),
            "the original row must now carry a superseded_at timestamp"
        );

        let row_count = count_rows(
            &conn,
            "SELECT COUNT(*) FROM acceptance_criteria WHERE parent_id = ?1",
            &[&task.id],
        );
        assert_eq!(row_count, 2, "a locked revise must add exactly one row — the original stays, plus one successor");
    });
}

#[test]
fn the_successor_inherits_rank_and_checked_across_a_revision() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Ordered with a run", None)
            .expect("create_task should succeed");
        let a = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "A", None)
            .expect("create_criterion A");
        let b = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "B", None)
            .expect("create_criterion B");
        let c = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "C", None)
            .expect("create_criterion C");

        toggle_criterion(&mut conn, &actor_id, &c.id).expect("toggle C");

        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id).expect("start_agent_run should succeed");

        let revised_c = revise_criterion(&mut conn, &actor_id, &c.id, "C revised", None).expect("revise C");

        assert_eq!(
            revised_c.rank, c.rank,
            "the successor must inherit the predecessor's rank — revising the third criterion leaves it third"
        );
        assert!(
            revised_c.checked,
            "the successor must inherit the predecessor's checked value, not silently untick it"
        );

        let current = list_current_criteria(&conn, "task", &task.id).expect("list_current_criteria should succeed");
        assert_eq!(current.len(), 3, "revising must not change the current count");
        assert_eq!(current[0].id, a.id);
        assert_eq!(current[1].id, b.id);
        assert_eq!(current[2].id, revised_c.id, "the revised criterion must still sort third");
    });
}

#[test]
fn revising_twice_produces_a_three_revision_chain_sharing_one_root() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Revise twice", None)
            .expect("create_task should succeed");
        let original = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "v1", None)
            .expect("create_criterion should succeed");
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id).expect("start_agent_run should succeed");

        let v2 = revise_criterion(&mut conn, &actor_id, &original.id, "v2", None).expect("revise to v2");
        assert_eq!(v2.revision, 2);
        assert_eq!(v2.revision_of.as_deref(), Some(original.id.as_str()));

        let v3 = revise_criterion(&mut conn, &actor_id, &v2.id, "v3", None).expect("revise to v3");
        assert_eq!(v3.revision, 3);
        assert_eq!(
            v3.revision_of.as_deref(),
            Some(original.id.as_str()),
            "revision 3's revision_of must still point at the CHAIN ROOT, not the immediate predecessor v2"
        );

        let chain = list_revisions_for_root(&conn, &v3.id).expect("list_revisions_for_root should succeed");
        assert_eq!(chain.len(), 3, "the chain must contain all three revisions");
        let revisions: Vec<i64> = chain.iter().map(|c| c.revision).collect();
        assert_eq!(revisions, vec![3, 2, 1], "ordered newest first");
        let current_count = chain.iter().filter(|c| c.superseded_at.is_none()).count();
        assert_eq!(current_count, 1, "exactly one member of the chain must be current");
        assert_eq!(chain[0].id, v3.id);

        // Walkable starting from the root's own id too, not only from a successor.
        let chain_from_root =
            list_revisions_for_root(&conn, &original.id).expect("list_revisions_for_root from the root should succeed");
        assert_eq!(chain_from_root.len(), 3);
    });
}

#[test]
fn both_revise_branches_append_exactly_one_event_and_the_locked_branch_is_criterion_revised() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Event count", None)
            .expect("create_task should succeed");
        let criterion = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "Original", None)
            .expect("create_criterion should succeed");

        // Unlocked revise.
        revise_criterion(&mut conn, &actor_id, &criterion.id, "Edited in place", None)
            .expect("unlocked revise should succeed");
        let updated_events = count_rows(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'criterion.updated'",
            &[&criterion.id],
        );
        assert_eq!(updated_events, 1, "the unlocked branch must append exactly one criterion.updated event");

        // Lock the task, then revise again.
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id).expect("start_agent_run should succeed");
        let revised = revise_criterion(&mut conn, &actor_id, &criterion.id, "Locked edit", None)
            .expect("locked revise should succeed");

        let revised_events = count_rows(
            &conn,
            "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'criterion.revised'",
            &[&revised.id],
        );
        assert_eq!(revised_events, 1, "the locked branch must append exactly one criterion.revised event");

        let payload_json: String = conn
            .query_row(
                "SELECT payload FROM events WHERE stream_id = ?1 AND event_type = 'criterion.revised'",
                [&revised.id],
                |row| row.get(0),
            )
            .expect("the criterion.revised event should exist");
        let payload: serde_json::Value =
            serde_json::from_str(&payload_json).expect("payload should be valid JSON");
        assert_eq!(payload["before"], "Edited in place", "the payload's before must carry the predecessor's statement");
        assert_eq!(payload["after"], "Locked edit", "the payload's after must carry the new statement");
    });
}

#[test]
fn revising_an_unknown_criterion_id_returns_an_error_and_writes_nothing() {
    let (mut conn, actor_id, _project) = seeded_project();
    let before_count = count_rows(&conn, "SELECT COUNT(*) FROM acceptance_criteria", &[]);

    let result = revise_criterion(&mut conn, &actor_id, "not-a-real-id", "New text", None);
    assert!(result.is_err(), "revising an unknown id must fail");

    let after_count = count_rows(&conn, "SELECT COUNT(*) FROM acceptance_criteria", &[]);
    assert_eq!(before_count, after_count, "a failed revise must write nothing");
}

// --- Task 3: every read path (the agent's own packet, the board badge) sees current revisions
// only, while the full chain stays queryable for the developer-facing history surface. ---

#[test]
fn a_newly_added_criterion_ranks_after_the_last_current_one_not_a_superseded_row() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Tail rank after revision", None)
            .expect("create_task should succeed");
        let a = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "A", None)
            .expect("create_criterion A");
        let b = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "B", None)
            .expect("create_criterion B");

        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id).expect("start_agent_run should succeed");

        // Revise B — its successor's rank is B's own rank, so the superseded row's rank is still
        // "the last one by rank" even though it is no longer current.
        let revised_b = revise_criterion(&mut conn, &actor_id, &b.id, "B revised", None).expect("revise B");
        assert_eq!(revised_b.rank, b.rank);

        let d = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "D", None)
            .expect("create_criterion D");
        assert!(d.rank > a.rank, "D must sort after A");
        assert!(d.rank > revised_b.rank, "D must sort after the current revision of B");

        let current = list_current_criteria(&conn, "task", &task.id).expect("list_current_criteria should succeed");
        let ids: Vec<&str> = current.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(
            ids,
            vec![a.id.as_str(), revised_b.id.as_str(), d.id.as_str()],
            "D must rank after the current criteria, not before"
        );
    });
}

// ---------------------------------------------------------------------------------------------
// Plan 08.1-03 — `seed_criteria`: the guarded tool that clears probe text off the real board and
// seeds real criteria on the tasks that have an active worktree (D-23). The test includes the
// binary's own source file as a module so it exercises the REAL guard, not a reimplementation.
// ---------------------------------------------------------------------------------------------

#[allow(dead_code)]
#[path = "bin/seed_criteria.rs"]
mod seed_criteria;

fn criterion_event_count(conn: &Connection, criterion_id: &str, event_type: &str) -> i64 {
    count_rows(
        conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = ?2",
        &[&criterion_id, &event_type],
    )
}

#[test]
fn seed_criteria_deletes_a_row_whose_statement_is_exactly_probe_text() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Probe holder", None).unwrap();
    let probe = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, " test ", None).unwrap();

    seed_criteria::delete_probes(&mut conn, &actor_id).expect("delete_probes should succeed");

    assert!(
        list_criteria(&conn, "task", &task.id).unwrap().iter().all(|c| c.id != probe.id),
        "the probe row should be gone"
    );
}

#[test]
fn seed_criteria_leaves_a_criterion_with_real_prose_untouched() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Real holder", None).unwrap();
    let real = create_criterion(
        &mut conn, &project.id, &actor_id, "task", &task.id, "Rejects an empty email with a 400", None,
    )
    .unwrap();
    // A statement merely CONTAINING a probe word is still real prose: the guard is an exact match.
    let contains = create_criterion(
        &mut conn, &project.id, &actor_id, "task", &task.id, "Adds a test for the empty case", None,
    )
    .unwrap();

    seed_criteria::delete_probes(&mut conn, &actor_id).expect("delete_probes should succeed");

    let after = list_criteria(&conn, "task", &task.id).unwrap();
    assert_eq!(after.iter().filter(|c| c.id == real.id || c.id == contains.id).count(), 2);
    let kept = after.iter().find(|c| c.id == real.id).unwrap();
    assert_eq!(kept.statement, real.statement);
}

#[test]
fn seed_criteria_gives_an_active_worktree_task_with_no_criteria_some() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let with_worktree = create_task(&mut conn, &project.id, &actor_id, "Wire up the filter chips #21", None).unwrap();
        let without_worktree = create_task(&mut conn, &project.id, &actor_id, "No worktree here", None).unwrap();
        start_agent_run(&mut conn, &with_worktree.id, "acceptEdits", &actor_id).expect("start_agent_run");

        let created = seed_criteria::seed_worktree_tasks(&mut conn, &actor_id).expect("seed should succeed");

        let seeded = list_criteria(&conn, "task", &with_worktree.id).unwrap();
        assert!((2..=4).contains(&seeded.len()), "expected 2-4 criteria, got {}", seeded.len());
        assert_eq!(created, seeded.len());
        assert!(list_criteria(&conn, "task", &without_worktree.id).unwrap().is_empty());

        // Idempotent: a second run adds nothing to a task that already carries criteria.
        assert_eq!(seed_criteria::seed_worktree_tasks(&mut conn, &actor_id).unwrap(), 0);
    });
}

#[test]
fn seed_criteria_leaves_an_event_behind_for_every_row_it_touches() {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let task = create_task(&mut conn, &project.id, &actor_id, "Cache the event stream #26", None).unwrap();
        start_agent_run(&mut conn, &task.id, "acceptEdits", &actor_id).expect("start_agent_run");
        let probe = create_criterion(&mut conn, &project.id, &actor_id, "task", &task.id, "hello", None).unwrap();

        seed_criteria::delete_probes(&mut conn, &actor_id).unwrap();
        seed_criteria::seed_worktree_tasks(&mut conn, &actor_id).unwrap();

        assert_eq!(criterion_event_count(&conn, &probe.id, "criterion.deleted"), 1);
        let seeded = list_criteria(&conn, "task", &task.id).unwrap();
        assert!(!seeded.is_empty());
        for criterion in &seeded {
            assert_eq!(criterion_event_count(&conn, &criterion.id, "criterion.created"), 1);
        }
    });
}

#[test]
fn seed_criteria_refuses_to_run_without_a_mode_and_an_explicit_target() {
    let to_args = |a: &[&str]| a.iter().map(|s| s.to_string()).collect::<Vec<_>>();

    // No mode at all.
    assert!(seed_criteria::resolve_invocation(&to_args(&[]), true).is_err());
    // A mode, but no app-data override and no explicit real-database flag.
    assert!(seed_criteria::resolve_invocation(&to_args(&["both"]), false).is_err());
    // An unknown mode.
    assert!(seed_criteria::resolve_invocation(&to_args(&["wipe"]), true).is_err());
    // The flag, or the override, is what authorises a run.
    assert!(seed_criteria::resolve_invocation(&to_args(&["both", "--i-mean-the-real-database"]), false).is_ok());
    assert!(seed_criteria::resolve_invocation(&to_args(&["delete-probes"]), true).is_ok());

    // And the real binary, run with no mode against a scratch directory, exits non-zero and
    // creates nothing in it.
    let dir = scratch_dir();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_seed_criteria"))
        .env("FLYWHEEL_APP_DATA_DIR", dir.path())
        .output()
        .expect("failed to spawn seed_criteria");
    assert!(!output.status.success(), "no mode must exit non-zero");
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0, "a refused run must write nothing");
}
