//! Reordering the Roadmap (docs/mvp-spec.md §2 "Milestone", §7 "Roadmap strip"; issue #131).
//!
//! The Developer moves a Milestone by dropping it before another one, or at the end. Moving rewrites
//! one rank, and the Current Milestone (the first neither Done nor Dropped, derived on every read)
//! follows: "reordering is how focus changes". A Done or Dropped Milestone does not move, and only a
//! human moves one; an agent changes the Roadmap through a Proposal.

mod common;

use core::domain::milestone::{create_milestone, current_milestone, move_milestone, roadmap, set_milestone_state, MilestoneState};
use core::domain::session::agent_actor_id;
use rusqlite::Connection;

/// A project with Milestones `titles`, in that order. Returns `(conn, human, project_id, ids)`.
fn roadmap_of(titles: &[&str]) -> (Connection, String, String, Vec<String>) {
    let (mut conn, human, project) = common::seeded_project();
    let ids = titles
        .iter()
        .map(|t| create_milestone(&mut conn, &project.id, &human, t, None).expect("create_milestone").id)
        .collect();
    (conn, human, project.id, ids)
}

fn order(conn: &Connection, project_id: &str) -> Vec<String> {
    roadmap(conn, project_id).unwrap().into_iter().map(|m| m.title).collect()
}

fn milestone_events(conn: &Connection, id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM events WHERE stream_id = ?1 AND event_type = 'milestone.moved'",
        [id],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn moving_before_another_milestone_reranks_only_the_moved_one() {
    let (mut conn, human, project, ids) = roadmap_of(&["A", "B", "C", "D"]);
    let ranks_before: Vec<String> = roadmap(&conn, &project).unwrap().into_iter().map(|m| m.rank).collect();

    move_milestone(&mut conn, &human, &ids[3], Some(&ids[1])).expect("D before B");
    assert_eq!(order(&conn, &project), ["A", "D", "B", "C"]);

    let after = roadmap(&conn, &project).unwrap();
    for m in after.iter().filter(|m| m.id != ids[3]) {
        let i = ids.iter().position(|id| *id == m.id).unwrap();
        assert_eq!(m.rank, ranks_before[i], "{} kept its rank: moving one Milestone rewrites one row", m.title);
    }
    assert_eq!(milestone_events(&conn, &ids[3]), 1, "the move is on the timeline");
}

#[test]
fn moving_to_the_front_and_to_the_end() {
    let (mut conn, human, project, ids) = roadmap_of(&["A", "B", "C"]);
    move_milestone(&mut conn, &human, &ids[2], Some(&ids[0])).expect("C to the front");
    assert_eq!(order(&conn, &project), ["C", "A", "B"]);
    move_milestone(&mut conn, &human, &ids[2], None).expect("C to the end");
    assert_eq!(order(&conn, &project), ["A", "B", "C"]);
    move_milestone(&mut conn, &human, &ids[0], None).expect("A to the end");
    assert_eq!(order(&conn, &project), ["B", "C", "A"]);
}

#[test]
fn moving_past_the_first_open_milestone_changes_the_current_one() {
    let (mut conn, human, project, ids) = roadmap_of(&["Done one", "A", "B", "C"]);
    set_milestone_state(&mut conn, &human, &ids[0], MilestoneState::Done).unwrap();
    assert_eq!(current_milestone(&conn, &project).unwrap().unwrap().id, ids[1], "A is Current");

    // C moves ahead of A, behind the Done Milestone: it is now the first open one.
    move_milestone(&mut conn, &human, &ids[3], Some(&ids[1])).unwrap();
    assert_eq!(current_milestone(&conn, &project).unwrap().unwrap().id, ids[3], "C became Current");

    // A moves past B: C stays Current, A is no longer anywhere near it.
    move_milestone(&mut conn, &human, &ids[1], None).unwrap();
    assert_eq!(order(&conn, &project), ["Done one", "C", "B", "A"]);
    assert_eq!(current_milestone(&conn, &project).unwrap().unwrap().id, ids[3]);

    // The Current one moves to the end: the next open one takes its place.
    move_milestone(&mut conn, &human, &ids[3], None).unwrap();
    assert_eq!(current_milestone(&conn, &project).unwrap().unwrap().id, ids[2], "B became Current");
}

#[test]
fn a_done_or_dropped_milestone_does_not_move() {
    let (mut conn, human, project, ids) = roadmap_of(&["Done one", "Dropped one", "Open"]);
    set_milestone_state(&mut conn, &human, &ids[0], MilestoneState::Done).unwrap();
    set_milestone_state(&mut conn, &human, &ids[1], MilestoneState::Dropped).unwrap();

    let done = move_milestone(&mut conn, &human, &ids[0], None).unwrap_err();
    assert!(format!("{done:#}").contains("Done"), "names why: {done:#}");
    let dropped = move_milestone(&mut conn, &human, &ids[1], None).unwrap_err();
    assert!(format!("{dropped:#}").contains("Dropped"), "names why: {dropped:#}");
    assert_eq!(order(&conn, &project), ["Done one", "Dropped one", "Open"], "nothing moved");
    assert_eq!(milestone_events(&conn, &ids[0]) + milestone_events(&conn, &ids[1]), 0);

    // An open Milestone may still be placed before a Done one.
    move_milestone(&mut conn, &human, &ids[2], Some(&ids[0])).expect("an open Milestone moves past a Done one");
    assert_eq!(order(&conn, &project), ["Open", "Done one", "Dropped one"]);
}

#[test]
fn only_a_human_moves_a_milestone() {
    let (mut conn, _human, project, ids) = roadmap_of(&["A", "B"]);
    let agent = agent_actor_id(&conn).unwrap();
    let err = move_milestone(&mut conn, &agent, &ids[1], Some(&ids[0])).unwrap_err();
    assert!(format!("{err:#}").contains("agent"), "the refusal names the agent: {err:#}");
    assert_eq!(order(&conn, &project), ["A", "B"]);
    assert_eq!(milestone_events(&conn, &ids[1]), 0);
}

#[test]
fn the_anchor_must_be_another_milestone_of_the_same_roadmap() {
    let (mut conn, human, project, ids) = roadmap_of(&["A", "B"]);
    assert!(move_milestone(&mut conn, &human, &ids[0], Some(&ids[0])).is_err(), "not before itself");
    assert!(move_milestone(&mut conn, &human, &ids[0], Some("no-such-milestone")).is_err(), "an unknown anchor");
    assert!(move_milestone(&mut conn, &human, "no-such-milestone", None).is_err(), "an unknown Milestone");

    let other = core::domain::project::create_project(&mut conn, &human, "Other", "/other", "OTH", "main").unwrap();
    let foreign = create_milestone(&mut conn, &other.id, &human, "Elsewhere", None).unwrap();
    assert!(move_milestone(&mut conn, &human, &ids[0], Some(&foreign.id)).is_err(), "another project's Milestone");
    assert_eq!(order(&conn, &project), ["A", "B"]);
    assert_eq!(order(&conn, &other.id), ["Elsewhere"]);
}
