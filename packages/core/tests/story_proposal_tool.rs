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

use flywheel_core::domain::acceptance_criterion::{create_criterion, get_criterion};
use flywheel_core::domain::epic::{self, get_epic};
use flywheel_core::domain::milestone;
use flywheel_core::domain::proposal::{
    accept_proposal, accept_proposal_released, get_proposal, proposals_filed_by_story,
    proposals_for_triage, reject_proposal, OPEN_PROPOSALS_PER_SESSION,
};
use flywheel_core::domain::proposal_apply::Applied;
use flywheel_core::domain::session::{agent_actor_id, start_shaping_session, ShapingSubject};
use flywheel_core::domain::session_kind::{story_board_tools, SessionKind};
use flywheel_core::domain::story::{self, get_story, stories_in_epic, StoryState};
use flywheel_core::domain::story_proposal_tool::{
    apply_story_proposal_call, StoryProposalCall, STORY_PROPOSAL_TOOL_NAMES,
};
use rusqlite::{Connection, OptionalExtension};
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
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Board and review", None)
        .unwrap();
    let next = milestone::create_milestone(&mut conn, &project.id, &human, "Relay", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Execution").unwrap();
    let other = epic::create_epic(&mut conn, &human, &m.id, "Other").unwrap();
    let own = story::create_story(&mut conn, &human, &e.id, "Parser").unwrap();
    let shaping = story::create_story(&mut conn, &human, &e.id, "Lexer").unwrap();
    let ready = story::create_story(&mut conn, &human, &e.id, "Printer").unwrap();
    let elsewhere = story::create_story(&mut conn, &human, &other.id, "Elsewhere").unwrap();
    move_story(
        &mut conn,
        &human,
        &own.id,
        &[StoryState::Ready, StoryState::Running],
    );
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
    let id = flywheel_core::ids::new_id();
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

/// A New Story's criteria, for the calls that are not about them (issue #166: at least one).
fn one_criterion() -> Value {
    json!([{ "statement": "It holds", "check": "cargo test it_holds" }])
}

fn propose(f: &mut Fixture, args: Value) -> anyhow::Result<Value> {
    let mut args = args;
    if args["kind"] == "new_story" && args.get("criteria").is_none() {
        args["criteria"] = one_criterion();
    }
    args["why"] = json!("found while working the Parser");
    args["evidence"] = json!("src/parser.rs:42 panics on an empty line");
    call(&mut f.conn, &f.session_id, "propose", args)
}

fn proposal_id(answer: &Value) -> String {
    answer["proposal_id"]
        .as_str()
        .expect("the answer names the Proposal")
        .to_string()
}

fn withdraw(f: &mut Fixture, id: &str) -> anyhow::Result<Value> {
    call(
        &mut f.conn,
        &f.session_id,
        "proposal_withdraw",
        json!({ "proposal_id": id }),
    )
}

#[test]
fn the_tool_names_are_propose_and_proposal_withdraw_and_a_story_session_pre_approves_both() {
    assert_eq!(STORY_PROPOSAL_TOOL_NAMES, ["propose", "proposal_withdraw"]);
    let tools = story_board_tools();
    for name in STORY_PROPOSAL_TOOL_NAMES {
        assert!(
            tools.contains(&format!("mcp__flywheel-board__{name}")),
            "{name} is pre-approved: {tools:?}"
        );
    }
    let shaping = SessionKind::Shaping.launch_policy().allowed_tools;
    assert!(
        !shaping
            .iter()
            .any(|t| t.ends_with("__propose") || t.ends_with("__proposal_withdraw")),
        "{shaping:?}"
    );
}

#[test]
fn a_story_session_files_each_of_the_six_kinds_and_is_answered_at_once() {
    let mut f = fixture();
    let criterion =
        create_criterion(&mut f.conn, &f.human, &f.shaping.id, "Lexes an empty line").unwrap();
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
        (
            "amend",
            "criterion",
            Some(criterion.id.clone()),
            Some(f.epic_id.clone()),
        ),
        (
            "amend",
            "epic",
            Some(f.epic_id.clone()),
            Some(f.epic_id.clone()),
        ),
        (
            "reorder",
            "story",
            Some(f.ready.id.clone()),
            Some(f.epic_id.clone()),
        ),
        (
            "retire",
            "story",
            Some(f.shaping.id.clone()),
            Some(f.epic_id.clone()),
        ),
        ("create", "epic", None, None),
    ];
    for (i, (args, (verb, target, target_id, epic_id))) in
        kinds.into_iter().zip(expected).enumerate()
    {
        let kind = args["kind"].as_str().unwrap().to_string();
        let answer = propose(&mut f, args).unwrap_or_else(|e| panic!("{kind} is filed: {e:#}"));
        assert_eq!(answer["state"], "pending", "{kind}: {answer}");
        assert_eq!(answer["kind"], kind.as_str());
        assert!(
            answer["next"].as_str().unwrap().contains("do not wait"),
            "{kind} never pauses the agent: {answer}"
        );
        let p = get_proposal(&f.conn, &proposal_id(&answer))
            .unwrap()
            .unwrap();
        assert_eq!(
            (p.verb.as_str(), p.target_type.as_str()),
            (verb, target),
            "{kind}"
        );
        assert_eq!(p.target_id, target_id, "{kind}");
        assert_eq!(p.epic_id, epic_id, "{kind}");
        assert_eq!(p.session_id.as_deref(), Some(f.session_id.as_str()));
        assert_eq!(
            p.rationale.as_deref(),
            Some("found while working the Parser")
        );
        assert_eq!(
            p.evidence.as_deref(),
            Some("src/parser.rs:42 panics on an empty line")
        );
        assert_eq!(
            (p.stage_id, p.round_id),
            (None, None),
            "a Story session's Proposal hangs off no Stage"
        );
        // Three are open at a time: withdraw each kind once it is filed, so the next one fits.
        if i % 3 == 2 {
            for q in proposals_filed_by_story(&f.conn, &f.own.id)
                .unwrap()
                .iter()
                .filter(|q| q.state == "pending")
            {
                withdraw(&mut f, &q.id).unwrap();
            }
        }
    }
    // The New Epic lands after the Current Milestone.
    let new_epic = proposals_filed_by_story(&f.conn, &f.own.id)
        .unwrap()
        .into_iter()
        .last()
        .unwrap();
    assert_eq!(
        new_epic.payload["milestone_id"],
        f.next_milestone_id.as_str()
    );
}

