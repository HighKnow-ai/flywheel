//! Issue #129: an ADR is offered as a question inside the Round (docs/mvp-spec.md §3 "ADRs in
//! shaping", §6).
//!
//! The shaping agent offers an ADR draft with its bar lines as an `adr` question. "Yes" files an
//! ADR Proposal on the Epic and accepts it, filed and decided by the developer in the answer's own
//! transaction; "No" drops the draft and creates nothing. Either answer is settled once given.
//! Accept all recommended answers the Round's ordinary questions only, never an ADR question, since
//! its Yes decides a Proposal.

mod common;

use core::domain::proposal::{proposals_on_epic, Proposal};
use core::domain::round::{
    accept_all_recommended, answer_round_question, post_round, rounds_for_epic, AdrDraft, NewQuestion, NewRound, Round,
    RoundAnswer,
};
use core::domain::session::{agent_actor_id, start_shaping_session, ShapingSubject};
use core::domain::session_kind::SessionKind;
use core::domain::{epic, milestone};
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

fn draft() -> AdrDraft {
    AdrDraft {
        path: "docs/adr/0005-board-is-the-shaping-store.md".into(),
        text: "# The board is the shaping store\n\nEvery answer is written to the board as it is made.\n".into(),
        hard_to_reverse: "Every later Story reads its context from the board".into(),
        surprising: "A reader expects shaping notes in the repo".into(),
        losing_alternative: "A .planning/ folder of markdown".into(),
        relates_to: Some("ADR-0002".into()),
    }
}

fn plain(n: usize) -> NewQuestion {
    NewQuestion {
        title: format!("Question {n}"),
        question: format!("Should the Epic do thing {n}?"),
        grounding: format!("Read docs/spec.md §{n}"),
        recommended_answer: format!("Yes, thing {n}"),
        because: format!("Thing {n} is in scope"),
        adr: None,
    }
}

fn adr_question(recommended: &str) -> NewQuestion {
    NewQuestion {
        title: "Record the shaping store".into(),
        question: "Record \"the board is the shaping store\" as ADR 0005?".into(),
        grounding: "Read docs/adr/0002".into(),
        recommended_answer: recommended.into(),
        because: "It settles where every answer lives".into(),
        adr: Some(draft()),
    }
}

/// A Round of one ordinary question then one ADR question, posted by the live session.
fn posted(f: &mut Fixture) -> Round {
    let round = NewRound { note: "This Round settles the store.".into(), questions: vec![plain(1), adr_question("Yes")] };
    post_round(&mut f.conn, &f.session_id, Some("req-1"), &round).unwrap()
}

fn adr_proposals(f: &Fixture) -> Vec<Proposal> {
    proposals_on_epic(&f.conn, &f.epic_id).unwrap().into_iter().filter(|p| p.target_type == "adr").collect()
}

fn count(conn: &Connection, sql: &str) -> i64 {
    conn.query_row(sql, [], |r| r.get(0)).unwrap()
}

#[test]
fn yes_files_an_accepted_adr_proposal_on_the_epic_filed_and_decided_by_the_developer() {
    let mut f = posted_fixture();
    let round = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);
    let adr_q = &round.questions[1];
    answer_round_question(&mut f.conn, &f.human, &adr_q.id, &RoundAnswer::Own("yes".into())).unwrap();

    let filed = adr_proposals(&f);
    assert_eq!(filed.len(), 1, "one ADR Proposal on the Epic");
    let p = &filed[0];
    assert_eq!((p.verb.as_str(), p.target_type.as_str(), p.state.as_str()), ("create", "adr", "accepted"));
    assert_eq!(p.epic_id.as_deref(), Some(f.epic_id.as_str()));
    assert_eq!(p.project_id, f.project_id);
    assert_eq!(p.decided_by.as_deref(), Some(f.human.as_str()), "decided by the developer");
    let created_by: String =
        f.conn.query_row("SELECT created_by FROM proposals WHERE id = ?1", [&p.id], |r| r.get(0)).unwrap();
    assert_eq!(created_by, f.human, "filed by the developer, not the agent");
    assert_eq!(p.session_id.as_deref(), Some(f.session_id.as_str()), "filed under the session that offered it");
    assert_eq!(p.round_id.as_deref(), Some(round.id.as_str()), "it follows the Round it was offered in");
    assert_eq!(AdrDraft::from_payload(&p.payload).unwrap(), draft(), "the payload is the draft with its bar lines");

    let after = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);
    let answered = &after.questions[1];
    assert_eq!(answered.answer.as_deref(), Some("Yes"));
    assert_eq!(answered.answered_with.as_deref(), Some("recommended"), "Yes was the recommendation");
    assert_eq!(answered.adr_proposal_id.as_deref(), Some(p.id.as_str()));

    // Filed then decided, in that order, through the Proposal writers' own events.
    let mut stmt = f.conn.prepare("SELECT event_type FROM events WHERE stream_id = ?1 ORDER BY sequence").unwrap();
    let events: Vec<String> = stmt.query_map([&p.id], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(events, ["proposal.filed", "proposal.accepted"]);
}

#[test]
fn no_drops_the_draft_and_creates_nothing() {
    let mut f = posted_fixture();
    let round = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);
    let before = count(&f.conn, "SELECT COUNT(*) FROM proposals");
    answer_round_question(&mut f.conn, &f.human, &round.questions[1].id, &RoundAnswer::Own("No.".into())).unwrap();

    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM proposals"), before, "No files no Proposal");
    let after = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);
    assert_eq!(after.questions[1].answer.as_deref(), Some("No"));
    assert_eq!(after.questions[1].answered_with.as_deref(), Some("own"), "the recommendation was Yes");
    assert_eq!(after.questions[1].adr_proposal_id, None);
}

