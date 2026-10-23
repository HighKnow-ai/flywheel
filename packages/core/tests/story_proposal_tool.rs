//! Issue #160 (docs/mvp-spec.md §5): a running Story files a Proposal with `propose`, capped at 3 open
//! Proposals per session, withdrawable with `proposal_withdraw`, and answered at once.
//!
//! - `propose` takes a `kind` (new_story, amend_criterion, amend_epic_spec, reorder_story,
//!   retire_story, new_epic), a one-line `why` and an `evidence` line. Every kind is answered at
//!   once: a Proposal never pauses the agent.
//! - A 4th open Proposal is refused, naming `proposal_withdraw`. Withdrawing one of its own pending
//!   Proposals frees a slot.
//! - Identity comes from the session: a call lands only on the session's own Epic and its Stories,
//!   only while the session is live, and never from a shaping session.

mod common;

use core::domain::acceptance_criterion::{create_criterion, get_criterion};
use core::domain::epic::{self, get_epic};
use core::domain::milestone;
use core::domain::proposal::{accept_proposal, get_proposal, proposals_filed_by_story, OPEN_PROPOSALS_PER_SESSION};
use core::domain::proposal_apply::Applied;
use core::domain::session::{agent_actor_id, start_shaping_session, ShapingSubject};
use core::domain::session_kind::{story_board_tools, SessionKind};
use core::domain::story::{self, get_story, stories_in_epic, StoryState};
use core::domain::story_proposal_tool::{apply_story_proposal_call, StoryProposalCall, STORY_PROPOSAL_TOOL_NAMES};
use rusqlite::Connection;
use serde_json::{json, Value};

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    epic_id: String,
    /// The Milestone after the Current one: where a New Epic lands.
    next_milestone_id: String,
    /// The Story the session runs on.
    own: story::Story,
    /// A Story of the same Epic still in Shaping, one Ready, and one in another Epic.
    shaping: story::Story,
    ready: story::Story,
    elsewhere: story::Story,
    session_id: String,
}

fn move_story(conn: &mut Connection, human: &str, story_id: &str, to: &[StoryState]) {
    for state in to {
        story::set_story_state(conn, human, story_id, *state).unwrap();
    }
}

/// A Roadmap of two Milestones; the Current one holds Epic "Execution" with a Running Story and a
/// live Story session on it, a Story in Shaping and a Ready one, and Epic "Other" with one Story.
fn fixture() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Board and review", None).unwrap();
    let next = milestone::create_milestone(&mut conn, &project.id, &human, "Relay", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Execution").unwrap();
    let other = epic::create_epic(&mut conn, &human, &m.id, "Other").unwrap();
    let own = story::create_story(&mut conn, &human, &e.id, "Parser").unwrap();
    let shaping = story::create_story(&mut conn, &human, &e.id, "Lexer").unwrap();
    let ready = story::create_story(&mut conn, &human, &e.id, "Printer").unwrap();
    let elsewhere = story::create_story(&mut conn, &human, &other.id, "Elsewhere").unwrap();
    move_story(&mut conn, &human, &own.id, &[StoryState::Ready, StoryState::Running]);
    move_story(&mut conn, &human, &ready.id, &[StoryState::Ready]);
    let session_id = story_session(&mut conn, &project.id, &own.id);
    Fixture {
        conn,
        human,
        project_id: project.id,
        epic_id: e.id,
        next_milestone_id: next.id,
        own,
        shaping,
        ready,
        elsewhere,
        session_id,
    }
}

/// A live Story session row on `story_id`, as `start_session` writes it (without the worktree).
fn story_session(conn: &mut Connection, project_id: &str, story_id: &str) -> String {
    let agent = agent_actor_id(conn).unwrap();
    let id = core::ids::new_id();
    conn.execute(
        "INSERT INTO sessions (id, story_id, project_id, actor_id, status, permission_mode, log_path, started_at)
         VALUES (?1, ?2, ?3, ?4, 'running', 'acceptEdits', '/tmp/x.jsonl', '2026-10-23T00:00:00Z')",
        rusqlite::params![id, story_id, project_id, agent],
    )
    .unwrap();
    id
}

/// One tool call on session `session_id`, run as the core runs it.
fn call(conn: &mut Connection, session_id: &str, tool: &str, args: Value) -> anyhow::Result<Value> {
    let parsed = StoryProposalCall::parse(tool, &args)?;
    let outcome = apply_story_proposal_call(conn, session_id, &parsed)?;
    Ok(outcome.result)
}

