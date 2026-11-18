//! Behavior under test (issue #1762, rename a project from its menu):
//! - The name rules: whitespace is trimmed, an empty or over-long name and a name another project
//!   holds (ignoring case) are refused, and each refusal says which.
//! - `rename_project` writes the new name and exactly one `project.renamed` event, with the actor,
//!   the old name and the new one.
//! - The id, the key prefix, the key counter and the repository path do not change, so Story keys
//!   stay permanent: a Story written after the rename still counts on from the same counter.
//! - A refused name writes nothing: no row change, no event. So does the same name again.
//! - A project removed from Flywheel does not hold its name; an unknown id is refused.

mod common;

use flywheel_core::db::open_and_migrate;
use flywheel_core::domain::actor::local_human_actor_id;
use flywheel_core::domain::project::{
    create_project, hide_project, list_projects, rename_project, validate_project_name, Project,
    ProjectNameError, PROJECT_NAME_MAX_LEN,
};
use rusqlite::{params, Connection};

struct Fixture {
    conn: Connection,
    actor_id: String,
    _dir: tempfile::TempDir,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().expect("failed to create scratch dir");
    let conn = open_and_migrate(&dir.path().join("flywheel.db"), &dir.path().join("backups"))
        .expect("open_and_migrate should succeed");
    let actor_id = local_human_actor_id(&conn).expect("seeded human actor should exist");
    Fixture {
        conn,
        actor_id,
        _dir: dir,
    }
}

fn project(f: &mut Fixture, name: &str, prefix: &str) -> Project {
    create_project(
        &mut f.conn,
        &f.actor_id,
        name,
        &format!("/repo/{prefix}"),
        prefix,
        "main",
    )
    .expect("create_project should succeed")
}

/// The payloads of a project's `project.renamed` events, oldest first, with the actor.
fn renamed_events(conn: &Connection, project_id: &str) -> Vec<(String, serde_json::Value)> {
    let mut stmt = conn
        .prepare(
            "SELECT actor_id, payload FROM events
             WHERE project_id = ?1 AND event_type = 'project.renamed' ORDER BY sequence",
        )
        .expect("prepare");
    stmt.query_map(params![project_id], |row| {
        let payload: String = row.get(1)?;
        Ok((row.get(0)?, serde_json::from_str(&payload).unwrap()))
    })
    .expect("query")
    .collect::<Result<Vec<_>, _>>()
    .expect("collect")
}

fn key_counter(conn: &Connection, project_id: &str) -> i64 {
    conn.query_row(
        "SELECT key_counter FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get(0),
    )
    .unwrap()
}

#[test]
fn the_name_rules_trim_and_refuse_empty_long_and_taken_names() {
    assert_eq!(
        validate_project_name("  Flywheel  ", ["Other"]),
        Ok("Flywheel".to_string())
    );
    assert_eq!(
        validate_project_name("", std::iter::empty()),
        Err(ProjectNameError::Empty)
    );
    assert_eq!(
        validate_project_name(" \t\n ", std::iter::empty()),
        Err(ProjectNameError::Empty)
    );
    let long = "x".repeat(PROJECT_NAME_MAX_LEN + 1);
    assert_eq!(
        validate_project_name(&long, std::iter::empty()),
        Err(ProjectNameError::TooLong {
            chars: PROJECT_NAME_MAX_LEN + 1
        })
    );
    assert!(validate_project_name(&"x".repeat(PROJECT_NAME_MAX_LEN), std::iter::empty()).is_ok());
    // The length counts characters after trimming, not bytes.
    assert!(validate_project_name(&format!(" {} ", "é".repeat(PROJECT_NAME_MAX_LEN)), []).is_ok());
    assert_eq!(
        validate_project_name("alpha ", ["Alpha"]),
        Err(ProjectNameError::Taken {
            other: "Alpha".to_string()
        })
    );
}

