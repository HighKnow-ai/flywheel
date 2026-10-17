//! FNC-02 / D-22: every table the migrated database holds is classified in
//! `core::schema_classification::TABLE_CLASSES`, and every classification names a table the
//! database holds. The check reads `sqlite_master`, not the migration text, because a migration is
//! SQL and a new table reaches the database without the compiler ever seeing it.
//!
//! Self-contained: carries its own scratch-database helper rather than sharing one.

use core::db::open_and_migrate;
use core::schema_classification::TABLE_CLASSES;
use rusqlite::Connection;

/// FTS5 creates these implicitly for every virtual table; no migration can name them on its own.
const FTS_SHADOW_SUFFIXES: [&str; 5] = ["_data", "_idx", "_content", "_docsize", "_config"];

/// The spine. A `sqlite_master` read that does not return at least these is a broken read, not a
/// clean schema.
const SPINE_TABLES: [&str; 4] = ["milestones", "epics", "stories", "acceptance_criteria"];

fn migrated_scratch_db() -> (Connection, tempfile::TempDir) {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let conn = open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
        .expect("open_and_migrate should succeed");
    (conn, dir)
}

fn classified_names() -> Vec<&'static str> {
    TABLE_CLASSES.iter().map(|(name, _)| *name).collect()
}

/// Table and view names from `sqlite_master`, less the two named categories no migration owns.
fn database_tables(conn: &Connection) -> Vec<String> {
    let all: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') ORDER BY name")
        .expect("sqlite_master query should prepare")
        .query_map([], |row| row.get::<_, String>(0))
        .expect("sqlite_master query should run")
        .collect::<Result<_, _>>()
        .expect("sqlite_master rows should read");

    for spine in SPINE_TABLES {
        assert!(
            all.iter().any(|n| n == spine),
            "sqlite_master did not report spine table {spine:?}; the read is broken, so an empty \
             comparison would pass vacuously. Saw {all:?}"
        );
    }

    let search_indexes: Vec<&str> = TABLE_CLASSES
        .iter()
        .filter(|(_, class)| *class == core::schema_classification::TableClass::SearchIndex)
        .map(|(name, _)| *name)
        .collect();

    all.into_iter()
        .filter(|name| {
            // SQLite's own internal tables (`sqlite_sequence`, ...); no migration creates them.
            if name.starts_with("sqlite_") {
                return false;
            }
            // An FTS5 shadow table of an already-classified search index.
            !search_indexes.iter().any(|fts| {
                FTS_SHADOW_SUFFIXES.iter().any(|suffix| *name == format!("{fts}{suffix}"))
            })
        })
        .collect()
}

/// Both directions of the comparison, each sorted by name so two runs print identical text.
/// Comparison is exact and case-sensitive: two spellings are two tables and both must be listed.
fn offenders(conn: &Connection) -> (Vec<String>, Vec<String>) {
    let in_db = database_tables(conn);
    let listed = classified_names();

    let mut unclassified: Vec<String> =
        in_db.iter().filter(|n| !listed.contains(&n.as_str())).cloned().collect();
    let mut stale: Vec<String> =
        listed.iter().filter(|n| !in_db.iter().any(|d| d == *n)).map(|n| n.to_string()).collect();
    unclassified.sort();
    stale.sort();
    (unclassified, stale)
}

#[test]
fn every_table_in_the_database_is_classified_and_every_classification_exists() {
    let (conn, _dir) = migrated_scratch_db();
    let (unclassified, stale) = offenders(&conn);
    assert!(
        unclassified.is_empty() && stale.is_empty(),
        "FNC-02: the schema and core::schema_classification::TABLE_CLASSES disagree.\n\
         In the database but not classified (classify the new table): {unclassified:?}\n\
         Classified but not in the database (remove the stale entry): {stale:?}"
    );
}

#[test]
fn the_classification_gate_fires_on_a_planted_table() {
    let (conn, _dir) = migrated_scratch_db();
    conn.execute_batch("CREATE TABLE a_table_nobody_classified (id TEXT PRIMARY KEY)")
        .expect("planting a table should succeed");
    let (unclassified, stale) = offenders(&conn);
    assert_eq!(unclassified, vec!["a_table_nobody_classified".to_string()]);
    assert!(stale.is_empty(), "planting a table must not make an entry stale: {stale:?}");
}
