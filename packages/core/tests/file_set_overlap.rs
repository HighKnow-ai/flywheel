//! D-148's vocabulary and containment predicate (`core::file_set`), and the declared-set rows the
//! run-time hook and every plan-time check read (`core::domain::file_set`). Phase 09 plan 09-01.
//!
//! Plan 09-03 adds the pair-overlap and `collisions` cases to this same file; this plan needs
//! containment only.

mod common;

use core::domain::file_set::{
    declare_file_set, list_entries_for_task, EVENT_FILE_SET_DECLARED,
};
use core::domain::task::create_task;
use core::file_set::{
    covers, entry_form, entry_path, parse_entry, EntryRefusal, FileSetEntry, FILE_SET_FORMS,
};
use rusqlite::params;

fn file(p: &str) -> FileSetEntry {
    FileSetEntry::File(p.to_string())
}

fn dir(p: &str) -> FileSetEntry {
    FileSetEntry::Dir(p.to_string())
}

// --- the single list ------------------------------------------------------------------------

#[test]
fn the_form_vocabulary_is_exactly_file_and_dir() {
    assert_eq!(FILE_SET_FORMS, ["file", "dir"]);
}

#[test]
fn the_migration_check_lists_exactly_the_forms_the_rust_constant_declares() {
    let migration = core::db::migration_sources()
        .into_iter()
        .find(|src| src.contains("CREATE TABLE task_file_set_entries"))
        .expect("0019 should be registered in the migration source list");
    let expected = format!(
        "CHECK (form IN ({}))",
        FILE_SET_FORMS.iter().map(|f| format!("'{f}'")).collect::<Vec<_>>().join(", ")
    );
    assert!(
        migration.contains(&expected),
        "the migration's form CHECK must mirror FILE_SET_FORMS; expected `{expected}`"
    );
}

#[test]
fn stored_form_strings_come_from_the_constant() {
    assert!(FILE_SET_FORMS.contains(&entry_form(&file("a.rs"))));
    assert!(FILE_SET_FORMS.contains(&entry_form(&dir("a/"))));
}

// --- parse_entry: reject, never repair ------------------------------------------------------

#[test]
fn a_plain_path_parses_as_a_file_and_a_trailing_slash_as_a_dir() {
    assert_eq!(parse_entry("packages/core/src/lib.rs"), Ok(file("packages/core/src/lib.rs")));
    assert_eq!(parse_entry("packages/core/src/domain/"), Ok(dir("packages/core/src/domain/")));
    assert_eq!(parse_entry("Cargo.toml"), Ok(file("Cargo.toml")));
    assert_eq!(parse_entry(".gitignore"), Ok(file(".gitignore")), ".gitignore is not the git directory");
    assert_eq!(parse_entry("docs/a b.md"), Ok(file("docs/a b.md")), "an interior space is a legal file name");
}

#[test]
fn the_empty_and_whitespace_only_strings_are_refused() {
    assert_eq!(parse_entry(""), Err(EntryRefusal::Empty));
    assert_eq!(parse_entry("   "), Err(EntryRefusal::Empty));
    assert_eq!(parse_entry("\t\n"), Err(EntryRefusal::Empty));
}

#[test]
fn surrounding_whitespace_is_refused_not_trimmed() {
    assert_eq!(parse_entry(" src/a.rs"), Err(EntryRefusal::SurroundingWhitespace));
    assert_eq!(parse_entry("src/a.rs "), Err(EntryRefusal::SurroundingWhitespace));
}

#[test]
fn an_absolute_path_is_refused() {
    assert_eq!(parse_entry("/etc/passwd"), Err(EntryRefusal::Absolute));
    assert_eq!(parse_entry("/src/a.rs"), Err(EntryRefusal::Absolute));
    assert_eq!(parse_entry("/src/"), Err(EntryRefusal::Absolute));
}

