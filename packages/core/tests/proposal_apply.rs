//! Issue #125: a shaping session proposes spec changes as Proposals, and the developer decides each
//! one inline, on the Epic field it would land on.
//!
//! - `propose_spec_change` files a Proposal on the Epic being shaped and is answered at once: a
//!   Proposal never holds the agent. It records the Stage and the Round it was filed in.
//! - Accepting rewrites the Epic field in the same transaction as the decision; Amend applies the
//!   developer's edited text and the event keeps what the agent proposed; Reject keeps the reason,
//!   which the next shaping packet lists.
//! - A shaping session may hold any number of open Proposals; a Story session is still capped.
//! - [`count_undecided_proposals_in_stage`] is what closing a Stage (#126) reads.

mod common;

use core::domain::epic::{self, get_epic};
use core::domain::milestone;
use core::domain::proposal::{
    accept_proposal, accept_proposal_amended, count_undecided_proposals_in_stage, file_proposal, get_proposal,
    proposals_on_epic, reject_proposal, NewProposal, ProposalTarget, ProposalVerb, OPEN_PROPOSALS_PER_SESSION,
};
use core::domain::round::{accept_all_recommended, post_round, NewQuestion, NewRound};
use core::domain::session::{agent_actor_id, start_shaping_session, ShapingSubject};
use core::domain::session_kind::SessionKind;
use core::domain::shaping_tool::{apply_shaping_tool_call, ShapingToolCall, ShapingToolOutcome, SHAPING_TOOL_NAMES};
use core::domain::stage::open_stage;
use core::shaping_packet::build_epic_shaping_packet;
use rusqlite::Connection;
use serde_json::{json, Value};

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    epic_id: String,
    session_id: String,
    _checkout: tempfile::TempDir,
}

/// A project whose checkout is a plain directory, one Epic in Shaping with a Scope already written,
/// and a live shaping session on it.
fn shaping() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let checkout = tempfile::tempdir().unwrap();
    conn.execute("UPDATE projects SET repo_path = ?1 WHERE id = ?2", rusqlite::params![checkout.path().to_string_lossy(), project.id])
        .unwrap();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Shaping", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Epic shaping").unwrap();
    epic::update_epic(
        &mut conn,
        &human,
        &e.id,
        "Epic shaping",
        &epic::EpicSpec { problem: Some("Shaping is worse than a terminal.".into()), scope: Some("The board.".into()), ..Default::default() },
    )
    .unwrap();
    let session_id = start_shaping_session(
        &mut conn,
        &ShapingSubject::Epic(e.id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &human,
    )
    .unwrap()
    .id;
    Fixture { conn, human, project_id: project.id, epic_id: e.id, session_id, _checkout: checkout }
}

/// The agent's `propose_spec_change` call, run as the core runs it. Returns the answer it got.
fn propose(f: &mut Fixture, field: &str, text: &str) -> Value {
    let args = json!({ "field": field, "text": text, "why": format!("The {field} reads too wide") });
    let call = ShapingToolCall::parse("propose_spec_change", &args).expect("a well-formed call parses");
    match apply_shaping_tool_call(&mut f.conn, &f.session_id, "req-p", &call).expect("the call files a Proposal") {
        ShapingToolOutcome::Answered { result, project_id } => {
            assert_eq!(project_id, f.project_id);
            result
        }
        other => panic!("propose_spec_change is answered at once, never held: {other:?}"),
    }
}

fn proposal_id(answer: &Value) -> String {
    answer["proposal_id"].as_str().expect("the answer names the Proposal").to_string()
}

fn events(conn: &Connection, kind: &str) -> Vec<Value> {
    let mut stmt = conn.prepare("SELECT payload FROM events WHERE event_type = ?1 ORDER BY rowid").unwrap();
    stmt.query_map([kind], |r| r.get::<_, String>(0)).unwrap().map(|p| serde_json::from_str(&p.unwrap()).unwrap()).collect()
}

