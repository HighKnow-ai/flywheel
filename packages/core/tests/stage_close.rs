//! Issue #126: the developer closes a Stage once nothing in it is open (docs/mvp-spec.md §3
//! "Closing a Stage").
//!
//! `stage_status` lists what is still open in a Stage: every unanswered question and every
//! undecided Proposal, with an empty Problem, Scope or Exit test listed as a warning that never
//! blocks. `close_stage` is human-only and refused while anything is open, the refusal naming each
//! open item. Closing Challenge the spec opens Slice into Stories, and closing Slice opens Write the
//! Acceptance criteria, in the same transaction; the live shaping session on the Epic ends with it,
//! so the next Stage starts from a fresh packet that names it.
//!
//! Issue #128: the Criteria Stage also stays open while a Story still in Shaping has no criterion,
//! a Dropped Story aside. Closing it opens no Stage: every Shaping Story and the Epic move to Ready,
//! all in the close's transaction or none of them.

mod common;

use flywheel_core::domain::proposal::{accept_proposal, count_undecided_proposals_in_stage, reject_proposal};
use flywheel_core::domain::round::{
    accept_all_recommended, answer_round_question, post_round, AdrDraft, NewQuestion, NewRound, RoundAnswer,
};
use flywheel_core::domain::session::{agent_actor_id, live_shaping_session, start_shaping_session, ShapingSubject};
use flywheel_core::domain::session_kind::SessionKind;
use flywheel_core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome};
use flywheel_core::domain::stage::{close_stage, open_stage, stage_status, stages_for_epic, OpenItem, StageKind};
use flywheel_core::domain::acceptance_criterion::create_criterion;
use flywheel_core::domain::story::{self, StoryState};
use flywheel_core::domain::{actor, epic, milestone};
use flywheel_core::shaping_packet::build_epic_shaping_packet;
use rusqlite::Connection;

struct Fixture {
    conn: Connection,
    human: String,
    epic_id: String,
    session_id: String,
}

/// A project with one Epic in Shaping (no spec written) and a live shaping session on it.
fn shaping() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
    let session_id = start_session_on(&mut conn, &human, &e.id);
    Fixture { conn, human, epic_id: e.id, session_id }
}

fn start_session_on(conn: &mut Connection, human: &str, epic_id: &str) -> String {
    start_shaping_session(
        conn,
        &ShapingSubject::Epic(epic_id.to_string()),
        SessionKind::Shaping.launch_policy().permission_mode,
        human,
    )
    .unwrap()
    .id
}

impl Fixture {
    fn open_stage_id(&self) -> String {
        open_stage(&self.conn, &ShapingSubject::Epic(self.epic_id.clone())).unwrap().expect("an open Stage").id
    }

    /// The agent posts a Round of `titles.len()` questions, holding `req-<n>`.
    fn post(&mut self, titles: &[&str]) -> flywheel_core::domain::round::Round {
        let round = NewRound {
            note: "Settles the problem.".into(),
            questions: titles
                .iter()
                .map(|t| NewQuestion {
                    title: (*t).into(),
                    question: format!("{t}?"),
                    grounding: "Read the spec".into(),
                    recommended_answer: "Yes".into(),
                    because: "It is in scope".into(),
                    adr: None,
                })
                .collect(),
        };
        post_round(&mut self.conn, &self.session_id, Some("req-1"), &round).expect("the agent posts a Round")
    }

    /// The agent files a spec change on the Problem through its shaping tool.
    fn propose_problem(&mut self) -> String {
        let call = ShapingToolCall::parse(
            "propose_spec_change",
            &serde_json::json!({ "field": "problem", "text": "Shaping is worse than a terminal.", "why": "Round 1" }),
        )
        .unwrap();
        match apply_shaping_tool_call(&mut self.conn, &self.session_id, "req-p", &call).unwrap() {
            ShapingToolOutcome::Answered { result, .. } => result["proposal_id"].as_str().unwrap().to_string(),
            other => panic!("a Proposal is answered at once: {other:?}"),
        }
    }

