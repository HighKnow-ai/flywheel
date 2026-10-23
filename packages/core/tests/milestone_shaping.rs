//! Issue #132: shaping a Milestone's exit test (docs/mvp-spec.md §3 "Shaping a Milestone and the
//! Roadmap").
//!
//! A Milestone has exactly one Stage, Exit test. A shaping session on the Milestone opens it, its
//! Rounds go in it, and the agent proposes new exit-test text with `propose_exit_test`, which is
//! answered at once and filed as an Amend Milestone Proposal carrying only the exit test (the Roadmap
//! change's own kind, issue #133). Accepting it rewrites the exit
//! test, records the change on the timeline and reopens nothing, even after work started. Closing the
//! Stage with nothing open moves the Milestone from Shaping to Ready, in the same transaction, and
//! ends the live shaping session. A Milestone's held Round is Waiting on you, like an Epic's.

mod common;

use core::domain::milestone::{get_milestone, milestone_state, set_milestone_state, MilestoneState};
use core::domain::proposal::{
    accept_proposal, accept_proposal_amended, file_proposal, get_proposal, proposals_on_milestone, reject_proposal,
    NewProposal, ProposalTarget, ProposalVerb,
};
use core::domain::round::{accept_all_recommended, post_round, rounds_for_milestone, NewQuestion, NewRound};
use core::domain::session::{agent_actor_id, live_shaping_session, start_shaping_session, ShapingSubject};
use core::domain::session_kind::SessionKind;
use core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome, SHAPING_TOOL_NAMES};
use core::domain::stage::{close_stage, open_stage, stage_status, StageKind};
use core::domain::story::{create_story, set_story_state, StoryState};
use core::domain::{epic, milestone};
use core::query::fleet::waiting_rounds;
use core::query::permissions::{blocked_count_for_project, waiting_epic_ids_for_project, waiting_milestone_ids_for_project};
use rusqlite::Connection;
use serde_json::json;

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    milestone_id: String,
    session_id: String,
}

/// A project with one Milestone in Shaping, its exit test a first draft, and a live shaping session on it.
fn shaping() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", Some("Shaping works")).unwrap();
    let session_id = start_shaping_session(
        &mut conn,
        &ShapingSubject::Milestone(m.id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &human,
    )
    .unwrap()
    .id;
    Fixture { conn, human, project_id: project.id, milestone_id: m.id, session_id }
}

impl Fixture {
    fn subject(&self) -> ShapingSubject {
        ShapingSubject::Milestone(self.milestone_id.clone())
    }

    fn open_stage_id(&self) -> String {
        open_stage(&self.conn, &self.subject()).unwrap().expect("an open Stage").id
    }

    fn post(&mut self, n: usize) -> core::domain::round::Round {
        let round = NewRound {
            note: "Settles what the exit test observes.".into(),
            questions: (1..=n)
                .map(|i| NewQuestion {
                    title: format!("Q{i}"),
                    question: format!("Question {i}?"),
                    grounding: "docs/mvp-spec.md".into(),
                    recommended_answer: "Yes".into(),
                    because: "It is observable".into(),
                    adr: None,
                })
                .collect(),
        };
        post_round(&mut self.conn, &self.session_id, Some("req-1"), &round).expect("the agent posts a Round")
    }

    /// The agent's `propose_exit_test` call, run as the core runs it.
    fn propose(&mut self, text: &str) -> serde_json::Value {
        let call = ShapingToolCall::parse("propose_exit_test", &json!({ "text": text, "why": "Round 1 settled it" }))
            .expect("a well-formed call parses");
        match apply_shaping_tool_call(&mut self.conn, &self.session_id, "req-p", &call).unwrap() {
            ShapingToolOutcome::Answered { result, .. } => result,
            other => panic!("propose_exit_test is answered at once, never held: {other:?}"),
        }
    }

    fn exit_test(&self) -> Option<String> {
        get_milestone(&self.conn, &self.milestone_id).unwrap().unwrap().exit_test
    }

    fn stored_state(&self) -> String {
        get_milestone(&self.conn, &self.milestone_id).unwrap().unwrap().state
    }

    fn events(&self, event_type: &str) -> Vec<serde_json::Value> {
        let mut stmt = self
            .conn
            .prepare("SELECT payload FROM events WHERE stream_type = 'milestone' AND stream_id = ?1 AND event_type = ?2 ORDER BY id")
            .unwrap();
        stmt.query_map([&self.milestone_id, event_type], |r| r.get::<_, String>(0))
            .unwrap()
            .map(|p| serde_json::from_str(&p.unwrap()).unwrap())
            .collect()
    }
}

