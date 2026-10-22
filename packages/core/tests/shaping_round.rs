//! Issue #123: a shaping session challenges the spec in Rounds the developer answers in the dock.
//!
//! Starting a shaping session on an Epic opens its first Stage, Challenge the spec. The agent's
//! `round_post` call writes a Round of numbered questions into that open Stage and is held: it is
//! answered with every answer only once the last question is answered. Each answer is its own
//! transaction, so it is in the database before the next one is given, and a dead session loses
//! nothing the developer already answered. Identity always comes from the session the call arrived
//! on, never from an argument.

mod common;

use core::domain::round::{
    accept_all_recommended, answer_round_question, post_round, rounds_for_epic, NewQuestion, NewRound, RoundAnswer,
};
use core::domain::session::{interrupt_session, start_session, start_shaping_session, ShapingSubject};
use core::domain::session_kind::SessionKind;
use core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome, SHAPING_TOOL_NAMES};
use core::domain::stage::{open_stage, stages_for_epic, StageKind};
use core::domain::{epic, milestone};
use rusqlite::Connection;

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    epic_id: String,
    session_id: String,
}

/// A project with one Epic in Shaping and a live shaping session on it.
fn shaping() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
    let session_id = start_shaping_session(
        &mut conn,
        &ShapingSubject::Epic(e.id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &human,
    )
    .unwrap()
    .id;
    Fixture { conn, human, project_id: project.id, epic_id: e.id, session_id }
}

fn question(n: usize) -> NewQuestion {
    NewQuestion {
        title: format!("Question {n}"),
        question: format!("Should the Epic do thing {n}?"),
        grounding: format!("Read docs/spec.md §{n}"),
        recommended_answer: format!("Yes, thing {n}"),
        because: format!("Thing {n} is in scope"),
    }
}

fn round_of(n: usize) -> NewRound {
    NewRound { note: "This Round settles the problem statement.".into(), questions: (1..=n).map(question).collect() }
}

fn round_post_args(n: usize) -> serde_json::Value {
    serde_json::json!({
        "note": "This Round settles the problem statement.",
        "questions": (1..=n).map(|i| serde_json::json!({
            "title": format!("Question {i}"),
            "question": format!("Should the Epic do thing {i}?"),
            "grounding": format!("Read docs/spec.md §{i}"),
            "recommended_answer": format!("Yes, thing {i}"),
            "because": format!("Thing {i} is in scope"),
        })).collect::<Vec<_>>(),
    })
}

fn answered_count(conn: &Connection, round_id: &str) -> i64 {
    conn.query_row(
        "SELECT COUNT(*) FROM round_questions WHERE round_id = ?1 AND answer IS NOT NULL",
        [round_id],
        |r| r.get(0),
    )
    .unwrap()
}

#[test]
fn starting_a_shaping_session_opens_the_challenge_stage_once() {
    let mut f = shaping();
    let stages = stages_for_epic(&f.conn, &f.epic_id).unwrap();
    assert_eq!(stages.len(), 1);
    assert_eq!(stages[0].kind, StageKind::ChallengeSpec);
    assert_eq!(stages[0].state, "open");
    assert_eq!(stages[0].rank, 1);

    // A second session on the same Epic keeps the Stage that is already open.
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();
    start_shaping_session(&mut f.conn, &ShapingSubject::Epic(f.epic_id.clone()), "dontAsk", &f.human).unwrap();
    assert_eq!(stages_for_epic(&f.conn, &f.epic_id).unwrap().len(), 1, "no second Challenge Stage");
}

