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
use core::domain::acceptance_criterion::criteria_for_story;
use core::domain::check::check_for_criterion;
use core::domain::stage::{close_stage, open_stage, stage_status, StageKind};
use core::domain::story::{self, stories_in_epic, Story};
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
        adr: None,
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

// ============================================================================================
// Issue #127: slicing the Epic into Stories
// ============================================================================================

/// Run one Story tool call as the core runs it; the answer it got, or the refusal.
fn story_tool(f: &mut Fixture, tool: &str, args: Value) -> anyhow::Result<Value> {
    let call = ShapingToolCall::parse(tool, &args)?;
    match apply_shaping_tool_call(&mut f.conn, &f.session_id, "req-s", &call)? {
        ShapingToolOutcome::Answered { result, .. } => Ok(result),
        other => panic!("{tool} is answered at once, never held: {other:?}"),
    }
}

/// `propose_story` with a title and a description, plus `extra` arguments; the Proposal's id.
fn propose_story(f: &mut Fixture, title: &str, extra: Value) -> String {
    let mut args = json!({ "title": title, "description": format!("{title}: ships and is tested on its own.") });
    args.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
    proposal_id(&story_tool(f, "propose_story", args).expect("propose_story files a Proposal"))
}

/// The Epic's Stories in execution order, by title.
fn order(f: &Fixture) -> Vec<String> {
    stories_in_epic(&f.conn, &f.epic_id).unwrap().into_iter().map(|s| s.title).collect()
}

fn story_titled(f: &Fixture, title: &str) -> Story {
    stories_in_epic(&f.conn, &f.epic_id).unwrap().into_iter().find(|s| s.title == title).expect("the Story exists")
}

#[test]
fn propose_story_and_propose_story_order_are_shaping_tools() {
    assert!(SHAPING_TOOL_NAMES.contains(&"propose_story"), "{SHAPING_TOOL_NAMES:?}");
    assert!(SHAPING_TOOL_NAMES.contains(&"propose_story_order"), "{SHAPING_TOOL_NAMES:?}");
    let mut f = shaping();
    let id = propose_story(&mut f, "Feed row", json!({}));
    let p = get_proposal(&f.conn, &id).unwrap().unwrap();
    assert_eq!((p.verb.as_str(), p.target_type.as_str(), p.state.as_str()), ("create", "story", "pending"));
    assert_eq!(p.epic_id.as_deref(), Some(f.epic_id.as_str()));
    assert_eq!(p.target_id, None, "no Story exists until it is accepted");
    assert!(order(&f).is_empty(), "filing creates nothing");
}

#[test]
fn accepting_a_new_story_creates_a_shaping_story_in_the_epic_at_the_proposed_rank_with_its_marker() {
    let mut f = shaping();
    let first = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    let last = propose_story(&mut f, "Polish", json!({}));
    let before = propose_story(&mut f, "Schema", json!({ "before": first.key }));
    let after = propose_story(
        &mut f,
        "Feed row",
        json!({ "after": first.key, "runs_after": first.key, "runs_after_reason": "shares `FeedRow.tsx`" }),
    );
    for id in [&after, &last, &before] {
        accept_proposal(&mut f.conn, &f.human, id).unwrap();
    }
    assert_eq!(order(&f), ["Schema", "Parser", "Feed row", "Polish"], "each Story lands where it was proposed");

    let feed = story_titled(&f, "Feed row");
    assert_eq!(feed.state, "shaping");
    assert_eq!(feed.epic_id, f.epic_id);
    assert_eq!(feed.description.as_deref(), Some("Feed row: ships and is tested on its own."));
    assert_eq!(feed.runs_after_story_id.as_deref(), Some(first.id.as_str()));
    assert_eq!(feed.runs_after_reason.as_deref(), Some("shares `FeedRow.tsx`"));
    assert_eq!(story_titled(&f, "Polish").runs_after_story_id, None);
    let p = get_proposal(&f.conn, &after).unwrap().unwrap();
    assert_eq!((p.state.as_str(), p.target_id.as_deref()), ("accepted", Some(feed.id.as_str())), "the Proposal names its Story");
    assert_eq!(events(&f.conn, "story.runs_after_set").len(), 1);
}