#[test]
fn a_fourth_open_proposal_is_refused_naming_proposal_withdraw_and_withdrawing_frees_a_slot() {
    let mut f = fixture();
    let mut ids = Vec::new();
    for n in 0..OPEN_PROPOSALS_PER_SESSION {
        let answer = propose(
            &mut f,
            json!({ "kind": "new_story", "title": format!("Follow-up {n}") }),
        )
        .unwrap();
        assert_eq!(answer["open"], n + 1, "{answer}");
        assert_eq!(answer["cap"], OPEN_PROPOSALS_PER_SESSION);
        ids.push(proposal_id(&answer));
    }
    let err = propose(
        &mut f,
        json!({ "kind": "new_story", "title": "One too many" }),
    )
    .unwrap_err();
    let message = format!("{err:#}");
    assert!(
        message.contains("proposal_withdraw"),
        "the refusal names the withdraw tool: {message}"
    );
    assert!(message.contains('3'), "{message}");

    let answer = withdraw(&mut f, &ids[1]).unwrap();
    assert_eq!(answer["state"], "withdrawn");
    assert_eq!(answer["open"], 2);
    let p = get_proposal(&f.conn, &ids[1]).unwrap().unwrap();
    assert_eq!(p.state, "withdrawn");
    assert_eq!(
        p.decided_by, None,
        "withdrawing decides nothing: it is the agent's own act"
    );
    let label: String = f
        .conn
        .query_row("SELECT json_extract(payload, '$.label') FROM events WHERE event_type = 'proposal.withdrawn' AND stream_id = ?1", [&ids[1]], |r| r.get(0))
        .unwrap();
    assert_eq!(label, "Withdrew a Proposal");

    propose(
        &mut f,
        json!({ "kind": "new_story", "title": "The combined one" }),
    )
    .expect("the freed slot takes a new Proposal");

    // A withdrawn Proposal is closed: it cannot be withdrawn again, nor decided.
    let again = withdraw(&mut f, &ids[1]).unwrap_err();
    assert!(format!("{again:#}").contains("withdrawn"), "{again:#}");
    let decide = accept_proposal(&mut f.conn, &f.human, &ids[1]).unwrap_err();
    assert!(format!("{decide:#}").contains("withdrawn"), "{decide:#}");
}