#[test]
fn a_milestone_has_exactly_one_stage_exit_test() {
    let f = shaping();
    let stage = open_stage(&f.conn, &f.subject()).unwrap().expect("starting shaping opens the Stage");
    assert_eq!(stage.kind, StageKind::ExitTest);
    assert_eq!(stage.milestone_id.as_deref(), Some(f.milestone_id.as_str()));
    let count: i64 = f.conn.query_row("SELECT COUNT(*) FROM stages WHERE milestone_id = ?1", [&f.milestone_id], |r| r.get(0)).unwrap();
    assert_eq!(count, 1);

    let status = stage_status(&f.conn, &stage.id).unwrap();
    assert_eq!(status.next, None, "Exit test is the Milestone's only Stage");
    assert!(status.open_items.is_empty());
    assert!(status.closable(), "nothing is open, so the developer may close it");
}

#[test]
fn closing_exit_test_with_nothing_open_moves_the_milestone_to_ready_and_ends_the_session() {
    let mut f = shaping();
    let round = f.post(1);
    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    let stage_id = f.open_stage_id();

    let closed = close_stage(&mut f.conn, &f.human, &stage_id).expect("the developer closes Exit test");
    assert_eq!(closed.closed.state, "closed");
    assert_eq!(closed.opened, None, "no Stage follows Exit test");
    assert_eq!(closed.ended_session.as_deref(), Some(f.session_id.as_str()));

    assert_eq!(f.stored_state(), "ready");
    assert_eq!(milestone_state(&f.conn, &f.milestone_id).unwrap(), MilestoneState::Ready);
    assert!(open_stage(&f.conn, &f.subject()).unwrap().is_none());
    assert_eq!(live_shaping_session(&f.conn, &f.subject()).unwrap(), None);
    let moved = f.events("milestone.state_changed");
    assert_eq!(moved.len(), 1);
    assert_eq!((moved[0]["before"].as_str(), moved[0]["after"].as_str()), (Some("shaping"), Some("ready")));

    // Ready, the Milestone is shaped no more: a second close and a new session are both refused.
    assert!(close_stage(&mut f.conn, &f.human, &stage_id).is_err());
    let subject = f.subject();
    let again = start_shaping_session(&mut f.conn, &subject, "dontAsk", &f.human).unwrap_err();
    assert!(format!("{again:#}").contains("only a record in Shaping is shaped"), "{again:#}");
}

#[test]
fn exit_test_stays_open_while_a_question_or_a_proposal_is_open() {
    let mut f = shaping();
    let round = f.post(2);
    let stage_id = f.open_stage_id();
    let err = close_stage(&mut f.conn, &f.human, &stage_id).unwrap_err();
    assert!(format!("{err:#}").contains("Question 2 of Round 1 is unanswered: Q2"), "{err:#}");
    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();

    let proposal_id = f.propose("A one-line idea becomes Ready Stories.")["proposal_id"].as_str().unwrap().to_string();
    let status = stage_status(&f.conn, &stage_id).unwrap();
    assert!(!status.closable());
    assert_eq!(status.open_items[0].label(), "A Proposal to change the exit test is undecided");
    let err = close_stage(&mut f.conn, &f.human, &stage_id).unwrap_err();
    assert!(format!("{err:#}").contains("change the exit test"), "{err:#}");
    assert_eq!(f.stored_state(), "shaping", "a refused close moves nothing");

    reject_proposal(&mut f.conn, &f.human, &proposal_id, Some("Too vague")).unwrap();
    close_stage(&mut f.conn, &f.human, &stage_id).expect("closable once every Proposal is decided");
    assert_eq!(f.stored_state(), "ready");
}

#[test]
fn an_agent_cannot_close_exit_test() {
    let mut f = shaping();
    let agent = agent_actor_id(&f.conn).unwrap();
    let stage_id = f.open_stage_id();
    assert!(close_stage(&mut f.conn, &agent, &stage_id).is_err());
    assert_eq!(f.stored_state(), "shaping");
    assert!(open_stage(&f.conn, &f.subject()).unwrap().is_some());
}