#[test]
fn a_new_story_can_run_after_a_new_story_not_accepted_yet_in_either_order() {
    // The later one accepted first: its marker waits for the earlier one.
    let mut f = shaping();
    let schema = propose_story(&mut f, "Schema", json!({}));
    let feed = propose_story(&mut f, "Feed row", json!({ "after": schema, "runs_after": schema, "runs_after_reason": "reads its table" }));
    accept_proposal(&mut f.conn, &f.human, &feed).unwrap();
    assert_eq!(story_titled(&f, "Feed row").runs_after_story_id, None, "nothing to point at yet");
    accept_proposal(&mut f.conn, &f.human, &schema).unwrap();
    let feed_story = story_titled(&f, "Feed row");
    assert_eq!(feed_story.runs_after_story_id.as_deref(), Some(story_titled(&f, "Schema").id.as_str()));
    assert_eq!(feed_story.runs_after_reason.as_deref(), Some("reads its table"));
    assert_eq!(order(&f), ["Schema", "Feed row"]);

    // The earlier one accepted first: the marker is set at once.
    let mut g = shaping();
    let schema = propose_story(&mut g, "Schema", json!({}));
    let feed = propose_story(&mut g, "Feed row", json!({ "runs_after": schema, "runs_after_reason": "reads its table" }));
    accept_proposal(&mut g.conn, &g.human, &schema).unwrap();
    accept_proposal(&mut g.conn, &g.human, &feed).unwrap();
    assert_eq!(story_titled(&g, "Feed row").runs_after_story_id.as_deref(), Some(story_titled(&g, "Schema").id.as_str()));

    // Rejected, the earlier one leaves the later one with no marker: the constraint never blocks.
    let mut h = shaping();
    let schema = propose_story(&mut h, "Schema", json!({}));
    let feed = propose_story(&mut h, "Feed row", json!({ "runs_after": schema, "runs_after_reason": "reads its table" }));
    reject_proposal(&mut h.conn, &h.human, &schema, Some("Fold it into the feed")).unwrap();
    accept_proposal(&mut h.conn, &h.human, &feed).unwrap();
    assert_eq!(story_titled(&h, "Feed row").runs_after_story_id, None);
}

#[test]
fn no_story_is_created_outside_the_epic() {
    let mut f = shaping();
    let agent = agent_actor_id(&f.conn).unwrap();
    // A New Story filed on no Epic is never applied.
    let orphan = file_proposal(
        &mut f.conn,
        &agent,
        &NewProposal {
            project_id: &f.project_id,
            session_id: None,
            epic_id: None,
            verb: ProposalVerb::Create,
            target: ProposalTarget::Story,
            target_id: None,
            payload: json!({ "title": "Nowhere" }),
            rationale: None,
        },
    )
    .unwrap();
    let err = accept_proposal(&mut f.conn, &f.human, &orphan.id).unwrap_err();
    assert!(format!("{err:#}").contains("Epic"), "{err:#}");
    assert_eq!(get_proposal(&f.conn, &orphan.id).unwrap().unwrap().state, "pending");

    // A Story of another Epic is no place in this one's order, and nothing it runs after.
    let m = milestone::create_milestone(&mut f.conn, &f.project_id, &f.human, "Other", None).unwrap();
    let other_epic = epic::create_epic(&mut f.conn, &f.human, &m.id, "Other epic").unwrap();
    let elsewhere = story::create_story(&mut f.conn, &f.human, &other_epic.id, "Elsewhere").unwrap();
    for extra in [json!({ "after": elsewhere.key }), json!({ "runs_after": elsewhere.key, "runs_after_reason": "x" })] {
        let mut args = json!({ "title": "T", "description": "D" });
        args.as_object_mut().unwrap().extend(extra.as_object().unwrap().clone());
        let err = story_tool(&mut f, "propose_story", args).unwrap_err();
        assert!(format!("{err:#}").contains("neither a Story of this Epic"), "{err:#}");
    }
    // A runs-after marker pointing outside the Epic is refused at apply time too.
    let smuggled = file_proposal(
        &mut f.conn,
        &agent,
        &NewProposal {
            project_id: &f.project_id,
            session_id: None,
            epic_id: Some(&f.epic_id),
            verb: ProposalVerb::Create,
            target: ProposalTarget::Story,
            target_id: None,
            payload: json!({ "title": "T", "runs_after_story_id": elsewhere.id, "runs_after_reason": "x" }),
            rationale: None,
        },
    )
    .unwrap();
    assert!(accept_proposal(&mut f.conn, &f.human, &smuggled.id).is_err());
    assert!(order(&f).is_empty(), "the refused Story rolled back with its decision");
}

