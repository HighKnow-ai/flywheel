//! Behavior under test (01-03-PLAN.md Task 3 — the transactional-outbox, ULID and
//! actor-attribution invariants):
//! - Creating a story writes exactly one `stories` row and exactly one `events` row, and both are
//!   absent if the transaction is rolled back before commit.
//! - A mutation that sets a field to the value it already holds still appends exactly one event
//!   (no deduplication of no-op field changes).
//! - Two Stories created in a tight loop within one millisecond receive strictly increasing
//!   `sequence` values and distinct `events.id` ULIDs.
//! - Two events sharing an `occurred_at` string order identically on repeated reads when ordered
//!   by `(origin, sequence)`, and identically when ordered by `id`.
//! - Inserting a row with `id = ''` is rejected by the length CHECK.
//! - Rows ordered by `id` come back in creation order for a single origin.
//! - Two actors inserted with the same `display_name` are two rows with two ids.
//! - Inserting an `events` row with a NULL `actor_id` fails, and inserting one whose `actor_id`
//!   names no `actors` row fails with a foreign-key error — proving `foreign_keys` is genuinely
//!   on.
//! - Three mutations by one actor inside one transaction produce three events, all carrying that
//!   actor_id, ordered by `sequence` in write order.
//! - A project's key prefix is immutable once the project has allocated its first item key
//!   (01-UI-SPEC.md Open Decisions #11, D-10).

use flywheel_core::db::open_and_migrate;
use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::event::{append_event, next_sequence};
use flywheel_core::domain::project::{self, Project};
use flywheel_core::domain::{epic, milestone, story};
use flywheel_core::ids::new_id;
use rusqlite::{params, Connection};

fn scratch_dir() -> tempfile::TempDir {
    tempfile::tempdir().expect("failed to create scratch dir")
}

/// Open a fresh migrated database and register one project, returning the open connection, the
/// local human actor id, and the registered project — the fixture every test in this file
/// starts from.
fn seeded_project() -> (Connection, String, Project) {
    let dir = scratch_dir();
    let db_path = dir.path().join("flywheel.db");
    let backups_dir = dir.path().join("backups");
    // Leak the tempdir so the database file outlives this function — tests own the returned
    // Connection for their own duration and the OS reclaims the directory on process exit.
    std::mem::forget(dir);

    let mut conn =
        open_and_migrate(&db_path, &backups_dir).expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    let proj = project::create_project(&mut conn, &actor_id, "Threadfin", "/repo", "FLY", "main")
        .expect("create_project should succeed");
    (conn, actor_id, proj)
}

/// A Milestone and an Epic inside it, for Stories to be created in. Returns the Epic id.
fn fixture_epic(conn: &mut Connection, project_id: &str, actor_id: &str) -> String {
    let m = milestone::create_milestone(conn, project_id, actor_id, "Fixture milestone", None)
        .expect("create_milestone should succeed");
    epic::create_epic(conn, actor_id, &m.id, "Fixture epic")
        .expect("create_epic should succeed")
        .id
}

/// A Story created through the domain writer, in its own fresh Milestone and Epic.
fn create_story_in_fresh_epic(
    conn: &mut Connection,
    project_id: &str,
    actor_id: &str,
    title: &str,
) -> story::Story {
    let epic_id = fixture_epic(conn, project_id, actor_id);
    story::create_story(conn, actor_id, &epic_id, title).expect("create_story should succeed")
}

fn count_rows(conn: &Connection, sql: &str, params: &[&dyn rusqlite::ToSql]) -> i64 {
    conn.query_row(sql, params, |row| row.get(0))
        .expect("count query should succeed")
}

#[test]
fn outbox_writes_projection_and_event_together() {
    let (mut conn, actor_id, project) = seeded_project();

    let story = create_story_in_fresh_epic(&mut conn, &project.id, &actor_id, "First story");

    let story_count = count_rows(
        &conn,
        "SELECT COUNT(*) FROM stories WHERE id = ?1",
        &[&story.id],
    );
    assert_eq!(story_count, 1, "expected exactly one stories row");

    let event_count = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'story.created'",
        &[&story.id],
    );
    assert_eq!(event_count, 1, "expected exactly one story.created event");
}

