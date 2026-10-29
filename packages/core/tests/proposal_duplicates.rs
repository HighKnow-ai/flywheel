//! Issue #165 (docs/mvp-spec.md §5 "Duplicates"): a Proposal from execution that repeats one already
//! pending is flagged at filing, and accepting the original closes it.
//!
//! - Detection is deterministic: the same kind on the same target (the same Story, criterion or Epic
//!   field), or, for a New Story or a New Epic, the same Epic or Milestone and the same title, compared
//!   case-insensitively. No fuzzy or model matching.
//! - A duplicate does not count toward the cap of 3 open Proposals, and the agent is told at once.
//! - Accepting the original (or any Proposal of the group) rejects the others in the same transaction,
//!   as the developer, with the reason "duplicate of <title>".
//! - Rejecting or withdrawing the original frees its duplicates: the oldest becomes the original.

mod common;

use flywheel_core::domain::acceptance_criterion::create_criterion;
use flywheel_core::domain::epic;
use flywheel_core::domain::milestone;
use flywheel_core::domain::proposal::{
    accept_proposal, get_proposal, open_proposals_in_session, proposals_for_triage,
    reject_proposal, OPEN_PROPOSALS_PER_SESSION,
};
use flywheel_core::domain::proposal::{file_proposal, NewProposal};
use flywheel_core::domain::proposal_apply::RoadmapChange;
use flywheel_core::domain::session::{agent_actor_id, start_shaping_session, ShapingSubject};
use flywheel_core::domain::session_kind::SessionKind;
use flywheel_core::domain::story::{self, StoryState};
use flywheel_core::domain::story_proposal_tool::{apply_story_proposal_call, StoryProposalCall};
use rusqlite::Connection;
use serde_json::{json, Value};

struct Fixture {
    conn: Connection,
    human: String,
    project_id: String,
    epic_id: String,
    other_epic_id: String,
    /// The Milestone after the Current one: where a New Epic lands.
    next_milestone_id: String,
    /// The Story the first session runs on, and a second running Story of the same Epic.
    own: story::Story,
    sibling: story::Story,
    /// A Story still in Shaping and one Ready, in the same Epic.
    shaping: story::Story,
    ready: story::Story,
    session_id: String,
    sibling_session: String,
    /// A live session of a running Story in another Epic.
    elsewhere_session: String,
}

fn move_story(conn: &mut Connection, human: &str, story_id: &str, to: &[StoryState]) {
    for state in to {
        story::set_story_state(conn, human, story_id, *state).unwrap();
    }
}

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

fn fixture() -> Fixture {
    let (mut conn, human, project) = common::seeded_project();
    let m = milestone::create_milestone(&mut conn, &project.id, &human, "Board and review", None)
        .unwrap();
    let next = milestone::create_milestone(&mut conn, &project.id, &human, "Relay", None).unwrap();
    let e = epic::create_epic(&mut conn, &human, &m.id, "Execution").unwrap();
    let other = epic::create_epic(&mut conn, &human, &m.id, "Other").unwrap();
    let own = story::create_story(&mut conn, &human, &e.id, "Parser").unwrap();
    let sibling = story::create_story(&mut conn, &human, &e.id, "Printer").unwrap();
    let shaping = story::create_story(&mut conn, &human, &e.id, "Lexer").unwrap();
    let ready = story::create_story(&mut conn, &human, &e.id, "Formatter").unwrap();
    let elsewhere = story::create_story(&mut conn, &human, &other.id, "Elsewhere").unwrap();
    for s in [&own, &sibling, &elsewhere] {
        move_story(
            &mut conn,
            &human,
            &s.id,
            &[StoryState::Ready, StoryState::Running],
        );
    }
    move_story(&mut conn, &human, &ready.id, &[StoryState::Ready]);
    let session_id = story_session(&mut conn, &project.id, &own.id);
    let sibling_session = story_session(&mut conn, &project.id, &sibling.id);
    let elsewhere_session = story_session(&mut conn, &project.id, &elsewhere.id);
    Fixture {
        conn,
        human,
        project_id: project.id,
        epic_id: e.id,
        other_epic_id: other.id,
        next_milestone_id: next.id,
        own,
        sibling,
        shaping,
        ready,
        session_id,
        sibling_session,
        elsewhere_session,
    }
}

