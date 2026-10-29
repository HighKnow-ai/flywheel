//! Issue #124: a killed shaping session resumes at the open Round.
//!
//! A Round outlives the session that posted it: the developer keeps answering in the dock with no
//! live session, and every answer is on the board as it is given. Continue shaping starts a fresh
//! session whose packet carries the earlier Rounds with their answers and the open Round with the
//! answers so far, and tells the agent to call `round_wait`. That held call takes the open Round
//! over (its session and its held call become the new session's) and is answered once the last
//! question is answered, or at once when the Round is already complete.

mod common;

use flywheel_core::domain::round::{
    accept_all_recommended, answer_round_question, post_round, rounds_for_epic, NewQuestion,
    NewRound, RoundAnswer,
};
use flywheel_core::domain::session::{
    interrupt_session, start_session, start_shaping_session, ShapingSubject,
};
use flywheel_core::domain::session_kind::SessionKind;
use flywheel_core::domain::shaping_tool::{
    apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome, SHAPING_TOOL_NAMES,
};
use flywheel_core::domain::{epic, milestone};
use flywheel_core::shaping_packet::build_epic_shaping_packet;
use rusqlite::Connection;

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    epic_id: String,
    session_id: String,
}

fn shaping() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
    let session_id = start(&mut conn, &e.id, &human);
    Fixture {
        conn,
        human,
        project_id: project.id,
        epic_id: e.id,
        session_id,
    }
}

fn start(conn: &mut Connection, epic_id: &str, human: &str) -> String {
    start_shaping_session(
        conn,
        &ShapingSubject::Epic(epic_id.to_string()),
        SessionKind::Shaping.launch_policy().permission_mode,
        human,
    )
    .unwrap()
    .id
}

fn round_of(n: usize, note: &str) -> NewRound {
    NewRound {
        note: note.into(),
        questions: (1..=n)
            .map(|i| NewQuestion {
                title: format!("Question {i}"),
                question: format!("Should the Epic do thing {i}?"),
                grounding: format!("Read docs/spec.md §{i}"),
                recommended_answer: format!("Yes, thing {i}"),
                because: format!("Thing {i} is in scope"),
                adr: None,
            })
            .collect(),
    }
}

fn round_wait(
    f: &mut Fixture,
    session_id: &str,
    request_id: &str,
) -> anyhow::Result<ShapingToolOutcome> {
    let call = ShapingToolCall::parse("round_wait", &serde_json::json!({}))?;
    apply_shaping_tool_call(&mut f.conn, session_id, request_id, &call)
}

#[test]
fn round_wait_is_a_shaping_tool_and_takes_no_argument() {
    assert!(
        SHAPING_TOOL_NAMES.contains(&"round_wait"),
        "{SHAPING_TOOL_NAMES:?}"
    );
    assert_eq!(
        ShapingToolCall::parse("round_wait", &serde_json::json!({})).unwrap(),
        ShapingToolCall::RoundWait
    );
    assert_eq!(
        ShapingToolCall::parse("round_wait", &serde_json::Value::Null).unwrap(),
        ShapingToolCall::RoundWait
    );
}