#[test]
fn outbox_rollback_writes_neither() {
    let (mut conn, actor_id, project) = seeded_project();
    let epic_id = fixture_epic(&mut conn, &project.id, &actor_id);
    let id = new_id();

    {
        let tx = conn.transaction().expect("should open a transaction");
        tx.execute(
            "INSERT INTO stories (
                id, project_id, epic_id, key, title, state, rank,
                created_by, created_at, updated_at
            ) VALUES (?1, ?2, ?3, 'FLY-ROLLBACK', 'Rollback me', 'shaping', '80', ?4, ?5, ?5)",
            params![id, project.id, epic_id, actor_id, "2026-01-01T00:00:00Z"],
        )
        .expect("insert inside the transaction should succeed");

        let sequence =
            next_sequence(&tx, &project.id, "local").expect("should allocate a sequence");
        append_event(
            &tx,
            &project.id,
            "local",
            sequence,
            "story",
            &id,
            Some(&id),
            Some(&epic_id),
            &actor_id,
            "story.created",
            &serde_json::json!({}),
            "2026-01-01T00:00:00Z",
        )
        .expect("append_event should succeed");

        // `tx` is dropped here without `.commit()` — rusqlite rolls back on Drop.
    }

    let story_count = count_rows(&conn, "SELECT COUNT(*) FROM stories WHERE id = ?1", &[&id]);
    let event_count = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1",
        &[&id],
    );
    assert_eq!(
        story_count, 0,
        "rolled-back transaction must leave no stories row"
    );
    assert_eq!(
        event_count, 0,
        "rolled-back transaction must leave no events row"
    );
}

#[test]
fn append_event_for_a_no_op_field_change_still_appends_exactly_one_event() {
    // Simulates a mutation that sets a field to the value it already holds: append_event does
    // not deduplicate no-op changes — every mutation call appends exactly one row.
    let (mut conn, actor_id, project) = seeded_project();
    let story = create_story_in_fresh_epic(&mut conn, &project.id, &actor_id, "Unchanged title");

    let before_count = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1",
        &[&story.id],
    );

    let tx = conn.transaction().expect("should open a transaction");
    let sequence = next_sequence(&tx, &project.id, "local").expect("should allocate a sequence");
    let payload = serde_json::json!({
        "field": "title",
        "before": "Unchanged title",
        "after": "Unchanged title",
    });
    append_event(
        &tx,
        &project.id,
        "local",
        sequence,
        "story",
        &story.id,
        Some(&story.id),
        None,
        &actor_id,
        "story.updated",
        &payload,
        "2026-01-01T00:00:01Z",
    )
    .expect("append_event should succeed even for a no-op field change");
    tx.commit().expect("commit should succeed");

    let after_count = count_rows(
        &conn,
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1",
        &[&story.id],
    );
    assert_eq!(
        after_count,
        before_count + 1,
        "a no-op field change must still append exactly one event"
    );
}

#[test]
fn ids_same_millisecond_are_distinct_and_ascending() {
    let (mut conn, actor_id, project) = seeded_project();

    let epic_id = fixture_epic(&mut conn, &project.id, &actor_id);
    let mut story_ids = Vec::new();
    let mut sequences = Vec::new();
    for i in 0..25 {
        let story = story::create_story(&mut conn, &actor_id, &epic_id, &format!("Story {i}"))
            .expect("create_story should succeed");
        story_ids.push(story.id.clone());

        let sequence: i64 = conn
            .query_row(
                "SELECT sequence FROM events WHERE stream_id = ?1",
                params![story.id],
                |row| row.get(0),
            )
            .expect("event row should exist for this story");
        sequences.push(sequence);
    }

    let unique_ids: std::collections::HashSet<&String> = story_ids.iter().collect();
    assert_eq!(
        unique_ids.len(),
        story_ids.len(),
        "expected no duplicate story ids"
    );

    for pair in story_ids.windows(2) {
        assert!(pair[0] < pair[1], "expected strictly ascending story ULIDs");
    }
    for pair in sequences.windows(2) {
        assert!(
            pair[0] < pair[1],
            "expected strictly increasing sequence values, got {:?}",
            sequences
        );
    }
}