fn propose_on(conn: &mut Connection, session_id: &str, args: Value) -> anyhow::Result<Value> {
    let mut args = args;
    if args["kind"] == "new_story" && args.get("criteria").is_none() {
        // Issue #166: a New Story carries at least one criterion.
        args["criteria"] = json!([{ "statement": "It holds" }]);
    }
    args["why"] = json!("found while working");
    args["evidence"] = json!("src/parser.rs:42");
    let parsed = StoryProposalCall::parse("propose", &args)?;
    Ok(apply_story_proposal_call(conn, session_id, &parsed)?.result)
}

fn id_of(answer: &Value) -> String {
    answer["proposal_id"]
        .as_str()
        .expect("the answer names the Proposal")
        .to_string()
}

fn duplicate_of(f: &Fixture, id: &str) -> Option<String> {
    get_proposal(&f.conn, id).unwrap().unwrap().duplicate_of
}

#[test]
fn a_new_story_with_the_same_title_in_the_same_epic_is_flagged_whatever_its_case() {
    let mut f = fixture();
    let original = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_story", "title": "Empty-line recovery" }),
        )
        .unwrap(),
    );
    assert_eq!(
        duplicate_of(&f, &original),
        None,
        "the first of its kind is the original"
    );

    let answer = propose_on(
        &mut f.conn,
        &f.sibling_session,
        json!({ "kind": "new_story", "title": "  EMPTY-LINE Recovery " }),
    )
    .unwrap();
    let duplicate = id_of(&answer);
    assert_eq!(
        duplicate_of(&f, &duplicate).as_deref(),
        Some(original.as_str())
    );
    // The agent hears it at once, in the answer to its call.
    assert_eq!(answer["state"], "pending");
    assert_eq!(
        answer["duplicate_of"]["proposal_id"],
        original.as_str(),
        "{answer}"
    );
    assert_eq!(
        answer["duplicate_of"]["title"], "Empty-line recovery",
        "{answer}"
    );
    let next = answer["next"].as_str().unwrap();
    assert!(
        next.contains("duplicate") && next.contains("Empty-line recovery"),
        "{next}"
    );

    // A different title, or the same title in another Epic, is not a duplicate.
    let other_title = id_of(
        &propose_on(
            &mut f.conn,
            &f.sibling_session,
            json!({ "kind": "new_story", "title": "Empty-line recovery 2" }),
        )
        .unwrap(),
    );
    assert_eq!(duplicate_of(&f, &other_title), None);
    let other_epic = id_of(
        &propose_on(
            &mut f.conn,
            &f.elsewhere_session,
            json!({ "kind": "new_story", "title": "Empty-line recovery" }),
        )
        .unwrap(),
    );
    assert_eq!(duplicate_of(&f, &other_epic), None);
    assert_eq!(
        get_proposal(&f.conn, &other_epic)
            .unwrap()
            .unwrap()
            .epic_id
            .as_deref(),
        Some(f.other_epic_id.as_str())
    );
}