#[test]
fn a_session_withdraws_only_its_own_pending_proposals() {
    let mut f = fixture();
    let mine =
        proposal_id(&propose(&mut f, json!({ "kind": "new_story", "title": "Mine" })).unwrap());
    accept_proposal(&mut f.conn, &f.human, &mine).unwrap();
    let decided = withdraw(&mut f, &mine).unwrap_err();
    assert!(
        format!("{decided:#}").contains("accepted"),
        "a decided Proposal stays decided: {decided:#}"
    );

    let theirs_session = story_session(&mut f.conn, &f.project_id, &f.own.id);
    let theirs = proposal_id(&call(&mut f.conn, &theirs_session, "propose", json!({
        "kind": "new_story", "title": "Theirs", "why": "w", "evidence": "e", "criteria": one_criterion(),
    })).unwrap());
    let err = withdraw(&mut f, &theirs).unwrap_err();
    assert!(format!("{err:#}").contains("another session"), "{err:#}");
    assert_eq!(
        get_proposal(&f.conn, &theirs).unwrap().unwrap().state,
        "pending"
    );
}

#[test]
fn a_call_lands_only_on_the_sessions_own_epic_and_only_while_it_is_live() {
    let mut f = fixture();
    let foreign_criterion =
        create_criterion(&mut f.conn, &f.human, &f.elsewhere.id, "Elsewhere holds").unwrap();
    for (args, needle) in [
        (
            json!({ "kind": "reorder_story", "story": f.elsewhere.key }),
            "not a Story of this Epic",
        ),
        (
            json!({ "kind": "retire_story", "story": f.elsewhere.key }),
            "not a Story of this Epic",
        ),
        (
            json!({ "kind": "amend_criterion", "criterion_id": foreign_criterion.id, "statement": "x" }),
            "not a criterion of this Epic",
        ),
        // Retire only before a Story starts: a started Story is dropped by the developer.
        (
            json!({ "kind": "retire_story", "story": f.own.key }),
            "running",
        ),
        (
            json!({ "kind": "amend_epic_spec", "field": "nope", "text": "x" }),
            "not an Epic spec field",
        ),
        (json!({ "kind": "nonsense" }), "new_story"),
    ] {
        let err = propose(&mut f, args.clone()).unwrap_err();
        assert!(format!("{err:#}").contains(needle), "{args}: {err:#}");
    }
    let missing = call(
        &mut f.conn,
        &f.session_id,
        "propose",
        json!({ "kind": "new_story", "title": "T", "why": "w", "criteria": one_criterion() }),
    )
    .unwrap_err();
    assert!(format!("{missing:#}").contains("evidence"), "{missing:#}");

    // An ended session can no longer file.
    f.conn
        .execute(
            "UPDATE sessions SET status = 'completed', ended_at = 'now' WHERE id = ?1",
            [&f.session_id],
        )
        .unwrap();
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
    let err = call(&mut f.conn, &shaping.id, "propose", json!({ "kind": "new_story", "title": "T", "why": "w", "evidence": "e", "criteria": one_criterion() })).unwrap_err();
    assert!(format!("{err:#}").contains("shaping session"), "{err:#}");
}