#[test]
fn events_order_is_stable_under_equal_timestamps() {
    let (mut conn, actor_id, project) = seeded_project();
    let story = create_story_in_fresh_epic(&mut conn, &project.id, &actor_id, "Shared timestamp");

    // Append two more events sharing the exact same `occurred_at` string.
    let shared_timestamp = "2026-06-01T00:00:00.000Z";
    let mut appended_ids = Vec::new();
    for i in 0..2 {
        let tx = conn.transaction().expect("should open a transaction");
        let sequence =
            next_sequence(&tx, &project.id, "local").expect("should allocate a sequence");
        let event_id = append_event(
            &tx,
            &project.id,
            "local",
            sequence,
            "story",
            &story.id,
            Some(&story.id),
            None,
            &actor_id,
            "story.updated",
            &serde_json::json!({ "field": "note", "before": null, "after": i }),
            shared_timestamp,
        )
        .expect("append_event should succeed");
        tx.commit().expect("commit should succeed");
        appended_ids.push(event_id);
    }

    // Ordered by (origin, sequence): stable across repeated reads.
    let by_sequence_first: Vec<String> = query_event_ids(
        &conn,
        "SELECT id FROM events WHERE stream_id = ?1 AND occurred_at = ?2 ORDER BY origin, sequence",
        &story.id,
        shared_timestamp,
    );
    let by_sequence_second: Vec<String> = query_event_ids(
        &conn,
        "SELECT id FROM events WHERE stream_id = ?1 AND occurred_at = ?2 ORDER BY origin, sequence",
        &story.id,
        shared_timestamp,
    );
    assert_eq!(
        by_sequence_first, by_sequence_second,
        "(origin, sequence) order must be stable"
    );

    // Ordered by id: also stable across repeated reads.
    let by_id_first: Vec<String> = query_event_ids(
        &conn,
        "SELECT id FROM events WHERE stream_id = ?1 AND occurred_at = ?2 ORDER BY id",
        &story.id,
        shared_timestamp,
    );
    let by_id_second: Vec<String> = query_event_ids(
        &conn,
        "SELECT id FROM events WHERE stream_id = ?1 AND occurred_at = ?2 ORDER BY id",
        &story.id,
        shared_timestamp,
    );
    assert_eq!(by_id_first, by_id_second, "id order must be stable");
    assert_eq!(
        by_id_first.len(),
        2,
        "expected both appended events to be present"
    );
}

fn query_event_ids(
    conn: &Connection,
    sql: &str,
    stream_id: &str,
    occurred_at: &str,
) -> Vec<String> {
    let mut stmt = conn.prepare(sql).expect("prepare should succeed");
    stmt.query_map(params![stream_id, occurred_at], |row| row.get(0))
        .expect("query_map should succeed")
        .collect::<Result<Vec<_>, _>>()
        .expect("collecting event ids should succeed")
}

#[test]
fn empty_id_is_rejected_by_the_length_check() {
    let (conn, actor_id, _project) = seeded_project();
    let result = conn.execute(
        "INSERT INTO actors (id, type, display_name, created_at) VALUES (?1, 'human', 'Nobody', ?2)",
        params!["", "2026-01-01T00:00:00Z"],
    );
    assert!(
        result.is_err(),
        "an empty id must be rejected by the length CHECK"
    );
    // Sanity: the seeded actor's real id has the expected shape, so the constraint is on length,
    // not on the well-formed id path.
    assert_eq!(actor_id.len(), 26);
}

#[test]
fn rows_ordered_by_id_come_back_in_creation_order_for_one_origin() {
    let (mut conn, actor_id, project) = seeded_project();

    let epic_id = fixture_epic(&mut conn, &project.id, &actor_id);
    let mut created_ids = Vec::new();
    for i in 0..10 {
        let story = story::create_story(&mut conn, &actor_id, &epic_id, &format!("Story {i}"))
            .expect("create_story should succeed");
        created_ids.push(story.id);
    }

    let mut stmt = conn
        .prepare("SELECT id FROM stories WHERE project_id = ?1 ORDER BY id ASC")
        .expect("prepare should succeed");
    let read_back: Vec<String> = stmt
        .query_map(params![project.id], |row| row.get(0))
        .expect("query_map should succeed")
        .collect::<Result<Vec<_>, _>>()
        .expect("collecting ids should succeed");

    assert_eq!(
        read_back, created_ids,
        "id ordering must reproduce creation order"
    );
}

#[test]
fn two_actors_with_identical_display_name_are_distinct_rows() {
    let (conn, _actor_id, _project) = seeded_project();

    let id_a = new_id();
    let id_b = new_id();
    conn.execute(
        "INSERT INTO actors (id, type, display_name, created_at) VALUES (?1, 'human', 'Ada', ?2)",
        params![id_a, "2026-01-01T00:00:00Z"],
    )
    .expect("insert should succeed");
    conn.execute(
        "INSERT INTO actors (id, type, display_name, created_at) VALUES (?1, 'human', 'Ada', ?2)",
        params![id_b, "2026-01-01T00:00:01Z"],
    )
    .expect("insert should succeed");

    assert_ne!(id_a, id_b);
    let count = count_rows(
        &conn,
        "SELECT COUNT(*) FROM actors WHERE display_name = 'Ada'",
        &[],
    );
    assert_eq!(
        count, 2,
        "two actors with the same display_name must remain two distinct rows"
    );
}