fn propose(f: &mut Fixture, args: Value) -> anyhow::Result<Value> {
    let mut args = args;
    args["why"] = json!("found while working the Parser");
    args["evidence"] = json!("src/parser.rs:42 panics on an empty line");
    call(&mut f.conn, &f.session_id, "propose", args)
}

fn proposal_id(answer: &Value) -> String {
    answer["proposal_id"].as_str().expect("the answer names the Proposal").to_string()
}

fn withdraw(f: &mut Fixture, id: &str) -> anyhow::Result<Value> {
    call(&mut f.conn, &f.session_id, "proposal_withdraw", json!({ "proposal_id": id }))
}

#[test]
fn the_tool_names_are_propose_and_proposal_withdraw_and_a_story_session_pre_approves_both() {
    assert_eq!(STORY_PROPOSAL_TOOL_NAMES, ["propose", "proposal_withdraw"]);
    let tools = story_board_tools();
    for name in STORY_PROPOSAL_TOOL_NAMES {
        assert!(tools.contains(&format!("mcp__flywheel-board__{name}")), "{name} is pre-approved: {tools:?}");
    }
    let shaping = SessionKind::Shaping.launch_policy().allowed_tools;
    assert!(!shaping.iter().any(|t| t.ends_with("__propose") || t.ends_with("__proposal_withdraw")), "{shaping:?}");
}

#[test]
fn a_story_session_files_each_of_the_six_kinds_and_is_answered_at_once() {
    let mut f = fixture();
    let criterion = create_criterion(&mut f.conn, &f.human, &f.shaping.id, "Lexes an empty line").unwrap();
    let kinds = [
        json!({ "kind": "new_story", "title": "Empty-line recovery", "description": "Recover from an empty line" }),
        json!({ "kind": "amend_criterion", "criterion_id": criterion.id, "statement": "Lexes an empty line as no token", "check_command": "cargo test lexer" }),
        json!({ "kind": "amend_epic_spec", "field": "scope", "text": "The parser and the lexer" }),
        json!({ "kind": "reorder_story", "story": f.ready.key, "before": f.shaping.key }),
        json!({ "kind": "retire_story", "story": f.shaping.key }),
        json!({ "kind": "new_epic", "title": "Error recovery", "problem": "One bad line stops the parse" }),
    ];
    let expected = [
        ("create", "story", None, Some(f.epic_id.clone())),
        ("amend", "criterion", Some(criterion.id.clone()), Some(f.epic_id.clone())),
        ("amend", "epic", Some(f.epic_id.clone()), Some(f.epic_id.clone())),
        ("reorder", "story", Some(f.ready.id.clone()), Some(f.epic_id.clone())),
        ("retire", "story", Some(f.shaping.id.clone()), Some(f.epic_id.clone())),
        ("create", "epic", None, None),
    ];
    for (i, (args, (verb, target, target_id, epic_id))) in kinds.into_iter().zip(expected).enumerate() {
        let kind = args["kind"].as_str().unwrap().to_string();
        let answer = propose(&mut f, args).unwrap_or_else(|e| panic!("{kind} is filed: {e:#}"));
        assert_eq!(answer["state"], "pending", "{kind}: {answer}");
        assert_eq!(answer["kind"], kind.as_str());
        assert!(answer["next"].as_str().unwrap().contains("do not wait"), "{kind} never pauses the agent: {answer}");
        let p = get_proposal(&f.conn, &proposal_id(&answer)).unwrap().unwrap();
        assert_eq!((p.verb.as_str(), p.target_type.as_str()), (verb, target), "{kind}");
        assert_eq!(p.target_id, target_id, "{kind}");
        assert_eq!(p.epic_id, epic_id, "{kind}");
        assert_eq!(p.session_id.as_deref(), Some(f.session_id.as_str()));
        assert_eq!(p.rationale.as_deref(), Some("found while working the Parser"));
        assert_eq!(p.evidence.as_deref(), Some("src/parser.rs:42 panics on an empty line"));
        assert_eq!((p.stage_id, p.round_id), (None, None), "a Story session's Proposal hangs off no Stage");
        // Three are open at a time: withdraw each kind once it is filed, so the next one fits.
        if i % 3 == 2 {
            for q in proposals_filed_by_story(&f.conn, &f.own.id).unwrap().iter().filter(|q| q.state == "pending") {
                withdraw(&mut f, &q.id).unwrap();
            }
        }
    }
    // The New Epic lands after the Current Milestone.
    let new_epic = proposals_filed_by_story(&f.conn, &f.own.id).unwrap().into_iter().last().unwrap();
    assert_eq!(new_epic.payload["milestone_id"], f.next_milestone_id.as_str());
}