#[test]
fn accepted_proposals_from_execution_land_while_the_session_keeps_running() {
    let mut f = fixture();
    let ready_key = f.ready.key.clone();
    let retire = proposal_id(
        &propose(
            &mut f,
            json!({ "kind": "retire_story", "story": ready_key }),
        )
        .unwrap(),
    );
    let new_epic = proposal_id(
        &propose(
            &mut f,
            json!({ "kind": "new_epic", "title": "Error recovery" }),
        )
        .unwrap(),
    );
    let new_story =
        proposal_id(&propose(&mut f, json!({ "kind": "new_story", "title": "Recovery" })).unwrap());

    assert_eq!(
        accept_proposal(&mut f.conn, &f.human, &retire).unwrap(),
        Applied::StoryRetired {
            story_id: f.ready.id.clone()
        }
    );
    assert_eq!(
        get_story(&f.conn, &f.ready.id).unwrap().unwrap().state,
        "dropped",
        "a Ready Story is retired before it starts"
    );

    let Applied::Roadmap { record_id } = accept_proposal(&mut f.conn, &f.human, &new_epic).unwrap()
    else {
        panic!("a New Epic lands on the Roadmap")
    };
    let created = get_epic(&f.conn, &record_id).unwrap().unwrap();
    assert_eq!(
        (created.milestone_id.as_str(), created.state.as_str()),
        (f.next_milestone_id.as_str(), "shaping")
    );

    let Applied::StoryCreated { story_id } =
        accept_proposal(&mut f.conn, &f.human, &new_story).unwrap()
    else {
        panic!("a New Story is created")
    };
    let stories = stories_in_epic(&f.conn, &f.epic_id).unwrap();
    assert_eq!(
        stories.last().unwrap().id,
        story_id,
        "a New Story from execution goes at the end of the Epic's order"
    );
    assert_eq!(stories.last().unwrap().state, "shaping");

    let status: String = f
        .conn
        .query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            [&f.session_id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        status, "running",
        "deciding a Proposal never touches the session that filed it"
    );
}

fn session_status(f: &Fixture) -> String {
    f.conn
        .query_row(
            "SELECT status FROM sessions WHERE id = ?1",
            [&f.session_id],
            |r| r.get(0),
        )
        .unwrap()
}