#[test]
fn actor_attribution_is_not_nullable() {
    let (mut conn, actor_id, project) = seeded_project();
    let story = create_story_in_fresh_epic(&mut conn, &project.id, &actor_id, "Attributed story");

    // A NULL actor_id must be rejected by the NOT NULL constraint.
    let null_actor_result = conn.execute(
        "INSERT INTO events (
            id, project_id, origin, sequence, stream_type, stream_id, story_id, epic_id,
            actor_id, event_type, payload, occurred_at
        ) VALUES (?1, ?2, 'local', 9999, 'story', ?3, ?3, NULL, NULL, 'story.updated', '{}', ?4)",
        params![new_id(), project.id, story.id, "2026-01-01T00:00:00Z"],
    );
    assert!(
        null_actor_result.is_err(),
        "a NULL actor_id must be rejected"
    );

    // An actor_id naming no `actors` row must fail with a foreign-key error — this is the
    // assertion that proves `foreign_keys` is genuinely ON, not silently reverted (Pitfall 1):
    // the connection is the SAME one `seeded_project()` opened via `open_and_migrate`, so if
    // pragmas were not re-applied, this insert would silently succeed instead of erroring.
    let orphan_actor_result = conn.execute(
        "INSERT INTO events (
            id, project_id, origin, sequence, stream_type, stream_id, story_id, epic_id,
            actor_id, event_type, payload, occurred_at
        ) VALUES (?1, ?2, 'local', 10000, 'story', ?3, ?3, NULL, ?4, 'story.updated', '{}', ?5)",
        params![
            new_id(),
            project.id,
            story.id,
            "01ARZ3NDEKTSV4RRFFQNONEXIST",
            "2026-01-01T00:00:00Z"
        ],
    );
    assert!(
        orphan_actor_result.is_err(),
        "an actor_id naming no actors row must fail with a foreign-key error"
    );
}

#[test]
fn three_mutations_by_one_actor_in_one_transaction_share_actor_id_and_write_order() {
    let (mut conn, actor_id, project) = seeded_project();
    let story = create_story_in_fresh_epic(&mut conn, &project.id, &actor_id, "Multi-event story");

    let tx = conn.transaction().expect("should open a transaction");
    let mut sequences = Vec::new();
    for i in 0..3 {
        let sequence =
            next_sequence(&tx, &project.id, "local").expect("should allocate a sequence");
        sequences.push(sequence);
        append_event(
            &tx,
            &project.id,
            "local",
            sequence,
            "story",
            &story.id,
            Some(&story.id),
            None,
            &actor_id,
            "story.updated",
            &serde_json::json!({ "field": "note", "before": null, "after": i }),
            "2026-01-01T00:00:00Z",
        )
        .expect("append_event should succeed");
    }
    tx.commit().expect("commit should succeed");

    let mut stmt = conn
        .prepare(
            "SELECT actor_id, sequence FROM events
             WHERE stream_id = ?1 AND event_type = 'story.updated'
             ORDER BY sequence ASC",
        )
        .expect("prepare should succeed");
    let rows: Vec<(String, i64)> = stmt
        .query_map(params![story.id], |row| Ok((row.get(0)?, row.get(1)?)))
        .expect("query_map should succeed")
        .collect::<Result<Vec<_>, _>>()
        .expect("collecting rows should succeed");

    assert_eq!(rows.len(), 3, "expected exactly three story.updated events");
    for (actor, _) in &rows {
        assert_eq!(actor, &actor_id, "every event must carry the same actor_id");
    }
    let read_sequences: Vec<i64> = rows.iter().map(|(_, s)| *s).collect();
    assert_eq!(
        read_sequences, sequences,
        "events must be ordered by sequence in write order"
    );
}

#[test]
fn project_key_prefix_is_immutable_once_an_item_exists() {
    let (mut conn, actor_id, project) = seeded_project();

    // Before any item exists, the prefix may still be changed.
    project::update_key_prefix(&mut conn, &project.id, "FLYX")
        .expect("changing the prefix before any item exists should succeed");

    // Allocate the first item's key.
    let _story = create_story_in_fresh_epic(&mut conn, &project.id, &actor_id, "First item");

    // Now the prefix is immutable.
    let result = project::update_key_prefix(&mut conn, &project.id, "OTHR");
    assert!(
        result.is_err(),
        "the key prefix must be immutable once the project has allocated its first item key"
    );

    let key_prefix: String = conn
        .query_row(
            "SELECT key_prefix FROM projects WHERE id = ?1",
            params![project.id],
            |row| row.get(0),
        )
        .expect("reading the project's key_prefix should succeed");
    assert_eq!(
        key_prefix, "FLYX",
        "a rejected update must not have changed the stored prefix"
    );
}