#[test]
fn a_malformed_story_call_is_refused_before_anything_is_written() {
    let mut f = shaping();
    let s = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    for (tool, args) in [
        ("propose_story", json!({ "description": "D" })),
        ("propose_story", json!({ "title": "T" })),
        ("propose_story", json!({ "title": "T", "description": "D", "after": s.key, "before": s.key })),
        ("propose_story", json!({ "title": "T", "description": "D", "runs_after": s.key })),
        ("propose_story", json!({ "title": "T", "description": "D", "runs_after_reason": "why" })),
        ("propose_story", json!({ "title": "T", "description": "D", "runs_after": s.key, "runs_after_reason": "two\nlines" })),
        ("propose_story", json!({ "title": "T", "description": "D", "after": "FLY-999" })),
        ("propose_story_order", json!({ "story": s.key, "action": "move", "after": s.key })),
        ("propose_story_order", json!({ "story": s.key, "action": "swap", "why": "y" })),
        ("propose_story_order", json!({ "story": s.key, "action": "retire" })),
        ("propose_story_order", json!({ "story": "FLY-999", "action": "retire", "why": "y" })),
    ] {
        assert!(story_tool(&mut f, tool, args.clone()).is_err(), "{tool} {args}");
    }
    assert!(proposals_on_epic(&f.conn, &f.epic_id).unwrap().is_empty());
}

#[test]
fn accepted_reorder_and_retire_proposals_change_the_order_or_drop_the_story() {
    let mut f = shaping();
    for title in ["A", "B", "C"] {
        story::create_story(&mut f.conn, &f.human, &f.epic_id, title).unwrap();
    }
    let (a, c) = (story_titled(&f, "A"), story_titled(&f, "C"));
    let moved = proposal_id(
        &story_tool(&mut f, "propose_story_order", json!({ "story": a.key, "action": "move", "after": c.key, "why": "A needs C's table" }))
            .unwrap(),
    );
    let p = get_proposal(&f.conn, &moved).unwrap().unwrap();
    assert_eq!((p.verb.as_str(), p.target_id.as_deref()), ("reorder", Some(a.id.as_str())));
    assert_eq!(order(&f), ["A", "B", "C"], "nothing moves until it is accepted");
    accept_proposal(&mut f.conn, &f.human, &moved).unwrap();
    assert_eq!(order(&f), ["B", "C", "A"]);

    let b = story_titled(&f, "B");
    let retired = proposal_id(
        &story_tool(&mut f, "propose_story_order", json!({ "story": b.key, "action": "retire", "why": "Folded into C" })).unwrap(),
    );
    accept_proposal(&mut f.conn, &f.human, &retired).unwrap();
    assert_eq!(story_titled(&f, "B").state, "dropped");

    // A rejected reorder changes nothing.
    let c = story_titled(&f, "C");
    let kept = proposal_id(
        &story_tool(&mut f, "propose_story_order", json!({ "story": c.key, "action": "move", "before": b.key, "why": "y" })).unwrap(),
    );
    reject_proposal(&mut f.conn, &f.human, &kept, None).unwrap();
    assert_eq!(order(&f), ["B", "C", "A"]);

    // Only a Story still in Shaping is retired by a Proposal.
    let a = story_titled(&f, "A");
    f.conn.execute("UPDATE stories SET state = 'ready' WHERE id = ?1", [&a.id]).unwrap();
    let err = story_tool(&mut f, "propose_story_order", json!({ "story": a.key, "action": "retire", "why": "y" })).unwrap_err();
    assert!(format!("{err:#}").contains("Shaping"), "{err:#}");
}