/// Issue #162, the Epic's exit test: a Proposal filed by a running Story is triaged from the drawer
/// (`proposals_for_triage`, grouped by the record it lands on: each Epic in Roadmap order, then the
/// Roadmap for a New Epic) and its effect lands on the board, without pausing the agent. A judged-on
/// change is not the drawer's (issue #163).
#[test]
fn a_proposal_filed_by_a_running_story_is_triaged_from_the_drawer_and_lands_without_pausing_the_agent(
) {
    let mut f = fixture();
    // Epic "Other" comes after "Execution" on the Roadmap; its Story files first, and still sorts after.
    let other_epic = f.elsewhere.epic_id.clone();
    move_story(
        &mut f.conn,
        &f.human,
        &f.elsewhere.id,
        &[StoryState::Ready, StoryState::Running],
    );
    let other_session = story_session(&mut f.conn, &f.project_id, &f.elsewhere.id);
    let elsewhere = proposal_id(&call(&mut f.conn, &other_session, "propose", json!({
        "kind": "new_story", "title": "Elsewhere follow-up", "why": "w", "evidence": "e", "criteria": one_criterion(),
    })).unwrap());

    let (ready_key, lexer_key, own_key) = (
        f.ready.key.clone(),
        f.shaping.key.clone(),
        f.own.key.clone(),
    );
    let new_story = proposal_id(
        &propose(
            &mut f,
            json!({ "kind": "new_story", "title": "Empty-line recovery" }),
        )
        .unwrap(),
    );
    let reorder = proposal_id(
        &propose(
            &mut f,
            json!({ "kind": "reorder_story", "story": ready_key, "before": lexer_key }),
        )
        .unwrap(),
    );
    let new_epic = proposal_id(
        &propose(
            &mut f,
            json!({ "kind": "new_epic", "title": "Error recovery" }),
        )
        .unwrap(),
    );
    // A second session of the same Story files a retirement and a judged-on change.
    let second = story_session(&mut f.conn, &f.project_id, &f.own.id);
    let retire = proposal_id(
        &call(
            &mut f.conn,
            &second,
            "propose",
            json!({
                "kind": "retire_story", "story": lexer_key, "why": "w", "evidence": "e",
            }),
        )
        .unwrap(),
    );
    let judged_on = proposal_id(&call(&mut f.conn, &second, "propose", json!({
        "kind": "amend_epic_spec", "field": "scope", "text": "Parser only", "why": "w", "evidence": "e",
    })).unwrap());

    let drawer = proposals_for_triage(&f.conn, &f.project_id).unwrap();
    let ids: Vec<&str> = drawer.iter().map(|t| t.proposal.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            new_story.as_str(),
            reorder.as_str(),
            retire.as_str(),
            elsewhere.as_str(),
            new_epic.as_str()
        ]
    );
    assert!(
        !ids.contains(&judged_on.as_str()),
        "a judged-on change is its own Needs-you item, not the drawer's"
    );
    for t in &drawer[..3] {
        assert_eq!(
            t.story_key, own_key,
            "each card names the Story that filed it"
        );
        assert_eq!(
            t.epic_key.as_deref(),
            Some(get_epic(&f.conn, &f.epic_id).unwrap().unwrap().key.as_str())
        );
        assert_eq!(t.epic_title.as_deref(), Some("Execution"));
    }
    assert_eq!(drawer[3].story_key, f.elsewhere.key);
    assert_eq!(
        (
            drawer[3].proposal.epic_id.as_deref(),
            drawer[3].epic_title.as_deref()
        ),
        (Some(other_epic.as_str()), Some("Other"))
    );
    assert_eq!(
        (
            drawer[4].epic_key.as_deref(),
            drawer[4].milestone_title.as_deref()
        ),
        (None, Some("Relay")),
        "a New Epic lands after this Milestone"
    );
    let place = drawer[1]
        .reorder
        .as_ref()
        .expect("a Reorder carries its places");
    assert_eq!(
        (
            drawer[1].target_key.as_deref(),
            drawer[1].target_title.as_deref()
        ),
        (Some(ready_key.as_str()), Some("Printer"))
    );
    assert_eq!(
        (place.now_after.as_deref(), place.proposed_after.as_deref()),
        (Some(lexer_key.as_str()), Some(own_key.as_str()))
    );
    assert_eq!(drawer[2].target_title.as_deref(), Some("Lexer"));

    // Amend the New Story's title, then accept the rest, in the drawer's order.
    let amended =
        json!({ "title": "Recover from an empty line", "description": "Skip it and go on" });
    let decided =
        accept_proposal_released(&mut f.conn, &f.human, &new_story, Some(&amended)).unwrap();
    let Applied::StoryCreated { story_id } = decided.applied else {
        panic!("a New Story is created")
    };
    assert_eq!(
        get_story(&f.conn, &story_id).unwrap().unwrap().title,
        "Recover from an empty line"
    );
    assert_eq!(session_status(&f), "running");

    accept_proposal(&mut f.conn, &f.human, &reorder).unwrap();
    let order: Vec<String> = stories_in_epic(&f.conn, &f.epic_id)
        .unwrap()
        .into_iter()
        .map(|s| s.key)
        .collect();
    assert!(
        order.iter().position(|k| *k == ready_key) < order.iter().position(|k| *k == lexer_key),
        "the Reorder changed the execution order: {order:?}"
    );
    accept_proposal(&mut f.conn, &f.human, &retire).unwrap();
    assert_eq!(
        get_story(&f.conn, &f.shaping.id).unwrap().unwrap().state,
        "dropped"
    );
    reject_proposal(&mut f.conn, &f.human, &elsewhere, Some("Not now")).unwrap();
    let Applied::Roadmap { record_id } = accept_proposal(&mut f.conn, &f.human, &new_epic).unwrap()
    else {
        panic!("a New Epic")
    };
    assert_eq!(
        get_epic(&f.conn, &record_id).unwrap().unwrap().milestone_id,
        f.next_milestone_id
    );

    let left: Vec<String> = proposals_for_triage(&f.conn, &f.project_id)
        .unwrap()
        .into_iter()
        .map(|t| t.proposal.id)
        .collect();
    assert!(
        left.is_empty(),
        "every decided Proposal leaves the drawer: {left:?}"
    );
    assert_eq!(
        session_status(&f),
        "running",
        "triage never pauses the agent that filed"
    );
    // The agent goes on: its slots are free again and it files the next one at once.
    let next = propose(&mut f, json!({ "kind": "new_story", "title": "Next one" })).unwrap();
    assert_eq!(
        (next["state"].as_str(), next["open"].as_i64()),
        (Some("pending"), Some(1))
    );
}