#[test]
fn a_dot_or_parent_segment_is_refused() {
    assert_eq!(parse_entry("src/../etc/passwd"), Err(EntryRefusal::DotSegment));
    assert_eq!(parse_entry("../outside.rs"), Err(EntryRefusal::DotSegment));
    assert_eq!(parse_entry("./src/a.rs"), Err(EntryRefusal::DotSegment));
    assert_eq!(parse_entry("src/./a.rs"), Err(EntryRefusal::DotSegment));
    assert_eq!(parse_entry("src/.."), Err(EntryRefusal::DotSegment));
    assert_eq!(parse_entry("src/../"), Err(EntryRefusal::DotSegment));
}

#[test]
fn a_doubled_separator_is_refused() {
    assert_eq!(parse_entry("src//a.rs"), Err(EntryRefusal::DoubledSeparator));
    assert_eq!(parse_entry("src//"), Err(EntryRefusal::DoubledSeparator));
}

#[test]
fn a_backslash_nul_or_control_character_is_refused() {
    assert_eq!(parse_entry("src\\a.rs"), Err(EntryRefusal::Backslash));
    assert_eq!(parse_entry("src/a\0.rs"), Err(EntryRefusal::ControlCharacter));
    assert_eq!(parse_entry("src/a\n.rs"), Err(EntryRefusal::ControlCharacter));
    assert_eq!(parse_entry("src/a\u{7f}.rs"), Err(EntryRefusal::ControlCharacter));
}

#[test]
fn each_glob_metacharacter_is_refused_by_name() {
    for glob in ['*', '?', '[', ']', '{', '}'] {
        let raw = format!("src/a{glob}.rs");
        assert_eq!(parse_entry(&raw), Err(EntryRefusal::Glob(glob)), "{raw}");
    }
    assert_eq!(parse_entry("src/**/*.rs"), Err(EntryRefusal::Glob('*')));
    assert_eq!(parse_entry("src/[ab]/"), Err(EntryRefusal::Glob('[')));
}

#[test]
fn the_repository_root_is_refused() {
    assert_eq!(parse_entry("/"), Err(EntryRefusal::RepositoryRoot));
    assert_eq!(parse_entry("."), Err(EntryRefusal::RepositoryRoot));
    assert_eq!(parse_entry("./"), Err(EntryRefusal::RepositoryRoot));
}

#[test]
fn the_git_directory_and_anything_under_it_is_refused() {
    assert_eq!(parse_entry(".git"), Err(EntryRefusal::GitDirectory));
    assert_eq!(parse_entry(".git/"), Err(EntryRefusal::GitDirectory));
    assert_eq!(parse_entry(".git/hooks/pre-push"), Err(EntryRefusal::GitDirectory));
    assert_eq!(parse_entry(".GIT/config"), Err(EntryRefusal::GitDirectory));
}

#[test]
fn every_refusal_has_a_readable_named_cause() {
    for raw in ["", "/a", "a/../b", "a//b", "a\\b", "a\0b", "a*", "/", ".git/x", " a"] {
        let refusal = parse_entry(raw).expect_err(raw);
        assert!(!refusal.to_string().is_empty(), "{raw:?} has no message");
    }
    assert!(parse_entry("a*").unwrap_err().to_string().contains('*'), "a glob refusal names the glob character");
}

#[test]
fn a_parsed_entry_round_trips_through_its_stored_path() {
    for raw in ["a/b.rs", "a/b/", "x"] {
        let parsed = parse_entry(raw).unwrap();
        assert_eq!(entry_path(&parsed), raw);
        assert_eq!(parse_entry(entry_path(&parsed)), Ok(parsed));
    }
}

// --- covers ---------------------------------------------------------------------------------

#[test]
fn a_file_entry_covers_exactly_its_own_path() {
    let e = file("packages/core/src/lib.rs");
    assert!(covers(&e, "packages/core/src/lib.rs", false));
    assert!(!covers(&e, "packages/core/src/lib.rs.bak", false));
    assert!(!covers(&e, "packages/core/src/lib.r", false));
    assert!(!covers(&e, "packages/core/src/lib.rs/x", false));
}

