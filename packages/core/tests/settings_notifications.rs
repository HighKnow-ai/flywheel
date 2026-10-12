//! Phase 10 plan 10-07 (FLEET-05, D-176): the one global switch for OS notifications — default on,
//! round-trip, and degrade-to-default on a garbage stored value, like the dispatch cap.

mod common;

use core::domain::settings::{notifications_enabled, set_notifications_enabled, DEFAULT_NOTIFICATIONS_ENABLED};
use rusqlite::{params, Connection};

fn write_raw(conn: &Connection, actor: &str, value: &str) {
    conn.execute(
        "INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('notifications_enabled', ?1, ?2, 'now')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![value, actor],
    )
    .unwrap();
}

#[test]
fn with_nothing_stored_notifications_are_on() {
    let (conn, _actor, _project) = common::seeded_project();
    assert!(DEFAULT_NOTIFICATIONS_ENABLED);
    assert!(notifications_enabled(&conn).unwrap());
}

#[test]
fn false_and_true_round_trip_and_record_the_actor() {
    let (mut conn, actor, _project) = common::seeded_project();
    set_notifications_enabled(&mut conn, &actor, false).unwrap();
    assert!(!notifications_enabled(&conn).unwrap());
    set_notifications_enabled(&mut conn, &actor, true).unwrap();
    assert!(notifications_enabled(&conn).unwrap());
    let by: String = conn
        .query_row("SELECT updated_by FROM settings WHERE key = 'notifications_enabled'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(by, actor);
}

#[test]
fn an_unparseable_stored_value_degrades_to_on_rather_than_erroring() {
    let (conn, actor, _project) = common::seeded_project();
    for garbage in ["", "yes", "0", "maybe", "TRUE"] {
        write_raw(&conn, &actor, garbage);
        assert!(notifications_enabled(&conn).unwrap(), "{garbage:?} must degrade to on");
    }
}

#[test]
fn setting_writes_a_settings_row_and_no_event() {
    let (mut conn, actor, _project) = common::seeded_project();
    let events = |c: &Connection| c.query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, i64>(0)).unwrap();
    let before = events(&conn);
    set_notifications_enabled(&mut conn, &actor, false).unwrap();
    assert_eq!(events(&conn), before);
}