#[test]
fn an_amend_criterion_is_checked_and_applied_when_accepted() {
    let mut f = fixture();
    let criterion = create_criterion(&mut f.conn, &f.human, &f.own.id, "Parses a line").unwrap();
    let blank = propose(
        &mut f,
        json!({ "kind": "amend_criterion", "criterion_id": criterion.id, "statement": "  " }),
    )
    .unwrap_err();
    assert!(format!("{blank:#}").contains("statement"), "{blank:#}");
    let id = proposal_id(&propose(&mut f, json!({ "kind": "amend_criterion", "criterion_id": criterion.id, "statement": "Parses an empty line" })).unwrap());
    // Issue #163 gives it its effect; `proposal_judged_on.rs` covers the rest.
    assert_eq!(
        accept_proposal(&mut f.conn, &f.human, &id).unwrap(),
        Applied::CriterionAmended {
            criterion_id: criterion.id.clone(),
            story_id: f.own.id.clone()
        }
    );
    assert_eq!(
        get_criterion(&f.conn, &criterion.id)
            .unwrap()
            .unwrap()
            .statement,
        "Parses an empty line"
    );
}

/// A fresh database migrates through 0011 (`reviews`, #155) and then 0012, in file order.
#[test]
fn a_fresh_database_migrates_through_0011_then_0012() {
    let sources = flywheel_core::db::migration_sources();
    let at = |needle: &str| {
        sources
            .iter()
            .position(|s| s.contains(needle))
            .unwrap_or_else(|| panic!("{needle} is a migration"))
    };
    assert!(sources.len() >= 12, "0001 through 0012, none missing");
    assert!(
        at("CREATE TABLE reviews") == 10 && at("CREATE TABLE proposals_new") == 11,
        "0011, then 0012"
    );
    let f = fixture();
    let version: i64 = f
        .conn
        .query_row("PRAGMA user_version", [], |r| r.get(0))
        .unwrap();
    assert_eq!(version, sources.len() as i64);
    let reviews: i64 = f
        .conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'reviews'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(
        reviews, 1,
        "0011's table is there beside the rebuilt proposals"
    );
    let fk_violations: i64 = f
        .conn
        .query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(fk_violations, 0);
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
    for column in [
        "stage_id",
        "round_id",
        "duplicate_of",
        "withdrawn_at",
        "evidence",
    ] {
        assert!(
            columns.iter().any(|c| c == column),
            "{column} is on proposals: {columns:?}"
        );
    }
    let parent: String = f
        .conn
        .query_row("SELECT \"table\" FROM pragma_foreign_key_list('round_questions') WHERE \"from\" = 'adr_proposal_id'", [], |r| r.get(0))
        .unwrap();
    assert_eq!(parent, "proposals");
}