#[test]
fn a_new_story_ghost_ranks_among_other_ghosts() {
    let mut f = shaping();
    let one = propose_story(&mut f, "One", json!({}));
    let three = propose_story(&mut f, "Three", json!({}));
    let two = propose_story(&mut f, "Two", json!({ "after": one }));
    let rank = |id: &str| get_proposal(&f.conn, id).unwrap().unwrap().payload["rank"].as_str().unwrap().to_string();
    assert!(rank(&one) < rank(&two) && rank(&two) < rank(&three), "a ghost lands between the ghosts it names");
    for id in [&three, &one, &two] {
        accept_proposal(&mut f.conn, &f.human, id).unwrap();
    }
    assert_eq!(order(&f), ["One", "Two", "Three"]);
}

#[test]
fn amend_edits_a_new_storys_words_but_not_its_place_or_what_it_runs_after() {
    let mut f = shaping();
    let first = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    let id = propose_story(&mut f, "Feed", json!({ "runs_after": first.key, "runs_after_reason": "shares the parser" }));
    let original = get_proposal(&f.conn, &id).unwrap().unwrap().payload;

    let mut moved = original.clone();
    moved["rank"] = json!(core::ranking::rank_after(Some(original["rank"].as_str().unwrap())).unwrap());
    assert!(accept_proposal_amended(&mut f.conn, &f.human, &id, &moved).is_err(), "the place is kept");
    let mut unhooked = original.clone();
    unhooked["runs_after_story_id"] = Value::Null;
    unhooked["runs_after_reason"] = Value::Null;
    assert!(accept_proposal_amended(&mut f.conn, &f.human, &id, &unhooked).is_err(), "what it runs after is kept");

    let mut edited = original.clone();
    edited["title"] = json!("Feed row");
    edited["runs_after_reason"] = json!("shares `FeedRow.tsx`");
    accept_proposal_amended(&mut f.conn, &f.human, &id, &edited).unwrap();
    let feed = story_titled(&f, "Feed row");
    assert_eq!(feed.runs_after_reason.as_deref(), Some("shares `FeedRow.tsx`"));
}

