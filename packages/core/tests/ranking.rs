//! Behavior under test (01-07-PLAN.md Task 3 — the board's order is total and reproducible, and
//! a reorder costs exactly one row):
//! - `rank_between` on adjacent ranks returns a strictly-between value under plain string
//!   comparison.
//! - After 200 random moves within one group of 50 items, every rank is distinct and the read
//!   order matches the move history.
//! - A move rewrites exactly one row: the other rows' `rank` and `updated_at` are unchanged.
//! - Reordering in a group of one item returns `Ok` and writes no row (D-11).
//! - Two items given the same priority order by rank; two items with different priorities order
//!   by priority regardless of rank — "No priority" sorts last (Open Decisions #6).
//! - Reading the board twice with no intervening write returns byte-identical id sequences.
//! - Setting priority to the value it already holds appends no event.
//! - `set_assignee` with an actor id that names no row returns a foreign-key error.

use std::collections::HashSet;

use core::db::open_and_migrate;
use core::domain::actor::local_human_actor_id;
use core::domain::project::{self, Project};
use core::domain::task::{create_task, reorder_task, set_assignee, set_priority, DEFAULT_PRIORITY};
use core::query::{list_board, BoardFilter};
use core::ranking::{rank_after, rank_between, ReorderDirection};
use rusqlite::{params, Connection};

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Open a fresh migrated database and register one project (mirrors `hierarchy_workflow.rs`'s
/// and `criteria.rs`'s own `seeded_project` fixture).
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

fn task_rank(conn: &Connection, task_id: &str) -> String {
    conn.query_row(
        "SELECT rank FROM tasks WHERE id = ?1",
        params![task_id],
        |row| row.get(0),
    )
    .expect("should read the task's rank")
}

fn task_updated_at(conn: &Connection, task_id: &str) -> String {
    conn.query_row(
        "SELECT updated_at FROM tasks WHERE id = ?1",
        params![task_id],
        |row| row.get(0),
    )
    .expect("should read the task's updated_at")
}

/// (id, rank, updated_at) for every id in `ids`, in the same order — the "before" and "after"
/// snapshot `a_move_rewrites_exactly_one_row` diffs field by field, not just counts rows.
fn snapshot(conn: &Connection, ids: &[String]) -> Vec<(String, String, String)> {
    ids.iter()
        .map(|id| {
            conn.query_row(
                "SELECT id, rank, updated_at FROM tasks WHERE id = ?1",
                params![id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .expect("should read the task's (id, rank, updated_at)")
        })
        .collect()
}

#[test]
fn rank_between_is_strictly_between() {
    let a = rank_after(None).expect("rank_after(None) should succeed");
    let c = rank_after(Some(&a)).expect("rank_after(Some) should succeed");
    let b = rank_between(&a, &c).expect("rank_between should succeed on adjacent ranks");
    assert!(a < b, "{a:?} should sort strictly before {b:?}");
    assert!(b < c, "{b:?} should sort strictly before {c:?}");
}

#[test]
fn many_moves_keep_ranks_distinct() {
    let (mut conn, actor_id, project) = seeded_project();

    let mut ids: Vec<String> = Vec::new();
    for i in 0..50 {
        let task = create_task(&mut conn, &project.id, &actor_id, &format!("Task {i}"), None)
            .expect("create_task should succeed");
        ids.push(task.id);
    }

    // A small deterministic PRNG (xorshift32) — no extra dev-dependency needed, and a fixed
    // seed keeps the test reproducible across runs.
    let mut state: u32 = 0x9E37_79B9;
    let mut next_rand = || {
        state ^= state << 13;
        state ^= state >> 17;
        state ^= state << 5;
        state
    };

    let mut moves_applied = 0;
    while moves_applied < 200 {
        let idx = (next_rand() as usize) % ids.len();
        let go_up = next_rand() % 2 == 0;
        let can_move = if go_up { idx > 0 } else { idx < ids.len() - 1 };
        if !can_move {
            continue;
        }
        let direction = if go_up { ReorderDirection::Up } else { ReorderDirection::Down };
        reorder_task(&mut conn, &actor_id, &ids[idx], direction)
            .expect("reorder_task should succeed on a valid move");
        let swap_with = if go_up { idx - 1 } else { idx + 1 };
        ids.swap(idx, swap_with);
        moves_applied += 1;
    }

    let mut seen_ranks = HashSet::new();
    for id in &ids {
        let rank = task_rank(&conn, id);
        assert!(
            seen_ranks.insert(rank.clone()),
            "two items in this project-and-status group must never hold the same rank \
             (duplicate: {rank:?} for id {id:?})"
        );
    }

    let window = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let read_ids: Vec<String> = window.items.iter().map(|item| item.id.clone()).collect();
    assert_eq!(
        read_ids, ids,
        "the read order after 200 moves must match the move history's own final order"
    );
}

#[test]
fn a_move_rewrites_exactly_one_row() {
    let (mut conn, actor_id, project) = seeded_project();

    let mut ids: Vec<String> = Vec::new();
    for i in 0..5 {
        let task = create_task(&mut conn, &project.id, &actor_id, &format!("T{i}"), None)
            .expect("create_task should succeed");
        ids.push(task.id);
    }

    let before = snapshot(&conn, &ids);
    reorder_task(&mut conn, &actor_id, &ids[2], ReorderDirection::Up)
        .expect("reorder_task should succeed");
    let after = snapshot(&conn, &ids);

    let mut changed = 0;
    for (b, a) in before.iter().zip(after.iter()) {
        if b != a {
            changed += 1;
        }
    }
    assert_eq!(
        changed, 1,
        "a move must rewrite exactly one row — every other row's rank and updated_at must be \
         byte-identical before and after"
    );
    assert_ne!(
        before[2].1, after[2].1,
        "the moved item's own rank must be the one thing that changed"
    );
}

#[test]
fn reorder_in_a_tiny_group_is_a_no_op() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Solo", None)
        .expect("create_task should succeed");

    let rank_before = task_rank(&conn, &task.id);
    let updated_at_before = task_updated_at(&conn, &task.id);

    reorder_task(&mut conn, &actor_id, &task.id, ReorderDirection::Up)
        .expect("reordering the only item in its group up must return Ok");
    reorder_task(&mut conn, &actor_id, &task.id, ReorderDirection::Down)
        .expect("reordering the only item in its group down must return Ok");

    let rank_after = task_rank(&conn, &task.id);
    let updated_at_after = task_updated_at(&conn, &task.id);
    assert_eq!(
        rank_before, rank_after,
        "a no-op reorder must not rewrite the item's rank"
    );
    assert_eq!(
        updated_at_before, updated_at_after,
        "a no-op reorder must not touch updated_at either — no row was written at all"
    );

    let reorder_events = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.reordered'",
        &[&task.id],
    );
    assert_eq!(reorder_events, 0, "a no-op reorder must append no event");
}

#[test]
fn priority_sorts_before_rank() {
    let (mut conn, actor_id, project) = seeded_project();

    // Two items with different priorities order by priority regardless of rank: the first
    // item created keeps the default "No priority" (sorts last); the second is created after
    // it (so it would rank second by creation order alone) and then promoted to Urgent — it
    // must still sort first.
    let no_priority_item = create_task(&mut conn, &project.id, &actor_id, "No priority, created first", None)
        .expect("create_task should succeed");
    let urgent_item = create_task(&mut conn, &project.id, &actor_id, "Urgent, created second", None)
        .expect("create_task should succeed");
    set_priority(&mut conn, &actor_id, &urgent_item.id, 1).expect("set_priority to Urgent should succeed");

    let window = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let order: Vec<&str> = window.items.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(
        order,
        vec![urgent_item.id.as_str(), no_priority_item.id.as_str()],
        "priority must sort before rank — Urgent must sort before No priority even though it \
         was created, and thus ranked, after"
    );

    // Two items given the same priority order by rank: promote both to Medium and confirm
    // creation order (== rank order, since both were appended to the same tail) is preserved.
    set_priority(&mut conn, &actor_id, &no_priority_item.id, 3).expect("set_priority to Medium should succeed");
    set_priority(&mut conn, &actor_id, &urgent_item.id, 3).expect("set_priority to Medium should succeed");

    let window2 = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let order2: Vec<&str> = window2.items.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(
        order2,
        vec![no_priority_item.id.as_str(), urgent_item.id.as_str()],
        "two items at the same priority must order by rank — the one created (and ranked) \
         first sorts first"
    );
}

#[test]
fn board_order_is_reproducible() {
    let (mut conn, actor_id, project) = seeded_project();
    for i in 0..10 {
        create_task(&mut conn, &project.id, &actor_id, &format!("T{i}"), None)
            .expect("create_task should succeed");
    }

    let first = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let second = list_board(&conn, &project.id, &BoardFilter::default(), 200, None).expect("list_board should succeed");
    let first_ids: Vec<&str> = first.items.iter().map(|item| item.id.as_str()).collect();
    let second_ids: Vec<&str> = second.items.iter().map(|item| item.id.as_str()).collect();
    assert_eq!(
        first_ids, second_ids,
        "reading the board twice with no intervening write must return byte-identical id \
         sequences — the order is total, not merely sorted"
    );
}

#[test]
fn redundant_priority_change_is_a_no_op() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Stay no-priority", None)
        .expect("create_task should succeed");

    let updated_at_before = task_updated_at(&conn, &task.id);
    set_priority(&mut conn, &actor_id, &task.id, DEFAULT_PRIORITY)
        .expect("setting priority to its current value should succeed");
    let updated_at_after = task_updated_at(&conn, &task.id);

    assert_eq!(
        updated_at_before, updated_at_after,
        "a redundant priority change must leave updated_at unchanged"
    );

    let priority_events = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'task.priority_changed'",
        &[&task.id],
    );
    assert_eq!(priority_events, 0, "a redundant priority change must append no event");
}

#[test]
fn assignee_must_reference_a_real_actor() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Needs an owner", None)
        .expect("create_task should succeed");

    let result = set_assignee(&mut conn, &actor_id, &task.id, Some("not-a-real-actor-id"));
    let err = result.expect_err("an assignee id naming no actor row must be rejected");
    let sqlite_err = err
        .downcast_ref::<rusqlite::Error>()
        .expect("the error must originate from the assignee_id foreign key, not an application-layer guard");
    assert!(
        matches!(sqlite_err, rusqlite::Error::SqliteFailure(_, _)),
        "expected a SQLite foreign-key-constraint failure, got {sqlite_err:?}"
    );

    // A real actor id (the seeded local human actor) is accepted.
    set_assignee(&mut conn, &actor_id, &task.id, Some(&actor_id))
        .expect("a real actor id must be accepted");
    let assignee: Option<String> = conn
        .query_row(
            "SELECT assignee_id FROM tasks WHERE id = ?1",
            params![task.id],
            |row| row.get(0),
        )
        .expect("should read the task's assignee_id");
    assert_eq!(assignee.as_deref(), Some(actor_id.as_str()));
}