/// Issue #166: a New Story from execution carries its criteria, each with its Check or none, and
/// accepting it creates the Story in Shaping with them, as the developer who accepted it.
#[test]
fn accepting_a_new_story_with_criteria_creates_it_in_shaping_with_its_criteria_and_checks() {
    let mut f = fixture();
    let answer = propose(&mut f, json!({
        "kind": "new_story", "title": "Empty-line recovery", "description": "Skip an empty line",
        "criteria": [
            { "statement": "An empty line yields no token", "check": "  cargo test -p core --test lexer empty_line  " },
            { "statement": "The error names the line", "check": "   " },
            { "statement": "Recovery reads well in the feed" },
        ],
    }))
    .unwrap();
    let id = proposal_id(&answer);
    let filed = get_proposal(&f.conn, &id).unwrap().unwrap();
    assert_eq!(
        filed.payload["criteria"],
        json!([
            { "statement": "An empty line yields no token", "check": "cargo test -p core --test lexer empty_line" },
            { "statement": "The error names the line" },
            { "statement": "Recovery reads well in the feed" },
        ]),
        "a blank check is judged at review, like a missing one"
    );

    let Applied::StoryCreated { story_id } = accept_proposal(&mut f.conn, &f.human, &id).unwrap()
    else {
        panic!("a New Story")
    };
    assert_eq!(
        get_story(&f.conn, &story_id).unwrap().unwrap().state,
        "shaping"
    );
    let criteria =
        flywheel_core::domain::acceptance_criterion::criteria_for_story(&f.conn, &story_id)
            .unwrap();
    let statements: Vec<&str> = criteria.iter().map(|c| c.statement.as_str()).collect();
    assert_eq!(
        statements,
        [
            "An empty line yields no token",
            "The error names the line",
            "Recovery reads well in the feed"
        ]
    );
    assert!(
        criteria.iter().all(|c| c.accepted_by.is_none()),
        "a criterion is accepted at review, not by accepting the Story"
    );
    let checks: Vec<Option<String>> = criteria
        .iter()
        .map(|c| {
            f.conn
                .query_row(
                    "SELECT command FROM checks WHERE criterion_id = ?1",
                    [&c.id],
                    |r| r.get(0),
                )
                .optional()
                .unwrap()
        })
        .collect();
    assert_eq!(
        checks,
        vec![
            Some("cargo test -p core --test lexer empty_line".to_string()),
            None,
            None
        ]
    );
}

#[test]
fn a_new_story_without_criteria_or_with_a_malformed_one_is_refused_before_anything_is_filed() {
    let mut f = fixture();
    for (criteria, needle) in [
        (Value::Null, "criteria"),
        (json!([]), "criteria"),
        (json!([{ "statement": "  " }]), "statement"),
        (json!(["just text"]), "criterion 1"),
        (json!({ "statement": "x" }), "array"),
        (
            json!((0..21)
                .map(|n| json!({ "statement": format!("c{n}") }))
                .collect::<Vec<_>>()),
            "at most 20",
        ),
    ] {
        let args = json!({ "kind": "new_story", "title": "T", "why": "w", "evidence": "e", "criteria": criteria });
        let err = call(&mut f.conn, &f.session_id, "propose", args).unwrap_err();
        assert!(format!("{err:#}").contains(needle), "{criteria}: {err:#}");
    }
    assert!(proposals_filed_by_story(&f.conn, &f.own.id)
        .unwrap()
        .is_empty());
}

/// Amend edits a New Story's title and description only: its criteria survive the amended payload.
#[test]
fn an_amended_new_story_keeps_its_criteria() {
    let mut f = fixture();
    let id =
        proposal_id(&propose(&mut f, json!({ "kind": "new_story", "title": "Recovery" })).unwrap());
    let mut amended = get_proposal(&f.conn, &id).unwrap().unwrap().payload;
    amended["title"] = json!("Recover from an empty line");
    let decided = accept_proposal_released(&mut f.conn, &f.human, &id, Some(&amended)).unwrap();
    let Applied::StoryCreated { story_id } = decided.applied else {
        panic!("a New Story")
    };
    assert_eq!(
        flywheel_core::domain::acceptance_criterion::criteria_for_story(&f.conn, &story_id)
            .unwrap()
            .len(),
        1
    );
}