/// The acceptance criterion: killed mid-Round, the answers survive, the next session's packet holds
/// the open Round with them, and its `round_wait` is answered when the last question is answered.
#[test]
fn a_killed_session_resumes_at_the_open_round_and_round_wait_is_answered_with_every_answer() {
    let mut f = shaping();
    let round = post_round(
        &mut f.conn,
        &f.session_id,
        Some("req-1"),
        &round_of(3, "Settles the audience."),
    )
    .unwrap();
    answer_round_question(
        &mut f.conn,
        &f.human,
        &round.questions[0].id,
        &RoundAnswer::Own("Only Cyril".into()),
    )
    .unwrap();
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();

    // The developer keeps answering with no live session.
    let kept = answer_round_question(
        &mut f.conn,
        &f.human,
        &round.questions[1].id,
        &RoundAnswer::Recommended,
    )
    .unwrap();
    assert!(kept.release.is_none(), "no live session to answer");
    let stored = &rounds_for_epic(&f.conn, &f.epic_id).unwrap()[0];
    assert_eq!(stored.state, "open");
    assert_eq!(
        stored.questions[0].answer.as_deref(),
        Some("Only Cyril"),
        "the answer given survives the kill"
    );
    assert_eq!(stored.questions[1].answer.as_deref(), Some("Yes, thing 2"));

    // Continue shaping: a fresh session, rebuilt from the board.
    let next = start(&mut f.conn, &f.epic_id, &f.human);
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    let rounds = &packet[packet.find("## Rounds").expect("a Rounds section")
        ..packet.find("## Closing instruction").unwrap()];
    for line in [
        "Round 1 (open, 2 of 3 answered)",
        "Settles the audience.",
        "1. Question 1: Should the Epic do thing 1?",
        "Recommended: Yes, thing 1 (because Thing 1 is in scope)",
        "Answer (the developer's own words): Only Cyril",
        "Answer (your recommendation, accepted): Yes, thing 2",
        "3. Question 3: Should the Epic do thing 3?",
        "Answer: not answered yet",
    ] {
        assert!(
            rounds.contains(line),
            "the Rounds section misses {line:?}:\n{rounds}"
        );
    }
    let closing = &packet[packet.find("## Closing instruction").unwrap()..];
    assert!(
        closing.contains("`round_wait`"),
        "the agent is told to wait on the open Round:\n{closing}"
    );
    assert!(!closing.contains("post the first Round"), "{closing}");

    // round_wait takes the open Round over and is held.
    let outcome = round_wait(&mut f, &next, "req-9").unwrap();
    assert!(
        matches!(outcome, ShapingToolOutcome::Held { ref round_id, ref project_id } if *round_id == round.id && *project_id == f.project_id),
        "{outcome:?}"
    );
    let taken = &rounds_for_epic(&f.conn, &f.epic_id).unwrap()[0];
    assert_eq!(
        taken.session_id.as_deref(),
        Some(next.as_str()),
        "the Round is the new session's"
    );
    assert_eq!(
        taken.held_request_id.as_deref(),
        Some("req-9"),
        "its held call is round_wait's"
    );
    assert!(taken.waiting_on_you, "a live session is held on it again");

    // The last answer answers round_wait, with every answer, the ones given while no session lived too.
    let last = answer_round_question(
        &mut f.conn,
        &f.human,
        &round.questions[2].id,
        &RoundAnswer::Recommended,
    )
    .unwrap();
    let release = last.release.expect("the last answer releases round_wait");
    assert_eq!(
        (release.session_id.as_str(), release.request_id.as_str()),
        (next.as_str(), "req-9")
    );
    let answers = release.result["answers"].as_array().unwrap();
    assert_eq!(
        answers
            .iter()
            .map(|a| a["answer"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["Only Cyril", "Yes, thing 2", "Yes, thing 3"]
    );
}

#[test]
fn round_wait_is_answered_at_once_when_the_round_was_completed_with_no_live_session() {
    let mut f = shaping();
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(2, "n")).unwrap();
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();
    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();

    let next = start(&mut f.conn, &f.epic_id, &f.human);
    let outcome = round_wait(&mut f, &next, "req-2").unwrap();
    let ShapingToolOutcome::Answered { result, project_id } = outcome else {
        panic!("round_wait is answered at once")
    };
    assert_eq!(project_id, f.project_id);
    assert_eq!(result["round"], 1);
    assert_eq!(result["answers"][1]["answer"], "Yes, thing 2");
    let stored = &rounds_for_epic(&f.conn, &f.epic_id).unwrap()[0];
    assert_eq!(
        stored.held_request_id, None,
        "an answered Round holds nothing"
    );
}

#[test]
fn round_wait_is_refused_with_no_round_in_the_stage_for_an_ended_session_and_for_a_story_session() {
    let mut f = shaping();
    let session = f.session_id.clone();
    let none = round_wait(&mut f, &session, "req-1")
        .unwrap_err()
        .to_string();
    assert!(
        none.contains("round_post"),
        "with nothing to wait on, the agent is told to post: {none}"
    );

    post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(1, "n")).unwrap();
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();
    let ended = round_wait(&mut f, &session, "req-2")
        .unwrap_err()
        .to_string();
    assert!(ended.contains("ended"), "{ended}");

    common::with_scratch_worktree_root(|_| {
        let (mut conn, human, project, _repo) = common::seeded_git_project();
        let story = common::new_story(&mut conn, &project.id, &human, "A Story");
        flywheel_core::domain::story::set_story_state(
            &mut conn,
            &human,
            &story.id,
            flywheel_core::domain::story::StoryState::Ready,
        )
        .unwrap();
        flywheel_core::domain::story::set_story_state(
            &mut conn,
            &human,
            &story.id,
            flywheel_core::domain::story::StoryState::Running,
        )
        .unwrap();
        let story_session = start_session(&mut conn, &story.id, "acceptEdits", &human).unwrap();
        let refused = apply_shaping_tool_call(
            &mut conn,
            &story_session.id,
            "req-1",
            &ShapingToolCall::RoundWait,
        );
        assert!(refused.unwrap_err().to_string().contains("shaping session"));
    });
}

#[test]
fn round_wait_takes_over_the_round_in_one_transaction_with_an_event() {
    let mut f = shaping();
    post_round(&mut f.conn, &f.session_id, Some("req-1"), &round_of(1, "n")).unwrap();
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();
    let next = start(&mut f.conn, &f.epic_id, &f.human);
    round_wait(&mut f, &next, "req-2").unwrap();
    let (kind, epic): (String, Option<String>) = f
        .conn
        .query_row("SELECT event_type, epic_id FROM events WHERE event_type LIKE 'round.%' ORDER BY sequence DESC LIMIT 1", [], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .unwrap();
    assert_eq!(
        (kind.as_str(), epic),
        ("round.resumed", Some(f.epic_id.clone()))
    );
}

#[test]
fn the_packet_carries_earlier_rounds_with_their_answers_and_says_to_post_the_next_when_none_is_open(
) {
    let mut f = shaping();
    let first = post_round(
        &mut f.conn,
        &f.session_id,
        Some("req-1"),
        &round_of(1, "Settles the problem."),
    )
    .unwrap();
    accept_all_recommended(&mut f.conn, &f.human, &first.id).unwrap();
    interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();

    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    let rounds =
        &packet[packet.find("## Rounds").unwrap()..packet.find("## Closing instruction").unwrap()];
    assert!(rounds.contains("### Challenge the spec"), "{rounds}");
    assert!(rounds.contains("Round 1 (answered)"), "{rounds}");
    assert!(
        rounds.contains("Answer (your recommendation, accepted): Yes, thing 1"),
        "{rounds}"
    );
    let closing = &packet[packet.find("## Closing instruction").unwrap()..];
    assert!(closing.contains("post the next Round"), "{closing}");
    assert!(closing.contains("`round_post`"), "{closing}");
    assert!(
        !closing.contains("`round_wait`"),
        "nothing is open to wait on:\n{closing}"
    );
}

#[test]
fn an_epic_with_no_round_has_no_rounds_to_carry() {
    let f = shaping();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert!(
        packet.contains("## Rounds\n\nNo Round has been posted on this Epic yet.\n"),
        "{packet}"
    );
    assert!(
        packet.contains("post the first Round of the Challenge the spec Stage with `round_post`"),
        "{packet}"
    );
}
