//! Phase 09 plan 09-04: the one global number that caps how many agent sessions the dispatcher
//! may have running at once (PLAN-06, D-159) — its default, its closed range, its degradation on a
//! malformed stored value, and the occupancy it is read against.
//!
//! The cap gates the dispatcher's own spawns only; nothing here, or anywhere in this plan, refuses
//! a user-initiated launch.

mod common;

use core::db::open_and_migrate;
use core::dispatch::occupied_slots;
use core::domain::epic::create_epic;
use core::domain::project;
use core::domain::settings::{
    dispatch_max_parallel, set_dispatch_max_parallel, DEFAULT_DISPATCH_MAX_PARALLEL,
    DISPATCH_MAX_PARALLEL_MAX, DISPATCH_MAX_PARALLEL_MIN,
};
use core::domain::task::create_task;
use core::ids::new_id;
use rusqlite::{params, Connection};

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

fn write_raw_setting(conn: &Connection, value: &str) {
    conn.execute(
        "INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('dispatch_max_parallel', ?1, 'x', 'now')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value],
    )
    .unwrap();
}

// --- the cap ---------------------------------------------------------------------------------

#[test]
fn the_bounds_and_the_default_are_one_to_eight_and_three() {
    assert_eq!(DISPATCH_MAX_PARALLEL_MIN, 1);
    assert_eq!(DISPATCH_MAX_PARALLEL_MAX, 8);
    assert_eq!(DEFAULT_DISPATCH_MAX_PARALLEL, 3);
}

#[test]
fn with_no_row_ever_written_the_cap_reads_three() {
    let (conn, _actor, _project) = common::seeded_project();
    assert_eq!(dispatch_max_parallel(&conn).unwrap(), 3);
}

#[test]
fn both_ends_of_the_range_are_accepted_and_stored() {
    let (mut conn, actor, _project) = common::seeded_project();
    set_dispatch_max_parallel(&mut conn, &actor, 1).unwrap();
    assert_eq!(dispatch_max_parallel(&conn).unwrap(), 1);
    set_dispatch_max_parallel(&mut conn, &actor, 8).unwrap();
    assert_eq!(dispatch_max_parallel(&conn).unwrap(), 8);
}

#[test]
fn both_out_of_range_values_are_refused_with_the_bounds_named_and_nothing_stored() {
    let (mut conn, actor, _project) = common::seeded_project();
    set_dispatch_max_parallel(&mut conn, &actor, 5).unwrap();
    for bad in [0u32, 9] {
        let err = set_dispatch_max_parallel(&mut conn, &actor, bad).unwrap_err().to_string();
        assert!(err.contains('1') && err.contains('8'), "the error must name both bounds: {err}");
        assert_eq!(dispatch_max_parallel(&conn).unwrap(), 5, "{bad} must leave the stored value alone");
    }
}

#[test]
fn a_refusal_on_a_fresh_database_stores_no_row_at_all() {
    let (mut conn, actor, _project) = common::seeded_project();
    set_dispatch_max_parallel(&mut conn, &actor, 0).unwrap_err();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM settings WHERE key = 'dispatch_max_parallel'"), 0);
}

#[test]
fn a_malformed_stored_value_reads_back_as_the_default_instead_of_failing() {
    let (conn, _actor, _project) = common::seeded_project();
    for bad in ["not a number", "", "3.5", "-1", "0", "99", "9", " 4", "4294967296"] {
        write_raw_setting(&conn, bad);
        assert_eq!(
            dispatch_max_parallel(&conn).unwrap(),
            DEFAULT_DISPATCH_MAX_PARALLEL,
            "stored {bad:?} must read as the default"
        );
    }
    write_raw_setting(&conn, "6");
    assert_eq!(dispatch_max_parallel(&conn).unwrap(), 6, "a good value still reads back");
}