#[test]
fn propose_exit_test_is_a_shaping_tool_filed_in_the_stage_and_answered_at_once() {
    assert!(SHAPING_TOOL_NAMES.contains(&"propose_exit_test"), "{SHAPING_TOOL_NAMES:?}");
    let mut f = shaping();
    let round = f.post(1);
    let answer = f.propose("  A one-line idea becomes Ready Stories.  ");
    assert_eq!(answer["state"], "pending");
    let id = answer["proposal_id"].as_str().unwrap();

    let p = get_proposal(&f.conn, id).unwrap().unwrap();
    assert_eq!((p.verb.as_str(), p.target_type.as_str()), ("amend", "milestone"));
    assert_eq!(p.target_id.as_deref(), Some(f.milestone_id.as_str()));
    assert_eq!(p.epic_id, None);
    assert_eq!(p.payload, json!({ "title": null, "exit_test": "A one-line idea becomes Ready Stories." }));
    assert_eq!(p.rationale.as_deref(), Some("Round 1 settled it"));
    assert_eq!(p.stage_id.as_deref(), Some(f.open_stage_id().as_str()));
    assert_eq!(p.round_id.as_deref(), Some(round.id.as_str()));
    assert_eq!(f.exit_test().as_deref(), Some("Shaping works"), "nothing changes until the developer decides");
    assert_eq!(proposals_on_milestone(&f.conn, &f.milestone_id).unwrap().len(), 1);
}

#[test]
fn propose_exit_test_is_refused_without_text_or_why_and_from_an_epic_session() {
    for args in [json!({ "text": "", "why": "w" }), json!({ "text": "t" }), json!({ "why": "w" }), json!({ "text": "t", "why": " " })] {
        assert!(ShapingToolCall::parse("propose_exit_test", &args).is_err(), "{args}");
    }
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "M", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "E").unwrap();
    let session = start_shaping_session(&mut conn, &ShapingSubject::Epic(e.id), "dontAsk", &human).unwrap().id;
    let call = ShapingToolCall::parse("propose_exit_test", &json!({ "text": "t", "why": "w" })).unwrap();
    let err = apply_shaping_tool_call(&mut conn, &session, "req", &call).unwrap_err();
    assert!(format!("{err:#}").contains("propose_spec_change"), "{err:#}");
    let filed: i64 = conn.query_row("SELECT COUNT(*) FROM proposals", [], |r| r.get(0)).unwrap();
    assert_eq!(filed, 0);
}

#[test]
fn an_accepted_exit_test_proposal_rewrites_it_and_records_it_on_the_timeline() {
    let mut f = shaping();
    let id = f.propose("A one-line idea becomes Ready Stories.")["proposal_id"].as_str().unwrap().to_string();
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();

    assert_eq!(f.exit_test().as_deref(), Some("A one-line idea becomes Ready Stories."));
    assert_eq!(f.stored_state(), "shaping", "accepting reopens and advances nothing");
    let changed = f.events("milestone.updated");
    assert_eq!(changed.len(), 1);
    assert_eq!(changed[0]["before"], json!({ "title": "Shaping", "exit_test": "Shaping works" }));
    assert_eq!(changed[0]["after"], json!({ "title": "Shaping", "exit_test": "A one-line idea becomes Ready Stories." }));
    assert_eq!(changed[0]["proposal_id"], json!(id));
}

#[test]
fn amend_rewrites_the_exit_test_with_the_developers_text() {
    let mut f = shaping();
    let id = f.propose("A one-line idea becomes an Epic.")["proposal_id"].as_str().unwrap().to_string();
    let err = accept_proposal_amended(&mut f.conn, &f.human, &id, &json!({ "title": null, "exit_test": "  " })).unwrap_err();
    assert!(!format!("{err:#}").is_empty(), "an empty exit test is refused");
    accept_proposal_amended(&mut f.conn, &f.human, &id, &json!({ "title": null, "exit_test": "An idea becomes an Epic with Ready Stories." }))
        .unwrap();
    assert_eq!(f.exit_test().as_deref(), Some("An idea becomes an Epic with Ready Stories."));
}

