//! An agent's question (issue #100, docs/mvp-spec.md §2 "Attention", §5 "Never a pause").
//!
//! An `AskUserQuestion` call is held as a `permission_requests` row like any other request, so the
//! Story is Waiting on you, the question is in Needs you (the blocked queue) and counts in the
//! sidebar. It is answered with answers, never allowed or denied, and it expires with its session.

mod common;

use std::collections::BTreeMap;

use common::with_scratch_worktree_root;

use flywheel_core::domain::permission_request::{answer_request, create_pending_request};
use flywheel_core::domain::question::{answer_question, ASK_USER_QUESTION_TOOL};
use flywheel_core::domain::session::{interrupt_session, start_session};
use flywheel_core::domain::story::{set_story_state, StoryState};
use flywheel_core::query::fleet::blocked_queue;
use flywheel_core::query::permissions::{
    blocked_count_for_project, blocked_story_ids_for_project, pending_requests_for_run,
};
use rusqlite::{params, Connection};

struct Seeded {
    conn: Connection,
    actor_id: String,
    project_id: String,
    story_id: String,
    session_id: String,
}

fn seeded_running_session() -> Seeded {
    with_scratch_worktree_root(|_| {
        let (mut conn, actor_id, project, _repo_dir) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &actor_id, "Question story");
        set_story_state(&mut conn, &actor_id, &story.id, StoryState::Ready).expect("Ready");
        set_story_state(&mut conn, &actor_id, &story.id, StoryState::Running).expect("Running");
        let session =
            start_session(&mut conn, &story.id, "acceptEdits", &actor_id).expect("start_session");
        Seeded {
            conn,
            actor_id,
            project_id: project.id,
            story_id: story.id,
            session_id: session.id,
        }
    })
}

fn ask(s: &mut Seeded) -> String {
    let input = serde_json::json!({ "questions": [
        { "question": "Which colour?", "header": "Colour", "multiSelect": false,
          "options": [{ "label": "Red", "description": "" }, { "label": "Blue", "description": "" }] },
        { "question": "Which platforms?", "header": "Platforms", "multiSelect": true,
          "options": [{ "label": "macOS", "description": "" }, { "label": "Linux", "description": "" }] },
    ]})
    .to_string();
    create_pending_request(
        &mut s.conn,
        &s.session_id,
        ASK_USER_QUESTION_TOOL,
        Some(&input),
        &s.actor_id,
        None,
    )
    .expect("create_pending_request")
    .id
}

fn picks() -> BTreeMap<String, Vec<String>> {
    BTreeMap::from([
        (
            "Which colour?".to_string(),
            vec!["Teal, not on your list".to_string()],
        ),
        (
            "Which platforms?".to_string(),
            vec!["macOS".to_string(), "Linux".to_string()],
        ),
    ])
}

#[test]
fn an_open_question_is_waiting_on_you_in_needs_you_and_the_sidebar_until_answered() {
    let mut s = seeded_running_session();
    let question = ask(&mut s);

    let queue = blocked_queue(&s.conn, 50).unwrap();
    assert_eq!(queue.len(), 1, "the question is in Needs you");
    assert_eq!(queue[0].request_id, question);
    assert_eq!(queue[0].tool_name, ASK_USER_QUESTION_TOOL);
    assert_eq!(
        blocked_story_ids_for_project(&s.conn, &s.project_id).unwrap(),
        vec![s.story_id.clone()]
    );
    assert_eq!(
        blocked_count_for_project(&s.conn, &s.project_id).unwrap(),
        1,
        "the sidebar counts it"
    );

    let answered =
        answer_question(&mut s.conn, &question, &picks(), &s.actor_id).expect("answer_question");
    assert_eq!(
        serde_json::Value::Object(answered.answers),
        serde_json::json!({ "Which colour?": "Teal, not on your list", "Which platforms?": "macOS, Linux" })
    );
    assert_eq!(answered.session_id, s.session_id);

    let (status, stored): (String, String) = s
        .conn
        .query_row(
            "SELECT status, answers FROM permission_requests WHERE id = ?1",
            params![question],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(status, "allowed");
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&stored).unwrap(),
        serde_json::json!({ "Which colour?": "Teal, not on your list", "Which platforms?": "macOS, Linux" })
    );
    assert!(blocked_queue(&s.conn, 50).unwrap().is_empty());
    assert_eq!(
        blocked_count_for_project(&s.conn, &s.project_id).unwrap(),
        0
    );

    assert!(
        answer_question(&mut s.conn, &question, &picks(), &s.actor_id).is_err(),
        "answered once only"
    );
}

#[test]
fn a_question_is_never_allowed_or_denied() {
    let mut s = seeded_running_session();
    let question = ask(&mut s);
    for decision in ["allowed", "denied", "allowed_always"] {
        let err = answer_request(&mut s.conn, &question, decision, &s.actor_id).unwrap_err();
        assert!(err.to_string().contains("question"), "{decision}: {err}");
    }
    assert_eq!(
        pending_requests_for_run(&s.conn, &s.session_id)
            .unwrap()
            .len(),
        1,
        "still open"
    );
}

#[test]
fn a_question_expires_with_its_session() {
    let mut s = seeded_running_session();
    let question = ask(&mut s);
    interrupt_session(&mut s.conn, &s.session_id, &s.actor_id).expect("interrupt_session");

    assert!(blocked_queue(&s.conn, 50).unwrap().is_empty());
    assert_eq!(
        blocked_count_for_project(&s.conn, &s.project_id).unwrap(),
        0
    );
    let err = answer_question(&mut s.conn, &question, &picks(), &s.actor_id).unwrap_err();
    assert!(err.to_string().contains("no longer open"), "{err}");
}
