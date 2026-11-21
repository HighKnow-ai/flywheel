//! A Quick Story and a note to the agent (docs/mvp-spec.md §4.7, ADR 0044): the core commands,
//! against a scratch board and a scratch repository.

mod common;

use common::with_scratch_worktree_root;
use flywheel_core::domain::acceptance_criterion::criteria_for_story;
use flywheel_core::domain::actor::system_actor;
use flywheel_core::domain::epic::get_epic;
use flywheel_core::domain::quick_story::{
    title_for, write_quick_story, DEFAULT_CRITERION, MAX_REQUEST_LEN, QUICK_EPIC_TITLE,
};
use flywheel_core::domain::session::{agent_actor_id, close_session, start_session, SessionStatus};
use flywheel_core::domain::session_note::{
    mark_delivered, notes_for_story, record_note, MAX_NOTE_LEN,
};
use flywheel_core::domain::story::{set_story_state, StoryState};
use flywheel_core::domain::worktree::ensure_worktree;

#[test]
fn quick_story_is_ready_with_one_default_criterion_and_the_request_as_its_description() {
    let (mut conn, human, project) = common::seeded_project();
    let story = write_quick_story(
        &mut conn,
        &human,
        &project.id,
        "Fix the typo in the README\nline 12",
    )
    .unwrap();
    assert_eq!(story.state, "ready");
    assert_eq!(story.title, "Fix the typo in the README");
    assert_eq!(
        story.description.as_deref(),
        Some("Fix the typo in the README\nline 12")
    );
    let criteria = criteria_for_story(&conn, &story.id).unwrap();
    assert_eq!(criteria.len(), 1);
    assert_eq!(criteria[0].statement, DEFAULT_CRITERION);
    let epic = get_epic(&conn, &story.epic_id).unwrap().unwrap();
    assert_eq!(epic.title, QUICK_EPIC_TITLE);
}

#[test]
fn quick_stories_of_a_project_share_one_epic() {
    let (mut conn, human, project) = common::seeded_project();
    let first =
        write_quick_story(&mut conn, &human, &project.id, "Why does the build fail?").unwrap();
    let second = write_quick_story(&mut conn, &human, &project.id, "Rename the flag").unwrap();
    assert_eq!(first.epic_id, second.epic_id);
    assert_ne!(first.key, second.key);
}

#[test]
fn quick_story_refuses_a_blank_or_oversized_request_and_an_agent_and_writes_nothing() {
    let (mut conn, human, project) = common::seeded_project();
    assert!(write_quick_story(&mut conn, &human, &project.id, "   \n ").is_err());
    let long = "x".repeat(MAX_REQUEST_LEN + 1);
    assert!(write_quick_story(&mut conn, &human, &project.id, &long).is_err());
    let agent = agent_actor_id(&conn).unwrap();
    assert!(write_quick_story(&mut conn, &agent, &project.id, "do it").is_err());
    let stories: i64 = conn
        .query_row("SELECT COUNT(*) FROM stories", [], |r| r.get(0))
        .unwrap();
    assert_eq!(stories, 0);
}

#[test]
fn a_long_first_line_is_cut_into_a_title_that_ends_with_an_ellipsis() {
    let title = title_for(&"word ".repeat(40));
    assert!(title.chars().count() <= 80);
    assert!(title.ends_with('…'));
}

/// A Running Story with a live session, in a scratch repository.
fn live_session() -> (
    rusqlite::Connection,
    String,
    String,
    String,
    tempfile::TempDir,
) {
    let (mut conn, human, project, repo) = common::seeded_git_project();
    let story =
        write_quick_story(&mut conn, &human, &project.id, "Look at the flaky test").unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    ensure_worktree(&mut conn, &story.id, &human).unwrap();
    let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
    (conn, human, story.id, session.id, repo)
}

#[test]
fn a_note_is_sent_then_delivered_once() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, story_id, session_id, _repo) = live_session();
        let note = record_note(&mut conn, &human, &story_id, "  Use the 2024 fixture.  ").unwrap();
        assert_eq!(note.status, "sent");
        assert_eq!(note.session_id, session_id);
        assert_eq!(note.body, "Use the 2024 fixture.");
        assert_eq!(notes_for_story(&conn, &story_id).unwrap()[0].status, "sent");

        assert!(mark_delivered(&mut conn, &note.id).unwrap());
        assert!(
            !mark_delivered(&mut conn, &note.id).unwrap(),
            "the second report changes nothing"
        );
        let notes = notes_for_story(&conn, &story_id).unwrap();
        assert_eq!(notes[0].status, "delivered");
        assert!(notes[0].delivered_at.is_some());
        let delivered_events: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM events WHERE event_type = 'session.note_delivered' AND actor_id = ?1",
                [system_actor(&conn).unwrap().id],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(delivered_events, 1);
    });
}

#[test]
fn a_note_still_sent_when_its_session_ends_reads_undelivered() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, story_id, session_id, _repo) = live_session();
        let note =
            record_note(&mut conn, &human, &story_id, "Also check the Windows path.").unwrap();
        close_session(
            &mut conn,
            &session_id,
            SessionStatus::Completed,
            None,
            None,
            None,
        )
        .unwrap();
        let notes = notes_for_story(&conn, &story_id).unwrap();
        assert_eq!(notes[0].status, "undelivered");
        assert_eq!(notes[0].body, "Also check the Windows path.");
        // A late report of delivery from a dead session still wins: the agent had it.
        assert!(mark_delivered(&mut conn, &note.id).unwrap());
        assert_eq!(
            notes_for_story(&conn, &story_id).unwrap()[0].status,
            "delivered"
        );
    });
}

#[test]
fn a_note_is_refused_for_an_agent_a_blank_or_long_note_and_a_story_with_no_live_session() {
    with_scratch_worktree_root(|_| {
        let (mut conn, human, story_id, session_id, _repo) = live_session();
        let agent = agent_actor_id(&conn).unwrap();
        assert!(record_note(&mut conn, &agent, &story_id, "hello").is_err());
        assert!(record_note(&mut conn, &human, &story_id, "  ").is_err());
        assert!(record_note(&mut conn, &human, &story_id, &"x".repeat(MAX_NOTE_LEN + 1)).is_err());
        close_session(
            &mut conn,
            &session_id,
            SessionStatus::Completed,
            None,
            None,
            None,
        )
        .unwrap();
        let err = record_note(&mut conn, &human, &story_id, "too late").unwrap_err();
        assert!(err.to_string().contains("no live session"), "{err}");
        assert!(notes_for_story(&conn, &story_id).unwrap().is_empty());
    });
}