#[test]
fn accepting_the_recommendation_follows_it_yes_or_no() {
    let mut f = shaping();
    let round = NewRound { note: "n".into(), questions: vec![adr_question("no")] };
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &round).unwrap();
    assert_eq!(round.questions[0].recommended_answer, "No", "stored as the bare word");
    let outcome = answer_round_question(&mut f.conn, &f.human, &round.questions[0].id, &RoundAnswer::Recommended).unwrap();
    assert!(adr_proposals(&f).is_empty(), "the recommended No drops it");
    assert!(outcome.release.is_some(), "the last answer releases the held call");
}

#[test]
fn an_adr_answer_is_yes_or_no_and_settled_once_given() {
    let mut f = posted_fixture();
    let round = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);
    let id = round.questions[1].id.clone();

    let refused = answer_round_question(&mut f.conn, &f.human, &id, &RoundAnswer::Own("Maybe later".into())).unwrap_err();
    assert!(format!("{refused:#}").contains("Yes or No"), "{refused:#}");
    assert!(rounds_for_epic(&f.conn, &f.epic_id).unwrap()[0].questions[1].answer.is_none());

    answer_round_question(&mut f.conn, &f.human, &id, &RoundAnswer::Own("No".into())).unwrap();
    let changed = answer_round_question(&mut f.conn, &f.human, &id, &RoundAnswer::Own("Yes".into())).unwrap_err();
    assert!(format!("{changed:#}").contains("settled"), "{changed:#}");
    assert!(adr_proposals(&f).is_empty());
    assert_eq!(rounds_for_epic(&f.conn, &f.epic_id).unwrap()[0].state, "open", "settled even while the Round is open");
}

#[test]
fn an_agent_cannot_answer_an_adr_question_and_nothing_is_written() {
    let mut f = posted_fixture();
    let round = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);
    let agent = agent_actor_id(&f.conn).unwrap();
    assert!(answer_round_question(&mut f.conn, &agent, &round.questions[1].id, &RoundAnswer::Own("Yes".into())).is_err());
    assert!(adr_proposals(&f).is_empty());
    assert_eq!(count(&f.conn, "SELECT COUNT(*) FROM round_questions WHERE answer IS NOT NULL"), 0);
}

#[test]
fn accept_all_recommended_answers_ordinary_questions_and_leaves_an_adr_question_open() {
    let mut f = posted_fixture();
    let round = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);

    let outcome = accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    assert!(outcome.release.is_none(), "the Round is not complete while its ADR question is open");
    let after = rounds_for_epic(&f.conn, &f.epic_id).unwrap().remove(0);
    assert_eq!(after.state, "open");
    assert_eq!(after.questions[0].answer.as_deref(), Some("Yes, thing 1"));
    assert!(after.questions[1].answer.is_none(), "the ADR question waits for its own Yes or No");
    assert!(adr_proposals(&f).is_empty(), "Accept all never decides a Proposal");

    // With only the ADR question left, Accept all says what is left.
    let refused = accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap_err().to_string();
    assert!(refused.contains("only ADR questions"), "{refused}");

    // Its own Yes completes the Round and releases the call with the ADR's outcome.
    let done = answer_round_question(&mut f.conn, &f.human, &after.questions[1].id, &RoundAnswer::Recommended).unwrap();
    let release = done.release.expect("the last answer releases the held call");
    let adr = &release.result["answers"][1];
    assert_eq!(adr["kind"], "adr");
    assert_eq!(adr["answer"], "Yes");
    assert_eq!(adr["adr"]["path"], "docs/adr/0005-board-is-the-shaping-store.md");
    assert_eq!(adr["adr"]["proposal_id"], adr_proposals(&f)[0].id.as_str());
    assert!(release.result["answers"][0].get("kind").is_none(), "an ordinary answer is unchanged");
}

#[test]
fn an_adr_question_is_offered_only_while_shaping_an_epic() {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    let session = start_shaping_session(&mut conn, &ShapingSubject::Milestone(m.id), "dontAsk", &human).unwrap();
    let round = NewRound { note: "n".into(), questions: vec![adr_question("Yes")] };
    let refused = post_round(&mut conn, &session.id, Some("req-1"), &round).unwrap_err().to_string();
    assert!(refused.contains("Epic"), "{refused}");
    assert_eq!(count(&conn, "SELECT COUNT(*) FROM rounds"), 0);
}

fn posted_fixture() -> Fixture {
    let mut f = shaping();
    posted(&mut f);
    f
}

#[test]
fn the_schema_refuses_an_adr_question_without_its_bar_lines_and_a_draft_on_an_ordinary_question() {
    let f = posted_fixture();
    for sql in [
        "UPDATE round_questions SET bar_surprising = NULL WHERE kind = 'adr'",
        "UPDATE round_questions SET adr_text = NULL WHERE kind = 'adr'",
        "UPDATE round_questions SET kind = 'question' WHERE kind = 'adr'",
        "UPDATE round_questions SET adr_path = 'docs/adr/0001-x.md' WHERE kind = 'question'",
    ] {
        assert!(f.conn.execute(sql, []).is_err(), "the CHECK refuses: {sql}");
    }
}
