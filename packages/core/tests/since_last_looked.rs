//! Behaviour under test (issue #167, spec §7 "Since you last looked"):
//! - The first visit to a project's board sets the cursor and lists nothing: there is no "last look" yet.
//! - The next visit lists exactly the human-meaningful events written since, in write order: state moves,
//!   hand-offs, merges, Proposals filed or decided, Rounds opened or closed, Done confirmed. Task churn,
//!   title edits and criterion edits are left out.
//! - A visit moves the cursor to the newest event, so the visit after it starts after them, and an
//!   unmeaningful event at the tail is passed over too.
//! - The cursor lives in `settings` under `last_looked:<project_id>`, one per project, and reading the
//!   events without visiting leaves it where it is.
//! - Each event names its record: the Story's or Epic's key and title, or the Milestone's title.
//! - The list is capped at the newest events, and the total still counts them all.

mod common;

use common::{new_story, seeded_project};
use flywheel_core::domain::event::{append_event, next_sequence};
use flywheel_core::domain::settings::board_visit;
use flywheel_core::domain::story::{set_story_state, update_story, StoryState};
use flywheel_core::domain::task::add_task;
use flywheel_core::query::events::events_since_last_look;
use rusqlite::{params, Connection};

/// Append one raw event to the project's stream, for kinds whose own writers need a whole session.
/// `stream` is `(stream_type, stream_id)`, `scope` is `(story_id, epic_id)`.
fn append(conn: &mut Connection, project_id: &str, actor_id: &str, stream: (&str, &str), scope: (Option<&str>, Option<&str>), event_type: &str, label: &str) {
    let ((stream_type, stream_id), (story_id, epic_id)) = (stream, scope);
    let tx = conn.transaction().unwrap();
    let seq = next_sequence(&tx, project_id, "local").unwrap();
    append_event(
        &tx,
        project_id,
        "local",
        seq,
        stream_type,
        stream_id,
        story_id,
        epic_id,
        actor_id,
        event_type,
        &serde_json::json!({ "label": label }),
        "2026-10-23T09:00:00.000Z",
    )
    .unwrap();
    tx.commit().unwrap();
}

fn cursor(conn: &Connection, project_id: &str) -> Option<String> {
    conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        params![format!("last_looked:{project_id}")],
        |row| row.get(0),
    )
    .ok()
}

fn newest_sequence(conn: &Connection, project_id: &str) -> i64 {
    conn.query_row("SELECT MAX(sequence) FROM events WHERE project_id = ?1", params![project_id], |r| r.get(0))
        .unwrap()
}

#[test]
fn the_first_visit_sets_the_cursor_and_lists_nothing() {
    let (mut conn, actor, project) = seeded_project();
    let story = new_story(&mut conn, &project.id, &actor, "First");
    set_story_state(&mut conn, &actor, &story.id, StoryState::Ready).unwrap();

    let first = board_visit(&mut conn, &actor, &project.id, 200).unwrap();

    assert_eq!(first.total, 0);
    assert!(first.events.is_empty());
    assert_eq!(cursor(&conn, &project.id), Some(newest_sequence(&conn, &project.id).to_string()));
}

#[test]
fn the_next_visit_lists_exactly_the_meaningful_events_in_order_then_starts_after_them() {
    let (mut conn, actor, project) = seeded_project();
    let story = new_story(&mut conn, &project.id, &actor, "Make clicking predictable");
    let epic_id = story.epic_id.clone();
    board_visit(&mut conn, &actor, &project.id, 200).unwrap();

    // Since the last look: a mix of meaningful events and churn.
    set_story_state(&mut conn, &actor, &story.id, StoryState::Ready).unwrap();
    add_task(&mut conn, &actor, &story.id, "Read the click handlers").unwrap();
    update_story(&mut conn, &actor, &story.id, "Make every click predictable", None).unwrap();
    set_story_state(&mut conn, &actor, &story.id, StoryState::Running).unwrap();
    append(&mut conn, &project.id, &actor, ("task", "01JTASK0000000000000000000"), (Some(&story.id), None), "task.state_changed", "Started a Task");
    append(&mut conn, &project.id, &actor, ("story", &story.id), (Some(&story.id), None), "story.handed_off", "Handed off for review");
    append(&mut conn, &project.id, &actor, ("proposal", "01JPROP0000000000000000000"), (None, Some(&epic_id)), "proposal.filed", "Proposed to create a story");
    append(&mut conn, &project.id, &actor, ("proposal", "01JPROP0000000000000000000"), (None, Some(&epic_id)), "proposal.accepted", "Accepted a Proposal");
    append(&mut conn, &project.id, &actor, ("proposal", "01JPROP0000000000000000001"), (None, Some(&epic_id)), "proposal.rejected", "Rejected a Proposal");
    append(&mut conn, &project.id, &actor, ("round", "01JROUN0000000000000000000"), (None, Some(&epic_id)), "round.posted", "Posted Round 1");
    append(&mut conn, &project.id, &actor, ("round", "01JROUN0000000000000000000"), (None, Some(&epic_id)), "round.answered", "Answered Round 1");
    append(&mut conn, &project.id, &actor, ("round", "01JROUN0000000000000000001"), (None, None), "round.opened", "Opened roadmap Round 1");
    append(&mut conn, &project.id, &actor, ("round", "01JROUN0000000000000000001"), (None, None), "round.closed", "Closed roadmap Round 1");
    append(&mut conn, &project.id, &actor, ("round", "01JROUN0000000000000000002"), (None, None), "round.dismissed", "Dismissed roadmap Round 2");
    append(&mut conn, &project.id, &actor, ("story", &story.id), (Some(&story.id), None), "story.state_changed", "Moved Story from in_review to merged");
    append(&mut conn, &project.id, &actor, ("epic", &epic_id), (None, Some(&epic_id)), "epic.state_changed", "Confirmed the Epic done");
    // Churn at the tail: passed over, but the cursor still moves past it.
    append(&mut conn, &project.id, &actor, ("session", "01JSESS0000000000000000000"), (Some(&story.id), None), "session.started", "Started a session");

    let seen = board_visit(&mut conn, &actor, &project.id, 200).unwrap();

    let types: Vec<&str> = seen.events.iter().map(|e| e.event.event_type.as_str()).collect();
    assert_eq!(
        types,
        vec![
            "story.state_changed",
            "story.state_changed",
            "story.handed_off",
            "proposal.filed",
            "proposal.accepted",
            "proposal.rejected",
            "round.posted",
            "round.answered",
            "round.opened",
            "round.closed",
            "round.dismissed",
            "story.state_changed",
            "epic.state_changed",
        ]
    );
    assert_eq!(seen.total, 13);
    let sequences: Vec<i64> = seen.events.iter().map(|e| e.event.sequence).collect();
    assert!(sequences.windows(2).all(|w| w[0] < w[1]), "in write order: {sequences:?}");
    assert_eq!(cursor(&conn, &project.id), Some(newest_sequence(&conn, &project.id).to_string()));

    let again = board_visit(&mut conn, &actor, &project.id, 200).unwrap();
    assert_eq!(again.total, 0, "the next visit starts after them");
    assert!(again.events.is_empty());

    set_story_state(&mut conn, &actor, &story.id, StoryState::Dropped).unwrap();
    let later = board_visit(&mut conn, &actor, &project.id, 200).unwrap();
    assert_eq!(later.events.len(), 1);
    assert_eq!(later.events[0].event.description, "Moved Story from running to dropped");
}

