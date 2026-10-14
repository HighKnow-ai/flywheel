//! Behavior under test (01-10-PLAN.md Task 3 — the item trail half of BOARD-09/D-19):
//! - A task created and never edited has exactly one trail entry.
//! - Editing the title, changing the status twice and toggling a criterion produce five entries
//!   on the task's trail, in write order (criterion events are denormalised onto their parent's
//!   `task_id` column, so they appear on the same query with no union).
//! - Two events written inside one millisecond return in the same order on ten successive reads.
//! - Every entry carries a non-empty rendered description and a non-null actor id.
//! - Paging the trail with a limit of 2 covers every entry exactly once, matching the
//!   unpaginated read's own order.

use core::db::open_and_migrate;
use core::domain::acceptance_criterion::toggle_criterion;
use core::domain::actor::local_human_actor_id;
use core::domain::event::{append_event, next_sequence};
use core::domain::project::{self, Project};
use core::domain::task::{create_task, set_task_status, update_task};
use core::ids::new_id;
use core::query::events::activity_trail;
use rusqlite::{params, Connection};

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Open a fresh migrated database and register one project (mirrors `criteria.rs`'s/`outbox.rs`'s
/// own `seeded_project` fixture).
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

#[test]
fn new_item_has_exactly_one_entry() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Fresh task", None)
        .expect("create_task should succeed");

    let trail = activity_trail(&conn, "task", &task.id, 50, 0).expect("activity_trail should succeed");

    assert_eq!(trail.len(), 1, "a never-edited task must show exactly one trail entry");
    assert_eq!(trail[0].event_type, "task.created");
    assert!(!trail[0].description.is_empty());
}

#[test]
fn criterion_changes_appear_on_the_parent_trail() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Trail task", None)
        .expect("create_task should succeed");

    update_task(&mut conn, &actor_id, &task.id, Some("Renamed"), None).expect("update_task should succeed");
    set_task_status(&mut conn, &actor_id, &task.id, "in_progress").expect("set_task_status should succeed");
    set_task_status(&mut conn, &actor_id, &task.id, "in_review").expect("set_task_status should succeed");

    // Insert the criterion fixture directly (bypassing `create_criterion`) so setting it up does
    // not itself append a sixth `criterion.created` event onto this trail — this test proves that
    // TOGGLING a criterion shows up on its parent's trail, not that creating one does (that event
    // type is covered identically, `create_criterion`'s own write path is unchanged by this plan).
    let criterion_id = new_id();
    let now = "2026-01-01T00:00:00.000Z";
    conn.execute(
        "INSERT INTO acceptance_criteria (
            id, parent_type, parent_id, statement, verification_hint, checked, rank,
            created_by, created_at, updated_at
        ) VALUES (?1, 'task', ?2, 'Some criterion', NULL, 0, '1', ?3, ?4, ?4)",
        params![criterion_id, task.id, actor_id, now],
    )
    .expect("fixture insert should succeed");

    toggle_criterion(&mut conn, &actor_id, &criterion_id).expect("toggle_criterion should succeed");

    let trail = activity_trail(&conn, "task", &task.id, 50, 0).expect("activity_trail should succeed");

    assert_eq!(
        trail.len(),
        5,
        "created + title edit + 2 status changes + 1 criterion toggle"
    );
    let event_types: Vec<&str> = trail.iter().map(|e| e.event_type.as_str()).collect();
    assert_eq!(
        event_types,
        vec![
            "task.created",
            "task.updated",
            "task.status_changed",
            "task.status_changed",
            "criterion.toggled",
        ],
        "entries must appear in write order"
    );
}