#[test]
fn each_kind_is_a_duplicate_on_the_same_target_and_only_there() {
    let mut f = fixture();
    let criterion =
        create_criterion(&mut f.conn, &f.human, &f.shaping.id, "Lexes an empty line").unwrap();
    let other_criterion =
        create_criterion(&mut f.conn, &f.human, &f.shaping.id, "Lexes a comment").unwrap();
    let (ready, shaping) = (f.ready.key.clone(), f.shaping.key.clone());
    // (the original, a duplicate of it, a near miss that is not one)
    let cases = [
        (
            json!({ "kind": "amend_criterion", "criterion_id": criterion.id, "statement": "Lexes an empty line as no token" }),
            json!({ "kind": "amend_criterion", "criterion_id": criterion.id, "statement": "Skips an empty line" }),
            json!({ "kind": "amend_criterion", "criterion_id": other_criterion.id, "statement": "Lexes a comment as no token" }),
        ),
        (
            json!({ "kind": "amend_epic_spec", "field": "scope", "text": "The parser and the lexer" }),
            json!({ "kind": "amend_epic_spec", "field": "scope", "text": "The parser only" }),
            json!({ "kind": "amend_epic_spec", "field": "problem", "text": "One bad line stops the parse" }),
        ),
        (
            json!({ "kind": "reorder_story", "story": ready, "before": shaping }),
            json!({ "kind": "reorder_story", "story": ready }),
            json!({ "kind": "reorder_story", "story": shaping }),
        ),
        (
            json!({ "kind": "retire_story", "story": shaping }),
            json!({ "kind": "retire_story", "story": shaping }),
            json!({ "kind": "retire_story", "story": ready }),
        ),
        (
            json!({ "kind": "new_epic", "title": "Error recovery" }),
            json!({ "kind": "new_epic", "title": "error RECOVERY" }),
            json!({ "kind": "new_epic", "title": "Error reporting" }),
        ),
    ];
    for (original, duplicate, near_miss) in cases {
        let kind = original["kind"].as_str().unwrap().to_string();
        let o = id_of(&propose_on(&mut f.conn, &f.session_id, original).unwrap());
        let d = id_of(&propose_on(&mut f.conn, &f.sibling_session, duplicate).unwrap());
        let n = id_of(&propose_on(&mut f.conn, &f.sibling_session, near_miss).unwrap());
        assert_eq!(duplicate_of(&f, &o), None, "{kind}");
        assert_eq!(
            duplicate_of(&f, &d).as_deref(),
            Some(o.as_str()),
            "{kind}: the same target is a duplicate"
        );
        assert_eq!(duplicate_of(&f, &n), None, "{kind}: another target is not");
        // Clear the slate for the next kind: both sessions withdraw what they hold.
        for (session, id) in [
            (&f.session_id, &o),
            (&f.sibling_session, &d),
            (&f.sibling_session, &n),
        ] {
            let parsed =
                StoryProposalCall::parse("proposal_withdraw", &json!({ "proposal_id": id }))
                    .unwrap();
            apply_story_proposal_call(&mut f.conn, session, &parsed).unwrap();
        }
    }
    // A retirement and a reorder of the same Story are different kinds: neither duplicates the other.
    let shaping = f.shaping.key.clone();
    let retire = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "retire_story", "story": shaping }),
        )
        .unwrap(),
    );
    let reorder = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "reorder_story", "story": shaping }),
        )
        .unwrap(),
    );
    assert_eq!(
        (duplicate_of(&f, &retire), duplicate_of(&f, &reorder)),
        (None, None)
    );
}

#[test]
fn a_duplicate_does_not_count_toward_the_cap() {
    let mut f = fixture();
    let mut originals = Vec::new();
    for n in 0..OPEN_PROPOSALS_PER_SESSION {
        originals.push(id_of(
            &propose_on(
                &mut f.conn,
                &f.sibling_session,
                json!({ "kind": "new_story", "title": format!("Follow-up {n}") }),
            )
            .unwrap(),
        ));
    }
    for n in 0..OPEN_PROPOSALS_PER_SESSION {
        id_of(
            &propose_on(
                &mut f.conn,
                &f.session_id,
                json!({ "kind": "new_story", "title": format!("Own {n}") }),
            )
            .unwrap(),
        );
    }
    // At its cap, the session still files a duplicate: it holds no new slot.
    let answer = propose_on(
        &mut f.conn,
        &f.session_id,
        json!({ "kind": "new_story", "title": "follow-up 1" }),
    )
    .unwrap();
    assert_eq!(
        duplicate_of(&f, &id_of(&answer)).as_deref(),
        Some(originals[1].as_str())
    );
    assert_eq!(answer["open"], OPEN_PROPOSALS_PER_SESSION, "{answer}");
    assert_eq!(
        open_proposals_in_session(&f.conn, &f.session_id).unwrap(),
        OPEN_PROPOSALS_PER_SESSION
    );
    // A new one is still refused.
    let err = propose_on(
        &mut f.conn,
        &f.session_id,
        json!({ "kind": "new_story", "title": "Something new" }),
    )
    .unwrap_err();
    assert!(format!("{err:#}").contains("proposal_withdraw"), "{err:#}");
}

fn rejected_with(f: &Fixture, id: &str) -> (String, Option<String>, Option<String>) {
    let p = get_proposal(&f.conn, id).unwrap().unwrap();
    (p.state, p.rejection_reason, p.decided_by)
}

