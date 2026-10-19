//! A Story written by hand (issue #50): Milestone 2's stand-in for shaping. One call writes the
//! Story, its Acceptance criteria and their optional Checks inside an Epic, and lands it in Ready,
//! all in one transaction. A refusal writes nothing.

mod common;

use common::seeded_project;
use core::domain::acceptance_criterion::criteria_for_story;
use core::domain::actor::system_actor;
use core::domain::check::check_for_criterion;
use core::domain::story::{stories_in_epic, stories_in_project, write_story_by_hand, HandWrittenCriterion};
use core::domain::{epic, milestone};
use rusqlite::Connection;

fn epic_in(conn: &mut Connection, project_id: &str, actor: &str, milestone_title: &str, epic_title: &str) -> String {
    let m = milestone::create_milestone(conn, project_id, actor, milestone_title, None).unwrap();
    epic::create_epic(conn, actor, &m.id, epic_title).unwrap().id
}

/// `(stories, criteria, checks, events)` row counts — a refusal must change none of them.
fn footprint(conn: &Connection) -> (i64, i64, i64, i64) {
    let count = |table: &str| conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
    (count("stories"), count("acceptance_criteria"), count("checks"), count("events"))
}

fn criterion<'a>(statement: &'a str, check: Option<&'a str>) -> HandWrittenCriterion<'a> {
    HandWrittenCriterion { statement, check_command: check }
}

#[test]
fn a_hand_written_story_lands_in_ready_with_its_criteria_and_checks() {
    let (mut conn, actor, project) = seeded_project();
    let epic_id = epic_in(&mut conn, &project.id, &actor, "M1", "Epic");

    let story = write_story_by_hand(
        &mut conn,
        &actor,
        &epic_id,
        "  Start a Story  ",
        Some("from the form"),
        &[criterion("It starts", Some("  cargo test  ")), criterion("It shows its state", None), criterion("Blank check", Some("   "))],
    )
    .expect("a Story with criteria is written");

    assert_eq!(story.title, "Start a Story");
    assert_eq!(story.state, "ready");
    assert_eq!(story.description.as_deref(), Some("from the form"));
    assert_eq!(story.epic_id, epic_id);

    let criteria = criteria_for_story(&conn, &story.id).unwrap();
    let statements: Vec<&str> = criteria.iter().map(|c| c.statement.as_str()).collect();
    assert_eq!(statements, ["It starts", "It shows its state", "Blank check"], "criteria keep their order");
    assert!(criteria.iter().all(|c| c.story_id == story.id), "every criterion is anchored to the Story");

    let checks: Vec<Option<String>> =
        criteria.iter().map(|c| check_for_criterion(&conn, &c.id).unwrap().map(|k| k.command)).collect();
    assert_eq!(checks, [Some("cargo test".to_string()), None, None], "a blank Check command means judged at review");

    let stored = stories_in_epic(&conn, &epic_id).unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(stored[0].state, "ready");

    let types: Vec<String> = conn
        .prepare("SELECT event_type FROM events WHERE story_id = ?1 ORDER BY sequence")
        .unwrap()
        .query_map([&story.id], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(types.first().map(String::as_str), Some("story.created"));
    assert_eq!(types.last().map(String::as_str), Some("story.state_changed"), "Shaping → Ready is in the log");
    assert_eq!(types.iter().filter(|t| *t == "criterion.created").count(), 3);
    assert_eq!(types.iter().filter(|t| *t == "check.set").count(), 1);
}

#[test]
fn a_story_cannot_be_written_outside_an_epic() {
    let (mut conn, actor, _project) = seeded_project();
    let before = footprint(&conn);
    let err = write_story_by_hand(&mut conn, &actor, "no-such-epic", "Orphan", None, &[criterion("x", None)])
        .expect_err("no Epic, no Story");
    assert!(err.to_string().contains("Epic"), "{err}");
    assert_eq!(footprint(&conn), before, "a refusal writes nothing");
}

#[test]
fn a_story_needs_at_least_one_criterion_and_every_criterion_a_statement() {
    let (mut conn, actor, project) = seeded_project();
    let epic_id = epic_in(&mut conn, &project.id, &actor, "M1", "Epic");
    let before = footprint(&conn);

    let none = write_story_by_hand(&mut conn, &actor, &epic_id, "No criteria", None, &[]).expect_err("needs criteria");
    assert!(none.to_string().contains("criterion"), "{none}");
    assert_eq!(footprint(&conn), before);

    let blank = write_story_by_hand(&mut conn, &actor, &epic_id, "Blank", None, &[criterion("ok", None), criterion("  ", Some("true"))])
        .expect_err("a blank statement is refused");
    assert!(blank.to_string().contains("statement"), "{blank}");
    assert_eq!(footprint(&conn), before, "the whole write rolls back, including the first criterion");

    let untitled = write_story_by_hand(&mut conn, &actor, &epic_id, " ", None, &[criterion("ok", None)]).expect_err("title");
    assert!(untitled.to_string().contains("title"), "{untitled}");
    assert_eq!(footprint(&conn), before);
}

#[test]
fn only_the_developer_writes_a_story_by_hand() {
    let (mut conn, actor, project) = seeded_project();
    let epic_id = epic_in(&mut conn, &project.id, &actor, "M1", "Epic");
    let system = system_actor(&conn).unwrap();
    let before = footprint(&conn);
    write_story_by_hand(&mut conn, &system.id, &epic_id, "Agent's", None, &[criterion("x", None)])
        .expect_err("a non-human actor is refused");
    assert_eq!(footprint(&conn), before);
}

#[test]
fn the_projects_stories_are_listed_in_roadmap_order() {
    let (mut conn, actor, project) = seeded_project();
    let first = epic_in(&mut conn, &project.id, &actor, "M1", "First");
    let second = epic_in(&mut conn, &project.id, &actor, "M2", "Second");
    let b = write_story_by_hand(&mut conn, &actor, &second, "B", None, &[criterion("x", None)]).unwrap();
    let a1 = write_story_by_hand(&mut conn, &actor, &first, "A1", None, &[criterion("x", None)]).unwrap();
    let a2 = write_story_by_hand(&mut conn, &actor, &first, "A2", None, &[criterion("x", None)]).unwrap();

    let other_project = core::domain::project::create_project(&mut conn, &actor, "Other", "/other", "OTH", "main")
        .unwrap()
        .id;
    let other_epic = epic_in(&mut conn, &other_project, &actor, "Other", "Other");
    write_story_by_hand(&mut conn, &actor, &other_epic, "Elsewhere", None, &[criterion("x", None)]).unwrap();

    let ids: Vec<String> = stories_in_project(&conn, &project.id).unwrap().into_iter().map(|s| s.id).collect();
    assert_eq!(ids, [a1.id, a2.id, b.id], "Milestone order, then Epic order, then Story order; one project only");
}