#[test]
fn same_millisecond_events_order_stably() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Same ms", None)
        .expect("create_task should succeed");

    // Two events sharing the exact same `occurred_at` timestamp, appended in one transaction —
    // constructed directly rather than relying on real wall-clock coincidence, so this test does
    // not depend on the OS clock actually producing two calls within one millisecond.
    let same_instant = "2026-01-01T00:00:00.500Z";
    {
        let tx = conn.transaction().expect("transaction should open");
        let seq1 = next_sequence(&tx, &project.id, "local").expect("next_sequence should succeed");
        append_event(
            &tx,
            &project.id,
            "local",
            seq1,
            "task",
            &task.id,
            Some(&task.id),
            None,
            &actor_id,
            "task.updated",
            &serde_json::json!({"field": "title", "before": "Same ms", "after": "A", "label": "Edited title to \"A\""}),
            same_instant,
        )
        .expect("append_event should succeed");
        let seq2 = next_sequence(&tx, &project.id, "local").expect("next_sequence should succeed");
        append_event(
            &tx,
            &project.id,
            "local",
            seq2,
            "task",
            &task.id,
            Some(&task.id),
            None,
            &actor_id,
            "task.updated",
            &serde_json::json!({"field": "title", "before": "A", "after": "B", "label": "Edited title to \"B\""}),
            same_instant,
        )
        .expect("append_event should succeed");
        tx.commit().expect("commit should succeed");
    }

    let first = activity_trail(&conn, "task", &task.id, 50, 0).expect("activity_trail should succeed");
    assert_eq!(first.len(), 3, "created + the two same-instant updates");
    assert_eq!(first[1].occurred_at, first[2].occurred_at, "fixture events share one timestamp");

    let first_ids: Vec<String> = first.iter().map(|e| e.id.clone()).collect();
    for read_number in 0..10 {
        let again = activity_trail(&conn, "task", &task.id, 50, 0).expect("activity_trail should succeed");
        let again_ids: Vec<String> = again.iter().map(|e| e.id.clone()).collect();
        assert_eq!(again_ids, first_ids, "read {read_number} returned a different order");
    }
}

#[test]
fn every_entry_has_a_description_and_an_actor() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Described", None)
        .expect("create_task should succeed");
    update_task(&mut conn, &actor_id, &task.id, Some("Renamed"), None).expect("update_task should succeed");
    set_task_status(&mut conn, &actor_id, &task.id, "in_progress").expect("set_task_status should succeed");

    let trail = activity_trail(&conn, "task", &task.id, 50, 0).expect("activity_trail should succeed");

    assert_eq!(trail.len(), 3);
    for event in &trail {
        assert!(
            !event.description.is_empty(),
            "event {} rendered an empty description",
            event.event_type
        );
        assert!(!event.actor_id.is_empty());
        assert_eq!(event.actor_id, actor_id);
    }
}

#[test]
fn trail_paging_covers_every_entry_once() {
    let (mut conn, actor_id, project) = seeded_project();
    let task = create_task(&mut conn, &project.id, &actor_id, "Paged", None)
        .expect("create_task should succeed");
    update_task(&mut conn, &actor_id, &task.id, Some("A"), None).expect("update_task should succeed");
    update_task(&mut conn, &actor_id, &task.id, Some("B"), None).expect("update_task should succeed");
    set_task_status(&mut conn, &actor_id, &task.id, "in_progress").expect("set_task_status should succeed");

    let full = activity_trail(&conn, "task", &task.id, 50, 0).expect("activity_trail should succeed");
    assert_eq!(full.len(), 4, "created + two title edits + one status change");

    let mut paged_ids: Vec<String> = Vec::new();
    let mut offset = 0;
    loop {
        let page = activity_trail(&conn, "task", &task.id, 2, offset).expect("activity_trail should succeed");
        if page.is_empty() {
            break;
        }
        paged_ids.extend(page.iter().map(|e| e.id.clone()));
        offset += 2;
    }

    let full_ids: Vec<String> = full.iter().map(|e| e.id.clone()).collect();
    assert_eq!(paged_ids, full_ids, "paging must cover every entry exactly once, in the same order");
}
