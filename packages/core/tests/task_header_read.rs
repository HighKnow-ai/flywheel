//! Finish-review four-1 (plan 11-22): the session surface is handed a task id and nothing else, and
//! no read returned a task by id, so its header said "Session" and never named the board item the
//! run serves. These pin the two narrow reads that name it: a task's (or epic's) key and title,
//! and `None` for an id that names nothing (a task deleted mid-run) rather than an error.

mod common;

use core::domain::epic::create_epic;
use core::domain::task::create_task;
use core::query::authoring::{epic_header, task_header};

use common::seeded_project;

#[test]
fn task_header_returns_the_key_and_title_of_a_seeded_task() {
    let (mut conn, actor_id, proj) = seeded_project();
    let task = create_task(&mut conn, &proj.id, &actor_id, "Wire the session header", None).unwrap();

    let header = task_header(&conn, &task.id).unwrap().expect("a seeded task must resolve");
    assert_eq!(header.key, task.key);
    assert_eq!(header.title, "Wire the session header");
}

#[test]
fn task_header_is_none_for_an_unknown_id() {
    let (conn, _, _) = seeded_project();
    assert_eq!(task_header(&conn, "no-such-task").unwrap(), None);
}

#[test]
fn epic_header_returns_the_key_and_title_of_a_seeded_epic() {
    let (mut conn, actor_id, proj) = seeded_project();
    let epic = create_epic(&mut conn, &proj.id, &actor_id, "Review inside Flywheel", None).unwrap();

    let header = epic_header(&conn, &epic.id).unwrap().expect("a seeded epic must resolve");
    assert_eq!(header.key, epic.key);
    assert_eq!(header.title, "Review inside Flywheel");
}

#[test]
fn epic_header_is_none_for_an_unknown_id() {
    let (conn, _, _) = seeded_project();
    assert_eq!(epic_header(&conn, "no-such-epic").unwrap(), None);
}