#[test]
fn propose_spec_change_is_a_shaping_tool_answered_at_once() {
    assert!(SHAPING_TOOL_NAMES.contains(&"propose_spec_change"), "{SHAPING_TOOL_NAMES:?}");
    let mut f = shaping();
    let answer = propose(&mut f, "scope", "The board, and nothing else.");
    let p = get_proposal(&f.conn, &proposal_id(&answer)).unwrap().unwrap();
    assert_eq!((p.verb.as_str(), p.target_type.as_str(), p.state.as_str()), ("amend", "epic", "pending"));
    assert_eq!(p.target_id.as_deref(), Some(f.epic_id.as_str()));
    assert_eq!(p.epic_id.as_deref(), Some(f.epic_id.as_str()));
    assert_eq!(p.session_id.as_deref(), Some(f.session_id.as_str()));
    assert_eq!(p.payload, json!({ "field": "scope", "text": "The board, and nothing else." }));
    assert_eq!(p.rationale.as_deref(), Some("The scope reads too wide"));
    let scope = get_epic(&f.conn, &f.epic_id).unwrap().unwrap().spec.scope;
    assert_eq!(scope.as_deref(), Some("The board."), "filing changes nothing on the Epic");
}

#[test]
fn the_shaping_packet_tells_the_agent_to_propose_spec_changes_without_waiting() {
    let f = shaping();
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert!(packet.contains("`propose_spec_change`"), "{packet}");
    assert!(packet.contains("keep shaping without waiting"), "{packet}");
}

#[test]
fn a_malformed_spec_change_is_refused_before_anything_is_written() {
    for args in [
        json!({ "field": "title", "text": "x", "why": "y" }),
        json!({ "field": "scope", "text": "   ", "why": "y" }),
        json!({ "field": "scope", "text": "x" }),
        json!({ "field": "scope", "text": "x".repeat(20_001), "why": "y" }),
    ] {
        assert!(ShapingToolCall::parse("propose_spec_change", &args).is_err(), "{args}");
    }
}