    fn stage_rows(&self) -> Vec<(String, String, i64, Option<String>)> {
        let mut stmt =
            self.conn.prepare("SELECT kind, state, rank, closed_by FROM stages WHERE epic_id = ?1 ORDER BY rank").unwrap();
        stmt.query_map([&self.epic_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }
}

#[test]
fn stage_status_lists_each_unanswered_question_and_undecided_proposal() {
    let mut f = shaping();
    f.post(&["Who is it for", "What ships first"]);
    let proposal_id = f.propose_problem();
    let stage_id = f.open_stage_id();

    let status = stage_status(&f.conn, &stage_id).unwrap();
    assert_eq!(status.stage.kind, StageKind::ChallengeSpec);
    assert_eq!(status.next, Some(StageKind::Slice));
    assert_eq!(status.undecided_proposals, count_undecided_proposals_in_stage(&f.conn, &stage_id).unwrap());
    assert_eq!(status.undecided_proposals, 1);
    let labels: Vec<String> = status.open_items.iter().map(OpenItem::label).collect();
    assert_eq!(
        labels,
        vec![
            "Question 1 of Round 1 is unanswered: Who is it for".to_string(),
            "Question 2 of Round 1 is unanswered: What ships first".to_string(),
            "A Proposal to change the Problem is undecided".to_string(),
        ]
    );
    assert!(matches!(&status.open_items[2], OpenItem::Proposal { proposal_id: id, .. } if *id == proposal_id));
    assert!(!status.closable());
}

#[test]
fn an_empty_problem_scope_or_exit_test_is_a_warning_that_never_blocks() {
    let f = shaping();
    let status = stage_status(&f.conn, &f.open_stage_id()).unwrap();
    assert!(status.open_items.is_empty());
    assert_eq!(
        status.warnings,
        vec![
            "The Problem is not written yet".to_string(),
            "The Scope is not written yet".to_string(),
            "The Exit test is not written yet".to_string(),
        ]
    );
    assert!(status.closable(), "warnings do not block the close");
}

#[test]
fn a_stage_with_an_unanswered_question_cannot_be_closed_and_the_refusal_lists_it() {
    let mut f = shaping();
    let round = f.post(&["Who is it for", "What ships first"]);
    assert!(round.held_request_id.is_some(), "the round_post call is held on the open Round");
    let stage_id = f.open_stage_id();
    let before = f.stage_rows();

    let err = format!("{:#}", close_stage(&mut f.conn, &f.human, &stage_id).unwrap_err());
    assert!(err.contains("Question 1 of Round 1 is unanswered: Who is it for"), "{err}");
    assert!(err.contains("Question 2 of Round 1 is unanswered: What ships first"), "{err}");
    assert_eq!(f.stage_rows(), before, "a refused close writes nothing");
    assert_eq!(live_shaping_session(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap(), Some(f.session_id.clone()));
}

#[test]
fn a_stage_with_an_undecided_proposal_cannot_be_closed_until_it_is_decided() {
    let mut f = shaping();
    let round = f.post(&["Who is it for"]);
    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    let first = f.propose_problem();
    let second = f.propose_problem();
    let stage_id = f.open_stage_id();

    let err = format!("{:#}", close_stage(&mut f.conn, &f.human, &stage_id).unwrap_err());
    assert_eq!(err.matches("A Proposal to change the Problem is undecided").count(), 2, "{err}");

    accept_proposal(&mut f.conn, &f.human, &first).unwrap();
    let err = format!("{:#}", close_stage(&mut f.conn, &f.human, &stage_id).unwrap_err());
    assert_eq!(err.matches("A Proposal to change the Problem is undecided").count(), 1, "{err}");

    reject_proposal(&mut f.conn, &f.human, &second, Some("too long")).unwrap();
    close_stage(&mut f.conn, &f.human, &stage_id).expect("closable once every Proposal is decided");
}

#[test]
fn no_one_but_the_developer_can_close_a_stage() {
    let mut f = shaping();
    let stage_id = f.open_stage_id();
    let agent = agent_actor_id(&f.conn).unwrap();
    let system = actor::system_actor(&f.conn).unwrap().id;
    let before = f.stage_rows();
    for (who, id) in [("agent", agent.as_str()), ("system", system.as_str()), ("not found", "no-such-actor"), ("not found", "")] {
        let err = format!("{:#}", close_stage(&mut f.conn, id, &stage_id).unwrap_err());
        assert!(err.contains(who), "{id:?} refused for the wrong reason: {err}");
        assert_eq!(f.stage_rows(), before);
    }
}

#[test]
fn closing_challenge_opens_slice_and_ends_the_live_session() {
    let mut f = shaping();
    let round = f.post(&["Who is it for"]);
    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    let stage_id = f.open_stage_id();

    let closed = close_stage(&mut f.conn, &f.human, &stage_id).unwrap();
    assert_eq!(closed.closed.kind, StageKind::ChallengeSpec);
    assert_eq!(closed.closed.state, "closed");
    let opened = closed.opened.as_ref().expect("Challenge is not the last Stage");
    assert_eq!(opened.kind, StageKind::Slice);
    assert_eq!(opened.rank, 2);
    assert_eq!(closed.ended_session.as_deref(), Some(f.session_id.as_str()));
    assert_eq!(
        f.stage_rows(),
        vec![
            ("challenge_spec".into(), "closed".into(), 1, Some(f.human.clone())),
            ("slice".into(), "open".into(), 2, None),
        ]
    );
    assert_eq!(live_shaping_session(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap(), None);

    let events: Vec<String> = {
        let mut stmt = f.conn.prepare("SELECT event_type FROM events WHERE stream_type = 'stage' ORDER BY sequence").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(events, vec!["stage.opened", "stage.closed", "stage.opened"]);
}

#[test]
fn the_next_sessions_packet_names_the_slice_stage() {
    let mut f = shaping();
    let stage_id = f.open_stage_id();
    close_stage(&mut f.conn, &f.human, &stage_id).unwrap();

    // Closing ends the old session; the next one starts from a fresh packet in the Slice Stage.
    let next = start_session_on(&mut f.conn, &f.human, &f.epic_id);
    assert_ne!(next, f.session_id);
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert!(packet.contains("This session works the second Stage, Slice into Stories"), "{packet}");
    assert!(!packet.contains("This session works the first Stage"), "{packet}");
    assert!(packet.contains("of the Slice into Stories Stage with `round_post`"), "{packet}");
}

#[test]
fn closing_slice_opens_criteria() {
    let mut f = shaping();
    let challenge = f.open_stage_id();
    close_stage(&mut f.conn, &f.human, &challenge).unwrap();
    let slice = f.open_stage_id();
    let closed = close_stage(&mut f.conn, &f.human, &slice).unwrap();
    let opened = closed.opened.expect("Slice is not the last Stage");
    assert_eq!((closed.closed.kind, opened.kind, opened.rank), (StageKind::Slice, StageKind::Criteria, 3));
    assert_eq!(closed.ended_session, None, "no session was live");
    let kinds: Vec<StageKind> = stages_for_epic(&f.conn, &f.epic_id).unwrap().into_iter().map(|s| s.kind).collect();
    assert_eq!(kinds, StageKind::EPIC.to_vec());

    let criteria = f.open_stage_id();
    let status = stage_status(&f.conn, &criteria).unwrap();
    assert_eq!(status.next, None, "Write the Acceptance criteria is the last Stage");
    assert!(status.closes_the_record(), "closing it makes the Stories Ready");
}

// ============================================================================================
// Issue #128: closing the Criteria Stage makes the Stories and the Epic Ready
// ============================================================================================

impl Fixture {
    /// Close Challenge the spec and Slice into Stories; the Criteria Stage's id.
    fn advance_to_criteria(&mut self) -> String {
        for _ in 0..2 {
            let id = self.open_stage_id();
            close_stage(&mut self.conn, &self.human, &id).unwrap();
        }
        self.open_stage_id()
    }

    fn state_of(&self, table: &str, id: &str) -> String {
        self.conn.query_row(&format!("SELECT state FROM {table} WHERE id = ?1"), [id], |r| r.get(0)).unwrap()
    }
}

#[test]
fn the_criteria_stage_stays_open_while_an_accepted_story_has_no_criterion() {
    let mut f = shaping();
    let criteria = f.advance_to_criteria();
    // No Story at all: nothing to make Ready.
    let status = stage_status(&f.conn, &criteria).unwrap();
    let labels: Vec<String> = status.open_items.iter().map(OpenItem::label).collect();
    assert_eq!(labels, vec!["The Epic has no Story to make Ready".to_string()]);
    assert!(!status.closable());

    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    let feed = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Feed row").unwrap();
    let gone = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Gone").unwrap();
    story::set_story_state(&mut f.conn, &f.human, &gone.id, StoryState::Dropped).unwrap();
    create_criterion(&mut f.conn, &f.human, &parser.id, "A malformed line is skipped").unwrap();

    let status = stage_status(&f.conn, &criteria).unwrap();
    assert_eq!(
        status.open_items,
        vec![OpenItem::StoryWithoutCriterion { story_id: feed.id.clone(), key: feed.key.clone(), title: "Feed row".into() }],
        "a dropped Story needs no criterion"
    );
    assert_eq!(status.open_items[0].label(), format!("{} “Feed row” has no Acceptance criterion", feed.key));
    assert!(!status.closable());
    let before = f.stage_rows();
    let err = format!("{:#}", close_stage(&mut f.conn, &f.human, &criteria).unwrap_err());
    assert!(err.contains(&format!("{} “Feed row” has no Acceptance criterion", feed.key)), "{err}");
    assert_eq!(f.stage_rows(), before, "a refused close writes nothing");
    assert_eq!(f.state_of("stories", &parser.id), "shaping");

    create_criterion(&mut f.conn, &f.human, &feed.id, "The row shows the live verb").unwrap();
    assert!(stage_status(&f.conn, &criteria).unwrap().closable());
}

#[test]
fn closing_criteria_moves_every_shaping_story_and_the_epic_to_ready_and_ends_shaping() {
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    let feed = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Feed row").unwrap();
    let gone = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Gone").unwrap();
    story::set_story_state(&mut f.conn, &f.human, &gone.id, StoryState::Dropped).unwrap();
    for s in [&parser, &feed] {
        create_criterion(&mut f.conn, &f.human, &s.id, "It ships").unwrap();
    }
    let criteria = f.advance_to_criteria();
    let session = start_session_on(&mut f.conn, &f.human, &f.epic_id);

    let closed = close_stage(&mut f.conn, &f.human, &criteria).unwrap();
    assert_eq!(closed.closed.kind, StageKind::Criteria);
    assert_eq!(closed.opened, None, "no Stage follows the last one");
    assert_eq!(closed.made_ready, vec![parser.id.clone(), feed.id.clone()], "in execution order");
    assert_eq!(closed.ended_session.as_deref(), Some(session.as_str()));
    assert_eq!((f.state_of("stories", &parser.id), f.state_of("stories", &feed.id)), ("ready".into(), "ready".into()));
    assert_eq!(f.state_of("stories", &gone.id), "dropped", "a dropped Story stays dropped");
    assert_eq!(f.state_of("epics", &f.epic_id), "ready");
    assert!(f.stage_rows().iter().all(|(_, state, _, _)| state == "closed"), "{:?}", f.stage_rows());
    assert_eq!(live_shaping_session(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap(), None);

    let events: Vec<(String, String)> = {
        let mut stmt = f
            .conn
            .prepare("SELECT event_type, actor_id FROM events WHERE event_type IN ('story.state_changed', 'epic.state_changed') ORDER BY sequence")
            .unwrap();
        stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
    };
    let human = f.human.clone();
    assert_eq!(
        events,
        vec![
            ("story.state_changed".to_string(), human.clone()), // Gone, dropped by hand
            ("story.state_changed".to_string(), human.clone()),
            ("story.state_changed".to_string(), human.clone()),
            ("epic.state_changed".to_string(), human),
        ]
    );
    // Nothing is left to shape: a Ready Epic starts no shaping session.
    assert!(start_shaping_session(
        &mut f.conn,
        &ShapingSubject::Epic(f.epic_id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &f.human,
    )
    .is_err());
}

#[test]
fn closing_criteria_is_all_or_nothing() {
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    create_criterion(&mut f.conn, &f.human, &parser.id, "It ships").unwrap();
    let criteria = f.advance_to_criteria();
    // The Epic cannot be made Ready (dropped under the close, by hand): the Stories' moves roll back too.
    f.conn.execute("UPDATE epics SET state = 'dropped' WHERE id = ?1", [&f.epic_id]).unwrap();
    let before = f.stage_rows();
    assert!(close_stage(&mut f.conn, &f.human, &criteria).is_err());
    assert_eq!(f.state_of("stories", &parser.id), "shaping");
    assert_eq!(f.stage_rows(), before);
}

#[test]
fn a_closed_stage_cannot_be_closed_again() {
    let mut f = shaping();
    let stage_id = f.open_stage_id();
    close_stage(&mut f.conn, &f.human, &stage_id).unwrap();
    let err = format!("{:#}", close_stage(&mut f.conn, &f.human, &stage_id).unwrap_err());
    assert!(err.contains("already closed"), "{err}");
    let err = format!("{:#}", close_stage(&mut f.conn, &f.human, "01ZZZZZZZZZZZZZZZZZZZZZZZZ").unwrap_err());
    assert!(err.contains("not found"), "{err}");
}

/// A held `round_post` call lives only on an open Round, and an open Round always has an unanswered
/// question, which blocks the close: a close can never leave a held call with no Round to answer it.
#[test]
fn no_held_round_call_outlives_a_closed_stage() {
    let mut f = shaping();
    let round = f.post(&["Who is it for"]);
    let stage_id = f.open_stage_id();
    assert!(close_stage(&mut f.conn, &f.human, &stage_id).is_err(), "the held Round blocks the close");
    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    close_stage(&mut f.conn, &f.human, &stage_id).unwrap();
    let held: i64 = f
        .conn
        .query_row("SELECT COUNT(*) FROM rounds WHERE stage_id = ?1 AND held_request_id IS NOT NULL", [&stage_id], |r| r.get(0))
        .unwrap();
    assert_eq!(held, 0);
}

/// Issue #129's ADR question is a question like any other: unanswered, it keeps the Stage open.
/// Accept all recommended leaves it for the developer, so the Stage closes only once it is answered.
#[test]
fn an_unanswered_adr_question_keeps_the_stage_open() {
    let mut f = shaping();
    let plain = NewQuestion {
        title: "Who is it for".into(),
        question: "Is it for one developer?".into(),
        grounding: "Read the spec".into(),
        recommended_answer: "Yes".into(),
        because: "One user in the MVP".into(),
        adr: None,
    };
    let adr = NewQuestion {
        title: "Record the shaping store".into(),
        question: "Record \"the board is the shaping store\" as ADR 0005?".into(),
        grounding: "Read docs/adr/0002".into(),
        recommended_answer: "Yes".into(),
        because: "It settles where every answer lives".into(),
        adr: Some(AdrDraft {
            path: "docs/adr/0005-board-is-the-shaping-store.md".into(),
            text: "# The board is the shaping store\n".into(),
            hard_to_reverse: "Every later Story reads its context from the board".into(),
            surprising: "A reader expects shaping notes in the repo".into(),
            losing_alternative: "A .planning/ folder of markdown".into(),
            relates_to: None,
        }),
    };
    let round = post_round(
        &mut f.conn,
        &f.session_id,
        Some("req-1"),
        &NewRound { note: "Settles the store.".into(), questions: vec![plain, adr] },
    )
    .unwrap();
    let stage_id = f.open_stage_id();
    let _ = accept_all_recommended(&mut f.conn, &f.human, &round.id);

    let status = stage_status(&f.conn, &stage_id).unwrap();
    let labels: Vec<String> = status.open_items.iter().map(OpenItem::label).collect();
    assert_eq!(labels, vec!["Question 2 of Round 1 is unanswered: Record the shaping store".to_string()]);
    let err = format!("{:#}", close_stage(&mut f.conn, &f.human, &stage_id).unwrap_err());
    assert!(err.contains("Record the shaping store"), "{err}");

    answer_round_question(&mut f.conn, &f.human, &round.questions[1].id, &RoundAnswer::Own("Yes".into())).unwrap();
    let status = stage_status(&f.conn, &stage_id).unwrap();
    assert!(status.open_items.is_empty(), "the ADR accepted on Yes is decided, never pending: {:?}", status.open_items);
    close_stage(&mut f.conn, &f.human, &stage_id).expect("closable once the ADR question is answered");
}