#[test]
fn a_dir_entry_covers_paths_beneath_it() {
    let e = dir("packages/core/src/domain/");
    assert!(covers(&e, "packages/core/src/domain/task.rs", false));
    assert!(covers(&e, "packages/core/src/domain/deep/er/file.rs", false));
}

#[test]
fn a_dir_entry_does_not_cover_a_sibling_that_shares_its_name_as_a_prefix() {
    let e = dir("packages/core/src/domain/");
    assert!(!covers(&e, "packages/core/src/domain_x.rs", false));
    assert!(!covers(&e, "packages/core/src/domains/a.rs", false));
}

#[test]
fn a_dir_entry_does_not_cover_its_own_path() {
    let e = dir("packages/core/src/domain/");
    assert!(!covers(&e, "packages/core/src/domain", false), "separator stripped");
    assert!(!covers(&e, "packages/core/src/domain/", false), "no further component");
}

#[test]
fn nothing_covers_the_empty_path_or_a_path_outside() {
    assert!(!covers(&dir("a/"), "", false));
    assert!(!covers(&file("a"), "", false));
    assert!(!covers(&dir("a/"), "b/a/c", false));
}

#[test]
fn case_folding_is_off_unless_asked_for() {
    assert!(!covers(&file("src/Foo.ts"), "src/foo.ts", false));
    assert!(covers(&file("src/Foo.ts"), "src/foo.ts", true));
    assert!(covers(&dir("Src/"), "src/a.ts", true));
    assert!(!covers(&dir("Src/"), "src/a.ts", false));
    assert!(!covers(&dir("Src/"), "src", true), "folding does not weaken the own-path rule");
}

// --- the declared set -----------------------------------------------------------------------

fn event_rows(conn: &rusqlite::Connection, task_id: &str) -> Vec<serde_json::Value> {
    let mut stmt = conn
        .prepare("SELECT payload FROM events WHERE task_id = ?1 AND event_type = ?2 ORDER BY sequence")
        .unwrap();
    stmt.query_map(params![task_id, EVENT_FILE_SET_DECLARED], |r| r.get::<_, String>(0))
        .unwrap()
        .map(|p| serde_json::from_str(&p.unwrap()).unwrap())
        .collect()
}

#[test]
fn declaring_a_set_stores_the_rows_and_one_event_together() {
    let (mut conn, actor, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();

    declare_file_set(
        &mut conn,
        &task.id,
        &[dir("packages/core/src/domain/"), file("packages/core/src/lib.rs")],
        &actor,
    )
    .unwrap();

    assert_eq!(
        list_entries_for_task(&conn, &task.id).unwrap(),
        vec![dir("packages/core/src/domain/"), file("packages/core/src/lib.rs")]
    );
    let events = event_rows(&conn, &task.id);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["field"], "file_set");
    assert_eq!(events[0]["before"], serde_json::json!([]));
    assert_eq!(
        events[0]["after"],
        serde_json::json!(["packages/core/src/domain/", "packages/core/src/lib.rs"])
    );
    assert!(events[0]["label"].as_str().unwrap().contains('2'));
}