/// docs/mvp-spec.md §3: "Amending an exit test after work started is an ordinary Proposal. The text
/// changes, the change goes on the timeline and nothing is reopened."
#[test]
fn an_exit_test_amended_after_work_started_reopens_nothing() {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", Some("Shaping works")).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
    epic::set_epic_state(&mut conn, &human, &e.id, epic::EpicState::Ready).unwrap();
    let story = create_story(&mut conn, &human, &e.id, "Shape a Milestone").unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Ready).unwrap();
    set_story_state(&mut conn, &human, &story.id, StoryState::Running).unwrap();
    set_milestone_state(&mut conn, &human, &m.id, MilestoneState::Ready).unwrap();
    assert_eq!(milestone_state(&conn, &m.id).unwrap(), MilestoneState::InProgress);

    let agent = agent_actor_id(&conn).unwrap();
    let filed = file_proposal(
        &mut conn,
        &agent,
        &NewProposal {
            project_id: &project.id,
            session_id: None,
            epic_id: None,
            verb: ProposalVerb::Amend,
            target: ProposalTarget::Milestone,
            target_id: Some(&m.id),
            payload: json!({ "title": null, "exit_test": "Cyril shapes a Milestone's exit test in the dock." }),
            rationale: Some("The Epic showed what is observable"),
        },
    )
    .unwrap();
    let snapshot = |conn: &Connection| -> (String, String, String, i64) {
        conn.query_row(
            "SELECT m.state, e.state, s.state, (SELECT COUNT(*) FROM stages) FROM milestones m
             JOIN epics e ON e.milestone_id = m.id JOIN stories s ON s.epic_id = e.id WHERE m.id = ?1",
            [&m.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .unwrap()
    };
    let before = snapshot(&conn);
    accept_proposal(&mut conn, &human, &filed.id).unwrap();

    assert_eq!(snapshot(&conn), before, "no state moves and no Stage opens");
    assert_eq!(milestone_state(&conn, &m.id).unwrap(), MilestoneState::InProgress);
    assert_eq!(
        get_milestone(&conn, &m.id).unwrap().unwrap().exit_test.as_deref(),
        Some("Cyril shapes a Milestone's exit test in the dock.")
    );
    let on_timeline: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM events WHERE stream_type = 'milestone' AND stream_id = ?1 AND event_type = 'milestone.updated'",
            [&m.id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(on_timeline, 1);
}

#[test]
fn a_done_milestones_exit_test_is_frozen() {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Done", Some("It shipped")).unwrap();
    let agent = agent_actor_id(&conn).unwrap();
    let filed = file_proposal(
        &mut conn,
        &agent,
        &NewProposal {
            project_id: &project.id,
            session_id: None,
            epic_id: None,
            verb: ProposalVerb::Amend,
            target: ProposalTarget::Milestone,
            target_id: Some(&m.id),
            payload: json!({ "title": null, "exit_test": "Something else" }),
            rationale: None,
        },
    )
    .unwrap();
    set_milestone_state(&mut conn, &human, &m.id, MilestoneState::Done).unwrap();
    let err = accept_proposal(&mut conn, &human, &filed.id).unwrap_err();
    assert!(format!("{err:#}").contains("frozen"), "{err:#}");
    assert_eq!(get_proposal(&conn, &filed.id).unwrap().unwrap().state, "pending", "the refusal rolls the decision back");
    assert_eq!(get_milestone(&conn, &m.id).unwrap().unwrap().exit_test.as_deref(), Some("It shipped"));
}

#[test]
fn a_milestone_round_a_live_session_is_held_on_is_waiting_on_you() {
    let mut f = shaping();
    assert!(waiting_milestone_ids_for_project(&f.conn, &f.project_id).unwrap().is_empty());
    let round = f.post(1);
    assert_eq!(rounds_for_milestone(&f.conn, &f.milestone_id).unwrap().len(), 1);

    assert_eq!(waiting_milestone_ids_for_project(&f.conn, &f.project_id).unwrap(), vec![f.milestone_id.clone()]);
    assert!(waiting_epic_ids_for_project(&f.conn, &f.project_id).unwrap().is_empty());
    assert_eq!(blocked_count_for_project(&f.conn, &f.project_id).unwrap(), 1, "the project's Needs-you count");
    let lamps = waiting_rounds(&f.conn, 50).unwrap();
    assert_eq!(lamps.len(), 1, "{lamps:?}");
    assert_eq!(lamps[0].round_id, round.id);
    assert_eq!((lamps[0].subject.as_str(), lamps[0].stage_kind.as_deref()), ("milestone", Some("exit_test")));
    assert_eq!(lamps[0].milestone_id.as_deref(), Some(f.milestone_id.as_str()));
    assert_eq!(lamps[0].milestone_title.as_deref(), Some("Shaping"));
    assert_eq!(lamps[0].epic_id, None);

    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    assert!(waiting_milestone_ids_for_project(&f.conn, &f.project_id).unwrap().is_empty());
    assert_eq!(blocked_count_for_project(&f.conn, &f.project_id).unwrap(), 0);
    assert!(waiting_rounds(&f.conn, 50).unwrap().is_empty());
}