#[test]
fn the_proposal_records_the_stage_and_the_round_it_was_filed_in() {
    let mut f = shaping();
    let stage = open_stage(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap().unwrap();
    let filed = proposal_id(&propose(&mut f, "problem", "Shaping loses work."));
    let before = get_proposal(&f.conn, &filed).unwrap().unwrap();
    assert_eq!(before.stage_id.as_deref(), Some(stage.id.as_str()));
    assert_eq!(before.round_id, None, "no Round posted yet");

    let q = NewQuestion {
        title: "Audience".into(),
        question: "One developer?".into(),
        grounding: "GLOSSARY.md".into(),
        recommended_answer: "Yes".into(),
        because: "One user".into(),
    };
    let round = post_round(&mut f.conn, &f.session_id, Some("req-1"), &NewRound { note: "Settles it.".into(), questions: vec![q] }).unwrap();
    accept_all_recommended(&mut f.conn, &f.human, &round.id).unwrap();
    let filed = proposal_id(&propose(&mut f, "problem", "Shaping loses answers."));
    let after = get_proposal(&f.conn, &filed).unwrap().unwrap();
    assert_eq!(after.stage_id.as_deref(), Some(stage.id.as_str()));
    assert_eq!(after.round_id.as_deref(), Some(round.id.as_str()), "the Round the Proposal follows");
}

#[test]
fn accepting_a_spec_change_rewrites_the_epic_field_with_the_decision() {
    let mut f = shaping();
    let id = proposal_id(&propose(&mut f, "out_of_scope", "Milestone shaping."));
    accept_proposal(&mut f.conn, &f.human, &id).unwrap();

    let epic = get_epic(&f.conn, &f.epic_id).unwrap().unwrap();
    assert_eq!(epic.spec.out_of_scope.as_deref(), Some("Milestone shaping."));
    assert_eq!(epic.spec.scope.as_deref(), Some("The board."), "the other fields are untouched");
    assert_eq!(epic.spec.problem.as_deref(), Some("Shaping is worse than a terminal."));
    assert_eq!(get_proposal(&f.conn, &id).unwrap().unwrap().state, "accepted");
    let updated = events(&f.conn, "epic.updated");
    assert_eq!(updated.len(), 2, "the fixture's edit, then the applied Proposal");
    assert_eq!(updated[1]["proposal_id"], json!(id));
    assert_eq!(updated[1]["field"], "out_of_scope");
}

#[test]
fn a_failed_application_leaves_the_proposal_undecided() {
    let mut f = shaping();
    let id = proposal_id(&propose(&mut f, "scope", "Narrower."));
    let err = accept_proposal_amended(&mut f.conn, &f.human, &id, &json!({ "field": "scope", "text": "  " })).unwrap_err();
    assert!(format!("{err:#}").contains("empty"), "{err:#}");
    assert_eq!(get_proposal(&f.conn, &id).unwrap().unwrap().state, "pending", "decision and effect are one transaction");
    assert!(events(&f.conn, "proposal.accepted").is_empty());

    // The Epic gone from under it: the decision rolls back with the failed effect.
    f.conn.execute("UPDATE proposals SET target_id = 'gone' WHERE id = ?1", [&id]).unwrap();
    assert!(accept_proposal(&mut f.conn, &f.human, &id).is_err());
    assert_eq!(get_proposal(&f.conn, &id).unwrap().unwrap().state, "pending");
}

#[test]
fn amend_applies_the_developers_edit_and_the_event_keeps_the_original() {
    let mut f = shaping();
    let id = proposal_id(&propose(&mut f, "exit_test", "A one-line idea becomes an Epic."));
    accept_proposal_amended(
        &mut f.conn,
        &f.human,
        &id,
        &json!({ "field": "exit_test", "text": "A one-line idea becomes an Epic with Ready Stories." }),
    )
    .unwrap();

    let epic = get_epic(&f.conn, &f.epic_id).unwrap().unwrap();
    assert_eq!(epic.spec.exit_test.as_deref(), Some("A one-line idea becomes an Epic with Ready Stories."));
    let p = get_proposal(&f.conn, &id).unwrap().unwrap();
    assert_eq!(p.state, "accepted");
    assert_eq!(p.payload["text"], "A one-line idea becomes an Epic with Ready Stories.", "the row holds what was applied");
    let accepted = events(&f.conn, "proposal.accepted");
    assert_eq!(accepted.len(), 1);
    assert_eq!(accepted[0]["amended"], true);
    assert_eq!(accepted[0]["original"], json!({ "field": "exit_test", "text": "A one-line idea becomes an Epic." }));
    assert_eq!(accepted[0]["applied"]["text"], "A one-line idea becomes an Epic with Ready Stories.");
}

#[test]
fn amend_cannot_move_the_change_to_another_field() {
    let mut f = shaping();
    let id = proposal_id(&propose(&mut f, "scope", "Narrower."));
    let err = accept_proposal_amended(&mut f.conn, &f.human, &id, &json!({ "field": "problem", "text": "x" })).unwrap_err();
    assert!(format!("{err:#}").contains("Scope"), "{err:#}");
    assert_eq!(get_proposal(&f.conn, &id).unwrap().unwrap().state, "pending");
}

#[test]
fn reject_keeps_the_reason_and_the_next_shaping_packet_lists_it() {
    let mut f = shaping();
    let id = proposal_id(&propose(&mut f, "scope", "Every board surface."));
    reject_proposal(&mut f.conn, &f.human, &id, Some("Too wide for one Epic")).unwrap();

    let p = get_proposal(&f.conn, &id).unwrap().unwrap();
    assert_eq!((p.state.as_str(), p.rejection_reason.as_deref()), ("rejected", Some("Too wide for one Epic")));
    assert_eq!(get_epic(&f.conn, &f.epic_id).unwrap().unwrap().spec.scope.as_deref(), Some("The board."));
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    assert!(packet.contains("Rejected Proposals on this Epic"), "{packet}");
    assert!(packet.contains("Scope: \"Every board surface.\"; rejected: Too wide for one Epic"), "{packet}");
}

#[test]
fn a_shaping_session_holds_more_than_three_open_proposals() {
    let mut f = shaping();
    for n in 0..(OPEN_PROPOSALS_PER_SESSION + 2) {
        propose(&mut f, "scope", &format!("Scope {n}"));
    }
    let open = proposals_on_epic(&f.conn, &f.epic_id).unwrap().into_iter().filter(|p| p.state == "pending").count();
    assert_eq!(open as i64, OPEN_PROPOSALS_PER_SESSION + 2);
}

#[test]
fn a_story_session_is_still_capped_at_three() {
    let (mut conn, human, project) = common::seeded_project();
    let s = common::new_story(&mut conn, &project.id, &human, "S");
    let agent = agent_actor_id(&conn).unwrap();
    let session = core::ids::new_id();
    conn.execute(
        "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at)
         VALUES (?1, ?2, ?3, ?4, 'running', 'default', '/tmp/x.jsonl', 'now')",
        rusqlite::params![session, s.id, project.id, agent],
    )
    .unwrap();
    let proposal = |n: i64| NewProposal {
        project_id: &project.id,
        session_id: Some(&session),
        epic_id: Some(&s.epic_id),
        verb: ProposalVerb::Create,
        target: ProposalTarget::Story,
        target_id: None,
        payload: json!({ "title": format!("Follow-up {n}") }),
        rationale: Some("found while working"),
    };
    for n in 0..OPEN_PROPOSALS_PER_SESSION {
        let p = file_proposal(&mut conn, &agent, &proposal(n)).unwrap();
        assert_eq!((p.stage_id, p.round_id), (None, None), "a Story session's Proposal hangs off no Stage");
    }
    let err = file_proposal(&mut conn, &agent, &proposal(9)).unwrap_err();
    assert!(format!("{err:#}").contains("merge or withdraw"), "{err:#}");
}

#[test]
fn the_undecided_proposals_of_a_stage_are_counted_for_closing_it() {
    let mut f = shaping();
    let stage = open_stage(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap().unwrap();
    assert_eq!(count_undecided_proposals_in_stage(&f.conn, &stage.id).unwrap(), 0);
    let a = proposal_id(&propose(&mut f, "scope", "A"));
    let b = proposal_id(&propose(&mut f, "problem", "B"));
    propose(&mut f, "exit_test", "C");
    assert_eq!(count_undecided_proposals_in_stage(&f.conn, &stage.id).unwrap(), 3);
    accept_proposal(&mut f.conn, &f.human, &a).unwrap();
    reject_proposal(&mut f.conn, &f.human, &b, None).unwrap();
    assert_eq!(count_undecided_proposals_in_stage(&f.conn, &stage.id).unwrap(), 1, "only the pending one is undecided");
    assert_eq!(count_undecided_proposals_in_stage(&f.conn, "no-such-stage").unwrap(), 0);
}

#[test]
fn a_spec_change_from_a_session_that_ended_is_refused() {
    let mut f = shaping();
    core::domain::session::interrupt_session(&mut f.conn, &f.session_id, &f.human).unwrap();
    let call = ShapingToolCall::parse("propose_spec_change", &json!({ "field": "scope", "text": "x", "why": "y" })).unwrap();
    let err = apply_shaping_tool_call(&mut f.conn, &f.session_id, "req-x", &call).unwrap_err();
    assert!(format!("{err:#}").contains("ended"), "{err:#}");
    assert!(proposals_on_epic(&f.conn, &f.epic_id).unwrap().is_empty());
}