#[test]
fn redeclaring_replaces_the_rows_and_records_the_previous_list_as_before() {
    let (mut conn, actor, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();

    declare_file_set(&mut conn, &task.id, &[file("a.rs"), file("b.rs")], &actor).unwrap();
    declare_file_set(&mut conn, &task.id, &[dir("c/")], &actor).unwrap();

    assert_eq!(list_entries_for_task(&conn, &task.id).unwrap(), vec![dir("c/")]);
    let events = event_rows(&conn, &task.id);
    assert_eq!(events.len(), 2);
    assert_eq!(events[1]["before"], serde_json::json!(["a.rs", "b.rs"]));
    assert_eq!(events[1]["after"], serde_json::json!(["c/"]));
}

#[test]
fn declaring_an_empty_list_clears_the_set() {
    let (mut conn, actor, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();

    declare_file_set(&mut conn, &task.id, &[file("a.rs")], &actor).unwrap();
    declare_file_set(&mut conn, &task.id, &[], &actor).unwrap();

    assert!(list_entries_for_task(&conn, &task.id).unwrap().is_empty());
    let events = event_rows(&conn, &task.id);
    assert_eq!(events.len(), 2);
    assert_eq!(events[1]["after"], serde_json::json!([]));
}

#[test]
fn an_unchanged_set_appends_no_event() {
    let (mut conn, actor, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();

    declare_file_set(&mut conn, &task.id, &[file("a.rs")], &actor).unwrap();
    declare_file_set(&mut conn, &task.id, &[file("a.rs")], &actor).unwrap();
    declare_file_set(&mut conn, &task.id, &[], &actor).unwrap();
    declare_file_set(&mut conn, &task.id, &[], &actor).unwrap();

    assert_eq!(event_rows(&conn, &task.id).len(), 2, "one for the declare, one for the clear");
}

#[test]
fn duplicate_entries_collapse_to_one_row() {
    let (mut conn, actor, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();

    declare_file_set(&mut conn, &task.id, &[file("a.rs"), file("a.rs"), dir("d/")], &actor).unwrap();

    assert_eq!(list_entries_for_task(&conn, &task.id).unwrap(), vec![file("a.rs"), dir("d/")]);
}

#[test]
fn declaring_for_a_task_that_does_not_exist_is_an_error_not_a_panic() {
    let (mut conn, actor, _project) = common::seeded_project();
    let missing = core::ids::new_id();

    let err = declare_file_set(&mut conn, &missing, &[file("a.rs")], &actor)
        .expect_err("an unknown task must be refused");
    assert!(format!("{err:#}").contains("not found"), "got {err:#}");
}

#[test]
fn deleting_a_task_removes_its_declared_set() {
    let (mut conn, actor, project) = common::seeded_project();
    let task = create_task(&mut conn, &project.id, &actor, "T", None).unwrap();
    declare_file_set(&mut conn, &task.id, &[file("a.rs")], &actor).unwrap();

    // `ON DELETE CASCADE` on the task foreign key: deleting only the task row must take the set.
    conn.execute("DELETE FROM tasks WHERE id = ?1", params![task.id]).unwrap();
    let left: i64 = conn
        .query_row("SELECT COUNT(*) FROM task_file_set_entries WHERE task_id = ?1", params![task.id], |r| r.get(0))
        .unwrap();
    assert_eq!(left, 0);
}

#[test]
fn the_schema_refuses_a_form_outside_the_vocabulary() {
    let (conn, actor, project) = common::seeded_project();
    let now = "2026-01-01T00:00:00Z";
    conn.execute(
        "INSERT INTO tasks (id, project_id, epic_id, key, title, description, status, rank, priority, estimate, assignee_id, created_by, created_at, updated_at)
         VALUES (?1, ?2, NULL, 'FLY-1', 'T', NULL, 'todo', 'a', 0, NULL, NULL, ?3, ?4, ?4)",
        params![core::ids::new_id(), project.id, actor, now],
    )
    .unwrap();
    let task_id: String = conn.query_row("SELECT id FROM tasks LIMIT 1", [], |r| r.get(0)).unwrap();
    let result = conn.execute(
        "INSERT INTO task_file_set_entries (id, task_id, form, path, created_by, created_at) VALUES (?1, ?2, 'glob', 'src/*.rs', ?3, ?4)",
        params![core::ids::new_id(), task_id, actor, now],
    );
    assert!(result.is_err(), "the CHECK constraint must refuse a glob form");
}