#[test]
fn round_post_creates_a_round_in_the_open_stage_and_holds_the_call() {
    let mut f = shaping();
    let call = ShapingToolCall::parse("round_post", &round_post_args(3)).unwrap();
    let outcome = apply_shaping_tool_call(&mut f.conn, &f.session_id, "req-1", &call).unwrap();
    let ShapingToolOutcome::Held { round_id, project_id } = outcome else { panic!("round_post is held: {outcome:?}") };
    assert_eq!(project_id, f.project_id);

    let stage = open_stage(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap().unwrap();
    let rounds = rounds_for_epic(&f.conn, &f.epic_id).unwrap();
    assert_eq!(rounds.len(), 1);
    let round = &rounds[0];
    assert_eq!(round.id, round_id);
    assert_eq!(round.stage_id, stage.id);
    assert_eq!(round.number, 1);
    assert_eq!(round.state, "open");
    assert_eq!(round.session_id.as_deref(), Some(f.session_id.as_str()), "identity is the session's");
    assert_eq!(round.held_request_id.as_deref(), Some("req-1"), "the held call is stored on the Round");
    assert_eq!(round.questions.iter().map(|q| q.number).collect::<Vec<_>>(), [1, 2, 3]);
    assert_eq!(round.questions[1].recommended_answer, "Yes, thing 2");
    assert_eq!(round.questions[1].because, "Thing 2 is in scope");
    assert_eq!(round.questions[1].grounding, "Read docs/spec.md §2");
    assert!(round.questions.iter().all(|q| q.answer.is_none()));
    assert!(SHAPING_TOOL_NAMES.contains(&"round_post"));
}

#[test]
fn the_call_is_answered_only_once_the_last_question_is_answered_each_answer_stored_first() {
    let mut f = shaping();
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(3)).unwrap();
    let q = |i: usize| round.questions[i].id.clone();

    let first = answer_round_question(&mut f.conn, &f.human, &q(0), &RoundAnswer::Recommended).unwrap();
    assert!(first.release.is_none(), "two questions are still open");
    assert_eq!(answered_count(&f.conn, &round.id), 1, "the first answer is stored before the next is given");

    let second = answer_round_question(&mut f.conn, &f.human, &q(2), &RoundAnswer::Own("No: thing 3 is later".into())).unwrap();
    assert!(second.release.is_none());
    assert_eq!(answered_count(&f.conn, &round.id), 2);

    let last = answer_round_question(&mut f.conn, &f.human, &q(1), &RoundAnswer::Recommended).unwrap();
    let release = last.release.expect("the last answer releases the held call");
    assert_eq!(release.session_id, f.session_id);
    assert_eq!(release.request_id, "req-1");
    let answers = release.result["answers"].as_array().unwrap();
    assert_eq!(answers.len(), 3);
    assert_eq!(answers[0]["number"], 1);
    assert_eq!(answers[0]["answer"], "Yes, thing 1");
    assert_eq!(answers[0]["answered_with"], "recommended");
    assert_eq!(answers[2]["answer"], "No: thing 3 is later");
    assert_eq!(answers[2]["answered_with"], "own");
    assert_eq!(release.result["round"], 1);

    let stored = &rounds_for_epic(&f.conn, &f.epic_id).unwrap()[0];
    assert_eq!(stored.state, "answered");
    assert_eq!(stored.held_request_id, None, "a released call is no longer held");
    assert!(stored.answered_at.is_some());
    assert!(stored.questions.iter().all(|q| q.answered_by.as_deref() == Some(f.human.as_str())));
}

#[test]
fn accept_all_recommended_answers_every_open_question_with_its_recommendation_and_releases() {
    let mut f = shaping();
    let round = post_round(&mut f.conn, &f.session_id, Some("req-9"), &round_of(3)).unwrap();
    answer_round_question(&mut f.conn, &f.human, &round.questions[0].id, &RoundAnswer::Own("Mine".into())).unwrap();

    let outcome = accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    let release = outcome.release.expect("the Round is complete");
    let answers = release.result["answers"].as_array().unwrap();
    assert_eq!(answers[0]["answer"], "Mine", "an answer already given is kept");
    assert_eq!(answers[1]["answer"], "Yes, thing 2");
    assert_eq!(answers[2]["answered_with"], "recommended");
    assert!(accept_all_recommended(&mut f.conn, &f.human, &round.id).is_err(), "nothing is left open");
}