#[test]
fn a_fourth_open_proposal_is_refused_naming_proposal_withdraw_and_withdrawing_frees_a_slot() {
    let mut f = fixture();
    let mut ids = Vec::new();
    for n in 0..OPEN_PROPOSALS_PER_SESSION {
        let answer = propose(&mut f, json!({ "kind": "new_story", "title": format!("Follow-up {n}") })).unwrap();
        assert_eq!(answer["open"], n + 1, "{answer}");
        assert_eq!(answer["cap"], OPEN_PROPOSALS_PER_SESSION);
        ids.push(proposal_id(&answer));
    }
    let err = propose(&mut f, json!({ "kind": "new_story", "title": "One too many" })).unwrap_err();
    let message = format!("{err:#}");
    assert!(message.contains("proposal_withdraw"), "the refusal names the withdraw tool: {message}");
    assert!(message.contains('3'), "{message}");

    let answer = withdraw(&mut f, &ids[1]).unwrap();
    assert_eq!(answer["state"], "withdrawn");
    assert_eq!(answer["open"], 2);
    let p = get_proposal(&f.conn, &ids[1]).unwrap().unwrap();
    assert_eq!(p.state, "withdrawn");
    assert_eq!(p.decided_by, None, "withdrawing decides nothing: it is the agent's own act");
    let label: String = f
        .conn
        .query_row("SELECT json_extract(payload, '$.label') FROM events WHERE event_type = 'proposal.withdrawn' AND stream_id = ?1", [&ids[1]], |r| r.get(0))
        .unwrap();
    assert_eq!(label, "Withdrew a Proposal");

    propose(&mut f, json!({ "kind": "new_story", "title": "The combined one" })).expect("the freed slot takes a new Proposal");

    // A withdrawn Proposal is closed: it cannot be withdrawn again, nor decided.
    let again = withdraw(&mut f, &ids[1]).unwrap_err();
    assert!(format!("{again:#}").contains("withdrawn"), "{again:#}");
    let decide = accept_proposal(&mut f.conn, &f.human, &ids[1]).unwrap_err();
    assert!(format!("{decide:#}").contains("withdrawn"), "{decide:#}");
}

#[test]
fn a_session_withdraws_only_its_own_pending_proposals() {
    let mut f = fixture();
    let mine = proposal_id(&propose(&mut f, json!({ "kind": "new_story", "title": "Mine" })).unwrap());
    accept_proposal(&mut f.conn, &f.human, &mine).unwrap();
    let decided = withdraw(&mut f, &mine).unwrap_err();
    assert!(format!("{decided:#}").contains("accepted"), "a decided Proposal stays decided: {decided:#}");

    let theirs_session = story_session(&mut f.conn, &f.project_id, &f.own.id);
    let theirs = proposal_id(&call(&mut f.conn, &theirs_session, "propose", json!({
        "kind": "new_story", "title": "Theirs", "why": "w", "evidence": "e",
    })).unwrap());
    let err = withdraw(&mut f, &theirs).unwrap_err();
    assert!(format!("{err:#}").contains("another session"), "{err:#}");
    assert_eq!(get_proposal(&f.conn, &theirs).unwrap().unwrap().state, "pending");
}