#[test]
fn reading_without_visiting_leaves_the_cursor_and_each_project_has_its_own() {
    let (mut conn, actor, project) = seeded_project();
    let story = new_story(&mut conn, &project.id, &actor, "One");
    board_visit(&mut conn, &actor, &project.id, 200).unwrap();
    set_story_state(&mut conn, &actor, &story.id, StoryState::Ready).unwrap();

    let before = cursor(&conn, &project.id);
    let read = events_since_last_look(&conn, &project.id, 200).unwrap();
    assert_eq!(read.total, 1);
    assert_eq!(cursor(&conn, &project.id), before, "a read alone never moves the cursor");

    let other = flywheel_core::domain::project::create_project(&mut conn, &actor, "Other", "/other", "OTH", "main").unwrap();
    assert_eq!(events_since_last_look(&conn, &other.id, 200).unwrap().total, 0, "never visited: nothing to list");
    board_visit(&mut conn, &actor, &other.id, 200).unwrap();
    assert_eq!(events_since_last_look(&conn, &project.id, 200).unwrap().total, 1, "another project's visit moves only its own cursor");
}

#[test]
fn each_event_names_its_record() {
    let (mut conn, actor, project) = seeded_project();
    let story = new_story(&mut conn, &project.id, &actor, "Make clicking predictable");
    let epic_id = story.epic_id.clone();
    let (epic_key, epic_title): (String, String) =
        conn.query_row("SELECT key, title FROM epics WHERE id = ?1", params![epic_id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
    let (milestone_id, milestone_title): (String, String) = conn
        .query_row("SELECT milestone_id, (SELECT title FROM milestones m WHERE m.id = e.milestone_id) FROM epics e WHERE e.id = ?1", params![epic_id], |r| Ok((r.get(0)?, r.get(1)?)))
        .unwrap();
    board_visit(&mut conn, &actor, &project.id, 200).unwrap();

    set_story_state(&mut conn, &actor, &story.id, StoryState::Ready).unwrap();
    append(&mut conn, &project.id, &actor, ("epic", &epic_id), (None, Some(&epic_id)), "epic.state_changed", "Moved Epic");
    append(&mut conn, &project.id, &actor, ("milestone", &milestone_id), (None, None), "milestone.state_changed", "Moved Milestone");
    append(&mut conn, &project.id, &actor, ("round", "01JROUN0000000000000000001"), (None, None), "round.opened", "Opened roadmap Round 1");

    let seen = board_visit(&mut conn, &actor, &project.id, 200).unwrap();
    let subjects: Vec<(Option<&str>, Option<&str>)> =
        seen.events.iter().map(|e| (e.subject_key.as_deref(), e.subject_title.as_deref())).collect();
    assert_eq!(
        subjects,
        vec![
            (Some(story.key.as_str()), Some("Make clicking predictable")),
            (Some(epic_key.as_str()), Some(epic_title.as_str())),
            (None, Some(milestone_title.as_str())),
            (None, None),
        ]
    );
}

#[test]
fn the_list_keeps_the_newest_events_and_the_total_counts_them_all() {
    let (mut conn, actor, project) = seeded_project();
    let story = new_story(&mut conn, &project.id, &actor, "Busy");
    board_visit(&mut conn, &actor, &project.id, 200).unwrap();
    for n in 0..5 {
        append(&mut conn, &project.id, &actor, ("story", &story.id), (Some(&story.id), None), "story.state_changed", &format!("Move {n}"));
    }

    let seen = board_visit(&mut conn, &actor, &project.id, 3).unwrap();

    assert_eq!(seen.total, 5);
    let labels: Vec<&str> = seen.events.iter().map(|e| e.event.description.as_str()).collect();
    assert_eq!(labels, vec!["Move 2", "Move 3", "Move 4"], "the newest three, oldest first");
    assert_eq!(cursor(&conn, &project.id), Some(newest_sequence(&conn, &project.id).to_string()));
}