#[test]
fn story_proposals_read_as_what_they_do_in_the_stage_status_and_block_its_close() {
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    propose_story(&mut f, "Feed row", json!({}));
    story_tool(&mut f, "propose_story_order", json!({ "story": parser.key, "action": "move", "why": "last" })).unwrap();
    story_tool(&mut f, "propose_story_order", json!({ "story": parser.key, "action": "retire", "why": "gone" })).unwrap();
    let stage = open_stage(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap().unwrap();
    let status = stage_status(&f.conn, &stage.id).unwrap();
    let labels: Vec<String> = status.open_items.iter().map(|i| i.label()).collect();
    assert_eq!(
        labels,
        [
            "A Proposal to add the Story “Feed row” is undecided".to_string(),
            format!("A Proposal to move {} “Parser” in the order is undecided", parser.key),
            format!("A Proposal to retire {} “Parser” is undecided", parser.key),
        ]
    );
    assert!(!status.closable());
}

#[test]
fn the_slice_stage_names_its_tools_and_the_packet_lists_the_stories_and_their_proposals() {
    let purpose = StageKind::Slice.purpose();
    assert!(purpose.contains("`propose_story`") && purpose.contains("`propose_story_order`"), "{purpose}");
    assert!(purpose.contains("never blocks"), "{purpose}");

    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    let schema = propose_story(&mut f, "Schema", json!({}));
    propose_story(&mut f, "Feed row", json!({ "runs_after": parser.key, "runs_after_reason": "shares `FeedRow.tsx`" }));
    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    let stories = &packet[packet.find("## Stories").unwrap()..packet.find("## Rounds").unwrap()];
    assert!(stories.contains(&format!("- {} Parser (Shaping)", parser.key)), "{stories}");
    assert!(stories.contains(&format!("- New Story \"Schema\" (proposal_id {schema})")), "{stories}");
    assert!(stories.contains(&format!("runs after {}: shares `FeedRow.tsx`", parser.key)), "{stories}");
}

// ============================================================================================
// Issue #128: writing the Acceptance criteria and their Checks
// ============================================================================================

/// Close the Challenge the spec and Slice into Stories Stages and start the Criteria Stage's session,
/// as the developer would: closing a Stage ends the session that worked it.
fn in_criteria_stage(f: &mut Fixture) {
    for _ in 0..2 {
        let stage = open_stage(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap().unwrap();
        close_stage(&mut f.conn, &f.human, &stage.id).unwrap();
    }
    f.session_id = start_shaping_session(
        &mut f.conn,
        &ShapingSubject::Epic(f.epic_id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &f.human,
    )
    .unwrap()
    .id;
}

/// `propose_criterion` on Story `story` (its key) with `statement` and an optional Check command.
fn propose_criterion(f: &mut Fixture, story: &str, statement: &str, check: Option<&str>) -> anyhow::Result<String> {
    let mut args = json!({ "story": story, "statement": statement });
    if let Some(check) = check {
        args["check"] = json!(check);
    }
    Ok(proposal_id(&story_tool(f, "propose_criterion", args)?))
}

#[test]
fn propose_criterion_is_a_shaping_tool_answered_at_once_that_creates_nothing() {
    assert!(SHAPING_TOOL_NAMES.contains(&"propose_criterion"), "{SHAPING_TOOL_NAMES:?}");
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    in_criteria_stage(&mut f);
    let id = propose_criterion(&mut f, &parser.key, "A malformed line is skipped", Some("cargo test -p core --test parser")).unwrap();
    let p = get_proposal(&f.conn, &id).unwrap().unwrap();
    assert_eq!((p.verb.as_str(), p.target_type.as_str(), p.state.as_str()), ("create", "criterion", "pending"));
    assert_eq!(p.epic_id.as_deref(), Some(f.epic_id.as_str()));
    assert_eq!(p.target_id, None, "no criterion exists until it is accepted");
    assert_eq!(
        p.payload,
        json!({ "story_id": parser.id, "statement": "A malformed line is skipped", "check_command": "cargo test -p core --test parser" })
    );
    assert!(criteria_for_story(&f.conn, &parser.id).unwrap().is_empty(), "filing creates nothing");
}

#[test]
fn accepting_a_criterion_creates_it_on_its_story_with_its_check_and_leaves_it_unaccepted_for_review() {
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    in_criteria_stage(&mut f);
    let checked = propose_criterion(&mut f, &parser.key, "A malformed line is skipped", Some("cargo test -p core --test parser")).unwrap();
    let judged = propose_criterion(&mut f, &parser.key, "The error reads plainly", None).unwrap();
    for id in [&checked, &judged] {
        accept_proposal(&mut f.conn, &f.human, id).unwrap();
    }

    let criteria = criteria_for_story(&f.conn, &parser.id).unwrap();
    let statements: Vec<&str> = criteria.iter().map(|c| c.statement.as_str()).collect();
    assert_eq!(statements, ["A malformed line is skipped", "The error reads plainly"], "in the order accepted");
    for c in &criteria {
        assert_eq!(c.story_id, parser.id, "anchored to the Story the Proposal named");
        assert_eq!((c.accepted_by.as_deref(), c.accepted_at.as_deref()), (None, None), "accepted at review, not here");
    }
    let check = check_for_criterion(&f.conn, &criteria[0].id).unwrap().expect("the Check came with it");
    assert_eq!(check.command, "cargo test -p core --test parser");
    assert_eq!(check_for_criterion(&f.conn, &criteria[1].id).unwrap(), None, "no command: judged at review");

    let p = get_proposal(&f.conn, &checked).unwrap().unwrap();
    assert_eq!(p.target_id.as_deref(), Some(criteria[0].id.as_str()), "the Proposal names the criterion it created");
    // Written as the developer who accepted it: a Check is never the agent's to set.
    let creators: Vec<String> = {
        let mut stmt = f.conn.prepare("SELECT created_by FROM acceptance_criteria UNION ALL SELECT created_by FROM checks").unwrap();
        stmt.query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    };
    assert_eq!(creators, vec![f.human.clone(); 3]);
    assert_eq!(events(&f.conn, "check.set").len(), 1);
}

#[test]
fn amend_edits_a_criterions_statement_and_check_but_not_its_story() {
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    let feed = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Feed").unwrap();
    in_criteria_stage(&mut f);
    let id = propose_criterion(&mut f, &parser.key, "It parses", Some("cargo test")).unwrap();
    let original = get_proposal(&f.conn, &id).unwrap().unwrap().payload;

    let mut moved = original.clone();
    moved["story_id"] = json!(feed.id);
    let err = accept_proposal_amended(&mut f.conn, &f.human, &id, &moved).unwrap_err();
    assert!(format!("{err:#}").contains("Story"), "{err:#}");

    let mut edited = original.clone();
    edited["statement"] = json!("A malformed line is skipped");
    edited["check_command"] = Value::Null;
    accept_proposal_amended(&mut f.conn, &f.human, &id, &edited).unwrap();
    let criteria = criteria_for_story(&f.conn, &parser.id).unwrap();
    assert_eq!(criteria.len(), 1);
    assert_eq!(criteria[0].statement, "A malformed line is skipped");
    assert_eq!(check_for_criterion(&f.conn, &criteria[0].id).unwrap(), None, "the developer struck the Check out");
}

#[test]
fn a_criterion_is_proposed_only_on_a_shaping_story_of_the_epic_in_the_criteria_stage() {
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    // Slicing first: criteria wait for their Stage.
    let err = propose_criterion(&mut f, &parser.key, "It parses", None).unwrap_err();
    assert!(format!("{err:#}").contains("Write the Acceptance criteria"), "{err:#}");

    let gone = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Gone").unwrap();
    story::set_story_state(&mut f.conn, &f.human, &gone.id, story::StoryState::Dropped).unwrap();
    let m = milestone::create_milestone(&mut f.conn, &f.project_id, &f.human, "Other", None).unwrap();
    let other_epic = epic::create_epic(&mut f.conn, &f.human, &m.id, "Other epic").unwrap();
    let elsewhere = story::create_story(&mut f.conn, &f.human, &other_epic.id, "Elsewhere").unwrap();
    in_criteria_stage(&mut f);
    let pending_story = propose_story(&mut f, "Later", json!({}));

    for (story, statement, check, says) in [
        (gone.key.as_str(), "It parses", None, "dropped"),
        (elsewhere.key.as_str(), "It parses", None, "neither a Story of this Epic"),
        (pending_story.as_str(), "It parses", None, "not a Story yet"),
        (parser.key.as_str(), "   ", None, "statement"),
        (parser.key.as_str(), "It parses", Some("  "), "check"),
        ("FLY-999", "It parses", None, "neither a Story of this Epic"),
    ] {
        let err = propose_criterion(&mut f, story, statement, check).unwrap_err();
        assert!(format!("{err:#}").contains(says), "{story} {statement:?} {check:?}: {err:#}");
    }
    assert!(story_tool(&mut f, "propose_criterion", json!({ "statement": "It parses" })).is_err(), "a criterion names its Story");
    let filed: Vec<_> = proposals_on_epic(&f.conn, &f.epic_id).unwrap().into_iter().filter(|p| p.target_type == "criterion").collect();
    assert!(filed.is_empty(), "{filed:?}");

    // A criterion Proposal on a Story retired before it is decided is not applied.
    let id = propose_criterion(&mut f, &parser.key, "It parses", None).unwrap();
    f.conn.execute("UPDATE stories SET state = 'dropped' WHERE id = ?1", [&parser.id]).unwrap();
    assert!(accept_proposal(&mut f.conn, &f.human, &id).is_err());
    assert!(criteria_for_story(&f.conn, &parser.id).unwrap().is_empty());
    assert_eq!(get_proposal(&f.conn, &id).unwrap().unwrap().state, "pending", "the refused decision rolled back");
}

#[test]
fn criterion_proposals_read_as_what_they_do_in_the_stage_status() {
    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    in_criteria_stage(&mut f);
    propose_criterion(&mut f, &parser.key, "A malformed line is skipped", None).unwrap();
    let stage = open_stage(&f.conn, &ShapingSubject::Epic(f.epic_id.clone())).unwrap().unwrap();
    let labels: Vec<String> = stage_status(&f.conn, &stage.id).unwrap().open_items.iter().map(|i| i.label()).collect();
    // The Story is named once, through its Proposal: two items for one decision would read as two blockers.
    assert_eq!(labels, [format!("A Proposal to add the criterion “A malformed line is skipped” to {} is undecided", parser.key)]);

    // Rejected, the Proposal leaves the Story with no criterion, and the Story is listed again.
    let pending = proposals_on_epic(&f.conn, &f.epic_id).unwrap().into_iter().find(|p| p.target_type == "criterion").unwrap();
    reject_proposal(&mut f.conn, &f.human, &pending.id, None).unwrap();
    let labels: Vec<String> = stage_status(&f.conn, &stage.id).unwrap().open_items.iter().map(|i| i.label()).collect();
    assert_eq!(labels, [format!("{} “Parser” has no Acceptance criterion", parser.key)]);
}

#[test]
fn the_criteria_stage_names_its_tool_and_the_packet_lists_each_storys_criteria_and_checks() {
    let purpose = StageKind::Criteria.purpose();
    assert!(purpose.contains("`propose_criterion`"), "{purpose}");
    assert!(purpose.contains("judged at review"), "{purpose}");

    let mut f = shaping();
    let parser = story::create_story(&mut f.conn, &f.human, &f.epic_id, "Parser").unwrap();
    in_criteria_stage(&mut f);
    let checked = propose_criterion(&mut f, &parser.key, "A malformed line is skipped", Some("cargo test -p core --test parser")).unwrap();
    let judged = propose_criterion(&mut f, &parser.key, "The error reads plainly", None).unwrap();
    accept_proposal(&mut f.conn, &f.human, &checked).unwrap();
    accept_proposal(&mut f.conn, &f.human, &judged).unwrap();
    let pending = propose_criterion(&mut f, &parser.key, "It is fast", Some("cargo bench")).unwrap();
    let rejected = propose_criterion(&mut f, &parser.key, "It is pretty", None).unwrap();
    reject_proposal(&mut f.conn, &f.human, &rejected, Some("Not observable")).unwrap();

    let packet = build_epic_shaping_packet(&f.conn, &f.epic_id).unwrap();
    let stories = &packet[packet.find("## Stories").unwrap()..packet.find("## Rounds").unwrap()];
    assert!(stories.contains("  - A malformed line is skipped · Check: `cargo test -p core --test parser`"), "{stories}");
    assert!(stories.contains("  - The error reads plainly · judged at review"), "{stories}");
    assert!(
        stories.contains(&format!("- Criterion on {}: \"It is fast\" · Check: `cargo bench` (proposal_id {pending})", parser.key)),
        "{stories}"
    );
    assert!(packet.contains("create criterion \"It is pretty\"; rejected: Not observable"), "{packet}");
}