#[test]
fn a_call_lands_only_on_the_sessions_own_epic_and_only_while_it_is_live() {
    let mut f = fixture();
    let foreign_criterion = create_criterion(&mut f.conn, &f.human, &f.elsewhere.id, "Elsewhere holds").unwrap();
    for (args, needle) in [
        (json!({ "kind": "reorder_story", "story": f.elsewhere.key }), "not a Story of this Epic"),
        (json!({ "kind": "retire_story", "story": f.elsewhere.key }), "not a Story of this Epic"),
        (json!({ "kind": "amend_criterion", "criterion_id": foreign_criterion.id, "statement": "x" }), "not a criterion of this Epic"),
        // Retire only before a Story starts: a started Story is dropped by the developer.
        (json!({ "kind": "retire_story", "story": f.own.key }), "running"),
        (json!({ "kind": "amend_epic_spec", "field": "nope", "text": "x" }), "not an Epic spec field"),
        (json!({ "kind": "nonsense" }), "new_story"),
    ] {
        let err = propose(&mut f, args.clone()).unwrap_err();
        assert!(format!("{err:#}").contains(needle), "{args}: {err:#}");
    }
    let missing = call(&mut f.conn, &f.session_id, "propose", json!({ "kind": "new_story", "title": "T", "why": "w" })).unwrap_err();
    assert!(format!("{missing:#}").contains("evidence"), "{missing:#}");

    // An ended session can no longer file.
    f.conn.execute("UPDATE sessions SET status = 'completed', ended_at = 'now' WHERE id = ?1", [&f.session_id]).unwrap();
    let ended = propose(&mut f, json!({ "kind": "new_story", "title": "Late" })).unwrap_err();
    assert!(format!("{ended:#}").contains("ended"), "{ended:#}");

    // A shaping session has no Story: `propose` is not its tool.
    let shaping = start_shaping_session(
        &mut f.conn,
        &ShapingSubject::Milestone(f.next_milestone_id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &f.human,
    )
    .unwrap();
    let err = call(&mut f.conn, &shaping.id, "propose", json!({ "kind": "new_story", "title": "T", "why": "w", "evidence": "e" })).unwrap_err();
    assert!(format!("{err:#}").contains("shaping session"), "{err:#}");
}

#[test]
fn accepted_proposals_from_execution_land_while_the_session_keeps_running() {
    let mut f = fixture();
    let ready_key = f.ready.key.clone();
    let retire = proposal_id(&propose(&mut f, json!({ "kind": "retire_story", "story": ready_key })).unwrap());
    let new_epic = proposal_id(&propose(&mut f, json!({ "kind": "new_epic", "title": "Error recovery" })).unwrap());
    let new_story = proposal_id(&propose(&mut f, json!({ "kind": "new_story", "title": "Recovery" })).unwrap());

    assert_eq!(accept_proposal(&mut f.conn, &f.human, &retire).unwrap(), Applied::StoryRetired { story_id: f.ready.id.clone() });
    assert_eq!(get_story(&f.conn, &f.ready.id).unwrap().unwrap().state, "dropped", "a Ready Story is retired before it starts");

    let Applied::Roadmap { record_id } = accept_proposal(&mut f.conn, &f.human, &new_epic).unwrap() else { panic!("a New Epic lands on the Roadmap") };
    let created = get_epic(&f.conn, &record_id).unwrap().unwrap();
    assert_eq!((created.milestone_id.as_str(), created.state.as_str()), (f.next_milestone_id.as_str(), "shaping"));

    let Applied::StoryCreated { story_id } = accept_proposal(&mut f.conn, &f.human, &new_story).unwrap() else { panic!("a New Story is created") };
    let stories = stories_in_epic(&f.conn, &f.epic_id).unwrap();
    assert_eq!(stories.last().unwrap().id, story_id, "a New Story from execution goes at the end of the Epic's order");
    assert_eq!(stories.last().unwrap().state, "shaping");

    let status: String = f.conn.query_row("SELECT status FROM sessions WHERE id = ?1", [&f.session_id], |r| r.get(0)).unwrap();
    assert_eq!(status, "running", "deciding a Proposal never touches the session that filed it");
}

#[test]
fn an_amend_criterion_is_checked_and_recorded_only_until_its_effect_lands() {
    let mut f = fixture();
    let criterion = create_criterion(&mut f.conn, &f.human, &f.own.id, "Parses a line").unwrap();
    let blank = propose(&mut f, json!({ "kind": "amend_criterion", "criterion_id": criterion.id, "statement": "  " })).unwrap_err();
    assert!(format!("{blank:#}").contains("statement"), "{blank:#}");
    let id = proposal_id(&propose(&mut f, json!({ "kind": "amend_criterion", "criterion_id": criterion.id, "statement": "Parses an empty line" })).unwrap());
    assert_eq!(accept_proposal(&mut f.conn, &f.human, &id).unwrap(), Applied::RecordedOnly);
    assert_eq!(get_criterion(&f.conn, &criterion.id).unwrap().unwrap().statement, "Parses a line");
}

#[test]
fn the_proposals_table_keeps_its_columns_and_the_round_questions_foreign_key() {
    let f = fixture();
    let columns: Vec<String> = f
        .conn
        .prepare("SELECT name FROM pragma_table_info('proposals')")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    for column in ["stage_id", "round_id", "duplicate_of", "withdrawn_at", "evidence"] {
        assert!(columns.iter().any(|c| c == column), "{column} is on proposals: {columns:?}");
    }
    let parent: String = f
        .conn
        .query_row("SELECT \"table\" FROM pragma_foreign_key_list('round_questions') WHERE \"from\" = 'adr_proposal_id'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(parent, "proposals");
}