#[test]
fn rename_writes_the_name_and_one_event_with_the_actor_and_both_names() {
    let mut f = fixture();
    let p = project(&mut f, "HighKnow-harness", "FLY");

    let renamed = rename_project(&mut f.conn, &f.actor_id, &p.id, "  Flywheel ")
        .expect("rename_project should succeed");

    assert_eq!(renamed.name, "Flywheel", "the name is stored trimmed");
    assert_eq!(list_projects(&f.conn).unwrap()[0].name, "Flywheel");
    let events = renamed_events(&f.conn, &p.id);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].0, f.actor_id);
    assert_eq!(events[0].1["field"], "name");
    assert_eq!(events[0].1["before"], "HighKnow-harness");
    assert_eq!(events[0].1["after"], "Flywheel");
    assert_eq!(events[0].1["label"], "Renamed HighKnow-harness to Flywheel");
}

#[test]
fn rename_keeps_the_id_the_prefix_the_counter_and_the_path_so_story_keys_stay_permanent() {
    let mut f = fixture();
    let p = project(&mut f, "Old", "FLY");
    let first = common::new_story(&mut f.conn, &p.id, &f.actor_id, "First");
    let counter = key_counter(&f.conn, &p.id);
    assert!(counter > 0, "the fixture must have allocated a key");

    let renamed = rename_project(&mut f.conn, &f.actor_id, &p.id, "New").unwrap();

    assert_eq!(renamed.id, p.id);
    assert_eq!(renamed.key_prefix, "FLY");
    assert_eq!(renamed.repo_path, p.repo_path);
    assert_eq!(key_counter(&f.conn, &p.id), counter);
    let second = common::new_story(&mut f.conn, &p.id, &f.actor_id, "Second");
    assert!(first.key.starts_with("FLY-") && second.key.starts_with("FLY-"));
    assert_ne!(first.key, second.key, "keys keep counting on, never reused");
}

#[test]
fn a_refused_name_writes_nothing() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    project(&mut f, "Beta", "BET");

    for refused in ["", "   ", "beta", " BETA "] {
        let err = rename_project(&mut f.conn, &f.actor_id, &a.id, refused)
            .expect_err("the name must be refused");
        assert!(
            err.downcast_ref::<ProjectNameError>().is_some(),
            "{refused:?}: {err}"
        );
    }
    assert_eq!(list_projects(&f.conn).unwrap()[0].name, "Alpha");
    assert!(renamed_events(&f.conn, &a.id).is_empty());
}

#[test]
fn the_empty_name_message_says_why() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let err = rename_project(&mut f.conn, &f.actor_id, &a.id, "  ").unwrap_err();
    assert_eq!(err.to_string(), "project name must not be empty");
}

#[test]
fn the_same_name_again_changes_nothing_and_appends_no_event() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");

    rename_project(&mut f.conn, &f.actor_id, &a.id, "Alpha").unwrap();
    rename_project(&mut f.conn, &f.actor_id, &a.id, "  Alpha  ").unwrap();
    assert!(renamed_events(&f.conn, &a.id).is_empty());

    // A change of case only is a real rename of the project's own name.
    rename_project(&mut f.conn, &f.actor_id, &a.id, "ALPHA").unwrap();
    assert_eq!(renamed_events(&f.conn, &a.id).len(), 1);
}

#[test]
fn a_removed_project_does_not_hold_its_name_and_an_unknown_id_is_refused() {
    let mut f = fixture();
    let a = project(&mut f, "Alpha", "ALP");
    let gone = project(&mut f, "Gone", "GON");
    hide_project(&mut f.conn, &f.actor_id, &gone.id).unwrap();

    rename_project(&mut f.conn, &f.actor_id, &a.id, "Gone")
        .expect("a hidden project's name is free");

    let err = rename_project(
        &mut f.conn,
        &f.actor_id,
        "01ARZ3NDEKTSV4RRFFQ69G5FAV",
        "Any",
    )
    .unwrap_err();
    assert!(err.to_string().contains("not found"), "{err}");
}
