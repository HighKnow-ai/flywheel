//! Moving a Story between Epics (issue #168, docs/mvp-spec.md §7): the developer re-parents a Story
//! to another open Epic of the same project. It lands at the end of the target Epic's order, keeps
//! its key, branch, criteria, Tasks and worktree, and the move is written to the timeline. A Merged
//! or Dropped Story stays where it closed, a Done or Dropped Epic takes no new Story, and only a
//! human moves one (the actor half is pinned in `authority_human_only.rs`).

mod common;

use common::with_scratch_worktree_root;
use core::domain::acceptance_criterion::{create_criterion, criteria_for_story};
use core::domain::epic::{create_epic, set_epic_state, EpicState};
use core::domain::milestone::create_milestone;
use core::domain::session::{agent_actor_id, start_session};
use core::domain::story::{create_story, get_story, move_story_to_epic, set_story_state, stories_in_epic, StoryState};
use core::domain::story_drop::drop_story;
use core::domain::task::{add_task, tasks_for_story};
use core::domain::worktree::worktree_for_story;
use rusqlite::{params, Connection};

/// A Milestone with two Epics: `from` holding `first` and `second`, `to` holding `resident`.
struct Fixture {
    conn: Connection,
    human: String,
    from: String,
    to: String,
    first: String,
    second: String,
    resident: String,
}

fn fixture() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let (from, to, first, second, resident) = fixture_in(&mut conn, &human, &project.id);
    Fixture { conn, human, from, to, first, second, resident }
}

fn fixture_in(conn: &mut Connection, human: &str, project_id: &str) -> (String, String, String, String, String) {
    let m = create_milestone(conn, project_id, human, "Board", None).unwrap();
    let from = create_epic(conn, human, &m.id, "Roster").unwrap();
    let to = create_epic(conn, human, &m.id, "Needs you").unwrap();
    let first = create_story(conn, human, &from.id, "Epic rows").unwrap();
    let second = create_story(conn, human, &from.id, "Story lines").unwrap();
    let resident = create_story(conn, human, &to.id, "Rank the queue").unwrap();
    (from.id, to.id, first.id, second.id, resident.id)
}

fn epic_story_ids(conn: &Connection, epic_id: &str) -> Vec<String> {
    stories_in_epic(conn, epic_id).unwrap().into_iter().map(|s| s.id).collect()
}

#[test]
fn a_moved_story_lands_at_the_end_of_the_target_epic_and_keeps_its_key() {
    let mut f = fixture();
    let before = get_story(&f.conn, &f.first).unwrap().unwrap();

    move_story_to_epic(&mut f.conn, &f.human, &f.first, &f.to).expect("the human moves an open Story");

    let after = get_story(&f.conn, &f.first).unwrap().unwrap();
    assert_eq!(after.epic_id, f.to);
    assert_eq!(after.key, before.key, "the key never changes");
    assert_eq!(after.title, before.title);
    assert_eq!(after.state, before.state, "the Story keeps its state");
    assert_eq!(epic_story_ids(&f.conn, &f.to), vec![f.resident.clone(), f.first.clone()], "it lands last");
    assert_eq!(epic_story_ids(&f.conn, &f.from), vec![f.second.clone()]);
}

#[test]
fn the_move_is_written_to_the_timeline_under_the_new_epic() {
    let mut f = fixture();
    move_story_to_epic(&mut f.conn, &f.human, &f.first, &f.to).unwrap();
    let (epic_id, actor, payload): (String, String, String) = f
        .conn
        .query_row(
            "SELECT epic_id, actor_id, payload FROM events WHERE story_id = ?1 AND event_type = 'story.moved'",
            params![f.first],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .expect("one story.moved event");
    assert_eq!(epic_id, f.to);
    assert_eq!(actor, f.human);
    let payload: serde_json::Value = serde_json::from_str(&payload).unwrap();
    assert_eq!(payload["before"], f.from.as_str());
    assert_eq!(payload["after"], f.to.as_str());
    assert!(payload["label"].as_str().unwrap().contains("Needs you"), "the label names the new Epic: {payload}");
}

#[test]
fn criteria_tasks_worktree_and_branch_are_untouched() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let (_from, to, first, _second, _resident) = fixture_in(&mut conn, &human, &project.id);
        create_criterion(&mut conn, &human, &first, "The rows read in rank order").unwrap();
        set_story_state(&mut conn, &human, &first, StoryState::Ready).unwrap();
        set_story_state(&mut conn, &human, &first, StoryState::Running).unwrap();
        let run = start_session(&mut conn, &first, "acceptEdits", &human).unwrap();
        add_task(&mut conn, &run.actor_id, &first, "Draw the rows").unwrap();
        let worktree = worktree_for_story(&conn, &first).unwrap().expect("the session made a worktree");
        let criteria = criteria_for_story(&conn, &first).unwrap();
        let tasks = tasks_for_story(&conn, &first).unwrap();

        move_story_to_epic(&mut conn, &human, &first, &to).expect("a Running Story moves");

        assert_eq!(worktree_for_story(&conn, &first).unwrap(), Some(worktree.clone()), "same worktree, same branch");
        assert!(std::path::Path::new(&worktree.path).exists(), "the worktree is still on disk");
        assert_eq!(criteria_for_story(&conn, &first).unwrap(), criteria);
        assert_eq!(tasks_for_story(&conn, &first).unwrap(), tasks);
        assert_eq!(get_story(&conn, &first).unwrap().unwrap().state, "running");
    });
}