#[test]
fn accepting_the_original_closes_its_duplicates_as_the_developer_with_a_reason() {
    let mut f = fixture();
    let original = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_story", "title": "Empty-line recovery" }),
        )
        .unwrap(),
    );
    let first = id_of(
        &propose_on(
            &mut f.conn,
            &f.sibling_session,
            json!({ "kind": "new_story", "title": "empty-line recovery" }),
        )
        .unwrap(),
    );
    let second = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_story", "title": "EMPTY-LINE RECOVERY" }),
        )
        .unwrap(),
    );
    let unrelated = id_of(
        &propose_on(
            &mut f.conn,
            &f.sibling_session,
            json!({ "kind": "new_story", "title": "Comments" }),
        )
        .unwrap(),
    );

    accept_proposal(&mut f.conn, &f.human, &original).unwrap();
    for d in [&first, &second] {
        let (state, reason, by) = rejected_with(&f, d);
        assert_eq!(state, "rejected");
        assert_eq!(reason.as_deref(), Some("duplicate of Empty-line recovery"));
        assert_eq!(
            by.as_deref(),
            Some(f.human.as_str()),
            "closed as the developer who accepted the original"
        );
        let decided_at: Option<String> = f
            .conn
            .query_row("SELECT decided_at FROM proposals WHERE id = ?1", [d], |r| {
                r.get(0)
            })
            .unwrap();
        let accepted_at: Option<String> = f
            .conn
            .query_row(
                "SELECT decided_at FROM proposals WHERE id = ?1",
                [&original],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            decided_at, accepted_at,
            "closed in the acceptance's own transaction"
        );
        let label: String = f
            .conn
            .query_row(
                "SELECT json_extract(payload, '$.label') FROM events WHERE event_type = 'proposal.rejected' AND stream_id = ?1",
                [d],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(label, "Closed a duplicate Proposal");
    }
    assert_eq!(
        get_proposal(&f.conn, &unrelated).unwrap().unwrap().state,
        "pending"
    );
    let drawer: Vec<String> = proposals_for_triage(&f.conn, &f.project_id)
        .unwrap()
        .into_iter()
        .map(|t| t.proposal.id)
        .collect();
    assert_eq!(
        drawer,
        vec![unrelated],
        "the closed duplicates leave the drawer with their original"
    );
    // Only one Story was created.
    let created = story::stories_in_epic(&f.conn, &f.epic_id)
        .unwrap()
        .into_iter()
        .filter(|s| s.title.eq_ignore_ascii_case("empty-line recovery"))
        .count();
    assert_eq!(created, 1);
}

#[test]
fn accepting_a_duplicate_instead_closes_the_original_and_the_rest() {
    let mut f = fixture();
    let original = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_story", "title": "Recovery" }),
        )
        .unwrap(),
    );
    let first = id_of(
        &propose_on(
            &mut f.conn,
            &f.sibling_session,
            json!({ "kind": "new_story", "title": "recovery" }),
        )
        .unwrap(),
    );
    let second = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_story", "title": "RECOVERY" }),
        )
        .unwrap(),
    );

    accept_proposal(&mut f.conn, &f.human, &first).unwrap();
    assert_eq!(
        duplicate_of(&f, &first),
        None,
        "the accepted one is the original now"
    );
    for d in [&original, &second] {
        let (state, reason, _) = rejected_with(&f, d);
        assert_eq!(
            (state.as_str(), reason.as_deref()),
            ("rejected", Some("duplicate of recovery"))
        );
        assert_eq!(
            duplicate_of(&f, d).as_deref(),
            Some(first.as_str()),
            "each closed one points at the one accepted"
        );
    }
}

#[test]
fn a_failed_acceptance_closes_nothing() {
    let mut f = fixture();
    let ready = f.ready.key.clone();
    let original = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "retire_story", "story": ready }),
        )
        .unwrap(),
    );
    let duplicate = id_of(
        &propose_on(
            &mut f.conn,
            &f.sibling_session,
            json!({ "kind": "retire_story", "story": ready }),
        )
        .unwrap(),
    );
    // The Story starts before the developer decides: the retirement no longer applies.
    move_story(&mut f.conn, &f.human, &f.ready.id, &[StoryState::Running]);
    accept_proposal(&mut f.conn, &f.human, &original).unwrap_err();
    assert_eq!(
        get_proposal(&f.conn, &original).unwrap().unwrap().state,
        "pending"
    );
    assert_eq!(
        get_proposal(&f.conn, &duplicate).unwrap().unwrap().state,
        "pending",
        "one transaction: nothing closed"
    );
    assert_eq!(
        duplicate_of(&f, &duplicate).as_deref(),
        Some(original.as_str())
    );
}