#[test]
fn an_answer_can_change_while_the_round_is_open_but_not_after() {
    let mut f = shaping();
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(2)).unwrap();
    answer_round_question(&mut f.conn, &f.human, &round.questions[0].id, &RoundAnswer::Recommended).unwrap();
    answer_round_question(&mut f.conn, &f.human, &round.questions[0].id, &RoundAnswer::Own("Changed my mind".into()))
        .unwrap();
    let last = answer_round_question(&mut f.conn, &f.human, &round.questions[1].id, &RoundAnswer::Recommended).unwrap();
    assert_eq!(last.release.unwrap().result["answers"][0]["answer"], "Changed my mind");
    let late = answer_round_question(&mut f.conn, &f.human, &round.questions[0].id, &RoundAnswer::Recommended);
    assert!(late.unwrap_err().to_string().contains("answered"), "an answered Round is settled");
}

#[test]
fn a_second_round_is_refused_while_one_is_open_in_the_stage_and_numbered_after_it() {
    let mut f = shaping();
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(1)).unwrap();
    let refused = post_round(&mut f.conn, &f.session_id, Some("req-2"), &round_of(1));
    assert!(refused.unwrap_err().to_string().contains("still open"), "one open Round per Stage");

    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    let next = post_round(&mut f.conn, &f.session_id, Some("req-2"), &round_of(2)).unwrap();
    assert_eq!(next.number, 2);
    assert_eq!(next.stage_id, round.stage_id);
}

#[test]
fn round_post_is_refused_for_a_story_session_an_ended_session_and_a_malformed_round() {
    let mut f = shaping();

    // Malformed: no questions, a blank recommended answer, an unknown tool.
    assert!(ShapingToolCall::parse("round_post", &serde_json::json!({ "note": "n", "questions": [] })).is_err());
    let mut blank = round_post_args(1);
    blank["questions"][0]["recommended_answer"] = serde_json::json!("  ");
    assert!(ShapingToolCall::parse("round_post", &blank).unwrap_err().to_string().contains("recommended_answer"));
    assert!(ShapingToolCall::parse("task_list", &serde_json::json!({})).is_err());

    // Ended session.
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();
    let ended = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(1));
    assert!(ended.unwrap_err().to_string().contains("ended"));

    // A Story session has no Stage to post into.
    common::with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &human, "A Story");
        core::domain::story::set_story_state(&mut conn, &human, &story.id, core::domain::story::StoryState::Ready).unwrap();
        core::domain::story::set_story_state(&mut conn, &human, &story.id, core::domain::story::StoryState::Running).unwrap();
        let session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
        let refused = post_round(&mut conn, &session.id, Some("req-1"), &round_of(1));
        assert!(refused.unwrap_err().to_string().contains("shaping session"));
        let rounds: i64 = conn.query_row("SELECT COUNT(*) FROM rounds", [], |r| r.get(0)).unwrap();
        assert_eq!(rounds, 0);
    });
}

#[test]
fn a_round_outlives_its_session_and_its_answers_are_kept() {
    let mut f = shaping();
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(2)).unwrap();
    answer_round_question(&mut f.conn, &f.human, &round.questions[0].id, &RoundAnswer::Recommended).unwrap();
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();

    // The developer can keep answering; with no live session there is no call left to answer.
    let last = answer_round_question(&mut f.conn, &f.human, &round.questions[1].id, &RoundAnswer::Recommended).unwrap();
    assert!(last.release.is_none(), "a dead session's held call is not answered");
    let stored = &rounds_for_epic(&f.conn, &f.epic_id).unwrap()[0];
    assert_eq!(stored.state, "answered");
    assert_eq!(answered_count(&f.conn, &round.id), 2);
}

#[test]
fn each_post_and_answer_appends_an_event_scoped_to_the_epic() {
    let mut f = shaping();
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(1)).unwrap();
    answer_round_question(&mut f.conn, &f.human, &round.questions[0].id, &RoundAnswer::Recommended).unwrap();
    let mut stmt = f
        .conn
        .prepare("SELECT event_type, epic_id FROM events WHERE event_type LIKE 'round%' ORDER BY sequence")
        .unwrap();
    let events: Vec<(String, Option<String>)> =
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
    let epic = Some(f.epic_id.clone());
    assert_eq!(
        events,
        vec![
            ("round.posted".to_string(), epic.clone()),
            ("round_question.answered".to_string(), epic.clone()),
            ("round.answered".to_string(), epic),
        ]
    );
}