#[test]
fn setting_the_cap_writes_one_settings_row_and_no_event() {
    let (mut conn, actor, _project) = common::seeded_project();
    let events_before = count(&conn, "SELECT COUNT(*) FROM events");
    set_dispatch_max_parallel(&mut conn, &actor, 4).unwrap();
    set_dispatch_max_parallel(&mut conn, &actor, 6).unwrap();
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM events"), events_before);
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM settings WHERE key = 'dispatch_max_parallel'"), 1);
    let by: String = conn
        .query_row("SELECT updated_by FROM settings WHERE key = 'dispatch_max_parallel'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(by, actor, "the settings row is the audit record for the global scope");
}

// --- occupancy -------------------------------------------------------------------------------

/// A raw `agent_runs` row (with its trigger) — the occupancy read cares only about `status`, and
/// a real launch needs a git repository, so the fixture writes the row directly.
fn insert_run(conn: &Connection, actor: &str, project_id: &str, subject: Subject, status: &str) {
    let trigger_id = new_id();
    let (task_id, epic_id) = match &subject {
        Subject::Task(t) => (Some(t.as_str()), None),
        Subject::Epic(e) => (None, Some(e.as_str())),
    };
    conn.execute(
        "INSERT INTO triggers (id, project_id, target_task_id, target_epic_id, source, created_by, created_at)
         VALUES (?1, ?2, ?3, ?4, 'user_action', ?5, 'now')",
        params![trigger_id, project_id, task_id, epic_id, actor],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO agent_runs (id, task_id, epic_id, project_id, trigger_id, actor_id, status, permission_mode, log_path, started_at, authoring_stage)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'default', '/dev/null', 'now', ?8)",
        params![
            new_id(),
            task_id,
            epic_id,
            project_id,
            trigger_id,
            actor,
            status,
            epic_id.map(|_| "challenge")
        ],
    )
    .unwrap();
}

enum Subject {
    Task(String),
    Epic(String),
}

#[test]
fn occupancy_counts_running_and_blocked_runs_of_every_kind_across_projects_and_only_those() {
    let dir = tempfile::tempdir().unwrap();
    let db_path = dir.path().join("flywheel.db");
    let backups = dir.path().join("backups");
    let mut conn = open_and_migrate(&db_path, &backups).unwrap();
    let actor = core::domain::actor::local_human_actor_id(&conn).unwrap();
    let p1 = project::create_project(&mut conn, &actor, "One", "/one", "ONE", "main").unwrap();
    let p2 = project::create_project(&mut conn, &actor, "Two", "/two", "TWO", "main").unwrap();
    let epic = create_epic(&mut conn, &p1.id, &actor, "Epic", None).unwrap();
    let t1 = create_task(&mut conn, &p1.id, &actor, "T1", None).unwrap();
    let t2 = create_task(&mut conn, &p2.id, &actor, "T2", None).unwrap();
    let t3 = create_task(&mut conn, &p2.id, &actor, "T3", None).unwrap();
    let t4 = create_task(&mut conn, &p2.id, &actor, "T4", None).unwrap();
    let t5 = create_task(&mut conn, &p2.id, &actor, "T5", None).unwrap();
    let t6 = create_task(&mut conn, &p2.id, &actor, "T6", None).unwrap();

    assert_eq!(occupied_slots(&conn).unwrap(), 0);

    insert_run(&conn, &actor, &p1.id, Subject::Task(t1.id.clone()), "running");
    insert_run(&conn, &actor, &p2.id, Subject::Task(t2.id.clone()), "blocked");
    insert_run(&conn, &actor, &p1.id, Subject::Epic(epic.id.clone()), "running");
    // None of these hold a slot.
    insert_run(&conn, &actor, &p2.id, Subject::Task(t3.id.clone()), "completed");
    insert_run(&conn, &actor, &p2.id, Subject::Task(t4.id.clone()), "failed");
    insert_run(&conn, &actor, &p2.id, Subject::Task(t5.id.clone()), "interrupted");
    insert_run(&conn, &actor, &p2.id, Subject::Task(t6.id.clone()), "abandoned");

    assert_eq!(occupied_slots(&conn).unwrap(), 3);

    // The database is the truth, not memory: a fresh connection reads the same number.
    drop(conn);
    let reopened = open_and_migrate(&db_path, &backups).unwrap();
    assert_eq!(occupied_slots(&reopened).unwrap(), 3);
}