#[test]
fn rejecting_or_withdrawing_the_original_frees_its_duplicates_the_oldest_taking_its_place() {
    let mut f = fixture();
    let original = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_epic", "title": "Error recovery" }),
        )
        .unwrap(),
    );
    let first = id_of(
        &propose_on(
            &mut f.conn,
            &f.sibling_session,
            json!({ "kind": "new_epic", "title": "error recovery" }),
        )
        .unwrap(),
    );
    let second = id_of(
        &propose_on(
            &mut f.conn,
            &f.elsewhere_session,
            json!({ "kind": "new_epic", "title": "Error Recovery" }),
        )
        .unwrap(),
    );

    reject_proposal(&mut f.conn, &f.human, &original, Some("Not this Milestone")).unwrap();
    assert_eq!(
        get_proposal(&f.conn, &first).unwrap().unwrap().state,
        "pending",
        "the developer decides each on its own"
    );
    assert_eq!(
        duplicate_of(&f, &first),
        None,
        "the oldest duplicate is the original now"
    );
    assert_eq!(duplicate_of(&f, &second).as_deref(), Some(first.as_str()));
    assert_eq!(
        open_proposals_in_session(&f.conn, &f.sibling_session).unwrap(),
        1,
        "it holds a slot now"
    );

    let parsed =
        StoryProposalCall::parse("proposal_withdraw", &json!({ "proposal_id": first })).unwrap();
    apply_story_proposal_call(&mut f.conn, &f.sibling_session, &parsed).unwrap();
    assert_eq!(duplicate_of(&f, &second), None);
    assert_eq!(
        get_proposal(&f.conn, &second).unwrap().unwrap().state,
        "pending"
    );
}

#[test]
fn the_drawer_card_names_what_a_duplicate_repeats() {
    let mut f = fixture();
    let original = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_story", "title": "Empty-line recovery" }),
        )
        .unwrap(),
    );
    let duplicate = id_of(
        &propose_on(
            &mut f.conn,
            &f.sibling_session,
            json!({ "kind": "new_story", "title": "empty-line recovery" }),
        )
        .unwrap(),
    );
    let drawer = proposals_for_triage(&f.conn, &f.project_id).unwrap();
    assert_eq!(
        drawer.len(),
        2,
        "a duplicate still waits in the drawer, flagged"
    );
    assert_eq!(drawer[0].proposal.id, original);
    assert!(drawer[0].duplicate.is_none());
    let card = drawer.iter().find(|t| t.proposal.id == duplicate).unwrap();
    let flag = card
        .duplicate
        .as_ref()
        .expect("the duplicate's card is flagged");
    assert_eq!(flag.proposal_id, original);
    assert_eq!(flag.title, "Empty-line recovery");
    assert_eq!(
        flag.story_key.as_deref(),
        Some(f.own.key.as_str()),
        "and names the Story that filed the original"
    );
    assert_eq!(card.story_key, f.sibling.key);
}

#[test]
fn a_shaping_sessions_proposals_are_never_flagged() {
    let mut f = fixture();
    let story_side = id_of(
        &propose_on(
            &mut f.conn,
            &f.session_id,
            json!({ "kind": "new_epic", "title": "Error recovery" }),
        )
        .unwrap(),
    );
    let shaping = start_shaping_session(
        &mut f.conn,
        &ShapingSubject::Milestone(f.next_milestone_id.clone()),
        SessionKind::Shaping.launch_policy().permission_mode,
        &f.human,
    )
    .unwrap();
    let change = RoadmapChange::AddEpic {
        milestone_id: f.next_milestone_id.clone(),
        title: "Error recovery".into(),
        problem: None,
    };
    let (verb, target, target_id, payload) = change.to_proposal();
    let agent = agent_actor_id(&f.conn).unwrap();
    let filed = file_proposal(
        &mut f.conn,
        &agent,
        &NewProposal {
            project_id: &f.project_id,
            session_id: Some(&shaping.id),
            epic_id: None,
            verb,
            target,
            target_id,
            payload,
            rationale: Some("w"),
        },
    )
    .unwrap();
    assert_eq!(
        filed.duplicate_of, None,
        "shaping is made of Proposals; its Stage decides each"
    );
    assert_eq!(duplicate_of(&f, &story_side), None);
}
