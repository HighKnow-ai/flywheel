//! The stored text of a timestamp is part of the database's contract (issue #1728, which moved
//! the workspace from `chrono` to `jiff`). Queries order and compare the text directly
//! (`ORDER BY started_at DESC`, `MAX(ended_at)`), so a database that holds rows from the old
//! build and rows from this one must order them as time does, and every old row must still parse.
//!
//! The "old" rows below are literals in the exact spelling `chrono`'s `Utc::now().to_rfc3339()`
//! wrote: `+00:00`, and a fraction of 0, 3, 6 or 9 digits. They are written out here, not derived
//! from this build's writer, so a change to the writer cannot move them.

use flywheel_core::timestamp::{format_rfc3339, now_rfc3339, parse_rfc3339};
use jiff::{SignedDuration, Timestamp};
use rusqlite::Connection;

/// Oldest first, as time orders them: each differs from the next in a different place.
const OLD_ROWS_IN_TIME_ORDER: [&str; 6] = [
    "2026-10-19T09:59:59.999999999+00:00",
    "2026-10-19T10:00:00+00:00",
    "2026-10-19T10:00:00.001+00:00",
    "2026-10-19T10:00:00.001001+00:00",
    "2026-10-19T10:00:00.001001001+00:00",
    "2026-10-19T10:00:01+00:00",
];

fn table_with(rows: &[String]) -> Connection {
    let conn = Connection::open_in_memory().expect("in-memory database");
    conn.execute_batch("CREATE TABLE events (at TEXT NOT NULL)")
        .expect("create the table");
    for row in rows {
        conn.execute("INSERT INTO events (at) VALUES (?1)", [row])
            .expect("insert");
    }
    conn
}

fn ordered_by_text(conn: &Connection) -> Vec<String> {
    let mut stmt = conn
        .prepare("SELECT at FROM events ORDER BY at ASC")
        .expect("prepare");
    stmt.query_map([], |row| row.get(0))
        .expect("query")
        .collect::<Result<_, _>>()
        .expect("rows")
}

#[test]
fn every_row_the_old_build_wrote_still_parses_and_orders_as_time_does() {
    let mut shuffled: Vec<String> = OLD_ROWS_IN_TIME_ORDER.map(String::from).to_vec();
    shuffled.reverse();
    let conn = table_with(&shuffled);

    let by_text = ordered_by_text(&conn);
    assert_eq!(by_text, OLD_ROWS_IN_TIME_ORDER);
    let instants: Vec<Timestamp> = by_text
        .iter()
        .map(|text| parse_rfc3339(text).unwrap_or_else(|| panic!("{text} no longer parses")))
        .collect();
    assert!(
        instants.windows(2).all(|pair| pair[0] < pair[1]),
        "text order and time order agree for the old rows: {instants:?}"
    );
}

#[test]
fn rows_this_build_writes_sort_with_the_old_rows_in_one_column() {
    let old_instants: Vec<Timestamp> = OLD_ROWS_IN_TIME_ORDER
        .iter()
        .map(|text| parse_rfc3339(text).expect("parses"))
        .collect();
    // This build rewrites each old instant, and adds the same instants shifted by a few
    // nanoseconds, so rows of both builds interleave inside single seconds.
    let mut rows: Vec<String> = Vec::new();
    for (index, instant) in old_instants.iter().enumerate() {
        rows.push(format_rfc3339(*instant));
        rows.push(format_rfc3339(
            *instant + SignedDuration::from_nanos(7 + index as i64),
        ));
    }
    let now = now_rfc3339();
    rows.push(now.clone());
    let conn = table_with(&rows);

    let by_text = ordered_by_text(&conn);
    let mut by_instant = by_text.clone();
    by_instant.sort_by_key(|text| parse_rfc3339(text).expect("parses"));
    assert_eq!(
        by_text, by_instant,
        "text order equals time order across rows of both builds"
    );
    assert_eq!(
        by_text.last(),
        Some(&now),
        "a row written now is the newest"
    );
}

#[test]
fn this_build_writes_each_old_row_back_byte_for_byte() {
    for old in OLD_ROWS_IN_TIME_ORDER {
        let instant = parse_rfc3339(old).expect("parses");
        assert_eq!(format_rfc3339(instant), old);
    }
}