#[test]
fn a_merged_or_dropped_story_stays_where_it_closed() {
    let mut f = fixture();
    drop_story(&mut f.conn, &f.human, &f.first).unwrap();
    let err = move_story_to_epic(&mut f.conn, &f.human, &f.first, &f.to).unwrap_err();
    assert!(format!("{err:#}").contains("dropped"), "{err:#}");

    let story = f.second.clone();
    for state in [StoryState::Ready, StoryState::Running, StoryState::InReview, StoryState::Merged] {
        set_story_state(&mut f.conn, &f.human, &story, state).unwrap();
    }
    let err = move_story_to_epic(&mut f.conn, &f.human, &story, &f.to).unwrap_err();
    assert!(format!("{err:#}").contains("merged"), "{err:#}");
    assert_eq!(get_story(&f.conn, &story).unwrap().unwrap().epic_id, f.from);
}

#[test]
fn a_done_epic_takes_no_story() {
    let mut f = fixture();
    // Close the target: its one Story dropped, shaping closed, exit test confirmed.
    drop_story(&mut f.conn, &f.human, &f.resident).unwrap();
    set_epic_state(&mut f.conn, &f.human, &f.to, EpicState::Done).unwrap();

    let err = move_story_to_epic(&mut f.conn, &f.human, &f.first, &f.to).unwrap_err();
    assert!(format!("{err:#}").contains("done"), "{err:#}");
    assert_eq!(get_story(&f.conn, &f.first).unwrap().unwrap().epic_id, f.from);
}

#[test]
fn a_story_moves_only_within_its_project() {
    let (mut conn, human, project) = common::seeded_project();
    let (_from, _to, first, _second, _resident) = fixture_in(&mut conn, &human, &project.id);
    let other = core::domain::project::create_project(&mut conn, &human, "Other", "/other", "OTH", "main").unwrap();
    let (_, elsewhere, _, _, _) = fixture_in(&mut conn, &human, &other.id);

    let err = move_story_to_epic(&mut conn, &human, &first, &elsewhere).unwrap_err();
    assert!(format!("{err:#}").contains("project"), "{err:#}");
}

#[test]
fn moving_into_its_own_epic_is_refused() {
    let mut f = fixture();
    let err = move_story_to_epic(&mut f.conn, &f.human, &f.first, &f.from).unwrap_err();
    assert!(format!("{err:#}").contains("already"), "{err:#}");
}

/// The marker as an accepted Proposal leaves it (issue #127), written straight to the row.
fn mark_runs_after(conn: &Connection, story_id: &str, after_id: &str) {
    conn.execute(
        "UPDATE stories SET runs_after_story_id = ?1, runs_after_reason = 'shares a file' WHERE id = ?2",
        params![after_id, story_id],
    )
    .unwrap();
}

#[test]
fn runs_after_markers_that_would_cross_epics_are_cleared() {
    let mut f = fixture();
    // A marker names a Story of the same Epic, so a move clears every marker it would carry across:
    // the ones pointing at the moved Story, and the moved Story's own.
    mark_runs_after(&f.conn, &f.second, &f.first);

    move_story_to_epic(&mut f.conn, &f.human, &f.first, &f.to).unwrap();

    let second = get_story(&f.conn, &f.second).unwrap().unwrap();
    assert_eq!(second.runs_after_story_id, None);
    assert_eq!(second.runs_after_reason, None);

    mark_runs_after(&f.conn, &f.first, &f.resident);
    move_story_to_epic(&mut f.conn, &f.human, &f.first, &f.from).unwrap();
    assert_eq!(get_story(&f.conn, &f.first).unwrap().unwrap().runs_after_story_id, None);
}

#[test]
fn an_agent_cannot_move_a_story() {
    let mut f = fixture();
    let agent = agent_actor_id(&f.conn).unwrap();
    assert!(move_story_to_epic(&mut f.conn, &agent, &f.first, &f.to).is_err());
    assert_eq!(get_story(&f.conn, &f.first).unwrap().unwrap().epic_id, f.from);
}
